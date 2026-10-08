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

    // 1. Zkontrolovat, zda cílový client jar již existuje a je aktuální (ověření SHA-1 hashe od Microsoftu/Mojangu)
    if (fs.existsSync(targetJarPath)) {
        let isUpToDate = true;
        if (expectedSha1) {
            const actualSha1 = getFileSha1(targetJarPath);
            if (actualSha1 && actualSha1 !== expectedSha1) {
                isUpToDate = false;
                this.client.emit('debug', `[AKTUALIZACE]: Detekován nový patch / revize verze ${versionNumber} od Microsoftu/Mojangu (lokální SHA-1 ${actualSha1} neodpovídá ${expectedSha1}). Stahuji aktualizovaný klient jar...`);
            }
        }
        if (isUpToDate) {
            try { fs.writeFileSync(targetJsonPath, JSON.stringify(this.version, null, 4)); } catch (e) {}
            this.client.emit('debug', `[OPTIMALIZACE]: Verze ${jarName} již existuje na disku a je aktuální, stahování přeskočeno.`);
            return;
        }
    }

    // 2. Bleskové převzetí existujícího jaru ze systému (.minecraft, PrismLauncher, Modrinth)
    const candidates = getExistingMinecraftBaseDirs();
    let copied = false;
    for (const cand of candidates) {
        const candJar = path.join(cand, 'versions', versionNumber, `${versionNumber}.jar`);
        if (fs.existsSync(candJar)) {
            // Ověříme, zda i kandidát odpovídá novému Mojang hashi
            if (expectedSha1) {
                const candSha1 = getFileSha1(candJar);
                if (candSha1 !== expectedSha1) continue;
            }
            try {
                fs.mkdirSync(this.options.directory, { recursive: true });
                fs.copyFileSync(candJar, targetJarPath);
                copied = true;
                this.client.emit('debug', `[OPTIMALIZACE]: ⚡ Bleskově převzat existující herní klient ${jarName} z "${candJar}"!`);
                break;
            } catch (e) {}
        }
    }

    // 3. Pokud není na disku nebo neodpovídá novému patchi, stáhnout z oficiálního Mojang serveru
    if (!copied) {
        await this.downloadAsync(this.version.downloads.client.url, this.options.directory, jarName, true, 'version-jar');
    }

    try { fs.writeFileSync(targetJsonPath, JSON.stringify(this.version, null, 4)); } catch (e) {}
    this.client.emit('debug', `[MCLC]: Herní klient ${jarName} je připraven.`);
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
                    log(`[OPTIMALIZACE] ⚡ Bleskově propojeny existující Minecraft assety z "${candAssets}" (0 MB ke stahování)!`);
                    break;
                } catch (e) {
                    log(`[OPTIMALIZACE] Nelze vytvořit symlink na assety (${e.message}), použijeme přímé čtení z disku.`);
                }
            }
        }
    }

    // 2. Propojení / sdílení složky libraries
    const targetLibs = path.join(targetRootDir, 'libraries');
    if (!fs.existsSync(targetLibs)) {
        for (const cand of candidates) {
            const candLibs = path.join(cand, 'libraries');
            if (fs.existsSync(candLibs)) {
                try {
                    fs.mkdirSync(path.dirname(targetLibs), { recursive: true });
                    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
                    fs.symlinkSync(candLibs, targetLibs, symlinkType);
                    log(`[OPTIMALIZACE] ⚡ Bleskově propojeny existující Minecraft knihovny z "${candLibs}"!`);
                    break;
                } catch (e) {}
            }
        }
    }
}

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
    const assetId = this.options.version.custom || this.options.version.number;
    const indexFilePath = path.join(assetDirectory, 'indexes', `${assetId}.json`);

    if (!fs.existsSync(indexFilePath)) {
        await this.downloadAsync(this.version.assetIndex.url, path.join(assetDirectory, 'indexes'), `${assetId}.json`, true, 'asset-json');
    }

    if (!fs.existsSync(indexFilePath)) {
        throw new Error(`Nepodařilo se stáhnout index assetů: ${assetId}.json`);
    }

    const index = JSON.parse(fs.readFileSync(indexFilePath, { encoding: 'utf8' }));

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
        this.client.emit('debug', `[DELTA ASSETY]: ⚡ Všech ${filteredAssetKeys.length} textur a zvuků již existuje na disku a jsou 100% aktuální. Spouštím hru bleskově bez stahování!`);
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
    this.client.emit('debug', `[OPTIMALIZACE]: Staženo ${counter} nových/změněných assetů. ${reusedCount} nezměněných textur a zvuků bylo bleskově převzato z disku.`);
};


