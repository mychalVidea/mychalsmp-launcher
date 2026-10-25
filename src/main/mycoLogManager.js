/**
 * MYCO Log Manager – Human & AI-Readable, Sanitized .myco Log System
 * 
 * Specifikace formátu .myco:
 * 1. Sanitace citlivých údajů:
 *    - Automatické maskování hesel v příkazech (/login, /register, /l, /reg, /changepassword, /auth)
 *    - Maskování serverových chat řádků s přihlašováním
 *    - Maskování auth tokenů (Bearer, JWT, Minecraft refresh tokeny, enc:v2: secrets)
 * 2. Formát textu:
 *    - Čisté UTF-8 kódování, které lze bez jakýchkoliv pluginů otevřít v Poznámkovém bloku (Notepad)
 *    - Přenositelný formát pro nahrání do webové AI (ChatGPT, Claude, Gemini), která z něj okamžitě vyčte chybu
 *    - Standardní strukturovaná záhlaví s verzí, profilem a časovým razítkem
 * 3. Zpětná kompatibilita:
 *    - Automatické rozpoznání a dekomprese dřívějších binárních Brotli/Gzip .myco archivů
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
let shell = null;
try {
    const electron = require('electron');
    if (electron && typeof electron === 'object' && electron.shell) {
        shell = electron.shell;
    }
} catch (_) {}
const { BASE_DIR, loadConfig } = require('./config');

const MAGIC_HEADER = Buffer.from('MYCO', 'utf8');
const FORMAT_VERSION = 2; // Zpětná kompatibilita pro binární Brotli

/**
 * Sanitace citlivých údajů z Minecraft a launcher logů
 * @param {string} text 
 * @returns {string}
 */
function sanitizeLog(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        // 1. Maskování hesel v příkazech (/login, /register, /l, /reg, /changepassword, /auth, /vlogin, /vregister)
        .replace(/(\/(?:login|register|reg|l|changepassword|cp|auth|vlogin|vregister)\s+)([^\s\r\n]+)/gi, '$1***')
        .replace(/(issued\s+server\s+command:\s*\/(?:login|register|reg|l|changepassword|cp|auth|vlogin|vregister)\s+)([^\s\r\n]+)/gi, '$1***')
        .replace(/(\[[^\]]*\]\s*:\s*\/(?:login|register|reg|l|changepassword|cp|auth)\s+)([^\s\r\n]+)/gi, '$1***')
        // 2. Auth tokeny a Bearer hlavičky
        .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{20,}/gi, '$1***')
        .replace(/(["']?(?:access_token|refreshToken|refresh_token|xsts_token|client_secret|userHash|authToken|mcToken|password|secret)["']?\s*[:=]\s*["']?)[^"'\s\r\n,]{6,}(["']?)/gi, '$1***$2')
        // 3. Citlivé systémové šifrované řetězce
        .replace(/(enc:v2:(?:dpapi:)?[a-zA-Z0-9+/=]{16,})/gi, 'enc:v2:***');
}

/**
 * Inteligentní redukce, deduplikace a čištění Minecraft a launcher logů pro formát .mog
 * 
 * Co dělá:
 * 1. Sanitace hesel, tokenů a citlivých údajů
 * 2. Odstranění terminálových ANSI únikových sekvencí (\x1B[...)
 * 3. Skládání po sobě jdoucích identických zpráv (i přes různé timestampy):
 *    Např. 500x OpenGL error -> první řádek + "    ↳ [... stejná zpráva se opakovala 499× ...]"
 * 4. Sloučení vícenásobných prázdných řádků
 * 5. Statistika úspory řádků pro záhlaví archivu
 * 
 * @param {string} rawText 
 * @param {Object} [meta]
 * @returns {{ text: string, originalLines: number, optimizedLines: number, savedLines: number }}
 */
function optimizeLogContent(rawText, meta = {}) {
    if (!rawText || typeof rawText !== 'string') {
        return { text: '', originalLines: 0, optimizedLines: 0, savedLines: 0 };
    }

    // 1. Sanitace hesel a tokenů
    const sanitized = sanitizeLog(rawText);

    // 2. Odstranění terminálových ANSI escape sekvencí
    const cleanAnsi = sanitized.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    const lines = cleanAnsi.split(/\r?\n/);
    const originalLines = lines.length;

    const result = [];
    let prevPattern = null;
    let prevFullLine = null;
    let repeatCount = 0;
    let totalDeduplicated = 0;

    // Extrakce sémantického těla zprávy bez timestampu:
    // Podporuje "[HH:MM:SS] [thread/LEVEL]: ...", "[GAME] ...", "YYYY-MM-DD ..."
    function extractPattern(line) {
        return line
            .replace(/^\[GAME\]\s*/, '')
            .replace(/^\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\]\s*/, '')
            .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, '')
            .trim();
    }

    function flushRepeats() {
        if (repeatCount > 0) {
            if (repeatCount === 1) {
                result.push(prevFullLine);
            } else {
                result.push(`    ↳ [... stejná zpráva se opakovala ${repeatCount}× ...]`);
                totalDeduplicated += (repeatCount - 1);
            }
            repeatCount = 0;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Ošetření vícenásobných prázdných řádků
        if (!trimmed) {
            if (result.length > 0 && result[result.length - 1] !== '') {
                flushRepeats();
                result.push('');
            }
            continue;
        }

        const pattern = extractPattern(line);

        // Pokud je zpráva neprázdná a shoduje se s předchozím vzorem
        const isRepeated = (prevPattern !== null && pattern.length > 5 && pattern === prevPattern);

        if (isRepeated) {
            repeatCount++;
        } else {
            flushRepeats();
            result.push(line);
            prevPattern = pattern;
            prevFullLine = line;
        }
    }

    flushRepeats();

    const finalBody = result.join('\n');
    const optimizedLines = result.length;
    const savedLines = Math.max(0, originalLines - optimizedLines);

    return {
        text: finalBody,
        originalLines,
        optimizedLines,
        savedLines
    };
}

