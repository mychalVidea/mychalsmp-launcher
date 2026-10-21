const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (_) { }

const { Client } = require('minecraft-launcher-core');
const Handler = require('minecraft-launcher-core/components/handler');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { BASE_DIR, loadConfig } = require('./config');
const nativeLoader = require('./nativeLoader');

let activeMinecraftProcess = null;
let activeLauncherClient = null;
let currentLaunchInfo = null;
let isIntentionalTermination = false;

function markIntentionalTermination() {
    isIntentionalTermination = true;
}

function wasTerminationIntentional() {
    return isIntentionalTermination;
}

function resetTerminationIntent() {
    isIntentionalTermination = false;
}

function verifyFileSha1(filePath, expectedSha1) {
    if (!expectedSha1) return true;
    try {
        if (!fs.existsSync(filePath)) return false;
        let actualSha1;
        if (nativeLoader.isNativeActive()) {
            actualSha1 = nativeLoader.fastHashFileSha1(filePath);
        } else {
            const data = fs.readFileSync(filePath);
            actualSha1 = crypto.createHash('sha1').update(data).digest('hex');
        }
        return actualSha1.toLowerCase() === expectedSha1.toLowerCase();
    } catch (e) {
        return false;
    }
}

function isJarFileValidInternal(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.size < 22) return false;
    const fd = fs.openSync(filePath, 'r');
    try {
        const headBuf = Buffer.alloc(4);
        fs.readSync(fd, headBuf, 0, 4, 0);
        // První 4 bajty musí být přesně LOC hlavička: 0x04034b50 (PK\3\4)
        if (headBuf[0] !== 0x50 || headBuf[1] !== 0x4b || headBuf[2] !== 0x03 || headBuf[3] !== 0x04) {
            return false;
        }
        const tailLen = Math.min(stats.size, 65557);
        const tailBuf = Buffer.alloc(tailLen);
        fs.readSync(fd, tailBuf, 0, tailLen, stats.size - tailLen);
        const eocdIndex = tailBuf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        if (eocdIndex === -1) {
            return false;
        }

        // Ověření integrity Central Directory (CEN) hlavičky pro prevenci java.util.zip.ZipException: invalid CEN header
        if (eocdIndex + 20 <= tailLen) {
            let cenOffset = tailBuf.readUInt32LE(eocdIndex + 16);
            let cenSize = tailBuf.readUInt32LE(eocdIndex + 12);
            let totalEntries = tailBuf.readUInt16LE(eocdIndex + 10);

            // Zip64 podpora pro velké archivy
            if (cenOffset === 0xFFFFFFFF || cenSize === 0xFFFFFFFF || totalEntries === 0xFFFF) {
                const locIndex = tailBuf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
                if (locIndex !== -1 && locIndex + 16 <= tailLen) {
                    const zip64EocdOffset = Number(tailBuf.readBigUInt64LE(locIndex + 8));
                    if (zip64EocdOffset < stats.size) {
                        const zip64Buf = Buffer.alloc(56);
                        fs.readSync(fd, zip64Buf, 0, 56, zip64EocdOffset);
                        if (zip64Buf[0] === 0x50 && zip64Buf[1] === 0x4b && zip64Buf[2] === 0x06 && zip64Buf[3] === 0x06) {
                            cenOffset = Number(zip64Buf.readBigUInt64LE(48));
                            cenSize = Number(zip64Buf.readBigUInt64LE(40));
                            totalEntries = Number(zip64Buf.readBigUInt64LE(32));
                        }
                    }
                }
            }

            if (cenSize > 0) {
                if (cenOffset >= stats.size || (cenOffset + cenSize) > stats.size) return false;
                const readCenLen = Math.min(cenSize, Math.min(stats.size - cenOffset, 16 * 1024 * 1024));
                const cenSigBuf = Buffer.alloc(readCenLen);
                fs.readSync(fd, cenSigBuf, 0, readCenLen, cenOffset);
                // CEN signature prvního záznamu musí být přesně 0x02014b50 (PK\1\2)
                if (cenSigBuf[0] !== 0x50 || cenSigBuf[1] !== 0x4b || cenSigBuf[2] !== 0x01 || cenSigBuf[3] !== 0x02) {
                    return false;
                }

                // Hloubkové ověření LOC hlaviček napříč CELÝM archivem pro zamezení ZipFile invalid LOC header (bad signature)
                let p = 0;
                const locOffsets = [];
                while (p + 46 <= readCenLen) {
                    if (cenSigBuf[p] !== 0x50 || cenSigBuf[p + 1] !== 0x4b || cenSigBuf[p + 2] !== 0x01 || cenSigBuf[p + 3] !== 0x02) {
                        return false; // Porušená položka v CEN tabulce
                    }
                    const nameLen = cenSigBuf.readUInt16LE(p + 28);
                    const extraLen = cenSigBuf.readUInt16LE(p + 30);
                    const commentLen = cenSigBuf.readUInt16LE(p + 32);
                    const locOffset = cenSigBuf.readUInt32LE(p + 42);

                    if (locOffset >= stats.size) {
                        return false;
                    }
                    locOffsets.push(locOffset);
                    p += 46 + nameLen + extraLen + commentLen;
                }

                if (locOffsets.length === 0) return false;

                // Ověření LOC signatur rovnoměrně rozprostřených napříč celým archivem (0 % až 100 %)
                const locBuf = Buffer.alloc(4);
                const checkIndices = new Set();
                checkIndices.add(0);
                checkIndices.add(locOffsets.length - 1);
                checkIndices.add(Math.floor(locOffsets.length / 2));
                checkIndices.add(Math.floor(locOffsets.length / 4));
                checkIndices.add(Math.floor((3 * locOffsets.length) / 4));

                const step = Math.max(1, Math.floor(locOffsets.length / 100));
                for (let i = 0; i < locOffsets.length; i += step) {
                    checkIndices.add(i);
                }

                for (const idx of checkIndices) {
                    const offset = locOffsets[idx];
                    if (offset + 4 > stats.size) return false;
                    fs.readSync(fd, locBuf, 0, 4, offset);
                    if (locBuf[0] !== 0x50 || locBuf[1] !== 0x4b || locBuf[2] !== 0x03 || locBuf[3] !== 0x04) {
                        return false; // Vadná LOC hlavička (bad signature) nalezena v archivu!
                    }
                }
            }
        }
    } finally {
        fs.closeSync(fd);
    }

    // Doplňková kontrola dekomprese vzorku položek pomocí adm-zip (pokud je dostupný)
    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        if (entries && entries.length > 0) {
            const sampleEntries = [];
            const manifest = entries.find(e => e.entryName === 'META-INF/MANIFEST.MF');
            if (manifest) sampleEntries.push(manifest);
            const fabricJson = entries.find(e => e.entryName === 'fabric.mod.json');
            if (fabricJson) sampleEntries.push(fabricJson);

            const nonDirEntries = entries.filter(e => !e.isDirectory);
            if (nonDirEntries.length > 0) {
                sampleEntries.push(nonDirEntries[0]);
                sampleEntries.push(nonDirEntries[Math.floor(nonDirEntries.length / 2)]);
                sampleEntries.push(nonDirEntries[nonDirEntries.length - 1]);
            }

            for (const entry of sampleEntries) {
                const data = zip.readFile(entry);
                if (data === null && entry.header && entry.header.size > 0) {
                    return false; // Selhala dekomprese položky
                }
            }
        }
    } catch (_) {
        // Pokud adm-zip není dostupný, selže na paměti nebo alokaci,
        // ale nativní binární kontrola hlaviček výše prošla na 100 %, archiv je platný!
    }

    return true;
}

function isJarFileValid(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return isJarFileValidInternal(filePath);
        } catch (err) {
            if ((err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') && attempt < 2) {
                const end = Date.now() + 150;
                while (Date.now() < end) { /* sync delay for OS file handle release */ }
                continue;
            }
            return false;
        }
    }
    return false;
}

// Intercept Handler.prototype.downloadAsync:
// Bleskurychlý downloader postavený na nativním Node fetch (HTTP/2 multiplexing, nulová socket starvation,
// dynamický inactivity timeout a paměťový buffer pro malé assety).
Handler.prototype.downloadAsync = async function (url, directory, name, retry = 3, type = 'assets') {
    if (this.client && this.client._isCancelled) {
        return Promise.reject(new Error('LAUNCH_CANCELLED'));
    }

    const fullPath = path.join(directory, name);
    if (this.client && this.client._sessionDownloadedFiles) {
        this.client._sessionDownloadedFiles.add(fullPath);
    }

    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch (e) { }

    const controller = new AbortController();
    if (this.client && this.client._activeControllers) {
        this.client._activeControllers.add(controller);
    }

    const isBigFile = (type === 'version-jar' || (name && name.endsWith('.jar') && type !== 'assets'));
    const defaultTimeoutMs = isBigFile ? 60000 : 15000;

    let timeoutTimer = null;
    const resetTimeout = (ms = defaultTimeoutMs) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
            try { controller.abort(new Error('ETIMEDOUT')); } catch (e) { }
        }, ms);
    };

    resetTimeout(defaultTimeoutMs);

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

        resetTimeout(defaultTimeoutMs);

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
                try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) { }
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
                try { controller.abort(); } catch (e) { }
                return;
            }
            receivedBytes += chunk.length;
            resetTimeout(defaultTimeoutMs);
            this.client.emit('download-status', {
                name: name,
                type: type,
                current: receivedBytes,
                total: totalBytes || receivedBytes
            });
        });

        await pipeline(nodeStream, fileStream);

        if (totalBytes > 0 && receivedBytes < totalBytes) {
            try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) { }
            throw new Error(`Neúplné stažení souboru ${name}: ${receivedBytes}/${totalBytes} B`);
        }

        if (name.endsWith('.jar') && !isJarFileValid(fullPath)) {
            try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) { }
            throw new Error(`Poškozený stažený archiv JAR: ${name}`);
        }

        cleanup();
        this.client.emit('download', name);
        return { failed: false, asset: null };

    } catch (err) {
        cleanup();
        try {
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch (e) { }

        if (this.client && this.client._isCancelled) {
            return false;
        }

        let retriesLeft = typeof retry === 'number' ? retry : (retry ? 3 : 0);
        this.client.emit('debug', `[MCLC]: Chyba při stahování ${name} (${err.message}). Zbývající pokusy: ${retriesLeft}`);

        if (retriesLeft > 0) {
            const backoff = retriesLeft === 3 ? 250 : (retriesLeft === 2 ? 600 : 1200);
            await new Promise(r => setTimeout(r, backoff));
            return await this.downloadAsync(url, directory, name, retriesLeft - 1, type);
        }
        return false;
    }
};

const origStartMinecraft = Client.prototype.startMinecraft;
Client.prototype.startMinecraft = function (launchArguments) {
    if (this._isCancelled) {
        this.emit('debug', '[MCLC]: Spuštění hry bylo zrušeno, proces nebude nastartován.');
        return null;
    }
    try {
        if (Array.isArray(launchArguments)) {
            const centralRoot = this.options?.overrides?.cwd || this.options?.root || path.join(os.homedir(), '.mychalsmp');
            const targetVer = String(this.version?.id || this.options?.version?.number || '26.2');
            const resolvedNatives = path.join(centralRoot, 'natives_extract', targetVer);

            // 1. Nahradit případné neexpandované šablony ${natives_directory} z MCLC
            launchArguments = launchArguments.map(arg => {
                if (typeof arg === 'string' && arg.includes('${natives_directory}')) {
                    return arg.replaceAll('${natives_directory}', resolvedNatives);
                }
                return arg;
            });

            // 2. Deduplikace systémových vlastností (-D), aby pozdější neexpandované či duplicitní parametry nepřepisovaly platné
            const seenPropKeys = new Set();
            launchArguments = launchArguments.filter(arg => {
                if (typeof arg === 'string' && arg.startsWith('-D')) {
                    const eqIdx = arg.indexOf('=');
                    if (eqIdx !== -1) {
                        const propKey = arg.slice(0, eqIdx);
                        if (seenPropKeys.has(propKey)) {
                            return false;
                        }
                        seenPropKeys.add(propKey);
                    }
                }
                return true;
            });
        }
        const proc = origStartMinecraft.call(this, launchArguments);
        if (this._isCancelled && proc) {
            try { proc.kill(); } catch (e) { }
            return null;
        }
        if (proc) {
            proc.on('error', (err) => {
                this.emit('debug', `[MCLC]: Chyba při spuštění procesu Minecraftu: ${err.message}`);
                this.emit('close', 1);
            });
        }
        return proc;
    } catch (e) {
        this.emit('debug', `[MCLC]: Výjimka při volání startMinecraft: ${e.message}`);
        this.emit('close', 1);
        return null;
    }
};

/**
 * Intercept Handler.prototype.getNatives:
 * MCLC nativně parsuje verze přes version.id.split('.')[1], což selhává u nových verzí Minecraftu jako 26.2 a 26.3
 * (split('.')[1] je "2" nebo "3", takže MCLC chybně vyhodnotí verzi jako starý Minecraft 1.2 z roku 2012!).
 * Pro verze 26.x i 1.19+ vracíme kořenový adresář hry, protože LWJGL 3 načítá nativní DLL/SO dynamicky z classpath jarů.
 */
const origGetNatives = Handler.prototype.getNatives;
Handler.prototype.getNatives = async function () {
    const vId = String(this.version?.id || this.options?.version?.number || '');
    const firstPart = parseInt(vId.split('.')[0], 10);
    const secondPart = parseInt(vId.split('.')[1], 10);
    if (firstPart >= 26 || (firstPart === 1 && secondPart >= 19)) {
        return this.options.overrides.cwd || this.options.root;
    }
    return origGetNatives.call(this);
};

/**
 * Intercept Handler.prototype.getJar:
 * Zkontroluje, zda herní klient (<version>.jar) již existuje na disku v .minecraft nebo jiných instalacích.
 * Pokud ano, bleskově jej zkopíruje bez stahování 30–40 MB přes internet!
 */
function getFileSha1(filePath) {
    try {
        if (nativeLoader.isNativeActive()) {
            return nativeLoader.fastHashFileSha1(filePath);
        }
        const buffer = fs.readFileSync(filePath);
        return crypto.createHash('sha1').update(buffer).digest('hex');
    } catch (e) {
        return null;
    }
}

const verifiedJarsCache = new Map();
const dnsResolutionCache = new Map();

/**
 * ⚡ Asynchronní vyřešení domény serveru s 10minutovou paměťovou cache a 350ms limitem,
 * která zabraňuje zasekávání startu hry při pomalém nebo nedostupném DNS.
 */
async function isServerHostResolvable(hostOnly) {
    if (!hostOnly) return true;
    const lower = hostOnly.toLowerCase();
    const cached = dnsResolutionCache.get(lower);
    if (cached && (Date.now() - cached.timestamp < 10 * 60 * 1000)) {
        return cached.resolvable;
    }
    const dns = require('dns').promises;
    try {
        await Promise.race([
            dns.lookup(hostOnly),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), 350))
        ]);
        dnsResolutionCache.set(lower, { resolvable: true, timestamp: Date.now() });
        return true;
    } catch (_) {
        dnsResolutionCache.set(lower, { resolvable: false, timestamp: Date.now() });
        return false;
    }
}

Handler.prototype.getJar = async function () {
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
        let isUpToDate = false;
        try {
            const st = fs.statSync(targetJarPath);
            const cacheKey = `${st.size}:${Math.floor(st.mtimeMs)}:${expectedSha1 || 'any'}`;
            if (verifiedJarsCache.get(targetJarPath) === cacheKey) {
                // ⚡ Bleskový start z cache (0 ms zátěž namísto čtení a hešování 85 MB!)
                isUpToDate = true;
            } else {
                isUpToDate = isJarFileValid(targetJarPath);
                if (isUpToDate && expectedSha1) {
                    const actualSha1 = getFileSha1(targetJarPath);
                    if (actualSha1 && actualSha1 !== expectedSha1) {
                        const vanillaBackup = targetJarPath.replace(/\.jar$/, '.vanilla.jar');
                        const sigPath = `${targetJarPath}.skin_sig`;
                        const hasValidVanillaBackup = fs.existsSync(vanillaBackup) && isJarFileValid(vanillaBackup);
                        const hasSkinSig = fs.existsSync(sigPath);

                        if (hasSkinSig && hasValidVanillaBackup) {
                            const bakSha1 = getFileSha1(vanillaBackup);
                            if (bakSha1 && bakSha1 === expectedSha1) {
                                // Cílový JAR má aplikovaný náš RAW skin offline postavy a záloha přesně odpovídá Mojangu
                                this.client.emit('debug', `[POSTAVA]: Herní klient ${jarName} má aplikovaný RAW offline skin postavy.`);
                            } else {
                                isUpToDate = false;
                                this.client.emit('debug', `[AKTUALIZACE]: Záloha jádra ${path.basename(vanillaBackup)} neodpovídá oficiálnímu SHA-1. Stahuji čisté jádro...`);
                            }
                        } else {
                            isUpToDate = false;
                            this.client.emit('debug', `[AKTUALIZACE]: Lokální hash ${actualSha1} neodpovídá ${expectedSha1}. Stahuji aktualizovaný klient jar...`);
                        }
                    }
                }
                if (isUpToDate) {
                    verifiedJarsCache.set(targetJarPath, cacheKey);
                }
            }
        } catch (_) {
            isUpToDate = false;
        }

        if (isUpToDate) {
            try { fs.writeFileSync(targetJsonPath, JSON.stringify(this.version, null, 4)); } catch (e) { }
            this.client.emit('debug', `[OPTIMALIZACE]: Verze ${jarName} již existuje na disku a je platná.`);
            return;
        } else {
            this.client.emit('debug', `[OPRAVA]: Soubor ${jarName} je poškozený nebo neúplný. Mažu a stahuji znovu...`);
            try { fs.unlinkSync(targetJarPath); } catch (e) { }
            try { fs.unlinkSync(targetJarPath.replace(/\.jar$/, '.vanilla.jar')); } catch (e) { }
            try { fs.unlinkSync(`${targetJarPath}.skin_sig`); } catch (e) { }
            try { fs.unlinkSync(`${targetJarPath}.brand_sig`); } catch (e) { }
            try { fs.unlinkSync(`${targetJarPath}.vanilla_bak`); } catch (e) { }
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
                        try { fs.unlinkSync(targetJarPath); } catch (e) { }
                    }
                } catch (e) { }
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
            } catch (e) { }
        }

        if (clientUrl) {
            await this.downloadAsync(clientUrl, this.options.directory, jarName, 3, 'version-jar');
        } else {
            const baseJar = path.join(this.options.root, 'versions', this.options.version.number, `${this.options.version.number}.jar`);
            if (fs.existsSync(baseJar) && isJarFileValid(baseJar)) {
                fs.mkdirSync(this.options.directory, { recursive: true });
                try { fs.copyFileSync(baseJar, targetJarPath); } catch (e) { }
            }
        }

        // Pokud ani po stažení není platný a máme vanilla base jar
        if (!isJarFileValid(targetJarPath)) {
            const baseJar = path.join(this.options.root, 'versions', this.options.version.number, `${this.options.version.number}.jar`);
            if (fs.existsSync(baseJar) && isJarFileValid(baseJar)) {
                fs.mkdirSync(this.options.directory, { recursive: true });
                try { fs.copyFileSync(baseJar, targetJarPath); } catch (e) { }
            }
        }
    }

    // ⚡ Bezpečnostní kontrola integrity: Nikdy nedovolit start Minecraftu s chybějícím nebo poškozeným jádrem!
    if (!isJarFileValid(targetJarPath)) {
        this.client.emit('debug', `[CHYBA]: Herní klient ${jarName} nebyl úspěšně stažen nebo je poškozený!`);
        throw new Error(`Nepodařilo se stáhnout herní jádro ${jarName}. Zkontroluj připojení k internetu a zkus to znovu.`);
    }

    try { fs.writeFileSync(targetJsonPath, JSON.stringify(this.version, null, 4)); } catch (e) { }
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
        } catch (_) { }
    }

    try {
        let launcherVersion = '1.3.10';
        try {
            const { app } = require('electron');
            launcherVersion = (app && typeof app.getVersion === 'function') ? app.getVersion() : require('../../package.json').version;
        } catch (_) {
            try { launcherVersion = require('../../package.json').version; } catch (__) { }
        }
        const resolvedLoader = (this.options.version?.custom?.toLowerCase().includes('fabric') ? 'fabric'
            : (this.options.version?.custom?.toLowerCase().includes('neoforge') ? 'neoforge'
                : (this.options.version?.custom?.toLowerCase().includes('forge') ? 'forge'
                    : (this.options.config?.loader || 'vanilla').toLowerCase())));
        const customBrand = `smpclient/${launcherVersion}-${resolvedLoader}-${this.options.version?.number || '26.2'}`;

        injectSMPClientBrandIntoJars(
            this.options.root || BASE_DIR,
            this.options.version?.number,
            this.options.version,
            (msg) => this.client.emit('debug', msg),
            this.options.javaPath,
            customBrand
        );
    } catch (_) { }
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
    } catch (e) { }
    try {
        fs.mkdirSync(targetLibs, { recursive: true });
    } catch (e) { }
}

