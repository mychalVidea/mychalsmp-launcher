const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, saveConfig } = require('./config');
const nativeLoader = require('./nativeLoader');

/**
 * Copies a directory recursively.
 */
function copyDirRecursiveSync(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursiveSync(srcPath, destPath);
        } else {
            try {
                fs.copyFileSync(srcPath, destPath);
            } catch (e) {
                console.warn(`[COPY] Selhalo kopírování ${srcPath}:`, e.message);
            }
        }
    }
}

/**
 * Scans an external directory (Prism, CurseForge, Modrinth, .minecraft)
 * to detect Minecraft version, loader, mods count, and available configs.
 */
function scanInstanceDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        throw new Error('Vybraná složka neexistuje.');
    }

    let detectedVersion = '26.3';
    let detectedLoader = 'fabric';
    let instanceName = path.basename(dirPath);

    // 1. Prism / MultiMC instance.cfg check
    const instanceCfgPath = path.join(dirPath, 'instance.cfg');
    if (fs.existsSync(instanceCfgPath)) {
        try {
            const content = fs.readFileSync(instanceCfgPath, 'utf-8');
            const vMatch = content.match(/IntendedVersion=([^\r\n]+)/);
            if (vMatch) detectedVersion = vMatch[1].trim();
            const nMatch = content.match(/name=([^\r\n]+)/);
            if (nMatch) instanceName = nMatch[1].trim();
        } catch (e) {}
    }

    // 2. mmc-pack.json check (MultiMC / Prism component list)
    const mmcPackPath = path.join(dirPath, 'mmc-pack.json');
    if (fs.existsSync(mmcPackPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(mmcPackPath, 'utf-8'));
            if (data.components) {
                const mcComp = data.components.find(c => c.uid === 'net.minecraft' || c.id === 'net.minecraft');
                if (mcComp && mcComp.version) detectedVersion = mcComp.version;
                const fabComp = data.components.find(c => c.uid === 'net.fabricmc.fabric-loader' || c.id === 'net.fabricmc.fabric-loader');
                if (fabComp) detectedLoader = 'fabric';
                const forgeComp = data.components.find(c => c.uid === 'net.minecraftforge' || c.id === 'net.minecraftforge');
                if (forgeComp) detectedLoader = 'forge';
                const neoComp = data.components.find(c => c.uid === 'net.neoforged' || c.id === 'net.neoforged');
                if (neoComp) detectedLoader = 'neoforge';
            }
        } catch (e) {}
    }

    // 3. CurseForge minecraftinstance.json
    const curseJsonPath = path.join(dirPath, 'minecraftinstance.json');
    if (fs.existsSync(curseJsonPath)) {
        try {
            const cData = JSON.parse(fs.readFileSync(curseJsonPath, 'utf-8'));
            if (cData.gameVersion) detectedVersion = cData.gameVersion;
            if (cData.name) instanceName = cData.name;
            if (cData.baseModLoader && cData.baseModLoader.name) {
                const bName = cData.baseModLoader.name.toLowerCase();
                if (bName.includes('fabric') || bName.includes('quilt')) detectedLoader = 'fabric';
                else if (bName.includes('neoforge')) detectedLoader = 'neoforge';
                else if (bName.includes('forge')) detectedLoader = 'forge';
            }
        } catch (e) {}
    }

    // 4. Modrinth modrinth.index.json
    const modrinthIndexPath = path.join(dirPath, 'modrinth.index.json');
    if (fs.existsSync(modrinthIndexPath)) {
        try {
            const mData = JSON.parse(fs.readFileSync(modrinthIndexPath, 'utf-8'));
            if (mData.game) detectedVersion = mData.game;
            if (mData.name) instanceName = mData.name;
            if (mData.dependencies) {
                if (mData.dependencies['fabric-loader'] || mData.dependencies['quilt-loader']) detectedLoader = 'fabric';
                else if (mData.dependencies['neoforge']) detectedLoader = 'neoforge';
                else if (mData.dependencies['forge']) detectedLoader = 'forge';
            }
        } catch (e) {}
    }

    // Subdirectory check (support .minecraft inside MultiMC instances/.minecraft)
    let effectiveGameDir = dirPath;
    const subMinecraft = path.join(dirPath, '.minecraft');
    const subMinecraftAlt = path.join(dirPath, 'minecraft');
    if (fs.existsSync(subMinecraft) && fs.existsSync(path.join(subMinecraft, 'mods'))) {
        effectiveGameDir = subMinecraft;
    } else if (fs.existsSync(subMinecraftAlt) && fs.existsSync(path.join(subMinecraftAlt, 'mods'))) {
        effectiveGameDir = subMinecraftAlt;
    }

    // Scan mods
    const modsDir = path.join(effectiveGameDir, 'mods');
    let modCount = 0;
    const modFiles = [];
    if (fs.existsSync(modsDir)) {
        try {
            const files = fs.readdirSync(modsDir);
            for (const f of files) {
                if (f.toLowerCase().endsWith('.jar')) {
                    modCount++;
                    modFiles.push(f);
                }
            }
        } catch (e) {}
    }

    // Pokud máme nalezené módy a loader je stále vanilla, odvodíme ho z módů
    if (modCount > 0 && detectedLoader === 'vanilla') {
        const hasNeoForge = modFiles.some(f => f.toLowerCase().includes('neoforge'));
        const hasForge = modFiles.some(f => f.toLowerCase().includes('forge') && !f.toLowerCase().includes('neoforge'));
        if (hasNeoForge) detectedLoader = 'neoforge';
        else if (hasForge) detectedLoader = 'forge';
        else detectedLoader = 'fabric';
    }

    // Scan resourcepacks
    const rpDir = path.join(effectiveGameDir, 'resourcepacks');
    let rpCount = 0;
    if (fs.existsSync(rpDir)) {
        try {
            rpCount = fs.readdirSync(rpDir).filter(f => !f.startsWith('.')).length;
        } catch (e) {}
    }

    const hasConfig = fs.existsSync(path.join(effectiveGameDir, 'config'));
    const hasOptions = fs.existsSync(path.join(effectiveGameDir, 'options.txt'));
    const hasShaderpacks = fs.existsSync(path.join(effectiveGameDir, 'shaderpacks'));

    return {
        originalDir: dirPath,
        effectiveGameDir,
        name: instanceName,
        detectedVersion,
        detectedLoader,
        modCount,
        modFiles: modFiles.slice(0, 50),
        rpCount,
        hasConfig,
        hasOptions,
        hasShaderpacks
    };
}

