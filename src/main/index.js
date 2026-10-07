const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, BASE_DIR } = require('./config');
const { pingServer } = require('./serverPing');
const { createOfflineAuth, loginMicrosoft } = require('./auth');
const {
    launchGame,
    isGameRunning,
    killGame,
    detectJavaPath,
    getAvailableJavas,
    getInstalledVersions
} = require('./launcher');
const { searchModrinth, downloadModOrPack } = require('./modrinth');
const {
    scanInstanceDirectory,
    importInstanceProfile,
    upgradeProfile
} = require('./profileManager');
const {
    getMojangProfile,
    uploadMojangSkin,
    resetMojangSkin,
    setMojangCape
} = require('./skinService');
const {
    scanProfileForBlacklistedMods,
    disableIllegalMod,
    disableAllIllegalMods
} = require('./wardenProbeChecker');
const { checkForUpdates, applyUpdate } = require('./updateService');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 740,
        minWidth: 980,
        minHeight: 640,
        frame: false, // Custom sleek titlebar
        backgroundColor: '#0a0b12',
        show: false,
        icon: path.join(__dirname, '../renderer/assets/server-icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
function ensureLinuxDesktopShortcut() {
    if (process.platform !== 'linux') return;
    try {
        const homeDir = require('os').homedir();
        const execPath = process.execPath;
        const iconSource = path.join(__dirname, '../renderer/assets/server-icon.png');

        const iconDir = path.join(homeDir, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');
        if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });
        const iconDest = path.join(iconDir, 'mychalsmp-launcher.png');
        if (fs.existsSync(iconSource)) {
            try { fs.copyFileSync(iconSource, iconDest); } catch (e) { }
        }

        const desktopContent = `[Desktop Entry]
Name=MYCHAL SMP Launcher
Comment=Oficiální Minecraft launcher sítě MYCHAL SMP
Exec="${execPath}" %U
Icon=${fs.existsSync(iconDest) ? iconDest : 'mychalsmp-launcher'}
Terminal=false
Type=Application
Categories=Game;ActionGame;AdventureGame;
StartupWMClass=xyz.mychalsmp.launcher
`;

        // 1. Applications Menu
        const appsDir = path.join(homeDir, '.local', 'share', 'applications');
        if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true });
        const appDesktopFile = path.join(appsDir, 'mychalsmp-launcher.desktop');
        fs.writeFileSync(appDesktopFile, desktopContent, 'utf-8');
        try { fs.chmodSync(appDesktopFile, 0o755); } catch (e) { }

        // 2. Desktop folder (Desktop or Plocha)
        const desktopCandidates = [
            path.join(homeDir, 'Desktop'),
            path.join(homeDir, 'Plocha')
        ];
        for (const d of desktopCandidates) {
            if (fs.existsSync(d)) {
                const target = path.join(d, 'MYCHAL SMP Launcher.desktop');
                fs.writeFileSync(target, desktopContent, 'utf-8');
                try { fs.chmodSync(target, 0o755); } catch (e) { }
            }
        }
    } catch (err) {
        console.error('Chyba při tvorbě desktop ikony:', err);
    }
}

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        ensureLinuxDesktopShortcut();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => {
    return loadConfig();
});

ipcMain.handle('save-config', (event, newConfig) => {
    return saveConfig(newConfig);
});

ipcMain.handle('ping-server', async (event, ip = 'mychalsmp.xyz', port = 25565) => {
    return await pingServer(ip, port);
});

ipcMain.handle('get-installed-versions', () => {
    return getInstalledVersions(BASE_DIR);
});

ipcMain.handle('get-available-javas', () => {
    return getAvailableJavas();
});

ipcMain.handle('detect-java', () => {
    return detectJavaPath();
});

ipcMain.handle('search-modrinth', async (event, query, version, loader, category, projectType) => {
    return await searchModrinth(query, version, loader, category, projectType);
});