/**
 * Vygeneruje přehlednou hlavičku pro .mog (Mychal Log) čitelnou pro lidi i webové AI
 * @param {Object} [meta]
 * @returns {string}
 */
function createMogHeader(meta = {}) {
    const now = new Date();
    const dateStr = now.toISOString().replace('T', ' ').slice(0, 19);
    const version = meta.version || '26.2';
    const profile = meta.profileName || 'Minecraft 26.2';

    const headerLines = [
        '================================================================================',
        '  MYCHAL SMP LOG ARCHIVE (.mog / Mychal Log)',
        `  Server: mychalsmp.xyz | Verze: ${version} | Profil: ${profile} | Vytvořeno: ${dateStr}`
    ];

    if (meta.savedLines && meta.savedLines > 0) {
        const percent = ((meta.savedLines / Math.max(1, meta.originalLines)) * 100).toFixed(0);
        headerLines.push(`  Optimalizace: ${meta.originalLines} řádků zredukováno na ${meta.optimizedLines} (odstraněno ${meta.savedLines} duplicitních řádků, úspora ~${percent} %)`);
    }

    headerLines.push(
        '  Ochrana soukromí: Hesla (/login, /register, /auth), tokeny a klíče byly zamazány.',
        '  Tento soubor (.mog) lze přímo otevřít v Poznámkovém bloku nebo nahrát do webové AI.',
        '================================================================================',
        '',
        ''
    );

    return headerLines.join('\n');
}

function createMycoHeader(meta = {}) {
    return createMogHeader(meta);
}

/**
 * Převede a naformátuje textový log do .mog standardu (Mychal Log – čistý UTF-8 text se sanitací hesel a AI hlavičkou)
 * Plně kompatibilní s Poznámkovým blokem, ChatGPT, Claude i Gemini bez nutnosti speciálních dekompresorů.
 * @param {string} rawText 
 * @param {Object} [meta] 
 * @returns {Buffer}
 */
