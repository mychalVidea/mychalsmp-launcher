const { Client } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let activeMinecraftProcess = null;

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
    const javaExecutable = config.javaPath && fs.existsSync(config.javaPath)
        ? config.javaPath
        : detectJavaPath();

    const rootDir = config.baseDir;
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

    // Determine target version (e.g. 26.2, 26.3, 26.1.2)
    const targetVersion = config.version || '26.2';

    // JVM Arguments (optimized for Linux & Windows 11 performance)
    const jvmArgs = [
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC',
        '-XX:+AlwaysPreTouch',
        '-Dfile.encoding=UTF-8'
    ];

    if (config.customJvmArgs) {
        config.customJvmArgs.split(' ').forEach(arg => {
            if (arg.trim() && !jvmArgs.includes(arg.trim())) {
                jvmArgs.push(arg.trim());
            }
        });
    }

    // Direct Quick Play multiplayer connection
    let quickPlay = null;
    const serverToJoin = customServer || (config.autoConnectServer ? config.serverIp || 'mychalsmp.xyz' : null);
    if (serverToJoin) {
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

    activeMinecraftProcess = await launcher.launch(opts);
    return activeMinecraftProcess;
}

function isGameRunning() {
    return activeMinecraftProcess !== null;
}

function killGame() {
    if (activeMinecraftProcess) {
        try {
            activeMinecraftProcess.kill();
        } catch (e) {}
        activeMinecraftProcess = null;
    }
}

module.exports = {
    detectJavaPath,
    getAvailableJavas,
    getInstalledVersions,
    launchGame,
    isGameRunning,
    killGame
};
