const { ipcMain, shell, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadConfig, saveConfig, BASE_DIR } = require('../config');
const { sanitizeAccountForRenderer } = require('../cryptoVault');
const { pingServer } = require('../serverPing');
const { getInstalledVersions, getAvailableJavas, detectJavaPath, isGameRunning } = require('../launcher');
const keybindManager = require('../keybindManager');
const { discordRpc } = require('../discordRpc');
const mycoLogManager = require('../mycoLogManager');

function registerAppIpc({ getMainWindow, setupTray }) {
    ipcMain.handle('get-config', () => {
        const config = loadConfig();
        return (config && config.microsoftAccount) ? {
            ...config,
            microsoftAccount: sanitizeAccountForRenderer(config.microsoftAccount)
        } : config;
    });

    ipcMain.handle('save-config', (event, newConfig) => {
        const saved = saveConfig(newConfig);
        try {
            if (saved && saved.enableDiscordRpc === false) {
                discordRpc.clearActivity();
            } else if (saved && !isGameRunning()) {
                const activeProfile = (saved.profiles || []).find(p => p.id === saved.activeProfileId);
                discordRpc.updateActivity({
                    username: saved.username || 'Hráč',
                    server: saved.serverIp || 'mychalsmp.xyz',
                    profileName: activeProfile ? activeProfile.name : 'Minecraft 26.2',
                    isPlaying: false
                });
            }

            if (saved && (saved.screenshotToClipboard !== undefined || saved.borderlessFullscreen !== undefined)) {
                try {
                    const cfgData = {
                        screenshotToClipboard: saved.screenshotToClipboard !== false,
                        borderlessFullscreen: saved.borderlessFullscreen === true
                    };
                    const cfgJson = JSON.stringify(cfgData, null, 2);
                    const baseCfgDir = path.join(BASE_DIR, 'config');
                    if (!fs.existsSync(baseCfgDir)) fs.mkdirSync(baseCfgDir, { recursive: true });
                    fs.writeFileSync(path.join(baseCfgDir, 'selfnametag.json'), cfgJson, 'utf-8');

                    for (const parent of [path.join(BASE_DIR, 'profiles'), path.join(BASE_DIR, 'instances')]) {
                        if (fs.existsSync(parent)) {
                            for (const sub of fs.readdirSync(parent)) {
                                const subDir = path.join(parent, sub);
                                if (fs.statSync(subDir).isDirectory()) {
                                    const scDir = path.join(subDir, 'config');
                                    if (!fs.existsSync(scDir)) fs.mkdirSync(scDir, { recursive: true });
                                    fs.writeFileSync(path.join(scDir, 'selfnametag.json'), cfgJson, 'utf-8');
                                }
                            }
                        }
                    }
                } catch (_) {}
            }
        } catch (e) { }
        return (saved && saved.microsoftAccount) ? {
            ...saved,
            microsoftAccount: sanitizeAccountForRenderer(saved.microsoftAccount)
        } : saved;
    });

    ipcMain.handle('ping-server', async (event, ip = 'mychalsmp.xyz', port = 25565) => {
        return await pingServer(ip, port);
    });

    ipcMain.handle('get-installed-versions', () => {
        return getInstalledVersions(BASE_DIR);
    });

    ipcMain.handle('get-available-javas', () => {
        return getAvailableJavas();
    });

    ipcMain.handle('detect-java', () => {
        return detectJavaPath();
    });

    ipcMain.handle('get-keybinds', async (event, profileId) => {
        return keybindManager.getKeybinds(profileId);
    });

    ipcMain.handle('save-keybinds', async (event, updatedBinds, profileId) => {
        return keybindManager.saveKeybinds(updatedBinds, profileId);
    });

    ipcMain.handle('reset-keybinds-default', async () => {
        return keybindManager.resetKeybindsToDefaults();
    });

    ipcMain.handle('get-available-keyarts', async () => {
        const keyarts = {};
        const validExts = ['.jpg', '.jpeg', '.png', '.webp'];

        const scanDir = (dirPath, prefix = '') => {
            try {
                if (!fs.existsSync(dirPath)) return;
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                for (const ent of entries) {
                    if (ent.isFile()) {
                        const ext = path.extname(ent.name).toLowerCase();
                        if (validExts.includes(ext)) {
                            const baseName = path.basename(ent.name, ext).toLowerCase().trim();
                            const relPath = prefix ? path.posix.join(prefix, ent.name) : ent.name;
                            keyarts[baseName] = relPath;
                        }
                    }
                }
            } catch (e) {
                console.warn('[KEYARTS] Nelze načíst složku:', dirPath, e.message);
            }
        };

        const bundledDir = path.join(__dirname, '../../renderer/assets/keyarts');
        scanDir(bundledDir, 'assets/keyarts');

        const userDir = path.join(BASE_DIR, 'keyarts');
        if (fs.existsSync(userDir)) {
            try {
                const userEntries = fs.readdirSync(userDir);
                for (const fname of userEntries) {
                    const ext = path.extname(fname).toLowerCase();
                    if (validExts.includes(ext)) {
                        const baseName = path.basename(fname, ext).toLowerCase().trim();
                        const fullP = path.join(userDir, fname);
                        keyarts[baseName] = `file://${fullP.replace(/\\/g, '/')}`;
                    }
                }
            } catch (_) {}
        }

        return keyarts;
    });

    ipcMain.handle('open-keyarts-folder', async () => {
        const bundledDir = path.join(__dirname, '../../renderer/assets/keyarts');
        if (!fs.existsSync(bundledDir)) {
            try { fs.mkdirSync(bundledDir, { recursive: true }); } catch (_) {}
        }
        return await shell.openPath(bundledDir);
    });

    ipcMain.handle('copy-to-clipboard', (event, text) => {
        try {
            clipboard.writeText(text || '');
            return true;
        } catch (_) {
            return false;
        }
    });

    ipcMain.handle('get-latest-game-log', async () => {
        try {
            const config = loadConfig();
            const activeProfileId = config.activeProfileId || 'minecraft-26.2';
            return mycoLogManager.getLatestLogContent(activeProfileId);
        } catch (_) {}
        return null;
    });

    ipcMain.handle('open-log-in-editor', async () => {
        try {
            const config = loadConfig();
            const activeProfileId = config.activeProfileId || 'minecraft-26.2';
            return await mycoLogManager.openLogInEditor(activeProfileId);
        } catch (err) {
            console.error('[IPC] Selhalo otevření logu v editoru:', err);
            return false;
        }
    });

    const handleDownloadLog = async (event, customText) => {
        try {
            const win = getMainWindow();
            const config = loadConfig();
            const activeProfileId = config.activeProfileId || 'minecraft-26.2';
            const textToSave = customText || mycoLogManager.getLatestLogContent(activeProfileId);

            if (!textToSave || !textToSave.trim()) {
                return { success: false, error: 'Žádný log k uložení.' };
            }

            const now = new Date();
            const dateStr = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const defaultFilename = `mychalsmp-log-${dateStr}.mog`;

            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Uložit Mychal Log (.mog pro Poznámkový blok i AI)',
                defaultPath: defaultFilename,
                filters: [
                    { name: 'Mychal Log (*.mog)', extensions: ['mog'] },
                    { name: 'MYCO Log (*.myco)', extensions: ['myco'] },
                    { name: 'Textový dokument (*.txt, *.log)', extensions: ['txt', 'log'] },
                    { name: 'Všechny soubory (*.*)', extensions: ['*'] }
                ]
            });

            if (canceled || !filePath) {
                return { success: false, canceled: true };
            }

            const activeProfile = (config.profiles || []).find(p => p.id === activeProfileId);
            const mogBuffer = mycoLogManager.formatMogLog(textToSave, {
                version: activeProfile ? activeProfile.version : config.version,
                profileName: activeProfile ? activeProfile.name : activeProfileId
            });
            fs.writeFileSync(filePath, mogBuffer);
            return {
                success: true,
                path: filePath,
                originalSize: Buffer.byteLength(textToSave, 'utf8'),
                compressedSize: mogBuffer.length
            };
        } catch (err) {
            console.error('[IPC] Selhalo uložení logu do .mog:', err);
            return { success: false, error: err.message };
        }
    };

    ipcMain.handle('download-log-mog', handleDownloadLog);
    ipcMain.handle('download-log-myco', handleDownloadLog);

    ipcMain.on('open-game-dir', () => {
        shell.openPath(BASE_DIR);
    });

    ipcMain.on('open-logs-folder', () => {
        try {
            const config = loadConfig();
            const activeProfileId = config.activeProfileId || 'minecraft-26.2';
            try {
                mycoLogManager.convertAllPendingLogsToMyco();
            } catch (_) {}
            const logsDir = mycoLogManager.resolveLogsDir(null, activeProfileId);
            if (logsDir && fs.existsSync(logsDir)) {
                shell.openPath(logsDir);
            } else {
                shell.openPath(BASE_DIR);
            }
        } catch (err) {
            console.error('[IPC] Selhalo otevření složky s logy:', err);
        }
    });

    ipcMain.on('open-url', (event, url) => {
        if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
            shell.openExternal(url);
        }
    });

    // Window controls
    ipcMain.on('window-minimize', () => {
        const win = getMainWindow();
        if (win) win.minimize();
    });

    ipcMain.on('window-maximize', () => {
        const win = getMainWindow();
        if (win) {
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    });

    ipcMain.handle('window-is-maximized', () => {
        const win = getMainWindow();
        return (win && !win.isDestroyed()) ? win.isMaximized() : false;
    });

    ipcMain.on('window-close', () => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
            setupTray();
            win.hide();
        }
    });

    // System Info
    ipcMain.handle('get-system-info', async () => {
        const totalBytes = os.totalmem();
        const totalRamGB = Math.round(totalBytes / (1024 * 1024 * 1024));
        const maxAllowedRamGB = Math.max(4, Math.floor((totalBytes * 0.8) / (1024 * 1024 * 1024)));

        let recommendedRamGB = 4;
        if (totalRamGB <= 4) recommendedRamGB = 2;
        else if (totalRamGB <= 8) recommendedRamGB = 4;
        else if (totalRamGB <= 16) recommendedRamGB = 6;
        else if (totalRamGB <= 32) recommendedRamGB = 8;
        else recommendedRamGB = 10;

        function formatCleanGpuName(raw) {
            if (!raw) return 'Standardní grafická karta';
            let clean = raw.trim();
            const bracketMatch = clean.match(/\[(.*?)\]/);
            const vendorMatch = clean.match(/(NVIDIA|AMD|Radeon|Intel)/i);
            const vendor = vendorMatch ? (vendorMatch[1].toUpperCase() === 'NVIDIA' ? 'NVIDIA ' : (vendorMatch[1].toUpperCase() === 'INTEL' ? 'Intel ' : 'AMD ')) : '';

            if (bracketMatch && bracketMatch[1]) {
                const model = bracketMatch[1].trim();
                if (vendor && !model.toLowerCase().includes(vendor.trim().toLowerCase())) {
                    return `${vendor}${model}`;
                }
                return model;
            }
            clean = clean.replace(/^[0-9a-fA-F:.]+\s*(VGA compatible controller|3D controller|Display controller)?:\s*/i, '');
            clean = clean.replace(/\(rev\s+[0-9a-fA-F]+\)/i, '');
            clean = clean.replace(/Corporation/gi, '');
            return clean.trim() || 'Standardní grafická karta';
        }

        let gpuName = 'Standardní grafická karta';
        let isDedicatedGpu = false;
        if (process.platform === 'win32') {
            try {
                const { execSync } = require('child_process');
                const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 2500, encoding: 'utf8' });
                const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                if (lines.length > 0) {
                    const dedicated = lines.find(l => /nvidia|geforce|rtx|gtx|radeon|amd/i.test(l));
                    if (dedicated) {
                        gpuName = formatCleanGpuName(dedicated);
                        isDedicatedGpu = true;
                    } else {
                        gpuName = formatCleanGpuName(lines[0]);
                        isDedicatedGpu = !/intel|basic|microsoft/i.test(lines[0]);
                    }
                }
            } catch (_) { }
        } else if (process.platform === 'linux') {
            try {
                const { execSync } = require('child_process');
                const out = execSync('lspci | grep -i "vga\\|3d\\|display"', { timeout: 2000, encoding: 'utf8' });
                const lines = out.split('\n').map(s => s.trim()).filter(Boolean);
                if (lines.length > 0) {
                    const dedicated = lines.find(l => /nvidia|geforce|radeon|amd/i.test(l));
                    const chosen = dedicated || lines[0];
                    gpuName = formatCleanGpuName(chosen);
                    isDedicatedGpu = /nvidia|geforce|rtx|gtx|radeon|amd/i.test(chosen) && !/intel/i.test(chosen);
                }
            } catch (_) { }
        }

        return {
            platform: process.platform,
            arch: process.arch,
            totalRamGB,
            recommendedRamGB,
            maxAllowedRamGB,
            gpuName,
            isDedicatedGpu
        };
    });

    // Screenshots Gallery
    ipcMain.handle('get-profile-screenshots', async (event, profileId) => {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = profile?.gameDir || BASE_DIR;
        const scDir = path.join(gameDir, 'screenshots');
        if (!fs.existsSync(scDir)) {
            return { success: true, screenshots: [], dirPath: scDir };
        }
        try {
            const files = fs.readdirSync(scDir);
            const screenshots = [];
            for (const file of files) {
                if (file.toLowerCase().endsWith('.png')) {
                    const fullPath = path.join(scDir, file);
                    const stat = fs.statSync(fullPath);
                    screenshots.push({
                        filename: file,
                        fullPath,
                        thumbUrl: `file://${fullPath}`,
                        sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
                        mtime: stat.mtimeMs,
                        dateFormatted: new Date(stat.mtimeMs).toLocaleString('cs-CZ')
                    });
                }
            }
            screenshots.sort((a, b) => b.mtime - a.mtime);
            return { success: true, screenshots, dirPath: scDir };
        } catch (e) {
            return { success: false, error: e.message, screenshots: [] };
        }
    });

    ipcMain.handle('copy-screenshot-to-clipboard', async (event, fullPath) => {
        try {
            if (!fs.existsSync(fullPath)) return { success: false, error: 'Soubor neexistuje' };
            const img = nativeImage.createFromPath(fullPath);
            clipboard.writeImage(img);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('delete-screenshot', async (event, fullPath) => {
        try {
            if (!fullPath || typeof fullPath !== 'string') return { success: false, error: 'Neplatná cesta' };
            const resolvedPath = path.resolve(fullPath);
            const resolvedBase = path.resolve(BASE_DIR);
            if (!resolvedPath.startsWith(resolvedBase + path.sep) || !resolvedPath.toLowerCase().endsWith('.png')) {
                return { success: false, error: 'Mazání povoleno pouze pro snímky obrazovky launcheru.' };
            }
            if (fs.existsSync(resolvedPath)) {
                fs.unlinkSync(resolvedPath);
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('open-file-path', async (event, fullPath) => {
        try {
            if (fs.existsSync(fullPath)) {
                shell.openPath(fullPath);
                return { success: true };
            }
            return { success: false, error: 'Soubor neexistuje' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { registerAppIpc };