/**
 * Intercept Handler.prototype.downloadToDirectory:
 * Bleskové převzetí knihoven z existujících instalací na disku a garantované stažení
 * chybějících knihoven z Mojang Maven (včetně lwjgl-vulkan a novějších LWJGL 3.4.x).
 * Zabraňuje NoClassDefFoundError / ClassNotFoundException.
 */
Handler.prototype.downloadToDirectory = async function (directory, libraries, eventName) {
    const libs = [];
    if (!Array.isArray(libraries) || libraries.length === 0) return libs;

    const candidates = getExistingMinecraftBaseDirs();
    let counter = 0;

    // Připravit knihovny a cesty
    const parsedLibs = [];
    for (const library of libraries) {
        if (!library) continue;
        if (this.parseRule(library)) continue;
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
        let downloadUrl = null;
        if (library.downloads && library.downloads.artifact && library.downloads.artifact.url) {
            downloadUrl = library.downloads.artifact.url;
        } else if (library.url) {
            downloadUrl = `${library.url}${relPath}`;
        } else {
            downloadUrl = `https://libraries.minecraft.net/${relPath}`;
        }

        parsedLibs.push({
            library,
            relPath,
            name,
            jarPath,
            destFile,
            downloadUrl,
            sha1: library.downloads?.artifact?.sha1 || null,
            size: library.downloads?.artifact?.size || null
        });
    }

    // ⚡ 1. Rust Native High-Speed Batch Verification across all CPU cores
    if (nativeLoader.isNativeActive() && parsedLibs.length > 0) {
        const verifyItems = parsedLibs
            .filter(item => item.sha1)
            .map(item => ({
                path: item.destFile,
                expected_sha1: item.sha1,
                expected_size: item.size
            }));

        let invalidSet = new Set();
        if (verifyItems.length > 0) {
            try {
                const batchRes = nativeLoader.fastVerifyFileHashesBatch(verifyItems);
                if (batchRes && Array.isArray(batchRes.invalid_files)) {
                    invalidSet = new Set(batchRes.invalid_files);
                    this.client.emit('debug', `[RUST NATIVE]: ⚡ Paralelně ověřeno ${verifyItems.length} knihoven za ${batchRes.elapsed_ms.toFixed(1)} ms (${batchRes.valid} platných).`);
                }
            } catch (err) {
                invalidSet = new Set(verifyItems.map(i => i.path));
            }
        }

        const missingOrCorrupt = [];
        for (const item of parsedLibs) {
            if (item.sha1) {
                if (!invalidSet.has(item.destFile)) {
                    libs.push(item.destFile);
                    counter++;
                    continue;
                }
            } else {
                if (fs.existsSync(item.destFile) && isJarFileValid(item.destFile)) {
                    libs.push(item.destFile);
                    counter++;
                    continue;
                }
            }

            // Pokud neexistuje nebo je poškozená, zkusit převzít z kandidátů na disku
            let foundInCandidate = false;
            for (const cand of candidates) {
                const candLib = path.join(cand, 'libraries', item.relPath);
                if (fs.existsSync(candLib)) {
                    try {
                        const candValid = item.sha1
                            ? verifyFileSha1(candLib, item.sha1)
                            : (item.name.endsWith('.jar') ? isJarFileValid(candLib) : fs.statSync(candLib).size > 0);
                        if (candValid) {
                            fs.mkdirSync(item.jarPath, { recursive: true });
                            fs.copyFileSync(candLib, item.destFile);
                            libs.push(item.destFile);
                            counter++;
                            foundInCandidate = true;
                            break;
                        }
                    } catch (_) {}
                }
            }

            if (!foundInCandidate) {
                missingOrCorrupt.push(item);
            }
        }

        // ⚡ 2. Rust Native High-Speed Parallel Batch Download pro chybějící knihovny
        if (missingOrCorrupt.length > 0) {
            this.client.emit('debug', `[RUST NATIVE]: Paralelně stahuji ${missingOrCorrupt.length} chybějících knihoven...`);
            const batchDownloadItems = missingOrCorrupt.map(item => ({
                url: item.downloadUrl,
                dest_path: item.destFile
            }));

            try {
                const dlResult = await nativeLoader.fastDownloadBatch(batchDownloadItems);
                const successfulDls = new Set();
                if (dlResult && Array.isArray(dlResult.items)) {
                    for (const di of dlResult.items) {
                        if (di.success) successfulDls.add(di.dest_path);
                    }
                }

                for (const item of missingOrCorrupt) {
                    if (successfulDls.has(item.destFile)) {
                        libs.push(item.destFile);
                        counter++;
                    } else {
                        // Fallback na Mojang Maven pokud původní selhalo
                        let recovered = false;
                        if (!item.downloadUrl.includes('libraries.minecraft.net')) {
                            const mojangUrl = `https://libraries.minecraft.net/${item.relPath}`;
                            try {
                                await nativeLoader.fastDownloadFile(mojangUrl, item.destFile);
                                if (fs.existsSync(item.destFile) && (item.sha1 ? verifyFileSha1(item.destFile, item.sha1) : fs.statSync(item.destFile).size > 0)) {
                                    libs.push(item.destFile);
                                    counter++;
                                    recovered = true;
                                }
                            } catch (_) {}
                        }
                        if (!recovered) {
                            this.client.emit('debug', `[MCLC]: ⚠ Knihovna ${item.library.name} nebyla nalezena (${item.destFile})`);
                        }
                    }
                }
            } catch (dlErr) {
                this.client.emit('debug', `[RUST NATIVE] Batch download selhal: ${dlErr.message}`);
            }
        }

        this.client.emit('progress', {
            type: eventName,
            task: counter,
            total: libraries.length
        });

        return libs;
    }

    // ── JS Fallback Pool ────────────────────────────────────────────────────
    const concurrency = 20;
    let idx = 0;

    const processLibrary = async (library) => {
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

        let exists = false;
        try {
            if (fs.existsSync(destFile)) {
                const stat = fs.statSync(destFile);
                if (stat.size > 0) {
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
                        try { fs.unlinkSync(destFile); } catch (e) { }
                    }
                }
            }
        } catch (e) {
            exists = false;
        }

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
                    } catch (e) { }
                }
            }
        }

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
                await this.downloadAsync(downloadUrl, jarPath, name, 3, eventName);
                if (fs.existsSync(destFile)) {
                    if (library.downloads?.artifact?.sha1) {
                        exists = verifyFileSha1(destFile, library.downloads.artifact.sha1);
                    } else if (name.endsWith('.jar')) {
                        exists = isJarFileValid(destFile);
                    } else {
                        exists = fs.statSync(destFile).size > 0;
                    }
                    if (!exists) {
                        try { fs.unlinkSync(destFile); } catch (e) { }
                    }
                }
            } catch (err) {
                this.client.emit('debug', `[MCLC]: Knihovnu ${name} nelze stáhnout z ${downloadUrl}, zkouším Mojang Maven...`);
            }

            if (!exists && !downloadUrl.includes('libraries.minecraft.net')) {
                try {
                    await this.downloadAsync(`https://libraries.minecraft.net/${relPath}`, jarPath, name, 3, eventName);
                    if (fs.existsSync(destFile)) {
                        if (library.downloads?.artifact?.sha1) {
                            exists = verifyFileSha1(destFile, library.downloads.artifact.sha1);
                        } else if (name.endsWith('.jar')) {
                            exists = isJarFileValid(destFile);
                        } else {
                            exists = fs.statSync(destFile).size > 0;
                        }
                        if (!exists) {
                            try { fs.unlinkSync(destFile); } catch (e) { }
                        }
                    }
                } catch (e) { }
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
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (idx < libraries.length) {
            if (this.client && this.client._isCancelled) break;
            const library = libraries[idx++];
            await processLibrary(library);
        }
    });

    await Promise.all(workers);

    return libs;
};

/**
 * Intercept Handler.prototype.getClasses:
 * Zajišťuje, že veškeré knihovny z Vanilla manifestu (např. fastutil, log4j, netty, guava, brigadier)
 * i zavaděče (Fabric loader, asm, sponge-mixin) jsou VŽDY kompletně staženy a zahrnuty na classpath (-cp).
 * Zabraňuje NoClassDefFoundError: it/unimi/dsi/fastutil/... i chybějícímu Log4j provideru.
 */
Handler.prototype.getClasses = async function (classJson) {
    let libs = [];
    const libraryDirectory = path.resolve(this.options.overrides?.libraryRoot || path.join(this.options.root, 'libraries'));

    // 1. Zjistit cílovou verzi Minecraftu (např. 26.2)
    const targetVersion = this.options.version?.number || this.version?.inheritsFrom || '26.2';
    let vanillaJson = null;
    try {
        vanillaJson = await getOrFetchVanillaVersionJson(this.options.root, targetVersion);
    } catch (_) { }

    const combinedLibraries = [];
    const customArtifactKeys = new Set();

    // a) Custom mavenFiles (např. ForgeWrapper)
    if (classJson && Array.isArray(classJson.mavenFiles)) {
        await this.downloadToDirectory(libraryDirectory, classJson.mavenFiles, 'classes-maven-custom');
    }

    // b) Knihovny z custom JSON (Fabric / Forge / NeoForge)
    const customLibs = classJson?.libraries || this.version?.libraries || [];
    if (Array.isArray(customLibs)) {
        for (const lib of customLibs) {
            if (!lib || this.parseRule(lib)) continue;
            if (lib.name) {
                const parts = lib.name.split(':');
                if (parts[0] && parts[1]) {
                    const classifier = parts[3] || '';
                    customArtifactKeys.add(`${parts[0]}:${parts[1]}:${classifier}`);
                    if (!classifier) {
                        customArtifactKeys.add(`${parts[0]}:${parts[1]}`);
                    }
                }
            }
            combinedLibraries.push(lib);
        }
    }

    // c) Knihovny z Vanilla manifestu (fastutil, log4j, netty, guava, lwjgl...)
    // Doplníme vše z vanilkového manifestu, co loader nenahradil.
    // POZOR: Vanilkové knihovny se NESMÍ deduplikovat navzájem mezi sebou podle groupId:artifactId,
    // protože např. u LWJGL Mojang používá natives jar (org.lwjgl:lwjgl:3.4.1:natives-windows)
    // i kódový jar (org.lwjgl:lwjgl:3.4.1:unsafe) pod stejným artifactId lwjgl!
    const vanillaLibs = vanillaJson?.libraries || (this.version?.inheritsFrom ? null : this.version?.libraries) || [];
    if (Array.isArray(vanillaLibs)) {
        for (const lib of vanillaLibs) {
            if (!lib || this.parseRule(lib)) continue;

            if (lib.name) {
                const parts = lib.name.split(':');
                const baseKey = `${parts[0]}:${parts[1]}`;
                const classifier = parts[3] || '';
                const exactKey = `${parts[0]}:${parts[1]}:${classifier}`;

                // Pokud custom loader (Fabric/Forge) dodal vlastní přímou náhradu téže knihovny,
                // přeskočíme vanilkovou verzi. Nativní knihovny a specifické klasifikátory (např. unsafe u lwjgl)
                // však nikdy custom loader nenahrazuje.
                if (!classifier && customArtifactKeys.has(baseKey)) {
                    continue; // Custom knihovna bez klasifikátoru má přednost
                }
                if (classifier && customArtifactKeys.has(exactKey)) {
                    continue; // Custom knihovna s přesným klasifikátorem má přednost
                }
            }

            combinedLibraries.push(lib);
        }
    }

    // d) Stažení a zařazení všech knihoven do classpath
    libs = await this.downloadToDirectory(libraryDirectory, combinedLibraries, 'classes');

    this.client.emit('debug', `[MCLC]: Úspěšně shromážděno ${libs.length} herních knihoven do classpath.`);
    return libs;
};

function downloadFileWithHttps(targetUrl, destPath, timeoutMs = 15000) {
    if (nativeLoader.isNativeActive()) {
        return nativeLoader.fastDownloadFile(targetUrl, destPath)
            .then(() => true)
            .catch(() => downloadFileWithHttpsFallback(targetUrl, destPath, timeoutMs));
    }
    return downloadFileWithHttpsFallback(targetUrl, destPath, timeoutMs);
}

function downloadFileWithHttpsFallback(targetUrl, destPath, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const http = require('http');
        const client = targetUrl.startsWith('https') ? https : http;
        try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch (_) { }

        const req = client.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
            },
            timeout: timeoutMs
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFileWithHttpsFallback(res.headers.location, destPath, timeoutMs).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve(true);
            });
            fileStream.on('error', (err) => {
                try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) { }
                reject(err);
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error('ETIMEDOUT'));
        });
        req.on('error', (err) => {
            try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) { }
            reject(err);
        });
    });
}

/**
 * Intercept Handler.prototype.getAssets:
 * 1. Oseká 120+ nepotřebných cizích jazyků a stáhne z Mojangu POUZE CS, SK, EN_US a EN_GB (~50 MB úspora).
 * 2. Zkontroluje existující .minecraft na disku a chybějící soubory zkopíruje bleskově z disku namísto stahování.
 */
const verifiedAssetIndexes = new Set();