function formatMogLog(rawText, meta = {}) {
    if (!rawText) return Buffer.alloc(0);

    // Pokud text již hlavičku obsahuje, nepřidáváme ji znovu
    if (rawText.includes('MYCHAL SMP LOG ARCHIVE')) {
        return Buffer.from(rawText, 'utf8');
    }

    const { text, originalLines, optimizedLines, savedLines } = optimizeLogContent(rawText, meta);
    const header = createMogHeader({
        ...meta,
        originalLines,
        optimizedLines,
        savedLines
    });

    return Buffer.from(header + text, 'utf8');
}

function compressToMyco(rawText, meta = {}) {
    return formatMogLog(rawText, meta);
}

/**
 * Dekomprimuje nebo přečte .myco kontejner zpět na čistý UTF-8 text
 * Zpětně plně kompatibilní se staršími binárními Brotli archivy i novým čistým UTF-8 standardem.
 * @param {Buffer|string} bufferOrPath 
 * @returns {string}
 */
function decompressFromMyco(bufferOrPath) {
    let buf = bufferOrPath;
    if (typeof bufferOrPath === 'string') {
        if (!fs.existsSync(bufferOrPath)) return '';
        buf = fs.readFileSync(bufferOrPath);
    }
    if (!buf || buf.length === 0) return '';

    // 1. Zpětná kompatibilita: starý binární formát v2 (Brotli s 16B hlavičkou)
    if (buf.length >= 16 && buf.subarray(0, 4).equals(MAGIC_HEADER)) {
        const ver = buf.readUInt8(4);
        if (ver === 2) {
            const payload = buf.subarray(16);
            try {
                const decompressed = zlib.brotliDecompressSync(payload);
                return decompressed.toString('utf8');
            } catch (err) {
                console.error('[MYCO LOG] Selhala dekomprese starého binárního payloadu v2:', err);
            }
        }
    }

    // 2. Fallback: přímý starší Brotli stream bez hlavičky
    try {
        const decompressed = zlib.brotliDecompressSync(buf);
        const text = decompressed.toString('utf8');
        if (text && text.length > 0) return text;
    } catch (_) {}

    // 3. Fallback: Gzip stream (např. starší log.gz)
    try {
        const decompressed = zlib.gunzipSync(buf);
        return decompressed.toString('utf8');
    } catch (_) {}

    // 4. Nativní UTF-8 text (nový standard pro .myco – Poznámkový blok, webové AI, editory)
    return buf.toString('utf8');
}

/**
 * Vyhledá všechny existující adresáře logů (výchozí BASE_DIR, profily, instance, vlastní gameDir)
 * @returns {string[]}
 */
function getAllCandidateLogsDirs() {
    const dirs = new Set();
    const baseLogs = path.join(BASE_DIR, 'logs');
    if (fs.existsSync(baseLogs)) dirs.add(baseLogs);

    for (const sub of ['profiles', 'instances']) {
        const parent = path.join(BASE_DIR, sub);
        if (fs.existsSync(parent)) {
            try {
                const entries = fs.readdirSync(parent);
                for (const entry of entries) {
                    const lDir = path.join(parent, entry, 'logs');
                    if (fs.existsSync(lDir)) dirs.add(lDir);
                }
            } catch (_) {}
        }
    }

    try {
        const cfg = loadConfig();
        if (Array.isArray(cfg.profiles)) {
            for (const p of cfg.profiles) {
                if (p.gameDir) {
                    const lDir = path.join(p.gameDir, 'logs');
                    if (fs.existsSync(lDir)) dirs.add(lDir);
                }
            }
        }
    } catch (_) {}

    return Array.from(dirs);
}

/**
 * Vyhledá složku s logy pro daný profil nebo výchozí BASE_DIR
 * @param {string} [instanceDir] 
 * @param {string} [profileId] 
 * @returns {string}
 */
function resolveLogsDir(instanceDir, profileId) {
    if (instanceDir) {
        const candidate = path.join(instanceDir, 'logs');
        if (fs.existsSync(candidate)) return candidate;
    }
    const pid = profileId || 'minecraft-26.2';
    const profileLogs = path.join(BASE_DIR, 'profiles', pid, 'logs');
    if (fs.existsSync(profileLogs)) return profileLogs;

    const baseLogs = path.join(BASE_DIR, 'logs');
    if (!fs.existsSync(baseLogs)) {
        try { fs.mkdirSync(baseLogs, { recursive: true }); } catch (_) {}
    }
    return baseLogs;
}

