const fs = require('fs');
const path = require('path');

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
    'resourcify'
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

    // 3. Freecam Mods
    {
        pattern: /(freecam|openfreecam|simplefreecam)/i,
        name: 'Freecam',
        category: 'FREECAM',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
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
        pattern: /(meteor|trouserstreak|trouser-streak|blackout|bananaplus|banana-plus|glazed|orion|wurst|liquidbounce|rusherhack|futureclient|future-client|bleachhack|thunderhack|mathax|vape|riseclient|rise-client|augustus|boze|inertia|coffee|kami|maru|ogar|cerberus|higgins|phobos|earthhack|cosmos|konas|driplite|drip-lite|prestige|slinky|entropy|whiteout|ravenbplus|raven-xd)/i,
        name: 'Nepovolený klient / Cheat',
        category: 'HACK_CLIENT',
        categoryLabel: 'Nepovolený mód',
        reason: 'Tento mód není povolený'
    }
];

/**
 * Checks a filename or mod id against prohibited rules.
 */
function evaluateModFile(filename) {
    const lower = filename.toLowerCase();

    // 1. Explicit Whitelist check (e.g. Replay Mod)
    for (const wl of WHITELIST_KEYWORDS) {
        if (lower.includes(wl)) {
            return null; // Whitelisted!
        }
    }

    // 2. Prohibited rule check
    for (const rule of PROHIBITED_MOD_RULES) {
        if (rule.pattern.test(lower)) {
            return {
                filename,
                modName: rule.name,
                category: rule.category,
                categoryLabel: rule.categoryLabel,
                reason: rule.reason
            };
        }
    }

    return null;
}

/**
 * Scans a profile directory's mods folder for blacklisted mods.
 */
function scanProfileForBlacklistedMods(profileDir) {
    if (!profileDir || !fs.existsSync(profileDir)) {
        return { clean: true, blockedCount: 0, illegalMods: [] };
    }

    const modsDir = path.join(profileDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        return { clean: true, blockedCount: 0, illegalMods: [] };
    }

    const illegalMods = [];
    try {
        const files = fs.readdirSync(modsDir);
        for (const file of files) {
            // Only inspect active jar files (ignore .disabled)
            if (file.toLowerCase().endsWith('.jar')) {
                const match = evaluateModFile(file);
                if (match) {
                    illegalMods.push(match);
                }
            }
        }
    } catch (e) {
        // Silently ignore
    }

    return {
        clean: illegalMods.length === 0,
        blockedCount: illegalMods.length,
        illegalMods
    };
}

/**
 * Disables a prohibited mod by renaming it to .jar.disabled
 */
function disableIllegalMod(profileDir, filename) {
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
    evaluateModFile,
    WHITELIST_KEYWORDS
};
