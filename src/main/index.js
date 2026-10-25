const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

// Globální ochrana proti neošetřeným výjimkám v hlavním procesu (zabrání crash dialogům na Windows)
process.on('uncaughtException', (err) => {
    console.error('[MAIN PROCESS] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[MAIN PROCESS] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Ochrana před poškozenými JSON soubory v node_modules
try {
    const originalJsonExtension = require.extensions['.json'];
    if (originalJsonExtension) {
        require.extensions['.json'] = function (module, filename) {
            try {
                return originalJsonExtension(module, filename);
            } catch (jsonErr) {
                console.error(`[MODULE] Varování: Chyba parsování JSON souboru ${filename}:`, jsonErr);
                try {
                    const fsMod = require('fs');
                    const raw = fsMod.readFileSync(filename, 'utf8');
                    const cleaned = raw.replace(/^[\s\S]*?(\{[\s\S]*\}|\[[\s\S]*\])[\s\S]*$/, '$1');
                    module.exports = JSON.parse(cleaned);
                } catch (_) {
                    module.exports = {};
                }
            }
        };
    }
} catch (_) {}

const { app, BrowserWindow, screen, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadConfig, saveConfig, BASE_DIR } = require('./config');
const {
    isGameRunning,
    killGame,
    ensureSelfNametagModInstalled,
    prewarmLaunchEnvironment
} = require('./launcher');
const { checkProfileModUpdates } = require('./modrinth');
const { discordRpc } = require('./discordRpc');
const nativeLoader = require('./nativeLoader');
const {
    checkAndResumeActiveSession,
    saveSessionTick,
    getActiveSessionData,
    isProcessAlive
} = require('./sessionManager');
const { registerAllIpcHandlers } = require('./ipc');

// ⚡ Povolení V8 Garbage Collection pro úsporný režim v liště (Tray)
try {
    app.commandLine.appendSwitch('js-flags', '--expose-gc');
} catch (_) { }

// ⚡ Windows AppUserModelId pro ikonu na hlavním panelu a v nabídce Start
if (process.platform === 'win32') {
    app.setAppUserModelId('xyz.mychalsmp.launcher');
}

function getAppIconPath() {
    if (process.platform === 'win32') {
        const ico = path.join(__dirname, '../renderer/assets/icon.ico');
        if (fs.existsSync(ico)) return ico;
    }
    return path.join(__dirname, '../renderer/assets/logo.png');
}

let mainWindow = null;
let splashWindow = null;
let appTray = null;
let isQuitting = false;

function restoreAndFocusMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.show();
        mainWindow.focus();
        try {
            mainWindow.webContents.setBackgroundThrottling(false);
            mainWindow.webContents.send('window-restored-from-tray');
        } catch (_) { }

        try {
            if (typeof discordRpc.wake === 'function') {
                discordRpc.wake();
            }
            if (!isGameRunning()) {
                const cfg = loadConfig();
                if (cfg.enableDiscordRpc !== false) {
                    const activeProfile = (cfg.profiles || []).find(p => p.id === cfg.activeProfileId);
                    discordRpc.updateActivity({
                        username: cfg.username || 'Hráč',
                        server: cfg.serverIp || 'mychalsmp.xyz',
                        profileName: activeProfile ? activeProfile.name : 'Minecraft 26.2',
                        isPlaying: false
                    });
                }
            }
        } catch (_) { }

        updateTrayMenu();
    }
}

/**
 * ⚡ Maximální úspora RAM a VRAM při skrytí launcheru do systémové lišty:
 * - Spustí V8 Garbage Collection v Node.js i v Chromium rendereru
 * - Na Windows ořeže Working Set (fyzické stránky v RAM)
 * - Na Linuxu provede libc::malloc_trim přes Rust modul
 * - Uvolní kódovou i diskovou mezipaměť Chromia
 * - Uspí Discord RPC spojení při nečinnosti v liště (pokud neběží hra)
 */
function cleanupTrayMemory() {
    try {
        if (global.gc) {
            global.gc();
        }
    } catch (_) { }

    try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.executeJavaScript('if (typeof window.gc === "function") window.gc(); else if (typeof gc === "function") gc();').catch(() => {});
        }
    } catch (_) { }

    try {
        if (nativeLoader && typeof nativeLoader.fastTrimMemory === 'function') {
            nativeLoader.fastTrimMemory();
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                const rendererPid = mainWindow.webContents.getOSProcessId();
                if (rendererPid) {
                    nativeLoader.fastTrimMemory(rendererPid);
                }
            }
        } else if (process.platform === 'win32' && typeof process.trimWorkingSet === 'function') {
            process.trimWorkingSet();
        }
    } catch (_) { }

    try {
        const { session } = require('electron');
        if (session && session.defaultSession) {
            session.defaultSession.clearCodeCaches({}).catch(() => {});
            session.defaultSession.clearCache().catch(() => {});
        }
    } catch (_) { }

    try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.invalidate();
        }
    } catch (_) { }

    try {
        const session = getActiveSessionData();
        if (!isGameRunning() && (!session || !isProcessAlive(session.pid))) {
            if (typeof discordRpc.sleep === 'function') {
                discordRpc.sleep();
            } else {
                discordRpc.clearActivity();
            }
        }
    } catch (_) { }
}