/**
/**
 * ⚡ Hromadný automatický převod všech existujících .log.gz, starých .log a .myco souborů do formátu .mog (Mychal Log)
 * Projde všechny složky logů, aplikuje sanitaci hesel a tokenů,
 * převede je do čistého čitelného UTF-8 textového formátu .mog a bezpečně odstraní původní nebezpečný .log.gz.
 * @returns {number} Počet úspěšně převedených archivů
 */
function convertAllPendingLogsToMyco() {
    let convertedCount = 0;
    try {
        const dirs = getAllCandidateLogsDirs();
        for (const logsDir of dirs) {
            let files = [];
            try {
                files = fs.readdirSync(logsDir);
            } catch (_) {
                continue;
            }

            for (const file of files) {
                const fullPath = path.join(logsDir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (!stat.isFile()) continue;

                    // 1. Staré Mojang logy komprimované v Gzipu (*.log.gz) -> *.mog
                    // Příklad: 2026-10-25-1.log.gz -> 2026-10-25-1.mog
                    if (file.endsWith('.log.gz')) {
                        const mogName = file.replace(/\.log\.gz$/, '.mog');
                        const mogPath = path.join(logsDir, mogName);

                        let rawText = '';
                        try {
                            const gzBuf = fs.readFileSync(fullPath);
                            rawText = zlib.gunzipSync(gzBuf).toString('utf8');
                        } catch (gzErr) {
                            try {
                                const rawBuf = fs.readFileSync(fullPath);
                                rawText = rawBuf.toString('utf8');
                            } catch (_) {
                                continue;
                            }
                        }

                        if (rawText && rawText.trim().length > 0) {
                            const mogBuf = formatMogLog(rawText);
                            fs.writeFileSync(mogPath, mogBuf);

                            if (fs.existsSync(mogPath) && fs.statSync(mogPath).size >= 16) {
                                try { fs.unlinkSync(fullPath); } catch (_) {}
                                convertedCount++;
                                console.log(`[MYCHAL LOG] Převeden archiv: ${file} -> ${mogName} (${stat.size} B -> ${mogBuf.length} B)`);
                            }
                        }
                        continue;
                    }

                    // 2. Staré nekomprimované .log soubory (kromě aktivního latest.log) -> *.mog
                    if (file.endsWith('.log') && file !== 'latest.log') {
                        const mogName = file.replace(/\.log$/, '.mog');
                        const mogPath = path.join(logsDir, mogName);

                        const rawText = fs.readFileSync(fullPath, 'utf8');
                        if (rawText && rawText.trim().length > 0) {
                            const mogBuf = formatMogLog(rawText);
                            fs.writeFileSync(mogPath, mogBuf);

                            if (fs.existsSync(mogPath) && fs.statSync(mogPath).size >= 16) {
                                try { fs.unlinkSync(fullPath); } catch (_) {}
                                convertedCount++;
                                console.log(`[MYCHAL LOG] Převeden textový log: ${file} -> ${mogName} (${stat.size} B -> ${mogBuf.length} B)`);
                            }
                        }
                        continue;
                    }

                    // 3. Migrace starých .myco souborů na čistý .mog (Mychal Log)
                    if (file.endsWith('.myco')) {
                        const mogName = file.replace(/\.myco$/, '.mog');
                        const mogPath = path.join(logsDir, mogName);
                        try {
                            const plain = decompressFromMyco(fullPath);
                            if (plain && plain.trim().length > 0) {
                                const mogBuf = formatMogLog(plain);
                                fs.writeFileSync(mogPath, mogBuf);
                                try { fs.unlinkSync(fullPath); } catch (_) {}
                                console.log(`[MYCHAL LOG] Převeden starší soubor: ${file} -> ${mogName}`);
                                convertedCount++;
                            }
                        } catch (_) {}
                        continue;
                    }

                    // 4. latest.log – synchronizace do latest.mog (a zrcadlení latest.myco)
                    if (file === 'latest.log') {
                        const mogPath = path.join(logsDir, 'latest.mog');
                        const mycoPath = path.join(logsDir, 'latest.myco');
                        let needsUpdate = true;
                        if (fs.existsSync(mogPath)) {
                            const mogStat = fs.statSync(mogPath);
                            if (mogStat.mtimeMs >= stat.mtimeMs) {
                                needsUpdate = false;
                            }
                        }

                        if (needsUpdate && stat.size > 0) {
                            try {
                                const rawContent = fs.readFileSync(fullPath, 'utf8');
                                if (rawContent && rawContent.trim().length > 0) {
                                    const mogBuffer = formatMogLog(rawContent);
                                    fs.writeFileSync(mogPath, mogBuffer);
                                    try { fs.writeFileSync(mycoPath, mogBuffer); } catch (_) {}

                                    // Okamžitá sanitace hesla na disku v latest.log
                                    const sanitizedPlain = sanitizeLog(rawContent);
                                    if (sanitizedPlain !== rawContent) {
                                        fs.writeFileSync(fullPath, sanitizedPlain, 'utf8');
                                    }
                                    console.log(`[MYCHAL LOG] Synchronizován latest.log -> latest.mog (${stat.size} B -> ${mogBuffer.length} B)`);
                                }
                            } catch (e) {
                                console.error(`[MYCHAL LOG] Chyba při synchronizaci latest.log:`, e);
                            }
                        }
                    }
                } catch (itemErr) {
                    console.error(`[MYCHAL LOG] Chyba při zpracování souboru ${file}:`, itemErr);
                }
            }
        }
    } catch (err) {
        console.error('[MYCHAL LOG] Chyba při hromadném převodu logů do .mog:', err);
    }
    return convertedCount;
}

