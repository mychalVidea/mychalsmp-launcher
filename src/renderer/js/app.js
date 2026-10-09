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
    const btnEditNickFromHero = document.getElementById('btnEditNickFromHero');
    const btnManageProfiles = document.getElementById('btnManageProfiles');
    const btnAddModsShortcut = document.getElementById('btnAddModsShortcut');

    // Progress Bar
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressText = document.getElementById('progressText');

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
    const javaPathInput = document.getElementById('javaPathInput');
    const btnDetectJava = document.getElementById('btnDetectJava');
    const javaDetectedList = document.getElementById('javaDetectedList');
    const autoConnectCheck = document.getElementById('autoConnectCheck');
    const btnOpenGameDir = document.getElementById('btnOpenGameDir');
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    const consoleOutput = document.getElementById('consoleOutput');
    const btnClearLog = document.getElementById('btnClearLog');

    // State
    let currentConfig = {};
    let installedVersions = [];
    let isLaunching = false;
    let isRunning = false;
    let currentModFilter = {
        query: '',
        version: '26.2',
        loader: 'fabric',
        category: '',
        projectType: 'mod'
    };

    // ── Window Controls ─────────────────────────────────────────────────────
    if (btnMin) btnMin.addEventListener('click', () => window.api.minimizeWindow());
    if (btnMax) btnMax.addEventListener('click', () => window.api.maximizeWindow());
    if (btnClose) btnClose.addEventListener('click', () => window.api.closeWindow());

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
                heroSkinViewer.setSize(160, 220);
                scheduleHeroReturn();
            } else {
                cancelHeroReturn();
            }
        }
        if (skinViewer) {
            skinViewer.renderPaused = (tabId !== 'character');
            if (tabId === 'character') {
                skinViewer.setSize(220, 310);
            }
        }
    }

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    if (btnEditNickFromHero) {
        btnEditNickFromHero.addEventListener('click', () => switchTab('character'));
    }
    if (btnManageProfiles) {
        btnManageProfiles.addEventListener('click', () => switchTab('mods'));
    }
    if (btnAddModsShortcut) {
        btnAddModsShortcut.addEventListener('click', () => switchTab('mods'));
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

    updateNetworkStatus();
    setInterval(updateNetworkStatus, 15000);

    // ── Configuration Loader ────────────────────────────────────────────────
    async function loadConfiguration() {
        try {
            currentConfig = await window.api.getConfig();
            installedVersions = await window.api.getInstalledVersions();

            // Automatické pročištění starého defaultního canvas pláště z konfigurace
            if (currentConfig && currentConfig.customCapePath && (
                currentConfig.customCapePath.startsWith('data:image') ||
                currentConfig.customCapePath === 'default' ||
                currentConfig.customCapePath === 'none'
            )) {
                currentConfig.customCapePath = null;
                window.api.saveOfflineSkin({ capePath: null }).catch(() => {});
            }

            // Profile info
            const isMs = currentConfig.authType === 'microsoft';
            const name = isMs
                ? (currentConfig.microsoftAccount?.username || currentConfig.username || 'Steve')
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

                renderRamSliderMarks(maxRam);

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
                            ramSlider.value = sysInfo.recommendedRamGB;
                            ramValueBadge.textContent = `${sysInfo.recommendedRamGB} GB`;
                            currentConfig.ramMax = sysInfo.recommendedRamGB;
                            autoSaveSettings(true);
                            showToast(`Nastavena optimální paměť: ${sysInfo.recommendedRamGB} GB RAM`, 'success');
                        }
                    };
                }

                // Auto-Detekce dedikované grafiky (Windows i Linux)
                const gpuNameText = document.getElementById('gpuNameText');
                const gpuDedicatedBadge = document.getElementById('gpuDedicatedBadge');
                if (gpuNameText) {
                    gpuNameText.textContent = sysInfo?.gpuName || 'Standardní grafický adaptér';
                }
                if (gpuDedicatedBadge) {
                    gpuDedicatedBadge.style.display = sysInfo?.isDedicatedGpu ? 'inline-block' : 'none';
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
                ramSlider.value = currentConfig.ramMax;
                ramValueBadge.textContent = `${currentConfig.ramMax} GB`;
            }

            // Java
            if (javaPathInput && currentConfig.javaPath) {
                javaPathInput.value = currentConfig.javaPath;
            }

            // Auto connect
            if (autoConnectCheck) {
                autoConnectCheck.checked = currentConfig.autoConnectServer === true;
            }

            // Resolution
            if (currentConfig.resolution) {
                const resVal = currentConfig.resolution.fullscreen
                    ? 'fullscreen'
                    : `${currentConfig.resolution.width}x${currentConfig.resolution.height}`;
                const radio = document.querySelector(`input[name="res"][value="${resVal}"]`);
                if (radio) radio.checked = true;
            }

            // Linux & Wayland Performance Settings
            const checkGameMode = document.getElementById('checkGameMode');
            if (checkGameMode) checkGameMode.checked = currentConfig.enableGameMode !== false;

            const checkDiscreteGpu = document.getElementById('checkDiscreteGpu');
            if (checkDiscreteGpu) checkDiscreteGpu.checked = currentConfig.enableDiscreteGpu !== false;

            const checkMangoHud = document.getElementById('checkMangoHud');
            if (checkMangoHud) checkMangoHud.checked = !!currentConfig.enableMangoHud;

            const checkZink = document.getElementById('checkZink');
            if (checkZink) checkZink.checked = !!currentConfig.enableZink;

            const checkDisableVsync = document.getElementById('checkDisableVsync');
            if (checkDisableVsync) checkDisableVsync.checked = !!currentConfig.disableVsync;

            const checkNativeWayland = document.getElementById('checkNativeWayland');
            if (checkNativeWayland) checkNativeWayland.checked = !!currentConfig.enableNativeWayland;

            const checkDiscordRpc = document.getElementById('checkDiscordRpc');
            if (checkDiscordRpc) checkDiscordRpc.checked = currentConfig.enableDiscordRpc !== false;

            const jvmArgsInput = document.getElementById('jvmArgsInput');
            if (jvmArgsInput) jvmArgsInput.value = currentConfig.customJvmArgs || '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions -XX:+AlwaysPreTouch -XX:+DisableExplicitGC';

            const customEnvVarsInput = document.getElementById('customEnvVarsInput');
            if (customEnvVarsInput) customEnvVarsInput.value = currentConfig.customEnvVars || '';

            // Render Server Tracker & Profiles
            renderServerTracker();
            pingCustomServersInBackground();
            renderProfilesList();
            refreshVersionStatuses();
            detectAvailableJavas();
            checkWardenProbe();
            checkLauncherUpdates(true);
        } catch (e) {
            console.error('Chyba při načítání konfigurace:', e);
        }
    }

    function renderRamSliderMarks(maxGb) {
        const marksContainer = document.getElementById('ramSliderMarks') || document.querySelector('.slider-marks');
        if (!marksContainer) return;
        const min = 2;
        const max = maxGb || 16;

        // Clean landmarks within [min, max]
        const candidates = [4, 8, 16, 24, 32, 48, 64];
        const points = [min];

        candidates.forEach(c => {
            if (c > min && c < max) {
                if (max - c >= 3) {
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
            const isRec = (val === 4);

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

            return `<span class="slider-mark ${extraClass}" style="left: ${pct.toFixed(2)}%;" data-ram-val="${val}" title="${isRec ? 'Doporučeno pro většinu modpacků' : `Nastavit ${val} GB`}">${label}</span>`;
        }).join('');

        marksContainer.querySelectorAll('.slider-mark').forEach(mark => {
            mark.addEventListener('click', () => {
                const val = parseInt(mark.dataset.ramVal, 10);
                if (!isNaN(val) && ramSlider) {
                    ramSlider.value = val;
                    if (ramValueBadge) ramValueBadge.textContent = `${val} GB`;
                    autoSaveSettings(true);
                }
            });
        });
    }

    function updateUserUI(name, type, customSkin) {
        const isMicrosoft = type === 'microsoft';
        const displayName = isMicrosoft
            ? (currentConfig.microsoftAccount?.username || name || 'Steve')
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
        const badgePill = document.getElementById('skinAccountTypeBadge');
        const skinPathLabel = document.getElementById('offlineSkinPathLabel');
        const capePathLabel = document.getElementById('offlineCapePathLabel');

        if (isMicrosoft) {
            authMicrosoftBtn?.classList.add('active');
            authOfflineBtn?.classList.remove('active');
            if (panelMs) panelMs.style.display = 'flex';
            if (panelOff) panelOff.style.display = 'none';
            if (badgePill) {
                badgePill.innerHTML = '<span class="status-dot online"></span> Microsoft Účet';
                badgePill.className = 'skin-badge-pill pill-microsoft';
            }
            loadMojangCapes();
        } else {
            authOfflineBtn?.classList.add('active');
            authMicrosoftBtn?.classList.remove('active');
            if (panelMs) panelMs.style.display = 'none';
            if (panelOff) panelOff.style.display = 'flex';
            if (badgePill) {
                badgePill.innerHTML = '<span class="status-dot" style="background:#eab308; box-shadow:0 0 6px rgba(234,179,8,0.5);"></span> Offline Profil (Uloženo lokálně)';
                badgePill.className = 'skin-badge-pill';
            }
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
        const avatarUrl = `https://minotar.net/avatar/${encodeURIComponent(displayName)}/24.png`;

        if (greetingAvatar) greetingAvatar.src = avatarUrl;
        if (skinCaption) skinCaption.textContent = `3D Náhled: ${displayName}`;

        const effectiveCape = getEffectiveCape();

        const skinSrc = effectiveSkin
            ? ((effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://')) ? effectiveSkin : `file://${effectiveSkin}`)
            : `https://minotar.net/skin/${encodeURIComponent(displayName)}`;

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

            const versions = ['26.2', '26.3', '26.1.2'];
            for (const ver of versions) {
                const idSuffix = ver.replace(/\./g, '');
                const card = document.getElementById(`vCard${idSuffix}`);
                const statusBadge = document.getElementById(`vStatus${idSuffix}`);
                const btnAction = document.getElementById(`btnAction${idSuffix}`);
                const btnStop = document.getElementById(`btnStop${idSuffix}`);
                const progressBox = document.getElementById(`vProgressBox${idSuffix}`);
                const isInstalled = installedVersions.includes(ver);
                const isThisRunning = isRunning && activeVersion === ver;
                const isThisLaunching = isLaunching && activeVersion === ver;

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
                        label.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-pulse" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Spuštěno';
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
                            btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Načítání hry...</span>`;
                        } else if (isInstalled) {
                            btnAction.disabled = false;
                            btnAction.innerHTML = `<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát Minecraft ${ver}</span>`;
                        } else {
                            btnAction.disabled = false;
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
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (b.lastJoined || 0) - (a.lastJoined || 0);
        });
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
                        <div class="item-name">${escapeHtml(s.name)}</div>
                        <div class="item-ip">${escapeHtml(s.ip)}</div>
                    </div>
                    <div class="tracked-server-actions">
                        <button class="btn-quick-join" data-server="${escapeHtml(s.ip)}" title="Připojit se">
                            <svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span>Join</span>
                        </button>
                        ${!isMychal ? `<button class="btn-del-server" data-server-id="${escapeHtml(s.id)}" title="Odstranit server"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Bind quick join buttons
        trackedServersList.querySelectorAll('.btn-quick-join').forEach(btn => {
            btn.addEventListener('click', () => {
                const srv = btn.dataset.server;
                startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', srv);
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
                        </div>
                        <div class="server-full-ip">${escapeHtml(s.ip)}</div>
                    </div>
                    <div class="server-full-actions">
                        <button class="btn-quick-join btn-quick-join--lg" data-server="${escapeHtml(s.ip)}" title="Připojit se na server">
                            <svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span>Join</span>
                        </button>
                        ${!isMychal ? `<button class="btn-del-server btn-del-server--lg" data-server-id="${escapeHtml(s.id)}" title="Odstranit server"><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--red" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Bind quick join buttons
        fullList.querySelectorAll('.btn-quick-join').forEach(btn => {
            btn.addEventListener('click', () => {
                const srv = btn.dataset.server;
                startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', srv);
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
            showToast(target.pinned ? `Server "${target.name}" byl připnut nahoru!` : `Server "${target.name}" byl odepnut.`, 'info');
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
                showToast('Zadej prosím IP adresu nebo doménu serveru.', 'error');
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
                lastJoined: Date.now()
            };

            const existing = currentConfig.servers || [];
            currentConfig.servers = [...existing, newServer];
            await window.api.saveConfig({ servers: currentConfig.servers });

            closeAddServerModal();
            renderServerTracker();
            renderServersFullTab();
            showToast(`Server "${rawName}" byl úspěšně přidán${isPinned ? ' a připnut' : ''}!`, 'success');
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
            closeWardenModal();
            appendLog('[PROFIL] Spouštím hru bez připojení k serveru MYCHAL SMP (módy povoleny pro singleplayer a jiné servery)...');
            showToast('Spouštím hru bez připojení k SMP – módy povoleny.', 'info');
            startLaunch(currentConfig.activeProfileId, null);
        });
    }

    const btnCleanIllegalMods = document.getElementById('btnCleanIllegalMods');
    if (btnCleanIllegalMods) {
        btnCleanIllegalMods.addEventListener('click', async () => {
            btnCleanIllegalMods.disabled = true;
            btnCleanIllegalMods.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Zakazuji módy...</span>';
            try {
                const res = await window.api.disableIllegalMods(currentConfig.activeProfileId, null);
                showToast(`Všechny nepovolené módy (${res.disabledCount}) byly přejmenovány na .disabled!`, 'success');
                appendLog(`Zakázáno ${res.disabledCount} nepovolených módů z profilu.`);
                closeWardenModal();
                await checkWardenProbe();
            } catch (e) {
                showToast('Chyba: ' + e.message, 'error');
            } finally {
                btnCleanIllegalMods.disabled = false;
                btnCleanIllegalMods.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg> Zakázat tyto módy a odemknout Quick Play</span>';
            }
        });
    }

    // ── Quick Play MYCHAL SMP Banner ────────────────────────────────────────
    if (btnQuickPlayMychal) {
        btnQuickPlayMychal.addEventListener('click', async () => {
            if (currentIllegalMods.length > 0) {
                showToast('Quick Play zablokován: Nalezeny nepovolené módy v profilu!', 'error');
                openWardenModal();
                return;
            }
            startLaunch('minecraft-26.2', 'mychalsmp.xyz');
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
                    showToast('Launcher je aktuální (verze v' + (update.currentVersion || '1.0.4') + ')', 'info');
                }
            }
        } catch (e) {
            console.error('[AUTO-UPDATE] Kontrola aktualizací selhala:', e);
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
                const pct = data.percent || 0;
                if (updateProgressBar) updateProgressBar.style.width = `${pct}%`;
                if (updateProgressText) {
                    updateProgressText.textContent = data.isDelta
                        ? `Stahuji bleskovou delta aktualizaci... ${pct} %`
                        : `Stahuji aktualizaci... ${pct} %`;
                }
                if (updateProgressSize && data.total) {
                    const curMb = (data.current / 1048576).toFixed(1);
                    const totMb = (data.total / 1048576).toFixed(1);
                    updateProgressSize.textContent = `${curMb} MB / ${totMb} MB${data.isDelta ? ' (Delta)' : ''}`;
                }
            } else if (data.status === 'extracting') {
                if (updateProgressBar) updateProgressBar.style.width = '100%';
                if (updateProgressText) {
                    updateProgressText.textContent = data.step || (data.isDelta
                        ? 'Aplikuji delta změny v kódu launcheru...'
                        : 'Rozbaluji aktualizační archiv...');
                }
                if (updateProgressSize) updateProgressSize.textContent = data.isDelta ? 'Delta instalace' : 'Rozbalování';
            } else if (data.status === 'installing') {
                if (updateProgressBar) updateProgressBar.style.width = '100%';
                if (updateProgressText) {
                    updateProgressText.textContent = data.step || 'Instaluji aktualizované soubory...';
                }
                if (updateProgressSize) updateProgressSize.textContent = 'Instalace';
            }
        });
    }

    function openUpdateModal(update) {
        const modal = document.getElementById('updateModal');
        const title = document.getElementById('updateModalTitle');
        const desc = document.getElementById('updateModalDesc');
        const notes = document.getElementById('updateReleaseNotes');
        if (!modal) return;

        if (title) title.textContent = `Dostupná nová verze v${update.latestVersion || ''}`;
        if (desc) {
            if (update.isDelta) {
                const mb = update.downloadSize ? (update.downloadSize / 1048576).toFixed(1) + ' MB' : '~3 MB';
                desc.innerHTML = `Byla vydána nová verze MYCHAL SMP Launcheru (máš v${update.currentVersion || '1.0.0'}).<br><span style="display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; color: #21de00; font-weight: 700; background: rgba(33, 222, 0, 0.12); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(33, 222, 0, 0.3);"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Blesková delta aktualizace: stahují se pouze změny (${mb} namísto ~90 MB)</span>`;
            } else {
                desc.textContent = `Byla vydána nová verze MYCHAL SMP Launcheru (máš nainstalovanou v${update.currentVersion || '1.0.0'}). Chceš aktualizaci stáhnout a nainstalovat?`;
            }
        }

        if (notes && update.releaseNotes) {
            notes.textContent = update.releaseNotes;
            notes.style.display = 'block';
        } else if (notes) {
            notes.style.display = 'none';
        }

        // Reset progress & countdown
        if (updateProgressContainer) updateProgressContainer.style.display = 'none';
        if (updateProgressBar) updateProgressBar.style.width = '0%';
        if (updateCountdownContainer) updateCountdownContainer.style.display = 'none';
        if (updateModalFoot) updateModalFoot.style.display = 'flex';

        const btnConfirm = document.getElementById('btnConfirmUpdate');
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = update.isDelta
                ? '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-pulse" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Aktualizovat bleskově (Delta)</span>'
                : '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Aktualizovat nyní</span>';
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
        btnManualCheckUpdate.addEventListener('click', async () => {
            btnManualCheckUpdate.disabled = true;
            const orig = btnManualCheckUpdate.innerHTML;
            btnManualCheckUpdate.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Kontroluji...</span>';
            try {
                await checkLauncherUpdates(false);
            } finally {
                btnManualCheckUpdate.disabled = false;
                btnManualCheckUpdate.innerHTML = orig;
            }
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
            btnConfirmUpdate.innerHTML = pendingUpdateData.isDelta
                ? '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Stahuji delta aktualizaci...</span>'
                : '<span><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Stahuji aktualizaci...</span>';

            const notes = document.getElementById('updateReleaseNotes');
            if (notes) notes.style.display = 'none';

            if (updateProgressContainer) {
                updateProgressContainer.style.display = 'block';
                if (updateProgressBar) updateProgressBar.style.width = '0%';
                if (updateProgressText) updateProgressText.textContent = pendingUpdateData.isDelta
                    ? 'Stahuji bleskový delta balíček...'
                    : 'Navazuji spojení s GitHub Releases...';
                if (updateProgressSize) updateProgressSize.textContent = '0 MB / ...';
            }

            try {
                const assets = pendingUpdateData.assets || [];
                const deltaAsset = assets.find(a => a.name === 'update.asar' || a.name === 'app.asar');
                const tarAsset = assets.find(a => a.name.endsWith('.tar.gz'));
                const downloadUrl = pendingUpdateData.downloadUrl || (deltaAsset ? deltaAsset.downloadUrl : (tarAsset ? tarAsset.downloadUrl : (assets[0] ? assets[0].downloadUrl : pendingUpdateData.releaseUrl)));

                const res = await window.api.applyUpdate(downloadUrl);
                if (res && res.applied) {
                    if (updateProgressContainer) updateProgressContainer.style.display = 'none';
                    if (updateModalFoot) updateModalFoot.style.display = 'none';
                    if (updateCountdownContainer) updateCountdownContainer.style.display = 'block';

                    let countdown = 3;
                    if (updateCountdownSec) updateCountdownSec.textContent = countdown;

                    const interval = setInterval(async () => {
                        countdown--;
                        if (updateCountdownSec) updateCountdownSec.textContent = countdown;
                        if (countdown <= 0) {
                            clearInterval(interval);
                            try {
                                await window.api.restartLauncher();
                            } catch (e) {
                                window.location.reload();
                            }
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
                if (updateProgressContainer) updateProgressContainer.style.display = 'none';
                if (btnConfirmUpdate) {
                    btnConfirmUpdate.disabled = false;
                    btnConfirmUpdate.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Zkusit znovu</span>';
                }
            }
        });
    }

    // ── Profile List Rendering & Interactive Selection ──────────────────────
    function renderProfilesList() {
        const list = document.getElementById('profileCardsList');
        if (!list) return;

        const profiles = currentConfig.profiles || [];
        const activeId = currentConfig.activeProfileId || (profiles[0] ? profiles[0].id : 'minecraft-26.2');

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

        list.innerHTML = profiles.map(p => {
            const isActive = p.id === activeId;
            const getIconSvg = (icon) => {
                switch (icon) {
                    case 'sword':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline><line x1="13" y1="19" x2="19" y2="13"></line><line x1="16" y1="16" x2="20" y2="20"></line><line x1="19" y1="21" x2="21" y2="19"></line></svg>';
                    case 'latest':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--gold ui-icon-pulse" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
                    case 'chest':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
                    case 'upgrade':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--gold" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
                    case 'import':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--green" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
                    case 'shield':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>';
                    case 'rocket':
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path></svg>';
                    default:
                        return '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--blue" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="4"></rect><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="11" x2="15.01" y2="11"></line><line x1="18" y1="13" x2="18.01" y2="13"></line></svg>';
                }
            };
            const iconSymbol = getIconSvg(p.icon);

            const badgeClass = (p.id === 'minecraft-26.2' || p.id === 'mychalsmp-26.2') ? 'p-recommended' :
                p.version === '26.3' ? 'p-latest' :
                    p.icon === 'upgrade' ? 'p-upgrade' :
                        p.icon === 'import' ? 'p-imported' : 'p-vanilla';

            const badgeText = (p.id === 'minecraft-26.2' || p.id === 'mychalsmp-26.2') ? 'Doporučeno 26.2' :
                p.version === '26.3' ? 'Nejnovější 26.3' :
                    p.icon === 'upgrade' ? `Upgrade (${p.version})` :
                        p.icon === 'import' ? `Import (${p.version})` : `Verze ${p.version}`;

            const playtimeStr = (p.playtimeSeconds && p.playtimeSeconds >= 60)
                ? `Odehráno: ${formatPlaytime(p.playtimeSeconds)}`
                : 'Zatím nehráno';
            const lastPlayedStr = p.lastPlayed ? `Naposledy: ${formatLastPlayed(p.lastPlayed)}` : null;
            const loaderTag = (p.loader && p.loader !== 'vanilla') ? `${p.loader.charAt(0).toUpperCase() + p.loader.slice(1)}` : null;

            const metaParts = [loaderTag, `Verze ${p.version}`, playtimeStr, lastPlayedStr].filter(Boolean);
            const meta = metaParts.join(' • ');

            // Upgrade button is ONLY displayed for versions older than the latest (26.3)
            const canUpgrade = p.version !== '26.3' && p.version !== '26.4';
            const upgradeBtnHtml = canUpgrade ? `
                <button class="btn-upgrade-profile" data-profile-id="${escapeHtml(p.id)}" title="Upgradovat profil a stáhnout nové verze módů">
                    <svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--gold" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Upgrade
                </button>
            ` : '';

            return `
                <div class="profile-row-card ${isActive ? 'active-profile' : ''}" data-profile-id="${escapeHtml(p.id)}">
                    <div class="profile-icon-box">${iconSymbol}</div>
                    <div class="profile-details">
                        <div class="profile-title-line">
                            <span class="p-name">${escapeHtml(p.name)}</span>
                            <span class="p-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
                        </div>
                        <div class="p-meta">${escapeHtml(meta)}</div>
                    </div>
                    <div class="profile-actions">
                        ${upgradeBtnHtml}
                        <button class="mc-btn ${(() => {
                    if (isRunning && isActive) return 'mc-btn-red';
                    const isInst = Array.isArray(installedVersions) && installedVersions.includes(p.version);
                    return isInst ? 'mc-btn-green' : 'mc-btn-primary';
                })()} btn-launch-profile" data-profile-id="${escapeHtml(p.id)}">
                            <span>${(() => {
                    if (isRunning && isActive) return '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg> Stop';
                    const isInst = Array.isArray(installedVersions) && installedVersions.includes(p.version);
                    return isInst ? '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát' : '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout';
                })()}</span>
                        </button>
                        <button class="mc-btn mc-btn-secondary btn-profile-settings" data-profile-id="${escapeHtml(p.id)}" title="Nastavení profilu"><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
                    </div>
                </div>
            `;
        }).join('');

        // Bind card click for selection
        list.querySelectorAll('.profile-row-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const pid = card.dataset.profileId;
                selectActiveProfile(pid);
            });
        });

        // Bind Play buttons
        list.querySelectorAll('.btn-launch-profile').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = btn.dataset.profileId;
                selectActiveProfile(pid);
                startLaunch(pid, null);
            });
        });

        // Bind Upgrade buttons
        list.querySelectorAll('.btn-upgrade-profile').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = btn.dataset.profileId;
                openUpgradeModal(pid);
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
    }

    function selectActiveProfile(profileId) {
        currentConfig.activeProfileId = profileId;
        const p = (currentConfig.profiles || []).find(x => x.id === profileId);
        if (p) {
            currentConfig.version = p.version;
            currentConfig.loader = p.loader || 'vanilla';
            window.api.saveConfig({
                activeProfileId: profileId,
                version: p.version,
                loader: p.loader || 'vanilla'
            });
            appendLog(`[PROFIL] Aktivován profil: ${p.name} (${p.version}, zavaděč: ${(p.loader || 'vanilla').toUpperCase()})`);
            const isInst = Array.isArray(installedVersions) && installedVersions.includes(p.version);
            if (sideConsoleStatus && !isRunning && !isLaunching) {
                sideConsoleStatus.textContent = isInst
                    ? 'Klient je připraven. Kliknutím na Hrát spustíš instanci s optimalizacemi.'
                    : `Verze ${p.version} ještě není stažena. Kliknutím na Stáhnout ji nainstaluješ.`;
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

    if (sidebarPlayBtn) {
        sidebarPlayBtn.addEventListener('click', () => {
            startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', null);
        });
    }

    // Version tab installer buttons & stop buttons
    document.querySelectorAll('.btn-install-v').forEach(btn => {
        btn.addEventListener('click', async () => {
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
            try {
                await window.api.killGame();
            } catch (e) {}
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
            appendLog('[LAUNCHER] Stahování / instalace byla zrušena uživatelem. Čistím stažené soubory...');
            if (progressText) progressText.textContent = 'Ruším instalaci a mažu stažená data...';
            try {
                await window.api.cancelLaunch();
            } catch (err) {
                console.error('Cancel error:', err);
            }
            resetPlayState();
            appendLog('[LAUNCHER] Instalace byla úspěšně zrušena a nekompletní soubory byly smazány.');
        });
    }

    // ── Launch Minecraft ────────────────────────────────────────────────────
    async function startLaunch(profileId, serverIp) {
        if (typeof autoSaveSettings === 'function') {
            await autoSaveSettings(true);
        }
        if (isRunning) {
            if (confirm('Chceš ukončit běžící Minecraft proces?')) {
                await window.api.killGame();
                resetPlayState();
            }
            return;
        }

        isLaunching = true;
        if (sidebarPlayBtn) sidebarPlayBtn.style.opacity = '0.5';
        refreshVersionStatuses();

        const targetPid = profileId || currentConfig.activeProfileId || 'minecraft-26.2';
        const targetProf = (currentConfig.profiles || []).find(x => x.id === targetPid);
        const isAlreadyInstalled = targetProf && Array.isArray(installedVersions) && installedVersions.includes(targetProf.version);

        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = '10%';
            if (progressPercent) progressPercent.textContent = '10%';
            if (progressText) progressText.textContent = isAlreadyInstalled ? 'Načítání hry...' : 'Stahuji verzi a herní data...';
        }

        appendLog(isAlreadyInstalled
            ? `[LAUNCHER] Zahajuji spuštění profilu ${profileId || 'aktivní'}...`
            : `[LAUNCHER] Zahajuji stahování a instalaci verze ${targetProf?.version || ''}...`);
        if (sideConsoleStatus) sideConsoleStatus.textContent = isAlreadyInstalled ? 'Připravuji herní data a knihovny...' : 'Stahuji verzi a herní data...';

        let actualServerIp = serverIp;
        if (actualServerIp && (actualServerIp.includes('mychalsmp.xyz') || actualServerIp.includes('mychalsmp'))) {
            if (currentIllegalMods && currentIllegalMods.length > 0) {
                // If launch wasn't explicitly triggered from quick play, don't block the user, simply launch without connecting to SMP
                actualServerIp = null;
                showToast('Připojení na MYCHAL SMP přeskočeno (profil obsahuje nepovolené módy pro SMP). Hra spuštěna bez serveru.', 'info');
                appendLog('[BEZPEČNOST] Quick Play na MYCHAL SMP přeskočen z důvodu nepovolených módů v profilu. Hra spuštěna bez automatického připojení k serveru.');
            }
        }

        try {
            const res = await window.api.launchGame(profileId, actualServerIp);
            if (res && res.success) {
                isRunning = true;
                isLaunching = false;

                try {
                    installedVersions = await window.api.getInstalledVersions();
                } catch (e) { }

                // Record real lastPlayed timestamp for profile
                const launchedProfile = (currentConfig.profiles || []).find(x => x.id === targetPid);
                if (launchedProfile) {
                    launchedProfile.lastPlayed = Date.now();
                    window.api.saveConfig({ profiles: currentConfig.profiles });
                    renderProfilesList();
                }

                if (sidebarPlayBtn) {
                    sidebarPlayBtn.style.opacity = '1';
                    sidebarPlayBtn.style.background = '#ef4444';
                    sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
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
                if (sideConsoleStatus) sideConsoleStatus.textContent = 'Hra úspěšně běží!';
                appendLog('[LAUNCHER] Instance Minecraftu byla úspěšně spuštěna.');
            } else if (res && res.blockedByWarden) {
                appendLog(`[BEZPEČNOST] ${res.error}`);
                showToast('Quick Play na MYCHAL SMP zablokován: Nalezeny nepovolené módy.', 'error');
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

    function resetPlayState() {
        isRunning = false;
        isLaunching = false;
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        if (sidebarPlayBtn) {
            sidebarPlayBtn.style.opacity = '1';
            sidebarPlayBtn.style.background = '#22c55e';
            sidebarPlayBtn.querySelector('span').innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        }
        document.querySelectorAll('.btn-launch-profile').forEach(btn => {
            const pid = btn.dataset.profileId;
            const prof = (currentConfig.profiles || []).find(p => p.id === pid);
            const isInst = prof && Array.isArray(installedVersions) && installedVersions.includes(prof.version);
            btn.innerHTML = `<span>${isInst ? '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Hrát' : '<svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout'}</span>`;
            btn.classList.remove('mc-btn-red', 'mc-btn-green', 'mc-btn-primary');
            btn.classList.add(isInst ? 'mc-btn-green' : 'mc-btn-primary');
        });
        const activeP = (currentConfig.profiles || []).find(x => x.id === (currentConfig.activeProfileId || 'minecraft-26.2'));
        const activeInst = activeP && Array.isArray(installedVersions) && installedVersions.includes(activeP.version);
        if (sideConsoleStatus) {
            sideConsoleStatus.textContent = activeInst
                ? 'Klient je připraven. Kliknutím na Hrát spustíš instanci s optimalizacemi.'
                : `Verze ${activeP ? activeP.version : ''} ještě není stažena. Kliknutím na Stáhnout ji nainstaluješ.`;
        }
        document.querySelectorAll('.v-card-progress').forEach(p => p.style.display = 'none');
        refreshVersionStatuses();
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

    function closeProfileSeedModal() {
        if (modalProfileSeed) modalProfileSeed.style.display = 'none';
        if (profileSeedImportStatus) profileSeedImportStatus.textContent = '';
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
                showToast('Stiskni Ctrl+C pro zkopírování', 'info');
            }
        });
    }

    if (window.api && window.api.onProfileSeedProgress) {
        window.api.onProfileSeedProgress((data) => {
            if (profileSeedImportStatus) {
                profileSeedImportStatus.innerHTML = `<span style="color: #60a5fa;">Stahování: ${data.current} z ${data.total}</span>`;
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
            if (profileSeedImportStatus) profileSeedImportStatus.textContent = 'Příprava stahování...';

            try {
                const res = await window.api.importProfileSeed(profId, seedVal);
                if (res && res.success) {
                    showToast('Balíček byl úspěšně stažen', 'success');
                    if (profileSeedImportStatus) {
                        if (res.failedCount > 0) {
                            profileSeedImportStatus.innerHTML = `<span style="color: #f59e0b;">Staženo: ${res.installedCount}, selhalo: ${res.failedCount}</span>`;
                        } else {
                            profileSeedImportStatus.innerHTML = '<span style="color: #21DE00;">Hotovo</span>';
                        }
                    }
                    // Refresh mods & packs list in UI
                    loadProfileMods(profId);
                } else {
                    showToast(res?.error || 'Chyba při stahování', 'error');
                    if (profileSeedImportStatus) {
                        profileSeedImportStatus.innerHTML = `<span style="color: #f51515;">${escapeHtml(res?.error || 'Chyba')}</span>`;
                    }
                }
            } catch (err) {
                showToast(err.message, 'error');
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
                } catch (_) {}
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
                        modCollisionDescText.textContent = `Nalezeno ${res.collisions.length} módů s duplicitními verzemi (${extraDups} duplikátů). Automaticky zachová nejnovější verzi a starší bezpečně deaktivuje.`;
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
                                btnResolveModCollisions.textContent = 'Automaticky vyřešit';
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
                        <div class="empty-mods-title">V tomto profilu zatím nejsou žádné módy</div>
                        <p class="empty-mods-desc">Přidej módy z Modrinth katalogu jedním kliknutím nebo vlož .jar soubory do složky mods.</p>
                        <div class="empty-mods-actions">
                            <button type="button" class="mc-btn mc-btn-primary" id="btnEmptyGoCatalog">
                                <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> Přejít do Modrinth katalogu</span>
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

        // Bind delete buttons
        listEl.querySelectorAll('.btn-mod-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = btn.dataset.filename;
                if (!confirm(`Opravdu chceš smazat soubor "${filename}" z profilu?`)) return;
                btn.disabled = true;
                try {
                    const res = await window.api.deleteProfileMod(profId, filename);
                    if (res && res.success) {
                        showToast('Soubor módu byl smazán.', 'success');
                        await loadProfileMods(profId);
                    } else {
                        showToast('Chyba při mazání módu: ' + (res?.error || 'Neznámá chyba'), 'error');
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
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
                            <button type="button" class="mc-btn mc-btn-secondary" id="btnEmptyOpenPackFolder">
                                <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Otevřít složku ${escapeHtml(folderName)}</span>
                            </button>
                        </div>
                    </div>
                `;
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
            const initial = (p.cleanName || 'P').charAt(0).toUpperCase();
            return `
            <div class="installed-mod-row ${p.enabled ? 'mod-enabled' : 'mod-disabled'}" data-filename="${escapeHtml(p.filename)}">
                <div class="mod-row-left">
                    <div class="mod-avatar-wrapper">
                        <div class="mod-avatar-fallback">${escapeHtml(initial)}</div>
                    </div>
                    <div class="mod-row-info">
                        <div class="mod-row-title-line">
                            <span class="mod-row-name" title="${escapeHtml(p.cleanName)}">${escapeHtml(p.cleanName)}</span>
                            <span class="mod-row-badge ${p.enabled ? 'badge-enabled' : 'badge-disabled'}">
                                ${p.enabled ? '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Aktivní' : 'Vypnuto'}
                            </span>
                        </div>
                        <div class="mod-row-file-meta">
                            <span class="mod-file-name" title="${escapeHtml(p.filename)}">${escapeHtml(p.filename)}</span>
                            <span>•</span>
                            <span class="mod-file-size">${escapeHtml(p.sizeFormatted)}</span>
                        </div>
                    </div>
                </div>
                <div class="mod-row-actions">
                    <button type="button" class="btn-pack-toggle mc-btn btn-sm ${p.enabled ? 'mc-btn-secondary' : 'mc-btn-primary'}"
                        data-filename="${escapeHtml(p.filename)}"
                        data-pack-type="${escapeHtml(packType)}"
                        title="${p.enabled ? 'Deaktivovat' : 'Aktivovat'}">
                        <span>${p.enabled ? 'Vypnout' : 'Zapnout'}</span>
                    </button>
                    <button type="button" class="btn-pack-delete mc-btn btn-sm"
                        data-filename="${escapeHtml(p.filename)}"
                        data-pack-type="${escapeHtml(packType)}"
                        style="color: #f51515;"
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

        // Bind delete pack
        listEl.querySelectorAll('.btn-pack-delete').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const fn = btn.dataset.filename;
                const pt = btn.dataset.packType;
                if (!confirm(`Opravdu chceš smazat "${fn}" z profilu?`)) return;
                btn.disabled = true;
                try {
                    const res = await window.api.deleteProfilePack(profId, pt, fn);
                    if (res && res.success) {
                        showToast('Soubor byl smazán.', 'success');
                        await loadProfileMods(profId);
                    } else {
                        showToast('Chyba: ' + (res?.error || 'Neznámá chyba'), 'error');
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
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

    /**
     * Zjistí, zda je vzdálená verze z Modrinthu novější než lokálně nainstalovaná verze v profilu.
     */
    function isModVersionNewer(remoteVer, localVer) {
        if (!remoteVer || !localVer) return false;
        if (remoteVer === localVer) return false;

        const clean = (v) => {
            const raw = (v || '').trim();
            const withoutPrefix = raw.replace(/^v/i, '').replace(/^mc[0-9.]*[-_]/i, '');
            const base = withoutPrefix.split('+')[0].split('-')[0].trim();
            return base;
        };

        const rClean = clean(remoteVer);
        const lClean = clean(localVer);
        if (rClean === lClean) return false;

        const rParts = rClean.split('.').map(n => parseInt(n, 10) || 0);
        const lParts = lClean.split('.').map(n => parseInt(n, 10) || 0);

        for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
            const r = rParts[i] || 0;
            const l = lParts[i] || 0;
            if (r > l) return true;
            if (r < l) return false;
        }

        return false;
    }

    /**
     * Inteligentně najde odpovídající nainstalovaný mód v profilu pro danou položku z katalogu Modrinth.
     */
    function findInstalledModForCatalog(catalogMod, profileMods) {
        if (!profileMods || profileMods.length === 0) return null;

        const catId = (catalogMod.id || '').toLowerCase().trim();
        const catSlug = (catalogMod.slug || catalogMod.id || '').toLowerCase().trim();
        const catProjId = (catalogMod.project_id || '').toLowerCase().trim();
        const catTitle = (catalogMod.title || '').toLowerCase().trim();

        const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanSlug = clean(catSlug);
        const cleanTitle = clean(catTitle);
        const cleanId = clean(catId);

        for (const inst of profileMods) {
            // 0. Metadata shoda z .mod_meta.json
            const instMId = (inst.modrinthId || '').toLowerCase().trim();
            const instMSlug = (inst.modrinthSlug || '').toLowerCase().trim();
            if (instMId && (instMId === catId || instMId === catSlug || instMId === catProjId)) {
                return inst;
            }
            if (instMSlug && (instMSlug === catId || instMSlug === catSlug || instMSlug === catProjId)) {
                return inst;
            }

            const instModId = (inst.modId || '').toLowerCase().trim();
            const instName = (inst.name || '').toLowerCase().trim();
            const instFile = (inst.filename || '').toLowerCase().trim();
            const cleanInstId = clean(instModId);
            const cleanInstName = clean(instName);
            const cleanInstFile = clean(instFile);

            // 1. Přesná shoda ID / slug
            if (cleanSlug && (cleanSlug === cleanInstId || cleanId === cleanInstId || catSlug === instModId)) {
                return inst;
            }

            // 2. Přesná shoda názvu módu
            if (cleanTitle && (cleanTitle === cleanInstName || catTitle === instName)) {
                return inst;
            }

            // 3. Shoda začátku nebo části názvu souboru (např. sodium-fabric-0.6.6 vs slug sodium)
            if (catSlug && catSlug.length >= 3) {
                if (instFile.startsWith(catSlug + '-') || instFile.startsWith(catSlug + '_') || instFile.startsWith(catSlug + '.')) {
                    return inst;
                }
            }
            if (cleanSlug && cleanSlug.length >= 3 && (cleanInstFile.startsWith(cleanSlug) || cleanInstFile.includes(cleanSlug))) {
                return inst;
            }

            // 4. Fallback na cleanName
            if (cleanSlug && cleanSlug.length >= 4 && cleanInstName.startsWith(cleanSlug)) {
                return inst;
            }
        }
        return null;
    }

    let lastLoadedCatalogMods = [];
    let catalogOffset = 0;
    const catalogLimit = 24;
    let isCatalogLoading = false;
    let hasMoreCatalogMods = true;

    async function loadModrinthMods(reset = true) {
        if (!modsCardsList) return;
        if (reset) {
            catalogOffset = 0;
            hasMoreCatalogMods = true;
            lastLoadedCatalogMods = [];
            const typeLabels = { mod: 'mody', resourcepack: 'resource packy', shader: 'shadery' };
            const label = typeLabels[currentModFilter.projectType] || 'položky';
            modsCardsList.innerHTML = `<div class="mods-loading">Načítám ${label} z katalogu Modrinth...</div>`;
        }

        if (isCatalogLoading) return;
        isCatalogLoading = true;

        try {
            // VŽDY načteme aktuální módy profilu přímo z disku pro 100% přesnou detekci stavu stažení
            const profId = selectedModsProfileId || currentConfig.activeProfileId;
            if (profId) {
                try {
                    const pRes = await window.api.getProfileMods(profId);
                    if (pRes && pRes.success) {
                        currentProfileModsList = pRes.mods || [];
                    }
                } catch (_) {}
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
            isCatalogLoading = false;
        }
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

        const updateableMods = [];

        modsCardsList.innerHTML = mods.map(m => {
            const installedMod = findInstalledModForCatalog(m, currentProfileModsList);
            // Zásadní oprava: Zda je mód nainstalován, závisí VÝHRADNĚ na tom, zda skutečně existuje v profilu!
            const isInstalled = !!installedMod;
            const currentVer = installedMod ? (installedMod.version || '') : '';
            const latestVer = m.latest_version_number || '';

            // Kontrola, zda nová verze podporuje stejnou verzi hry:
            // Pokud je nová verze pro jinou verzi MC, neukazujeme aktualizaci, ale "Staženo" / "Nainstalováno"
            const latestSupportsOurMc = !m.latest_game_versions || m.latest_game_versions.length === 0 || m.latest_game_versions.includes(targetMcVersion);
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
            } else {
                btnHtml = `
                    <button class="mc-btn mc-btn-green btn-toggle-mod" data-mod="${escapeHtml(m.id)}" data-action="download" title="Stáhnout do profilu">
                        <span><svg class="ui-icon-svg ui-icon-svg--xs" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Stáhnout</span>
                    </button>
                `;
            }

            return `
                <div class="mod-card-row">
                    <img src="${escapeHtml(m.icon_url)}" class="mod-avatar" onerror="this.src='assets/server-icon.png'">
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
                            <span>Verze: ${currentModFilter.version}</span>
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
                            }
                        } catch (err) {
                            console.warn(`Selhala aktualizace módu ${item.mod.id}:`, err);
                        }
                    }

                    showToast(`Úspěšně aktualizováno ${successCount} z ${total} módů!`, 'success');
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

        // Bind interactive delete buttons directly from catalog
        modsCardsList.querySelectorAll('.btn-catalog-delete-mod').forEach(delBtn => {
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = delBtn.dataset.filename;
                const modTitle = delBtn.dataset.modTitle || 'mód';
                const targetProfileId = selectedModsProfileId || currentConfig.activeProfileId;
                if (!filename) {
                    showToast('Nelze dohledat soubor módu pro smazání.', 'error');
                    return;
                }
                if (!confirm(`Opravdu chceš smazat "${modTitle}" (${filename}) z profilu?`)) return;
                delBtn.disabled = true;
                try {
                    const res = await window.api.deleteProfileMod(targetProfileId, filename);
                    if (res && res.success) {
                        showToast(`${modTitle} byl smazán z profilu.`, 'success');
                        const pRes = await window.api.getProfileMods(targetProfileId);
                        if (pRes && pRes.success) {
                            currentProfileModsList = pRes.mods || [];
                        }
                        renderModCards(lastLoadedCatalogMods);
                    } else {
                        showToast('Chyba při mazání módu: ' + (res?.error || 'Neznámá chyba'), 'error');
                        delBtn.disabled = false;
                    }
                } catch (err) {
                    showToast('Chyba: ' + err.message, 'error');
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

                        const sub = res.subfolder || 'mods';
                        const toastMsg = isUpdate
                            ? `${title} byl úspěšně aktualizován na novou verzi!`
                            : `${title} byl úspěšně stažen do ${sub}/!`;
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
                            showToast(`Profil byl automaticky přepnut na ${niceNew} loader!`, 'info');
                            appendLog(`[LOADER] Profil "${pObj ? pObj.name : targetProfileId}" byl automaticky přepnut z ${nicePrev} na ${niceNew} pro spuštění módů.`);

                            renderModsProfileDropdown();
                            refreshVersionStatuses();
                            renderProfilesList();
                        }

                        // VŽDY synchronizujeme nainstalované módy z disku a překreslíme karty v katalogu
                        const pRes = await window.api.getProfileMods(targetProfileId);
                        if (pRes && pRes.success) {
                            currentProfileModsList = pRes.mods || [];
                        }
                        renderModCards(lastLoadedCatalogMods);
                        await checkWardenProbe();
                    } else {
                        btn.classList.remove('btn-downloading');
                        btn.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--red" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <span>Chyba</span>`;
                        showToast(`Chyba při stahování: ${res.error || 'Neznámá chyba'}`, 'error');
                    }
                } catch (e) {
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
    let skinViewer = null;
    let heroSkinViewer = null;
    let activeMojangCapeUrl = null;
    let defaultServerCapeDataUrl = null;
    let isBackEquipmentElytra = false;
    let isFlyingAnimationActive = false;
    let isAutoRotateActive = false;
    let lastLoadedSkinUrl = null;
    let lastLoadedCapeUrl = null;

    // Smooth return physics & drag controls for hero card
    const DEFAULT_HERO_ROT_Y = -0.30; // ~17° default angle: front, 3D depth, and cape are visible
    const DEFAULT_HERO_ROT_X = 0;
    const HERO_RETURN_DELAY_MS = 1800; // 1.8s delay after releasing mouse before returning
    let isDraggingHero = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let startHeroRotY = DEFAULT_HERO_ROT_Y;
    let startHeroRotX = DEFAULT_HERO_ROT_X;
    let heroReturnTimeout = null;
    let heroReturnAnimId = null;

    function cancelHeroReturn() {
        if (heroReturnTimeout) {
            clearTimeout(heroReturnTimeout);
            heroReturnTimeout = null;
        }
        if (heroReturnAnimId) {
            cancelAnimationFrame(heroReturnAnimId);
            heroReturnAnimId = null;
        }
    }

    function scheduleHeroReturn() {
        cancelHeroReturn();
        heroReturnTimeout = setTimeout(() => {
            animateHeroSmoothReturn();
        }, HERO_RETURN_DELAY_MS);
    }

    function animateHeroSmoothReturn() {
        if (!heroSkinViewer || isDraggingHero) return;

        const currentY = heroSkinViewer.playerWrapper.rotation.y;
        const currentX = heroSkinViewer.playerWrapper.rotation.x;

        // Shortest angular difference around circle [-PI, PI]
        const diffY = ((DEFAULT_HERO_ROT_Y - currentY + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const diffX = DEFAULT_HERO_ROT_X - currentX;

        // Threshold check to finish smoothly
        if (Math.abs(diffY) < 0.0015 && Math.abs(diffX) < 0.0015) {
            heroSkinViewer.playerWrapper.rotation.y = DEFAULT_HERO_ROT_Y;
            heroSkinViewer.playerWrapper.rotation.x = DEFAULT_HERO_ROT_X;
            heroReturnAnimId = null;
            return;
        }

        // Smooth ease-out lerp (0.065 damping factor)
        heroSkinViewer.playerWrapper.rotation.y += diffY * 0.065;
        heroSkinViewer.playerWrapper.rotation.x += diffX * 0.065;

        heroReturnAnimId = requestAnimationFrame(animateHeroSmoothReturn);
    }

    /**
     * Výchozí stav pláště: žádný plášť (hráč začíná vždy s čistým vzhledem bez vnuceného pláště).
     */
    function getDefaultServerCapeUrl() {
        return null;
    }

    /**
     * Dynamická animace klidového stavu (Idle) s přirozeným vlněním pláště ve větru.
     */
    function createCapeIdleAnimation() {
        if (!window.skinview3d) return null;
        try {
            class DynamicCapeIdleAnimation extends window.skinview3d.IdleAnimation {
                animate(player) {
                    super.animate(player);
                    if (player && player.cape) {
                        const t = this.progress * 3;
                        // Organické vlnění pláště v jemném vánku při stání
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
        if (heroSkinViewer && !force) return;

        try {
            cancelHeroReturn();
            if (heroSkinViewer) {
                try { heroSkinViewer.dispose(); } catch (_) { }
                heroSkinViewer = null;
            }

            const isSlim = currentConfig ? (currentConfig.customSkinVariant === 'slim') : false;
            heroSkinViewer = new window.skinview3d.SkinViewer({
                canvas: canvas,
                width: 160,
                height: 220,
                model: isSlim ? 'slim' : 'default'
            });

            heroSkinViewer.camera.position.set(0, 0, 70);
            heroSkinViewer.zoom = 0.95;
            heroSkinViewer.fov = 48;
            heroSkinViewer.autoRotate = false; // Strictly no auto-rotation
            heroSkinViewer.controls.enabled = false; // Direct smooth drag on playerWrapper
            heroSkinViewer.animation = createCapeIdleAnimation() || new window.skinview3d.IdleAnimation();

            // Set default resting pose
            heroSkinViewer.playerWrapper.rotation.set(DEFAULT_HERO_ROT_X, DEFAULT_HERO_ROT_Y, 0);

            // Drag to rotate with pointer events & smooth auto-return
            canvas.style.cursor = 'grab';

            canvas.onpointerdown = (e) => {
                if (!heroSkinViewer) return;
                isDraggingHero = true;
                cancelHeroReturn();

                startPointerX = e.clientX;
                startPointerY = e.clientY;
                startHeroRotY = heroSkinViewer.playerWrapper.rotation.y;
                startHeroRotX = heroSkinViewer.playerWrapper.rotation.x;

                canvas.style.cursor = 'grabbing';
                try {
                    canvas.setPointerCapture(e.pointerId);
                } catch (_) { }
            };

            canvas.onpointermove = (e) => {
                if (!isDraggingHero || !heroSkinViewer) return;
                cancelHeroReturn();

                const dx = e.clientX - startPointerX;
                const dy = e.clientY - startPointerY;

                // Horizontal rotation: 0.014 rad per pixel
                heroSkinViewer.playerWrapper.rotation.y = startHeroRotY + dx * 0.014;

                // Subtle vertical tilt clamped between -0.25 and 0.25 rad
                const rawX = startHeroRotX + dy * 0.008;
                heroSkinViewer.playerWrapper.rotation.x = Math.max(-0.25, Math.min(0.25, rawX));
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

                scheduleHeroReturn();
            };

            canvas.onpointerup = onPointerEnd;
            canvas.onpointercancel = onPointerEnd;

            // Load current skin & cape immediately
            if (currentConfig) {
                const isMicrosoft = currentConfig.authType === 'microsoft';
                const effectiveSkin = currentConfig.customSkinPath || (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.skinUrl : null);
                const name = (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.username : currentConfig.username) || 'Steve';
                const skinSrc = effectiveSkin
                    ? ((effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://')) ? effectiveSkin : `file://${effectiveSkin}`)
                    : `https://minotar.net/skin/${encodeURIComponent(name)}`;
                const effectiveCape = getEffectiveCape();

                const pSkin = heroSkinViewer.loadSkin(skinSrc, { model: isSlim ? 'slim' : 'default' });
                if (pSkin && typeof pSkin.catch === 'function') {
                    pSkin.catch(err => console.warn('[HERO 3D] loadSkin init failed:', err));
                }
                if (effectiveCape) {
                    const pCape = heroSkinViewer.loadCape(effectiveCape, { backEquipment: 'cape' });
                    if (pCape && typeof pCape.catch === 'function') {
                        pCape.catch(err => console.warn('[HERO 3D] loadCape init failed:', err));
                    }
                }
            }
        } catch (e) {
            console.warn('[HERO 3D] Inicializace hero 3D prohlížeče selhala:', e);
            if (heroSkinImg) heroSkinImg.style.display = 'block';
        }
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
            heroSkinViewer.setSize(160, 220);
            if (skinUrl) {
                const pSkin = heroSkinViewer.loadSkin(skinUrl, { model: isSlim ? 'slim' : 'default' });
                if (pSkin && typeof pSkin.catch === 'function') {
                    pSkin.catch(err => console.warn('[HERO 3D] loadSkin failed:', err));
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
                width: 220,
                height: 310,
                model: currentConfig.customSkinVariant === 'slim' ? 'slim' : 'default'
            });

            skinViewer.camera.position.set(0, 0, 70);
            skinViewer.zoom = 0.95;
            skinViewer.fov = 48;
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
            skinViewer.setSize(220, 310);
        }
        const isMicrosoft = currentConfig.authType === 'microsoft';
        const effectiveSkin = currentConfig.customSkinPath || (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.skinUrl : null);
        const effectiveCape = getEffectiveCape();
        const isSlim = currentConfig.customSkinVariant === 'slim';
        const name = (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.username : currentConfig.username) || 'Steve';

        const skinSrc = effectiveSkin
            ? ((effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://')) ? effectiveSkin : `file://${effectiveSkin}`)
            : `https://minotar.net/skin/${encodeURIComponent(name)}`;

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
        if (!container) return;

        if (currentConfig.authType !== 'microsoft') {
            container.innerHTML = '';
            if (equippedBadge) equippedBadge.style.display = 'none';
            return;
        }

        try {
            const res = await window.api.getMojangProfile();
            if (res && res.success && res.profile) {
                const capes = res.profile.capes || [];
                if (capes.length === 0) {
                    container.innerHTML = '<div class="cape-loading-hint">Na tomto Mojang účtu nemáš žádné oficiální pláště.</div>';
                    if (equippedBadge) equippedBadge.style.display = 'none';
                    return;
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

                if (equippedBadge && equippedName) {
                    if (activeCapeFound) {
                        equippedBadge.style.display = 'block';
                        equippedName.textContent = activeCapeFound.alias || 'Aktivní plášť';
                        activeMojangCapeUrl = activeCapeFound.url;
                        updateSkinViewer3D(lastLoadedSkinUrl, activeCapeFound.url, currentConfig.customSkinVariant === 'slim');
                        updateHeroSkinViewer3D(lastLoadedSkinUrl, activeCapeFound.url, currentConfig.customSkinVariant === 'slim');
                    } else {
                        equippedBadge.style.display = 'none';
                        activeMojangCapeUrl = null;
                        updateSkinViewer3D(lastLoadedSkinUrl, null, currentConfig.customSkinVariant === 'slim');
                        updateHeroSkinViewer3D(lastLoadedSkinUrl, null, currentConfig.customSkinVariant === 'slim');
                    }
                }

                // Bind click to equip cape on Mojang account
                container.querySelectorAll('.cape-item-card').forEach(card => {
                    card.addEventListener('click', async () => {
                        const capeId = card.dataset.capeId;
                        showToast('Nastavuji plášť na Mojang účtu...', 'info');
                        const equipRes = await window.api.setMojangCape(capeId);
                        if (equipRes && equipRes.success) {
                            showToast('Plášť byl úspěšně aktivován na tvém Mojang účtu!', 'success');
                            await loadMojangCapes();
                        } else {
                            showToast('Chyba při nastavování pláště: ' + (equipRes.error || 'Neznámá chyba'), 'error');
                        }
                    });
                });
            } else {
                container.innerHTML = `<div class="cape-loading-hint">Pláště nelze načíst (${res?.error || 'Nepřihlášen'}).</div>`;
            }
        } catch (e) {
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
                    const minotarSkin = `https://minotar.net/skin/${encodeURIComponent(val)}`;
                    drawSkinToCanvas(minotarSkin, currentConfig.customSkinVariant === 'slim');
                    updateSkinViewer3D(minotarSkin, getEffectiveCape(), currentConfig.customSkinVariant === 'slim');
                    updateHeroSkinViewer3D(minotarSkin, getEffectiveCape(), currentConfig.customSkinVariant === 'slim');
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
                    showToast('Skin byl úspěšně nahrán a uložen na tvůj oficiální Mojang účet!', 'success');
                    appendLog('[MOJANG] Skin byl úspěšně aktualizován na Mojang serverech.');
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
                const defaultSkin = `https://minotar.net/skin/${encodeURIComponent(currentConfig.username)}`;
                drawSkinToCanvas(defaultSkin, currentConfig.customSkinVariant === 'slim');
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
                showToast('Offline skin byl uložen v launcheru!', 'success');
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
                    showToast('Skin byl úspěšně nahrán přetažením myší!', 'success');
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
                showToast('Offline plášť byl uložen v launcheru!', 'success');
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
            currentConfig.offlineUsername = nick;
            currentConfig.username = nick;
            const res = await window.api.loginOffline(nick);
            if (res && res.success) {
                currentConfig.username = nick;
                currentConfig.offlineUsername = nick;
                currentConfig.authType = 'offline';
                // Note: customSkinPath is kept!
                updateUserUI(nick, 'offline', currentConfig.customSkinPath);
                temporaryButtonText(btnSaveCharacter, '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Postava uložena!</span>');
                showToast(`Postava "${nick}" byla uložena s tvým skinem!`, 'success');
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

    if (authMicrosoftBtn) {
        authMicrosoftBtn.addEventListener('click', async () => {
            authMicrosoftBtn.disabled = true;
            const originalHtml = authMicrosoftBtn.innerHTML;
            authMicrosoftBtn.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Čekám na okno Microsoftu...</span>';
            appendLog('[AUTH] Otevírám oficiální Microsoft přihlašovací okno...');

            try {
                const res = await window.api.loginMicrosoft();
                if (res && res.success) {
                    currentConfig.username = res.profile.name;
                    currentConfig.authType = 'microsoft';
                    currentConfig.microsoftAccount = res.auth;
                    updateUserUI(res.profile.name, 'microsoft', res.profile.skinUrl);
                    appendLog(`[AUTH] Úspěšné přihlášení Microsoft účtu: ${res.profile.name}`);
                    showToast(`Úspěšně přihlášen Microsoft účet: ${res.profile.name}`, 'success');
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
        });
    }

    // Offline Account Switcher
    if (authOfflineBtn) {
        authOfflineBtn.addEventListener('click', async () => {
            const nick = currentConfig.offlineUsername || 'Hráč';
            if (inputNick) inputNick.value = nick;
            const res = await window.api.loginOffline(nick);
            if (res && res.success) {
                currentConfig.username = nick;
                currentConfig.offlineUsername = nick;
                currentConfig.authType = 'offline';
                currentConfig.microsoftAccount = null;
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
                        sideJavaBadge.textContent = list[0].label.includes('25') ? 'Java 25 (LTS)' : 'Java 21 (LTS)';
                    }
                } else {
                    javaDetectedList.innerHTML = `<span class="java-pill">Java 25/21 automatická detekce</span>`;
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
        const selectedRes = document.querySelector('input[name="res"]:checked')?.value || '1280x720';
        let resObj = { width: 1280, height: 720, fullscreen: false };

        if (selectedRes === 'fullscreen') {
            resObj.fullscreen = true;
        } else {
            const parts = selectedRes.split('x');
            resObj.width = parseInt(parts[0], 10) || 1280;
            resObj.height = parseInt(parts[1], 10) || 720;
        }

        const checkGameMode = document.getElementById('checkGameMode');
        const checkDiscreteGpu = document.getElementById('checkDiscreteGpu');
        const checkMangoHud = document.getElementById('checkMangoHud');
        const checkZink = document.getElementById('checkZink');
        const checkDisableVsync = document.getElementById('checkDisableVsync');
        const checkNativeWayland = document.getElementById('checkNativeWayland');
        const checkDiscordRpc = document.getElementById('checkDiscordRpc');
        const jvmArgsInput = document.getElementById('jvmArgsInput');
        const customEnvVarsInput = document.getElementById('customEnvVarsInput');

        return {
            ramMax: parseInt(ramSlider?.value || '4', 10),
            javaPath: javaPathInput?.value.trim() || null,
            autoConnectServer: autoConnectCheck?.checked ?? false,
            resolution: resObj,
            enableGameMode: checkGameMode ? checkGameMode.checked : true,
            enableDiscreteGpu: checkDiscreteGpu ? checkDiscreteGpu.checked : true,
            enableMangoHud: checkMangoHud ? checkMangoHud.checked : false,
            enableZink: checkZink ? checkZink.checked : false,
            disableVsync: checkDisableVsync ? checkDisableVsync.checked : false,
            enableNativeWayland: checkNativeWayland ? checkNativeWayland.checked : false,
            enableDiscordRpc: checkDiscordRpc ? checkDiscordRpc.checked : true,
            customJvmArgs: jvmArgsInput ? jvmArgsInput.value.trim() : null,
            customEnvVars: customEnvVarsInput ? customEnvVarsInput.value.trim() : ''
        };
    }

    let autoSaveSettingsTimer = null;
    async function autoSaveSettings(instant = false) {
        if (autoSaveSettingsTimer) {
            clearTimeout(autoSaveSettingsTimer);
            autoSaveSettingsTimer = null;
        }

        const doSave = async () => {
            try {
                const updated = collectCurrentSettings();
                currentConfig = { ...currentConfig, ...updated };
                await window.api.saveConfig(updated);
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
        ramSlider.addEventListener('input', (e) => {
            ramValueBadge.textContent = `${e.target.value} GB`;
            autoSaveSettings(false);
        });
        ramSlider.addEventListener('change', () => {
            autoSaveSettings(true);
        });
    }

    if (btnOpenGameDir) {
        btnOpenGameDir.addEventListener('click', () => window.api.openGameDir());
    }

    // Auto-save listeners on all checkboxes & controls
    const checkGameModeEl = document.getElementById('checkGameMode');
    if (checkGameModeEl) checkGameModeEl.addEventListener('change', () => autoSaveSettings(true));

    const checkDiscreteGpuEl = document.getElementById('checkDiscreteGpu');
    if (checkDiscreteGpuEl) checkDiscreteGpuEl.addEventListener('change', () => autoSaveSettings(true));

    const checkMangoHudEl = document.getElementById('checkMangoHud');
    if (checkMangoHudEl) checkMangoHudEl.addEventListener('change', () => autoSaveSettings(true));

    const checkZinkEl = document.getElementById('checkZink');
    if (checkZinkEl) checkZinkEl.addEventListener('change', () => autoSaveSettings(true));

    const checkDisableVsyncEl = document.getElementById('checkDisableVsync');
    if (checkDisableVsyncEl) checkDisableVsyncEl.addEventListener('change', () => autoSaveSettings(true));

    const checkNativeWaylandEl = document.getElementById('checkNativeWayland');
    if (checkNativeWaylandEl) checkNativeWaylandEl.addEventListener('change', () => autoSaveSettings(true));

    const checkDiscordRpcEl = document.getElementById('checkDiscordRpc');
    if (checkDiscordRpcEl) checkDiscordRpcEl.addEventListener('change', () => autoSaveSettings(true));

    if (autoConnectCheck) {
        autoConnectCheck.addEventListener('change', () => autoSaveSettings(true));
    }

    document.querySelectorAll('input[name="res"]').forEach(radio => {
        radio.addEventListener('change', () => autoSaveSettings(true));
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

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            await autoSaveSettings(true);
            appendLog('[CONFIG] Nastavení bylo uloženo.');
            temporaryButtonText(btnSaveSettings, '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Nastavení uloženo!</span>');
            showToast('Nastavení klienta bylo uloženo!', 'success');
        });
    }

    const btnPresetZgc = document.getElementById('btnPresetZgc');
    if (btnPresetZgc) {
        btnPresetZgc.addEventListener('click', () => {
            const jvmInput = document.getElementById('jvmArgsInput');
            if (jvmInput) {
                jvmInput.value = '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions -XX:+AlwaysPreTouch -XX:+DisableExplicitGC';
                autoSaveSettings(true);
                showToast('Nastaveny doporučené parametry Generational ZGC (Java 21/25)!', 'info');
            }
        });
    }

    const btnPresetG1gc = document.getElementById('btnPresetG1gc');
    if (btnPresetG1gc) {
        btnPresetG1gc.addEventListener('click', () => {
            const jvmInput = document.getElementById('jvmArgsInput');
            if (jvmInput) {
                jvmInput.value = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch';
                autoSaveSettings(true);
                showToast('Nastaveny standardní parametry G1GC.', 'info');
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

    if (btnClearLog) {
        btnClearLog.addEventListener('click', () => {
            if (consoleOutput) consoleOutput.textContent = '';
        });
    }

    // ── IPC Launch Events ───────────────────────────────────────────────────
    window.api.onProgress((data) => {
        const percent = Math.min(Math.max(data.percent || 0, 0), 100);
        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressText) progressText.textContent = data.text || 'Načítání hry...';
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
            if (vTxt) vTxt.textContent = data.text || 'Načítání...';
        }
        if (vBadge) {
            vBadge.className = 'v-status-badge downloading';
            const vLabel = vBadge.querySelector('.v-status-label') || vBadge;
            vLabel.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Stahování... ${percent}%</span>`;
        }
    });

    window.api.onLog((line) => appendLog(line));

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

    // Zero-overhead during gameplay & background pause (Tray restore)
    if (window.api && window.api.onGameStarted) {
        window.api.onGameStarted(() => {
            appendLog('[VÝKON] Hra spuštěna – launcher minimalizován do Tray lišty, pozastaveno 3D vykreslování pro 0% zátěž CPU/GPU.');
            if (heroSkinViewer) heroSkinViewer.renderPaused = true;
            if (skinViewer) skinViewer.renderPaused = true;
        });
    }

    if (window.api && window.api.onGameStopped) {
        window.api.onGameStopped(() => {
            appendLog('[VÝKON] Hra ukončena – okno launcheru obnoveno ze systémové lišty.');
            const curTab = document.querySelector('.nav-btn.active')?.dataset?.tab || 'play';
            if (heroSkinViewer) heroSkinViewer.renderPaused = (curTab !== 'play');
            if (skinViewer) skinViewer.renderPaused = (curTab !== 'character');
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
        screenshotsGridContainer.innerHTML = '<div class="mods-loading">Načítám snímky obrazovky...</div>';
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
                        <div class="empty-mods-title">Zatím žádné snímky obrazovky</div>
                        <p class="empty-mods-desc">Stiskni během hry klávesu <strong>F2</strong> pro pořízení screenshotu. Zde se ti okamžitě zobrazí pro bleskové sdílení na Discord.</p>
                    </div>
                `;
                return;
            }

            screenshotsGridContainer.innerHTML = items.map(sc => `
                <div class="screenshot-card" data-path="${escapeHtml(sc.fullPath)}">
                    <div class="screenshot-thumb-box" title="Kliknutím otevřít v plné velikosti">
                        <img src="${sc.thumbUrl}" alt="${escapeHtml(sc.filename)}" class="screenshot-thumb-img" loading="lazy">
                        <div class="screenshot-overlay">
                            <button type="button" class="btn-screenshot-copy" data-path="${escapeHtml(sc.fullPath)}" title="Zkopírovat obrázek do schránky (Ctrl+V na Discord)">
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
                            <button type="button" class="mc-btn mc-btn-secondary btn-sm btn-open-single-sc" data-path="${escapeHtml(sc.fullPath)}" title="Otevřít v systémovém prohlížeči">
                                Otevřít
                            </button>
                            <button type="button" class="mc-btn btn-sm btn-delete-single-sc" data-path="${escapeHtml(sc.fullPath)}" style="color: #f51515;" title="Smazat snímek">
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
                            showToast('Screenshot zkopírován do schránky! Můžeš vložit (Ctrl+V) na Discord.', 'success');
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
                    if (!confirm('Opravdu chceš smazat tento snímek obrazovky?')) return;
                    try {
                        const dRes = await window.api.deleteScreenshot(fullPath);
                        if (dRes && dRes.success) {
                            showToast('Snímek byl smazán.', 'info');
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

    // ── Intelligent Crash Analyzer ──────────────────────────────────────────
    let currentCrashData = null;
    const modalCrashAnalyzer = document.getElementById('modalCrashAnalyzer');
    const btnCloseCrashModal = document.getElementById('btnCloseCrashModal');
    const btnDismissCrashModal = document.getElementById('btnDismissCrashModal');
    const btnApplyCrashFix = document.getElementById('btnApplyCrashFix');
    const btnOpenCrashFullReport = document.getElementById('btnOpenCrashFullReport');

    function closeCrashModal() {
        if (modalCrashAnalyzer) modalCrashAnalyzer.style.display = 'none';
        currentCrashData = null;
    }

    if (btnCloseCrashModal) btnCloseCrashModal.addEventListener('click', closeCrashModal);
    if (btnDismissCrashModal) btnDismissCrashModal.addEventListener('click', closeCrashModal);

    if (window.api && window.api.onCrash) {
        window.api.onCrash((crashData) => {
            if (!crashData || !modalCrashAnalyzer) return;
            currentCrashData = crashData;

            const titleElem = document.getElementById('crashAnalyzerTitle');
            const subElem = document.getElementById('crashAnalyzerSubtitle');
            const badgeElem = document.getElementById('crashExitCodeBadge');
            const headElem = document.getElementById('crashCauseHead');
            const descElem = document.getElementById('crashCauseDesc');
            const recElem = document.getElementById('crashRecommendation');
            const logElem = document.getElementById('crashLogExcerpt');
            const fixTextElem = document.getElementById('btnApplyCrashFixText');

            if (titleElem) titleElem.textContent = crashData.title || 'Analyzátor pádů Minecraftu';
            if (subElem) subElem.textContent = `Detekován pád hry (Exit kód: ${crashData.exitCode || 1})`;
            if (badgeElem) badgeElem.textContent = `Kód ${crashData.exitCode || 1}`;
            if (headElem) headElem.textContent = `Příčina: ${crashData.title || 'Neznámá chyba'}`;
            if (descElem) descElem.textContent = crashData.description || '';
            if (recElem) recElem.textContent = crashData.recommendation || '';
            if (logElem) logElem.textContent = crashData.logExcerpt || '';

            if (btnApplyCrashFix) {
                if (crashData.autoFix) {
                    btnApplyCrashFix.style.display = 'inline-flex';
                    if (fixTextElem) {
                        const cleanLabel = (crashData.autoFix.label || 'Automatická oprava').replace(/^[⚡⚠️🔧\s]+/u, '');
                        fixTextElem.innerHTML = `<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--gold ui-icon-pulse" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> <span>${escapeHtml(cleanLabel)}</span>`;
                    }
                } else {
                    btnApplyCrashFix.style.display = 'none';
                }
            }

            if (btnOpenCrashFullReport) {
                if (crashData.reportPath) {
                    btnOpenCrashFullReport.style.display = 'inline-flex';
                } else {
                    btnOpenCrashFullReport.style.display = 'none';
                }
            }

            modalCrashAnalyzer.style.display = 'flex';
            appendLog(`[CRASH ANALYZER] Zjištěna příčina pádu: ${crashData.title}`);
        });
    }

    if (btnApplyCrashFix) {
        btnApplyCrashFix.addEventListener('click', async () => {
            if (!currentCrashData || !currentCrashData.autoFix) return;
            btnApplyCrashFix.disabled = true;
            btnApplyCrashFix.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--xs ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Aplikuji opravu...</span>';
            try {
                const res = await window.api.applyCrashFix(currentCrashData.autoFix, currentConfig.activeProfileId);
                if (res && res.success) {
                    showToast(`${res.message}`.replace(/^[✓\s]+/u, ''), 'success');
                    appendLog(`[OPRAVA PÁDU] ${res.message}`);
                    closeCrashModal();

                    // Refresh config and UI
                    const updatedCfg = await window.api.getConfig();
                    if (updatedCfg) {
                        currentConfig = updatedCfg;
                        if (ramSlider && updatedCfg.ramMax) {
                            ramSlider.value = updatedCfg.ramMax;
                            if (ramValueBadge) ramValueBadge.textContent = `${updatedCfg.ramMax} GB`;
                        }
                        if (javaPathInput && updatedCfg.javaPath) {
                            javaPathInput.value = updatedCfg.javaPath;
                        }
                    }
                } else {
                    showToast('Chyba: ' + (res?.error || 'Opravu se nepodařilo aplikovat'), 'error');
                }
            } catch (err) {
                showToast('Chyba: ' + err.message, 'error');
            } finally {
                btnApplyCrashFix.disabled = false;
                btnApplyCrashFix.innerHTML = '<span id="btnApplyCrashFixText"><svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--gold ui-icon-pulse" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> <span>Automatická oprava</span></span>';
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
        newProfileRamSlider.addEventListener('input', (e) => {
            newProfileRamValueBadge.textContent = `${e.target.value} GB`;
        });
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
        if (newProfileRamSlider && newProfileRamValueBadge) {
            newProfileRamSlider.value = 4;
            newProfileRamValueBadge.textContent = '4 GB';
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
                showToast('Zadej prosím název nového profilu.', 'error');
                return;
            }

            const ver = dropdownNewVersion ? dropdownNewVersion.getValue() : '26.2';
            const ldr = dropdownNewLoader ? dropdownNewLoader.getValue() : 'vanilla';
            const ram = parseInt(newProfileRamSlider?.value || '4', 10);
            const newId = 'profile-' + Date.now();

            const newProf = {
                id: newId,
                name: rawName,
                version: ver,
                loader: ldr,
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
            showToast(`Profil "${rawName}" byl úspěšně vytvořen!`, 'success');
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

    if (btnImportProfileModalOpen) {
        btnImportProfileModalOpen.addEventListener('click', () => {
            if (modalImportProfile) {
                modalImportProfile.style.display = 'flex';
                currentScannedData = null;
                if (scannedInstancePreview) scannedInstancePreview.style.display = 'none';
                if (importPathLabel) importPathLabel.textContent = 'Zatím nebyla vybrána žádná složka';
                if (btnConfirmImport) btnConfirmImport.disabled = true;
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
            const res = await window.api.importProfileDialog();
            if (res.canceled) return;

            if (res.error) {
                alert('Chyba při čtení složky: ' + res.error);
                return;
            }

            const scan = res.scan;
            currentScannedData = scan;

            if (importPathLabel) importPathLabel.textContent = scan.originalDir;
            if (importProfileNameInput) importProfileNameInput.value = scan.name;
            if (importVersionSelect) {
                if (['26.2', '26.3', '26.1.2'].includes(scan.detectedVersion)) {
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
                    appendLog(`[IMPORT] Profil ${res.profile.name} byl úspěšně importován (${res.importedModCount} módů).`);
                    closeImportModal();
                    await loadConfiguration();
                    renderProfilesList();
                    alert(`Profil byl úspěšně importován!\nPřeneseno ${res.importedModCount} módů a veškerá herní nastavení.`);
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
            btnConfirmUpgrade.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path></svg> Spustit upgrade</span>';
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
                            upgradeResultSummaryText.innerHTML = `
                                <strong>Vytvořen nový profil:</strong> ${escapeHtml(res.profile.name)}<br>
                                <strong>Převedeno:</strong> Herní options.txt, konfigurace módů (config/) a texture packy.<br>
                                <strong>Módy z Modrinthu:</strong> Úspěšně staženo a aktualizováno ${res.upgradedMods.length} módů pro verzi ${targetVer}.
                            `;
                        }

                        if (upgradeResultModsList) {
                            let html = '';
                            if (res.upgradedMods && res.upgradedMods.length > 0) {
                                html += `<div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#86efac; margin-top:8px;"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Automaticky aktualizované módy (${res.upgradedMods.length}):</div>`;
                                html += res.upgradedMods.map(m => `
                                    <div class="result-mod-tag" style="display:flex; align-items:center; gap:6px; background:#132a1e; color:#86efac;">
                                        <svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(m.newFile)} (v${escapeHtml(m.version)})
                                    </div>
                                `).join('');
                            }

                            if (res.missingMods && res.missingMods.length > 0) {
                                html += `<div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#fbbf24; margin-top:10px;"><svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Módy čekající na vydání pro ${escapeHtml(targetVer)} (${res.missingMods.length}):</div>`;
                                html += res.missingMods.map(m => `
                                    <div class="result-mod-tag" style="display:flex; align-items:center; gap:6px; background:#2a2313; color:#fde047;">
                                        <svg class="ui-icon-svg ui-icon-svg--xs ui-icon-svg--gold ui-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> ${escapeHtml(m)} (Zatím bez odpovídající verze)
                                    </div>
                                `).join('');
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
                btnConfirmUpgrade.innerHTML = '<span><svg class="ui-icon-svg ui-icon-svg--sm" viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path></svg> Spustit upgrade</span>';
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
        profileRamSlider.addEventListener('input', (e) => {
            profileRamValueBadge.textContent = `${e.target.value} GB`;
        });
    }

    function openProfileSettingsModal(pid) {
        const profile = (currentConfig.profiles || []).find(p => p.id === pid) || currentConfig.profiles[0];
        if (!profile) return;
        activeSettingsProfileId = pid;

        const titleEl = document.getElementById('profileSettingsModalTitle');
        const nameInput = document.getElementById('profileSettingsNameInput');
        const loaderSelect = document.getElementById('profileSettingsLoaderSelect');
        const deleteSec = document.getElementById('profileDeleteSection');

        if (titleEl) titleEl.textContent = `Nastavení profilu: ${profile.name}`;
        if (nameInput) nameInput.value = profile.name;
        if (loaderSelect) loaderSelect.value = profile.loader || 'vanilla';
        if (profileRamSlider && profileRamValueBadge) {
            profileRamSlider.value = profile.ramMax || currentConfig.ramMax || 4;
            profileRamValueBadge.textContent = `${profileRamSlider.value} GB`;
        }

        if (deleteSec) {
            deleteSec.style.display = (profile.id === 'minecraft-26.2' || profile.id === 'mychalsmp-26.2') ? 'none' : 'flex';
        }

        if (modalProfileSettings) modalProfileSettings.style.display = 'flex';
    }

    function closeProfileSettingsModal() {
        if (modalProfileSettings) modalProfileSettings.style.display = 'none';
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
            const nameInput = document.getElementById('profileSettingsNameInput');
            const loaderSelect = document.getElementById('profileSettingsLoaderSelect');
            const newName = nameInput ? nameInput.value.trim() : '';
            const newRam = profileRamSlider ? parseInt(profileRamSlider.value, 10) : 4;
            const newLoader = loaderSelect ? loaderSelect.value : 'vanilla';

            await window.api.updateProfileSettings(activeSettingsProfileId, {
                name: newName || 'Profil',
                ramMax: newRam,
                loader: newLoader
            });

            showToast('Nastavení profilu bylo uloženo!', 'success');
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
            if (!confirm(`Opravdu chceš smazat profil "${pName}"?`)) return;

            const res = await window.api.deleteProfile(activeSettingsProfileId);
            if (res && res.success) {
                showToast(`Profil "${pName}" byl smazán.`, 'success');
                closeProfileSettingsModal();
                await loadConfiguration();
                renderProfilesList();
            } else {
                alert(res.error || 'Profil se nepodařilo smazat.');
            }
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
                        alert('Data launcheru byla úspěšně smazána a nastavení bylo resetováno.');
                    }, 500);
                } else {
                    alert('Chyba při mazání dat: ' + (res.error || 'Neznámá chyba'));
                }
            } catch (e) {
                alert('Chyba: ' + e.message);
            } finally {
                btnResetLauncherData.disabled = false;
                btnResetLauncherData.innerHTML = '<svg class="ui-icon-svg ui-icon-svg--sm ui-icon-svg--red" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> <span>Smazat data launcheru (Reset)</span>';
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
});