function updateTrayMenu() {
    if (!appTray || appTray.isDestroyed()) return;
    try {
        const isGame = isGameRunning();
        const isWinVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
        const session = getActiveSessionData();
        const profileName = session ? (session.profileName || 'Minecraft') : 'SMPClient';

        const menuTemplate = [
            {
                label: isGame ? `🟢 Hra běží: ${profileName}` : 'SMPClient • V liště',
                enabled: false
            },
            { type: 'separator' },
            {
                label: isWinVisible ? 'Skrýt launcher do lišty' : 'Zobrazit launcher',
                click: () => {
                    if (isWinVisible) {
                        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
                    } else {
                        restoreAndFocusMainWindow();
                    }
                }
            }
        ];

        if (isGame) {
            menuTemplate.push({
                label: '🛑 Ukončit běžící hru',
                click: () => {
                    killGame();
                }
            });
        }

        menuTemplate.push(
            { type: 'separator' },
            {
                label: 'Ukončit aplikaci',
                click: () => {
                    isQuitting = true;
                    app.quit();
                }
            }
        );

        const contextMenu = Menu.buildFromTemplate(menuTemplate);
        appTray.setContextMenu(contextMenu);
        appTray.setToolTip(isGame ? `SMPClient • Hra běží (${profileName})` : 'SMPClient - MYCHAL SMP');
    } catch (_) { }
}

