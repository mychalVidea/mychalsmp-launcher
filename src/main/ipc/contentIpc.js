const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, BASE_DIR } = require('../config');
const { searchModrinth, downloadModOrPack, checkProfileModUpdates } = require('../modrinth');
const { ensureSelfNametagModInstalled } = require('../launcher');
const nativeLoader = require('../nativeLoader');

// ── Mod Metadata & Icon Extractor with Rust Native Acceleration ──────────────
const modMetadataCache = new Map();
const packMetadataCache = new Map();

function cleanMinecraftFormatting(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/§#[0-9a-fA-F]{6}/gi, '')
        .replace(/§/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts mod metadata (id, name, version, icon) with Rust NAPI acceleration.
 */
function getCachedModMetadata(jarPath, mtimeMs) {
    const cacheKey = `${jarPath}:${mtimeMs}`;
    if (modMetadataCache.has(cacheKey)) {
        return modMetadataCache.get(cacheKey);
    }

    let meta = null;

    // ⚡ 1. Rust NAPI ultra-fast reader for Fabric mod metadata
    try {
        if (typeof nativeLoader.fastReadFabricModMeta === 'function') {
            const nativeMeta = nativeLoader.fastReadFabricModMeta(jarPath);
            if (nativeMeta && (nativeMeta.id || nativeMeta.name)) {
                meta = {
                    modId: nativeMeta.id,
                    name: nativeMeta.name || nativeMeta.id,
                    version: nativeMeta.version,
                    iconDataUrl: null
                };
            }
        }
    } catch (_) { }

    // ⚡ 2. Fallback / Icon extraction via AdmZip if needed
    try {
        let AdmZip;
        try { AdmZip = require('adm-zip'); } catch (_) { }
        if (AdmZip && fs.existsSync(jarPath)) {
            const zip = new AdmZip(jarPath);
            let name = meta?.name || null;
            let version = meta?.version || null;
            let iconDataUrl = null;
            let modId = meta?.modId || null;

            // Fabric mod descriptor (if not parsed by native or if icon needed)
            const fabEntry = zip.getEntry('fabric.mod.json');
            if (fabEntry) {
                try {
                    const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                    if (!name && fab.name) name = fab.name;
                    if (!modId && fab.id) modId = fab.id;
                    if (!version && fab.version) version = fab.version;
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

            // Quilt descriptor
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

            // Forge / NeoForge mods.toml
            if (!name) {
                const tomlEntry = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml');
                if (tomlEntry) {
                    try {
                        const txt = tomlEntry.getData().toString('utf8');
                        const mName = txt.match(/displayName\s*=\s*["']([^"']+)["']/);
                        if (mName) name = mName[1];
                        const mId = txt.match(/modId\s*=\s*["']([^"']+)["']/);
                        if (mId && !modId) modId = mId[1];
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

            if (!iconDataUrl) {
                try {
                    const iconEntry = zip.getEntry('assets/icon.png') || zip.getEntry('icon.png');
                    if (iconEntry && iconEntry.header.size < 600000) {
                        iconDataUrl = `data:image/png;base64,${iconEntry.getData().toString('base64')}`;
                    }
                } catch (_) { }
            }

            if (name || modId || version || iconDataUrl) {
                meta = { modId, name, version, iconDataUrl };
            }
        }
    } catch (_) { }

    modMetadataCache.set(cacheKey, meta);
    return meta;
}

/**
 * Extracts resource / shader pack metadata and pack.png.
 */
function getCachedPackMetadata(filePath, mtime, isDirectory) {
    const cacheKey = `${filePath}:${mtime}`;
    if (packMetadataCache.has(cacheKey)) {
        return packMetadataCache.get(cacheKey);
    }

    let meta = {
        description: null,
        iconDataUrl: null
    };

    try {
        if (isDirectory) {
            const packPngPath = path.join(filePath, 'pack.png');
            if (fs.existsSync(packPngPath)) {
                try {
                    const buf = fs.readFileSync(packPngPath);
                    if (buf.length < 800000) {
                        meta.iconDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
                    }
                } catch (_) { }
            }
            const mcmetaPath = path.join(filePath, 'pack.mcmeta');
            if (fs.existsSync(mcmetaPath)) {
                try {
                    const raw = JSON.parse(fs.readFileSync(mcmetaPath, 'utf8'));
                    if (raw?.pack?.description) {
                        const desc = typeof raw.pack.description === 'string'
                            ? raw.pack.description
                            : (raw.pack.description.text || JSON.stringify(raw.pack.description));
                        meta.description = cleanMinecraftFormatting(desc);
                    }
                } catch (_) { }
            }
        } else {
            let AdmZip;
            try { AdmZip = require('adm-zip'); } catch (_) { }
            if (AdmZip && fs.existsSync(filePath)) {
                const zip = new AdmZip(filePath);
                const packPng = zip.getEntry('pack.png') ||
                    zip.getEntry('pack.icon.png') ||
                    zip.getEntries().find(e => (e.entryName.toLowerCase().endsWith('pack.png') || e.entryName.toLowerCase().endsWith('icon.png')) && e.header.size < 800000);
                if (packPng && packPng.header.size < 800000) {
                    meta.iconDataUrl = `data:image/png;base64,${packPng.getData().toString('base64')}`;
                }

                const mcmetaEntry = zip.getEntry('pack.mcmeta');
                if (mcmetaEntry) {
                    try {
                        const raw = JSON.parse(mcmetaEntry.getData().toString('utf8'));
                        if (raw?.pack?.description) {
                            const desc = typeof raw.pack.description === 'string'
                                ? raw.pack.description
                                : (raw.pack.description.text || '');
                            meta.description = cleanMinecraftFormatting(desc);
                        }
                    } catch (_) { }
                }
            }
        }
    } catch (_) { }

    packMetadataCache.set(cacheKey, meta);
    return meta;
}

function registerContentIpc() {
    ipcMain.handle('search-modrinth', async (event, query, version, loader, category, projectType, offset, limit) => {
        return await searchModrinth(query, version, loader, category, projectType, offset, limit);
    });

    ipcMain.handle('check-profile-mod-updates', async (event, profileId, force = false) => {
        try {
            const config = loadConfig();
            const targetProfId = profileId || config.activeProfileId;
            const profile = (config.profiles || []).find(p => p.id === targetProfId) || config.profiles[0];
            if (!profile || profile.loader === 'vanilla') {
                return { success: true, updates: [] };
            }
            const targetDir = profile.gameDir || BASE_DIR;
            return await checkProfileModUpdates({
                profileId: targetProfId,
                gameDir: targetDir,
                version: profile.version || '26.2',
                loader: profile.loader || 'fabric',
                force
            });
        } catch (e) {
            console.warn('[MOD UPDATES] Chyba při kontrole aktualizací módů:', e.message);
            return { success: false, error: e.message, updates: [] };
        }
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
                    } catch (_) { }
                }
            };
            const res = await downloadModOrPack(optsWithProgress, targetDir);
            if (res && res.success && (!modOptions?.projectType || modOptions.projectType === 'mod')) {
                const detectedLoader = res.resolvedLoader || modOptions?.loader || 'fabric';
                const currentLoader = targetProfile?.loader || 'vanilla';

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

    ipcMain.handle('get-profile-mods', async (event, profileId) => {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;
        const modsDir = path.join(gameDir, 'mods');

        ensureSelfNametagModInstalled(gameDir);

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

            // Collision detection
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
        if (!filename || typeof filename !== 'string') {
            return { success: false, error: 'Neplatný název souboru.' };
        }
        const safeFilename = path.basename(filename.trim());
        if (!safeFilename || safeFilename !== filename || safeFilename.includes('..')) {
            return { success: false, error: 'Neplatný název souboru.' };
        }

        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;
        const modsDir = path.resolve(gameDir, 'mods');

        const srcPath = path.resolve(modsDir, safeFilename);
        if (!srcPath.startsWith(modsDir + path.sep) || !fs.existsSync(srcPath)) {
            return { success: false, error: 'Soubor módu nebyl nalezen.' };
        }

        let targetFilename;
        let enabled;
        if (safeFilename.toLowerCase().endsWith('.disabled')) {
            targetFilename = safeFilename.replace(/\.disabled$/i, '');
            enabled = true;
        } else {
            targetFilename = safeFilename + '.disabled';
            enabled = false;
        }

        const destPath = path.resolve(modsDir, targetFilename);
        if (!destPath.startsWith(modsDir + path.sep)) {
            return { success: false, error: 'Neplatná cílová cesta módu.' };
        }

        try {
            fs.renameSync(srcPath, destPath);
            return { success: true, oldFilename: safeFilename, newFilename: targetFilename, enabled };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('delete-profile-mod', async (event, profileId, filename) => {
        if (!filename || typeof filename !== 'string') {
            return { success: false, error: 'Neplatný název souboru.' };
        }
        const safeFilename = path.basename(filename.trim());
        if (!safeFilename || safeFilename !== filename || safeFilename.includes('..')) {
            return { success: false, error: 'Neplatný název souboru.' };
        }

        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;
        const modsDir = path.resolve(gameDir, 'mods');
        const filePath = path.resolve(modsDir, safeFilename);

        if (!filePath.startsWith(modsDir + path.sep) || !fs.existsSync(filePath)) {
            return { success: false, error: 'Soubor módu nebyl nalezen.' };
        }

        try {
            fs.unlinkSync(filePath);

            try {
                const metaPath = path.join(modsDir, '.mod_meta.json');
                if (fs.existsSync(metaPath)) {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    const deletedInfo = meta[safeFilename] || meta[safeFilename + '.disabled'] || meta[safeFilename.replace(/\.disabled$/i, '')];
                    delete meta[safeFilename];
                    delete meta[safeFilename + '.disabled'];
                    delete meta[safeFilename.replace(/\.disabled$/i, '')];
                    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

                    if (deletedInfo && config.installedMods) {
                        const cleanList = (config.installedMods || []).filter(m => m !== deletedInfo.id && m !== deletedInfo.slug);
                        if (cleanList.length !== config.installedMods.length) {
                            saveConfig({ installedMods: cleanList });
                        }
                    }
                }
            } catch (_) { }

            return { success: true, filename: safeFilename };
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

    // Packs
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
            let metaMap = {};
            try {
                const metaFile = path.join(folderPath, '.mod_meta.json');
                if (fs.existsSync(metaFile)) {
                    metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
                }
            } catch (_) { }

            const files = fs.readdirSync(folderPath);
            const packs = [];
            for (const file of files) {
                if (file.startsWith('.')) continue;

                const lower = file.toLowerCase();
                const fullPath = path.join(folderPath, file);
                const stat = fs.statSync(fullPath);
                const isDir = stat.isDirectory();

                if (lower.endsWith('.zip') || lower.endsWith('.zip.disabled') || isDir) {
                    const isEnabled = !lower.endsWith('.disabled');
                    const rawCleanName = file.replace(/\.disabled$/i, '').replace(/\.zip$/i, '');
                    const cleanName = cleanMinecraftFormatting(rawCleanName);
                    const baseFile = file.replace(/\.disabled$/i, '');
                    const fileMeta = metaMap[file] || metaMap[baseFile] || {};

                    const packMeta = getCachedPackMetadata(fullPath, stat.mtimeMs, isDir);

                    let version = fileMeta.version || null;
                    if (!version) {
                        const verMatch = cleanName.match(/[-_ ](?:v|r|ver)?([0-9]+(?:\.[0-9]+)+(?:[-_][a-zA-Z0-9]+)?)/i) ||
                            cleanName.match(/[-_ ](v?[0-9]+\.[0-9]+)/i);
                        if (verMatch) version = verMatch[1];
                    }

                    const displayName = cleanMinecraftFormatting(fileMeta.title || cleanName);
                    const modId = fileMeta.id || cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');

                    packs.push({
                        filename: file,
                        cleanName,
                        name: displayName,
                        modId,
                        modrinthId: fileMeta.id || null,
                        modrinthSlug: fileMeta.slug || null,
                        version,
                        description: packMeta?.description || null,
                        iconDataUrl: packMeta?.iconDataUrl || null,
                        enabled: isEnabled,
                        sizeFormatted: isDir ? 'Složka' : (stat.size / (1024 * 1024)).toFixed(1) + ' MB',
                        mtime: stat.mtimeMs,
                        isDirectory: isDir
                    });
                }
            }
            packs.sort((a, b) => (a.name || a.cleanName).localeCompare(b.name || b.cleanName));
            return { success: true, packs, folderPath };
        } catch (e) {
            return { success: false, error: e.message, packs: [] };
        }
    });

    ipcMain.handle('toggle-profile-pack', async (event, profileId, packType, filename) => {
        if (!filename || typeof filename !== 'string') {
            return { success: false, error: 'Neplatný název souboru.' };
        }
        const safeFilename = path.basename(filename.trim());
        if (!safeFilename || safeFilename !== filename || safeFilename.includes('..')) {
            return { success: false, error: 'Neplatný název balíčku.' };
        }

        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;
        const targetFolder = packType === 'shaderpacks' ? 'shaderpacks' : 'resourcepacks';
        const folderPath = path.resolve(gameDir, targetFolder);
        const srcPath = path.resolve(folderPath, safeFilename);

        if (!srcPath.startsWith(folderPath + path.sep) || !fs.existsSync(srcPath)) {
            return { success: false, error: 'Soubor nenalezen' };
        }

        const isCurrentlyDisabled = safeFilename.toLowerCase().endsWith('.disabled');
        const targetFilename = isCurrentlyDisabled ? safeFilename.replace(/\.disabled$/i, '') : safeFilename + '.disabled';
        const destPath = path.resolve(folderPath, targetFilename);

        if (!destPath.startsWith(folderPath + path.sep)) {
            return { success: false, error: 'Neplatná cílová cesta balíčku.' };
        }

        try {
            fs.renameSync(srcPath, destPath);
            return { success: true, oldFilename: safeFilename, newFilename: targetFilename, enabled: isCurrentlyDisabled };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('delete-profile-pack', async (event, profileId, packType, filename) => {
        if (!filename || typeof filename !== 'string') {
            return { success: false, error: 'Neplatný název souboru.' };
        }
        const safeFilename = path.basename(filename.trim());
        if (!safeFilename || safeFilename !== filename || safeFilename.includes('..')) {
            return { success: false, error: 'Neplatný název balíčku.' };
        }

        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;
        const targetFolder = packType === 'shaderpacks' ? 'shaderpacks' : 'resourcepacks';
        const folderPath = path.resolve(gameDir, targetFolder);

        let targetPath = path.resolve(folderPath, safeFilename);
        if (!fs.existsSync(targetPath)) {
            if (fs.existsSync(targetPath + '.disabled')) {
                targetPath = targetPath + '.disabled';
            } else if (safeFilename.endsWith('.disabled') && fs.existsSync(targetPath.replace(/\.disabled$/i, ''))) {
                targetPath = targetPath.replace(/\.disabled$/i, '');
            }
        }

        if (!targetPath.startsWith(folderPath + path.sep) || !fs.existsSync(targetPath)) {
            return { success: false, error: 'Balíček nebyl nalezen.' };
        }

        try {
            if (fs.statSync(targetPath).isDirectory()) {
                fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(targetPath);
            }
            return { success: true, filename: safeFilename };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = {
    registerContentIpc,
    getCachedModMetadata,
    getCachedPackMetadata,
    cleanMinecraftFormatting
};
