const { Client } = require('minecraft-launcher-core');
const Handler = require('minecraft-launcher-core/components/handler');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { BASE_DIR } = require('./config');

let activeMinecraftProcess = null;
let activeLauncherClient = null;
let currentLaunchInfo = null;

function verifyFileSha1(filePath, expectedSha1) {
    if (!expectedSha1) return true;
    try {
        if (!fs.existsSync(filePath)) return false;
        const data = fs.readFileSync(filePath);
        const actualSha1 = crypto.createHash('sha1').update(data).digest('hex');
        return actualSha1.toLowerCase() === expectedSha1.toLowerCase();
    } catch (e) {
        return false;
    }
}

function isJarFileValid(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        const stats = fs.statSync(filePath);
        if (stats.size < 22) return false;
        const fd = fs.openSync(filePath, 'r');
        try {
            const headBuf = Buffer.alloc(4);
            fs.readSync(fd, headBuf, 0, 4, 0);
            if (headBuf[0] !== 0x50 || headBuf[1] !== 0x4b) {
                return false;
            }
            const tailLen = Math.min(stats.size, 65557);
            const tailBuf = Buffer.alloc(tailLen);
            fs.readSync(fd, tailBuf, 0, tailLen, stats.size - tailLen);
            return tailBuf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        } finally {
            fs.closeSync(fd);
        }
    } catch (e) {
        return false;
    }
}

// Intercept Handler.prototype.downloadAsync:
// Bleskurychlý downloader postavený na nativním Node fetch (HTTP/2 multiplexing, nulová socket starvation,
// 10s inactivity timeout namísto zamrzání na 50 sekund a paměťový buffer pro malé assety).
Handler.prototype.downloadAsync = async function(url, directory, name, retry = true, type = 'assets') {
    if (this.client && this.client._isCancelled) {
        return Promise.reject(new Error('LAUNCH_CANCELLED'));
    }

    const fullPath = path.join(directory, name);
    if (this.client && this.client._sessionDownloadedFiles) {
        this.client._sessionDownloadedFiles.add(fullPath);
    }

    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch (e) {}

    const controller = new AbortController();
    if (this.client && this.client._activeControllers) {
        this.client._activeControllers.add(controller);
    }

    // Inactivity timeout: pokud se spojení na školní/pomalé síti zasekne na 10s bez jediného bajtu, okamžitě abortujeme a zkusíme znovu
    let timeoutTimer = null;
    const resetTimeout = (ms = 10000) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
            try { controller.abort(new Error('ETIMEDOUT')); } catch (e) {}
        }, ms);
    };

    resetTimeout(10000);

    let fileStream = null;

    const cleanup = () => {
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
        }
        if (this.client && this.client._activeControllers) {
            this.client._activeControllers.delete(controller);
        }
        if (fileStream && this.client && this.client._activeStreams) {
            this.client._activeStreams.delete(fullPath);
        }
    };

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
            }
        });

        resetTimeout(10000);

        if (this.client && this.client._isCancelled) {
            cleanup();
            return false;
        }

        if (res.status === 404) {
            cleanup();
            this.client.emit('debug', `[MCLC]: Failed to download ${url} due to: File not found...`);
            return false;
        }

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const totalBytes = parseInt(res.headers.get('content-length')) || 0;
        let receivedBytes = 0;

        // Pro malé soubory (< 1.5 MB, což je 99.9 % assetů) stáhneme buffer rovnou do paměti a zapíšeme najednou.
        // Šetří tisíce otevírání/zavírání streamů a několikanásobně zrychluje I/O na disku.
        if (totalBytes > 0 && totalBytes < 1572864 && type !== 'version-jar') {
            const arrayBuf = await res.arrayBuffer();
            cleanup();
            if (this.client && this.client._isCancelled) return false;
            await fs.promises.writeFile(fullPath, Buffer.from(arrayBuf));
            if (name.endsWith('.jar') && !isJarFileValid(fullPath)) {
                try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}
                throw new Error(`Poškozený stažený archiv JAR: ${name}`);
            }
            this.client.emit('download', name);
            return { failed: false, asset: null };
        }

        // Pro velké soubory (client.jar, archivy) streamujeme na disk s průběžným hlášením postupu
        fileStream = fs.createWriteStream(fullPath);
        if (this.client && this.client._activeStreams) {
            this.client._activeStreams.set(fullPath, fileStream);
        }

        const nodeStream = Readable.fromWeb(res.body);
        nodeStream.on('data', (chunk) => {
            if (this.client && this.client._isCancelled) {
                try { controller.abort(); } catch (e) {}
                return;
            }
            receivedBytes += chunk.length;
            resetTimeout(10000);
            this.client.emit('download-status', {
                name: name,
                type: type,
                current: receivedBytes,
                total: totalBytes || receivedBytes
            });
        });

        await pipeline(nodeStream, fileStream);

        if (totalBytes > 0 && receivedBytes < totalBytes) {
            try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}
            throw new Error(`Neúplné stažení souboru ${name}: ${receivedBytes}/${totalBytes} B`);
        }

        if (name.endsWith('.jar') && !isJarFileValid(fullPath)) {
            try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}
            throw new Error(`Poškozený stažený archiv JAR: ${name}`);
        }

        cleanup();
        this.client.emit('download', name);
        return { failed: false, asset: null };

    } catch (err) {
        cleanup();
        try {
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch (e) {}

        if (this.client && this.client._isCancelled) {
            return false;
        }

        this.client.emit('debug', `[MCLC]: Chyba při stahování ${name} (${err.message}). Opakuji pokus... (${retry})`);

        if (retry) {
            // Rychlý backoff 120ms před opakováním pokusu
            await new Promise(r => setTimeout(r, 120));
            return await this.downloadAsync(url, directory, name, false, type);
        }
        return false;
    }
};

const origStartMinecraft = Client.prototype.startMinecraft;
Client.prototype.startMinecraft = function(launchArguments) {
    if (this._isCancelled) {
        this.emit('debug', '[MCLC]: Spuštění hry bylo zrušeno, proces nebude nastartován.');
        return null;
    }
    const proc = origStartMinecraft.call(this, launchArguments);
    if (this._isCancelled && proc) {
        try { proc.kill(); } catch (e) {}
        return null;
    }
    return proc;
};

/**
 * Intercept Handler.prototype.getJar:
 * Zkontroluje, zda herní klient (<version>.jar) již existuje na disku v .minecraft nebo jiných instalacích.
 * Pokud ano, bleskově jej zkopíruje bez stahování 30–40 MB přes internet!
 */
function getFileSha1(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        return crypto.createHash('sha1').update(buffer).digest('hex');
    } catch (e) {
        return null;
    }
}

Handler.prototype.getJar = async function() {
    if (this.client && this.client._isCancelled) {
        return Promise.reject(new Error('LAUNCH_CANCELLED'));
    }

    const versionNumber = this.options.version.custom ? this.options.version.custom : this.options.version.number;
    const jarName = `${versionNumber}.jar`;
    const targetJarPath = path.join(this.options.directory, jarName);
    const targetJsonPath = path.join(this.options.directory, `${this.options.version.number}.json`);
    const expectedSha1 = this.version && this.version.downloads && this.version.downloads.client ? this.version.downloads.client.sha1 : null;

    // 1. Zkontrolovat, zda cílový client jar již existuje a je 100% platný (ověření SHA-1 hashe a ZIP hlavičky)
    if (fs.existsSync(targetJarPath)) {
        let isUpToDate = isJarFileValid(targetJarPath);
        if (isUpToDate && expectedSha1) {
            const actualSha1 = getFileSha1(targetJarPath);
            if (actualSha1 && actualSha1 !== expectedSha1) {
                const vanillaBackup = targetJarPath.replace(/\.jar$/, '.vanilla.jar');
                const sigPath = `${targetJarPath}.skin_sig`;
                const hasValidVanillaBackup = fs.existsSync(vanillaBackup) && isJarFileValid(vanillaBackup);
                const hasSkinSig = fs.existsSync(sigPath);

                if (hasSkinSig || hasValidVanillaBackup) {
                    // Cílový JAR má aplikovaný náš RAW skin offline postavy, není poškozený
                    this.client.emit('debug', `[POSTAVA]: Herní klient ${jarName} má aplikovaný RAW offline skin postavy.`);
                } else {
                    isUpToDate = false;
                    this.client.emit('debug', `[AKTUALIZACE]: Lokální hash ${actualSha1} neodpovídá ${expectedSha1}. Stahuji aktualizovaný klient jar...`);
                }
            }
        }
        if (isUpToDate) {
            try { fs.writeFileSync(targetJsonPath, JSON.stringify(this.version, null, 4)); } catch (e) {}
            this.client.emit('debug', `[OPTIMALIZACE]: Verze ${jarName} již existuje na disku a je platná.`);
            return;
        } else {
            this.client.emit('debug', `[OPRAVA]: Soubor ${jarName} je poškozený nebo neúplný. Mažu a stahuji znovu...`);
            try { fs.unlinkSync(targetJarPath); } catch (e) {}
        }
    }

    // 2. Bleskové převzetí existujícího jaru ze systému (.minecraft, PrismLauncher, Modrinth)
    const candidates = getExistingMinecraftBaseDirs();
    let copied = false;
    for (const cand of candidates) {
        const candJars = [
            path.join(cand, 'versions', versionNumber, `${versionNumber}.jar`),
            path.join(cand, 'versions', this.options.version.number, `${this.options.version.number}.jar`)
        ];
        for (const candJar of candJars) {
            if (fs.existsSync(candJar) && isJarFileValid(candJar)) {
                if (expectedSha1) {
                    const candSha1 = getFileSha1(candJar);
                    if (candSha1 && candSha1 !== expectedSha1) continue;
                }
                try {
                    fs.mkdirSync(this.options.directory, { recursive: true });
                    fs.copyFileSync(candJar, targetJarPath);
                    if (isJarFileValid(targetJarPath)) {
                        copied = true;
                        this.client.emit('debug', `[OPTIMALIZACE]: Převzat platný herní klient ${jarName} z "${candJar}"`);
                        break;
                    } else {
                        try { fs.unlinkSync(targetJarPath); } catch (e) {}
                    }
                } catch (e) {}
            }
        }
        if (copied) break;
    }

    // 3. Pokud není na disku nebo neodpovídá novému patchi, stáhnout z oficiálního Mojang serveru
    if (!copied) {
        let clientUrl = this.version?.downloads?.client?.url;
        if (!clientUrl && this.options.version.number) {
            try {
                const vJson = await getOrFetchVanillaVersionJson(this.options.root, this.options.version.number);
                clientUrl = vJson?.downloads?.client?.url;
            } catch (e) {}
        }

        if (clientUrl) {
            await this.downloadAsync(clientUrl, this.options.directory, jarName, true, 'version-jar');
        } else {
            const baseJar = path.join(this.options.root, 'versions', this.options.version.number, `${this.options.version.number}.jar`);
            if (fs.existsSync(baseJar) && isJarFileValid(baseJar)) {
                fs.mkdirSync(this.options.directory, { recursive: true });
                try { fs.copyFileSync(baseJar, targetJarPath); } catch (e) {}
            }
        }

        // Pokud ani po stažení není platný a máme vanilla base jar
        if (!isJarFileValid(targetJarPath)) {
            const baseJar = path.join(this.options.root, 'versions', this.options.version.number, `${this.options.version.number}.jar`);
            if (fs.existsSync(baseJar) && isJarFileValid(baseJar)) {
                fs.mkdirSync(this.options.directory, { recursive: true });
                try { fs.copyFileSync(baseJar, targetJarPath); } catch (e) {}
            }
        }
    }

    try { fs.writeFileSync(targetJsonPath, JSON.stringify(this.version, null, 4)); } catch (e) {}
    this.client.emit('debug', `[MCLC]: Herní klient ${jarName} je připraven.`);

    // Pokud je aktivní offline režim, aplikujeme RAW skin ihned po přípravě JARu
    if (this.options.config && this.options.config.authType !== 'microsoft') {
        try {
            await setupOfflineCustomSkinAndCape(
                this.options.overrides?.gameDirectory || this.options.directory,
                this.options.config,
                (msg) => this.client.emit('debug', msg),
                this.options.version.number,
                this.options.version
            );
        } catch (_) {}
    }
};

