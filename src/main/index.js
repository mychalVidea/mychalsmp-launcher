const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, BASE_DIR } = require('./config');
const { pingServer } = require('./serverPing');
const { createOfflineAuth, loginMicrosoft } = require('./auth');
const {
    launchGame,
    isGameRunning,
    killGame,
    cancelLaunch,
    detectJavaPath,
    getAvailableJavas,
    downloadAndInstallJava,
    getInstalledVersions,
    checkAudioDlcStatus,
    downloadAudioDlc,
    cancelAudioDlcDownload,
    setupOfflineCustomSkinAndCape
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
const { checkForUpdates, applyUpdate, getResourcesDir } = require('./updateService');
const { analyzeCrash, executeCrashFix } = require('./crashAnalyzer');
const { scanLauncherCache, cleanLauncherCache } = require('./cleaner');
const { discordRpc } = require('./discordRpc');

let mainWindow = null;
let splashWindow = null;
let appTray = null;

function setupTray() {
    if (appTray && !appTray.isDestroyed()) return appTray;
    try {
        const iconPath = path.join(__dirname, '../renderer/assets/logo.png');
        if (fs.existsSync(iconPath)) {
            const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
            appTray = new Tray(icon);
            const contextMenu = Menu.buildFromTemplate([
                { label: 'SMPClient', enabled: false },
                { type: 'separator' },
                {
                    label: 'Zobrazit launcher',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.show();
                            mainWindow.focus();
                        }
                    }
                },
                {
                    label: 'Minimalizovat',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.minimize();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Ukončit aplikaci',
                    click: () => {
                        app.quit();
                    }
                }
            ]);
            appTray.setToolTip('SMPClient 26.x');
            appTray.setContextMenu(contextMenu);
            appTray.on('double-click', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            });
        }
    } catch (e) {
        console.error('Chyba při vytváření Tray:', e);
    }
    return appTray;
}

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 320,
        height: 360,
        frame: false,
        transparent: true,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        show: true,
        backgroundColor: '#00000000',
        icon: path.join(__dirname, '../renderer/assets/logo.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    if (splashWindow.removeMenu) splashWindow.removeMenu();
    splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));

    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 740,
        minWidth: 980,
        minHeight: 640,
        frame: false, // Custom sleek titlebar
        backgroundColor: '#0a0b12',
        show: false,
        icon: path.join(__dirname, '../renderer/assets/logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.destroy();
            splashWindow = null;
        }
        mainWindow.show();
        mainWindow.focus();
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
        const iconSource = path.join(__dirname, '../renderer/assets/logo.png');

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
        } else if (splashWindow && !splashWindow.isDestroyed()) {
            if (splashWindow.isMinimized()) splashWindow.restore();
            splashWindow.focus();
        }
    });

    app.whenReady().then(() => {
        ensureLinuxDesktopShortcut();
        createSplashWindow();
        createWindow();

        // Initialize Discord Rich Presence
        try {
            const config = loadConfig();
            if (config.enableDiscordRpc !== false) {
                const activeProfile = (config.profiles || []).find(p => p.id === config.activeProfileId);
                discordRpc.updateActivity({
                    username: config.username || 'Hráč',
                    server: config.serverIp || 'mychalsmp.xyz',
                    profileName: activeProfile ? activeProfile.name : 'Minecraft 26.2',
                    isPlaying: false
                });
            }
        } catch (e) {
            console.warn('[DISCORD RPC] Nelze spustit RPC při startu:', e.message);
        }

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

app.on('will-quit', () => {
    try {
        discordRpc.shutdown();
    } catch (e) { }
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => {
    return loadConfig();
});

ipcMain.handle('save-config', (event, newConfig) => {
    const saved = saveConfig(newConfig);
    try {
        if (saved.enableDiscordRpc === false) {
            discordRpc.clearActivity();
        } else if (!isGameRunning()) {
            const activeProfile = (saved.profiles || []).find(p => p.id === saved.activeProfileId);
            discordRpc.updateActivity({
                username: saved.username || 'Hráč',
                server: saved.serverIp || 'mychalsmp.xyz',
                profileName: activeProfile ? activeProfile.name : 'Minecraft 26.2',
                isPlaying: false
            });
        }
    } catch (e) { }
    return saved;
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

ipcMain.handle('search-modrinth', async (event, query, version, loader, category, projectType, offset, limit) => {
    return await searchModrinth(query, version, loader, category, projectType, offset, limit);
});

ipcMain.handle('download-mod-or-pack', async (event, modOptions) => {
    const config = loadConfig();
    const targetProfileId = modOptions?.profileId || config.activeProfileId;
    const targetProfile = (config.profiles || []).find(p => p.id === targetProfileId) || config.profiles[0];
    const targetDir = targetProfile?.gameDir || BASE_DIR;
    try {
        const optsWithProgress = {
            ...modOptions,
            onProgress: (received, total, percent) => {
                try {
                    event.sender.send('mod-download-progress', {
                        id: modOptions?.id,
                        received,
                        total,
                        percent
                    });
                } catch (_) {}
            }
        };
        const res = await downloadModOrPack(optsWithProgress, targetDir);
        if (res && res.success && (!modOptions?.projectType || modOptions.projectType === 'mod')) {
            const detectedLoader = res.resolvedLoader || modOptions?.loader || 'fabric';
            const currentLoader = targetProfile?.loader || 'vanilla';

            // Pouze pokud byl profil nastaven na Vanilla, automaticky jej přepneme na zavaděč staženého módu
            if (currentLoader === 'vanilla' && detectedLoader && ['fabric', 'forge', 'neoforge'].includes(detectedLoader)) {
                const updatedProfiles = (config.profiles || []).map(p => {
                    if (p.id === targetProfileId) {
                        return { ...p, loader: detectedLoader };
                    }
                    return p;
                });
                const extra = {};
                if (config.activeProfileId === targetProfileId) {
                    extra.loader = detectedLoader;
                }
                saveConfig({ profiles: updatedProfiles, ...extra });
                res.loaderChanged = true;
                res.newLoader = detectedLoader;
                res.prevLoader = currentLoader;
                res.profileId = targetProfileId;
            }
        }
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── Mod Metadata & Icon Extractor ───────────────────────────────────────────
const modMetadataCache = new Map();

function getCachedModMetadata(jarPath, mtimeMs) {
    const cacheKey = `${jarPath}:${mtimeMs}`;
    if (modMetadataCache.has(cacheKey)) {
        return modMetadataCache.get(cacheKey);
    }

    let meta = null;
    try {
        let AdmZip;
        try { AdmZip = require('adm-zip'); } catch (_) { }
        if (AdmZip && fs.existsSync(jarPath)) {
            const zip = new AdmZip(jarPath);
            let name = null;
            let version = null;
            let iconDataUrl = null;
            let modId = null;

            // 1. Fabric mod descriptor
            const fabEntry = zip.getEntry('fabric.mod.json');
            if (fabEntry) {
                try {
                    const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                    if (fab.name) name = fab.name;
                    if (fab.id) modId = fab.id;
                    if (fab.version) version = fab.version;
                    let iconPath = fab.icon;
                    if (iconPath && typeof iconPath === 'object') {
                        iconPath = iconPath['128'] || iconPath['64'] || iconPath['32'] || Object.values(iconPath)[0];
                    }
                    if (iconPath && typeof iconPath === 'string') {
                        const cleanIcon = iconPath.replace(/^\//, '');
                        const iEntry = zip.getEntry(cleanIcon) || zip.getEntry(`assets/${modId}/${cleanIcon}`) || zip.getEntry('icon.png');
                        if (iEntry && iEntry.header.size < 600000) {
                            iconDataUrl = `data:image/png;base64,${iEntry.getData().toString('base64')}`;
                        }
                    }
                } catch (_) { }
            }

            // 2. Quilt descriptor
            if (!name) {
                const quiltEntry = zip.getEntry('quilt.mod.json');
                if (quiltEntry) {
                    try {
                        const q = JSON.parse(quiltEntry.getData().toString('utf8'));
                        const qMeta = q.quilt_loader?.metadata;
                        if (qMeta?.name) name = qMeta.name;
                        if (qMeta?.version) version = qMeta.version;
                        let iconPath = qMeta?.icon;
                        if (iconPath && typeof iconPath === 'string') {
                            const iEntry = zip.getEntry(iconPath.replace(/^\//, ''));
                            if (iEntry && iEntry.header.size < 600000) {
                                iconDataUrl = `data:image/png;base64,${iEntry.getData().toString('base64')}`;
                            }
                        }
                    } catch (_) { }
                }
            }

            // 3. Forge / NeoForge mods.toml
            if (!name) {
                const tomlEntry = zip.getEntry('META-INF/mods.toml');
                if (tomlEntry) {
                    try {
                        const txt = tomlEntry.getData().toString('utf8');
                        const mName = txt.match(/displayName\s*=\s*["']([^"']+)["']/);
                        if (mName) name = mName[1];
                        const mVer = txt.match(/version\s*=\s*["']([^"']+)["']/);
                        if (mVer && mVer[1] !== '${file.jarVersion}') version = mVer[1];
                        const mLogo = txt.match(/logoFile\s*=\s*["']([^"']+)["']/);
                        if (mLogo) {
                            const lEntry = zip.getEntry(mLogo[1].replace(/^\//, '')) || zip.getEntry(`assets/${modId || ''}/${mLogo[1].replace(/^\//, '')}`);
                            if (lEntry && lEntry.header.size < 600000) {
                                iconDataUrl = `data:image/png;base64,${lEntry.getData().toString('base64')}`;
                            }
                        }
                    } catch (_) { }
                }
            }

            // 4. Fallback: najít jakoukoliv icon.png v archivu
            if (!iconDataUrl) {
                try {
                    const iconEntry = zip.getEntry('icon.png') || zip.getEntries().find(e => (e.entryName.endsWith('icon.png') || e.entryName.endsWith('logo.png')) && e.header.size < 500000);
                    if (iconEntry) {
                        iconDataUrl = `data:image/png;base64,${iconEntry.getData().toString('base64')}`;
                    }
                } catch (_) { }
            }

            // 5. Fallback z názvu souboru: např. sodium-fabric-0.5.11+mc1.20.4.jar
            const baseFileName = path.basename(jarPath).replace(/\.disabled$/i, '').replace(/\.jar$/i, '');
            if (!modId) {
                const autoMatch = baseFileName.match(/^([a-zA-Z0-9_\-]+?)(?:[-_]v?[0-9]|\+)/);
                if (autoMatch) {
                    modId = autoMatch[1].toLowerCase().replace(/[-_](fabric|forge|neoforge|quilt|mc[0-9.]+)$/i, '');
                } else {
                    modId = baseFileName.toLowerCase();
                }
            }
            if (!version) {
                const verMatch = baseFileName.match(/[-_](v?[0-9]+\.[0-9]+[^/]*)$/i);
                if (verMatch) {
                    version = verMatch[1];
                }
            }

            meta = { modId, name, version, iconDataUrl };
        }
    } catch (_) { }

    modMetadataCache.set(cacheKey, meta);
    return meta;
}

ipcMain.handle('get-profile-mods', async (event, profileId) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const modsDir = path.join(gameDir, 'mods');

    if (!fs.existsSync(modsDir)) {
        return { success: true, mods: [], modsDir, profileName: profile?.name || profileId };
    }

    try {
        let metaMap = {};
        try {
            const metaFile = path.join(modsDir, '.mod_meta.json');
            if (fs.existsSync(metaFile)) {
                metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
            }
        } catch (_) { }

        const files = fs.readdirSync(modsDir);
        const mods = [];
        for (const file of files) {
            const lower = file.toLowerCase();
            if (lower.endsWith('.jar') || lower.endsWith('.jar.disabled')) {
                const fullPath = path.join(modsDir, file);
                const stat = fs.statSync(fullPath);
                const isEnabled = !lower.endsWith('.disabled');
                const cleanName = file.replace(/\.disabled$/i, '').replace(/\.jar$/i, '');
                const baseFile = file.replace(/\.disabled$/i, '');
                const fileMeta = metaMap[file] || metaMap[baseFile] || {};

                // Rychlé čtení metadat a ikony z JAR archivu s cache
                let meta = getCachedModMetadata(fullPath, stat.mtimeMs);

                mods.push({
                    filename: file,
                    cleanName,
                    modId: fileMeta.id || meta?.modId || cleanName.toLowerCase(),
                    modrinthId: fileMeta.id || null,
                    modrinthSlug: fileMeta.slug || null,
                    name: fileMeta.title || meta?.name || cleanName,
                    version: fileMeta.version || meta?.version || null,
                    iconDataUrl: meta?.iconDataUrl || null,
                    enabled: isEnabled,
                    sizeBytes: stat.size,
                    sizeFormatted: (stat.size / (1024 * 1024)).toFixed(1) + ' MB',
                    mtime: stat.mtimeMs
                });
            }
        }
        mods.sort((a, b) => (a.name || a.cleanName).localeCompare(b.name || b.cleanName));

        // Detekce kolizí a duplicitních verzí módů
        const enabledMods = mods.filter(m => m.enabled);
        const byKey = {};
        for (const m of enabledMods) {
            const normKey = (m.modId && m.modId.length > 2)
                ? m.modId.toLowerCase()
                : m.cleanName.toLowerCase().replace(/[-_]v?\d+[\d.\w+-]*/g, '');
            if (!byKey[normKey]) byKey[normKey] = [];
            byKey[normKey].push(m);
        }
        const collisions = [];
        for (const [key, group] of Object.entries(byKey)) {
            if (group.length > 1) {
                collisions.push({
                    modKey: key,
                    name: group[0].name || key,
                    files: group.map(x => x.filename),
                    count: group.length
                });
            }
        }

        return { success: true, mods, collisions, modsDir, profileName: profile?.name || profileId };
    } catch (e) {
        return { success: false, error: e.message, mods: [] };
    }
});

ipcMain.handle('toggle-profile-mod', async (event, profileId, filename) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const modsDir = path.join(gameDir, 'mods');

    const srcPath = path.join(modsDir, filename);
    if (!fs.existsSync(srcPath)) {
        return { success: false, error: 'Soubor módu nebyl nalezen.' };
    }

    let targetFilename;
    let enabled;
    if (filename.toLowerCase().endsWith('.disabled')) {
        targetFilename = filename.replace(/\.disabled$/i, '');
        enabled = true;
    } else {
        targetFilename = filename + '.disabled';
        enabled = false;
    }

    const destPath = path.join(modsDir, targetFilename);
    try {
        fs.renameSync(srcPath, destPath);
        return { success: true, oldFilename: filename, newFilename: targetFilename, enabled };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-profile-mod', async (event, profileId, filename) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const modsDir = path.join(gameDir, 'mods');
    const filePath = path.join(modsDir, filename);

    if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Soubor módu nebyl nalezen.' };
    }

    try {
        fs.unlinkSync(filePath);

        // Odstraníme záznam z .mod_meta.json
        try {
            const metaPath = path.join(modsDir, '.mod_meta.json');
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                const deletedInfo = meta[filename] || meta[filename + '.disabled'] || meta[filename.replace(/\.disabled$/i, '')];
                delete meta[filename];
                delete meta[filename + '.disabled'];
                delete meta[filename.replace(/\.disabled$/i, '')];
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

                // Také vyčistíme staré pole config.installedMods, pokud tam byl id nebo slug
                if (deletedInfo && config.installedMods) {
                    const cleanList = (config.installedMods || []).filter(m => m !== deletedInfo.id && m !== deletedInfo.slug);
                    if (cleanList.length !== config.installedMods.length) {
                        saveConfig({ installedMods: cleanList });
                    }
                }
            }
        } catch (_) { }

        return { success: true, filename };
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

// Mod Collisions Resolver
ipcMain.handle('resolve-mod-collisions', async (event, profileId) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const modsDir = path.join(gameDir, 'mods');
    if (!fs.existsSync(modsDir)) return { success: true, resolved: 0 };
    try {
        const files = fs.readdirSync(modsDir);
        const jarFiles = files.filter(f => f.toLowerCase().endsWith('.jar'));
        const byKey = {};
        for (const f of jarFiles) {
            const stat = fs.statSync(path.join(modsDir, f));
            const normKey = f.toLowerCase().replace(/[-_]v?\d+[\d.\w+-]*/g, '').replace(/\.jar$/, '');
            if (!byKey[normKey]) byKey[normKey] = [];
            byKey[normKey].push({ filename: f, mtime: stat.mtimeMs });
        }
        let resolvedCount = 0;
        for (const [key, group] of Object.entries(byKey)) {
            if (group.length > 1) {
                group.sort((a, b) => b.mtime - a.mtime);
                for (let i = 1; i < group.length; i++) {
                    const oldPath = path.join(modsDir, group[i].filename);
                    const disabledPath = path.join(modsDir, group[i].filename + '.disabled');
                    try {
                        fs.renameSync(oldPath, disabledPath);
                        resolvedCount++;
                    } catch (_) { }
                }
            }
        }
        return { success: true, resolved: resolvedCount };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Resource Packs & Shaders Management
ipcMain.handle('get-profile-packs', async (event, profileId, packType) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const targetFolder = packType === 'shaderpacks' ? 'shaderpacks' : 'resourcepacks';
    const folderPath = path.join(gameDir, targetFolder);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        return { success: true, packs: [], folderPath };
    }
    try {
        const files = fs.readdirSync(folderPath);
        const packs = [];
        for (const file of files) {
            const lower = file.toLowerCase();
            const fullPath = path.join(folderPath, file);
            const stat = fs.statSync(fullPath);
            if (lower.endsWith('.zip') || lower.endsWith('.zip.disabled') || stat.isDirectory()) {
                const isEnabled = !lower.endsWith('.disabled');
                const cleanName = file.replace(/\.disabled$/i, '').replace(/\.zip$/i, '');
                packs.push({
                    filename: file,
                    cleanName,
                    enabled: isEnabled,
                    sizeFormatted: stat.isDirectory() ? 'Složka' : (stat.size / (1024 * 1024)).toFixed(1) + ' MB',
                    mtime: stat.mtimeMs,
                    isDirectory: stat.isDirectory()
                });
            }
        }
        packs.sort((a, b) => a.cleanName.localeCompare(b.cleanName));
        return { success: true, packs, folderPath };
    } catch (e) {
        return { success: false, error: e.message, packs: [] };
    }
});

ipcMain.handle('toggle-profile-pack', async (event, profileId, packType, filename) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const targetFolder = packType === 'shaderpacks' ? 'shaderpacks' : 'resourcepacks';
    const folderPath = path.join(gameDir, targetFolder);
    const srcPath = path.join(folderPath, filename);
    if (!fs.existsSync(srcPath)) return { success: false, error: 'Soubor nenalezen' };
    const isCurrentlyDisabled = filename.toLowerCase().endsWith('.disabled');
    const targetFilename = isCurrentlyDisabled ? filename.replace(/\.disabled$/i, '') : filename + '.disabled';
    const destPath = path.join(folderPath, targetFilename);
    try {
        fs.renameSync(srcPath, destPath);
        return { success: true, oldFilename: filename, newFilename: targetFilename, enabled: isCurrentlyDisabled };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-profile-pack', async (event, profileId, packType, filename) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const targetFolder = packType === 'shaderpacks' ? 'shaderpacks' : 'resourcepacks';
    const folderPath = path.join(gameDir, targetFolder);
    const targetPath = path.join(folderPath, filename);
    try {
        if (fs.existsSync(targetPath)) {
            if (fs.statSync(targetPath).isDirectory()) {
                fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(targetPath);
            }
        }
        return { success: true, filename };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('login-offline', (event, username) => {
    const config = loadConfig();
    const auth = createOfflineAuth(username);
    // Offline mode: Keep existing customSkinPath and customCapePath so they persist across any nick!
    saveConfig({ username: auth.name, offlineUsername: auth.name, authType: 'offline' });
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

ipcMain.handle('cancel-launch', () => {
    cancelLaunch();
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

    const recentGameLogs = [];
    const gameSessionStart = Date.now();

    // Update Discord RPC to In-Game status
    try {
        const currentCfg = loadConfig();
        if (currentCfg.enableDiscordRpc !== false) {
            const isMychal = !serverIp || serverIp.toLowerCase().includes('mychalsmp');
            discordRpc.updateActivity({
                username: authData?.name || currentCfg.username || 'Hráč',
                server: isMychal ? 'mychalsmp.xyz' : serverIp,
                profileName: profile ? profile.name : 'Minecraft 26.2',
                isPlaying: true,
                startTime: gameSessionStart
            });
        }
    } catch (e) { }

    try {
        const proc = await launchGame(
            launchConfig,
            authData,
            serverIp,
            (progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launch-progress', progress);
                }
            },
            (logLine) => {
                recentGameLogs.push(logLine);
                if (recentGameLogs.length > 200) recentGameLogs.shift();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launch-log', logLine);
                }
            },
            (exitCode) => {
                const durationSec = Math.max(0, Math.floor((Date.now() - gameSessionStart) / 1000));
                let totalPlaytime = 0;
                if (durationSec > 0) {
                    try {
                        const freshConfig = loadConfig();
                        const updated = (freshConfig.profiles || []).map(p => {
                            if (p.id === activeId) {
                                const newTotal = (p.playtimeSeconds || 0) + durationSec;
                                totalPlaytime = newTotal;
                                return { ...p, playtimeSeconds: newTotal, lastPlayed: Date.now() };
                            }
                            return p;
                        });
                        saveConfig({ profiles: updated });
                    } catch (e) {
                        console.error('Chyba při ukládání odehraného času:', e);
                    }
                }

                // Reset Discord RPC back to Launcher status
                try {
                    const freshConfig = loadConfig();
                    if (freshConfig.enableDiscordRpc !== false) {
                        const activeP = (freshConfig.profiles || []).find(p => p.id === activeId);
                        discordRpc.updateActivity({
                            username: freshConfig.username || 'Hráč',
                            server: freshConfig.serverIp || 'mychalsmp.xyz',
                            profileName: activeP ? activeP.name : 'Minecraft 26.2',
                            isPlaying: false
                        });
                    }
                } catch (e) { }

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('game-stopped');
                    mainWindow.webContents.send('launch-exit', {
                        exitCode,
                        profileId: activeId,
                        sessionSeconds: durationSec,
                        totalPlaytime
                    });
                    mainWindow.show();
                    mainWindow.focus();
                }

                // Trigger Intelligent Crash Analyzer on non-zero exit code
                if (exitCode !== 0) {
                    try {
                        const crashData = analyzeCrash(launchConfig.baseDir, exitCode, recentGameLogs);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('launch-crash', crashData);
                        }
                    } catch (crashErr) {
                        console.error('Chyba při analýze pádu hry:', crashErr);
                    }
                }
            }
        );
        if (!proc) {
            return { success: false, cancelled: true };
        }

        // Tray minimalizace a nulová zátěž launcheru při běhu hry
        setupTray();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game-started');
            mainWindow.minimize();
        }

        return { success: true };
    } catch (err) {
        if (err && err.message === 'LAUNCH_CANCELLED') {
            return { success: false, cancelled: true };
        }
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
    const extra = {};
    if (config.activeProfileId === profileId) {
        if (updates.version) extra.version = updates.version;
        if (updates.loader) extra.loader = updates.loader;
    }
    saveConfig({ profiles, ...extra });
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

// ── Profile Mod/Pack Seed System (Export & Import konfigurace profilu) ──────
ipcMain.handle('generate-profile-seed', async (event, profileId) => {
    try {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;

        const items = [];

        // 1. Mods
        const modsDir = path.join(gameDir, 'mods');
        if (fs.existsSync(modsDir)) {
            let metaMap = {};
            const metaFile = path.join(modsDir, '.mod_meta.json');
            if (fs.existsSync(metaFile)) {
                try { metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { }
            }
            const files = fs.readdirSync(modsDir);
            for (const f of files) {
                if (f.toLowerCase().endsWith('.jar')) {
                    const cleanName = f.replace(/\.jar$/i, '');
                    const meta = metaMap[f] || {};
                    items.push({
                        id: meta.id || cleanName.toLowerCase(),
                        title: meta.title || cleanName,
                        type: 'mod',
                        filename: f,
                        version: meta.version || null,
                        loader: meta.loader || profile?.loader || 'fabric',
                        downloadUrl: meta.downloadUrl || null
                    });
                }
            }
        }

        // 2. Resource Packs
        const rpDir = path.join(gameDir, 'resourcepacks');
        if (fs.existsSync(rpDir)) {
            let metaMap = {};
            const metaFile = path.join(rpDir, '.mod_meta.json');
            if (fs.existsSync(metaFile)) {
                try { metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { }
            }
            const files = fs.readdirSync(rpDir);
            for (const f of files) {
                if (f.toLowerCase().endsWith('.zip')) {
                    const cleanName = f.replace(/\.zip$/i, '');
                    const meta = metaMap[f] || {};
                    items.push({
                        id: meta.id || cleanName.toLowerCase(),
                        title: meta.title || cleanName,
                        type: 'resourcepack',
                        filename: f,
                        downloadUrl: meta.downloadUrl || null
                    });
                }
            }
        }

        // 3. Shaders
        const shaderDir = path.join(gameDir, 'shaderpacks');
        if (fs.existsSync(shaderDir)) {
            let metaMap = {};
            const metaFile = path.join(shaderDir, '.mod_meta.json');
            if (fs.existsSync(metaFile)) {
                try { metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { }
            }
            const files = fs.readdirSync(shaderDir);
            for (const f of files) {
                if (f.toLowerCase().endsWith('.zip')) {
                    const cleanName = f.replace(/\.zip$/i, '');
                    const meta = metaMap[f] || {};
                    items.push({
                        id: meta.id || cleanName.toLowerCase(),
                        title: meta.title || cleanName,
                        type: 'shader',
                        filename: f,
                        downloadUrl: meta.downloadUrl || null
                    });
                }
            }
        }

        const payload = {
            v: 1,
            profileName: profile?.name || 'Profil',
            mc: profile?.version || '26.2',
            loader: profile?.loader || 'fabric',
            items
        };

        const jsonStr = JSON.stringify(payload);
        const base64 = Buffer.from(jsonStr, 'utf8').toString('base64');
        const seed = `SMP-PACK:${base64}`;

        return {
            success: true,
            seed,
            count: items.length,
            itemsCount: {
                mods: items.filter(i => i.type === 'mod').length,
                resourcepacks: items.filter(i => i.type === 'resourcepack').length,
                shaders: items.filter(i => i.type === 'shader').length
            }
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('import-profile-seed', async (event, profileId, seedString) => {
    try {
        if (!seedString || typeof seedString !== 'string') {
            return { success: false, error: 'Zadej platný kód balíčku.' };
        }
        let cleaned = seedString.trim();
        if (cleaned.startsWith('SMP-PACK:')) {
            cleaned = cleaned.slice(9).trim();
        } else if (cleaned.startsWith('SMP-SEED:')) {
            cleaned = cleaned.slice(9).trim();
        }
        const base64Part = cleaned;
        let payload;
        try {
            const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
            payload = JSON.parse(decoded);
        } catch (_) {
            return { success: false, error: 'Formát kódu balíčku je poškozený nebo neplatný.' };
        }

        if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
            return { success: false, error: 'Balíček neobsahuje žádné módy ani doplňky.' };
        }

        const config = loadConfig();
        const targetProfile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const targetDir = targetProfile?.gameDir || BASE_DIR;

        // Pokud profil běží na Vanilla a seed je pro Fabric/Forge, nastavíme loader profilu
        if (payload.loader && payload.loader !== 'vanilla') {
            const updatedProfiles = (config.profiles || []).map(p => {
                if (p.id === targetProfile.id && p.loader === 'vanilla') {
                    return { ...p, loader: payload.loader };
                }
                return p;
            });
            saveConfig({ profiles: updatedProfiles });
        }

        const total = payload.items.length;
        let installedCount = 0;
        let failedCount = 0;
        const failedItems = [];

        for (let idx = 0; idx < total; idx++) {
            const it = payload.items[idx];
            event.sender.send('profile-seed-progress', {
                current: idx + 1,
                total,
                percent: Math.round(((idx + 1) / total) * 100),
                title: it.title || it.id
            });

            try {
                const res = await downloadModOrPack({
                    id: it.id,
                    title: it.title,
                    projectType: it.type || 'mod',
                    version: payload.mc || targetProfile?.version || '26.2',
                    loader: it.loader || payload.loader || 'fabric',
                    filename: it.filename,
                    directUrl: it.downloadUrl
                }, targetDir);

                if (res && res.success) {
                    installedCount++;
                } else {
                    failedCount++;
                    failedItems.push(it.title || it.id);
                }
            } catch (err) {
                console.warn(`[SEED-IMPORT] Položku "${it.title || it.id}" se nepodařilo stáhnout:`, err.message);
                failedCount++;
                failedItems.push(it.title || it.id);
            }
        }

        return {
            success: true,
            total,
            installedCount,
            failedCount,
            failedItems
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── Minecraft Hudba & Zvuky (DLC) IPC Handlers ──────────────────────────────
ipcMain.handle('check-audio-dlc', async () => {
    try {
        const cfg = loadConfig();
        const baseDir = cfg.baseDir || BASE_DIR;
        const targetVersion = cfg.version || '26.2';
        return await checkAudioDlcStatus(baseDir, targetVersion);
    } catch (e) {
        console.error('Chyba při kontrole stavu audio DLC:', e);
        return { available: false, error: e.message };
    }
});

ipcMain.handle('download-audio-dlc', async () => {
    try {
        const cfg = loadConfig();
        const baseDir = cfg.baseDir || BASE_DIR;
        const targetVersion = cfg.version || '26.2';
        return await downloadAudioDlc(baseDir, targetVersion, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('audio-dlc-progress', progress);
            }
        });
    } catch (e) {
        console.error('Chyba při stahování audio DLC:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('cancel-audio-dlc', () => {
    return cancelAudioDlcDownload();
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
    try {
        setupOfflineCustomSkinAndCape(BASE_DIR, cfg, (m) => console.log(m));
    } catch (e) { }
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
    return await applyUpdate(assetUrl, (data) => {
        try {
            event.sender.send('update-progress', data);
        } catch (e) { }
    });
});

ipcMain.handle('restart-launcher', () => {
    if (process.platform === 'win32') {
        const resourcesDir = getResourcesDir();
        const pendingAsar = path.join(resourcesDir, 'app.asar.pending');
        const targetAsar = path.join(resourcesDir, 'app.asar');

        // Kontrola také pro přenosnou (portable) verzi launcheru
        const portableTarget = process.env.PORTABLE_EXECUTABLE_FILE;
        const portablePending = portableTarget ? portableTarget + '.pending' : null;
        const hasPortablePending = portablePending && fs.existsSync(portablePending);
        const hasAsarPending = fs.existsSync(pendingAsar);

        if (hasAsarPending || hasPortablePending) {
            const batPath = path.join(os.tmpdir(), `mychalsmp_update_${Date.now()}.bat`);
            const exePath = portableTarget || process.execPath;
            const exeDir = path.dirname(exePath);

            // Escapování procent pro bezpečné použití v dávkovém souboru Windows cmd
            const cleanTarget = targetAsar.replace(/%/g, '%%');
            const cleanPending = pendingAsar.replace(/%/g, '%%');
            const cleanExe = exePath.replace(/%/g, '%%');
            const cleanExeDir = exeDir.replace(/%/g, '%%');
            const cleanPortableTarget = portableTarget ? portableTarget.replace(/%/g, '%%') : '';
            const cleanPortablePending = portablePending ? portablePending.replace(/%/g, '%%') : '';

            const batLines = [
                '@echo off',
                'setlocal EnableExtensions',
                'chcp 65001 >nul',
                '',
                ':: 1. Počkáme 2 sekundy na úplné uzavření procesu Electronu a uvolnění systémových zámků',
                'timeout /t 2 /nobreak >nul',
                '',
                `set "TARGET=${cleanTarget}"`,
                `set "PENDING=${cleanPending}"`,
                `set "EXE=${cleanExe}"`,
                `set "EXE_DIR=${cleanExeDir}"`,
                `set "HAS_PORTABLE=${hasPortablePending ? '1' : '0'}"`,
                `set "PORTABLE_TARGET=${cleanPortableTarget}"`,
                `set "PORTABLE_PENDING=${cleanPortablePending}"`,
                '',
                ':: 2. Robustní smyčka pro spolehlivou výměnu souborů (až 30 pokusů, 1 pokus/sec)',
                'set ATTEMPTS=0',
                ':swap_loop',
                'set /a ATTEMPTS+=1',
                '',
                'if "%HAS_PORTABLE%"=="1" (',
                '    if exist "%PORTABLE_TARGET%" (',
                '        del /f /q "%PORTABLE_TARGET%" >nul 2>&1',
                '    )',
                '    if exist "%PORTABLE_PENDING%" (',
                '        move /y "%PORTABLE_PENDING%" "%PORTABLE_TARGET%" >nul 2>&1',
                '    )',
                '    if not exist "%PORTABLE_PENDING%" (',
                '        if exist "%PORTABLE_TARGET%" (',
                '            goto launch_app',
                '        )',
                '    )',
                ') else (',
                '    if exist "%TARGET%" (',
                '        del /f /q "%TARGET%" >nul 2>&1',
                '    )',
                '    if exist "%PENDING%" (',
                '        move /y "%PENDING%" "%TARGET%" >nul 2>&1',
                '    )',
                '    if not exist "%PENDING%" (',
                '        if exist "%TARGET%" (',
                '            goto launch_app',
                '        )',
                '    )',
                ')',
                '',
                'if %ATTEMPTS% lss 30 (',
                '    timeout /t 1 /nobreak >nul',
                '    goto swap_loop',
                ')',
                '',
                ':: Záložní fallback řešení: copy /y a del',
                'if "%HAS_PORTABLE%"=="1" (',
                '    if exist "%PORTABLE_PENDING%" (',
                '        copy /y "%PORTABLE_PENDING%" "%PORTABLE_TARGET%" >nul 2>&1',
                '        if exist "%PORTABLE_TARGET%" (',
                '            del /f /q "%PORTABLE_PENDING%" >nul 2>&1',
                '        )',
                '    )',
                ') else (',
                '    if exist "%PENDING%" (',
                '        copy /y "%PENDING%" "%TARGET%" >nul 2>&1',
                '        if exist "%TARGET%" (',
                '            del /f /q "%PENDING%" >nul 2>&1',
                '        )',
                '    )',
                ')',
                '',
                ':launch_app',
                'cd /d "%EXE_DIR%"',
                'start "" "%EXE%"',
                '',
                ':: Samomazání dávkového souboru a čisté ukončení',
                '(goto) 2>nul & del "%~f0"',
                'exit /b 0'
            ];

            const batContent = batLines.join('\r\n') + '\r\n';
            try {
                fs.writeFileSync(batPath, batContent, 'utf8');
            } catch (err) {
                console.error('[UPDATER] Nelze zapsat Windows swap dávkový soubor:', err);
                app.relaunch();
                app.exit(0);
                return;
            }

            const { spawn } = require('child_process');
            const child = spawn('cmd.exe', ['/c', batPath], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
            app.exit(0);
            return;
        }

        app.relaunch();
        app.exit(0);
        return;
    }

    let targetExe = path.join(require('os').homedir(), '.local', 'share', 'mychalsmp-launcher', 'mychalsmp-launcher');
    if (process.platform === 'linux') {
        const exeDir = path.dirname(process.execPath);
        if (!exeDir.startsWith('/tmp') && fs.existsSync(path.join(exeDir, 'mychalsmp-launcher'))) {
            targetExe = path.join(exeDir, 'mychalsmp-launcher');
        }
    }
    if (fs.existsSync(targetExe)) {
        app.relaunch({ execPath: targetExe });
    } else {
        app.relaunch();
    }
    app.exit(0);
});

// Crash Analyzer & Storage Cleaner IPC Handlers
ipcMain.handle('apply-crash-fix', async (event, autoFix, profileId) => {
    try {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = (profile && profile.gameDir) ? profile.gameDir : config.baseDir;
        return await executeCrashFix(autoFix, gameDir, config, saveConfig, detectJavaPath, downloadAndInstallJava);
    } catch (err) {
        console.error('Chyba při aplikaci opravy pádu:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('scan-launcher-cache', async () => {
    try {
        const config = loadConfig();
        return scanLauncherCache(config.baseDir, config.profiles || []);
    } catch (err) {
        console.error('Chyba při skenování cache:', err);
        return { fileCount: 0, totalBytes: 0, formattedSize: '0 B', breakdown: {} };
    }
});

ipcMain.handle('clean-launcher-cache', async () => {
    try {
        const config = loadConfig();
        return cleanLauncherCache(config.baseDir, config.profiles || []);
    } catch (err) {
        console.error('Chyba při čištění cache:', err);
        return { success: false, error: err.message };
    }
});

// System Info & Hardware IPC Handlers
ipcMain.handle('get-system-info', async () => {
    const os = require('os');
    const totalBytes = os.totalmem();
    const totalRamGB = Math.round(totalBytes / (1024 * 1024 * 1024));
    const maxAllowedRamGB = Math.max(4, Math.floor((totalBytes * 0.8) / (1024 * 1024 * 1024)));

    // Chytrý RAM asistent podle HW v PC (Windows + Linux)
    let recommendedRamGB = 4;
    if (totalRamGB <= 4) recommendedRamGB = 2;
    else if (totalRamGB <= 8) recommendedRamGB = 4;
    else if (totalRamGB <= 16) recommendedRamGB = 6;
    else if (totalRamGB <= 32) recommendedRamGB = 8;
    else recommendedRamGB = 10;

    // Detekce grafické karty a diskrétního GPU
    let gpuName = 'Standardní grafický adaptér';
    let isDedicatedGpu = false;
    if (process.platform === 'win32') {
        try {
            const { execSync } = require('child_process');
            const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 2500, encoding: 'utf8' });
            const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (lines.length > 0) {
                const dedicated = lines.find(l => /nvidia|geforce|rtx|gtx|radeon|amd/i.test(l));
                if (dedicated) {
                    gpuName = dedicated;
                    isDedicatedGpu = true;
                } else {
                    gpuName = lines[0];
                    isDedicatedGpu = !/intel|basic|microsoft/i.test(lines[0]);
                }
            }
        } catch (_) { }
    } else if (process.platform === 'linux') {
        try {
            const { execSync } = require('child_process');
            const out = execSync('lspci | grep -i "vga\\|3d\\|display"', { timeout: 2000, encoding: 'utf8' });
            const lines = out.split('\n').map(s => s.trim()).filter(Boolean);
            if (lines.length > 0) {
                const dedicated = lines.find(l => /nvidia|geforce|radeon|amd/i.test(l));
                if (dedicated) {
                    gpuName = dedicated.replace(/^[^:]+:\s*/, '');
                    isDedicatedGpu = true;
                } else {
                    gpuName = lines[0].replace(/^[^:]+:\s*/, '');
                    isDedicatedGpu = !/intel/i.test(lines[0]);
                }
            }
        } catch (_) { }
    }

    return {
        platform: process.platform,
        arch: process.arch,
        totalRamGB: totalRamGB,
        recommendedRamGB: recommendedRamGB,
        maxAllowedRamGB: maxAllowedRamGB,
        gpuName: gpuName,
        isDedicatedGpu: isDedicatedGpu
    };
});

// Screenshots Gallery IPC Handlers
ipcMain.handle('get-profile-screenshots', async (event, profileId) => {
    const config = loadConfig();
    const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
    const gameDir = profile?.gameDir || BASE_DIR;
    const scDir = path.join(gameDir, 'screenshots');
    if (!fs.existsSync(scDir)) {
        return { success: true, screenshots: [], dirPath: scDir };
    }
    try {
        const files = fs.readdirSync(scDir);
        const screenshots = [];
        for (const file of files) {
            if (file.toLowerCase().endsWith('.png')) {
                const fullPath = path.join(scDir, file);
                const stat = fs.statSync(fullPath);
                screenshots.push({
                    filename: file,
                    fullPath,
                    thumbUrl: `file://${fullPath}`,
                    sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
                    mtime: stat.mtimeMs,
                    dateFormatted: new Date(stat.mtimeMs).toLocaleString('cs-CZ')
                });
            }
        }
        screenshots.sort((a, b) => b.mtime - a.mtime);
        return { success: true, screenshots, dirPath: scDir };
    } catch (e) {
        return { success: false, error: e.message, screenshots: [] };
    }
});

ipcMain.handle('copy-screenshot-to-clipboard', async (event, fullPath) => {
    try {
        if (!fs.existsSync(fullPath)) return { success: false, error: 'Soubor neexistuje' };
        const img = nativeImage.createFromPath(fullPath);
        clipboard.writeImage(img);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-screenshot', async (event, fullPath) => {
    try {
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-file-path', async (event, fullPath) => {
    try {
        if (fs.existsSync(fullPath)) {
            shell.openPath(fullPath);
            return { success: true };
        }
        return { success: false, error: 'Soubor neexistuje' };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Drag & Drop Skin Handler
ipcMain.handle('save-dragged-skin', async (event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) return { success: false, error: 'Soubor neexistuje' };
        const dest = path.join(BASE_DIR, 'offline_skin.png');
        fs.copyFileSync(filePath, dest);
        const buf = fs.readFileSync(dest);
        const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        saveConfig({ customSkinPath: dest });
        return { success: true, customSkinPath: dest, skinDataUrl: dataUrl };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