Handler.prototype.getAssets = async function () {
    if (this.client && this.client._isCancelled) {
        return Promise.reject(new Error('LAUNCH_CANCELLED'));
    }

    const assetDirectory = path.resolve(this.options.overrides.assetRoot || path.join(this.options.root, 'assets'));
    const indexName = (this.version && this.version.assetIndex && this.version.assetIndex.id)
        ? this.version.assetIndex.id
        : (this.options.version.number || '26.2');
    const assetId = this.options.version.custom || this.options.version.number;
    const versionNumber = this.options.version.number || '26.2';

    const indexesDir = path.join(assetDirectory, 'indexes');
    try { fs.mkdirSync(indexesDir, { recursive: true }); } catch (_) { }

    const indexFilePath = path.join(indexesDir, `${indexName}.json`);
    const customIndexFilePath = path.join(indexesDir, `${assetId}.json`);
    const versionIndexFilePath = path.join(indexesDir, `${versionNumber}.json`);

    const targetUrl = (this.version && this.version.assetIndex && this.version.assetIndex.url)
        ? this.version.assetIndex.url
        : null;

    // Pomocná funkce pro ověření neporušenosti JSON souboru assetů
    const isAssetIndexValid = (filePath) => {
        if (!filePath || !fs.existsSync(filePath)) return false;
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw || raw.length < 50) return false;
            const parsed = JSON.parse(raw);
            return Boolean(parsed && typeof parsed === 'object' && parsed.objects && typeof parsed.objects === 'object');
        } catch (_) {
            return false;
        }
    };

    // Pokud existuje poškozený / uříznutý soubor na disku, smažeme ho, aby nezpůsobil SyntaxError v MCLC
    if (fs.existsSync(indexFilePath) && !isAssetIndexValid(indexFilePath)) {
        try {
            fs.unlinkSync(indexFilePath);
            this.client.emit('debug', `[ASSETY] ⚠ Odstraněn poškozený soubor ${indexName}.json pro čisté znovustažení.`);
        } catch (_) { }
    }
    if (fs.existsSync(customIndexFilePath) && !isAssetIndexValid(customIndexFilePath)) {
        try {
            fs.unlinkSync(customIndexFilePath);
            this.client.emit('debug', `[ASSETY] ⚠ Odstraněn poškozený soubor ${assetId}.json pro čisté znovustažení.`);
        } catch (_) { }
    }
    if (fs.existsSync(versionIndexFilePath) && !isAssetIndexValid(versionIndexFilePath)) {
        try { fs.unlinkSync(versionIndexFilePath); } catch (_) { }
    }

    // ── KROK 1: Kontrola existujících lokálních indexů na disku ─────────────
    let sourceValidIndex = null;
    const localCandidates = [
        indexFilePath,
        customIndexFilePath,
        versionIndexFilePath,
        path.join(indexesDir, '32.json'),
        path.join(indexesDir, '26.2.json'),
        path.join(indexesDir, '26.3.json')
    ];
    for (const cPath of localCandidates) {
        if (isAssetIndexValid(cPath)) {
            sourceValidIndex = cPath;
            break;
        }
    }

    // ── KROK 2: Vestavěné asset indexy v launcheru (Offline bundle) ─────────
    if (!sourceValidIndex) {
        const bundledDirs = [
            path.join(__dirname, '..', '..', 'assets', 'indexes'),
            path.join(process.resourcesPath || '', 'assets', 'indexes'),
            path.join(process.resourcesPath || '', 'app', 'assets', 'indexes')
        ];
        try {
            const { app } = require('electron');
            if (app && typeof app.getAppPath === 'function') {
                bundledDirs.push(path.join(app.getAppPath(), 'assets', 'indexes'));
            }
        } catch (_) { }

        for (const bDir of bundledDirs) {
            const bCandidates = [
                path.join(bDir, `${indexName}.json`),
                path.join(bDir, `${versionNumber}.json`),
                path.join(bDir, '32.json'),
                path.join(bDir, '26.2.json'),
                path.join(bDir, '26.3.json')
            ];
            for (const bPath of bCandidates) {
                if (isAssetIndexValid(bPath)) {
                    sourceValidIndex = bPath;
                    this.client.emit('debug', `[ASSETY] Použit vestavěný asset index z bundle: ${bPath}`);
                    break;
                }
            }
            if (sourceValidIndex) break;
        }
    }

    // ── KROK 3: Prohledat existující instalace (.minecraft / PrismLauncher) ───
    if (!sourceValidIndex) {
        const extBases = getExistingMinecraftBaseDirs();
        for (const extBase of extBases) {
            const extIdxDir = path.join(extBase, 'assets', 'indexes');
            const extCandidates = [
                path.join(extIdxDir, `${indexName}.json`),
                path.join(extIdxDir, `${versionNumber}.json`),
                path.join(extIdxDir, '32.json'),
                path.join(extIdxDir, '26.2.json'),
                path.join(extIdxDir, `${assetId}.json`)
            ];
            for (const extPath of extCandidates) {
                if (isAssetIndexValid(extPath)) {
                    sourceValidIndex = extPath;
                    this.client.emit('debug', `[ASSETY] Převzat platný asset index z existující instalace: ${extPath}`);
                    break;
                }
            }
            if (sourceValidIndex) break;
        }
    }

    // Pokud jsme našli platný lokální index, naklonujeme jej do všech požadovaných cest
    if (sourceValidIndex) {
        try { if (!isAssetIndexValid(indexFilePath)) fs.copyFileSync(sourceValidIndex, indexFilePath); } catch (_) { }
        try { if (!isAssetIndexValid(customIndexFilePath)) fs.copyFileSync(sourceValidIndex, customIndexFilePath); } catch (_) { }
        try { if (!isAssetIndexValid(versionIndexFilePath)) fs.copyFileSync(sourceValidIndex, versionIndexFilePath); } catch (_) { }
    }

    // ── KROK 4: Robustní online stažení s multi-mirror zrcadly a HTTPS fallbackem ──
    if (!isAssetIndexValid(indexFilePath) && !isAssetIndexValid(customIndexFilePath) && !isAssetIndexValid(versionIndexFilePath)) {
        const downloadUrls = [];
        if (targetUrl) {
            downloadUrls.push(targetUrl);
            downloadUrls.push(targetUrl.replace('piston-meta.mojang.com', 'bmclapi2.bangbang93.com').replace('launchermeta.mojang.com', 'bmclapi2.bangbang93.com'));
            downloadUrls.push(targetUrl.replace('piston-meta.mojang.com', 'launchermeta.mojang.com'));
        }

        // Známé oficiální hashe pro Mojang asset indexy 32 (26.2) a 26.3
        if (indexName === '32' || versionNumber === '26.2') {
            const mojang32 = 'https://piston-meta.mojang.com/v1/packages/72b2ca7f98a3af7c84ac7c47a3292faea80280c5/32.json';
            const bmcl32 = 'https://bmclapi2.bangbang93.com/v1/packages/72b2ca7f98a3af7c84ac7c47a3292faea80280c5/32.json';
            if (!downloadUrls.includes(mojang32)) downloadUrls.push(mojang32);
            if (!downloadUrls.includes(bmcl32)) downloadUrls.push(bmcl32);
        }

        // Dotaz na oficiální a zrcadlený manifest verzí
        if (downloadUrls.length === 0) {
            const manifestApis = [
                'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
                'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
            ];
            for (const manApi of manifestApis) {
                try {
                    const manRes = await fetch(manApi, { signal: AbortSignal.timeout(10000) });
                    if (manRes.ok) {
                        const manifest = await manRes.json();
                        const verEntry = manifest.versions.find(v => v.id === indexName || v.id === versionNumber) ||
                            (versionNumber === '1.21.11' ? manifest.versions.find(v => v.id === '1.21.1') : null);
                        if (verEntry && verEntry.url) {
                            const vRes = await fetch(verEntry.url, { signal: AbortSignal.timeout(10000) });
                            if (vRes.ok) {
                                const vJson = await vRes.json();
                                if (vJson.assetIndex && vJson.assetIndex.url) {
                                    downloadUrls.push(vJson.assetIndex.url);
                                    downloadUrls.push(vJson.assetIndex.url.replace('piston-meta.mojang.com', 'bmclapi2.bangbang93.com'));
                                    break;
                                }
                            }
                        }
                    }
                } catch (_) { }
            }
        }

        for (const dlUrl of downloadUrls) {
            this.client.emit('debug', `[ASSETY] Pokus o stažení asset indexu z: ${dlUrl}`);
            await this.downloadAsync(dlUrl, indexesDir, `${indexName}.json`, 2, 'asset-json');
            if (isAssetIndexValid(indexFilePath)) break;

            // Nativní Node https fallback (obejde případný IPv6 / undici timeout na Windows)
            try {
                await downloadFileWithHttps(dlUrl, indexFilePath, 12000);
                if (isAssetIndexValid(indexFilePath)) {
                    this.client.emit('debug', `[ASSETY] ✓ Úspěšně staženo přes nativní HTTPS fallback z ${dlUrl}`);
                    break;
                }
            } catch (_) { }
        }

        if (isAssetIndexValid(indexFilePath)) {
            try { if (!isAssetIndexValid(customIndexFilePath)) fs.copyFileSync(indexFilePath, customIndexFilePath); } catch (_) { }
            try { if (!isAssetIndexValid(versionIndexFilePath)) fs.copyFileSync(indexFilePath, versionIndexFilePath); } catch (_) { }
            try {
                const p32 = path.join(indexesDir, '32.json');
                if (!isAssetIndexValid(p32)) fs.copyFileSync(indexFilePath, p32);
            } catch (_) { }
        }
    }

    const finalPath = isAssetIndexValid(indexFilePath)
        ? indexFilePath
        : (isAssetIndexValid(customIndexFilePath)
            ? customIndexFilePath
            : (isAssetIndexValid(versionIndexFilePath) ? versionIndexFilePath : null));

    if (!finalPath) {
        throw new Error(`Nepodařilo se stáhnout nebo ověřit integritu indexu assetů: ${indexName}.json`);
    }

    // Zajistíme zrcadlení platného indexu do všech variant (indexName, customId, versionNumber a 32.json)
    try { if (!isAssetIndexValid(indexFilePath)) fs.copyFileSync(finalPath, indexFilePath); } catch (_) { }
    try { if (!isAssetIndexValid(customIndexFilePath)) fs.copyFileSync(finalPath, customIndexFilePath); } catch (_) { }
    try { if (!isAssetIndexValid(versionIndexFilePath)) fs.copyFileSync(finalPath, versionIndexFilePath); } catch (_) { }
    try {
        const p32 = path.join(indexesDir, '32.json');
        if (!isAssetIndexValid(p32)) fs.copyFileSync(finalPath, p32);
    } catch (_) { }

    let index;
    try {
        index = JSON.parse(fs.readFileSync(finalPath, { encoding: 'utf8' }));
    } catch (parseErr) {
        try { if (fs.existsSync(indexFilePath)) fs.unlinkSync(indexFilePath); } catch (_) { }
        try { if (fs.existsSync(customIndexFilePath)) fs.unlinkSync(customIndexFilePath); } catch (_) { }
        throw new Error(`Poškozený soubor asset indexu (${indexName}.json): ${parseErr.message}`);
    }

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

    const assetIndexCacheKey = `${indexName}:${assetDirectory}:${downloadAudioDlc}`;
    if (verifiedAssetIndexes.has(assetIndexCacheKey)) {
        this.client.emit('debug', `[DELTA ASSETY]: Všech ${filteredAssetKeys.length} textur a zvuků ověřeno z relace (bleskový start).`);
        this.client.emit('progress', {
            type: 'assets',
            task: filteredAssetKeys.length,
            total: filteredAssetKeys.length
        });
        return;
    }

    // ── Inteligentní Delta Analýza Textur & Assetů ───────────────────────────
    // Zjistíme, které textury a assety už existují (z předchozích verzí 26.1/26.2 nebo .minecraft).
    // Pokud Mojang textury nezměnil, mají totožný SHA-1 hash a znovupoužijí se bez stahování!
    const missingAssetKeys = [];
    let reusedCount = 0;

    let nativeVerified = false;
    if (nativeLoader.isNativeActive()) {
        try {
            const verifyItems = filteredAssetKeys.map(k => {
                const h = index.objects[k].hash;
                const sub = h.substring(0, 2);
                return {
                    path: path.join(assetDirectory, 'objects', sub, h),
                    expected_sha1: h,
                    expected_size: index.objects[k].size
                };
            });
            const batchRes = nativeLoader.fastVerifyFileHashesBatch(verifyItems);
            if (batchRes && Array.isArray(batchRes.invalid_files)) {
                nativeVerified = true;
                const invalidSet = new Set(batchRes.invalid_files);
                for (const assetKey of filteredAssetKeys) {
                    const h = index.objects[assetKey].hash;
                    const sub = h.substring(0, 2);
                    const targetFilePath = path.join(assetDirectory, 'objects', sub, h);
                    if (invalidSet.has(targetFilePath)) {
                        missingAssetKeys.push(assetKey);
                    } else {
                        reusedCount++;
                    }
                }
                this.client.emit('debug', `[RUST NATIVE]: ⚡ Paralelně ověřeno ${verifyItems.length} assetů za ${batchRes.elapsed_ms.toFixed(1)} ms (${batchRes.valid} platných, ${batchRes.missing} chybí, ${batchRes.corrupted} poškozeno).`);
            }
        } catch (e) {
            nativeVerified = false;
        }
    }

    if (!nativeVerified) {
        for (const assetKey of filteredAssetKeys) {
            const hash = index.objects[assetKey].hash;
            const subhash = hash.substring(0, 2);
            const subAssetDir = path.join(assetDirectory, 'objects', subhash);
            const targetFilePath = path.join(subAssetDir, hash);

            if (fs.existsSync(targetFilePath)) {
                reusedCount++;
            } else {
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
                        } catch (e) { }
                    }
                }
                if (!copiedFromDisk) {
                    missingAssetKeys.push(assetKey);
                }
            }
        }
    }

    if (missingAssetKeys.length === 0) {
        verifiedAssetIndexes.add(assetIndexCacheKey);
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

    // 1. Rust Native High-Speed Parallel Batch Download
    if (nativeLoader.isNativeActive()) {
        const batchItems = missingAssetKeys.map(k => {
            const h = index.objects[k].hash;
            const sub = h.substring(0, 2);
            return {
                url: `${this.options.overrides.url.resource}/${sub}/${h}`,
                dest_path: path.join(assetDirectory, 'objects', sub, h)
            };
        });
        this.client.emit('debug', `[RUST NATIVE]: Spouštím nativní paralelní stahování ${batchItems.length} assetů Minecraftu...`);
        try {
            await nativeLoader.fastDownloadBatch(batchItems);
            verifiedAssetIndexes.add(assetIndexCacheKey);
            this.client.emit('progress', {
                type: 'assets',
                task: missingAssetKeys.length,
                total: missingAssetKeys.length
            });
            this.client.emit('debug', `[OPTIMALIZACE]: Bleskově staženo ${batchItems.length} assetů přes vícevláknový Rust engine.`);
            return;
        } catch (nativeErr) {
            this.client.emit('debug', `[RUST NATIVE] Chyba batch stahování, fallback na JS: ${nativeErr.message}`);
        }
    }

    // 2. JS Fallback worker pool
    // Paralelní zpracování po dávkách pro maximální rychlost přes HTTP/2 multiplexing
    const concurrency = 45;
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
    verifiedAssetIndexes.add(assetIndexCacheKey);
    this.client.emit('debug', `[OPTIMALIZACE]: Staženo ${counter} nových/změněných assetů, ${reusedCount} převzato z disku.`);
};


/**
 * Na Windows je javaw.exe GUI aplikací bez konzole, která do stdout/stderr neposílá žádný výstup.
 * Pro testování a spolehlivé zjištění verze přes '-version' převedeme javaw.exe na java.exe ve stejné složce.
 */
function resolveJavaConsoleBinary(binPath) {
    if (!binPath) return binPath;
    if (process.platform === 'win32') {
        const normalized = String(binPath).replace(/\//g, '\\');
        if (/javaw\.exe$/i.test(normalized)) {
            const javaConsole = normalized.replace(/javaw\.exe$/i, 'java.exe');
            if (fs.existsSync(javaConsole)) {
                return javaConsole;
            }
        }
    }
    return binPath;
}

/**
 * Extracts the major version of a Java runtime executable (e.g. 25, 21, 17, 8).
 */
function getJavaMajorVersion(binPath) {
    if (!binPath) return 0;
    const testBin = resolveJavaConsoleBinary(binPath);
    try {
        let out = '';
        try {
            out = execFileSync(testBin, ['-version'], { timeout: 3500, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (procErr) {
            out = (procErr.stderr || procErr.stdout || '').toString();
        }
        if (!out) {
            try {
                out = execSync(`"${testBin}" -version 2>&1`, { timeout: 3500, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
            } catch (_) { }
        }
        const match = out.match(/(?:version|Runtime Environment)\s+"?(\d+)(?:\.(\d+))?/i);
        if (match) {
            const v1 = parseInt(match[1], 10);
            if (v1 === 1 && match[2]) {
                return parseInt(match[2], 10);
            }
            return v1;
        }
    } catch (e) { }
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
    const testBin = resolveJavaConsoleBinary(binPath);
    try {
        let ok = false;
        try {
            execFileSync(testBin, ['-version'], { timeout: 3500, stdio: ['ignore', 'pipe', 'pipe'] });
            ok = true;
        } catch (procErr) {
            if ((procErr.stderr && procErr.stderr.length > 0) || procErr.status === 0) {
                ok = true;
            }
        }
        if (!ok) {
            try {
                execSync(`"${testBin}" -version`, { timeout: 3500, stdio: ['ignore', 'pipe', 'pipe'] });
                ok = true;
            } catch (_) { }
        }
        if (!ok) return false;

        if (minMajor > 0) {
            const major = getJavaMajorVersion(testBin);
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
        try { fs.rmSync(javaDir, { recursive: true, force: true }); } catch (e) { }
    }
    fs.mkdirSync(javaDir, { recursive: true });

    const tempExtract = path.join(runtimeBase, `extract_tmp_${targetVersion}`);
    if (fs.existsSync(tempExtract)) {
        try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch (e) { }
    }

    if (isWin) {
        if (nativeLoader.isNativeActive()) {
            nativeLoader.fastExtractArchive(archivePath, tempExtract);
        } else {
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(archivePath);
            zip.extractAllTo(tempExtract, true);
        }

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

    try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch (e) { }
    try { fs.unlinkSync(archivePath); } catch (e) { }

    const binName = isWin ? 'javaw.exe' : 'java';
    let finalJavaPath = path.join(javaDir, 'bin', binName);
    if (isWin && !fs.existsSync(finalJavaPath)) {
        finalJavaPath = path.join(javaDir, 'bin', 'java.exe');
    }

    if (!fs.existsSync(finalJavaPath)) {
        throw new Error(`Běhový soubor Java nebyl nalezen po rozbalení: ${finalJavaPath}`);
    }

    if (!isWin) {
        try { fs.chmodSync(finalJavaPath, 0o755); } catch (e) { }
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
// In-memory cache ověřených cest k Javě pro bleskový start (0 ms bez opakovaného execFileSync)
const cachedJavaExecutables = new Map();

async function ensureJavaExecutable(config, onLog = console.log, onProgress = null) {
    const targetVersion = (config && config.version) || '26.2';
    const requiredMajor = getRequiredJavaVersion(targetVersion);
    const cacheKey = `${requiredMajor}:${(config && config.javaPath) || 'auto'}`;

    if (cachedJavaExecutables.has(cacheKey)) {
        const cachedPath = cachedJavaExecutables.get(cacheKey);
        if (cachedPath && fs.existsSync(cachedPath)) {
            return cachedPath;
        }
    }

    // 1. Configured custom path
    if (config && config.javaPath) {
        const customMajor = getJavaMajorVersion(config.javaPath);
        if (customMajor >= requiredMajor && testJavaExecutable(config.javaPath, requiredMajor)) {
            cachedJavaExecutables.set(cacheKey, config.javaPath);
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
        cachedJavaExecutables.set(cacheKey, localBin);
        return localBin;
    }
    if (localBinAlt && fs.existsSync(localBinAlt) && testJavaExecutable(localBinAlt, requiredMajor)) {
        cachedJavaExecutables.set(cacheKey, localBinAlt);
        return localBinAlt;
    }

    // 3. System detected paths meeting required major version
    const detected = detectJavaPath(requiredMajor);
    if (detected && testJavaExecutable(detected, requiredMajor)) {
        cachedJavaExecutables.set(cacheKey, detected);
        return detected;
    }

    // 4. Fallback: Automatically download OpenJDK of required version (e.g. 25)
    onLog(`[JAVA] V systému nebyla nalezena kompatibilní Java ${requiredMajor}+ pro verzi ${targetVersion}. Stahuji vestavěný OpenJDK ${requiredMajor}...`);
    const installed = await downloadAndInstallJava(requiredMajor, onLog, onProgress);
    try {
        saveConfig({ javaPath: installed });
    } catch (e) { }
    if (installed) cachedJavaExecutables.set(cacheKey, installed);
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
        } catch (e) { }

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
                } catch (e) { }
            }
        }

        try {
            const out = execSync('where javaw', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) candidates.push(out);
        } catch (e) { }

        try {
            const out = execSync('where java', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) candidates.push(out);
        } catch (e) { }
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
                let verOut = '';
                try {
                    verOut = execFileSync(binPath, ['-version'], { encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] });
                } catch (procErr) {
                    verOut = (procErr.stderr || procErr.stdout || '').toString();
                }
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
                } catch (e) { }
            }
        }
        try {
            const out = execSync('where javaw', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (out) checkPath(out, 'Systémová Java (PATH)');
        } catch (e) { }
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
                    } catch (e) { }
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
            if (fs.existsSync(legacyZip)) { try { fs.unlinkSync(legacyZip); } catch (_) { } }
            if (fs.existsSync(legacyDir)) { try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch (_) { } }

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
        } catch (_) { }
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
        } catch (_) { }
    }
    const targetSig = `${skinHash}:${capeHash}`;

    if (fs.existsSync(sigPath)) {
        try {
            const currentSig = fs.readFileSync(sigPath, 'utf8').trim();
            if (currentSig === targetSig) {
                // Skin v tomto JARu je již identický - bleskový 0ms start
                return true;
            }
        } catch (_) { }
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

        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { }
        success = true;
    } catch (cliErr) {
        // Nativní 'zip' CLI není na Windows dostupné.
        // DŮLEŽITÉ: AdmZip.writeZip() NIKDY nesmí přepisovat 40MB herní jádro s desetitisíci třídami,
        // protože způsobuje fatální ZipException: ZipFile invalid LOC header (bad signature).
        // Jádro proto ponecháme v bezpečném, originálním stavu.
        onLog(`[POSTAVA] ℹ Nativní zip nástroj není dostupný, herní jádro ${path.basename(jarPath)} ponecháno v bezpečném originálním stavu.`);
    }

    if (success && isJarFileValid(jarPath)) {
        try { fs.writeFileSync(sigPath, targetSig, 'utf8'); } catch (_) { }
        onLog(`[POSTAVA] ✓ Textury skinu hráče RAW přepsány přímo v jádru hry (${path.basename(jarPath)}). Žádný texture pack ani mód není potřeba!`);
        return true;
    }
    // Pokud došlo k chybě integrity nebo soubor selhal ve validaci, okamžitě obnovíme nepoškozenou zálohu
    if (fs.existsSync(backupPath) && isJarFileValid(backupPath)) {
        try {
            fs.copyFileSync(backupPath, jarPath);
            try { if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath); } catch (_) { }
            onLog(`[POSTAVA] ⚠ Obnoven původní funkční soubor ${path.basename(jarPath)} ze zálohy.`);
        } catch (_) { }
    } else {
        if (fs.existsSync(backupPath)) {
            try { fs.unlinkSync(backupPath); } catch (_) { }
        }
        if (fs.existsSync(jarPath) && !isJarFileValid(jarPath)) {
            try { fs.unlinkSync(jarPath); } catch (_) { }
        }
        try { if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath); } catch (_) { }
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
                const brandSigPath = `${jarPath}.brand_sig`;

                // ⚡ Pojistka: Pokud záloha neprošla validací, okamžitě ji smažeme, aby nešířila poškození
                if (fs.existsSync(backupPath) && !isJarFileValid(backupPath)) {
                    try { fs.unlinkSync(backupPath); } catch (_) { }
                    onLog(`[POSTAVA] 🧹 Odstraněna poškozená záloha jádra: ${path.basename(backupPath)}`);
                }

                if (fs.existsSync(backupPath) && isJarFileValid(backupPath)) {
                    if (!fs.existsSync(jarPath) || !isJarFileValid(jarPath) || fs.existsSync(sigPath)) {
                        try {
                            fs.copyFileSync(backupPath, jarPath);
                            try { if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath); } catch (_) { }
                            try { if (fs.existsSync(brandSigPath)) fs.unlinkSync(brandSigPath); } catch (_) { }
                            onLog(`[POSTAVA] 🔄 Obnoveno výchozí vanilla jádro bez úprav: ${d}.jar`);
                        } catch (_) { }
                    }
                } else if (fs.existsSync(jarPath) && !isJarFileValid(jarPath)) {
                    try {
                        fs.unlinkSync(jarPath);
                        try { if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath); } catch (_) { }
                        try { if (fs.existsSync(brandSigPath)) fs.unlinkSync(brandSigPath); } catch (_) { }
                        onLog(`[POSTAVA] 🧹 Odstraněno poškozené herní jádro pro automatické znovustažení: ${d}.jar`);
                    } catch (_) { }
                }
            }
        }
    } catch (_) { }
}