/**
 * Vyhledá existující oficiální instalace Minecraftu na počítači hráče (Linux, Windows, macOS).
 */
function getExistingMinecraftBaseDirs() {
    const os = require('os');
    const home = os.homedir();
    const dirs = [];

    if (BASE_DIR) {
        dirs.push(BASE_DIR);
    }

    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        dirs.push(path.join(appData, '.minecraft'));
        dirs.push(path.join(appData, 'PrismLauncher'));
        dirs.push(path.join(localAppData, 'Packages', 'Microsoft.4297127D64C6C_8wekyb3d8bbwe', 'LocalCache', 'Roaming', '.minecraft'));
    } else if (process.platform === 'darwin') {
        dirs.push(path.join(home, 'Library', 'Application Support', 'minecraft'));
        dirs.push(path.join(home, 'Library', 'Application Support', 'PrismLauncher'));
    } else {
        dirs.push(path.join(home, '.minecraft'));
        dirs.push(path.join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft'));
        dirs.push(path.join(home, '.local', 'share', 'PrismLauncher'));
        dirs.push(path.join(home, '.local', 'share', 'ModrinthApp'));
    }

    return dirs.filter(d => fs.existsSync(d));
}

/**
 * ⚡ Bleskové převzetí: Pokud na disku existuje .minecraft, okamžitě propojí složky assets a libraries.
 */
function linkOrShareExistingMinecraftData(targetRootDir, onLog) {
    if (!targetRootDir) return;
    const candidates = getExistingMinecraftBaseDirs();
    if (!candidates.length) return;

    const log = (msg) => { if (typeof onLog === 'function') onLog(msg); };

    // 1. Propojení / sdílení složky assets
    const targetAssets = path.join(targetRootDir, 'assets');
    if (!fs.existsSync(targetAssets)) {
        for (const cand of candidates) {
            const candAssets = path.join(cand, 'assets');
            const candObjects = path.join(candAssets, 'objects');
            if (fs.existsSync(candObjects)) {
                try {
                    fs.mkdirSync(path.dirname(targetAssets), { recursive: true });
                    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
                    fs.symlinkSync(candAssets, targetAssets, symlinkType);
                    log(`[OPTIMALIZACE] Propojeny existující Minecraft assety z "${candAssets}"`);
                    break;
                } catch (e) {
                    log(`[OPTIMALIZACE] Nelze vytvořit symlink na assety (${e.message}), použijeme přímé čtení z disku.`);
                }
            }
        }
    }

    // 2. Složka libraries MUSÍ být reálná složka, nikdy ne symlink na cizí launcher!
    const targetLibs = path.join(targetRootDir, 'libraries');
    try {
        const lstat = fs.lstatSync(targetLibs);
        if (lstat.isSymbolicLink()) {
            fs.unlinkSync(targetLibs);
        }
    } catch (e) {}
    try {
        fs.mkdirSync(targetLibs, { recursive: true });
    } catch (e) {}
}

/**
 * Intercept Handler.prototype.downloadToDirectory:
 * Bleskové převzetí knihoven z existujících instalací na disku a garantované stažení
 * chybějících knihoven z Mojang Maven (včetně lwjgl-vulkan a novějších LWJGL 3.4.x).
 * Zabraňuje NoClassDefFoundError / ClassNotFoundException.
 */
Handler.prototype.downloadToDirectory = async function(directory, libraries, eventName) {
    const libs = [];
    if (!Array.isArray(libraries)) return libs;

    const candidates = getExistingMinecraftBaseDirs();
    let counter = 0;

    await Promise.all(libraries.map(async (library) => {
        if (!library) return;
        if (this.parseRule(library)) return;
        const lib = library.name.split(':');

        let jarPath;
        let name;
        let relPath;
        if (library.downloads && library.downloads.artifact && library.downloads.artifact.path) {
            relPath = library.downloads.artifact.path;
            name = path.basename(relPath);
            jarPath = path.join(directory, path.dirname(relPath));
        } else {
            relPath = `${lib[0].replace(/\./g, '/')}/${lib[1]}/${lib[2]}/${lib[1]}-${lib[2]}${lib[3] ? '-' + lib[3] : ''}.jar`;
            name = path.basename(relPath);
            jarPath = path.join(directory, path.dirname(relPath));
        }

        const destFile = path.join(jarPath, name);

        // 1. Zkontrolovat, zda soubor existuje a má platnou velikost i platný obsah
        let exists = false;
        try {
            if (fs.existsSync(destFile)) {
                const stat = fs.statSync(destFile);
                if (stat.size > 0) {
                    // ⚡ Blesková kontrola velikosti: namísto drahého čtení a SHA1 hešování desítek JARů při každém spuštění
                    if (library.downloads?.artifact?.size && stat.size === library.downloads.artifact.size) {
                        exists = true;
                    } else if (library.downloads?.artifact?.sha1) {
                        exists = verifyFileSha1(destFile, library.downloads.artifact.sha1);
                    } else if (name.endsWith('.jar')) {
                        exists = isJarFileValid(destFile);
                    } else {
                        exists = true;
                    }
                    if (!exists) {
                        try { fs.unlinkSync(destFile); } catch (e) {}
                    }
                }
            }
        } catch (e) {
            exists = false;
        }

        // 2. Pokud neexistuje, zkusit bleskově převzít z existujících launcherů na disku
        if (!exists) {
            for (const cand of candidates) {
                const candLib = path.join(cand, 'libraries', relPath);
                if (fs.existsSync(candLib)) {
                    try {
                        const candValid = library.downloads?.artifact?.sha1
                            ? verifyFileSha1(candLib, library.downloads.artifact.sha1)
                            : (name.endsWith('.jar') ? isJarFileValid(candLib) : fs.statSync(candLib).size > 0);
                        if (candValid) {
                            fs.mkdirSync(jarPath, { recursive: true });
                            fs.copyFileSync(candLib, destFile);
                            exists = true;
                            break;
                        }
                    } catch (e) {}
                }
            }
        }

        // 3. Pokud stále neexistuje, stáhnout přes náš downloadAsync
        if (!exists) {
            let downloadUrl = null;
            if (library.downloads && library.downloads.artifact && library.downloads.artifact.url) {
                downloadUrl = library.downloads.artifact.url;
            } else if (library.url) {
                downloadUrl = `${library.url}${relPath}`;
            } else {
                downloadUrl = `https://libraries.minecraft.net/${relPath}`;
            }

            try {
                fs.mkdirSync(jarPath, { recursive: true });
                await this.downloadAsync(downloadUrl, jarPath, name, true, eventName);
                if (fs.existsSync(destFile)) {
                    if (library.downloads?.artifact?.sha1) {
                        exists = verifyFileSha1(destFile, library.downloads.artifact.sha1);
                    } else if (name.endsWith('.jar')) {
                        exists = isJarFileValid(destFile);
                    } else {
                        exists = fs.statSync(destFile).size > 0;
                    }
                    if (!exists) {
                        try { fs.unlinkSync(destFile); } catch (e) {}
                    }
                }
            } catch (err) {
                this.client.emit('debug', `[MCLC]: Knihovnu ${name} nelze stáhnout z ${downloadUrl}, zkouším Mojang Maven...`);
            }

            // Fallback na Mojang Maven pokud původní selhalo
            if (!exists && !downloadUrl.includes('libraries.minecraft.net')) {
                try {
                    await this.downloadAsync(`https://libraries.minecraft.net/${relPath}`, jarPath, name, true, eventName);
                    if (fs.existsSync(destFile)) {
                        if (library.downloads?.artifact?.sha1) {
                            exists = verifyFileSha1(destFile, library.downloads.artifact.sha1);
                        } else if (name.endsWith('.jar')) {
                            exists = isJarFileValid(destFile);
                        } else {
                            exists = fs.statSync(destFile).size > 0;
                        }
                        if (!exists) {
                            try { fs.unlinkSync(destFile); } catch (e) {}
                        }
                    }
                } catch (e) {}
            }
        }

        counter++;
        this.client.emit('progress', {
            type: eventName,
            task: counter,
            total: libraries.length
        });

        if (exists) {
            libs.push(destFile);
        } else {
            this.client.emit('debug', `[MCLC]: ⚠ Knihovna ${library.name} nebyla nalezena (${destFile})`);
        }
    }));

    return libs;
};

/**
 * Intercept Handler.prototype.getAssets:
 * 1. Oseká 120+ nepotřebných cizích jazyků a stáhne z Mojangu POUZE CS, SK, EN_US a EN_GB (~50 MB úspora).
 * 2. Zkontroluje existující .minecraft na disku a chybějící soubory zkopíruje bleskově z disku namísto stahování.
 */