function setupTray() {
    if (appTray && !appTray.isDestroyed()) {
        updateTrayMenu();
        return appTray;
    }
    try {
        const iconPath = getAppIconPath();
        if (fs.existsSync(iconPath)) {
            const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
            appTray = new Tray(icon);
            updateTrayMenu();
            appTray.on('click', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        restoreAndFocusMainWindow();
                    }
                }
            });
            appTray.on('double-click', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        restoreAndFocusMainWindow();
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
    let splashX, splashY;
    try {
        const primary = screen.getPrimaryDisplay();
        const { x, y, width, height } = primary.workArea;
        splashX = Math.round(x + (width - 320) / 2);
        splashY = Math.round(y + (height - 360) / 2);
    } catch (e) { }

    splashWindow = new BrowserWindow({
        width: 320,
        height: 360,
        ...(splashX !== undefined ? { x: splashX, y: splashY } : { center: true }),
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        show: true,
        backgroundColor: '#00000000',
        icon: getAppIconPath(),
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
    let isInitialShowCompleted = false;
    let winX, winY, winW = 1180, winH = 740;
    try {
        const primary = screen.getPrimaryDisplay();
        const { x, y, width, height } = primary.workArea;
        winW = Math.min(1180, width);
        winH = Math.min(740, height);
        winX = Math.round(x + (width - winW) / 2);
        winY = Math.round(y + (height - winH) / 2);
    } catch (e) { }

    mainWindow = new BrowserWindow({
        width: winW,
        height: winH,
        ...(winX !== undefined ? { x: winX, y: winY } : {}),
        minWidth: 980,
        minHeight: 640,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: true,
        show: false,
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            backgroundThrottling: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[RENDERER] ${message} (${path.basename(sourceId || '')}:${line})`);
    });

    mainWindow.webContents.once('did-finish-load', () => {
        const isLive = checkAndResumeActiveSession({ updateTrayMenu });
        if (isLive) {
            const curSession = getActiveSessionData();
            mainWindow.webContents.send('game-started', {
                profileId: curSession ? curSession.profileId : null,
                version: curSession ? curSession.version : null
            });
        }
    });

    mainWindow.on('maximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-maximize-change', true);
        }
    });

    mainWindow.on('unmaximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-maximize-change', false);
        }
    });

    mainWindow.on('hide', () => {
        if (!isInitialShowCompleted) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                mainWindow.webContents.setBackgroundThrottling(true);
                mainWindow.webContents.send('window-hidden-to-tray');
            } catch (_) { }
            cleanupTrayMemory();
            updateTrayMenu();
        }
    });

    mainWindow.on('show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                mainWindow.webContents.setBackgroundThrottling(false);
                mainWindow.webContents.send('window-restored-from-tray');
            } catch (_) { }
            try {
                if (typeof discordRpc.wake === 'function') {
                    discordRpc.wake();
                }
                if (!isGameRunning()) {
                    const cfg = loadConfig();
                    if (cfg.enableDiscordRpc !== false) {
                        const activeProfile = (cfg.profiles || []).find(p => p.id === cfg.activeProfileId);
                        discordRpc.updateActivity({
                            username: cfg.username || 'Hráč',
                            server: cfg.serverIp || 'mychalsmp.xyz',
                            profileName: activeProfile ? activeProfile.name : 'Minecraft 26.2',
                            isPlaying: false
                        });
                    }
                }
            } catch (_) { }
            updateTrayMenu();
        }
    });

    mainWindow.on('minimize', () => {
        if (!isInitialShowCompleted) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                mainWindow.webContents.setBackgroundThrottling(true);
                mainWindow.webContents.send('window-hidden-to-tray');
            } catch (_) { }
            cleanupTrayMemory();
            updateTrayMenu();
        }
    });

    mainWindow.on('restore', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                mainWindow.webContents.setBackgroundThrottling(false);
                mainWindow.webContents.send('window-restored-from-tray');
            } catch (_) { }
            try {
                if (typeof discordRpc.wake === 'function') {
                    discordRpc.wake();
                }
                if (!isGameRunning()) {
                    const cfg = loadConfig();
                    if (cfg.enableDiscordRpc !== false) {
                        const activeProfile = (cfg.profiles || []).find(p => p.id === cfg.activeProfileId);
                        discordRpc.updateActivity({
                            username: cfg.username || 'Hráč',
                            server: cfg.serverIp || 'mychalsmp.xyz',
                            profileName: activeProfile ? activeProfile.name : 'Minecraft 26.2',
                            isPlaying: false
                        });
                    }
                }
            } catch (_) { }
            updateTrayMenu();
        }
    });

    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.destroy();
            splashWindow = null;
        }

        try {
            const primary = screen.getPrimaryDisplay();
            const { x, y, width, height } = primary.workArea;
            const currentBounds = mainWindow.getBounds();
            const targetX = Math.round(x + (width - currentBounds.width) / 2);
            const targetY = Math.round(y + (height - currentBounds.height) / 2);
            mainWindow.setPosition(targetX, targetY);
        } catch (e) { }

        mainWindow.show();
        mainWindow.focus();

        setTimeout(() => {
            isInitialShowCompleted = true;
            if (mainWindow && !mainWindow.isDestroyed()) {
                try {
                    mainWindow.webContents.send('window-restored-from-tray');
                } catch (_) { }
            }
        }, 400);
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            setupTray();
            mainWindow.hide();
            return false;
        }
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
        const homeDir = os.homedir();
        const execPath = process.execPath;
        const iconSource = path.join(__dirname, '../renderer/assets/logo.png');

        const iconDir = path.join(homeDir, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');
        if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });
        const iconDest = path.join(iconDir, 'mychalsmp-launcher.png');
        if (fs.existsSync(iconSource)) {
            try { fs.copyFileSync(iconSource, iconDest); } catch (e) { }
        }

        let execCommand = '';
        const installedBin = path.join(homeDir, '.local', 'share', 'mychalsmp-launcher', 'mychalsmp-launcher');
        const projectRoot = path.resolve(__dirname, '../..');

        if (!app.isPackaged || execPath.includes('node_modules')) {
            execCommand = `"${execPath}" "${projectRoot}" --no-sandbox %U`;
        } else if (fs.existsSync(installedBin)) {
            execCommand = `"${installedBin}" --no-sandbox %U`;
        } else {
            execCommand = `"${execPath}" --no-sandbox %U`;
        }

        const desktopContent = `[Desktop Entry]
Name=SMPClient
Comment=Oficiální Minecraft klient sítě MYCHAL SMP
Exec=${execCommand}
Icon=${fs.existsSync(iconDest) ? iconDest : 'mychalsmp-launcher'}
Terminal=false
Type=Application
Categories=Game;ActionGame;AdventureGame;
StartupWMClass=xyz.mychalsmp.launcher
MimeType=x-scheme-handler/mychalsmp;text/x-mog;text/plain;application/x-myco-log;text/x-myco;
`;

        const appsDir = path.join(homeDir, '.local', 'share', 'applications');
        if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true });
        const appDesktopFile = path.join(appsDir, 'mychalsmp-launcher.desktop');
        fs.writeFileSync(appDesktopFile, desktopContent, 'utf-8');
        try { fs.chmodSync(appDesktopFile, 0o755); } catch (e) { }

        const desktopCandidates = [
            path.join(homeDir, 'Desktop'),
            path.join(homeDir, 'Plocha')
        ];
        for (const d of desktopCandidates) {
            if (fs.existsSync(d)) {
                const target = path.join(d, 'SMPClient.desktop');
                fs.writeFileSync(target, desktopContent, 'utf-8');
                try { fs.chmodSync(target, 0o755); } catch (e) { }
            }
        }
    } catch (err) {
        console.error('Chyba při tvorbě desktop ikony:', err);
    }
}

/**
 * Zkontroluje, zda nebyl launcheru předán .myco soubor jako argument (např. při poklepání v OS)
 * @param {string[]} argv 
 * @returns {boolean}
 */
function handleFileArgOpen(argv) {
    if (!Array.isArray(argv)) return false;
    for (const arg of argv) {
        if (typeof arg === 'string' && (arg.toLowerCase().endsWith('.mog') || arg.toLowerCase().endsWith('.myco')) && fs.existsSync(arg)) {
            try {
                const { openMycoFileInEditor } = require('./mycoLogManager');
                openMycoFileInEditor(arg);
                return true;
            } catch (err) {
                console.error('[MYCHAL LOG] Chyba při otevírání log souboru z argumentu:', err);
            }
        }
    }
    return false;
}

function startMainApplication() {
    // ⚡ Registrace všech modulárních IPC handlerů
    registerAllIpcHandlers({
        getMainWindow: () => mainWindow,
        setupTray,
        updateTrayMenu,
        cleanupTrayMemory,
        restoreAndFocusMainWindow
    });

    app.on('second-instance', (event, commandLine) => {
        if (handleFileArgOpen(commandLine)) {
            return;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            restoreAndFocusMainWindow();
        } else if (splashWindow && !splashWindow.isDestroyed()) {
            if (splashWindow.isMinimized()) splashWindow.restore();
            splashWindow.focus();
        }
    });

    app.whenReady().then(() => {
        handleFileArgOpen(process.argv);
        checkAndResumeActiveSession({ updateTrayMenu });
        ensureLinuxDesktopShortcut();
        setupTray();
        createSplashWindow();
        createWindow();

        // ⚡ Automatický převod starých logů (.log.gz, uncompressed) do .myco na pozadí při startu
        setTimeout(() => {
            try {
                const { convertAllPendingLogsToMyco } = require('./mycoLogManager');
                const count = convertAllPendingLogsToMyco();
                if (count > 0) {
                    console.log(`[MYCO LOG] Při startu launcher převedl ${count} logů do formátu .myco.`);
                }
            } catch (_) {}
        }, 1500);

        setTimeout(() => {
            try {
                ensureSelfNametagModInstalled(BASE_DIR);
            } catch (_) {}
            try {
                const cfg = loadConfig();
                const targetVer = cfg.version || '26.2';
                prewarmLaunchEnvironment(BASE_DIR, targetVer, cfg);

                if (cfg.autoUpdateMods !== false) {
                    const activeProfile = (cfg.profiles || []).find(p => p.id === cfg.activeProfileId);
                    if (activeProfile && activeProfile.loader && activeProfile.loader !== 'vanilla') {
                        const gDir = activeProfile.gameDir || path.join(BASE_DIR, 'profiles', activeProfile.id);
                        checkProfileModUpdates({
                            profileId: activeProfile.id,
                            gameDir: gDir,
                            version: activeProfile.version || '26.2',
                            loader: activeProfile.loader || 'fabric',
                            force: false
                        }).catch(() => {});
                    }
                }
            } catch (_) {}
        }, 1200);

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
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.focus();
            } else if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

if (!gotTheLock) {
    let retries = 0;
    const checkLockInterval = setInterval(() => {
        retries++;
        if (app.requestSingleInstanceLock()) {
            clearInterval(checkLockInterval);
            startMainApplication();
        } else if (retries >= 8) {
            clearInterval(checkLockInterval);
            app.quit();
        }
    }, 300);
} else {
    startMainApplication();
}

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (isQuitting) {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    }
});

app.on('will-quit', () => {
    const session = getActiveSessionData();
    if (session) {
        saveSessionTick(session, true);
    }
    try {
        if (appTray && !appTray.isDestroyed()) {
            appTray.destroy();
            appTray = null;
        }
    } catch (_) { }
    try {
        discordRpc.shutdown();
    } catch (e) { }
});