ipcMain.handle('download-mod-or-pack', async (event, modOptions) => {
    const config = loadConfig();
    const activeProfile = (config.profiles || []).find(p => p.id === config.activeProfileId) || config.profiles[0];
    const targetDir = activeProfile.gameDir || BASE_DIR;
    try {
        const res = await downloadModOrPack(modOptions, targetDir);
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('toggle-mod', (event, modId) => {
    const config = loadConfig();
    let mods = config.installedMods || [];
    if (mods.includes(modId)) {
        mods = mods.filter(m => m !== modId);
    } else {
        mods.push(modId);
    }
    saveConfig({ installedMods: mods });
    return mods;
});

ipcMain.handle('login-offline', (event, username) => {
    const config = loadConfig();
    const auth = createOfflineAuth(username);
    // Offline mode: Keep existing customSkinPath and customCapePath so they persist across any nick!
    saveConfig({ username: auth.name, authType: 'offline' });
    return {
        success: true,
        auth,
        profile: {
            name: auth.name,
            skinUrl: config.customSkinPath || auth.skinUrl,
            customSkinPath: config.customSkinPath,
            customSkinVariant: config.customSkinVariant || 'classic',
            customCapePath: config.customCapePath
        }
    };
});

ipcMain.handle('login-microsoft', async () => {
    const res = await loginMicrosoft(mainWindow);
    if (res.success) {
        saveConfig({
            username: res.profile.name,
            authType: 'microsoft',
            microsoftAccount: {
                ...res.auth,
                skinUrl: res.profile.skinUrl,
                skins: res.profile.skins || [],
                capes: res.profile.capes || []
            }
        });
    }
    return res;
});

ipcMain.handle('is-game-running', () => {
    return isGameRunning();
});

ipcMain.handle('kill-game', () => {
    killGame();
    return true;
});

ipcMain.handle('launch-game', async (event, profileId, serverIp) => {
    const config = loadConfig();
    let authData;

    if (config.authType === 'microsoft' && config.microsoftAccount) {
        authData = config.microsoftAccount;
    } else {
        authData = createOfflineAuth(config.username);
    }

    // Select profile
    const activeId = profileId || config.activeProfileId || 'minecraft-26.2';
    const profile = (config.profiles || []).find(p => p.id === activeId) || {
        version: '26.2',
        loader: 'vanilla'
    };

    // Update active profile and timestamps with real Date.now()
    const updatedProfiles = (config.profiles || []).map(p => {
        if (p.id === activeId) {
            return { ...p, lastPlayed: Date.now() };
        }
        return p;
    });

    // Update server lastJoined if server passed
    let updatedServers = config.servers || [];
    if (serverIp) {
        updatedServers = updatedServers.map(s => {
            if (s.ip === serverIp || s.subdomain === serverIp) {
                return { ...s, lastJoined: Date.now() };
            }
            return s;
        });
    }

    saveConfig({
        activeProfileId: activeId,
        version: profile.version,
        loader: profile.loader,
        profiles: updatedProfiles,
        servers: updatedServers
    });

    const launchConfig = {
        ...config,
        version: profile.version,
        loader: profile.loader,
        baseDir: profile.gameDir || config.baseDir
    };

    if (serverIp && (serverIp.includes('mychalsmp.xyz') || serverIp.includes('mychalsmp'))) {
        const probeScan = scanProfileForBlacklistedMods(launchConfig.baseDir);
        if (!probeScan.clean) {
            return {
                success: false,
                blockedByWarden: true,
                illegalMods: probeScan.illegalMods,
                error: `Přístup na MYCHAL SMP byl zablokován z bezpečnostních důvodů. Nalezeno nepovolených módů: ${probeScan.blockedCount}.`
            };
        }
    }

    try {
        await launchGame(
            launchConfig,
            authData,
            serverIp,
            (progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launch-progress', progress);
                }
            },
            (logLine) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launch-log', logLine);
                }
            },
            (exitCode) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launch-exit', exitCode);
                }
            }
        );
        return { success: true };
    } catch (err) {
        console.error('Chyba při spouštění hry:', err);
        return { success: false, error: err.message };
    }
});

// Profile Import & Upgrade IPC Handlers
ipcMain.handle('import-profile-dialog', async () => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Vyber složku profilu / instance (Prism, CurseForge, Modrinth, .minecraft)',
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
    }
    const dirPath = result.filePaths[0];
    try {
        const scan = scanInstanceDirectory(dirPath);
        return { canceled: false, scan };
    } catch (e) {
        return { canceled: false, error: e.message };
    }
});