Handler.prototype.getAssets = async function() {
    if (this.client && this.client._isCancelled) {
        return Promise.reject(new Error('LAUNCH_CANCELLED'));
    }

    const assetDirectory = path.resolve(this.options.overrides.assetRoot || path.join(this.options.root, 'assets'));
    const indexName = (this.version && this.version.assetIndex && this.version.assetIndex.id)
        ? this.version.assetIndex.id
        : (this.options.version.number || '26.2');
    const assetId = this.options.version.custom || this.options.version.number;
    const indexFilePath = path.join(assetDirectory, 'indexes', `${indexName}.json`);
    const customIndexFilePath = path.join(assetDirectory, 'indexes', `${assetId}.json`);

    const targetUrl = (this.version && this.version.assetIndex && this.version.assetIndex.url)
        ? this.version.assetIndex.url
        : null;

    if (!fs.existsSync(indexFilePath) && targetUrl) {
        await this.downloadAsync(targetUrl, path.join(assetDirectory, 'indexes'), `${indexName}.json`, true, 'asset-json');
    }

    if (fs.existsSync(indexFilePath) && !fs.existsSync(customIndexFilePath)) {
        try { fs.copyFileSync(indexFilePath, customIndexFilePath); } catch (e) {}
    } else if (fs.existsSync(customIndexFilePath) && !fs.existsSync(indexFilePath)) {
        try { fs.copyFileSync(customIndexFilePath, indexFilePath); } catch (e) {}
    }

    const finalPath = fs.existsSync(indexFilePath) ? indexFilePath : customIndexFilePath;
    if (!fs.existsSync(finalPath)) {
        throw new Error(`Nepodařilo se stáhnout index assetů: ${indexName}.json`);
    }

    const index = JSON.parse(fs.readFileSync(finalPath, { encoding: 'utf8' }));

    // Povolené jazyky: čeština, slovenština, americká angličtina, britská angličtina
    const ALLOWED_LANGUAGES = new Set(['cs_cz', 'sk_sk', 'en_us', 'en_gb']);

    // Volitelné Audio & Hudba DLC: defaultně zapnuto (true)
    const downloadAudioDlc = this.options.downloadAudioDlc !== false;

    // Osekáme nepotřebné jazyky (~84 MB).
    // Pokud je DLC vypnuté (např. na pomalé školní síti), přeskočíme zvuky a hudbu pro okamžité spuštění.
    // Pokud je DLC zapnuté (výchozí stav), stáhnou se VŠECHNY zvuky, hudba i desky.
    const filteredAssetKeys = Object.keys(index.objects || {}).filter(assetKey => {
        if (assetKey.startsWith('minecraft/lang/') || assetKey.includes('/lang/')) {
            const langName = path.basename(assetKey, '.json').toLowerCase();
            return ALLOWED_LANGUAGES.has(langName);
        }
        if (!downloadAudioDlc && assetKey.startsWith('minecraft/sounds/')) {
            return false;
        }
        return true;
    });

    const existingCandidates = getExistingMinecraftBaseDirs()
        .map(d => path.join(d, 'assets', 'objects'))
        .filter(d => fs.existsSync(d));

    // ── Inteligentní Delta Analýza Textur & Assetů ───────────────────────────
    // Zjistíme, které textury a assety už existují (z předchozích verzí 26.1/26.2 nebo .minecraft).
    // Pokud Mojang textury nezměnil, mají totožný SHA-1 hash a znovupoužijí se bez stahování!
    const missingAssetKeys = [];
    let reusedCount = 0;

    for (const assetKey of filteredAssetKeys) {
        const hash = index.objects[assetKey].hash;
        const subhash = hash.substring(0, 2);
        const subAssetDir = path.join(assetDirectory, 'objects', subhash);
        const targetFilePath = path.join(subAssetDir, hash);

        if (fs.existsSync(targetFilePath)) {
            reusedCount++;
        } else {
            // Zkusit okamžitě převzít z .minecraft nebo jiných launcherů na disku
            let copiedFromDisk = false;
            for (const candDir of existingCandidates) {
                const srcPath = path.join(candDir, subhash, hash);
                if (fs.existsSync(srcPath)) {
                    try {
                        fs.mkdirSync(subAssetDir, { recursive: true });
                        fs.copyFileSync(srcPath, targetFilePath);
                        copiedFromDisk = true;
                        reusedCount++;
                        break;
                    } catch (e) {}
                }
            }
            if (!copiedFromDisk) {
                missingAssetKeys.push(assetKey);
            }
        }
    }

    if (missingAssetKeys.length === 0) {
        this.client.emit('debug', `[DELTA ASSETY]: Všech ${filteredAssetKeys.length} textur a zvuků existuje na disku a je aktuální.`);
        this.client.emit('progress', {
            type: 'assets',
            task: filteredAssetKeys.length,
            total: filteredAssetKeys.length
        });
        return;
    }

    this.client.emit('debug', `[DELTA ASSETY]: ⚡ Znovupoužito ${reusedCount} již existujících textur a zvuků z předchozích verzí. Stahuje se pouze ${missingAssetKeys.length} nových změn.`);

    let counter = 0;
    this.client.emit('progress', {
        type: 'assets',
        task: 0,
        total: missingAssetKeys.length
    });

    // Paralelní zpracování po dávkách pro maximální rychlost přes HTTP/2 multiplexing
    const concurrency = 35;
    let idx = 0;

    const downloadMissingAsset = async (assetKey) => {
        if (this.client && this.client._isCancelled) return;

        const hash = index.objects[assetKey].hash;
        const subhash = hash.substring(0, 2);
        const subAssetDir = path.join(assetDirectory, 'objects', subhash);

        await this.downloadAsync(`${this.options.overrides.url.resource}/${subhash}/${hash}`, subAssetDir, hash, true, 'assets');

        counter++;
        this.client.emit('progress', {
            type: 'assets',
            task: counter,
            total: missingAssetKeys.length
        });
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (idx < missingAssetKeys.length) {
            if (this.client && this.client._isCancelled) break;
            const currentAsset = missingAssetKeys[idx++];
            await downloadMissingAsset(currentAsset);
        }
    });

    await Promise.all(workers);
    this.client.emit('debug', `[OPTIMALIZACE]: Staženo ${counter} nových/změněných assetů, ${reusedCount} převzato z disku.`);
};


/**
 * Extracts the major version of a Java runtime executable (e.g. 25, 21, 17, 8).
 */
function getJavaMajorVersion(binPath) {
    if (!binPath) return 0;
    try {
        const out = execSync(`"${binPath}" -version 2>&1`, { timeout: 3500, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
        const match = out.match(/(?:version|Runtime Environment)\s+"?(\d+)(?:\.(\d+))?/i);
        if (match) {
            const v1 = parseInt(match[1], 10);
            if (v1 === 1 && match[2]) {
                return parseInt(match[2], 10);
            }
            return v1;
        }
    } catch (e) {}
    return 0;
}

/**
 * Determines the minimum required Java major version for a given Minecraft version.
 * Modern 26.x requires Java 25 (class file version 69.0).
 */
function getRequiredJavaVersion(gameVersion) {
    if (!gameVersion) return 25;
    const str = String(gameVersion).trim();
    if (/^1\.(1[67])/.test(str)) return 16;
    if (/^1\.(1[89]|20\.[0-4])/.test(str)) return 17;
    if (/^1\./.test(str) && !/^1\.(2[1-9])/.test(str)) return 8;
    // Výchozí standard pro celou síť MYCHAL SMP je moderní Java 25
    return 25;
}

/**
 * Tests if a java binary executable runs properly and meets an optional minimum major version.
 */
function testJavaExecutable(binPath, minMajor = 0) {
    if (!binPath) return false;
    try {
        execSync(`"${binPath}" -version`, { timeout: 3500, stdio: ['ignore', 'pipe', 'pipe'] });
        if (minMajor > 0) {
            const major = getJavaMajorVersion(binPath);
            return major >= minMajor;
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Downloads and installs OpenJDK Temurin JRE of specified major version (default: 25) from Adoptium API.
 * Solves class version mismatch errors (e.g. UnsupportedClassVersionError 69.0) completely automatically.
 */
async function downloadAndInstallJava(targetVersion = 25, onLog = console.log, onProgress = null) {
    const runtimeBase = path.join(BASE_DIR, 'runtime');
    const javaDir = path.join(runtimeBase, `java-${targetVersion}`);
    const isWin = process.platform === 'win32';
    const osType = isWin ? 'windows' : (process.platform === 'darwin' ? 'mac' : 'linux');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';

    fs.mkdirSync(runtimeBase, { recursive: true });

    onLog(`[JAVA] Automaticky stahuji oficiální OpenJDK ${targetVersion} Runtime (${osType}-${arch})...`);
    if (onProgress) {
        onProgress({ percent: 5, text: `Stahování běhového prostředí Java ${targetVersion} z Adoptium...`, status: `Stahování Java ${targetVersion}...` });
    }

    const apiUrl = `https://api.adoptium.net/v3/binary/latest/${targetVersion}/ga/${osType}/${arch}/jre/hotspot/normal/eclipse`;

    const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' },
        redirect: 'follow'
    });

    if (!resp.ok) {
        throw new Error(`Nepodařilo se stáhnout Javu ${targetVersion} z Adoptium API: HTTP ${resp.status}`);
    }

    const totalBytes = parseInt(resp.headers.get('content-length') || '0', 10);
    const archivePath = path.join(runtimeBase, isWin ? `java${targetVersion}.zip` : `java${targetVersion}.tar.gz`);
    const fileStream = fs.createWriteStream(archivePath);

    let downloadedBytes = 0;
    const reader = resp.body.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        downloadedBytes += value.length;
        fileStream.write(Buffer.from(value));
        if (totalBytes > 0 && onProgress) {
            const percent = Math.min(90, Math.round((downloadedBytes / totalBytes) * 85) + 5);
            onProgress({
                percent,
                text: `Stahování Java ${targetVersion} (${Math.round(downloadedBytes / 1024 / 1024)} MB / ${Math.round(totalBytes / 1024 / 1024)} MB)...`,
                status: `Stahování Java ${targetVersion} (${percent}%)...`
            });
        }
    }
    fileStream.end();
    await new Promise((resolve) => fileStream.on('finish', resolve));

    if (onProgress) {
        onProgress({ percent: 92, text: `Instalace a rozbalování Java ${targetVersion}...`, status: `Rozbalování Java ${targetVersion}...` });
    }
    onLog(`[JAVA] Archiv stažen (${Math.round(downloadedBytes / 1024 / 1024)} MB). Rozbaluji do ${javaDir}...`);

    if (fs.existsSync(javaDir)) {
        try { fs.rmSync(javaDir, { recursive: true, force: true }); } catch (e) {}
    }
    fs.mkdirSync(javaDir, { recursive: true });

    const tempExtract = path.join(runtimeBase, `extract_tmp_${targetVersion}`);
    if (fs.existsSync(tempExtract)) {
        try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch (e) {}
    }

    if (isWin) {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(tempExtract, true);

        const entries = fs.readdirSync(tempExtract);
        let sourceFolder = tempExtract;
        for (const e of entries) {
            const p = path.join(tempExtract, e);
            if (fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, 'bin', 'javaw.exe')) || fs.existsSync(path.join(p, 'bin', 'java.exe')))) {
                sourceFolder = p;
                break;
            }
        }
        for (const item of fs.readdirSync(sourceFolder)) {
            fs.renameSync(path.join(sourceFolder, item), path.join(javaDir, item));
        }
    } else {
        fs.mkdirSync(tempExtract, { recursive: true });
        execSync(`tar -xzf "${archivePath}" -C "${tempExtract}"`);

        const entries = fs.readdirSync(tempExtract);
        let sourceFolder = tempExtract;
        for (const e of entries) {
            const p = path.join(tempExtract, e);
            if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'bin', 'java'))) {
                sourceFolder = p;
                break;
            }
        }
        for (const item of fs.readdirSync(sourceFolder)) {
            fs.renameSync(path.join(sourceFolder, item), path.join(javaDir, item));
        }
    }

    try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch (e) {}
    try { fs.unlinkSync(archivePath); } catch (e) {}

    const binName = isWin ? 'javaw.exe' : 'java';
    let finalJavaPath = path.join(javaDir, 'bin', binName);
    if (isWin && !fs.existsSync(finalJavaPath)) {
        finalJavaPath = path.join(javaDir, 'bin', 'java.exe');
    }

    if (!fs.existsSync(finalJavaPath)) {
        throw new Error(`Běhový soubor Java nebyl nalezen po rozbalení: ${finalJavaPath}`);
    }

    if (!isWin) {
        try { fs.chmodSync(finalJavaPath, 0o755); } catch (e) {}
    }

    onLog(`[JAVA] ✓ Java ${targetVersion} úspěšně připravena: ${finalJavaPath}`);
    if (onProgress) {
        onProgress({ percent: 100, text: `Java ${targetVersion} připravena!`, status: 'Hotovo' });
    }
    return finalJavaPath;
}

/**
 * Backwards compatibility alias for Java installer (default: Java 25).
 */
async function downloadAndInstallJava25(onLog = console.log, onProgress = null) {
    return downloadAndInstallJava(25, onLog, onProgress);
}
async function downloadAndInstallJava21(onLog = console.log, onProgress = null) {
    return downloadAndInstallJava(25, onLog, onProgress);
}

/**
 * Ensures that a working Java executable matching the required major version is available.
 * If neither system nor configured Java is functional/compatible, automatically downloads it.
 */
