const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, shell } = require('electron');
const packageJson = require('../../package.json');

const GITHUB_REPO = 'mychalVidea/mychalsmp-launcher';
const CURRENT_VERSION = packageJson.version || '1.0.0';

/**
 * Checks for new releases from GitHub API.
 */
async function checkForUpdates() {
    try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: {
                'User-Agent': 'mychalsmp-launcher-updater',
                'Accept': 'application/vnd.github.v3+json'
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
 */
async function applyUpdate(assetUrl) {
    if (!assetUrl) {
        throw new Error('Chybí odkaz na aktualizační balíček.');
    }

    const installDir = path.join(os.homedir(), '.local', 'share', 'mychalsmp-launcher');
    const isInstalledLinux = process.platform === 'linux' && fs.existsSync(installDir);

    if (isInstalledLinux && assetUrl.endsWith('.tar.gz')) {
        const tmpTar = path.join(os.tmpdir(), `mychalsmp-update-${Date.now()}.tar.gz`);

        const res = await fetch(assetUrl);
        if (!res.ok) throw new Error(`Chyba stahování: HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(tmpTar, Buffer.from(buffer));

        // Unpack tar.gz into installDir
        const { execSync } = require('child_process');
        execSync(`tar -xzf "${tmpTar}" -C "${installDir}"`);
        fs.unlinkSync(tmpTar);

        return {
            success: true,
            applied: true,
            message: 'Aktualizace byla úspěšně nainstalována. Launcher se restartuje.'
        };
    } else {
        // Open browser to release page
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
