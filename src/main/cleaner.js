const fs = require('fs');
const path = require('path');

/**
 * Cache and Storage Cleaner for MYCHAL SMP Launcher
 * Automatically detects and cleans old compressed logs (.log.gz), crash reports
 * older than 30 days, temporary files, old native extractions, and unused Java cached jars.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Recursively scans a directory for files matching criteria
 */
function scanDir(dirPath, filterFn, maxDepth = 4, currentDepth = 0) {
    let results = [];
    if (!fs.existsSync(dirPath) || currentDepth > maxDepth) return results;

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                results = results.concat(scanDir(fullPath, filterFn, maxDepth, currentDepth + 1));
            } else if (entry.isFile()) {
                try {
                    const stat = fs.statSync(fullPath);
                    if (filterFn(fullPath, entry.name, stat)) {
                        results.push({
                            path: fullPath,
                            size: stat.size,
                            mtime: stat.mtimeMs
                        });
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
    return results;
}

/**
 * Scans for all cleanable cache and old log files
 */
function scanLauncherCache(baseDir, profiles = []) {
    const now = Date.now();
    const directoriesToScan = new Set();
    directoriesToScan.add(baseDir);

    for (const p of profiles) {
        if (p.gameDir && fs.existsSync(p.gameDir)) {
            directoriesToScan.add(p.gameDir);
        }
    }

    const itemsToDelete = [];
    const breakdown = {
        logs: { count: 0, bytes: 0 },
        crashes: { count: 0, bytes: 0 },
        temps: { count: 0, bytes: 0 },
        oldJars: { count: 0, bytes: 0 }
    };

    // 1. Scan logs/*.log.gz and old *.log (> 30 days)
    for (const dir of directoriesToScan) {
        const logsDir = path.join(dir, 'logs');
        if (fs.existsSync(logsDir)) {
            const logFiles = scanDir(logsDir, (fPath, name, stat) => {
                if (name === 'latest.log') return false;
                // .log.gz files or old .log older than 30 days
                if (name.endsWith('.log.gz')) {
                    return (now - stat.mtimeMs) > THIRTY_DAYS_MS;
                }
                if (name.endsWith('.log')) {
                    return (now - stat.mtimeMs) > THIRTY_DAYS_MS;
                }
                return false;
            }, 1);

            for (const f of logFiles) {
                itemsToDelete.push(f);
                breakdown.logs.count++;
                breakdown.logs.bytes += f.size;
            }
        }

        // 2. Scan crash-reports/*.txt (> 30 days)
        const crashDir = path.join(dir, 'crash-reports');
        if (fs.existsSync(crashDir)) {
            const crashFiles = scanDir(crashDir, (fPath, name, stat) => {
                return name.endsWith('.txt') && (now - stat.mtimeMs) > THIRTY_DAYS_MS;
            }, 1);

            for (const f of crashFiles) {
                itemsToDelete.push(f);
                breakdown.crashes.count++;
                breakdown.crashes.bytes += f.size;
            }
        }
    }

    // 3. Scan temp files (*.tmp, *.part, *.download, natives cache)
    const tempDirs = [
        path.join(baseDir, 'temp'),
        path.join(baseDir, 'cache'),
        path.join(baseDir, 'natives'),
        path.join(baseDir, 'webcache')
    ];

    for (const tDir of tempDirs) {
        if (fs.existsSync(tDir)) {
            const tempFiles = scanDir(tDir, (fPath, name, stat) => {
                // All temporary files or natives older than 7 days
                return true;
            }, 3);

            for (const f of tempFiles) {
                itemsToDelete.push(f);
                breakdown.temps.count++;
                breakdown.temps.bytes += f.size;
            }
        }
    }

    // 4. Scan for abandoned / old orphaned version jars (> 30 days and not in active profiles)
    const versionsDir = path.join(baseDir, 'versions');
    if (fs.existsSync(versionsDir)) {
        const activeVersions = new Set(profiles.map(p => p.version));
        try {
            const vDirs = fs.readdirSync(versionsDir);
            for (const v of vDirs) {
                if (!activeVersions.has(v) && !v.includes('26.2') && !v.includes('26.3')) {
                    const fullVDir = path.join(versionsDir, v);
                    const jarFiles = scanDir(fullVDir, (fPath, name, stat) => {
                        return (now - stat.mtimeMs) > THIRTY_DAYS_MS;
                    }, 2);
                    for (const f of jarFiles) {
                        itemsToDelete.push(f);
                        breakdown.oldJars.count++;
                        breakdown.oldJars.bytes += f.size;
                    }
                }
            }
        } catch (e) {}
    }

    const totalBytes = itemsToDelete.reduce((acc, cur) => acc + cur.size, 0);

    return {
        fileCount: itemsToDelete.length,
        totalBytes,
        formattedSize: formatBytes(totalBytes),
        breakdown: {
            logs: { count: breakdown.logs.count, formatted: formatBytes(breakdown.logs.bytes) },
            crashes: { count: breakdown.crashes.count, formatted: formatBytes(breakdown.crashes.bytes) },
            temps: { count: breakdown.temps.count, formatted: formatBytes(breakdown.temps.bytes) },
            oldJars: { count: breakdown.oldJars.count, formatted: formatBytes(breakdown.oldJars.bytes) }
        },
        items: itemsToDelete
    };
}

/**
 * Cleans the identified cache files
 */
function cleanLauncherCache(baseDir, profiles = []) {
    const scan = scanLauncherCache(baseDir, profiles);
    let deletedCount = 0;
    let freedBytes = 0;

    for (const item of scan.items) {
        try {
            if (fs.existsSync(item.path)) {
                fs.unlinkSync(item.path);
                deletedCount++;
                freedBytes += item.size;
            }
        } catch (e) {
            console.warn(`[CLEANER] Nelze smazat soubor ${item.path}:`, e.message);
        }
    }

    // Clean up empty directories in temp/ and cache/
    const cleanupDirs = [
        path.join(baseDir, 'temp'),
        path.join(baseDir, 'natives'),
        path.join(baseDir, 'cache')
    ];

    for (const d of cleanupDirs) {
        try {
            if (fs.existsSync(d)) {
                const contents = fs.readdirSync(d);
                if (contents.length === 0) {
                    fs.rmdirSync(d);
                }
            }
        } catch (e) {}
    }

    return {
        success: true,
        deletedCount,
        freedBytes,
        formattedSize: formatBytes(freedBytes),
        message: deletedCount > 0
            ? `Úspěšně vyčištěno ${deletedCount} souborů (${formatBytes(freedBytes)} uvolněno).`
            : 'Všechna data jsou již čistá, nebyly nalezeny žádné staré logy ani dočasná data.'
    };
}

module.exports = {
    scanLauncherCache,
    cleanLauncherCache,
    formatBytes
};
