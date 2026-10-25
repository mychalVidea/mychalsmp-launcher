const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, BASE_DIR } = require('./config');
const { discordRpc } = require('./discordRpc');
const nativeLoader = require('./nativeLoader');

const SESSION_FILE = path.join(BASE_DIR, 'active-game-session.json');
let activeHeartbeatInterval = null;
let activeSessionData = null;
let lastSessionDiskFlushTime = 0;

/**
 * Checks if a process is still alive by PID.
 */
function isProcessAlive(pid) {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM';
    }
}

/**
 * Validates if the detected host is a real Minecraft server.
 */
function isValidServerHost(host) {
    if (!host || typeof host !== 'string') return false;
    const h = host.toLowerCase().trim();
    if (!h) return false;

    const blacklist = [
        'voice', 'voicechat', 'chat', 'server', 'servers', 'the', 'a', 'an',
        'service', 'services', 'audio', 'sound', 'auth', 'session', 'skin', 'skins',
        'account', 'telemetry', 'remote', 'local', 'socket', 'channel', 'relay',
        'proxy', 'ice', 'stun', 'turn', 'world', 'lan', 'screen', 'game',
        'integrated', 'default', 'null', 'undefined'
    ];
    if (blacklist.includes(h)) return false;
    if (h.startsWith('voice.') || h.endsWith('.voice')) return false;
    if (h.startsWith('.') || h.endsWith('.') || h.startsWith('-') || h.endsWith('-')) return false;

    if (h === 'localhost') return true;

    // IPv4 address
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
        const parts = h.split('.').map(Number);
        return parts.every(p => p >= 0 && p <= 255);
    }

    // IPv6 address
    if (/^\[?[0-9a-fA-F:]+\]?$/.test(h) && h.includes(':')) {
        return true;
    }

    // Standard domain with dot
    if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h)) {
        const parts = h.split('.');
        const tld = parts[parts.length - 1];
        if (tld.length >= 2 && !/^\d+$/.test(tld)) {
            return true;
        }
    }

    return false;
}

/**
 * Saves playtime session tick with intelligent disk throttling (once per 60s or on force exit).
 */
function saveSessionTick(session, forceDiskFlush = false, onPlaytimeUpdated = null) {
    if (!session || !session.profileId) return;
    const now = Date.now();
    const elapsedSec = Math.max(0, Math.floor((now - (session.lastTickTime || session.startTime || now)) / 1000));
    if (elapsedSec <= 0 && !forceDiskFlush) return;

    session.lastTickTime = now;
    session.pendingElapsedSec = (session.pendingElapsedSec || 0) + elapsedSec;

    const shouldFlushDisk = forceDiskFlush || (now - lastSessionDiskFlushTime >= 60000);
    if (!shouldFlushDisk) {
        return;
    }

    lastSessionDiskFlushTime = now;
    const flushSec = session.pendingElapsedSec || 0;
    session.pendingElapsedSec = 0;

    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
    } catch (_) { }

    if (flushSec > 0) {
        try {
            const freshConfig = loadConfig();
            let totalPlaytime = 0;
            const updated = (freshConfig.profiles || []).map(p => {
                if (p.id === session.profileId) {
                    const newTotal = (p.playtimeSeconds || 0) + flushSec;
                    totalPlaytime = newTotal;
                    return { ...p, playtimeSeconds: newTotal, lastPlayed: now };
                }
                return p;
            });

            let updatedServers = freshConfig.servers || [];
            if (session.currentServerIp) {
                const cleanTarget = session.currentServerIp.toLowerCase().trim();
                updatedServers = updatedServers.map(s => {
                    const ip = (s.ip || '').toLowerCase();
                    const sub = (s.subdomain || '').toLowerCase();
                    const backup = (s.backupIp || '').toLowerCase();
                    const isMychal = (cleanTarget.includes('mychalsmp') || cleanTarget === '130.61.89.37') && (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz');
                    if (ip === cleanTarget || sub === cleanTarget || backup === cleanTarget || isMychal) {
                        return {
                            ...s,
                            playtimeSeconds: (Number(s.playtimeSeconds) || 0) + flushSec
                        };
                    }
                    return s;
                });
            }

            saveConfig({ profiles: updated, servers: updatedServers });

            if (typeof onPlaytimeUpdated === 'function') {
                onPlaytimeUpdated({
                    profileId: session.profileId,
                    addedSeconds: flushSec,
                    totalPlaytime,
                    serverIp: session.currentServerIp || null
                });
            }
        } catch (e) {
            console.error('[PLAYTIME] Chyba při průběžném ukládání:', e);
        }
    }
}

