const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Native Rust Module Loader for MYCHAL SMP Launcher
 * Provides zero-cost abstraction with automatic high-speed Rust bridge
 * and transparent JavaScript fallback if native binary is unavailable.
 */

let nativeModule = null;
let isLoaded = false;

// Candidate locations for the compiled native module (.node)
const candidatePaths = [
    path.join(__dirname, 'mychalsmp_native.node'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'mychalsmp_native.node'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'main', 'mychalsmp_native.node'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'mychalsmp_native.node'),
    path.join(__dirname, '..', '..', 'native', 'mychalsmp_native.node'),
    path.join(__dirname, '..', '..', 'native', 'target', 'release', 'mychalsmp_native.node')
];

for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
        try {
            nativeModule = require(p);
            isLoaded = true;
            console.log(`[RUST NATIVE] Úspěšně načten nativní modul z: ${p}`);
            break;
        } catch (err) {
            console.warn(`[RUST NATIVE] Nepodařilo se načíst z ${p}:`, err.message);
        }
    }
}

if (!isLoaded) {
    console.log('[RUST NATIVE] Nativní Rust modul není přítomen, aktivuji standardní JS fallback.');
}

// ── Native / Fallback API ───────────────────────────────────────────────────

function isNativeActive() {
    if (isLoaded && nativeModule && typeof nativeModule.isNativeActive === 'function') {
        try {
            return nativeModule.isNativeActive();
        } catch (_) {
            return false;
        }
    }
    return false;
}

/**
 * Fast parallel verification of mods directory
 * Returns parsed ModScanResult object: { total_mods, clean_mods, prohibited_mods, mods, scan_time_ms }
 */
function fastVerifyModsDir(modsDir) {
    if (isLoaded && nativeModule && typeof nativeModule.fastVerifyModsDir === 'function') {
        try {
            const rawJson = nativeModule.fastVerifyModsDir(modsDir);
            return JSON.parse(rawJson);
        } catch (err) {
            console.warn('[RUST NATIVE] fastVerifyModsDir selhalo, použiji JS fallback:', err);
        }
    }

    // JS Fallback
    const start = Date.now();
    const result = {
        total_mods: 0,
        clean_mods: 0,
        prohibited_mods: 0,
        mods: [],
        scan_time_ms: 0
    };

    if (!fs.existsSync(modsDir)) {
        return result;
    }

    const PROHIBITED_KEYWORDS = [
        ['baritone', 'Baritone / Bot Pathing'],
        ['xray', 'X-Ray modifikace'],
        ['x-ray', 'X-Ray modifikace'],
        ['x_ray', 'X-Ray modifikace'],
        ['orefinder', 'Ore finder cheat'],
        ['freecam', 'Freecam modifikace'],
        ['seedcracker', 'Seed cracker exploit'],
        ['autoclicker', 'Auto clicker'],
        ['chestesp', 'Chest ESP'],
        ['crystalaura', 'Crystal Aura combat cheat'],
        ['meteor', 'Meteor Hack Client'],
        ['wurst', 'Wurst Hack Client'],
        ['liquidbounce', 'LiquidBounce Hack Client'],
        ['rusherhack', 'Rusherhack Client'],
        ['vape', 'Vape Client']
    ];

    try {
        const files = fs.readdirSync(modsDir);
        for (const file of files) {
            if (file.toLowerCase().endsWith('.jar')) {
                result.total_mods++;
                const fullPath = path.join(modsDir, file);
                const stat = fs.statSync(fullPath);
                
                // SHA-256 hash
                let sha256 = 'unknown';
                try {
                    const buf = fs.readFileSync(fullPath);
                    sha256 = crypto.createHash('sha256').update(buf).digest('hex');
                } catch (_) {}

                const lowerName = file.toLowerCase();
                let isProhibited = false;
                let reason = null;

                for (const [kw, desc] of PROHIBITED_KEYWORDS) {
                    if (lowerName.includes(kw)) {
                        isProhibited = true;
                        reason = desc;
                        break;
                    }
                }

                if (isProhibited) {
                    result.prohibited_mods++;
                } else {
                    result.clean_mods++;
                }

                result.mods.push({
                    file_name: file,
                    relative_path: file,
                    size_bytes: stat.size,
                    sha256,
                    is_prohibited: isProhibited,
                    detection_reason: reason
                });
            }
        }
    } catch (e) {
        console.error('[JS FALLBACK] Chyba skenování složky módů:', e);
    }

    result.scan_time_ms = Date.now() - start;
    return result;
}