/**
 * 🏷️ Značka klienta SMPClient:
 * Base64 bytecode třídy net/minecraft/client/ClientBrandRetriever kompatibilní s Java 8 až Java 25+.
 * Vrací hodnotu systémové vlastnosti -Dsmpclient.brand, případně výchozí "smpclient".
 */
const SMPCLIENT_BRAND_RETRIEVER_CLASS_BASE64 = 'yv66vgAAADQAJQoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWCAAIAQAPc21wY2xpZW50LmJyYW5kCgAKAAsHAAwMAA0ADgEAEGphdmEvbGFuZy9TeXN0ZW0BAAtnZXRQcm9wZXJ0eQEAJihMamF2YS9sYW5nL1N0cmluZzspTGphdmEvbGFuZy9TdHJpbmc7CgAQABEHABIMABMAFAEAEGphdmEvbGFuZy9TdHJpbmcBAAdpc0VtcHR5AQADKClaCAAWAQAJc21wY2xpZW50BwAYAQApbmV0L21pbmVjcmFmdC9jbGllbnQvQ2xpZW50QnJhbmRSZXRyaWV2ZXIBAAxWQU5JTExBX05BTUUBABJMamF2YS9sYW5nL1N0cmluZzsBAA1Db25zdGFudFZhbHVlCAAdAQAHdmFuaWxsYQEABENvZGUBAA9MaW5lTnVtYmVyVGFibGUBABBnZXRDbGllbnRNb2ROYW1lAQAUKClMamF2YS9sYW5nL1N0cmluZzsBAA1TdGFja01hcFRhYmxlAQAKU291cmNlRmlsZQEAGUNsaWVudEJyYW5kUmV0cmlldmVyLmphdmEAIQAXAAIAAAABABkAGQAaAAEAGwAAAAIAHAACAAEABQAGAAEAHgAAAB0AAQABAAAABSq3AAGxAAAAAQAfAAAABgABAAAAAwAJACAAIQABAB4AAABIAAEAAQAAABYSB7gACUsqxgAMKrYAD5oABSqwEhWwAAAAAgAfAAAAEgAEAAAABwAGAAgAEQAJABMACwAiAAAACAAB/AATBwAQAAEAIwAAAAIAJA==';

/**
 * 🏷️ Zajišťuje existenci samostatného JARu obsahujícího ClientBrandRetriever
 * pro připojení přes -Xbootclasspath/a:, což garantuje načtení SMPClient brandu na úrovni JVM.
 */
function ensureSMPClientBrandJar(baseDir) {
    try {
        const brandJarDir = path.join(baseDir, 'libraries', 'smpclient', 'brand');
        const brandJarPath = path.join(brandJarDir, 'smpclient-brand.jar');
        if (fs.existsSync(brandJarPath) && fs.statSync(brandJarPath).size > 100) {
            return brandJarPath;
        }
        fs.mkdirSync(brandJarDir, { recursive: true });
        const AdmZip = require('adm-zip');
        const zip = new AdmZip();
        zip.addFile('net/minecraft/client/ClientBrandRetriever.class', Buffer.from(SMPCLIENT_BRAND_RETRIEVER_CLASS_BASE64, 'base64'));
        zip.writeZip(brandJarPath);
        return brandJarPath;
    } catch (e) {
        return null;
    }
}

/**
 * Vyhledá oficiální nástroj `jar` (OpenJDK) v runtime adresářích, PATH nebo JAVA_HOME.
 */
function findJarCli(javaPath, baseDir) {
    const jarName = process.platform === 'win32' ? 'jar.exe' : 'jar';
    const candidates = [];
    if (javaPath) {
        candidates.push(path.join(path.dirname(javaPath), jarName));
    }
    if (process.env.JAVA_HOME) {
        candidates.push(path.join(process.env.JAVA_HOME, 'bin', jarName));
    }
    if (baseDir) {
        candidates.push(path.join(baseDir, 'runtime', 'java-25', 'bin', jarName));
        candidates.push(path.join(baseDir, 'runtime', 'java-21', 'bin', jarName));
        try {
            const rtDir = path.join(baseDir, 'runtime');
            if (fs.existsSync(rtDir)) {
                for (const sub of fs.readdirSync(rtDir)) {
                    candidates.push(path.join(rtDir, sub, 'bin', jarName));
                }
            }
        } catch (_) { }
    }
    if (process.platform !== 'win32') {
        candidates.push(
            '/usr/lib/jvm/java-25-openjdk-amd64/bin/jar',
            '/usr/lib/jvm/java-25-openjdk/bin/jar',
            '/usr/lib/jvm/openjdk-25/bin/jar',
            '/usr/lib/jvm/java-21-openjdk-amd64/bin/jar',
            '/usr/lib/jvm/java-21-openjdk/bin/jar',
            '/usr/lib/jvm/default-runtime/bin/jar',
            '/usr/bin/jar'
        );
    }
    for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) return cand;
    }
    try {
        const { execSync } = require('child_process');
        execSync(process.platform === 'win32' ? 'where jar' : 'which jar', { stdio: 'ignore' });
        return 'jar';
    } catch (_) { }
    return null;
}

/**
 * 🏷️ Zapisuje třídu net/minecraft/client/ClientBrandRetriever do herních JARů
 * (Vanilla, Fabric, Forge, NeoForge), aby klient při připojení na server vždy posílal identifikaci SMPClient
 * ve formátu: smpclient/<verze-launcheru>-<loader>-<verze-hry>
 * (např. smpclient/1.3.10-fabric-26.2 nebo smpclient/1.3.10-vanilla-26.2).
 * Používá oficiální nástroj OpenJDK `jar` (případně bezpečný `zip -u`), NIKDY nemaže soubory (-d),
 * což garantuje 100% zachování integrity ZIP/CEN hlaviček a zamezuje pádu ZipException.
 */
function injectSMPClientBrandIntoJars(baseDir, targetVersion = null, versionOpts = null, onLog = console.log, javaPath = null, customBrand = null) {
    // 1. Zajištění -Xbootclasspath JARu
    ensureSMPClientBrandJar(baseDir);

    const targetVer = targetVersion || '26.2';
    const classBuf = Buffer.from(SMPCLIENT_BRAND_RETRIEVER_CLASS_BASE64, 'base64');

    let launcherVersion = '1.3.10';
    try {
        const { app } = require('electron');
        launcherVersion = (app && typeof app.getVersion === 'function') ? app.getVersion() : require('../../package.json').version;
    } catch (_) {
        try { launcherVersion = require('../../package.json').version; } catch (__) { }
    }

    const resolvedLoader = (versionOpts?.custom?.toLowerCase().includes('fabric') ? 'fabric'
        : (versionOpts?.custom?.toLowerCase().includes('neoforge') ? 'neoforge'
            : (versionOpts?.custom?.toLowerCase().includes('forge') ? 'forge'
                : 'vanilla')));

    const effectiveBrand = customBrand || `smpclient/${launcherVersion}-${resolvedLoader}-${targetVer}`;
    const brandSig = `smpclient_brand_v3_${effectiveBrand.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    // U Fabric profilů se brand předává bezpečně a dynamicky přes -Xbootclasspath/a a -Dsmpclient.brand.
    // NIKDY neupravujeme fyzické JAR soubory, protože to poškozuje TinyRemapper při deobfuskování a způsobuje ZipException.
    if (resolvedLoader === 'fabric') {
        return;
    }

    const jarsToPatch = new Set();
    const vanillaJar = path.join(baseDir, 'versions', targetVer, `${targetVer}.jar`);
    if (fs.existsSync(vanillaJar)) jarsToPatch.add(vanillaJar);

    if (versionOpts?.custom) {
        const customJar = path.join(baseDir, 'versions', versionOpts.custom, `${versionOpts.custom}.jar`);
        if (fs.existsSync(customJar)) jarsToPatch.add(customJar);
    }

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
        } catch (_) { }
    }

    if (jarsToPatch.size === 0) return;

    // Detekce oficiálního OpenJDK jar nástroje
    const jarCli = findJarCli(javaPath, baseDir);

    const os = require('os');
    const { execFileSync } = require('child_process');

    for (const jarPath of jarsToPatch) {
        if (!fs.existsSync(jarPath) || !isJarFileValid(jarPath)) continue;

        // NIKDY neupravujeme fabric-loader-*.jar soubor, protože to poškozuje TinyRemapper při deobfuskování!
        if (path.basename(jarPath).startsWith('fabric-loader-')) {
            continue;
        }

        const backupPath = jarPath.replace(/\.jar$/, '.vanilla.jar');
        const sigPath = `${jarPath}.brand_sig`;

        // Odstranění případné poškozené zálohy
        if (fs.existsSync(backupPath) && !isJarFileValid(backupPath)) {
            try { fs.unlinkSync(backupPath); } catch (_) { }
        }

        // Čistá vanilla záloha před zápisem (pouze pokud je původní soubor platný)
        if (!fs.existsSync(backupPath) && isJarFileValid(jarPath)) {
            try { fs.copyFileSync(jarPath, backupPath); } catch (_) { }
        }

        // Cache kontrola podpisu (0ms zátěž pokud již bylo aplikováno)
        if (fs.existsSync(sigPath)) {
            try {
                if (fs.readFileSync(sigPath, 'utf8').trim() === brandSig) {
                    continue;
                }
            } catch (_) { }
        }

        let success = false;
        const tmpDir = path.join(os.tmpdir(), `smpclient_brand_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
        const tempJar = path.join(tmpDir, 'patched.jar');
        try {
            const classDest = path.join(tmpDir, 'net/minecraft/client/ClientBrandRetriever.class');
            fs.mkdirSync(path.dirname(classDest), { recursive: true });
            fs.writeFileSync(classDest, classBuf);

            // Vždy modifikujeme nejprve dočasnou kopii, abychom NIKDY nepoškodili originální JAR na disku
            fs.copyFileSync(jarPath, tempJar);

            if (jarCli) {
                // Metoda 1: Oficiální OpenJDK jar CLI na dočasném souboru
                execFileSync(jarCli, ['uf', tempJar, 'net/minecraft/client/ClientBrandRetriever.class'], { cwd: tmpDir, stdio: 'ignore' });
            } else {
                // Metoda 2: Fallback na zip CLI bez mazání (-u pouze)
                try {
                    execFileSync('zip', ['-u', tempJar, 'net/minecraft/client/ClientBrandRetriever.class'], { cwd: tmpDir, stdio: 'ignore' });
                } catch (_) {
                    // DŮLEŽITÉ: AdmZip NIKDY nesmí zapisovat do 40MB herního jádra (způsobuje Invalid LOC header corruption).
                    // Brand je již 100% spolehlivě injektován přes JVM argument -Xbootclasspath/a:smpclient-brand.jar.
                    onLog(`[KLIENT] ℹ Nativní jar/zip CLI není dostupné, herní jádro ${path.basename(jarPath)} ponecháno v originálním stavu (brand zajištěn přes -Xbootclasspath).`);
                }
            }

            // Striktní ověření integrity dočasného souboru před nahrazením originálu
            if (isJarFileValid(tempJar)) {
                fs.copyFileSync(tempJar, jarPath);
                success = true;
            } else {
                onLog(`[KLIENT] ⚠ Dočasný soubor po zápisu brandu neprošel ověřením integrity. Ponechávám původní JAR.`);
            }
        } catch (patchErr) {
            onLog(`[KLIENT] ⚠ Zápis brandu do ${path.basename(jarPath)} selhal: ${patchErr.message}`);
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { }
        }

        // Striktní ověření integrity po zápisu
        if (success && isJarFileValid(jarPath)) {
            try { fs.writeFileSync(sigPath, brandSig, 'utf8'); } catch (_) { }
            onLog(`[KLIENT] ✓ Brand ${effectiveBrand} úspěšně zapsán do jádra hry (${path.basename(jarPath)})`);
        } else if (fs.existsSync(backupPath) && isJarFileValid(backupPath)) {
            try { fs.copyFileSync(backupPath, jarPath); } catch (_) { }
            onLog(`[KLIENT] ⚠ Obnoveno původní jádro ${path.basename(jarPath)} ze zálohy.`);
        } else if (!isJarFileValid(jarPath)) {
            try { fs.unlinkSync(jarPath); } catch (_) { }
            try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (_) { }
            try { if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath); } catch (_) { }
            onLog(`[KLIENT] ⚠ Detekován neopravitelně poškozený soubor ${path.basename(jarPath)}. Odstraněn pro čisté stažení.`);
        }
    }
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
            } catch (_) { }
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
        // Aplikujeme POUZE do základního vanilla JARu (např. 26.2.jar).
        // Nikdy nesaháme do Fabric/Forge profilů, protože mod loadery ověřují integritu své třídy a spouštěče.
        const vanillaJar = path.join(baseDir, 'versions', targetVer, `${targetVer}.jar`);
        if (fs.existsSync(vanillaJar)) {
            injectRawSkinIntoJar(vanillaJar, activeSkin, activeCape, onLog);
        }
    } catch (err) {
        onLog(`[POSTAVA] ⚠ Chyba při RAW aplikaci skinu/pláště: ${err.message}`);
    }
}

// In-memory TTL cache pro Mojang version manifest (aby se neblokoval start sítě při každém spuštění)
const mojangVersionCheckCache = new Map(); // targetVersion -> timestamp
const MOJANG_CHECK_TTL_MS = 2 * 60 * 60 * 1000; // 2 hodiny TTL cache

/**
 * ⚡ Kontrola a aktualizace verze proti oficiálnímu Mojang manifestu (piston-meta).
 * Využívá bleskovou TTL cache (0 ms pokud soubory existují a byly v posledních 2 hodinách ověřeny).
 */
async function ensureMojangVersionUpToDate(centralRootDir, targetVersion, onLog = console.log, forceCheck = false) {
    if (!targetVersion || targetVersion === 'custom') return null;

    const versionsDir = path.join(centralRootDir, 'versions');
    const localVersionDir = path.join(versionsDir, targetVersion);
    const localJsonPath = path.join(localVersionDir, `${targetVersion}.json`);
    const localJarPath = path.join(localVersionDir, `${targetVersion}.jar`);

    // Blesková kontrola existence na disku: Pokud lokální manifest i JAR již na disku existují
    // a nejedná se o vynucený pre-warm (forceCheck), vrátit lokální manifest okamžitě (0 ms).
    // Síťová kontrola aktualizací z Mojangu se provádí na pozadí při startu launcheru přes pre-warm.
    if (!forceCheck && fs.existsSync(localJsonPath) && fs.existsSync(localJarPath)) {
        mojangVersionCheckCache.set(targetVersion, Date.now());
        try {
            return JSON.parse(fs.readFileSync(localJsonPath, 'utf8'));
        } catch (_) { }
    }

    try {
        const manRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
            signal: AbortSignal.timeout(3000)
        });
        if (!manRes.ok) {
            mojangVersionCheckCache.set(targetVersion, Date.now());
            return null;
        }

        const manifest = await manRes.json();
        const vEntry = manifest.versions?.find(v => v.id === targetVersion) ||
            (targetVersion === '1.21.11' ? manifest.versions?.find(v => v.id === '1.21.1') : null);
        if (!vEntry || !vEntry.url) {
            mojangVersionCheckCache.set(targetVersion, Date.now());
            return null;
        }

        // Pokud lokální JSON manifest zatím neexistuje, stáhnout čerstvý v originálním formátu
        if (!fs.existsSync(localJsonPath)) {
            const vRes = await fetch(vEntry.url, { signal: AbortSignal.timeout(6000) });
            if (vRes.ok) {
                const rawText = await vRes.text();
                fs.mkdirSync(localVersionDir, { recursive: true });
                fs.writeFileSync(localJsonPath, rawText, 'utf8');
                mojangVersionCheckCache.set(targetVersion, Date.now());
                try { return JSON.parse(rawText); } catch (_) { }
            }
            return null;
        }

        // Lokální JSON existuje – ověříme integritu a revizi vůči Mojangu
        let localObj = null;
        try {
            localObj = JSON.parse(fs.readFileSync(localJsonPath, 'utf8'));
        } catch (_) { }

        const localSha1 = getFileSha1(localJsonPath);
        const mojangSha1 = vEntry.sha1 ? vEntry.sha1.toLowerCase() : null;
        const isSha1Match = Boolean(mojangSha1 && localSha1 && localSha1.toLowerCase() === mojangSha1);
        const isTimeMatch = Boolean(localObj && localObj.time && vEntry.time && localObj.time === vEntry.time);

        // Pokud je manifest na disku aktuální (odpovídá SHA-1 hash nebo časové razítko revize z manifestu), pokračujeme
        if (isSha1Match || isTimeMatch) {
            mojangVersionCheckCache.set(targetVersion, Date.now());
            return localObj;
        }

        onLog(`[MOJANG] ⚡ Zjištěna nová oficiální aktualizace/patch pro Minecraft ${targetVersion} (${vEntry.time})! Aktualizuji herní soubory...`);

        const vRes = await fetch(vEntry.url, { signal: AbortSignal.timeout(8000) });
        if (vRes.ok) {
            const rawText = await vRes.text();
            const freshJson = JSON.parse(rawText);
            const newClientSha1 = freshJson.downloads?.client?.sha1 ? freshJson.downloads.client.sha1.toLowerCase() : null;
            const oldClientSha1 = localObj?.downloads?.client?.sha1 ? localObj.downloads.client.sha1.toLowerCase() : null;

            // Uložit surový čerstvý manifest (přesný byte-to-byte hash)
            fs.writeFileSync(localJsonPath, rawText, 'utf8');

            // Pokud se změnil hash herního klienta (client.jar), odstranit starý jar a zálohy pro čisté stažení nového patche
            if (newClientSha1 && newClientSha1 !== oldClientSha1) {
                onLog(`[MOJANG] 🔄 Detekován aktualizovaný herní klient pro ${targetVersion} (nový SHA-1: ${newClientSha1.slice(0, 8)}...). Převezmu nový JAR od Mojangu...`);
                try { fs.unlinkSync(localJarPath); } catch (_) { }
                try { fs.unlinkSync(localJarPath.replace(/\.jar$/, '.vanilla.jar')); } catch (_) { }
                try { fs.unlinkSync(`${localJarPath}.skin_sig`); } catch (_) { }
                try { fs.unlinkSync(`${localJarPath}.brand_sig`); } catch (_) { }
                try { fs.unlinkSync(`${localJarPath}.vanilla_bak`); } catch (_) { }
            }

            // Pokud existoval custom Fabric profil dědící z této verze, vymazat sloučený JSON, aby se přegeneroval
            try {
                const files = fs.readdirSync(versionsDir);
                for (const f of files) {
                    if (f.toLowerCase().includes('fabric') && f.includes(targetVersion)) {
                        const fJson = path.join(versionsDir, f, `${f}.json`);
                        if (fs.existsSync(fJson)) {
                            try { fs.unlinkSync(fJson); } catch (_) { }
                        }
                    }
                }
            } catch (_) { }

            mojangVersionCheckCache.set(targetVersion, Date.now());
            return freshJson;
        }
    } catch (err) {
        // Při výpadku sítě nebo offline režimu tiše pokračujeme s existujícími soubory
        mojangVersionCheckCache.set(targetVersion, Date.now());
    }
    return null;
}

