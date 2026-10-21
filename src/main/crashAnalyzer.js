const fs = require('fs');
const path = require('path');
const https = require('https');
const { shell } = require('electron');
const { downloadModOrPack, resolveModrinthProject, isModInstalledInDir } = require('./modrinth');
const { isJarFileValid } = require('./launcher');
const nativeLoader = require('./nativeLoader');

/**
 * Intelligent Crash Analyzer for MYCHAL SMP Launcher
 * Analyzes Minecraft crashes (exit code 1 or non-zero), extracts the root cause
 * from crash-reports and latest.log, explains it in clean Czech, and provides
 * 1-click automatic fixes.
 */

// Klíčové systémové módy, které nesmí být nikdy automaticky vyřazeny jako "nekompatibilní"
const PROTECTED_CORE_MODS = new Set([
    'sodium',
    'iris',
    'fabric-api',
    'fabric_api',
    'fabricapi',
    'lithium',
    'selfnametag'
]);

/**
 * Extracts a relevant stacktrace excerpt around a matching pattern
 */
function extractRelevantStack(text, regex) {
    if (!text || !regex) return '';
    const lines = text.split('\n');
    const idx = lines.findIndex(l => regex.test(l));
    if (idx === -1) return '';
    const start = Math.max(0, idx - 2);
    const end = Math.min(lines.length, idx + 18);
    return lines.slice(start, end).join('\n').trim();
}

/**
 * Searches for the newest crash report in gameDir/crash-reports
 */
