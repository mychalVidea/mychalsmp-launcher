/**
 * MYCO Log Manager – Zero-Overhead, Ultra-Compressed, Unencrypted .myco Log System
 * 
 * Specifikace nezašifrovaného kontejneru .myco v2:
 * 1. Sanitace citlivých údajů:
 *    - Automatické maskování hesel v příkazech (/login, /register, /l, /reg, /changepassword, /auth)
 *    - Maskování serverových chat řádků s přihlašováním
 *    - Maskování auth tokenů (Bearer, JWT, Minecraft refresh tokeny, enc:v2: secrets)
 * 2. Hlavička kontejneru (16 bajtů):
 *    - [0..3]:   'MYCO' (4 bajty Magic)
 *    - [4]:      0x02   (1 bajt: Verze 2 = nezašifrovaný Brotli archiv)
 *    - [5]:      0x01   (1 bajt Flags: 0x01 = Minecraft Log stream)
 *    - [6..7]:   0x0000 (2 bajty rezervováno)
 *    - [8..11]:  Původní délka textu v bajtech (UInt32BE)
 *    - [12..15]: Časové razítko vytvoření v sekundách (UInt32BE)
 * 3. Tělo archivu:
 *    - Brotli komprese na maximální úroveň (Quality 11, LGWIN 24, Text mode)
 *    - Ušetří 90 až 98 % velikosti souboru oproti běžnému .log / .txt
 * 4. Transparentní otevírání:
 *    - Blesková dekomprese do dočasného souboru a otevření ve výchozím textovém editoru OS (Poznámkový blok apod.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { shell } = require('electron');
const { BASE_DIR, loadConfig } = require('./config');

const MAGIC_HEADER = Buffer.from('MYCO', 'utf8');
const FORMAT_VERSION = 2; // v2 = nezašifrovaný komprimovaný log

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
 * Zkomprimuje textový log do .myco binárního kontejneru (Brotli Quality 11, unencrypted)
 * @param {string} rawText 
 * @returns {Buffer}
 */
function compressToMyco(rawText) {
    const sanitized = sanitizeLog(rawText);
    const inputBuf = Buffer.from(sanitized, 'utf8');

    const header = Buffer.alloc(16);
    header.write('MYCO', 0, 4, 'utf8');
    header.writeUInt8(FORMAT_VERSION, 4);
    header.writeUInt8(1, 5); // Flags: log
    header.writeUInt16BE(0, 6);
    header.writeUInt32BE(inputBuf.length, 8);
    header.writeUInt32BE(Math.floor(Date.now() / 1000), 12);

    const compressed = zlib.brotliCompressSync(inputBuf, {
        params: {
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11, // Maximální komprese
            [zlib.constants.BROTLI_PARAM_LGWIN]: 24,   // 16 MB okno pro maximální kompresní poměr
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: inputBuf.length
        }
    });

    return Buffer.concat([header, compressed]);
}

/**
 * Dekomprimuje .myco kontejner zpět na čistý UTF-8 text
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

    // Ověření hlavičky MYCO v2
    if (buf.length >= 16 && buf.subarray(0, 4).equals(MAGIC_HEADER)) {
        const ver = buf.readUInt8(4);
        if (ver === 2) {
            const payload = buf.subarray(16);
            try {
                const decompressed = zlib.brotliDecompressSync(payload);
                return decompressed.toString('utf8');
            } catch (err) {
                console.error('[MYCO LOG] Selhala dekomprese payloadu v2:', err);
            }
        }
    }

    // Fallback: přímý Brotli stream
    try {
        const decompressed = zlib.brotliDecompressSync(buf);
        return decompressed.toString('utf8');
    } catch (_) {}

    // Fallback: Gzip stream (např. starší log.gz)
    try {
        const decompressed = zlib.gunzipSync(buf);
        return decompressed.toString('utf8');
    } catch (_) {}

    // Fallback: Plaintext
    return buf.toString('utf8');
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
 * Zpracuje a převede ukončenou relaci do .myco kontejneru
 * Voláno při ukončení hry v sessionManageru.
 * @param {string} instanceDir 
 * @param {string} profileId 
 */
function archiveSessionLogs(instanceDir, profileId) {
    try {
        const logsDir = resolveLogsDir(instanceDir, profileId);
        const latestLogPath = path.join(logsDir, 'latest.log');
        const latestMycoPath = path.join(logsDir, 'latest.myco');

        if (!fs.existsSync(latestLogPath)) {
            console.log(`[MYCO LOG] Soubor ${latestLogPath} nenalezen pro archivaci.`);
            return false;
        }

        const rawContent = fs.readFileSync(latestLogPath, 'utf8');
        if (!rawContent || !rawContent.trim()) {
            return false;
        }

        // 1. Sanitace a komprese do .myco s maximálním poměrem
        const mycoBuffer = compressToMyco(rawContent);
        fs.writeFileSync(latestMycoPath, mycoBuffer);

        // 2. Vytvoření časově označeného archivu relace (session-YYYY-MM-DD_HH-mm-ss.myco)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const sessionArchiveName = `session-${dateStr}.myco`;
        const sessionArchivePath = path.join(logsDir, sessionArchiveName);
        fs.writeFileSync(sessionArchivePath, mycoBuffer);

        // 3. Sanitace původního latest.log na disku, aby nezůstala v plain textu hesla
        const sanitizedPlain = sanitizeLog(rawContent);
        if (sanitizedPlain !== rawContent) {
            fs.writeFileSync(latestLogPath, sanitizedPlain, 'utf8');
        }

        const ratio = ((1 - (mycoBuffer.length / Math.max(1, rawContent.length))) * 100).toFixed(1);
        console.log(`[MYCO LOG] Relace úspěšně převedena do .myco: ${rawContent.length} B -> ${mycoBuffer.length} B (úspora ${ratio} %). Uloženo: ${latestMycoPath}`);
        return true;
    } catch (err) {
        console.error('[MYCO LOG] Chyba při archivaci relace do .myco:', err);
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
            const mycoPath = path.join(dir, 'latest.myco');
            if (fs.existsSync(mycoPath)) {
                const text = decompressFromMyco(mycoPath);
                if (text && text.trim().length > 0) return text;
            }

            const logPath = path.join(dir, 'latest.log');
            if (fs.existsSync(logPath)) {
                const raw = fs.readFileSync(logPath, 'utf8');
                return sanitizeLog(raw);
            }
        }
    } catch (err) {
        console.error('[MYCO LOG] Chyba při čtení nejnovějšího logu:', err);
    }
    return '';
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

        console.log(`[MYCO LOG] Otevírám dekomprimovaný log v editoru: ${tempPath}`);
        const result = await shell.openPath(tempPath);
        if (result) {
            console.warn(`[MYCO LOG] shell.openPath vrátil varování: ${result}`);
        }
        return true;
    } catch (err) {
        console.error('[MYCO LOG] Chyba při otevírání logu v editoru:', err);
        return false;
    }
}

module.exports = {
    sanitizeLog,
    compressToMyco,
    decompressFromMyco,
    resolveLogsDir,
    archiveSessionLogs,
    getLatestLogContent,
    openLogInEditor
};