/**
 * Pomocná funkce pro získání kompletního Vanilla JSON manifestu pro cílovou verzi.
 */
async function getOrFetchVanillaVersionJson(centralRootDir, targetVersion) {
    const versionsDir = path.join(centralRootDir, 'versions');
    const localJson = path.join(versionsDir, targetVersion, `${targetVersion}.json`);
    if (fs.existsSync(localJson)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(localJson, 'utf8'));
            if (parsed && Array.isArray(parsed.libraries) && parsed.libraries.length > 20) {
                return parsed;
            }
        } catch (e) { }
    }

    const candidates = getExistingMinecraftBaseDirs();
    for (const cand of candidates) {
        const candJson = path.join(cand, 'versions', targetVersion, `${targetVersion}.json`);
        if (fs.existsSync(candJson)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(candJson, 'utf8'));
                if (parsed && Array.isArray(parsed.libraries) && parsed.libraries.length > 20) {
                    fs.mkdirSync(path.join(versionsDir, targetVersion), { recursive: true });
                    fs.copyFileSync(candJson, localJson);
                    return parsed;
                }
            } catch (e) { }
        }
    }

    try {
        const manUrls = [
            'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
            'https://launchermeta.mojang.com/mc/game/version_manifest.json'
        ];
        for (const manUrl of manUrls) {
            try {
                const manRes = await fetch(manUrl, { signal: AbortSignal.timeout(12000) });
                if (manRes.ok) {
                    const manifest = await manRes.json();
                    let entry = manifest.versions.find(v => v.id === targetVersion);
                    if (!entry && targetVersion === '1.21.11') {
                        entry = manifest.versions.find(v => v.id === '1.21.1') || manifest.versions.find(v => v.id === '1.21');
                    }
                    if (entry && entry.url) {
                        const vRes = await fetch(entry.url, { signal: AbortSignal.timeout(15000) });
                        if (vRes.ok) {
                            const vJson = await vRes.json();
                            if (vJson && Array.isArray(vJson.libraries) && vJson.libraries.length > 20) {
                                fs.mkdirSync(path.join(versionsDir, targetVersion), { recursive: true });
                                fs.writeFileSync(localJson, JSON.stringify(vJson, null, 2), 'utf8');
                                return vJson;
                            }
                        }
                    }
                }
            } catch (_) { }
        }
    } catch (e) { }
    return null;
}

/**
 * ⚡ Zajištění existence Fabric loader profilu pro zadanou verzi Minecraftu.
 * Sloučí oficiální Fabric meta JSON s Vanilla JSON manifestem (včetně client downloadu a všech knihoven).
 */
async function ensureFabricProfile(centralRootDir, targetVersion, onLog = console.log) {
    const versionsDir = path.join(centralRootDir, 'versions');
    fs.mkdirSync(versionsDir, { recursive: true });

    // ⚡ Bezpečnostní úklid: Odstranění nestabilních/experimentálních verzí Fabric Loaderu (např. 0.20.0-unstable)
    try {
        const brokenDirs = fs.readdirSync(versionsDir).filter(d =>
            d.toLowerCase().includes('0.20.0') || d.toLowerCase().startsWith('fabric-loader-0.20.0')
        );
        for (const bDir of brokenDirs) {
            onLog(`[FABRIC] ⚠ Nalezen nestabilní profil ${bDir}. Odstraňuji pro vynucení stabilního vydání...`);
            try { fs.rmSync(path.join(versionsDir, bDir), { recursive: true, force: true }); } catch (_) { }
        }
    } catch (_) { }

    try {
        const brokenLib = path.join(centralRootDir, 'libraries', 'net', 'fabricmc', 'fabric-loader', '0.20.0');
        if (fs.existsSync(brokenLib)) {
            try { fs.rmSync(brokenLib, { recursive: true, force: true }); } catch (_) { }
        }
    } catch (_) { }

    try {
        const existing = fs.readdirSync(versionsDir).find(d =>
            d.toLowerCase().startsWith('fabric-loader-') &&
            !d.includes('0.20.0') &&
            d.includes(targetVersion) &&
            fs.existsSync(path.join(versionsDir, d, `${d}.json`))
        );
        if (existing) {
            const exJsonPath = path.join(versionsDir, existing, `${existing}.json`);
            try {
                const exJson = JSON.parse(fs.readFileSync(exJsonPath, 'utf8'));
                if (exJson.downloads && exJson.assetIndex && exJson.libraries && exJson.libraries.length > 20) {
                    // Ověřit, že samotný fabric-loader JAR v libraries existuje a má platnou hlavičku
                    const loaderLib = exJson.libraries.find(l => l.name && l.name.startsWith('net.fabricmc:fabric-loader:'));
                    let loaderJarValid = true;
                    if (loaderLib) {
                        const libParts = loaderLib.name.split(':');
                        const lVer = libParts[2];
                        const lPath = path.join(centralRootDir, 'libraries', 'net', 'fabricmc', 'fabric-loader', lVer, `fabric-loader-${lVer}.jar`);
                        if (!fs.existsSync(lPath) || !isJarFileValid(lPath)) {
                            loaderJarValid = false;
                        }
                    }

                    // ⚡ Ověřit také, že existující JAR soubory (vanilla i fabric) nejsou poškozené
                    const vJar = path.join(versionsDir, targetVersion, `${targetVersion}.jar`);
                    const fJar = path.join(versionsDir, existing, `${existing}.jar`);
                    if (fs.existsSync(vJar) && !isJarFileValid(vJar)) {
                        onLog(`[FABRIC] ⚠ Nalezen poškozený ${targetVersion}.jar. Mažu pro čisté znovustažení...`);
                        try { fs.unlinkSync(vJar); } catch (_) { }
                        try { fs.unlinkSync(`${vJar}.skin_sig`); } catch (_) { }
                        try { fs.unlinkSync(`${vJar}.brand_sig`); } catch (_) { }
                        loaderJarValid = false;
                    }
                    if (fs.existsSync(fJar) && !isJarFileValid(fJar)) {
                        onLog(`[FABRIC] ⚠ Nalezen poškozený ${existing}.jar. Mažu pro čistou obnovu...`);
                        try { fs.unlinkSync(fJar); } catch (_) { }
                        try { fs.unlinkSync(`${fJar}.skin_sig`); } catch (_) { }
                        try { fs.unlinkSync(`${fJar}.brand_sig`); } catch (_) { }
                        loaderJarValid = false;
                    }

                    if (loaderJarValid) {
                        onLog(`[FABRIC] Nalezen kompletní Fabric profil: ${existing}`);
                        return existing;
                    }
                }
            } catch (e) { }
        }
    } catch (e) { }

    onLog(`[FABRIC] Zjišťuji nejnovější Fabric loader pro Minecraft ${targetVersion}...`);
    try {
        let loaders = [];
        let effectiveGameVersion = targetVersion;
        const metaRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${targetVersion}`, {
            headers: { 'User-Agent': 'MYCHALSMP-Launcher' },
            signal: AbortSignal.timeout(10000)
        });
        if (metaRes.ok) {
            loaders = await metaRes.json();
        }
        if ((!Array.isArray(loaders) || loaders.length === 0) && targetVersion === '1.21.11') {
            const fallbackRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/1.21.1`, {
                headers: { 'User-Agent': 'MYCHALSMP-Launcher' },
                signal: AbortSignal.timeout(10000)
            });
            if (fallbackRes.ok) {
                const fbLoaders = await fallbackRes.json();
                if (Array.isArray(fbLoaders) && fbLoaders.length > 0) {
                    loaders = fbLoaders;
                    effectiveGameVersion = '1.21.1';
                }
            }
        }
        if (!Array.isArray(loaders) || loaders.length === 0) {
            throw new Error(`Žádný Fabric loader nenalezen pro verzi ${targetVersion}`);
        }
        // ⚡ Zásadní: Výběr nejnovější STABILNÍ verze (stable: true), nikoliv experimentálních snapshotů (např. 0.20.0)!
        const stableLoader = loaders.find(l => l.loader && l.loader.stable === true);
        const selectedLoader = stableLoader || loaders[0];
        const loaderVersion = selectedLoader?.loader?.version || '0.19.5';
        onLog(`[FABRIC] Stahuji profil pro Fabric loader ${loaderVersion}...`);

        const profileRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${effectiveGameVersion}/${loaderVersion}/profile/json`, {
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
        if (!vanillaJson || !Array.isArray(vanillaJson.libraries) || vanillaJson.libraries.length < 10) {
            throw new Error(`Nepodařilo se získat vanilkový manifest pro verzi ${targetVersion}`);
        }

        const combinedLibs = [];
        const seenLibKeys = new Set();
        const getLibKey = (l) => l?.name ? l.name.split(':').slice(0, 2).join(':') : null;

        for (const l of (profileJson.libraries || [])) {
            const k = getLibKey(l);
            if (k) seenLibKeys.add(k);
            combinedLibs.push(l);
        }
        for (const l of (vanillaJson.libraries || [])) {
            const k = getLibKey(l);
            if (k && !seenLibKeys.has(k)) {
                seenLibKeys.add(k);
                combinedLibs.push(l);
            }
        }

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
            libraries: combinedLibs,
            assetIndex: vanillaJson?.assetIndex,
            assets: vanillaJson?.assets,
            downloads: vanillaJson?.downloads
        };

        fs.writeFileSync(path.join(targetDir, `${fabricId}.json`), JSON.stringify(mergedProfile, null, 2), 'utf8');
        fs.writeFileSync(path.join(targetDir, `${targetVersion}.json`), JSON.stringify(mergedProfile, null, 2), 'utf8');

        // ⚡ Pojistka: Přímé ověření a stažení samotného jádra fabric-loader-${loaderVersion}.jar do knihoven
        try {
            const flDir = path.join(centralRootDir, 'libraries', 'net', 'fabricmc', 'fabric-loader', loaderVersion);
            const flJar = path.join(flDir, `fabric-loader-${loaderVersion}.jar`);
            if (!fs.existsSync(flJar) || !isJarFileValid(flJar)) {
                onLog(`[FABRIC] Stahuji jádro zavaděče fabric-loader-${loaderVersion}.jar...`);
                fs.mkdirSync(flDir, { recursive: true });
                const flRes = await fetch(`https://maven.fabricmc.net/net/fabricmc/fabric-loader/${loaderVersion}/fabric-loader-${loaderVersion}.jar`, {
                    headers: { 'User-Agent': 'MYCHALSMP-Launcher' },
                    signal: AbortSignal.timeout(20000)
                });
                if (flRes.ok) {
                    const flBuf = Buffer.from(await flRes.arrayBuffer());
                    fs.writeFileSync(flJar, flBuf);
                    if (!isJarFileValid(flJar)) {
                        try { fs.unlinkSync(flJar); } catch (_) { }
                        throw new Error('Stažený fabric-loader JAR neprošel validací ZIP');
                    }
                }
            }
        } catch (flErr) {
            onLog(`[FABRIC] ⚠ Příprava loader JAR: ${flErr.message}`);
        }

        // Zkopírovat vanilla client.jar do složky fabric profilu (pouze pokud je vanilkový jar 100% platný)
        const vanillaJar = path.join(versionsDir, targetVersion, `${targetVersion}.jar`);
        const vanillaBak = path.join(versionsDir, targetVersion, `${targetVersion}.vanilla.jar`);
        const fabricJar = path.join(targetDir, `${fabricId}.jar`);

        if (fs.existsSync(vanillaBak) && !isJarFileValid(vanillaBak)) {
            try { fs.unlinkSync(vanillaBak); } catch (e) { }
        }

        if (fs.existsSync(fabricJar) && !isJarFileValid(fabricJar)) {
            onLog(`[FABRIC] ⚠ Detekován poškozený soubor ${fabricId}.jar. Obnovuji...`);
            try { fs.unlinkSync(fabricJar); } catch (e) { }
            try { fs.unlinkSync(`${fabricJar}.skin_sig`); } catch (e) { }
            try { fs.unlinkSync(`${fabricJar}.brand_sig`); } catch (e) { }
        }
        if (fs.existsSync(vanillaJar) && !isJarFileValid(vanillaJar)) {
            onLog(`[FABRIC] ⚠ Detekován poškozený vanilkový soubor ${targetVersion}.jar. Odstraňuji pro čisté znovustažení...`);
            try { fs.unlinkSync(vanillaJar); } catch (e) { }
            try { if (fs.existsSync(vanillaBak)) fs.unlinkSync(vanillaBak); } catch (e) { }
            try { fs.unlinkSync(`${vanillaJar}.skin_sig`); } catch (e) { }
            try { fs.unlinkSync(`${vanillaJar}.brand_sig`); } catch (e) { }
            try { fs.unlinkSync(`${vanillaJar}.vanilla_bak`); } catch (e) { }
        }
        if (fs.existsSync(vanillaJar) && isJarFileValid(vanillaJar) && (!fs.existsSync(fabricJar) || !isJarFileValid(fabricJar))) {
            try { fs.copyFileSync(vanillaJar, fabricJar); } catch (e) { }
        }

        onLog(`[FABRIC] ✓ Fabric profil ${fabricId} úspěšně připraven a sloučen s jádrem!`);
        return fabricId;
    } catch (err) {
        try {
            const localFallback = fs.readdirSync(versionsDir).find(d =>
                d.toLowerCase().startsWith('fabric-loader-') &&
                !d.includes('0.20.0') &&
                d.includes(targetVersion) &&
                fs.existsSync(path.join(versionsDir, d, `${d}.json`))
            );
            if (localFallback) {
                const fbJson = JSON.parse(fs.readFileSync(path.join(versionsDir, localFallback, `${localFallback}.json`), 'utf8'));
                if (fbJson.libraries && fbJson.libraries.length > 20) {
                    onLog(`[FABRIC] Síťové ověření selhalo (${err.message}), použiji existující lokální profil: ${localFallback}`);
                    return localFallback;
                }
            }
        } catch (_) { }
        onLog(`[FABRIC] ⚠ Nepodařilo se připravit Fabric profil: ${err.message}. Spouštím Vanilla.`);
        return null;
    }
}

/**
 * ⚡ Zajišťuje přítomnost a aktuálnost módu Self Nametag (F5) v profilu.
 * Kontroluje se a vynucuje při každém spuštění hry i při načtení profilu pro verze 1.21.11 až 26.3!
 */
function getBundledSelfNametagPath() {
    const candidates = [
        path.join(__dirname, '../../assets/mods/selfnametag-1.0.0.jar'),
        path.join(process.resourcesPath || '', 'assets/mods/selfnametag-1.0.0.jar'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked/assets/mods/selfnametag-1.0.0.jar'),
        path.join(__dirname, '../../../assets/mods/selfnametag-1.0.0.jar'),
        path.join(BASE_DIR, 'mods/selfnametag-1.0.0.jar')
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) {
            try {
                if (fs.statSync(c).size > 1000) return c;
            } catch (_) { }
        }
    }
    return null;
}

// In-memory cache pro synchronizaci Self Nametag módu (vyhne se opakovanému čtení a počítání SHA-256)
const selfNametagSyncedDirs = new Map();

function syncSelfNametagConfigToDirs(dirs) {
    try {
        const launcherCfg = loadConfig();
        const currentModCfg = {
            screenshotToClipboard: launcherCfg.screenshotToClipboard !== false,
            borderlessFullscreen: launcherCfg.borderlessFullscreen === true
        };
        const cfgJson = JSON.stringify(currentModCfg, null, 2);
        for (const d of dirs) {
            try {
                const cfgDir = path.join(d, 'config');
                if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
                fs.writeFileSync(path.join(cfgDir, 'selfnametag.json'), cfgJson, 'utf-8');
            } catch (_) { }
        }
    } catch (_) { }
}