async function ensureJavaExecutable(config, onLog = console.log, onProgress = null) {
    const targetVersion = config.version || '26.2';
    const requiredMajor = getRequiredJavaVersion(targetVersion);

    // 1. Configured custom path
    if (config.javaPath) {
        const customMajor = getJavaMajorVersion(config.javaPath);
        if (customMajor >= requiredMajor && testJavaExecutable(config.javaPath, requiredMajor)) {
            return config.javaPath;
        }
        if (customMajor > 0 && customMajor < requiredMajor) {
            onLog(`[JAVA] Nastavená Java (${config.javaPath}) má verzi Java ${customMajor}, ale verze ${targetVersion} vyžaduje Java ${requiredMajor}+. Hledám kompatibilní runtime...`);
        }
    }

    // 2. Launcher local runtime for required version
    const isWin = process.platform === 'win32';
    const localBin = path.join(BASE_DIR, 'runtime', `java-${requiredMajor}`, 'bin', isWin ? 'javaw.exe' : 'java');
    const localBinAlt = isWin ? path.join(BASE_DIR, 'runtime', `java-${requiredMajor}`, 'bin', 'java.exe') : null;
    if (fs.existsSync(localBin) && testJavaExecutable(localBin, requiredMajor)) {
        return localBin;
    }
    if (localBinAlt && fs.existsSync(localBinAlt) && testJavaExecutable(localBinAlt, requiredMajor)) {
        return localBinAlt;
    }

    // 3. System detected paths meeting required major version
    const detected = detectJavaPath(requiredMajor);
    if (detected && testJavaExecutable(detected, requiredMajor)) {
        return detected;
    }

    // 4. Fallback: Automatically download OpenJDK of required version (e.g. 25)
    onLog(`[JAVA] V systému nebyla nalezena kompatibilní Java ${requiredMajor}+ pro verzi ${targetVersion}. Stahuji vestavěný OpenJDK ${requiredMajor}...`);
    const installed = await downloadAndInstallJava(requiredMajor, onLog, onProgress);
    try {
        saveConfig({ javaPath: installed });
    } catch (e) {}
    return installed;
}

/**
 * Scans installed Java environments prioritizing Java 25.
 */
function detectJavaPath(minMajor = 25) {
    const isWin = process.platform === 'win32';
    const candidates = [];

    // Check launcher local runtimes (java-25)
    const local25 = path.join(BASE_DIR, 'runtime', 'java-25', 'bin', isWin ? 'javaw.exe' : 'java');
    if (fs.existsSync(local25)) candidates.push(local25);
    if (isWin && fs.existsSync(path.join(BASE_DIR, 'runtime', 'java-25', 'bin', 'java.exe'))) {
        candidates.push(path.join(BASE_DIR, 'runtime', 'java-25', 'bin', 'java.exe'));
    }

    // 1. Linux candidates
    if (!isWin) {
        const linuxCandidates = [
            '/usr/lib/jvm/java-25-openjdk-amd64/bin/java',
            '/usr/lib/jvm/java-25-openjdk/bin/java',
            '/usr/lib/jvm/openjdk-25/bin/java',
            '/usr/lib/jvm/default-runtime/bin/java'
        ];
        candidates.push(...linuxCandidates);

        try {
            const out = execSync('which java', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) candidates.push(out);
        } catch (e) {}

        candidates.push('/usr/bin/java');
    } else {
        // 2. Windows candidates
        const winBaseDirs = [
            'C:\\Program Files\\Eclipse Adoptium',
            'C:\\Program Files\\Microsoft',
            'C:\\Program Files\\Java',
            'C:\\Program Files (x86)\\Java',
            'C:\\Program Files\\BellSoft',
            'C:\\Program Files\\Amazon Corretto',
            'C:\\Program Files\\Zulu'
        ];

        for (const base of winBaseDirs) {
            if (fs.existsSync(base)) {
                try {
                    const subdirs = fs.readdirSync(base);
                    for (const sub of subdirs) {
                        const javaw = path.join(base, sub, 'bin', 'javaw.exe');
                        if (fs.existsSync(javaw)) candidates.push(javaw);
                        const javaExe = path.join(base, sub, 'bin', 'java.exe');
                        if (fs.existsSync(javaExe)) candidates.push(javaExe);
                    }
                } catch (e) {}
            }
        }

        try {
            const out = execSync('where javaw', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) candidates.push(out);
        } catch (e) {}

        try {
            const out = execSync('where java', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) candidates.push(out);
        } catch (e) {}
    }

    // Evaluate candidate versions
    const evaluated = [];
    const seen = new Set();
    for (const cand of candidates) {
        if (!cand || seen.has(cand)) continue;
        seen.add(cand);
        if (fs.existsSync(cand)) {
            const major = getJavaMajorVersion(cand);
            if (major > 0) {
                evaluated.push({ path: cand, major });
            }
        }
    }

    // Sort by major version descending
    evaluated.sort((a, b) => b.major - a.major);

    const match = evaluated.find(e => e.major >= minMajor);
    if (match) return match.path;

    if (minMajor === 0 && evaluated.length > 0) return evaluated[0].path;

    return null;
}

/**
 * Returns all detected Java installations with version info across Linux and Windows.
 */
function getAvailableJavas() {
    const list = [];
    const seen = new Set();
    const isWin = process.platform === 'win32';

    const checkPath = (binPath, label) => {
        if (!binPath || seen.has(binPath)) return;
        seen.add(binPath);
        if (fs.existsSync(binPath)) {
            const major = getJavaMajorVersion(binPath);
            try {
                const verOut = execSync(`"${binPath}" -version 2>&1`, { encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] });
                const firstLine = (verOut.split(/\r?\n/)[0] || '').replace(/"/g, '').trim();
                list.push({ path: binPath, major, label: `${label} (${firstLine || `Java ${major}`})` });
            } catch (e) {
                list.push({ path: binPath, major, label });
            }
        }
    };

    // Check launcher local runtimes
    const local25 = path.join(BASE_DIR, 'runtime', 'java-25', 'bin', isWin ? 'javaw.exe' : 'java');
    checkPath(local25, 'Vestavěná Java 25 (Adoptium)');

    if (!isWin) {
        const candidates = [
            ['/usr/lib/jvm/java-25-openjdk-amd64/bin/java', 'Java 25 (LTS)'],
            ['/usr/lib/jvm/java-25-openjdk/bin/java', 'Java 25 (LTS)'],
            ['/usr/bin/java', 'Systémová Java']
        ];
        candidates.forEach(([p, l]) => checkPath(p, l));
    } else {
        const winBaseDirs = [
            'C:\\Program Files\\Eclipse Adoptium',
            'C:\\Program Files\\Microsoft',
            'C:\\Program Files\\Java',
            'C:\\Program Files (x86)\\Java'
        ];
        for (const base of winBaseDirs) {
            if (fs.existsSync(base)) {
                try {
                    const subdirs = fs.readdirSync(base);
                    for (const sub of subdirs) {
                        const javaw = path.join(base, sub, 'bin', 'javaw.exe');
                        checkPath(javaw, `Instalovaná ${sub}`);
                    }
                } catch (e) {}
            }
        }
        try {
            const out = execSync('where javaw', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) checkPath(out, 'Systémová Java (PATH)');
        } catch (e) {}
    }

    list.sort((a, b) => (b.major || 0) - (a.major || 0));
    return list;
}

/**
 * Scans the local versions folder to see which versions are downloaded.
 */
function getInstalledVersions(baseDir) {
    const versionsDir = path.join(baseDir, 'versions');
    if (!fs.existsSync(versionsDir)) return [];

    try {
        const dirs = fs.readdirSync(versionsDir, { withFileTypes: true });
        const installed = [];
        for (const dirent of dirs) {
            if (dirent.isDirectory()) {
                const v = dirent.name;
                const jsonPath = path.join(versionsDir, v, `${v}.json`);
                const jarPath = path.join(versionsDir, v, `${v}.jar`);
                // Verze je nainstalovaná pouze tehdy, pokud má json i platný client jar (> 100 KB)
                if (fs.existsSync(jarPath) && fs.existsSync(jsonPath)) {
                    try {
                        const st = fs.statSync(jarPath);
                        if (st.size > 100000) {
                            installed.push(v);
                        }
                    } catch (e) {}
                }
            }
        }
        return installed;
    } catch (e) {
        return [];
    }
}

/**
 * Vyčistí staré resource packy postav z předchozích verzí a odstraní je z options.txt,
 * aby hráč neměl žádný nechtěný texture pack.
 */
function cleanupLegacyCharacterPacks(gameDir, baseDir) {
    const dirs = [gameDir, baseDir].filter(Boolean);
    for (const d of new Set(dirs)) {
        try {
            const rpDir = path.join(d, 'resourcepacks');
            const legacyZip = path.join(rpDir, 'mychalsmp-character.zip');
            const legacyDir = path.join(rpDir, 'mychalsmp-character');
            if (fs.existsSync(legacyZip)) { try { fs.unlinkSync(legacyZip); } catch (_) {} }
            if (fs.existsSync(legacyDir)) { try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch (_) {} }

            const optFile = path.join(d, 'options.txt');
            if (fs.existsSync(optFile)) {
                let content = fs.readFileSync(optFile, 'utf8');
                if (content.includes('mychalsmp-character')) {
                    content = content.replace(/resourcePacks:\[(.*?)\]/, (match, inner) => {
                        let packs = [];
                        try { packs = JSON.parse(`[${inner}]`); } catch (_) { packs = inner.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean); }
                        packs = packs.filter(p => !p.includes('mychalsmp-character'));
                        return `resourcePacks:[${packs.map(p => JSON.stringify(p)).join(',')}]`;
                    });
                    content = content.replace(/incompatibleResourcePacks:\[(.*?)\]/, (match, inner) => {
                        let packs = [];
                        try { packs = JSON.parse(`[${inner}]`); } catch (_) { packs = inner.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean); }
                        packs = packs.filter(p => !p.includes('mychalsmp-character'));
                        return `incompatibleResourcePacks:[${packs.map(p => JSON.stringify(p)).join(',')}]`;
                    });
                    fs.writeFileSync(optFile, content, 'utf8');
                }
            }
        } catch (_) {}
    }
}

/**
 * RAW injekce offline skinu a pláště přímo do JAR souboru herního jádra.
 * Přepíše výchozí textury Steva, Alex a 7 dalších defaultních postav v wide i slim modelech.
 */
