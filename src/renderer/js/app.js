/**
 * MYCHAL SMP Launcher - Compact Client Application Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ── Element References ──────────────────────────────────────────────────
    // Window Controls
    const btnMin = document.getElementById('btnMinimize');
    const btnMax = document.getElementById('btnMaximize');
    const btnClose = document.getElementById('btnClose');

    // Navigation
    const navButtons = document.querySelectorAll('.nav-icon-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const sidebarPlayBtn = document.getElementById('sidebarPlayBtn');

    // Titlebar Info
    const greetingAvatar = document.getElementById('greetingAvatar');
    const greetingNick = document.getElementById('greetingNick');
    const networkDot = document.getElementById('networkDot');
    const networkText = document.getElementById('networkText');

    // Hero Stage
    const heroSkinImg = document.getElementById('heroSkinImg');
    const heroSkinCanvas3D = document.getElementById('heroSkinCanvas3D');
    const heroNickLabel = document.getElementById('heroNickLabel');
    const stageNickPill = document.getElementById('stageNickPill');
    const btnEditNickFromHero = document.getElementById('btnEditNickFromHero');
    const btnManageProfiles = document.getElementById('btnManageProfiles');
    const btnAddModsShortcut = document.getElementById('btnAddModsShortcut');

    // Progress Bar & Global Titlebar Download Chip
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressText = document.getElementById('progressText');
    const globalDownloadChip = document.getElementById('globalDownloadChip');
    const globalDownloadText = document.getElementById('globalDownloadText');
    const globalDownloadBar = document.getElementById('globalDownloadBar');
    const btnCancelGlobalDownload = document.getElementById('btnCancelGlobalDownload');
    let lastProgressData = null;
    let maxRenderedProgress = 0;
    let activePreLaunchModUpdate = null;
    let skinViewer = null;
    let heroSkinViewer = null;

    /**
     * Ideální psychologická Cubic Bézier křivka pro všechny progress bary:
     * cubic-bezier(.05, 1, 1, .55)
     * - Okamžitá a živá odezva (P1 = [0.05, 1]): okamžitý raketový náběh při spuštění stahování
     * - Super plynulý tah a hladký dojezd do cíle (P2 = [1, 0.55])
     */
    function evalCubicBezier(x, x1 = 0.05, y1 = 1, x2 = 1, y2 = 0.55) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;

        // Řešení X(t) = x pro t v [0, 1] pomocí Newton-Raphson metody
        let t = x;
        for (let i = 0; i < 8; i++) {
            const u = 1 - t;
            const currentX = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
            const dx = currentX - x;
            if (Math.abs(dx) < 1e-4) break;
            const dxdt = 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
            if (Math.abs(dxdt) < 1e-5) break;
            t -= dx / dxdt;
            t = Math.max(0, Math.min(1, t));
        }

        const u = 1 - t;
        return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    }

    function calculatePerceptualProgress(realPercent) {
        const val = Number(realPercent);
        if (isNaN(val) || val <= 0) return 0;
        if (val >= 100) return 100;
        return Math.min(99, Math.max(1, Math.round(val)));
    }

    /**
     * Převede technické hlášky nebo milníky na přátelské, živé atmosférické stavy.
     * Pokud je předán konkrétní lidský text z launch engine, zachovává jej v plné přesnosti.
     */
    function getHumanFriendlyStatus(rawText, percent = 0) {
        const text = String(rawText || '').trim();
        const lower = text.toLowerCase();

        // Okamžité přerušení nebo ukončení
        if (lower.includes('ruším') || lower.includes('zrušeno')) return 'Ruším stahování...';
        if (lower.includes('ukončuji') || lower.includes('ukončeno')) return 'Ukončuji Minecraft...';
        if (lower.includes('spouštím minecraft') || lower.includes('hra spuštěna') || percent >= 98) return 'Spouštíme Minecraft!';

        // Pokud text již obsahuje specifickou, smysluplnou herní zprávu z našeho launch enginu,
        // zachováme ji v plné kráse (např. "Zavádění 57 módů a doplňků...")
        if (
            text.startsWith('Zavádění ') ||
            text.startsWith('Aplikace ') ||
            text.startsWith('Inicializace ') ||
            text.startsWith('Vytváření ') ||
            text.startsWith('Otevírání ') ||
            text.startsWith('Ověřování ') ||
            text.startsWith('Optimalizace ') ||
            text.startsWith('Herní ') ||
            text.startsWith('Start ') ||
            text.startsWith('Příprava ') ||
            text.startsWith('Stahuji herní knihovny') ||
            text.startsWith('Stahuji herní textury') ||
            text.startsWith('Stahuji jádro') ||
            text.startsWith('Kontroluji aktualizace') ||
            text.startsWith('Stahuji aktualizaci')
        ) {
            return text;
        }

        // Klíčová slova podle subsystému
        if (lower.includes('java') || lower.includes('runtime') || lower.includes('jádro') || lower.includes('client.jar')) {
            return 'Připravujeme herní jádro...';
        }
        if (lower.includes('mixin') || lower.includes('optimiz')) {
            return 'Aplikace herních optimalizací...';
        }
        if (lower.includes('gpu') || lower.includes('grafik') || lower.includes('vulkan') || lower.includes('opengl')) {
            return 'Inicializace grafiky a GPU...';
        }
        if (lower.includes('mod') || lower.includes('knihovn') || lower.includes('librar') || lower.includes('classes')) {
            return 'Leštíme modpack...';
        }
        if (lower.includes('textur') || lower.includes('asset') || lower.includes('zvuk') || lower.includes('audio') || lower.includes('resource') || lower.includes('delta')) {
            return 'Rozpalujeme kamna...';
        }
        if (lower.includes('nativ') || lower.includes('natives')) {
            return 'Rozpalujeme kamna...';
        }

        // Dynamické herní stavy podle plynulých procent (pokud v textu není konkrétní údaj)
        if (percent < 18) {
            return 'Připravujeme herní jádro...';
        }
        if (percent < 45) {
            return 'Ověřování herních souborů...';
        }
        if (percent < 68) {
            return 'Leštíme modpack...';
        }
        if (percent < 84) {
            return 'Aplikace herních optimalizací...';
        }
        if (percent < 94) {
            return 'Inicializace grafiky a GPU...';
        }
        if (percent < 98) {
            return 'Vytváření herního okna...';
        }

        return 'Spouštíme Minecraft!';
    }

    // ── Klientský plynulý mikro-posun během spouštění (eliminuje jakékoliv vizuální zamrznutí) ──
    let clientProgressTicker = null;
    function startClientProgressTicker() {
        if (clientProgressTicker) clearInterval(clientProgressTicker);
        clientProgressTicker = setInterval(() => {
            if (!isLaunching || isRunning) {
                stopClientProgressTicker();
                return;
            }
            if (maxRenderedProgress > 0 && maxRenderedProgress < 96) {
                maxRenderedProgress += 0.15;
                updateLaunchProgressUI(maxRenderedProgress, lastProgressData ? lastProgressData.text : '');
            }
        }, 100);
    }
    function stopClientProgressTicker() {
        if (clientProgressTicker) {
            clearInterval(clientProgressTicker);
            clientProgressTicker = null;
        }
    }

    function updateLaunchProgressUI(rawPercent, statusText) {
        const val = Math.min(Math.max(Number(rawPercent) || 0, 0), 100);
        maxRenderedProgress = Math.max(maxRenderedProgress, val);
        const percent = Math.min(99, Math.round(maxRenderedProgress));
        const rawStatusText = statusText || (lastProgressData ? lastProgressData.text : 'Načítání hry...');
        const friendlyStatus = getHumanFriendlyStatus(rawStatusText, percent);

        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressText) {
                progressText.textContent = friendlyStatus;
                progressText.title = rawStatusText;
            }
        }

        if (globalDownloadChip) {
            globalDownloadChip.style.display = 'inline-flex';
            if (globalDownloadBar) globalDownloadBar.style.width = `${percent}%`;
            if (globalDownloadText) {
                globalDownloadText.textContent = `${friendlyStatus} (${percent}%)`;
                globalDownloadText.title = rawStatusText;
            }
        }

        // Živý indikátor stahování přímo v kartě spouštěné verze
        const activeProfile = (currentConfig.profiles || []).find(p => p.id === currentConfig.activeProfileId);
        const activeVer = activeProfile ? activeProfile.version : (currentConfig.version || '26.2');
        const idSuffix = activeVer ? activeVer.replace(/\./g, '') : '262';
        const vBox = document.getElementById(`vProgressBox${idSuffix}`);
        const vBar = document.getElementById(`vProgressBar${idSuffix}`);
        const vPct = document.getElementById(`vProgressPercent${idSuffix}`);
        const vTxt = document.getElementById(`vProgressText${idSuffix}`);
        const vBadge = document.getElementById(`vStatus${idSuffix}`);

        if (vBox) {
            vBox.style.display = 'flex';
            if (vBar) vBar.style.width = `${percent}%`;
            if (vPct) vPct.textContent = `${percent}%`;
            if (vTxt) {
                vTxt.textContent = friendlyStatus;
                vTxt.title = rawStatusText;
            }
        }
        if (vBadge) {
            vBadge.className = 'v-status-badge downloading';
            const vLabel = vBadge.querySelector('.v-status-label') || vBadge;
            vLabel.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Spouštění... ${percent}%</span>`;
        }
    }



    // Right Column: Server Banner & Tracker
    const serverPlayersCount = document.getElementById('serverPlayersCount');
    const serverPingVal = document.getElementById('serverPingVal');
    const btnQuickPlayMychal = document.getElementById('btnQuickPlayMychal');
    const trackedServersList = document.getElementById('trackedServersList');
    const btnAddCustomServer = document.getElementById('btnAddCustomServer');
    const sideJavaBadge = document.getElementById('sideJavaBadge');
    const sideConsoleStatus = document.getElementById('sideConsoleStatus');

    // Modrinth Browser
    const modSearchInput = document.getElementById('modSearchInput');
    const modsCardsList = document.getElementById('modsCardsList');
    const modTabButtons = document.querySelectorAll('.mod-tab-btn');

    // Character Tab
    const inputNick = document.getElementById('inputNick');
    const authOfflineBtn = document.getElementById('authOfflineBtn');
    const authMicrosoftBtn = document.getElementById('authMicrosoftBtn');
    const skinPreviewImg = document.getElementById('skinPreviewImg');
    const skinCaption = document.getElementById('skinCaption');
    const btnSelectSkinFile = document.getElementById('btnSelectSkinFile');
    const btnSaveCharacter = document.getElementById('btnSaveCharacter');

    // Settings
    const ramSlider = document.getElementById('ramSlider');
    const ramValueBadge = document.getElementById('ramValueBadge');
    let ramSliderController = null;
    let newProfileRamSliderController = null;
    let profileRamSliderController = null;
    const javaPathInput = document.getElementById('javaPathInput');
    const btnDetectJava = document.getElementById('btnDetectJava');
    const javaDetectedList = document.getElementById('javaDetectedList');
    const btnOpenGameDir = document.getElementById('btnOpenGameDir');
    const consoleOutput = document.getElementById('consoleOutput');
    const btnClearLog = document.getElementById('btnClearLog');
    const btnCopyLog = document.getElementById('btnCopyLog');
    const btnOpenLogEditor = document.getElementById('btnOpenLogEditor');
    const btnDownloadLog = document.getElementById('btnDownloadLog');

    // State
    let currentConfig = {};
    let installedVersions = [];
    let isLaunching = false;
    let isRunning = false;
    let runningProfileId = null;
    let launchingProfileId = null;
    let userRequestedGameStop = false;

    function markUserRequestedStop() {
        userRequestedGameStop = true;
        setTimeout(() => { userRequestedGameStop = false; }, 6000);
    }
    const BUNDLED_KEYARTS = {
        '1.21.11': 'assets/keyarts/1.21.11.jpg',
        '26.1': 'assets/keyarts/26.1.jpg',
        '26.2': 'assets/keyarts/26.2.jpg',
        '26.3': 'assets/keyarts/26.3.jpg',
        'card-1.21.11': 'assets/keyarts/card-1.21.11.jpg',
        'card-26.1': 'assets/keyarts/card-26.1.jpg',
        'card-26.2': 'assets/keyarts/card-26.2.jpg',
        'card-26.3': 'assets/keyarts/card-26.3.jpg',
        'default': 'assets/keyarts/default.jpg'
    };
    const BUNDLED_CARD_KEYARTS = {
        '1.21.11': 'assets/keyarts/card-1.21.11.jpg',
        '26.1': 'assets/keyarts/card-26.1.jpg',
        '26.2': 'assets/keyarts/card-26.2.jpg',
        '26.3': 'assets/keyarts/card-26.3.jpg',
        'default': 'assets/keyarts/default.jpg'
    };
    let availableKeyartsMap = { ...BUNDLED_KEYARTS };
    let currentModFilter = {
        query: '',
        version: '26.2',
        loader: 'fabric',
        category: '',
        projectType: 'mod'
    };

    // ── Window Controls & State ─────────────────────────────────────────────
    if (btnMin) btnMin.addEventListener('click', () => window.api.minimizeWindow());
    if (btnMax) btnMax.addEventListener('click', () => window.api.maximizeWindow());
    if (btnClose) btnClose.addEventListener('click', () => window.api.closeWindow());

    if (window.api && window.api.onMaximizeChange) {
        window.api.onMaximizeChange((isMax) => {
            document.body.classList.toggle('is-maximized', isMax);
            if (btnMax) btnMax.title = isMax ? 'Obnovit velikost' : 'Maximalizovat';
        });
        if (typeof window.api.isMaximized === 'function') {
            window.api.isMaximized().then((isMax) => {
                if (isMax) {
                    document.body.classList.add('is-maximized');
                    if (btnMax) btnMax.title = 'Obnovit velikost';
                }
            }).catch(() => { });
        }
    }

    // ── Úsporný režim při skrytí do Tray lišty (Zero-Overhead Background Mode) ──
    let isLauncherSuspendedInTray = false;

    function pauseLauncherBackgroundActivity() {
        if (isLauncherSuspendedInTray) return;
        isLauncherSuspendedInTray = true;

        // 1. Okamžitě zmrazit 3D WebGL renderování v skinview3d a smrštit buffery na 1x1 pro uvolnění VRAM
        if (heroSkinViewer) {
            heroSkinViewer.renderPaused = true;
            try { heroSkinViewer.setSize(1, 1); } catch (_) { }
        }
        if (skinViewer) {
            skinViewer.renderPaused = true;
            try { skinViewer.setSize(1, 1); } catch (_) { }
        }

        // 2. Vynulovat interakce a sledování kurzoru hero modelu
        if (typeof cancelHeroReturn === 'function') cancelHeroReturn();
        isDraggingHero = false;
        heroDragVelocityX = 0;
        heroDragVelocityY = 0;
        targetHeroHeadLookX = 0;
        targetHeroHeadLookY = 0;

        // 3. Pozastavit periodický 15s interval zjišťování stavu sítě (ping)
        stopNetworkStatusPolling();

        // 4. Zmrazit veškeré CSS keyframe animace na pozadí
        document.body.classList.add('app-in-tray-paused');

        // 5. Uvolnit V8 paměťovou haldu v rendereru pro sražení RAM na minimum
        try {
            if (typeof window.gc === 'function') {
                window.gc();
            } else if (typeof gc === 'function') {
                gc();
            }
        } catch (_) { }

        console.log('[VÝKON] Launcher v Tray liště – 3D renderování, JS intervaly, animace pozastaveny a RAM uvolněna (0% zátěž CPU/GPU).');
    }

    function resumeLauncherBackgroundActivity() {
        isLauncherSuspendedInTray = false;

        // 1. Odmrazit CSS animace a zajistit plnou viditelnost okna
        document.body.classList.remove('launch-handoff');
        document.body.classList.remove('app-in-tray-paused');

        // 2. Obnovit 3D renderování pouze pro aktivní záložku
        const curTab = (document.querySelector('.nav-icon-btn.active, .nav-btn.active')?.dataset?.tab) || 'play';
        if (heroSkinViewer) {
            heroSkinViewer.renderPaused = (curTab !== 'play');
            if (curTab === 'play') {
                heroSkinViewer.setSize(220, 280);
                try { heroSkinViewer.draw(); } catch (_) { }
                if (typeof scheduleHeroReturn === 'function') scheduleHeroReturn();
                if (typeof triggerHeroWave === 'function') triggerHeroWave(true);
            }
        }
        if (skinViewer) {
            skinViewer.renderPaused = (curTab !== 'character');
            if (curTab === 'character') {
                skinViewer.setSize(200, 235);
                try { skinViewer.draw(); } catch (_) { }
            }
        }

        // 3. Okamžitě zkontrolovat stav sítě a obnovit 15s interval
        updateNetworkStatus();
        startNetworkStatusPolling();

        console.log('[VÝKON] Launcher obnoven z lišty – běh 3D modelu a rozhraní obnoven.');
    }

    // Posluchače událostí z Traye a viditelnosti okna
    if (window.api && window.api.onWindowHiddenToTray) {
        window.api.onWindowHiddenToTray(() => {
            pauseLauncherBackgroundActivity();
        });
    }

    if (window.api && window.api.onWindowRestoredFromTray) {
        window.api.onWindowRestoredFromTray(() => {
            resumeLauncherBackgroundActivity();
        });
    }

    window.addEventListener('focus', () => {
        document.body.classList.remove('launch-handoff');
        document.body.classList.remove('app-in-tray-paused');
        if (isLauncherSuspendedInTray) {
            resumeLauncherBackgroundActivity();
        }
    });

    // ── Tab Navigation ──────────────────────────────────────────────────────
    function switchTab(tabId) {
        if (typeof autoSaveSettings === 'function') {
            autoSaveSettings(true);
        }
        navButtons.forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabId}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        if (tabId === 'mods') {
            renderModsProfileDropdown();
            if (btnSwitchCatalogMods && btnSwitchCatalogMods.classList.contains('active')) {
                loadModrinthMods();
                loadProfileMods();
            } else {
                loadProfileMods();
            }
        } else if (tabId === 'servers') {
            renderServersFullTab();
        } else if (tabId === 'character') {
            updateCharacterTabSkinPreview();
        }

        if (heroSkinViewer) {
            heroSkinViewer.renderPaused = (tabId !== 'play');
            if (tabId === 'play') {
                const cvEl = document.querySelector('.content-viewport');
                if (cvEl && cvEl.scrollTop > 0) cvEl.scrollTop = 0;
                heroSkinViewer.setSize(220, 280);
                scheduleHeroReturn();
            } else {
                cancelHeroReturn();
            }
        }
        if (skinViewer) {
            skinViewer.renderPaused = (tabId !== 'character');
            if (tabId === 'character') {
                skinViewer.setSize(200, 235);
            }
        }

        // Pokud právě probíhá stahování / spouštění verze, zajistit zobrazení indikátorů
        if (isLaunching) {
            if (globalDownloadChip) {
                globalDownloadChip.style.display = 'inline-flex';
            }
            if (tabId === 'play' && progressContainer) {
                progressContainer.style.display = 'flex';
                if (lastProgressData) {
                    const rawPct = Math.min(Math.max(lastProgressData.percent || 0, 0), 100);
                    const pct = calculatePerceptualProgress(rawPct);
                    if (progressBar) progressBar.style.width = `${pct}%`;
                    if (progressPercent) progressPercent.textContent = `${pct}%`;
                    if (progressText) progressText.textContent = lastProgressData.text || 'Načítání hry...';
                }
            }
        }
    }

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    if (stageNickPill) {
        stageNickPill.addEventListener('click', () => switchTab('character'));
    }
    if (btnEditNickFromHero) {
        btnEditNickFromHero.addEventListener('click', (e) => {
            e.stopPropagation();
            switchTab('character');
        });
    }
    const btnQuickMods = document.getElementById('btnQuickMods');
    if (btnQuickMods) {
        btnQuickMods.addEventListener('click', () => switchTab('mods'));
    }
    if (btnManageProfiles) {
        btnManageProfiles.addEventListener('click', () => switchTab('mods'));
    }
    if (btnAddModsShortcut) {
        btnAddModsShortcut.addEventListener('click', () => switchTab('mods'));
    }
    const btnOpenKeybindEditor = document.getElementById('btnOpenKeybindEditor');
    if (btnOpenKeybindEditor) {
        btnOpenKeybindEditor.addEventListener('click', () => {
            if (typeof openKeybindEditorModal === 'function') {
                openKeybindEditorModal();
            }
        });
    }
    const heroStatActiveProfile = document.getElementById('heroStatActiveProfile');
    if (heroStatActiveProfile) {
        heroStatActiveProfile.style.cursor = 'pointer';
        heroStatActiveProfile.addEventListener('click', () => {
            const listEl = document.getElementById('profileCardsList');
            if (listEl) {
                const activeCard = listEl.querySelector('.active-profile') || listEl.firstElementChild;
                if (activeCard) {
                    if (activeCard === listEl.firstElementChild) {
                        listEl.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            }
        });
    }

    const profilesSectionEl = document.querySelector('.profiles-section');
    const profileCardsListEl = document.getElementById('profileCardsList');
    if (profilesSectionEl && profileCardsListEl) {
        profilesSectionEl.addEventListener('wheel', (e) => {
            if (!profileCardsListEl.contains(e.target)) {
                profileCardsListEl.scrollTop += e.deltaY;
            }
        }, { passive: true });
    }


    // ── Server Status & Telemetry ───────────────────────────────────────────
    async function updateNetworkStatus() {
        try {
            const status = await window.api.pingServer('mychalsmp.xyz', 25565);
            if (status && status.online) {
                if (networkDot) networkDot.classList.remove('offline');
                if (networkText) networkText.textContent = `mychalsmp.xyz • ${status.players.online} online`;
                if (serverPlayersCount) serverPlayersCount.textContent = `${status.players.online} / ${status.players.max}`;
                if (serverPingVal) serverPingVal.textContent = `${status.latency} ms`;
            } else {
                markOfflineStatus();
            }
        } catch (err) {
            markOfflineStatus();
        }
    }

    function markOfflineStatus() {
        if (networkDot) networkDot.classList.add('offline');
        if (networkText) networkText.textContent = `Offline mód (Lokální verze)`;
        if (serverPlayersCount) serverPlayersCount.textContent = `Offline`;
        if (serverPingVal) serverPingVal.textContent = `-- ms`;
    }

    let networkStatusInterval = null;
    function startNetworkStatusPolling() {
        if (networkStatusInterval) clearInterval(networkStatusInterval);
        networkStatusInterval = setInterval(updateNetworkStatus, 15000);
    }
    function stopNetworkStatusPolling() {
        if (networkStatusInterval) {
            clearInterval(networkStatusInterval);
            networkStatusInterval = null;
        }
    }

    updateNetworkStatus();
    startNetworkStatusPolling();

    // ── Configuration Loader ────────────────────────────────────────────────
    async function loadConfiguration() {
        try {
            currentConfig = await window.api.getConfig();
            installedVersions = await window.api.getInstalledVersions();
            try {
                if (window.api && typeof window.api.getKeyarts === 'function') {
                    const fetched = await window.api.getKeyarts();
                    if (fetched && typeof fetched === 'object') {
                        availableKeyartsMap = { ...BUNDLED_KEYARTS, ...fetched };
                    }
                }
            } catch (_) { }

            // Automatické pročištění starého defaultního canvas pláště z konfigurace
            if (currentConfig && currentConfig.customCapePath && (
                currentConfig.customCapePath.startsWith('data:image') ||
                currentConfig.customCapePath === 'default' ||
                currentConfig.customCapePath === 'none'
            )) {
                currentConfig.customCapePath = null;
                window.api.saveOfflineSkin({ capePath: null }).catch(() => { });
            }

            // Profile info
            const isMs = currentConfig.authType === 'microsoft';
            const msName = currentConfig.microsoftAccount?.name || currentConfig.microsoftAccount?.username;
            const name = isMs
                ? (msName || currentConfig.username || 'Hráč')
                : (currentConfig.offlineUsername || currentConfig.username || 'Hráč');
            updateUserUI(name, currentConfig.authType || 'offline', currentConfig.customSkinPath);

            // System Hardware & RAM detection (up to 80% of system RAM)
            try {
                const sysInfo = await window.api.getSystemInfo();
                const maxRam = (sysInfo && sysInfo.maxAllowedRamGB) ? sysInfo.maxAllowedRamGB : 16;
                if (ramSlider) ramSlider.max = maxRam;
                if (profileRamSlider) profileRamSlider.max = maxRam;
                const newProfRam = document.getElementById('newProfileRamSlider');
                if (newProfRam) newProfRam.max = maxRam;
                window._lastRecommendedRamGB = sysInfo?.recommendedRamGB || 8;
                renderRamSliderMarks(maxRam, window._lastRecommendedRamGB);

                // Chytrý RAM asistent podle HW v PC (Windows + Linux)
                const ramTotalText = document.getElementById('ramTotalText');
                const ramRecommendedVal = document.getElementById('ramRecommendedVal');
                const btnApplyRecommendedRam = document.getElementById('btnApplyRecommendedRam');
                if (ramTotalText && sysInfo?.totalRamGB) {
                    ramTotalText.textContent = `${sysInfo.totalRamGB} GB RAM`;
                }
                if (ramRecommendedVal && sysInfo?.recommendedRamGB) {
                    ramRecommendedVal.textContent = `${sysInfo.recommendedRamGB} GB`;
                }
                if (btnApplyRecommendedRam && sysInfo?.recommendedRamGB) {
                    btnApplyRecommendedRam.style.display = 'inline-flex';
                    btnApplyRecommendedRam.onclick = () => {
                        if (ramSlider && ramValueBadge) {
                            if (ramSliderController) {
                                ramSliderController.setTarget(sysInfo.recommendedRamGB, false, true);
                            } else {
                                ramSlider.value = sysInfo.recommendedRamGB;
                                updateSliderVisuals(ramSlider, ramValueBadge);
                            }
                            currentConfig.ramMax = sysInfo.recommendedRamGB;
                            autoSaveSettings(true);
                            showToast(`Nastavena optimální paměť: ${sysInfo.recommendedRamGB} GB RAM`, 'success');
                        }
                    };
                }

                // Rychlé předvolby RAM tlačítek (4 GB, 16 GB atd.)
                document.querySelectorAll('.btn-ram-preset[data-ram]').forEach(btn => {
                    btn.onclick = () => {
                        const val = parseInt(btn.getAttribute('data-ram'), 10);
                        if (val && ramSlider && ramValueBadge) {
                            if (ramSliderController) {
                                ramSliderController.setTarget(val, false, true);
                            } else {
                                ramSlider.value = val;
                                updateSliderVisuals(ramSlider, ramValueBadge);
                            }
                            currentConfig.ramMax = val;
                            autoSaveSettings(true);
                            showToast(`Nastavena paměť: ${val} GB RAM`, 'info');
                        }
                    };
                });

                // Auto-Detekce dedikované grafiky (Windows i Linux)
                const gpuNameText = document.getElementById('gpuNameText');
                const gpuDedicatedBadge = document.getElementById('gpuDedicatedBadge');
                if (gpuNameText) {
                    let cleanGpu = sysInfo?.gpuName || 'Standardní grafická karta';
                    const bracketMatch = cleanGpu.match(/\[(.*?)\]/);
                    const vendorMatch = cleanGpu.match(/(NVIDIA|AMD|Radeon|Intel)/i);
                    const vendor = vendorMatch ? (vendorMatch[1].toUpperCase() === 'NVIDIA' ? 'NVIDIA ' : (vendorMatch[1].toUpperCase() === 'INTEL' ? 'Intel ' : 'AMD ')) : '';
                    if (bracketMatch && bracketMatch[1]) {
                        const model = bracketMatch[1].trim();
                        cleanGpu = vendor && !model.toLowerCase().includes(vendor.trim().toLowerCase()) ? `${vendor}${model}` : model;
                    } else {
                        cleanGpu = cleanGpu.replace(/^[0-9a-fA-F:.]+\s*(VGA compatible controller|3D controller|Display controller)?:\s*/i, '');
                        cleanGpu = cleanGpu.replace(/\(rev\s+[0-9a-fA-F]+\)/i, '').replace(/Corporation/gi, '').trim();
                    }
                    gpuNameText.textContent = cleanGpu || 'Standardní grafická karta';
                }
                if (gpuDedicatedBadge) {
                    gpuDedicatedBadge.style.display = sysInfo?.isDedicatedGpu ? 'inline-block' : 'none';
                    gpuDedicatedBadge.textContent = 'Výkonná grafika';
                }

                // Na Windows schovat čistě linuxová nastavení (co dělají bordel na Windows)
                const linuxPerfGroup = document.getElementById('linuxPerfGroup');
                if (linuxPerfGroup) {
                    linuxPerfGroup.style.display = (sysInfo?.platform === 'win32') ? 'none' : 'block';
                }
            } catch (sysErr) {
                console.warn('Detekce hardware RAM/GPU selhala:', sysErr);
                renderRamSliderMarks(16);
            }

            // RAM
            if (ramSlider && ramValueBadge && currentConfig.ramMax) {
                if (ramSliderController) {
                    ramSliderController.setValue(currentConfig.ramMax, true);
                } else {
                    ramSlider.value = currentConfig.ramMax;
                    updateSliderVisuals(ramSlider, ramValueBadge);
                }
            }

            // Java
            if (javaPathInput && currentConfig.javaPath) {
                javaPathInput.value = currentConfig.javaPath;
            }


            // Resolution
            if (currentConfig.resolution) {
                const resVal = (currentConfig.borderlessFullscreen === true || currentConfig.resolution.fullscreen)
                    ? 'fullscreen'
                    : `${currentConfig.resolution.width}x${currentConfig.resolution.height}`;
                const radio = document.querySelector(`input[name="res"][value="${resVal}"]`);
                if (radio) radio.checked = true;
            }

            // Render API (Vulkan / OpenGL / Default)
            const currentBackend = currentConfig.graphicsBackend || 'default';
            const backendRadio = document.querySelector(`input[name="graphicsBackend"][value="${currentBackend}"]`);
            if (backendRadio) backendRadio.checked = true;

            // Platform detection & OS Accordion setup
            const currentPlatform = (window.api && window.api.platform) ? window.api.platform : 'linux';
            const isWindows = currentPlatform === 'win32';

            const detailsWin = document.getElementById('detailsWindowsSettings');
            const detailsLin = document.getElementById('detailsLinuxSettings');
            const badgeWin = document.getElementById('badgeOsWindows');
            const badgeLin = document.getElementById('badgeOsLinux');
            const noticeWin = document.getElementById('noticeOsWindows');
            const noticeLin = document.getElementById('noticeOsLinux');

            if (isWindows) {
                if (detailsWin) detailsWin.open = true;
                if (detailsLin) {
                    detailsLin.open = false;
                    detailsLin.classList.add('is-inactive');
                }
                if (badgeWin) {
                    badgeWin.className = 'badge-os badge-os-active';
                    badgeWin.innerHTML = '<span class="os-status-dot"></span>Aktivní systém';
                }
                if (badgeLin) {
                    badgeLin.className = 'badge-os badge-os-inactive';
                    badgeLin.textContent = 'Dostupné pouze na Linuxu';
                }
                if (noticeLin) noticeLin.style.display = 'flex';
                if (detailsLin) {
                    detailsLin.querySelectorAll('input').forEach(inp => inp.disabled = true);
                }
            } else {
                if (detailsLin) detailsLin.open = true;
                if (detailsWin) {
                    detailsWin.open = false;
                    detailsWin.classList.add('is-inactive');
                }
                if (badgeLin) {
                    badgeLin.className = 'badge-os badge-os-active';
                    badgeLin.innerHTML = '<span class="os-status-dot"></span>Aktivní systém';
                }
                if (badgeWin) {
                    badgeWin.className = 'badge-os badge-os-inactive';
                    badgeWin.textContent = 'Dostupné pouze na Windows';
                }
                if (noticeWin) noticeWin.style.display = 'flex';
                if (detailsWin) {
                    detailsWin.querySelectorAll('input').forEach(inp => inp.disabled = true);
                }
            }

            // Windows Specific Settings
            const checkWinHighPriority = document.getElementById('checkWinHighPriority');
            if (checkWinHighPriority) checkWinHighPriority.checked = currentConfig.winHighPriority !== false;

            const checkWinDedicatedGpu = document.getElementById('checkWinDedicatedGpu');
            if (checkWinDedicatedGpu) checkWinDedicatedGpu.checked = currentConfig.winDedicatedGpu !== false;

            const checkWinWindowedOptimization = document.getElementById('checkWinWindowedOptimization');
            if (checkWinWindowedOptimization) checkWinWindowedOptimization.checked = currentConfig.winWindowedOptimization !== false;

            const checkWinDisableStickyKeys = document.getElementById('checkWinDisableStickyKeys');
            if (checkWinDisableStickyKeys) checkWinDisableStickyKeys.checked = currentConfig.winDisableStickyKeys !== false;

            const checkWinTrimMemory = document.getElementById('checkWinTrimMemory');
            if (checkWinTrimMemory) checkWinTrimMemory.checked = currentConfig.winTrimMemory !== false;

            // Linux & Wayland Performance Settings
            const checkGameMode = document.getElementById('checkGameMode');
            if (checkGameMode) checkGameMode.checked = currentConfig.enableGameMode !== false;

            const checkDiscreteGpu = document.getElementById('checkDiscreteGpu');
            if (checkDiscreteGpu) checkDiscreteGpu.checked = currentConfig.enableDiscreteGpu !== false;

            const checkZink = document.getElementById('checkZink');
            if (checkZink) checkZink.checked = !!currentConfig.enableZink;

            const checkDisableVsync = document.getElementById('checkDisableVsync');
            if (checkDisableVsync) checkDisableVsync.checked = !!currentConfig.disableVsync;

            const checkNativeWayland = document.getElementById('checkNativeWayland');
            if (checkNativeWayland) checkNativeWayland.checked = !!currentConfig.enableNativeWayland;

            // Universal Settings
            const checkDiscordRpc = document.getElementById('checkDiscordRpc');
            if (checkDiscordRpc) checkDiscordRpc.checked = currentConfig.enableDiscordRpc !== false;

            const checkAutoUpdateMods = document.getElementById('checkAutoUpdateMods');
            if (checkAutoUpdateMods) checkAutoUpdateMods.checked = currentConfig.autoUpdateMods !== false;

            const checkScreenshotClipboard = document.getElementById('checkScreenshotClipboard');
            if (checkScreenshotClipboard) checkScreenshotClipboard.checked = currentConfig.screenshotToClipboard !== false;

            const checkBorderlessFullscreen = document.getElementById('checkBorderlessFullscreen');
            if (checkBorderlessFullscreen) {
                checkBorderlessFullscreen.checked = currentConfig.borderlessFullscreen === true;
                if (checkBorderlessFullscreen.checked) {
                    const fullRadio = document.querySelector('input[name="res"][value="fullscreen"]');
                    if (fullRadio) fullRadio.checked = true;
                }
            }

            const jvmArgsInput = document.getElementById('jvmArgsInput');
            if (jvmArgsInput) jvmArgsInput.value = (currentConfig.customJvmArgs || '-XX:+UseZGC -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC').replace(/-XX:\+ZGenerational\s*/g, '').replace(/-XX:\+AlwaysPreTouch\s*/g, '').trim();

            const customEnvVarsInput = document.getElementById('customEnvVarsInput');
            if (customEnvVarsInput) customEnvVarsInput.value = currentConfig.customEnvVars || '';

            // Vyřešíme aktivní nebo naposledy hraný profil hned při načtení
            currentConfig.activeProfileId = resolveLaunchProfileId();
            const initialProf = (currentConfig.profiles || []).find(x => x.id === currentConfig.activeProfileId);
            if (initialProf) {
                currentConfig.version = initialProf.version;
                currentConfig.loader = initialProf.loader || 'fabric';
            }

            // Render Server Tracker & Profiles
            renderServerTracker();
            pingCustomServersInBackground();
            renderProfilesList();
            refreshVersionStatuses();
            detectAvailableJavas();
            checkWardenProbe();
            checkLauncherUpdates(true);

            // Check if Minecraft session is active / resumed from previous launch
            try {
                if (window.api && window.api.getActiveSession) {
                    const session = await window.api.getActiveSession();
                    if (session && session.running) {
                        isRunning = true;
                        runningProfileId = session.profileId || currentConfig.activeProfileId;
                        if (session.profileId) {
                            currentConfig.activeProfileId = session.profileId;
                        }
                        if (sidebarPlayBtn) {
                            sidebarPlayBtn.style.opacity = '1';
                            sidebarPlayBtn.style.background = '#ef4444';
                            sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop';
                        }
                        renderProfilesList();
                        refreshVersionStatuses();
                    }
                } else {
                    const gameRunning = await window.api.isGameRunning();
                    if (gameRunning) {
                        isRunning = true;
                        runningProfileId = currentConfig.activeProfileId;
                        if (sidebarPlayBtn) {
                            sidebarPlayBtn.style.opacity = '1';
                            sidebarPlayBtn.style.background = '#ef4444';
                            sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop';
                        }
                        renderProfilesList();
                        refreshVersionStatuses();
                    }
                }
            } catch (_) { }
        } catch (e) {
            console.error('Chyba při načítání konfigurace:', e);
        }
    }

    function updateSliderVisuals(slider, badgeEl, forceSnap = false) {
        if (!slider) return;
        const min = parseFloat(slider.min) !== undefined && !isNaN(parseFloat(slider.min)) ? parseFloat(slider.min) : 2;
        const max = parseFloat(slider.max) !== undefined && !isNaN(parseFloat(slider.max)) ? parseFloat(slider.max) : 16;
        let val = parseFloat(slider.value) !== undefined && !isNaN(parseFloat(slider.value)) ? parseFloat(slider.value) : min;

        if (forceSnap) {
            val = Math.round(val);
            slider.value = val;
            if (slider._smoothController) {
                slider._smoothController.syncTarget(val);
            }
        }

        const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
        slider.style.setProperty('--slider-fill', `${pct.toFixed(2)}%`);

        if (badgeEl) {
            const intVal = Math.round(val);
            const targetText = `${intVal} GB`;
            if (badgeEl.textContent !== targetText) {
                badgeEl.textContent = targetText;
                badgeEl.classList.remove('badge-bump');
                void badgeEl.offsetWidth;
                badgeEl.classList.add('badge-bump');
            }
        }
    }

    function setupSmoothSnapSlider(slider, badgeEl, options = {}) {
        if (!slider) return null;

        const {
            onSnapChange = null,
            onFinalize = null,
        } = options;

        let targetVal = Math.round(parseFloat(slider.value) || 4);
        let currentVisualVal = parseFloat(slider.value) || targetVal;
        let animFrameId = null;
        let isDragging = false;

        function getBounds() {
            const min = parseFloat(slider.min) !== undefined && !isNaN(parseFloat(slider.min)) ? parseFloat(slider.min) : 2;
            const max = parseFloat(slider.max) !== undefined && !isNaN(parseFloat(slider.max)) ? parseFloat(slider.max) : 16;
            return { min, max };
        }

        function syncVisuals() {
            updateSliderVisuals(slider, badgeEl, false);
        }

        function animateToTarget(immediate = false) {
            if (immediate) {
                if (animFrameId) {
                    cancelAnimationFrame(animFrameId);
                    animFrameId = null;
                }
                currentVisualVal = targetVal;
                slider.value = targetVal;
                syncVisuals();
                return;
            }

            if (animFrameId) return;

            let lastTime = performance.now();

            function step(now) {
                const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
                lastTime = now;

                const diff = targetVal - currentVisualVal;
                if (Math.abs(diff) < 0.008) {
                    currentVisualVal = targetVal;
                    slider.value = targetVal;
                    syncVisuals();
                    animFrameId = null;
                    return;
                }

                // Smooth exponential spring glide (~160ms)
                const factor = 1 - Math.exp(-24 * dt);
                currentVisualVal += diff * factor;
                slider.value = currentVisualVal.toFixed(3);
                syncVisuals();

                animFrameId = requestAnimationFrame(step);
            }

            animFrameId = requestAnimationFrame(step);
        }

        function setTarget(newVal, immediate = false, triggerChange = false) {
            const { min, max } = getBounds();
            const clamped = Math.max(min, Math.min(max, Math.round(Number(newVal) || min)));
            const changed = clamped !== targetVal;
            targetVal = clamped;

            if (badgeEl) {
                const targetText = `${targetVal} GB`;
                if (badgeEl.textContent !== targetText) {
                    badgeEl.textContent = targetText;
                    badgeEl.classList.remove('badge-bump');
                    void badgeEl.offsetWidth;
                    badgeEl.classList.add('badge-bump');
                }
            }

            if (changed && typeof onSnapChange === 'function') {
                onSnapChange(targetVal);
            }

            animateToTarget(immediate);

            if (triggerChange) {
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        function calculatePointerTarget(clientX) {
            const rect = slider.getBoundingClientRect();
            if (!rect.width) return targetVal;

            const thumbRadius = 11;
            const trackWidth = Math.max(1, rect.width - thumbRadius * 2);
            const pointerOffset = Math.max(0, Math.min(trackWidth, clientX - rect.left - thumbRadius));
            const ratio = pointerOffset / trackWidth;

            const { min, max } = getBounds();
            const rawVal = min + ratio * (max - min);

            // Hysteresis deadzone to prevent fluttering at borders
            let candidate = targetVal;
            if (rawVal > targetVal + 0.56) {
                candidate = Math.round(rawVal);
            } else if (rawVal < targetVal - 0.56) {
                candidate = Math.round(rawVal);
            }
            return Math.max(min, Math.min(max, candidate));
        }

        function onPointerMove(e) {
            if (!isDragging) return;
            const newTarget = calculatePointerTarget(e.clientX);
            if (newTarget !== targetVal) {
                setTarget(newTarget, false, false);
            }
        }

        function onPointerUp() {
            if (!isDragging) return;
            isDragging = false;
            slider.classList.remove('is-dragging');

            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);

            animateToTarget(false);

            if (typeof onFinalize === 'function') {
                onFinalize(targetVal);
            }

            slider.dispatchEvent(new Event('change', { bubbles: true }));
        }

        slider.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            slider.focus();
            isDragging = true;
            slider.classList.add('is-dragging');

            const newTarget = calculatePointerTarget(e.clientX);
            setTarget(newTarget, false, false);

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });

        // Keyboard navigation (Arrow keys)
        slider.addEventListener('keydown', (e) => {
            const { min, max } = getBounds();
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = Math.min(max, targetVal + 1);
                if (next !== targetVal) {
                    setTarget(next, false, true);
                    if (typeof onFinalize === 'function') onFinalize(next);
                }
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                const prev = Math.max(min, targetVal - 1);
                if (prev !== targetVal) {
                    setTarget(prev, false, true);
                    if (typeof onFinalize === 'function') onFinalize(prev);
                }
            }
        });

        // Mouse wheel adjustment
        slider.addEventListener('wheel', (e) => {
            e.preventDefault();
            const { min, max } = getBounds();
            if (e.deltaY < 0 || e.deltaX > 0) {
                const next = Math.min(max, targetVal + 1);
                if (next !== targetVal) {
                    setTarget(next, false, true);
                    if (typeof onFinalize === 'function') onFinalize(next);
                }
            } else if (e.deltaY > 0 || e.deltaX < 0) {
                const prev = Math.max(min, targetVal - 1);
                if (prev !== targetVal) {
                    setTarget(prev, false, true);
                    if (typeof onFinalize === 'function') onFinalize(prev);
                }
            }
        }, { passive: false });

        const controller = {
            setTarget,
            setValue: (v, imm = false) => setTarget(v, imm, false),
            getTarget: () => targetVal,
            syncVisuals,
            isDragging: () => isDragging,
            syncTarget: (v) => {
                const { min, max } = getBounds();
                const clamped = Math.max(min, Math.min(max, Math.round(Number(v) || min)));
                targetVal = clamped;
                currentVisualVal = clamped;
            }
        };

        slider._smoothController = controller;
        return controller;
    }

    function renderRamSliderMarks(maxGb, recGb) {
        const marksContainer = document.getElementById('ramSliderMarks') || document.querySelector('.slider-marks');
        if (!marksContainer) return;
        const min = 2;
        const max = maxGb || 16;
        const targetRec = (typeof recGb === 'number' && recGb > 0) ? recGb : (window._lastRecommendedRamGB || 8);

        // Clean landmarks within [min, max]
        const candidates = [4, 8, 16, 24, 32, 48, 64];
        if (targetRec > min && targetRec < max && !candidates.includes(targetRec)) {
            candidates.push(targetRec);
            candidates.sort((a, b) => a - b);
        }
        const points = [min];

        candidates.forEach(c => {
            if (c > min && c < max) {
                if (max - c >= 3 || c === targetRec) {
                    points.push(c);
                }
            }
        });

        if (!points.includes(max)) {
            points.push(max);
        }

        marksContainer.innerHTML = points.map((val, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === points.length - 1;
            const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
            const isRec = (val === targetRec);

            let label = `${val} GB`;
            let extraClass = '';
            if (isFirst) {
                extraClass = 'mark-start';
            } else if (isLast) {
                extraClass = 'mark-end';
                label = `${val} GB (Max)`;
            } else if (isRec) {
                extraClass = 'recommended';
            }

            return `<span class="slider-mark ${extraClass}" style="left: ${pct.toFixed(2)}%;" data-ram-val="${val}" title="Nastavit ${val} GB">${label}</span>`;
        }).join('');

        marksContainer.querySelectorAll('.slider-mark').forEach(mark => {
            mark.addEventListener('click', () => {
                const val = parseInt(mark.dataset.ramVal, 10);
                if (!isNaN(val)) {
                    if (ramSliderController) {
                        ramSliderController.setTarget(val, false, true);
                        currentConfig.ramMax = val;
                        autoSaveSettings(true);
                    } else if (ramSlider) {
                        ramSlider.value = val;
                        updateSliderVisuals(ramSlider, ramValueBadge, true);
                        currentConfig.ramMax = val;
                        autoSaveSettings(true);
                    }
                }
            });
        });
    }

    function updateUserUI(name, type, customSkin) {
        const isMicrosoft = type === 'microsoft';
        const msName = currentConfig.microsoftAccount?.name || currentConfig.microsoftAccount?.username;
        const displayName = isMicrosoft
            ? (msName || name || 'Hráč')
            : (currentConfig.offlineUsername || name || 'Hráč');

        if (greetingNick) greetingNick.textContent = displayName;
        if (heroNickLabel) heroNickLabel.textContent = displayName;
        const heroPlayerNick = document.getElementById('heroPlayerNick');
        if (heroPlayerNick) heroPlayerNick.textContent = displayName;
        const heroAccountTypeBadge = document.getElementById('heroAccountTypeBadge');
        if (heroAccountTypeBadge) {
            heroAccountTypeBadge.textContent = isMicrosoft ? 'Microsoft účet připojen' : 'Offline profil připraven';
        }
        if (inputNick) {
            inputNick.value = displayName;
            inputNick.readOnly = isMicrosoft;
            inputNick.disabled = isMicrosoft;
        }

        const nickLockBadge = document.getElementById('nickLockBadge');
        if (nickLockBadge) {
            nickLockBadge.style.display = isMicrosoft ? 'inline-block' : 'none';
        }

        const panelMs = document.getElementById('panelMicrosoftSkin');
        const panelOff = document.getElementById('panelOfflineSkin');
        const skinPathLabel = document.getElementById('offlineSkinPathLabel');
        const capePathLabel = document.getElementById('offlineCapePathLabel');

        if (isMicrosoft) {
            authMicrosoftBtn?.classList.add('active');
            authOfflineBtn?.classList.remove('active');
            if (panelMs) panelMs.style.display = 'flex';
            if (panelOff) panelOff.style.display = 'none';
            loadMojangCapes();
        } else {
            authOfflineBtn?.classList.add('active');
            authMicrosoftBtn?.classList.remove('active');
            if (panelMs) panelMs.style.display = 'none';
            if (panelOff) panelOff.style.display = 'flex';
            const offCapeSec = document.getElementById('offlineCapesSection');
            if (offCapeSec) offCapeSec.style.display = 'none';
            const equippedBadge = document.getElementById('equippedCapeBadge');
            if (equippedBadge) equippedBadge.style.display = 'none';
            activeMojangCapeUrl = null;
            updateSkinViewer3D(lastLoadedSkinUrl, null, currentConfig.customSkinVariant === 'slim');
            updateHeroSkinViewer3D(lastLoadedSkinUrl, null, currentConfig.customSkinVariant === 'slim');
        }

        // Labels for offline paths
        if (skinPathLabel) {
            skinPathLabel.textContent = currentConfig.customSkinPath
                ? currentConfig.customSkinPath.split(/[\/\\]/).pop()
                : 'Výchozí skin';
        }
        if (capePathLabel) {
            capePathLabel.textContent = currentConfig.customCapePath
                ? (currentConfig.customCapePath.startsWith('http') ? 'Vybraný plášť' : currentConfig.customCapePath.split(/[\/\\]/).pop())
                : 'Žádný plášť';
        }

        // Model variant buttons
        const isSlim = currentConfig.customSkinVariant === 'slim';
        const btnClassic = document.getElementById('btnVariantClassic');
        const btnSlim = document.getElementById('btnVariantSlim');
        if (btnClassic) btnClassic.classList.toggle('active', !isSlim);
        if (btnSlim) btnSlim.classList.toggle('active', isSlim);

        // Effective skin resolution
        const effectiveSkin = customSkin || currentConfig.customSkinPath || (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.skinUrl : null);
        const avatarUrl = (displayName.toLowerCase() === 'steve' || displayName.toLowerCase() === 'alex' || displayName === 'Hráč')
            ? (isSlim ? 'assets/default_alex.png' : 'assets/default_steve.png')
            : `https://minotar.net/avatar/${encodeURIComponent(displayName)}/24.png`;

        if (greetingAvatar) greetingAvatar.src = avatarUrl;
        if (skinCaption) skinCaption.textContent = `3D Náhled: ${displayName}`;

        const effectiveCape = getEffectiveCape();

        let skinSrc;
        if (effectiveSkin) {
            skinSrc = (effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://') || effectiveSkin.startsWith('assets/'))
                ? effectiveSkin
                : `file://${effectiveSkin}`;
        } else if (displayName.toLowerCase() === 'steve' || displayName.toLowerCase() === 'alex' || displayName === 'Hráč') {
            skinSrc = isSlim ? 'assets/default_alex.png' : 'assets/default_steve.png';
        } else {
            skinSrc = `https://minotar.net/skin/${encodeURIComponent(displayName)}`;
        }

        drawSkinToCanvas(skinSrc, isSlim);
        updateSkinViewer3D(skinSrc, effectiveCape, isSlim);
        updateHeroSkinViewer3D(skinSrc, effectiveCape, isSlim);
    }

    // ── Version Statuses & Interactivity ──────────────────────────────────
    async function refreshVersionStatuses() {
        try {
            installedVersions = await window.api.getInstalledVersions();
            const activeProfile = (currentConfig.profiles || []).find(p => p.id === currentConfig.activeProfileId);
            const activeVersion = activeProfile ? activeProfile.version : (currentConfig.version || '26.2');

            const runningProfile = (isRunning && runningProfileId) ? (currentConfig.profiles || []).find(p => p.id === runningProfileId) : null;
            const launchingProfile = (isLaunching && launchingProfileId) ? (currentConfig.profiles || []).find(p => p.id === launchingProfileId) : null;
            const effectiveRunningVersion = runningProfile ? runningProfile.version : (isRunning ? activeVersion : null);
            const effectiveLaunchingVersion = launchingProfile ? launchingProfile.version : (isLaunching ? activeVersion : null);

            const versions = ['26.2', '26.3', '1.21.11', '26.1.2'];
            for (const ver of versions) {
                const idSuffix = ver.replace(/\./g, '');
                const card = document.getElementById(`vCard${idSuffix}`);
                const statusBadge = document.getElementById(`vStatus${idSuffix}`);
                const btnAction = document.getElementById(`btnAction${idSuffix}`);
                const btnStop = document.getElementById(`btnStop${idSuffix}`);
                const progressBox = document.getElementById(`vProgressBox${idSuffix}`);
                const isInstalled = installedVersions.includes(ver);
                const isThisRunning = isRunning && (effectiveRunningVersion === ver);
                const isThisLaunching = isLaunching && (effectiveLaunchingVersion === ver);
                const isAnyOtherBusy = (isRunning || isLaunching) && !isThisRunning && !isThisLaunching;

                if (card) {
                    if (isThisRunning) {
                        card.classList.add('is-running');
                    } else {
                        card.classList.remove('is-running');
                    }
                }

                if (statusBadge) {
                    const label = statusBadge.querySelector('.v-status-label') || statusBadge;
                    if (isThisRunning) {
                        statusBadge.className = 'v-status-badge running';
                        label.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-pulse" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"></polygon></svg> Spuštěno';
                    } else if (isThisLaunching) {
                        statusBadge.className = 'v-status-badge downloading';
                        label.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Příprava / Stahování...';
                    } else if (isInstalled) {
                        statusBadge.className = 'v-status-badge installed';
                        label.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Nainstalováno';
                    } else {
                        statusBadge.className = 'v-status-badge';
                        label.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg> Připraveno ke stažení';
                    }
                }

                if (btnAction && btnStop) {
                    if (isThisRunning) {
                        btnAction.style.display = 'none';
                        btnStop.style.display = 'flex';
                    } else {
                        btnStop.style.display = 'none';
                        btnAction.style.display = 'flex';
                        if (isThisLaunching) {
                            btnAction.disabled = true;
                            btnAction.classList.remove('mc-btn-disabled');
                            btnAction.title = 'Probíhá spouštění / stahování...';
                            btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Načítání hry...</span>`;
                        } else if (isAnyOtherBusy) {
                            btnAction.disabled = true;
                            btnAction.classList.add('mc-btn-disabled');
                            btnAction.title = isRunning
                                ? 'Hra již běží. Před spuštěním nebo stažením jiné verze nejprve ukonči běžící instanci.'
                                : 'Probíhá spouštění nebo stahování jiné verze. Počkej prosím na dokončení.';
                            if (isInstalled) {
                                btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát Minecraft ${ver}</span>`;
                            } else {
                                btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout & Hrát ${ver}</span>`;
                            }
                        } else if (isInstalled) {
                            btnAction.disabled = false;
                            btnAction.classList.remove('mc-btn-disabled');
                            btnAction.title = '';
                            btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát Minecraft ${ver}</span>`;
                        } else {
                            btnAction.disabled = false;
                            btnAction.classList.remove('mc-btn-disabled');
                            btnAction.title = '';
                            btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout & Hrát ${ver}</span>`;
                        }
                    }
                }

                // Synchronizace výběru modloaderu (Vanilla / Fabric)
                const matchedProfile = (currentConfig.profiles || []).find(p => p.version === ver);
                const currentLoader = matchedProfile ? (matchedProfile.loader || 'vanilla') : 'vanilla';
                const loaderOptions = document.querySelector(`.v-loader-options[data-version="${ver}"]`);
                if (loaderOptions) {
                    loaderOptions.querySelectorAll('.v-loader-btn').forEach(lBtn => {
                        if (lBtn.dataset.loader === currentLoader) {
                            lBtn.classList.add('active');
                        } else {
                            lBtn.classList.remove('active');
                        }
                    });
                }

                if (progressBox && !isThisLaunching) {
                    progressBox.style.display = 'none';
                }
            }
        } catch (e) {
            console.warn('refreshVersionStatuses error:', e);
        }
    }

    // ── Server Tracker & Pinning Rendering ──────────────────────────────────
    function getSortedServers() {
        const servers = currentConfig.servers || [];
        return [...servers].sort((a, b) => {
            // Pinned servery mají přednost, pokud uživatel server explicitně připnul
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;

            // 1. Nejhranější servery podle počtu spuštění / připojení
            const countA = Number(a.playCount) || 0;
            const countB = Number(b.playCount) || 0;
            if (countB !== countA) return countB - countA;

            // 2. Podle odehraného času (sekundy)
            const timeA = Number(a.playtimeSeconds) || 0;
            const timeB = Number(b.playtimeSeconds) || 0;
            if (timeB !== timeA) return timeB - timeA;

            // 3. Podle času posledního připojení
            const lastA = Number(a.lastJoined) || 0;
            const lastB = Number(b.lastJoined) || 0;
            if (lastB !== lastA) return lastB - lastA;

            // 4. Výchozí fallback: Oficiální síť nahoře
            if (a.id === 'mychalsmp' || a.ip === 'mychalsmp.xyz') return -1;
            if (b.id === 'mychalsmp' || b.ip === 'mychalsmp.xyz') return 1;

            return 0;
        });
    }

    async function recordServerJoin(serverIpOrHost) {
        if (!serverIpOrHost) return;
        const cleanTarget = serverIpOrHost.toLowerCase().trim();
        const servers = currentConfig.servers || [];
        let matched = false;

        for (const s of servers) {
            const ip = (s.ip || '').toLowerCase();
            const sub = (s.subdomain || '').toLowerCase();
            const backup = (s.backupIp || '').toLowerCase();
            const isMychal = (cleanTarget.includes('mychalsmp') || cleanTarget === '130.61.89.37') && (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz');

            if (ip === cleanTarget || sub === cleanTarget || backup === cleanTarget || isMychal) {
                s.playCount = (Number(s.playCount) || 0) + 1;
                s.lastJoined = Date.now();
                matched = true;
                break;
            }
        }

        if (matched) {
            try {
                await window.api.saveConfig({ servers });
                renderServerTracker();
                renderServersFullTab();
            } catch (e) {
                console.warn('[SERVER TRACKER] Nelze uložit statistiku serveru:', e);
            }
        }
    }

    function renderServerTracker() {
        if (!trackedServersList) return;
        const servers = getSortedServers();

        trackedServersList.innerHTML = servers.map(s => {
            const isMychal = s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz';
            const iconSrc = isMychal ? 'assets/server-icon.png' : (s.icon || 'assets/server-icon.png');
            const offlineCross = (!isMychal && s.online === false)
                ? '<span class="server-offline-cross-badge" title="Server neodpovídá / je offline"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></span>'
                : '';
            return `
                <div class="tracked-server-item">
                    <div style="position: relative; flex-shrink: 0;">
                        <img src="${escapeHtml(iconSrc)}" class="item-server-icon" onerror="this.src='assets/server-icon.png'">
                        ${offlineCross}
                    </div>
                    <div class="item-info">
                        <div class="item-name-row">
                            <span class="item-name">${escapeHtml(s.name)}</span>
                            ${!isMychal ? `<button class="btn-del-server" data-server-id="${escapeHtml(s.id)}" title="Odebrat server"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
                        </div>
                        <div class="item-ip">${escapeHtml(s.ip)}</div>
                    </div>
                    <div class="tracked-server-actions">
                        <button class="btn-quick-join" data-server="${escapeHtml(s.ip)}" title="Připojit se">
                            <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span>Hrát</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Bind quick join buttons
        trackedServersList.querySelectorAll('.btn-quick-join').forEach(btn => {
            btn.addEventListener('click', () => {
                if (isRunning) {
                    showToast('Hra již běží. Před připojením k serveru nejprve ukonči běžící hru.', 'error');
                    return;
                }
                if (isLaunching) {
                    showToast('Probíhá spouštění nebo stahování verze. Počkej na dokončení.', 'warning');
                    return;
                }
                const srv = btn.dataset.server;
                const targetProfileId = resolveLaunchProfileId();
                recordServerJoin(srv);
                selectActiveProfile(targetProfileId);
                startLaunch(targetProfileId, srv);
            });
        });

        // Bind delete buttons
        trackedServersList.querySelectorAll('.btn-del-server').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sid = btn.dataset.serverId;
                deleteServer(sid);
            });
        });
    }

    function renderServersFullTab() {
        const fullList = document.getElementById('serversFullList');
        if (!fullList) return;
        const servers = getSortedServers();

        fullList.innerHTML = servers.map(s => {
            const isMychal = s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz';
            const isPinned = !!s.pinned;
            const port = s.port || 25565;
            const iconSrc = isMychal ? 'assets/server-icon.png' : (s.icon || 'assets/server-icon.png');
            const statusHtml = (!isMychal && s.online === false)
                ? '<span class="server-status-pill offline"><span class="status-dot offline"></span> Offline</span>'
                : (isMychal
                    ? '<span class="server-status-pill official">Oficiální síť</span>'
                    : (s.online ? '<span class="server-status-pill online"><span class="status-dot online"></span> Online</span>' : ''));
            const playCount = Number(s.playCount) || 0;
            const playMeta = playCount > 0 ? `<span class="server-play-meta">• ${playCount}× hráno</span>` : '';

            return `
                <div class="server-full-card">
                    <div style="position: relative; flex-shrink: 0;">
                        <img src="${escapeHtml(iconSrc)}" class="server-full-icon" onerror="this.src='assets/server-icon.png'">
                        ${(!isMychal && s.online === false) ? '<span class="server-offline-cross-badge"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></span>' : ''}
                    </div>
                    <div class="server-full-info">
                        <div class="server-full-name-row">
                            <span class="server-full-name">${escapeHtml(s.name)}</span>
                            ${statusHtml}
                            ${!isMychal ? `<button class="btn-del-server btn-del-server--inline" data-server-id="${escapeHtml(s.id)}" title="Odstranit server"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
                        </div>
                        <div class="server-full-ip">${escapeHtml(s.ip)} ${playMeta}</div>
                    </div>
                    <div class="server-full-actions">
                        <button class="btn-quick-join btn-quick-join--lg" data-server="${escapeHtml(s.ip)}" title="Připojit se na server">
                            <svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span>Hrát</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Bind quick join buttons
        fullList.querySelectorAll('.btn-quick-join').forEach(btn => {
            btn.addEventListener('click', () => {
                if (isRunning) {
                    showToast('Hra již běží. Před připojením k serveru nejprve ukonči běžící hru.', 'error');
                    return;
                }
                if (isLaunching) {
                    showToast('Probíhá spouštění nebo stahování verze. Počkej na dokončení.', 'warning');
                    return;
                }
                const srv = btn.dataset.server;
                const targetProfileId = resolveLaunchProfileId();
                recordServerJoin(srv);
                selectActiveProfile(targetProfileId);
                startLaunch(targetProfileId, srv);
            });
        });

        // Bind delete buttons
        fullList.querySelectorAll('.btn-del-server').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sid = btn.dataset.serverId;
                deleteServer(sid);
            });
        });
    }

    async function pingCustomServersInBackground() {
        const servers = currentConfig.servers || [];
        let hasChanges = false;
        for (const s of servers) {
            if (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz') continue;
            try {
                const res = await window.api.pingServer(s.ip, s.port || 25565);
                if (res && res.online) {
                    if (s.online !== true || (res.favicon && s.icon !== res.favicon)) {
                        s.online = true;
                        if (res.favicon) s.icon = res.favicon;
                        hasChanges = true;
                    }
                } else {
                    if (s.online !== false) {
                        s.online = false;
                        hasChanges = true;
                    }
                }
            } catch (e) {
                if (s.online !== false) {
                    s.online = false;
                    hasChanges = true;
                }
            }
        }
        if (hasChanges) {
            renderServerTracker();
            renderServersFullTab();
            try { await window.api.saveConfig({ servers: currentConfig.servers }); } catch (e) { }
        }
    }

    async function togglePinServer(serverId) {
        const servers = currentConfig.servers || [];
        const target = servers.find(s => s.id === serverId);
        if (target) {
            target.pinned = !target.pinned;
            await window.api.saveConfig({ servers });
            renderServerTracker();
            renderServersFullTab();
            showToast(target.pinned ? `Server "${target.name}" připnut.` : `Server "${target.name}" odepnut.`, 'info');
        }
    }

    async function deleteServer(serverId) {
        const servers = currentConfig.servers || [];
        const target = servers.find(s => s.id === serverId);
        if (!target) return;
        if (confirm(`Opravdu chceš smazat server "${target.name}" ze seznamu?`)) {
            const filtered = servers.filter(s => s.id !== serverId);
            currentConfig.servers = filtered;
            await window.api.saveConfig({ servers: filtered });
            renderServerTracker();
            renderServersFullTab();
            showToast(`Server "${target.name}" byl odebrán.`, 'info');
        }
    }

    // Modal Add Server controls
    const modalAddServer = document.getElementById('modalAddServer');
    const btnCloseAddServerModal = document.getElementById('btnCloseAddServerModal');
    const btnCancelAddServer = document.getElementById('btnCancelAddServer');
    const btnConfirmAddServer = document.getElementById('btnConfirmAddServer');
    const newServerNameInput = document.getElementById('newServerNameInput');
    const newServerIpInput = document.getElementById('newServerIpInput');
    const newServerPinnedCheck = document.getElementById('newServerPinnedCheck');
    const btnOpenAddServerTab = document.getElementById('btnOpenAddServerTab');

    const newServerPreviewIcon = document.getElementById('newServerPreviewIcon');
    const newServerOfflineCross = document.getElementById('newServerOfflineCross');
    const newServerStatusDot = document.getElementById('newServerStatusDot');
    const newServerStatusBadge = document.getElementById('newServerStatusBadge');
    const newServerPingDetails = document.getElementById('newServerPingDetails');
    let addServerPingDebounce = null;
    let currentDetectedServerIcon = null;
    let currentDetectedServerOnline = false;

    function resetAddServerPreview() {
        if (addServerPingDebounce) clearTimeout(addServerPingDebounce);
        currentDetectedServerIcon = null;
        currentDetectedServerOnline = false;
        if (newServerPreviewIcon) newServerPreviewIcon.src = 'assets/server-icon.png';
        if (newServerOfflineCross) newServerOfflineCross.style.display = 'none';
        if (newServerStatusDot) {
            newServerStatusDot.className = 'status-dot';
            newServerStatusDot.style.background = '#64748b';
        }
        if (newServerStatusBadge) {
            newServerStatusBadge.textContent = 'Zadej IP adresu serveru...';
            newServerStatusBadge.style.color = '#94a3b8';
        }
        if (newServerPingDetails) {
            newServerPingDetails.textContent = 'Automatická detekce dostupnosti, latence a ikony';
        }
    }

    function openAddServerModal() {
        if (!modalAddServer) return;
        if (newServerNameInput) newServerNameInput.value = '';
        if (newServerIpInput) newServerIpInput.value = '';
        if (newServerPinnedCheck) newServerPinnedCheck.checked = true;
        resetAddServerPreview();
        modalAddServer.style.display = 'flex';
        setTimeout(() => newServerIpInput?.focus(), 50);
    }

    function closeAddServerModal() {
        if (modalAddServer) modalAddServer.style.display = 'none';
        resetAddServerPreview();
    }

    if (newServerIpInput) {
        newServerIpInput.addEventListener('input', () => {
            if (addServerPingDebounce) clearTimeout(addServerPingDebounce);
            const val = newServerIpInput.value.trim();
            if (!val) {
                resetAddServerPreview();
                return;
            }

            if (newServerStatusBadge) {
                newServerStatusBadge.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Ověřuji server...';
                newServerStatusBadge.style.color = '#38bdf8';
            }
            if (newServerStatusDot) {
                newServerStatusDot.className = 'status-dot';
                newServerStatusDot.style.background = '#38bdf8';
            }

            addServerPingDebounce = setTimeout(async () => {
                let cleanIp = val;
                let port = 25565;
                if (cleanIp.includes(':')) {
                    const parts = cleanIp.split(':');
                    cleanIp = parts[0].trim();
                    port = parseInt(parts[1], 10) || 25565;
                }

                try {
                    const status = await window.api.pingServer(cleanIp, port);
                    if (status && status.online) {
                        currentDetectedServerOnline = true;
                        currentDetectedServerIcon = status.favicon || null;
                        if (newServerPreviewIcon) {
                            newServerPreviewIcon.src = status.favicon || 'assets/server-icon.png';
                        }
                        if (newServerOfflineCross) newServerOfflineCross.style.display = 'none';
                        if (newServerStatusDot) {
                            newServerStatusDot.className = 'status-dot';
                            newServerStatusDot.style.background = '#21DE00';
                        }
                        if (newServerStatusBadge) {
                            newServerStatusBadge.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Online (${status.latency} ms) • ${status.players.online}/${status.players.max} hráčů`;
                            newServerStatusBadge.style.color = '#21DE00';
                        }
                        if (newServerPingDetails) {
                            newServerPingDetails.textContent = status.motd ? status.motd.split('\n')[0].replace(/§./g, '').trim() : `${cleanIp}:${port}`;
                        }
                        // If name is empty, auto-suggest
                        if (newServerNameInput && !newServerNameInput.value.trim()) {
                            const suggested = status.motd ? status.motd.split('\n')[0].replace(/§./g, '').trim().slice(0, 32) : cleanIp;
                            newServerNameInput.value = suggested || cleanIp;
                        }
                    } else {
                        throw new Error('Server neodpovídá');
                    }
                } catch (e) {
                    currentDetectedServerOnline = false;
                    currentDetectedServerIcon = null;
                    if (newServerPreviewIcon) newServerPreviewIcon.src = 'assets/server-icon.png';
                    if (newServerOfflineCross) newServerOfflineCross.style.display = 'flex';
                    if (newServerStatusDot) {
                        newServerStatusDot.className = 'status-dot offline';
                        newServerStatusDot.style.background = '#f51515';
                    }
                    if (newServerStatusBadge) {
                        newServerStatusBadge.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Server neodpovídá (offline / neplatná adresa)';
                        newServerStatusBadge.style.color = '#f51515';
                    }
                    if (newServerPingDetails) {
                        newServerPingDetails.textContent = 'Zkontroluj správnost IP adresy nebo portu.';
                    }
                }
            }, 450);
        });
    }

    if (btnAddCustomServer) btnAddCustomServer.addEventListener('click', openAddServerModal);
    if (btnOpenAddServerTab) btnOpenAddServerTab.addEventListener('click', openAddServerModal);
    if (btnCloseAddServerModal) btnCloseAddServerModal.addEventListener('click', closeAddServerModal);
    if (btnCancelAddServer) btnCancelAddServer.addEventListener('click', closeAddServerModal);

    if (btnConfirmAddServer) {
        btnConfirmAddServer.addEventListener('click', async () => {
            const rawIp = newServerIpInput?.value?.trim() || '';
            if (!rawIp) {
                showToast('Zadej IP adresu serveru.', 'error');
                return;
            }

            let cleanIp = rawIp;
            let port = 25565;
            if (cleanIp.includes(':')) {
                const parts = cleanIp.split(':');
                cleanIp = parts[0].trim();
                port = parseInt(parts[1], 10) || 25565;
            }

            const rawName = newServerNameInput?.value?.trim() || cleanIp;
            const isPinned = !!(newServerPinnedCheck?.checked);

            const newServer = {
                id: 'srv-' + Date.now(),
                name: rawName,
                ip: cleanIp,
                port: port,
                pinned: isPinned,
                icon: currentDetectedServerIcon || null,
                online: currentDetectedServerOnline,
                lastJoined: null,
                playCount: 0,
                playtimeSeconds: 0
            };

            const existing = currentConfig.servers || [];
            currentConfig.servers = [...existing, newServer];
            await window.api.saveConfig({ servers: currentConfig.servers });

            closeAddServerModal();
            renderServerTracker();
            renderServersFullTab();
            showToast(`Server "${rawName}" přidán${isPinned ? ' a připnut' : ''}.`, 'success');
        });
    }

    // ── Mod Safety Check & Quick Play Protection ──
    let currentIllegalMods = [];

    async function checkWardenProbe() {
        const banner = document.getElementById('wardenBlockedAlert');
        const countText = document.getElementById('wardenBlockedCountText');
        const btnQuick = document.getElementById('btnQuickPlayMychal');

        try {
            const scan = await window.api.checkWardenProbe(currentConfig.activeProfileId);
            if (scan && !scan.clean) {
                currentIllegalMods = scan.illegalMods || [];
                if (banner) banner.style.display = 'flex';
                if (countText) {
                    countText.textContent = `${scan.blockedCount} nepovolených módů v profilu`;
                }
                if (btnQuick) {
                    btnQuick.classList.add('mc-btn-blocked');
                    btnQuick.title = 'Quick Play zablokován: Nalezeny nepovolené módy.';
                }
            } else {
                currentIllegalMods = [];
                if (banner) banner.style.display = 'none';
                if (btnQuick) {
                    btnQuick.classList.remove('mc-btn-blocked');
                    btnQuick.title = 'Rychlé připojení na MYCHAL SMP';
                }
            }
        } catch (e) {
            console.error('[MOD CHECK] Kontrola selhala:', e);
        }
    }

    function openWardenModal() {
        const modal = document.getElementById('wardenModal');
        const list = document.getElementById('wardenIllegalModsList');
        if (!modal) return;

        if (list) {
            if (currentIllegalMods.length === 0) {
                list.innerHTML = '<div class="cape-loading-hint">Nebyly nalezeny žádné nepovolené módy. Profil je čistý!</div>';
            } else {
                list.innerHTML = currentIllegalMods.map(m => `
                    <div class="illegal-mod-item">
                        <div class="illegal-mod-meta">
                            <div class="illegal-mod-name-row">
                                <span class="illegal-mod-name">${escapeHtml(m.modName)}</span>
                                <span class="illegal-mod-pill">${escapeHtml(m.categoryLabel)}</span>
                            </div>
                            <span class="illegal-mod-file"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> ${escapeHtml(m.filename)}</span>
                            <span class="illegal-mod-reason"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> ${escapeHtml(m.reason)}</span>
                        </div>
                        <button class="btn-disable-single-mod" data-filename="${escapeHtml(m.filename)}">Zakázat (.disabled)</button>
                    </div>
                `).join('');

                list.querySelectorAll('.btn-disable-single-mod').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const fn = btn.dataset.filename;
                        btn.disabled = true;
                        btn.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Zakazuji...';
                        await window.api.disableIllegalMods(currentConfig.activeProfileId, fn);
                        showToast(`Mód ${fn} byl přejmenován na .disabled`, 'info');
                        await checkWardenProbe();
                        openWardenModal();
                    });
                });
            }
        }

        modal.style.display = 'flex';
    }

    function closeWardenModal() {
        const modal = document.getElementById('wardenModal');
        if (modal) modal.style.display = 'none';
    }

    const btnOpenWardenModal = document.getElementById('btnOpenWardenModal');
    if (btnOpenWardenModal) btnOpenWardenModal.addEventListener('click', () => openWardenModal());

    const btnCloseWardenModal = document.getElementById('btnCloseWardenModal');
    if (btnCloseWardenModal) btnCloseWardenModal.addEventListener('click', () => closeWardenModal());

    const btnIgnoreWardenClose = document.getElementById('btnIgnoreWardenClose');
    if (btnIgnoreWardenClose) btnIgnoreWardenClose.addEventListener('click', () => closeWardenModal());

    const btnLaunchWithoutSmp = document.getElementById('btnLaunchWithoutSmp');
    if (btnLaunchWithoutSmp) {
        btnLaunchWithoutSmp.addEventListener('click', () => {
            if (isRunning) {
                showToast('Hra již běží. Před spuštěním jiné verze nejprve ukonči běžící hru.', 'error');
                return;
            }
            if (isLaunching) {
                showToast('Probíhá spouštění nebo stahování jiné verze.', 'warning');
                return;
            }
            closeWardenModal();
            appendLog('[PROFIL] Spouštím hru bez připojení k serveru MYCHAL SMP (módy povoleny pro singleplayer a jiné servery)...');
            showToast('Spouštím hru bez připojení k SMP – módy povoleny.', 'info');
            const targetProfileId = resolveLaunchProfileId(currentConfig.activeProfileId);
            startLaunch(targetProfileId, null);
        });
    }

    const btnCleanIllegalMods = document.getElementById('btnCleanIllegalMods');
    if (btnCleanIllegalMods) {
        btnCleanIllegalMods.addEventListener('click', async () => {
            btnCleanIllegalMods.disabled = true;
            btnCleanIllegalMods.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Zakazuji módy...</span>';
            try {
                const res = await window.api.disableIllegalMods(currentConfig.activeProfileId, null);
                showToast(`Nepovolené módy (${res.disabledCount}) deaktivovány.`, 'success');
                appendLog(`Zakázáno ${res.disabledCount} nepovolených módů z profilu.`);
                closeWardenModal();
                await checkWardenProbe();
            } catch (e) {
                showToast('Chyba: ' + e.message, 'error');
            } finally {
                btnCleanIllegalMods.disabled = false;
                btnCleanIllegalMods.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg> Deaktivovat módy</span>';
            }
        });
    }

    // ── Quick Play MYCHAL SMP Banner ────────────────────────────────────────
    if (btnQuickPlayMychal) {
        btnQuickPlayMychal.addEventListener('pointerenter', () => {
            if (!isRunning && !isLaunching && typeof prewarmLaunchEnvironment === 'function') {
                prewarmLaunchEnvironment();
            }
        }, { passive: true });

        btnQuickPlayMychal.addEventListener('click', async () => {
            if (isRunning) {
                showToast('Hra již běží. Před připojením k serveru nejprve ukonči běžící instanci.', 'error');
                return;
            }
            if (isLaunching) {
                showToast('Probíhá spouštění nebo stahování verze. Počkej prosím na dokončení.', 'warning');
                return;
            }
            const targetProfileId = resolveLaunchProfileId();
            selectActiveProfile(targetProfileId);

            const scan = await window.api.checkWardenProbe(targetProfileId);
            if (scan && !scan.clean) {
                currentIllegalMods = scan.illegalMods || [];
                showToast('Quick Play zablokován: V profilu jsou nepovolené módy pro MYCHAL SMP.', 'error');
                openWardenModal();
                return;
            }
            recordServerJoin('mychalsmp.xyz');
            startLaunch(targetProfileId, 'mychalsmp.xyz');
        });
    }

    // ── GitHub Auto-Update Service ──────────────────────────────────────────
    let pendingUpdateData = null;

    async function checkLauncherUpdates(silent = true) {
        const chip = document.getElementById('updateChip');
        const updateText = document.getElementById('updateText');
        try {
            const update = await window.api.checkForUpdates();
            const versionStatus = document.getElementById('launcherVersionStatus');
            if (versionStatus && update && update.currentVersion) {
                versionStatus.innerHTML = `Nainstalovaná verze: <strong>v${update.currentVersion}</strong>${update.hasUpdate ? ` • <span style="color: #4ade80; font-weight: 600;">Dostupná nová verze v${update.latestVersion}</span>` : ' • <span style="color: #94a3b8;">Aktuální</span>'}`;
            }

            if (update && update.hasUpdate) {
                pendingUpdateData = update;
                if (chip) {
                    chip.style.display = 'flex';
                    if (updateText) updateText.textContent = `Nová verze v${update.latestVersion}`;
                }
                if (!silent) {
                    openUpdateModal(update);
                }
            } else {
                if (chip) chip.style.display = 'none';
                if (!silent) {
                    showToast('Launcher je aktuální (verze v' + (update?.currentVersion || '1.4.7') + ')', 'info');
                }
            }
            return update;
        } catch (e) {
            console.error('[AUTO-UPDATE] Kontrola aktualizací selhala:', e);
            throw e;
        }
    }

    const updateModal = document.getElementById('updateModal');
    const updateProgressContainer = document.getElementById('updateProgressContainer');
    const updateProgressBar = document.getElementById('updateProgressBar');
    const updateProgressText = document.getElementById('updateProgressText');
    const updateProgressSize = document.getElementById('updateProgressSize');
    const updateCountdownContainer = document.getElementById('updateCountdownContainer');
    const updateCountdownSec = document.getElementById('updateCountdownSec');
    const updateModalFoot = document.getElementById('updateModalFoot');
    let isUpdatingCurrently = false;

    // Příjem průběžných dat o stahování a instalaci aktualizace
    if (window.api && window.api.onUpdateProgress) {
        window.api.onUpdateProgress((data) => {
            if (!updateProgressContainer) return;
            updateProgressContainer.style.display = 'block';

            if (data.status === 'downloading') {
                const rawPct = data.percent || 0;
                const pct = calculatePerceptualProgress(rawPct);
                if (updateProgressBar) updateProgressBar.style.width = `${pct}%`;
                if (updateProgressText) {
                    const stepLabel = data.isDiff ? 'Stahuji bleskový balíček změn...' : (data.step || 'Stahuji aktualizaci...');
                    updateProgressText.textContent = `${stepLabel} ${pct} %`;
                }
                if (updateProgressSize && data.total) {
                    if (data.total < 1048576) {
                        const curKb = Math.round(data.current / 1024);
                        const totKb = Math.round(data.total / 1024);
                        updateProgressSize.textContent = `${curKb} KB / ${totKb} KB`;
                    } else {
                        const curMb = (data.current / 1048576).toFixed(1);
                        const totMb = (data.total / 1048576).toFixed(1);
                        updateProgressSize.textContent = `${curMb} MB / ${totMb} MB`;
                    }
                }
            } else if (data.status === 'extracting') {
                const pct = Math.max(90, calculatePerceptualProgress(data.percent || 90));
                if (updateProgressBar) updateProgressBar.style.width = `${pct}%`;
                if (updateProgressText) {
                    updateProgressText.textContent = data.step || 'Aplikuji aktualizaci do launcheru...';
                }
                if (updateProgressSize) updateProgressSize.textContent = 'Instalace';
            } else if (data.status === 'installing') {
                if (updateProgressBar) updateProgressBar.style.width = '100%';
                if (updateProgressText) {
                    updateProgressText.textContent = data.step || 'Aktualizace byla úspěšně připravena!';
                }
                if (updateProgressSize) updateProgressSize.textContent = '100 %';
            }
        });
    }

    function openUpdateModal(update) {
        const modal = document.getElementById('updateModal');
        const title = document.getElementById('updateModalTitle');
        const desc = document.getElementById('updateModalDesc');
        const notes = document.getElementById('updateReleaseNotes');
        if (!modal) return;

        if (title) title.textContent = `Aktualizace v${update.latestVersion || ''}`;
        if (desc) {
            desc.textContent = `K dispozici je verze v${update.latestVersion || ''} (nainstalováno: v${update.currentVersion || '1.0.0'}).`;
            desc.style.display = 'block';
        }

        const notesBox = document.getElementById('updateReleaseNotesBox');
        if (notes && update.releaseNotes) {
            let cleanNotes = String(update.releaseNotes).trim();
            if (cleanNotes.startsWith('**Full Changelog**:') || cleanNotes.includes('/compare/')) {
                cleanNotes = cleanNotes.replace(/\*\*Full Changelog\*\*:[^\n]*/gi, '').trim();
            }
            if (cleanNotes) {
                notes.textContent = cleanNotes;
                notes.style.display = 'block';
                if (notesBox) notesBox.style.display = 'block';
            } else {
                notes.textContent = 'Aktualizace a vylepšení launcheru.';
                notes.style.display = 'block';
                if (notesBox) notesBox.style.display = 'block';
            }
        } else if (notes) {
            notes.style.display = 'none';
            if (notesBox) notesBox.style.display = 'none';
        }

        // Reset progress, icon & countdown
        const iconWrap = document.getElementById('updateModalIconWrap');
        if (iconWrap) {
            iconWrap.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--lg ui-icon-svg--blue" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;
        }
        if (updateProgressContainer) updateProgressContainer.style.display = 'none';
        if (updateProgressBar) updateProgressBar.style.width = '0%';
        if (updateCountdownContainer) updateCountdownContainer.style.display = 'none';
        if (updateModalFoot) updateModalFoot.style.display = 'flex';

        const btnConfirm = document.getElementById('btnConfirmUpdate');
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Aktualizovat</span>';
        }

        modal.style.display = 'flex';
    }

    function closeUpdateModal() {
        if (isUpdatingCurrently) return;
        const modal = document.getElementById('updateModal');
        if (modal) modal.style.display = 'none';
    }

    const updateChip = document.getElementById('updateChip');
    if (updateChip) {
        updateChip.addEventListener('click', () => {
            if (pendingUpdateData) {
                openUpdateModal(pendingUpdateData);
            }
        });
    }

    const btnUpdateChip = document.getElementById('btnUpdateChip');
    if (btnUpdateChip) {
        btnUpdateChip.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pendingUpdateData) {
                openUpdateModal(pendingUpdateData);
            }
        });
    }

    const btnManualCheckUpdate = document.getElementById('btnManualCheckUpdate');
    if (btnManualCheckUpdate) {
        let isCheckingUpdates = false;
        btnManualCheckUpdate.addEventListener('click', async () => {
            if (isCheckingUpdates) return;
            if (btnManualCheckUpdate.classList.contains('is-available') && pendingUpdateData) {
                openUpdateModal(pendingUpdateData);
                return;
            }

            isCheckingUpdates = true;
            const updateCard = btnManualCheckUpdate.closest('.update-checker-card');
            const origHTML = `
                <svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                <span>Zkontrolovat</span>
            `;

            // Spustit vizuální kontrolu s horním specular odleskem na kartě
            if (updateCard) updateCard.classList.add('card-is-checking');
            btnManualCheckUpdate.classList.remove('is-success', 'is-error', 'is-available');
            btnManualCheckUpdate.classList.add('is-checking');
            btnManualCheckUpdate.innerHTML = `
                <svg class="ui-icon-svg ui-icon-svg--sm icon-spin-smooth" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                    <path d="M3 3v5h5"></path>
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                    <path d="M16 21h5v-5"></path>
                </svg>
                <span>Hledám...</span>
            `;

            try {
                // Minimální perception práh (850ms) pro plynulý, prémiový pocit
                const [update] = await Promise.all([
                    checkLauncherUpdates(true),
                    new Promise((resolve) => setTimeout(resolve, 850))
                ]);

                if (updateCard) updateCard.classList.remove('card-is-checking');
                btnManualCheckUpdate.classList.remove('is-checking');

                if (update && update.hasUpdate) {
                    btnManualCheckUpdate.classList.add('is-available');
                    btnManualCheckUpdate.innerHTML = `
                        <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span>Aktualizovat</span>
                    `;
                    setTimeout(() => {
                        if (pendingUpdateData) openUpdateModal(pendingUpdateData);
                    }, 500);
                } else {
                    btnManualCheckUpdate.classList.add('is-success');
                    btnManualCheckUpdate.innerHTML = `
                        <svg class="ui-icon-svg ui-icon-svg--xs checkmark-spring" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Aktuální</span>
                    `;
                    const versionStatus = document.getElementById('launcherVersionStatus');
                    if (versionStatus && update && update.currentVersion) {
                        versionStatus.innerHTML = `Nainstalovaná verze: <strong>v${update.currentVersion}</strong> • <span class="update-status-fresh">Aktuální ✓</span>`;
                    }
                    showToast('Launcher je plně aktuální (v' + (update?.currentVersion || '1.4.7') + ')', 'info');

                    setTimeout(() => {
                        btnManualCheckUpdate.classList.remove('is-success');
                        btnManualCheckUpdate.innerHTML = origHTML;
                        isCheckingUpdates = false;
                    }, 2200);
                    return;
                }
            } catch (err) {
                if (updateCard) updateCard.classList.remove('card-is-checking');
                btnManualCheckUpdate.classList.remove('is-checking');
                btnManualCheckUpdate.classList.add('is-error');
                btnManualCheckUpdate.innerHTML = `
                    <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <span>Chyba sítě</span>
                `;
                showToast('Nepodařilo se zkontrolovat aktualizace.', 'error');
                setTimeout(() => {
                    btnManualCheckUpdate.classList.remove('is-error');
                    btnManualCheckUpdate.innerHTML = origHTML;
                    isCheckingUpdates = false;
                }, 2200);
                return;
            }

            isCheckingUpdates = false;
        });
    }

    const btnCloseUpdateModal = document.getElementById('btnCloseUpdateModal');
    if (btnCloseUpdateModal) btnCloseUpdateModal.addEventListener('click', () => closeUpdateModal());

    const btnDismissUpdate = document.getElementById('btnDismissUpdate');
    if (btnDismissUpdate) btnDismissUpdate.addEventListener('click', () => closeUpdateModal());

    const btnConfirmUpdate = document.getElementById('btnConfirmUpdate');
    if (btnConfirmUpdate) {
        btnConfirmUpdate.addEventListener('click', async () => {
            if (!pendingUpdateData || isUpdatingCurrently) return;
            if (typeof autoSaveSettings === 'function') {
                await autoSaveSettings(true);
            }
            isUpdatingCurrently = true;
            btnConfirmUpdate.disabled = true;

            const title = document.getElementById('updateModalTitle');
            const desc = document.getElementById('updateModalDesc');
            const notes = document.getElementById('updateReleaseNotes');

            if (title) title.textContent = 'Stahování aktualizace';
            if (desc) desc.style.display = 'none';
            if (notes) notes.style.display = 'none';
            const notesBox = document.getElementById('updateReleaseNotesBox');
            if (notesBox) notesBox.style.display = 'none';
            if (updateModalFoot) updateModalFoot.style.display = 'none';

            if (updateProgressContainer) {
                updateProgressContainer.style.display = 'block';
                if (updateProgressBar) updateProgressBar.style.width = '12%';
                if (updateProgressText) updateProgressText.textContent = 'Připojuji a zahajuji stahování...';
                if (updateProgressSize) updateProgressSize.textContent = 'Příprava';
            }

            try {
                const assets = pendingUpdateData.assets || [];
                const deltaAsset = assets.find(a => a.name === 'update-v3.asar' || a.name === 'update-v2.asar' || a.name === 'update.asar' || a.name === 'app.asar');
                const tarAsset = assets.find(a => a.name.endsWith('.tar.gz'));
                const downloadUrl = pendingUpdateData.downloadUrl || (deltaAsset ? deltaAsset.downloadUrl : (tarAsset ? tarAsset.downloadUrl : (assets[0] ? assets[0].downloadUrl : pendingUpdateData.releaseUrl)));

                const res = await window.api.applyUpdate(downloadUrl);
                if (res && res.applied) {
                    if (updateProgressBar) updateProgressBar.style.width = '100%';
                    if (updateProgressText) updateProgressText.textContent = 'Aktualizace byla úspěšně připravena!';
                    if (updateProgressSize) updateProgressSize.textContent = '100 %';

                    // Plynulá prodleva 650 ms, aby uživatel jasně viděl dokončení progress baru a neprobliklo to
                    await new Promise(r => setTimeout(r, 650));

                    if (updateProgressContainer) updateProgressContainer.style.display = 'none';
                    if (desc) desc.style.display = 'none';
                    if (updateModalFoot) updateModalFoot.style.display = 'none';
                    if (title) title.textContent = 'Aktualizace dokončena';

                    const iconWrap = document.getElementById('updateModalIconWrap');
                    if (iconWrap) {
                        iconWrap.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--lg ui-icon-svg--green" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="16 9 10 15 7 12"></polyline></svg>`;
                    }

                    if (updateCountdownContainer) updateCountdownContainer.style.display = 'block';

                    let countdown = 3;
                    if (updateCountdownSec) updateCountdownSec.textContent = countdown;

                    const countdownFill = document.getElementById('updateCountdownFill');
                    if (countdownFill) {
                        countdownFill.style.transition = 'none';
                        countdownFill.style.width = '100%';
                        void countdownFill.offsetWidth;
                        countdownFill.style.transition = 'width 3s linear';
                        countdownFill.style.width = '0%';
                    }

                    let isRestarting = false;
                    let interval = null;
                    const doRestart = async () => {
                        if (isRestarting) return;
                        isRestarting = true;
                        if (interval) clearInterval(interval);
                        try {
                            await window.api.restartLauncher();
                        } catch (e) {
                            console.error('[UPDATER] Chyba restartu launcheru:', e);
                            showToast('Chyba při restartu launcheru: ' + (e.message || e), 'error');
                            isUpdatingCurrently = false;
                            isRestarting = false;
                            if (updateCountdownContainer) updateCountdownContainer.style.display = 'none';
                            if (updateModalFoot) updateModalFoot.style.display = 'flex';
                        }
                    };

                    const btnRestartNow = document.getElementById('btnRestartNow');
                    if (btnRestartNow) {
                        btnRestartNow.onclick = () => doRestart();
                    }

                    interval = setInterval(async () => {
                        countdown--;
                        if (updateCountdownSec) updateCountdownSec.textContent = countdown;
                        if (countdown <= 0) {
                            clearInterval(interval);
                            await doRestart();
                        }
                    }, 1000);
                } else if (res && res.openedInBrowser) {
                    showToast('Odkaz na stažení byl otevřen v prohlížeči.', 'info');
                    isUpdatingCurrently = false;
                    closeUpdateModal();
                }
            } catch (err) {
                isUpdatingCurrently = false;
                showToast('Chyba při aktualizaci: ' + err.message, 'error');
                const title = document.getElementById('updateModalTitle');
                const desc = document.getElementById('updateModalDesc');
                if (title) title.textContent = 'Chyba aktualizace';
                if (desc) desc.style.display = 'block';
                if (updateProgressContainer) updateProgressContainer.style.display = 'none';
                if (updateModalFoot) updateModalFoot.style.display = 'flex';
                if (btnConfirmUpdate) {
                    btnConfirmUpdate.disabled = false;
                    btnConfirmUpdate.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Zkusit znovu</span>';
                }
            }
        });
    }

    let hasUserManuallySelectedProfile = false;

    function resolveLaunchProfileId(preferredId) {
        const profiles = currentConfig.profiles || [];
        if (profiles.length === 0) return 'minecraft-26.2';

        if (preferredId) {
            const foundPref = profiles.find(p => p.id === preferredId);
            if (foundPref) return foundPref.id;
        }

        // 1. Profil, který právě běží (isRunning)
        const currentRunningId = runningProfileId || currentConfig.activeProfileId;
        if (isRunning && currentRunningId) {
            const runningProf = profiles.find(p => p.id === currentRunningId);
            if (runningProf) return runningProf.id;
        }

        // 2. Profil, který má uživatel vybraný v launcheru (aktivní profil)
        if (hasUserManuallySelectedProfile && currentConfig.activeProfileId) {
            const activeProf = profiles.find(p => p.id === currentConfig.activeProfileId);
            if (activeProf) return activeProf.id;
        }

        // 3. Profil, který uživatel naposledy hrál (s nejnovějším lastPlayed timestampem)
        const playedProfiles = profiles.filter(p => {
            const ts = (typeof p.lastPlayed === 'number' && p.lastPlayed > 0) ? p.lastPlayed : (parseInt(p.lastPlayed, 10) || 0);
            return ts > 0;
        });
        if (playedProfiles.length > 0) {
            const mostRecentPlayed = [...playedProfiles].sort((a, b) => {
                const aTs = (typeof a.lastPlayed === 'number' && a.lastPlayed > 0) ? a.lastPlayed : (parseInt(a.lastPlayed, 10) || 0);
                const bTs = (typeof b.lastPlayed === 'number' && b.lastPlayed > 0) ? b.lastPlayed : (parseInt(b.lastPlayed, 10) || 0);
                return bTs - aTs;
            })[0];
            if (mostRecentPlayed) return mostRecentPlayed.id;
        }

        // 4. Defaultní serverový profil MYCHALSMP, pokud existuje
        const foundMychal = profiles.find(p => p.id === 'mychalsmp-26.2' || p.id === 'mychalsmp');
        if (foundMychal) return foundMychal.id;

        if (currentConfig.activeProfileId) {
            const activeProf = profiles.find(p => p.id === currentConfig.activeProfileId);
            if (activeProf) return activeProf.id;
        }

        return profiles[0].id;
    }

    // Seřadí profily přesně podle reality hraní: 1. Běžící hra, 2. Čas posledního hraní (lastPlayed), 3. Herní čas
    function getSortedProfiles() {
        const profiles = currentConfig.profiles || [];
        if (!Array.isArray(profiles) || profiles.length === 0) return [];

        const activeId = currentConfig.activeProfileId;
        const targetRunningId = runningProfileId || (isRunning ? activeId : null);

        return [...profiles].sort((a, b) => {
            // 1. Profil, který právě běží (isRunning), je VŽDY na 1. místě
            const aRunning = isRunning && targetRunningId && (a.id === targetRunningId);
            const bRunning = isRunning && targetRunningId && (b.id === targetRunningId);
            if (aRunning && !bRunning) return -1;
            if (!aRunning && bRunning) return 1;

            // 2. Čas posledního hraní (lastPlayed timestamp v ms) – nejnovější nahoře
            const aLast = (typeof a.lastPlayed === 'number' && a.lastPlayed > 0) ? a.lastPlayed : (parseInt(a.lastPlayed, 10) || 0);
            const bLast = (typeof b.lastPlayed === 'number' && b.lastPlayed > 0) ? b.lastPlayed : (parseInt(b.lastPlayed, 10) || 0);
            if (aLast !== bLast) {
                return bLast - aLast;
            }

            // 3. Celkový odehraný čas (playtimeSeconds) – profily s více odehraným časem nahoře
            const aPlaytime = Number(a.playtimeSeconds) || 0;
            const bPlaytime = Number(b.playtimeSeconds) || 0;
            if (aPlaytime !== bPlaytime) {
                return bPlaytime - aPlaytime;
            }

            // 4. Přirozené pořadí verzí sítě: 26.3 -> 26.2 -> 26.1.2 -> 1.21.11
            const getVersionPriority = (ver) => {
                const v = String(ver || '').toLowerCase();
                if (v.includes('26.3')) return 40;
                if (v.includes('26.2')) return 30;
                if (v.includes('26.1')) return 20;
                if (v.includes('1.21.11') || v.includes('1.21')) return 10;
                return 0;
            };
            const prioDiff = getVersionPriority(b.version) - getVersionPriority(a.version);
            if (prioDiff !== 0) {
                return prioDiff;
            }

            // 5. Stabilní abecední pořadí podle názvu
            return (a.name || '').localeCompare(b.name || '');
        });
    }

    // ── Version Key Arts (Background Artworks) ──────────────────────────────
    function resolveKeyartUrl(versionStr) {
        if (!availableKeyartsMap || Object.keys(availableKeyartsMap).length === 0) {
            return 'assets/keyarts/default.jpg';
        }
        if (!versionStr) {
            return availableKeyartsMap['26.2'] || availableKeyartsMap['default'] || null;
        }

        const raw = String(versionStr).toLowerCase().trim();
        // 1. Přímá shoda (např. '1.21.11', '26.3', '26.2', '26.1')
        if (availableKeyartsMap[raw]) {
            return availableKeyartsMap[raw];
        }

        // 2. Extrakce verze (např. 'minecraft-1.21.11' nebo 'Minecraft 26.2')
        const match = raw.match(/\d+(\.\d+)*/);
        if (match) {
            const vNum = match[0];
            if (availableKeyartsMap[vNum]) {
                return availableKeyartsMap[vNum];
            }

            // 3. Fallback na major.minor (např. 26.1.2 -> 26.1)
            const parts = vNum.split('.');
            if (parts.length > 2) {
                const shortV = `${parts[0]}.${parts[1]}`;
                if (availableKeyartsMap[shortV]) {
                    return availableKeyartsMap[shortV];
                }
            }

            // Fallback pro 1.21 rodinu -> 1.21.11
            if (vNum.startsWith('1.21') && availableKeyartsMap['1.21.11']) {
                return availableKeyartsMap['1.21.11'];
            }

            if (parts.length > 1) {
                const majorV = parts[0];
                if (availableKeyartsMap[majorV]) {
                    return availableKeyartsMap[majorV];
                }
                if (majorV === '26' && availableKeyartsMap['26.2']) {
                    return availableKeyartsMap['26.2'];
                }
            }
        }

        // 4. Default fallback
        return availableKeyartsMap['default'] || availableKeyartsMap['26.2'] || null;
    }

    function resolveCardKeyartUrl(versionStr) {
        if (!availableKeyartsMap || Object.keys(availableKeyartsMap).length === 0) {
            return BUNDLED_CARD_KEYARTS['26.2'] || 'assets/keyarts/default.jpg';
        }
        if (!versionStr) {
            return availableKeyartsMap['card-26.2'] || BUNDLED_CARD_KEYARTS['26.2'] || null;
        }

        const raw = String(versionStr).toLowerCase().trim();
        // 1. Přímá shoda (card-26.2, card-26.3, card-1.21.11, card-26.1)
        if (availableKeyartsMap[`card-${raw}`]) return availableKeyartsMap[`card-${raw}`];
        if (BUNDLED_CARD_KEYARTS[raw]) return BUNDLED_CARD_KEYARTS[raw];

        // 2. Extrakce verze z názvu
        const match = raw.match(/\d+(\.\d+)*/);
        if (match) {
            const vNum = match[0];
            if (availableKeyartsMap[`card-${vNum}`]) return availableKeyartsMap[`card-${vNum}`];
            if (BUNDLED_CARD_KEYARTS[vNum]) return BUNDLED_CARD_KEYARTS[vNum];

            // 3. Fallback pro major.minor (např. 26.1.2 -> card-26.1)
            const parts = vNum.split('.');
            if (parts.length > 2) {
                const shortV = `${parts[0]}.${parts[1]}`;
                if (availableKeyartsMap[`card-${shortV}`]) return availableKeyartsMap[`card-${shortV}`];
                if (BUNDLED_CARD_KEYARTS[shortV]) return BUNDLED_CARD_KEYARTS[shortV];
            }

            // Fallback pro 1.21 rodinu
            if (vNum.startsWith('1.21')) {
                if (availableKeyartsMap['card-1.21.11']) return availableKeyartsMap['card-1.21.11'];
                if (BUNDLED_CARD_KEYARTS['1.21.11']) return BUNDLED_CARD_KEYARTS['1.21.11'];
            }

            if (parts.length > 1 && parts[0] === '26') {
                if (availableKeyartsMap['card-26.2']) return availableKeyartsMap['card-26.2'];
                if (BUNDLED_CARD_KEYARTS['26.2']) return BUNDLED_CARD_KEYARTS['26.2'];
            }
        }

        // 4. Fallback na plný keyart
        return resolveKeyartUrl(versionStr);
    }

    let currentHeroKeyartUrl = null;
    let lastActiveProfileIndex = -1;

    function updateHeroKeyart(versionStr, direction = 'auto') {
        const container = document.getElementById('heroKeyartContainer') || document.getElementById('heroKeyartBg')?.parentElement;
        if (!container) return;

        const keyartUrl = resolveKeyartUrl(versionStr);

        // Zjistit aktuální URL pozadí z existující vrstvy pokud ještě není inicializováno
        if (currentHeroKeyartUrl === null) {
            const initialLayer = container.querySelector('.stage-keyart-active') || document.getElementById('heroKeyartBg');
            if (initialLayer && initialLayer.style.backgroundImage) {
                const match = initialLayer.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
                if (match) currentHeroKeyartUrl = match[1];
            }
        }

        // Stejný keyart a vrstva už je aktivní -> žádná nová animace není potřeba
        if (keyartUrl === currentHeroKeyartUrl && container.querySelector('.stage-keyart-active')) {
            return;
        }

        currentHeroKeyartUrl = keyartUrl;

        // Automatické určení směru posunu (zprava nebo zleva podle pořadí profilů v seznamu)
        let slideDirection = direction;
        if (slideDirection === 'auto') {
            const profiles = currentConfig?.profiles || [];
            const currentIndex = profiles.findIndex(p => p.id === currentConfig?.activeProfileId);
            if (currentIndex !== -1 && lastActiveProfileIndex !== -1) {
                slideDirection = currentIndex >= lastActiveProfileIndex ? 'right' : 'left';
            } else {
                slideDirection = 'right';
            }
            lastActiveProfileIndex = currentIndex;
        }

        const oldLayer = container.querySelector('.stage-keyart-active') || container.querySelector('.stage-keyart-layer, #heroKeyartBg');

        if (!keyartUrl) {
            if (oldLayer) {
                oldLayer.className = `stage-keyart-layer ${slideDirection === 'right' ? 'stage-keyart-leaving-left' : 'stage-keyart-leaving-right'}`;
                setTimeout(() => { try { oldLayer.remove(); } catch (_) { } }, 720);
            }
            return;
        }

        // Vytvoření nové vrstvy s počátečním motion-blur posunem
        const newLayer = document.createElement('div');
        const enterClass = slideDirection === 'right' ? 'stage-keyart-entering-right' : 'stage-keyart-entering-left';
        newLayer.className = `stage-keyart-layer ${enterClass}`;
        newLayer.style.backgroundImage = `url("${keyartUrl}")`;
        container.appendChild(newLayer);

        // Stará vrstva se plynule odsune a rozmaže s motion-blurem
        if (oldLayer) {
            const leaveClass = slideDirection === 'right' ? 'stage-keyart-leaving-left' : 'stage-keyart-leaving-right';
            oldLayer.className = `stage-keyart-layer ${leaveClass}`;
            setTimeout(() => {
                try { oldLayer.remove(); } catch (_) { }
            }, 720);
        }

        // Dva snímky rAF pro bezpečné spuštění CSS transform/filter animace
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                newLayer.className = 'stage-keyart-layer stage-keyart-active';
            });
        });
    }

    // ── Profile List Rendering & Interactive Selection ──────────────────────
    function renderProfilesList() {
        const list = document.getElementById('profileCardsList');
        if (!list) return;

        const profiles = currentConfig.profiles || [];
        const activeId = resolveLaunchProfileId();
        currentConfig.activeProfileId = activeId;

        const activeProfile = profiles.find(p => p.id === activeId);
        const heroActiveProfileEl = document.getElementById('heroActiveProfileName');
        if (heroActiveProfileEl && activeProfile) {
            const loaderTag = (activeProfile.loader && activeProfile.loader !== 'vanilla') ? ` (${activeProfile.loader})` : '';
            heroActiveProfileEl.textContent = `${activeProfile.name}${loaderTag}`;
        }
        if (btnQuickPlayMychal && activeProfile) {
            const loaderTag = (activeProfile.loader && activeProfile.loader !== 'vanilla') ? ` • ${activeProfile.loader}` : '';
            btnQuickPlayMychal.title = `Rychlé připojení na MYCHAL SMP (${activeProfile.name}${loaderTag})`;
        }

        updateHeroKeyart(activeProfile ? activeProfile.version : currentConfig.version);

        const totalSec = profiles.reduce((acc, p) => acc + (p.playtimeSeconds || 0), 0);
        const heroPlaytimeEl = document.getElementById('heroTotalPlaytimeVal');
        if (heroPlaytimeEl) {
            heroPlaytimeEl.textContent = totalSec >= 60 ? formatPlaytime(totalSec) : 'Zatím nehráno';
        }

        const hasAnyPlayed = profiles.some(p => p.lastPlayed);
        const headingTitle = document.getElementById('profilesSectionTitle');
        const headingIcon = document.getElementById('profilesSectionIcon');
        if (headingTitle) {
            headingTitle.textContent = hasAnyPlayed ? 'Naposledy hrané profily' : 'Dostupné herní profily';
        }
        if (headingIcon) {
            headingIcon.innerHTML = hasAnyPlayed
                ? '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
                : '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="4"></rect><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="11" x2="15.01" y2="11"></line><line x1="18" y1="13" x2="18.01" y2="13"></line></svg>';
        }

        const sortedProfiles = getSortedProfiles();

        // Zajistíme striktní unikátnost: v launcheru může být přesně JEDNA "nejhranější" verze (Iron Golem)
        // a přesně JEDNA "nejnovější" verze (Tráva). Všechny ostatní verze jsou klasické/starší (Hlína).
        let singleMostPlayedId = null;
        const playedProfiles = sortedProfiles.filter(p => (typeof p.playtimeSeconds === 'number' && p.playtimeSeconds > 0));
        if (playedProfiles.length > 0) {
            const topPlayed = [...playedProfiles].sort((a, b) => (b.playtimeSeconds || 0) - (a.playtimeSeconds || 0))[0];
            singleMostPlayedId = topPlayed ? topPlayed.id : null;
        } else {
            const mychalProf = sortedProfiles.find(p => p.id === 'mychalsmp-26.2' || p.id === 'mychalsmp' || (p.name && p.name.toUpperCase().includes('MYCHALSMP')));
            singleMostPlayedId = mychalProf ? mychalProf.id : (activeId || (sortedProfiles[0] ? sortedProfiles[0].id : null));
        }

        let singleNewestId = null;
        const newestProf = sortedProfiles.find(p => {
            const ver = (p.version || '');
            const icon = (p.icon || '').toLowerCase();
            return icon === 'latest' || icon === 'newest' || ver.startsWith('26.3') || (p.id && p.id.includes('26.3'));
        });
        if (newestProf && newestProf.id !== singleMostPlayedId) {
            singleNewestId = newestProf.id;
        }

        const resolveProfile3DIcon = (profile) => {
            if (!profile) return 'assets/icons/old.png';

            // 1. Unikátní nejhranější profil (Iron Golem hlava)
            if (profile.id === singleMostPlayedId) {
                return 'assets/icons/mostplayed.png';
            }

            // 2. Unikátní nejnovější verze (Tráva)
            if (profile.id === singleNewestId) {
                return 'assets/icons/newest.png';
            }

            // 3. Všechny ostatní verze (Hlína)
            return 'assets/icons/old.png';
        };

        list.innerHTML = sortedProfiles.map(p => {
            const isActive = p.id === activeId;
            const pKeyart = resolveCardKeyartUrl(p.version);
            const keyartBgStyle = pKeyart ? `background-image: url('${escapeHtml(pKeyart)}');` : '';
            const iconUrl = resolveProfile3DIcon(p);

            const playtimeStr = (p.playtimeSeconds && p.playtimeSeconds >= 60)
                ? `Odehráno: ${formatPlaytime(p.playtimeSeconds)}`
                : 'Zatím nehráno';
            const lastPlayedStr = p.lastPlayed ? `Naposledy: ${formatLastPlayed(p.lastPlayed)}` : null;
            const loaderTag = (p.loader && p.loader !== 'vanilla') ? `${p.loader.charAt(0).toUpperCase() + p.loader.slice(1)}` : null;

            const metaParts = [loaderTag, `Verze ${p.version}`, playtimeStr, lastPlayedStr].filter(Boolean);
            const meta = metaParts.join(' • ');

            const isThisRunning = isRunning && runningProfileId && (p.id === runningProfileId);
            const isThisLaunching = isLaunching && launchingProfileId && (p.id === launchingProfileId);
            const isBlocked = (isRunning || isLaunching) && !isThisRunning && !isThisLaunching;

            const isInst = Array.isArray(installedVersions) && installedVersions.includes(p.version);
            let launchBtnClass = 'mc-btn btn-launch-profile';
            let launchBtnAttrs = `data-profile-id="${escapeHtml(p.id)}"`;
            let launchBtnContent = '';

            if (isThisRunning) {
                launchBtnClass += ' mc-btn-red btn-stop-running';
                launchBtnAttrs += ' title="Kliknutím ukončíš běžící hru"';
                launchBtnContent = '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop';
            } else if (isThisLaunching) {
                launchBtnClass += ' mc-btn-primary';
                launchBtnAttrs += ' disabled title="Probíhá spouštění / stahování hry..."';
                launchBtnContent = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Spouštím...';
            } else if (isBlocked) {
                launchBtnClass += ' mc-btn-primary mc-btn-disabled';
                const blockedTooltip = isRunning
                    ? 'Hra již běží. Před spuštěním nebo stažením jiné verze nejprve ukonči běžící instanci.'
                    : 'Probíhá spouštění nebo stahování jiné verze. Počkej prosím na dokončení.';
                launchBtnAttrs += ` disabled title="${escapeHtml(blockedTooltip)}"`;
                launchBtnContent = isInst
                    ? '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát'
                    : '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout';
            } else {
                launchBtnClass += ' mc-btn-primary';
                launchBtnContent = isInst
                    ? '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát'
                    : '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout';
            }

            return `
                <div class="profile-row-card ${isActive ? 'active-profile' : ''}" data-profile-id="${escapeHtml(p.id)}">
                    ${pKeyart ? `<div class="profile-card-keyart-bg" style="${keyartBgStyle}"></div><div class="profile-card-keyart-overlay"></div>` : ''}
                    <div class="profile-icon-box">
                        <img src="${escapeHtml(iconUrl)}" class="profile-3d-float-icon" alt="${escapeHtml(p.name || '')}" draggable="false" />
                    </div>
                    <div class="profile-details">
                        <div class="profile-title-line">
                            <span class="p-name">${escapeHtml(p.name)}</span>
                        </div>
                        <div class="p-meta">${escapeHtml(meta)}</div>
                    </div>
                    <div class="profile-card-right">
                        <div class="profile-actions">
                            <button class="profile-tool-btn btn-profile-settings" data-profile-id="${escapeHtml(p.id)}" title="Nastavení profilu">
                                <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            </button>
                            <button class="${launchBtnClass}" ${launchBtnAttrs}>
                                <span>${launchBtnContent}</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Bind card click for selection
        list.querySelectorAll('.profile-row-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, .profile-tool-btn')) return;
                const pid = card.dataset.profileId;
                if (isRunning && runningProfileId && pid !== runningProfileId) {
                    showToast('Hra již běží. Před výběrem jiného profilu nejprve ukonči běžící hru.', 'info');
                    return;
                }
                selectActiveProfile(pid);
            });
        });

        // Bind Play buttons
        list.querySelectorAll('.btn-launch-profile').forEach(btn => {
            btn.addEventListener('pointerenter', () => {
                if (!btn.disabled && typeof prewarmLaunchEnvironment === 'function') {
                    prewarmLaunchEnvironment(btn.dataset.profileId);
                }
            }, { passive: true });
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (btn.disabled) return;
                const pid = btn.dataset.profileId;
                const isThisRunning = isRunning && (runningProfileId ? pid === runningProfileId : pid === currentConfig.activeProfileId);
                if (isThisRunning) {
                    if (confirm('Chceš ukončit běžící Minecraft proces?')) {
                        markUserRequestedStop();
                        try {
                            await window.api.killGame();
                        } catch (err) { }
                        resetPlayState();
                    }
                    return;
                }
                if (isRunning) {
                    showToast('Hra již běží. Před spuštěním nebo stažením jiné verze nejprve ukonči běžící hru.', 'error');
                    return;
                }
                if (isLaunching) {
                    showToast('Probíhá stahování nebo spouštění jiné verze. Počkej prosím na dokončení.', 'warning');
                    return;
                }
                try {
                    selectActiveProfile(pid);
                    await startLaunch(pid, null);
                } catch (launchErr) {
                    console.error('[LAUNCH ERROR]', launchErr);
                    showToast('Nepodařilo se spustit hru.', 'error');
                }
            });
        });


        // Bind Settings buttons (Gear icon) to open Profile Settings Modal
        list.querySelectorAll('.btn-profile-settings').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = btn.dataset.profileId;
                openProfileSettingsModal(pid);
            });
        });

        // Bind Delete buttons (Trash icon) to remove and uninstall profile
        list.querySelectorAll('.btn-profile-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (btn.disabled || isRunning || isLaunching) {
                    showToast(isRunning ? 'Nelze mazat profily během běhu hry.' : 'Nelze mazat profily během stahování / spouštění.', 'warning');
                    return;
                }
                const pid = btn.dataset.profileId;
                const p = (currentConfig.profiles || []).find(x => x.id === pid);
                const pName = p ? p.name : pid;
                if ((currentConfig.profiles || []).length <= 1) {
                    showToast('V launcheru musí zůstat alespoň jeden profil.', 'warning');
                    return;
                }
                const isConfirmed = confirm(
                    `Opravdu chceš odebrat a odinstalovat profil "${pName}"?\n\n` +
                    `Tato akce profil odstraní a odinstaluje soubory verze, které nepoužívá žádný jiný profil.`
                );
                if (!isConfirmed) return;

                btn.disabled = true;
                try {
                    const res = await window.api.deleteProfile(pid);
                    if (res && res.success) {
                        showToast(`Profil "${pName}" byl odebrán a odinstalován.`, 'success');
                        await loadConfiguration();
                        renderProfilesList();
                    } else {
                        showToast(res?.error || 'Profil se nepodařilo odebrat.', 'error');
                        btn.disabled = false;
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
                    btn.disabled = false;
                }
            });
        });
    }

    function selectActiveProfile(profileId, isManual = true) {
        if (isRunning && runningProfileId && profileId !== runningProfileId) {
            return;
        }
        if (isManual) {
            hasUserManuallySelectedProfile = true;
        }
        currentConfig.activeProfileId = profileId;
        const p = (currentConfig.profiles || []).find(x => x.id === profileId);
        if (p) {
            currentConfig.version = p.version;
            currentConfig.loader = p.loader || 'vanilla';
            updateHeroKeyart(p.version);
            window.api.saveConfig({
                activeProfileId: profileId,
                version: p.version,
                loader: p.loader || 'vanilla'
            });
            appendLog(`[PROFIL] Aktivován profil: ${p.name} (${p.version}, zavaděč: ${(p.loader || 'vanilla').toUpperCase()})`);
            const heroActiveProfileEl = document.getElementById('heroActiveProfileName');
            if (heroActiveProfileEl) {
                const loaderTag = (p.loader && p.loader !== 'vanilla') ? ` (${p.loader})` : '';
                heroActiveProfileEl.textContent = `${p.name}${loaderTag}`;
                heroActiveProfileEl.classList.remove('val-pulse');
                void heroActiveProfileEl.offsetWidth;
                heroActiveProfileEl.classList.add('val-pulse');
            }
            if (btnQuickPlayMychal) {
                const loaderTag = (p.loader && p.loader !== 'vanilla') ? ` • ${p.loader}` : '';
                btnQuickPlayMychal.title = `Rychlé připojení na MYCHAL SMP (${p.name}${loaderTag})`;
            }
            const isInst = Array.isArray(installedVersions) && installedVersions.includes(p.version);
            if (sideConsoleStatus && !isRunning && !isLaunching) {
                sideConsoleStatus.textContent = isInst
                    ? 'Klient je připraven ke spuštění.'
                    : `Verze ${p.version} není nainstalována.`;
            }
        } else {
            window.api.saveConfig({ activeProfileId: profileId });
        }
        checkWardenProbe();

        document.querySelectorAll('.profile-row-card').forEach(c => {
            if (c.dataset.profileId === profileId) {
                c.classList.add('active-profile');
            } else {
                c.classList.remove('active-profile');
            }
        });
    }

    let hoverPreloadTimer = null;
    let lastHoverPreloadedPid = null;

    function prewarmLaunchEnvironment(profileId) {
        if (hoverPreloadTimer) clearTimeout(hoverPreloadTimer);
        hoverPreloadTimer = setTimeout(() => {
            const targetPid = profileId || resolveLaunchProfileId();
            if (targetPid === lastHoverPreloadedPid) return;
            lastHoverPreloadedPid = targetPid;
            if (window.api && window.api.preloadLaunchEnvironment) {
                window.api.preloadLaunchEnvironment(targetPid).catch(() => { });
            }
        }, 160);
    }

    if (sidebarPlayBtn) {
        sidebarPlayBtn.addEventListener('click', () => {
            if (isRunning) {
                if (confirm('Chceš ukončit běžící Minecraft proces?')) {
                    markUserRequestedStop();
                    window.api.killGame().catch(console.error);
                    resetPlayState();
                }
                return;
            }
            if (isLaunching) {
                showToast('Probíhá spouštění nebo stahování verze. Počkej prosím na dokončení.', 'warning');
                return;
            }
            const targetProfileId = resolveLaunchProfileId();
            selectActiveProfile(targetProfileId, true);
            startLaunch(targetProfileId, null);
        });
        sidebarPlayBtn.addEventListener('pointerenter', () => {
            if (!isRunning && !isLaunching) {
                prewarmLaunchEnvironment();
            }
        }, { passive: true });
    }

    // Version tab installer buttons & stop buttons
    document.querySelectorAll('.btn-install-v').forEach(btn => {
        btn.addEventListener('pointerenter', () => {
            if (btn.disabled || isRunning || isLaunching) return;
            const ver = btn.dataset.version;
            const pid = currentConfig.activeProfileId || `minecraft-${ver}`;
            prewarmLaunchEnvironment(pid);
        }, { passive: true });
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            if (isRunning) {
                showToast('Hra již běží. Před spuštěním nebo stažením jiné verze nejprve ukonči běžící instanci.', 'error');
                return;
            }
            if (isLaunching) {
                showToast('Probíhá stahování nebo spouštění jiné verze. Počkej prosím na dokončení.', 'warning');
                return;
            }
            const ver = btn.dataset.version;
            const profiles = currentConfig.profiles || [];
            let matchedProfile = profiles.find(p => p.id === currentConfig.activeProfileId && p.version === ver);
            if (!matchedProfile) {
                matchedProfile = profiles.find(p => p.version === ver);
            }
            const pid = matchedProfile ? matchedProfile.id : (currentConfig.activeProfileId || `minecraft-${ver}`);
            selectActiveProfile(pid);
            appendLog(`[PROFIL] Spouštím verzi ${ver}...`);
            refreshVersionStatuses();
            startLaunch(pid, null);
        });
    });

    document.querySelectorAll('.btn-stop-v').forEach(btn => {
        btn.addEventListener('click', async () => {
            appendLog('[LAUNCHER] Zastavuji herní proces na přání uživatele...');
            markUserRequestedStop();
            try {
                await window.api.killGame();
            } catch (e) { }
            resetPlayState();
            refreshVersionStatuses();
        });
    });

    // Version tab modloader selection pills (Vanilla / Fabric)
    document.querySelectorAll('.v-loader-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const parent = btn.closest('.v-loader-options');
            if (!parent) return;
            const ver = parent.dataset.version;
            const loader = btn.dataset.loader || 'vanilla';

            parent.querySelectorAll('.v-loader-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const profiles = currentConfig.profiles || [];
            let matchedAny = false;
            profiles.forEach(p => {
                if (p.version === ver) {
                    p.loader = loader;
                    matchedAny = true;
                }
            });
            const activeProfile = profiles.find(p => p.id === currentConfig.activeProfileId);
            if (activeProfile && activeProfile.version === ver) {
                currentConfig.loader = loader;
            } else if (!activeProfile || matchedAny) {
                currentConfig.loader = loader;
            }
            await window.api.saveConfig({ profiles, loader: currentConfig.loader });
            showToast(`Zavaděč pro verzi ${ver} nastaven na: ${loader.toUpperCase()}`, 'info');
            appendLog(`[PROFIL] Verze ${ver} nastavena na zavaděč: ${loader.toUpperCase()}`);
            refreshVersionStatuses();
            renderProfilesList();
        });
    });

    const btnCancelDownload = document.getElementById('btnCancelDownload');
    if (btnCancelDownload) {
        btnCancelDownload.addEventListener('click', async () => {
            if (isRunning) {
                appendLog('[LAUNCHER] Ukončuji běžící instanci Minecraftu...');
                if (progressText) progressText.textContent = 'Ukončuji Minecraft...';
                markUserRequestedStop();
                try {
                    await window.api.killGame();
                } catch (err) {
                    console.error('Kill error:', err);
                }
                resetPlayState();
                return;
            }
            appendLog('[LAUNCHER] Stahování / instalace byla zrušena uživatelem. Čistím stažené soubory...');
            if (progressText) progressText.textContent = 'Ruším instalaci a mažu stažená data...';
            try {
                await window.api.cancelLaunch();
            } catch (err) {
                console.error('Cancel error:', err);
            }
            resetPlayState();
            appendLog('[LAUNCHER] Instalace byla zrušena a dočasné soubory smazány.');
        });
    }

    if (globalDownloadChip) {
        globalDownloadChip.addEventListener('click', (e) => {
            if (e.target.closest('#btnCancelGlobalDownload')) return;
            switchTab('play');
        });
    }

    if (btnCancelGlobalDownload) {
        btnCancelGlobalDownload.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isRunning) {
                appendLog('[LAUNCHER] Ukončuji běžící Minecraft z horní lišty...');
                markUserRequestedStop();
                try {
                    await window.api.killGame();
                } catch (err) {
                    console.error('Kill error:', err);
                }
                resetPlayState();
                return;
            }
            appendLog('[LAUNCHER] Stahování / instalace byla zrušena z horní lišty.');
            if (progressText) progressText.textContent = 'Ruším instalaci a mažu stažená data...';
            if (globalDownloadText) globalDownloadText.textContent = 'Ruším...';
            try {
                await window.api.cancelLaunch();
            } catch (err) {
                console.error('Cancel error:', err);
            }
            resetPlayState();
            appendLog('[LAUNCHER] Instalace byla zrušena a dočasné soubory smazány.');
        });
    }

    // ── Launch Minecraft ────────────────────────────────────────────────────
    async function startLaunch(profileId, serverIp) {
        if (isRunning) {
            const currentRunningPid = runningProfileId || currentConfig.activeProfileId;
            if (profileId === currentRunningPid || (!profileId && currentConfig.activeProfileId === currentRunningPid)) {
                if (confirm('Chceš ukončit běžící Minecraft proces?')) {
                    markUserRequestedStop();
                    await window.api.killGame();
                    resetPlayState();
                }
            } else {
                showToast('Hra již běží. Před spuštěním nebo stažením jiné verze nejprve ukonči běžící instanci.', 'error');
            }
            return;
        }

        if (isLaunching) {
            console.warn('[LAUNCH] Spuštění již probíhá...');
            showToast('Probíhá spouštění nebo stahování verze. Počkej na dokončení.', 'warning');
            return;
        }

        const targetPid = profileId || currentConfig.activeProfileId || 'minecraft-26.2';
        const targetProf = (currentConfig.profiles || []).find(x => x.id === targetPid);

        // ⚡ Blesková vizuální odezva do 16 ms (1. frame):
        isLaunching = true;
        launchingProfileId = targetPid;
        setHeroLaunchCelebration(true);
        if (sidebarPlayBtn) sidebarPlayBtn.style.opacity = '0.5';

        const isAlreadyInstalled = targetProf && Array.isArray(installedVersions) && installedVersions.includes(targetProf.version);
        const initStatusText = isAlreadyInstalled ? 'Příprava herního jádra...' : 'Stahuji verzi a herní data...';
        maxRenderedProgress = 12;
        lastProgressData = { percent: 12, text: initStatusText };
        const friendlyInit = getHumanFriendlyStatus(initStatusText, 12);

        startClientProgressTicker();

        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = `${maxRenderedProgress}%`;
            if (progressPercent) progressPercent.textContent = `${maxRenderedProgress}%`;
            if (progressText) {
                progressText.textContent = friendlyInit;
                progressText.title = initStatusText;
            }
        }
        if (globalDownloadChip) {
            globalDownloadChip.style.display = 'inline-flex';
            if (globalDownloadBar) globalDownloadBar.style.width = `${maxRenderedProgress}%`;
            if (globalDownloadText) globalDownloadText.textContent = `${friendlyInit} (${maxRenderedProgress}%)`;
        }

        renderProfilesList();
        refreshVersionStatuses();

        // ── Kontrola nepovolených módů (Warden Probe) při připojení na MYCHAL SMP ──
        const isMychalServer = serverIp && (
            serverIp.toLowerCase().includes('mychalsmp.xyz') ||
            serverIp.toLowerCase().includes('mychalsmp') ||
            serverIp === '130.61.89.37'
        );

        if (isMychalServer) {
            try {
                const wardenScan = await window.api.checkWardenProbe(targetPid);
                if (wardenScan && !wardenScan.clean) {
                    currentIllegalMods = wardenScan.illegalMods || [];
                    const banner = document.getElementById('wardenBlockedAlert');
                    const countText = document.getElementById('wardenBlockedCountText');
                    if (banner) banner.style.display = 'flex';
                    if (countText) countText.textContent = `${wardenScan.blockedCount} nepovolených módů pro MYCHAL SMP`;
                    showToast(`Připojení k MYCHAL SMP zablokováno: V profilu je ${wardenScan.blockedCount} nepovolených módů.`, 'error');
                    appendLog(`[BEZPEČNOST] Připojení k MYCHAL SMP zablokováno systémem Warden. Nalezeny nepovolené modifikace (${wardenScan.blockedCount}).`);
                    resetPlayState();
                    renderProfilesList();
                    openWardenModal();
                    return;
                }
            } catch (wErr) {
                console.warn('[WARDEN] Kontrola selhala:', wErr);
            }
        }

        // 💾 Uložit nastavení pouze v případě reálné změny (isSettingsDirty)
        try {
            if (typeof autoSaveSettings === 'function' && isSettingsDirty) {
                await Promise.race([
                    autoSaveSettings(true, true),
                    new Promise(r => setTimeout(r, 600))
                ]).catch(() => { });
            }
        } catch (_) { }

        const hasBeenPlayed = targetProf && (Boolean(targetProf.lastPlayed) || (typeof targetProf.playtimeSeconds === 'number' && targetProf.playtimeSeconds > 0));
        const hasExplicitLoader = targetProf && Boolean(targetProf.loader) && ['fabric', 'vanilla', 'forge', 'neoforge'].includes(targetProf.loader);

        // Pokud pro tento profil ještě nebyla vybrána varianta (Vanilla vs Optimalizovaný), zeptáme se:
        // ALE NIKDY se neptáme, pokud:
        // 1. Hráč už profil dříve hrál (lastPlayed / playtime > 0)
        // 2. Verze hry je již stažena/nainstalována (isAlreadyInstalled)
        // 3. Profil má explicitně určený loader (např. záměrně vytvořený Fabric, Vanilla apod.)
        if (targetProf && !targetProf.optimizedChosen) {
            if (hasBeenPlayed || isAlreadyInstalled || hasExplicitLoader) {
                targetProf.optimizedChosen = targetProf.loader === 'fabric' ? 'optimized' : 'vanilla';
                try {
                    window.api.saveConfig({ profiles: currentConfig.profiles });
                } catch (_) { }
            } else {
                isLaunching = false;
                setHeroLaunchCelebration(false);
                if (sidebarPlayBtn) sidebarPlayBtn.style.opacity = '1';
                promptFirstLaunchOptimizer(targetProf, () => {
                    startLaunch(targetPid, serverIp);
                });
                return;
            }
        }

        // ── Automatická kontrola a stažení aktualizací módů před spuštěním ──
        if (targetProf && targetProf.loader !== 'vanilla' && currentConfig.autoUpdateMods !== false && !isRunning) {
            try {
                if (progressContainer) progressContainer.style.display = 'flex';
                if (globalDownloadChip) globalDownloadChip.style.display = 'inline-flex';
                if (progressBar) progressBar.style.width = '10%';
                if (progressPercent) progressPercent.textContent = '10%';
                const friendlyModCheck = getHumanFriendlyStatus('Kontroluji aktualizace módů...', 10);
                if (progressText) {
                    progressText.textContent = friendlyModCheck;
                    progressText.title = 'Kontroluji aktualizace módů...';
                }
                if (globalDownloadBar) globalDownloadBar.style.width = '10%';
                if (globalDownloadText) globalDownloadText.textContent = `${friendlyModCheck} (10%)`;
                if (sideConsoleStatus) sideConsoleStatus.textContent = 'Kontroluji aktualizace módů...';

                appendLog('[AKTUALIZACE MÓDŮ] Kontroluji aktualizace nainstalovaných módů na Modrinthu...');

                const updateRes = await Promise.race([
                    window.api.checkProfileModUpdates(targetPid),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1500))
                ]).catch(err => {
                    appendLog(`[AKTUALIZACE MÓDŮ] Kontrola přeskočena (${err.message})`);
                    return { success: false, updates: [] };
                });

                const updates = (updateRes && Array.isArray(updateRes.updates)) ? updateRes.updates : [];
                if (updates.length > 0) {
                    appendLog(`[AKTUALIZACE MÓDŮ] Nalezeno ${updates.length} nových verzí módů ke stažení.`);
                    const totalUpdates = updates.length;

                    for (let i = 0; i < totalUpdates; i++) {
                        if (!isLaunching) break;
                        const u = updates[i];
                        const basePct = Math.round(10 + ((i / totalUpdates) * 48));
                        const nextPct = Math.round(10 + (((i + 1) / totalUpdates) * 48));
                        const statusMsg = `Stahuji aktualizaci: ${u.title} (v${u.newVersion}) [${i + 1}/${totalUpdates}]`;
                        const friendlyModDl = getHumanFriendlyStatus(statusMsg, basePct);

                        activePreLaunchModUpdate = {
                            id: u.id,
                            title: u.title,
                            index: i,
                            total: totalUpdates,
                            basePct,
                            nextPct
                        };

                        if (progressBar) progressBar.style.width = `${basePct}%`;
                        if (progressPercent) progressPercent.textContent = `${basePct}%`;
                        if (progressText) {
                            progressText.textContent = friendlyModDl;
                            progressText.title = statusMsg;
                        }
                        if (globalDownloadBar) globalDownloadBar.style.width = `${basePct}%`;
                        if (globalDownloadText) globalDownloadText.textContent = `${friendlyModDl} (${basePct}%)`;
                        if (sideConsoleStatus) sideConsoleStatus.textContent = statusMsg;

                        appendLog(`[AKTUALIZACE MÓDŮ] Stahuji ${u.title} (v${u.newVersion})...`);

                        try {
                            await window.api.downloadModOrPack({
                                id: u.id,
                                title: u.title,
                                projectType: 'mod',
                                version: targetProf.version || '26.2',
                                loader: targetProf.loader || 'fabric',
                                profileId: targetPid,
                                oldFilename: u.oldFilename,
                                directUrl: u.directUrl,
                                filename: u.newFilename
                            });
                            appendLog(`[AKTUALIZACE MÓDŮ] ✔ ${u.title} úspěšně aktualizován.`);
                        } catch (dlErr) {
                            console.warn(`Chyba při stahování aktualizace módu ${u.title}:`, dlErr);
                            appendLog(`[AKTUALIZACE MÓDŮ] ⚠ Selhalo stažení ${u.title}: ${dlErr.message}`);
                        } finally {
                            activePreLaunchModUpdate = null;
                        }
                    }

                    showToast(`Aktualizováno ${totalUpdates} módů před spuštěním.`, 'success');
                    if (progressBar) progressBar.style.width = '60%';
                    if (progressPercent) progressPercent.textContent = '60%';
                    if (globalDownloadBar) globalDownloadBar.style.width = '60%';
                } else {
                    appendLog('[AKTUALIZACE MÓDŮ] Všechny módy jsou aktuální.');
                }
            } catch (modUpErr) {
                console.warn('Chyba při kontrole aktualizací módů:', modUpErr);
            } finally {
                activePreLaunchModUpdate = null;
            }
        }

        const launchStatusText = isAlreadyInstalled ? 'Načítání hry...' : 'Stahuji verzi a herní data...';
        maxRenderedProgress = Math.max(maxRenderedProgress, 18);
        lastProgressData = { percent: 18, text: launchStatusText };
        const friendlyLaunch = getHumanFriendlyStatus(launchStatusText, 18);

        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = `${maxRenderedProgress}%`;
            if (progressPercent) progressPercent.textContent = `${maxRenderedProgress}%`;
            if (progressText) {
                progressText.textContent = friendlyLaunch;
                progressText.title = launchStatusText;
            }
        }

        if (globalDownloadChip) {
            globalDownloadChip.style.display = 'inline-flex';
            if (globalDownloadBar) globalDownloadBar.style.width = `${maxRenderedProgress}%`;
            if (globalDownloadText) globalDownloadText.textContent = `${friendlyLaunch} (${maxRenderedProgress}%)`;
        }

        appendLog(isAlreadyInstalled
            ? `[LAUNCHER] Zahajuji spuštění profilu ${targetProf?.name || targetPid}...`
            : `[LAUNCHER] Zahajuji stahování a instalaci verze ${targetProf?.version || ''}...`);
        if (sideConsoleStatus) sideConsoleStatus.textContent = isAlreadyInstalled ? 'Připravuji herní data a knihovny...' : 'Stahuji verzi a herní data...';

        const actualServerIp = serverIp;

        try {
            const res = await window.api.launchGame(targetPid, actualServerIp);
            if (res && res.success) {
                isRunning = true;
                runningProfileId = targetPid;
                isLaunching = false;
                launchingProfileId = null;
                setHeroLaunchCelebration(false);

                try {
                    installedVersions = await window.api.getInstalledVersions();
                } catch (e) { }

                // Record real lastPlayed timestamp for profile and set as active profile
                const launchedProfile = (currentConfig.profiles || []).find(x => x.id === targetPid);
                if (launchedProfile) {
                    launchedProfile.lastPlayed = Date.now();
                    currentConfig.activeProfileId = targetPid;
                    window.api.saveConfig({ profiles: currentConfig.profiles, activeProfileId: targetPid });
                }

                renderProfilesList();
                refreshVersionStatuses();

                if (sidebarPlayBtn) {
                    sidebarPlayBtn.style.opacity = '1';
                    sidebarPlayBtn.style.background = '#ef4444';
                    sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop';
                }
                const activeCard = document.querySelector(`.profile-row-card[data-profile-id="${targetPid}"]`);
                if (activeCard) {
                    const btn = activeCard.querySelector('.btn-launch-profile');
                    if (btn) {
                        btn.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop</span>';
                        btn.classList.remove('mc-btn-green', 'mc-btn-primary');
                        btn.classList.add('mc-btn-red');
                    }
                }
                if (sideConsoleStatus) sideConsoleStatus.textContent = 'Hra běží.';
                appendLog('[LAUNCHER] Instance Minecraftu byla spuštěna.');

                // Live running state on progress container
                if (progressContainer) {
                    progressContainer.style.display = 'flex';
                    if (progressBar) {
                        progressBar.style.width = '100%';
                        progressBar.classList.add('is-running');
                    }
                    if (progressPercent) progressPercent.textContent = 'Spuštěno';
                    if (progressText) progressText.textContent = 'Hra spuštěna';
                    if (btnCancelDownload) {
                        btnCancelDownload.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Ukončit';
                        btnCancelDownload.classList.add('btn-stop-running');
                        btnCancelDownload.title = 'Ukončit Minecraft';
                    }
                }
                if (globalDownloadChip) {
                    globalDownloadChip.style.display = 'inline-flex';
                    if (globalDownloadBar) {
                        globalDownloadBar.style.width = '100%';
                        globalDownloadBar.classList.add('is-running');
                    }
                    if (globalDownloadText) globalDownloadText.textContent = 'Minecraft běží';
                }
            } else if (res && res.sessionExpired) {
                appendLog(`[AUTH] ${res.error}`);
                showToast(res.error || 'Platnost Microsoft účtu vypršela.', 'error');
                alert(res.error || 'Platnost Microsoft účtu vypršela.\nPřihlas se prosím znovu ke svému účtu v launcheru.');
                resetPlayState();
                return;
            } else if (res && res.blockedByWarden) {
                appendLog(`[BEZPEČNOST] ${res.error}`);
                showToast(res.error || 'Spuštění zablokováno: V profilu jsou nepovolené módy.', 'error');
                if (res.illegalMods) currentIllegalMods = res.illegalMods;
                openWardenModal();
                resetPlayState();
                return;
            } else if (res && res.cancelled) {
                appendLog('[LAUNCHER] Spuštění hry bylo zrušeno.');
                resetPlayState();
            } else {
                throw new Error(res.error || 'Neznámá chyba při spouštění');
            }
        } catch (err) {
            console.error('Launch failed:', err);
            appendLog(`[CHYBA SPOUŠTĚNÍ] ${err.message}`);
            alert(`Nepodařilo se spustit Minecraft:\n${err.message}`);
            resetPlayState();
        }
    }

    // ── First Launch Modal Handler ───────────────────────────────────────────
    function promptFirstLaunchOptimizer(profile, onComplete) {
        const modal = document.getElementById('modalFirstLaunchOptimizer');
        const title = document.getElementById('firstLaunchModalTitle');
        const btnClose = document.getElementById('btnCloseFirstLaunchModal');
        const btnOpt = document.getElementById('btnConfirmChooseOptimized');
        const btnVan = document.getElementById('btnConfirmChooseVanilla');
        const progressBox = document.getElementById('firstLaunchOptProgressBox');
        const statusText = document.getElementById('firstLaunchOptStatusText');
        const percentText = document.getElementById('firstLaunchOptPercentText');
        const barFill = document.getElementById('firstLaunchOptProgressBarFill');
        if (!modal) {
            if (onComplete) onComplete();
            return;
        }

        if (title) title.textContent = `Jak chceš spustit ${profile.name || 'Minecraft'}?`;
        if (progressBox) progressBox.style.display = 'none';
        if (barFill) barFill.style.width = '0%';
        if (btnOpt) {
            btnOpt.disabled = false;
            btnOpt.innerHTML = '<span>⚡ Spustit s optimalizací</span>';
        }
        if (btnVan) btnVan.disabled = false;
        modal.style.display = 'flex';

        function cleanup() {
            modal.style.display = 'none';
            if (progressBox) progressBox.style.display = 'none';
            if (btnOpt) {
                btnOpt.onclick = null;
                btnOpt.disabled = false;
                btnOpt.innerHTML = '<span>⚡ Spustit s optimalizací</span>';
            }
            if (btnVan) {
                btnVan.onclick = null;
                btnVan.disabled = false;
            }
            if (btnClose) btnClose.onclick = null;
        }

        if (btnClose) {
            btnClose.onclick = () => cleanup();
        }

        if (btnOpt) {
            btnOpt.onclick = async () => {
                btnOpt.disabled = true;
                if (btnVan) btnVan.disabled = true;
                if (progressBox) {
                    progressBox.style.display = 'block';
                    if (statusText) statusText.textContent = 'Příprava optimalizace...';
                    if (percentText) percentText.textContent = '0%';
                    if (barFill) barFill.style.width = '0%';
                }
                btnOpt.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Optimalizuji...</span>';
                profile.optimizedChosen = 'optimized';
                profile.loader = 'fabric';
                try {
                    await window.api.applyProfileOptimization(profile.id);
                } catch (_) { }
                await window.api.saveConfig({ profiles: currentConfig.profiles, loader: 'fabric' });
                if (statusText) statusText.textContent = 'Optimalizace dokončena!';
                if (percentText) percentText.textContent = '100%';
                if (barFill) barFill.style.width = '100%';
                showToast('Doporučená optimalizace nastavena.', 'success');
                setTimeout(() => {
                    cleanup();
                    if (onComplete) onComplete();
                }, 400);
            };
        }

        if (btnVan) {
            btnVan.onclick = async () => {
                profile.optimizedChosen = 'vanilla';
                profile.loader = 'vanilla';
                await window.api.saveConfig({ profiles: currentConfig.profiles, loader: 'vanilla' });
                cleanup();
                if (onComplete) onComplete();
            };
        }
    }

    function resetPlayState() {
        stopClientProgressTicker();
        document.body.classList.remove('launch-handoff');
        isRunning = false;
        runningProfileId = null;
        isLaunching = false;
        launchingProfileId = null;
        setHeroLaunchCelebration(false);
        lastProgressData = null;
        maxRenderedProgress = 0;
        activePreLaunchModUpdate = null;
        if (progressBar) progressBar.classList.remove('is-running');
        if (globalDownloadBar) globalDownloadBar.classList.remove('is-running');
        if (btnCancelDownload) {
            btnCancelDownload.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Zrušit';
            btnCancelDownload.classList.remove('btn-stop-running');
            btnCancelDownload.title = 'Zrušit stahování / spuštění';
        }
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        if (globalDownloadChip) {
            globalDownloadChip.style.display = 'none';
        }
        if (sidebarPlayBtn) {
            sidebarPlayBtn.style.opacity = '1';
            sidebarPlayBtn.style.background = 'var(--brand-blue)';
            sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        }
        document.querySelectorAll('.btn-launch-profile').forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            const pid = btn.dataset.profileId;
            const prof = (currentConfig.profiles || []).find(p => p.id === pid);
            const isInst = prof && Array.isArray(installedVersions) && installedVersions.includes(prof.version);
            btn.innerHTML = `<span>${isInst ? '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát' : '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout'}</span>`;
            btn.classList.remove('mc-btn-red', 'mc-btn-green');
            btn.classList.add('mc-btn-primary');
        });
        const activeP = (currentConfig.profiles || []).find(x => x.id === (currentConfig.activeProfileId || 'minecraft-26.2'));
        const activeInst = activeP && Array.isArray(installedVersions) && installedVersions.includes(activeP.version);
        if (sideConsoleStatus) {
            sideConsoleStatus.textContent = activeInst
                ? 'Klient je připraven ke spuštění.'
                : `Verze ${activeP ? activeP.version : ''} není nainstalována.`;
        }
        document.querySelectorAll('.v-card-progress').forEach(p => p.style.display = 'none');
        refreshVersionStatuses();
        renderProfilesList();
    }

    // ── Správa Módů v Profilech & Modrinth Katalog ──────────────────────────
    let selectedModsProfileId = null;
    let currentInstalledTab = 'mods'; // 'mods' | 'resourcepacks' | 'shaderpacks'
    let currentProfileModsList = [];
    let currentProfileResourcePacksList = [];
    let currentProfileShadersList = [];

    // Profile selector dropdown for mods
    function renderModsProfileDropdown() {
        const select = document.getElementById('modsProfileSelect');
        if (!select) return;

        const profiles = currentConfig.profiles || [];
        if (!selectedModsProfileId) {
            selectedModsProfileId = currentConfig.activeProfileId || (profiles[0] ? profiles[0].id : null);
        }

        select.innerHTML = profiles.map(p => {
            const isSelected = p.id === selectedModsProfileId;
            const loader = p.loader && p.loader !== 'vanilla' ? ` [${p.loader.toUpperCase()}]` : ' [VANILLA]';
            const name = p.name || p.id;
            return `<option value="${escapeHtml(p.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(name)} (${p.version}${loader})</option>`;
        }).join('');

        select.onchange = (e) => {
            selectedModsProfileId = e.target.value;
            const p = (currentConfig.profiles || []).find(x => x.id === selectedModsProfileId);
            if (p) {
                if (p.loader && ['fabric', 'forge', 'neoforge'].includes(p.loader)) {
                    currentModFilter.loader = p.loader;
                    const radio = document.querySelector(`input[name="filterLoader"][value="${p.loader}"]`);
                    if (radio) radio.checked = true;
                }
                if (p.version) {
                    currentModFilter.version = p.version;
                    const vRadio = document.querySelector(`input[name="filterVersion"][value="${p.version}"]`);
                    if (vRadio) vRadio.checked = true;
                }
            }
            loadProfileMods(selectedModsProfileId);
            if (btnSwitchCatalogMods && btnSwitchCatalogMods.classList.contains('active')) {
                loadModrinthMods();
            }
        };
    }

    // Button to open selected profile's mods folder
    const btnOpenSelectedProfileModsFolder = document.getElementById('btnOpenSelectedProfileModsFolder');
    if (btnOpenSelectedProfileModsFolder) {
        btnOpenSelectedProfileModsFolder.addEventListener('click', async () => {
            const profId = selectedModsProfileId || currentConfig.activeProfileId;
            if (profId) {
                await window.api.openProfileFolder(profId, 'mods');
            }
        });
    }

    // ── Profile Seed (Export / Import / Synchronizace konfigurace módů a balíčků) ──
    const modalProfileSeed = document.getElementById('modalProfileSeed');
    const btnOpenProfileSeedModal = document.getElementById('btnOpenProfileSeedModal');
    const btnCloseProfileSeedModal = document.getElementById('btnCloseProfileSeedModal');
    const btnCloseProfileSeedFooter = document.getElementById('btnCloseProfileSeedFooter');
    const profileSeedExportInput = document.getElementById('profileSeedExportInput');
    const profileSeedSummary = document.getElementById('profileSeedSummary');
    const btnCopyProfileSeed = document.getElementById('btnCopyProfileSeed');
    const profileSeedImportInput = document.getElementById('profileSeedImportInput');
    const btnApplyProfileSeed = document.getElementById('btnApplyProfileSeed');
    const profileSeedImportStatus = document.getElementById('profileSeedImportStatus');
    const profileSeedProgressBox = document.getElementById('profileSeedProgressBox');
    const profileSeedProgressText = document.getElementById('profileSeedProgressText');
    const profileSeedProgressPercent = document.getElementById('profileSeedProgressPercent');
    const profileSeedProgressBarFill = document.getElementById('profileSeedProgressBarFill');

    function closeProfileSeedModal() {
        if (modalProfileSeed) modalProfileSeed.style.display = 'none';
        if (profileSeedImportStatus) profileSeedImportStatus.textContent = '';
        if (profileSeedProgressBox) profileSeedProgressBox.style.display = 'none';
    }

    if (btnCloseProfileSeedModal) btnCloseProfileSeedModal.addEventListener('click', closeProfileSeedModal);
    if (btnCloseProfileSeedFooter) btnCloseProfileSeedFooter.addEventListener('click', closeProfileSeedModal);

    if (btnOpenProfileSeedModal) {
        btnOpenProfileSeedModal.addEventListener('click', async () => {
            const profId = selectedModsProfileId || currentConfig.activeProfileId;
            if (!profId) {
                showToast('Není vybrán žádný profil.', 'error');
                return;
            }
            if (modalProfileSeed) modalProfileSeed.style.display = 'flex';
            if (profileSeedExportInput) profileSeedExportInput.value = 'Generuji...';
            if (profileSeedSummary) profileSeedSummary.textContent = '';
            if (profileSeedImportStatus) profileSeedImportStatus.textContent = '';
            if (profileSeedImportInput) profileSeedImportInput.value = '';
            if (profileSeedProgressBox) profileSeedProgressBox.style.display = 'none';
            if (profileSeedProgressBarFill) {
                profileSeedProgressBarFill.style.width = '0%';
                profileSeedProgressBarFill.style.background = 'linear-gradient(90deg, #0a67e5, #21DE00)';
            }

            try {
                const res = await window.api.generateProfileSeed(profId);
                if (res && res.success) {
                    if (profileSeedExportInput) profileSeedExportInput.value = res.seed;
                    if (profileSeedSummary) {
                        profileSeedSummary.textContent = `${res.count} položek`;
                    }
                } else {
                    if (profileSeedExportInput) profileSeedExportInput.value = 'Chyba';
                    if (profileSeedSummary) profileSeedSummary.textContent = res?.error || 'Chyba';
                }
            } catch (err) {
                if (profileSeedExportInput) profileSeedExportInput.value = 'Chyba';
                if (profileSeedSummary) profileSeedSummary.textContent = err.message;
            }
        });
    }

    if (btnCopyProfileSeed) {
        btnCopyProfileSeed.addEventListener('click', async () => {
            if (!profileSeedExportInput || !profileSeedExportInput.value || profileSeedExportInput.value.startsWith('Generuji') || profileSeedExportInput.value.startsWith('Chyba')) {
                return;
            }
            try {
                await navigator.clipboard.writeText(profileSeedExportInput.value);
                showToast('Kód zkopírován', 'success');
                temporaryButtonText(btnCopyProfileSeed, '<span>Zkopírováno</span>', 1500);
            } catch (err) {
                profileSeedExportInput.select();
                showToast('Kód vybrán ke zkopírování.', 'info');
            }
        });
    }

    if (window.api && window.api.onProfileSeedProgress) {
        window.api.onProfileSeedProgress((data) => {
            if (profileSeedProgressBox) profileSeedProgressBox.style.display = 'block';
            const rawPct = Math.max(0, Math.min(100, data.percent || 0));
            const pct = calculatePerceptualProgress(rawPct);
            if (profileSeedProgressBarFill) {
                profileSeedProgressBarFill.style.width = `${pct}%`;
                profileSeedProgressBarFill.style.background = 'linear-gradient(90deg, #0a67e5, #21DE00)';
            }
            if (profileSeedProgressPercent) {
                profileSeedProgressPercent.textContent = `${pct}%`;
            }
            if (profileSeedProgressText) {
                profileSeedProgressText.textContent = `${data.current} z ${data.total}: ${data.title || ''}`;
            }
        });
    }

    if (window.api && window.api.onOptimizationProgress) {
        window.api.onOptimizationProgress((data) => {
            const rawPct = Math.max(0, Math.min(100, data.percent || 0));
            const pct = calculatePerceptualProgress(rawPct);

            // 1. Modální okno prvního spuštění
            const flBox = document.getElementById('firstLaunchOptProgressBox');
            const flStatus = document.getElementById('firstLaunchOptStatusText');
            const flPercent = document.getElementById('firstLaunchOptPercentText');
            const flFill = document.getElementById('firstLaunchOptProgressBarFill');
            const flBtn = document.getElementById('btnConfirmChooseOptimized');

            if (flBox && flBox.style.display !== 'none') {
                if (flStatus) flStatus.textContent = data.status || 'Optimalizuji...';
                if (flPercent) flPercent.textContent = `${pct}%`;
                if (flFill) flFill.style.width = `${pct}%`;
                if (flBtn) {
                    const label = data.itemTitle ? `Instalace: ${data.itemTitle}` : (data.status || 'Optimalizuji...');
                    flBtn.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> ${escapeHtml(label)}</span>`;
                }
            }

            // 2. Nastavení profilu – tlačítko "⚡ Optimalizovat"
            const btnApplyOpt = document.getElementById('btnApplyProfileOptimization');
            if (btnApplyOpt && btnApplyOpt.disabled) {
                const label = data.itemTitle ? `${data.itemTitle} (${pct}%)` : `${pct}%`;
                btnApplyOpt.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> ${escapeHtml(label)}</span>`;
            }
        });
    }

    if (btnApplyProfileSeed) {
        btnApplyProfileSeed.addEventListener('click', async () => {
            const profId = selectedModsProfileId || currentConfig.activeProfileId;
            if (!profId) {
                showToast('Není vybrán žádný profil.', 'error');
                return;
            }
            const seedVal = profileSeedImportInput ? profileSeedImportInput.value.trim() : '';
            if (!seedVal) {
                showToast('Zadej kód balíčku.', 'error');
                return;
            }

            btnApplyProfileSeed.disabled = true;
            const originalBtnContent = btnApplyProfileSeed.innerHTML;
            btnApplyProfileSeed.innerHTML = '<span>Stahuji...</span>';
            if (profileSeedImportStatus) profileSeedImportStatus.textContent = '';
            if (profileSeedProgressBox) profileSeedProgressBox.style.display = 'block';
            if (profileSeedProgressBarFill) {
                profileSeedProgressBarFill.style.width = '2%';
                profileSeedProgressBarFill.style.background = 'linear-gradient(90deg, #0a67e5, #21DE00)';
            }
            if (profileSeedProgressPercent) profileSeedProgressPercent.textContent = '0%';
            if (profileSeedProgressText) profileSeedProgressText.textContent = 'Příprava stahování...';

            try {
                const res = await window.api.importProfileSeed(profId, seedVal);
                if (res && res.success) {
                    showToast('Balíček stažen.', 'success');
                    if (profileSeedProgressBarFill) {
                        profileSeedProgressBarFill.style.width = '100%';
                        profileSeedProgressBarFill.style.background = '#21DE00';
                    }
                    if (profileSeedProgressPercent) profileSeedProgressPercent.textContent = '100%';
                    if (profileSeedProgressText) profileSeedProgressText.textContent = 'Hotovo';
                    if (profileSeedImportStatus) {
                        if (res.failedCount > 0) {
                            profileSeedImportStatus.innerHTML = `<span style="color: #f59e0b;">Staženo: ${res.installedCount}, selhalo: ${res.failedCount}</span>`;
                        } else {
                            profileSeedImportStatus.innerHTML = '<span style="color: #21DE00;">Všechny mody byly nainstalovány</span>';
                            setTimeout(() => {
                                closeProfileSeedModal();
                            }, 3000);
                        }
                    } else if (!res.failedCount) {
                        setTimeout(() => {
                            closeProfileSeedModal();
                        }, 3000);
                    }
                    // Refresh mods & packs list in UI
                    loadProfileMods(profId);
                } else {
                    showToast(res?.error || 'Chyba při stahování', 'error');
                    if (profileSeedProgressBarFill) {
                        profileSeedProgressBarFill.style.background = '#f51515';
                    }
                    if (profileSeedProgressText) profileSeedProgressText.textContent = 'Chyba';
                    if (profileSeedImportStatus) {
                        profileSeedImportStatus.innerHTML = `<span style="color: #f51515;">${escapeHtml(res?.error || 'Chyba')}</span>`;
                    }
                }
            } catch (err) {
                showToast(err.message, 'error');
                if (profileSeedProgressBarFill) {
                    profileSeedProgressBarFill.style.background = '#f51515';
                }
                if (profileSeedProgressText) profileSeedProgressText.textContent = 'Chyba';
                if (profileSeedImportStatus) {
                    profileSeedImportStatus.innerHTML = `<span style="color: #f51515;">${escapeHtml(err.message)}</span>`;
                }
            } finally {
                btnApplyProfileSeed.disabled = false;
                btnApplyProfileSeed.innerHTML = originalBtnContent;
            }
        });
    }

    // Subview switcher: Installed mods vs Modrinth catalog
    const btnSwitchInstalledMods = document.getElementById('btnSwitchInstalledMods');
    const btnSwitchCatalogMods = document.getElementById('btnSwitchCatalogMods');
    const viewInstalledMods = document.getElementById('viewInstalledMods');
    const viewCatalogMods = document.getElementById('viewCatalogMods');

    if (btnSwitchInstalledMods && btnSwitchCatalogMods) {
        btnSwitchInstalledMods.addEventListener('click', () => {
            btnSwitchInstalledMods.classList.add('active');
            btnSwitchCatalogMods.classList.remove('active');
            if (viewInstalledMods) viewInstalledMods.style.display = 'block';
            if (viewCatalogMods) viewCatalogMods.style.display = 'none';
            loadProfileMods();
        });

        btnSwitchCatalogMods.addEventListener('click', async () => {
            btnSwitchCatalogMods.classList.add('active');
            btnSwitchInstalledMods.classList.remove('active');
            if (viewInstalledMods) viewInstalledMods.style.display = 'none';
            if (viewCatalogMods) viewCatalogMods.style.display = 'block';

            // Vždy načteme čerstvý stav profilu z disku, aby se ihned projevily smazané nebo přidané módy
            const profId = selectedModsProfileId || currentConfig.activeProfileId;
            if (profId) {
                try {
                    const pRes = await window.api.getProfileMods(profId);
                    if (pRes && pRes.success) {
                        currentProfileModsList = pRes.mods || [];
                    }
                } catch (_) { }
            }
            if (lastLoadedCatalogMods && lastLoadedCatalogMods.length > 0) {
                renderModCards(lastLoadedCatalogMods);
            } else {
                loadModrinthMods();
            }
        });
    }

    // Load installed mods, resource packs, and shaders for selected profile
    async function loadProfileMods(profileId) {
        const listEl = document.getElementById('installedModsList');
        const countEl = document.getElementById('installedModsCount');
        const summaryEl = document.getElementById('installedModsSummary');
        if (!listEl) return;

        const profId = profileId || selectedModsProfileId || currentConfig.activeProfileId;
        if (!profId) {
            listEl.innerHTML = `<div class="empty-mods-state"><p>Není vybrán žádný profil.</p></div>`;
            return;
        }

        listEl.innerHTML = `<div class="mods-loading">Načítám nainstalované položky profilu...</div>`;

        try {
            const res = await window.api.getProfileMods(profId);
            if (!res || !res.success) {
                listEl.innerHTML = `<div class="empty-mods-state"><p>Nepodařilo se načíst položky: ${escapeHtml(res?.error || 'Neznámá chyba')}</p></div>`;
                return;
            }

            currentProfileModsList = res.mods || [];

            // Načtení Resource Packů a Shaderů
            try {
                const rpRes = await window.api.getProfilePacks(profId, 'resourcepacks');
                currentProfileResourcePacksList = rpRes?.packs || [];
            } catch (_) { currentProfileResourcePacksList = []; }

            try {
                const shRes = await window.api.getProfilePacks(profId, 'shaderpacks');
                currentProfileShadersList = shRes?.packs || [];
            } catch (_) { currentProfileShadersList = []; }

            // Aktualizace číselných odznaků
            if (countEl) countEl.textContent = currentProfileModsList.length;
            const subModsCount = document.getElementById('installedModsCountSub');
            if (subModsCount) subModsCount.textContent = currentProfileModsList.length;
            const rpCountEl = document.getElementById('installedRpCount');
            if (rpCountEl) rpCountEl.textContent = currentProfileResourcePacksList.length;
            const shCountEl = document.getElementById('installedShaderCount');
            if (shCountEl) shCountEl.textContent = currentProfileShadersList.length;

            if (summaryEl) {
                const activeCount = currentProfileModsList.filter(m => m.enabled).length;
                const pObj = (currentConfig.profiles || []).find(p => p.id === profId);
                const ldr = pObj && pObj.loader && pObj.loader !== 'vanilla' ? pObj.loader.toUpperCase() : 'VANILLA';
                const ldrColor = ldr === 'VANILLA' ? '#94a3b8' : '#0a67e5';
                summaryEl.innerHTML = `Profil: <strong>${escapeHtml(res.profileName || profId)}</strong> • Zavaděč: <strong style="color: ${ldrColor};">${ldr}</strong> • Aktivních: <strong>${activeCount}/${currentProfileModsList.length}</strong>`;
            }

            // Detekce kolizí a duplicitních verzí módů
            const modCollisionBanner = document.getElementById('modCollisionBanner');
            const modCollisionDescText = document.getElementById('modCollisionDescText');
            const btnResolveModCollisions = document.getElementById('btnResolveModCollisions');
            if (modCollisionBanner) {
                if (res.collisions && res.collisions.length > 0) {
                    const extraDups = res.collisions.reduce((acc, c) => acc + (c.count - 1), 0);
                    modCollisionBanner.style.display = 'flex';
                    if (modCollisionDescText) {
                        modCollisionDescText.textContent = `Nalezeno ${res.collisions.length} módů s duplicitními verzemi (${extraDups} duplikátů). Zachová nejnovější verzi a starší deaktivuje.`;
                    }
                    if (btnResolveModCollisions) {
                        btnResolveModCollisions.onclick = async () => {
                            btnResolveModCollisions.disabled = true;
                            btnResolveModCollisions.textContent = 'Řeším kolize...';
                            try {
                                const rRes = await window.api.resolveModCollisions(profId);
                                if (rRes && rRes.success) {
                                    showToast(`Kolize vyřešeny: ${rRes.resolved} starších verzí deaktivováno.`, 'success');
                                }
                                await loadProfileMods(profId);
                            } catch (err) {
                                showToast('Chyba při řešení kolizí: ' + err.message, 'error');
                            } finally {
                                btnResolveModCollisions.disabled = false;
                                btnResolveModCollisions.textContent = 'Vyřešit konflikty';
                            }
                        };
                    }
                } else {
                    modCollisionBanner.style.display = 'none';
                }
            }

            renderFilteredInstalledItems();
            // VŽDY aktualizujeme i karty v katalogu, aby se okamžitě projevil smazaný mód
            if (lastLoadedCatalogMods && lastLoadedCatalogMods.length > 0) {
                renderModCards(lastLoadedCatalogMods);
            }
        } catch (e) {
            listEl.innerHTML = `<div class="empty-mods-state"><p>Chyba při načítání módů: ${escapeHtml(e.message)}</p></div>`;
        }
    }

    // Render filtered installed mods
    function renderFilteredInstalledMods() {
        const listEl = document.getElementById('installedModsList');
        const searchInput = document.getElementById('installedModsSearchInput');
        if (!listEl) return;

        const summaryEl = document.getElementById('installedModsSummary');
        if (summaryEl) {
            const activeCount = currentProfileModsList.filter(m => m.enabled).length;
            summaryEl.innerHTML = `Módy: <strong>${activeCount}/${currentProfileModsList.length} aktivních</strong>`;
        }

        const filterText = (searchInput?.value || '').trim().toLowerCase();
        const filtered = currentProfileModsList.filter(m => {
            if (!filterText) return true;
            return m.cleanName.toLowerCase().includes(filterText) || m.filename.toLowerCase().includes(filterText);
        });

        if (filtered.length === 0) {
            if (currentProfileModsList.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-mods-state">
                        <div class="empty-mods-icon">
                            <svg class="ui-icon-svg ui-icon-svg--xl" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        </div>
                        <div class="empty-mods-title">Žádné módy</div>
                        <p class="empty-mods-desc">Přidej módy z katalogu nebo vlož .jar soubory do složky mods.</p>
                        <div class="empty-mods-actions">
                            <button type="button" class="mc-btn mc-btn-primary" id="btnEmptyGoCatalog">
                                <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> Přejít do katalogu</span>
                            </button>
                            <button type="button" class="mc-btn mc-btn-secondary" id="btnEmptyOpenFolder">
                                <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Otevřít složku mods</span>
                            </button>
                        </div>
                    </div>
                `;
                const goCatalog = document.getElementById('btnEmptyGoCatalog');
                if (goCatalog) {
                    goCatalog.onclick = () => {
                        btnSwitchCatalogMods?.click();
                    };
                }
                const openFolder = document.getElementById('btnEmptyOpenFolder');
                if (openFolder) {
                    openFolder.onclick = () => {
                        const profId = selectedModsProfileId || currentConfig.activeProfileId;
                        if (profId) window.api.openProfileFolder(profId, 'mods');
                    };
                }
            } else {
                listEl.innerHTML = `<div class="empty-mods-state"><p>Hledání neodpovídá žádný mód v profilu.</p></div>`;
            }
            return;
        }

        const profId = selectedModsProfileId || currentConfig.activeProfileId;
        listEl.innerHTML = filtered.map(m => {
            const displayName = m.name || m.cleanName;
            const initial = (displayName || 'M').charAt(0).toUpperCase();
            return `
            <div class="installed-mod-row ${m.enabled ? 'mod-enabled' : 'mod-disabled'}" data-filename="${escapeHtml(m.filename)}">
                <div class="mod-row-left">
                    <div class="mod-avatar-wrapper">
                        ${m.iconDataUrl
                    ? `<img src="${m.iconDataUrl}" class="mod-avatar-thumb" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
                               <div class="mod-avatar-fallback" style="display:none;">${escapeHtml(initial)}</div>`
                    : `<div class="mod-avatar-fallback">${escapeHtml(initial)}</div>`
                }
                    </div>
                    <div class="mod-row-info">
                        <div class="mod-row-title-line">
                            <span class="mod-row-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                            ${m.version ? `<span class="mod-version-tag">v${escapeHtml(m.version)}</span>` : ''}
                            <span class="mod-row-badge ${m.enabled ? 'badge-enabled' : 'badge-disabled'}">
                                ${m.enabled ? '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Aktivní' : 'Vypnuto'}
                            </span>
                        </div>
                        <div class="mod-row-file-meta">
                            <span class="mod-file-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</span>
                            <span>•</span>
                            <span class="mod-file-size">${escapeHtml(m.sizeFormatted)}</span>
                        </div>
                    </div>
                </div>
                <div class="mod-row-actions">
                    <button type="button" class="btn-mod-toggle ${m.enabled ? 'btn-disable' : 'btn-enable'}"
                        data-filename="${escapeHtml(m.filename)}"
                        title="${m.enabled ? 'Deaktivovat mód' : 'Aktivovat mód'}">
                        <span>${m.enabled ? 'Vypnout' : 'Zapnout'}</span>
                    </button>
                    <button type="button" class="btn-mod-delete"
                        data-filename="${escapeHtml(m.filename)}"
                        title="Smazat soubor módu">
                        <span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Smazat</span>
                    </button>
                </div>
            </div>
            `;
        }).join('');

        // Bind toggle buttons
        listEl.querySelectorAll('.btn-mod-toggle').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = btn.dataset.filename;
                btn.disabled = true;
                try {
                    const res = await window.api.toggleProfileMod(profId, filename);
                    if (res && res.success) {
                        showToast(res.enabled ? 'Mód aktivován' : 'Mód vypnut', 'info');
                        await loadProfileMods(profId);
                    } else {
                        showToast('Chyba při změně módu: ' + (res?.error || 'Neznámá chyba'), 'error');
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
                }
            });
        });

        // Bind delete buttons with iOS-style uninstall animation
        listEl.querySelectorAll('.btn-mod-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = btn.dataset.filename;
                if (!confirm(`Opravdu chceš smazat soubor "${filename}" z profilu?`)) return;
                btn.disabled = true;

                const rowItem = btn.closest('.installed-mod-row');
                if (rowItem) {
                    rowItem.classList.add('ios-uninstalling');
                }

                await new Promise(r => setTimeout(r, 380));

                try {
                    const res = await window.api.deleteProfileMod(profId, filename);
                    if (res && res.success) {
                        showToast('Soubor módu byl odinstalován.', 'success');
                        await loadProfileMods(profId);
                    } else {
                        showToast('Chyba při mazání módu: ' + (res?.error || 'Neznámá chyba'), 'error');
                        if (rowItem) rowItem.classList.remove('ios-uninstalling');
                        btn.disabled = false;
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
                    if (rowItem) rowItem.classList.remove('ios-uninstalling');
                    btn.disabled = false;
                }
            });
        });
    }

    // Render filtered installed Resource Packs and Shaders
    function renderFilteredInstalledPacks(packType) {
        const listEl = document.getElementById('installedModsList');
        const searchInput = document.getElementById('installedModsSearchInput');
        const summaryEl = document.getElementById('installedModsSummary');
        if (!listEl) return;

        const isShader = packType === 'shaderpacks';
        const rawList = isShader ? currentProfileShadersList : currentProfileResourcePacksList;
        const typeLabel = isShader ? 'shader' : 'texture pack';
        const typeLabelPlural = isShader ? 'Shadery' : 'Texture Packy';
        const folderName = isShader ? 'shaderpacks' : 'resourcepacks';

        const filterText = (searchInput?.value || '').trim().toLowerCase();
        const filtered = rawList.filter(p => {
            if (!filterText) return true;
            return p.cleanName.toLowerCase().includes(filterText) || p.filename.toLowerCase().includes(filterText);
        });

        if (summaryEl) {
            const activeCount = rawList.filter(p => p.enabled).length;
            summaryEl.innerHTML = `${typeLabelPlural}: <strong>${activeCount}/${rawList.length} aktivních</strong>`;
        }

        if (filtered.length === 0) {
            if (rawList.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-mods-state">
                        <div class="empty-mods-icon">
                            <svg class="ui-icon-svg ui-icon-svg--xl" viewBox="0 0 24 24">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                            </svg>
                        </div>
                        <div class="empty-mods-title">V tomto profilu zatím nejsou žádné ${escapeHtml(typeLabelPlural.toLowerCase())}</div>
                        <p class="empty-mods-desc">Vlož .zip soubory do složky ${escapeHtml(folderName)} nebo si je stáhni v katalogu.</p>
                        <div class="empty-mods-actions">
                            <button type="button" class="mc-btn mc-btn-primary" id="btnEmptyGoCatalogPacks">
                                <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> Přejít do katalogu</span>
                            </button>
                            <button type="button" class="mc-btn mc-btn-secondary" id="btnEmptyOpenPackFolder">
                                <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Otevřít složku ${escapeHtml(folderName)}</span>
                            </button>
                        </div>
                    </div>
                `;
                const btnGoCatalog = document.getElementById('btnEmptyGoCatalogPacks');
                if (btnGoCatalog) {
                    btnGoCatalog.onclick = () => {
                        btnSwitchCatalogMods?.click();
                        const targetType = isShader ? 'shader' : 'resourcepack';
                        const targetTab = Array.from(modTabButtons).find(b => b.dataset.modType === targetType);
                        if (targetTab) targetTab.click();
                    };
                }
                const btnOpen = document.getElementById('btnEmptyOpenPackFolder');
                if (btnOpen) {
                    btnOpen.onclick = () => {
                        const profId = selectedModsProfileId || currentConfig.activeProfileId;
                        if (profId) window.api.openProfileFolder(profId, folderName);
                    };
                }
            } else {
                listEl.innerHTML = `<div class="empty-mods-state"><p>Hledání neodpovídá žádný ${escapeHtml(typeLabel)} v profilu.</p></div>`;
            }
            return;
        }

        const profId = selectedModsProfileId || currentConfig.activeProfileId;
        listEl.innerHTML = filtered.map(p => {
            const displayName = cleanMinecraftFormatting(p.name || p.cleanName);
            const initial = (displayName || 'P').charAt(0).toUpperCase();
            const cleanFileName = cleanMinecraftFormatting(p.filename);
            return `
            <div class="installed-mod-row ${p.enabled ? 'mod-enabled' : 'mod-disabled'}" data-filename="${escapeHtml(p.filename)}">
                <div class="mod-row-left">
                    <div class="mod-avatar-wrapper">
                        ${p.iconDataUrl
                    ? `<img src="${p.iconDataUrl}" class="mod-avatar-thumb" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
                               <div class="mod-avatar-fallback" style="display:none;">${escapeHtml(initial)}</div>`
                    : `<div class="mod-avatar-fallback">${escapeHtml(initial)}</div>`
                }
                    </div>
                    <div class="mod-row-info">
                        <div class="mod-row-title-line">
                            <span class="mod-row-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                            ${p.version ? `<span class="mod-version-tag">v${escapeHtml(p.version)}</span>` : ''}
                            <span class="mod-row-badge ${p.enabled ? 'badge-enabled' : 'badge-disabled'}">
                                ${p.enabled ? '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Aktivní' : 'Vypnuto'}
                            </span>
                        </div>
                        <div class="mod-row-file-meta">
                            <span class="mod-file-name" title="${escapeHtml(p.filename)}">${escapeHtml(cleanFileName)}</span>
                            <span>•</span>
                            <span class="mod-file-size">${escapeHtml(p.sizeFormatted)}</span>
                        </div>
                    </div>
                </div>
                <div class="mod-row-actions">
                    <button type="button" class="btn-pack-toggle btn-mod-toggle ${p.enabled ? 'btn-disable' : 'btn-enable'}"
                        data-filename="${escapeHtml(p.filename)}"
                        data-pack-type="${escapeHtml(packType)}"
                        title="${p.enabled ? 'Deaktivovat' : 'Aktivovat'}">
                        <span>${p.enabled ? 'Vypnout' : 'Zapnout'}</span>
                    </button>
                    <button type="button" class="btn-pack-delete btn-mod-delete"
                        data-filename="${escapeHtml(p.filename)}"
                        data-pack-type="${escapeHtml(packType)}"
                        title="Smazat soubor">
                        <span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Smazat</span>
                    </button>
                </div>
            </div>
            `;
        }).join('');

        // Bind toggle pack
        listEl.querySelectorAll('.btn-pack-toggle').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const fn = btn.dataset.filename;
                const pt = btn.dataset.packType;
                btn.disabled = true;
                try {
                    const res = await window.api.toggleProfilePack(profId, pt, fn);
                    if (res && res.success) {
                        showToast(res.enabled ? 'Aktivováno' : 'Deaktivováno', 'info');
                        await loadProfileMods(profId);
                    } else {
                        showToast('Chyba: ' + (res?.error || 'Neznámá chyba'), 'error');
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
                }
            };
        });

        // Bind delete pack with iOS-style uninstall animation
        listEl.querySelectorAll('.btn-pack-delete').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const fn = btn.dataset.filename;
                const pt = btn.dataset.packType;
                if (!confirm(`Opravdu chceš smazat "${fn}" z profilu?`)) return;
                btn.disabled = true;

                const rowItem = btn.closest('.installed-mod-row');
                if (rowItem) {
                    rowItem.classList.add('ios-uninstalling');
                }

                await new Promise(r => setTimeout(r, 380));

                try {
                    const res = await window.api.deleteProfilePack(profId, pt, fn);
                    if (res && res.success) {
                        showToast('Položka byla odinstalována.', 'success');
                        await loadProfileMods(profId);
                    } else {
                        showToast('Chyba: ' + (res?.error || 'Neznámá chyba'), 'error');
                        if (rowItem) rowItem.classList.remove('ios-uninstalling');
                        btn.disabled = false;
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
                    if (rowItem) rowItem.classList.remove('ios-uninstalling');
                    btn.disabled = false;
                }
            };
        });
    }

    // Render filtered installed items according to active subtab
    function renderFilteredInstalledItems() {
        if (currentInstalledTab === 'mods') {
            renderFilteredInstalledMods();
        } else {
            renderFilteredInstalledPacks(currentInstalledTab);
        }
    }

    // Subtabs: Módy vs Texture Packy vs Shadery
    const tabInstalledMods = document.getElementById('tabInstalledMods');
    const tabInstalledResourcePacks = document.getElementById('tabInstalledResourcePacks');
    const tabInstalledShaders = document.getElementById('tabInstalledShaders');

    [tabInstalledMods, tabInstalledResourcePacks, tabInstalledShaders].forEach(tabBtn => {
        if (!tabBtn) return;
        tabBtn.addEventListener('click', () => {
            [tabInstalledMods, tabInstalledResourcePacks, tabInstalledShaders].forEach(b => {
                if (b) b.classList.remove('active');
            });
            tabBtn.classList.add('active');
            currentInstalledTab = tabBtn.dataset.packType || 'mods';
            renderFilteredInstalledItems();
        });
    });

    const installedModsSearchInput = document.getElementById('installedModsSearchInput');
    if (installedModsSearchInput) {
        installedModsSearchInput.addEventListener('input', () => {
            renderFilteredInstalledItems();
        });
    }

    // Subtabs: Mody, Resource Packy, Shadery
    modTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modTabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const modType = btn.dataset.modType || 'mod';
            currentModFilter.projectType = modType;
            loadModrinthMods();
        });
    });

    function extractVersionParts(v) {
        if (!v) return [];
        let s = String(v).trim();
        s = s.replace(/^v/i, '');
        let prev;
        do {
            prev = s;
            s = s.replace(/^(?:fabric|forge|neoforge|quilt|mc[0-9.]*)[-_+]/i, '');
            s = s.replace(/^v/i, '');
        } while (s !== prev);

        const leftOfPlus = s.split('+')[0].trim();
        const candidate = /\d/.test(leftOfPlus) ? leftOfPlus : s;
        const match = candidate.match(/(\d+(?:\.\d+)*)/);
        if (!match) return [];
        return match[1].split('.').map(n => parseInt(n, 10) || 0);
    }

    /**
     * Zjistí, zda je vzdálená verze z Modrinthu novější než lokálně nainstalovaná verze v profilu.
     */
    function isModVersionNewer(remoteVer, localVer) {
        if (!remoteVer || !localVer) return false;
        if (remoteVer.trim().toLowerCase() === localVer.trim().toLowerCase()) return false;

        const rParts = extractVersionParts(remoteVer);
        const lParts = extractVersionParts(localVer);

        if (rParts.length === 0 || lParts.length === 0) return false;

        for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
            const r = rParts[i] || 0;
            const l = lParts[i] || 0;
            if (r > l) return true;
            if (r < l) return false;
        }

        return false;
    }

    function cleanMinecraftFormatting(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/§[0-9a-fk-or]/gi, '')
            .replace(/§#[0-9a-fA-F]{6}/gi, '')
            .replace(/§/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Získá čistý základ názvu módu / resource packu / shaderu z názvu souboru
     * bez loaderů (fabric, forge, neoforge, quilt), MC tagů a verzí.
     */
    function extractModBaseName(filename) {
        if (!filename) return '';
        let base = filename.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '');
        let prev;
        do {
            prev = base;
            // 1. Oříznout koncový loader (-fabric, -forge, -neoforge, -quilt)
            base = base.replace(/[-_+](?:fabric|forge|neoforge|quilt)$/i, '');
            // 2. Oříznout koncovou verzi, mc tag nebo build tag (-1.5.1+26.2, +1.20.4, _r5.8.1, -mc1.20.4, +edge, -v2.5)
            base = base.replace(/[-_+](?:(?:mc)?[0-9][0-9._\-+a-zA-Z]*|[vr][0-9][0-9._\-+a-zA-Z]*)$/i, '');
            // 3. Oříznout loader spojený s verzí (-fabric-1.5.1, _forge_1.20)
            base = base.replace(/[-_+](?:fabric|forge|neoforge|quilt)[-_+][0-9a-zA-Z._\-+]*$/i, '');
        } while (base !== prev && base.length > 2);
        return base;
    }

    /**
     * Spolehlivě a přesně najde odpovídající nainstalovaný mód, resource pack nebo shader v profilu pro danou položku z katalogu Modrinth.
     * Striktní porovnávání zabraňuje falešným pozitivům (např. 'Sounds' vs 'Sound Physics Remastered').
     */
    function findInstalledModForCatalog(catalogMod, profileMods) {
        if (!profileMods || profileMods.length === 0 || !catalogMod) return null;

        const catId = (catalogMod.id || '').toLowerCase().trim();
        const catSlug = (catalogMod.slug || catalogMod.id || '').toLowerCase().trim();
        const catProjId = (catalogMod.project_id || '').toLowerCase().trim();
        const catTitle = (catalogMod.title || '').toLowerCase().trim();

        const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanSlug = clean(catSlug);
        const cleanTitle = clean(catTitle);
        const cleanId = clean(catId);
        const cleanProjId = clean(catProjId);

        for (const inst of profileMods) {
            // 0. 100% jistá metadata shoda z .mod_meta.json (uložená při stažení přes launcher)
            const instMId = (inst.modrinthId || '').toLowerCase().trim();
            const instMSlug = (inst.modrinthSlug || '').toLowerCase().trim();
            if (instMId && (instMId === catId || instMId === catSlug || instMId === catProjId)) {
                return inst;
            }
            if (instMSlug && (instMSlug === catId || instMSlug === catSlug || instMSlug === catProjId)) {
                return inst;
            }

            const instModId = (inst.modId || '').toLowerCase().trim();
            const instName = (inst.name || inst.cleanName || '').toLowerCase().trim();
            const instFile = (inst.filename || '').toLowerCase().trim();
            const cleanInstId = clean(instModId);
            const cleanInstName = clean(instName);

            // 1. Shoda podle interního ID módu z deskriptoru (fabric.mod.json / mods.toml / quilt.mod.json)
            // Např. modId 'sound_physics_remastered' (clean: soundphysicsremastered) vs slug 'sound-physics-remastered'
            if (cleanInstId) {
                if (cleanSlug && cleanInstId === cleanSlug) return inst;
                if (cleanId && cleanInstId === cleanId) return inst;
                if (cleanProjId && cleanInstId === cleanProjId) return inst;
            }

            // 2. Přesná shoda podle oficiálního názvu
            // Např. 'Sound Physics Remastered' vs 'Sound Physics Remastered'
            if (cleanInstName) {
                if (cleanTitle && cleanInstName === cleanTitle) return inst;
            }

            // 3. Shoda podle kořenového názvu souboru (bez verzí a loaderů)
            // Např. 'sound-physics-remastered-fabric-1.5.1+26.2.jar' -> 'sound-physics-remastered'
            // 'sounds-2.5.1+edge+26.2-fabric.jar' -> 'sounds'
            // 'ComplementaryReimagined_r5.8.1.zip' -> 'ComplementaryReimagined'
            const fileBase = extractModBaseName(instFile);
            const cleanFileBase = clean(fileBase);

            if (cleanFileBase) {
                if (cleanSlug && cleanFileBase === cleanSlug) return inst;
                if (cleanId && cleanFileBase === cleanId) return inst;
                if (cleanTitle && cleanFileBase === cleanTitle) return inst;
            }
        }
        return null;
    }

    let lastLoadedCatalogMods = [];
    let catalogOffset = 0;
    const catalogLimit = 24;
    let isCatalogLoading = false;
    let hasMoreCatalogMods = true;

    function getModCardSkeletonsHtml(count = 6) {
        let html = '';
        const titleWidths = [180, 220, 160, 205, 175, 190];
        const descWidths1 = ['86%', '92%', '78%', '88%', '82%', '90%'];
        const descWidths2 = ['52%', '68%', '45%', '58%', '62%', '48%'];

        for (let i = 0; i < count; i++) {
            const delay = (i * 0.12).toFixed(2);
            const tW = titleWidths[i % titleWidths.length];
            const dW1 = descWidths1[i % descWidths1.length];
            const dW2 = descWidths2[i % descWidths2.length];

            html += `
                <div class="mod-card-row mod-card-skeleton" style="--sk-delay: ${delay}s;" aria-hidden="true">
                    <div class="skeleton-avatar"></div>
                    <div class="mod-info-area">
                        <div class="mod-name-row">
                            <div class="skeleton-bar skeleton-title" style="width: ${tW}px; height: 16px;"></div>
                            <div class="skeleton-bar skeleton-author" style="width: 65px; height: 12px;"></div>
                        </div>
                        <div class="skeleton-desc-area">
                            <div class="skeleton-bar skeleton-desc-line" style="width: ${dW1}; height: 12px;"></div>
                            <div class="skeleton-bar skeleton-desc-line" style="width: ${dW2}; height: 12px;"></div>
                        </div>
                        <div class="mod-stats-row">
                            <div class="skeleton-bar skeleton-stat" style="width: 80px; height: 12px;"></div>
                            <div class="skeleton-bar skeleton-stat" style="width: 90px; height: 12px;"></div>
                            <div class="skeleton-bar skeleton-stat" style="width: 70px; height: 12px;"></div>
                        </div>
                    </div>
                    <div class="skeleton-btn"></div>
                </div>
            `;
        }
        return html;
    }

    async function loadModrinthMods(reset = true) {
        if (!modsCardsList) return;
        let infiniteSkeletonsEl = null;

        if (reset) {
            catalogOffset = 0;
            hasMoreCatalogMods = true;
            lastLoadedCatalogMods = [];
            modsCardsList.innerHTML = getModCardSkeletonsHtml(6);
        } else {
            infiniteSkeletonsEl = document.createElement('div');
            infiniteSkeletonsEl.className = 'catalog-infinite-skeletons';
            infiniteSkeletonsEl.innerHTML = getModCardSkeletonsHtml(3);
            modsCardsList.appendChild(infiniteSkeletonsEl);
        }

        if (isCatalogLoading) {
            if (infiniteSkeletonsEl && infiniteSkeletonsEl.parentNode) {
                infiniteSkeletonsEl.remove();
            }
            return;
        }
        isCatalogLoading = true;

        try {
            // VŽDY načteme aktuální položky profilu (módy, resource packy i shadery) přímo z disku
            const profId = selectedModsProfileId || currentConfig.activeProfileId;
            if (profId) {
                try {
                    const pRes = await window.api.getProfileMods(profId);
                    if (pRes && pRes.success) {
                        currentProfileModsList = pRes.mods || [];
                    }
                } catch (_) { }

                try {
                    const rpRes = await window.api.getProfilePacks(profId, 'resourcepacks');
                    if (rpRes && rpRes.success) {
                        currentProfileResourcePacksList = rpRes.packs || [];
                    }
                } catch (_) { }

                try {
                    const shRes = await window.api.getProfilePacks(profId, 'shaderpacks');
                    if (shRes && shRes.success) {
                        currentProfileShadersList = shRes.packs || [];
                    }
                } catch (_) { }
            }

            const mods = await window.api.searchModrinth(
                currentModFilter.query,
                currentModFilter.version,
                currentModFilter.loader,
                currentModFilter.category,
                currentModFilter.projectType || 'mod',
                catalogOffset,
                catalogLimit
            );

            const received = Array.isArray(mods) ? mods : [];
            if (received.length < catalogLimit) {
                hasMoreCatalogMods = false;
            }

            if (reset) {
                lastLoadedCatalogMods = received;
            } else {
                lastLoadedCatalogMods = [...lastLoadedCatalogMods, ...received];
            }

            catalogOffset += received.length;
            renderModCards(lastLoadedCatalogMods);
        } catch (e) {
            if (reset) {
                modsCardsList.innerHTML = `<div class="mods-loading">Nepodařilo se načíst data z katalogu.</div>`;
            }
        } finally {
            if (infiniteSkeletonsEl && infiniteSkeletonsEl.parentNode) {
                infiniteSkeletonsEl.remove();
            }
            isCatalogLoading = false;
        }
    }

    // Apple-style circular progress overlay on mod avatar & pre-launch download progress bar
    if (window.api && window.api.onModDownloadProgress) {
        window.api.onModDownloadProgress((data) => {
            if (!data) return;

            if (data.id) {
                const boxes = document.querySelectorAll(`.mod-avatar-box[data-mod-id="${CSS.escape(data.id)}"]`);
                boxes.forEach(box => {
                    const ov = box.querySelector('.apple-progress-overlay');
                    const bar = box.querySelector('.apple-progress-bar');
                    if (ov && bar) {
                        ov.classList.add('active');
                        const rawPct = Math.max(0, Math.min(100, data.percent || 0));
                        const pct = calculatePerceptualProgress(rawPct);
                        const offset = 87.96 - (87.96 * pct / 100);
                        bar.style.strokeDashoffset = offset;
                    }
                });
            }

            // Živá aktualizace download progress baru během stahování módů před spuštěním hry
            if (activePreLaunchModUpdate && isLaunching) {
                const rawModPct = Math.max(0, Math.min(100, data.percent || 0));
                const span = activePreLaunchModUpdate.nextPct - activePreLaunchModUpdate.basePct;
                const currentOverallPct = Math.min(99, Math.round(activePreLaunchModUpdate.basePct + (rawModPct * span / 100)));
                const mbReceived = data.received ? (data.received / 1048576).toFixed(1) : null;
                const mbTotal = data.total ? (data.total / 1048576).toFixed(1) : null;
                const sizeStr = (mbReceived && mbTotal && Number(mbTotal) > 0) ? ` (${mbReceived}/${mbTotal} MB)` : '';
                const text = `Stahuji aktualizaci: ${activePreLaunchModUpdate.title}${sizeStr} [${activePreLaunchModUpdate.index + 1}/${activePreLaunchModUpdate.total}]`;

                if (progressBar) progressBar.style.width = `${currentOverallPct}%`;
                if (progressPercent) progressPercent.textContent = `${currentOverallPct}%`;
                if (progressText) progressText.textContent = text;
                if (globalDownloadBar) globalDownloadBar.style.width = `${currentOverallPct}%`;
                if (globalDownloadText) globalDownloadText.textContent = `${text} (${currentOverallPct}%)`;
                if (sideConsoleStatus) sideConsoleStatus.textContent = text;
            }
        });
    }

    function renderModCards(mods) {
        if (!modsCardsList) return;
        if (!mods || mods.length === 0) {
            modsCardsList.innerHTML = `<div class="mods-loading">Nenalezeny žádné položky odpovídající hledání.</div>`;
            const btnUpdateAll = document.getElementById('btnUpdateAllCatalogMods');
            if (btnUpdateAll) btnUpdateAll.style.display = 'none';
            return;
        }

        const targetProfile = (currentConfig.profiles || []).find(p => p.id === (selectedModsProfileId || currentConfig.activeProfileId));
        const targetMcVersion = targetProfile?.version || currentModFilter.version || '26.2';

        // Pokud je vybrána verze hry, zobrazujeme v katalogu pouze kompatibilní mody pro danou verzi
        const displayMods = mods.filter(m => {
            if (!targetMcVersion) return true;
            if (!m.latest_game_versions || m.latest_game_versions.length === 0) return true;
            return m.latest_game_versions.includes(targetMcVersion);
        });

        if (displayMods.length === 0) {
            modsCardsList.innerHTML = `<div class="mods-loading">Žádné položky odpovídající verzi MC ${escapeHtml(targetMcVersion)}.</div>`;
            const btnUpdateAll = document.getElementById('btnUpdateAllCatalogMods');
            if (btnUpdateAll) btnUpdateAll.style.display = 'none';
            return;
        }

        const updateableMods = [];

        // Vybereme správný seznam nainstalovaných položek podle aktivního typu projektu
        const activeInstalledList = currentModFilter.projectType === 'shader'
            ? currentProfileShadersList
            : (currentModFilter.projectType === 'resourcepack' ? currentProfileResourcePacksList : currentProfileModsList);

        modsCardsList.innerHTML = displayMods.map(m => {
            const installedMod = findInstalledModForCatalog(m, activeInstalledList);
            // Zásadní oprava: Zda je položka nainstalována, závisí VÝHRADNĚ na tom, zda skutečně existuje v profilu!
            const isInstalled = !!installedMod;
            const currentVer = installedMod ? (installedMod.version || '') : '';
            const latestVer = m.latest_version_number || '';

            // Kontrola, zda nová verze podporuje stejnou verzi hry:
            // Pokud je nová verze pro jinou verzi MC, neukazujeme aktualizaci, ale "Staženo" / "Nainstalováno"
            const latestSupportsOurMc = !m.latest_game_versions || m.latest_game_versions.length === 0 || m.latest_game_versions.includes(targetMcVersion);
            const isCompatibleWithTarget = latestSupportsOurMc;
            const displayVersionTag = (m.latest_game_versions && m.latest_game_versions.length > 0)
                ? (m.latest_game_versions.includes(targetMcVersion) ? targetMcVersion : m.latest_game_versions[m.latest_game_versions.length - 1])
                : (currentModFilter.version || targetMcVersion);
            const hasUpdate = isInstalled && isModVersionNewer(latestVer, currentVer) && latestSupportsOurMc;

            if (hasUpdate) {
                updateableMods.push({ mod: m, installedMod });
            }

            const downloadsFormatted = m.downloads > 1000000
                ? (m.downloads / 1000000).toFixed(1) + 'M'
                : (m.downloads / 1000).toFixed(0) + 'k';

            let btnHtml = '';
            let statusPill = '';

            if (hasUpdate) {
                statusPill = `<span class="mod-status-pill mod-status-update"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg> Nová verze v${escapeHtml(latestVer)}</span>`;
                btnHtml = `
                    <div class="mod-card-actions">
                        <button class="mc-btn btn-update-mod btn-toggle-mod" data-mod="${escapeHtml(m.id)}" data-action="update" data-old-file="${escapeHtml(installedMod?.filename || '')}" title="Aktualizovat na novější verzi v${escapeHtml(latestVer)}">
                            <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg> Aktualizovat</span>
                        </button>
                        <button class="mc-btn btn-catalog-delete-mod" data-filename="${escapeHtml(installedMod?.filename || '')}" data-mod-title="${escapeHtml(m.title)}" title="Smazat mód z profilu">
                            <span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span>
                        </button>
                    </div>
                `;
            } else if (isInstalled) {
                statusPill = `<span class="mod-status-pill mod-status-installed"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Nainstalováno${currentVer ? ` (v${escapeHtml(currentVer)})` : ''}</span>`;
                btnHtml = `
                    <div class="mod-card-actions">
                        <button class="mc-btn btn-download-success btn-toggle-mod" data-mod="${escapeHtml(m.id)}" data-action="installed" title="Již nainstalováno v profilu">
                            <span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Nainstalováno</span>
                        </button>
                        <button class="mc-btn btn-catalog-delete-mod" data-filename="${escapeHtml(installedMod?.filename || '')}" data-mod-title="${escapeHtml(m.title)}" title="Smazat mód z profilu">
                            <span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span>
                        </button>
                    </div>
                `;
            } else if (!isCompatibleWithTarget) {
                statusPill = `<span class="mod-status-pill mod-status-incompatible"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Nekompatibilní (MC ${escapeHtml(displayVersionTag)})</span>`;
                btnHtml = `
                    <button class="mc-btn btn-incompatible-mod" disabled title="Mód není dostupný pro Minecraft ${escapeHtml(targetMcVersion)} (dostupné pro: MC ${escapeHtml(displayVersionTag)})">
                        <span>Nekompatibilní</span>
                    </button>
                `;
            } else {
                btnHtml = `
                    <button class="mc-btn mc-btn-green btn-toggle-mod" data-mod="${escapeHtml(m.id)}" data-action="download" title="Stáhnout do profilu">
                        <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout</span>
                    </button>
                `;
            }

            return `
                <div class="mod-card-row">
                    <div class="mod-avatar-box" data-mod-id="${escapeHtml(m.id)}">
                        <img src="${escapeHtml(m.icon_url)}" class="mod-avatar" onerror="this.src='assets/server-icon.png'">
                        <div class="apple-progress-overlay">
                            <svg class="apple-progress-svg" viewBox="0 0 36 36">
                                <circle class="apple-progress-bg" cx="18" cy="18" r="14"></circle>
                                <circle class="apple-progress-bar" cx="18" cy="18" r="14"></circle>
                            </svg>
                            <span class="apple-progress-stop"></span>
                        </div>
                    </div>
                    <div class="mod-info-area">
                        <div class="mod-name-row">
                            <span class="mod-name-title">${escapeHtml(m.title)}</span>
                            ${statusPill}
                            <span class="mod-author-lbl">od ${escapeHtml(m.author)}</span>
                        </div>
                        <div class="mod-desc-text">${escapeHtml(m.description)}</div>
                        <div class="mod-stats-row">
                            <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> ${downloadsFormatted} stažení</span>
                            <span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> ${(m.follows || 1000).toLocaleString()} oblíbení</span>
                            <span>Verze: MC ${escapeHtml(displayVersionTag)}</span>
                        </div>
                    </div>
                    ${btnHtml}
                </div>
            `;
        }).join('');

        // Tlačítko pro hromadnou aktualizaci všech zastaralých módů najednou
        const btnUpdateAll = document.getElementById('btnUpdateAllCatalogMods');
        const updateAllCountEl = document.getElementById('updateAllCount');
        if (btnUpdateAll && updateAllCountEl) {
            if (updateableMods.length > 0) {
                updateAllCountEl.textContent = updateableMods.length;
                btnUpdateAll.style.display = 'inline-flex';
                btnUpdateAll.onclick = async () => {
                    btnUpdateAll.disabled = true;
                    const total = updateableMods.length;
                    let successCount = 0;
                    appendLog(`[UPDATE] Spouštím hromadnou aktualizaci ${total} módů...`);

                    for (let idx = 0; idx < total; idx++) {
                        const item = updateableMods[idx];
                        btnUpdateAll.innerHTML = `<span class="spinner-inline"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg></span> <span>Aktualizuji ${idx + 1}/${total}...</span>`;
                        const itemBox = document.querySelector(`.mod-avatar-box[data-mod-id="${CSS.escape(item.mod.id)}"]`);
                        if (itemBox) {
                            const ov = itemBox.querySelector('.apple-progress-overlay');
                            const bar = itemBox.querySelector('.apple-progress-bar');
                            if (ov && bar) {
                                ov.classList.remove('success');
                                ov.classList.add('active');
                                bar.style.strokeDashoffset = '87.96';
                            }
                        }
                        try {
                            const targetProfileId = selectedModsProfileId || currentConfig.activeProfileId;
                            const prof = (currentConfig.profiles || []).find(p => p.id === targetProfileId);
                            const profVer = prof?.version || currentModFilter.version || '26.2';
                            let chosenLoader = prof?.loader && prof.loader !== 'vanilla' ? prof.loader : (currentModFilter.loader || 'fabric');

                            const res = await window.api.downloadModOrPack({
                                id: item.mod.id,
                                title: item.mod.title,
                                projectType: currentModFilter.projectType || 'mod',
                                version: profVer,
                                loader: chosenLoader,
                                profileId: targetProfileId,
                                oldFilename: item.installedMod?.filename || null
                            });

                            if (res && res.success) {
                                successCount++;
                                appendLog(`[UPDATE] ${item.mod.title} byl aktualizován na novou verzi (${res.filename}).`);
                                if (itemBox) {
                                    const ov = itemBox.querySelector('.apple-progress-overlay');
                                    const bar = itemBox.querySelector('.apple-progress-bar');
                                    if (ov && bar) {
                                        bar.style.strokeDashoffset = '0';
                                        ov.classList.add('success');
                                        setTimeout(() => {
                                            ov.classList.remove('active', 'success');
                                            bar.style.strokeDashoffset = '87.96';
                                        }, 600);
                                    }
                                }
                            } else if (itemBox) {
                                const ov = itemBox.querySelector('.apple-progress-overlay');
                                const bar = itemBox.querySelector('.apple-progress-bar');
                                if (ov && bar) {
                                    ov.classList.remove('active', 'success');
                                    bar.style.strokeDashoffset = '87.96';
                                }
                            }
                        } catch (err) {
                            console.warn(`Selhala aktualizace módu ${item.mod.id}:`, err);
                            if (itemBox) {
                                const ov = itemBox.querySelector('.apple-progress-overlay');
                                const bar = itemBox.querySelector('.apple-progress-bar');
                                if (ov && bar) {
                                    ov.classList.remove('active', 'success');
                                    bar.style.strokeDashoffset = '87.96';
                                }
                            }
                        }
                    }

                    showToast(`Aktualizováno ${successCount} z ${total} módů.`, 'success');
                    btnUpdateAll.disabled = false;
                    btnUpdateAll.style.display = 'none';

                    const targetProfileId = selectedModsProfileId || currentConfig.activeProfileId;
                    await loadProfileMods(targetProfileId);
                    await loadModrinthMods(true);
                };
            } else {
                btnUpdateAll.style.display = 'none';
            }
        }

        // Bind interactive delete buttons directly from catalog with iOS-style reverse animation
        modsCardsList.querySelectorAll('.btn-catalog-delete-mod').forEach(delBtn => {
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = delBtn.dataset.filename;
                const modTitle = delBtn.dataset.modTitle || 'položku';
                const targetProfileId = selectedModsProfileId || currentConfig.activeProfileId;
                if (!filename) {
                    showToast('Nelze dohledat soubor pro smazání.', 'error');
                    return;
                }
                if (!confirm(`Opravdu chceš smazat "${modTitle}" z profilu?`)) return;

                delBtn.disabled = true;
                const cardRow = delBtn.closest('.mod-card-row');
                const avatarBox = cardRow?.querySelector('.mod-avatar-box');
                const ov = avatarBox?.querySelector('.apple-progress-overlay');
                const bar = avatarBox?.querySelector('.apple-progress-bar');

                // iOS-style uninstall reverse download animation
                if (avatarBox) avatarBox.classList.add('ios-uninstalling');
                if (cardRow) cardRow.classList.add('ios-card-uninstalling');

                if (ov && bar) {
                    ov.classList.remove('success');
                    ov.classList.add('active', 'uninstalling');
                    bar.style.transition = 'none';
                    bar.style.strokeDashoffset = '0';
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            bar.style.transition = 'stroke-dashoffset 0.45s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s ease';
                            bar.style.strokeDashoffset = '87.96';
                        });
                    });
                }

                delBtn.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin ui-icon-svg--red" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg></span>`;

                await new Promise(r => setTimeout(r, 450));

                try {
                    const projType = currentModFilter.projectType || 'mod';
                    let res;
                    if (projType === 'shader') {
                        res = await window.api.deleteProfilePack(targetProfileId, 'shaderpacks', filename);
                    } else if (projType === 'resourcepack') {
                        res = await window.api.deleteProfilePack(targetProfileId, 'resourcepacks', filename);
                    } else {
                        res = await window.api.deleteProfileMod(targetProfileId, filename);
                    }

                    if (res && res.success) {
                        showToast(`${modTitle} byl odinstalován z profilu.`, 'success');
                        await loadProfileMods(targetProfileId);
                        renderModCards(lastLoadedCatalogMods);
                    } else {
                        showToast('Chyba při mazání: ' + (res?.error || 'Neznámá chyba'), 'error');
                        if (ov) ov.classList.remove('active', 'uninstalling');
                        if (avatarBox) avatarBox.classList.remove('ios-uninstalling');
                        if (cardRow) cardRow.classList.remove('ios-card-uninstalling');
                        delBtn.disabled = false;
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
                    if (ov) ov.classList.remove('active', 'uninstalling');
                    if (avatarBox) avatarBox.classList.remove('ios-uninstalling');
                    if (cardRow) cardRow.classList.remove('ios-card-uninstalling');
                    delBtn.disabled = false;
                }
            });
        });

        // Bind interactive download and update buttons
        modsCardsList.querySelectorAll('.btn-toggle-mod').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                const modId = btn.dataset.mod;
                const oldFile = btn.dataset.oldFile;
                const modItem = (mods || []).find(x => x.id === modId);
                const title = modItem ? modItem.title : modId;
                const targetProfileId = selectedModsProfileId || currentConfig.activeProfileId;
                const targetProfile = (currentConfig.profiles || []).find(p => p.id === targetProfileId);
                const profileLoader = targetProfile?.loader || 'vanilla';
                const profileVersion = targetProfile?.version || currentModFilter.version || '26.2';

                if (action === 'installed') {
                    showToast(`Mód ${title} je již v profilu nainstalován.`, 'info');
                    return;
                }

                const isUpdate = action === 'update';

                // Přísná ochrana proti stažení nesprávného loaderu (např. Forge na Fabric profil):
                let chosenLoader = 'fabric';
                if (profileLoader !== 'vanilla') {
                    chosenLoader = profileLoader;
                    if (modItem && Array.isArray(modItem.loaders) && modItem.loaders.length > 0 && !modItem.loaders.includes(profileLoader)) {
                        showToast(`Mód "${title}" není dostupný pro zavaděč ${profileLoader.toUpperCase()}!`, 'error');
                        return;
                    }
                } else {
                    // Profil je Vanilla: zvolíme loader dle filtru nebo primární podpory módu
                    if (currentModFilter.loader && modItem?.loaders?.includes(currentModFilter.loader)) {
                        chosenLoader = currentModFilter.loader;
                    } else if (modItem?.loaders?.includes('fabric')) {
                        chosenLoader = 'fabric';
                    } else if (modItem?.loaders?.includes('forge')) {
                        chosenLoader = 'forge';
                    } else if (modItem?.loaders?.includes('neoforge')) {
                        chosenLoader = 'neoforge';
                    } else {
                        chosenLoader = 'fabric';
                    }
                }

                // Micro-animation: Button spinner state
                btn.disabled = true;
                btn.classList.add('btn-downloading');
                btn.innerHTML = `<span class="spinner-inline"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg></span> <span>${isUpdate ? 'Aktualizuji...' : 'Stahuji...'}</span>`;

                const avatarBox = btn.closest('.mod-card-row')?.querySelector('.mod-avatar-box') || document.querySelector(`.mod-avatar-box[data-mod-id="${CSS.escape(modId)}"]`);
                if (avatarBox) {
                    const ov = avatarBox.querySelector('.apple-progress-overlay');
                    const bar = avatarBox.querySelector('.apple-progress-bar');
                    if (ov && bar) {
                        ov.classList.remove('success');
                        ov.classList.add('active');
                        bar.style.strokeDashoffset = '87.96';
                    }
                }

                try {
                    const res = await window.api.downloadModOrPack({
                        id: modId,
                        title: title,
                        projectType: currentModFilter.projectType || 'mod',
                        version: profileVersion,
                        loader: chosenLoader,
                        profileId: targetProfileId,
                        oldFilename: oldFile || null
                    });

                    if (res && res.success) {
                        btn.classList.remove('btn-downloading', 'btn-update-mod', 'mc-btn-green', 'mc-btn-primary');
                        btn.classList.add('btn-download-success');
                        btn.dataset.action = 'installed';
                        btn.innerHTML = `<span class="checkmark-anim"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></span> <span>STAŽENO</span>`;

                        if (avatarBox) {
                            const ov = avatarBox.querySelector('.apple-progress-overlay');
                            const bar = avatarBox.querySelector('.apple-progress-bar');
                            if (ov && bar) {
                                bar.style.strokeDashoffset = '0';
                                ov.classList.add('success');
                                setTimeout(() => {
                                    ov.classList.remove('active', 'success');
                                    bar.style.strokeDashoffset = '87.96';
                                }, 600);
                            }
                        }

                        const sub = res.subfolder || 'mods';
                        const toastMsg = isUpdate
                            ? `${title} byl aktualizován.`
                            : `${title} byl stažen.`;
                        showToast(toastMsg, 'success');
                        appendLog(`[DOWNLOAD] ${title} (${res.filename}) ${isUpdate ? 'aktualizován' : 'stažen'} do ${sub}/ v profilu ${targetProfileId}.`);

                        // Automatické přepnutí loaderu profilu pouze pokud byl profil Vanilla
                        if (res.loaderChanged) {
                            const pObj = (currentConfig.profiles || []).find(p => p.id === targetProfileId);
                            if (pObj) {
                                pObj.loader = res.newLoader;
                            }
                            if (currentConfig.activeProfileId === targetProfileId) {
                                currentConfig.loader = res.newLoader;
                            }
                            const loaderLabels = {
                                fabric: 'Fabric',
                                forge: 'Forge',
                                neoforge: 'NeoForge',
                                vanilla: 'Vanilla'
                            };
                            const niceNew = loaderLabels[res.newLoader] || res.newLoader;
                            const nicePrev = loaderLabels[res.prevLoader] || res.prevLoader || 'Vanilla';
                            showToast(`Profil přepnut na ${niceNew}.`, 'info');
                            appendLog(`[LOADER] Profil "${pObj ? pObj.name : targetProfileId}" přepnut z ${nicePrev} na ${niceNew}.`);

                            renderModsProfileDropdown();
                            refreshVersionStatuses();
                            renderProfilesList();
                        }

                        // VŽDY synchronizujeme nainstalované položky z disku a překreslíme karty v katalogu
                        await loadProfileMods(targetProfileId);
                        renderModCards(lastLoadedCatalogMods);
                        await checkWardenProbe();
                        if (currentIllegalMods && currentIllegalMods.length > 0) {
                            showToast('Tento mód je stažen, ale je zakázán na serveru MYCHAL SMP.', 'warning');
                        }
                    } else {
                        if (avatarBox) {
                            const ov = avatarBox.querySelector('.apple-progress-overlay');
                            const bar = avatarBox.querySelector('.apple-progress-bar');
                            if (ov && bar) {
                                ov.classList.remove('active', 'success');
                                bar.style.strokeDashoffset = '87.96';
                            }
                        }
                        btn.classList.remove('btn-downloading');
                        btn.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <span>Chyba</span>`;
                        showToast(`Chyba při stahování: ${res.error || 'Neznámá chyba'}`, 'error');
                    }
                } catch (e) {
                    if (avatarBox) {
                        const ov = avatarBox.querySelector('.apple-progress-overlay');
                        const bar = avatarBox.querySelector('.apple-progress-bar');
                        if (ov && bar) {
                            ov.classList.remove('active', 'success');
                            bar.style.strokeDashoffset = '87.96';
                        }
                    }
                    btn.classList.remove('btn-downloading');
                    btn.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <span>Chyba</span>`;
                    showToast(`Chyba: ${e.message}`, 'error');
                } finally {
                    setTimeout(() => {
                        btn.disabled = false;
                    }, 1000);
                }
            });
        });
    }

    // Modrinth filters
    let searchDebounce = null;
    if (modSearchInput) {
        modSearchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                currentModFilter.query = e.target.value.trim();
                loadModrinthMods();
            }, 300);
        });
    }

    document.querySelectorAll('input[name="filterVersion"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentModFilter.version = e.target.value;
            loadModrinthMods();
        });
    });

    document.querySelectorAll('input[name="filterLoader"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentModFilter.loader = e.target.value;
            loadModrinthMods();
        });
    });

    document.querySelectorAll('input[name="filterCategory"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentModFilter.category = e.target.value;
            loadModrinthMods();
        });
    });

    // Nekonečné scrollování (Infinite Scroll) v katalogu Modrinth
    if (modsCardsList) {
        modsCardsList.addEventListener('scroll', () => {
            if (isCatalogLoading || !hasMoreCatalogMods) return;
            const { scrollTop, scrollHeight, clientHeight } = modsCardsList;
            if (scrollTop + clientHeight >= scrollHeight - 350) {
                loadModrinthMods(false);
            }
        });
    }

    // ── 3D Skin Viewer (skinview3d) Integration ────────────────────────────
    let activeMojangCapeUrl = null;
    let defaultServerCapeDataUrl = null;
    let isBackEquipmentElytra = false;
    let isFlyingAnimationActive = false;
    let isAutoRotateActive = false;
    let lastLoadedSkinUrl = null;
    let lastLoadedCapeUrl = null;

    // Smooth return physics & drag controls for hero card
    let heroManualRotY = 0;
    let heroManualRotX = 0;
    let heroDragVelocityY = 0;
    let heroDragVelocityX = 0;
    let isDraggingHero = false;
    let lastDragPointerX = 0;
    let lastDragPointerY = 0;
    let startDragPointerX = 0;
    let startDragPointerY = 0;

    // Head tracking & curiosity tilt physics (cursor and button hover)
    let targetHeroHeadLookX = 0;
    let targetHeroHeadLookY = 0;
    let currentHeroHeadLookX = 0;
    let currentHeroHeadLookY = 0;
    let targetHeroCuriosityTilt = 0;
    let currentHeroCuriosityTilt = 0;
    let heroCuriosityVelocity = 0;
    let isHeroHoverTrackingActive = false;

    // Greeting wave physics: waves automatically 2s after startup or on click / tray restore
    let heroWaveStartTime = Date.now() + 2000;
    let heroWaveDuration = 2400;
    let isQuickWave = false;
    let lastHeroWaveTime = Date.now() + 2000;
    const HERO_WAVE_COOLDOWN_MS = 30000; // 30s cooldown mezi máváním

    function triggerHeroWave(isQuick = false, force = false) {
        const now = Date.now();
        // Pokud od posledního mávnutí neuplynulo alespoň 30 sekund, ignorujeme
        if (!force && (now - lastHeroWaveTime < HERO_WAVE_COOLDOWN_MS)) {
            return;
        }
        lastHeroWaveTime = now;
        isQuickWave = !!isQuick;
        heroWaveDuration = isQuick ? 1200 : 2400;
        heroWaveStartTime = now;
    }

    // Minecraft click punch physics (panáček hitne jako by klikal na tlačítko)
    let heroPunchStartTime = 0;
    const HERO_PUNCH_DURATION = 240;

    function triggerHeroPunch() {
        heroPunchStartTime = Date.now();
    }

    // Launch excitement & celebration spin physics
    let isHeroLaunchSpinning = false;
    let heroSpinAngle = 0;
    let heroCelebrationWeight = 0;

    function setHeroLaunchCelebration(active) {
        isHeroLaunchSpinning = !!active;
        if (!active) {
            heroCelebrationWeight = 0;
            if (heroSkinViewer && heroSkinViewer.playerObject) {
                heroSkinViewer.playerObject.position.y = -1;
            }
        }
    }

    function cancelHeroReturn() {
        // Safe no-op retained for API compatibility
    }

    function scheduleHeroReturn() {
        // Safe no-op retained for API compatibility
    }

    // ── Noční podřimování (Dozing off / Sleepy head-droop & startled wake-up) ───
    let lastHeroUserActivityTime = Date.now();
    let heroSleepWeight = 0;
    let heroSleepCycleStart = Date.now();
    let isForcedSleepTest = false; // Dev/test toggle via window.testHeroSleep()

    // ── Dlouhodobý idle stav (Klepání nohama v 5m, sezení v 10m) ────────────────
    let heroSitWeight = 0;
    let heroLegShakeWeight = 0;
    let isForcedSitTest = false;
    let isForcedShakeTest = false;

    window.testHeroSleep = function (enable = true) {
        isForcedSleepTest = !!enable;
        if (enable) {
            lastHeroUserActivityTime = 0; // Ihned vstoupit do idle režimu
            heroSleepCycleStart = Date.now();
        }
        console.log(`[Hero] Noční podřimování test mód: ${isForcedSleepTest ? 'AKTIVNÍ' : 'VYPNUTO'}`);
    };

    window.testHeroIdleTime = function (minutes = 10) {
        lastHeroUserActivityTime = Date.now() - (minutes * 60 * 1000);
        isForcedSitTest = false;
        isForcedShakeTest = false;
        console.log(`[Hero] Nastaven idle čas: ${minutes} minut. (Aktuální stav: ${minutes >= 10 ? 'SEDÍ' : (minutes >= 5 ? 'KLEPE NOHAMA' : 'STOJÍ')})`);
    };

    window.testHeroSit = function (enable = true) {
        isForcedSitTest = !!enable;
        if (enable) isForcedShakeTest = false;
        console.log(`[Hero] Testovací režim sedu: ${isForcedSitTest ? 'AKTIVNÍ (sedí)' : 'VYPNUT'}`);
    };

    window.testHeroShake = function (enable = true) {
        isForcedShakeTest = !!enable;
        if (enable) isForcedSitTest = false;
        console.log(`[Hero] Testovací režim klepání nohama: ${isForcedShakeTest ? 'AKTIVNÍ' : 'VYPNUT'}`);
    };

    /**
     * Plynulé sledování kurzoru a tlačítek:
     * Postava reaguje POUZE HLAVOU – tělo se natáčí organicky v idle pohybu nebo tažením myší.
     */
    function setupHeroInteractiveHoverTracking() {
        if (isHeroHoverTrackingActive) return;
        isHeroHoverTrackingActive = true;

        const markHeroActivity = () => {
            lastHeroUserActivityTime = Date.now();
        };
        window.addEventListener('pointerdown', markHeroActivity, { passive: true });
        window.addEventListener('keydown', markHeroActivity, { passive: true });
        window.addEventListener('wheel', markHeroActivity, { passive: true });
        window.addEventListener('focus', markHeroActivity, { passive: true });
        window.addEventListener('resize', markHeroActivity, { passive: true });

        window.addEventListener('pointermove', (e) => {
            markHeroActivity();
            const canvas = document.getElementById('heroSkinCanvas3D');
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            // Střed hlavy postavy v souřadnicích okna
            const headCenterX = rect.left + rect.width / 2;
            const headCenterY = rect.top + rect.height * 0.28;

            const dx = e.clientX - headCenterX;
            const dy = e.clientY - headCenterY;

            // Plynule normalizovaný dosah podle velikosti okna
            const winW = Math.max(window.innerWidth, 800);
            const winH = Math.max(window.innerHeight, 600);

            const normX = Math.max(-1, Math.min(1, dx / (winW * 0.45)));
            const normY = Math.max(-1, Math.min(1, dy / (winH * 0.45)));

            // 1. Zvláštní chování pro tlačítka "Hrát" a postavičku (organický jemný náklon hlavy)
            const playBtn = e.target?.closest?.('.btn-launch-profile, #sidebarPlayBtn, #btnQuickPlayMychal, .btn-install-v');
            const heroCanvas = e.target?.closest?.('#heroSkinWrapper, #heroSkinCanvas3D, #stageNickPill');

            if (playBtn) {
                const btnRect = playBtn.getBoundingClientRect();
                const btnCenterX = btnRect.left + btnRect.width / 2;
                const btnCenterY = btnRect.top + btnRect.height / 2;
                const btnDx = btnCenterX - headCenterX;
                const btnDy = btnCenterY - headCenterY;

                const normBtnX = Math.max(-1, Math.min(1, btnDx / (winW * 0.45)));
                const normBtnY = Math.max(-1, Math.min(1, btnDy / (winH * 0.45)));

                targetHeroHeadLookY = normBtnX * 0.35;
                targetHeroHeadLookX = normBtnY * 0.20;

                // Velmi jemný a přirozený zvědavý náklon hlavy
                targetHeroCuriosityTilt = (btnCenterX >= headCenterX ? 0.08 : -0.08);
            } else if (heroCanvas) {
                // Přímé najetí myši na samotnou postavičku – plynulý pohled bez skákání a s jemným, přirozeným náklonem
                targetHeroHeadLookX = normY * 0.12 - 0.02;
                targetHeroHeadLookY = normX * 0.16;
                targetHeroCuriosityTilt = (dx >= 0 ? 0.04 : -0.04);
            } else {
                targetHeroCuriosityTilt = 0;
                // Běžné sledování kurzoru
                const isInteractive = !!e.target?.closest?.('button, .mc-btn, .profile-row-card, .sidebar-nav-item, .dash-action-chip, .stage-nick-pill, .control-field');
                const focusMultiplier = isInteractive ? 1.08 : 1.0;

                targetHeroHeadLookY = normX * 0.28 * focusMultiplier;
                targetHeroHeadLookX = normY * 0.16 * focusMultiplier;
            }
        }, { passive: true });

        // Okamžitá reakce na najetí myši na tlačítko Hrát nebo postavičku i bez pohybu myši (jemné, decentní)
        document.addEventListener('pointerover', (e) => {
            const playBtn = e.target?.closest?.('.btn-launch-profile, #sidebarPlayBtn, #btnQuickPlayMychal, .btn-install-v');
            if (playBtn) {
                const canvas = document.getElementById('heroSkinCanvas3D');
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    const headCenterX = rect.left + rect.width / 2;
                    const btnRect = playBtn.getBoundingClientRect();
                    const btnCenterX = btnRect.left + btnRect.width / 2;
                    targetHeroCuriosityTilt = (btnCenterX >= headCenterX ? 0.08 : -0.08);
                }
            } else if (e.target?.closest?.('#heroSkinWrapper, #heroSkinCanvas3D, #stageNickPill')) {
                targetHeroCuriosityTilt = 0.04;
            }
        }, { passive: true });

        document.addEventListener('pointerout', (e) => {
            if (e.target?.closest?.('.btn-launch-profile, #sidebarPlayBtn, #btnQuickPlayMychal, .btn-install-v, #heroSkinWrapper, #heroSkinCanvas3D, #stageNickPill')) {
                targetHeroCuriosityTilt = 0;
            }
        }, { passive: true });

        // Návrat do klidového pohledu při opuštění okna
        document.addEventListener('pointerleave', () => {
            targetHeroHeadLookX = 0;
            targetHeroHeadLookY = 0;
            targetHeroCuriosityTilt = 0;
        });

        window.addEventListener('blur', () => {
            targetHeroHeadLookX = 0;
            targetHeroHeadLookY = 0;
            targetHeroCuriosityTilt = 0;
        });

        // Pozn.: Obnovení z lišty a mávnutí je řízeno přes resumeLauncherBackgroundActivity()

        // Úder / Minecraft punch swing při kliknutí na jakékoliv tlačítko v launcheru
        document.addEventListener('pointerdown', (e) => {
            if (e.target && !e.target.closest('#heroSkinCanvas3D') && e.target.closest('button, .mc-btn, .sidebar-nav-item, .dash-action-chip, .stage-nick-pill, .profile-row-card, .btn, .icon-btn, .tab-btn, [role="button"], a.btn-primary, .control-field, .action-btn')) {
                triggerHeroPunch();
            }
        }, { passive: true });
    }

    /**
     * Výchozí stav pláště: žádný plášť (hráč začíná vždy s čistým vzhledem bez vnuceného pláště).
     */
    function getDefaultServerCapeUrl() {
        return null;
    }

    /**
     * Inteligentní animace hlavní postavy na dashboardu:
     * 1. Organické vlnění pláště ve větru.
     * 2. Přirozené střídání poloh těla (plynulé jemné natáčení doleva a doprava).
     * 3. Fyzikální momentum (dojezd) při rotaci myší a hladké vracení zpět.
     * 4. Hlava neustále plynule sleduje kurzor (kompenzuje natočení těla).
     */
    function createHeroIdleAnimation() {
        if (!window.skinview3d) return null;
        try {
            class HeroIdleAnimation extends window.skinview3d.IdleAnimation {
                constructor() {
                    super();
                    this.lastFrameTime = performance.now();
                }
                animate(player) {
                    super.animate(player);
                    const perfNow = performance.now();
                    const dt = Math.min((perfNow - (this.lastFrameTime || perfNow)) / 1000, 0.08) || 0.016;
                    this.lastFrameTime = perfNow;
                    const t = this.progress * 3;
                    const now = Date.now();

                    // 1. Organické vlnění pláště ve větru (s přirozeným splýváním za postavou při sedu)
                    if (player && player.cape) {
                        const baseCapeX = 0.28 + 0.11 * Math.sin(t) + 0.04 * Math.sin(t * 2.3);
                        const sitCapeX = 0.72 + 0.03 * Math.sin(t * 0.8);
                        player.cape.rotation.x = baseCapeX * (1 - heroSitWeight) + sitCapeX * heroSitWeight;
                        player.cape.rotation.z = (0.04 * Math.sin(t * 0.9)) * (1 - heroSitWeight);
                        player.cape.rotation.y = Math.PI + 0.02 * Math.cos(t * 1.1);
                    }

                    if (!heroSkinViewer) return;

                    // ── A. SPOUŠTĚNÍ HRY (KLIDNÉ, PLYNULÉ OSLAVNÉ ROZTÁČENÍ) ─────────────────
                    const targetCelebWeight = isHeroLaunchSpinning ? 1.0 : 0.0;
                    heroCelebrationWeight += (targetCelebWeight - heroCelebrationWeight) * Math.min(1.0, dt * 7.0);
                    if (Math.abs(heroCelebrationWeight) < 0.001) heroCelebrationWeight = 0;

                    if (heroCelebrationWeight > 0.001) {
                        // Klidné, přirozené točení nezávislé na obnovovací frekvenci monitoru (1 otáčka za ~4.5 s)
                        const spinSpeedRadPerSec = 1.35;
                        heroSpinAngle = (heroSpinAngle + spinSpeedRadPerSec * dt * heroCelebrationWeight) % (Math.PI * 2);
                    } else {
                        heroSpinAngle = 0;
                    }

                    // ── B. DLOUHODOBÁ NEČINNOST (5 min klepání nohou, 10 min sed a čekání) ────
                    const idleElapsed = isForcedSitTest
                        ? 600000
                        : (isForcedShakeTest ? 330000 : (now - lastHeroUserActivityTime));

                    const isIdlePhase5Min = idleElapsed >= (5 * 60 * 1000) && idleElapsed < (10 * 60 * 1000);
                    const isIdlePhase10Min = idleElapsed >= (10 * 60 * 1000);

                    // 1. Plynulý přechod do sedící pózy po 10 minutách nečinnosti
                    const targetSitWeight = (!isDraggingHero && !isHeroLaunchSpinning && isIdlePhase10Min) ? 1.0 : 0.0;
                    const sitLerpSpeed = targetSitWeight > heroSitWeight ? Math.min(1.0, dt * 2.2) : Math.min(1.0, dt * 5.5);
                    heroSitWeight += (targetSitWeight - heroSitWeight) * sitLerpSpeed;
                    if (Math.abs(heroSitWeight) < 0.001) heroSitWeight = 0;

                    // 2. Periodické klepání nohou (restless foot tapping) od 5. do 10. minuty
                    let targetShakeWeight = 0.0;
                    if (!isDraggingHero && !isHeroLaunchSpinning && isIdlePhase5Min && heroSitWeight < 0.05) {
                        const SHAKE_PERIOD = 11000; // 11s cyklus
                        const SHAKE_BURST = 4200;  // 4.2s klepání
                        const shakeCycleTime = (now % SHAKE_PERIOD);
                        if (shakeCycleTime < SHAKE_BURST) {
                            const pBurst = shakeCycleTime / SHAKE_BURST;
                            targetShakeWeight = Math.sin(pBurst * Math.PI); // 0 -> 1 -> 0
                        }
                    }
                    const shakeLerpSpeed = Math.min(1.0, dt * 8.0);
                    heroLegShakeWeight += (targetShakeWeight - heroLegShakeWeight) * shakeLerpSpeed;
                    if (Math.abs(heroLegShakeWeight) < 0.001) heroLegShakeWeight = 0;

                    // ── C. NOČNÍ PODŘIMOVÁNÍ (Podle reálného času po 23:00 / v noci v nečinnosti) ──
                    const currentHour = new Date().getHours();
                    // V noci (od 22:00 do 06:00 ráno nebo testovací režim)
                    const isNightTime = (currentHour >= 22 || currentHour < 6) || isForcedSleepTest;
                    const isUserIdle = (now - lastHeroUserActivityTime > 6500) && !isDraggingHero && !isHeroLaunchSpinning && (heroCelebrationWeight === 0) && (heroSitWeight === 0);
                    const targetSleepWeight = (isNightTime && isUserIdle) ? 1.0 : 0.0;

                    // Hladký náběh do dřímání a rychlé probuzení při aktivitě uživatele
                    const sleepLerpRate = targetSleepWeight > heroSleepWeight ? Math.min(1.0, dt * 1.6) : Math.min(1.0, dt * 6.0);
                    heroSleepWeight += (targetSleepWeight - heroSleepWeight) * sleepLerpRate;
                    if (Math.abs(heroSleepWeight) < 0.001) heroSleepWeight = 0;

                    let sleepHeadPitch = 0;
                    let sleepHeadYaw = 0;
                    let sleepHeadRoll = 0;
                    let sleepTorsoPitch = 0;

                    if (heroSleepWeight > 0.001) {
                        const SLEEP_CYCLE_MS = 14000; // 14s cyklus podřimování
                        const cycleTime = (now - heroSleepCycleStart) % SLEEP_CYCLE_MS;

                        // 1. FÁZE (0 až 6800 ms): Pomalé, bezvládné klesání hlavy a trupu (těžká víčka)
                        if (cycleTime < 6800) {
                            const p = cycleTime / 6800;
                            const droop = Math.pow(p, 1.7);
                            const sleepBreathing = Math.sin(p * Math.PI * 4) * 0.022;

                            sleepHeadPitch = (droop * 0.55) + sleepBreathing;
                            sleepHeadRoll = droop * 0.12;
                            sleepTorsoPitch = droop * 0.07;
                        }
                        // 2. FÁZE (6800 až 7350 ms): STARTLE & JOLT! (Prudké leknutí a trhnutí hlavy zpět nahoru!)
                        else if (cycleTime < 7350) {
                            const joltPhase = (cycleTime - 6800) / 550;
                            if (joltPhase < 0.32) {
                                const snapNorm = joltPhase / 0.32;
                                sleepHeadPitch = 0.55 + (-0.15 - 0.55) * Math.sin(snapNorm * Math.PI * 0.5);
                                sleepHeadRoll = 0.12 * (1 - snapNorm);
                                sleepTorsoPitch = 0.07 * (1 - snapNorm);
                            } else {
                                const settleNorm = (joltPhase - 0.32) / 0.68;
                                sleepHeadPitch = -0.15 * (1 - Math.sin(settleNorm * Math.PI * 0.5));
                                sleepHeadYaw = Math.sin(settleNorm * Math.PI * 2) * 0.14;
                                sleepHeadRoll = 0;
                                sleepTorsoPitch = 0;
                            }
                        }
                        // 3. FÁZE (7350 až 14000 ms): Probuzený stav a snaha vydržet vzhůru
                        else {
                            const awakeElapsed = cycleTime - 7350;
                            const settleDamp = Math.max(0, 1 - (awakeElapsed / 2000));
                            sleepHeadYaw = Math.sin(awakeElapsed * 0.0035) * 0.04 * settleDamp;
                            sleepHeadPitch = 0;
                            sleepHeadRoll = 0;
                            sleepTorsoPitch = 0;
                        }
                    }

                    // 2. Přirozené střídání poloh těla: jemné organické dýchání a natáčení
                    const idleBodyYaw = Math.sin(t * 0.24) * 0.14 + Math.sin(t * 0.12) * 0.04;

                    // 3. Fyzika rotace tažením myší (momentum dojezd + hladké přirozené vracení zpět)
                    if (!isDraggingHero) {
                        const friction = Math.pow(0.88, dt * 60);
                        if (Math.abs(heroDragVelocityY) > 0.0001) {
                            heroManualRotY += heroDragVelocityY;
                            heroDragVelocityY *= friction;
                        } else {
                            heroDragVelocityY = 0;
                        }
                        if (Math.abs(heroDragVelocityX) > 0.0001) {
                            heroManualRotX += heroDragVelocityX;
                            heroDragVelocityX *= friction;
                        } else {
                            heroDragVelocityX = 0;
                        }

                        const twoPi = Math.PI * 2;
                        const targetFrontAngle = Math.round(heroManualRotY / twoPi) * twoPi;
                        const diffY = targetFrontAngle - heroManualRotY;

                        if (Math.abs(diffY) > 0.001) {
                            const returnRate = 1 - Math.pow(0.045, dt);
                            heroManualRotY += diffY * returnRate;
                        } else {
                            heroManualRotY = 0;
                        }

                        if (Math.abs(heroManualRotX) > 0.001) {
                            const returnRateX = 1 - Math.pow(0.045, dt);
                            heroManualRotX += (0 - heroManualRotX) * returnRateX;
                        } else {
                            heroManualRotX = 0;
                        }
                    }

                    // Celková rotace těla: kombinuje idle vlnění, točení při spuštění a ruční manipulaci myší
                    const totalBodyYaw = (idleBodyYaw * (1 - heroCelebrationWeight)) + (heroSpinAngle * heroCelebrationWeight) + heroManualRotY;
                    const totalBodyPitch = heroManualRotX;

                    heroSkinViewer.playerWrapper.rotation.y = totalBodyYaw;
                    heroSkinViewer.playerWrapper.rotation.x = totalBodyPitch;
                    heroSkinViewer.playerWrapper.rotation.z = 0;

                    // 4. Přátelské zamávání rukou (2s po zapnutí nebo po obnovení z traye)
                    let waveWeight = 0;
                    const duration = heroWaveDuration || 2400;
                    if (now >= heroWaveStartTime && now <= heroWaveStartTime + duration) {
                        const elapsed = now - heroWaveStartTime;
                        const p = elapsed / duration;
                        if (p < 0.18) {
                            waveWeight = 0.5 - 0.5 * Math.cos((p / 0.18) * Math.PI);
                        } else if (p > 0.82) {
                            waveWeight = 0.5 + 0.5 * Math.cos(((p - 0.82) / 0.18) * Math.PI);
                        } else {
                            waveWeight = 1.0;
                        }
                    }

                    // 5. Minecraft Punch Hit swing (při kliknutí na jakékoliv tlačítko v launcheru)
                    let punchWeight = 0;
                    if (heroPunchStartTime > 0 && now <= heroPunchStartTime + HERO_PUNCH_DURATION) {
                        const p = (now - heroPunchStartTime) / HERO_PUNCH_DURATION;
                        punchWeight = Math.sin(p * Math.PI);
                    }

                    // 6. Fyzika a rotace končetin (paže i nohy): Plynulý přechod do sedu i klepání
                    if (player && player.skin) {
                        // Čisté základní klidové rotace v Minecraftu (přirozené dýchání podél těla)
                        const baseLeftRotX = Math.sin(t * 0.8) * 0.05;
                        const baseLeftRotY = 0;
                        const baseLeftRotZ = 0.06;

                        const baseRightRotX = -Math.sin(t * 0.8) * 0.05;
                        const baseRightRotY = 0;
                        const baseRightRotZ = -0.06;

                        // Ruce v sedě přirozeně spočívají na stehnech / klíně
                        const sitArmX = -0.42;
                        const sitLeftArmY = 0.16;
                        const sitLeftArmZ = 0.12;
                        const sitRightArmY = -0.16;
                        const sitRightArmZ = -0.12;

                        // LEVÁ RUKA
                        if (player.skin.leftArm) {
                            let targetLeftRotX = baseLeftRotX;
                            let targetLeftRotY = baseLeftRotY;
                            let targetLeftRotZ = baseLeftRotZ;

                            if (heroCelebrationWeight > 0.0001) {
                                const celebLeftX = -2.68 + Math.sin(t * 6) * 0.08;
                                const celebLeftZ = 0.55 + Math.cos(t * 6) * 0.06;
                                const celebLeftY = 0.0;

                                targetLeftRotX = baseLeftRotX + (celebLeftX - baseLeftRotX) * heroCelebrationWeight;
                                targetLeftRotY = baseLeftRotY + (celebLeftY - baseLeftRotY) * heroCelebrationWeight;
                                targetLeftRotZ = baseLeftRotZ + (celebLeftZ - baseLeftRotZ) * heroCelebrationWeight;
                            }

                            // Aplikace klidného položení ruky na stehno při sezení
                            targetLeftRotX = targetLeftRotX * (1 - heroSitWeight) + sitArmX * heroSitWeight;
                            targetLeftRotY = targetLeftRotY * (1 - heroSitWeight) + sitLeftArmY * heroSitWeight;
                            targetLeftRotZ = targetLeftRotZ * (1 - heroSitWeight) + sitLeftArmZ * heroSitWeight;

                            player.skin.leftArm.rotation.x = targetLeftRotX;
                            player.skin.leftArm.rotation.y = targetLeftRotY;
                            player.skin.leftArm.rotation.z = targetLeftRotZ;
                        }

                        // PRAVÁ RUKA (oslava, mávání, úder pěstí, sezení)
                        if (player.skin.rightArm) {
                            let targetRotX = baseRightRotX;
                            let targetRotY = baseRightRotY;
                            let targetRotZ = baseRightRotZ;

                            // A. Oslava spuštění
                            if (heroCelebrationWeight > 0.0001) {
                                const celebRightX = -2.68 + Math.sin(t * 6 + 0.4) * 0.08;
                                const celebRightZ = -0.55 - Math.cos(t * 6) * 0.06;
                                const celebRightY = 0.0;

                                targetRotX = baseRightRotX + (celebRightX - baseRightRotX) * heroCelebrationWeight;
                                targetRotY = baseRightRotY + (celebRightY - baseRightRotY) * heroCelebrationWeight;
                                targetRotZ = baseRightRotZ + (celebRightZ - baseRightRotZ) * heroCelebrationWeight;
                            }

                            // B. Aplikace mávání rukou
                            if (waveWeight > 0.0001 && heroCelebrationWeight < 0.5) {
                                const elapsed = Math.max(0, now - heroWaveStartTime);
                                const waveSpeed = isQuickWave ? 14.0 : 9.5;
                                const waveOsc = Math.sin((elapsed / 1000) * waveSpeed);

                                const waveTargetZ = -2.35 + waveOsc * 0.32;
                                const waveTargetX = -0.32 + Math.cos((elapsed / 1000) * waveSpeed) * 0.08;
                                const waveTargetY = 0.22;

                                const waveBlend = waveWeight * (1 - heroCelebrationWeight);
                                targetRotX = targetRotX + (waveTargetX - targetRotX) * waveBlend;
                                targetRotY = targetRotY + (waveTargetY - targetRotY) * waveBlend;
                                targetRotZ = targetRotZ + (waveTargetZ - targetRotZ) * waveBlend;
                            }

                            // C. Aplikace úderu pěstí
                            if (punchWeight > 0.0001) {
                                const punchTargetX = -1.35;
                                const punchTargetY = 0.38;
                                const punchTargetZ = -0.22;

                                targetRotX = targetRotX + (punchTargetX - targetRotX) * punchWeight;
                                targetRotY = targetRotY + (punchTargetY - targetRotY) * punchWeight;
                                targetRotZ = targetRotZ + (punchTargetZ - targetRotZ) * punchWeight;
                            }

                            // Aplikace sedící pózy pro pravou ruku
                            targetRotX = targetRotX * (1 - heroSitWeight) + sitArmX * heroSitWeight;
                            targetRotY = targetRotY * (1 - heroSitWeight) + sitRightArmY * heroSitWeight;
                            targetRotZ = targetRotZ * (1 - heroSitWeight) + sitRightArmZ * heroSitWeight;

                            player.skin.rightArm.rotation.x = targetRotX;
                            player.skin.rightArm.rotation.y = targetRotY;
                            player.skin.rightArm.rotation.z = targetRotZ;
                        }

                        // NOHY (animace chůze/stání, klepání nohou v 5. minutě a sezení v 10. minutě)
                        if (player.skin.leftLeg && player.skin.rightLeg) {
                            const baseLeftLegX = -Math.sin(t * 0.8) * 0.02;
                            const baseRightLegX = Math.sin(t * 0.8) * 0.02;

                            // Rychlé nervózní klepání nohou (nepokoj v koleni / podupávání špičkou)
                            const legShakeAngle = (heroLegShakeWeight > 0.001) ? Math.sin((now / 1000) * 40) * 0.11 * heroLegShakeWeight : 0;

                            // Sedící pozice nohou (ohnuté dopředu = -1.52 rad pro přirozený mírný spád k zemi)
                            const sitLegAngle = -1.52;
                            const sitLeftLegX = sitLegAngle + Math.sin(t * 1.1) * 0.035;
                            const sitRightLegX = sitLegAngle - Math.sin(t * 1.1) * 0.035;

                            // Přirozené rozkročení nohou v sedu (ramenní šířka, eliminuje prolínání nohou do sebe)
                            const sitLegSpreadZ = 0.20; // Vytočení nohou do stran (+Z pro levou, -Z pro pravou)
                            const sitLegRollY = 0.08;   // Mírné přirozené vytočení špiček/kolen zevně

                            player.skin.leftLeg.rotation.x = baseLeftLegX * (1 - heroSitWeight) + sitLeftLegX * heroSitWeight;
                            player.skin.leftLeg.rotation.y = sitLegRollY * heroSitWeight;
                            player.skin.leftLeg.rotation.z = sitLegSpreadZ * heroSitWeight;

                            player.skin.rightLeg.rotation.x = (baseRightLegX + legShakeAngle) * (1 - heroSitWeight) + sitRightLegX * heroSitWeight;
                            player.skin.rightLeg.rotation.y = (-sitLegRollY * heroSitWeight) + (0.04 * heroLegShakeWeight * (1 - heroSitWeight));
                            player.skin.rightLeg.rotation.z = (-sitLegSpreadZ * heroSitWeight) + (0.02 * heroLegShakeWeight * (1 - heroSitWeight));
                        }

                        // Výška těla: snížení do sedu na podlahu + drobné poskakování při klepání nohou
                        if (heroSkinViewer.playerObject) {
                            const celebBounce = Math.abs(Math.sin(t * 6)) * 0.9 * heroCelebrationWeight;
                            const sitDrop = -6.4 * heroSitWeight;
                            const legShakeBounce = (heroLegShakeWeight > 0.001 && heroSitWeight < 0.1)
                                ? Math.abs(Math.sin((now / 1000) * 40)) * 0.16 * heroLegShakeWeight
                                : 0;
                            heroSkinViewer.playerObject.position.y = -1 + celebBounce + sitDrop + legShakeBounce;
                        }
                    }

                    // 7. HLAVA PLYNULE A FILMOVĚ SLEDUJE KURZOR (ŽÁDNÝ SKOK, VELMI JEMNÝ NÁKLON)
                    const headLerpRate = 1 - Math.pow(0.04, dt);
                    currentHeroHeadLookX += (targetHeroHeadLookX - currentHeroHeadLookX) * headLerpRate;
                    currentHeroHeadLookY += (targetHeroHeadLookY - currentHeroHeadLookY) * headLerpRate;

                    // Organický pružinový tlumič s nízkou tuhostí pro plynulý, nekřečovitý náklon hlavy
                    const curiositySpringK = 14.0;
                    const curiosityDamping = 12.0;
                    const curiosityDiff = targetHeroCuriosityTilt - currentHeroCuriosityTilt;
                    heroCuriosityVelocity += curiosityDiff * curiositySpringK * dt;
                    heroCuriosityVelocity *= Math.max(0, 1 - curiosityDamping * dt);
                    currentHeroCuriosityTilt += heroCuriosityVelocity * dt;

                    // Idle rozhlížení a čekání v sedě
                    let sitHeadYaw = 0;
                    let sitHeadPitch = 0;
                    if (heroSitWeight > 0.001) {
                        const waitCycle = (now * 0.001) % 18; // 18s cyklus čekání v sedě
                        if (waitCycle < 3.5) {
                            sitHeadYaw = 0;
                            sitHeadPitch = 0.04;
                        } else if (waitCycle < 7.0) {
                            const p = (waitCycle - 3.5) / 3.5;
                            sitHeadYaw = Math.sin(p * Math.PI) * 0.28;
                            sitHeadPitch = 0.02;
                        } else if (waitCycle < 10.5) {
                            sitHeadYaw = 0;
                            sitHeadPitch = 0.06;
                        } else if (waitCycle < 14.0) {
                            const p = (waitCycle - 10.5) / 3.5;
                            sitHeadYaw = -Math.sin(p * Math.PI) * 0.28;
                            sitHeadPitch = 0.02;
                        } else {
                            sitHeadYaw = 0;
                            sitHeadPitch = 0.04;
                        }
                    }

                    // Při klepání nohou se postava občas podívá dolů na nohu
                    const legShakeHeadPitch = (heroLegShakeWeight > 0.001 && heroSitWeight < 0.1)
                        ? 0.07 * heroLegShakeWeight
                        : 0;

                    if (player && player.skin && player.skin.head) {
                        let diffYaw = (currentHeroHeadLookY - totalBodyYaw) % (Math.PI * 2);
                        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
                        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;

                        const MAX_HEAD_YAW = Math.PI / 2.3;
                        let targetHeadYaw = 0;

                        if (Math.abs(diffYaw) <= MAX_HEAD_YAW) {
                            targetHeadYaw = diffYaw;
                        } else {
                            targetHeadYaw = Math.sign(diffYaw) * (Math.PI - Math.abs(diffYaw));
                        }

                        targetHeadYaw = Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, targetHeadYaw));

                        const frontFactor = Math.max(0, Math.cos(diffYaw));
                        const curiosityIntensity = Math.abs(currentHeroCuriosityTilt);

                        const curiousPitch = 0.035 * curiosityIntensity;
                        const targetHeadPitch = -totalBodyPitch * frontFactor + currentHeroHeadLookX * frontFactor + Math.sin(t * 1.4) * 0.012;

                        const curiosityPulse = Math.sin(t * 2.2) * 0.008 * curiosityIntensity;

                        // Tlumení sledování myši při spánku a v sedě
                        const wakeTrackingFactor = Math.max(0, (1 - heroSleepWeight * 0.9) * (1 - heroSitWeight * 0.85));

                        player.skin.head.rotation.y = (targetHeadYaw * wakeTrackingFactor) + (sleepHeadYaw * heroSleepWeight) + (sitHeadYaw * heroSitWeight);
                        player.skin.head.rotation.x = (targetHeadPitch * wakeTrackingFactor) + (punchWeight * 0.08) + curiousPitch + (sleepHeadPitch * heroSleepWeight) + (sitHeadPitch * heroSitWeight) + legShakeHeadPitch;
                        player.skin.head.rotation.z = (-targetHeadYaw * 0.035 * wakeTrackingFactor) - (waveWeight * 0.08) + currentHeroCuriosityTilt + curiosityPulse + (sleepHeadRoll * heroSleepWeight);

                        // Anatomický protipohyb trupu
                        const bodyPart = player.skin.body || player.skin.torso;
                        if (bodyPart) {
                            bodyPart.rotation.z = -currentHeroCuriosityTilt * 0.08;
                            bodyPart.rotation.x = (sleepTorsoPitch * heroSleepWeight) + (0.04 * heroSitWeight);
                        }
                    }
                }
            }
            return new HeroIdleAnimation();
        } catch (_) {
            return new window.skinview3d.IdleAnimation();
        }
    }

    /**
     * Dynamická animace klidového stavu (Idle) pro modál výběru skinu.
     */
    function createCapeIdleAnimation() {
        if (!window.skinview3d) return null;
        try {
            class DynamicCapeIdleAnimation extends window.skinview3d.IdleAnimation {
                animate(player) {
                    super.animate(player);
                    if (player && player.cape) {
                        const t = this.progress * 3;
                        player.cape.rotation.x = 0.28 + 0.11 * Math.sin(t) + 0.04 * Math.sin(t * 2.3);
                        player.cape.rotation.z = 0.04 * Math.sin(t * 0.9);
                        player.cape.rotation.y = Math.PI + 0.02 * Math.cos(t * 1.1);
                    }
                }
            }
            return new DynamicCapeIdleAnimation();
        } catch (_) {
            return new window.skinview3d.IdleAnimation();
        }
    }

    /**
     * Dynamická animace letu (Flying) s aerodynamickým vláním pláště za postavou.
     */
    function createCapeFlyingAnimation() {
        if (!window.skinview3d) return null;
        try {
            class DynamicCapeFlyingAnimation extends window.skinview3d.FlyingAnimation {
                animate(player) {
                    super.animate(player);
                    if (player && player.cape) {
                        const t = this.progress * 8;
                        // Aerodynamické plachtění / vlání pláště za letícím hráčem
                        player.cape.rotation.x = 1.18 + 0.16 * Math.sin(t * 2) + 0.05 * Math.sin(t * 4.3);
                        player.cape.rotation.z = 0.05 * Math.sin(t * 1.5);
                        player.cape.rotation.y = Math.PI + 0.03 * Math.cos(t * 1.8);
                    }
                }
            }
            return new DynamicCapeFlyingAnimation();
        } catch (_) {
            return new window.skinview3d.FlyingAnimation();
        }
    }

    /**
     * Resolves the effective cape URL:
     * 1. Active official Mojang cape (if Microsoft auth)
     * 2. Custom cape path (if offline custom file or selected preset)
     * 3. Explicit null (NO default cape forced)
     */
    function getEffectiveCape() {
        const isMicrosoft = currentConfig.authType === 'microsoft';
        if (isMicrosoft) {
            if (activeMojangCapeUrl) return activeMojangCapeUrl;
            const capes = currentConfig.microsoftAccount?.capes || [];
            const active = capes.find(c => c.state === 'ACTIVE');
            if (active) {
                activeMojangCapeUrl = active.url;
                return active.url;
            }
            return null; // Oficiální účet bez aktivního pláště nemá žádný plášť
        } else {
            // Warez / offline: žádné pláště se nepoužívají ani nezobrazují
            return null;
        }
    }

    /**
     * Initializes the 3D skin viewer on the main hero dashboard card.
     */
    function initHeroSkinViewer3D(force = false) {
        const canvas = document.getElementById('heroSkinCanvas3D');
        if (!canvas || !window.skinview3d) return;
        if (heroSkinViewer && !force) {
            document.body.classList.remove('app-in-tray-paused');
            heroSkinViewer.renderPaused = false;
            heroSkinViewer.setSize(220, 280);
            try { heroSkinViewer.draw(); } catch (_) { }
            return;
        }

        try {
            cancelHeroReturn();
            if (heroSkinViewer) {
                try { heroSkinViewer.dispose(); } catch (_) { }
                heroSkinViewer = null;
            }

            document.body.classList.remove('app-in-tray-paused');
            const isSlim = currentConfig ? (currentConfig.customSkinVariant === 'slim') : false;
            heroSkinViewer = new window.skinview3d.SkinViewer({
                canvas: canvas,
                width: 220,
                height: 280,
                model: isSlim ? 'slim' : 'default'
            });
            heroSkinViewer.renderPaused = false;

            heroWaveStartTime = Date.now() + 2000;
            lastHeroWaveTime = Date.now() + 2000;
            heroSkinViewer.camera.position.set(0, 0, 70);
            heroSkinViewer.zoom = 0.88;
            heroSkinViewer.fov = 46;
            if (heroSkinViewer.playerObject) {
                heroSkinViewer.playerObject.position.y = -1;
            }
            heroSkinViewer.autoRotate = false; // Strictly no auto-rotation
            heroSkinViewer.controls.enabled = false; // Direct smooth drag on playerWrapper
            heroSkinViewer.animation = createHeroIdleAnimation() || new window.skinview3d.IdleAnimation();

            // Set default resting pose
            heroSkinViewer.playerWrapper.rotation.set(0, 0, 0);

            // Drag to rotate with pointer events & smooth auto-return
            canvas.style.cursor = 'grab';

            canvas.onpointerdown = (e) => {
                if (!heroSkinViewer) return;
                isDraggingHero = true;
                startDragPointerX = e.clientX;
                startDragPointerY = e.clientY;
                lastDragPointerX = e.clientX;
                lastDragPointerY = e.clientY;
                heroDragVelocityY = 0;
                heroDragVelocityX = 0;

                canvas.style.cursor = 'grabbing';
                try {
                    canvas.setPointerCapture(e.pointerId);
                } catch (_) { }
            };

            canvas.onpointermove = (e) => {
                if (!isDraggingHero) return;

                const dx = e.clientX - lastDragPointerX;
                const dy = e.clientY - lastDragPointerY;
                lastDragPointerX = e.clientX;
                lastDragPointerY = e.clientY;

                // Track immediate drag velocity for momentum / dojezd
                heroDragVelocityY = dx * 0.014;
                heroDragVelocityX = dy * 0.008;

                heroManualRotY += heroDragVelocityY;
                heroManualRotX = Math.max(-0.25, Math.min(0.25, heroManualRotX + heroDragVelocityX));
            };

            const onPointerEnd = (e) => {
                if (!isDraggingHero) return;
                isDraggingHero = false;
                canvas.style.cursor = 'grab';
                try {
                    if (e.pointerId && canvas.hasPointerCapture(e.pointerId)) {
                        canvas.releasePointerCapture(e.pointerId);
                    }
                } catch (_) { }

                // Rychlý klik bez posunu vyvolá přátelské mávnutí
                const dist = Math.hypot(e.clientX - startDragPointerX, e.clientY - startDragPointerY);
                if (dist < 6) {
                    triggerHeroWave();
                }
            };

            canvas.onpointerup = onPointerEnd;
            canvas.onpointercancel = onPointerEnd;

            // Load current skin & cape immediately
            if (currentConfig) {
                const isMicrosoft = currentConfig.authType === 'microsoft';
                const effectiveSkin = currentConfig.customSkinPath || (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.skinUrl : null);
                const msName = currentConfig.microsoftAccount?.name || currentConfig.microsoftAccount?.username;
                const name = (isMicrosoft ? msName : currentConfig.username) || 'Hráč';
                let skinSrc;
                if (effectiveSkin) {
                    skinSrc = (effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://') || effectiveSkin.startsWith('assets/')) ? effectiveSkin : `file://${effectiveSkin}`;
                } else if (name.toLowerCase() === 'steve' || name.toLowerCase() === 'alex' || name === 'Hráč') {
                    skinSrc = isSlim ? 'assets/default_alex.png' : 'assets/default_steve.png';
                } else {
                    skinSrc = `https://minotar.net/skin/${encodeURIComponent(name)}`;
                }
                const effectiveCape = getEffectiveCape();

                const pSkin = heroSkinViewer.loadSkin(skinSrc, { model: isSlim ? 'slim' : 'default' });
                if (pSkin && typeof pSkin.then === 'function') {
                    pSkin.then(() => {
                        if (heroSkinImg) heroSkinImg.classList.add('is-hidden');
                        try { heroSkinViewer?.draw(); } catch (_) { }
                    }).catch(err => {
                        console.warn('[HERO 3D] loadSkin init failed:', err);
                        if (heroSkinImg) heroSkinImg.classList.remove('is-hidden');
                    });
                }
                if (effectiveCape) {
                    const pCape = heroSkinViewer.loadCape(effectiveCape, { backEquipment: 'cape' });
                    if (pCape && typeof pCape.catch === 'function') {
                        pCape.catch(err => console.warn('[HERO 3D] loadCape init failed:', err));
                    }
                }
            }
            try { heroSkinViewer.draw(); } catch (_) { }
        } catch (e) {
            console.warn('[HERO 3D] Inicializace hero 3D prohlížeče selhala:', e);
            if (heroSkinImg) {
                heroSkinImg.classList.remove('is-hidden');
                heroSkinImg.style.display = 'block';
            }
        }

        // Aktivace interaktivního sledování tlačítek (lean & glance)
        setupHeroInteractiveHoverTracking();
    }

    /**
     * Updates the 3D model, skin, and cape in the hero dashboard viewer.
     */
    function updateHeroSkinViewer3D(skinUrl, capeUrl, isSlim = false) {
        if (!heroSkinViewer) {
            initHeroSkinViewer3D();
        }
        if (!heroSkinViewer) return;

        try {
            document.body.classList.remove('app-in-tray-paused');
            heroSkinViewer.renderPaused = false;
            heroSkinViewer.setSize(220, 280);
            if (skinUrl) {
                const pSkin = heroSkinViewer.loadSkin(skinUrl, { model: isSlim ? 'slim' : 'default' });
                if (pSkin && typeof pSkin.then === 'function') {
                    pSkin.then(() => {
                        if (heroSkinImg) heroSkinImg.classList.add('is-hidden');
                        try { heroSkinViewer?.draw(); } catch (_) { }
                    }).catch(err => {
                        console.warn('[HERO 3D] loadSkin failed:', err);
                        if (heroSkinImg) heroSkinImg.classList.remove('is-hidden');
                    });
                }
            }
            const capeToLoad = capeUrl !== undefined ? capeUrl : getEffectiveCape();
            if (capeToLoad) {
                const pCape = heroSkinViewer.loadCape(capeToLoad, { backEquipment: 'cape' });
                if (pCape && typeof pCape.catch === 'function') {
                    pCape.catch(err => console.warn('[HERO 3D] loadCape failed:', err));
                }
            } else {
                heroSkinViewer.loadCape(null);
            }
            try { heroSkinViewer.draw(); } catch (_) { }
        } catch (e) {
            console.warn('[HERO 3D] Chyba při aktualizaci 3D modelu na dashboardu:', e);
        }
    }

    function initSkinViewer3D() {
        const canvas3D = document.getElementById('skinCanvas3D');
        if (!canvas3D || !window.skinview3d) return;

        try {
            if (skinViewer) {
                skinViewer.dispose();
                skinViewer = null;
            }

            skinViewer = new window.skinview3d.SkinViewer({
                canvas: canvas3D,
                width: 200,
                height: 235,
                model: currentConfig.customSkinVariant === 'slim' ? 'slim' : 'default'
            });
            skinViewer.renderPaused = false;

            skinViewer.camera.position.set(0, 0, 70);
            skinViewer.zoom = 0.88;
            skinViewer.fov = 46;
            if (skinViewer.playerObject) {
                skinViewer.playerObject.position.y = -1;
            }
            skinViewer.controls.enableRotate = true;
            skinViewer.controls.enableZoom = true;
            skinViewer.controls.enablePan = false;
            skinViewer.animation = createCapeIdleAnimation() || new window.skinview3d.IdleAnimation();

            // 3D Toolbar Buttons: [ 360° ] [ Plášť ] [ Létání ]
            const btnRotate = document.getElementById('btn3DRotateToggle');
            const btnElytra = document.getElementById('btn3DElytraToggle');
            const btnFlying = document.getElementById('btn3DFlyingToggle');
            const labelElytra = document.getElementById('label3DElytra');
            const labelFlying = document.getElementById('label3DFlying');

            if (btnRotate) {
                btnRotate.onclick = () => {
                    if (!skinViewer) return;
                    isAutoRotateActive = !isAutoRotateActive;
                    skinViewer.autoRotate = isAutoRotateActive;
                    skinViewer.autoRotateSpeed = 1.8;
                    btnRotate.classList.toggle('active', isAutoRotateActive);
                };
            }

            if (btnElytra) {
                btnElytra.onclick = () => {
                    if (!skinViewer) return;
                    isBackEquipmentElytra = !isBackEquipmentElytra;
                    skinViewer.playerObject.backEquipment = isBackEquipmentElytra ? 'elytra' : 'cape';
                    if (labelElytra) labelElytra.textContent = isBackEquipmentElytra ? 'Elytra' : 'Plášť';
                    btnElytra.classList.toggle('active', !isBackEquipmentElytra);
                };
            }

            if (btnFlying) {
                btnFlying.onclick = () => {
                    if (!skinViewer) return;
                    isFlyingAnimationActive = !isFlyingAnimationActive;
                    if (isFlyingAnimationActive) {
                        skinViewer.animation = createCapeFlyingAnimation() || new window.skinview3d.FlyingAnimation();
                        if (labelFlying) labelFlying.textContent = 'Postavit';
                        btnFlying.classList.add('active');
                    } else {
                        skinViewer.animation = createCapeIdleAnimation() || new window.skinview3d.IdleAnimation();
                        if (labelFlying) labelFlying.textContent = 'Létání';
                        btnFlying.classList.remove('active');
                    }
                };
            }
        } catch (e) {
            console.warn('[3D VIEWER] Inicializace 3D prohlížeče selhala:', e);
        }
    }

    function updateSkinViewer3D(skinUrl, capeUrl, isSlim = false) {
        if (!skinViewer) {
            initSkinViewer3D();
        }
        if (!skinViewer) return;

        try {
            if (skinUrl) {
                lastLoadedSkinUrl = skinUrl;
                const pSkin = skinViewer.loadSkin(skinUrl, { model: isSlim ? 'slim' : 'default' });
                if (pSkin && typeof pSkin.catch === 'function') {
                    pSkin.catch(err => console.warn('[3D VIEWER] loadSkin failed:', err));
                }
            }

            if (capeUrl) {
                lastLoadedCapeUrl = capeUrl;
                const pCape = skinViewer.loadCape(capeUrl, { backEquipment: isBackEquipmentElytra ? 'elytra' : 'cape' });
                if (pCape && typeof pCape.catch === 'function') {
                    pCape.catch(err => console.warn('[3D VIEWER] loadCape failed:', err));
                }
            } else if (capeUrl === null) {
                lastLoadedCapeUrl = null;
                skinViewer.loadCape(null);
            }
        } catch (e) {
            console.warn('[3D VIEWER] Chyba aktualizace skinu/pláště v 3D:', e);
        }
    }

    function updateCharacterTabSkinPreview() {
        if (!skinViewer) {
            initSkinViewer3D();
        } else {
            skinViewer.setSize(200, 235);
        }
        const isMicrosoft = currentConfig.authType === 'microsoft';
        const effectiveSkin = currentConfig.customSkinPath || (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.skinUrl : null);
        const effectiveCape = getEffectiveCape();
        const isSlim = currentConfig.customSkinVariant === 'slim';
        const msName = currentConfig.microsoftAccount?.name || currentConfig.microsoftAccount?.username;
        const name = (isMicrosoft ? msName : currentConfig.username) || 'Hráč';

        let skinSrc;
        if (effectiveSkin) {
            skinSrc = (effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://') || effectiveSkin.startsWith('assets/')) ? effectiveSkin : `file://${effectiveSkin}`;
        } else if (name.toLowerCase() === 'steve' || name.toLowerCase() === 'alex' || name === 'Hráč') {
            skinSrc = isSlim ? 'assets/default_alex.png' : 'assets/default_steve.png';
        } else {
            skinSrc = `https://minotar.net/skin/${encodeURIComponent(name)}`;
        }

        updateSkinViewer3D(skinSrc, effectiveCape, isSlim);
        updateHeroSkinViewer3D(skinSrc, effectiveCape, isSlim);
        drawSkinToCanvas(skinSrc, isSlim);
        if (isMicrosoft) {
            loadMojangCapes();
        } else {
            const offCapeSec = document.getElementById('offlineCapesSection');
            if (offCapeSec) offCapeSec.style.display = 'none';
            const equippedBadge = document.getElementById('equippedCapeBadge');
            if (equippedBadge) equippedBadge.style.display = 'none';
            activeMojangCapeUrl = null;
        }
    }

    // ── Skin Canvas 2D Renderer ─────────────────────────────────────────────
    function drawSkinToCanvas(imgSrc, isSlim = false) {
        const canvas = document.getElementById('skinCanvas2D');
        const previewImg = document.getElementById('skinPreviewImg');
        const canvas3D = document.getElementById('skinCanvas3D');

        // Always update 3D Skin Viewer
        updateSkinViewer3D(imgSrc, lastLoadedCapeUrl, isSlim);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            canvas.width = 128;
            canvas.height = 256;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const armSrcW = isSlim ? 3 : 4;
            const rArmW = armSrcW * 8;
            const lArmW = armSrcW * 8;

            // 1. Head (8x8) -> at (32, 16)
            ctx.drawImage(img, 8, 8, 8, 8, 32, 16, 64, 64);
            // Head Hat / Helm Layer (sx=40, sy=8, sw=8, sh=8)
            ctx.drawImage(img, 40, 8, 8, 8, 32, 16, 64, 64);

            // 2. Torso (8x12) -> at (32, 80)
            ctx.drawImage(img, 20, 20, 8, 12, 32, 80, 64, 96);
            if (img.height >= 64) {
                // Torso Jacket (sx=20, sy=36, sw=8, sh=12)
                ctx.drawImage(img, 20, 36, 8, 12, 32, 80, 64, 96);
            }

            // 3. Right Arm (armSrcW x 12) -> at (32 - rArmW, 80)
            ctx.drawImage(img, 44, 20, armSrcW, 12, 32 - rArmW, 80, rArmW, 96);
            if (img.height >= 64) {
                ctx.drawImage(img, 44, 36, armSrcW, 12, 32 - rArmW, 80, rArmW, 96);
            }

            // 4. Left Arm -> at (96, 80)
            if (img.height >= 64) {
                ctx.drawImage(img, 36, 52, armSrcW, 12, 96, 80, lArmW, 96);
                ctx.drawImage(img, 52, 52, armSrcW, 12, 96, 80, lArmW, 96);
            } else {
                ctx.save();
                ctx.translate(96 + lArmW, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(img, 44, 20, armSrcW, 12, 0, 80, lArmW, 96);
                ctx.restore();
            }

            // 5. Right Leg (4x12) -> at (32, 176)
            ctx.drawImage(img, 4, 20, 4, 12, 32, 176, 32, 96);
            if (img.height >= 64) {
                ctx.drawImage(img, 4, 36, 4, 12, 32, 176, 32, 96);
            }

            // 6. Left Leg (4x12) -> at (64, 176)
            if (img.height >= 64) {
                ctx.drawImage(img, 20, 52, 4, 12, 64, 176, 32, 96);
                ctx.drawImage(img, 4, 52, 4, 12, 64, 176, 32, 96);
            } else {
                ctx.save();
                ctx.translate(64 + 32, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(img, 4, 20, 4, 12, 0, 176, 32, 96);
                ctx.restore();
            }

            // Strictly keep 2D canvas hidden from Character stage
            canvas.style.display = 'none';
            if (previewImg) previewImg.style.display = 'none';

            // Propagate rendered canvas to hero skin
            if (heroSkinImg) {
                heroSkinImg.src = canvas.toDataURL();
            }
        };
        img.onerror = () => {
            canvas.style.display = 'none';
            if (previewImg) {
                previewImg.style.display = 'block';
                previewImg.src = imgSrc;
            }
        };
        img.src = imgSrc;
    }

    // ── Cape Thumbnail Renderer (Upright 10:16 Minecraft Model, Razor Sharp) ─────
    function drawCapeModelThumb(imgSrc, canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // Použijeme přesný 8x celočíselný násobek Minecraft 10x16 poměru (80x128)
            canvas.width = 80;
            canvas.height = 128;

            // Kritické: V HTML5 canvasu změna width/height resetuje imageSmoothingEnabled zpět na true!
            ctx.imageSmoothingEnabled = false;
            if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
            if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // V Minecraft 64x32 texturách je vnější lícová strana pláště (back face) na souřadnicích (1, 1, 10, 16)
            // (souřadnice 12, 1 je vnitřní rubová strana přivrácená k tělu hráče)
            const scale = (img.naturalWidth || 64) / 64;
            const sx = 1 * scale;
            const sy = 1 * scale;
            const sw = 10 * scale;
            const sh = 16 * scale;

            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        };
        img.onerror = () => {
            canvas.width = 80;
            canvas.height = 128;
            ctx.imageSmoothingEnabled = false;
            ctx.fillStyle = '#0a67e5';
            ctx.fillRect(0, 0, 80, 128);
        };
        img.src = imgSrc;
    }

    // ── Mojang Capes Fetcher & Renderer ─────────────────────────────────────
    async function loadMojangCapes() {
        const container = document.getElementById('mojangCapesList');
        const equippedBadge = document.getElementById('equippedCapeBadge');
        const equippedName = document.getElementById('equippedCapeName');
        const countPill = document.getElementById('mojangCapesCount');
        const btnHideCape = document.getElementById('btnHideMojangCape');
        if (!container) return;

        if (currentConfig.authType !== 'microsoft') {
            container.innerHTML = '';
            if (equippedBadge) equippedBadge.style.display = 'none';
            if (countPill) countPill.style.display = 'none';
            if (btnHideCape) btnHideCape.style.display = 'none';
            return;
        }

        try {
            const res = await window.api.getMojangProfile();
            if (res && res.success && res.profile) {
                // Automatically reflect active Mojang skin and arm model (Classic vs Slim)
                const activeSkin = (res.profile.skins || []).find(s => s.state === 'ACTIVE') || (res.profile.skins || [])[0];
                const isSlimArm = activeSkin ? (activeSkin.variant || '').toLowerCase() === 'slim' : (currentConfig.customSkinVariant === 'slim');
                if (activeSkin && activeSkin.url && !currentConfig.customSkinPath) {
                    currentConfig.customSkinVariant = isSlimArm ? 'slim' : 'classic';
                    if (currentConfig.microsoftAccount) {
                        currentConfig.microsoftAccount.skinUrl = activeSkin.url;
                    }
                    lastLoadedSkinUrl = activeSkin.url;
                    drawSkinToCanvas(activeSkin.url, isSlimArm);
                }

                const capes = res.profile.capes || [];
                if (capes.length === 0) {
                    container.innerHTML = '<div class="cape-loading-hint">Na tomto Mojang účtu nemáš žádné oficiální pláště.</div>';
                    if (equippedBadge) equippedBadge.style.display = 'none';
                    if (countPill) countPill.style.display = 'none';
                    if (btnHideCape) btnHideCape.style.display = 'none';
                    return;
                }

                if (countPill) {
                    countPill.textContent = `${capes.length} ${capes.length === 1 ? 'plášť' : capes.length < 5 ? 'pláště' : 'plášťů'}`;
                    countPill.style.display = 'inline-block';
                }

                let activeCapeFound = null;
                container.innerHTML = capes.map((c, idx) => {
                    const isActive = c.state === 'ACTIVE';
                    if (isActive) activeCapeFound = c;
                    return `
                        <div class="cape-item-card ${isActive ? 'active-cape' : ''}" data-cape-id="${escapeHtml(c.id)}" title="${escapeHtml(c.alias || 'Plášť')}">
                            <div class="cape-item-preview-box">
                                <canvas class="cape-canvas-render" id="mojangCapeCanvas_${idx}" width="40" height="64"></canvas>
                            </div>
                            ${isActive ? '<span class="cape-active-indicator"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Aktivní</span>' : ''}
                            <span class="cape-item-name">${escapeHtml(c.alias || 'Plášť')}</span>
                        </div>
                    `;
                }).join('');

                capes.forEach((c, idx) => {
                    const canvas = document.getElementById(`mojangCapeCanvas_${idx}`);
                    if (canvas) drawCapeModelThumb(c.url, canvas);
                });

                const targetSkin = lastLoadedSkinUrl || currentConfig.microsoftAccount?.skinUrl || (isSlimArm ? 'assets/default_alex.png' : 'assets/default_steve.png');

                if (equippedBadge && equippedName) {
                    if (activeCapeFound) {
                        equippedBadge.style.display = 'block';
                        equippedName.textContent = activeCapeFound.alias || 'Aktivní plášť';
                        activeMojangCapeUrl = activeCapeFound.url;
                        updateSkinViewer3D(targetSkin, activeCapeFound.url, isSlimArm);
                        updateHeroSkinViewer3D(targetSkin, activeCapeFound.url, isSlimArm);
                        if (btnHideCape) btnHideCape.style.display = 'inline-flex';
                    } else {
                        equippedBadge.style.display = 'none';
                        activeMojangCapeUrl = null;
                        updateSkinViewer3D(targetSkin, null, isSlimArm);
                        updateHeroSkinViewer3D(targetSkin, null, isSlimArm);
                        if (btnHideCape) btnHideCape.style.display = 'none';
                    }
                } else if (btnHideCape) {
                    btnHideCape.style.display = activeCapeFound ? 'inline-flex' : 'none';
                }

                // Bind click to equip cape on Mojang account
                container.querySelectorAll('.cape-item-card').forEach(card => {
                    card.addEventListener('click', async () => {
                        const capeId = card.dataset.capeId;
                        showToast('Nastavuji plášť na Mojang účtu...', 'info');
                        const equipRes = await window.api.setMojangCape(capeId);
                        if (equipRes && equipRes.success) {
                            showToast('Plášť aktivován na Mojang účtu.', 'success');
                            await loadMojangCapes();
                        } else {
                            showToast('Chyba při nastavování pláště: ' + (equipRes.error || 'Neznámá chyba'), 'error');
                        }
                    });
                });
            } else if (res && res.expired) {
                if (countPill) countPill.style.display = 'none';
                if (btnHideCape) btnHideCape.style.display = 'none';
                container.innerHTML = `
                    <div style="text-align: center; padding: 10px 4px;">
                        <div class="cape-loading-hint" style="color: #f51515; margin-bottom: 8px;">
                            ${escapeHtml(res.error || 'Platnost Microsoft přihlášení vypršela.')}
                        </div>
                        <button type="button" class="mc-btn mc-btn-green" id="btnReloginExpiredMs" style="margin: 0 auto; justify-content: center; font-size: 11.5px; padding: 6px 14px;">
                            <span>Obnovit Microsoft přihlášení</span>
                        </button>
                    </div>
                `;
                const btnRelogin = document.getElementById('btnReloginExpiredMs');
                if (btnRelogin) {
                    btnRelogin.onclick = () => loginWithMicrosoft();
                }
                if (equippedBadge) equippedBadge.style.display = 'none';
            } else {
                if (countPill) countPill.style.display = 'none';
                if (btnHideCape) btnHideCape.style.display = 'none';
                container.innerHTML = `<div class="cape-loading-hint">Pláště nelze načíst (${res?.error || 'Nepřihlášen'}).</div>`;
            }
        } catch (e) {
            if (countPill) countPill.style.display = 'none';
            if (btnHideCape) btnHideCape.style.display = 'none';
            container.innerHTML = `<div class="cape-loading-hint">Chyba při načítání plášťů.</div>`;
        }
    }

    // ── Offline Preset & Custom Capes (Skryto pro Warez) ────────────────────
    function loadOfflinePresetCapes() {
        const container = document.getElementById('offlineCapesList');
        const offCapeSec = document.getElementById('offlineCapesSection');
        if (offCapeSec) offCapeSec.style.display = 'none';
        if (container) container.innerHTML = '';
    }

    // ── Character & Skin Handlers ───────────────────────────────────────────
    let nickDebounce = null;
    if (inputNick) {
        inputNick.addEventListener('input', (e) => {
            clearTimeout(nickDebounce);
            const val = e.target.value.trim() || 'Hráč';
            // Save immediately in config for offline players
            if (currentConfig.authType !== 'microsoft') {
                currentConfig.offlineUsername = val;
                currentConfig.username = val;
            }
            nickDebounce = setTimeout(() => {
                if (skinCaption) skinCaption.textContent = `3D Náhled: ${val}`;
                if (!currentConfig.customSkinPath && currentConfig.authType !== 'microsoft') {
                    const isSlim = currentConfig.customSkinVariant === 'slim';
                    const skinToDraw = (val.toLowerCase() === 'steve' || val.toLowerCase() === 'alex' || val === 'Hráč')
                        ? (isSlim ? 'assets/default_alex.png' : 'assets/default_steve.png')
                        : `https://minotar.net/skin/${encodeURIComponent(val)}`;
                    drawSkinToCanvas(skinToDraw, isSlim);
                    updateSkinViewer3D(skinToDraw, getEffectiveCape(), isSlim);
                    updateHeroSkinViewer3D(skinToDraw, getEffectiveCape(), isSlim);
                }
            }, 300);
        });
    }

    // Model variant toggles (Classic 4px vs Slim 3px)
    const btnVariantClassic = document.getElementById('btnVariantClassic');
    const btnVariantSlim = document.getElementById('btnVariantSlim');
    if (btnVariantClassic && btnVariantSlim) {
        btnVariantClassic.addEventListener('click', async () => {
            currentConfig.customSkinVariant = 'classic';
            btnVariantClassic.classList.add('active');
            btnVariantSlim.classList.remove('active');
            await window.api.saveOfflineSkin({ variant: 'classic' });
            if (skinViewer) skinViewer.playerObject.skin.modelType = 'default';
            if (heroSkinViewer) heroSkinViewer.playerObject.skin.modelType = 'default';
            updateCharacterTabSkinPreview();
        });
        btnVariantSlim.addEventListener('click', async () => {
            currentConfig.customSkinVariant = 'slim';
            btnVariantSlim.classList.add('active');
            btnVariantClassic.classList.remove('active');
            await window.api.saveOfflineSkin({ variant: 'slim' });
            if (skinViewer) skinViewer.playerObject.skin.modelType = 'slim';
            if (heroSkinViewer) heroSkinViewer.playerObject.skin.modelType = 'slim';
            updateCharacterTabSkinPreview();
        });
    }

    // Microsoft: Upload Skin to Mojang Account
    const btnUploadMojangSkin = document.getElementById('btnUploadMojangSkin');
    if (btnUploadMojangSkin) {
        btnUploadMojangSkin.addEventListener('click', async () => {
            const filePath = await window.api.selectSkinFile();
            if (!filePath) return;

            const variant = currentConfig.customSkinVariant || 'classic';
            btnUploadMojangSkin.disabled = true;
            btnUploadMojangSkin.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Nahrávám na Mojang účet...</span>';

            try {
                const res = await window.api.uploadMojangSkin(filePath, variant);
                if (res && res.success) {
                    showToast('Skin nahrán na Mojang účet.', 'success');
                    appendLog('[MOJANG] Skin aktualizován na serverech Mojang.');
                    if (res.skin && res.skin.url) {
                        currentConfig.customSkinPath = filePath;
                        drawSkinToCanvas(res.skin.url, variant === 'slim');
                    }
                } else {
                    showToast('Chyba při nahrávání na Mojang: ' + (res.error || 'Neznámá chyba'), 'error');
                }
            } catch (e) {
                showToast('Chyba: ' + e.message, 'error');
            } finally {
                btnUploadMojangSkin.disabled = false;
                btnUploadMojangSkin.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg> <span>Nahrát skin na Mojang účet</span>';
            }
        });
    }

    // Microsoft: Reset Skin on Mojang Account
    const btnResetMojangSkin = document.getElementById('btnResetMojangSkin');
    if (btnResetMojangSkin) {
        btnResetMojangSkin.addEventListener('click', async () => {
            if (!confirm('Opravdu chceš resetovat svůj oficiální skin na výchozí Steve/Alex?')) return;
            const res = await window.api.resetMojangSkin();
            if (res && res.success) {
                showToast('Skin byl resetován na výchozí.', 'success');
                const isSlim = currentConfig.customSkinVariant === 'slim';
                const defaultSkin = isSlim ? 'assets/default_alex.png' : 'assets/default_steve.png';
                if (currentConfig.microsoftAccount) {
                    currentConfig.microsoftAccount.skinUrl = null;
                }
                currentConfig.customSkinPath = null;
                drawSkinToCanvas(defaultSkin, isSlim);
                updateSkinViewer3D(defaultSkin, getEffectiveCape(), isSlim);
                updateHeroSkinViewer3D(defaultSkin, getEffectiveCape(), isSlim);
            } else {
                showToast('Reset selhal: ' + (res.error || 'Chyba'), 'error');
            }
        });
    }

    // Microsoft: Hide / Unequip Cape
    const btnHideMojangCape = document.getElementById('btnHideMojangCape');
    if (btnHideMojangCape) {
        btnHideMojangCape.addEventListener('click', async () => {
            const res = await window.api.setMojangCape(null);
            if (res && res.success) {
                showToast('Plášť byl skryt na tvém Mojang účtu.', 'success');
                await loadMojangCapes();
            } else {
                showToast('Chyba: ' + (res.error || 'Chyba'), 'error');
            }
        });
    }

    const btnRefreshMojangCapes = document.getElementById('btnRefreshMojangCapes');
    if (btnRefreshMojangCapes) {
        btnRefreshMojangCapes.addEventListener('click', () => loadMojangCapes());
    }

    // Offline / Warez: Select local custom skin (.png) - PERSISTS ACROSS ANY OFFLINE NICK
    if (btnSelectSkinFile) {
        btnSelectSkinFile.addEventListener('click', async () => {
            const destPath = await window.api.selectSkinFile();
            if (destPath) {
                currentConfig.customSkinPath = destPath;
                await window.api.saveOfflineSkin({
                    skinPath: destPath,
                    variant: currentConfig.customSkinVariant || 'classic'
                });
                updateUserUI(currentConfig.username, 'offline', destPath);
                showToast('Skin byl uložen.', 'success');
                appendLog(`[SKIN] Vlastní offline skin nastaven: ${destPath}`);
            }
        });
    }

    // Drag & Drop Skin Upload Support
    const skinWrapper = document.getElementById('skinCanvasWrapper');
    const skinDropHint = document.getElementById('skinDropHint');
    if (skinWrapper) {
        ['dragenter', 'dragover'].forEach(eventName => {
            skinWrapper.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (skinDropHint) skinDropHint.style.display = 'flex';
            });
        });

        ['dragleave', 'dragend'].forEach(eventName => {
            skinWrapper.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.relatedTarget && skinWrapper.contains(e.relatedTarget)) return;
                if (skinDropHint) skinDropHint.style.display = 'none';
            });
        });

        skinWrapper.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (skinDropHint) skinDropHint.style.display = 'none';

            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;

            const file = files[0];
            if (!file.name.toLowerCase().endsWith('.png')) {
                showToast('Soubor skinu musí být ve formátu .png', 'error');
                return;
            }

            try {
                const res = await window.api.saveDraggedSkin(file.path);
                if (res && res.success) {
                    currentConfig.customSkinPath = res.customSkinPath;
                    await window.api.saveOfflineSkin({
                        skinPath: res.customSkinPath,
                        variant: currentConfig.customSkinVariant || 'classic'
                    });
                    updateUserUI(currentConfig.username, currentConfig.authType || 'offline', res.customSkinPath);
                    showToast('Skin byl nahrán.', 'success');
                    appendLog(`[SKIN] Skin úspěšně nahrán přes Drag & Drop: ${file.name}`);
                } else {
                    showToast('Chyba při ukládání skinu: ' + (res?.error || 'Neznámá chyba'), 'error');
                }
            } catch (err) {
                showToast('Chyba při přetahování skinu: ' + err.message, 'error');
            }
        });
    }

    // Offline / Warez: Select local custom cape (.png)
    const btnSelectCapeFile = document.getElementById('btnSelectCapeFile');
    if (btnSelectCapeFile) {
        btnSelectCapeFile.addEventListener('click', async () => {
            const capePath = await window.api.selectCapeFile();
            if (capePath) {
                currentConfig.customCapePath = capePath;
                await window.api.saveOfflineSkin({ capePath: capePath });
                updateUserUI(currentConfig.username, 'offline', currentConfig.customSkinPath);
                loadOfflinePresetCapes();
                showToast('Plášť byl uložen.', 'success');
                appendLog(`[CAPE] Vlastní offline plášť nastaven: ${capePath}`);
            }
        });
    }

    // Offline / Warez: Remove local custom cape
    const btnRemoveOfflineCape = document.getElementById('btnRemoveOfflineCape');
    if (btnRemoveOfflineCape) {
        btnRemoveOfflineCape.addEventListener('click', async () => {
            currentConfig.customCapePath = null;
            await window.api.saveOfflineSkin({ capePath: null });
            updateUserUI(currentConfig.username, 'offline', currentConfig.customSkinPath);
            loadOfflinePresetCapes();
            showToast('Offline plášť byl odebrán.', 'info');
        });
    }

    // Offline / Warez: Save character nick & config
    if (btnSaveCharacter) {
        btnSaveCharacter.addEventListener('click', async () => {
            const nick = inputNick.value.trim() || 'Hráč';
            // Pokud hráč zadá nick svého přihlášeného Microsoft účtu, automaticky přepneme na Microsoft
            const msName = currentConfig.microsoftAccount?.name || currentConfig.microsoftAccount?.username;
            if (msName && nick.toLowerCase() === msName.toLowerCase()) {
                currentConfig.authType = 'microsoft';
                currentConfig.username = msName;
                await window.api.saveConfig({ authType: 'microsoft', username: msName });
                updateUserUI(msName, 'microsoft', currentConfig.microsoftAccount.skinUrl);
                temporaryButtonText(btnSaveCharacter, '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Uloženo</span>');
                showToast(`Nick "${msName}" patří tvému oficiálnímu účtu. Přepnuto na Microsoft přihlášení.`, 'success');
                return;
            }

            currentConfig.offlineUsername = nick;
            currentConfig.username = nick;
            const res = await window.api.loginOffline(nick);
            if (res && res.success) {
                currentConfig.username = nick;
                currentConfig.offlineUsername = nick;
                currentConfig.authType = 'offline';
                // Note: customSkinPath is kept!
                updateUserUI(nick, 'offline', currentConfig.customSkinPath);
                temporaryButtonText(btnSaveCharacter, '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Uloženo</span>');
                showToast(`Postava "${nick}" uložena.`, 'success');
            }
        });
    }

    // Microsoft Account Interactive Login
    if (window.api && window.api.onAuthStatus) {
        window.api.onAuthStatus((statusText) => {
            if (authMicrosoftBtn && authMicrosoftBtn.disabled) {
                authMicrosoftBtn.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>${escapeHtml(statusText)}</span>`;
            }
            appendLog(`[AUTH] ${statusText}`);
        });
    }

    async function loginWithMicrosoft() {
        if (!authMicrosoftBtn) return;
        authMicrosoftBtn.disabled = true;
        const originalHtml = authMicrosoftBtn.innerHTML;
        authMicrosoftBtn.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Čekám na okno Microsoftu...</span>';
        appendLog('[AUTH] Otevírám oficiální Microsoft přihlašovací okno...');

        try {
            const res = await window.api.loginMicrosoft();
            if (res && res.success) {
                currentConfig.username = res.profile.name;
                currentConfig.authType = 'microsoft';
                currentConfig.microsoftAccount = {
                    ...res.auth,
                    name: res.profile.name,
                    username: res.profile.name,
                    skinUrl: res.profile.skinUrl,
                    skins: res.profile.skins || [],
                    capes: res.profile.capes || []
                };
                if (res.profile.skinVariant) {
                    currentConfig.customSkinVariant = res.profile.skinVariant.toLowerCase() === 'slim' ? 'slim' : 'classic';
                }
                updateUserUI(res.profile.name, 'microsoft', res.profile.skinUrl);
                appendLog(`[AUTH] Microsoft účet přihlášen: ${res.profile.name}`);
                showToast(`Microsoft účet přihlášen: ${res.profile.name}`, 'success');
            } else {
                appendLog(`[AUTH] Přihlášení k Microsoft účtu: ${res.error || 'Zrušeno'}`);
                showToast(res.error || 'Přihlášení bylo zrušeno', 'error');
            }
        } catch (err) {
            appendLog(`[AUTH] Chyba při přihlašování: ${err.message}`);
            showToast(`Chyba: ${err.message}`, 'error');
        } finally {
            authMicrosoftBtn.disabled = false;
            authMicrosoftBtn.innerHTML = originalHtml;
        }
    }

    if (authMicrosoftBtn) {
        authMicrosoftBtn.addEventListener('click', async () => {
            if (currentConfig.authType === 'microsoft') {
                return;
            }
            const msAcc = currentConfig.microsoftAccount;
            const msName = msAcc?.name || msAcc?.username;
            if (msAcc && msName) {
                currentConfig.authType = 'microsoft';
                currentConfig.username = msName;
                await window.api.saveConfig({
                    authType: 'microsoft',
                    username: msName
                });
                updateUserUI(msName, 'microsoft', msAcc.skinUrl);
                appendLog(`[AUTH] Přepnuto zpět na Microsoft účet: ${msName}`);
                showToast(`Aktivován Microsoft účet: ${msName}`, 'success');
                return;
            }
            await loginWithMicrosoft();
        });
    }

    const btnSwitchMicrosoftAccount = document.getElementById('btnSwitchMicrosoftAccount');
    if (btnSwitchMicrosoftAccount) {
        btnSwitchMicrosoftAccount.addEventListener('click', loginWithMicrosoft);
    }

    // Offline Account Switcher
    if (authOfflineBtn) {
        authOfflineBtn.addEventListener('click', async () => {
            if (currentConfig.authType === 'offline') {
                return;
            }
            const nick = currentConfig.offlineUsername || 'Hráč';
            if (inputNick) inputNick.value = nick;
            const res = await window.api.loginOffline(nick);
            if (res && res.success) {
                currentConfig.username = nick;
                currentConfig.offlineUsername = nick;
                currentConfig.authType = 'offline';
                // Zachováme currentConfig.microsoftAccount v paměti pro okamžité přepnutí zpět!
                updateUserUI(nick, 'offline', currentConfig.customSkinPath);
                appendLog(`[AUTH] Přepnuto na offline mód pro nick: ${nick}`);
                showToast(`Přepnuto na offline mód: ${nick}`, 'info');
            }
        });
    }

    // ── Java & Settings Handlers ────────────────────────────────────────────
    async function detectAvailableJavas() {
        try {
            const list = await window.api.getAvailableJavas();
            if (javaDetectedList) {
                if (list && list.length > 0) {
                    javaDetectedList.innerHTML = list.map(j => `
                        <span class="java-pill" data-path="${escapeHtml(j.path)}" title="${escapeHtml(j.path)}">
                            ${escapeHtml(j.label)}
                        </span>
                    `).join('');

                    javaDetectedList.querySelectorAll('.java-pill').forEach(pill => {
                        pill.addEventListener('click', () => {
                            if (javaPathInput) {
                                javaPathInput.value = pill.dataset.path;
                                autoSaveSettings(true);
                            }
                        });
                    });

                    if (sideJavaBadge) {
                        sideJavaBadge.textContent = 'Java 25 (LTS)';
                    }
                } else {
                    javaDetectedList.innerHTML = `<span class="java-pill">Java 25 automatická detekce</span>`;
                }
            }
        } catch (e) { }
    }

    if (btnDetectJava) {
        btnDetectJava.addEventListener('click', async () => {
            const detected = await window.api.detectJava();
            if (javaPathInput) {
                javaPathInput.value = detected || '';
                autoSaveSettings(true);
                appendLog(`[JAVA] Detekováno: ${detected}`);
                temporaryButtonText(btnDetectJava, '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Detekováno</span>');
            }
        });
    }

    // ── Settings Auto-Save & Collection ─────────────────────────────────────
    function collectCurrentSettings() {
        const checkBorderlessFullscreen = document.getElementById('checkBorderlessFullscreen');
        const isBorderless = checkBorderlessFullscreen ? checkBorderlessFullscreen.checked : false;
        const selectedRes = document.querySelector('input[name="res"]:checked')?.value || '1280x720';
        let resObj = { width: 1280, height: 720, fullscreen: false };

        if (isBorderless || selectedRes === 'fullscreen') {
            resObj.fullscreen = true;
        } else {
            const parts = selectedRes.split('x');
            resObj.width = parseInt(parts[0], 10) || 1280;
            resObj.height = parseInt(parts[1], 10) || 720;
        }

        const graphicsBackendRadio = document.querySelector('input[name="graphicsBackend"]:checked');
        const graphicsBackend = graphicsBackendRadio ? graphicsBackendRadio.value : 'default';

        // Windows settings
        const checkWinHighPriority = document.getElementById('checkWinHighPriority');
        const checkWinDedicatedGpu = document.getElementById('checkWinDedicatedGpu');
        const checkWinWindowedOptimization = document.getElementById('checkWinWindowedOptimization');
        const checkWinDisableStickyKeys = document.getElementById('checkWinDisableStickyKeys');
        const checkWinTrimMemory = document.getElementById('checkWinTrimMemory');

        // Linux settings
        const checkGameMode = document.getElementById('checkGameMode');
        const checkDiscreteGpu = document.getElementById('checkDiscreteGpu');
        const checkZink = document.getElementById('checkZink');
        const checkDisableVsync = document.getElementById('checkDisableVsync');
        const checkNativeWayland = document.getElementById('checkNativeWayland');

        // Universal settings
        const checkDiscordRpc = document.getElementById('checkDiscordRpc');
        const checkAutoUpdateMods = document.getElementById('checkAutoUpdateMods');
        const checkScreenshotClipboard = document.getElementById('checkScreenshotClipboard');
        const jvmArgsInput = document.getElementById('jvmArgsInput');
        const customEnvVarsInput = document.getElementById('customEnvVarsInput');

        return {
            ramMax: (ramSliderController ? ramSliderController.getTarget() : parseInt(ramSlider?.value || '4', 10)),
            javaPath: javaPathInput?.value.trim() || null,
            autoConnectServer: false,
            resolution: resObj,
            graphicsBackend: graphicsBackend || 'default',
            winHighPriority: checkWinHighPriority ? checkWinHighPriority.checked : true,
            winDedicatedGpu: checkWinDedicatedGpu ? checkWinDedicatedGpu.checked : true,
            winWindowedOptimization: checkWinWindowedOptimization ? checkWinWindowedOptimization.checked : true,
            winDisableStickyKeys: checkWinDisableStickyKeys ? checkWinDisableStickyKeys.checked : true,
            winTrimMemory: checkWinTrimMemory ? checkWinTrimMemory.checked : true,
            enableGameMode: checkGameMode ? checkGameMode.checked : true,
            enableDiscreteGpu: checkDiscreteGpu ? checkDiscreteGpu.checked : true,
            enableZink: checkZink ? checkZink.checked : false,
            disableVsync: checkDisableVsync ? checkDisableVsync.checked : false,
            enableNativeWayland: checkNativeWayland ? checkNativeWayland.checked : false,
            enableDiscordRpc: checkDiscordRpc ? checkDiscordRpc.checked : true,
            autoUpdateMods: checkAutoUpdateMods ? checkAutoUpdateMods.checked : true,
            screenshotToClipboard: checkScreenshotClipboard ? checkScreenshotClipboard.checked : true,
            borderlessFullscreen: isBorderless,
            customJvmArgs: jvmArgsInput ? jvmArgsInput.value.trim() : null,
            customEnvVars: customEnvVarsInput ? customEnvVarsInput.value.trim() : ''
        };
    }

    let autoSaveSettingsTimer = null;
    let isSettingsDirty = false;

    function markSettingsDirty() {
        isSettingsDirty = true;
    }

    async function autoSaveSettings(instant = false, force = false) {
        if (!force) {
            isSettingsDirty = true;
        } else if (!isSettingsDirty && !autoSaveSettingsTimer) {
            return;
        }

        if (autoSaveSettingsTimer) {
            clearTimeout(autoSaveSettingsTimer);
            autoSaveSettingsTimer = null;
        }

        const doSave = async () => {
            isSettingsDirty = false;
            try {
                const updated = collectCurrentSettings();
                currentConfig = { ...currentConfig, ...updated };
                await window.api.saveConfig(updated);
                const saveBadge = document.getElementById('settingsAutoSaveStatus');
                if (saveBadge) {
                    saveBadge.style.display = 'inline-flex';
                    saveBadge.style.opacity = '1';
                    clearTimeout(saveBadge._fadeTimer);
                    saveBadge._fadeTimer = setTimeout(() => {
                        saveBadge.style.opacity = '0';
                        setTimeout(() => {
                            if (saveBadge.style.opacity === '0') saveBadge.style.display = 'none';
                        }, 300);
                    }, 1800);
                }
            } catch (err) {
                console.error('[CONFIG] Chyba automatického ukládání nastavení:', err);
            }
        };

        if (instant) {
            await doSave();
        } else {
            autoSaveSettingsTimer = setTimeout(doSave, 300);
        }
    }

    if (ramSlider && ramValueBadge) {
        ramSliderController = setupSmoothSnapSlider(ramSlider, ramValueBadge, {
            onFinalize: (val) => {
                currentConfig.ramMax = val;
                autoSaveSettings(true);
            }
        });
    }

    // Global listener ensuring all range sliders keep dynamic track progress updated smoothly
    document.addEventListener('input', (e) => {
        if (e.target && e.target.type === 'range' && e.target.classList.contains('slider') && !e.target._smoothController) {
            updateSliderVisuals(e.target, null, false);
        }
    });

    document.addEventListener('pointerup', (e) => {
        if (e.target && e.target.type === 'range' && e.target.classList.contains('slider') && !e.target._smoothController) {
            updateSliderVisuals(e.target, null, true);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target && e.target.type === 'range' && e.target.classList.contains('slider') && !e.target._smoothController) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                const min = parseFloat(e.target.min) || 2;
                const max = parseFloat(e.target.max) || 16;
                const nextVal = Math.min(max, Math.round(parseFloat(e.target.value) || min) + 1);
                e.target.value = nextVal;
                updateSliderVisuals(e.target, null, true);
                e.target.dispatchEvent(new Event('input', { bubbles: true }));
                e.target.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                const min = parseFloat(e.target.min) || 2;
                const prevVal = Math.max(min, Math.round(parseFloat(e.target.value) || min) - 1);
                e.target.value = prevVal;
                updateSliderVisuals(e.target, null, true);
                e.target.dispatchEvent(new Event('input', { bubbles: true }));
                e.target.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    if (btnOpenGameDir) {
        btnOpenGameDir.addEventListener('click', () => window.api.openGameDir());
    }

    // Auto-save listeners on all checkboxes & controls
    document.querySelectorAll('input[name="graphicsBackend"]').forEach(radio => {
        radio.addEventListener('change', () => autoSaveSettings(true));
    });

    const winSettingCheckboxes = [
        'checkWinHighPriority',
        'checkWinDedicatedGpu',
        'checkWinWindowedOptimization',
        'checkWinDisableStickyKeys',
        'checkWinTrimMemory'
    ];
    winSettingCheckboxes.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => autoSaveSettings(true));
    });

    const checkGameModeEl = document.getElementById('checkGameMode');
    if (checkGameModeEl) checkGameModeEl.addEventListener('change', () => autoSaveSettings(true));

    const checkDiscreteGpuEl = document.getElementById('checkDiscreteGpu');
    if (checkDiscreteGpuEl) checkDiscreteGpuEl.addEventListener('change', () => autoSaveSettings(true));

    const checkZinkEl = document.getElementById('checkZink');
    if (checkZinkEl) checkZinkEl.addEventListener('change', () => autoSaveSettings(true));

    const checkDisableVsyncEl = document.getElementById('checkDisableVsync');
    if (checkDisableVsyncEl) checkDisableVsyncEl.addEventListener('change', () => autoSaveSettings(true));

    const checkNativeWaylandEl = document.getElementById('checkNativeWayland');
    if (checkNativeWaylandEl) checkNativeWaylandEl.addEventListener('change', () => autoSaveSettings(true));

    const checkDiscordRpcEl = document.getElementById('checkDiscordRpc');
    if (checkDiscordRpcEl) checkDiscordRpcEl.addEventListener('change', () => autoSaveSettings(true));

    const checkAutoUpdateModsEl = document.getElementById('checkAutoUpdateMods');
    if (checkAutoUpdateModsEl) checkAutoUpdateModsEl.addEventListener('change', () => autoSaveSettings(true));

    const checkScreenshotClipboardEl = document.getElementById('checkScreenshotClipboard');
    if (checkScreenshotClipboardEl) checkScreenshotClipboardEl.addEventListener('change', () => autoSaveSettings(true));

    const checkBorderlessFullscreenEl = document.getElementById('checkBorderlessFullscreen');
    if (checkBorderlessFullscreenEl) {
        checkBorderlessFullscreenEl.addEventListener('change', () => {
            if (checkBorderlessFullscreenEl.checked) {
                const fullRadio = document.querySelector('input[name="res"][value="fullscreen"]');
                if (fullRadio) fullRadio.checked = true;
            }
            autoSaveSettings(true);
        });
    }

    document.querySelectorAll('input[name="res"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value !== 'fullscreen' && checkBorderlessFullscreenEl && checkBorderlessFullscreenEl.checked) {
                checkBorderlessFullscreenEl.checked = false;
            }
            autoSaveSettings(true);
        });
    });

    if (javaPathInput) {
        javaPathInput.addEventListener('input', () => autoSaveSettings(false));
        javaPathInput.addEventListener('change', () => autoSaveSettings(true));
    }

    const jvmArgsEl = document.getElementById('jvmArgsInput');
    if (jvmArgsEl) {
        jvmArgsEl.addEventListener('input', () => autoSaveSettings(false));
        jvmArgsEl.addEventListener('change', () => autoSaveSettings(true));
    }

    const customEnvVarsEl = document.getElementById('customEnvVarsInput');
    if (customEnvVarsEl) {
        customEnvVarsEl.addEventListener('input', () => autoSaveSettings(false));
        customEnvVarsEl.addEventListener('change', () => autoSaveSettings(true));
    }

    const btnPresetZgc = document.getElementById('btnPresetZgc');
    if (btnPresetZgc) {
        btnPresetZgc.addEventListener('click', () => {
            const jvmInput = document.getElementById('jvmArgsInput');
            if (jvmInput) {
                jvmInput.value = '-XX:+UseZGC -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC';
                autoSaveSettings(true);
                showToast('Nastaveny parametry ZGC.', 'info');
            }
        });
    }

    const btnPresetG1gc = document.getElementById('btnPresetG1gc');
    if (btnPresetG1gc) {
        btnPresetG1gc.addEventListener('click', () => {
            const jvmInput = document.getElementById('jvmArgsInput');
            if (jvmInput) {
                jvmInput.value = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC';
                autoSaveSettings(true);
                showToast('Nastaveny parametry G1GC.', 'info');
            }
        });
    }

    window.addEventListener('beforeunload', () => {
        if (typeof autoSaveSettings === 'function') {
            autoSaveSettings(true);
        }
    });



    // ── Console Output ──────────────────────────────────────────────────────
    function appendLog(line) {
        if (!consoleOutput) return;
        if (consoleOutput.textContent === 'Čekám na spuštění hry...') {
            consoleOutput.textContent = '';
        }
        consoleOutput.textContent += `${line}\n`;
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    async function getFullLogContent() {
        let content = '';
        if (consoleOutput && consoleOutput.textContent && consoleOutput.textContent !== 'Čekám na spuštění hry...') {
            content += '=== LAUNCHER CONSOLE LOG ===\n' + consoleOutput.textContent + '\n\n';
        }
        try {
            if (window.api && typeof window.api.getLatestGameLog === 'function') {
                const diskLog = await window.api.getLatestGameLog();
                if (diskLog && diskLog.trim().length > 0) {
                    content += '=== MINECRAFT LATEST.LOG ===\n' + diskLog;
                }
            }
        } catch (_) { }
        if (!content.trim()) {
            content = consoleOutput?.textContent || 'Žádné zaznamenané logy.';
        }
        return content;
    }

    if (btnCopyLog) {
        btnCopyLog.addEventListener('click', async () => {
            try {
                const logText = await getFullLogContent();
                if (window.api && typeof window.api.copyToClipboard === 'function') {
                    await window.api.copyToClipboard(logText);
                } else if (navigator.clipboard) {
                    await navigator.clipboard.writeText(logText);
                }
                showToast('Log byl zkopírován do schránky!', 'success');
                const orig = btnCopyLog.innerHTML;
                btnCopyLog.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Zkopírováno!</span>';
                setTimeout(() => { if (btnCopyLog) btnCopyLog.innerHTML = orig; }, 2000);
            } catch (err) {
                console.error('[COPY LOG]', err);
                showToast('Nepodařilo se zkopírovat log.', 'error');
            }
        });
    }

    if (btnOpenLogEditor) {
        btnOpenLogEditor.addEventListener('click', async () => {
            try {
                showToast('Otevírám log v textovém editoru...', 'info');
                if (window.api && typeof window.api.openLogInEditor === 'function') {
                    const ok = await window.api.openLogInEditor();
                    if (!ok) {
                        showToast('Nepodařilo se otevřít log v editoru.', 'error');
                    }
                }
            } catch (err) {
                console.error('[OPEN LOG EDITOR]', err);
                showToast('Chyba při otevírání logu.', 'error');
            }
        });
    }

    if (btnDownloadLog) {
        btnDownloadLog.addEventListener('click', async () => {
            try {
                const logText = await getFullLogContent();
                if (window.api && typeof window.api.downloadLogMyco === 'function') {
                    const res = await window.api.downloadLogMyco(logText);
                    if (res && res.success) {
                        const ratio = res.originalSize && res.compressedSize 
                            ? ` (úspora ${((1 - res.compressedSize / res.originalSize) * 100).toFixed(0)} %)` 
                            : '';
                        showToast(`Log byl úspěšně uložen do .myco${ratio}!`, 'success');
                        return;
                    } else if (res && res.canceled) {
                        return;
                    }
                }

                // Fallback pro prohlížečové stažení
                const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                a.download = `mychalsmp-log-${dateStr}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('Log byl úspěšně stažen!', 'success');
            } catch (err) {
                console.error('[DOWNLOAD LOG]', err);
                showToast('Nepodařilo se stáhnout log.', 'error');
            }
        });
    }

    if (btnClearLog) {
        btnClearLog.addEventListener('click', () => {
            if (consoleOutput) consoleOutput.textContent = '';
        });
    }

    // ── IPC Launch Events ───────────────────────────────────────────────────
    window.api.onProgress((data) => {
        lastProgressData = data;
        const rawPercent = Math.min(Math.max(data.percent || 0, 0), 100);
        updateLaunchProgressUI(rawPercent, data.text);
    });

    window.api.onLog((line) => {
        appendLog(line);
        // Živé milníky herního procesu zachycené přímo v rendereru
        if (isLaunching && !isRunning && typeof line === 'string') {
            if (line.includes('Loading Minecraft') || line.includes('Fabric Loader')) {
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 68), 'Zavádění zavaděče Fabric a herního jádra...');
            } else if (line.includes('Loading ') && line.includes('mods')) {
                const modMatch = line.match(/Loading\s+(\d+)\s+mods/i);
                const modTxt = modMatch ? `Zavádění ${modMatch[1]} módů a doplňků...` : 'Zavádění herních módů a doplňků...';
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 74), modTxt);
            } else if (line.includes('SpongePowered MIXIN') || line.includes('MixinExtras')) {
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 82), 'Aplikace herních optimalizací (Mixin)...');
            } else if (line.includes('Searching for graphics') || line.includes('Found graphics adapter') || line.includes('Sodium')) {
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 87), 'Inicializace grafické karty a GPU...');
            } else if (line.includes('Datafixer') || line.includes('Datafixer optimizations')) {
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 91), 'Optimalizace herních struktur a dat...');
            } else if (line.includes('Backend library: LWJGL') || line.includes('Setting user:')) {
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 95), 'Vytváření herního okna...');
            } else if (line.includes('Using graphics backend') || line.includes('GL_') || line.includes('VK_')) {
                updateLaunchProgressUI(Math.max(maxRenderedProgress, 98), 'Otevírání Minecraftu...');
            }
        }
    });

    window.api.onExit((data) => {
        const exitCode = (typeof data === 'object' && data !== null) ? data.exitCode : data;
        appendLog(`[LAUNCHER] Proces hry ukončen (kód: ${exitCode}).`);
        if (typeof data === 'object' && data !== null && data.sessionSeconds > 0) {
            const playedMins = Math.round(data.sessionSeconds / 60);
            const addedText = playedMins < 1 ? '< 1 min' : `${playedMins} min`;
            appendLog(`[HERNÍ ČAS] Zaznamenán nový odehraný čas: +${addedText} (Celkem: ${formatPlaytime(data.totalPlaytime)}).`);
        }
        resetPlayState();
        // Refresh profiles to display updated playtime
        window.api.getConfig().then(cfg => {
            if (cfg) {
                currentConfig = cfg;
                renderProfilesList();
            }
        });
        setTimeout(() => {
            if (progressContainer && !isRunning && !isLaunching) {
                progressContainer.style.display = 'none';
            }
        }, 2000);
    });

    // Live Playtime & Session Updates
    if (window.api && window.api.onPlaytimeUpdated) {
        window.api.onPlaytimeUpdated((data) => {
            if (!data) return;
            if (data.profileId && currentConfig && Array.isArray(currentConfig.profiles)) {
                const targetProf = currentConfig.profiles.find(p => p.id === data.profileId);
                if (targetProf) {
                    targetProf.playtimeSeconds = data.totalPlaytime || ((targetProf.playtimeSeconds || 0) + (data.addedSeconds || 0));
                    targetProf.lastPlayed = Date.now();
                    renderProfilesList();
                }
            }

            if (data.serverIp && currentConfig && Array.isArray(currentConfig.servers)) {
                const cleanSrv = data.serverIp.toLowerCase().trim();
                const matchedSrv = currentConfig.servers.find(s => {
                    const ip = (s.ip || '').toLowerCase();
                    const sub = (s.subdomain || '').toLowerCase();
                    const backup = (s.backupIp || '').toLowerCase();
                    const isM = (cleanSrv.includes('mychalsmp') || cleanSrv === '130.61.89.37') && (s.id === 'mychalsmp' || s.ip === 'mychalsmp.xyz');
                    return ip === cleanSrv || sub === cleanSrv || backup === cleanSrv || isM;
                });
                if (matchedSrv) {
                    matchedSrv.playtimeSeconds = (Number(matchedSrv.playtimeSeconds) || 0) + (data.addedSeconds || 0);
                    renderServerTracker();
                    renderServersFullTab();
                }
            }
        });
    }

    if (window.api && window.api.onServersUpdated) {
        window.api.onServersUpdated((newServers) => {
            if (Array.isArray(newServers)) {
                currentConfig.servers = newServers;
                renderServerTracker();
                renderServersFullTab();
            }
        });
    }

    // Zero-overhead during gameplay & background pause (Tray restore)
    if (window.api && window.api.onGameStarted) {
        window.api.onGameStarted((data) => {
            appendLog('[VÝKON] Hra spuštěna – plynulý přechod (Launch Handoff) do herního okna, launcher minimalizován do Tray lišty.');
            document.body.classList.add('launch-handoff');
            setTimeout(() => {
                document.body.classList.remove('launch-handoff');
            }, 400);
            stopClientProgressTicker();
            isRunning = true;
            isLaunching = false;
            launchingProfileId = null;
            if (data && data.profileId) {
                runningProfileId = data.profileId;
            } else if (!runningProfileId) {
                runningProfileId = currentConfig.activeProfileId;
            }
            setHeroLaunchCelebration(false);
            if (sidebarPlayBtn) {
                sidebarPlayBtn.style.opacity = '1';
                sidebarPlayBtn.style.background = '#ef4444';
                sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop';
            }
            renderProfilesList();
            refreshVersionStatuses();
            pauseLauncherBackgroundActivity();
        });
    }

    if (window.api && window.api.onGameStopped) {
        window.api.onGameStopped(() => {
            document.body.classList.remove('launch-handoff');
            appendLog('[VÝKON] Hra ukončena – okno launcheru obnoveno ze systémové lišty.');
            resetPlayState();
            resumeLauncherBackgroundActivity();
        });
    }

    // ── Screenshots Gallery Modal ───────────────────────────────────────────
    const modalScreenshotsGallery = document.getElementById('modalScreenshotsGallery');
    const btnOpenScreenshotsModal = document.getElementById('btnOpenScreenshotsModal');
    const btnCloseScreenshotsModal = document.getElementById('btnCloseScreenshotsModal');
    const btnOpenScreenshotsFolder = document.getElementById('btnOpenScreenshotsFolder');
    const screenshotsGridContainer = document.getElementById('screenshotsGridContainer');

    async function loadScreenshotsGallery() {
        if (!screenshotsGridContainer) return;
        screenshotsGridContainer.innerHTML = '<div class="mods-loading">Načítám screenshoty...</div>';
        try {
            const profId = currentConfig.activeProfileId;
            const res = await window.api.getProfileScreenshots(profId);
            if (!res || !res.success) {
                screenshotsGridContainer.innerHTML = `<div class="empty-mods-state"><p>Chyba při načítání screenshotů: ${escapeHtml(res?.error || 'Neznámá chyba')}</p></div>`;
                return;
            }

            const items = res.screenshots || [];
            if (items.length === 0) {
                screenshotsGridContainer.innerHTML = `
                    <div class="empty-mods-state" style="grid-column: 1 / -1; padding: 40px 20px;">
                        <div class="empty-mods-icon">
                            <svg class="ui-icon-svg ui-icon-svg--xl" viewBox="0 0 24 24">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                            </svg>
                        </div>
                        <div class="empty-mods-title">Žádné screenshoty</div>
                        <p class="empty-mods-desc">V tomto profilu zatím nejsou žádné screenshoty.</p>
                    </div>
                `;
                return;
            }

            screenshotsGridContainer.innerHTML = items.map(sc => `
                <div class="screenshot-card" data-path="${escapeHtml(sc.fullPath)}">
                    <div class="screenshot-thumb-box" title="Otevřít">
                        <img src="${sc.thumbUrl}" alt="${escapeHtml(sc.filename)}" class="screenshot-thumb-img" loading="lazy">
                        <div class="screenshot-overlay">
                            <button type="button" class="btn-screenshot-copy" data-path="${escapeHtml(sc.fullPath)}" title="Kopírovat do schránky">
                                <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                                <span>Kopírovat</span>
                            </button>
                        </div>
                    </div>
                    <div class="screenshot-info">
                        <div class="screenshot-name" title="${escapeHtml(sc.filename)}">${escapeHtml(sc.filename)}</div>
                        <div class="screenshot-meta">
                            <span>${escapeHtml(sc.dateFormatted)}</span>
                            <span>•</span>
                            <span>${escapeHtml(sc.sizeFormatted)}</span>
                        </div>
                        <div class="screenshot-actions">
                            <button type="button" class="mc-btn mc-btn-secondary btn-sm btn-open-single-sc" data-path="${escapeHtml(sc.fullPath)}" title="Otevřít">
                                Otevřít
                            </button>
                            <button type="button" class="mc-btn btn-sm btn-delete-single-sc" data-path="${escapeHtml(sc.fullPath)}" style="color: #f51515;" title="Smazat">
                                <svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');

            // Bind Copy to Clipboard
            screenshotsGridContainer.querySelectorAll('.btn-screenshot-copy').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const fullPath = btn.dataset.path;
                    try {
                        const cRes = await window.api.copyScreenshotToClipboard(fullPath);
                        if (cRes && cRes.success) {
                            showToast('Screenshot zkopírován do schránky.', 'success');
                        } else {
                            showToast('Chyba při kopírování: ' + (cRes?.error || 'Neznámá'), 'error');
                        }
                    } catch (err) {
                        showToast('Chyba: ' + err.message, 'error');
                    }
                };
            });

            // Bind Open File
            screenshotsGridContainer.querySelectorAll('.btn-open-single-sc').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const fullPath = btn.dataset.path;
                    await window.api.openFilePath(fullPath);
                };
            });

            // Clicking thumbnail opens file too
            screenshotsGridContainer.querySelectorAll('.screenshot-thumb-box').forEach(box => {
                box.onclick = async () => {
                    const card = box.closest('.screenshot-card');
                    if (card?.dataset?.path) {
                        await window.api.openFilePath(card.dataset.path);
                    }
                };
            });

            // Bind Delete
            screenshotsGridContainer.querySelectorAll('.btn-delete-single-sc').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const fullPath = btn.dataset.path;
                    if (!confirm('Opravdu chceš smazat tento screenshot?')) return;
                    try {
                        const dRes = await window.api.deleteScreenshot(fullPath);
                        if (dRes && dRes.success) {
                            showToast('Screenshot byl smazán.', 'info');
                            loadScreenshotsGallery();
                        } else {
                            showToast('Chyba při mazání: ' + (dRes?.error || 'Neznámá chyba'), 'error');
                        }
                    } catch (err) {
                        showToast('Chyba: ' + err.message, 'error');
                    }
                };
            });

        } catch (e) {
            screenshotsGridContainer.innerHTML = `<div class="empty-mods-state"><p>Chyba při načítání galerie: ${escapeHtml(e.message)}</p></div>`;
        }
    }

    if (btnOpenScreenshotsModal) {
        btnOpenScreenshotsModal.addEventListener('click', () => {
            if (modalScreenshotsGallery) {
                modalScreenshotsGallery.style.display = 'flex';
                loadScreenshotsGallery();
            }
        });
    }

    if (btnCloseScreenshotsModal) {
        btnCloseScreenshotsModal.addEventListener('click', () => {
            if (modalScreenshotsGallery) modalScreenshotsGallery.style.display = 'none';
        });
    }

    if (btnOpenScreenshotsFolder) {
        btnOpenScreenshotsFolder.addEventListener('click', async () => {
            const profId = currentConfig.activeProfileId;
            await window.api.openProfileFolder(profId, 'screenshots');
        });
    }

    if (modalScreenshotsGallery) {
        modalScreenshotsGallery.addEventListener('click', (e) => {
            if (e.target === modalScreenshotsGallery) {
                modalScreenshotsGallery.style.display = 'none';
            }
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ⌨️ KEYBIND EDITOR & VISUAL KEYBOARD CONTROLLER (MYCHAL SMP STANDARDS)
    // ═════════════════════════════════════════════════════════════════════════
    const modalKeybindEditor = document.getElementById('modalKeybindEditor');
    const btnCloseKeybindEditorModal = document.getElementById('btnCloseKeybindEditorModal');
    const btnKeybindToggleKeyboard = document.getElementById('btnKeybindToggleKeyboard');
    const btnKeybindToggleList = document.getElementById('btnKeybindToggleList');
    const keybindKeyboardView = document.getElementById('keybindKeyboardView');
    const keybindListView = document.getElementById('keybindListView');
    const keybindFilterToolbar = document.getElementById('keybindFilterToolbar');
    const keyboardStage = document.getElementById('keyboardStage');
    const mouseButtonsRow = document.getElementById('mouseButtonsRow');
    const keybindCategoriesContainer = document.getElementById('keybindCategoriesContainer');
    const keybindSearchInput = document.getElementById('keybindSearchInput');
    const btnClearKeybindSearch = document.getElementById('btnClearKeybindSearch');
    const keybindCategoryChips = document.getElementById('keybindCategoryChips');
    const chipOnlyConflicts = document.getElementById('chipOnlyConflicts');
    const keybindConflictPill = document.getElementById('keybindConflictPill');
    const keybindConflictText = document.getElementById('keybindConflictText');
    const btnResetKeybinds = document.getElementById('btnResetKeybinds');
    const keybindInspectorCard = document.getElementById('keybindInspectorCard');
    const inspectorEmptyState = document.getElementById('inspectorEmptyState');
    const inspectorActiveContent = document.getElementById('inspectorActiveContent');
    const inspectorKeyBadge = document.getElementById('inspectorKeyBadge');
    const inspectorKeyTitle = document.getElementById('inspectorKeyTitle');
    const inspectorKeySubtitle = document.getElementById('inspectorKeySubtitle');
    const inspectorBindingsList = document.getElementById('inspectorBindingsList');
    const btnInspectorAssignNew = document.getElementById('btnInspectorAssignNew');
    const keybindAutoSaveIndicator = document.getElementById('keybindAutoSaveIndicator');
    const keybindAutoSaveText = document.getElementById('keybindAutoSaveText');

    // Recorder dialog elements
    const modalKeybindRecorder = document.getElementById('modalKeybindRecorder');
    const recorderActionTitle = document.getElementById('recorderActionTitle');
    const recorderActionSubtitle = document.getElementById('recorderActionSubtitle');
    const recorderKeyPreview = document.getElementById('recorderKeyPreview');
    const btnRecorderUnbind = document.getElementById('btnRecorderUnbind');
    const btnRecorderCancel = document.getElementById('btnRecorderCancel');

    let keybindState = {
        binds: [],
        stats: { total: 0, conflicts: 0, bound: 0, unbound: 0 },
        keyDefinitions: {}
    };
    let keybindSelectedKey = null;
    let keybindActiveCategory = 'all';
    let keybindSearchQuery = '';
    let keybindRecordingActionId = null;

    const KEYBOARD_LAYOUT = [
        // Row 0: F-row
        [
            { key: 'key.keyboard.escape', label: 'Esc', class: 'key-f' },
            { gap: 'sm' },
            { key: 'key.keyboard.f1', label: 'F1', class: 'key-f' },
            { key: 'key.keyboard.f2', label: 'F2', class: 'key-f' },
            { key: 'key.keyboard.f3', label: 'F3', class: 'key-f' },
            { key: 'key.keyboard.f4', label: 'F4', class: 'key-f' },
            { gap: 'sm' },
            { key: 'key.keyboard.f5', label: 'F5', class: 'key-f' },
            { key: 'key.keyboard.f6', label: 'F6', class: 'key-f' },
            { key: 'key.keyboard.f7', label: 'F7', class: 'key-f' },
            { key: 'key.keyboard.f8', label: 'F8', class: 'key-f' },
            { gap: 'sm' },
            { key: 'key.keyboard.f9', label: 'F9', class: 'key-f' },
            { key: 'key.keyboard.f10', label: 'F10', class: 'key-f' },
            { key: 'key.keyboard.f11', label: 'F11', class: 'key-f' },
            { key: 'key.keyboard.f12', label: 'F12', class: 'key-f' },
            { gap: 'md' },
            { key: 'key.keyboard.print.screen', label: 'PrtSc', class: 'key-f' },
            { key: 'key.keyboard.scroll.lock', label: 'ScrLk', class: 'key-f' },
            { key: 'key.keyboard.pause', label: 'Pause', class: 'key-f' }
        ],
        // Row 1: Numbers
        [
            { key: 'key.keyboard.grave.accent', label: '~' },
            { key: 'key.keyboard.1', label: '1' },
            { key: 'key.keyboard.2', label: '2' },
            { key: 'key.keyboard.3', label: '3' },
            { key: 'key.keyboard.4', label: '4' },
            { key: 'key.keyboard.5', label: '5' },
            { key: 'key.keyboard.6', label: '6' },
            { key: 'key.keyboard.7', label: '7' },
            { key: 'key.keyboard.8', label: '8' },
            { key: 'key.keyboard.9', label: '9' },
            { key: 'key.keyboard.0', label: '0' },
            { key: 'key.keyboard.minus', label: '-' },
            { key: 'key.keyboard.equal', label: '=' },
            { key: 'key.keyboard.backspace', label: 'Backspace', class: 'key-backspace' },
            { gap: 'md' },
            { key: 'key.keyboard.insert', label: 'Ins', class: 'key-nav' },
            { key: 'key.keyboard.home', label: 'Home', class: 'key-nav' },
            { key: 'key.keyboard.page.up', label: 'PgUp', class: 'key-nav' }
        ],
        // Row 2: QWERTY
        [
            { key: 'key.keyboard.tab', label: 'Tab', class: 'key-tab' },
            { key: 'key.keyboard.q', label: 'Q' },
            { key: 'key.keyboard.w', label: 'W' },
            { key: 'key.keyboard.e', label: 'E' },
            { key: 'key.keyboard.r', label: 'R' },
            { key: 'key.keyboard.t', label: 'T' },
            { key: 'key.keyboard.y', label: 'Y' },
            { key: 'key.keyboard.u', label: 'U' },
            { key: 'key.keyboard.i', label: 'I' },
            { key: 'key.keyboard.o', label: 'O' },
            { key: 'key.keyboard.p', label: 'P' },
            { key: 'key.keyboard.left.bracket', label: '[' },
            { key: 'key.keyboard.right.bracket', label: ']' },
            { key: 'key.keyboard.backslash', label: '\\' },
            { gap: 'md' },
            { key: 'key.keyboard.delete', label: 'Del', class: 'key-nav' },
            { key: 'key.keyboard.end', label: 'End', class: 'key-nav' },
            { key: 'key.keyboard.page.down', label: 'PgDn', class: 'key-nav' }
        ],
        // Row 3: Home row
        [
            { key: 'key.keyboard.caps.lock', label: 'Caps', class: 'key-caps' },
            { key: 'key.keyboard.a', label: 'A' },
            { key: 'key.keyboard.s', label: 'S' },
            { key: 'key.keyboard.d', label: 'D' },
            { key: 'key.keyboard.f', label: 'F' },
            { key: 'key.keyboard.g', label: 'G' },
            { key: 'key.keyboard.h', label: 'H' },
            { key: 'key.keyboard.j', label: 'J' },
            { key: 'key.keyboard.k', label: 'K' },
            { key: 'key.keyboard.l', label: 'L' },
            { key: 'key.keyboard.semicolon', label: ';' },
            { key: 'key.keyboard.apostrophe', label: '\'' },
            { key: 'key.keyboard.enter', label: 'Enter', class: 'key-enter' }
        ],
        // Row 4: Shift row
        [
            { key: 'key.keyboard.left.shift', label: 'Shift', class: 'key-shift-l' },
            { key: 'key.keyboard.z', label: 'Z' },
            { key: 'key.keyboard.x', label: 'X' },
            { key: 'key.keyboard.c', label: 'C' },
            { key: 'key.keyboard.v', label: 'V' },
            { key: 'key.keyboard.b', label: 'B' },
            { key: 'key.keyboard.n', label: 'N' },
            { key: 'key.keyboard.m', label: 'M' },
            { key: 'key.keyboard.comma', label: ',' },
            { key: 'key.keyboard.period', label: '.' },
            { key: 'key.keyboard.slash', label: '/' },
            { key: 'key.keyboard.right.shift', label: 'Shift', class: 'key-shift-r' },
            { gap: 'md' },
            { spacer: true, class: 'key-nav' },
            { key: 'key.keyboard.up', label: '↑', class: 'key-nav' },
            { spacer: true, class: 'key-nav' }
        ],
        // Row 5: Bottom row
        [
            { key: 'key.keyboard.left.control', label: 'Ctrl', class: 'key-mod' },
            { key: 'key.keyboard.left.win', label: 'Win', class: 'key-mod' },
            { key: 'key.keyboard.left.alt', label: 'Alt', class: 'key-mod' },
            { key: 'key.keyboard.space', label: 'SPACE', class: 'key-space' },
            { key: 'key.keyboard.right.alt', label: 'Alt', class: 'key-mod' },
            { key: 'key.keyboard.right.win', label: 'Win', class: 'key-mod' },
            { key: 'key.keyboard.right.control', label: 'Ctrl', class: 'key-mod' },
            { gap: 'md' },
            { key: 'key.keyboard.left', label: '←', class: 'key-nav' },
            { key: 'key.keyboard.down', label: '↓', class: 'key-nav' },
            { key: 'key.keyboard.right', label: '→', class: 'key-nav' }
        ]
    ];

    const MOUSE_BUTTONS = [
        { key: 'key.mouse.left', label: 'Levé tl. myši', defaultDesc: 'Útok / Ničení' },
        { key: 'key.mouse.right', label: 'Pravé tl. myši', defaultDesc: 'Použít / Položit' },
        { key: 'key.mouse.middle', label: 'Kolečko myši', defaultDesc: 'Vybrat blok (Pick)' },
        { key: 'key.mouse.4', label: 'Boční tlačítko 4', defaultDesc: 'Zpět / Vlastní akce' },
        { key: 'key.mouse.5', label: 'Boční tlačítko 5', defaultDesc: 'Vpřed / Vlastní akce' }
    ];

    function getKeyDisplay(mcKey) {
        if (!mcKey || mcKey === 'key.keyboard.unknown') return '—';
        if (keybindState.keyDefinitions && keybindState.keyDefinitions[mcKey]) {
            const def = keybindState.keyDefinitions[mcKey];
            return typeof def === 'object' && def !== null ? (def.label || def.code || mcKey) : def;
        }
        if (mcKey.startsWith('key.keyboard.')) {
            return mcKey.replace('key.keyboard.', '').toUpperCase();
        }
        if (mcKey.startsWith('key.mouse.')) {
            return mcKey.replace('key.mouse.', 'Myš ').toUpperCase();
        }
        return mcKey;
    }

    function isDebugKeyAction(action) {
        if (!action) return false;
        if (action.isDebug) return true;
        const id = (action.id || '').toLowerCase();
        return id.includes('.debug.') || id.includes('debug_') || id.startsWith('key_debug') || id.startsWith('key.debug');
    }

    function recalculateKeybindStats() {
        const normalCounts = {};
        const debugCounts = {};

        for (const b of keybindState.binds) {
            if (b.key && b.key !== 'key.keyboard.unknown') {
                const isDbg = isDebugKeyAction(b);
                b.isDebug = isDbg;
                if (isDbg) {
                    debugCounts[b.key] = (debugCounts[b.key] || 0) + 1;
                } else {
                    normalCounts[b.key] = (normalCounts[b.key] || 0) + 1;
                }
            }
        }
        let conflicts = 0;
        let bound = 0;
        let unbound = 0;

        for (const b of keybindState.binds) {
            if (!b.key || b.key === 'key.keyboard.unknown') {
                b.isConflict = false;
                unbound++;
            } else {
                bound++;
                // F3 debug zkratky vyžadují držení F3, proto nekolidují s běžnými klávesami
                const count = b.isDebug ? (debugCounts[b.key] || 0) : (normalCounts[b.key] || 0);
                b.isConflict = count > 1;
                if (b.isConflict) conflicts++;
            }
        }

        keybindState.stats = {
            total: keybindState.binds.length,
            conflicts,
            bound,
            unbound
        };

        if (keybindConflictPill && keybindConflictText) {
            if (conflicts > 0) {
                keybindConflictPill.className = 'keybind-conflict-chip has-conflicts';
                keybindConflictText.textContent = `${conflicts} ${conflicts === 1 ? 'konflikt' : (conflicts < 5 ? 'konflikty' : 'konfliktů')}`;
                if (chipOnlyConflicts) chipOnlyConflicts.style.display = 'inline-block';
            } else {
                keybindConflictPill.className = 'keybind-conflict-chip clean';
                keybindConflictText.textContent = '0 konfliktů';
                if (chipOnlyConflicts) {
                    chipOnlyConflicts.style.display = 'none';
                    if (keybindActiveCategory === 'conflicts') {
                        keybindActiveCategory = 'all';
                        updateCategoryChipsUI();
                    }
                }
            }
        }
    }

    function updateCategoryChipsUI() {
        if (!keybindCategoryChips) return;
        const chips = keybindCategoryChips.querySelectorAll('.cat-chip');
        chips.forEach(c => {
            const cat = c.dataset.category;
            if (cat === keybindActiveCategory) {
                c.classList.add('active');
            } else {
                c.classList.remove('active');
            }
        });
    }

    async function autoSaveKeybinds() {
        try {
            const map = {};
            for (const b of keybindState.binds) {
                map[b.id] = b.key;
            }
            if (keybindAutoSaveIndicator && keybindAutoSaveText) {
                keybindAutoSaveIndicator.style.opacity = '0.5';
                keybindAutoSaveText.textContent = 'Ukládám bindy...';
            }
            await window.api.saveKeybinds(map);
            if (keybindAutoSaveIndicator && keybindAutoSaveText) {
                keybindAutoSaveIndicator.style.opacity = '1';
                keybindAutoSaveText.textContent = 'Všechny bindy uloženy globálně pro všechny profily';
            }
        } catch (err) {
            console.error('Chyba při ukládání kláves:', err);
            if (keybindAutoSaveText) keybindAutoSaveText.textContent = 'Chyba ukládání';
        }
    }

    function renderKeyboardStage() {
        if (!keyboardStage) return;
        keyboardStage.innerHTML = '';

        KEYBOARD_LAYOUT.forEach(row => {
            const rowEl = document.createElement('div');
            rowEl.className = 'keyboard-row';

            row.forEach(item => {
                if (item.gap) {
                    const gapEl = document.createElement('div');
                    gapEl.className = `keyboard-gap-${item.gap}`;
                    rowEl.appendChild(gapEl);
                    return;
                }
                if (item.spacer) {
                    const spEl = document.createElement('div');
                    spEl.className = `keycap ${item.class || ''}`;
                    spEl.style.visibility = 'hidden';
                    rowEl.appendChild(spEl);
                    return;
                }

                const keycap = document.createElement('div');
                keycap.className = `keycap ${item.class || ''}`;
                keycap.dataset.key = item.key;

                const boundActions = keybindState.binds.filter(b => b.key === item.key);
                const normalBound = boundActions.filter(b => !b.isDebug);
                const debugBound = boundActions.filter(b => b.isDebug);
                const isConflict = normalBound.length > 1 || debugBound.length > 1;
                const isBound = boundActions.length > 0;

                if (isConflict) keycap.classList.add('conflict');
                else if (isBound) keycap.classList.add('bound');

                if (keybindSelectedKey === item.key) {
                    keycap.classList.add('selected');
                }

                // Subtitle preview
                let subText = '';
                if (isConflict) {
                    const conflictCount = (normalBound.length > 1 ? normalBound.length : 0) + (debugBound.length > 1 ? debugBound.length : 0);
                    subText = `${conflictCount} akce`;
                } else if (isBound) {
                    subText = normalBound.length > 0 ? normalBound[0].label : debugBound[0].label;
                }

                keycap.innerHTML = `
                    <span class="keycap-label">${escapeHtml(item.label)}</span>
                    <span class="keycap-sub" title="${escapeHtml(subText)}">${escapeHtml(subText)}</span>
                    ${isConflict ? `<span class="keycap-conflict-badge">${normalBound.length > 1 ? normalBound.length : debugBound.length}</span>` : ''}
                `;

                keycap.addEventListener('click', () => {
                    selectKeyboardKey(item.key, item.label);
                });

                rowEl.appendChild(keycap);
            });

            keyboardStage.appendChild(rowEl);
        });

        renderMouseButtonsRow();
    }

    function renderMouseButtonsRow() {
        if (!mouseButtonsRow) return;
        mouseButtonsRow.innerHTML = '';

        MOUSE_BUTTONS.forEach(btn => {
            const keycap = document.createElement('div');
            keycap.className = 'keycap mouse-keycap';
            keycap.dataset.key = btn.key;

            const boundActions = keybindState.binds.filter(b => b.key === btn.key);
            const normalBound = boundActions.filter(b => !b.isDebug);
            const debugBound = boundActions.filter(b => b.isDebug);
            const isConflict = normalBound.length > 1 || debugBound.length > 1;
            const isBound = boundActions.length > 0;

            if (isConflict) keycap.classList.add('conflict');
            else if (isBound) keycap.classList.add('bound');

            if (keybindSelectedKey === btn.key) {
                keycap.classList.add('selected');
            }

            let subText = btn.defaultDesc;
            if (isConflict) {
                subText = 'Konflikt';
            } else if (isBound) {
                subText = boundActions.map(a => a.label).join(', ');
            }

            keycap.innerHTML = `
                <span class="keycap-label">${escapeHtml(btn.label)}</span>
                <span class="keycap-sub" title="${escapeHtml(subText)}">${escapeHtml(subText)}</span>
                ${isConflict ? `<span class="keycap-conflict-badge">${boundActions.length}</span>` : ''}
            `;

            keycap.addEventListener('click', () => {
                selectKeyboardKey(btn.key, btn.label);
            });

            mouseButtonsRow.appendChild(keycap);
        });
    }

    function selectKeyboardKey(mcKey, label) {
        keybindSelectedKey = mcKey;

        // Aktualizujeme třídu selected na všech klávesách
        if (keyboardStage) {
            keyboardStage.querySelectorAll('.keycap').forEach(k => {
                k.classList.toggle('selected', k.dataset.key === mcKey);
            });
        }
        if (mouseButtonsRow) {
            mouseButtonsRow.querySelectorAll('.keycap').forEach(k => {
                k.classList.toggle('selected', k.dataset.key === mcKey);
            });
        }

        renderKeyInspector(mcKey, label);
    }

    function renderKeyInspector(mcKey, label) {
        if (!keybindInspectorCard || !inspectorEmptyState || !inspectorActiveContent) return;

        if (!mcKey) {
            inspectorEmptyState.style.display = 'flex';
            inspectorActiveContent.style.display = 'none';
            return;
        }

        inspectorEmptyState.style.display = 'none';
        inspectorActiveContent.style.display = 'block';

        const boundActions = keybindState.binds.filter(b => b.key === mcKey);
        const normalBound = boundActions.filter(b => !b.isDebug);
        const debugBound = boundActions.filter(b => b.isDebug);
        const hasConflict = normalBound.length > 1 || debugBound.length > 1;
        const displayLabel = label || getKeyDisplay(mcKey);

        inspectorKeyBadge.textContent = displayLabel;
        inspectorKeyTitle.textContent = `Klávesa: ${displayLabel}`;

        if (boundActions.length === 0) {
            inspectorKeySubtitle.textContent = 'Volná klávesa (žádná přiřazená akce)';
            inspectorKeySubtitle.style.color = 'var(--text-muted)';
        } else if (hasConflict) {
            inspectorKeySubtitle.textContent = 'Konflikt: více akcí používá tuto klávesu současně';
            inspectorKeySubtitle.style.color = 'var(--brand-red)';
        } else if (normalBound.length === 1 && debugBound.length === 1) {
            inspectorKeySubtitle.textContent = `1 herní akce + 1 F3 debug zkratka (bez konfliktu)`;
            inspectorKeySubtitle.style.color = 'var(--brand-gray)';
        } else {
            inspectorKeySubtitle.textContent = `${boundActions.length} ${boundActions.length === 1 ? 'přiřazená akce' : (boundActions.length < 5 ? 'přiřazené akce' : 'přiřazených akcí')}`;
            inspectorKeySubtitle.style.color = 'var(--brand-gray)';
        }

        inspectorBindingsList.innerHTML = '';

        if (boundActions.length === 0) {
            const emptyNotice = document.createElement('div');
            emptyNotice.style.padding = '10px 0';
            emptyNotice.style.color = 'var(--text-muted)';
            emptyNotice.style.fontSize = '0.84rem';
            emptyNotice.textContent = 'K této klávese zatím není přiřazena žádná herní akce.';
            inspectorBindingsList.appendChild(emptyNotice);
        } else {
            boundActions.forEach(action => {
                const row = document.createElement('div');
                row.className = `inspector-binding-row ${action.isConflict ? 'is-conflict' : ''}`;

                const tagText = action.isDebug
                    ? `F3 Debug zkratka • ${action.id}`
                    : `${action.modName || action.category} • ${action.id}`;

                row.innerHTML = `
                    <div class="inspector-binding-info">
                        <span class="inspector-binding-title">${escapeHtml(action.label)}</span>
                        <span class="inspector-binding-tag">${escapeHtml(tagText)}</span>
                    </div>
                    <div class="inspector-binding-controls">
                        <button type="button" class="mc-btn mc-btn-primary btn-sm btn-rebind-action">
                            Změnit klávesu
                        </button>
                        <button type="button" class="mc-btn mc-btn-secondary btn-sm btn-unbind-action" title="Zrušit přiřazení">
                            ✕
                        </button>
                    </div>
                `;

                row.querySelector('.btn-rebind-action').addEventListener('click', () => {
                    startRecordingKeybind(action.id);
                });
                row.querySelector('.btn-unbind-action').addEventListener('click', async () => {
                    action.key = 'key.keyboard.unknown';
                    recalculateKeybindStats();
                    renderKeyboardStage();
                    renderKeyInspector(mcKey, label);
                    renderKeybindListView();
                    await autoSaveKeybinds();
                });

                inspectorBindingsList.appendChild(row);
            });
        }

        // Tlačítko přiřadit novou akci
        btnInspectorAssignNew.onclick = () => {
            showAssignActionPicker(mcKey);
        };
    }

    function showAssignActionPicker(targetMcKey) {
        // Zobrazíme rychlý dialog se všemi akcemi, které lze přiřadit k této klávese
        const availableActions = keybindState.binds.filter(b => b.key !== targetMcKey);
        if (availableActions.length === 0) {
            showToast('Všechny akce jsou již k této klávese přiřazeny.', 'info');
            return;
        }

        const pickerModal = document.createElement('div');
        pickerModal.className = 'launcher-modal-overlay';
        pickerModal.style.display = 'flex';
        pickerModal.style.zIndex = '99999';

        pickerModal.innerHTML = `
            <div class="launcher-modal-card" style="max-width: 520px; width: 90%; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <div class="modal-title-box">
                        <h3>Přiřadit akci ke klávese ${escapeHtml(getKeyDisplay(targetMcKey))}</h3>
                    </div>
                    <button class="modal-close-btn btn-picker-close">✕</button>
                </div>
                <div style="padding: 12px 18px; border-bottom: 1px solid var(--surface-border);">
                    <input type="text" class="keybind-search-input picker-search" placeholder="Hledat akci (např. Skok, Útok, Zoom)..." style="width: 100%;">
                </div>
                <div class="picker-list" style="overflow-y: auto; flex: 1; padding: 12px 18px; display: flex; flex-direction: column; gap: 6px;">
                </div>
            </div>
        `;

        document.body.appendChild(pickerModal);

        const pickerList = pickerModal.querySelector('.picker-list');
        const pickerSearch = pickerModal.querySelector('.picker-search');
        const btnClose = pickerModal.querySelector('.btn-picker-close');

        function renderPickerList(filter = '') {
            pickerList.innerHTML = '';
            const q = filter.toLowerCase().trim();
            const filtered = availableActions.filter(a => {
                if (!q) return true;
                return a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
            });

            if (filtered.length === 0) {
                pickerList.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">Žádná akce nenalezena.</div>';
                return;
            }

            filtered.forEach(action => {
                const item = document.createElement('div');
                item.className = 'inspector-binding-row';
                item.style.cursor = 'pointer';

                item.innerHTML = `
                    <div class="inspector-binding-info">
                        <span class="inspector-binding-title">${escapeHtml(action.label)}</span>
                        <span class="inspector-binding-tag">Aktuální klávesa: ${escapeHtml(getKeyDisplay(action.key))}</span>
                    </div>
                    <button type="button" class="mc-btn mc-btn-primary btn-sm">Přiřadit</button>
                `;

                item.addEventListener('click', async () => {
                    action.key = targetMcKey;
                    document.body.removeChild(pickerModal);
                    recalculateKeybindStats();
                    renderKeyboardStage();
                    renderKeyInspector(targetMcKey);
                    renderKeybindListView();
                    await autoSaveKeybinds();
                    showToast(`Klávesa ${getKeyDisplay(targetMcKey)} přiřazena k "${action.label}".`, 'success');
                });

                pickerList.appendChild(item);
            });
        }

        renderPickerList();
        pickerSearch.addEventListener('input', (e) => renderPickerList(e.target.value));
        pickerSearch.focus();

        btnClose.addEventListener('click', () => {
            if (document.body.contains(pickerModal)) document.body.removeChild(pickerModal);
        });
        pickerModal.addEventListener('click', (e) => {
            if (e.target === pickerModal && document.body.contains(pickerModal)) {
                document.body.removeChild(pickerModal);
            }
        });
    }

    function renderKeybindListView() {
        if (!keybindCategoriesContainer) return;
        keybindCategoriesContainer.innerHTML = '';

        const CATEGORY_NAMES = {
            'movement': 'Pohyb',
            'gameplay': 'Hratelnost & Boj',
            'inventory': 'Inventář & Rychlá lišta',
            'multiplayer': 'Multiplayer & Komunikace',
            'misc': 'Různé & Rozhraní',
            'mods': 'Módy & Doplňky'
        };

        const categories = ['movement', 'gameplay', 'inventory', 'multiplayer', 'misc', 'mods'];
        const q = keybindSearchQuery.toLowerCase().trim();

        categories.forEach(catKey => {
            if (keybindActiveCategory !== 'all' && keybindActiveCategory !== 'conflicts' && keybindActiveCategory !== catKey) {
                return;
            }

            let actions = keybindState.binds.filter(b => b.category === catKey);

            if (keybindActiveCategory === 'conflicts') {
                actions = actions.filter(b => b.isConflict);
            }

            if (q) {
                actions = actions.filter(b => {
                    const labelMatch = b.label.toLowerCase().includes(q);
                    const idMatch = b.id.toLowerCase().includes(q);
                    const keyMatch = getKeyDisplay(b.key).toLowerCase().includes(q);
                    return labelMatch || idMatch || keyMatch;
                });
            }

            if (actions.length === 0) return;

            const card = document.createElement('div');
            card.className = 'keybind-category-card';

            const header = document.createElement('div');
            header.className = 'keybind-category-header';
            header.innerHTML = `
                <span>${CATEGORY_NAMES[catKey] || catKey}</span>
                <span class="keybind-category-count">${actions.length} ${actions.length === 1 ? 'akce' : (actions.length < 5 ? 'akce' : 'akcí')}</span>
            `;
            card.appendChild(header);

            const body = document.createElement('div');
            body.className = 'keybind-category-body';

            actions.forEach(action => {
                const row = document.createElement('div');
                row.className = `keybind-action-row ${action.isConflict ? 'is-conflict' : ''}`;

                let conflictNotice = '';
                if (action.isConflict) {
                    const others = keybindState.binds.filter(b => b.key === action.key && b.id !== action.id);
                    const names = others.map(o => o.label).join(', ');
                    conflictNotice = `<div class="action-conflict-warn"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Konflikt s: ${escapeHtml(names)}</div>`;
                }

                row.innerHTML = `
                    <div class="action-row-left">
                        <span class="action-label-main">${escapeHtml(action.label)}</span>
                        <span class="action-id-sub">${escapeHtml(action.modName ? `${action.modName} • ` : '')}${escapeHtml(action.id)}</span>
                        ${conflictNotice}
                    </div>
                    <div class="action-row-right">
                        <button type="button" class="key-record-btn ${action.isConflict ? 'is-conflict' : ''}">
                            ${escapeHtml(getKeyDisplay(action.key))}
                        </button>
                        <button type="button" class="key-unbind-btn" title="Zrušit bind">
                            ✕
                        </button>
                    </div>
                `;

                const recordBtn = row.querySelector('.key-record-btn');
                const unbindBtn = row.querySelector('.key-unbind-btn');

                recordBtn.addEventListener('click', () => {
                    startRecordingKeybind(action.id);
                });

                unbindBtn.addEventListener('click', async () => {
                    action.key = 'key.keyboard.unknown';
                    recalculateKeybindStats();
                    renderKeyboardStage();
                    renderKeybindListView();
                    if (keybindSelectedKey) renderKeyInspector(keybindSelectedKey);
                    await autoSaveKeybinds();
                });

                body.appendChild(row);
            });

            card.appendChild(body);
            keybindCategoriesContainer.appendChild(card);
        });

        if (keybindCategoriesContainer.children.length === 0) {
            keybindCategoriesContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 40px;">
                    Žádné klávesy neodpovídají zadanému filtru.
                </div>
            `;
        }
    }

    function convertBrowserCodeToMcKey(code) {
        if (!code) return 'key.keyboard.unknown';
        const directMap = {
            'Space': 'key.keyboard.space',
            'ShiftLeft': 'key.keyboard.left.shift',
            'ShiftRight': 'key.keyboard.right.shift',
            'ControlLeft': 'key.keyboard.left.control',
            'ControlRight': 'key.keyboard.right.control',
            'AltLeft': 'key.keyboard.left.alt',
            'AltRight': 'key.keyboard.right.alt',
            'MetaLeft': 'key.keyboard.left.win',
            'MetaRight': 'key.keyboard.right.win',
            'Tab': 'key.keyboard.tab',
            'CapsLock': 'key.keyboard.caps.lock',
            'Enter': 'key.keyboard.enter',
            'Backspace': 'key.keyboard.backspace',
            'Escape': 'key.keyboard.escape',
            'ArrowUp': 'key.keyboard.up',
            'ArrowDown': 'key.keyboard.down',
            'ArrowLeft': 'key.keyboard.left',
            'ArrowRight': 'key.keyboard.right',
            'Insert': 'key.keyboard.insert',
            'Delete': 'key.keyboard.delete',
            'Home': 'key.keyboard.home',
            'End': 'key.keyboard.end',
            'PageUp': 'key.keyboard.page.up',
            'PageDown': 'key.keyboard.page.down',
            'PrintScreen': 'key.keyboard.print.screen',
            'ScrollLock': 'key.keyboard.scroll.lock',
            'Pause': 'key.keyboard.pause',
            'Backquote': 'key.keyboard.grave.accent',
            'Minus': 'key.keyboard.minus',
            'Equal': 'key.keyboard.equal',
            'BracketLeft': 'key.keyboard.left.bracket',
            'BracketRight': 'key.keyboard.right.bracket',
            'Backslash': 'key.keyboard.backslash',
            'Semicolon': 'key.keyboard.semicolon',
            'Quote': 'key.keyboard.apostrophe',
            'Comma': 'key.keyboard.comma',
            'Period': 'key.keyboard.period',
            'Slash': 'key.keyboard.slash'
        };
        if (directMap[code]) return directMap[code];
        if (code.startsWith('Key')) {
            return `key.keyboard.${code.slice(3).toLowerCase()}`;
        }
        if (code.startsWith('Digit')) {
            return `key.keyboard.${code.slice(5)}`;
        }
        if (code.startsWith('F') && /^F\d+$/.test(code)) {
            return `key.keyboard.${code.toLowerCase()}`;
        }
        if (code.startsWith('Numpad')) {
            return `key.keyboard.keypad.${code.slice(6).toLowerCase()}`;
        }
        return 'key.keyboard.unknown';
    }

    function convertMouseButtonToMcKey(button) {
        if (button === 0) return 'key.mouse.left';
        if (button === 1) return 'key.mouse.middle';
        if (button === 2) return 'key.mouse.right';
        if (button === 3) return 'key.mouse.4';
        if (button === 4) return 'key.mouse.5';
        return 'key.keyboard.unknown';
    }

    function startRecordingKeybind(actionId) {
        keybindRecordingActionId = actionId;
        const action = keybindState.binds.find(b => b.id === actionId);
        if (!action) return;

        recorderActionTitle.textContent = `Přiřazení klávesy: ${action.label}`;
        recorderActionSubtitle.textContent = action.modName
            ? `Mód: ${action.modName}`
            : `Minecraft akce (${action.id})`;
        recorderKeyPreview.textContent = '[ Stiskni klávesu nebo tlačítko myši ]';
        modalKeybindRecorder.style.display = 'flex';

        window.addEventListener('keydown', onRecordingKeyDown, { capture: true });
        window.addEventListener('mousedown', onRecordingMouseDown, { capture: true });
    }

    function stopRecordingKeybind() {
        modalKeybindRecorder.style.display = 'none';
        keybindRecordingActionId = null;
        window.removeEventListener('keydown', onRecordingKeyDown, { capture: true });
        window.removeEventListener('mousedown', onRecordingMouseDown, { capture: true });
    }

    async function applyRecordedKey(mcKey) {
        if (!keybindRecordingActionId) return;
        const action = keybindState.binds.find(b => b.id === keybindRecordingActionId);
        if (action) {
            action.key = mcKey;
            stopRecordingKeybind();
            recalculateKeybindStats();
            renderKeyboardStage();
            renderKeybindListView();
            if (keybindSelectedKey) renderKeyInspector(keybindSelectedKey);
            await autoSaveKeybinds();
            showToast(`Klávesa ${getKeyDisplay(mcKey)} přiřazena k "${action.label}".`, 'success');
        } else {
            stopRecordingKeybind();
        }
    }

    function onRecordingKeyDown(e) {
        e.preventDefault();
        e.stopPropagation();

        if (e.code === 'Escape') {
            stopRecordingKeybind();
            return;
        }

        const mcKey = convertBrowserCodeToMcKey(e.code);
        applyRecordedKey(mcKey);
    }

    function onRecordingMouseDown(e) {
        // Zkontrolujeme zda nekliká na zrušení nebo unbind
        if (btnRecorderCancel && btnRecorderCancel.contains(e.target)) return;
        if (btnRecorderUnbind && btnRecorderUnbind.contains(e.target)) return;

        // Jinak zachytíme tlačítko myši jako bind!
        e.preventDefault();
        e.stopPropagation();

        const mcKey = convertMouseButtonToMcKey(e.button);
        applyRecordedKey(mcKey);
    }

    if (btnRecorderCancel) {
        btnRecorderCancel.addEventListener('click', stopRecordingKeybind);
    }
    if (btnRecorderUnbind) {
        btnRecorderUnbind.addEventListener('click', () => {
            applyRecordedKey('key.keyboard.unknown');
        });
    }

    // Modal switch view buttons
    if (btnKeybindToggleKeyboard) {
        btnKeybindToggleKeyboard.addEventListener('click', () => {
            btnKeybindToggleKeyboard.classList.add('active');
            btnKeybindToggleList.classList.remove('active');
            keybindKeyboardView.style.display = 'flex';
            keybindListView.style.display = 'none';
        });
    }
    if (btnKeybindToggleList) {
        btnKeybindToggleList.addEventListener('click', () => {
            btnKeybindToggleList.classList.add('active');
            btnKeybindToggleKeyboard.classList.remove('active');
            keybindKeyboardView.style.display = 'none';
            keybindListView.style.display = 'block';
            renderKeybindListView();
        });
    }

    // Category chips
    if (keybindCategoryChips) {
        keybindCategoryChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.cat-chip');
            if (!chip) return;
            keybindActiveCategory = chip.dataset.category;
            updateCategoryChipsUI();
            renderKeybindListView();
        });
    }

    // Search bar
    if (keybindSearchInput) {
        keybindSearchInput.addEventListener('input', (e) => {
            keybindSearchQuery = e.target.value;
            if (btnClearKeybindSearch) {
                btnClearKeybindSearch.style.display = keybindSearchQuery ? 'block' : 'none';
            }
            renderKeybindListView();
        });
    }
    if (btnClearKeybindSearch) {
        btnClearKeybindSearch.addEventListener('click', () => {
            keybindSearchInput.value = '';
            keybindSearchQuery = '';
            btnClearKeybindSearch.style.display = 'none';
            renderKeybindListView();
        });
    }

    // ==========================================
    // CRASH ANALYZER & AUTONOMOUS REPAIR
    // ==========================================
    const modalCrashAnalyzer = document.getElementById('modalCrashAnalyzer');
    const btnCloseCrashModal = document.getElementById('btnCloseCrashModal');
    const btnDismissCrashModal = document.getElementById('btnDismissCrashModal');
    const btnApplyCrashFix = document.getElementById('btnApplyCrashFix');
    const btnOpenCrashFullReport = document.getElementById('btnOpenCrashFullReport');

    let currentCrashData = null;
    let activeCrashFixPromise = null;
    let userAcknowledgedWhileFixing = false;

    function closeCrashModal() {
        if (modalCrashAnalyzer) modalCrashAnalyzer.style.display = 'none';
        currentCrashData = null;
    }

    if (btnCloseCrashModal) btnCloseCrashModal.addEventListener('click', closeCrashModal);
    if (btnDismissCrashModal) btnDismissCrashModal.addEventListener('click', closeCrashModal);

    if (window.api && window.api.onCrash) {
        window.api.onCrash((crashData) => {
            setHeroLaunchCelebration(false);
            if (!crashData || !modalCrashAnalyzer) return;
            if (userRequestedGameStop || crashData.isCleanShutdown || crashData.hasCrash === false) {
                console.log('[CRASH ANALYZER] Ignoruji pád – hra byla ukončena záměrně uživatelem nebo systémem.');
                return;
            }
            currentCrashData = crashData;
            activeCrashFixPromise = null;
            userAcknowledgedWhileFixing = false;

            const titleElem = document.getElementById('crashAnalyzerTitle');
            const subElem = document.getElementById('crashAnalyzerSubtitle');
            const badgeElem = document.getElementById('crashExitCodeBadge');
            const headElem = document.getElementById('crashCauseHead');
            const descElem = document.getElementById('crashCauseDesc');
            const recElem = document.getElementById('crashRecommendation');
            const logElem = document.getElementById('crashLogExcerpt');
            const fixTextElem = document.getElementById('btnApplyCrashFixText');
            const repairBanner = document.getElementById('crashAutoRepairBanner');
            const repairTitle = document.getElementById('crashAutoRepairTitle');
            const repairDesc = document.getElementById('crashAutoRepairDesc');
            const repairIcon = document.getElementById('crashAutoRepairIcon');
            const diagCard = document.getElementById('crashDiagCard');
            const modalIconSvg = document.getElementById('crashModalIconSvg');

            const isAlreadyFixed = !!(crashData.fixed || crashData.autoFixed);
            const hasActionableFix = !!(crashData.autoFix && !isAlreadyFixed);

            if (descElem) {
                descElem.textContent = crashData.description || 'Neznámá chyba.';
                descElem.style.color = '#94a3b8';
            }
            if (logElem) {
                logElem.textContent = crashData.stackExcerpt || crashData.rawLog || 'Žádné podrobnosti k dispozici.';
                logElem.style.color = '#94a3b8';
            }

            if (isAlreadyFixed) {
                if (titleElem) {
                    titleElem.textContent = crashData.title || 'Hra opravena';
                    titleElem.style.color = '#21DE00';
                }
                if (subElem) {
                    subElem.textContent = 'Automatická oprava dokončena';
                    subElem.style.color = '#94a3b8';
                }
                if (badgeElem) {
                    badgeElem.textContent = 'Opraveno';
                    badgeElem.style.background = '#21DE00';
                    badgeElem.style.color = '#0a0a0c';
                }
                if (headElem) {
                    headElem.textContent = '✓ ' + (crashData.title || 'Vyřešeno');
                    headElem.style.color = '#21DE00';
                }
                if (diagCard) {
                    diagCard.style.background = 'rgba(33, 222, 0, 0.08)';
                    diagCard.style.border = '1px solid rgba(33, 222, 0, 0.3)';
                }
                if (modalIconSvg) {
                    modalIconSvg.className = 'ui-icon-svg ui-icon-svg--lg ui-icon-svg--green';
                    modalIconSvg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                }
                if (repairBanner) {
                    repairBanner.style.display = 'flex';
                    repairBanner.style.background = 'rgba(33, 222, 0, 0.12)';
                    repairBanner.style.border = '1px solid rgba(33, 222, 0, 0.35)';
                    if (repairTitle) {
                        repairTitle.textContent = '✓ Automaticky opraveno';
                        repairTitle.style.color = '#21DE00';
                    }
                    if (repairDesc) {
                        repairDesc.textContent = crashData.recommendation || 'Opravy byly úspěšně aplikovány.';
                        repairDesc.style.color = '#94a3b8';
                    }
                    if (repairIcon) {
                        repairIcon.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                    }
                }
                if (recElem) {
                    recElem.textContent = crashData.recommendation || 'Můžeš hru ihned spustit znovu.';
                    recElem.style.color = '#21DE00';
                }
                if (typeof loadInstalledMods === 'function') {
                    loadInstalledMods();
                }
                if (btnApplyCrashFix) {
                    btnApplyCrashFix.style.display = 'inline-flex';
                    btnApplyCrashFix.className = 'mc-btn mc-btn-green';
                    if (fixTextElem) {
                        fixTextElem.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> <span>Rozumím (Spustit hru)</span>';
                    }
                }
            } else if (hasActionableFix) {
                if (titleElem) {
                    titleElem.textContent = crashData.title || 'Pád hry';
                    titleElem.style.color = '#f51515';
                }
                if (subElem) {
                    subElem.textContent = 'Automatická oprava probíhá';
                    subElem.style.color = '#94a3b8';
                }
                if (badgeElem) {
                    badgeElem.textContent = 'Opravuji...';
                    badgeElem.style.background = '#0a67e5';
                    badgeElem.style.color = '#ffffff';
                }
                if (headElem) {
                    headElem.textContent = 'Příčina: ' + (crashData.title || 'Neznámá chyba');
                    headElem.style.color = '#f51515';
                }
                if (diagCard) {
                    diagCard.style.background = 'rgba(245, 21, 21, 0.08)';
                    diagCard.style.border = '1px solid rgba(245, 21, 21, 0.25)';
                }
                if (modalIconSvg) {
                    modalIconSvg.className = 'ui-icon-svg ui-icon-svg--lg ui-icon-svg--red';
                    modalIconSvg.innerHTML = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>';
                }
                if (repairBanner) {
                    repairBanner.style.display = 'flex';
                    repairBanner.style.background = 'rgba(10, 103, 229, 0.12)';
                    repairBanner.style.border = '1px solid rgba(10, 103, 229, 0.3)';
                    if (repairTitle) {
                        repairTitle.textContent = 'Automatická oprava probíhá';
                        repairTitle.style.color = '#0a67e5';
                    }
                    if (repairDesc) {
                        repairDesc.textContent = 'Aplikuji opravy...';
                        repairDesc.style.color = '#94a3b8';
                    }
                    if (repairIcon) {
                        repairIcon.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" style="color: #0a67e5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg>';
                    }
                }
                if (recElem) {
                    recElem.textContent = crashData.recommendation || 'Probíhá automatické řešení chyby...';
                    recElem.style.color = '#0a67e5';
                }
                if (btnApplyCrashFix) {
                    btnApplyCrashFix.style.display = 'inline-flex';
                    btnApplyCrashFix.className = 'mc-btn mc-btn-secondary';
                    if (fixTextElem) {
                        fixTextElem.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Opravuji... (OK)</span>';
                    }
                }

                // Autonomously start applying the fix right now while user looks at modal
                appendLog(`[AUTOPILOT OPRAV] ⚡ Spouštím automatickou opravu v pozadí: ${crashData.autoFix.id}`);
                activeCrashFixPromise = window.api.applyCrashFix(crashData.autoFix, currentConfig.activeProfileId)
                    .then(async (res) => {
                        activeCrashFixPromise = null;
                        if (res && res.success) {
                            if (currentCrashData) {
                                currentCrashData.fixed = true;
                                currentCrashData.autoFixed = true;
                            }
                            if (titleElem) {
                                titleElem.textContent = 'Hra opravena';
                                titleElem.style.color = '#21DE00';
                            }
                            if (subElem) {
                                subElem.textContent = 'Automatická oprava dokončena';
                                subElem.style.color = '#94a3b8';
                            }
                            if (badgeElem) {
                                badgeElem.textContent = 'Opraveno';
                                badgeElem.style.background = '#21DE00';
                                badgeElem.style.color = '#0a0a0c';
                            }
                            if (headElem) {
                                headElem.textContent = '✓ Problém byl vyřešen';
                                headElem.style.color = '#21DE00';
                            }
                            if (diagCard) {
                                diagCard.style.background = 'rgba(33, 222, 0, 0.08)';
                                diagCard.style.border = '1px solid rgba(33, 222, 0, 0.3)';
                            }
                            if (modalIconSvg) {
                                modalIconSvg.className = 'ui-icon-svg ui-icon-svg--lg ui-icon-svg--green';
                                modalIconSvg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                            }
                            if (repairBanner) {
                                repairBanner.style.background = 'rgba(33, 222, 0, 0.12)';
                                repairBanner.style.border = '1px solid rgba(33, 222, 0, 0.35)';
                                if (repairTitle) {
                                    repairTitle.textContent = '✓ Automaticky opraveno';
                                    repairTitle.style.color = '#21DE00';
                                }
                                if (repairDesc) {
                                    repairDesc.textContent = res.message || 'Opravy byly úspěšně aplikovány.';
                                    repairDesc.style.color = '#94a3b8';
                                }
                                if (repairIcon) {
                                    repairIcon.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                                }
                            }
                            if (recElem) {
                                recElem.textContent = res.message || 'Hra je opravena a připravena ke spuštění.';
                                recElem.style.color = '#21DE00';
                            }
                            if (btnApplyCrashFix) {
                                btnApplyCrashFix.className = 'mc-btn mc-btn-green';
                                if (fixTextElem) {
                                    fixTextElem.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> <span>Rozumím (Spustit hru)</span>';
                                }
                            }

                            if (typeof loadInstalledMods === 'function') loadInstalledMods();
                            const updatedCfg = await window.api.getConfig();
                            if (updatedCfg) {
                                currentConfig = updatedCfg;
                                if (ramSlider && updatedCfg.ramMax) {
                                    if (ramSliderController) {
                                        ramSliderController.setValue(updatedCfg.ramMax, true);
                                    } else {
                                        ramSlider.value = updatedCfg.ramMax;
                                        updateSliderVisuals(ramSlider, ramValueBadge);
                                    }
                                }
                                if (javaPathInput && updatedCfg.javaPath) {
                                    javaPathInput.value = updatedCfg.javaPath;
                                }
                            }

                            appendLog(`[AUTOPILOT OPRAV] ${res.message}`);
                            showToast(String(res.message).replace(/^[✓⚡\s]+/u, ''), 'success');

                            if (userAcknowledgedWhileFixing) {
                                closeCrashModal();
                                setTimeout(() => {
                                    const btnLaunch = document.getElementById('btnLaunchGame');
                                    if (btnLaunch && !btnLaunch.disabled) {
                                        btnLaunch.click();
                                    }
                                }, 200);
                            }
                        } else {
                            if (repairBanner) {
                                repairBanner.style.background = 'rgba(245, 21, 21, 0.12)';
                                repairBanner.style.border = '1px solid rgba(245, 21, 21, 0.35)';
                                if (repairTitle) {
                                    repairTitle.textContent = 'Opravu se nepodařilo dokončit';
                                    repairTitle.style.color = '#f51515';
                                }
                                if (repairDesc) {
                                    repairDesc.textContent = res?.error || 'Zkontroluj podrobnosti níže nebo otevři report.';
                                    repairDesc.style.color = '#94a3b8';
                                }
                                if (repairIcon) {
                                    repairIcon.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--red" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                                }
                            }
                            if (btnApplyCrashFix) {
                                btnApplyCrashFix.className = 'mc-btn mc-btn-secondary';
                                if (fixTextElem) fixTextElem.innerHTML = '<span>Rozumím (Zavřít)</span>';
                            }
                        }
                    })
                    .catch((err) => {
                        activeCrashFixPromise = null;
                        console.error('Chyba při automatické opravě pádu v pozadí:', err);
                        if (btnApplyCrashFix) {
                            btnApplyCrashFix.className = 'mc-btn mc-btn-secondary';
                            if (fixTextElem) fixTextElem.innerHTML = '<span>Rozumím</span>';
                        }
                    });
            } else {
                if (titleElem) {
                    titleElem.textContent = crashData.title || 'Pád hry';
                    titleElem.style.color = '#f51515';
                }
                if (subElem) {
                    subElem.textContent = `Chyba při běhu (kód: ${crashData.exitCode || 1})`;
                    subElem.style.color = '#94a3b8';
                }
                if (badgeElem) {
                    badgeElem.textContent = `Kód ${crashData.exitCode || 1}`;
                    badgeElem.style.background = '#f51515';
                    badgeElem.style.color = '#ffffff';
                }
                if (headElem) {
                    headElem.textContent = `Příčina: ${crashData.title || 'Neznámá chyba'}`;
                    headElem.style.color = '#f51515';
                }
                if (recElem) {
                    recElem.textContent = crashData.recommendation || '';
                    recElem.style.color = '#0a67e5';
                }
                if (repairBanner) {
                    repairBanner.style.display = 'none';
                }
                if (btnApplyCrashFix) {
                    btnApplyCrashFix.style.display = 'inline-flex';
                    btnApplyCrashFix.className = 'mc-btn mc-btn-primary';
                    if (fixTextElem) fixTextElem.innerHTML = '<span>Rozumím</span>';
                }
            }

            if (btnOpenCrashFullReport) {
                btnOpenCrashFullReport.style.display = crashData.reportPath ? 'inline-flex' : 'none';
            }

            modalCrashAnalyzer.style.display = 'flex';
            appendLog(`[CRASH ANALYZER] ${isAlreadyFixed ? 'Automaticky vyřešeno' : 'Zjištěna příčina pádu'}: ${crashData.title}`);
        });
    }

    if (btnApplyCrashFix) {
        btnApplyCrashFix.addEventListener('click', () => {
            if (activeCrashFixPromise) {
                userAcknowledgedWhileFixing = true;
                showToast('Dokončuji opravu... Hra se za okamžik spustí.', 'info');
                closeCrashModal();
                return;
            }
            const shouldRelaunch = !!(
                currentCrashData?.fixed ||
                currentCrashData?.autoFixed ||
                currentCrashData?.autoFix?.id === 'RELAUNCH_GAME'
            );
            closeCrashModal();
            if (shouldRelaunch) {
                setTimeout(() => {
                    const btnLaunch = document.getElementById('btnLaunchGame');
                    if (btnLaunch && !btnLaunch.disabled) {
                        btnLaunch.click();
                    }
                }, 200);
            }
        });
    }

    if (btnOpenCrashFullReport) {
        btnOpenCrashFullReport.addEventListener('click', async () => {
            if (!currentCrashData || !currentCrashData.reportPath) return;
            try {
                await window.api.applyCrashFix({ id: 'OPEN_CRASH_REPORT', reportPath: currentCrashData.reportPath }, currentConfig.activeProfileId);
            } catch (e) {
                showToast('Nelze otevřít report: ' + e.message, 'error');
            }
        });
    }

    // ── Java & Cache Cleaner UI ─────────────────────────────────────────────
    const btnScanCache = document.getElementById('btnScanCache');
    const btnCleanCache = document.getElementById('btnCleanCache');
    const cacheCleanerSummary = document.getElementById('cacheCleanerSummary');

    if (btnScanCache) {
        btnScanCache.addEventListener('click', async () => {
            btnScanCache.disabled = true;
            if (cacheCleanerSummary) cacheCleanerSummary.textContent = 'Probíhá skenování disku a cache...';
            try {
                const res = await window.api.scanLauncherCache();
                if (cacheCleanerSummary) {
                    cacheCleanerSummary.textContent = `Nalezeno ${res.fileCount} souborů k vyčištění (${res.formattedSize}). Staré logy: ${res.breakdown?.logs?.formatted || '0 B'}, Dočasná data: ${res.breakdown?.temps?.formatted || '0 B'}.`;
                }
                showToast(`Analýza dokončena: ${res.formattedSize} volného místa lze uvolnit.`, 'info');
            } catch (err) {
                if (cacheCleanerSummary) cacheCleanerSummary.textContent = 'Chyba při analýze: ' + err.message;
            } finally {
                btnScanCache.disabled = false;
            }
        });
    }

    if (btnCleanCache) {
        btnCleanCache.addEventListener('click', async () => {
            btnCleanCache.disabled = true;
            if (cacheCleanerSummary) cacheCleanerSummary.textContent = 'Probíhá bezpečné promazávání starých logů a cache...';
            try {
                const res = await window.api.cleanLauncherCache();
                if (cacheCleanerSummary) {
                    cacheCleanerSummary.textContent = res.message;
                }
                showToast(res.message, 'success');
                appendLog(`[ČIŠTĚNÍ CACHE] ${res.message}`);
            } catch (err) {
                if (cacheCleanerSummary) cacheCleanerSummary.textContent = 'Chyba při čištění: ' + err.message;
                showToast('Chyba při čištění: ' + err.message, 'error');
            } finally {
                btnCleanCache.disabled = false;
            }
        });
    }

    // ── Custom Dropdown Helper ──────────────────────────────────────────────
    function setupCustomDropdown(containerId, onSelect) {
        const container = document.getElementById(containerId);
        if (!container) return null;

        const trigger = container.querySelector('.custom-dropdown-trigger');
        const selectedText = container.querySelector('.custom-dropdown-selected-text') || container.querySelector('.custom-dropdown-selected span:last-child');
        const selectedIcon = container.querySelector('.custom-dropdown-selected-icon');
        const options = container.querySelectorAll('.custom-dropdown-option');

        const closeDropdown = () => {
            container.classList.remove('open');
        };

        if (trigger) {
            trigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.custom-dropdown.open').forEach(d => {
                    if (d !== container) d.classList.remove('open');
                });
                container.classList.toggle('open');
            };
        }

        options.forEach(opt => {
            opt.onclick = (e) => {
                e.stopPropagation();
                const val = opt.dataset.value;
                const icon = opt.dataset.icon || '';
                const title = opt.querySelector('.custom-option-title')?.textContent || val;

                container.dataset.value = val;
                if (selectedText) selectedText.textContent = title;
                if (selectedIcon) {
                    const optIconEl = opt.querySelector('.custom-option-icon');
                    if (optIconEl && optIconEl.innerHTML.trim()) {
                        selectedIcon.innerHTML = optIconEl.innerHTML;
                    } else if (typeof getIconSvg === 'function' && icon) {
                        selectedIcon.innerHTML = getIconSvg(icon);
                    } else {
                        selectedIcon.innerHTML = '';
                    }
                }

                options.forEach(o => {
                    o.classList.remove('active');
                    const check = o.querySelector('.custom-option-check');
                    if (check) check.innerHTML = '';
                });
                opt.classList.add('active');
                const check = opt.querySelector('.custom-option-check');
                if (check) {
                    check.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
                }

                closeDropdown();
                if (typeof onSelect === 'function') onSelect(val);
            };
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                closeDropdown();
            }
        });

        return {
            setValue: (val) => {
                const matched = Array.from(options).find(o => o.dataset.value === val);
                if (matched) {
                    matched.click();
                }
            },
            getValue: () => container.dataset.value
        };
    }

    // ── Create Profile Modal Handlers ───────────────────────────────────────
    const modalCreateProfile = document.getElementById('modalCreateProfile');
    const btnOpenCreateProfileModal = document.getElementById('btnOpenCreateProfileModal');
    const btnCloseCreateProfileModal = document.getElementById('btnCloseCreateProfileModal');
    const btnCancelCreateProfile = document.getElementById('btnCancelCreateProfile');
    const btnConfirmCreateProfile = document.getElementById('btnConfirmCreateProfile');
    const newProfileNameInput = document.getElementById('newProfileNameInput');
    const newProfileRamSlider = document.getElementById('newProfileRamSlider');
    const newProfileRamValueBadge = document.getElementById('newProfileRamValueBadge');
    let newProfileSelectedIcon = 'sword';

    const dropdownNewVersion = setupCustomDropdown('dropdownNewProfileVersion');
    const dropdownNewLoader = setupCustomDropdown('dropdownNewProfileLoader');

    if (newProfileRamSlider && newProfileRamValueBadge) {
        newProfileRamSliderController = setupSmoothSnapSlider(newProfileRamSlider, newProfileRamValueBadge);
    }

    const iconButtons = document.querySelectorAll('#newProfileIconPicker .icon-picker-item');
    iconButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            iconButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            newProfileSelectedIcon = btn.dataset.icon || 'sword';
        });
    });

    function openCreateProfileModal() {
        if (!modalCreateProfile) return;
        const count = currentConfig.profiles?.length ? currentConfig.profiles.length + 1 : 1;
        if (newProfileNameInput) {
            newProfileNameInput.value = `Nový profil ${count}`;
        }
        if (newProfileRamSliderController) {
            newProfileRamSliderController.setValue(4, true);
        } else if (newProfileRamSlider && newProfileRamValueBadge) {
            newProfileRamSlider.value = 4;
            updateSliderVisuals(newProfileRamSlider, newProfileRamValueBadge);
        }
        dropdownNewVersion?.setValue('26.2');
        dropdownNewLoader?.setValue('vanilla');
        newProfileSelectedIcon = 'sword';
        iconButtons.forEach(b => b.classList.toggle('active', b.dataset.icon === 'sword'));
        modalCreateProfile.style.display = 'flex';
    }

    function closeCreateProfileModal() {
        if (modalCreateProfile) modalCreateProfile.style.display = 'none';
    }

    if (btnOpenCreateProfileModal) btnOpenCreateProfileModal.addEventListener('click', openCreateProfileModal);
    if (btnCloseCreateProfileModal) btnCloseCreateProfileModal.addEventListener('click', closeCreateProfileModal);
    if (btnCancelCreateProfile) btnCancelCreateProfile.addEventListener('click', closeCreateProfileModal);

    if (btnConfirmCreateProfile) {
        btnConfirmCreateProfile.addEventListener('click', async () => {
            const rawName = newProfileNameInput?.value?.trim() || '';
            if (!rawName) {
                showToast('Zadej název profilu.', 'error');
                return;
            }

            const ver = dropdownNewVersion ? dropdownNewVersion.getValue() : '26.2';
            const ldr = dropdownNewLoader ? dropdownNewLoader.getValue() : 'vanilla';
            const ram = newProfileRamSliderController ? newProfileRamSliderController.getTarget() : parseInt(newProfileRamSlider?.value || '4', 10);
            const newId = 'profile-' + Date.now();

            const newProf = {
                id: newId,
                name: rawName,
                version: ver,
                loader: ldr,
                optimizedChosen: ldr === 'fabric' ? 'optimized' : 'vanilla',
                desc: `${rawName} (${ver}${ldr !== 'vanilla' ? ' • ' + ldr : ''})`,
                icon: newProfileSelectedIcon,
                ramMax: ram,
                lastPlayed: null,
                playtimeSeconds: 0
            };

            const existing = currentConfig.profiles || [];
            currentConfig.profiles = [newProf, ...existing];
            currentConfig.activeProfileId = newId;

            await window.api.saveConfig({
                profiles: currentConfig.profiles,
                activeProfileId: newId
            });

            closeCreateProfileModal();
            renderProfilesList();
            showToast(`Profil "${rawName}" vytvořen.`, 'success');
        });
    }

    // ── Import Profile Modal Handlers ───────────────────────────────────────
    const modalImportProfile = document.getElementById('modalImportProfile');
    const btnImportProfileModalOpen = document.getElementById('btnImportProfileModalOpen');
    const btnCloseImportModal = document.getElementById('btnCloseImportModal');
    const btnCancelImport = document.getElementById('btnCancelImport');
    const btnSelectImportFolder = document.getElementById('btnSelectImportFolder');
    const importPathLabel = document.getElementById('importPathLabel');
    const scannedInstancePreview = document.getElementById('scannedInstancePreview');
    const importProfileNameInput = document.getElementById('importProfileNameInput');
    const importVersionSelect = document.getElementById('importVersionSelect');
    const importLoaderSelect = document.getElementById('importLoaderSelect');
    const scannedStatsPills = document.getElementById('scannedStatsPills');
    const btnConfirmImport = document.getElementById('btnConfirmImport');

    let currentScannedData = null;
    let discoveredProfilesCache = [];

    async function loadDiscoveredProfiles() {
        const discoveredSection = document.getElementById('discoveredProfilesSection');
        const discoveredList = document.getElementById('discoveredProfilesList');
        if (!discoveredSection || !discoveredList) return;

        discoveredSection.style.display = 'block';
        discoveredList.innerHTML = '<div style="font-size: 11.5px; color: #94a3b8; padding: 12px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Hledám nainstalované profily (.minecraft, Lunar, Prism, Modrinth...)...</div>';

        try {
            const discovered = await window.api.discoverInstalledProfiles();
            discoveredProfilesCache = discovered || [];
            if (!discovered || discovered.length === 0) {
                discoveredSection.style.display = 'none';
                return;
            }

            discoveredSection.style.display = 'block';
            discoveredList.innerHTML = discovered.map((p, idx) => `
                <div class="discovered-profile-card" data-idx="${idx}">
                    <div class="discovered-profile-top">
                        <span class="discovered-profile-name">${escapeHtml(p.name)}</span>
                        <span class="discovered-profile-badge">${escapeHtml(p.source)}</span>
                    </div>
                    <div class="discovered-profile-meta">
                        <span>Verze ${escapeHtml(p.version)}</span>
                        <span>•</span>
                        <span>${escapeHtml(p.loader.toUpperCase())}</span>
                        ${p.modCount > 0 ? `<span>•</span><span>${p.modCount} módů</span>` : ''}
                        <span>•</span>
                        <span>Naposledy: ${escapeHtml(p.lastPlayedFormatted)}</span>
                    </div>
                </div>
            `).join('');

            discoveredList.querySelectorAll('.discovered-profile-card').forEach(card => {
                card.addEventListener('click', () => {
                    discoveredList.querySelectorAll('.discovered-profile-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    const idx = Number(card.dataset.idx);
                    const p = discoveredProfilesCache[idx];
                    if (!p) return;

                    currentScannedData = {
                        originalDir: p.gameDir,
                        effectiveGameDir: p.gameDir,
                        name: p.name,
                        detectedVersion: p.version,
                        detectedLoader: p.loader,
                        modCount: p.modCount,
                        rpCount: 0,
                        hasConfig: true,
                        hasOptions: true
                    };

                    if (importPathLabel) importPathLabel.textContent = p.gameDir;
                    if (importProfileNameInput) importProfileNameInput.value = p.name;
                    if (importVersionSelect) {
                        if (['26.2', '26.3', '26.1.2', '1.21.11'].includes(p.version)) {
                            importVersionSelect.value = p.version;
                        } else {
                            importVersionSelect.value = '26.2';
                        }
                    }
                    if (importLoaderSelect) {
                        importLoaderSelect.value = p.loader || 'fabric';
                    }

                    if (scannedStatsPills) {
                        scannedStatsPills.innerHTML = `
                            <span class="stat-pill stat-good"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg> Nalezeno módů: ${p.modCount}</span>
                            <span class="stat-pill stat-good"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Zdroj: ${escapeHtml(p.source)}</span>
                            <span class="stat-pill stat-good"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Naposledy: ${escapeHtml(p.lastPlayedFormatted)}</span>
                        `;
                    }

                    if (scannedInstancePreview) scannedInstancePreview.style.display = 'block';
                    if (btnConfirmImport) btnConfirmImport.disabled = false;
                });
            });
        } catch (e) {
            console.warn('[IMPORT] Chyba při načítání nalezených profilů:', e);
            if (discoveredSection) discoveredSection.style.display = 'none';
        }
    }

    if (btnImportProfileModalOpen) {
        btnImportProfileModalOpen.addEventListener('click', () => {
            if (modalImportProfile) {
                modalImportProfile.style.display = 'flex';
                currentScannedData = null;
                if (scannedInstancePreview) scannedInstancePreview.style.display = 'none';
                if (importPathLabel) importPathLabel.textContent = 'Zatím nebyla vybrána žádná složka';
                if (btnConfirmImport) btnConfirmImport.disabled = true;
                loadDiscoveredProfiles();
            }
        });
    }

    function closeImportModal() {
        if (modalImportProfile) modalImportProfile.style.display = 'none';
        currentScannedData = null;
    }

    if (btnCloseImportModal) btnCloseImportModal.addEventListener('click', closeImportModal);
    if (btnCancelImport) btnCancelImport.addEventListener('click', closeImportModal);

    if (btnSelectImportFolder) {
        btnSelectImportFolder.addEventListener('click', async () => {
            appendLog('[IMPORT] Otevírám dialog výběru složky instance...');
            try {
                btnSelectImportFolder.disabled = true;
                const res = await window.api.importProfileDialog();
                btnSelectImportFolder.disabled = false;
                if (!res || res.canceled) {
                    appendLog('[IMPORT] Výběr složky zrušen.');
                    return;
                }

                if (res.error) {
                    showToast('Chyba při čtení složky: ' + res.error, 'error');
                    appendLog('[IMPORT] Chyba: ' + res.error);
                    return;
                }

                const scan = res.scan;
                if (!scan) return;
                currentScannedData = scan;

                if (importPathLabel) importPathLabel.textContent = scan.originalDir;
                if (importProfileNameInput) importProfileNameInput.value = scan.name;
                if (importVersionSelect) {
                    if (['26.2', '26.3', '26.1.2', '1.21.11'].includes(scan.detectedVersion)) {
                        importVersionSelect.value = scan.detectedVersion;
                    } else {
                        importVersionSelect.value = '26.2';
                    }
                }
                if (importLoaderSelect) {
                    importLoaderSelect.value = scan.detectedLoader || 'fabric';
                }

                if (scannedStatsPills) {
                    scannedStatsPills.innerHTML = `
                    <span class="stat-pill stat-good"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg> Nalezeno módů: ${scan.modCount}</span>
                    <span class="stat-pill"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/></svg> Texture packů: ${scan.rpCount}</span>
                    <span class="stat-pill ${scan.hasConfig ? 'stat-good' : ''}"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Nastavení módů: ${scan.hasConfig ? 'Ano' : 'Ne'}</span>
                    <span class="stat-pill ${scan.hasOptions ? 'stat-good' : ''}"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg> Herní options.txt: ${scan.hasOptions ? 'Ano' : 'Ne'}</span>
                `;
                }

                if (scannedInstancePreview) scannedInstancePreview.style.display = 'block';
                if (btnConfirmImport) btnConfirmImport.disabled = false;
            } catch (err) {
                btnSelectImportFolder.disabled = false;
                showToast('Chyba dialogu výběru složky: ' + err.message, 'error');
            }
        });
    }

    if (btnConfirmImport) {
        btnConfirmImport.addEventListener('click', async () => {
            if (!currentScannedData) return;
            btnConfirmImport.disabled = true;
            btnConfirmImport.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Importuji data instance...</span>';

            try {
                const importPayload = {
                    sourceDir: currentScannedData.originalDir,
                    effectiveDir: currentScannedData.effectiveGameDir,
                    name: (importProfileNameInput ? importProfileNameInput.value.trim() : '') || currentScannedData.name,
                    version: importVersionSelect ? importVersionSelect.value : '26.2',
                    loader: importLoaderSelect ? importLoaderSelect.value : 'fabric'
                };

                const res = await window.api.confirmImportProfile(importPayload);
                if (res.success) {
                    appendLog(`[IMPORT] Profil ${res.profile.name} byl importován (${res.importedModCount} módů).`);
                    closeImportModal();
                    await loadConfiguration();
                    renderProfilesList();
                    alert(`Profil byl importován (${res.importedModCount} módů).`);
                } else {
                    alert('Chyba při importu: ' + res.error);
                }
            } catch (e) {
                alert('Chyba: ' + e.message);
            } finally {
                btnConfirmImport.disabled = false;
                btnConfirmImport.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Dokončit import profilu</span>';
            }
        });
    }

    // ── Upgrade Profile Modal Handlers ───────────────────────────────────────
    const modalUpgradeProfile = document.getElementById('modalUpgradeProfile');
    const btnCloseUpgradeModal = document.getElementById('btnCloseUpgradeModal');
    const btnCancelUpgrade = document.getElementById('btnCancelUpgrade');
    const upgradeSourceProfileName = document.getElementById('upgradeSourceProfileName');
    const upgradeTargetVersionSelect = document.getElementById('upgradeTargetVersionSelect');
    const upgradeProgressArea = document.getElementById('upgradeProgressArea');
    const upgradeStatusText = document.getElementById('upgradeStatusText');
    const btnConfirmUpgrade = document.getElementById('btnConfirmUpgrade');

    // Result modal
    const modalUpgradeResult = document.getElementById('modalUpgradeResult');
    const btnCloseResultModal = document.getElementById('btnCloseResultModal');
    const btnFinishUpgradeResult = document.getElementById('btnFinishUpgradeResult');
    const upgradeResultSummaryText = document.getElementById('upgradeResultSummaryText');
    const upgradeResultModsList = document.getElementById('upgradeResultModsList');

    let activeUpgradeSourceProfileId = null;

    function openUpgradeModal(profileId) {
        if (isRunning || isLaunching) {
            showToast(isRunning ? 'Nelze provádět upgrade profilu během běhu hry.' : 'Nelze provádět upgrade během stahování / spouštění.', 'warning');
            return;
        }
        activeUpgradeSourceProfileId = profileId;
        const profile = (currentConfig.profiles || []).find(p => p.id === profileId) || currentConfig.profiles[0];

        if (upgradeSourceProfileName) {
            upgradeSourceProfileName.textContent = `Zdrojový profil: ${profile.name} (${profile.version || '26.2'})`;
        }

        if (upgradeTargetVersionSelect) {
            upgradeTargetVersionSelect.value = profile.version === '26.3' ? '26.2' : '26.3';
        }

        if (upgradeProgressArea) upgradeProgressArea.style.display = 'none';
        if (btnConfirmUpgrade) {
            btnConfirmUpgrade.disabled = false;
            btnConfirmUpgrade.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="16 12 12 8 8 12"></polyline><line x1="12" y1="16" x2="12" y2="8"></line></svg> Spustit upgrade</span>';
        }

        if (modalUpgradeProfile) modalUpgradeProfile.style.display = 'flex';
    }

    function closeUpgradeModal() {
        if (modalUpgradeProfile) modalUpgradeProfile.style.display = 'none';
        activeUpgradeSourceProfileId = null;
    }

    if (btnCloseUpgradeModal) btnCloseUpgradeModal.addEventListener('click', closeUpgradeModal);
    if (btnCancelUpgrade) btnCancelUpgrade.addEventListener('click', closeUpgradeModal);

    window.api.onUpgradeProgress((data) => {
        if (upgradeStatusText && data.status) {
            upgradeStatusText.textContent = data.status;
        }
        appendLog(`[UPGRADE] ${data.status}`);
    });

    if (btnConfirmUpgrade) {
        btnConfirmUpgrade.addEventListener('click', async () => {
            if (!activeUpgradeSourceProfileId) return;
            if (isRunning || isLaunching) {
                showToast(isRunning ? 'Nelze provádět upgrade profilu během běhu hry.' : 'Nelze provádět upgrade během stahování / spouštění.', 'warning');
                return;
            }

            const targetVer = upgradeTargetVersionSelect ? upgradeTargetVersionSelect.value : '26.3';
            btnConfirmUpgrade.disabled = true;
            btnConfirmUpgrade.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Probíhá upgrade...</span>';
            if (upgradeProgressArea) upgradeProgressArea.style.display = 'block';

            try {
                const res = await window.api.upgradeProfile(activeUpgradeSourceProfileId, targetVer);
                if (res && res.success) {
                    closeUpgradeModal();
                    await loadConfiguration();
                    renderProfilesList();

                    // Show result modal
                    if (modalUpgradeResult) {
                        if (upgradeResultSummaryText) {
                            const disabledCount = (res.disabledMods || res.missingMods || []).length;
                            upgradeResultSummaryText.innerHTML = `
                                <strong>Vytvořen nový profil:</strong> ${escapeHtml(res.profile.name)}<br>
                                <strong>Převedeno:</strong> Herní options.txt, konfigurace módů (config/) a texture packy.<br>
                                <strong>Aktualizováno:</strong> Staženo ${res.upgradedMods ? res.upgradedMods.length : 0} kompatibilních módů pro verzi ${targetVer}.<br>
                                ${disabledCount > 0 ? `<strong style="color:#f87171;">Deaktivováno:</strong> ${disabledCount} módů bylo bezpečně zakázáno (.disabled), protože pro verzi ${targetVer} zatím nevyšly.` : ''}
                            `;
                        }

                        if (upgradeResultModsList) {
                            let html = '';
                            if (res.upgradedMods && res.upgradedMods.length > 0) {
                                html += `<div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#86efac; margin-top:8px;"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Aktualizované módy (${res.upgradedMods.length}):</div>`;
                                html += res.upgradedMods.map(m => `
                                    <div class="result-mod-tag" style="display:flex; align-items:center; gap:6px; background:#132a1e; color:#86efac;">
                                        <svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(m.newFile || m.oldFile)} (v${escapeHtml(m.version || 'nová')})
                                    </div>
                                `).join('');
                            }

                            const disabledList = res.disabledMods || (res.missingMods ? res.missingMods.map(m => ({ name: m, file: m })) : []);
                            if (disabledList && disabledList.length > 0) {
                                html += `<div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#f87171; margin-top:12px;"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Zakázané módy – nepodporují verzi ${escapeHtml(targetVer)} (${disabledList.length}):</div>`;
                                html += `<div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Tyto módy byly v novém profilu automaticky deaktivovány (.disabled), aby hra nespadla:</div>`;
                                html += disabledList.map(m => {
                                    const modTitle = typeof m === 'object' ? (m.name || m.file) : m;
                                    return `
                                    <div class="result-mod-tag" style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#291415; border:1px solid rgba(248,113,113,0.25); color:#fca5a5; padding:6px 10px; border-radius:6px; margin-bottom:4px;">
                                        <div style="display:flex; align-items:center; gap:6px; font-weight:600;">
                                            <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                                            ${escapeHtml(modTitle)}
                                        </div>
                                        <span style="font-size:11px; opacity:0.85; font-weight:400;">(Zakázán • čeká na aktualizaci pro ${escapeHtml(targetVer)})</span>
                                    </div>
                                    `;
                                }).join('');
                            }
                            upgradeResultModsList.innerHTML = html;
                        }

                        modalUpgradeResult.style.display = 'flex';
                    }
                } else {
                    alert('Chyba při upgradu: ' + (res ? res.error : 'Neznámá chyba'));
                }
            } catch (e) {
                alert('Chyba při upgradu: ' + e.message);
            } finally {
                btnConfirmUpgrade.disabled = false;
                btnConfirmUpgrade.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="16 12 12 8 8 12"></polyline><line x1="12" y1="16" x2="12" y2="8"></line></svg> Spustit upgrade</span>';
            }
        });
    }

    function closeResultModal() {
        if (modalUpgradeResult) modalUpgradeResult.style.display = 'none';
    }
    if (btnCloseResultModal) btnCloseResultModal.addEventListener('click', closeResultModal);
    if (btnFinishUpgradeResult) btnFinishUpgradeResult.addEventListener('click', closeResultModal);

    // ── Profile Settings Modal Handlers ─────────────────────────────────────
    let activeSettingsProfileId = null;
    const modalProfileSettings = document.getElementById('modalProfileSettings');
    const btnCloseProfileSettingsModal = document.getElementById('btnCloseProfileSettingsModal');
    const btnCancelProfileSettings = document.getElementById('btnCancelProfileSettings');
    const btnSaveProfileSettings = document.getElementById('btnSaveProfileSettings');
    const profileRamSlider = document.getElementById('profileRamSlider');
    const profileRamValueBadge = document.getElementById('profileRamValueBadge');
    const btnDeleteCurrentProfile = document.getElementById('btnDeleteCurrentProfile');

    if (profileRamSlider && profileRamValueBadge) {
        profileRamSliderController = setupSmoothSnapSlider(profileRamSlider, profileRamValueBadge);
    }

    function openProfileSettingsModal(pid) {
        const profile = (currentConfig.profiles || []).find(p => p.id === pid) || currentConfig.profiles[0];
        if (!profile) return;
        activeSettingsProfileId = pid;

        const isImported = Boolean(
            profile.isImported ||
            (profile.id && profile.id.startsWith('imported-')) ||
            profile.icon === 'import' ||
            (profile.desc && profile.desc.includes('Importováno')) ||
            (profile.gameDir && (profile.gameDir.includes('instances') || profile.gameDir.includes('profiles')) && profile.id.includes('import'))
        );

        const titleEl = document.getElementById('profileSettingsModalTitle');
        const nameInput = document.getElementById('profileSettingsNameInput');
        const loaderSelect = document.getElementById('profileSettingsLoaderSelect');
        const deleteSec = document.getElementById('profileDeleteSection');
        const loaderCardsContainer = document.getElementById('loaderCardsContainer');
        const importedLoaderNotice = document.getElementById('profileImportedLoaderNotice');
        const importedLoaderLabel = document.getElementById('profileImportedLoaderLabel');
        const quickOptBanner = document.getElementById('profileQuickOptBanner');

        // Banner optimalizace ve výchozím stavu schováme, aby nezpůsoboval žádný UI šum
        if (quickOptBanner) quickOptBanner.style.display = 'none';

        if (titleEl) titleEl.textContent = `Nastavení profilu: ${profile.name}`;
        if (nameInput) nameInput.value = profile.name;

        const curLoader = profile.loader || 'fabric';
        if (loaderSelect) loaderSelect.value = curLoader;

        // U importovaných profilů nezobrazujeme přepínač loaderů (Fabric/Vanilla/NeoForge/Forge),
        // ale pouze čistou uzamčenou informaci o stávajícím zavaděči
        if (isImported) {
            if (loaderCardsContainer) loaderCardsContainer.style.display = 'none';
            if (importedLoaderNotice) {
                importedLoaderNotice.style.display = 'flex';
                if (importedLoaderLabel) {
                    const loaderNames = {
                        fabric: 'Fabric',
                        vanilla: 'Vanilla',
                        neoforge: 'NeoForge',
                        forge: 'Forge',
                        quilt: 'Quilt'
                    };
                    importedLoaderLabel.textContent = loaderNames[curLoader.toLowerCase()] || curLoader;
                }
            }
        } else {
            if (loaderCardsContainer) loaderCardsContainer.style.display = 'grid';
            if (importedLoaderNotice) importedLoaderNotice.style.display = 'none';

            // Synchronizace vizuálních karet loaderů
            document.querySelectorAll('#loaderCardsContainer .loader-card').forEach(card => {
                if (card.dataset.loader === curLoader) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            });
        }

        const pRam = profile.ramMax || currentConfig.ramMax || 4;
        if (profileRamSliderController) {
            profileRamSliderController.setValue(pRam, true);
        } else if (profileRamSlider && profileRamValueBadge) {
            profileRamSlider.value = pRam;
            updateSliderVisuals(profileRamSlider, profileRamValueBadge);
        }

        if (deleteSec) {
            deleteSec.style.display = ((currentConfig.profiles || []).length <= 1) ? 'none' : 'flex';
        }

        const upgradeBanner = document.getElementById('profileQuickUpgradeBanner');
        const v = String(profile.version || '').trim().toLowerCase();
        const canUpgrade = v && !v.includes('26.3') && !v.includes('26.4') && v !== 'latest';
        if (upgradeBanner) {
            if (canUpgrade) {
                upgradeBanner.style.display = 'flex';
                const bannerTitle = document.getElementById('profileUpgradeBannerTitle');
                const bannerDesc = document.getElementById('profileUpgradeBannerDesc');
                if (bannerTitle) bannerTitle.textContent = `Dostupný upgrade (Verze ${profile.version || 'starší'})`;
                if (bannerDesc) bannerDesc.textContent = `Tento profil běží na starší verzi Minecraftu. Můžeš ho jedním kliknutím upgradovat na novější doporučenou verzi a stáhnout kompatibilní módy.`;
            } else {
                upgradeBanner.style.display = 'none';
            }
        }

        if (modalProfileSettings) modalProfileSettings.style.display = 'flex';

        // Kontrola optimalizace: Pokud už profil Sodium/Lithium má (nebo jde o importovaný profil),
        // banner vůbec nezobrazujeme (žádný text "Optimalizováno" ani zelený pruh v UI).
        // Zobrazí se výhradně tehdy, pokud profil optimalizovaný NENÍ a lze ho optimalizovat.
        (async () => {
            try {
                if (isImported) {
                    if (quickOptBanner) quickOptBanner.style.display = 'none';
                    return;
                }

                const optStatus = await window.api.checkOptimizationStatus(pid);
                const isAlreadyOptimized = Boolean(optStatus && (optStatus.hasSodium || optStatus.hasLithium));

                if (isAlreadyOptimized) {
                    // Už je to optimalizováno -> schovat banner, žádný UI šum!
                    if (quickOptBanner) quickOptBanner.style.display = 'none';
                } else {
                    // Profil ještě není optimalizován -> nabídnout 1-klik optimalizaci
                    if (quickOptBanner) quickOptBanner.style.display = 'flex';
                    const btnApplyOpt = document.getElementById('btnApplyProfileOptimization');
                    const profileQuickOptDesc = document.getElementById('profileQuickOptDesc');
                    if (btnApplyOpt) {
                        btnApplyOpt.innerHTML = '<span>⚡ Optimalizovat</span>';
                        btnApplyOpt.classList.remove('btn-opt-done');
                        btnApplyOpt.classList.add('mc-btn-green');
                        btnApplyOpt.title = 'Nainstaluje doporučené optimalizační módy';
                    }
                    if (profileQuickOptDesc) {
                        profileQuickOptDesc.textContent = 'Nainstaluje Sodium, Lithium a Iris pro maximální FPS a plynulost.';
                    }
                }
            } catch (e) {
                console.warn('Nelze ověřit stav optimalizace:', e);
                if (quickOptBanner) quickOptBanner.style.display = 'none';
            }
        })();
    }

    // Interaktivní klikání na karty loaderu v nastavení profilu
    document.querySelectorAll('#loaderCardsContainer .loader-card').forEach(card => {
        card.addEventListener('click', () => {
            const ldr = card.dataset.loader;
            document.querySelectorAll('#loaderCardsContainer .loader-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const loaderSelect = document.getElementById('profileSettingsLoaderSelect');
            if (loaderSelect) loaderSelect.value = ldr;
        });
    });

    // Tlačítko pro aplikaci doporučené optimalizace v nastavení profilu
    const btnApplyOpt = document.getElementById('btnApplyProfileOptimization');
    if (btnApplyOpt) {
        btnApplyOpt.addEventListener('click', async () => {
            if (!activeSettingsProfileId) return;
            const quickOptBanner = document.getElementById('profileQuickOptBanner');
            btnApplyOpt.disabled = true;
            btnApplyOpt.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Optimalizuji...</span>';
            try {
                const res = await window.api.applyProfileOptimization(activeSettingsProfileId);
                if (res && res.success) {
                    showToast('Profil byl úspěšně optimalizován.', 'success');
                    const loaderSelect = document.getElementById('profileSettingsLoaderSelect');
                    if (loaderSelect) loaderSelect.value = 'fabric';
                    document.querySelectorAll('#loaderCardsContainer .loader-card').forEach(c => {
                        if (c.dataset.loader === 'fabric') c.classList.add('active');
                        else c.classList.remove('active');
                    });
                    // Po úspěšné optimalizaci banner okamžitě schováme (žádný zbytečný UI šum "Optimalizováno")
                    if (quickOptBanner) quickOptBanner.style.display = 'none';
                } else {
                    showToast(res?.error || 'Optimalizace selhala.', 'error');
                    btnApplyOpt.innerHTML = '<span>⚡ Optimalizovat</span>';
                }
            } catch (e) {
                showToast('Chyba: ' + e.message, 'error');
                btnApplyOpt.innerHTML = '<span>⚡ Optimalizovat</span>';
            } finally {
                btnApplyOpt.disabled = false;
                await loadConfiguration();
                renderProfilesList();
            }
        });
    }

    function closeProfileSettingsModal() {
        if (modalProfileSettings) modalProfileSettings.style.display = 'none';
        const quickOptBanner = document.getElementById('profileQuickOptBanner');
        if (quickOptBanner) quickOptBanner.style.display = 'none';
        activeSettingsProfileId = null;
    }

    if (btnCloseProfileSettingsModal) btnCloseProfileSettingsModal.addEventListener('click', closeProfileSettingsModal);
    if (btnCancelProfileSettings) btnCancelProfileSettings.addEventListener('click', closeProfileSettingsModal);

    // Quick profile subfolders
    document.querySelectorAll('.btn-open-profile-subfolder').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!activeSettingsProfileId) return;
            const sub = btn.dataset.subfolder || '';
            await window.api.openProfileFolder(activeSettingsProfileId, sub);
        });
    });

    if (btnSaveProfileSettings) {
        btnSaveProfileSettings.addEventListener('click', async () => {
            if (!activeSettingsProfileId) return;
            const profile = (currentConfig.profiles || []).find(p => p.id === activeSettingsProfileId);
            const isImported = Boolean(
                profile && (
                    profile.isImported ||
                    (profile.id && profile.id.startsWith('imported-')) ||
                    profile.icon === 'import' ||
                    (profile.desc && profile.desc.includes('Importováno')) ||
                    (profile.gameDir && (profile.gameDir.includes('instances') || profile.gameDir.includes('profiles')) && profile.id.includes('import'))
                )
            );

            const nameInput = document.getElementById('profileSettingsNameInput');
            const loaderSelect = document.getElementById('profileSettingsLoaderSelect');
            const newName = nameInput ? nameInput.value.trim() : '';
            const newRam = profileRamSliderController ? profileRamSliderController.getTarget() : (profileRamSlider ? parseInt(profileRamSlider.value, 10) : 4);
            // U importovaných profilů se zavaděč nemění ani nepřepisuje
            const newLoader = isImported ? ((profile && profile.loader) || 'fabric') : (loaderSelect ? loaderSelect.value : 'fabric');

            await window.api.updateProfileSettings(activeSettingsProfileId, {
                name: newName || 'Profil',
                ramMax: newRam,
                loader: newLoader
            });

            showToast('Nastavení profilu uloženo.', 'success');
            closeProfileSettingsModal();
            await loadConfiguration();
            renderProfilesList();
        });
    }

    if (btnDeleteCurrentProfile) {
        btnDeleteCurrentProfile.addEventListener('click', async () => {
            if (!activeSettingsProfileId) return;
            const profile = (currentConfig.profiles || []).find(p => p.id === activeSettingsProfileId);
            const pName = profile ? profile.name : activeSettingsProfileId;
            if ((currentConfig.profiles || []).length <= 1) {
                showToast('V launcheru musí zůstat alespoň jeden profil.', 'warning');
                return;
            }
            if (isRunning && runningProfileId === activeSettingsProfileId) {
                showToast('Nelze smazat profil, který právě běží. Nejprve ukonči hru.', 'warning');
                return;
            }
            if (isLaunching && launchingProfileId === activeSettingsProfileId) {
                showToast('Nelze smazat profil během stahování nebo spouštění.', 'warning');
                return;
            }
            if (!confirm(`Opravdu chceš smazat a odinstalovat profil "${pName}"?\n\nTato akce profil trvale odstraní a odinstaluje soubory verze, které nepoužívá žádný jiný profil.`)) return;

            btnDeleteCurrentProfile.disabled = true;
            const origHtml = btnDeleteCurrentProfile.innerHTML;
            btnDeleteCurrentProfile.innerHTML = '<span>Probíhá mazání...</span>';

            try {
                const targetId = activeSettingsProfileId;
                const res = await window.api.deleteProfile(targetId);
                if (res && res.success) {
                    showToast(`Profil "${pName}" byl smazán a odinstalován.`, 'success');
                    // Okamžité pročištění profilu z paměti v rendereru
                    currentConfig.profiles = (currentConfig.profiles || []).filter(p => p.id !== targetId);
                    if (currentConfig.activeProfileId === targetId) {
                        currentConfig.activeProfileId = res.activeProfileId || currentConfig.profiles[0]?.id || 'minecraft-26.2';
                        hasUserManuallySelectedProfile = false;
                    }
                    closeProfileSettingsModal();
                    await loadConfiguration();
                    renderProfilesList();
                } else {
                    showToast(res?.error || 'Profil se nepodařilo smazat.', 'error');
                    btnDeleteCurrentProfile.disabled = false;
                    btnDeleteCurrentProfile.innerHTML = origHtml;
                }
            } catch (err) {
                showToast('Chyba při mazání profilu: ' + err.message, 'error');
                btnDeleteCurrentProfile.disabled = false;
                btnDeleteCurrentProfile.innerHTML = origHtml;
            }
        });
    }

    const btnModalUpgradeProfile = document.getElementById('btnModalUpgradeProfile');
    if (btnModalUpgradeProfile) {
        btnModalUpgradeProfile.addEventListener('click', () => {
            if (!activeSettingsProfileId) return;
            const targetId = activeSettingsProfileId;
            closeProfileSettingsModal();
            openUpgradeModal(targetId);
        });
    }

    // ── Danger Zone: Reset Launcher Data ────────────────────────────────────
    const btnResetLauncherData = document.getElementById('btnResetLauncherData');
    if (btnResetLauncherData) {
        btnResetLauncherData.addEventListener('click', async () => {
            const confirmReset = confirm(
                'VAROVÁNÍ: Opravdu chceš smazat veškerá data launcheru?\n\n' +
                'Tato akce vymaže všechny stažené verze, instance, konfigurace a vrátí launcher do výchozího stavu.'
            );
            if (!confirmReset) return;

            btnResetLauncherData.disabled = true;
            btnResetLauncherData.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Probíhá mazání dat...</span>';
            appendLog('[RESET] Zahájeno mazání dat launcheru...');

            try {
                const res = await window.api.resetLauncherData();
                if (res && res.success) {
                    showToast('Data launcheru byla smazána a launcher resetován.', 'success');
                    appendLog('[RESET] Tovární reset launcheru dokončen.');
                    setTimeout(async () => {
                        await loadConfiguration();
                        renderProfilesList();
                        alert('Data launcheru byla smazána.');
                    }, 500);
                } else {
                    alert('Chyba při mazání dat: ' + (res.error || 'Neznámá chyba'));
                }
            } catch (e) {
                alert('Chyba: ' + e.message);
            } finally {
                btnResetLauncherData.disabled = false;
                btnResetLauncherData.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--red" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> <span>Smazat data launcheru</span>';
            }
        });
    }

    // ── Toast System ────────────────────────────────────────────────────────
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast-message ${type === 'error' ? 'toast-error' : type === 'info' ? 'toast-info' : ''}`;

        let iconSvg = '';
        if (type === 'error') {
            iconSvg = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--red" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        } else if (type === 'success') {
            iconSvg = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        } else {
            iconSvg = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        }

        // Strip any leading emoji remnants if passed dynamically
        const cleanMessage = String(message).replace(/^[✓⚠️ℹ️🚀🎮🧹📌❌⚡🟢🟡⚪⏳⬇▶]+\s*/gu, '');

        toast.innerHTML = `
            <span class="toast-icon">${iconSvg}</span>
            <span class="toast-text">${escapeHtml(cleanMessage)}</span>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 4000);
    }

    // ── Time Formatter (Real Timestamps & Steam-style Playtime) ─────────────
    function formatPlaytime(seconds) {
        if (!seconds || seconds < 60) return '0 min';
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins} min`;
        const hours = (seconds / 3600).toFixed(1);
        const cleanHours = hours.endsWith('.0') ? parseInt(hours, 10) : hours;
        return `${cleanHours} hod`;
    }

    function formatLastPlayed(timestamp) {
        if (!timestamp) return 'Zatím nehráno';
        const num = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
        if (isNaN(num)) return 'Zatím nehráno';
        const diff = Date.now() - num;
        if (diff < 60000) return 'Právě teď';
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `Před ${mins} min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `Před ${hours} h`;
        const days = Math.floor(hours / 24);
        if (days === 1) return 'Včera';
        if (days < 7) return `Před ${days} dny`;
        const d = new Date(num);
        return `${d.getDate()}.${d.getMonth() + 1}.`;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    function temporaryButtonText(btn, tempHtml, duration = 2000) {
        if (!btn) return;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = tempHtml;
        setTimeout(() => {
            btn.innerHTML = originalHtml;
        }, duration);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Initialize
    await loadConfiguration();

    // Ujistíme se, že okno, 3D model i stav sítě jsou po startu v aktivním stavu
    setTimeout(() => {
        resumeLauncherBackgroundActivity();
    }, 150);
});
