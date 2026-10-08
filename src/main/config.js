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
        loader: 'vanilla',
        desc: 'Minecraft 26.3',
        icon: 'latest',
        lastPlayed: null,
        playtimeSeconds: 0
    },
    {
        id: 'minecraft-26.2',
        name: 'Minecraft 26.2',
        version: '26.2',
        loader: 'vanilla',
        desc: 'Minecraft 26.2',
        icon: 'sword',
        lastPlayed: null,
        playtimeSeconds: 0
    },
    {
        id: 'minecraft-26.1.2',
        name: 'Minecraft 26.1.2',
        version: '26.1.2',
        loader: 'vanilla',
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
    loader: 'vanilla',
    activeProfileId: 'minecraft-26.2',
    profiles: DEFAULT_PROFILES,
    servers: DEFAULT_SERVERS,
    autoConnectServer: true,
    serverIp: 'mychalsmp.xyz',
    serverPort: 25565,
    customJvmArgs: '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions -XX:+AlwaysPreTouch -XX:+DisableExplicitGC',
    enableGameMode: true,
    enableMangoHud: false,
    enableDiscreteGpu: false,
    enableZink: false,
    disableVsync: false,
    customEnvVars: '',
    installedMods: [],
    enableNativeWayland: false,
    enableDiscordRpc: true,
    customSkinPath: null,
    customSkinVariant: 'classic',
    customCapePath: null,
    enableAudioDlc: true
};

function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadConfig() {
    try {
        ensureDirSync(BASE_DIR);
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            const merged = { ...DEFAULT_CONFIG, ...parsed, baseDir: BASE_DIR };
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
        const merged = { ...current, ...newConfig };
        delete merged.baseDir;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
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