/**
 * Zpracuje a převede ukončenou relaci do .mog (Mychal Log) kontejneru
 * Voláno při ukončení hry v sessionManageru.
 * @param {string} instanceDir 
 * @param {string} profileId 
 * @param {string} [fallbackText]
 */
function archiveSessionLogs(instanceDir, profileId, fallbackText) {
    try {
        // Nejprve převedeme všechny existující .log.gz a pending logy
        convertAllPendingLogsToMyco();

        const logsDir = resolveLogsDir(instanceDir, profileId);
        const latestLogPath = path.join(logsDir, 'latest.log');
        const latestMogPath = path.join(logsDir, 'latest.mog');
        const latestMycoPath = path.join(logsDir, 'latest.myco');

        let rawContent = '';
        if (fs.existsSync(latestLogPath)) {
            try {
                rawContent = fs.readFileSync(latestLogPath, 'utf8');
            } catch (_) {}
        }

        if ((!rawContent || !rawContent.trim()) && fallbackText && fallbackText.trim()) {
            rawContent = fallbackText;
        }

        if (!rawContent || !rawContent.trim()) {
            console.log(`[MYCHAL LOG] Žádný obsah k archivaci relace v ${logsDir}.`);
            return false;
        }

        // 1. Sanitace a převedení do čitelného .mog s AI hlavičkou
        const mogBuffer = formatMogLog(rawContent, { profileName: profileId });
        fs.writeFileSync(latestMogPath, mogBuffer);
        try { fs.writeFileSync(latestMycoPath, mogBuffer); } catch (_) {}

        // 2. Vytvoření časově označeného archivu relace (session-YYYY-MM-DD_HH-mm-ss.mog)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const sessionArchiveName = `session-${dateStr}.mog`;
        const sessionArchivePath = path.join(logsDir, sessionArchiveName);
        fs.writeFileSync(sessionArchivePath, mogBuffer);

        // 3. Sanitace původního latest.log na disku, aby nezůstala v plain textu hesla
        if (fs.existsSync(latestLogPath)) {
            const sanitizedPlain = sanitizeLog(rawContent);
            if (sanitizedPlain !== rawContent) {
                fs.writeFileSync(latestLogPath, sanitizedPlain, 'utf8');
            }
        }

        console.log(`[MYCHAL LOG] Relace úspěšně archivována do čitelného .mog textu (${sessionArchiveName}). Uloženo v: ${sessionArchivePath}`);
        return true;
    } catch (err) {
        console.error('[MYCHAL LOG] Chyba při archivaci relace do .mog:', err);
        return false;
    }
}

