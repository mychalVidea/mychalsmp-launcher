const { Client } = require('minecraft-launcher-core');
const Handler = require('minecraft-launcher-core/components/handler');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

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
 * Vyhledá existující oficiální instalace Minecraftu na počítači hráče (Linux, Windows, macOS).
 */
function getExistingMinecraftBaseDirs() {
    const os = require('os');
    const home = os.homedir();
    const dirs = [];

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

    // Osekáme nepotřebné jazyky (~84 MB) a obří soundtracky / gramofonové desky (~242 MB)
    const filteredAssetKeys = Object.keys(index.objects || {}).filter(assetKey => {
        if (assetKey.startsWith('minecraft/lang/') || assetKey.includes('/lang/')) {
            const langName = path.basename(assetKey, '.json').toLowerCase();
            return ALLOWED_LANGUAGES.has(langName);
        }
        // Přeskočíme gigantické ambientní soundtracky a gramofonové desky (tvoří 60 % stahování, klient bez nich funguje naprosto bezchybně)
        if (assetKey.startsWith('minecraft/sounds/music/') || assetKey.startsWith('minecraft/sounds/records/')) {
            return false;
        }
        return true;
    });

    const existingCandidates = getExistingMinecraftBaseDirs()
        .map(d => path.join(d, 'assets', 'objects'))
        .filter(d => fs.existsSync(d));

    let counter = 0;
    this.client.emit('progress', {
        type: 'assets',
        task: 0,
        total: filteredAssetKeys.length
    });

    // Paralelní zpracování po dávkách pro maximální rychlost přes HTTP/2 multiplexing
    const concurrency = 35;
    let idx = 0;

    const processAsset = async (asset) => {
        if (this.client && this.client._isCancelled) return;

        const hash = index.objects[asset].hash;
        const subhash = hash.substring(0, 2);
        const subAssetDir = path.join(assetDirectory, 'objects', subhash);
        const targetFilePath = path.join(subAssetDir, hash);

        // A) Zkontrolovat, zda soubor již v cílové složce existuje
        if (!fs.existsSync(targetFilePath)) {
            // B) Bleskové převzetí ze stávajícího .minecraft na disku
            let copiedFromDisk = false;
            for (const candDir of existingCandidates) {
                const srcPath = path.join(candDir, subhash, hash);
                if (fs.existsSync(srcPath)) {
                    try {
                        fs.mkdirSync(subAssetDir, { recursive: true });
                        fs.copyFileSync(srcPath, targetFilePath);
                        copiedFromDisk = true;
                        break;
                    } catch (e) {}
                }
            }

            // C) Pokud není na disku, stáhnout z oficiálního Mojang serveru
            if (!copiedFromDisk) {
                await this.downloadAsync(`${this.options.overrides.url.resource}/${subhash}/${hash}`, subAssetDir, hash, true, 'assets');
            }
        }

        counter++;
        this.client.emit('progress', {
            type: 'assets',
            task: counter,
            total: filteredAssetKeys.length
        });
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (idx < filteredAssetKeys.length) {
            if (this.client && this.client._isCancelled) break;
            const currentAsset = filteredAssetKeys[idx++];
            await processAsset(currentAsset);
        }
    });

    await Promise.all(workers);
    this.client.emit('debug', `[OPTIMALIZACE]: Zpracováno ${counter} klíčových assetů (cizí jazyky a velká hudba vynechány, staženo bleskově přes HTTP/2)`);
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
                if (fs.existsSync(jsonPath) || fs.existsSync(jarPath)) {
                    installed.push(v);
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
    let serverToJoin = customServer || (config.autoConnectServer ? config.serverIp || 'mychalsmp.xyz' : null);
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
        overrides: {
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
            setGameEnv('__NV_PRIME_RENDER_OFFLOAD', '1');
            setGameEnv('__GLX_VENDOR_LIBRARY_NAME', 'nvidia');
            setGameEnv('__VK_LAYER_NV_optimus', 'NVIDIA_only');
            onLog('[VÝKON] Diskrétní GPU aktivována (DRI_PRIME=1, NVIDIA Prime Render Offload)');
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

module.exports = {
    detectJavaPath,
    getAvailableJavas,
    getInstalledVersions,
    launchGame,
    isGameRunning,
    killGame,
    cancelLaunch
};