function ensureSelfNametagModInstalled(targetDir, onLog = console.log, forceOverwrite = false) {
    const targetKey = targetDir || BASE_DIR;

    const checkDirs = new Set();
    if (targetDir) checkDirs.add(targetDir);
    checkDirs.add(BASE_DIR);

    // Také automatická kontrola všech profilů ve složce profiles
    const profilesDir = path.join(BASE_DIR, 'profiles');
    if (fs.existsSync(profilesDir)) {
        try {
            const subEntries = fs.readdirSync(profilesDir);
            for (const sub of subEntries) {
                const pPath = path.join(profilesDir, sub);
                if (fs.statSync(pPath).isDirectory()) {
                    checkDirs.add(pPath);
                }
            }
        } catch (_) { }
    }

    // Vždy synchronizujeme konfiguraci doplňku (selfnametag.json) pro aktuální nastavení launcheru
    syncSelfNametagConfigToDirs(checkDirs);

    if (!forceOverwrite && selfNametagSyncedDirs.has(targetKey)) {
        const lastSync = selfNametagSyncedDirs.get(targetKey) || 0;
        if (Date.now() - lastSync < 5 * 60 * 1000) {
            return true;
        }
    }

    const bundledModPath = getBundledSelfNametagPath();
    if (!bundledModPath) {
        if (typeof onLog === 'function') {
            onLog('[DOPLŇKY] ⚠ Nebyl nalezen výchozí balíček selfnametag-1.0.0.jar v launcheru.');
        }
        return false;
    }

    let modBuffer = null;
    let bundledSha256 = '';
    try {
        modBuffer = fs.readFileSync(bundledModPath);
        bundledSha256 = crypto.createHash('sha256').update(modBuffer).digest('hex');
    } catch (e) {
        console.warn('[LAUNCHER] Nelze načíst selfnametag jar:', e.message);
        return false;
    }

    // Také automatická kontrola všech instancí ve složce instances (včetně imported-*)
    const instancesDir = path.join(BASE_DIR, 'instances');
    if (fs.existsSync(instancesDir)) {
        try {
            const subEntries = fs.readdirSync(instancesDir);
            for (const sub of subEntries) {
                const iPath = path.join(instancesDir, sub);
                if (fs.statSync(iPath).isDirectory()) {
                    checkDirs.add(iPath);
                }
            }
        } catch (_) { }
    }

    // Kontrola všech profilů z launcher-config.json (včetně p.gameDir)
    try {
        const cfgPath = path.join(BASE_DIR, 'launcher-config.json');
        if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            for (const p of (cfg.profiles || [])) {
                if (p.gameDir) checkDirs.add(p.gameDir);
            }
        }
    } catch (_) { }

    let installedCount = 0;
    for (const d of checkDirs) {
        try {
            const mDir = path.join(d, 'mods');
            if (!fs.existsSync(mDir)) {
                fs.mkdirSync(mDir, { recursive: true });
            }

            // Automaticky smazat staré, poškozené nebo alternativně pojmenované verze selfnametag modu
            try {
                const entries = fs.readdirSync(mDir);
                for (const item of entries) {
                    if (item !== 'selfnametag-1.0.0.jar' && /^self-?nametag.*\.jar$/i.test(item)) {
                        try { fs.unlinkSync(path.join(mDir, item)); } catch (_) { }
                    }
                }
            } catch (_) { }

            const targetJar = path.join(mDir, 'selfnametag-1.0.0.jar');
            let shouldCopy = forceOverwrite || !fs.existsSync(targetJar);
            if (!shouldCopy) {
                try {
                    const tBuf = fs.readFileSync(targetJar);
                    const tSha = crypto.createHash('sha256').update(tBuf).digest('hex');
                    if (tSha !== bundledSha256) {
                        shouldCopy = true;
                    }
                } catch (_) {
                    shouldCopy = true;
                }
            }

            if (shouldCopy) {
                fs.writeFileSync(targetJar, modBuffer);
                installedCount++;
                if (typeof onLog === 'function') {
                    onLog(`[DOPLŇKY] ✔ Aktualizován Self Nametag mod (F5 / SMPClient gradient) do: ${path.relative(BASE_DIR, targetJar) || targetJar}`);
                }
            }

            // Synchronizace konfigurace doplňku (Screenshot do schránky, Borderless Fullscreen)
            try {
                const cfgDir = path.join(d, 'config');
                if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
                const cfgPath = path.join(cfgDir, 'selfnametag.json');
                const launcherCfg = loadConfig();
                let currentModCfg = { screenshotToClipboard: true, borderlessFullscreen: false };
                if (fs.existsSync(cfgPath)) {
                    try {
                        const raw = fs.readFileSync(cfgPath, 'utf-8');
                        currentModCfg = { ...currentModCfg, ...JSON.parse(raw) };
                    } catch (_) { }
                }
                if (launcherCfg.screenshotToClipboard !== undefined) {
                    currentModCfg.screenshotToClipboard = launcherCfg.screenshotToClipboard !== false;
                }
                if (launcherCfg.borderlessFullscreen !== undefined) {
                    currentModCfg.borderlessFullscreen = launcherCfg.borderlessFullscreen === true;
                }
                fs.writeFileSync(cfgPath, JSON.stringify(currentModCfg, null, 2), 'utf-8');
            } catch (_) { }
        } catch (err) {
            console.warn(`[LAUNCHER] Nepodařilo se nainstalovat selfnametag do ${d}:`, err.message);
        }
    }

    if (installedCount === 0 && typeof onLog === 'function') {
        onLog('[DOPLŇKY] ✔ Ověřeno: Self Nametag (F5) je aktuální se sestavením launcheru.');
    }
    selfNametagSyncedDirs.set(targetKey, Date.now());
    return true;
}

/**
 * ⚡ Pre-flight kontrola závislostí módů pro Fabric profily.
 * Pokud mód v mods/ vyžaduje chybějící doplněk (např. particle_core vyžaduje fzzy_config),
 * launcher jej automaticky stáhne z Modrinthu ještě před spuštěním hry!
 * Pokud se stažení nezdaří, jako bezpečný fallback mód dočasně deaktivuje (.disabled),
 * aby nedošlo k pádu Minecraftu na "Incompatible mods found!".
 */
// In-memory cache otisku složky mods pro okamžité přeskočení rozbalování ZIPů (0 ms pokud se nic nezměnilo)
const profileModsDependenciesCache = new Map();

function getModsDirectoryFingerprint(modsDir) {
    if (!fs.existsSync(modsDir)) return '';
    try {
        const files = fs.readdirSync(modsDir);
        files.sort();
        const parts = [];
        for (const f of files) {
            const l = f.toLowerCase();
            if (l.endsWith('.jar') || l.endsWith('.disabled')) {
                const fullPath = path.join(modsDir, f);
                try {
                    const st = fs.statSync(fullPath);
                    parts.push(`${f}:${st.size}:${Math.floor(st.mtimeMs)}`);
                } catch (_) { }
            }
        }
        return parts.join('|');
    } catch (_) {
        return '';
    }
}

async function ensureProfileModsDependencies(gameInstanceDir, config, onLog) {
    const ldr = (config && config.loader) ? String(config.loader).toLowerCase() : '';
    if (!ldr.includes('fabric')) return;
    const modsDir = path.join(gameInstanceDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        try { fs.mkdirSync(modsDir, { recursive: true }); } catch (_) { }
    }

    // Inkrementální kontrola otisku složky mods: pokud se žádný soubor nezměnil od minula,
    // přeskočíme otevírání desítek JARů přes AdmZip i Modrinth kontrolu (0 ms)
    const initialFingerprint = getModsDirectoryFingerprint(modsDir);
    if (initialFingerprint && profileModsDependenciesCache.get(gameInstanceDir) === initialFingerprint) {
        if (typeof onLog === 'function') {
            onLog('[ZÁVISLOSTI] ⚡ Závislosti módů ověřeny z cache (beze změn složky mods).');
        }
        return;
    }

    let AdmZip = null;
    try { AdmZip = require('adm-zip'); } catch (_) { return; }

    let files = [];
    try { files = fs.readdirSync(modsDir); } catch (_) { return; }
    const jarFiles = files.filter(f => f.toLowerCase().endsWith('.jar'));
    if (jarFiles.length === 0) return;

    // Ověříme, zda není Sodium explicitně deaktivováno (.disabled)
    const isSodiumDisabled = files.some(f => {
        const l = f.toLowerCase();
        return (l.startsWith('sodium-') || l.startsWith('sodium_') || l === 'sodium.jar.disabled') &&
               l.endsWith('.disabled') && !l.includes('extra') && !l.includes('options');
    });

    let downloadModOrPack;
    try {
        const modrinthModule = require('./modrinth');
        downloadModOrPack = modrinthModule.downloadModOrPack;
    } catch (_) {
        return;
    }

    let hasIris = false;
    let sodiumMod = null;
    let fabricApiMod = null;

    for (const f of jarFiles) {
        const fullPath = path.join(modsDir, f);
        const lName = f.toLowerCase();
        if ((lName.includes('fabric-api') || lName.includes('fabric_api')) && !lName.includes('fabric-api-base')) {
            if (!fabricApiMod) {
                fabricApiMod = { filename: f, fullPath, version: f };
            }
        }
        if ((lName.startsWith('sodium-') || lName.startsWith('sodium_') || lName === 'sodium.jar') && !lName.includes('extra') && !lName.includes('options')) {
            sodiumMod = { filename: f, fullPath, version: '' };
        }
        if (lName.startsWith('iris-') || lName.startsWith('iris_') || lName === 'iris.jar') {
            hasIris = true;
        }

        try {
            const zip = new AdmZip(fullPath);
            const fabEntry = zip.getEntry('fabric.mod.json');
            if (fabEntry) {
                const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                if (fab.id) {
                    const idLower = fab.id.toLowerCase();
                    if (idLower === 'iris') {
                        hasIris = true;
                    }
                    if (idLower === 'sodium') {
                        sodiumMod = {
                            filename: f,
                            fullPath,
                            id: fab.id,
                            version: String(fab.version || '')
                        };
                    }
                    if (idLower === 'fabric-api' || idLower === 'fabric_api') {
                        fabricApiMod = {
                            filename: f,
                            fullPath,
                            id: fab.id,
                            version: String(fab.version || f)
                        };
                    }
                }
            }
        } catch (_) { }
    }

    const targetVersion = config.version || '26.2';

    // 2. KLÍČOVÁ KONTROLA: Iris na Minecraftu striktně vyžaduje Sodium
    if (hasIris && isSodiumDisabled) {
        // Pokud je Sodium záměrně deaktivováno (.disabled), musíme dočasně zakázat i Iris,
        // jinak Iris okamžitě způsobí pád Fabricu kvůli chybějícímu Sodium.
        if (typeof onLog === 'function') {
            onLog('[ZÁVISLOSTI] ⚠️ Sodium je deaktivováno (.disabled) – dočasně deaktivuji Iris, aby hra nespadla na chybějící závislosti.');
        }
        for (const f of jarFiles) {
            const l = f.toLowerCase();
            if (l.startsWith('iris-') || l.startsWith('iris_') || l === 'iris.jar') {
                try {
                    const fullP = path.join(modsDir, f);
                    fs.renameSync(fullP, fullP + '.disabled');
                } catch (_) {}
            }
        }
        hasIris = false;
    } else if (hasIris && !isSodiumDisabled) {
        const sodiumNeedsUpdate = !sodiumMod ||
            (!sodiumMod.version.startsWith('0.9') && !sodiumMod.filename.toLowerCase().includes('0.9'));

        if (sodiumNeedsUpdate) {
            if (typeof onLog === 'function') {
                if (sodiumMod) {
                    onLog(`[ZÁVISLOSTI] ⚠️ Zjištěna nekompatibilní verze Sodium (${sodiumMod.version || sodiumMod.filename}). Iris vyžaduje Sodium 0.9.x pro MC ${targetVersion}. Automaticky aktualizuji Sodium...`);
                } else {
                    onLog(`[ZÁVISLOSTI] 🔍 Mód Iris vyžaduje Sodium 0.9.x. Automaticky stahuji Sodium z Modrinthu...`);
                }
            }

            try {
                const dlRes = await downloadModOrPack({
                    id: 'sodium',
                    title: 'Sodium',
                    projectType: 'mod',
                    version: targetVersion,
                    loader: 'fabric',
                    oldFilename: sodiumMod ? sodiumMod.filename : null
                }, gameInstanceDir);

                if (dlRes && dlRes.success) {
                    if (typeof onLog === 'function') {
                        onLog(`[ZÁVISLOSTI] ✔ Úspěšně staženo kompatibilní Sodium: ${dlRes.filename}`);
                    }
                }
            } catch (sodErr) {
                if (typeof onLog === 'function') {
                    onLog(`[ZÁVISLOSTI] ⚠️ Nepodařilo se stáhnout Sodium: ${sodErr.message}`);
                }
            }
        }
    }

    // 3. KONTROLA FABRIC API: Kontrola přítomnosti a verze pro cílovou verzi Minecraftu
    const targetVer = String(targetVersion || '26.2');
    let fabricApiIncompatible = false;

    if (fabricApiMod) {
        const fVer = (fabricApiMod.version || fabricApiMod.filename).toLowerCase();
        if (targetVer === '26.2') {
            if (fVer.includes('26.4') || fVer.includes('26.3') || fVer.includes('1.21')) {
                fabricApiIncompatible = true;
            }
        } else if (targetVer === '26.3') {
            if (fVer.includes('26.4') || fVer.includes('26.2') || fVer.includes('1.21')) {
                fabricApiIncompatible = true;
            }
        } else if (targetVer.startsWith('1.21')) {
            if (fVer.includes('26.')) {
                fabricApiIncompatible = true;
            }
        }
    }

    // Odstranění všech zbylých nekompatibilních Fabric API souborů v mods složce
    for (const f of jarFiles) {
        const lName = f.toLowerCase();
        if ((lName.includes('fabric-api') || lName.includes('fabric_api')) && !lName.includes('fabric-api-base')) {
            if (targetVer === '26.2' && (lName.includes('26.4') || lName.includes('26.3') || lName.includes('1.21'))) {
                try {
                    fs.unlinkSync(path.join(modsDir, f));
                    if (typeof onLog === 'function') onLog(`[ZÁVISLOSTI] 🗑️ Odstraněna nekompatibilní verze Fabric API: ${f}`);
                } catch (_) { }
            }
        }
    }

    if (!fabricApiMod || fabricApiIncompatible) {
        if (typeof onLog === 'function') {
            if (fabricApiIncompatible) {
                onLog(`[ZÁVISLOSTI] ⚠️ Zjištěna nekompatibilní verze Fabric API (${fabricApiMod.filename}). Vyžadována verze pro Minecraft ${targetVersion}. Automaticky aktualizuji...`);
            } else {
                onLog(`[ZÁVISLOSTI] 🔍 Zjištěna absence Fabric API. Automaticky stahuji z Modrinthu...`);
            }
        }
        try {
            const dlRes = await downloadModOrPack({
                id: 'fabric-api',
                title: 'Fabric API',
                projectType: 'mod',
                version: targetVersion,
                loader: 'fabric',
                oldFilename: fabricApiIncompatible ? fabricApiMod.filename : null
            }, gameInstanceDir);

            if (dlRes && dlRes.success) {
                if (typeof onLog === 'function') {
                    onLog(`[ZÁVISLOSTI] ✔ Úspěšně stažen Fabric API: ${dlRes.filename}`);
                }
            }
        } catch (fErr) {
            if (typeof onLog === 'function') {
                onLog(`[ZÁVISLOSTI] ⚠️ Nepodařilo se stáhnout Fabric API: ${fErr.message}`);
            }
        }
    }

    const finalFingerprint = getModsDirectoryFingerprint(modsDir);
    if (finalFingerprint) profileModsDependenciesCache.set(gameInstanceDir, finalFingerprint);
}

/**
 * Launches Minecraft with the specified profile & configuration.
 */
