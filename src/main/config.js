const fs = require('fs');
const path = require('path');
const os = require('os');

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
        desc: 'Minecraft 26.1.2',
        icon: 'chest',
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
    version: '26.2',
    loader: 'fabric',
    activeProfileId: 'minecraft-26.2',
    profiles: DEFAULT_PROFILES,
    servers: DEFAULT_SERVERS,
    autoConnectServer: false,
    serverIp: 'mychalsmp.xyz',
    serverPort: 25565,
    customJvmArgs: '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions -XX:+AlwaysPreTouch -XX:+DisableExplicitGC',
    enableGameMode: true,
    enableMangoHud: false,
    enableDiscreteGpu: true,
    enableZink: false,
    disableVsync: false,
    customEnvVars: '',
    installedMods: [],
    enableNativeWayland: false,
    enableDiscordRpc: true,
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
            const merged = {
                ...DEFAULT_CONFIG,
                ...parsed,
                resolution: {
                    ...DEFAULT_CONFIG.resolution,
                    ...(parsed.resolution || {})
                },
                baseDir: BASE_DIR
            };
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
                        p.loader = 'vanilla';
                    }
                    if (p.name && (p.name.includes('Beacon') || p.name.includes('MYCHAL SMP') || p.name.startsWith('Vanilla ') || p.name.toLowerCase().includes('vanilla'))) {
                        p.name = `Minecraft ${p.version}`;
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
            return merged;
        }
    } catch (err) {
        console.error('Chyba při načítání konfigurace launcheru:', err);
    }
    return { ...DEFAULT_CONFIG, baseDir: BASE_DIR };
}

function saveConfig(newConfig) {
    try {
        ensureDirSync(BASE_DIR);
        const current = loadConfig();
        const cleanedNewConfig = {};
        for (const [k, v] of Object.entries(newConfig || {})) {
            if (v !== undefined) {
                cleanedNewConfig[k] = v;
            }
        }
        const merged = {
            ...current,
            ...cleanedNewConfig,
            resolution: (cleanedNewConfig && cleanedNewConfig.resolution)
                ? { ...(current.resolution || {}), ...cleanedNewConfig.resolution }
                : current.resolution
        };
        delete merged.baseDir;
        const tmpFile = `${CONFIG_FILE}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(merged, null, 2), 'utf-8');
        fs.renameSync(tmpFile, CONFIG_FILE);
        try {
            fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);
        } catch (e) {}
        return { ...merged, baseDir: BASE_DIR };
    } catch (err) {
        console.error('Chyba při ukládání konfigurace launcheru:', err);
        return null;
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