/**
 * Scans installed Java environments prioritizing Java 25 and Java 21.
 */
function detectJavaPath() {
    // 1. Linux candidates (Java 25 first, then Java 21, then system default)
    if (process.platform !== 'win32') {
        const linuxCandidates = [
            '/usr/lib/jvm/java-25-openjdk-amd64/bin/java',
            '/usr/lib/jvm/java-25-openjdk/bin/java',
            '/usr/lib/jvm/openjdk-25/bin/java',
            '/usr/lib/jvm/java-21-openjdk-amd64/bin/java',
            '/usr/lib/jvm/java-21-openjdk/bin/java',
            '/usr/lib/jvm/openjdk-21/bin/java',
            '/usr/lib/jvm/default-runtime/bin/java'
        ];
        for (const cand of linuxCandidates) {
            if (fs.existsSync(cand)) return cand;
        }

        try {
            const out = execSync('which java', { encoding: 'utf-8', timeout: 1500 }).trim().split('\n')[0];
            if (out && fs.existsSync(out)) return out;
        } catch (e) {}

        return '/usr/bin/java';
    }

    // 2. Windows candidates (Java 25 first, then Java 21)
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
                // Prefer 25 over 21
                const sorted = subdirs.sort((a, b) => b.localeCompare(a));
                for (const sub of sorted) {
                    const javaw = path.join(base, sub, 'bin', 'javaw.exe');
                    if (fs.existsSync(javaw)) return javaw;
                }
            } catch (e) {}
        }
    }

    try {
        const out = execSync('where javaw', { encoding: 'utf-8', timeout: 1500 }).trim().split('\n')[0];
        if (out && fs.existsSync(out)) return out;
    } catch (e) {}

    return 'javaw';
}

/**
 * Returns all detected Java installations with version info.
 */
