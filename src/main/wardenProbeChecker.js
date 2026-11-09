const fs = require('fs');
const path = require('path');
const nativeLoader = require('./nativeLoader');

/**
 * Mod Safety Checker for MYCHAL SMP Launcher
 * Ensures players don't join with prohibited modifications.
 */

const WHITELIST_KEYWORDS = [
    'replaymod',
    'replay_mod',
    'replay-mod',
    'flashback',
    'camerastudio',
    'aperture',
    'cmdcam',
    'simplereplay',
    'sodium',
    'iris',
    'lithium',
    'ferritecore',
    'ferrite-core',
    'appleskin',
    'entityculling',
    'modernfix',
    'fabric-api',
    'indium',
    'continuity',
    'lambdynamiclights',
    'resourcify',
    'selfnametag',
    'self-nametag',
    'self_nametag'
];

const PROHIBITED_MOD_RULES = [
    // 1. Bot & Pathing (Baritone)
    {
        pattern: /baritone/i,
        name: 'Baritone',
        category: 'BOT_PATHING',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    },

    // 2. Standalone X-Ray & Ore Finders
    {
        pattern: /(xray|x-ray|x_ray|orefinder|cavefinder)/i,
        name: 'X-Ray / Ore Finder',
        category: 'XRAY',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    },

    // 3. Freecam & Unbound Decoupled Camera
    {
        pattern: /(freecam|openfreecam|simplefreecam|unbound[-_]?third[-_]?person)/i,
        name: 'Freecam / Unbound Camera',
        category: 'FREECAM',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený (umožňuje vidět skrz zdi a pokládat bloky za záda)'
    },

    // 4. World Downloader & Exploits
    {
        pattern: /(seedcracker|seed-cracker|autoclicker|auto-clicker|worlddownloader|\bwdl\b|autototem|auto-totem)/i,
        name: 'Exploit / Automatizace',
        category: 'EXPLOIT_MOD',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    },

    // 5. ESP & Visual Cheats
    {
        pattern: /(chestesp|storageesp|entityesp|playeresp|blockesp|tracers|nametags|chams)/i,
        name: 'ESP / Visual Cheats',
        category: 'RENDER_CHEAT',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    },

    // 6. Crystal Aura & Combat Cheats
    {
        pattern: /(crystalaura|crystal-aura|autocrystal|auto-crystal|anchoraura|bedaura)/i,
        name: 'Combat modifikace',
        category: 'EXPLOIT_MOD',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    },

    // 7. Full Hack Clients & Addons
    {
        pattern: /(meteor|trouserstreak|trouser-streak|blackout|bananaplus|banana-plus|glazed|orion|wurst|liquidbounce|rusherhack|futureclient|future-client|bleachhack|thunderhack|mathax|vape|riseclient|rise-client|augustus|boze|inertia|coffee|kami|maru|ogar|cerberus|higgins|phobos|earthhack|cosmos|konas|driplite|drip-lite|prestige|slinky|entropy|whiteout|ravenbplus|raven-xd|aristois|sigma|impact)/i,
        name: 'Nepovolený klient / Cheat',
        category: 'HACK_CLIENT',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    },

    // 8. Minimap, World Map & Radar Mods
    {
        pattern: /(xaero|xaerominimap|xaeros_minimap|xaero-minimap|xaeroworldmap|xaeros_world_map|xaero-world-map|journeymap|journey-map|journey_map|voxelmap|voxel-map|voxel_map|mapwriter|reiminimap|reis_minimap|zansminimap|zans_minimap|minimap|mini-map|mini_map|worldmap|world-map|world_map|ftbchunks|ftb-chunks|radarmap|entityradar)/i,
        name: 'Minimapa / World Map',
        category: 'MINIMAP',
        categoryLabel: 'Nepovolený mód',
        reason: 'Minimapy a radary nejsou povoleny'
    }
];

