const fs = require('fs');
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

        return {
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            latestVersion: latestTag,
            releaseName: release.name || release.tag_name,
            releaseUrl: release.html_url,
            releaseNotes: release.body || '',
            publishedAt: release.published_at,
            assets: (release.assets || []).map(a => ({
                name: a.name,
                downloadUrl: a.browser_download_url,
                size: a.size
            }))
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
 * Downloads and applies the update for Linux if installed in ~/.local/share/mychalsmp-launcher.
 * Podporuje streamování průběhu stahování a správné rozbalení vnořené složky tar.gz.
 */
async function applyUpdate(assetUrl, onProgress) {
    if (!assetUrl) {
        throw new Error('Chybí odkaz na aktualizační balíček.');
    }

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

        // 1. Streamované stahování s reportingem procent a megabajtů
        const res = await fetch(assetUrl, {
            headers: {
                'User-Agent': 'mychalsmp-launcher-updater'
            }
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
                        status: 'downloading'
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
                status: 'extracting'
            });
        }

        // 2. Rozbalení tar.gz do dočasné složky
        const tmpExtractDir = path.join(os.tmpdir(), `mychalsmp-extract-${Date.now()}`);
        fs.mkdirSync(tmpExtractDir, { recursive: true });

        const { execSync } = require('child_process');
        execSync(`tar -xzf "${tmpTar}" -C "${tmpExtractDir}"`);

        // 3. Detekce podsložky obsahující spustitelný soubor mychalsmp-launcher
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

        // 4. Přepsání souborů v cílové složce instalace
        fs.mkdirSync(installDir, { recursive: true });
        execSync(`cp -rf "${sourceDir}"/* "${installDir}"/`);

        const targetExe = path.join(installDir, 'mychalsmp-launcher');
        try { execSync(`chmod +x "${targetExe}"`); } catch (e) {}

        // 5. Aktualizace desktop ikony, pokud existuje
        try {
            const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
            const desktopFile = path.join(appsDir, 'mychalsmp-launcher.desktop');
            if (fs.existsSync(desktopFile)) {
                let content = fs.readFileSync(desktopFile, 'utf8');
                content = content.replace(/Exec="?[^"\n]+"?/g, `Exec="${targetExe}"`);
                fs.writeFileSync(desktopFile, content, 'utf8');
            }
        } catch (e) {}

        // 6. Úklid dočasných souborů
        try { fs.unlinkSync(tmpTar); } catch (e) {}
        try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (e) {}

        return {
            success: true,
            applied: true,
            targetExe: targetExe,
            message: 'Aktualizace byla úspěšně nainstalována.'
        };
    } else {
        // Otevření v prohlížeči pro jiné platformy
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