function getAvailableJavas() {
    const list = [];
    const checkPath = (binPath, label) => {
        if (fs.existsSync(binPath)) {
            try {
                const verOut = execSync(`"${binPath}" -version 2>&1`, { encoding: 'utf-8', timeout: 2000 });
                const firstLine = verOut.split('\n')[0] || '';
                list.push({ path: binPath, label: `${label} (${firstLine.replace(/"/g, '')})` });
            } catch (e) {
                list.push({ path: binPath, label });
            }
        }
    };

    if (process.platform !== 'win32') {
        const candidates = [
            ['/usr/lib/jvm/java-25-openjdk-amd64/bin/java', 'Java 25 (LTS)'],
            ['/usr/lib/jvm/java-21-openjdk-amd64/bin/java', 'Java 21 (LTS)'],
            ['/usr/bin/java', 'Systémová Java']
        ];
        candidates.forEach(([p, l]) => checkPath(p, l));
    }
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
    const rootDir = config.baseDir;
    const targetVersion = config.version || '26.2';

    currentLaunchInfo = {
        rootDir,
        targetVersion,
        client: launcher
    };

    const javaExecutable = config.javaPath && fs.existsSync(config.javaPath)
        ? config.javaPath
        : detectJavaPath();
    if (!fs.existsSync(rootDir)) {
        fs.mkdirSync(rootDir, { recursive: true });
    }

    // ⚡ Bleskové převzetí existujících assetů a knihoven ze systému (.minecraft)
    linkOrShareExistingMinecraftData(rootDir, onLog);

    // If running in an instance subfolder, share central assets and libraries
    try {
        const parentDir = path.dirname(rootDir);
        if (path.basename(parentDir) === 'instances') {
            const centralBase = path.dirname(parentDir);
            const centralAssets = path.join(centralBase, 'assets');
            const centralLibs = path.join(centralBase, 'libraries');
            const instAssets = path.join(rootDir, 'assets');
            const instLibs = path.join(rootDir, 'libraries');
            if (fs.existsSync(centralAssets) && !fs.existsSync(instAssets)) {
                try { fs.symlinkSync(centralAssets, instAssets, 'junction'); } catch(e){}
            }
            if (fs.existsSync(centralLibs) && !fs.existsSync(instLibs)) {
                try { fs.symlinkSync(centralLibs, instLibs, 'junction'); } catch(e){}
            }
        }
    } catch (e) {}

    // JVM Arguments (supports modern Java 21/25 Generational ZGC and G1GC)
    let jvmArgs = [];
    if (config.customJvmArgs && config.customJvmArgs.trim()) {
        jvmArgs = config.customJvmArgs.trim().split(/\s+/).filter(Boolean);
    } else {
        // High-performance Java 21+ Generational ZGC default
        jvmArgs = [
            '-XX:+UseZGC',
            '-XX:+ZGenerational',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+AlwaysPreTouch',
            '-XX:+DisableExplicitGC'
        ];
    }
    if (!jvmArgs.some(a => a.startsWith('-Dfile.encoding='))) {
        jvmArgs.push('-Dfile.encoding=UTF-8');
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

    // Loader resolution (Vanilla by default, or Fabric / Forge / NeoForge if present)
    const versionOpts = {
        number: targetVersion,
        type: 'release'
    };

    if (config.loader && config.loader !== 'vanilla') {
        const versionsDir = path.join(rootDir, 'versions');
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

    const opts = {
        authorization: authData,
        root: rootDir,
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
        downloadAudioDlc: config.enableAudioDlc !== false,
        overrides: {
            assetRoot: path.join(BASE_DIR, 'assets'),
            libraryRoot: path.join(BASE_DIR, 'libraries'),
            detached: false,
            maxSockets: 64,
            timeout: 10000
        }
    };

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

        // MangoHud Overlay
        if (config.enableMangoHud) {
            setGameEnv('MANGOHUD', '1');
            onLog('[VÝKON] MangoHud aktivován (MANGOHUD=1)');
        }

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
            } else {
                jvmArgs.push('-Dorg.lwjgl.glfw.libname=wayland');
            }
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

    launcher.on('progress', (e) => {
        const percent = Math.round((e.task / e.total) * 100) || 0;
        onProgress({
            type: e.type,
            task: e.task,
            total: e.total,
            percent: percent,
            text: `Stahuji ${e.type}: ${percent}% (${e.task}/${e.total})`
        });
    });

    launcher.on('download-status', (e) => {
        const percent = Math.round((e.current / e.total) * 100) || 0;
        onProgress({
            type: e.type,
            task: e.current,
            total: e.total,
            percent: percent,
            text: `Stahuji: ${e.name} (${percent}%)`
        });
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

    if (currentLaunchInfo && currentLaunchInfo.rootDir && currentLaunchInfo.targetVersion) {
        const vDir = path.join(currentLaunchInfo.rootDir, 'versions', currentLaunchInfo.targetVersion);
        try {
            if (fs.existsSync(vDir)) {
                fs.rmSync(vDir, { recursive: true, force: true });
            }
        } catch (e) {}
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
    detectJavaPath,
    getAvailableJavas,
    getInstalledVersions,
    launchGame,
    isGameRunning,
    killGame,
    cancelLaunch,
    checkAudioDlcStatus,
    downloadAudioDlc,
    cancelAudioDlcDownload
};
