const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, BASE_DIR } = require('../config');
const {
    scanInstanceDirectory,
    importInstanceProfile,
    upgradeProfile,
    discoverInstalledProfiles
} = require('../profileManager');
const { killGame } = require('../launcher');
const { downloadModOrPack } = require('../modrinth');

function registerProfileIpc({ getMainWindow }) {
    ipcMain.handle('discover-installed-profiles', async () => {
        try {
            return discoverInstalledProfiles();
        } catch (e) {
            console.warn('[PROFILE-DISCOVERY] Chyba při hledání profilů:', e.message);
            return [];
        }
    });

    ipcMain.handle('import-profile-dialog', async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: 'Vyber složku profilu / instance (Prism, CurseForge, Modrinth, .minecraft)',
                properties: ['openDirectory']
            });
            if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return { canceled: true };
            }
            const dirPath = result.filePaths[0];
            const scan = scanInstanceDirectory(dirPath);
            return { canceled: false, scan };
        } catch (e) {
            return { canceled: false, error: e.message };
        }
    });

    ipcMain.handle('confirm-import-profile', async (event, importData) => {
        try {
            return await importInstanceProfile(importData, BASE_DIR);
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('upgrade-profile', async (event, sourceProfileId, targetVersion) => {
        try {
            const win = getMainWindow();
            return await upgradeProfile(sourceProfileId, targetVersion, BASE_DIR, (progress) => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('upgrade-progress', progress);
                }
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('open-profile-folder', async (event, profileId, subfolder) => {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        let folder = profile.gameDir || BASE_DIR;
        if (subfolder && typeof subfolder === 'string') {
            const safeSub = path.basename(subfolder.trim());
            const allowed = ['mods', 'resourcepacks', 'shaderpacks', 'screenshots', 'saves', 'logs', 'config'];
            if (allowed.includes(safeSub)) {
                folder = path.join(folder, safeSub);
                if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
            }
        }
        shell.openPath(folder);
        return true;
    });

    ipcMain.handle('update-profile-settings', async (event, profileId, updates) => {
        const config = loadConfig();
        const profiles = (config.profiles || []).map(p => {
            if (p.id === profileId) {
                const isImported = Boolean(
                    p.isImported ||
                    (p.id && p.id.startsWith('imported-')) ||
                    p.icon === 'import' ||
                    (p.desc && p.desc.includes('Importováno')) ||
                    (p.gameDir && (p.gameDir.includes('instances') || p.gameDir.includes('profiles')) && p.id.includes('import'))
                );
                const safeUpdates = { ...updates };
                if (isImported) {
                    delete safeUpdates.loader;
                }
                const next = { ...p, ...safeUpdates };
                if (safeUpdates.loader) {
                    next.optimizedChosen = safeUpdates.loader === 'fabric' ? 'optimized' : 'vanilla';
                }
                return next;
            }
            return p;
        });
        const extra = {};
        if (config.activeProfileId === profileId) {
            if (updates.version) extra.version = updates.version;
            const targetP = profiles.find(p => p.id === profileId);
            if (targetP && targetP.loader) extra.loader = targetP.loader;
        }
        saveConfig({ profiles, ...extra });
        return { success: true };
    });

    ipcMain.handle('delete-profile', async (event, profileId) => {
        if (!profileId || typeof profileId !== 'string') {
            return { success: false, error: 'Neplatné ID profilu.' };
        }
        const safeProfileId = path.basename(profileId.trim());
        if (!safeProfileId || safeProfileId !== profileId || safeProfileId === '.' || safeProfileId === '..') {
            return { success: false, error: 'Neplatné ID profilu.' };
        }

        const config = loadConfig();
        const profiles = config.profiles || [];
        if (profiles.length <= 1) {
            return { success: false, error: 'V launcheru musí zůstat alespoň jeden profil.' };
        }

        const profile = profiles.find(p => p.id === safeProfileId);
        if (!profile) {
            return { success: false, error: 'Profil nebyl nalezen.' };
        }

        const resolvedBase = path.resolve(BASE_DIR);
        if (profile.gameDir && typeof profile.gameDir === 'string') {
            const resolvedGameDir = path.resolve(profile.gameDir);
            if (resolvedGameDir !== resolvedBase && resolvedGameDir.startsWith(resolvedBase + path.sep) && fs.existsSync(resolvedGameDir)) {
                try {
                    fs.rmSync(resolvedGameDir, { recursive: true, force: true });
                } catch (e) { }
            }
        }

        const profilesDir = path.resolve(BASE_DIR, 'profiles');
        const profileSubDir = path.resolve(profilesDir, safeProfileId);
        if (profileSubDir.startsWith(profilesDir + path.sep) && fs.existsSync(profileSubDir)) {
            try {
                fs.rmSync(profileSubDir, { recursive: true, force: true });
            } catch (e) { }
        }

        const instancesDir = path.resolve(BASE_DIR, 'instances');
        const instanceSubDir = path.resolve(instancesDir, safeProfileId);
        if (instanceSubDir.startsWith(instancesDir + path.sep) && fs.existsSync(instanceSubDir)) {
            try {
                fs.rmSync(instanceSubDir, { recursive: true, force: true });
            } catch (e) { }
        }

        const updated = profiles.filter(p => p.id !== safeProfileId);

        if (profile.version) {
            const isVersionStillUsed = updated.some(p => p.version === profile.version);
            if (!isVersionStillUsed) {
                const versionsDir = path.join(BASE_DIR, 'versions');
                if (fs.existsSync(versionsDir)) {
                    try {
                        const entries = fs.readdirSync(versionsDir);
                        for (const entry of entries) {
                            if (entry === profile.version || entry.endsWith(`-${profile.version}`)) {
                                const verPath = path.join(versionsDir, entry);
                                try {
                                    fs.rmSync(verPath, { recursive: true, force: true });
                                } catch (_) { }
                            }
                        }
                    } catch (_) { }
                }
            }
        }

        const newActiveProfile = updated.find(p => p.id === config.activeProfileId) || updated[0];
        const newActiveId = newActiveProfile ? newActiveProfile.id : 'minecraft-26.2';

        saveConfig({
            profiles: updated,
            activeProfileId: newActiveId,
            version: newActiveProfile ? newActiveProfile.version : config.version,
            loader: newActiveProfile ? (newActiveProfile.loader || 'fabric') : config.loader
        });

        return { success: true, activeProfileId: newActiveId };
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
            saveConfig({});
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Profile Seed System (Export & Import)
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

            // 3. Shader Packs
            const spDir = path.join(gameDir, 'shaderpacks');
            if (fs.existsSync(spDir)) {
                let metaMap = {};
                const metaFile = path.join(spDir, '.mod_meta.json');
                if (fs.existsSync(metaFile)) {
                    try { metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { }
                }
                const files = fs.readdirSync(spDir);
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
                name: profile?.name || 'Můj balíček',
                mc: profile?.version || '26.3',
                loader: profile?.loader || 'fabric',
                date: new Date().toISOString(),
                items
            };

            const jsonStr = JSON.stringify(payload);
            const base64 = Buffer.from(jsonStr, 'utf8').toString('base64');
            const seedString = `SMP-PACK:${base64}`;

            return {
                success: true,
                seed: seedString,
                seedString,
                code: seedString,
                packCode: seedString,
                count: items.length,
                itemCount: items.length,
                items,
                payload
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
}

module.exports = { registerProfileIpc };