let AdmZip = null;
try { AdmZip = require('adm-zip'); } catch (_) { }

/**
 * Inspects internal descriptors of a jar file (fabric.mod.json, quilt.mod.json, mods.toml)
 */
function inspectJarDescriptor(jarPath) {
    if (!AdmZip || !fs.existsSync(jarPath)) return null;
    try {
        const zip = new AdmZip(jarPath);
        // 1. Fabric mod descriptor
        const fabEntry = zip.getEntry('fabric.mod.json');
        if (fabEntry) {
            try {
                const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                return {
                    id: fab.id || '',
                    name: fab.name || ''
                };
            } catch (_) { }
        }
        // 2. Quilt descriptor
        const quiltEntry = zip.getEntry('quilt.mod.json');
        if (quiltEntry) {
            try {
                const q = JSON.parse(quiltEntry.getData().toString('utf8'));
                const qMeta = q.quilt_loader?.metadata;
                return {
                    id: q.quilt_loader?.id || '',
                    name: qMeta?.name || ''
                };
            } catch (_) { }
        }
        // 3. Forge / NeoForge mods.toml
        const tomlEntry = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml');
        if (tomlEntry) {
            try {
                const txt = tomlEntry.getData().toString('utf8');
                const mName = txt.match(/displayName\s*=\s*["']([^"']+)["']/);
                const mId = txt.match(/modId\s*=\s*["']([^"']+)["']/);
                return {
                    id: mId ? mId[1] : '',
                    name: mName ? mName[1] : ''
                };
            } catch (_) { }
        }
    } catch (_) { }
    return null;
}

/**
 * Evaluates a mod file against whitelist and prohibited rules.
 * Checks filename, Modrinth metadata and internal jar descriptors.
 */
function evaluateMod(filename, fullPath = null, metaObj = null) {
    const lower = filename.toLowerCase();
    const testStrings = [lower];

    if (metaObj) {
        if (metaObj.id) testStrings.push(String(metaObj.id).toLowerCase());
        if (metaObj.slug) testStrings.push(String(metaObj.slug).toLowerCase());
        if (metaObj.title) testStrings.push(String(metaObj.title).toLowerCase());
    }

    let descriptor = null;
    if (fullPath && fs.existsSync(fullPath)) {
        descriptor = inspectJarDescriptor(fullPath);
        if (descriptor) {
            if (descriptor.id) testStrings.push(descriptor.id.toLowerCase());
            if (descriptor.name) testStrings.push(descriptor.name.toLowerCase());
        }
    }

    // 1. Prohibited rule check (Must ALWAYS run first to prevent whitelist bypass/spoofing)
    for (const rule of PROHIBITED_MOD_RULES) {
        for (const str of testStrings) {
            if (rule.pattern.test(str)) {
                return {
                    filename,
                    modName: descriptor?.name || metaObj?.title || rule.name,
                    category: rule.category,
                    categoryLabel: rule.categoryLabel,
                    reason: rule.reason
                };
            }
        }
    }

    // 2. Explicit Whitelist check
    for (const str of testStrings) {
        for (const wl of WHITELIST_KEYWORDS) {
            if (str === wl || str.includes(wl)) {
                return null; // Safe / Whitelisted
            }
        }
    }

    return null;
}

function evaluateModFile(filename) {
    return evaluateMod(filename);
}

// Inkrementální paměťová cache výsledků skenu složky mods podle otisku mtimeMs a velikosti
const wardenScanCache = new Map();

function getModsDirFingerprint(modsDir) {
    if (!fs.existsSync(modsDir)) return '';
    try {
        const files = fs.readdirSync(modsDir);
        files.sort();
        const parts = [];
        for (const f of files) {
            const l = f.toLowerCase();
            if (l.endsWith('.jar') || l.endsWith('.disabled')) {
                const fullPath = path.join(modsDir, f);
                try {
                    const st = fs.statSync(fullPath);
                    parts.push(`${f}:${st.size}:${Math.floor(st.mtimeMs)}`);
                } catch (_) { }
            }
        }
        return parts.join('|');
    } catch (_) {
        return '';
    }
}