async function launchGame(config, authData, customServer, onProgress, onLog, onExit) {
    isIntentionalTermination = false;
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

    // ⚡ Vynucená kontrola a instalace módu Self Nametag (F5) před každým spuštěním pro tento profil/instanci
    ensureSelfNametagModInstalled(gameInstanceDir, onLog);

    // ⚡ Blesková online kontrola zda Mojang nevydal nový patch/hotfix pro cílovou verzi (např. 1.8.9, 1.12.2, 26.2)
    await ensureMojangVersionUpToDate(BASE_DIR, targetVersion, onLog);

    // ⚡ Bleskové převzetí existujících assetů a knihoven ze systému (.minecraft)
    linkOrShareExistingMinecraftData(BASE_DIR, onLog);

    // ⚡ Automatická pre-flight kontrola a stažení chybějících závislostí módů (s fallbackem na .disabled)
    await ensureProfileModsDependencies(gameInstanceDir, config, onLog);

    // JVM Arguments (supports modern Java 25 ZGC and G1GC)
    let jvmArgs = [];
    if (config.customJvmArgs && config.customJvmArgs.trim()) {
        jvmArgs = config.customJvmArgs.trim().split(/\s+/).filter(Boolean);
    } else {
        // High-performance Java 25 ZGC default (bez -XX:+AlwaysPreTouch pro bleskový start)
        jvmArgs = [
            '-XX:+UseZGC',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+DisableExplicitGC'
        ];
    }
    // Pro Java 24/25: odfiltrovat -XX:+ZGenerational a -XX:+AlwaysPreTouch (zbytečně nuluje celou RAM a zdržuje start)
    jvmArgs = jvmArgs.filter(a => a !== '-XX:+ZGenerational' && a !== '-XX:+AlwaysPreTouch');
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
    } catch (e) { }

    // ⚡ Klíčový příznak pro Java 24/25 – Mojang 26.x manifest jej explicitně vyžaduje pro přístup Netty, LWJGL a Fabric k paměti
    if (!jvmArgs.includes('--sun-misc-unsafe-memory-access=allow')) {
        jvmArgs.push('--sun-misc-unsafe-memory-access=allow');
    }
    if (!jvmArgs.includes('--enable-native-access=ALL-UNNAMED')) {
        jvmArgs.push('--enable-native-access=ALL-UNNAMED');
    }
    if (!jvmArgs.includes('--add-exports') && !jvmArgs.some(a => a.includes('jdk.internal.misc'))) {
        jvmArgs.push('--add-exports', 'java.base/jdk.internal.misc=ALL-UNNAMED');
    }
    if (!jvmArgs.some(a => a.startsWith('-XX:StackShadowPages='))) {
        jvmArgs.push('-XX:StackShadowPages=32');
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
    // POZNÁMKA: NIKDY nepřidávat -Djava.library.path směřující na prázdnou složku!
    // Na Windows i Linuxu to přepisuje systémový mechanismus hledání dynamických knihoven a způsobí pád LWJGL.

    // Direct Quick Play multiplayer connection (with automatic fallback to backup IP 130.61.89.37)
    let quickPlay = null;
    let serverToJoin = customServer || (config.autoConnectServer ? config.serverIp : null);
    if (serverToJoin) {
        if (serverToJoin.toLowerCase().includes('mychalsmp')) {
            const hostOnly = serverToJoin.includes(':') ? serverToJoin.split(':')[0] : serverToJoin;
            const isResolvable = await isServerHostResolvable(hostOnly);
            if (!isResolvable) {
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
            } catch (e) { }
        }
    }

    // ⚡ Načtení specifických JVM argumentů přímo z manifestu (např. -DFabricMcEmu nebo Mojang 26.x flags)
    try {
        let manifestToRead = null;
        if (versionOpts.custom) {
            const cPath = path.join(BASE_DIR, 'versions', versionOpts.custom, `${versionOpts.custom}.json`);
            if (fs.existsSync(cPath)) manifestToRead = cPath;
        }
        if (!manifestToRead) {
            const vPath = path.join(BASE_DIR, 'versions', targetVersion, `${targetVersion}.json`);
            if (fs.existsSync(vPath)) manifestToRead = vPath;
        }
        if (manifestToRead) {
            const manifestObj = JSON.parse(fs.readFileSync(manifestToRead, 'utf8'));
            const manifestJvm = manifestObj?.arguments?.jvm;
            if (Array.isArray(manifestJvm)) {
                for (const arg of manifestJvm) {
                    if (typeof arg === 'string') {
                        const trimmedArg = arg.trim().replaceAll('${natives_directory}', nativesExtractDir);
                        if (!trimmedArg.startsWith('-cp') && !trimmedArg.startsWith('${classpath}') &&
                            !trimmedArg.startsWith('-Djava.library.path') && !trimmedArg.startsWith('-Dminecraft.launcher') &&
                            !trimmedArg.startsWith('-DFabricMcEmu')) {
                            const propPrefix = (trimmedArg.startsWith('-D') && trimmedArg.includes('='))
                                ? trimmedArg.slice(0, trimmedArg.indexOf('=') + 1)
                                : null;
                            const alreadyHasProp = propPrefix && jvmArgs.some(a => typeof a === 'string' && a.startsWith(propPrefix));
                            if (!alreadyHasProp && !jvmArgs.includes(trimmedArg)) {
                                jvmArgs.push(trimmedArg);
                            }
                        }
                    }
                }
            }
        }
    } catch (_) { }

    // Automatická kontrola a oprava integrity version JAR před spuštěním
    const activeVersionFolder = versionOpts.custom || versionOpts.number;
    const clientJarPath = path.join(BASE_DIR, 'versions', activeVersionFolder, `${activeVersionFolder}.jar`);
    const vanillaClientJar = path.join(BASE_DIR, 'versions', versionOpts.number, `${versionOpts.number}.jar`);

    if (fs.existsSync(clientJarPath) && !isJarFileValid(clientJarPath)) {
        const bak = clientJarPath.replace(/\.jar$/, '.vanilla.jar');
        if (fs.existsSync(bak) && isJarFileValid(bak)) {
            onLog(`[OPRAVA]: Obnovuji poškozený soubor ${path.basename(clientJarPath)} z čisté vanilla zálohy...`);
            try { fs.copyFileSync(bak, clientJarPath); } catch (_) { }
        } else if (versionOpts.custom && fs.existsSync(vanillaClientJar) && isJarFileValid(vanillaClientJar)) {
            onLog(`[OPRAVA]: Detekován poškozený soubor klienta ${path.basename(clientJarPath)} (neplatná hlavička). Obnovuji z platného jádra ${path.basename(vanillaClientJar)}...`);
            try { fs.unlinkSync(clientJarPath); } catch (e) { }
            try { fs.copyFileSync(vanillaClientJar, clientJarPath); } catch (_) { }
        } else {
            onLog(`[OPRAVA]: Detekován poškozený soubor klienta ${path.basename(clientJarPath)}. Odstraňuji pro čisté znovustažení...`);
            try { fs.unlinkSync(clientJarPath); } catch (e) { }
        }
        try { fs.unlinkSync(`${clientJarPath}.skin_sig`); } catch (_) { }
        try { fs.unlinkSync(`${clientJarPath}.brand_sig`); } catch (_) { }
        try { fs.unlinkSync(`${clientJarPath}.vanilla_bak`); } catch (_) { }
        if (fs.existsSync(bak) && !isJarFileValid(bak)) {
            try { fs.unlinkSync(bak); } catch (_) { }
        }
    }

    if (fs.existsSync(vanillaClientJar) && !isJarFileValid(vanillaClientJar)) {
        const bak = vanillaClientJar.replace(/\.jar$/, '.vanilla.jar');
        if (fs.existsSync(bak) && isJarFileValid(bak)) {
            onLog(`[OPRAVA]: Obnovuji poškozený ${path.basename(vanillaClientJar)} z vanilkové zálohy...`);
            try { fs.copyFileSync(bak, vanillaClientJar); } catch (_) { }
        } else {
            onLog(`[OPRAVA]: Detekován poškozený soubor jádra ${path.basename(vanillaClientJar)}. Odstraňuji pro čisté znovustažení...`);
            try { fs.unlinkSync(vanillaClientJar); } catch (e) { }
        }
        try { fs.unlinkSync(`${vanillaClientJar}.skin_sig`); } catch (_) { }
        try { fs.unlinkSync(`${vanillaClientJar}.brand_sig`); } catch (_) { }
        try { fs.unlinkSync(`${vanillaClientJar}.vanilla_bak`); } catch (_) { }
        if (fs.existsSync(bak) && !isJarFileValid(bak)) {
            try { fs.unlinkSync(bak); } catch (_) { }
        }
        if (versionOpts.custom && fs.existsSync(clientJarPath)) {
            try { fs.unlinkSync(clientJarPath); } catch (_) { }
            try { fs.unlinkSync(`${clientJarPath}.skin_sig`); } catch (_) { }
            try { fs.unlinkSync(`${clientJarPath}.brand_sig`); } catch (_) { }
        }
    }

    // Pro custom zavaděče (Fabric): pokud jar chybí, ale vanilkový existuje a je platný, vytvoříme okamžitě kopii
    if (versionOpts.custom && !fs.existsSync(clientJarPath) && fs.existsSync(vanillaClientJar) && isJarFileValid(vanillaClientJar)) {
        onLog(`[OPRAVA]: Příprava herního jádra pro profil ${versionOpts.custom}...`);
        try { fs.copyFileSync(vanillaClientJar, clientJarPath); } catch (_) { }
    }

    // 🎭 Aplikace vlastního RAW offline skinu a pláště pro warez / offline režim přímo do jádra
    await setupOfflineCustomSkinAndCape(gameInstanceDir, config, onLog, targetVersion, versionOpts);

    // 🏷️ Brand klienta pro síť MYCHAL SMP: smpclient/<version>-<loader>-<gameVersion>
    // např. smpclient/1.3.10-fabric-26.2, smpclient/1.3.10-vanilla-26.2, smpclient/1.3.10-forge-26.2, smpclient/1.3.10-neoforge-26.2
    let launcherVersion = '1.3.10';
    try {
        const { app } = require('electron');
        launcherVersion = (app && typeof app.getVersion === 'function') ? app.getVersion() : require('../../package.json').version;
    } catch (_) {
        try { launcherVersion = require('../../package.json').version; } catch (__) { }
    }

    let resolvedLoader = 'vanilla';
    if (config.loader && config.loader.toLowerCase() !== 'vanilla') {
        resolvedLoader = config.loader.toLowerCase();
    } else if (versionOpts?.custom?.toLowerCase().includes('fabric')) {
        resolvedLoader = 'fabric';
    } else if (versionOpts?.custom?.toLowerCase().includes('neoforge')) {
        resolvedLoader = 'neoforge';
    } else if (versionOpts?.custom?.toLowerCase().includes('forge')) {
        resolvedLoader = 'forge';
    }

    const clientBrand = `smpclient/${launcherVersion}-${resolvedLoader}-${targetVersion}`;

    if (!jvmArgs.some(a => a.startsWith('-Dsmpclient.brand='))) {
        jvmArgs.push(`-Dsmpclient.brand=${clientBrand}`);
    }
    if (!jvmArgs.some(a => a.startsWith('-Dsmpclient.version='))) {
        jvmArgs.push(`-Dsmpclient.version=${launcherVersion}`);
    }
    if (!jvmArgs.some(a => a.startsWith('-Dsmpclient.loader='))) {
        jvmArgs.push(`-Dsmpclient.loader=${resolvedLoader}`);
    }
    if (!jvmArgs.some(a => a.startsWith('-Dsmpclient.gameversion='))) {
        jvmArgs.push(`-Dsmpclient.gameversion=${targetVersion}`);
    }

    const brandJar = ensureSMPClientBrandJar(BASE_DIR);
    if (brandJar && !jvmArgs.some(a => a.startsWith('-Xbootclasspath/a:'))) {
        jvmArgs.push(`-Xbootclasspath/a:${brandJar}`);
    }

    // Injekce třídy ClientBrandRetriever přímo do herních JARů pro všechny zavaděče
    injectSMPClientBrandIntoJars(BASE_DIR, targetVersion, versionOpts, onLog, javaExecutable, clientBrand);
    onLog(`[KLIENT] 🏷️ Spouštění oficiálního klienta s identifikací: ${clientBrand}`);

    // Synchronizace globálních klávesových zkratek do profilu před startem hry
    try {
        const { syncKeybindsToProfile } = require('./keybindManager');
        if (typeof syncKeybindsToProfile === 'function') {
            syncKeybindsToProfile(gameInstanceDir);
        }
    } catch (_) { }

    let safeRamMax = Math.max(1, parseInt(config.ramMax, 10) || 4);
    let safeRamMin = Math.max(1, parseInt(config.ramMin, 10) || 2);
    if (safeRamMin > safeRamMax) {
        safeRamMin = safeRamMax;
    }

    const opts = {
        config: config,
        authorization: authData,
        root: BASE_DIR, // Centrální adresář pro sdílení verzí, knihoven a assetů bez znovustahování
        version: versionOpts,
        memory: {
            max: `${safeRamMax}G`,
            min: `${safeRamMin}G`
        },
        javaPath: javaExecutable,
        customArgs: jvmArgs,
        window: {
            width: config.resolution ? config.resolution.width : 1280,
            height: config.resolution ? config.resolution.height : 720,
            fullscreen: (config.borderlessFullscreen === true) || (config.resolution ? config.resolution.fullscreen === true : false)
        },
        quickPlay: quickPlay,
        downloadAudioDlc: true,
        overrides: {
            gameDirectory: gameInstanceDir, // Sem Minecraft generuje a odkud čte mods, config, options.txt, saves
            assetIndex: targetVersion,
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

    // Odstranění zablokovaného pádu z options.txt a synchronizace fullscreen / borderless nastavení
    try {
        const isBorderless = (config.borderlessFullscreen === true);
        const shouldFullscreen = isBorderless || (config.resolution && config.resolution.fullscreen === true);
        const optPaths = [
            path.join(gameInstanceDir, 'options.txt'),
            path.join(BASE_DIR, 'options.txt')
        ];
        for (const optPath of optPaths) {
            if (fs.existsSync(optPath)) {
                let optText = fs.readFileSync(optPath, 'utf8');
                let changed = false;
                const targetBackend = config.graphicsBackend || 'default';
                if (optText.includes('preferredGraphicsBackend:')) {
                    optText = optText.replace(/preferredGraphicsBackend:"[^"]*"/g, `preferredGraphicsBackend:"${targetBackend}"`);
                    changed = true;
                } else {
                    optText += `\npreferredGraphicsBackend:"${targetBackend}"\n`;
                    changed = true;
                }
                if (targetBackend === 'vulkan') {
                    onLog('[GRAFIKA] 🌋 Nastaven nativní Vulkan backend (preferredGraphicsBackend:"vulkan")');
                } else if (targetBackend === 'opengl') {
                    onLog('[GRAFIKA] 🖌️ Nastaven OpenGL backend (preferredGraphicsBackend:"opengl")');
                }
                if (shouldFullscreen) {
                    if (optText.includes('fullscreen:false')) {
                        optText = optText.replace(/fullscreen:false/g, 'fullscreen:true');
                        changed = true;
                    } else if (!optText.includes('fullscreen:')) {
                        optText += '\nfullscreen:true\n';
                        changed = true;
                    }
                } else if (config.resolution && config.resolution.fullscreen === false) {
                    if (optText.includes('fullscreen:true')) {
                        optText = optText.replace(/fullscreen:true/g, 'fullscreen:false');
                        changed = true;
                    }
                }
                if (changed) {
                    fs.writeFileSync(optPath, optText, 'utf8');
                }
            } else if (shouldFullscreen) {
                fs.writeFileSync(optPath, 'fullscreen:true\n', 'utf8');
            }
        }
    } catch (_) { }

    // Důkladné pročištění starých grafických proměnných z process.env
    // Zabrání chybám 'No supported graphics backend was found' a 'VK_ERROR_INITIALIZATION_FAILED'
    const sensitiveGpuKeys = [
        '__VK_LAYER_NV_optimus',
        'MESA_GL_VERSION_OVERRIDE',
        'MESA_GLSL_VERSION_OVERRIDE',
        'MESA_LOADER_DRIVER_OVERRIDE',
        '__NV_PRIME_RENDER_OFFLOAD',
        '__GLX_VENDOR_LIBRARY_NAME',
        'DRI_PRIME',
        '__GL_THREADED_OPTIMIZATIONS',
        'MESA_GL_THREAD'
    ];
    for (const key of sensitiveGpuKeys) {
        delete process.env[key];
    }

    // Prepare Environment Variables for Game Launch (Wayland, Linux Performance & Prism features)
    const savedEnv = {};
    const setGameEnv = (key, val) => {
        if (!(key in savedEnv)) {
            savedEnv[key] = process.env[key];
        }
        process.env[key] = val;
    };
    const unsetGameEnv = (key) => {
        if (!(key in savedEnv)) {
            savedEnv[key] = process.env[key];
        }
        delete process.env[key];
    };

    // In-memory cache pro detekci hardware platformy a GPU na Linuxu (vyhne se opakovanému čtení sysfs)
    let cachedLinuxGpuInfo = null;

    function getLinuxPlatformPerformanceInfo() {
        if (cachedLinuxGpuInfo) return cachedLinuxGpuInfo;
        let isLaptop = false;
        try {
            if (fs.existsSync('/sys/class/dmi/id/chassis_type')) {
                const chassis = fs.readFileSync('/sys/class/dmi/id/chassis_type', 'utf8').trim();
                const laptopTypes = ['8', '9', '10', '11', '14', '30', '31', '32'];
                const desktopTypes = ['3', '4', '5', '6', '7', '13', '15', '16', '17', '23', '24', '35', '36'];
                if (laptopTypes.includes(chassis)) {
                    isLaptop = true;
                } else if (desktopTypes.includes(chassis)) {
                    isLaptop = false;
                }
            }
            if (!isLaptop && fs.existsSync('/sys/class/power_supply')) {
                const supplies = fs.readdirSync('/sys/class/power_supply');
                for (const s of supplies) {
                    if (s.startsWith('BAT')) {
                        const scopePath = path.join('/sys/class/power_supply', s, 'scope');
                        const typePath = path.join('/sys/class/power_supply', s, 'type');
                        const scope = fs.existsSync(scopePath) ? fs.readFileSync(scopePath, 'utf8').trim().toLowerCase() : '';
                        const type = fs.existsSync(typePath) ? fs.readFileSync(typePath, 'utf8').trim().toLowerCase() : '';
                        if ((type === 'battery' || !type) && scope !== 'device') {
                            isLaptop = true;
                            break;
                        }
                    }
                }
            }
        } catch (_) { }

        let gpuDeviceCount = 1;
        try {
            const drmDir = '/sys/class/drm';
            if (fs.existsSync(drmDir)) {
                const cards = fs.readdirSync(drmDir).filter(f => /^card\d+$/.test(f));
                const uniqueDevices = new Set();
                for (const c of cards) {
                    try {
                        const devPath = fs.realpathSync(path.join(drmDir, c, 'device'));
                        uniqueDevices.add(devPath);
                    } catch (_) { }
                }
                gpuDeviceCount = uniqueDevices.size;
            }
        } catch (_) { }

        const isHybridMultiGpu = isLaptop && (gpuDeviceCount >= 2);
        const hasNvidia = fs.existsSync('/proc/driver/nvidia') || fs.existsSync('/sys/module/nvidia');

        let gamemodeLib = null;
        const gamemodeLibs = [
            '/usr/lib/libgamemodeauto.so.0',
            '/usr/lib/x86_64-linux-gnu/libgamemodeauto.so.0',
            '/usr/lib64/libgamemodeauto.so.0'
        ];
        for (const lib of gamemodeLibs) {
            if (fs.existsSync(lib)) {
                gamemodeLib = lib;
                break;
            }
        }

        cachedLinuxGpuInfo = { isLaptop, isHybridMultiGpu, hasNvidia, gamemodeLib };
        return cachedLinuxGpuInfo;
    }

    if (process.platform === 'linux') {
        const linuxInfo = getLinuxPlatformPerformanceInfo();

        // Feral GameMode support
        if (config.enableGameMode && linuxInfo.gamemodeLib) {
            const currentPreload = process.env.LD_PRELOAD || '';
            setGameEnv('LD_PRELOAD', currentPreload ? `${currentPreload}:${linuxInfo.gamemodeLib}` : linuxInfo.gamemodeLib);
            onLog(`[VÝKON] Feral GameMode aktivován (${linuxInfo.gamemodeLib})`);
        }

        // Discrete GPU (NVIDIA & AMD Prime Offloading výhradně pro hybridní notebooky s duální iGPU + dGPU)
        // Na stolních PC (jako RTX 4070) nebo laptopech s 1 GPU je monitor/displej zapojen přímo do grafiky a PRIME offload se NIKDY nesmí zapínat!
        if (config.enableDiscreteGpu && linuxInfo.isHybridMultiGpu) {
            if (linuxInfo.hasNvidia) {
                setGameEnv('__NV_PRIME_RENDER_OFFLOAD', '1');
                setGameEnv('__GLX_VENDOR_LIBRARY_NAME', 'nvidia');
                // Nikdy nenastavovat __VK_LAYER_NV_optimus=NVIDIA_only – rozbíjí Vulkan loader a vede k VK_ERROR_INITIALIZATION_FAILED
                unsetGameEnv('__VK_LAYER_NV_optimus');
                onLog('[VÝKON] Hybridní notebook (iGPU + dGPU): aktivován NVIDIA Prime Render Offload');
            } else {
                setGameEnv('DRI_PRIME', '1');
                onLog('[VÝKON] Hybridní notebook (iGPU + dGPU): aktivován DRI_PRIME=1');
            }
        } else {
            // Stolní PC (Desktop PC) nebo notebook s 1 GPU: nativní přístup ke GPU bez hybridního offloadu
            unsetGameEnv('__NV_PRIME_RENDER_OFFLOAD');
            unsetGameEnv('__GLX_VENDOR_LIBRARY_NAME');
            unsetGameEnv('__VK_LAYER_NV_optimus');
            unsetGameEnv('DRI_PRIME');
            if (config.enableDiscreteGpu) {
                onLog(`[VÝKON] Detekován ${linuxInfo.isLaptop ? 'notebook s 1 GPU' : 'stolní počítač (Desktop PC)'} – GPU běží nativně bez hybridního PRIME offloadu.`);
            }
        }

        // Zink (OpenGL over Vulkan) - určen výhradně pro open-source Mesa ovladače (AMD, Intel, Nouveau),
        // NIKDY pro proprietární ovladač NVIDIA (kde způsobuje pád 'Driver does not support OpenGL 3.3').
        if (config.enableZink) {
            if (linuxInfo.hasNvidia && config.enableDiscreteGpu && linuxInfo.isHybridMultiGpu) {
                onLog('[VÝKON] ℹ Zink přeskočen: NVIDIA Prime Render Offload využívá nativní proprietární OpenGL ovladač NVIDIA pro maximální výkon.');
                unsetGameEnv('MESA_LOADER_DRIVER_OVERRIDE');
            } else {
                setGameEnv('MESA_LOADER_DRIVER_OVERRIDE', 'zink');
                onLog('[VÝKON] Zink aktivován (MESA_LOADER_DRIVER_OVERRIDE=zink)');
            }
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
    } else if (process.platform === 'win32') {
        // Windows specifické optimalizace
        if (config.winDedicatedGpu !== false) {
            setGameEnv('SHIM_MCCOMPAT', '0xD4000000');
            setGameEnv('__NV_PRIME_RENDER_OFFLOAD', '1');
            setGameEnv('__GLX_VENDOR_LIBRARY_NAME', 'nvidia');
            onLog('[WINDOWS] Vynuceno spuštění na dedikované grafické kartě (NVIDIA / AMD)');
        }

        if (config.winWindowedOptimization !== false) {
            setGameEnv('DWM_WINDOW_PRESENTATION_MODE', '1');
            jvmArgs.push('-Dsun.java2d.d3d=true');
            onLog('[WINDOWS] Aktivována DWM Flip Model optimalizace pro okna bez okrajů');
        }

        if (config.winTrimMemory !== false) {
            try {
                if (typeof process.trimWorkingSet === 'function') {
                    process.trimWorkingSet();
                    onLog('[WINDOWS] Vyčištěna pohotovostní paměť RAM před startem');
                }
            } catch (_) {}
        }

        if (config.winDisableStickyKeys !== false) {
            try {
                const { exec } = require('child_process');
                exec('reg add "HKCU\\Control Panel\\Accessibility\\StickyKeys" /v Flags /t REG_SZ /d 506 /f', { timeout: 1500 }, () => {});
                onLog('[WINDOWS] Ochrana před vyskakovacím oknem Sticky Keys (Shift sneak) aktivní');
            } catch (_) {}
        }
    }

    // Custom environment variables defined by user (KEY=VAL per line - pro všechny OS)
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

    let lastMclcError = null;
    launcher.on('debug', (e) => {
        onLog(`[DEBUG] ${e}`);
        if (typeof e === 'string' && e.includes('[MCLC]: Failed to start due to')) {
            lastMclcError = e.replace('[MCLC]: Failed to start due to', '').replace(', closing...', '').trim();
        }
    });
    // ── Unified Kinetic Launch & Milestone Engine ───────────────────────────
    // Zajišťuje 100% nepřetržitý plynulý posun progress baru (dle AGENTS.md sekce 8).
    // Odstraňuje zamrzávání na 54 % při startu JVM a zavádění desítek módů.
    let unifiedProgress = 12;
    let targetProgress = 20;
    let currentStatusText = 'Příprava herního jádra...';
    let launchFinished = false;

    function pushMilestone(targetPercent, statusText) {
        if (targetPercent > targetProgress) {
            targetProgress = Math.min(99, targetPercent);
        }
        if (statusText) {
            currentStatusText = statusText;
        }
        if (onProgress) {
            onProgress({
                percent: Math.min(99, Math.max(Math.round(unifiedProgress), Math.round(targetProgress))),
                text: currentStatusText
            });
        }
    }

    // Živý kinetický ticker (každých 80ms) – zaručuje, že progress se neustále organicky hýbe
    const progressTicker = setInterval(() => {
        if (launchFinished || launcher._isCancelled) {
            clearInterval(progressTicker);
            return;
        }

        // Plynulé kinetické přibližování k cílovému milníku
        if (unifiedProgress < targetProgress) {
            const step = Math.max(0.2, (targetProgress - unifiedProgress) * 0.15);
            unifiedProgress = Math.min(targetProgress, unifiedProgress + step);
        } else if (unifiedProgress < 96) {
            // Asymptotický organický mikrokrok, aby se progress nikdy nezastavil na místě
            unifiedProgress = Math.min(96, unifiedProgress + 0.12);
        }

        if (onProgress) {
            onProgress({
                percent: Math.min(99, Math.round(unifiedProgress)),
                text: currentStatusText
            });
        }
    }, 80);

    launcher._progressTicker = progressTicker;

    let currentPhase = 'init'; // 'init' | 'classes' | 'assets' | 'natives'

    launcher.on('progress', (e) => {
        const taskFraction = (e.total && e.total > 0) ? Math.min(1, Math.max(0, e.task / e.total)) : 0;

        if (e.type === 'classes' || e.type === 'classes-custom' || e.type === 'classes-maven-custom') {
            currentPhase = 'classes';
            // Fáze knihoven: 20 % -> 48 %
            const phasePercent = Math.round(20 + (taskFraction * 28));
            const text = (e.task >= e.total)
                ? 'Herní knihovny připraveny'
                : `Ověřování herních knihoven (${e.task} z ${e.total})...`;
            pushMilestone(phasePercent, text);
        } else if (e.type === 'assets') {
            currentPhase = 'assets';
            // Fáze assetů (zvuky, textury): 48 % -> 62 %
            const phasePercent = Math.round(48 + (taskFraction * 14));
            const text = (e.task >= e.total)
                ? 'Herní textury a data připraveny'
                : `Stahuji herní textury a data (${Math.round(taskFraction * 100)} %)...`;
            pushMilestone(phasePercent, text);
        } else if (e.type === 'natives') {
            currentPhase = 'natives';
            const phasePercent = Math.round(62 + (taskFraction * 4));
            pushMilestone(phasePercent, 'Příprava nativních systémových knihoven...');
        } else {
            const phasePercent = Math.round(15 + (taskFraction * 45));
            pushMilestone(phasePercent, 'Příprava herních souborů...');
        }
    });

    launcher.on('download-status', (e) => {
        const fileFraction = (e.total && e.total > 0) ? Math.min(1, Math.max(0, e.current / e.total)) : 0;

        if (currentPhase === 'init') {
            const phasePercent = Math.round(10 + (fileFraction * 10));
            pushMilestone(phasePercent, `Stahuji jádro hry (${e.name || 'Minecraft'})...`);
        } else if (currentPhase === 'classes') {
            currentStatusText = `Stahuji herní knihovny (${e.name || 'soubor'})...`;
        } else if (currentPhase === 'assets') {
            currentStatusText = `Stahuji herní textury a data...`;
        }
    });

    launcher.on('data', (e) => {
        const line = String(e || '');
        onLog(`[GAME] ${line}`);

        // ⚡ Živé milníky herního procesu (start JVM, načítání módů, Mixiny, GPU, okno)
        if (line.includes('Loading Minecraft') || line.includes('KnotClient') || line.includes('Fabric Loader')) {
            pushMilestone(68, 'Zavádění zavaděče Fabric a herního jádra...');
        } else if (line.includes('Loading ') && line.includes('mods')) {
            const modMatch = line.match(/Loading\s+(\d+)\s+mods/i);
            const modText = modMatch ? `Zavádění ${modMatch[1]} módů a doplňků...` : 'Zavádění herních módů a doplňků...';
            pushMilestone(74, modText);
        } else if (line.includes('SpongePowered MIXIN') || line.includes('MixinExtras') || line.includes('BadOptimizations') || line.includes('Lithium') || line.includes('Sodium')) {
            pushMilestone(82, 'Aplikace herních optimalizací (Mixin)...');
        } else if (line.includes('Searching for graphics cards') || line.includes('Found graphics adapter') || line.includes('preferredGraphicsBackend')) {
            pushMilestone(87, 'Inicializace grafické karty a GPU...');
        } else if (line.includes('Datafixer') || line.includes('Datafixer optimizations')) {
            pushMilestone(91, 'Optimalizace herních struktur a dat...');
        } else if (line.includes('Backend library: LWJGL') || line.includes('Setting user:') || line.includes('Setting exclusive fullscreen')) {
            pushMilestone(95, 'Vytváření herního okna...');
        } else if (line.includes('Using graphics backend') || line.includes('GL_') || line.includes('VK_')) {
            pushMilestone(98, 'Otevírání Minecraftu...');
        }
    });

    launcher.on('close', (code) => {
        launchFinished = true;
        if (launcher._progressTicker) {
            clearInterval(launcher._progressTicker);
            launcher._progressTicker = null;
        }
        activeMinecraftProcess = null;
        onExit(code);
    });

    try {
        const proc = await launcher.launch(opts);
        if (launcher._isCancelled) {
            activeMinecraftProcess = null;
            return null;
        }
        if (!proc) {
            activeMinecraftProcess = null;
            throw new Error(lastMclcError || 'Minecraft proces se nepodařilo nastartovat (MCLC selhalo při inicializaci).');
        }
        activeMinecraftProcess = proc;
        pushMilestone(66, 'Spouštění herního enginu...');

        if (process.platform === 'win32' && config.winHighPriority !== false && proc && proc.pid) {
            try {
                const os = require('os');
                os.setPriority(proc.pid, os.constants.priority.PRIORITY_HIGH);
                onLog(`[WINDOWS] Procesu Minecraftu (PID ${proc.pid}) byla přidělena VYSOKÁ priorita procesoru.`);
            } catch (_) {
                try {
                    const { exec } = require('child_process');
                    exec(`wmic process where processid=${proc.pid} CALL setpriority "High Priority"`, () => {});
                } catch (_) {}
            }
        }
        if (onProgress) {
            onProgress({
                percent: 100,
                text: 'Spouštíme Minecraft!'
            });
        }
    } catch (e) {
        if (launcher._isCancelled) {
            activeMinecraftProcess = null;
            return null;
        }
        throw e;
    } finally {
        launchFinished = true;
        if (launcher._progressTicker) {
            clearInterval(launcher._progressTicker);
            launcher._progressTicker = null;
        }
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

        if (activeLauncherClient._progressTicker) {
            try { clearInterval(activeLauncherClient._progressTicker); } catch (_) { }
            activeLauncherClient._progressTicker = null;
        }

        if (activeLauncherClient._activeControllers) {
            for (const ctrl of activeLauncherClient._activeControllers) {
                try { ctrl.abort(); } catch (e) { }
            }
            activeLauncherClient._activeControllers.clear();
        }

        if (activeLauncherClient._activeRequests) {
            for (const req of activeLauncherClient._activeRequests) {
                try { req.abort(); } catch (e) { }
            }
            activeLauncherClient._activeRequests.clear();
        }

        if (activeLauncherClient._activeStreams) {
            for (const [filePath, st] of activeLauncherClient._activeStreams.entries()) {
                try { st.destroy(); } catch (e) { }
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) { }
            }
            activeLauncherClient._activeStreams.clear();
        }

        if (activeLauncherClient._sessionDownloadedFiles) {
            for (const filePath of activeLauncherClient._sessionDownloadedFiles) {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) { }
            }
            activeLauncherClient._sessionDownloadedFiles.clear();
        }
    }

    isIntentionalTermination = true;

    if (activeMinecraftProcess) {
        try {
            activeMinecraftProcess.kill();
        } catch (e) { }
        activeMinecraftProcess = null;
    }

    activeLauncherClient = null;
    currentLaunchInfo = null;
    return true;
}

function killGame() {
    isIntentionalTermination = true;
    return cancelLaunch();
}

// ── Minecraft Hudba & Zvuky (DLC) ───────────────────────────────────────────
let activeDlcAbortController = null;

async function getOrFetchAssetIndex(baseDir, targetVersion = '26.2') {
    const assetsDir = path.join(baseDir, 'assets');
    const indexesDir = path.join(assetsDir, 'indexes');
    const indexFile = path.join(indexesDir, `${targetVersion}.json`);

    // 1. Přímá kontrola kandidátů v lokální složce (targetVersion, 32.json pro 26.2, 26.2.json)
    const localCandidates = [
        indexFile,
        path.join(indexesDir, '32.json'),
        path.join(indexesDir, '26.2.json'),
        path.join(indexesDir, '26.3.json')
    ];
    for (const cPath of localCandidates) {
        if (fs.existsSync(cPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(cPath, 'utf8'));
                if (parsed && parsed.objects && Object.keys(parsed.objects).length > 50) return parsed;
            } catch (e) {
                try { fs.unlinkSync(cPath); } catch (_) { }
            }
        }
    }

    // 2. Prohledat jakýkoliv jiný platný .json v indexesDir
    if (fs.existsSync(indexesDir)) {
        try {
            const files = fs.readdirSync(indexesDir).filter(f => f.endsWith('.json'));
            for (const f of files) {
                const fPath = path.join(indexesDir, f);
                try {
                    const parsed = JSON.parse(fs.readFileSync(fPath, 'utf8'));
                    if (parsed && parsed.objects && Object.keys(parsed.objects).length > 50) return parsed;
                } catch (e) {
                    try { fs.unlinkSync(fPath); } catch (_) { }
                }
            }
        } catch (e) { }
    }

    // 3. Vestavěné asset indexy v launcheru (Offline bundle)
    const bundledDirs = [
        path.join(__dirname, '..', '..', 'assets', 'indexes'),
        path.join(process.resourcesPath || '', 'assets', 'indexes'),
        path.join(process.resourcesPath || '', 'app', 'assets', 'indexes')
    ];
    try {
        const { app } = require('electron');
        if (app && typeof app.getAppPath === 'function') {
            bundledDirs.push(path.join(app.getAppPath(), 'assets', 'indexes'));
        }
    } catch (_) { }

    for (const bDir of bundledDirs) {
        if (fs.existsSync(bDir)) {
            const bCandidates = [
                path.join(bDir, `${targetVersion}.json`),
                path.join(bDir, '32.json'),
                path.join(bDir, '26.2.json'),
                path.join(bDir, '26.3.json')
            ];
            for (const bPath of bCandidates) {
                if (fs.existsSync(bPath)) {
                    try {
                        const parsed = JSON.parse(fs.readFileSync(bPath, 'utf8'));
                        if (parsed && parsed.objects && Object.keys(parsed.objects).length > 50) {
                            try {
                                fs.mkdirSync(indexesDir, { recursive: true });
                                fs.copyFileSync(bPath, indexFile);
                                fs.copyFileSync(bPath, path.join(indexesDir, '32.json'));
                            } catch (_) { }
                            return parsed;
                        }
                    } catch (_) { }
                }
            }
        }
    }

    // 4. Prohledat existující instalace (.minecraft / Prism)
    try {
        const extBases = getExistingMinecraftBaseDirs();
        for (const extBase of extBases) {
            const extIdxDir = path.join(extBase, 'assets', 'indexes');
            const extCandidates = [
                path.join(extIdxDir, `${targetVersion}.json`),
                path.join(extIdxDir, '32.json'),
                path.join(extIdxDir, '26.2.json')
            ];
            for (const extPath of extCandidates) {
                if (fs.existsSync(extPath)) {
                    try {
                        const parsed = JSON.parse(fs.readFileSync(extPath, 'utf8'));
                        if (parsed && parsed.objects && Object.keys(parsed.objects).length > 50) {
                            try {
                                fs.mkdirSync(indexesDir, { recursive: true });
                                fs.copyFileSync(extPath, indexFile);
                                fs.copyFileSync(extPath, path.join(indexesDir, '32.json'));
                            } catch (_) { }
                            return parsed;
                        }
                    } catch (_) { }
                }
            }
        }
    } catch (_) { }

    // 5. Online stažení z Mojangu / zrcadel
    try {
        fs.mkdirSync(indexesDir, { recursive: true });
        const manifestRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(8000) });
        if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            let vEntry = manifest.versions.find(v => v.id === targetVersion) ||
                (targetVersion === '1.21.11' ? manifest.versions.find(v => v.id === '1.21.1') : null) ||
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
                            if (vJson.assetIndex.id) {
                                try {
                                    fs.writeFileSync(path.join(indexesDir, `${vJson.assetIndex.id}.json`), indexText, 'utf8');
                                } catch (_) { }
                            }
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
        try { activeDlcAbortController.abort(); } catch (e) { }
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
                } catch (e) { }
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
        try { activeDlcAbortController.abort(); } catch (e) { }
        activeDlcAbortController = null;
        return true;
    }
    return false;
}