function findLatestCrashReport(gameDir) {
    if (!gameDir || typeof gameDir !== 'string') return null;
    try {
        const crashDir = path.join(gameDir, 'crash-reports');
        if (!fs.existsSync(crashDir)) return null;

        const files = fs.readdirSync(crashDir)
            .filter(f => f.endsWith('.txt'))
            .map(f => {
                const fullPath = path.join(crashDir, f);
                try {
                    const stat = fs.statSync(fullPath);
                    return { fullPath, filename: f, mtime: stat.mtimeMs };
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) {
            // Check if file is recent (within last 30 minutes)
            const newest = files[0];
            if (Date.now() - newest.mtime < 30 * 60 * 1000) {
                return newest.fullPath;
            }
        }
    } catch (e) {
        console.error('[CRASH ANALYZER] Nelze načíst crash-reports:', e);
    }
    return null;
}

/**
 * Reads the tail of latest.log
 */
function readLatestLogTail(gameDir, maxLines = 600) {
    if (!gameDir || typeof gameDir !== 'string') return '';
    try {
        const logPath = path.join(gameDir, 'logs', 'latest.log');
        if (!fs.existsSync(logPath)) return '';

        const stat = fs.statSync(logPath);
        // Read up to last 512KB
        const readSize = Math.min(stat.size, 524288);
        const buffer = Buffer.alloc(readSize);
        const fd = fs.openSync(logPath, 'r');
        fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
        fs.closeSync(fd);

        const content = buffer.toString('utf-8');
        const lines = content.split('\n');
        return lines.slice(-maxLines).join('\n');
    } catch (e) {
        return '';
    }
}

/**
 * Extracts all missing mod dependencies from the crash log or latest.log output.
 */
function extractMissingDependencies(combinedText) {
    const missing = [];
    if (!combinedText) return missing;

    // 0a. Modern Fabric log: "[HARD_DEP_NO_CANDIDATE particle_core 0.3.3+26.2 {depends fzzy_config @ [>=0.7.6]}]"
    //     or "[HARD_DEP particle_core 0.3.3+26.2 {depends fzzy_config @ [>=0.7.6]}]"
    const rHardDep = /\[HARD_DEP(?:_NO_CANDIDATE)?\s+([a-zA-Z0-9_\-]+)\s+[^{]*\{depends\s+([a-zA-Z0-9_\-]+)(?:\s*@\s*\[([^\]]*)\])?\}/gi;
    let m;
    while ((m = rHardDep.exec(combinedText)) !== null) {
        const modId = m[1];
        const depId = m[2];
        const verReq = m[3] || '';
        if (!['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric', 'quilt_loader', 'quiltloader'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (existing) {
                if (modId && !existing.modId) existing.modId = modId;
                if (verReq && !existing.verReq) existing.verReq = verReq;
            } else {
                missing.push({ modName: modId, modId, depName: depId, depId, verReq });
            }
        }
    }

    // 0b. Modern Fabric log: "Fix: add [add:fzzy_config 0.7.6 ([[0.7.6,∞)])], remove [], replace []"
    const rFixAdd = /Fix:\s*add\s*\[add:([a-zA-Z0-9_\-]+)\s+([^\]]+)\]/gi;
    while ((m = rFixAdd.exec(combinedText)) !== null) {
        const depId = m[1];
        const verReq = m[2];
        if (!['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (existing) {
                if (verReq && !existing.verReq) existing.verReq = verReq;
            } else {
                missing.push({ modName: '', modId: '', depName: depId, depId, verReq });
            }
        }
    }

    // 1. Fabric: "Mod 'Iris' (iris) 1.11.4+mc26.2 requires any 0.9.x version of sodium, which is missing!"
    //     or "Mod 'Particle Core' (particle_core) 0.3.3+26.2 requires version 0.7.6 or later of fzzy_config, which is missing!"
    //     or "Mod 'A' (a) requires ... of mod 'B' (b), which is missing!"
    const rModReq = /Mod\s+['"]([^'"]+)['"]\s*(?:\(([^)]+)\))?[^\n\r]*?requires\s+(?:[^\n\r]*?\s+of\s+)?(?:mod\s+['"]([^'"]+)['"]\s*(?:\(([^)]+)\))?|['"]([^'"]+)['"]|([a-zA-Z0-9_\-]+)),\s*which is missing/gi;
    while ((m = rModReq.exec(combinedText)) !== null) {
        const modName = m[1];
        const modId = m[2] || modName;
        const depName = m[3] || m[5] || m[6];
        const depId = m[4] || m[5] || m[6];
        if (depId && !['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric', 'quilt_loader', 'quiltloader'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (existing) {
                if (modName && (!existing.modName || existing.modName === 'Neznámý mód')) existing.modName = modName;
                if (modId && !existing.modId) existing.modId = modId;
            } else {
                missing.push({ modName, modId, depName: depName || depId, depId });
            }
        }
    }

    // 2. Fabric recommended: "Install sodium, any 0.9.x version." OR "Install fzzy_config, version 0.7.6 or later."
    const rInstallFlex = /Install\s+(?:mod\s+['"]([^'"]+)['"]\s*(?:\(([^)]+)\))?|([a-zA-Z0-9_\-]+)),?\s*[^\n\r]*?version/gi;
    while ((m = rInstallFlex.exec(combinedText)) !== null) {
        const depName = m[1] || m[3];
        const depId = m[2] || m[3];
        if (depId && !['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric', 'quilt_loader', 'quiltloader'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (!existing) {
                missing.push({ modName: '', modId: '', depName, depId });
            }
        }
    }

    // 3. Fabric generic: "requires ... of mod 'DepName' (depId), which is missing"
    const r2 = /requires\s+[^\n\r]*?\s+of\s+mod\s+'([^']+)'\s*\(([^)]+)\),\s*which is missing/gi;
    while ((m = r2.exec(combinedText)) !== null) {
        const depName = m[1];
        const depId = m[2];
        if (!['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric', 'quilt_loader', 'quiltloader'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (!existing) {
                missing.push({ modName: '', modId: '', depName, depId });
            }
        }
    }

    // 4. Fabric: "requires ... of 'depId', which is missing"
    const r3 = /requires\s+[^\n\r]*?\s+of\s+(?:'([^']+)'|([a-zA-Z0-9_\-]+)),\s*which is missing/gi;
    while ((m = r3.exec(combinedText)) !== null) {
        const depId = m[1] || m[2];
        if (!['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (!existing) {
                missing.push({ modName: '', modId: '', depName: depId, depId });
            }
        }
    }

    // 5. NeoForge / Forge: "Mod ID: 'depId', requested by 'modId', is not installed"
    const r4 = /Mod ID: '([^']+)', requested by '([^']+)', is not installed/gi;
    while ((m = r4.exec(combinedText)) !== null) {
        const depId = m[1];
        const modId = m[2];
        if (!['minecraft', 'java', 'forge', 'neoforge'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (!existing) {
                missing.push({ modName: modId, modId, depName: depId, depId });
            }
        }
    }

    // 6. Forge: "Mod 'X' requires 'Y' ... which is not installed"
    const r5 = /Mod '([^']+)' requires '([^']+)'[^\n\r]*which is not installed/gi;
    while ((m = r5.exec(combinedText)) !== null) {
        const modName = m[1];
        const depId = m[2];
        if (!['minecraft', 'java', 'forge', 'neoforge'].includes(depId.toLowerCase())) {
            const existing = missing.find(d => d.depId.toLowerCase() === depId.toLowerCase());
            if (!existing) {
                missing.push({ modName, modId: modName, depName: depId, depId });
            }
        }
    }

    return missing;
}

/**
 * Finds and disables a problematic mod in modsDir by renaming its jar file to .jar.disabled.
 */
function disableModInModsDir(modsDir, modIdentifier, modName) {
    if (!modsDir || !fs.existsSync(modsDir)) return null;
    let files = [];
    try { files = fs.readdirSync(modsDir); } catch (_) { return null; }
    const jarFiles = files.filter(f => f.toLowerCase().endsWith('.jar'));

    let metaMap = {};
    try {
        const metaFile = path.join(modsDir, '.mod_meta.json');
        if (fs.existsSync(metaFile)) metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (_) { }

    let AdmZip = null;
    try { AdmZip = require('adm-zip'); } catch (_) { }

    const rawId = (modIdentifier || '').toLowerCase();
    const rawHyphen = rawId.replace(/_/g, '-');
    const rawUnderscore = rawId.replace(/-/g, '_');
    const rawName = (modName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const f of jarFiles) {
        const fullPath = path.join(modsDir, f);
        const meta = metaMap[f] || metaMap[f.replace(/\.disabled$/i, '')] || {};
        let mId = (meta.id || '').toLowerCase();
        let mName = (meta.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        if (!mId && AdmZip) {
            try {
                const zip = new AdmZip(fullPath);
                const fabEntry = zip.getEntry('fabric.mod.json');
                if (fabEntry) {
                    const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                    if (fab.id) mId = fab.id.toLowerCase();
                    if (fab.name) mName = fab.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                }
            } catch (_) { }
        }

        const cleanFile = f.replace(/\.jar$/i, '').toLowerCase();

        let matched = false;
        if (rawId && (mId === rawId || mId === rawHyphen || mId === rawUnderscore ||
            cleanFile === rawId || cleanFile === rawHyphen || cleanFile === rawUnderscore ||
            cleanFile.includes(rawId) || cleanFile.includes(rawHyphen))) {
            matched = true;
        }
        if (!matched && rawName && (mName === rawName || cleanFile.replace(/[^a-z0-9]/g, '').includes(rawName))) {
            matched = true;
        }

        if (matched) {
            try {
                const disabledPath = fullPath + '.disabled';
                fs.renameSync(fullPath, disabledPath);
                console.log(`[CRASH AUTO-RESOLVE] Fallback: Deaktivován problematický mód: ${f}`);
                return { filename: f, disabledFilename: f + '.disabled', path: disabledPath };
            } catch (err) {
                console.error(`[CRASH AUTO-RESOLVE] Chyba při deaktivaci módu ${f}:`, err);
            }
        }
    }
    return null;
}

/**
 * Automatically resolves missing dependencies by:
 * 1. Re-enabling any disabled (.disabled) matching files in mods directory
 * 2. Downloading missing dependencies from Modrinth API
 * 3. Fallback: Disabling the problematic mod if dependency cannot be downloaded!
 */
async function autoResolveMissingDependencies(gameDir, combinedText, launchConfig = {}) {
    if (!gameDir || typeof gameDir !== 'string') {
        return null;
    }
    const modsDir = path.join(gameDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        return null;
    }

    const missingDeps = extractMissingDependencies(combinedText);
    if (!missingDeps || missingDeps.length === 0) {
        return null;
    }

    // 1. Pokud pro některou závislost nemáme zjištěný modId (který ji vyžaduje),
    // prohledáme fabric.mod.json všech JARů v modsDir, abychom našli ten, který ji má v "depends"
    let AdmZip = null;
    try { AdmZip = require('adm-zip'); } catch (_) { }

    if (AdmZip && fs.existsSync(modsDir)) {
        try {
            const jarFiles = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar'));
            for (const dep of missingDeps) {
                if (dep.modId) continue;
                const targetDepId = dep.depId.toLowerCase();
                const targetHyphen = targetDepId.replace(/_/g, '-');
                const targetUnderscore = targetDepId.replace(/-/g, '_');

                for (const jf of jarFiles) {
                    try {
                        const zip = new AdmZip(path.join(modsDir, jf));
                        const entry = zip.getEntry('fabric.mod.json');
                        if (entry) {
                            const fab = JSON.parse(entry.getData().toString('utf8'));
                            if (fab.depends && typeof fab.depends === 'object') {
                                const depKeys = Object.keys(fab.depends).map(k => k.toLowerCase());
                                if (depKeys.includes(targetDepId) || depKeys.includes(targetHyphen) || depKeys.includes(targetUnderscore)) {
                                    dep.modId = fab.id;
                                    dep.modName = fab.name || fab.id;
                                    console.log(`[CRASH AUTO-RESOLVE] Identifikován mateřský mód: ${dep.modName} (${dep.modId}) vyžadující ${dep.depId}`);
                                    break;
                                }
                            }
                        }
                    } catch (_) { }
                }
            }
        } catch (_) { }
    }

    const reEnabled = [];
    const downloaded = [];
    const failedToDownload = [];
    const targetVersion = launchConfig.version || '26.2';
    const targetLoader = launchConfig.loader || 'fabric';

    for (const dep of missingDeps) {
        try {
            const isFabricSubmodule = (dep.depId.startsWith('fabric-') || dep.depId.startsWith('fabric_')) && dep.depId !== 'fabricloader' && dep.depId !== 'fabric-loader';
            let targetModId = isFabricSubmodule ? 'fabric-api' : dep.depId.replace(/_/g, '-');
            const targetModTitle = isFabricSubmodule ? 'Fabric API' : (dep.depName || dep.depId);

            console.log(`[CRASH AUTO-RESOLVE] Automaticky stahuji vyžadovanou závislost ${targetModTitle} z Modrinthu (MC ${targetVersion}, ${targetLoader})...`);

            // Zjistíme, zda existuje starší nebo nekompatibilní soubor k nahrazení
            const existingCheck = isModInstalledInDir(modsDir, targetModId);
            const oldFilename = existingCheck ? existingCheck.filename : null;

            const dlRes = await downloadModOrPack({
                id: targetModId,
                title: targetModTitle,
                projectType: 'mod',
                version: targetVersion,
                loader: targetLoader,
                oldFilename: oldFilename
            }, gameDir);

            if (dlRes && dlRes.success) {
                downloaded.push({
                    depId: dep.depId,
                    depName: dep.depName || dep.depId,
                    filename: dlRes.filename
                });
            } else {
                failedToDownload.push(dep);
            }
        } catch (dlErr) {
            console.warn(`[CRASH AUTO-RESOLVE] Nepodařilo se stáhnout závislost ${dep.depId}:`, dlErr.message);
            // Zkusíme, zda náhodou v modsDir neexistuje dříve deaktivovaný .disabled soubor (offline nouzový fallback)
            const check = isModInstalledInDir(modsDir, dep.depId);
            if (check && check.installed && check.disabled && check.fullPath) {
                try {
                    const targetEnabled = check.fullPath.replace(/\.disabled$/i, '');
                    fs.renameSync(check.fullPath, targetEnabled);
                    console.log(`[CRASH AUTO-RESOLVE] Offline fallback: Re-aktivována nalezená závislost: ${check.filename}`);
                    reEnabled.push({
                        depId: dep.depId,
                        depName: dep.depName || dep.depId,
                        filename: path.basename(targetEnabled)
                    });
                } catch (e) {
                    failedToDownload.push(dep);
                }
            } else {
                failedToDownload.push(dep);
            }
        }
    }

    // 3. Fallback: Pokud se závislost nepodařilo stáhnout/získat, automaticky deaktivujeme problémový mód (.disabled),
    // který chybějící závislost vyžaduje, aby hra nebyla zablokovaná a mohla se v pořádku spustit bez pádu.
    const disabledMods = [];
    if (failedToDownload.length > 0) {
        for (const failedDep of failedToDownload) {
            const culpritId = failedDep.modId;
            const culpritName = failedDep.modName;
            if (culpritId || culpritName) {
                const res = disableModInModsDir(modsDir, culpritId, culpritName);
                if (res && !disabledMods.some(d => d.filename === res.filename)) {
                    disabledMods.push({
                        id: culpritId,
                        name: culpritName || culpritId,
                        filename: res.filename,
                        depName: failedDep.depName || failedDep.depId
                    });
                }
            }
        }
    }

    // Vytáhneme výňatek z logu pro zobrazení
    let excerpt = '';
    const incompIdx = combinedText.indexOf('Incompatible mods found!');
    if (incompIdx !== -1) {
        excerpt = combinedText.substring(incompIdx, incompIdx + 900).trim();
    } else {
        const formattedIdx = combinedText.indexOf('FormattedException:');
        if (formattedIdx !== -1) {
            excerpt = combinedText.substring(formattedIdx, formattedIdx + 900).trim();
        }
    }

    const totalFixed = reEnabled.length + downloaded.length + disabledMods.length;
    // Považujeme za plně opravené, pokud byla závislost stažena NEBO byl problémový mód úspěšně deaktivován (.disabled)
    const unhandledFailures = failedToDownload.filter(f => !disabledMods.some(d =>
        (f.modId && d.id && f.modId.toLowerCase() === d.id.toLowerCase()) ||
        (f.modName && d.name && f.modName.toLowerCase() === d.name.toLowerCase())
    ));
    const isFullyFixed = totalFixed > 0 && unhandledFailures.length === 0;

    return {
        detected: true,
        fixed: isFullyFixed,
        missingDeps,
        reEnabled,
        downloaded,
        disabledMods,
        failedToDownload,
        logExcerpt: excerpt
    };
}

/**
 * Detects strictly incompatible, conflicting, or broken mods (Mixin error, Entrypoint failure,
 * wrong Minecraft version) and disables ONLY those broken mods (.jar.disabled).
 * Never disables mods that are merely missing a dependency!
 */
function autoResolveIncompatibleMods(gameDir, combinedText) {
    if (!gameDir || typeof gameDir !== 'string') {
        return null;
    }
    const modsDir = path.join(gameDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        return null;
    }

    const isIncompatible =
        /Incompatible mods found!/i.test(combinedText) ||
        /Some of your mods are incompatible with the game or each other!/i.test(combinedText) ||
        /Replace mod '[^']+'/i.test(combinedText) ||
        /Mod '[^']+' \([^)]+\) requires .*? but only the wrong version is present/i.test(combinedText) ||
        /Mod '[^']+' \([^)]+\) is incompatible with mod/i.test(combinedText) ||
        /Could not execute entrypoint stage '[^']+' due to errors, provided by '[^']+'/i.test(combinedText) ||
        /in\s+\[[a-zA-Z0-9_\-]+\.mixins\.json/i.test(combinedText) ||
        /(?:handler|wrapMethod|wrapOperation|modify\w*|redirect|constant)\$[a-z0-9]+\$[a-zA-Z0-9_\-]+\$/i.test(combinedText) ||
        /IncompatibleModException/i.test(combinedText);

    if (!isIncompatible) {
        return null;
    }

    const culprits = [];

    // 1. Fabric: "Replace mod 'Exordium' (exordium) 2.1.1 with any version that is compatible with: ... - minecraft 26.2"
    const replaceRegex = /Replace mod '([^']+)' \(([^)]+)\)(?:\s+([0-9a-zA-Z\.\+\-_]+))? with any version that is compatible with:(?:[\s\S]*?- minecraft ([0-9a-zA-Z\.\+\-_]+))?/gi;
    let m;
    while ((m = replaceRegex.exec(combinedText)) !== null) {
        const name = m[1];
        const id = m[2];
        const ver = m[3] || '';
        const targetMc = m[4] || '';
        if (!culprits.some(c => c.id.toLowerCase() === id.toLowerCase())) {
            culprits.push({
                name,
                id,
                ver,
                reason: targetMc ? `vyžaduje verzi kompatibilní s Minecraft ${targetMc}` : 'nekompatibilní verze se hrou'
            });
        }
    }

    // 2. Fabric: "Mod 'Exordium' (exordium) 2.1.1 requires any version between 26.1 ... but only the wrong version is present: 26.2!"
    const reqMcRegex = /Mod '([^']+)' \(([^)]+)\)(?:\s+([0-9a-zA-Z\.\+\-_]+))? requires (?:any version between ([^\n\r]+) of 'Minecraft'|([^\n\r]+) of 'Minecraft')[^\n\r]*but only the wrong version is present: ([^\n\r!]+)/gi;
    while ((m = reqMcRegex.exec(combinedText)) !== null) {
        const name = m[1];
        const id = m[2];
        const ver = m[3] || '';
        const reqVer = m[4] || m[5] || '';
        const presentVer = (m[6] || '').trim();
        const existing = culprits.find(c => c.id.toLowerCase() === id.toLowerCase());
        const reason = `vyžaduje Minecraft ${reqVer}, spouští se ${presentVer}`;
        if (existing) {
            existing.reason = reason;
        } else {
            culprits.push({ name, id, ver, reason });
        }
    }

    // 3. Fabric: "Mod 'A' (a) is incompatible with mod 'B' (b)"
    const conflictRegex = /Mod '([^']+)' \(([^)]+)\) is incompatible with mod '([^']+)' \(([^)]+)\)/gi;
    while ((m = conflictRegex.exec(combinedText)) !== null) {
        const name = m[1];
        const id = m[2];
        const otherName = m[3];
        const otherId = m[4];
        if (!culprits.some(c => c.id.toLowerCase() === id.toLowerCase())) {
            culprits.push({
                name,
                id,
                reason: `konflikt s ${otherName} (${otherId})`
            });
        }
    }

    // 4. Entrypoint provider: "Could not execute entrypoint stage 'main' due to errors, provided by 'modid'"
    const entrypointRegex = /Could not execute entrypoint stage '[^']+' due to errors, provided by '([^']+)'/gi;
    while ((m = entrypointRegex.exec(combinedText)) !== null) {
        const id = m[1];
        const idLower = id.toLowerCase();
        if (!['minecraft', 'fabric', 'fabricloader'].includes(idLower) &&
            !PROTECTED_CORE_MODS.has(idLower) &&
            !culprits.some(c => c.id.toLowerCase() === idLower)) {
            culprits.push({
                name: id,
                id,
                reason: 'chyba při inicializaci vstupního kódu módu'
            });
        }
    }

    // 5. Mixin crash: "in [modid.mixins.json:...]"
    const mixinRegex = /in\s+\[([a-zA-Z0-9_\-]+)\.mixins\.json/gi;
    while ((m = mixinRegex.exec(combinedText)) !== null) {
        const id = m[1];
        const idLower = id.toLowerCase();
        if (!['minecraft', 'fabric', 'fabricloader'].includes(idLower) &&
            !PROTECTED_CORE_MODS.has(idLower) &&
            !culprits.some(c => c.id.toLowerCase() === idLower)) {
            culprits.push({
                name: id,
                id,
                reason: 'kritická chyba v Mixin transformaci kódu hry'
            });
        }
    }

    // 6. Runtime Fabric Mixin handler ve stacktracu (např. handler$edd000$spatial-gui$spatialGUI$beforeGuiRender)
    if (/Unreported exception thrown|emergencySaveAndCrash|---- Minecraft Crash Report ----|Failed to handle packet/i.test(combinedText)) {
        const runtimeMixinRegex = /(?:handler|wrapMethod|wrapOperation|modify\w*|redirect|constant)\$[a-z0-9]+\$([a-zA-Z0-9_\-]+)\$/gi;
        while ((m = runtimeMixinRegex.exec(combinedText)) !== null) {
            const rawId = m[1];
            const idLower = rawId.toLowerCase();
            if (!['minecraft', 'fabric', 'fabricloader', 'mixinextras'].includes(idLower) &&
                !idLower.startsWith('fabric-') &&
                !idLower.startsWith('fabric_') &&
                !PROTECTED_CORE_MODS.has(idLower) &&
                !culprits.some(c => c.id.toLowerCase() === idLower)) {
                culprits.push({
                    name: rawId,
                    id: rawId,
                    reason: 'runtime pád (NullPointerException / Mixin hook) během běhu hry'
                });
                break; // Bereme pouze nejvyšší Mixin frame na vrcholu stacktracu (skutečného viníka), ne nižší wrappery jako dynamic_fps
            }
        }
    }

    if (culprits.length === 0) {
        return null;
    }

    // Read all jar files in mods directory
    let files = [];
    try { files = fs.readdirSync(modsDir); } catch (_) { }
    const jarFiles = files.filter(f => f.toLowerCase().endsWith('.jar'));

    let metaMap = {};
    try {
        const metaFile = path.join(modsDir, '.mod_meta.json');
        if (fs.existsSync(metaFile)) metaMap = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (_) { }

    let AdmZip = null;
    try { AdmZip = require('adm-zip'); } catch (_) { }

    const modFiles = [];
    for (const f of jarFiles) {
        const fullPath = path.join(modsDir, f);
        const meta = metaMap[f] || metaMap[f.replace(/\.disabled$/i, '')] || {};
        let modId = (meta.id || '').toLowerCase();
        let modName = (meta.title || '').toLowerCase();

        if (!modId && AdmZip) {
            try {
                const zip = new AdmZip(fullPath);
                const fabEntry = zip.getEntry('fabric.mod.json');
                if (fabEntry) {
                    const fab = JSON.parse(fabEntry.getData().toString('utf8'));
                    if (fab.id) modId = fab.id.toLowerCase();
                    if (fab.name) modName = fab.name.toLowerCase();
                }
            } catch (_) { }
        }

        modFiles.push({
            filename: f,
            fullPath,
            modId,
            modName,
            cleanName: f.replace(/\.jar$/i, '').toLowerCase()
        });
    }

    // Match culprits to jar files on disk
    const matchedCulprits = [];
    for (const culprit of culprits) {
        const cId = (culprit.id || '').toLowerCase();
        const cName = (culprit.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        let match = modFiles.find(mf => mf.modId && mf.modId === cId);
        if (!match && cName) {
            match = modFiles.find(mf => mf.modName && mf.modName.replace(/[^a-z0-9]/g, '') === cName);
        }
        if (!match && cId) {
            match = modFiles.find(mf => mf.cleanName.includes(cId));
        }
        if (!match && cName) {
            match = modFiles.find(mf => mf.cleanName.replace(/[^a-z0-9]/g, '').includes(cName));
        }

        if (match) {
            matchedCulprits.push({
                ...culprit,
                matchedFile: match.filename,
                fullPath: match.fullPath
            });
        } else {
            matchedCulprits.push(culprit);
        }
    }

    // Automatically disable matched jar files by renaming to .disabled
    const disabledMods = [];
    for (const c of matchedCulprits) {
        const cId = (c.id || '').toLowerCase();
        const cName = (c.name || '').toLowerCase();
        if (PROTECTED_CORE_MODS.has(cId) || PROTECTED_CORE_MODS.has(cName)) {
            console.warn(`[CRASH ANALYZER] Ochrana jádra: Systémový mód ${c.matchedFile || cId} nebude automaticky deaktivován.`);
            continue;
        }
        if (c.fullPath && fs.existsSync(c.fullPath)) {
            try {
                const targetDisabled = c.fullPath + '.disabled';
                fs.renameSync(c.fullPath, targetDisabled);
                disabledMods.push({
                    name: c.name,
                    id: c.id,
                    filename: c.matchedFile,
                    disabledFilename: c.matchedFile + '.disabled',
                    reason: c.reason
                });
            } catch (e) {
                console.error(`[CRASH ANALYZER] Nelze automaticky přejmenovat mód ${c.matchedFile}:`, e);
            }
        }
    }

    // Extract exact log excerpt around incompatibility
    let excerpt = '';
    const incompIdx = combinedText.indexOf('Incompatible mods found!');
    if (incompIdx !== -1) {
        excerpt = combinedText.substring(incompIdx, incompIdx + 900).trim();
    } else {
        const formattedIdx = combinedText.indexOf('FormattedException:');
        if (formattedIdx !== -1) {
            excerpt = combinedText.substring(formattedIdx, formattedIdx + 900).trim();
        } else {
            const mixinMatch = combinedText.match(/(?:handler|wrapMethod|wrapOperation|modify\w*|redirect|constant)\$[a-z0-9]+\$[a-zA-Z0-9_\-]+\$/);
            if (mixinMatch) {
                const mixinIdx = mixinMatch.index;
                const start = Math.max(0, mixinIdx - 300);
                excerpt = combinedText.substring(start, start + 900).trim();
            }
        }
    }

    return {
        detected: true,
        fixed: disabledMods.length > 0,
        culprits: matchedCulprits,
        disabledMods,
        logExcerpt: excerpt
    };
}

/**
 * Detects duplicate mods in mods directory and automatically disables the older duplicate
 */
function autoResolveDuplicateMods(gameDir, combinedText) {
    if (!gameDir || typeof gameDir !== 'string') return null;
    const modsDir = path.join(gameDir, 'mods');
    if (!fs.existsSync(modsDir)) return null;

    const dupMatch = combinedText.match(/DuplicateModsException[^\n]*|Found duplicate mods[^\n]*|Found multiple mod files providing the same mod:\s*([^\n\r]+)/i);
    if (!dupMatch) return null;

    let dupKey = (dupMatch[1] || '').trim();
    let files = [];
    try { files = fs.readdirSync(modsDir); } catch (_) { }
    const jarFiles = files.filter(f => f.toLowerCase().endsWith('.jar'));

    const candidateFiles = [];
    if (dupKey) {
        for (const f of jarFiles) {
            if (f.toLowerCase().includes(dupKey.toLowerCase())) {
                const fullPath = path.join(modsDir, f);
                try {
                    const stat = fs.statSync(fullPath);
                    candidateFiles.push({ filename: f, fullPath, mtime: stat.mtimeMs });
                } catch (_) { }
            }
        }
    }

    candidateFiles.sort((a, b) => b.mtime - a.mtime);

    let disabledFilename = null;
    if (candidateFiles.length > 1) {
        for (let i = 1; i < candidateFiles.length; i++) {
            try {
                fs.renameSync(candidateFiles[i].fullPath, candidateFiles[i].fullPath + '.disabled');
                disabledFilename = candidateFiles[i].filename;
            } catch (_) { }
        }
    }

    return {
        detected: true,
        fixed: !!disabledFilename,
        dupKey: dupKey || 'duplicitní mód',
        disabledFilename,
        keptFilename: candidateFiles[0]?.filename || null
    };
}

/**
 * Analyzes the crash and determines the Czech diagnosis and 1-click fix
 */
async function analyzeCrash(gameDir, exitCode = 1, recentMemoryLogs = [], launchConfig = {}) {
    let reportContent = '';
    let reportPath = findLatestCrashReport(gameDir);

    if (reportPath && fs.existsSync(reportPath)) {
        try {
            reportContent = fs.readFileSync(reportPath, 'utf-8');
        } catch (e) { }
    }

    let nativeScan = null;
    const latestLogFile = path.join(gameDir, 'logs', 'latest.log');
    if (nativeLoader.isNativeActive()) {
        try {
            if (reportPath && fs.existsSync(reportPath)) {
                nativeScan = nativeLoader.fastScanLogForCrashes(reportPath);
            }
            if ((!nativeScan || !nativeScan.has_crash) && fs.existsSync(latestLogFile)) {
                nativeScan = nativeLoader.fastScanLogForCrashes(latestLogFile);
            }
        } catch (_) { }
    }

    if (nativeScan && nativeScan.crash_type === 'CLEAN_SHUTDOWN') {
        return {
            hasCrash: false,
            isCleanShutdown: true,
            exitCode,
            reportPath: null,
            title: 'Hra ukončena',
            severity: 'info',
            description: 'Minecraft byl hráčem úspěšně ukončen.',
            recommendation: ''
        };
    }

    const logTail = readLatestLogTail(gameDir);
    const memoryLogText = Array.isArray(recentMemoryLogs) ? recentMemoryLogs.join('\n') : (typeof recentMemoryLogs === 'string' ? recentMemoryLogs : '');

    const combinedText = [
        reportContent,
        logTail,
        memoryLogText
    ].join('\n\n');

    // Extract relevant stack trace or exception snippet
    let logExcerpt = (nativeScan && nativeScan.log_excerpt) ? nativeScan.log_excerpt : '';
    if (!logExcerpt && reportContent) {
        const lines = reportContent.split('\n');
        logExcerpt = lines.slice(0, 35).join('\n');
    } else if (!logExcerpt && logTail) {
        const errorLines = logTail.split('\n').filter(l =>
            l.includes('FATAL') || l.includes('ERROR') || l.includes('Exception') || l.includes('Error')
        );
        logExcerpt = errorLines.slice(-15).join('\n') || logTail.split('\n').slice(-15).join('\n');
    }

    if (!logExcerpt && memoryLogText) {
        const memLines = memoryLogText.split('\n').map(l => l.trim()).filter(Boolean);
        const errorLines = memLines.filter(l =>
            l.includes('FATAL') || l.includes('ERROR') || l.includes('Exception') || l.includes('Error') ||
            l.includes('GLFW') || l.includes('GLX') || l.includes('Failed') || l.includes('[GAME]') || l.includes('[STDERR]')
        );
        logExcerpt = errorLines.slice(-15).join('\n') || memLines.slice(-15).join('\n');
    }

    // ── Diagnostic Rule: Normal Game Shutdown or Intentional Kill (False Positive) ───────
    if (
        launchConfig?.intentionalStop ||
        exitCode === 4294967288 ||
        exitCode === -8 ||
        exitCode === 130 || // SIGINT
        exitCode === 143 || // SIGTERM
        exitCode === 137 || // SIGKILL
        exitCode === 3221225786 || // STATUS_CONTROL_C_EXIT
        exitCode === -1073741510 ||
        combinedText.includes('Client shutdown from post-main') ||
        combinedText.includes('ClientShutdownWatchdog') ||
        combinedText.includes('Description: Client shutdown from post-main') ||
        (combinedText.includes('Stopping!') && !combinedText.includes('This crash report has been saved to:'))
    ) {
        return {
            hasCrash: false,
            isCleanShutdown: true,
            exitCode,
            reportPath: null,
            title: 'Hra ukončena',
            severity: 'info',
            description: 'Minecraft byl hráčem úspěšně ukončen.',
            recommendation: ''
        };
    }

    // ── Diagnostic Rule: Missing Mod Dependencies (Smart Auto-Download & Fallback) ──────
    const missingDepResult = await autoResolveMissingDependencies(gameDir, combinedText, launchConfig);
    if (missingDepResult && missingDepResult.detected) {
        if (missingDepResult.fixed) {
            // Případ A: Problémový mód byl deaktivován jako fallback (pokud závislost nebylo možné stáhnout)
            if (missingDepResult.disabledMods && missingDepResult.disabledMods.length > 0) {
                const names = missingDepResult.disabledMods.map(m => m.name || m.id).join(', ');
                const files = missingDepResult.disabledMods.map(m => m.filename).join(', ');
                const depNames = missingDepResult.disabledMods.map(m => m.depName).join(', ');

                return {
                    hasCrash: true,
                    exitCode,
                    reportPath,
                    fixed: true,
                    autoFixed: true,
                    title: 'Hra opravena – Problémový mód deaktivován',
                    severity: 'warning',
                    description: `Mód ${names} (${files}) vyžadoval chybějící doplněk (${depNames}), který se nepodařilo stáhnout. Aby se Minecraft mohl v pořádku spustit, byl tento mód automaticky deaktivován (.disabled).`,
                    recommendation: 'Problémový mód byl bezpečně vyřazen. Můžeš hru ihned spustit znovu bez pádu.',
                    disabledMods: missingDepResult.disabledMods,
                    logExcerpt: missingDepResult.logExcerpt || logExcerpt,
                    autoFix: {
                        id: 'RELAUNCH_GAME',
                        label: 'Spustit hru znovu',
                        description: 'Spustí instanci s již opravenými módy.'
                    }
                };
            }

            // Případ B: Všechny závislosti byly úspěšně staženy / re-aktivovány
            const allItems = [
                ...missingDepResult.downloaded.map(d => `${d.depName || d.depId} (${d.filename})`),
                ...missingDepResult.reEnabled.map(d => `${d.depName || d.depId} (re-aktivováno)`)
            ];
            const names = allItems.join(', ');

            return {
                hasCrash: true,
                exitCode,
                reportPath,
                fixed: true,
                autoFixed: true,
                title: 'Hra opravena – Chybějící závislost stažena',
                severity: 'warning',
                description: `Detekována chybějící závislost módu. Launcher automaticky stáhl a nainstaloval potřebné doplňky: ${names}. Hra je připravena ke spuštění!`,
                recommendation: 'Vyžadované modifikace byly úspěšně doplněny. Můžeš hru ihned spustit znovu.',
                logExcerpt: missingDepResult.logExcerpt || logExcerpt,
                autoFix: {
                    id: 'RELAUNCH_GAME',
                    label: 'Spustit hru znovu',
                    description: 'Spustí instanci se staženými závislostmi.'
                }
            };
        } else {
            const neededList = missingDepResult.failedToDownload.length > 0 ? missingDepResult.failedToDownload : missingDepResult.missingDeps;
            const neededNames = neededList.map(d => d.depName || d.depId).join(', ');
            const forMod = missingDepResult.missingDeps[0]?.modName ? ` (pro ${missingDepResult.missingDeps[0].modName})` : '';

            return {
                hasCrash: true,
                exitCode,
                reportPath,
                fixed: false,
                title: `Chybí závislost: ${neededNames}`,
                severity: 'warning',
                description: `Mód v profilu${forMod} vyžaduje chybějící doplněk: ${neededNames}. Bez něj se Minecraft nemůže spustit.`,
                recommendation: 'Klikni na tlačítko níže pro automatické vyhledání a stažení z Modrinthu a spuštění hry.',
                logExcerpt: missingDepResult.logExcerpt || logExcerpt,
                autoFix: {
                    id: 'INSTALL_MISSING_DEPENDENCIES',
                    missingDeps: neededList,
                    label: `Stáhnout závislost (${neededNames})`,
                    description: 'Automaticky vyhledá a stáhne chybějící knihovny z Modrinthu a spustí hru.'
                }
            };
        }
    }

    // ── Diagnostic Rule: Missing LWJGL Core Classes ────────────────────────────
    if (
        /NoClassDefFoundError:\s*org[\/\.]lwjgl/i.test(combinedText) ||
        /ClassNotFoundException:\s*org[\/\.]lwjgl/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            fixed: false,
            title: 'Chybějící knihovna LWJGL',
            severity: 'critical',
            description: 'Minecraft nemohl nastartovat, protože chybí základní kódová knihovna LWJGL (org.lwjgl.Version / MathUtil). Launcher v nové verzi tuto chybu v sestavení classpath plně opravuje.',
            recommendation: 'Spusť hru znovu – launcher automaticky zahrne všechny LWJGL knihovny do spuštění.',
            logExcerpt: extractRelevantStack(combinedText, /org[\/\.]lwjgl/i) || logExcerpt
        };
    }

    // ── Diagnostic Rule: Sodium Graphics PreLaunch Crash ───────────────────────
    const isSodiumPreLaunch =
        (/Could not execute entrypoint stage 'preLaunch' due to errors, provided by 'sodium'/i.test(combinedText) ||
            /SodiumPreLaunch/i.test(combinedText)) &&
        !combinedText.includes('Incompatible mods found!') &&
        !/NoClassDefFoundError:\s*org[\/\.]lwjgl/i.test(combinedText) &&
        !/ClassNotFoundException:\s*org[\/\.]lwjgl/i.test(combinedText);

    if (isSodiumPreLaunch) {
        let sodiumExcerpt = '';
        const sodIdx = combinedText.indexOf("provided by 'sodium'");
        if (sodIdx !== -1) {
            sodiumExcerpt = combinedText.substring(Math.max(0, sodIdx - 50), sodIdx + 750).trim();
        } else {
            const preIdx = combinedText.indexOf("SodiumPreLaunch");
            if (preIdx !== -1) {
                sodiumExcerpt = combinedText.substring(Math.max(0, preIdx - 50), preIdx + 750).trim();
            }
        }

        return {
            hasCrash: true,
            exitCode,
            reportPath,
            fixed: false,
            title: 'Chyba grafického ovladače (Sodium)',
            severity: 'critical',
            description: 'Mód Sodium (grafické jádro hry) nemohl inicializovat grafický adaptér v předsouborové fázi (SodiumPreLaunch). K této chybě dochází, pokud grafická karta nemá aktuální ovladače od výrobce (NVIDIA, AMD, Intel), nebo pokud do hry zasahuje externí program s překryvem obrazu (např. RivaTuner Statistics Server, MSI Afterburner, Discord overlay).',
            recommendation: '1. Aktualizuj ovladač grafické karty přímo ze stránek výrobce (NVIDIA / AMD / Intel).\n2. Vypni programy s překryvem obrazu (RivaTuner RTSS, Afterburner).\n3. U notebooků se 2 grafikami nastav ve Windows pro javaw.exe vysoký výkon (dedikovanou GPU).',
            logExcerpt: sodiumExcerpt || logExcerpt,
            autoFix: {
                id: 'BYPASS_SODIUM_DRIVER_CHECKS',
                label: '⚡ Zkusit obejít kontroly ovladače',
                description: 'Přidá parametry pro přeskočení striktních kontrol kompatibility GPU v Sodium a restartuje hru.'
            }
        };
    }

    // ── Diagnostic Rule 0: Incompatible / Conflicting Mods (Smart Auto-Fix) ────
    const incompResult = autoResolveIncompatibleMods(gameDir, combinedText);
    if (incompResult && incompResult.detected) {
        if (incompResult.fixed) {
            const names = incompResult.disabledMods.map(m => m.name).join(', ');
            const files = incompResult.disabledMods.map(m => m.filename).join(', ');
            const reason = incompResult.disabledMods[0]?.reason ? ` (${incompResult.disabledMods[0].reason})` : '';

            return {
                hasCrash: true,
                exitCode,
                reportPath,
                fixed: true,
                autoFixed: true,
                title: 'Hra opravena – Nekompatibilní mód deaktivován',
                severity: 'warning',
                description: `Detekován nekompatibilní mód: ${names}${reason}. Soubor ${files} byl automaticky zakázán (.disabled), aby spuštění hry proběhlo hladce.`,
                recommendation: 'Nekompatibilní modifikace byla vyřazena. Můžeš hru ihned spustit znovu.',
                disabledMods: incompResult.disabledMods,
                logExcerpt: incompResult.logExcerpt || logExcerpt,
                autoFix: {
                    id: 'RELAUNCH_GAME',
                    label: 'Spustit hru znovu',
                    description: 'Spustí instanci s již opravenými a deaktivovanými módy.'
                }
            };
        } else {
            const culpritNames = incompResult.culprits.map(c => c.name || c.id).join(', ');
            const filesToDisable = incompResult.culprits.map(c => c.matchedFile).filter(Boolean);
                const targetFiles = filesToDisable.length > 0
                    ? filesToDisable
                    : incompResult.culprits.map(c => `${c.id}.jar`);
                return {
                    hasCrash: true,
                    exitCode,
                    reportPath,
                    fixed: false,
                    title: 'Nekompatibilní modifikace',
                    severity: 'critical',
                    description: `V profilu byl nalezen nekompatibilní mód: ${culpritNames}. Vyžaduje jinou verzi Minecraftu nebo jiný zavaděč.`,
                    recommendation: 'Deaktivace problematického módu pro bezproblémové spuštění.',
                    logExcerpt: incompResult.logExcerpt || logExcerpt,
                    autoFix: {
                        id: 'DISABLE_INCOMPATIBLE_MODS',
                        files: targetFiles,
                        label: `Deaktivovat mód (${culpritNames})`,
                        description: 'Přejmenuje problematický mód na .disabled pro bezpečné spuštění.'
                    }
                };
        }
    }

    // ── Diagnostic Rule 0b: Duplicate Mods (Smart Auto-Fix) ──────────────────
    const dupResult = autoResolveDuplicateMods(gameDir, combinedText);
    if (dupResult && dupResult.detected && dupResult.fixed) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            fixed: true,
            autoFixed: true,
            title: 'Hra opravena – Duplicitní mód deaktivován',
            severity: 'warning',
            description: `Ve složce mods se nacházely duplicitní soubory pro ${dupResult.dupKey}. Starší soubor (${dupResult.disabledFilename}) byl automaticky deaktivován (.disabled).`,
            recommendation: 'Duplicita byla vyřešena. Můžeš hru ihned spustit znovu.',
            logExcerpt: logExcerpt || `Duplicate mods found for: ${dupResult.dupKey}`,
            autoFix: {
                id: 'RELAUNCH_GAME',
                label: 'Spustit hru znovu',
                description: 'Spustí hru s ponechanou novější verzí módu.'
            }
        };
    }

    // ── Diagnostic Rule 1: Out of Memory / Insufficient RAM ──────────────────
    if (
        (nativeScan && nativeScan.crash_type === 'OUT_OF_MEMORY') ||
        /OutOfMemoryError/i.test(combinedText) ||
        /Java heap space/i.test(combinedText) ||
        /GC overhead limit exceeded/i.test(combinedText) ||
        /Could not reserve enough space for/i.test(combinedText) ||
        exitCode === 137
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Nedostatek operační paměti RAM',
            severity: 'critical',
            description: 'Minecraftu došla přidělená operační paměť RAM (Java OutOfMemoryError). Herní verze 26.x nebo nainstalované modifikace spotřebovaly veškerý přidělený heap prostor.',
            recommendation: 'Zvyš posuvník přidělené RAM v nastavení na 6 GB nebo více.',
            logExcerpt,
            autoFix: {
                id: 'SET_RAM_6GB',
                targetRam: 6,
                label: '⚡ Zvýšit RAM na 6 GB (Automatická oprava)',
                description: 'Nastaví maximální RAM na 6 GB v konfiguraci a okamžitě ji uloží.'
            }
        };
    }

    // ── Diagnostic Rule 2: Missing Fabric API ────────────────────────────────
    if (
        /requires\s+fabric(?:-api)?/i.test(combinedText) ||
        /requires\s+mod\s+['"]fabric['"]/i.test(combinedText) ||
        /Some of your mods require Fabric API/i.test(combinedText) ||
        /net\.fabricmc\.loader\.impl\.FormattedException:\s+Some of your mods require Fabric API/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chybí Fabric API',
            severity: 'critical',
            description: 'Módy v tomto profilu vyžadují Fabric API.',
            recommendation: 'Nainstaluj Fabric API pro tuto verzi hry.',
            logExcerpt,
            autoFix: {
                id: 'INSTALL_FABRIC_API',
                label: 'Stáhnout Fabric API',
                description: 'Stáhne balíček Fabric API do složky mods.'
            }
        };
    }

    // ── Diagnostic Rule 3: Unsupported Java Class Version ───────────────────
    const classVerMatch = combinedText.match(/class file version (\d+)(?:\.\d+)?.*?(?:only recognizes|up to).*?(\d+)(?:\.\d+)?/i) ||
        combinedText.match(/class file version (\d+)(?:\.\d+)?/i);
    if (
        /UnsupportedClassVersionError/i.test(combinedText) ||
        /has been compiled by a more recent version of the Java Runtime/i.test(combinedText) ||
        /class file version (65|66|67|68|69)\.0/i.test(combinedText)
    ) {
        let reqMajor = 25;
        let currMajor = 21;
        if (classVerMatch && classVerMatch[1]) {
            const cVer = parseInt(classVerMatch[1], 10);
            reqMajor = Math.max(8, cVer - 44);
            if (classVerMatch[2]) {
                const curVer = parseInt(classVerMatch[2], 10);
                currMajor = Math.max(8, curVer - 44);
            }
        }

        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: `Vyžadována Java ${reqMajor}`,
            severity: 'critical',
            description: `Hra vyžaduje Java ${reqMajor}, proces běží pod Java ${currMajor}.`,
            recommendation: `Nastav prostředí Java ${reqMajor}.`,
            logExcerpt,
            autoFix: {
                id: 'AUTO_DETECT_JAVA',
                label: `Nastavit Javu ${reqMajor}`,
                description: `Nastaví nebo stáhne kompatibilní Javu ${reqMajor}.`,
                targetJavaVersion: reqMajor
            }
        };
    }

    // ── Diagnostic Rule: Could not find or load main class / Missing Client Class (Corrupted Client JAR) ──
    if (
        /Could not find or load main class net\.minecraft\.client\.main\.Main/i.test(combinedText) ||
        /ClassNotFoundException: net\.minecraft\.client\.main\.Main/i.test(combinedText) ||
        /Failed to load class file for 'net\.minecraft/i.test(combinedText) ||
        /(?:NoClassDefFoundError|ClassNotFoundException):\s*net[\/\.]minecraft[\/\.]client/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Poškozený soubor verze Minecraftu',
            severity: 'critical',
            description: 'Hlavní kód klienta Minecraftu je neúplný nebo byl poškozen (chybějící kódová třída).',
            recommendation: 'Automatická oprava odstranila poškozený soubor verze. Při příštím startu se čistě stáhne oficiální balíček od Mojangu.',
            logExcerpt: extractRelevantStack(combinedText, /(?:NoClassDefFoundError|ClassNotFoundException|Failed to load class file|Could not find or load main class)/i) || logExcerpt,
            autoFix: {
                id: 'REDOWNLOAD_VERSION_JAR',
                label: 'Znovu stáhnout verzi hry',
                description: 'Odstraní stávající soubor verze pro čisté stažení.'
            }
        };
    }

    // ── Diagnostic Rule: Fabric Loader Initialization Failure / Corrupted sat4j (ContradictionException) ──
    if (
        /ContradictionException/i.test(combinedText) ||
        /net\/fabricmc\/loader\/impl\/lib\/sat4j/i.test(combinedText) ||
        (/FabricLoader/i.test(combinedText) && /NoClassDefFoundError/i.test(combinedText) && /LoaderLibrary/i.test(combinedText))
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Nestabilní / poškozený Fabric Loader (0.20.0)',
            severity: 'critical',
            description: 'Byl detekován pád při zavádění Fabric Loaderu (chybějící třída sat4j ContradictionException). K této chybě dochází při pokusu o spuštění experimentální nestabilní verze Fabric Loaderu (0.20.0) nebo při poškození staženého zavaděče.',
            recommendation: 'Klikni na tlačítko níže pro automatické vyčištění nestabilního zavaděče a obnovení oficiální stabilní verze (0.19.5).',
            logExcerpt: logExcerpt || 'NoClassDefFoundError: net/fabricmc/loader/impl/lib/sat4j/specs/ContradictionException',
            autoFix: {
                id: 'RESET_FABRIC_LOADER',
                label: '🧹 Obnovit stabilní Fabric Loader (0.19.5)',
                description: 'Odstraní nestabilní profily Fabric Loaderu a zajistí čisté stažení stabilní verze 0.19.5.'
            }
        };
    }

    // ── Diagnostic Rule 4: Duplicate Mods ────────────────────────────────────
    const duplicateMatch = combinedText.match(/DuplicateModsException[^\n]*|Found duplicate mods[^\n]*|Found multiple mod files providing the same mod:\s*([^\n\r]+)/i);
    if (duplicateMatch) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Nalezeny duplicitní módy v profilu',
            severity: 'warning',
            description: `Ve složce mods se nachází dvě různé verze stejné modifikace: ${duplicateMatch[1] || duplicateMatch[0]}`,
            recommendation: 'Otevři složku mods a odstraň starší verzi duplicitního souboru.',
            logExcerpt,
            autoFix: {
                id: 'OPEN_MODS_DIR',
                label: '📂 Otevřít složku mods k vyřešení',
                description: 'Otevře složku s modifikacemi v systémovém správci souborů.'
            }
        };
    }

    // ── Diagnostic Rule 5: Corrupt options.txt ──────────────────────────────
    if (/options\.txt/i.test(combinedText) && (/corrupt/i.test(combinedText) || /Failed to load/i.test(combinedText) || /Stream Closed/i.test(combinedText))) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Poškozená konfigurace nastavení hry (options.txt)',
            severity: 'warning',
            description: 'Soubor nastavení grafiky a kláves options.txt byl poškozen nebo je nečitelný a brání spuštění Minecraftu.',
            recommendation: 'Resetuj options.txt do výchozího stavu (původní soubor bude bezpečně zálohován jako options.txt.bak).',
            logExcerpt,
            autoFix: {
                id: 'RESET_OPTIONS',
                label: '🔄 Resetovat options.txt na výchozí hodnoty',
                description: 'Přejmenuje stávající soubor na options.txt.bak a Minecraft vygeneruje čisté nastavení.'
            }
        };
    }

    // ── Diagnostic Rule 5b: Linux GLFW IME Preedit Callback Failure (nglfwSetPreeditCallback) ─
    if (
        /nglfwSetPreeditCallback/i.test(combinedText) ||
        /glfwSetPreeditCallback/i.test(combinedText) ||
        (/setupKeyboardCallbacks/i.test(combinedText) && /Checks\.check/i.test(combinedText))
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba GLFW IME preedit callbacku (Linux / CachyOS / Arch)',
            severity: 'critical',
            description: 'Minecraft v novém vstupním subsystému registruje callback pro asijská vstupní pole (IME preedit). Použitá linuxová verze GLFW knihovny tento symbol neobsahuje, což způsobilo pád na Checks.check.',
            recommendation: 'Problém byl automaticky vyřešen aktualizací klientského balíčku selfnametag-1.0.0.jar.',
            logExcerpt: logExcerpt || 'Detekována chyba: Checks.check(Functions.SetPreeditCallback) v setupKeyboardCallbacks'
        };
    }

    // ── Diagnostic Rule 6: Graphics / GLFW / Wayland Error ───────────────────
    if (
        /GLFW error 65542/i.test(combinedText) ||
        /GLFW error 65543/i.test(combinedText) ||
        /Pixel format not accelerated/i.test(combinedText) ||
        /The driver does not appear to support OpenGL/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba grafického subsystému OpenGL / GLFW',
            severity: 'critical',
            description: 'Minecraftu se nepodařilo inicializovat grafické okno přes GLFW. Na Linuxu k tomu často dochází při problémech s XWayland vrstvou nebo chybějící OpenGL akcelerací.',
            recommendation: 'Aktivuj nativní Wayland okno v nastavení launcheru pro přímý přístup k displeji.',
            logExcerpt,
            autoFix: {
                id: 'ENABLE_WAYLAND',
                label: '🖥️ Aktivovat nativní Wayland režim',
                description: 'Vynutí čisté Wayland okno bez XWayland mezivrstvy pro nulový lag a spolehlivé spuštění.'
            }
        };
    }

    // ── Diagnostic Rule 7: Corrupted Library / Version / Mod JAR (ZipException / invalid CEN/LOC header) ────
    if (
        /ZipException/i.test(combinedText) ||
        /invalid CEN header/i.test(combinedText) ||
        /invalid LOC header/i.test(combinedText) ||
        /error remapping game jars/i.test(combinedText) ||
        /error reading\s+[^\n\r]+\.jar/i.test(combinedText)
    ) {
        let corruptJarPath = null;
        const jarMatch = combinedText.match(/error remapping game jars\s*\[\s*([^\]]+\.jar)\s*\]/i) ||
            combinedText.match(/remapping game jars\s*\[\s*([^\]]+\.jar)\s*\]/i) ||
            combinedText.match(/error reading\s+([^\n\r\t]+\.jar)/i) ||
            combinedText.match(/reading\s+([^\n\r\t\s]+\.jar)/i) ||
            combinedText.match(/([^\s\n\r\t\'\"\[\]]+\.jar)[^\n\r]*ZipException/i) ||
            combinedText.match(/ZipException[^\n\r]*?([^\s\n\r\t\'\"\[\]]+\.jar)/i);
        if (jarMatch && jarMatch[1]) {
            corruptJarPath = jarMatch[1].trim();
        }

        const baseDir = launchConfig?.baseDir || gameDir;
        if (!corruptJarPath && baseDir) {
            try {
                const versionsDir = path.join(baseDir, 'versions');
                if (fs.existsSync(versionsDir)) {
                    for (const d of fs.readdirSync(versionsDir)) {
                        const jPath = path.join(versionsDir, d, `${d}.jar`);
                        if (fs.existsSync(jPath) && !isJarFileValid(jPath)) {
                            corruptJarPath = jPath;
                            break;
                        }
                    }
                }
            } catch (_) { }

            if (!corruptJarPath && /net\.minecraft\./i.test(combinedText)) {
                const targetVer = launchConfig?.version?.number || '26.2';
                const vJar = path.join(baseDir, 'versions', targetVer, `${targetVer}.jar`);
                if (fs.existsSync(vJar)) {
                    corruptJarPath = vJar;
                }
            }
        }

        const isVersionJar = corruptJarPath && corruptJarPath.includes('/versions/');
        const jarName = corruptJarPath ? path.basename(corruptJarPath) : 'herní jádro / JAR';
        const isLoc = /invalid LOC header/i.test(combinedText);
        const isCen = /invalid CEN header/i.test(combinedText);
        const headerType = isLoc ? 'neplatná LOC hlavička' : (isCen ? 'neplatná CEN hlavička' : 'poškozená ZIP struktura');

        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: isVersionJar ? `Poškozené jádro hry (${headerType})` : 'Poškozený soubor JAR (ZipException)',
            severity: 'critical',
            description: `Byl detekován poškozený soubor ${jarName}. Soubor má poškozenou interní strukturu (${headerType}) a Java ani zavaděč jej nemůže deobfuskovat ani přečíst.`,
            recommendation: 'Klikni na tlačítko níže pro automatické smazání poškozeného souboru. Launcher jej při dalším spuštění automaticky obnoví z čisté verze nebo znovu stáhne.',
            logExcerpt: logExcerpt || (corruptJarPath ? `ZipException: error remapping/reading ${corruptJarPath}` : 'ZipException: invalid LOC/CEN header (bad signature)'),
            autoFix: {
                id: 'DELETE_CORRUPT_JAR',
                filePath: corruptJarPath,
                label: corruptJarPath ? `🧹 Opravit a obnovit ${path.basename(corruptJarPath)}` : '🧹 Automaticky vyčistit a obnovit poškozené jádro',
                description: 'Odstraní poškozený soubor i související staré zálohy z disku. Launcher jej při dalším startu čistě a bezpečně obnoví.'
            }
        };
    }

    // ── Diagnostic Rule 8: Specific Mod Incompatibility ─────────────────────
    const incompModMatch = combinedText.match(/Replace mod '([^']+)'/i) ||
        combinedText.match(/Mod '([^']+)' requires/i) ||
        combinedText.match(/Mod '([^']+)' is incompatible/i);
    const modCrashMatch = incompModMatch ||
        combinedText.match(/(?:Caused by:\s+)?net\.fabricmc\.loader\.[^\n]+Exception:\s+([^\n\r]+)/i) ||
        combinedText.match(/Could not execute entrypoint stage 'main' due to errors, provided by '([^']+)'/i);
    if (modCrashMatch) {
        const culprit = incompModMatch ? incompModMatch[1] : modCrashMatch[1];
        const isKnownIncomp = Boolean(incompModMatch) || /Incompatible mods found/i.test(combinedText);
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: isKnownIncomp ? (incompModMatch ? `Nekompatibilní modifikace: ${culprit}` : 'Nekompatibilní modifikace') : 'Chyba při zavádění modifikace',
            severity: 'warning',
            description: isKnownIncomp
                ? `Fabric Loader nalezl nekompatibilní modifikace v profilu: ${culprit}. Modifikace neodpovídá verzi Minecraftu nebo jinému modu.`
                : `Pád způsobil konflikt nebo chyba v modifikaci: ${culprit}`,
            recommendation: 'Zkontroluj složku mods a dočasně zakaž tuto modifikaci přejmenováním na .disabled.',
            logExcerpt,
            autoFix: {
                id: 'OPEN_MODS_DIR',
                label: '📂 Otevřít složku mods',
                description: 'Otevře složku mods pro správu souborů.'
            }
        };
    }

    // ── Diagnostic Rule 8b: Mixin Transformation / Injection Conflict ────────
    if (
        /MixinApplyError/i.test(combinedText) ||
        /MixinTransformerError/i.test(combinedText) ||
        /InjectionError/i.test(combinedText) ||
        /Critical injection failure/i.test(combinedText) ||
        (/(?:handler|wrapMethod|wrapOperation|modify\w*|redirect|constant)\$[a-z0-9]+\$([a-zA-Z0-9_\-]+)\$/i.test(combinedText) &&
            /NullPointerException|Unreported exception thrown|emergencySaveAndCrash/i.test(combinedText))
    ) {
        let culpritMod = null;
        const modMatch =
            combinedText.match(/from mod\s+([a-zA-Z0-9_\-]+)/i) ||
            combinedText.match(/in\s+([a-zA-Z0-9_\-]+)\.mixins\.json/i) ||
            combinedText.match(/mixins\.([a-zA-Z0-9_\-]+)\.json/i) ||
            combinedText.match(/(?:handler|wrapMethod|wrapOperation|modify\w*|redirect|constant)\$[a-z0-9]+\$([a-zA-Z0-9_\-]+)\$/i);
        if (modMatch && modMatch[1]) {
            culpritMod = modMatch[1];
        }

        const culpritLabel = culpritMod ? `: ${culpritMod}` : '';
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: `Kritická chyba Mixin injekce${culpritLabel}`,
            severity: 'critical',
            description: culpritMod
                ? `Modifikace "${culpritMod}" selhala při úpravě herního kódu za běhu nebo způsobila fatální výjimku v Mixin hooku.`
                : 'Některá z modifikací selhala při vstřikování kódu do Minecraftu (Mixin injection failure).',
            recommendation: culpritMod
                ? `Deaktivuj nebo aktualizuj modifikaci "${culpritMod}" v herním profilu.`
                : 'Zkontroluj herní log a vyřaď problematické modifikace.',
            logExcerpt: extractRelevantStack(combinedText, /(?:handler\$|wrapMethod|wrapOperation|MixinApplyError|InjectionError|emergencySaveAndCrash)/i) || logExcerpt,
            autoFix: culpritMod ? {
                id: 'DISABLE_INCOMPATIBLE_MODS',
                files: [`${culpritMod}.jar`],
                label: `Deaktivovat mód (${culpritMod})`,
                description: `Přejmenuje ${culpritMod}.jar na .disabled pro bezpečné spuštění.`
            } : {
                id: 'OPEN_MODS_DIR',
                label: '📂 Otevřít složku mods',
                description: 'Otevře složku mods pro správu souborů.'
            }
        };
    }

    // ── Diagnostic Rule 9: GLFW / OpenGL / GLX Initialization Failure ────────
    if (
        /Failed to initialize GLFW/i.test(combinedText) ||
        /DISPLAY environment variable is missing/i.test(combinedText) ||
        /libGLX_nvidia/i.test(combinedText) ||
        /GLX: Failed to create context/i.test(combinedText) ||
        /No OpenGL context found/i.test(combinedText) ||
        /GLFW error/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba grafického subsystému GLFW / OpenGL',
            severity: 'critical',
            description: 'Minecraft nedokázal inicializovat grafické okno nebo OpenGL kontext (chyba GLFW / GLX ovladače). To obvykle nastává při vynucení dedikované grafiky (NVIDIA) na zařízeních s integrovanou Intel/AMD grafikou nebo při chybějícím grafickém serveru.',
            recommendation: 'Deaktivuj volbu "Vynutit diskrétní GPU" v nastavení grafiky nebo ověř grafické ovladače.',
            logExcerpt: logExcerpt || 'Detekována chyba: Failed to initialize GLFW (GLX/Display context)',
            autoFix: {
                id: 'DISABLE_DISCRETE_GPU',
                label: '⚡ Deaktivovat diskrétní GPU v nastavení',
                description: 'Vypne vynucení NVIDIA GPU, které způsobuje pád na Intel a AMD grafických kartách.'
            }
        };
    }

    // ── Diagnostic Rule: BackendCreationException / OpenGL 3.3 / Zink Failure ──
    if (
        /BackendCreationException:\s*Driver does not support OpenGL 3\.3/i.test(combinedText) ||
        /Failed to create backend OpenGL/i.test(combinedText) ||
        /MESA-LOADER:\s*failed to retrieve device information/i.test(combinedText) ||
        /ZINK:\s*failed to choose pdev/i.test(combinedText) ||
        /Driver does not support OpenGL 3\.3/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Nekompatibilní grafický ovladač / Zink',
            severity: 'critical',
            description: 'Minecraft nedokázal vytvořit grafický kontext OpenGL 3.3. K chybě dochází při nekompatibilitě softwarové Zink vrstvy nebo nesprávném mapování grafických adaptérů na Linuxu.',
            recommendation: 'Automatická oprava resetovala Zink vrstvu a obnovila bezpečný výchozí grafický backend.',
            logExcerpt: extractRelevantStack(combinedText, /(?:BackendCreationException|Failed to create backend OpenGL|Driver does not support OpenGL)/i) || logExcerpt,
            autoFix: {
                id: 'RESET_GRAPHICS_BACKEND_DEFAULT',
                label: 'Obnovit výchozí grafický ovladač',
                description: 'Vypne Zink vrstvu a obnoví standardní stabilní grafický backend.'
            }
        };
    }

    // ── Diagnostic Rule: Iris Shaderpack Compilation Crash ───────────────────
    if (
        /net\.irisshaders\.iris\.pipeline\.transform\.TransformException/i.test(combinedText) ||
        /net\.irisshaders\.iris\.gl\.shader\.ShaderCompileException/i.test(combinedText) ||
        /iris:\s*Failed to load shader pack/i.test(combinedText) ||
        /ShaderpackException/i.test(combinedText) ||
        (/Failed to compile shader/i.test(combinedText) && /iris/i.test(combinedText))
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba grafického shaderpacku (Iris)',
            severity: 'critical',
            description: 'Aktivní shaderpack selhal při kompilaci shaderů (TransformException / ShaderCompileException). Použitý shaderpack není kompatibilní s aktuálním grafickým ovladačem nebo verzí hry.',
            recommendation: 'Automatická oprava deaktivovala aktivní shaderpack, aby hra mohla bezpečně naběhnout.',
            logExcerpt: extractRelevantStack(combinedText, /(?:TransformException|ShaderCompileException|Failed to load shader pack)/i) || logExcerpt,
            autoFix: {
                id: 'DISABLE_CORRUPT_SHADERPACK',
                label: 'Deaktivovat problematický shaderpack',
                description: 'Vypne aktivní shaderpack v konfiguraci Iris a umožní bezpečný start hry.'
            }
        };
    }

    // ── Diagnostic Rule: Resource Pack Texture Atlas / ModelBakery Crash ─────
    if (
        /TextureAtlasSprite\.getPixelRGBA/i.test(combinedText) ||
        (/ModelBakery/i.test(combinedText) && /NullPointerException/i.test(combinedText)) ||
        /Failed to load resource pack/i.test(combinedText) ||
        (/pack\.mcmeta/i.test(combinedText) && /(?:JsonSyntaxException|corrupt|invalid)/i.test(combinedText))
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Poškozený balíček textur (Resource Pack)',
            severity: 'warning',
            description: 'Aktivní balíček textur obsahuje poškozené textury nebo neplatný model (TextureAtlasSprite / ModelBakery), což způsobilo pád vykreslovacího vlákna.',
            recommendation: 'Automatická oprava resetovala balíčky textur na výchozí vanilkový vzhled.',
            logExcerpt: extractRelevantStack(combinedText, /(?:TextureAtlasSprite|ModelBakery|resource pack)/i) || logExcerpt,
            autoFix: {
                id: 'RESET_RESOURCE_PACKS',
                label: 'Resetovat balíčky textur',
                description: 'Vyčistí seznam aktivních resource packů v options.txt.'
            }
        };
    }

    // ── Diagnostic Rule: Partial / Corrupted Downloads in mods/ ──────────────
    if (
        /ZipException:\s*error in opening zip file/i.test(combinedText) ||
        /JarFile:\s*file is empty/i.test(combinedText) ||
        (/error reading\s+[^\n\r]+\.jar/i.test(combinedText) && /mods/i.test(combinedText))
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Neúplný / poškozený soubor módu (0 B nebo .part)',
            severity: 'critical',
            description: 'Ve složce mods byl detekován poškozený soubor nebo zbytek nedokončeného stahování (.part / 0 bajtů). Zavaděč nedokáže přečíst archiv módu.',
            recommendation: 'Automatická oprava vyčistila neúplné a nulové soubory ze složky mods.',
            logExcerpt: extractRelevantStack(combinedText, /(?:ZipException|error reading|JarFile)/i) || logExcerpt,
            autoFix: {
                id: 'CLEAN_PARTIAL_DOWNLOADS',
                label: 'Vyčistit neúplné mod soubory',
                description: 'Odstraní dočasné a nulové .jar a .part soubory ze složky mods.'
            }
        };
    }

    // ── Diagnostic Rule: LWJGL Natives Cache Corruption ───────────────────────
    if (
        /UnsatisfiedLinkError:.*natives_extract/i.test(combinedText) ||
        /Failed to extract native library/i.test(combinedText) ||
        (/libglfw\.so/i.test(combinedText) && /(?:file too short|invalid ELF header)/i.test(combinedText)) ||
        (/UnsatisfiedLinkError/i.test(combinedText) && /Failed to load library:\s*lib(?:glfw|lwjgl|jemalloc|openal)/i.test(combinedText))
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Poškozená mezipaměť nativních knihoven',
            severity: 'critical',
            description: 'Nativní binární knihovny (LWJGL / GLFW) v mezipaměti natives_extract byly poškozeny nebo zkráceny (file too short / invalid ELF header).',
            recommendation: 'Automatická oprava vyčistila složku natives_extract. Knihovny se čistě rozbalí při spuštění.',
            logExcerpt: extractRelevantStack(combinedText, /UnsatisfiedLinkError/i) || logExcerpt,
            autoFix: {
                id: 'PURGE_NATIVES_CACHE',
                label: 'Vyčistit cache nativních knihoven',
                description: 'Odstraní dočasnou složku natives_extract pro čistou extrakci knihoven.'
            }
        };
    }

    // ── Diagnostic Rule: Invalid JVM Memory Heap or Args Misconfiguration ─────
    if (
        /Incompatible minimum and maximum heap sizes specified/i.test(combinedText) ||
        /Initial heap size set to a larger value than the maximum heap size/i.test(combinedText) ||
        /Invalid maximum heap size/i.test(combinedText) ||
        /Could not create the Java Virtual Machine/i.test(combinedText) ||
        /Error occurred during initialization of VM/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba parametrů Java paměti (JVM)',
            severity: 'critical',
            description: 'Java odmítla nastartovat kvůli konfliktu v konfiguraci paměti (např. -Xms překračuje -Xmx nebo neplatný přepínač virtuálního stroje).',
            recommendation: 'Automatická oprava srovnala paměť na stabilní hodnoty (2 GB min, 6 GB max) a vyčistila konfliktní argumenty.',
            logExcerpt: extractRelevantStack(combinedText, /(?:Incompatible minimum|Initial heap size|Could not create the Java Virtual Machine|initialization of VM)/i) || logExcerpt,
            autoFix: {
                id: 'RESET_JVM_MEMORY_FLAGS',
                label: 'Srovnat parametry RAM (2GB - 6GB)',
                description: 'Nastaví bezpečné meze paměti RAM a odstraní kolidující přepínače.'
            }
        };
    }

    // ── Diagnostic Rule: Corrupted Sodium Options JSON ───────────────────────
    if (
        (/sodium-options\.json/i.test(combinedText) && /(?:JsonSyntaxException|corrupt|MalformedJsonException)/i.test(combinedText)) ||
        /OptionException.*sodium/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Poškozená konfigurace Sodium',
            severity: 'warning',
            description: 'Konfigurační soubor sodium-options.json je poškozený nebo obsahuje neplatnou JSON syntaxi, která brání spuštění hry.',
            recommendation: 'Automatická oprava zazálohovala vadný soubor a obnovila výchozí nastavení Sodium.',
            logExcerpt: extractRelevantStack(combinedText, /sodium-options\.json/i) || logExcerpt,
            autoFix: {
                id: 'RESET_SODIUM_CONFIG',
                label: 'Resetovat nastavení Sodium',
                description: 'Zálohuje a obnoví sodium-options.json do čistého stavu.'
            }
        };
    }

    // ── Diagnostic Rule: OpenAL Audio Device Crash ────────────────────────────
    if (
        /org\.lwjgl\.openal\.AL10/i.test(combinedText) ||
        /OpenAL error:\s*Invalid Device/i.test(combinedText) ||
        /Failed to initialize OpenAL/i.test(combinedText)
    ) {
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba zvukového subsystému (OpenAL)',
            severity: 'warning',
            description: 'Minecraftu se nepodařilo otevřít nastavené zvukové výstupní zařízení (OpenAL Invalid Device).',
            recommendation: 'Automatická oprava resetovala zvukový výstup v options.txt na výchozí systémové zařízení.',
            logExcerpt: extractRelevantStack(combinedText, /(?:openal|Invalid Device)/i) || logExcerpt,
            autoFix: {
                id: 'RESET_AUDIO_DEVICE',
                label: 'Resetovat zvukové zařízení',
                description: 'Nastaví soundDevice na výchozí zařízení v options.txt.'
            }
        };
    }

    return {
        hasCrash: true,
        exitCode,
        reportPath,
        title: `Neočekávané ukončení hry (Kód: ${exitCode})`,
        severity: 'warning',
        description: reportPath
            ? 'Minecraft byl neočekávaně ukončen. Detailní technický report byl zapsán do souboru crash-reports.'
            : 'Minecraft byl ukončen s nenulovým kódem. Prohlédni si výpis z herního logu níže pro zjištění příčiny.',
        recommendation: reportPath
            ? 'Klikni na tlačítko níže pro otevření kompletního crash reportu.'
            : 'Zkontroluj herní log v boční konzoli nebo otevři složku hry.',
        logExcerpt: logExcerpt || 'Žádné podrobnosti v logu nebyly nalezeny.',
        autoFix: reportPath ? {
            id: 'OPEN_CRASH_REPORT',
            reportPath,
            label: '📄 Otevřít kompletní Crash Report',
            description: 'Zobrazí plný technický report pádů v systémovém editoru.'
        } : {
            id: 'OPEN_GAME_DIR',
            label: '📂 Otevřít složku Minecraftu',
            description: 'Otevře herní adresář profilu.'
        }
    };
}