/**
 * Starts tracking a newly launched game process.
 */
function startSessionTracking(pid, profileId, profileName, instanceDir, serverIp, callbacks = {}) {
    if (activeHeartbeatInterval) {
        clearInterval(activeHeartbeatInterval);
        activeHeartbeatInterval = null;
    }

    const now = Date.now();
    lastSessionDiskFlushTime = now;
    activeSessionData = {
        pid,
        profileId,
        profileName: profileName || 'Minecraft',
        instanceDir: instanceDir || BASE_DIR,
        startTime: now,
        lastTickTime: now,
        pendingElapsedSec: 0,
        currentServerIp: serverIp || null
    };

    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(activeSessionData, null, 2), 'utf-8');
    } catch (e) {
        console.error('[PLAYTIME] Nelze zapsat active-game-session.json:', e);
    }

    if (typeof callbacks.updateTrayMenu === 'function') {
        callbacks.updateTrayMenu();
    }

    // Zero-CPU native process waiter via NAPI (pidfd on Linux / WaitForSingleObject on Windows)
    if (nativeLoader && typeof nativeLoader.fastWaitForProcessExit === 'function') {
        nativeLoader.fastWaitForProcessExit(pid).then((exitCode) => {
            if (activeSessionData && activeSessionData.pid === pid) {
                console.log(`[ZERO-CPU WAITER] Minecraft proces ${pid} detekován jako ukončený (kód: ${exitCode}).`);
                endSessionTracking(exitCode || 0, callbacks);
            }
        }).catch(() => {});
    }

    activeHeartbeatInterval = setInterval(() => {
        if (!activeSessionData) return;
        if (!isProcessAlive(activeSessionData.pid)) {
            console.log(`[PLAYTIME] Minecraft proces ${activeSessionData.pid} byl ukončen.`);
            endSessionTracking(0, callbacks);
            return;
        }
        saveSessionTick(activeSessionData, false, callbacks.onPlaytimeUpdated);
    }, 5000);
}

/**
 * Ends tracking of the current game process, cleans up, and restores UI.
 */
function endSessionTracking(exitCode = 0, callbacks = {}) {
    if (activeHeartbeatInterval) {
        clearInterval(activeHeartbeatInterval);
        activeHeartbeatInterval = null;
    }

    if (activeSessionData) {
        saveSessionTick(activeSessionData, true, callbacks.onPlaytimeUpdated);
        const finishedProfileId = activeSessionData.profileId;
        const finishedInstanceDir = activeSessionData.instanceDir;
        activeSessionData = null;

        try {
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
        } catch (_) { }

        // Automatický převod logů ukončené relace do .mog (Mychal Log, regex sanitace)
        try {
            const { archiveSessionLogs } = require('./mycoLogManager');
            archiveSessionLogs(finishedInstanceDir, finishedProfileId);
        } catch (err) {
            console.error('[MYCHAL LOG] Selhala archivace do .mog:', err);
        }

        if (typeof callbacks.onGameStopped === 'function') {
            callbacks.onGameStopped({ exitCode, profileId: finishedProfileId });
        }

        if (typeof callbacks.updateTrayMenu === 'function') {
            callbacks.updateTrayMenu();
        }

        try {
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
        } catch (_) { }
    }
}

/**
 * Checks for and resumes an existing active session on launcher start.
 */
