let fs;
try {
    fs = require('original-fs');
} catch (e) {
    fs = require('fs');
}
const path = require('path');
const os = require('os');
const { app, shell } = require('electron');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const packageJson = require('../../package.json');

const GITHUB_REPO = 'mychalVidea/mychalsmp-launcher';
const CURRENT_VERSION = packageJson.version || '1.0.0';

/**
 * Checks for new releases from GitHub API.
 */
async function checkForUpdates() {
    try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest?t=${Date.now()}`, {
            headers: {
                'User-Agent': 'mychalsmp-launcher-updater',
                'Accept': 'application/vnd.github.v3+json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });

        if (!res.ok) {
            if (res.status === 404) {
                return {
                    hasUpdate: false,
                    currentVersion: CURRENT_VERSION,
                    message: 'Žádné vydání nebylo na GitHubu nalezeno.'
                };
            }
            throw new Error(`GitHub API HTTP ${res.status}`);
        }

        const release = await res.json();
        const latestTag = (release.tag_name || '').replace(/^v/, '').trim();

        const hasUpdate = isNewerVersion(latestTag, CURRENT_VERSION);

        const assets = (release.assets || []).map(a => ({
            name: a.name,
            downloadUrl: a.browser_download_url,
            size: a.size
        }));

        // Detekce bleskového delta balíčku (update.asar nebo app.asar ~3 MB)
        const deltaAsset = assets.find(a => a.name === 'update.asar' || a.name === 'app.asar');
        const tarAsset = assets.find(a => a.name.endsWith('.tar.gz') && !a.name.includes('blockmap'));
        const winAsset = assets.find(a => a.name.endsWith('.exe') && !a.name.includes('blockmap'));

        let preferredAsset = null;
        let isDelta = false;

        // Pokud máme k dispozici lehký delta balíček, preferujeme ho pro okamžitou aktualizaci
        if (deltaAsset) {
            preferredAsset = deltaAsset;
            isDelta = true;
        } else if (process.platform === 'linux' && tarAsset) {
            preferredAsset = tarAsset;
        } else if (process.platform === 'win32' && winAsset) {
            preferredAsset = winAsset;
        } else if (assets.length > 0) {
            preferredAsset = assets[0];
        }

        return {
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            latestVersion: latestTag,
            releaseName: release.name || release.tag_name,
            releaseUrl: release.html_url,
            releaseNotes: release.body || '',
            publishedAt: release.published_at,
            isDelta,
            deltaName: deltaAsset ? deltaAsset.name : null,
            downloadUrl: preferredAsset ? preferredAsset.downloadUrl : null,
            downloadSize: preferredAsset ? preferredAsset.size : null,
            assets
        };
    } catch (e) {
        return {
            hasUpdate: false,
            currentVersion: CURRENT_VERSION,
            error: e.message
        };
    }
}

/**
 * Compares two semver strings (v1 > v2).
 */
function isNewerVersion(remote, local) {
    if (!remote || !local) return false;
    const rParts = remote.split('.').map(n => parseInt(n, 10) || 0);
    const lParts = local.split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
        const r = rParts[i] || 0;
        const l = lParts[i] || 0;
        if (r > l) return true;
        if (r < l) return false;
    }
    return false;
}

/**
 * Safely copies a file, avoiding Linux 'ETXTBSY: text file busy' on running binaries
 * by unlinking/renaming the destination first.
 */
function safeCopyFile(src, dst) {
    const prevNoAsar = process.noAsar;
    process.noAsar = true;
    try {
        if (fs.existsSync(dst)) {
            try {
                fs.unlinkSync(dst);
            } catch (e1) {
                try {
                    const oldPath = dst + '.old.' + Date.now();
                    fs.renameSync(dst, oldPath);
                    try { fs.unlinkSync(oldPath); } catch (_) {}
                } catch (e2) {}
            }
        }
        fs.copyFileSync(src, dst);
    } finally {
        process.noAsar = prevNoAsar;
    }
}

/**
 * Downloads and applies the update.
 * Podporuje:
 * 1. Bleskovou delta aktualizaci přes update.asar (~3 MB namísto ~90 MB).
 * 2. Inteligentní souborový diff sync pro plný archiv .tar.gz (přepisuje pouze reálně změněné soubory).
 */
async function applyUpdate(assetUrl, onProgress) {
    if (!assetUrl) {
        throw new Error('Chybí odkaz na aktualizační balíček.');
    }

    // ── 1. Blesková Delta Aktualizace (jen změněné soubory app.asar ~3 MB) ────
    if (assetUrl.endsWith('.asar')) {
        const prevNoAsar = process.noAsar;
        process.noAsar = true;
        try {
            let resourcesDir = null;
            const exeDir = path.dirname(process.execPath);
            const candidates = [
                process.resourcesPath,
                path.join(exeDir, 'resources'),
                path.join(os.homedir(), '.local', 'share', 'mychalsmp-launcher', 'resources')
            ];

            for (const cand of candidates) {
                if (cand && fs.existsSync(cand) && (fs.existsSync(path.join(cand, 'app.asar')) || fs.existsSync(path.join(path.dirname(cand), 'mychalsmp-launcher')) || fs.existsSync(path.join(path.dirname(cand), 'mychalsmp-launcher.exe')))) {
                    resourcesDir = cand;
                    break;
                }
            }

            if (!resourcesDir) {
                resourcesDir = process.resourcesPath || path.join(exeDir, 'resources');
                try { fs.mkdirSync(resourcesDir, { recursive: true }); } catch (e) {}
            }

            const targetAsar = path.join(resourcesDir, 'app.asar');
            // Použijeme .download příponu během streamu, aby Electron nezkoušel balíček parsovat
            const tmpAsar = path.join(os.tmpdir(), `mychalsmp-update-${Date.now()}.download`);

            const res = await fetch(assetUrl, {
                headers: { 'User-Agent': 'mychalsmp-launcher-updater' }
            });
            if (!res.ok) throw new Error(`Chyba stahování delta balíčku: HTTP ${res.status}`);

            const totalBytes = parseInt(res.headers.get('content-length')) || 0;
            let receivedBytes = 0;
            const fileStream = fs.createWriteStream(tmpAsar);
            const nodeStream = Readable.fromWeb(res.body);

            let lastReport = 0;
            nodeStream.on('data', (chunk) => {
                receivedBytes += chunk.length;
                const now = Date.now();
                if (now - lastReport > 40 || receivedBytes === totalBytes) {
                    lastReport = now;
                    const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
                    if (onProgress) {
                        onProgress({
                            current: receivedBytes,
                            total: totalBytes,
                            percent: Math.min(percent, 100),
                            status: 'downloading',
                            isDelta: true
                        });
                    }
                }
            });

            await pipeline(nodeStream, fileStream);

            if (onProgress) {
                onProgress({
                    current: totalBytes,
                    total: totalBytes,
                    percent: 100,
                    status: 'extracting',
                    isDelta: true
                });
            }

            // Záloha a atomické přepsání
            const backupAsar = path.join(resourcesDir, 'app.asar.bak');
            try {
                if (fs.existsSync(targetAsar)) {
                    fs.copyFileSync(targetAsar, backupAsar);
                }
            } catch (e) {}

            try {
                safeCopyFile(tmpAsar, targetAsar);
                try { fs.unlinkSync(tmpAsar); } catch (e) {}
            } catch (copyErr) {
                if (fs.existsSync(backupAsar)) {
                    try { safeCopyFile(backupAsar, targetAsar); } catch (e) {}
                }
                throw new Error(`Chyba při zápisu delta balíčku: ${copyErr.message}`);
            }

            const targetExe = process.execPath;
            return {
                success: true,
                applied: true,
                isDelta: true,
                targetExe: targetExe,
                message: 'Blesková delta aktualizace byla úspěšně nainstalována.'
            };
        } finally {
            process.noAsar = prevNoAsar;
        }
    }

    // ── 2. Plná instalace archivu .tar.gz (Linux) se souborovým diff-syncem ───
    const defaultInstallDir = path.join(os.homedir(), '.local', 'share', 'mychalsmp-launcher');
    let installDir = defaultInstallDir;

    if (process.platform === 'linux') {
        const exeDir = path.dirname(process.execPath);
        if (!exeDir.startsWith('/tmp') && (fs.existsSync(path.join(exeDir, 'mychalsmp-launcher')) || fs.existsSync(path.join(exeDir, 'resources')))) {
            installDir = exeDir;
        }
    }

    if (process.platform === 'linux' && assetUrl.endsWith('.tar.gz')) {
        const tmpTar = path.join(os.tmpdir(), `mychalsmp-update-${Date.now()}.tar.gz`);

        const res = await fetch(assetUrl, {
            headers: { 'User-Agent': 'mychalsmp-launcher-updater' }
        });
        if (!res.ok) throw new Error(`Chyba stahování: HTTP ${res.status}`);

        const totalBytes = parseInt(res.headers.get('content-length')) || 0;
        let receivedBytes = 0;

        const fileStream = fs.createWriteStream(tmpTar);
        const nodeStream = Readable.fromWeb(res.body);

        let lastReport = 0;
        nodeStream.on('data', (chunk) => {
            receivedBytes += chunk.length;
            const now = Date.now();
            if (now - lastReport > 60 || receivedBytes === totalBytes) {
                lastReport = now;
                const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
                if (onProgress) {
                    onProgress({
                        current: receivedBytes,
                        total: totalBytes,
                        percent: Math.min(percent, 100),
                        status: 'downloading',
                        isDelta: false
                    });
                }
            }
        });

        await pipeline(nodeStream, fileStream);

        if (onProgress) {
            onProgress({
                current: receivedBytes,
                total: totalBytes,
                percent: 100,
                status: 'extracting',
                isDelta: false,
                step: 'Rozbaluji aktualizační archiv...'
            });
        }

        const tmpExtractDir = path.join(os.tmpdir(), `mychalsmp-extract-${Date.now()}`);
        fs.mkdirSync(tmpExtractDir, { recursive: true });

        // Asynchronní rozbalení - nezamrzne hlavní proces ani okno
        const util = require('util');
        const { exec } = require('child_process');
        const execAsync = util.promisify(exec);
        await execAsync(`tar -xzf "${tmpTar}" -C "${tmpExtractDir}"`);

        function findBinaryDir(dir) {
            if (fs.existsSync(path.join(dir, 'mychalsmp-launcher'))) {
                return dir;
            }
            try {
                const subdirs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
                for (const sub of subdirs) {
                    const subPath = path.join(dir, sub.name);
                    if (fs.existsSync(path.join(subPath, 'mychalsmp-launcher'))) {
                        return subPath;
                    }
                }
            } catch (e) {}
            return dir;
        }

        const sourceDir = findBinaryDir(tmpExtractDir);

        if (onProgress) {
            onProgress({
                current: receivedBytes,
                total: totalBytes,
                percent: 100,
                status: 'installing',
                isDelta: false,
                step: 'Instaluji aktualizované soubory...'
            });
        }

        // Inteligentní souborový diff sync: přepisuje pouze novější nebo změněné soubory
        fs.mkdirSync(installDir, { recursive: true });

        async function syncDirDiffAsync(src, dst) {
            fs.mkdirSync(dst, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            let modified = 0;
            let skipped = 0;

            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const dstPath = path.join(dst, entry.name);

                if (entry.isDirectory()) {
                    const sub = await syncDirDiffAsync(srcPath, dstPath);
                    modified += sub.modified;
                    skipped += sub.skipped;
                } else if (entry.isFile()) {
                    let needsCopy = true;
                    if (fs.existsSync(dstPath)) {
                        try {
                            const srcStat = fs.statSync(srcPath);
                            const dstStat = fs.statSync(dstPath);
                            if (srcStat.size === dstStat.size) {
                                needsCopy = false;
                                skipped++;
                            }
                        } catch (e) {}
                    }
                    if (needsCopy) {
                        try {
                            safeCopyFile(srcPath, dstPath);
                            modified++;
                        } catch (copyErr) {
                            console.warn(`[UPDATER] Nelze přepsat ${dstPath}:`, copyErr.message);
                        }
                    }
                }
                // Dovolí Node.js event loop zpracovávat události (nulové zamrzání)
                await new Promise(r => setImmediate(r));
            }
            return { modified, skipped };
        }

        const syncStats = await syncDirDiffAsync(sourceDir, installDir);
        console.log(`[DIFF UPDATER] Synchronizováno ${syncStats.modified} změněných souborů, ${syncStats.skipped} nezměněných knihoven zachováno.`);

        const targetExe = path.join(installDir, 'mychalsmp-launcher');
        try { fs.chmodSync(targetExe, 0o755); } catch (e) {}

        try {
            const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
            const desktopFile = path.join(appsDir, 'mychalsmp-launcher.desktop');
            if (fs.existsSync(desktopFile)) {
                let content = fs.readFileSync(desktopFile, 'utf8');
                content = content.replace(/Exec="?[^"\n]+"?/g, `Exec="${targetExe}"`);
                fs.writeFileSync(desktopFile, content, 'utf8');
            }
        } catch (e) {}

        try { fs.unlinkSync(tmpTar); } catch (e) {}
        try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (e) {}

        return {
            success: true,
            applied: true,
            isDelta: false,
            targetExe: targetExe,
            message: 'Aktualizace byla úspěšně nainstalována.'
        };
    } else {
        shell.openExternal(assetUrl);
        return {
            success: true,
            applied: false,
            openedInBrowser: true,
            message: 'Odkaz na stažení byl otevřen v prohlížeči.'
        };
    }
}

module.exports = {
    checkForUpdates,
    applyUpdate,
    CURRENT_VERSION
};
