const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Configuration
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),

    // Server Status & Ping
    pingServer: (ip, port) => ipcRenderer.invoke('ping-server', ip, port),

    // Authentication
    loginOffline: (username) => ipcRenderer.invoke('login-offline', username),
    loginMicrosoft: () => ipcRenderer.invoke('login-microsoft'),

    // Launch & Process
    launchGame: (profileId, serverIp) => ipcRenderer.invoke('launch-game', profileId, serverIp),
    killGame: () => ipcRenderer.invoke('kill-game'),
    cancelLaunch: () => ipcRenderer.invoke('cancel-launch'),
    isGameRunning: () => ipcRenderer.invoke('is-game-running'),
    detectJava: () => ipcRenderer.invoke('detect-java'),
    getAvailableJavas: () => ipcRenderer.invoke('get-available-javas'),
    getInstalledVersions: () => ipcRenderer.invoke('get-installed-versions'),

    // Modrinth Browsing
    searchModrinth: (query, version, loader, category, projectType) => 
        ipcRenderer.invoke('search-modrinth', query, version, loader, category, projectType),
    downloadModOrPack: (options) => ipcRenderer.invoke('download-mod-or-pack', options),
    toggleMod: (modId) => ipcRenderer.invoke('toggle-mod', modId),

    // Profile Import, Upgrade & Management
    importProfileDialog: () => ipcRenderer.invoke('import-profile-dialog'),
    confirmImportProfile: (data) => ipcRenderer.invoke('confirm-import-profile', data),
    upgradeProfile: (sourceProfileId, targetVersion) => ipcRenderer.invoke('upgrade-profile', sourceProfileId, targetVersion),
    openProfileFolder: (profileId, subfolder) => ipcRenderer.invoke('open-profile-folder', profileId, subfolder),
    updateProfileSettings: (profileId, updates) => ipcRenderer.invoke('update-profile-settings', profileId, updates),
    deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),
    resetLauncherData: () => ipcRenderer.invoke('reset-launcher-data'),
    onUpgradeProgress: (callback) => {
        ipcRenderer.on('upgrade-progress', (event, data) => callback(data));
    },

    // Event Listeners
    onProgress: (callback) => {
        ipcRenderer.on('launch-progress', (event, data) => callback(data));
    },
    onLog: (callback) => {
        ipcRenderer.on('launch-log', (event, line) => callback(line));
    },
    onExit: (callback) => {
        ipcRenderer.on('launch-exit', (event, code) => callback(code));
    },
    onCrash: (callback) => {
        ipcRenderer.on('launch-crash', (event, crashData) => callback(crashData));
    },

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // File Dialogs & Shell
    selectSkinFile: () => ipcRenderer.invoke('select-skin-file'),
    selectCapeFile: () => ipcRenderer.invoke('select-cape-file'),
    saveOfflineSkin: (skinData) => ipcRenderer.invoke('save-offline-skin', skinData),
    getMojangProfile: () => ipcRenderer.invoke('get-mojang-profile'),
    uploadMojangSkin: (filePath, variant) => ipcRenderer.invoke('upload-mojang-skin', filePath, variant),
    resetMojangSkin: () => ipcRenderer.invoke('reset-mojang-skin'),
    setMojangCape: (capeId) => ipcRenderer.invoke('set-mojang-cape', capeId),
    checkWardenProbe: (profileId) => ipcRenderer.invoke('check-warden-probe', profileId),
    disableIllegalMods: (profileId, filename) => ipcRenderer.invoke('disable-illegal-mods', profileId, filename),
    applyCrashFix: (autoFix, profileId) => ipcRenderer.invoke('apply-crash-fix', autoFix, profileId),
    scanLauncherCache: () => ipcRenderer.invoke('scan-launcher-cache'),
    cleanLauncherCache: () => ipcRenderer.invoke('clean-launcher-cache'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    applyUpdate: (assetUrl) => ipcRenderer.invoke('apply-update', assetUrl),
    restartLauncher: () => ipcRenderer.invoke('restart-launcher'),
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    openGameDir: () => ipcRenderer.send('open-game-dir'),
    openUrl: (url) => ipcRenderer.send('open-url', url)
});