/**
 * Downloads a file from URL to destination path
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const req = https.get(url, {
            headers: {
                'User-Agent': 'mychalsmp-launcher/1.0 (admin@mychalsmp.xyz)'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirect
                file.close();
                try { fs.unlinkSync(destPath); } catch (e) { }
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(destPath); } catch (e) { }
                return reject(new Error(`HTTP status: ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(true));
            });
        });

        req.on('error', (err) => {
            file.close();
            try { fs.unlinkSync(destPath); } catch (e) { }
            reject(err);
        });
    });
}

/**
 * Executes the automatic fix action
 */
async function executeCrashFix(autoFix, gameDir, config, saveConfigFn, detectJavaPathFn, downloadJavaFn) {
    if (!autoFix || !autoFix.id) {
        throw new Error('Není definována žádná akce opravy.');
    }

    switch (autoFix.id) {
        case 'BYPASS_SODIUM_DRIVER_CHECKS': {
            // 1. Obnovíme dříve deaktivované Sodium a Iris, aby je mohl hráč otestovat s novými flagy
            const modsDir = path.join(gameDir, 'mods');
            if (fs.existsSync(modsDir)) {
                try {
                    const mFiles = fs.readdirSync(modsDir);
                    for (const f of mFiles) {
                        const l = f.toLowerCase();
                        if ((l.startsWith('sodium-') || l.startsWith('sodium_') || l === 'sodium.jar.disabled') && l.endsWith('.disabled')) {
                            const srcP = path.join(modsDir, f);
                            const dstP = srcP.replace(/\.disabled$/i, '');
                            if (!fs.existsSync(dstP)) {
                                fs.renameSync(srcP, dstP);
                            }
                        }
                        if ((l.startsWith('iris-') || l.startsWith('iris_') || l === 'iris.jar.disabled') && l.endsWith('.disabled')) {
                            const srcP = path.join(modsDir, f);
                            const dstP = srcP.replace(/\.disabled$/i, '');
                            if (!fs.existsSync(dstP)) {
                                fs.renameSync(srcP, dstP);
                            }
                        }
                    }
                } catch (_) { }
            }

            // 2. Přidáme JVM argumenty obcházející bugchecky Sodium
            const sodiumFlags = [
                '-Dsodium.checks.issue2561=false',
                '-Dsodium.checks.issue899=false',
                '-Dsodium.checks.issue1486=false',
                '-Dsodium.checks.issue2048=false',
                '-Dsodium.checks.issue2637=false'
            ];
            let currentArgs = config.jvmArgs || [];
            if (typeof currentArgs === 'string') {
                currentArgs = currentArgs.split(/\s+/).filter(Boolean);
            }
            if (!Array.isArray(currentArgs)) {
                currentArgs = [];
            }
            for (const flag of sodiumFlags) {
                const prefix = flag.split('=')[0];
                if (!currentArgs.some(a => typeof a === 'string' && a.startsWith(prefix))) {
                    currentArgs.push(flag);
                }
            }
            config.jvmArgs = currentArgs;
            if (saveConfigFn) saveConfigFn({ jvmArgs: config.jvmArgs });
            return {
                success: true,
                relaunch: true,
                message: 'Byla nastavena pravidla pro přeskočení kontrol grafického ovladače v Sodium. Spouštím hru znovu...',
                updatedConfig: { jvmArgs: config.jvmArgs }
            };
        }

        case 'SET_RAM_6GB': {
            const newRam = autoFix.targetRam || 6;
            config.ramMax = Math.max(config.ramMax || 4, newRam);
            if (saveConfigFn) saveConfigFn({ ramMax: config.ramMax });
            return {
                success: true,
                message: `Maximální paměť RAM byla úspěšně zvýšena na ${config.ramMax} GB.`,
                updatedConfig: { ramMax: config.ramMax }
            };
        }

        case 'INSTALL_FABRIC_API': {
            const modsDir = path.join(gameDir, 'mods');
            if (!fs.existsSync(modsDir)) {
                fs.mkdirSync(modsDir, { recursive: true });
            }

            // Target Fabric API version from Modrinth
            const version = config.version || '26.2';
            let downloadUrl = null;
            let filename = `fabric-api-${version}.jar`;

            try {
                // Fetch version from Modrinth API
                const apiUrl = `https://api.modrinth.com/v2/project/fabric-api/version?game_versions=["${encodeURIComponent(version)}"]&loaders=["fabric"]`;
                const data = await new Promise((resolve, reject) => {
                    https.get(apiUrl, {
                        headers: { 'User-Agent': 'mychalsmp-launcher/1.0 (admin@mychalsmp.xyz)' }
                    }, (res) => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(body));
                            } catch (e) {
                                resolve([]);
                            }
                        });
                    }).on('error', reject);
                });

                if (Array.isArray(data) && data.length > 0 && data[0].files && data[0].files.length > 0) {
                    const primary = data[0].files.find(f => f.primary) || data[0].files[0];
                    downloadUrl = primary.url;
                    filename = primary.filename;
                }
            } catch (apiErr) {
                console.warn('[CRASH ANALYZER] Nelze získat Fabric API z Modrinth API:', apiErr);
            }

            if (!downloadUrl) {
                // Fallback direct URL for Fabric API
                downloadUrl = 'https://cdn.modrinth.com/data/P7dR8mSH/versions/B1l8K5mP/fabric-api-0.115.1%2B1.21.4.jar';
                filename = 'fabric-api-latest.jar';
            }

            const destPath = path.join(modsDir, filename);
            await downloadFile(downloadUrl, destPath);

            return {
                success: true,
                message: `Fabric API (${filename}) byl úspěšně stažen a nainstalován do složky mods.`
            };
        }

        case 'AUTO_DETECT_JAVA': {
            const targetVer = (autoFix && autoFix.targetJavaVersion) || 25;
            // 1. Zkusit najít kompatibilní systémovou Javu na počítači
            if (detectJavaPathFn) {
                const detected = detectJavaPathFn(targetVer);
                if (detected && fs.existsSync(detected)) {
                    config.javaPath = detected;
                    if (saveConfigFn) saveConfigFn({ javaPath: detected });
                    return {
                        success: true,
                        message: `Byla nalezena a nastavena systémová Java ${targetVer}+: ${detected}`,
                        updatedConfig: { javaPath: detected }
                    };
                }
            }

            // 2. Pokud v systému není, automaticky stáhnout oficiální OpenJDK z Adoptium
            if (downloadJavaFn) {
                try {
                    const downloaded = await downloadJavaFn(targetVer);
                    if (downloaded && fs.existsSync(downloaded)) {
                        config.javaPath = downloaded;
                        if (saveConfigFn) saveConfigFn({ javaPath: downloaded });
                        return {
                            success: true,
                            message: `Byla úspěšně stažena a nastavena oficiální Java ${targetVer} (Adoptium JRE). Můžeš spustit hru!`,
                            updatedConfig: { javaPath: downloaded }
                        };
                    }
                } catch (e) {
                    console.error('Chyba při stahování Javy v crash fixu:', e);
                }
            }

            config.javaPath = '';
            if (saveConfigFn) saveConfigFn({ javaPath: '' });
            return {
                success: true,
                message: `Cesta k Javě byla resetována. Při příštím spuštění launcher automaticky stáhne Javu ${targetVer}.`,
                updatedConfig: { javaPath: '' }
            };
        }

        case 'REDOWNLOAD_VERSION_JAR': {
            const targetVer = config.version || '26.2';
            const baseDir = config.baseDir || gameDir;
            const verDir = path.join(baseDir, 'versions');
            const targetVerDir = path.join(verDir, targetVer);
            const vJar = path.join(targetVerDir, `${targetVer}.jar`);
            const vBak = path.join(targetVerDir, `${targetVer}.vanilla.jar`);
            try { if (fs.existsSync(vJar)) fs.unlinkSync(vJar); } catch (_) { }
            try { if (fs.existsSync(vBak)) fs.unlinkSync(vBak); } catch (_) { }
            try { if (fs.existsSync(`${vJar}.skin_sig`)) fs.unlinkSync(`${vJar}.skin_sig`); } catch (_) { }
            try { if (fs.existsSync(`${vJar}.brand_sig`)) fs.unlinkSync(`${vJar}.brand_sig`); } catch (_) { }
            try { if (fs.existsSync(`${vJar}.vanilla_bak`)) fs.unlinkSync(`${vJar}.vanilla_bak`); } catch (_) { }

            // Vyčistit také všechny odvozené Fabric/Forge JARy pro tuto verzi
            try {
                if (fs.existsSync(verDir)) {
                    for (const d of fs.readdirSync(verDir)) {
                        if (d.includes(targetVer)) {
                            const subJar = path.join(verDir, d, `${d}.jar`);
                            const subBak = path.join(verDir, d, `${d}.vanilla.jar`);
                            try { if (fs.existsSync(subJar)) fs.unlinkSync(subJar); } catch (_) { }
                            try { if (fs.existsSync(subBak)) fs.unlinkSync(subBak); } catch (_) { }
                            try { if (fs.existsSync(`${subJar}.skin_sig`)) fs.unlinkSync(`${subJar}.skin_sig`); } catch (_) { }
                            try { if (fs.existsSync(`${subJar}.brand_sig`)) fs.unlinkSync(`${subJar}.brand_sig`); } catch (_) { }
                        }
                    }
                }
            } catch (_) { }

            // Vyčistit remapped cache Fabricu
            try {
                const remappedDir = path.join(baseDir, '.fabric', 'remappedJars');
                if (fs.existsSync(remappedDir)) fs.rmSync(remappedDir, { recursive: true, force: true });
            } catch (_) { }

            return {
                success: true,
                relaunch: true,
                message: `Soubory verze ${targetVer} a odvozené profily byly resetovány. Při příštím spuštění launcher stáhne čistou oficiální kopii od Mojangu!`
            };
        }

        case 'RESET_FABRIC_LOADER': {
            const baseDir = config?.baseDir || gameDir;
            const cleaned = [];
            try {
                const versionsDir = path.join(baseDir, 'versions');
                if (fs.existsSync(versionsDir)) {
                    for (const d of fs.readdirSync(versionsDir)) {
                        if (d.toLowerCase().includes('0.20.0') || d.toLowerCase().startsWith('fabric-loader-0.20.0')) {
                            try {
                                fs.rmSync(path.join(versionsDir, d), { recursive: true, force: true });
                                cleaned.push(d);
                            } catch (_) { }
                        }
                    }
                }
            } catch (_) { }

            try {
                const flLibDir = path.join(baseDir, 'libraries', 'net', 'fabricmc', 'fabric-loader');
                if (fs.existsSync(flLibDir)) {
                    for (const d of fs.readdirSync(flLibDir)) {
                        if (d.includes('0.20.0')) {
                            try {
                                fs.rmSync(path.join(flLibDir, d), { recursive: true, force: true });
                                cleaned.push(`lib: ${d}`);
                            } catch (_) { }
                        }
                    }
                }
            } catch (_) { }

            return {
                success: true,
                relaunch: true,
                message: `Nestabilní zavaděč Fabric Loader byl úspěšně vyčištěn (${cleaned.join(', ') || 'profily resetovány'}). Při příštím spuštění launcher použije ověřenou stabilní verzi 0.19.5.`
            };
        }

        case 'RESET_OPTIONS': {
            const optionsFile = path.join(gameDir, 'options.txt');
            if (fs.existsSync(optionsFile)) {
                const backupFile = path.join(gameDir, 'options.txt.bak');
                fs.renameSync(optionsFile, backupFile);
                return {
                    success: true,
                    message: 'Soubor options.txt byl úspěšně zazálohován a resetován. Hra vygeneruje nové čisté nastavení.'
                };
            }
            return {
                success: true,
                message: 'Soubor options.txt nebyl nalezen, hra automaticky vytvoří výchozí nastavení.'
            };
        }

        case 'ENABLE_WAYLAND': {
            config.enableNativeWayland = true;
            if (saveConfigFn) saveConfigFn({ enableNativeWayland: true });
            return {
                success: true,
                message: 'Nativní Wayland okno bylo úspěšně aktivováno v nastavení.',
                updatedConfig: { enableNativeWayland: true }
            };
        }

        case 'DISABLE_DISCRETE_GPU': {
            config.enableDiscreteGpu = false;
            if (saveConfigFn) saveConfigFn({ enableDiscreteGpu: false });
            return {
                success: true,
                message: 'Vynucení diskrétní GPU bylo úspěšně vypnuto. Hra nyní použije standardní grafický adaptér.',
                updatedConfig: { enableDiscreteGpu: false }
            };
        }

        case 'DELETE_CORRUPT_JAR': {
            const targetFile = autoFix.filePath;
            let deletedList = [];
            const cleanJarAndBackups = (filePath) => {
                if (!filePath) return;
                const vBak = filePath.replace(/\.jar$/, '.vanilla.jar');
                if (fs.existsSync(vBak) && isJarFileValid(vBak)) {
                    try {
                        fs.copyFileSync(vBak, filePath);
                        deletedList.push(`${path.basename(filePath)} (obnoveno ze zálohy)`);
                    } catch (_) {
                        try {
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                                deletedList.push(path.basename(filePath));
                            }
                        } catch (_) { }
                    }
                } else {
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                            deletedList.push(path.basename(filePath));
                        }
                    } catch (_) { }
                    try { if (fs.existsSync(vBak)) fs.unlinkSync(vBak); } catch (_) { }
                }
                try { if (fs.existsSync(`${filePath}.skin_sig`)) fs.unlinkSync(`${filePath}.skin_sig`); } catch (_) { }
                try { if (fs.existsSync(`${filePath}.brand_sig`)) fs.unlinkSync(`${filePath}.brand_sig`); } catch (_) { }
                try { if (fs.existsSync(`${filePath}.vanilla_bak`)) fs.unlinkSync(`${filePath}.vanilla_bak`); } catch (_) { }
            };

            const baseDir = config.baseDir || gameDir;
            if (targetFile) {
                cleanJarAndBackups(targetFile);
                // Pokud šlo o soubor v versions/, vyčistit i všechny spjaté profily
                if (targetFile.includes('/versions/')) {
                    const fname = path.basename(targetFile, '.jar');
                    const verMatch = fname.match(/(\d+\.\d+(?:\.\d+)?)/);
                    if (verMatch) {
                        const targetVer = verMatch[1];
                        const verDir = path.join(baseDir, 'versions');
                        try {
                            if (fs.existsSync(verDir)) {
                                for (const d of fs.readdirSync(verDir)) {
                                    if (d.includes(targetVer)) {
                                        cleanJarAndBackups(path.join(verDir, d, `${d}.jar`));
                                    }
                                }
                            }
                        } catch (_) { }
                    }
                }
            } else {
                // Plošné vyčištění všech neplatných JARů v versions
                try {
                    const verDir = path.join(baseDir, 'versions');
                    if (fs.existsSync(verDir)) {
                        for (const d of fs.readdirSync(verDir)) {
                            const j = path.join(verDir, d, `${d}.jar`);
                            if (fs.existsSync(j) && !isJarFileValid(j)) {
                                cleanJarAndBackups(j);
                            }
                        }
                    }
                } catch (_) { }
            }

            // Vyčisti remapped cache Fabricu, která mohla vzniknout z poškozeného jádra
            try {
                const remappedDir = path.join(baseDir, '.fabric', 'remappedJars');
                if (fs.existsSync(remappedDir)) {
                    fs.rmSync(remappedDir, { recursive: true, force: true });
                }
            } catch (_) { }

            if (targetFile) {
                cleanJarAndBackups(targetFile);

                // Pokud šlo o Fabric loader jar, zkontroluj a vyčisti i vanilkové jádro pokud je vadné
                if (targetFile.includes('fabric-loader-')) {
                    const matchVer = targetFile.match(/fabric-loader-[^-]+-([0-9.]+)\.jar/i);
                    if (matchVer && matchVer[1]) {
                        const vJar = path.join(path.dirname(path.dirname(targetFile)), matchVer[1], `${matchVer[1]}.jar`);
                        if (fs.existsSync(vJar) && !isJarFileValid(vJar)) {
                            cleanJarAndBackups(vJar);
                        }
                    }
                }
            }

            // Prohledej celou složku versions a odstraň všechny další neplatné JARy a poškozené zálohy
            const versionsDir = path.join(gameDir, 'versions');
            if (fs.existsSync(versionsDir)) {
                try {
                    const vDirs = fs.readdirSync(versionsDir);
                    for (const vd of vDirs) {
                        const vPath = path.join(versionsDir, vd);
                        if (fs.existsSync(vPath) && fs.statSync(vPath).isDirectory()) {
                            const files = fs.readdirSync(vPath);
                            for (const f of files) {
                                if (f.endsWith('.jar')) {
                                    const fullF = path.join(vPath, f);
                                    if (!isJarFileValid(fullF)) {
                                        cleanJarAndBackups(fullF);
                                    }
                                }
                            }
                        }
                    }
                } catch (_) { }
            }

            return {
                success: true,
                relaunch: true,
                message: deletedList.length > 0
                    ? `Poškozené soubory (${deletedList.join(', ')}) byly bezpečně odstraněny. Launcher je při příštím spuštění čistě obnoví a stáhne z Mojang serveru.`
                    : 'Poškozené soubory byly vyčištěny. Můžeš hru spustit znovu.'
            };
        }

        case 'RELAUNCH_GAME': {
            return {
                success: true,
                relaunch: true,
                message: 'Hra byla opravena a je připravena ke spuštění.'
            };
        }

        case 'DISABLE_INCOMPATIBLE_MODS': {
            const modsDir = path.join(gameDir, 'mods');
            const files = autoFix.files || [];
            let disabledCount = 0;
            for (const f of files) {
                const fullP = path.join(modsDir, f);
                if (fs.existsSync(fullP)) {
                    try {
                        fs.renameSync(fullP, fullP + '.disabled');
                        disabledCount++;
                    } catch (e) {
                        console.error('Chyba při vypínání módu:', e);
                    }
                }
            }
            return {
                success: true,
                relaunch: true,
                message: `Deaktivováno ${disabledCount} nekompatibilních módů. Hra je připravena ke spuštění.`
            };
        }

        case 'INSTALL_MISSING_DEPENDENCIES': {
            const missing = autoFix.missingDeps || [];
            const targetVersion = config.version || '26.2';
            const targetLoader = config.loader || 'fabric';
            const downloadedNames = [];

            for (const item of missing) {
                const depId = item.depId || item.id;
                if (!depId) continue;
                try {
                    const resolved = await resolveModrinthProject(depId);
                    const dlId = resolved?.id || resolved?.slug || depId;
                    const dlTitle = resolved?.title || item.depName || depId;

                    const dlRes = await downloadModOrPack({
                        id: dlId,
                        title: dlTitle,
                        projectType: 'mod',
                        version: targetVersion,
                        loader: targetLoader
                    }, gameDir);

                    if (dlRes && dlRes.success) {
                        downloadedNames.push(dlTitle);
                    }
                } catch (dlErr) {
                    console.error(`[CRASH FIX] Chyba při stahování závislosti ${depId}:`, dlErr);
                }
            }

            if (downloadedNames.length > 0) {
                return {
                    success: true,
                    relaunch: true,
                    message: `Úspěšně staženo a nainstalováno: ${downloadedNames.join(', ')}. Spouštím hru!`
                };
            }

            // Fallback: Pokud se stažení nezdařilo, deaktivujeme problémové módy!
            const disabledNames = [];
            const modsDir = path.join(gameDir, 'mods');
            for (const item of missing) {
                if (item.modId || item.modName) {
                    const dis = disableModInModsDir(modsDir, item.modId, item.modName);
                    if (dis && !disabledNames.includes(dis.filename)) {
                        disabledNames.push(dis.filename);
                    }
                }
            }
            if (disabledNames.length > 0) {
                return {
                    success: true,
                    relaunch: true,
                    message: `Závislosti se nepodařilo stáhnout. Problematické módy byly deaktivovány: ${disabledNames.join(', ')}. Spouštím hru!`
                };
            }

            throw new Error('Nepodařilo se automaticky stáhnout chybějící závislosti z Modrinthu ani deaktivovat problematický mód.');
        }

        case 'RESET_GRAPHICS_BACKEND_DEFAULT': {
            config.enableZink = false;
            config.graphicsBackend = 'default';
            config.enableDiscreteGpu = false;
            if (saveConfigFn) {
                saveConfigFn({
                    enableZink: false,
                    graphicsBackend: 'default',
                    enableDiscreteGpu: false
                });
            }
            return {
                success: true,
                relaunch: true,
                message: 'Zink byl vypnut a grafický adaptér byl resetován na bezpečný stabilní výchozí profil.',
                updatedConfig: {
                    enableZink: false,
                    graphicsBackend: 'default',
                    enableDiscreteGpu: false
                }
            };
        }

        case 'DISABLE_CORRUPT_SHADERPACK': {
            const irisOptionsFile = path.join(gameDir, 'optionsiris.txt');
            let modified = false;
            if (fs.existsSync(irisOptionsFile)) {
                try {
                    let content = fs.readFileSync(irisOptionsFile, 'utf-8');
                    content = content.replace(/shaderPack=.*/g, 'shaderPack=');
                    content = content.replace(/enableShaders=true/g, 'enableShaders=false');
                    fs.writeFileSync(irisOptionsFile, content, 'utf-8');
                    modified = true;
                } catch (e) {
                    console.error('Chyba při úpravě optionsiris.txt:', e);
                }
            }
            return {
                success: true,
                relaunch: true,
                message: modified
                    ? 'Aktivní shaderpack byl deaktivován v optionsiris.txt. Hra se spustí bez shaderů.'
                    : 'Konfigurace shaderů byla vyčištěna.'
            };
        }

        case 'RESET_RESOURCE_PACKS': {
            const optionsFile = path.join(gameDir, 'options.txt');
            let modified = false;
            if (fs.existsSync(optionsFile)) {
                try {
                    let content = fs.readFileSync(optionsFile, 'utf-8');
                    content = content.replace(/resourcePacks:\[.*?\]/g, 'resourcePacks:[]');
                    content = content.replace(/incompatibleResourcePacks:\[.*?\]/g, 'incompatibleResourcePacks:[]');
                    fs.writeFileSync(optionsFile, content, 'utf-8');
                    modified = true;
                } catch (e) {
                    console.error('Chyba při úpravě options.txt:', e);
                }
            }
            return {
                success: true,
                relaunch: true,
                message: modified
                    ? 'Balíčky textur (resource packs) byly vyčištěny z options.txt.'
                    : 'Nastavení balíčků textur bylo resetováno na vanilkový vzhled.'
            };
        }

        case 'CLEAN_PARTIAL_DOWNLOADS': {
            const modsDir = path.join(gameDir, 'mods');
            let cleaned = [];
            if (fs.existsSync(modsDir)) {
                try {
                    const files = fs.readdirSync(modsDir);
                    for (const f of files) {
                        const lower = f.toLowerCase();
                        const fullP = path.join(modsDir, f);
                        const isPartial = lower.endsWith('.part') || lower.endsWith('.tmp') || lower.endsWith('.crdownload') || lower.endsWith('.download');
                        let isBadJar = false;
                        if (lower.endsWith('.jar')) {
                            try {
                                const st = fs.statSync(fullP);
                                if (st.size < 300 || !isJarFileValid(fullP)) {
                                    isBadJar = true;
                                }
                            } catch (_) {}
                        }
                        if (isPartial || isBadJar) {
                            try {
                                fs.unlinkSync(fullP);
                                cleaned.push(f);
                            } catch (_) {}
                        }
                    }
                } catch (e) {
                    console.error('Chyba při čištění složky mods:', e);
                }
            }
            return {
                success: true,
                relaunch: true,
                message: cleaned.length > 0
                    ? `Bylo odstraněno ${cleaned.length} poškozených souborů (${cleaned.slice(0, 3).join(', ')}).`
                    : 'Složka mods byla zkontrolována a vyčištěna.'
            };
        }

        case 'PURGE_NATIVES_CACHE': {
            const baseDir = config.baseDir || gameDir;
            const candidates = [
                path.join(baseDir, 'natives_extract'),
                path.join(gameDir, 'natives_extract'),
                path.join(baseDir, '.natives'),
                path.join(gameDir, '.natives')
            ];
            let purgedCount = 0;
            for (const p of candidates) {
                if (fs.existsSync(p)) {
                    try {
                        fs.rmSync(p, { recursive: true, force: true });
                        purgedCount++;
                    } catch (_) {}
                }
            }
            return {
                success: true,
                relaunch: true,
                message: 'Mezipaměť rozbalených nativních knihoven LWJGL byla úspěšně vyčištěna.'
            };
        }

        case 'RESET_JVM_MEMORY_FLAGS': {
            config.ramMin = 2;
            config.ramMax = Math.max(6, config.ramMax || 6);
            if (config.customJvmArgs && typeof config.customJvmArgs === 'string') {
                config.customJvmArgs = config.customJvmArgs
                    .replace(/-Xm[sx]\d+[kmgKMG]?/g, '')
                    .replace(/-XX:MaxHeapSize=\d+[kmgKMG]?/g, '')
                    .replace(/-XX:InitialHeapSize=\d+[kmgKMG]?/g, '')
                    .trim();
            }
            if (Array.isArray(config.jvmArgs)) {
                config.jvmArgs = config.jvmArgs.filter(a => !/^-Xm[sx]/.test(a));
            }
            if (saveConfigFn) {
                saveConfigFn({
                    ramMin: 2,
                    ramMax: config.ramMax,
                    customJvmArgs: config.customJvmArgs,
                    jvmArgs: config.jvmArgs
                });
            }
            return {
                success: true,
                relaunch: true,
                message: `Paměťové meze byly harmonizovány na 2 GB (min) a ${config.ramMax} GB (max).`,
                updatedConfig: {
                    ramMin: 2,
                    ramMax: config.ramMax,
                    customJvmArgs: config.customJvmArgs,
                    jvmArgs: config.jvmArgs
                }
            };
        }

        case 'RESET_SODIUM_CONFIG': {
            const sodiumConfig = path.join(gameDir, 'config', 'sodium-options.json');
            if (fs.existsSync(sodiumConfig)) {
                try {
                    fs.renameSync(sodiumConfig, sodiumConfig + '.bak');
                } catch (_) {}
            }
            return {
                success: true,
                relaunch: true,
                message: 'Konfigurační soubor sodium-options.json byl zálohován a obnoven do výchozího stavu.'
            };
        }

        case 'RESET_AUDIO_DEVICE': {
            const optionsFile = path.join(gameDir, 'options.txt');
            let modified = false;
            if (fs.existsSync(optionsFile)) {
                try {
                    let content = fs.readFileSync(optionsFile, 'utf-8');
                    content = content.replace(/soundDevice:.*/g, 'soundDevice:""');
                    fs.writeFileSync(optionsFile, content, 'utf-8');
                    modified = true;
                } catch (_) {}
            }
            return {
                success: true,
                relaunch: true,
                message: 'Zvukové výstupní zařízení v options.txt bylo resetováno na výchozí hodnotu.'
            };
        }

        case 'OPEN_CRASH_REPORT': {
            const targetPath = autoFix.reportPath || findLatestCrashReport(gameDir);
            if (targetPath && fs.existsSync(targetPath)) {
                await shell.openPath(targetPath);
                return {
                    success: true,
                    message: `Crash report byl otevřen: ${path.basename(targetPath)}`
                };
            }
            throw new Error('Crash report nebyl na disku nalezen.');
        }

        case 'OPEN_MODS_DIR': {
            const modsDir = path.join(gameDir, 'mods');
            if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
            await shell.openPath(modsDir);
            return {
                success: true,
                message: 'Složka mods byla otevřena.'
            };
        }

        case 'OPEN_GAME_DIR': {
            await shell.openPath(gameDir);
            return {
                success: true,
                message: 'Složka profilu byla otevřena.'
            };
        }

        default:
            throw new Error(`Neznámý typ opravy: ${autoFix.id}`);
    }
}

module.exports = {
    findLatestCrashReport,
    readLatestLogTail,
    extractMissingDependencies,
    autoResolveMissingDependencies,
    autoResolveIncompatibleMods,
    analyzeCrash,
    executeCrashFix
};