/**
 * Scans a profile directory's mods folder for blacklisted mods.
 * Využívá bleskovou kontrolu otisku souborů (0 ms pokud nedošlo ke změně).
 */
function scanProfileForBlacklistedMods(profileDir) {
    if (!profileDir || !fs.existsSync(profileDir)) {
        return { clean: true, blockedCount: 0, illegalMods: [] };
    }

    const modsDir = path.join(profileDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        return { clean: true, blockedCount: 0, illegalMods: [] };
    }

    const fingerprint = getModsDirFingerprint(modsDir);
    const cached = wardenScanCache.get(profileDir);
    if (cached && cached.fingerprint === fingerprint) {
        return cached.result;
    }

    let metaMap = {};
    const metaPath = path.join(modsDir, '.mod_meta.json');
    if (fs.existsSync(metaPath)) {
        try {
            metaMap = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (_) { }
    }

    const illegalMods = [];

    // 1. Rust Native High-Speed Parallel Scan
    if (nativeLoader.isNativeActive()) {
        try {
            const nativeScan = nativeLoader.fastVerifyModsDir(modsDir);
            if (nativeScan && nativeScan.prohibited_mods > 0) {
                for (const m of nativeScan.mods) {
                    if (m.is_prohibited) {
                        illegalMods.push({
                            filename: m.file_name,
                            name: m.file_name,
                            category: 'PROHIBITED',
                            categoryLabel: 'Nepovolený mód',
                            reason: m.detection_reason || 'Tento mód není povolený'
                        });
                    }
                }
            }
        } catch (nativeErr) {
            console.warn('[WARDEN] Rust native scan selhal, použiji JS fallback:', nativeErr);
        }
    }

    // 2. JS Fallback & Deep Descriptor Inspection (if no prohibited mods found yet)
    if (illegalMods.length === 0) {
        try {
            const files = fs.readdirSync(modsDir);
            for (const file of files) {
                // Only inspect active jar files (ignore .disabled)
                if (file.toLowerCase().endsWith('.jar')) {
                    const fullPath = path.join(modsDir, file);
                    const meta = metaMap[file] || null;
                    const match = evaluateMod(file, fullPath, meta);
                    if (match) {
                        illegalMods.push(match);
                    }
                }
            }
        } catch (e) {
            // Silently ignore
        }
    }

    const result = {
        clean: illegalMods.length === 0,
        blockedCount: illegalMods.length,
        illegalMods
    };

    wardenScanCache.set(profileDir, { fingerprint, result });
    return result;
}

/**
 * Disables a prohibited mod by renaming it to .jar.disabled
 */
function disableIllegalMod(profileDir, filename) {
    wardenScanCache.delete(profileDir);
    const modsDir = path.join(profileDir, 'mods');
    const oldPath = path.join(modsDir, filename);
    const newPath = path.join(modsDir, filename + '.disabled');

    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        return { success: true, disabledFilename: filename + '.disabled' };
    }
    return { success: false, error: 'Soubor nebyl nalezen.' };
}

/**
 * Disables all prohibited mods found in profile.
 */
function disableAllIllegalMods(profileDir) {
    const scan = scanProfileForBlacklistedMods(profileDir);
    const disabled = [];
    for (const mod of scan.illegalMods) {
        const res = disableIllegalMod(profileDir, mod.filename);
        if (res.success) disabled.push(mod.filename);
    }
    return {
        success: true,
        disabledCount: disabled.length,
        disabled
    };
}

module.exports = {
    scanProfileForBlacklistedMods,
    disableIllegalMod,
    disableAllIllegalMods,
    evaluateMod,
    evaluateModFile,
    WHITELIST_KEYWORDS
};