function injectRawSkinIntoJar(jarPath, activeSkinPath, activeCapePath, onLog = console.log) {
    if (!fs.existsSync(jarPath) || !isJarFileValid(jarPath)) return false;

    const backupPath = jarPath.replace(/\.jar$/, '.vanilla.jar');
    const sigPath = `${jarPath}.skin_sig`;

    // 1. Zajištění čisté vanilla zálohy JARu před jakoukoliv úpravou
    if (!fs.existsSync(backupPath)) {
        try {
            fs.copyFileSync(jarPath, backupPath);
            onLog(`[POSTAVA] 📦 Vytvořena vanilla záloha jádra: ${path.basename(backupPath)}`);
        } catch (e) {
            onLog(`[POSTAVA] ⚠ Nelze vytvořit zálohu jádra: ${e.message}`);
        }
    }

    if (!activeSkinPath || !fs.existsSync(activeSkinPath)) {
        return false;
    }

    // 2. Kontrola cache podpisu (0ms start pokud se skin nezměnil)
    const crypto = require('crypto');
    let skinHash = '';
    try {
        skinHash = crypto.createHash('sha1').update(fs.readFileSync(activeSkinPath)).digest('hex');
    } catch (_) { return false; }

    let capeHash = 'nocape';
    if (activeCapePath && fs.existsSync(activeCapePath)) {
        try {
            capeHash = crypto.createHash('sha1').update(fs.readFileSync(activeCapePath)).digest('hex');
        } catch (_) {}
    }
    const targetSig = `${skinHash}:${capeHash}`;

    if (fs.existsSync(sigPath)) {
        try {
            const currentSig = fs.readFileSync(sigPath, 'utf8').trim();
            if (currentSig === targetSig) {
                // Skin v tomto JARu je již identický - bleskový 0ms start
                return true;
            }
        } catch (_) {}
    }

    // 3. Přímé RAW přepsání textur v herním JAR souboru
    onLog(`[POSTAVA] ⚡ RAW aplikace skinu do ${path.basename(jarPath)} (Steve, Alex a modely postav)...`);
    const skinBuf = fs.readFileSync(activeSkinPath);
    const capeBuf = (activeCapePath && fs.existsSync(activeCapePath)) ? fs.readFileSync(activeCapePath) : null;

    const playerModels = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
    const entriesToUpdate = [];

    for (const model of playerModels) {
        entriesToUpdate.push({ path: `assets/minecraft/textures/entity/player/wide/${model}.png`, buf: skinBuf });
        entriesToUpdate.push({ path: `assets/minecraft/textures/entity/player/slim/${model}.png`, buf: skinBuf });
    }
    entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/player/steve.png', buf: skinBuf });
    entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/player/alex.png', buf: skinBuf });
    entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/steve.png', buf: skinBuf });
    entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/alex.png', buf: skinBuf });

    if (capeBuf) {
        entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/equipment/wings/elytra.png', buf: capeBuf });
        entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/elytra.png', buf: capeBuf });
        entriesToUpdate.push({ path: 'assets/minecraft/textures/entity/cape/cape.png', buf: capeBuf });
    }

    let success = false;

    // A) Nativní 'zip' CLI (bleskurychlé in-place zpracování v Linuxu/macOS)
    try {
        const { execFileSync } = require('child_process');
        const os = require('os');
        const tmpDir = path.join(os.tmpdir(), `mychalsmp_skin_${Date.now()}`);
        fs.mkdirSync(path.join(tmpDir, 'assets/minecraft/textures/entity/player/wide'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'assets/minecraft/textures/entity/player/slim'), { recursive: true });
        if (capeBuf) {
            fs.mkdirSync(path.join(tmpDir, 'assets/minecraft/textures/entity/equipment/wings'), { recursive: true });
        }

        for (const entry of entriesToUpdate) {
            const destFile = path.join(tmpDir, entry.path);
            fs.mkdirSync(path.dirname(destFile), { recursive: true });
            fs.writeFileSync(destFile, entry.buf);
        }

        const relativePaths = entriesToUpdate.map(e => e.path);
        execFileSync('zip', ['-u', jarPath, ...relativePaths], { cwd: tmpDir, stdio: 'ignore' });

        try {
            execFileSync('zip', ['-d', jarPath, 'META-INF/MOJANGCS.SF', 'META-INF/MOJANGCS.RSA', 'META-INF/MOJANG_C.SF', 'META-INF/MOJANG_C.RSA'], { stdio: 'ignore' });
        } catch (_) {}

        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        success = true;
    } catch (cliErr) {
        // B) Multiplatformní fallback (AdmZip)
        try {
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(jarPath);
            try { zip.deleteFile('META-INF/MOJANGCS.SF'); } catch (_) {}
            try { zip.deleteFile('META-INF/MOJANGCS.RSA'); } catch (_) {}
            try { zip.deleteFile('META-INF/MOJANG_C.SF'); } catch (_) {}
            try { zip.deleteFile('META-INF/MOJANG_C.RSA'); } catch (_) {}

            for (const entry of entriesToUpdate) {
                zip.addFile(entry.path, entry.buf);
            }
            zip.writeZip(jarPath);
            success = true;
        } catch (admErr) {
            onLog(`[POSTAVA] ⚠ RAW injekce do ${path.basename(jarPath)} selhala: ${admErr.message}`);
        }
    }

    if (success && isJarFileValid(jarPath)) {
        try { fs.writeFileSync(sigPath, targetSig, 'utf8'); } catch (_) {}
        onLog(`[POSTAVA] ✓ Textury skinu hráče RAW přepsány přímo v jádru hry (${path.basename(jarPath)}). Žádný texture pack ani mód není potřeba!`);
        return true;
    }
    return false;
}

/**
 * Obnoví výchozí nemodifikované vanilla JARy ze zálohy .vanilla.jar.
 */
function restoreVanillaJars(baseDir, targetVer, onLog = console.log) {
    const versionsDir = path.join(baseDir, 'versions');
    if (!fs.existsSync(versionsDir)) return;
    try {
        const dirs = fs.readdirSync(versionsDir);
        for (const d of dirs) {
            if (!targetVer || d.includes(targetVer)) {
                const jarPath = path.join(versionsDir, d, `${d}.jar`);
                const backupPath = path.join(versionsDir, d, `${d}.vanilla.jar`);
                const sigPath = `${jarPath}.skin_sig`;
                if (fs.existsSync(backupPath) && fs.existsSync(sigPath) && isJarFileValid(backupPath)) {
                    try {
                        fs.copyFileSync(backupPath, jarPath);
                        fs.unlinkSync(sigPath);
                        onLog(`[POSTAVA] 🔄 Obnoveno výchozí vanilla jádro bez úprav: ${d}.jar`);
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}
}

/**
 * 🎭 Nastavení vlastního offline skinu a pláště pro warez / offline hráče.
 * RAW přepisuje textury Steva, Alex a dalších postav přímo v jádru hry (JAR).
 * Nevytváří ŽÁDNÝ resource pack, neupravuje options.txt a nevyžaduje žádné mody!
 */
async function setupOfflineCustomSkinAndCape(gameDir, config, onLog = console.log, targetVersion = null, versionOpts = null) {
    const baseDir = BASE_DIR;
    const targetGameDir = gameDir || baseDir;
    const targetVer = targetVersion || config?.version || '26.2';

    // Vždy vyčistíme staré resource packy postav z předchozích verzí launcheru
    cleanupLegacyCharacterPacks(targetGameDir, baseDir);

    if (config?.authType === 'microsoft') {
        restoreVanillaJars(baseDir, targetVer, onLog);
        return; // Pro oficiální účty se skin spravuje přes Mojang servery
    }

    const username = config?.offlineUsername || config?.username || 'Hrac';
    const skinCandidates = [
        config?.customSkinPath,
        path.join(targetGameDir, 'custom_skin.png'),
        path.join(targetGameDir, 'skins', 'skin.png'),
        path.join(baseDir, 'custom_skin.png'),
        path.join(baseDir, 'offline_skin.png')
    ].filter(Boolean);

    let activeSkin = skinCandidates.find(p => fs.existsSync(p));

    // Pokud skin na disku neexistuje, automaticky stáhneme oficiální skin odpovídající zvolenému nicku
    if (!activeSkin) {
        const skinUrls = [
            `https://minotar.net/skin/${encodeURIComponent(username)}`,
            `https://crafatar.com/skins/${encodeURIComponent(username)}`,
            `https://mc-heads.net/skin/${encodeURIComponent(username)}`
        ];
        for (const url of skinUrls) {
            try {
                const dest = path.join(baseDir, 'custom_skin.png');
                const resp = await fetch(url, {
                    headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' },
                    signal: AbortSignal.timeout(3000)
                });
                if (resp.ok) {
                    const buf = await resp.arrayBuffer();
                    if (buf.byteLength > 100) {
                        fs.writeFileSync(dest, Buffer.from(buf));
                        activeSkin = dest;
                        config.customSkinPath = dest;
                        onLog(`[POSTAVA] 🎨 Automaticky stažen skin pro nick "${username}".`);
                        break;
                    }
                }
            } catch (_) {}
        }
    }

    // Plášť aplikujeme POUZE pokud je explicitně nastaven a není 'none' / prázdný / defaultní
    const hasExplicitCape = config.customCapePath && config.customCapePath !== 'none' && !config.customCapePath.startsWith('data:image');
    let activeCape = null;
    if (hasExplicitCape) {
        if (config.customCapePath.startsWith('http://') || config.customCapePath.startsWith('https://')) {
            try {
                const destCape = path.join(baseDir, 'custom_cape.png');
                const resp = await fetch(config.customCapePath, {
                    headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' },
                    signal: AbortSignal.timeout(3000)
                });
                if (resp.ok) {
                    const buf = await resp.arrayBuffer();
                    if (buf.byteLength > 100) {
                        fs.writeFileSync(destCape, Buffer.from(buf));
                        activeCape = destCape;
                    }
                }
            } catch (e) {
                onLog(`[POSTAVA] Stažení online pláště selhalo: ${e.message}`);
            }
        } else if (fs.existsSync(config.customCapePath)) {
            activeCape = config.customCapePath;
        }
    }

    if (!activeSkin && !activeCape) {
        restoreVanillaJars(baseDir, targetVer, onLog);
        return;
    }

    try {
        // Cílové JARy k RAW přepsání textur
        const jarsToPatch = new Set();

        // 1. Základní vanilla JAR (např. 26.2.jar)
        const vanillaJar = path.join(baseDir, 'versions', targetVer, `${targetVer}.jar`);
        if (fs.existsSync(vanillaJar)) jarsToPatch.add(vanillaJar);

        // 2. Custom JAR (např. Fabric profil)
        if (versionOpts?.custom) {
            const customJar = path.join(baseDir, 'versions', versionOpts.custom, `${versionOpts.custom}.jar`);
            if (fs.existsSync(customJar)) jarsToPatch.add(customJar);
        }

        // 3. Prohledání všech odpovídajících složek ve versions
        const versionsDir = path.join(baseDir, 'versions');
        if (fs.existsSync(versionsDir)) {
            try {
                const dirs = fs.readdirSync(versionsDir);
                for (const d of dirs) {
                    if (d.includes(targetVer)) {
                        const cand = path.join(versionsDir, d, `${d}.jar`);
                        if (fs.existsSync(cand)) jarsToPatch.add(cand);
                    }
                }
            } catch (_) {}
        }

        for (const jarPath of jarsToPatch) {
            injectRawSkinIntoJar(jarPath, activeSkin, activeCape, onLog);
        }
    } catch (err) {
        onLog(`[POSTAVA] ⚠ Chyba při RAW aplikaci skinu/pláště: ${err.message}`);
    }
}

/**
 * Pomocná funkce pro získání kompletního Vanilla JSON manifestu pro cílovou verzi.
 */
async function getOrFetchVanillaVersionJson(centralRootDir, targetVersion) {
    const versionsDir = path.join(centralRootDir, 'versions');
    const localJson = path.join(versionsDir, targetVersion, `${targetVersion}.json`);
    if (fs.existsSync(localJson)) {
        try {
            return JSON.parse(fs.readFileSync(localJson, 'utf8'));
        } catch (e) {}
    }

    const candidates = getExistingMinecraftBaseDirs();
    for (const cand of candidates) {
        const candJson = path.join(cand, 'versions', targetVersion, `${targetVersion}.json`);
        if (fs.existsSync(candJson)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(candJson, 'utf8'));
                fs.mkdirSync(path.join(versionsDir, targetVersion), { recursive: true });
                fs.copyFileSync(candJson, localJson);
                return parsed;
            } catch (e) {}
        }
    }

    try {
        const manRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(8000) });
        if (manRes.ok) {
            const manifest = await manRes.json();
            const entry = manifest.versions.find(v => v.id === targetVersion);
            if (entry && entry.url) {
                const vRes = await fetch(entry.url, { signal: AbortSignal.timeout(10000) });
                if (vRes.ok) {
                    const vJson = await vRes.json();
                    fs.mkdirSync(path.join(versionsDir, targetVersion), { recursive: true });
                    fs.writeFileSync(localJson, JSON.stringify(vJson, null, 2), 'utf8');
                    return vJson;
                }
            }
        }
    } catch (e) {}
    return null;
}

