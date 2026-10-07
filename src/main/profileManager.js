const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

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

    let detectedVersion = '26.2';
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
            if (cData.baseModLoader && cData.baseModLoader.name && cData.baseModLoader.name.toLowerCase().includes('fabric')) {
                detectedLoader = 'fabric';
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
        version: version || '26.2',
        loader: loader || 'fabric',
        desc: `Importováno z ${path.basename(sourceDir)} • ${importedModCount} módů`,
        icon: 'import',
        lastPlayed: 'Právě importováno',
        gameDir: instanceDir
    };

    const currentProfiles = config.profiles || [];
    currentProfiles.unshift(newProfile);

    saveConfig({
        profiles: currentProfiles,
        activeProfileId: profileId
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
    const missingMods = [];

    if (fs.existsSync(srcModsDir)) {
        const files = fs.readdirSync(srcModsDir).filter(f => f.toLowerCase().endsWith('.jar'));
        const total = files.length;
        let index = 0;

        for (const file of files) {
            index++;
            const slug = extractModSlugFromFilename(file);
            if (onProgress) {
                onProgress({
                    status: `Hledám novou verzi pro ${file} (${index}/${total})...`,
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
                        version: targetMod.versionNumber
                    });
                } else {
                    // Mod does not have a 26.3 version on Modrinth yet
                    missingMods.push(file);
                }
            } catch (err) {
                missingMods.push(file);
            }
        }
    }

    // Create the new upgraded profile
    const newProfile = {
        id: newProfileId,
        name: `${sourceProfile.name} (${targetVersion})`,
        version: targetVersion,
        loader: sourceProfile.loader || 'fabric',
        desc: `Upgradováno z ${sourceProfile.version} • ${upgradedMods.length} aktualizovaných módů`,
        icon: 'upgrade',
        lastPlayed: 'Právě upgradováno',
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
        missingMods,
        totalChecked: upgradedMods.length + missingMods.length
    };
}

module.exports = {
    scanInstanceDirectory,
    importInstanceProfile,
    upgradeProfile,
    copyDirRecursiveSync
};