/**
 * Vrátí textový obsah nejnovějšího logu pro zobrazení v konzoli nebo kopírování
 * @param {string} [profileId] 
 * @returns {string}
 */
function getLatestLogContent(profileId) {
    try {
        const config = loadConfig();
        const activeProfileId = profileId || config.activeProfileId || 'minecraft-26.2';
        const candidateDirs = [
            path.join(BASE_DIR, 'profiles', activeProfileId, 'logs'),
            path.join(BASE_DIR, 'instances', activeProfileId, 'logs'),
            path.join(BASE_DIR, 'logs')
        ];

        for (const dir of candidateDirs) {
            const mogPath = path.join(dir, 'latest.mog');
            const mycoPath = path.join(dir, 'latest.myco');
            const logPath = path.join(dir, 'latest.log');

            if (fs.existsSync(mogPath)) {
                const text = decompressFromMyco(mogPath);
                if (text && text.trim().length > 0) return text;
            }
            if (fs.existsSync(mycoPath)) {
                const text = decompressFromMyco(mycoPath);
                if (text && text.trim().length > 0) return text;
            }
            if (fs.existsSync(logPath)) {
                const raw = fs.readFileSync(logPath, 'utf8');
                return sanitizeLog(raw);
            }
        }
    } catch (err) {
        console.error('[MYCHAL LOG] Chyba při čtení nejnovějšího logu:', err);
    }
    return '';
}

/**
 * Dekomprimuje konkrétní .mog nebo .myco soubor do dočasného .txt a otevře jej v systémovém editoru
 * @param {string} filePath 
 * @returns {Promise<boolean>}
 */
async function openMycoFileInEditor(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error(`Soubor neexistuje: ${filePath}`);
        }
        const text = decompressFromMyco(filePath);
        if (!text || !text.trim()) {
            throw new Error(`Soubor ${filePath} je prázdný nebo se nepodařilo jej přečíst.`);
        }

        const baseName = path.basename(filePath, path.extname(filePath));
        const tempPath = path.join(os.tmpdir(), `${baseName}-view.txt`);
        fs.writeFileSync(tempPath, text, 'utf8');

        console.log(`[MYCHAL LOG] Otevírám soubor ${filePath} v textovém editoru: ${tempPath}`);
        const result = await shell.openPath(tempPath);
        if (result) {
            console.warn(`[MYCHAL LOG] shell.openPath vrátil varování: ${result}`);
        }
        return true;
    } catch (err) {
        console.error('[MYCHAL LOG] Chyba při otevírání log souboru v editoru:', err);
        return false;
    }
}

/**
 * Dekomprimuje log a otevře jej ve výchozím textovém editoru operačního systému jako .txt
 * @param {string} [profileId] 
 * @returns {Promise<boolean>}
 */
async function openLogInEditor(profileId) {
    try {
        const content = getLatestLogContent(profileId);
        if (!content || !content.trim()) {
            throw new Error('Žádný log k zobrazení.');
        }

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const tempPath = path.join(os.tmpdir(), `mychalsmp-log-${dateStr}.txt`);
        fs.writeFileSync(tempPath, content, 'utf8');

        console.log(`[MYCHAL LOG] Otevírám log v editoru: ${tempPath}`);
        const result = await shell.openPath(tempPath);
        if (result) {
            console.warn(`[MYCHAL LOG] shell.openPath vrátil varování: ${result}`);
        }
        return true;
    } catch (err) {
        console.error('[MYCHAL LOG] Chyba při otevírání logu v editoru:', err);
        return false;
    }
}

module.exports = {
    sanitizeLog,
    optimizeLogContent,
    createMogHeader,
    createMycoHeader,
    formatMogLog,
    compressToMyco,
    decompressFromMyco,
    getAllCandidateLogsDirs,
    resolveLogsDir,
    convertAllPendingLogsToMyco,
    archiveSessionLogs,
    getLatestLogContent,
    openMycoFileInEditor,
    openLogInEditor
};