/**
 * ⚡ Zajištění existence Fabric loader profilu pro zadanou verzi Minecraftu.
 * Sloučí oficiální Fabric meta JSON s Vanilla JSON manifestem (včetně client downloadu a všech knihoven).
 */
async function ensureFabricProfile(centralRootDir, targetVersion, onLog = console.log) {
    const versionsDir = path.join(centralRootDir, 'versions');
    fs.mkdirSync(versionsDir, { recursive: true });

    try {
        const existing = fs.readdirSync(versionsDir).find(d =>
            d.toLowerCase().startsWith('fabric-loader-') && d.includes(targetVersion) &&
            fs.existsSync(path.join(versionsDir, d, `${d}.json`))
        );
        if (existing) {
            const exJsonPath = path.join(versionsDir, existing, `${existing}.json`);
            try {
                const exJson = JSON.parse(fs.readFileSync(exJsonPath, 'utf8'));
                if (exJson.downloads && exJson.assetIndex && exJson.libraries && exJson.libraries.length > 15) {
                    onLog(`[FABRIC] Nalezen kompletní Fabric profil: ${existing}`);
                    return existing;
                }
            } catch (e) {}
        }
    } catch (e) {}

    onLog(`[FABRIC] Zjišťuji nejnovější Fabric loader pro Minecraft ${targetVersion}...`);
    try {
        const metaRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${targetVersion}`, {
            headers: { 'User-Agent': 'MYCHALSMP-Launcher' },
            signal: AbortSignal.timeout(10000)
        });
        if (!metaRes.ok) throw new Error(`Fabric meta HTTP ${metaRes.status}`);
        const loaders = await metaRes.json();
        if (!Array.isArray(loaders) || loaders.length === 0) {
            throw new Error(`Žádný Fabric loader nenalezen pro verzi ${targetVersion}`);
        }
        const loaderVersion = loaders[0].loader.version;
        onLog(`[FABRIC] Stahuji profil pro Fabric loader ${loaderVersion}...`);

        const profileRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${targetVersion}/${loaderVersion}/profile/json`, {
            headers: { 'User-Agent': 'MYCHALSMP-Launcher' },
            signal: AbortSignal.timeout(12000)
        });
        if (!profileRes.ok) throw new Error(`Fabric profile JSON HTTP ${profileRes.status}`);
        const profileJson = await profileRes.json();

        const fabricId = profileJson.id || `fabric-loader-${loaderVersion}-${targetVersion}`;
        const targetDir = path.join(versionsDir, fabricId);
        fs.mkdirSync(targetDir, { recursive: true });

        // Sloučit s Vanilla manifestem (doplnit downloads.client, assetIndex a vanilkové knihovny)
        const vanillaJson = await getOrFetchVanillaVersionJson(centralRootDir, targetVersion);
        const mergedProfile = {
            id: fabricId,
            inheritsFrom: targetVersion,
            releaseTime: profileJson.releaseTime || new Date().toISOString(),
            time: profileJson.time || new Date().toISOString(),
            type: 'release',
            mainClass: profileJson.mainClass || 'net.fabricmc.loader.impl.launch.knot.KnotClient',
            arguments: {
                game: [
                    ...(vanillaJson?.arguments?.game || []),
                    ...(profileJson.arguments?.game || [])
                ],
                jvm: [
                    ...(profileJson.arguments?.jvm || []),
                    ...(vanillaJson?.arguments?.jvm || [])
                ]
            },
            libraries: [
                ...(profileJson.libraries || []),
                ...(vanillaJson?.libraries || [])
            ],
            assetIndex: vanillaJson?.assetIndex,
            assets: vanillaJson?.assets,
            downloads: vanillaJson?.downloads
        };

        fs.writeFileSync(path.join(targetDir, `${fabricId}.json`), JSON.stringify(mergedProfile, null, 2), 'utf8');
        fs.writeFileSync(path.join(targetDir, `${targetVersion}.json`), JSON.stringify(mergedProfile, null, 2), 'utf8');

        // Zkopírovat vanilla client.jar do složky fabric profilu (pouze pokud je vanilkový jar 100% platný)
        const vanillaJar = path.join(versionsDir, targetVersion, `${targetVersion}.jar`);
        const fabricJar = path.join(targetDir, `${fabricId}.jar`);
        if (fs.existsSync(fabricJar) && !isJarFileValid(fabricJar)) {
            try { fs.unlinkSync(fabricJar); } catch (e) {}
        }
        if (fs.existsSync(vanillaJar) && isJarFileValid(vanillaJar) && !fs.existsSync(fabricJar)) {
            try { fs.copyFileSync(vanillaJar, fabricJar); } catch (e) {}
        }

        onLog(`[FABRIC] ✓ Fabric profil ${fabricId} úspěšně připraven a sloučen s jádrem!`);
        return fabricId;
    } catch (err) {
        try {
            const localFallback = fs.readdirSync(versionsDir).find(d =>
                d.toLowerCase().startsWith('fabric-loader-') && d.includes(targetVersion) &&
                fs.existsSync(path.join(versionsDir, d, `${d}.json`))
            );
            if (localFallback) {
                onLog(`[FABRIC] Síťové ověření selhalo (${err.message}), použiji existující lokální profil: ${localFallback}`);
                return localFallback;
            }
        } catch (_) {}
        onLog(`[FABRIC] ⚠ Nepodařilo se připravit Fabric profil: ${err.message}. Spouštím Vanilla.`);
        return null;
    }
}

/**
 * Launches Minecraft with the specified profile & configuration.
 */