/**
 * Imports an external instance into MYCHAL SMP Launcher.
 */
async function importInstanceProfile(data, baseDir) {
    const { sourceDir, effectiveDir, name, version, loader } = data;
    const config = loadConfig();

    const profileId = `imported-${Date.now()}`;
    const instanceDir = path.join(baseDir, 'instances', profileId);
    fs.mkdirSync(instanceDir, { recursive: true });

    const srcDir = effectiveDir || sourceDir;

    // 1. Copy options.txt (keybinds, sensitivity, FOV, sound)
    const optionsSrc = path.join(srcDir, 'options.txt');
    if (fs.existsSync(optionsSrc)) {
        try {
            fs.copyFileSync(optionsSrc, path.join(instanceDir, 'options.txt'));
        } catch (e) {}
    }

    // 2. Copy config directory
    const configSrc = path.join(srcDir, 'config');
    if (fs.existsSync(configSrc)) {
        copyDirRecursiveSync(configSrc, path.join(instanceDir, 'config'));
    }

    // 3. Copy mods
    const modsSrc = path.join(srcDir, 'mods');
    let importedModCount = 0;
    if (fs.existsSync(modsSrc)) {
        const destMods = path.join(instanceDir, 'mods');
        fs.mkdirSync(destMods, { recursive: true });
        const files = fs.readdirSync(modsSrc);
        for (const file of files) {
            if (file.toLowerCase().endsWith('.jar')) {
                try {
                    fs.copyFileSync(path.join(modsSrc, file), path.join(destMods, file));
                    importedModCount++;
                } catch (e) {}
            }
        }
    }

    // Automaticky přidat náš Self Nametag mod do importované instance
    try {
        const bundledNametag = path.join(__dirname, '../../assets/mods/selfnametag-1.0.0.jar');
        if (fs.existsSync(bundledNametag)) {
            const destMods = path.join(instanceDir, 'mods');
            if (!fs.existsSync(destMods)) fs.mkdirSync(destMods, { recursive: true });
            fs.copyFileSync(bundledNametag, path.join(destMods, 'selfnametag-1.0.0.jar'));
        }
    } catch (_) {}

    // 4. Copy resourcepacks & shaderpacks
    const rpSrc = path.join(srcDir, 'resourcepacks');
    if (fs.existsSync(rpSrc)) {
        copyDirRecursiveSync(rpSrc, path.join(instanceDir, 'resourcepacks'));
    }
    const spSrc = path.join(srcDir, 'shaderpacks');
    if (fs.existsSync(spSrc)) {
        copyDirRecursiveSync(spSrc, path.join(instanceDir, 'shaderpacks'));
    }

    // Add new profile
    const newProfile = {
        id: profileId,
        name: name || `Importovaný profil (${version})`,
        version: version || '26.3',
        loader: loader || 'fabric',
        isImported: true,
        optimizedChosen: (loader === 'fabric' || (!loader && true)) ? 'optimized' : 'vanilla',
        desc: `Importováno z ${path.basename(sourceDir)} • ${importedModCount} módů`,
        icon: 'import',
        lastPlayed: 'Právě importováno',
        playtimeSeconds: 0,
        gameDir: instanceDir
    };

    const currentProfiles = config.profiles || [];
    currentProfiles.unshift(newProfile);

    saveConfig({
        profiles: currentProfiles,
        activeProfileId: profileId,
        version: newProfile.version,
        loader: newProfile.loader
    });

    return {
        success: true,
        profile: newProfile,
        importedModCount
    };
}