/**
 * ⚡ Asynchronní pre-warm spouštěcího prostředí na pozadí při startu launcheru:
 * - Ověří manifest verze z Mojangu na pozadí, takže při kliknutí na "Hrát" je verze připravena bez prodlevy.
 * - Zachešuje kompatibilní runtime Javy v paměti (0 ms znovutestování procesů).
 * - Zachešuje systémovou konfiguraci GPU/GameMode na Linuxu.
 */
async function prewarmLaunchEnvironment(centralRootDir, targetVersion = '26.2', config = null) {
    // ⚡ Okamžité nasazení vestavěných asset indexů (32.json, 26.2.json, 26.3.json) do assets/indexes
    try {
        const root = centralRootDir || BASE_DIR;
        const indexesDir = path.join(root, 'assets', 'indexes');
        fs.mkdirSync(indexesDir, { recursive: true });

        const bundledDirs = [
            path.join(__dirname, '..', '..', 'assets', 'indexes'),
            path.join(process.resourcesPath || '', 'assets', 'indexes'),
            path.join(process.resourcesPath || '', 'app', 'assets', 'indexes')
        ];
        try {
            const { app } = require('electron');
            if (app && typeof app.getAppPath === 'function') {
                bundledDirs.push(path.join(app.getAppPath(), 'assets', 'indexes'));
            }
        } catch (_) { }

        for (const bDir of bundledDirs) {
            if (fs.existsSync(bDir)) {
                const bFiles = fs.readdirSync(bDir).filter(f => f.endsWith('.json'));
                for (const f of bFiles) {
                    const src = path.join(bDir, f);
                    const dest = path.join(indexesDir, f);
                    try {
                        if (!fs.existsSync(dest) || fs.statSync(dest).size < 100) {
                            fs.copyFileSync(src, dest);
                        }
                    } catch (_) { }
                }
            }
        }

        // Pokud existuje 32.json nebo 26.2.json, vzájemně se synchronizují
        const p32 = path.join(indexesDir, '32.json');
        const p26_2 = path.join(indexesDir, '26.2.json');
        if (fs.existsSync(p32) && (!fs.existsSync(p26_2) || fs.statSync(p26_2).size < 100)) {
            try { fs.copyFileSync(p32, p26_2); } catch (_) { }
        } else if (fs.existsSync(p26_2) && (!fs.existsSync(p32) || fs.statSync(p32).size < 100)) {
            try { fs.copyFileSync(p26_2, p32); } catch (_) { }
        }
    } catch (_) { }

    try {
        await ensureMojangVersionUpToDate(centralRootDir || BASE_DIR, targetVersion, () => { }, true);
    } catch (_) { }

    try {
        if (config) {
            await ensureJavaExecutable(config, () => { });
        }
    } catch (_) { }

    try {
        if (process.platform === 'linux') {
            getLinuxPlatformPerformanceInfo();
        }
    } catch (_) { }

    try {
        isServerHostResolvable('mychalsmp.xyz').catch(() => {});
    } catch (_) { }
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
    getRequiredJavaVersion,
    ensureProfileModsDependencies,
    isJarFileValid,
    ensureSelfNametagModInstalled,
    ensureMojangVersionUpToDate,
    prewarmLaunchEnvironment,
    markIntentionalTermination,
    wasTerminationIntentional,
    resetTerminationIntent
};