ipcMain.handle('confirm-import-profile', async (event, importData) => {
    try {
        const res = await importInstanceProfile(importData, BASE_DIR);
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('upgrade-profile', async (event, sourceProfileId, targetVersion) => {
    try {
        const res = await upgradeProfile(sourceProfileId, targetVersion, BASE_DIR, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('upgrade-progress', progress);
            }
        });
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Profile Management IPC Handlers
ipcMain.handle('open-profile-folder', async (event, profileId, subfolder) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    let folder = profile.gameDir || BASE_DIR;
    if (subfolder) {
        folder = path.join(folder, subfolder);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    }
    shell.openPath(folder);
    return true;
});

ipcMain.handle('update-profile-settings', async (event, profileId, updates) => {
    const config = loadConfig();
    const profiles = (config.profiles || []).map(p => {
        if (p.id === profileId) {
            return { ...p, ...updates };
        }
        return p;
    });
    saveConfig({ profiles });
    return { success: true };
});

ipcMain.handle('delete-profile', async (event, profileId) => {
    const config = loadConfig();
    if (profileId === 'minecraft-26.2' || profileId === 'mychalsmp-26.2') {
        return { success: false, error: 'Výchozí doporučený profil nelze smazat.' };
    }
    const profile = (config.profiles || []).find(p => p.id === profileId);
    if (profile && profile.gameDir && fs.existsSync(profile.gameDir)) {
        try {
            fs.rmSync(profile.gameDir, { recursive: true, force: true });
        } catch (e) { }
    }
    const updated = (config.profiles || []).filter(p => p.id !== profileId);
    const newActive = config.activeProfileId === profileId
        ? (updated[0] ? updated[0].id : 'mychalsmp-26.2')
        : config.activeProfileId;
    saveConfig({ profiles: updated, activeProfileId: newActive });
    return { success: true, activeProfileId: newActive };
});

ipcMain.handle('reset-launcher-data', async () => {
    try {
        killGame();
        if (fs.existsSync(BASE_DIR)) {
            const items = fs.readdirSync(BASE_DIR);
            for (const item of items) {
                const target = path.join(BASE_DIR, item);
                try {
                    fs.rmSync(target, { recursive: true, force: true });
                } catch (e) { }
            }
        }
        const fresh = saveConfig({});
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('select-skin-file', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Vyber soubor skinu (.png)',
        filters: [{ name: 'Minecraft Skin', extensions: ['png'] }],
        properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const dest = path.join(BASE_DIR, 'custom_skin.png');
        fs.copyFileSync(filePath, dest);
        return dest;
    }
    return null;
});

ipcMain.handle('select-cape-file', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Vyber soubor pláště (.png)',
        filters: [{ name: 'Minecraft Cape', extensions: ['png'] }],
        properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const dest = path.join(BASE_DIR, 'custom_cape.png');
        fs.copyFileSync(filePath, dest);
        return dest;
    }
    return null;
});

ipcMain.handle('save-offline-skin', async (event, skinData) => {
    const updates = {};
    if (skinData.skinPath !== undefined) updates.customSkinPath = skinData.skinPath;
    if (skinData.variant !== undefined) updates.customSkinVariant = skinData.variant;
    if (skinData.capePath !== undefined) updates.customCapePath = skinData.capePath;
    const cfg = saveConfig(updates);
    return { success: true, config: cfg };
});

ipcMain.handle('get-mojang-profile', async () => {
    const config = loadConfig();
    const token = config.microsoftAccount?.access_token;
    if (!token) return { success: false, error: 'Nejsi přihlášen k Microsoft účtu.' };
    return await getMojangProfile(token);
});

ipcMain.handle('upload-mojang-skin', async (event, filePath, variant) => {
    const config = loadConfig();
    const token = config.microsoftAccount?.access_token;
    if (!token) return { success: false, error: 'Nejsi přihlášen k Microsoft účtu.' };
    const res = await uploadMojangSkin(token, filePath, variant);
    if (res.success && res.skin) {
        if (config.microsoftAccount) {
            config.microsoftAccount.skinUrl = res.skin.url;
            saveConfig({ microsoftAccount: config.microsoftAccount });
        }
    }
    return res;
});

ipcMain.handle('reset-mojang-skin', async () => {
    const config = loadConfig();
    const token = config.microsoftAccount?.access_token;
    if (!token) return { success: false, error: 'Nejsi přihlášen k Microsoft účtu.' };
    return await resetMojangSkin(token);
});

ipcMain.handle('set-mojang-cape', async (event, capeId) => {
    const config = loadConfig();
    const token = config.microsoftAccount?.access_token;
    if (!token) return { success: false, error: 'Nejsi přihlášen k Microsoft účtu.' };
    return await setMojangCape(token, capeId);
});

ipcMain.on('open-game-dir', () => {
    shell.openPath(BASE_DIR);
});

ipcMain.on('open-url', (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        shell.openExternal(url);
    }
});

// Window controls
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

// Mod Safety IPC Handlers
ipcMain.handle('check-warden-probe', async (event, profileId) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const targetDir = (profile && profile.gameDir) ? profile.gameDir : (config.baseDir || BASE_DIR);
    return scanProfileForBlacklistedMods(targetDir);
});

ipcMain.handle('disable-illegal-mods', async (event, profileId, filename) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const targetDir = (profile && profile.gameDir) ? profile.gameDir : (config.baseDir || BASE_DIR);
    if (filename) {
        return disableIllegalMod(targetDir, filename);
    } else {
        return disableAllIllegalMods(targetDir);
    }
});

// Auto-Update IPC Handlers
ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates();
});

ipcMain.handle('apply-update', async (event, assetUrl) => {
    return await applyUpdate(assetUrl);
});

