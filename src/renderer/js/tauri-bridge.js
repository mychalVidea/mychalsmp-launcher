/**
 * MYCHAL SMP Launcher (SMPClient) — Tauri v2 Native Rust IPC Bridge
 *
 * 1:1 drop-in náhrada za Electron `src/main/preload.js`. Každá metoda odpovídá
 * přesně stejnému názvu a pořadí argumentů jako v preloadu, takže `app.js`
 * funguje beze změny. Electron kanál `kebab-case` => Rust příkaz `snake_case`.
 */
(function initTauriBridge() {
  if (window.api) return; // Electron preload již API vystavil

  const tauri = window.__TAURI__;
  const internals = window.__TAURI_INTERNALS__;
  if (!tauri && !internals) return;

  const invoke = (cmd, args = {}) => {
    if (tauri && tauri.core && typeof tauri.core.invoke === 'function') {
      return tauri.core.invoke(cmd, args);
    }
    if (internals && typeof internals.invoke === 'function') {
      return internals.invoke(cmd, args);
    }
    return Promise.reject(new Error(`Tauri invoke unavailable: ${cmd}`));
  };

  // Fire-and-forget (ekvivalent ipcRenderer.send)
  const send = (cmd, args = {}) => {
    invoke(cmd, args).catch((err) => console.warn(`[TauriBridge] ${cmd} selhal:`, err));
  };

  const on = (eventName, callback) => {
    if (!tauri || !tauri.event || typeof tauri.event.listen !== 'function') return;
    tauri.event.listen(eventName, (event) => {
      try {
        callback(event.payload);
      } catch (err) {
        console.error(`[TauriBridge] Chyba v handleru ${eventName}:`, err);
      }
    });
  };

  // Electron `process.platform` je synchronní hodnota — odvodíme ji z UA WebView
  const ua = navigator.userAgent || '';
  const platform = /Windows/i.test(ua) ? 'win32' : /Mac OS X|Macintosh/i.test(ua) ? 'darwin' : 'linux';

  window.api = {
    platform,

    // Configuration
    getConfig: () => invoke('get_config'),
    saveConfig: (cfg) => invoke('save_config', { cfg }),

    // Server Status & Ping
    pingServer: (ip, port) => invoke('ping_server', { ip, port: Number(port) || 25565 }),

    // Authentication
    loginOffline: (username) => invoke('login_offline', { username }),
    loginMicrosoft: () => invoke('login_microsoft'),

    // Launch & Process
    launchGame: (profileId, serverIp) => invoke('launch_game', { profileId, serverIp: serverIp ?? null }),
    killGame: () => invoke('kill_game'),
    cancelLaunch: () => invoke('cancel_launch'),
    isGameRunning: () => invoke('is_game_running'),
    getActiveSession: () => invoke('get_active_session'),
    detectJava: () => invoke('detect_java'),
    getAvailableJavas: () => invoke('get_available_javas'),
    getInstalledVersions: () => invoke('get_installed_versions'),

    // Modrinth Browsing
    searchModrinth: (query, version, loader, category, projectType, offset, limit) =>
      invoke('search_modrinth', {
        query: query ?? '',
        version: version ?? null,
        loader: loader ?? null,
        category: category ?? null,
        projectType: projectType ?? null,
        offset: offset ?? 0,
        limit: limit ?? 20
      }),
    downloadModOrPack: (options) => invoke('download_mod_or_pack', { options }),
    checkProfileModUpdates: (profileId) => invoke('check_profile_mod_updates', { profileId: profileId ?? null }),
    onModDownloadProgress: (callback) => on('mod-download-progress', callback),
    toggleMod: (modId) => invoke('toggle_mod', { modId }),
    getProfileMods: (profileId) => invoke('get_profile_mods', { profileId: profileId ?? null }),
    toggleProfileMod: (profileId, filename) => invoke('toggle_profile_mod', { profileId, filename }),
    deleteProfileMod: (profileId, filename) => invoke('delete_profile_mod', { profileId, filename }),

    // Profile Import, Upgrade & Management
    discoverInstalledProfiles: () => invoke('discover_installed_profiles'),
    importProfileDialog: () => invoke('import_profile_dialog'),
    confirmImportProfile: (data) => invoke('confirm_import_profile', { data }),
    upgradeProfile: (sourceProfileId, targetVersion) =>
      invoke('upgrade_profile', { sourceProfileId, targetVersion }),
    openProfileFolder: (profileId, subfolder) =>
      invoke('open_profile_folder', { profileId: profileId ?? null, subfolder: subfolder ?? null }),
    updateProfileSettings: (profileId, updates) => invoke('update_profile_settings', { profileId, updates }),
    duplicateProfile: (profileId) => invoke('duplicate_profile', { profileId }),
    deleteProfile: (profileId) => invoke('delete_profile', { profileId }),
    resetLauncherData: () => invoke('reset_launcher_data'),
    generateProfileSeed: (profileId) => invoke('generate_profile_seed', { profileId }),
    importProfileSeed: (profileId, seedString) => invoke('import_profile_seed', { profileId, seedString }),
    onProfileSeedProgress: (callback) => on('profile-seed-progress', callback),
    onUpgradeProgress: (callback) => on('upgrade-progress', callback),

    // Profile & Performance Optimization
    applyProfileOptimization: (profileId) => invoke('apply_profile_optimization', { profileId }),
    checkOptimizationStatus: (profileId) => invoke('check_optimization_status', { profileId }),
    onOptimizationProgress: (callback) => on('optimization-progress', callback),

    // Keybinds Management
    getKeybinds: (profileId) => invoke('get_keybinds', { profileId: profileId ?? null }),
    saveKeybinds: (binds, profileId) => invoke('save_keybinds', { binds, profileId: profileId ?? null }),
    resetKeybindsDefault: () => invoke('reset_keybinds_default'),

    // Key Arts & Version Backgrounds
    getKeyarts: () => invoke('get_available_keyarts'),
    openKeyartsFolder: () => invoke('open_keyarts_folder'),

    // Event Listeners
    onProgress: (callback) => on('launch-progress', callback),
    onLog: (callback) => on('launch-log', callback),
    onExit: (callback) => on('launch-exit', callback),
    onCrash: (callback) => on('launch-crash', callback),
    onPlaytimeUpdated: (callback) => on('playtime-updated', callback),
    onServersUpdated: (callback) => on('servers-updated', callback),

    // Window controls
    minimizeWindow: () => send('window_minimize'),
    maximizeWindow: () => send('window_maximize'),
    closeWindow: () => send('window_close'),
    isMaximized: () => invoke('window_is_maximized'),
    onMaximizeChange: (callback) => on('window-maximize-change', callback),

    // File Dialogs & Shell
    selectSkinFile: () => invoke('select_skin_file'),
    selectCapeFile: () => invoke('select_cape_file'),
    saveOfflineSkin: (skinData) => invoke('save_offline_skin', { skinData }),
    getMojangProfile: () => invoke('get_mojang_profile'),
    uploadMojangSkin: (filePath, variant) => invoke('upload_mojang_skin', { filePath, variant: variant ?? 'classic' }),
    resetMojangSkin: () => invoke('reset_mojang_skin'),
    setMojangCape: (capeId) => invoke('set_mojang_cape', { capeId: capeId ?? null }),
    checkWardenProbe: (profileId) => invoke('check_warden_probe', { profileId: profileId ?? null }),
    disableIllegalMods: (profileId, filename) =>
      invoke('disable_illegal_mods', { profileId: profileId ?? null, filename: filename ?? null }),
    applyCrashFix: (autoFix, profileId) => invoke('apply_crash_fix', { autoFix, profileId: profileId ?? null }),
    scanLauncherCache: () => invoke('scan_launcher_cache'),
    cleanLauncherCache: () => invoke('clean_launcher_cache'),
    checkForUpdates: () => invoke('check_for_updates'),
    applyUpdate: (assetUrl) => invoke('apply_update', { assetUrl }),
    restartLauncher: () => invoke('restart_launcher'),
    onUpdateProgress: (callback) => on('update-progress', callback),
    checkAudioDlc: () => invoke('check_audio_dlc'),
    downloadAudioDlc: () => invoke('download_audio_dlc'),
    cancelAudioDlc: () => invoke('cancel_audio_dlc'),
    onAudioDlcProgress: (callback) => on('audio-dlc-progress', callback),
    getSystemInfo: () => invoke('get_system_info'),
    openGameDir: () => send('open_game_dir'),
    openUrl: (url) => send('open_url', { url }),
    copyToClipboard: (text) => invoke('copy_to_clipboard', { text }),
    getLatestGameLog: () => invoke('get_latest_game_log'),
    openLogInEditor: () => invoke('open_log_in_editor'),
    openLogsFolder: () => send('open_logs_folder'),
    downloadLogMog: (customText) => invoke('download_log_mog', { customText: customText ?? null }),
    downloadLogMyco: (customText) => invoke('download_log_myco', { customText: customText ?? null }),
    onAuthStatus: (callback) => on('auth-status', (data) => callback(typeof data === 'string' ? data : (data?.message || JSON.stringify(data)))),

    // Screenshots Gallery
    getProfileScreenshots: (profileId) => invoke('get_profile_screenshots', { profileId: profileId ?? null }),
    copyScreenshotToClipboard: (fullPath) => invoke('copy_screenshot_to_clipboard', { fullPath }),
    deleteScreenshot: (fullPath) => invoke('delete_screenshot', { fullPath }),
    openFilePath: (fullPath) => invoke('open_file_path', { fullPath }),

    // Resource Packs & Shaders
    getProfilePacks: (profileId, packType) => invoke('get_profile_packs', { profileId: profileId ?? null, packType }),
    toggleProfilePack: (profileId, packType, filename) =>
      invoke('toggle_profile_pack', { profileId: profileId ?? null, packType, filename }),
    deleteProfilePack: (profileId, packType, filename) =>
      invoke('delete_profile_pack', { profileId: profileId ?? null, packType, filename }),

    // Mod Collisions & Drag Skin
    resolveModCollisions: (profileId) => invoke('resolve_mod_collisions', { profileId: profileId ?? null }),
    saveDraggedSkin: (filePath) => invoke('save_dragged_skin', { filePath }),

    // Game lifecycle events for background pause
    onGameStarted: (callback) => on('game-started', () => callback()),
    onGameStopped: (callback) => on('game-stopped', () => callback()),
    onWindowRestoredFromTray: (callback) => on('window-restored-from-tray', () => callback()),
    onWindowHiddenToTray: (callback) => on('window-hidden-to-tray', () => callback()),
    preloadLaunchEnvironment: (profileId) => invoke('preload_launch_environment', { profileId: profileId ?? null })
  };

  // Nativní tažení bezrámového okna za titlebar
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.titlebar, .titlebar-drag').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, a, input, select, .window-controls')) return;
        if (e.detail === 2) {
          send('window_maximize');
          return;
        }
        if (tauri && tauri.window && typeof tauri.window.getCurrentWindow === 'function') {
          tauri.window.getCurrentWindow().startDragging().catch(() => {});
        }
      });
    });
  });
})();