function checkAndResumeActiveSession(callbacks = {}) {
    try {
        if (!fs.existsSync(SESSION_FILE)) return false;
        const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
        if (!raw || !raw.trim()) return false;
        const session = JSON.parse(raw);
        if (!session.pid || !session.profileId) {
            try { fs.unlinkSync(SESSION_FILE); } catch (_) { }
            return false;
        }

        if (isProcessAlive(session.pid)) {
            console.log(`[PLAYTIME] Obnovena běžící relace hry (PID: ${session.pid}, Profil: ${session.profileId}).`);
            activeSessionData = session;
            lastSessionDiskFlushTime = Date.now();
            saveSessionTick(activeSessionData, true, callbacks.onPlaytimeUpdated);

            if (nativeLoader && typeof nativeLoader.fastWaitForProcessExit === 'function') {
                nativeLoader.fastWaitForProcessExit(session.pid).then((exitCode) => {
                    if (activeSessionData && activeSessionData.pid === session.pid) {
                        console.log(`[ZERO-CPU WAITER] Obnovený Minecraft proces ${session.pid} detekován jako ukončený.`);
                        endSessionTracking(exitCode || 0, callbacks);
                    }
                }).catch(() => {});
            }

            activeHeartbeatInterval = setInterval(() => {
                if (!activeSessionData) return;
                if (!isProcessAlive(activeSessionData.pid)) {
                    console.log(`[PLAYTIME] Obnovený proces ${activeSessionData.pid} byl ukončen.`);
                    endSessionTracking(0, callbacks);
                    return;
                }
                saveSessionTick(activeSessionData, false, callbacks.onPlaytimeUpdated);
            }, 5000);

            try {
                const cfg = loadConfig();
                if (cfg.enableDiscordRpc !== false) {
                    discordRpc.updateActivity({
                        username: cfg.username || 'Hráč',
                        server: session.currentServerIp || 'menu',
                        profileName: session.profileName || 'Minecraft',
                        isPlaying: true,
                        startTime: session.startTime || Date.now()
                    });
                }
            } catch (_) { }

            return true;
        } else {
            console.log(`[PLAYTIME] Uložená relace PID ${session.pid} již neběží.`);
            let exitTime = Date.now();
            try {
                const logPath = path.join(session.instanceDir || BASE_DIR, 'logs', 'latest.log');
                if (fs.existsSync(logPath)) {
                    const stat = fs.statSync(logPath);
                    if (stat.mtimeMs > (session.lastTickTime || 0)) {
                        exitTime = stat.mtimeMs;
                    }
                }
            } catch (_) { }

            const unrecordedSec = Math.max(0, Math.floor((exitTime - (session.lastTickTime || session.startTime)) / 1000));
            const actualUnrecorded = Math.min(unrecordedSec, Math.floor((Date.now() - (session.lastTickTime || session.startTime)) / 1000));
            if (actualUnrecorded > 0) {
                try {
                    const freshConfig = loadConfig();
                    const updated = (freshConfig.profiles || []).map(p => {
                        if (p.id === session.profileId) {
                            return {
                                ...p,
                                playtimeSeconds: (p.playtimeSeconds || 0) + actualUnrecorded,
                                lastPlayed: exitTime
                            };
                        }
                        return p;
                    });
                    saveConfig({ profiles: updated });
                    console.log(`[PLAYTIME] Připsán nezaznamenaný čas z offline běhu: +${actualUnrecorded}s.`);
                } catch (_) { }
            }
            try {
                const { archiveSessionLogs } = require('./mycoLogManager');
                archiveSessionLogs(session.instanceDir, session.profileId);
            } catch (err) {
                console.error('[MYCHAL LOG] Selhala archivace do .mog po offline relaci:', err);
            }
            try { fs.unlinkSync(SESSION_FILE); } catch (_) { }
            return false;
        }
    } catch (e) {
        console.error('[PLAYTIME] Chyba při obnovování relace:', e);
        try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch (_) { }
        return false;
    }
}

function getActiveSessionData() {
    return activeSessionData;
}

function isGameSessionRunning() {
    return activeSessionData !== null && isProcessAlive(activeSessionData.pid);
}

module.exports = {
    isProcessAlive,
    isValidServerHost,
    saveSessionTick,
    startSessionTracking,
    endSessionTracking,
    checkAndResumeActiveSession,
    getActiveSessionData,
    isGameSessionRunning,
    SESSION_FILE
};
