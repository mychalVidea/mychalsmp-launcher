const fs = require('fs');
const path = require('path');
const os = require('os');
const { protectAccount, unprotectAccount } = require('./cryptoVault');

function getBaseDirectory() {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, '.mychalsmp');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'mychalsmp');
    } else {
        return path.join(os.homedir(), '.mychalsmp');
    }
}

const BASE_DIR = getBaseDirectory();
const CONFIG_FILE = path.join(BASE_DIR, 'launcher-config.json');

const DEFAULT_PROFILES = [
    {
        id: 'minecraft-26.3',
        name: 'Minecraft 26.3',
        version: '26.3',
        loader: 'fabric',
        optimizedChosen: 'optimized',
        desc: 'Minecraft 26.3',
        icon: 'latest',
        lastPlayed: null,
        playtimeSeconds: 0
    },
    {
        id: 'minecraft-26.2',
        name: 'Minecraft 26.2',
        version: '26.2',
        loader: 'fabric',
        optimizedChosen: 'optimized',
        desc: 'Minecraft 26.2',
        icon: 'sword',
        lastPlayed: null,
        playtimeSeconds: 0
    },
    {
        id: 'minecraft-26.1.2',
        name: 'Minecraft 26.1.2',
        version: '26.1.2',
        loader: 'fabric',
        optimizedChosen: 'optimized',
        desc: 'Minecraft 26.1.2',
        icon: 'chest',
        lastPlayed: null,
        playtimeSeconds: 0
    },
    {
        id: 'minecraft-1.21.11',
        name: 'Minecraft 1.21.11',
        version: '1.21.11',
        loader: 'fabric',
        optimizedChosen: 'optimized',
        desc: 'Minecraft 1.21.11',
        icon: 'shield',
        lastPlayed: null,
        playtimeSeconds: 0
    }
];

const DEFAULT_SERVERS = [
    {
        id: 'mychalsmp',
        name: 'MYCHAL SMP',
        ip: 'mychalsmp.xyz',
        backupIp: '130.61.89.37',
        port: 25565,
        pinned: true,
        lastJoined: Date.now()
    }
];

const DEFAULT_CONFIG = {
    username: 'Hrac' + Math.floor(100 + Math.random() * 900),
    offlineUsername: 'Hrac' + Math.floor(100 + Math.random() * 900),
    authType: 'offline', // 'offline' | 'microsoft'
    microsoftAccount: null,
    ramMin: 2,
    ramMax: 4,
    javaPath: '',
    resolution: {
        width: 1280,
        height: 720,
        fullscreen: false
    },
    version: '26.3',
    loader: 'fabric',
    activeProfileId: 'minecraft-26.3',
    profiles: DEFAULT_PROFILES,
    servers: DEFAULT_SERVERS,
    autoConnectServer: false,
    serverIp: 'mychalsmp.xyz',
    serverPort: 25565,
    customJvmArgs: '-XX:+UseZGC -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC',
    enableGameMode: true,
    enableDiscreteGpu: true,
    enableZink: false,
    disableVsync: false,
    customEnvVars: '',
    installedMods: [],
    enableNativeWayland: false,
    enableDiscordRpc: true,
    autoUpdateMods: true,
    screenshotToClipboard: true,
    borderlessFullscreen: false,
    graphicsBackend: 'default', // 'default' | 'vulkan' | 'opengl'
    // Windows specifické optimalizace
    winHighPriority: true,
    winDedicatedGpu: true,
    winWindowedOptimization: true,
    winDisableStickyKeys: true,
    winTrimMemory: true,
    customSkinPath: null,
    customSkinVariant: 'classic',
    customCapePath: null
};

function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadConfig() {
    try {
        ensureDirSync(BASE_DIR);
        let parsed = null;
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
                if (raw && raw.trim().length > 0) {
                    parsed = JSON.parse(raw);
                }
            } catch (parseErr) {
                console.error('[CONFIG] Chyba parsování CONFIG_FILE, zkouším zálohu .bak:', parseErr);
                const bakFile = `${CONFIG_FILE}.bak`;
                if (fs.existsSync(bakFile)) {
                    try {
                        const rawBak = fs.readFileSync(bakFile, 'utf-8');
                        if (rawBak && rawBak.trim().length > 0) {
                            parsed = JSON.parse(rawBak);
                        }
                    } catch (bakErr) {
                        console.error('[CONFIG] Selhalo i načtení .bak:', bakErr);
                    }
                }
            }
        }

        if (parsed) {
            if (parsed.microsoftAccount) {
                parsed.microsoftAccount = unprotectAccount(parsed.microsoftAccount);
            }
            const merged = {
                ...DEFAULT_CONFIG,
                ...parsed,
                resolution: {
                    ...DEFAULT_CONFIG.resolution,
                    ...(parsed.resolution || {})
                },
                baseDir: BASE_DIR
            };
            if (typeof merged.customJvmArgs === 'string') {
                merged.customJvmArgs = merged.customJvmArgs.replace(/-XX:\+AlwaysPreTouch\s*/g, '').trim();
            }
            if (!merged.offlineUsername) {
                merged.offlineUsername = (merged.authType === 'offline' && merged.username) ? merged.username : 'Hrac';
            }
            // Ensure profiles exist
            if (!merged.profiles || merged.profiles.length === 0) {
                merged.profiles = DEFAULT_PROFILES;
            } else {
                merged.profiles.forEach(p => {
                    if (typeof p.lastPlayed === 'string' && (p.lastPlayed.includes('Právě') || p.lastPlayed.includes('hodinami') || p.lastPlayed.includes('Včera'))) {
                        p.lastPlayed = null;
                    }
                    if (!p.loader) {
                        p.loader = 'fabric';
                    }
                    if (!p.optimizedChosen) {
                        p.optimizedChosen = p.loader === 'fabric' ? 'optimized' : 'vanilla';
                    }
                    if (typeof p.playtimeSeconds !== 'number') {
                        p.playtimeSeconds = 0;
                    }
                });
            }
            if (!merged.servers || merged.servers.length === 0) {
                merged.servers = DEFAULT_SERVERS;
            } else {
                merged.servers.forEach(s => {
                    if (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz') {
                        s.backupIp = '130.61.89.37';
                    }
                });
            }
            if (merged.ramMax !== undefined || merged.ramMin !== undefined) {
                let max = parseInt(merged.ramMax, 10);
                let min = parseInt(merged.ramMin, 10);
                if (isNaN(max) || max < 1) max = 4;
                if (isNaN(min) || min < 1) min = 2;
                if (min > max) min = max;
                merged.ramMax = max;
                merged.ramMin = min;
            }
            return merged;
        }
    } catch (err) {
        console.error('Chyba při načítání konfigurace launcheru:', err);
    }
    return { ...DEFAULT_CONFIG, baseDir: BASE_DIR };
}

