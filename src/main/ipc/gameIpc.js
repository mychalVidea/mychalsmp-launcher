const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { loadConfig, saveConfig, BASE_DIR } = require('../config');
const { getValidMicrosoftSession } = require('./authIpc');
const { createOfflineAuth } = require('../auth');
const {
    launchGame,
    isGameRunning,
    killGame,
    cancelLaunch,
    detectJavaPath,
    ensureSelfNametagModInstalled,
    markIntentionalTermination,
    wasTerminationIntentional
} = require('../launcher');
const { checkProfileModUpdates } = require('../modrinth');
const { scanProfileForBlacklistedMods } = require('../wardenProbeChecker');
const { ensureOptionsGuiScale, syncServersDat } = require('../optimizer');
const { analyzeCrash } = require('../crashAnalyzer');
const { discordRpc } = require('../discordRpc');
const keybindManager = require('../keybindManager');
const nativeLoader = require('../nativeLoader');
const {
    isProcessAlive,
    isValidServerHost,
    startSessionTracking,
    endSessionTracking,
    checkAndResumeActiveSession,
    getActiveSessionData
} = require('../sessionManager');

let isLaunchingProcess = false;
let launchProcessStartTime = 0;

function registerGameIpc({ getMainWindow, setupTray, updateTrayMenu }) {
    ipcMain.handle('is-game-running', () => {
        const session = getActiveSessionData();
        if (!session) {
            checkAndResumeActiveSession({ updateTrayMenu });
        }
        const currentSession = getActiveSessionData();
        return isGameRunning() || (currentSession !== null && isProcessAlive(currentSession.pid));
    });

    ipcMain.handle('kill-game', () => {
        markIntentionalTermination();
        const session = getActiveSessionData();
        if (session && isProcessAlive(session.pid)) {
            try {
                process.kill(session.pid);
            } catch (_) { }
        }
        killGame();
        endSessionTracking(0, {
            updateTrayMenu,
            onGameStopped: ({ exitCode, profileId }) => {
                const win = getMainWindow();
                if (win && !win.isDestroyed()) {
                    win.webContents.send('game-stopped');
                    win.webContents.send('launch-exit', { exitCode, profileId });
                    if (win.isMinimized()) win.restore();
                    win.show();
                    win.focus();
                }
            }
        });
        return true;
    });

    ipcMain.handle('get-active-session', () => {
        let session = getActiveSessionData();
        if (!session) {
            checkAndResumeActiveSession({ updateTrayMenu });
            session = getActiveSessionData();
        }
        const running = isGameRunning() || (session !== null && isProcessAlive(session.pid));
        return {
            running,
            profileId: session ? session.profileId : null,
            version: session ? session.version : null,
            pid: session ? session.pid : null
        };
    });

    ipcMain.handle('cancel-launch', () => {
        isLaunchingProcess = false;
        cancelLaunch();
        return true;
    });

    ipcMain.handle('preload-launch-environment', async (event, profileId) => {
        try {
            dns.lookup('mychalsmp.xyz', { all: false }, () => {});
            dns.lookup('join.mychalsmp.xyz', { all: false }, () => {});
            detectJavaPath(false).catch(() => {});
            const config = loadConfig();
            const pid = profileId || config.activeProfileId || 'minecraft-26.2';
            const profile = (config.profiles || []).find(p => p.id === pid);
            const version = profile ? profile.version : (config.version || '26.2');
            const verJson = path.join(BASE_DIR, 'versions', version, `${version}.json`);
            fs.promises.access(verJson, fs.constants.R_OK).catch(() => {});

            if (profile && profile.loader && profile.loader !== 'vanilla' && config.autoUpdateMods !== false) {
                const gameDir = profile.gameDir || path.join(BASE_DIR, 'profiles', profile.id);
                checkProfileModUpdates({
                    profileId: profile.id,
                    gameDir,
                    version: profile.version || '26.2',
                    loader: profile.loader || 'fabric',
                    force: false
                }).catch(() => {});
            }

            return { success: true };
        } catch (_) {
            return { success: false };
        }
    });

    ipcMain.handle('launch-game', async (event, profileId, serverIp) => {
        const win = getMainWindow();

        // Auto-recovery if hanging
        if (isLaunchingProcess && (Date.now() - launchProcessStartTime > 120000) && !isGameRunning()) {
            console.warn('[LAUNCHER] Detekován uvízlý stav spouštění bez běžícího procesu, resetuji.');
            isLaunchingProcess = false;
        }

        if (isLaunchingProcess) {
            return {
                success: false,
                error: 'Již probíhá spouštění nebo stahování jiné verze hry.'
            };
        }

        const session = getActiveSessionData();
        const alreadyRunning = isGameRunning() || (session !== null && isProcessAlive(session.pid));
        if (alreadyRunning) {
            return {
                success: false,
                error: 'Hra již běží. Před spuštěním jiné verze nejprve ukonči běžící hru.'
            };
        }

        isLaunchingProcess = true;
        launchProcessStartTime = Date.now();

        const config = loadConfig();
        let authData;

        if (config.authType === 'microsoft' && config.microsoftAccount) {
            const validMs = await getValidMicrosoftSession(false);
            if (!validMs.success) {
                isLaunchingProcess = false;
                return {
                    success: false,
                    sessionExpired: true,
                    error: validMs.error || 'Platnost Microsoft přihlášení vypršela. Přihlas se prosím znovu ke svému účtu.'
                };
            }
            authData = validMs.account;
        } else {
            authData = createOfflineAuth(config.username);
        }

        const profiles = config.profiles || [];
        let activeId = profileId || config.activeProfileId;
        let profile = profiles.find(p => p.id === activeId);

        if (!profile && profiles.length > 0) {
            const playedProfiles = profiles.filter(p => typeof p.lastPlayed === 'number' && p.lastPlayed > 0)
                .sort((a, b) => b.lastPlayed - a.lastPlayed);
            profile = playedProfiles[0] || profiles[0];
            activeId = profile.id;
        }

        if (!profile) {
            profile = {
                id: 'minecraft-26.2',
                name: 'Minecraft 26.2',
                version: '26.2',
                loader: 'fabric',
                optimizedChosen: 'optimized'
            };
            activeId = profile.id;
        }

        if (!profile.loader) {
            profile.loader = 'fabric';
        }

        const updatedProfiles = profiles.map(p => {
            if (p.id === activeId) {
                return { ...p, lastPlayed: Date.now() };
            }
            return p;
        });

        let updatedServers = config.servers || [];
        if (serverIp) {
            const cleanTarget = serverIp.toLowerCase().trim();
            updatedServers = updatedServers.map(s => {
                const ip = (s.ip || '').toLowerCase();
                const sub = (s.subdomain || '').toLowerCase();
                const backup = (s.backupIp || '').toLowerCase();
                const isMychal = (cleanTarget.includes('mychalsmp') || cleanTarget === '130.61.89.37') && (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz');
                if (ip === cleanTarget || sub === cleanTarget || backup === cleanTarget || isMychal) {
                    return {
                        ...s,
                        lastJoined: Date.now(),
                        playCount: (Number(s.playCount) || 0) + 1
                    };
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

        const targetDir = launchConfig.baseDir || BASE_DIR;
        await Promise.all([
            Promise.resolve().then(() => {
                try { ensureOptionsGuiScale(targetDir, 2); } catch (_) {}
            }),
            Promise.resolve().then(() => {
                try { syncServersDat(targetDir, config.servers || []); } catch (_) {}
            }),
            Promise.resolve().then(() => {
                try { keybindManager.syncKeybindsToProfile(targetDir); } catch (_) {}
            }),
            Promise.resolve().then(() => {
                try { ensureSelfNametagModInstalled(targetDir); } catch (_) {}
            })
        ]);

        const isMychalServer = serverIp && (
            serverIp.toLowerCase().includes('mychalsmp.xyz') ||
            serverIp.toLowerCase().includes('mychalsmp') ||
            serverIp === '130.61.89.37'
        );

        if (isMychalServer) {
            const probeScan = scanProfileForBlacklistedMods(launchConfig.baseDir);
            if (!probeScan.clean) {
                isLaunchingProcess = false;
                return {
                    success: false,
                    blockedByWarden: true,
                    illegalMods: probeScan.illegalMods,
                    error: `Přístup na MYCHAL SMP byl zablokován bezpečnostním systémem Warden. V profilu byly nalezeny nepovolené módy (${probeScan.blockedCount}). Pro hraní na síti MYCHAL SMP je nutné tyto módy deaktivovat.`
                };
            }
        }

        const recentGameLogs = [];
        const gameSessionStart = Date.now();

        setImmediate(() => {
            try {
                const currentCfg = loadConfig();
                if (currentCfg.enableDiscordRpc !== false) {
                    const initialServer = serverIp
                        ? (serverIp.toLowerCase().includes('mychalsmp') || serverIp === '130.61.89.37' ? 'mychalsmp.xyz' : serverIp)
                        : 'menu';
                    discordRpc.updateActivity({
                        username: authData?.name || currentCfg.username || 'Hráč',
                        server: initialServer,
                        profileName: profile ? profile.name : 'Minecraft 26.2',
                        isPlaying: true,
                        startTime: gameSessionStart
                    });
                }
            } catch (_) { }
        });

        try {
            let hasExited = false;
            let earlyExitCode = null;
            let hideWindowTimeout = null;
            let resolveGracePeriod = null;

            const proc = await launchGame(
                launchConfig,
                authData,
                serverIp,
                (progress) => {
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('launch-progress', progress);
                    }
                },
                (logLine) => {
                    recentGameLogs.push(logLine);
                    if (recentGameLogs.length > 200) recentGameLogs.shift();
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('launch-log', logLine);
                    }

                    if (resolveGracePeriod) {
                        if (hideWindowTimeout) clearTimeout(hideWindowTimeout);
                        const resolveFn = resolveGracePeriod;
                        resolveGracePeriod = null;
                        hideWindowTimeout = null;
                        resolveFn();
                    }

                    // ⚡ High-speed Rust native log parser
                    const logEvent = nativeLoader.fastParseGameLogLine(logLine);
                    if (logEvent.event_type === 'ignored_auxiliary') {
                        return;
                    }

                    if (logEvent.event_type === 'connecting' && logEvent.host) {
                        const detectedHost = logEvent.host.trim();
                        const detectedPort = logEvent.port || 25565;

                        if (isValidServerHost(detectedHost) && detectedPort !== 24454 && detectedPort !== 9050 && !detectedHost.toLowerCase().startsWith('voice.')) {
                            const isMychal = (detectedHost.toLowerCase().includes('mychalsmp') || detectedHost === '130.61.89.37');
                            const serverLabel = isMychal
                                ? 'mychalsmp.xyz'
                                : (detectedPort && detectedPort !== 25565 ? `${detectedHost}:${detectedPort}` : detectedHost);

                            const currentSession = getActiveSessionData();
                            if (currentSession) {
                                currentSession.currentServerIp = serverLabel;
                            }

                            try {
                                const curCfg = loadConfig();
                                if (curCfg.enableDiscordRpc !== false) {
                                    discordRpc.updateActivity({
                                        username: authData?.name || curCfg.username || 'Hráč',
                                        server: serverLabel,
                                        profileName: profile ? profile.name : 'Minecraft 26.2',
                                        isPlaying: true,
                                        startTime: gameSessionStart
                                    });
                                }
                            } catch (_) { }

                            try {
                                const curCfg = loadConfig();
                                let srvChanged = false;
                                const srvList = (curCfg.servers || []).map(s => {
                                    const ip = (s.ip || '').toLowerCase();
                                    const sub = (s.subdomain || '').toLowerCase();
                                    const backup = (s.backupIp || '').toLowerCase();
                                    const checkHost = detectedHost.toLowerCase();
                                    if (ip === checkHost || sub === checkHost || backup === checkHost || (isMychal && (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz'))) {
                                        srvChanged = true;
                                        return {
                                            ...s,
                                            lastJoined: Date.now(),
                                            playCount: (Number(s.playCount) || 0) + 1
                                        };
                                    }
                                    return s;
                                });
                                if (srvChanged) {
                                    saveConfig({ servers: srvList });
                                    if (win && !win.isDestroyed()) {
                                        win.webContents.send('servers-updated', srvList);
                                    }
                                }
                            } catch (_) { }
                        }
                    }

                    if (logEvent.event_type === 'singleplayer') {
                        const currentSession = getActiveSessionData();
                        if (currentSession && currentSession.currentServerIp !== 'Singleplayer') {
                            currentSession.currentServerIp = 'Singleplayer';
                            try {
                                const curCfg = loadConfig();
                                if (curCfg.enableDiscordRpc !== false) {
                                    discordRpc.updateActivity({
                                        username: authData?.name || curCfg.username || 'Hráč',
                                        server: 'Singleplayer',
                                        profileName: profile ? profile.name : 'Minecraft 26.2',
                                        isPlaying: true,
                                        startTime: gameSessionStart
                                    });
                                }
                            } catch (_) { }
                        }
                    }

                    if (logEvent.event_type === 'menu') {
                        const currentSession = getActiveSessionData();
                        if (currentSession && currentSession.currentServerIp && currentSession.currentServerIp !== 'menu') {
                            currentSession.currentServerIp = 'menu';
                            try {
                                const curCfg = loadConfig();
                                if (curCfg.enableDiscordRpc !== false) {
                                    discordRpc.updateActivity({
                                        username: authData?.name || curCfg.username || 'Hráč',
                                        server: 'menu',
                                        profileName: profile ? profile.name : 'Minecraft 26.2',
                                        isPlaying: true,
                                        startTime: gameSessionStart
                                    });
                                }
                            } catch (_) { }
                        }
                    }
                },
                async (exitCode) => {
                    hasExited = true;
                    earlyExitCode = exitCode;
                    if (hideWindowTimeout) {
                        clearTimeout(hideWindowTimeout);
                        hideWindowTimeout = null;
                    }
                    if (resolveGracePeriod) {
                        const r = resolveGracePeriod;
                        resolveGracePeriod = null;
                        r();
                    }

                    endSessionTracking(exitCode, {
                        updateTrayMenu,
                        onGameStopped: ({ exitCode: code, profileId: pid }) => {
                            if (win && !win.isDestroyed()) {
                                win.webContents.send('game-stopped');
                                win.webContents.send('launch-exit', { exitCode: code, profileId: pid });
                                if (win.isMinimized()) win.restore();
                                win.show();
                                win.focus();
                            }
                        },
                        onPlaytimeUpdated: (data) => {
                            if (win && !win.isDestroyed() && win.isVisible()) {
                                win.webContents.send('playtime-updated', data);
                            }
                        }
                    });

                    // Trigger Crash Analyzer on crash (unless termination was intentional or clean shutdown)
                    if (exitCode !== 0) {
                        if (wasTerminationIntentional()) {
                            console.log('[LAUNCHER] Hra byla ukončena záměrně přes launcher (killGame), neotevírám dialog pádu.');
                            return;
                        }

                        if (
                            exitCode === 4294967288 || 
                            exitCode === -8 ||
                            exitCode === 130 || // SIGINT
                            exitCode === 143 || // SIGTERM
                            exitCode === 137 || // SIGKILL
                            exitCode === 3221225786 || // STATUS_CONTROL_C_EXIT
                            exitCode === -1073741510
                        ) {
                            console.log(`[LAUNCHER] Detekováno běžné/řízené ukončení hry (kód ${exitCode}), neotevírám dialog pádu.`);
                            return;
                        }

                        try {
                            const crashData = await analyzeCrash(launchConfig.baseDir, exitCode, recentGameLogs, {
                                ...launchConfig,
                                intentionalStop: wasTerminationIntentional()
                            });
                            if (crashData && (crashData.isCleanShutdown || crashData.hasCrash === false)) {
                                console.log('[LAUNCHER] Detekováno běžné ukončení hry (post-main watchdog / clean shutdown), neotevírám dialog pádu.');
                                return;
                            }
                            if (win && !win.isDestroyed()) {
                                win.webContents.send('launch-crash', crashData);
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

            if (hasExited || proc.exitCode !== null || proc.killed) {
                if (wasTerminationIntentional()) {
                    console.log('[LAUNCHER] Spuštění hry bylo záměrně zrušeno uživatelem.');
                    return { success: false, cancelled: true };
                }
                const finalCode = proc.exitCode ?? earlyExitCode ?? 1;
                console.error(`[LAUNCHER] Proces hry selhal bezprostředně po spuštění (kód: ${finalCode})`);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('game-stopped');
                    if (win.isMinimized()) win.restore();
                    win.show();
                    win.focus();
                }
                return {
                    success: false,
                    error: `Hra byla ukončena ihned po spuštění (kód: ${finalCode}). Zkontroluj záznam v herní konzoli.`
                };
            }

            if (proc && proc.pid) {
                startSessionTracking(proc.pid, activeId, profile ? profile.name : 'Minecraft', launchConfig.baseDir, serverIp, {
                    updateTrayMenu,
                    onGameStopped: ({ exitCode: code, profileId: pid }) => {
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('game-stopped');
                            win.webContents.send('launch-exit', { exitCode: code, profileId: pid });
                            if (win.isMinimized()) win.restore();
                            win.show();
                            win.focus();
                        }
                    },
                    onPlaytimeUpdated: (data) => {
                        if (win && !win.isDestroyed() && win.isVisible()) {
                            win.webContents.send('playtime-updated', data);
                        }
                    }
                });
            }

            setupTray();

            if (!hasExited && proc.exitCode === null && !proc.killed && recentGameLogs.length === 0) {
                await new Promise(resolve => {
                    resolveGracePeriod = resolve;
                    hideWindowTimeout = setTimeout(() => {
                        resolveGracePeriod = null;
                        hideWindowTimeout = null;
                        resolve();
                    }, 750);
                });
                hideWindowTimeout = null;
                resolveGracePeriod = null;
            }

            if (hasExited || proc.exitCode !== null || proc.killed) {
                const finalCode = proc.exitCode ?? earlyExitCode ?? 1;
                console.error(`[LAUNCHER] Proces hry se neočekávaně ukončil během startu (kód: ${finalCode})`);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('game-stopped');
                    if (win.isMinimized()) win.restore();
                    win.show();
                    win.focus();
                }
                return {
                    success: false,
                    error: `Hra se neotevřela a byla okamžitě ukončena (kód: ${finalCode}). Zkontroluj herní konzoli a crash log.`
                };
            }

            if (win && !win.isDestroyed()) {
                const curSession = getActiveSessionData();
                win.webContents.send('game-started', {
                    profileId: curSession ? curSession.profileId : profileId,
                    version: curSession ? curSession.version : null
                });
                setTimeout(() => {
                    if (win && !win.isDestroyed()) {
                        win.hide();
                    }
                }, 160);
            }

            return { success: true };
        } catch (err) {
            if (err && err.message === 'LAUNCH_CANCELLED') {
                return { success: false, cancelled: true };
            }
            console.error('Chyba při spouštění hry:', err);
            return { success: false, error: err.message };
        } finally {
            isLaunchingProcess = false;
        }
    });
}

module.exports = { registerGameIpc };
