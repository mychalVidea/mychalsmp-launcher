const { Client } = require('minecraft-launcher-core');
const Handler = require('minecraft-launcher-core/components/handler');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let activeMinecraftProcess = null;
let activeLauncherClient = null;
let currentLaunchInfo = null;

// Intercept Handler.prototype.downloadAsync so downloads can be cleanly aborted and cleaned up
Handler.prototype.downloadAsync = function(url, directory, name, retry, type) {
    if (this.client && this.client._isCancelled) {
        return Promise.reject(new Error('LAUNCH_CANCELLED'));
    }

    const fullPath = path.join(directory, name);
    if (this.client && this.client._sessionDownloadedFiles) {
        this.client._sessionDownloadedFiles.add(fullPath);
    }

    return new Promise((resolve, reject) => {
        if (this.client && this.client._isCancelled) {
            return reject(new Error('LAUNCH_CANCELLED'));
        }

        try {
            fs.mkdirSync(directory, { recursive: true });
        } catch (e) {}

        let _request;
        try {
            _request = this.baseRequest(url);
        } catch (e) {
            return resolve(false);
        }

        let fileStream = null;

        const cleanupReq = () => {
            if (this.client && this.client._activeRequests) {
                this.client._activeRequests.delete(_request);
            }
            if (fileStream && this.client && this.client._activeStreams) {
                this.client._activeStreams.delete(fullPath);
            }
        };

        if (this.client && this.client._activeRequests) {
            this.client._activeRequests.add(_request);
        }

        let receivedBytes = 0;
        let totalBytes = 0;

        _request.on('response', (data) => {
            if (this.client && this.client._isCancelled) {
                try { _request.abort(); } catch (e) {}
                cleanupReq();
                return resolve(false);
            }
            if (data.statusCode === 404) {
                this.client.emit('debug', `[MCLC]: Failed to download ${url} due to: File not found...`);
                cleanupReq();
                return resolve(false);
            }
            totalBytes = parseInt(data.headers['content-length']) || 0;
        });

        _request.on('error', async (error) => {
            cleanupReq();
            if (this.client && this.client._isCancelled) {
                return resolve(false);
            }
            this.client.emit('debug', `[MCLC]: Failed to download asset to ${fullPath} due to\n${error}. Retrying... ${retry}`);
            if (retry) {
                try {
                    await this.downloadAsync(url, directory, name, false, type);
                } catch (e) {}
            }
            resolve(false);
        });

        _request.on('data', (data) => {
            if (this.client && this.client._isCancelled) {
                try { _request.abort(); } catch (e) {}
                return;
            }
            receivedBytes += data.length;
            this.client.emit('download-status', {
                name: name,
                type: type,
                current: receivedBytes,
                total: totalBytes
            });
        });

        try {
            fileStream = fs.createWriteStream(fullPath);
            if (this.client && this.client._activeStreams) {
                this.client._activeStreams.set(fullPath, fileStream);
            }
            _request.pipe(fileStream);

            fileStream.once('finish', () => {
                cleanupReq();
                this.client.emit('download', name);
                resolve({
                    failed: false,
                    asset: null
                });
            });

            fileStream.on('error', async (e) => {
                cleanupReq();
                if (this.client && this.client._isCancelled) {
                    try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (err) {}
                    return resolve(false);
                }
                this.client.emit('debug', `[MCLC]: Failed to download asset to ${fullPath} due to\n${e}. Retrying... ${retry}`);
                try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (err) {}
                if (retry) {
                    try {
                        await this.downloadAsync(url, directory, name, false, type);
                    } catch (err) {}
                }
                resolve(false);
            });
        } catch (err) {
            cleanupReq();
            resolve(false);
        }
    });
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
            detached: false
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