async function launchGame(config, authData, customServer, onProgress, onLog, onExit) {
    if (activeMinecraftProcess) {
        throw new Error("Minecraft již běží!");
    }

    const launcher = new Client();
    launcher._isCancelled = false;
    launcher._activeRequests = new Set();
    launcher._activeControllers = new Set();
    launcher._activeStreams = new Map();
    launcher._sessionDownloadedFiles = new Set();

    activeLauncherClient = launcher;

    // Centrální BASE_DIR slouží pro sdílení verzí, knihoven a assetů mezi všemi profily!
    // Game instance dir slouží pro options.txt, mods, config, saves konkrétního profilu.
    const gameInstanceDir = config.baseDir || BASE_DIR;
    const targetVersion = config.version || '26.2';

    currentLaunchInfo = {
        rootDir: BASE_DIR,
        gameInstanceDir,
        targetVersion,
        client: launcher
    };

    const javaExecutable = await ensureJavaExecutable(config, onLog, onProgress);

    if (!fs.existsSync(BASE_DIR)) {
        fs.mkdirSync(BASE_DIR, { recursive: true });
    }
    if (!fs.existsSync(gameInstanceDir)) {
        fs.mkdirSync(gameInstanceDir, { recursive: true });
    }

    // ⚡ Bleskové převzetí existujících assetů a knihoven ze systému (.minecraft)
    linkOrShareExistingMinecraftData(BASE_DIR, onLog);

    // JVM Arguments (supports modern Java 25 ZGC and G1GC)
    let jvmArgs = [];
    if (config.customJvmArgs && config.customJvmArgs.trim()) {
        jvmArgs = config.customJvmArgs.trim().split(/\s+/).filter(Boolean);
    } else {
        // High-performance Java 25 ZGC default
        jvmArgs = [
            '-XX:+UseZGC',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+AlwaysPreTouch',
            '-XX:+DisableExplicitGC'
        ];
    }
    // Pro Java 24/25: odfiltrovat -XX:+ZGenerational (bylo v 24.0 odstraněno a hází warning v konzoli)
    jvmArgs = jvmArgs.filter(a => a !== '-XX:+ZGenerational');
    if (!jvmArgs.some(a => a.startsWith('-Dfile.encoding='))) {
        jvmArgs.push('-Dfile.encoding=UTF-8');
    }

    // ⚡ Pokročilé JVM optimalizace pro nulové mikro-záseky (eliminace diskového I/O při GC) a úsporu paměti
    const advancedJvmFlags = [
        '-XX:+PerfDisableSharedMem',      // Vypíná diskové zápisy HotSpot hsperfdata, které způsobují lag spiky při GC
        '-XX:+UseStringDeduplication',     // Sloučí identické textové řetězce v paměti (šetří 10-15% RAM)
        '-XX:+UseNUMA',                    // Optimalizuje paměťovou propustnost a cache na vícejádrových CPU (Ryzen / Intel)
        '-Djava.net.preferIPv4Stack=true'  // Zrychluje síťové sockety v Netty (vypíná zbytečný dual-stack IPv6 fallback)
    ];
    for (const flag of advancedJvmFlags) {
        const flagPrefix = flag.split('=')[0];
        if (!jvmArgs.some(a => a.startsWith(flagPrefix))) {
            jvmArgs.push(flag);
        }
    }

    // Moderní Mojang JVM Native Access Arguments pro Java 21 a Java 25
    const nativesExtractDir = path.join(BASE_DIR, 'natives_extract', targetVersion);
    try {
        fs.mkdirSync(path.join(nativesExtractDir, 'lwjgl'), { recursive: true });
        fs.mkdirSync(path.join(nativesExtractDir, 'jna'), { recursive: true });
        fs.mkdirSync(path.join(nativesExtractDir, 'netty'), { recursive: true });
        fs.mkdirSync(path.join(nativesExtractDir, 'java'), { recursive: true });
    } catch (e) {}

    if (!jvmArgs.includes('--enable-native-access=ALL-UNNAMED')) {
        jvmArgs.push('--enable-native-access=ALL-UNNAMED');
    }
    if (!jvmArgs.includes('--add-exports') && !jvmArgs.some(a => a.includes('jdk.internal.misc'))) {
        jvmArgs.push('--add-exports', 'java.base/jdk.internal.misc=ALL-UNNAMED');
    }
    if (!jvmArgs.some(a => a.startsWith('-Dorg.lwjgl.system.SharedLibraryExtractPath='))) {
        jvmArgs.push(`-Dorg.lwjgl.system.SharedLibraryExtractPath=${path.join(nativesExtractDir, 'lwjgl')}`);
    }
    if (!jvmArgs.some(a => a.startsWith('-Djna.tmpdir='))) {
        jvmArgs.push(`-Djna.tmpdir=${path.join(nativesExtractDir, 'jna')}`);
    }
    if (!jvmArgs.some(a => a.startsWith('-Dio.netty.native.workdir='))) {
        jvmArgs.push(`-Dio.netty.native.workdir=${path.join(nativesExtractDir, 'netty')}`);
    }
    if (!jvmArgs.some(a => a.startsWith('-Djava.library.path='))) {
        jvmArgs.push(`-Djava.library.path=${path.join(nativesExtractDir, 'java')}`);
    }

    // Direct Quick Play multiplayer connection (with automatic fallback to backup IP 130.61.89.37)
    let quickPlay = null;
    let serverToJoin = customServer || (config.autoConnectServer ? config.serverIp : null);
    if (serverToJoin) {
        if (serverToJoin.toLowerCase().includes('mychalsmp')) {
            try {
                const dns = require('dns').promises;
                const hostOnly = serverToJoin.includes(':') ? serverToJoin.split(':')[0] : serverToJoin;
                await dns.lookup(hostOnly);
            } catch (dnsErr) {
                const portOnly = serverToJoin.includes(':') ? serverToJoin.split(':')[1] : '25565';
                onLog(`[SÍŤ] Doména mychalsmp.xyz je nedostupná (Unknown host). Přepínám na záložní IP: 130.61.89.37:${portOnly}`);
                serverToJoin = `130.61.89.37:${portOnly}`;
            }
        }
        quickPlay = {
            type: 'multiplayer',
            identifier: serverToJoin.includes(':') ? serverToJoin : `${serverToJoin}:25565`
        };
    }

    // Loader resolution (Vanilla nebo automaticky Fabric)
    const versionOpts = {
        number: targetVersion,
        type: 'release'
    };

    if (config.loader && config.loader.toLowerCase() === 'fabric') {
        const fabricCustomId = await ensureFabricProfile(BASE_DIR, targetVersion, onLog);
        if (fabricCustomId) {
            versionOpts.custom = fabricCustomId;
        }
    } else if (config.loader && config.loader !== 'vanilla') {
        const versionsDir = path.join(BASE_DIR, 'versions');
        if (fs.existsSync(versionsDir)) {
            try {
                const subdirs = fs.readdirSync(versionsDir);
                const loaderMatch = subdirs.find(d =>
                    d.toLowerCase().includes(config.loader.toLowerCase()) &&
                    d.includes(targetVersion)
                );
                if (loaderMatch) {
                    versionOpts.custom = loaderMatch;
                }
            } catch (e) {}
        }
    }

    // Automatická kontrola a oprava integrity version JAR před spuštěním
    const activeVersionFolder = versionOpts.custom || versionOpts.number;
    const clientJarPath = path.join(BASE_DIR, 'versions', activeVersionFolder, `${activeVersionFolder}.jar`);
    if (fs.existsSync(clientJarPath) && !isJarFileValid(clientJarPath)) {
        const bak = clientJarPath.replace(/\.jar$/, '.vanilla.jar');
        if (fs.existsSync(bak) && isJarFileValid(bak)) {
            try { fs.copyFileSync(bak, clientJarPath); } catch (_) {}
        } else {
            onLog(`[OPRAVA]: Detekován poškozený soubor klienta ${clientJarPath}. Odstraňuji pro čisté znovustažení...`);
            try { fs.unlinkSync(clientJarPath); } catch (e) {}
        }
    }
    const vanillaClientJar = path.join(BASE_DIR, 'versions', versionOpts.number, `${versionOpts.number}.jar`);
    if (fs.existsSync(vanillaClientJar) && !isJarFileValid(vanillaClientJar)) {
        const bak = vanillaClientJar.replace(/\.jar$/, '.vanilla.jar');
        if (fs.existsSync(bak) && isJarFileValid(bak)) {
            try { fs.copyFileSync(bak, vanillaClientJar); } catch (_) {}
        } else {
            onLog(`[OPRAVA]: Detekován poškozený soubor jádra ${vanillaClientJar}. Odstraňuji pro čisté znovustažení...`);
            try { fs.unlinkSync(vanillaClientJar); } catch (e) {}
        }
    }

    // 🎭 Aplikace vlastního RAW offline skinu a pláště pro warez / offline režim přímo do jádra
    await setupOfflineCustomSkinAndCape(gameInstanceDir, config, onLog, targetVersion, versionOpts);

    const opts = {
        config: config,
        authorization: authData,
        root: BASE_DIR, // Centrální adresář pro sdílení verzí, knihoven a assetů bez znovustahování
        version: versionOpts,
        memory: {
            max: `${config.ramMax || 4}G`,
            min: `${config.ramMin || 2}G`
        },
        javaPath: javaExecutable,
        customArgs: jvmArgs,
        window: {
            width: config.resolution ? config.resolution.width : 1280,
            height: config.resolution ? config.resolution.height : 720,
            fullscreen: config.resolution ? config.resolution.fullscreen : false
        },
        quickPlay: quickPlay,
        downloadAudioDlc: true,
        overrides: {
            gameDirectory: gameInstanceDir, // Sem Minecraft generuje a odkud čte mods, config, options.txt, saves
            assetRoot: path.join(BASE_DIR, 'assets'),
            libraryRoot: path.join(BASE_DIR, 'libraries'),
            detached: false,
            maxSockets: 64,
            timeout: 10000
        }
    };

    if (versionOpts.custom) {
        const customDir = path.join(BASE_DIR, 'versions', versionOpts.custom);
        const customJson = path.join(customDir, `${versionOpts.custom}.json`);
        const customJar = path.join(customDir, `${versionOpts.custom}.jar`);
        if (fs.existsSync(customJson)) {
            opts.overrides.versionJson = customJson;
        }
        if (fs.existsSync(customJar)) {
            opts.overrides.minecraftJar = customJar;
        }
    }

    // Prepare Environment Variables for Game Launch (Wayland, Linux Performance & Prism features)
    const savedEnv = {};
    const setGameEnv = (key, val) => {
        if (!(key in savedEnv)) {
            savedEnv[key] = process.env[key];
        }
        process.env[key] = val;
    };

    if (process.platform === 'linux') {
        // Feral GameMode support
        if (config.enableGameMode) {
            const gamemodeLibs = [
                '/usr/lib/libgamemodeauto.so.0',
                '/usr/lib/x86_64-linux-gnu/libgamemodeauto.so.0',
                '/usr/lib64/libgamemodeauto.so.0'
            ];
            for (const lib of gamemodeLibs) {
                if (fs.existsSync(lib)) {
                    const currentPreload = process.env.LD_PRELOAD || '';
                    setGameEnv('LD_PRELOAD', currentPreload ? `${currentPreload}:${lib}` : lib);
                    onLog(`[VÝKON] Feral GameMode aktivován (${lib})`);
                    break;
                }
            }
        }

        // MangoHud Overlay (deaktivováno - nepodporováno)
        // config.enableMangoHud je trvale vypnuto na žádost uživatele

        // ⚡ Vícevláknová fronta OpenGL příkazů v grafických ovladačích (Mesa i NVIDIA)
        setGameEnv('MESA_GL_THREAD', 'true');
        setGameEnv('__GL_THREADED_OPTIMIZATIONS', '1');

        // Discrete GPU (NVIDIA & AMD Prime Offloading)
        if (config.enableDiscreteGpu) {
            setGameEnv('DRI_PRIME', '1');
            const hasNvidia = fs.existsSync('/proc/driver/nvidia') || fs.existsSync('/sys/module/nvidia');
            if (hasNvidia) {
                setGameEnv('__NV_PRIME_RENDER_OFFLOAD', '1');
                setGameEnv('__GLX_VENDOR_LIBRARY_NAME', 'nvidia');
                setGameEnv('__VK_LAYER_NV_optimus', 'NVIDIA_only');
                onLog('[VÝKON] Diskrétní GPU aktivována (DRI_PRIME=1, NVIDIA Prime Render Offload)');
            } else {
                onLog('[VÝKON] Diskrétní GPU aktivována (DRI_PRIME=1, Intel/AMD Prime Offload)');
            }
        }

        // Zink (OpenGL over Vulkan)
        if (config.enableZink) {
            setGameEnv('MESA_LOADER_DRIVER_OVERRIDE', 'zink');
            onLog('[VÝKON] Zink aktivován (MESA_LOADER_DRIVER_OVERRIDE=zink)');
        }

        // VSync / Frame tearing override
        if (config.disableVsync) {
            setGameEnv('__GL_SYNC_TO_VBLANK', '0');
            setGameEnv('vblank_mode', '0');
            onLog('[VÝKON] VSync ovladače deaktivován pro nulový input lag');
        }

        // Native Wayland GLFW Window Mode (Ultra-low input lag)
        if (config.enableNativeWayland) {
            setGameEnv('GLFW_PLATFORM', 'wayland');
            setGameEnv('SDL_VIDEODRIVER', 'wayland');
            setGameEnv('GDK_BACKEND', 'wayland,x11');
            setGameEnv('QT_QPA_PLATFORM', 'wayland;xcb');
            setGameEnv('CLUTTER_BACKEND', 'wayland');

            const glfwCandidates = [
                '/usr/lib/x86_64-linux-gnu/libglfw.so.3',
                '/usr/lib/x86_64-linux-gnu/libglfw.so',
                '/usr/lib64/libglfw.so.3',
                '/usr/lib64/libglfw.so',
                '/usr/lib/libglfw.so.3',
                '/usr/lib/libglfw.so'
            ];
            let foundGlfw = null;
            for (const cand of glfwCandidates) {
                if (fs.existsSync(cand)) {
                    foundGlfw = cand;
                    break;
                }
            }

            if (foundGlfw) {
                jvmArgs.push(`-Dorg.lwjgl.glfw.libname=${foundGlfw}`);
                onLog(`[WAYLAND] Aktivována systémová GLFW knihovna: ${foundGlfw}`);
            }
            // ZDE NIKDY nepřidávat -Dorg.lwjgl.glfw.libname=wayland, protože LWJGL hledá libwayland.so,
            // které neexistuje a způsobí pád. LWJGL 3.4.1+ nativně obslouží Wayland díky GLFW_PLATFORM=wayland.
            jvmArgs.push('-Djdk.gtk.version=3');
            jvmArgs.push('-Dawt.useSystemAAFontSettings=on');
            onLog('[WAYLAND] Vynuceno nativní Wayland okno (GLFW_PLATFORM=wayland, minimální input lag myši)');
        }

        // Custom environment variables defined by user (KEY=VAL per line)
        if (config.customEnvVars) {
            const lines = config.customEnvVars.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const eqIdx = trimmed.indexOf('=');
                    const k = trimmed.slice(0, eqIdx).trim();
                    const v = trimmed.slice(eqIdx + 1).trim();
                    if (k) {
                        setGameEnv(k, v);
                        onLog(`[PROSTŘEDÍ] Proměnná: ${k}=${v}`);
                    }
                }
            }
        }
    }

    launcher.on('debug', (e) => onLog(`[DEBUG] ${e}`));
    launcher.on('data', (e) => onLog(`[GAME] ${e}`));

    // ── Unified Launch & Download Progress Aggregator ───────────────────────
    // Spojuje všechny fáze (stahování jádra, knihoven, assetů a start) do jednoho
    // plynulého celku 0 % -> 100 %. Zamezuje trhání a skákání procent zpět při stahování tisíců mini-souborů.
    let unifiedProgress = 8;
    let currentPhase = 'init'; // 'init' | 'classes' | 'assets' | 'natives'

    function emitUnifiedProgress(targetPercent, statusText) {
        if (targetPercent > unifiedProgress) {
            unifiedProgress = Math.min(99, targetPercent);
        }
        onProgress({
            percent: unifiedProgress,
            text: statusText
        });
    }

    launcher.on('progress', (e) => {
        const taskFraction = (e.total && e.total > 0) ? Math.min(1, Math.max(0, e.task / e.total)) : 0;

        if (e.type === 'classes' || e.type === 'classes-custom' || e.type === 'classes-maven-custom') {
            currentPhase = 'classes';
            // Fáze knihoven: 10 % -> 55 % (rozpětí 45 %)
            const phasePercent = Math.round(10 + (taskFraction * 45));
            const text = (e.task >= e.total)
                ? 'Herní knihovny připraveny'
                : `Stahuji herní knihovny (${e.task} z ${e.total})...`;
            emitUnifiedProgress(phasePercent, text);
        } else if (e.type === 'assets') {
            currentPhase = 'assets';
            // Fáze assetů (zvuky, textury): 55 % -> 92 % (rozpětí 37 %)
            const phasePercent = Math.round(55 + (taskFraction * 37));
            const text = (e.task >= e.total)
                ? 'Herní data a textury připraveny'
                : `Stahuji herní data a textury (${Math.round(taskFraction * 100)} %)...`;
            emitUnifiedProgress(phasePercent, text);
        } else if (e.type === 'natives') {
            currentPhase = 'natives';
            // Fáze nativních knihoven: 92 % -> 97 %
            const phasePercent = Math.round(92 + (taskFraction * 5));
            emitUnifiedProgress(phasePercent, 'Příprava nativních knihoven...');
        } else {
            const phasePercent = Math.round(10 + (taskFraction * 80));
            emitUnifiedProgress(phasePercent, 'Příprava herních souborů...');
        }
    });

    launcher.on('download-status', (e) => {
        // Jednotlivé mini-soubory NIKDY neresetují celková procenta na 0 %!
        // Bereme je jako součást jednoho plynulého celku.
        const fileFraction = (e.total && e.total > 0) ? Math.min(1, Math.max(0, e.current / e.total)) : 0;

        if (currentPhase === 'init') {
            // Úvodní stahování jádra (např. client.jar)
            const phasePercent = Math.round(8 + (fileFraction * 6));
            emitUnifiedProgress(phasePercent, `Stahuji jádro hry (${e.name || 'Minecraft'})...`);
        } else if (currentPhase === 'classes') {
            // Uvnitř fáze knihoven: informativní text, procenta řídí celkový task counter
            onProgress({
                percent: unifiedProgress,
                text: `Stahuji herní knihovny (${e.name || 'soubor'})...`
            });
        } else if (currentPhase === 'assets') {
            // Uvnitř fáze tisíců mini-assetů: nezahlcovat UI každým jednotlivým souborem
            onProgress({
                percent: unifiedProgress,
                text: `Stahuji herní data a textury...`
            });
        }
    });

    launcher.on('close', (code) => {
        activeMinecraftProcess = null;
        onExit(code);
    });

    try {
        const proc = await launcher.launch(opts);
        if (launcher._isCancelled) {
            activeMinecraftProcess = null;
            return null;
        }
        activeMinecraftProcess = proc;
        if (onProgress) {
            onProgress({
                percent: 100,
                text: 'Spouštím Minecraft...'
            });
        }
    } catch (e) {
        if (launcher._isCancelled) {
            activeMinecraftProcess = null;
            return null;
        }
        throw e;
    } finally {
        if (!activeMinecraftProcess) {
            activeLauncherClient = null;
            currentLaunchInfo = null;
        }
        // Restore environment variables for the launcher process
        setTimeout(() => {
            for (const k of Object.keys(savedEnv)) {
                if (savedEnv[k] === undefined) {
                    delete process.env[k];
                } else {
                    process.env[k] = savedEnv[k];
                }
            }
        }, 1500);
    }
    return activeMinecraftProcess;
}