/**
 * Strips version and loader suffixes from a mod jar filename to deduce the mod slug/name.
 */
function extractModSlugFromFilename(filename) {
    let clean = filename
        .replace(/\.jar$/i, '')
        .replace(/[-_](fabric|forge|quilt|neoforge|mc[0-9.]+|v?[0-9].*)/gi, '')
        .replace(/[-_]+[0-9].*$/, '')
        .trim();
    if (!clean) {
        clean = filename.replace(/\.jar$/i, '').split(/[-_]/)[0];
    }
    return clean.toLowerCase();
}

/**
 * Queries Modrinth API to find a compatible version file for target Minecraft version and loader.
 */
async function findModrinthVersionForTarget(slug, targetVersion, loader = 'fabric') {
    try {
        // Direct project versions endpoint
        const directUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?game_versions=${encodeURIComponent(JSON.stringify([targetVersion]))}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`;
        const resp = await fetch(directUrl, { headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' } });
        if (resp.ok) {
            const versions = await resp.json();
            if (Array.isArray(versions) && versions.length > 0) {
                const primaryFile = versions[0].files.find(f => f.primary) || versions[0].files[0];
                if (primaryFile) {
                    return {
                        versionNumber: versions[0].version_number,
                        downloadUrl: primaryFile.url,
                        filename: primaryFile.filename
                    };
                }
            }
        }

        // Fallback: search Modrinth by query
        const searchUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(slug)}&limit=3`;
        const sResp = await fetch(searchUrl, { headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' } });
        if (sResp.ok) {
            const sData = await sResp.json();
            if (sData.hits && sData.hits.length > 0) {
                const projectSlug = sData.hits[0].slug;
                const vUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}/version?game_versions=${encodeURIComponent(JSON.stringify([targetVersion]))}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`;
                const vResp = await fetch(vUrl, { headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' } });
                if (vResp.ok) {
                    const vList = await vResp.json();
                    if (Array.isArray(vList) && vList.length > 0) {
                        const file = vList[0].files.find(f => f.primary) || vList[0].files[0];
                        if (file) {
                            return {
                                versionNumber: vList[0].version_number,
                                downloadUrl: file.url,
                                filename: file.filename
                            };
                        }
                    }
                }
            }
        }
    } catch (e) {
        // Network or fetch error
    }
    return null;
}

/**
 * Downloads a file from URL to destination path.
 */
async function downloadFile(url, destPath) {
    if (nativeLoader.isNativeActive()) {
        try {
            await nativeLoader.fastDownloadFile(url, destPath);
            return;
        } catch (_) {}
    }
    const res = await fetch(url, { headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));
}

/**
 * Upgrades an existing profile to a target Minecraft version (e.g. 26.2 -> 26.3):
 * - Creates a new profile
 * - Migrates options.txt (keybinds, sensitivity, FOV, graphics)
 * - Migrates config/ (mod configurations)
 * - Migrates resourcepacks/ (texture packs)
 * - Upgrades mods by finding & downloading matching version jars from Modrinth
 */
async function upgradeProfile(sourceProfileId, targetVersion, baseDir, onProgress) {
    const config = loadConfig();
    const sourceProfile = (config.profiles || []).find(p => p.id === sourceProfileId) || config.profiles[0];

    const sourceGameDir = sourceProfile.gameDir || baseDir;
    const newProfileId = `profile-${targetVersion}-${Date.now()}`;
    const targetGameDir = path.join(baseDir, 'instances', newProfileId);
    fs.mkdirSync(targetGameDir, { recursive: true });

    if (onProgress) onProgress({ status: 'Překopírovávám nastavení hry (options.txt)...' });

    // 1. Copy options.txt
    const srcOptions = path.join(sourceGameDir, 'options.txt');
    if (fs.existsSync(srcOptions)) {
        try {
            fs.copyFileSync(srcOptions, path.join(targetGameDir, 'options.txt'));
        } catch (e) {}
    }

    // 2. Copy config/
    if (onProgress) onProgress({ status: 'Překopírovávám konfigurace módů (config/)...' });
    const srcConfig = path.join(sourceGameDir, 'config');
    if (fs.existsSync(srcConfig)) {
        copyDirRecursiveSync(srcConfig, path.join(targetGameDir, 'config'));
    }

    // 3. Copy resourcepacks/
    if (onProgress) onProgress({ status: 'Překopírovávám textury a resource packy...' });
    const srcRp = path.join(sourceGameDir, 'resourcepacks');
    if (fs.existsSync(srcRp)) {
        copyDirRecursiveSync(srcRp, path.join(targetGameDir, 'resourcepacks'));
    }

    // 4. Copy shaderpacks/
    const srcSp = path.join(sourceGameDir, 'shaderpacks');
    if (fs.existsSync(srcSp)) {
        copyDirRecursiveSync(srcSp, path.join(targetGameDir, 'shaderpacks'));
    }

    // 5. Scan & Upgrade mods
    const srcModsDir = path.join(sourceGameDir, 'mods');
    const destModsDir = path.join(targetGameDir, 'mods');
    fs.mkdirSync(destModsDir, { recursive: true });

    const upgradedMods = [];
    const disabledMods = [];
    const missingMods = [];

    let AdmZip = null;
    try { AdmZip = require('adm-zip'); } catch (_) {}

    if (fs.existsSync(srcModsDir)) {
        const files = fs.readdirSync(srcModsDir).filter(f => f.toLowerCase().endsWith('.jar') || f.toLowerCase().endsWith('.jar.disabled'));
        const total = files.length;
        let index = 0;

        for (const file of files) {
            index++;
            const cleanJarName = file.replace(/\.disabled$/i, '');
            let modId = null;
            let modName = null;

            if (nativeLoader.isNativeActive()) {
                const meta = nativeLoader.fastReadFabricModMeta(path.join(srcModsDir, file));
                if (meta) {
                    if (meta.id) modId = String(meta.id).trim();
                    if (meta.name) modName = String(meta.name).trim();
                }
            } else if (AdmZip) {
                try {
                    const zip = new AdmZip(path.join(srcModsDir, file));
                    const fabEntry = zip.getEntry('fabric.mod.json');
                    if (fabEntry) {
                        const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                        if (fab.id) modId = String(fab.id).trim();
                        if (fab.name) modName = String(fab.name).trim();
                    }
                } catch (_) {}
            }

            const slug = modId || extractModSlugFromFilename(cleanJarName);
            const displayName = modName || slug || cleanJarName;

            if (onProgress) {
                onProgress({
                    status: `Hledám verzi pro ${displayName} (${index}/${total})...`,
                    percent: Math.round((index / total) * 100)
                });
            }

            try {
                const targetMod = await findModrinthVersionForTarget(slug, targetVersion, sourceProfile.loader || 'fabric');
                if (targetMod) {
                    const destPath = path.join(destModsDir, targetMod.filename);
                    await downloadFile(targetMod.downloadUrl, destPath);
                    upgradedMods.push({
                        oldFile: file,
                        newFile: targetMod.filename,
                        name: displayName,
                        version: targetMod.versionNumber
                    });
                } else {
                    // Mód zatím nemá verzi pro cílový Minecraft:
                    // Zkopírujeme jej s příponou .disabled, aby byl v novém profilu bezpečně zakázán a neshodil hru
                    const disabledDestPath = path.join(destModsDir, `${cleanJarName}.disabled`);
                    try {
                        fs.copyFileSync(path.join(srcModsDir, file), disabledDestPath);
                    } catch (_) {}

                    disabledMods.push({
                        file: cleanJarName,
                        disabledFile: `${cleanJarName}.disabled`,
                        name: displayName,
                        reason: `Zatím nepodporuje verzi ${targetVersion}`
                    });
                    missingMods.push(cleanJarName);
                }
            } catch (err) {
                const disabledDestPath = path.join(destModsDir, `${cleanJarName}.disabled`);
                try {
                    fs.copyFileSync(path.join(srcModsDir, file), disabledDestPath);
                } catch (_) {}

                disabledMods.push({
                    file: cleanJarName,
                    disabledFile: `${cleanJarName}.disabled`,
                    name: displayName,
                    reason: `Chyba ověření: ${err.message}`
                });
                missingMods.push(cleanJarName);
            }
        }
    }

    // Create the new upgraded profile
    const descText = disabledMods.length > 0
        ? `Upgradováno z ${sourceProfile.version} • ${upgradedMods.length} aktualizováno, ${disabledMods.length} zakázáno (nekompatibilní)`
        : `Upgradováno z ${sourceProfile.version} • ${upgradedMods.length} aktualizovaných módů`;

    const newProfile = {
        id: newProfileId,
        name: `${sourceProfile.name} (${targetVersion})`,
        version: targetVersion,
        loader: sourceProfile.loader || 'fabric',
        optimizedChosen: (sourceProfile.loader === 'fabric' || !sourceProfile.loader) ? 'optimized' : 'vanilla',
        desc: descText,
        icon: 'upgrade',
        lastPlayed: 'Právě upgradováno',
        playtimeSeconds: 0,
        gameDir: targetGameDir
    };

    const updatedProfiles = [...(config.profiles || []), newProfile];
    saveConfig({
        profiles: updatedProfiles,
        activeProfileId: newProfileId,
        version: targetVersion,
        loader: newProfile.loader
    });

    return {
        success: true,
        profile: newProfile,
        upgradedMods,
        disabledMods,
        missingMods,
        totalChecked: upgradedMods.length + disabledMods.length
    };
}

/**
 * Formats a timestamp into user-friendly Czech string.
 */
function formatDiscoveredLastPlayed(timestamp) {
    if (!timestamp || isNaN(timestamp) || timestamp <= 0) return 'Dříve';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'Dříve';

    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const today = new Date();
    const isToday = d.getDate() === today.getDate() &&
                    d.getMonth() === today.getMonth() &&
                    d.getFullYear() === today.getFullYear();

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() &&
                        d.getMonth() === yesterday.getMonth() &&
                        d.getFullYear() === yesterday.getFullYear();

    if (isToday) return `Dnes v ${timeStr}`;
    if (isYesterday) return `Včera v ${timeStr}`;
    return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/**
 * Automatically discovers profiles and instances from installed launchers
 * across Windows, Linux, and macOS (.minecraft, Lunar Client, Prism, MultiMC, Modrinth, CurseForge).
 * Returns the top 10 most recently played or modified profiles.
 */
function discoverInstalledProfiles() {
    const candidates = [];
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const seenDirs = new Set();

    function addCandidate(cand) {
        if (!cand || !cand.gameDir) return;
        const normDir = path.normalize(cand.gameDir).toLowerCase();
        if (seenDirs.has(normDir)) return;
        seenDirs.add(normDir);
        candidates.push(cand);
    }

    // ── 1. Vanilla Minecraft (.minecraft) ──────────────────────────────────
    const dotMinecraftPaths = [];
    if (isWin) {
        if (process.env.APPDATA) dotMinecraftPaths.push(path.join(process.env.APPDATA, '.minecraft'));
        dotMinecraftPaths.push(path.join(home, '.minecraft'));
    } else if (isMac) {
        dotMinecraftPaths.push(path.join(home, 'Library', 'Application Support', 'minecraft'));
    } else {
        dotMinecraftPaths.push(path.join(home, '.minecraft'));
        dotMinecraftPaths.push(path.join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft'));
    }

    for (const mcDir of dotMinecraftPaths) {
        if (!fs.existsSync(mcDir)) continue;

        // A) Read launcher_profiles.json
        const profilesFiles = [
            path.join(mcDir, 'launcher_profiles.json'),
            path.join(mcDir, 'launcher_profiles_microsoft_store.json')
        ];

        for (const pf of profilesFiles) {
            if (!fs.existsSync(pf)) continue;
            try {
                const data = JSON.parse(fs.readFileSync(pf, 'utf-8'));
                const profs = data.profiles || {};
                for (const [profKey, prof] of Object.entries(profs)) {
                    if (!prof) continue;
                    const pName = prof.name || profKey;
                    const vId = String(prof.lastVersionId || '');

                    let detectedLoader = 'vanilla';
                    const vLower = vId.toLowerCase();
                    if (vLower.includes('fabric')) detectedLoader = 'fabric';
                    else if (vLower.includes('neoforge')) detectedLoader = 'neoforge';
                    else if (vLower.includes('forge')) detectedLoader = 'forge';
                    else if (vLower.includes('quilt')) detectedLoader = 'fabric';

                    const vMatch = vId.match(/(\d+\.\d+(\.\d+)?)/);
                    const detectedVersion = vMatch ? vMatch[1] : (vId || '26.3');

                    const effectiveDir = prof.gameDir ? path.resolve(prof.gameDir) : mcDir;
                    if (!fs.existsSync(effectiveDir)) continue;

                    let modCount = 0;
                    const modsPath = path.join(effectiveDir, 'mods');
                    if (fs.existsSync(modsPath)) {
                        try {
                            modCount = fs.readdirSync(modsPath).filter(f => f.toLowerCase().endsWith('.jar')).length;
                        } catch (_) {}
                    }
                    if (modCount > 0 && detectedLoader === 'vanilla') {
                        detectedLoader = 'fabric';
                    }

                    let ts = 0;
                    if (prof.lastUsed) ts = new Date(prof.lastUsed).getTime();
                    else if (prof.created) ts = new Date(prof.created).getTime();
                    if (!ts || isNaN(ts)) {
                        try {
                            const optStat = fs.statSync(path.join(effectiveDir, 'options.txt'));
                            ts = optStat.mtimeMs;
                        } catch (_) {
                            try {
                                ts = fs.statSync(effectiveDir).mtimeMs;
                            } catch (_) { ts = 0; }
                        }
                    }

                    addCandidate({
                        id: `vanilla-${profKey}`,
                        source: 'Minecraft Launcher',
                        sourceIcon: 'minecraft',
                        name: pName,
                        version: detectedVersion,
                        loader: detectedLoader,
                        gameDir: effectiveDir,
                        modCount,
                        lastPlayedTimestamp: ts || 0,
                        lastPlayedFormatted: formatDiscoveredLastPlayed(ts)
                    });
                }
            } catch (_) {}
        }

        // B) Scan .minecraft/versions directories
        const versionsDir = path.join(mcDir, 'versions');
        if (fs.existsSync(versionsDir)) {
            try {
                const subdirs = fs.readdirSync(versionsDir, { withFileTypes: true });
                for (const sub of subdirs) {
                    if (!sub.isDirectory()) continue;
                    const vPath = path.join(versionsDir, sub.name);
                    const jsonPath = path.join(vPath, `${sub.name}.json`);
                    if (!fs.existsSync(jsonPath)) continue;

                    let detectedLoader = 'vanilla';
                    const nLower = sub.name.toLowerCase();
                    if (nLower.includes('fabric')) detectedLoader = 'fabric';
                    else if (nLower.includes('neoforge')) detectedLoader = 'neoforge';
                    else if (nLower.includes('forge')) detectedLoader = 'forge';
                    else if (nLower.includes('quilt')) detectedLoader = 'fabric';

                    const vMatch = sub.name.match(/(\d+\.\d+(\.\d+)?)/);
                    const detectedVersion = vMatch ? vMatch[1] : sub.name;

                    let ts = 0;
                    try {
                        ts = fs.statSync(jsonPath).mtimeMs;
                    } catch (_) {}

                    addCandidate({
                        id: `mcver-${sub.name}`,
                        source: 'Minecraft Launcher',
                        sourceIcon: 'minecraft',
                        name: sub.name,
                        version: detectedVersion,
                        loader: detectedLoader,
                        gameDir: mcDir,
                        modCount: 0,
                        lastPlayedTimestamp: ts || 0,
                        lastPlayedFormatted: formatDiscoveredLastPlayed(ts)
                    });
                }
            } catch (_) {}
        }
    }

    // ── 2. Lunar Client (.lunarclient) ─────────────────────────────────────
    const lunarRoots = [
        path.join(home, '.lunarclient'),
        ...(process.env.USERPROFILE ? [path.join(process.env.USERPROFILE, '.lunarclient')] : []),
        ...(process.env.APPDATA ? [path.join(process.env.APPDATA, '.lunarclient')] : [])
    ];

    for (const lRoot of lunarRoots) {
        if (!fs.existsSync(lRoot)) continue;
        const multiverDir = path.join(lRoot, 'offline', 'multiver');
        if (fs.existsSync(multiverDir)) {
            try {
                const subs = fs.readdirSync(multiverDir, { withFileTypes: true });
                for (const sub of subs) {
                    if (!sub.isDirectory()) continue;
                    const vDir = path.join(multiverDir, sub.name);

                    const vClean = sub.name.replace(/^v/i, '').replace(/_/g, '.');
                    const vMatch = vClean.match(/(\d+\.\d+(\.\d+)?)/);
                    const detectedVersion = vMatch ? vMatch[1] : vClean;

                    let modCount = 0;
                    const modsPath = path.join(vDir, 'mods');
                    if (fs.existsSync(modsPath)) {
                        try {
                            modCount = fs.readdirSync(modsPath).filter(f => f.toLowerCase().endsWith('.jar')).length;
                        } catch (_) {}
                    }

                    let ts = 0;
                    try {
                        const opt = path.join(vDir, 'options.txt');
                        if (fs.existsSync(opt)) ts = fs.statSync(opt).mtimeMs;
                        else ts = fs.statSync(vDir).mtimeMs;
                    } catch (_) {}

                    addCandidate({
                        id: `lunar-${sub.name}`,
                        source: 'Lunar Client',
                        sourceIcon: 'lunar',
                        name: `Lunar Client (${sub.name})`,
                        version: detectedVersion,
                        loader: 'fabric',
                        gameDir: vDir,
                        modCount,
                        lastPlayedTimestamp: ts || 0,
                        lastPlayedFormatted: formatDiscoveredLastPlayed(ts)
                    });
                }
            } catch (_) {}
        }
    }

    // ── 3. Prism Launcher & MultiMC ────────────────────────────────────────
    const prismRoots = [
        path.join(home, '.local', 'share', 'PrismLauncher', 'instances'),
        path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances'),
        path.join(home, '.local', 'share', 'multimc', 'instances'),
        path.join(home, 'MultiMC', 'instances'),
        path.join(home, 'Library', 'Application Support', 'PrismLauncher', 'instances'),
        path.join(home, 'Library', 'Application Support', 'MultiMC', 'instances'),
        ...(process.env.APPDATA ? [
            path.join(process.env.APPDATA, 'PrismLauncher', 'instances'),
            path.join(process.env.APPDATA, 'MultiMC', 'instances')
        ] : [])
    ];

    for (const pRoot of prismRoots) {
        if (!fs.existsSync(pRoot)) continue;
        const isPrism = pRoot.toLowerCase().includes('prism');
        const sourceName = isPrism ? 'Prism Launcher' : 'MultiMC';
        try {
            const subs = fs.readdirSync(pRoot, { withFileTypes: true });
            for (const sub of subs) {
                if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
                const instDir = path.join(pRoot, sub.name);
                try {
                    const scan = scanInstanceDirectory(instDir);
                    let ts = 0;
                    try {
                        const opt = path.join(scan.effectiveGameDir, 'options.txt');
                        if (fs.existsSync(opt)) ts = fs.statSync(opt).mtimeMs;
                        else ts = fs.statSync(instDir).mtimeMs;
                    } catch (_) {}

                    addCandidate({
                        id: `prism-${sub.name}`,
                        source: sourceName,
                        sourceIcon: 'prism',
                        name: scan.name || sub.name,
                        version: scan.detectedVersion,
                        loader: scan.detectedLoader,
                        gameDir: scan.effectiveGameDir || instDir,
                        modCount: scan.modCount,
                        lastPlayedTimestamp: ts || 0,
                        lastPlayedFormatted: formatDiscoveredLastPlayed(ts)
                    });
                } catch (_) {}
            }
        } catch (_) {}
    }

    // ── 4. Modrinth App ────────────────────────────────────────────────────
    const modrinthRoots = [
        path.join(home, '.local', 'share', 'ModrinthApp', 'profiles'),
        path.join(home, '.var', 'app', 'com.modrinth.ModrinthApp', 'data', 'ModrinthApp', 'profiles'),
        path.join(home, '.config', 'ModrinthApp', 'profiles'),
        path.join(home, 'Library', 'Application Support', 'ModrinthApp', 'profiles'),
        ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'ModrinthApp', 'profiles')] : [])
    ];

    for (const mRoot of modrinthRoots) {
        if (!fs.existsSync(mRoot)) continue;
        try {
            const subs = fs.readdirSync(mRoot, { withFileTypes: true });
            for (const sub of subs) {
                if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
                const profDir = path.join(mRoot, sub.name);
                try {
                    const scan = scanInstanceDirectory(profDir);
                    let ts = 0;
                    try {
                        const opt = path.join(scan.effectiveGameDir, 'options.txt');
                        if (fs.existsSync(opt)) ts = fs.statSync(opt).mtimeMs;
                        else ts = fs.statSync(profDir).mtimeMs;
                    } catch (_) {}

                    addCandidate({
                        id: `modrinth-${sub.name}`,
                        source: 'Modrinth App',
                        sourceIcon: 'modrinth',
                        name: scan.name || sub.name,
                        version: scan.detectedVersion,
                        loader: scan.detectedLoader,
                        gameDir: scan.effectiveGameDir || profDir,
                        modCount: scan.modCount,
                        lastPlayedTimestamp: ts || 0,
                        lastPlayedFormatted: formatDiscoveredLastPlayed(ts)
                    });
                } catch (_) {}
            }
        } catch (_) {}
    }

    // ── 5. CurseForge ──────────────────────────────────────────────────────
    const curseRoots = [
        path.join(home, 'curseforge', 'minecraft', 'Instances'),
        path.join(home, '.local', 'share', 'curseforge', 'minecraft', 'Instances'),
        path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances'),
        ...(process.env.USERPROFILE ? [path.join(process.env.USERPROFILE, 'curseforge', 'minecraft', 'Instances')] : [])
    ];

    for (const cRoot of curseRoots) {
        if (!fs.existsSync(cRoot)) continue;
        try {
            const subs = fs.readdirSync(cRoot, { withFileTypes: true });
            for (const sub of subs) {
                if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
                const instDir = path.join(cRoot, sub.name);
                try {
                    const scan = scanInstanceDirectory(instDir);
                    let ts = 0;
                    try {
                        const opt = path.join(scan.effectiveGameDir, 'options.txt');
                        if (fs.existsSync(opt)) ts = fs.statSync(opt).mtimeMs;
                        else ts = fs.statSync(instDir).mtimeMs;
                    } catch (_) {}

                    addCandidate({
                        id: `curse-${sub.name}`,
                        source: 'CurseForge',
                        sourceIcon: 'curseforge',
                        name: scan.name || sub.name,
                        version: scan.detectedVersion,
                        loader: scan.detectedLoader,
                        gameDir: scan.effectiveGameDir || instDir,
                        modCount: scan.modCount,
                        lastPlayedTimestamp: ts || 0,
                        lastPlayedFormatted: formatDiscoveredLastPlayed(ts)
                    });
                } catch (_) {}
            }
        } catch (_) {}
    }

    // ── 6. Seřadit podle času posledního hraní / změny (sestupně) a vybrat TOP 10 ──
    candidates.sort((a, b) => (b.lastPlayedTimestamp || 0) - (a.lastPlayedTimestamp || 0));

    return candidates.slice(0, 10);
}

module.exports = {
    scanInstanceDirectory,
    importInstanceProfile,
    upgradeProfile,
    copyDirRecursiveSync,
    discoverInstalledProfiles
};