function safeAtomicWriteSync(filePath, content) {
    const tmpFile = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
        fs.writeFileSync(tmpFile, content, 'utf-8');
        if (process.platform === 'win32') {
            try {
                fs.copyFileSync(tmpFile, filePath);
                try { fs.unlinkSync(tmpFile); } catch (_) { }
                return;
            } catch (_) { }
        }
        fs.renameSync(tmpFile, filePath);
    } catch (err) {
        // Fallback: přímý zápis pokud rename/copy selže
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            try { fs.unlinkSync(tmpFile); } catch (_) { }
        } catch (e2) {
            console.error(`[CONFIG] Kritická chyba zápisu do ${filePath}:`, e2);
        }
    }
}

function saveConfig(newConfig) {
    let merged = null;
    try {
        ensureDirSync(BASE_DIR);
        const current = loadConfig();
        const cleanedNewConfig = {};
        for (const [k, v] of Object.entries(newConfig || {})) {
            if (v !== undefined) {
                cleanedNewConfig[k] = v;
            }
        }

        // Nikdy nesmažeme uložený Microsoft účet omylem, pokud to caller výslovně nepožaduje přes clearMicrosoftAccount: true
        if (cleanedNewConfig.microsoftAccount === null && !newConfig.clearMicrosoftAccount) {
            delete cleanedNewConfig.microsoftAccount;
        }

        // Pokud caller poskytuje microsoftAccount, zachováme citlivé tokeny z current, pokud je vynechal
        if (cleanedNewConfig.microsoftAccount && current.microsoftAccount) {
            const curAcc = current.microsoftAccount;
            const newAcc = cleanedNewConfig.microsoftAccount;
            if (!newAcc.refreshToken && curAcc.refreshToken) {
                newAcc.refreshToken = curAcc.refreshToken;
            }
            if (!newAcc.access_token && curAcc.access_token) {
                newAcc.access_token = curAcc.access_token;
            }
            if (!newAcc.client_token && curAcc.client_token) {
                newAcc.client_token = curAcc.client_token;
            }
            if (curAcc.meta?.refresh && (!newAcc.meta || !newAcc.meta.refresh)) {
                newAcc.meta = { ...(newAcc.meta || {}), refresh: curAcc.meta.refresh };
            }
        }

        merged = {
            ...current,
            ...cleanedNewConfig,
            resolution: (cleanedNewConfig && cleanedNewConfig.resolution)
                ? { ...(current.resolution || {}), ...cleanedNewConfig.resolution }
                : current.resolution
        };
        if (merged.ramMax !== undefined || merged.ramMin !== undefined) {
            let max = parseInt(merged.ramMax, 10);
            let min = parseInt(merged.ramMin, 10);
            if (isNaN(max) || max < 1) max = 4;
            if (isNaN(min) || min < 1) min = 2;
            if (min > max) min = max;
            merged.ramMax = max;
            merged.ramMin = min;
        }

        delete merged.baseDir;

        // Před zápisem na disk zašifrujeme veškeré autentizační tokeny na hardwarový klíč PC
        const diskReady = { ...merged };
        if (diskReady.microsoftAccount) {
            diskReady.microsoftAccount = protectAccount(diskReady.microsoftAccount);
        }

        safeAtomicWriteSync(CONFIG_FILE, JSON.stringify(diskReady, null, 2));
        try {
            fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);
        } catch (e) { }
        return { ...merged, baseDir: BASE_DIR };
    } catch (err) {
        console.error('Chyba při ukládání konfigurace launcheru:', err);
        return merged ? { ...merged, baseDir: BASE_DIR } : { ...DEFAULT_CONFIG, baseDir: BASE_DIR };
    }
}

module.exports = {
    BASE_DIR,
    CONFIG_FILE,
    DEFAULT_CONFIG,
    DEFAULT_PROFILES,
    DEFAULT_SERVERS,
    loadConfig,
    saveConfig
};