function isGameRunning() {
    return activeMinecraftProcess !== null;
}

function cancelLaunch() {
    if (activeLauncherClient) {
        activeLauncherClient._isCancelled = true;

        if (activeLauncherClient._activeControllers) {
            for (const ctrl of activeLauncherClient._activeControllers) {
                try { ctrl.abort(); } catch (e) {}
            }
            activeLauncherClient._activeControllers.clear();
        }

        if (activeLauncherClient._activeRequests) {
            for (const req of activeLauncherClient._activeRequests) {
                try { req.abort(); } catch (e) {}
            }
            activeLauncherClient._activeRequests.clear();
        }

        if (activeLauncherClient._activeStreams) {
            for (const [filePath, st] of activeLauncherClient._activeStreams.entries()) {
                try { st.destroy(); } catch (e) {}
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {}
            }
            activeLauncherClient._activeStreams.clear();
        }

        if (activeLauncherClient._sessionDownloadedFiles) {
            for (const filePath of activeLauncherClient._sessionDownloadedFiles) {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {}
            }
            activeLauncherClient._sessionDownloadedFiles.clear();
        }
    }

    if (activeMinecraftProcess) {
        try {
            activeMinecraftProcess.kill();
        } catch (e) {}
        activeMinecraftProcess = null;
    }

    activeLauncherClient = null;
    currentLaunchInfo = null;
    return true;
}

function killGame() {
    return cancelLaunch();
}

// ── Minecraft Hudba & Zvuky (DLC) ───────────────────────────────────────────
let activeDlcAbortController = null;

async function getOrFetchAssetIndex(baseDir, targetVersion = '26.2') {
    const assetsDir = path.join(baseDir, 'assets');
    const indexesDir = path.join(assetsDir, 'indexes');
    const indexFile = path.join(indexesDir, `${targetVersion}.json`);

    if (fs.existsSync(indexFile)) {
        try {
            return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        } catch (e) {}
    }

    if (fs.existsSync(indexesDir)) {
        try {
            const files = fs.readdirSync(indexesDir).filter(f => f.endsWith('.json'));
            if (files.length > 0) {
                const fPath = path.join(indexesDir, files[0]);
                return JSON.parse(fs.readFileSync(fPath, 'utf8'));
            }
        } catch (e) {}
    }

    try {
        fs.mkdirSync(indexesDir, { recursive: true });
        const manifestRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(8000) });
        if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            let vEntry = manifest.versions.find(v => v.id === targetVersion) ||
                         manifest.versions.find(v => v.id === manifest.latest.release) ||
                         manifest.versions[0];
            if (vEntry && vEntry.url) {
                const vRes = await fetch(vEntry.url, { signal: AbortSignal.timeout(8000) });
                if (vRes.ok) {
                    const vJson = await vRes.json();
                    if (vJson.assetIndex && vJson.assetIndex.url) {
                        const indexRes = await fetch(vJson.assetIndex.url, { signal: AbortSignal.timeout(10000) });
                        if (indexRes.ok) {
                            const indexText = await indexRes.text();
                            fs.writeFileSync(indexFile, indexText, 'utf8');
                            return JSON.parse(indexText);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Nepodařilo se stáhnout online asset index pro audio DLC:', e.message);
    }
    return null;
}

async function checkAudioDlcStatus(baseDir, targetVersion = '26.2') {
    const assetsDir = path.join(baseDir, 'assets');
    const objectsDir = path.join(assetsDir, 'objects');
    const index = await getOrFetchAssetIndex(baseDir, targetVersion);

    if (!index || !index.objects) {
        return {
            available: false,
            installed: false,
            totalAudioFiles: 0,
            existingCount: 0,
            missingCount: 0,
            missingMB: 0
        };
    }

    const audioKeys = Object.keys(index.objects).filter(k => k.startsWith('minecraft/sounds/'));
    let existingCount = 0;
    let missingBytes = 0;

    for (const key of audioKeys) {
        const obj = index.objects[key];
        const sub = obj.hash.substring(0, 2);
        const objPath = path.join(objectsDir, sub, obj.hash);
        if (fs.existsSync(objPath)) {
            existingCount++;
        } else {
            missingBytes += (obj.size || 0);
        }
    }

    const missingCount = audioKeys.length - existingCount;
    return {
        available: true,
        installed: missingCount === 0 && audioKeys.length > 0,
        totalAudioFiles: audioKeys.length,
        existingCount: existingCount,
        missingCount: missingCount,
        missingMB: Math.round(missingBytes / (1024 * 1024))
    };
}

async function downloadAudioDlc(baseDir, targetVersion = '26.2', onProgress) {
    if (activeDlcAbortController) {
        try { activeDlcAbortController.abort(); } catch (e) {}
    }
    const abortCtrl = new AbortController();
    activeDlcAbortController = abortCtrl;

    const assetsDir = path.join(baseDir, 'assets');
    const objectsDir = path.join(assetsDir, 'objects');
    const index = await getOrFetchAssetIndex(baseDir, targetVersion);

    if (!index || !index.objects) {
        throw new Error('Nelze načíst index Minecraft assetů.');
    }

    const audioKeys = Object.keys(index.objects).filter(k => k.startsWith('minecraft/sounds/'));
    const missingKeys = audioKeys.filter(k => {
        const obj = index.objects[k];
        const sub = obj.hash.substring(0, 2);
        return !fs.existsSync(path.join(objectsDir, sub, obj.hash));
    });

    if (missingKeys.length === 0) {
        if (onProgress) onProgress({ current: audioKeys.length, total: audioKeys.length, percent: 100, status: 'completed' });
        return { success: true, count: 0 };
    }

    const existingCandidates = getExistingMinecraftBaseDirs()
        .map(d => path.join(d, 'assets', 'objects'))
        .filter(d => fs.existsSync(d));

    let processed = 0;
    const totalToDownload = missingKeys.length;
    const concurrency = 25;
    let idx = 0;

    let lastReport = 0;
    const report = () => {
        const now = Date.now();
        if (now - lastReport > 80 || processed === totalToDownload) {
            lastReport = now;
            const percent = Math.min(100, Math.round((processed / totalToDownload) * 100));
            if (onProgress) {
                onProgress({
                    current: processed,
                    total: totalToDownload,
                    percent,
                    status: 'downloading'
                });
            }
        }
    };

    report();

    const downloadSingle = async (key) => {
        if (abortCtrl.signal.aborted) return;
        const obj = index.objects[key];
        const hash = obj.hash;
        const subhash = hash.substring(0, 2);
        const subDir = path.join(objectsDir, subhash);
        const targetFile = path.join(subDir, hash);

        // 1. Zkusit zkopírovat ze stávajícího .minecraft
        for (const candDir of existingCandidates) {
            const candPath = path.join(candDir, subhash, hash);
            if (fs.existsSync(candPath)) {
                try {
                    fs.mkdirSync(subDir, { recursive: true });
                    fs.copyFileSync(candPath, targetFile);
                    processed++;
                    report();
                    return;
                } catch (e) {}
            }
        }

        // 2. Stáhnout z Mojangu
        const url = `https://resources.download.minecraft.net/${subhash}/${hash}`;
        try {
            fs.mkdirSync(subDir, { recursive: true });
            const res = await fetch(url, { signal: abortCtrl.signal });
            if (res.ok) {
                const buffer = Buffer.from(await res.arrayBuffer());
                fs.writeFileSync(targetFile, buffer);
            }
        } catch (e) {
            if (abortCtrl.signal.aborted) throw e;
        }

        processed++;
        report();
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (idx < missingKeys.length) {
            if (abortCtrl.signal.aborted) break;
            const key = missingKeys[idx++];
            await downloadSingle(key);
        }
    });

    await Promise.all(workers);

    if (abortCtrl.signal.aborted) {
        throw new Error('DOWNLOAD_CANCELLED');
    }

    if (onProgress) {
        onProgress({
            current: totalToDownload,
            total: totalToDownload,
            percent: 100,
            status: 'completed'
        });
    }

    return { success: true, count: processed };
}

function cancelAudioDlcDownload() {
    if (activeDlcAbortController) {
        try { activeDlcAbortController.abort(); } catch (e) {}
        activeDlcAbortController = null;
        return true;
    }
    return false;
}

module.exports = {
    BASE_DIR,
    detectJavaPath,
    getAvailableJavas,
    getInstalledVersions,
    launchGame,
    isGameRunning,
    killGame,
    cancelLaunch,
    checkAudioDlcStatus,
    downloadAudioDlc,
    cancelAudioDlcDownload,
    setupOfflineCustomSkinAndCape,
    ensureJavaExecutable,
    downloadAndInstallJava,
    getJavaMajorVersion,
    getRequiredJavaVersion
};
