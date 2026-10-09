const fs = require('fs');
const path = require('path');
const https = require('https');
const { shell } = require('electron');

/**
 * Intelligent Crash Analyzer for MYCHAL SMP Launcher
 * Analyzes Minecraft crashes (exit code 1 or non-zero), extracts the root cause
 * from crash-reports and latest.log, explains it in clean Czech, and provides
 * 1-click automatic fixes.
 */

/**
 * Searches for the newest crash report in gameDir/crash-reports
 */
function findLatestCrashReport(gameDir) {
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
function readLatestLogTail(gameDir, maxLines = 150) {
    try {
        const logPath = path.join(gameDir, 'logs', 'latest.log');
        if (!fs.existsSync(logPath)) return '';

        const stat = fs.statSync(logPath);
        // Only read up to last 128KB
        const readSize = Math.min(stat.size, 131072);
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
 * Analyzes the crash and determines the Czech diagnosis and 1-click fix
 */
function analyzeCrash(gameDir, exitCode = 1, recentMemoryLogs = []) {
    let reportContent = '';
    let reportPath = findLatestCrashReport(gameDir);

    if (reportPath && fs.existsSync(reportPath)) {
        try {
            reportContent = fs.readFileSync(reportPath, 'utf-8');
        } catch (e) {}
    }

    const logTail = readLatestLogTail(gameDir);
    const memoryLogText = Array.isArray(recentMemoryLogs) ? recentMemoryLogs.join('\n') : '';

    const combinedText = [
        reportContent,
        logTail,
        memoryLogText
    ].join('\n\n');

    // Extract relevant stack trace or exception snippet
    let logExcerpt = '';
    if (reportContent) {
        const lines = reportContent.split('\n');
        // Take first 35 lines of crash report which contain description and head stacktrace
        logExcerpt = lines.slice(0, 35).join('\n');
    } else if (logTail) {
        const errorLines = logTail.split('\n').filter(l =>
            l.includes('FATAL') || l.includes('ERROR') || l.includes('Exception') || l.includes('Error')
        );
        logExcerpt = errorLines.slice(-15).join('\n') || logTail.split('\n').slice(-15).join('\n');
    }
    
    // Pokud logTail neobsahoval žádnou chybu nebo byl prázdný, vytáhneme chyby přímo z paměťových logů (stdout/stderr)
    if (!logExcerpt && memoryLogText) {
        const memLines = memoryLogText.split('\n').map(l => l.trim()).filter(Boolean);
        const errorLines = memLines.filter(l =>
            l.includes('FATAL') || l.includes('ERROR') || l.includes('Exception') || l.includes('Error') ||
            l.includes('GLFW') || l.includes('GLX') || l.includes('Failed') || l.includes('[GAME]') || l.includes('[STDERR]')
        );
        logExcerpt = errorLines.slice(-15).join('\n') || memLines.slice(-15).join('\n');
    }

    // ── Diagnostic Rule 1: Out of Memory / Insufficient RAM ──────────────────
    if (
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
            title: 'Chybí základní knihovna Fabric API',
            severity: 'critical',
            description: 'V profilu máš nainstalované Fabric modifikace, které ke svému chodu vyžadují oficiální knihovnu Fabric API. Ta v aktuální složce mods chybí.',
            recommendation: 'Nainstaluj Fabric API pro aktuální verzi hry. Launcher ji může stáhnout automaticky jedním kliknutím.',
            logExcerpt,
            autoFix: {
                id: 'INSTALL_FABRIC_API',
                label: '⬇️ Automaticky stáhnout a nainstalovat Fabric API',
                description: 'Stáhne kompatibilní balíček Fabric API přímo do složky mods tohoto profilu.'
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
            title: `Nekompatibilní nebo zastaralá Java (Vyžadována Java ${reqMajor})`,
            severity: 'critical',
            description: `Minecraft 26.x byl zkompilován pro Java ${reqMajor} (verze tříd ${reqMajor + 44}.0), avšak spuštěný proces běží pod starší Java ${currMajor}.`,
            recommendation: `Launcher automaticky stáhne a nastaví oficiální 64-bitové běhové prostředí Java ${reqMajor} (Adoptium Temurin JRE).`,
            logExcerpt,
            autoFix: {
                id: 'AUTO_DETECT_JAVA',
                label: `☕ Automaticky nastavit nebo stáhnout Javu ${reqMajor}`,
                description: `Zkontroluje systém a nastaví nebo stáhne kompatibilní 64-bitovou Javu ${reqMajor}.`,
                targetJavaVersion: reqMajor
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

    // ── Diagnostic Rule 7: Specific Mod Incompatibility ─────────────────────
    const modCrashMatch = combinedText.match(/(?:Caused by:\s+)?net\.fabricmc\.loader\.[^\n]+Exception:\s+([^\n\r]+)/i) ||
                          combinedText.match(/Could not execute entrypoint stage 'main' due to errors, provided by '([^']+)'/i);
    if (modCrashMatch) {
        const culprit = modCrashMatch[1];
        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Chyba při zavádění modifikace',
            severity: 'warning',
            description: `Pád způsobil konflikt nebo chyba v modifikaci: ${culprit}`,
            recommendation: 'Zkontroluj složku mods a dočasně zakaž tuto modifikaci přejmenováním na .disabled.',
            logExcerpt,
            autoFix: {
                id: 'OPEN_MODS_DIR',
                label: '📂 Otevřít složku mods',
                description: 'Otevře složku mods pro správu souborů.'
            }
        };
    }

    // ── Diagnostic Rule 8: GLFW / OpenGL / GLX Initialization Failure ────────
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

    // ── Diagnostic Rule 9: Corrupted Library / Mod JAR (ZipException) ────────
    if (
        /ZipException/i.test(combinedText) ||
        /invalid CEN header/i.test(combinedText) ||
        /error reading\s+[^\n\r]+\.jar/i.test(combinedText)
    ) {
        let corruptJarPath = null;
        const jarMatch = combinedText.match(/error reading\s+([^\n\r\t]+\.jar)/i) ||
                         combinedText.match(/reading\s+([^\n\r\t\s]+\.jar)/i);
        if (jarMatch && jarMatch[1]) {
            corruptJarPath = jarMatch[1].trim();
        }

        return {
            hasCrash: true,
            exitCode,
            reportPath,
            title: 'Poškozený soubor knihovny JAR (ZipException)',
            severity: 'critical',
            description: `Byl detekován neúplný nebo poškozený soubor knihovny ${corruptJarPath ? path.basename(corruptJarPath) : 'JAR'}. K tomu dochází při přerušeném stahování z internetu.`,
            recommendation: 'Klikni na tlačítko níže pro automatické smazání poškozeného souboru. Launcher jej při dalším spuštění stáhne čistě.',
            logExcerpt: logExcerpt || (corruptJarPath ? `IOException: error reading ${corruptJarPath}` : 'ZipException: invalid CEN header'),
            autoFix: corruptJarPath ? {
                id: 'DELETE_CORRUPT_JAR',
                filePath: corruptJarPath,
                label: `🧹 Odstranit poškozený ${path.basename(corruptJarPath)}`,
                description: 'Odstraní poškozený soubor z disku, aby jej launcher mohl stáhnout znovu a v pořádku.'
            } : null
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
                try { fs.unlinkSync(destPath); } catch (e) {}
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(destPath); } catch (e) {}
                return reject(new Error(`HTTP status: ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(true));
            });
        });

        req.on('error', (err) => {
            file.close();
            try { fs.unlinkSync(destPath); } catch (e) {}
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
            if (targetFile && fs.existsSync(targetFile)) {
                try {
                    fs.unlinkSync(targetFile);
                    return {
                        success: true,
                        message: `Poškozený soubor ${path.basename(targetFile)} byl úspěšně odstraněn. Při příštím spuštění jej launcher stáhne čistě.`
                    };
                } catch (delErr) {
                    throw new Error(`Nepodařilo se odstranit soubor: ${delErr.message}`);
                }
            }
            return {
                success: true,
                message: 'Soubor již byl odstraněn. Můžeš hru spustit znovu.'
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
    analyzeCrash,
    executeCrashFix
};