/**
 * High-speed SHA-1 file hash
 */
function fastHashFileSha1(filePath) {
    if (isLoaded && nativeModule && typeof nativeModule.fastHashFileSha1 === 'function') {
        try {
            return nativeModule.fastHashFileSha1(filePath);
        } catch (_) {}
    }

    // JS Fallback
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(buf).digest('hex');
}

/**
 * High-speed SHA-256 file hash
 */
function fastHashFileSha256(filePath) {
    if (isLoaded && nativeModule && typeof nativeModule.fastHashFileSha256 === 'function') {
        try {
            return nativeModule.fastHashFileSha256(filePath);
        } catch (_) {}
    }

    // JS Fallback
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Fast log crash analyzer
 */
function fastScanLogForCrashes(logPath) {
    if (isLoaded && nativeModule && typeof nativeModule.fastScanLogForCrashes === 'function') {
        try {
            const raw = nativeModule.fastScanLogForCrashes(logPath);
            return JSON.parse(raw);
        } catch (_) {}
    }

    // JS Fallback
    if (!fs.existsSync(logPath)) {
        return { has_crash: false, crash_type: null, summary_line: null, suspected_cause: null };
    }

    try {
        const text = fs.readFileSync(logPath, 'utf-8');
        if (text.includes('java.lang.OutOfMemoryError')) {
            return {
                has_crash: true,
                crash_type: 'OUT_OF_MEMORY',
                summary_line: 'java.lang.OutOfMemoryError',
                suspected_cause: 'Nedostatek alokované RAM pro Minecraft'
            };
        }
        if (text.includes('Minecraft has crashed!') || text.includes('---- Minecraft Crash Report ----')) {
            return {
                has_crash: true,
                crash_type: 'GAME_CRASH',
                summary_line: 'Minecraft Crash Report',
                suspected_cause: 'Kritický pád herního jádra Minecraftu'
            };
        }
        if (text.includes('# A fatal error has been detected by the Java Runtime Environment')) {
            return {
                has_crash: true,
                crash_type: 'JVM_FATAL_ERROR',
                summary_line: 'Fatal error in Java Runtime',
                suspected_cause: 'Pád JVM / grafického ovladače'
            };
        }
    } catch (_) {}

    return { has_crash: false, crash_type: null, summary_line: null, suspected_cause: null };
}

/**
 * High-speed native file downloader (Rust streaming directly to disk with SHA-256 calculation)
 */
/**
 * High-speed, non-blocking file downloader with automatic retry and timeout
 */
async function fastDownloadFile(url, destPath, maxRetries = 3) {
    const start = Date.now();
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
        try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) {}
    }

    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            try { controller.abort(new Error('ETIMEDOUT')); } catch (_) {}
        }, 25000);

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 mychalsmp-launcher'
                }
            });
            clearTimeout(timeout);

            if (!res.ok) {
                // If 404, no point in retrying
                if (res.status === 404) {
                    throw new Error(`HTTP 404 Not Found: ${url}`);
                }
                throw new Error(`HTTP ${res.status}: ${url}`);
            }

            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length === 0) {
                throw new Error(`Prázdná odpověď (0 bajtů): ${url}`);
            }

            const tempPath = `${destPath}.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            fs.writeFileSync(tempPath, buffer);
            try {
                fs.renameSync(tempPath, destPath);
            } catch (_) {
                fs.copyFileSync(tempPath, destPath);
                try { fs.unlinkSync(tempPath); } catch (_) {}
            }

            const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            return {
                success: true,
                bytes_downloaded: buffer.length,
                elapsed_ms: Date.now() - start,
                sha256,
                error: null
            };
        } catch (err) {
            clearTimeout(timeout);
            lastError = err;
            if (err.message && err.message.includes('404')) {
                break;
            }
            if (attempt < maxRetries) {
                // Exponential backoff with jitter
                const delay = (attempt * 400) + Math.floor(Math.random() * 200);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    throw lastError || new Error(`Stahování selhalo po ${maxRetries} pokusech: ${url}`);
}

/**
 * Parallel batch downloader for mods/assets with concurrency limit and retry
 * Completely non-blocking on Node.js event loop to prevent UI freezing
 * @param {Array<{ url: string, dest_path: string }>} items
 * @param {number} concurrency
 */
async function fastDownloadBatch(items, concurrency = 12) {
    const start = Date.now();
    if (!Array.isArray(items) || items.length === 0) {
        return {
            total: 0,
            successful: 0,
            failed: 0,
            elapsed_ms: 0,
            total_bytes_downloaded: 0,
            items: []
        };
    }

    const results = new Array(items.length);
    let totalBytes = 0;
    let successful = 0;
    let failed = 0;

    let cursor = 0;
    const workerCount = Math.min(concurrency, items.length);

    async function worker() {
        while (cursor < items.length) {
            const idx = cursor++;
            const item = items[idx];
            try {
                const single = await fastDownloadFile(item.url, item.dest_path);
                results[idx] = {
                    url: item.url,
                    dest_path: item.dest_path,
                    success: true,
                    bytes_downloaded: single.bytes_downloaded,
                    error: null
                };
                totalBytes += single.bytes_downloaded;
                successful++;
            } catch (err) {
                results[idx] = {
                    url: item.url,
                    dest_path: item.dest_path,
                    success: false,
                    bytes_downloaded: 0,
                    error: err.message
                };
                failed++;
            }
        }
    }

    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return {
        total: items.length,
        successful,
        failed,
        elapsed_ms: Date.now() - start,
        total_bytes_downloaded: totalBytes,
        items: results
    };
}

/**
 * Creates binary diff patch between two files (e.g. old app.asar and new app.asar)
 */
function createBinaryPatch(oldPath, newPath, patchOutputPath) {
    if (isLoaded && nativeModule && typeof nativeModule.createBinaryPatch === 'function') {
        const raw = nativeModule.createBinaryPatch(oldPath, newPath, patchOutputPath);
        return JSON.parse(raw);
    }
    throw new Error('Nativní Rust modul není dostupný pro generování binárního patche');
}

/**
 * Applies binary diff patch to reconstruct target file
 */
function applyBinaryPatch(oldPath, patchPath, targetOutputPath) {
    if (isLoaded && nativeModule && typeof nativeModule.applyBinaryPatch === 'function') {
        const raw = nativeModule.applyBinaryPatch(oldPath, patchPath, targetOutputPath);
        return JSON.parse(raw);
    }
    throw new Error('Nativní Rust modul není dostupný pro aplikaci binárního patche');
}

/**
 * OS-level memory trimmer (glibc malloc_trim on Linux, Win32 EmptyWorkingSet on Windows)
 */
function fastTrimMemory(pid = null) {
    if (isLoaded && nativeModule && typeof nativeModule.fastTrimMemory === 'function') {
        try {
            return nativeModule.fastTrimMemory(pid || null);
        } catch (_) {}
    }

    if (process.platform === 'win32' && typeof process.trimWorkingSet === 'function') {
        try {
            process.trimWorkingSet();
            return true;
        } catch (_) {}
    }
    return false;
}

/**
 * High-speed Minecraft game log line parser (sub-microsecond)
 */
function fastParseGameLogLine(line) {
    if (isLoaded && nativeModule && typeof nativeModule.fastParseGameLogLine === 'function') {
        try {
            const raw = nativeModule.fastParseGameLogLine(line);
            return JSON.parse(raw);
        } catch (_) {}
    }

    // JS Fallback
    const lower = (line || '').toLowerCase();
    if (lower.includes('voicechat') || lower.includes('plasmovoice') || lower.includes('simple voice') || lower.includes('audioplayer') || lower.includes('essential') || lower.includes('telemetry') || lower.includes('ice:') || lower.includes('stun:') || lower.includes('turn:')) {
        return { event_type: 'ignored_auxiliary', host: null, port: null };
    }
    if (lower.includes('connecting to ')) {
        const m = line.match(/Connecting to\s+(?:server\s+)?\[?([a-zA-Z0-9_.-]+)\]?(?:(?:,\s*|\:)(\d+))?/i);
        if (m && m[1]) {
            return {
                event_type: 'connecting',
                host: m[1].trim(),
                port: m[2] ? parseInt(m[2], 10) : 25565
            };
        }
    }
    if (lower.includes('starting integrated minecraft server') || lower.includes('[integrated server/info]') || lower.includes('preparing start region for dimension')) {
        return { event_type: 'singleplayer', host: null, port: null };
    }
    if (lower.includes('stopping integrated server') || lower.includes('lost connection to server') || lower.includes('client disconnected with reason') || lower.includes('disconnected from server')) {
        return { event_type: 'menu', host: null, port: null };
    }
    return { event_type: 'none', host: null, port: null };
}

/**
 * Parallel cache scanner for cleaner
 */
function fastScanCleanerCache(directories, maxAgeDays = 30) {
    if (isLoaded && nativeModule && typeof nativeModule.fastScanCleanerCache === 'function') {
        try {
            const raw = nativeModule.fastScanCleanerCache(directories, maxAgeDays);
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[RUST NATIVE] fastScanCleanerCache selhalo, fallback na JS:', e.message);
        }
    }
    return null;
}

/**
 * High-speed archive / modpack / jar extraction in Rust
 */
function fastExtractArchive(archivePath, destDir) {
    if (isLoaded && nativeModule && typeof nativeModule.fastExtractArchive === 'function') {
        const raw = nativeModule.fastExtractArchive(archivePath, destDir);
        return JSON.parse(raw);
    }
    throw new Error('Nativní Rust modul není dostupný pro extrakci archivu');
}

/**
 * Parallel batch file integrity check (SHA-1) in Rust across all CPU cores
 */
function fastVerifyFileHashesBatch(items) {
    if (isLoaded && nativeModule && typeof nativeModule.fastVerifyFileHashesBatch === 'function') {
        try {
            const raw = nativeModule.fastVerifyFileHashesBatch(JSON.stringify(items));
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[RUST NATIVE] fastVerifyFileHashesBatch selhalo, fallback na JS:', e.message);
        }
    }

    // JS Fallback
    const start = Date.now();
    let valid = 0;
    let corrupted = 0;
    let missing = 0;
    const invalid_files = [];

    for (const item of items) {
        if (!fs.existsSync(item.path)) {
            missing++;
            invalid_files.push(item.path);
            continue;
        }
        if (item.expected_size !== undefined && item.expected_size !== null) {
            try {
                const s = fs.statSync(item.path);
                if (s.size !== item.expected_size) {
                    corrupted++;
                    invalid_files.push(item.path);
                    continue;
                }
            } catch (_) {}
        }
        try {
            const buf = fs.readFileSync(item.path);
            const actual = crypto.createHash('sha1').update(buf).digest('hex');
            if (actual.toLowerCase() === item.expected_sha1.toLowerCase()) {
                valid++;
            } else {
                corrupted++;
                invalid_files.push(item.path);
            }
        } catch (_) {
            corrupted++;
            invalid_files.push(item.path);
        }
    }

    return {
        total: items.length,
        valid,
        corrupted,
        missing,
        elapsed_ms: Date.now() - start,
        invalid_files
    };
}

/**
 * Zero-CPU asynchronous process exit waiter using OS kernel primitives
 * (Linux pidfd_open / Windows WaitForSingleObject)
 */
function fastWaitForProcessExit(pid, timeoutMs = 0) {
    if (isLoaded && nativeModule && typeof nativeModule.fastWaitForProcessExit === 'function') {
        try {
            return nativeModule.fastWaitForProcessExit(pid, timeoutMs || 0);
        } catch (e) {
            console.warn('[RUST NATIVE] fastWaitForProcessExit selhalo, fallback na polling:', e.message);
        }
    }

    // JS Fallback: 1-second polling loop
    return new Promise((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
            let alive = false;
            try {
                process.kill(pid, 0);
                alive = true;
            } catch (err) {
                alive = err.code === 'EPERM';
            }

            if (!alive) {
                clearInterval(interval);
                resolve(0);
                return;
            }

            if (timeoutMs > 0 && Date.now() - start >= timeoutMs) {
                clearInterval(interval);
                resolve(0);
            }
        }, 1000);
    });
}

/**
 * Parallel batch file deletion across all CPU cores in Rust
 * @param {string[]} filePaths
 * @returns {{ deleted_count: number, freed_bytes: number, elapsed_ms: number }}
 */
function fastDeleteFilesBatch(filePaths) {
    if (isLoaded && nativeModule && typeof nativeModule.fastDeleteFilesBatch === 'function') {
        try {
            const raw = nativeModule.fastDeleteFilesBatch(JSON.stringify(filePaths));
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[RUST NATIVE] fastDeleteFilesBatch selhalo, fallback na JS:', e.message);
        }
    }

    // JS Fallback
    const start = Date.now();
    let deleted_count = 0;
    let freed_bytes = 0;
    for (const p of filePaths) {
        try {
            if (fs.existsSync(p)) {
                const s = fs.statSync(p);
                fs.unlinkSync(p);
                deleted_count++;
                freed_bytes += s.size;
            }
        } catch (_) {}
    }
    return {
        deleted_count,
        freed_bytes,
        elapsed_ms: Date.now() - start
    };
}

/**
 * High-speed atomic options.txt guiScale modifier in Rust
 */
function fastEnsureGuiScale(gameDir, scale = 2) {
    if (isLoaded && nativeModule && typeof nativeModule.fastEnsureGuiScale === 'function') {
        try {
            return nativeModule.fastEnsureGuiScale(gameDir, scale);
        } catch (_) {}
    }

    // JS Fallback
    try {
        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
        const optionsPath = path.join(gameDir, 'options.txt');
        let content = fs.existsSync(optionsPath) ? fs.readFileSync(optionsPath, 'utf8') : '';
        const scaleRegex = /^guiScale:\s*\d+/m;
        if (content.match(scaleRegex)) {
            content = content.replace(scaleRegex, `guiScale:${scale}`);
        } else {
            content = (content ? content.trimEnd() + '\n' : '') + `guiScale:${scale}\n`;
        }
        fs.writeFileSync(optionsPath, content, 'utf8');
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * High-speed uncompressed NBT servers.dat builder written natively in Rust
 */
function fastBuildServersDat(serversList, destPath) {
    if (isLoaded && nativeModule && typeof nativeModule.fastBuildServersDat === 'function') {
        try {
            return nativeModule.fastBuildServersDat(JSON.stringify(serversList), destPath);
        } catch (e) {
            console.warn('[RUST NATIVE] fastBuildServersDat selhalo, fallback na JS:', e.message);
        }
    }
    return false;
}

/**
 * High-speed reader for fabric.mod.json inside mod jar files using Rust ZipArchive
 */
function fastReadFabricModMeta(jarPath) {
    if (isLoaded && nativeModule && typeof nativeModule.fastReadFabricModMeta === 'function') {
        try {
            const raw = nativeModule.fastReadFabricModMeta(jarPath);
            return JSON.parse(raw);
        } catch (_) {}
    }
    return null;
}

/**
 * Native Rayon classpath builder across all CPU cores
 */
function fastBuildClasspath(baseDir, relPaths, clientJar) {
    if (isLoaded && nativeModule && typeof nativeModule.fastBuildClasspath === 'function') {
        try {
            return nativeModule.fastBuildClasspath(baseDir, relPaths, clientJar);
        } catch (_) {}
    }

    const sep = process.platform === 'win32' ? ';' : ':';
    const valid = [];
    for (const rel of relPaths) {
        const full = path.join(baseDir, 'libraries', rel);
        if (fs.existsSync(full)) {
            valid.push(full);
        }
    }
    if (clientJar && fs.existsSync(clientJar)) {
        valid.push(clientJar);
    }
    return valid.join(sep);
}

module.exports = {
    isNativeActive,
    fastVerifyModsDir,
    fastHashFileSha1,
    fastHashFileSha256,
    fastScanLogForCrashes,
    fastDownloadFile,
    fastDownloadBatch,
    createBinaryPatch,
    applyBinaryPatch,
    fastTrimMemory,
    fastParseGameLogLine,
    fastScanCleanerCache,
    fastExtractArchive,
    fastVerifyFileHashesBatch,
    fastWaitForProcessExit,
    fastDeleteFilesBatch,
    fastEnsureGuiScale,
    fastBuildServersDat,
    fastReadFabricModMeta,
    fastBuildClasspath
};

