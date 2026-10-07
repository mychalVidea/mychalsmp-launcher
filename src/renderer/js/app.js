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
            loadModrinthMods();
        } else if (tabId === 'versions') {
            refreshVersionStatuses();
        } else if (tabId === 'servers') {
            renderServersFullTab();
        } else if (tabId === 'character') {
            if (!skinViewer) initSkinViewer3D();
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
        btnManageProfiles.addEventListener('click', () => switchTab('versions'));
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

            // Profile info
            const name = currentConfig.username || 'Steve';
            updateUserUI(name, currentConfig.authType || 'offline', currentConfig.customSkinPath);

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
                autoConnectCheck.checked = currentConfig.autoConnectServer !== false;
            }

            // Resolution
            if (currentConfig.resolution) {
                const resVal = currentConfig.resolution.fullscreen
                    ? 'fullscreen'
                    : `${currentConfig.resolution.width}x${currentConfig.resolution.height}`;
                const radio = document.querySelector(`input[name="res"][value="${resVal}"]`);
                if (radio) radio.checked = true;
            }

            // Render Server Tracker & Profiles
            renderServerTracker();
            renderProfilesList();
            refreshVersionStatuses();
            detectAvailableJavas();
            checkWardenProbe();
            initSkinViewer3D();
            checkLauncherUpdates(true);
        } catch (e) {
            console.error('Chyba při načítání konfigurace:', e);
        }
    }

    function updateUserUI(name, type, customSkin) {
        if (greetingNick) greetingNick.textContent = name;
        if (heroNickLabel) heroNickLabel.textContent = name;
        if (inputNick) inputNick.value = name;

        const isMicrosoft = type === 'microsoft';
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
                badgePill.textContent = '🟢 Microsoft Účet (Mojang)';
                badgePill.className = 'skin-badge-pill pill-microsoft';
            }
            loadMojangCapes();
        } else {
            authOfflineBtn?.classList.add('active');
            authMicrosoftBtn?.classList.remove('active');
            if (panelMs) panelMs.style.display = 'none';
            if (panelOff) panelOff.style.display = 'flex';
            if (badgePill) {
                badgePill.textContent = '🟡 Offline Profil (Uloženo lokálně)';
                badgePill.className = 'skin-badge-pill';
            }
        }

        // Labels for offline paths
        if (skinPathLabel) {
            skinPathLabel.textContent = currentConfig.customSkinPath
                ? currentConfig.customSkinPath.split(/[\/\\]/).pop()
                : 'Výchozí skin';
        }
        if (capePathLabel) {
            capePathLabel.textContent = currentConfig.customCapePath
                ? currentConfig.customCapePath.split(/[\/\\]/).pop()
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
        const avatarUrl = `https://minotar.net/avatar/${encodeURIComponent(name)}/24.png`;

        if (greetingAvatar) greetingAvatar.src = avatarUrl;
        if (skinCaption) skinCaption.textContent = `3D Náhled: ${name}`;

        const effectiveCape = isMicrosoft
            ? null // handled by loadMojangCapes
            : (currentConfig.customCapePath ? (currentConfig.customCapePath.startsWith('http') || currentConfig.customCapePath.startsWith('file://') ? currentConfig.customCapePath : `file://${currentConfig.customCapePath}`) : null);

        if (effectiveSkin) {
            const skinSrc = (effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://'))
                ? effectiveSkin
                : `file://${effectiveSkin}`;
            drawSkinToCanvas(skinSrc, isSlim);
            updateSkinViewer3D(skinSrc, effectiveCape, isSlim);
        } else {
            const minotarSkin = `https://minotar.net/skin/${encodeURIComponent(name)}`;
            drawSkinToCanvas(minotarSkin, isSlim);
            updateSkinViewer3D(minotarSkin, effectiveCape, isSlim);
        }
    }

    // ── Version Statuses ────────────────────────────────────────────────────
    async function refreshVersionStatuses() {
        try {
            installedVersions = await window.api.getInstalledVersions();
            const is262 = installedVersions.includes('26.2');
            const is263 = installedVersions.includes('26.3');
            const is2612 = installedVersions.includes('26.1.2');

            const s262 = document.getElementById('vStatus262');
            if (s262) s262.textContent = is262 ? '✓ Nainstalováno lokálně' : 'Připraveno ke stažení';

            const s263 = document.getElementById('vStatus263');
            if (s263) s263.textContent = is263 ? '✓ Nainstalováno lokálně' : 'Připraveno ke stažení';

            const s2612 = document.getElementById('vStatus2612');
            if (s2612) s2612.textContent = is2612 ? '✓ Nainstalováno lokálně' : 'Připraveno ke stažení';
        } catch (e) {}
    }

    // ── Server Tracker Rendering ────────────────────────────────────────────
    function renderServerTracker() {
        if (!trackedServersList) return;
        const servers = currentConfig.servers || [];

        trackedServersList.innerHTML = servers.map(s => `
            <div class="tracked-server-item">
                <img src="${s.ip.includes('mychalsmp') ? 'assets/server-icon.png' : 'assets/server-icon.png'}" class="item-server-icon">
                <div class="item-info">
                    <div class="item-name">${escapeHtml(s.name)}</div>
                    <div class="item-ip">${escapeHtml(s.ip)}</div>
                </div>
                <button class="btn-quick-join" data-server="${escapeHtml(s.ip)}" title="Rychlé připojení">
                    ▶ Join
                </button>
            </div>
        `).join('');

        // Bind quick join buttons
        trackedServersList.querySelectorAll('.btn-quick-join').forEach(btn => {
            btn.addEventListener('click', () => {
                const srv = btn.dataset.server;
                startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', srv);
            });
        });
    }

    function renderServersFullTab() {
        const fullList = document.getElementById('serversFullList');
        if (!fullList) return;
        const servers = currentConfig.servers || [];

        fullList.innerHTML = servers.map(s => `
            <div class="server-full-card">
                <img src="assets/server-icon.png" class="server-full-icon">
                <div class="server-full-info">
                    <div class="server-full-name">${escapeHtml(s.name)}</div>
                    <div class="server-full-ip">${escapeHtml(s.ip)}</div>
                    <div class="server-full-telemetry">Oficiální síťová infrastruktura MYCHAL SMP • Port: ${s.port || 25565}</div>
                </div>
                <button class="mc-btn mc-btn-green btn-quick-join" data-server="${escapeHtml(s.ip)}">
                    <span>⚡ Quick Play</span>
                </button>
            </div>
        `).join('');

        fullList.querySelectorAll('.btn-quick-join').forEach(btn => {
            btn.addEventListener('click', () => {
                const srv = btn.dataset.server;
                startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', srv);
            });
        });
    }

    if (btnAddCustomServer) {
        btnAddCustomServer.addEventListener('click', async () => {
            const ip = prompt('Zadej IP adresu Minecraft serveru (např. mc.example.com):');
            if (!ip || !ip.trim()) return;
            const name = prompt('Zadej název serveru:') || ip.trim();

            const newServer = {
                id: 'srv-' + Date.now(),
                name: name.trim(),
                ip: ip.trim(),
                port: 25565,
                pinned: false,
                lastJoined: Date.now()
            };

            const updated = [...(currentConfig.servers || []), newServer];
            await window.api.saveConfig({ servers: updated });
            currentConfig.servers = updated;
            renderServerTracker();
            renderServersFullTab();
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
                            <span class="illegal-mod-file">📁 ${escapeHtml(m.filename)}</span>
                            <span class="illegal-mod-reason">⚠️ ${escapeHtml(m.reason)}</span>
                        </div>
                        <button class="btn-disable-single-mod" data-filename="${escapeHtml(m.filename)}">Zakázat (.disabled)</button>
                    </div>
                `).join('');

                list.querySelectorAll('.btn-disable-single-mod').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const fn = btn.dataset.filename;
                        btn.disabled = true;
                        btn.textContent = '⏳ Zakazuji...';
                        await window.api.disableIllegalMods(currentConfig.activeProfileId, fn);
                        showToast(`✓ Mód ${fn} byl přejmenován na .disabled`, 'info');
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

    const btnCleanIllegalMods = document.getElementById('btnCleanIllegalMods');
    if (btnCleanIllegalMods) {
        btnCleanIllegalMods.addEventListener('click', async () => {
            btnCleanIllegalMods.disabled = true;
            btnCleanIllegalMods.textContent = '⏳ Zakazuji módy...';
            try {
                const res = await window.api.disableIllegalMods(currentConfig.activeProfileId, null);
                showToast(`✓ Všechny nepovolené módy (${res.disabledCount}) byly přejmenovány na .disabled!`, 'success');
                appendLog(`Zakázáno ${res.disabledCount} nepovolených módů z profilu.`);
                closeWardenModal();
                await checkWardenProbe();
            } catch (e) {
                showToast('Chyba: ' + e.message, 'error');
            } finally {
                btnCleanIllegalMods.disabled = false;
                btnCleanIllegalMods.innerHTML = '<span>🧹 Zakázat tyto módy a odemknout Quick Play</span>';
            }
        });
    }

    // ── Quick Play MYCHAL SMP Banner ────────────────────────────────────────
    if (btnQuickPlayMychal) {
        btnQuickPlayMychal.addEventListener('click', async () => {
            if (currentIllegalMods.length > 0) {
                showToast('🛡️ Quick Play zablokován: Nalezeny nepovolené módy v profilu!', 'error');
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
                    showToast('Launcher je aktuální (verze ' + (update.currentVersion || '1.0.0') + ')', 'info');
                }
            }
        } catch (e) {
            console.error('[AUTO-UPDATE] Kontrola aktualizací selhala:', e);
        }
    }

    function openUpdateModal(update) {
        const modal = document.getElementById('updateModal');
        const title = document.getElementById('updateModalTitle');
        const desc = document.getElementById('updateModalDesc');
        const notes = document.getElementById('updateReleaseNotes');
        if (!modal) return;

        if (title) title.textContent = `Dostupná verze v${update.latestVersion || ''}`;
        if (desc) desc.textContent = `Byla vydána nová verze MYCHAL SMP Launcheru (máš nainstalovanou v${update.currentVersion || '1.0.0'}). Chceš aktualizaci stáhnout a nainstalovat?`;

        if (notes && update.releaseNotes) {
            notes.textContent = update.releaseNotes;
            notes.style.display = 'block';
        } else if (notes) {
            notes.style.display = 'none';
        }

        modal.style.display = 'flex';
    }

    function closeUpdateModal() {
        const modal = document.getElementById('updateModal');
        if (modal) modal.style.display = 'none';
    }

    const btnUpdateChip = document.getElementById('btnUpdateChip');
    if (btnUpdateChip) {
        btnUpdateChip.addEventListener('click', () => {
            if (pendingUpdateData) {
                openUpdateModal(pendingUpdateData);
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
            if (!pendingUpdateData) return;
            btnConfirmUpdate.disabled = true;
            btnConfirmUpdate.innerHTML = '<span>⏳ Stahuji aktualizaci...</span>';

            try {
                const assets = pendingUpdateData.assets || [];
                const tarAsset = assets.find(a => a.name.endsWith('.tar.gz'));
                const downloadUrl = tarAsset ? tarAsset.downloadUrl : (assets[0] ? assets[0].downloadUrl : pendingUpdateData.releaseUrl);

                const res = await window.api.applyUpdate(downloadUrl);
                if (res && res.applied) {
                    showToast('✓ ' + res.message, 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                } else if (res && res.openedInBrowser) {
                    showToast('Odkaz na stažení byl otevřen v prohlížeči.', 'info');
                    closeUpdateModal();
                }
            } catch (err) {
                showToast('Chyba při aktualizaci: ' + err.message, 'error');
            } finally {
                btnConfirmUpdate.disabled = false;
                btnConfirmUpdate.innerHTML = '<span>⬇️ Aktualizovat nyní</span>';
            }
        });
    }

    // ── Profile List Rendering & Interactive Selection ──────────────────────
    function renderProfilesList() {
        const list = document.getElementById('profileCardsList');
        if (!list) return;

        const profiles = currentConfig.profiles || [];
        const activeId = currentConfig.activeProfileId || (profiles[0] ? profiles[0].id : 'minecraft-26.2');

        list.innerHTML = profiles.map(p => {
            const isActive = p.id === activeId;
            const iconSymbol = p.icon === 'sword' ? '⚔️' :
                               p.icon === 'latest' ? '✨' :
                               p.icon === 'chest' ? '📦' :
                               p.icon === 'upgrade' ? '⚡' :
                               p.icon === 'import' ? '📥' : '🎮';

            const badgeClass = (p.id === 'minecraft-26.2' || p.id === 'mychalsmp-26.2') ? 'p-recommended' :
                               p.version === '26.3' ? 'p-latest' :
                               p.icon === 'upgrade' ? 'p-upgrade' :
                               p.icon === 'import' ? 'p-imported' : 'p-vanilla';

            const badgeText = (p.id === 'minecraft-26.2' || p.id === 'mychalsmp-26.2') ? 'Doporučeno 26.2' :
                              p.version === '26.3' ? 'Nejnovější 26.3' :
                              p.icon === 'upgrade' ? `Upgrade (${p.version})` :
                              p.icon === 'import' ? `Import (${p.version})` : `Verze ${p.version}`;

            const playedText = p.lastPlayed ? `Hrál: ${formatLastPlayed(p.lastPlayed)}` : 'Zatím nehráno';
            const loaderTag = (p.loader && p.loader !== 'vanilla') ? `${p.loader.charAt(0).toUpperCase() + p.loader.slice(1)} • ` : '';
            const meta = `${loaderTag}${p.version} • ${playedText}`;

            // Upgrade button is ONLY displayed for versions older than the latest (26.3)
            const canUpgrade = p.version !== '26.3' && p.version !== '26.4';
            const upgradeBtnHtml = canUpgrade ? `
                <button class="btn-upgrade-profile" data-profile-id="${escapeHtml(p.id)}" title="Upgradovat profil a stáhnout nové verze módů">
                    ⚡ Upgrade
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
                        <button class="mc-btn mc-btn-green btn-launch-profile" data-profile-id="${escapeHtml(p.id)}">
                            <span>▶ Hrát</span>
                        </button>
                        <button class="mc-btn mc-btn-secondary btn-profile-settings" data-profile-id="${escapeHtml(p.id)}" title="Nastavení profilu">⚙</button>
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
                startLaunch(pid, currentConfig.autoConnectServer ? 'mychalsmp.xyz' : null);
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
        window.api.saveConfig({ activeProfileId: profileId });
        checkWardenProbe();

        document.querySelectorAll('.profile-row-card').forEach(c => {
            if (c.dataset.profileId === profileId) {
                c.classList.add('active-profile');
            } else {
                c.classList.remove('active-profile');
            }
        });

        const p = (currentConfig.profiles || []).find(x => x.id === profileId);
        if (p) {
            appendLog(`[PROFIL] Aktivován profil: ${p.name} (${p.version})`);
        }
    }

    if (sidebarPlayBtn) {
        sidebarPlayBtn.addEventListener('click', () => {
            startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', currentConfig.autoConnectServer ? 'mychalsmp.xyz' : null);
        });
    }

    // Version tab installer buttons
    document.querySelectorAll('.btn-install-v').forEach(btn => {
        btn.addEventListener('click', async () => {
            const ver = btn.dataset.version;
            const matchedProfile = (currentConfig.profiles || []).find(p => p.version === ver);
            const pid = matchedProfile ? matchedProfile.id : (currentConfig.activeProfileId || 'minecraft-26.2');
            selectActiveProfile(pid);
            appendLog(`[PROFIL] Spouštím instalaci / hraní verze ${ver}...`);
            startLaunch(pid, currentConfig.autoConnectServer ? 'mychalsmp.xyz' : null);
        });
    });

    const btnCancelDownload = document.getElementById('btnCancelDownload');
    if (btnCancelDownload) {
        btnCancelDownload.addEventListener('click', async () => {
            appendLog('[LAUNCHER] Stahování / spuštění bylo zrušeno uživatelem.');
            await window.api.killGame();
            resetPlayState();
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
        });
    }

    // ── Launch Minecraft ────────────────────────────────────────────────────
    async function startLaunch(profileId, serverIp) {
        if (isRunning) {
            if (confirm('Chceš ukončit běžící Minecraft proces?')) {
                await window.api.killGame();
                resetPlayState();
            }
            return;
        }

        if (isLaunching) return;

        isLaunching = true;
        if (sidebarPlayBtn) sidebarPlayBtn.style.opacity = '0.5';

        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = '10%';
            if (progressPercent) progressPercent.textContent = '10%';
            if (progressText) progressText.textContent = 'Příprava herních dat a knihoven...';
        }

        appendLog(`[LAUNCHER] Zahajuji spuštění profilu ${profileId || 'aktivní'}...`);
        if (sideConsoleStatus) sideConsoleStatus.textContent = 'Připravuji herní data a knihovny...';

        try {
            const res = await window.api.launchGame(profileId, serverIp);
            if (res && res.success) {
                isRunning = true;
                isLaunching = false;
                if (sidebarPlayBtn) {
                    sidebarPlayBtn.style.opacity = '1';
                    sidebarPlayBtn.style.background = '#ef4444';
                    sidebarPlayBtn.querySelector('span').textContent = '■';
                }
                const activeCard = document.querySelector(`.profile-row-card[data-profile-id="${profileId || currentConfig.activeProfileId}"]`);
                if (activeCard) {
                    const btn = activeCard.querySelector('.btn-launch-profile');
                    if (btn) {
                        btn.innerHTML = '<span>■ Stop</span>';
                        btn.classList.remove('mc-btn-green');
                        btn.classList.add('mc-btn-red');
                    }
                }
                if (sideConsoleStatus) sideConsoleStatus.textContent = 'Hra úspěšně běží!';
                appendLog('[LAUNCHER] Instance Minecraftu byla úspěšně spuštěna.');
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
        if (sidebarPlayBtn) {
            sidebarPlayBtn.style.opacity = '1';
            sidebarPlayBtn.style.background = '#22c55e';
            sidebarPlayBtn.querySelector('span').textContent = '▶';
        }
        document.querySelectorAll('.btn-launch-profile').forEach(btn => {
            btn.innerHTML = '<span>▶ Hrát</span>';
            btn.classList.remove('mc-btn-red');
            btn.classList.add('mc-btn-green');
        });
        if (sideConsoleStatus) sideConsoleStatus.textContent = 'Klient je připraven.';
    }

    // ── Modrinth Catalog Browsing (Mods, Resourcepacks & Shaders) ──────────
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

    async function loadModrinthMods() {
        if (!modsCardsList) return;
        const typeLabels = { mod: 'mody', resourcepack: 'resource packy', shader: 'shadery' };
        const label = typeLabels[currentModFilter.projectType] || 'položky';
        modsCardsList.innerHTML = `<div class="mods-loading">Načítám ${label} z katalogu Modrinth...</div>`;

        try {
            const mods = await window.api.searchModrinth(
                currentModFilter.query,
                currentModFilter.version,
                currentModFilter.loader,
                currentModFilter.category,
                currentModFilter.projectType || 'mod'
            );

            renderModCards(mods);
        } catch (e) {
            modsCardsList.innerHTML = `<div class="mods-loading">Nepodařilo se načíst data z katalogu.</div>`;
        }
    }

    function renderModCards(mods) {
        if (!modsCardsList) return;
        if (!mods || mods.length === 0) {
            modsCardsList.innerHTML = `<div class="mods-loading">Nenalezeny žádné položky odpovídající hledání.</div>`;
            return;
        }

        const installedList = currentConfig.installedMods || [];

        modsCardsList.innerHTML = mods.map(m => {
            const isInstalled = installedList.includes(m.id) || m.installed;
            const downloadsFormatted = m.downloads > 1000000
                ? (m.downloads / 1000000).toFixed(1) + 'M'
                : (m.downloads / 1000).toFixed(0) + 'k';

            return `
                <div class="mod-card-row">
                    <img src="${escapeHtml(m.icon_url)}" class="mod-avatar" onerror="this.src='assets/server-icon.png'">
                    <div class="mod-info-area">
                        <div class="mod-name-row">
                            <span class="mod-name-title">${escapeHtml(m.title)}</span>
                            <span class="mod-author-lbl">od ${escapeHtml(m.author)}</span>
                        </div>
                        <div class="mod-desc-text">${escapeHtml(m.description)}</div>
                        <div class="mod-stats-row">
                            <span>⬇ ${downloadsFormatted} stažení</span>
                            <span>❤️ ${(m.follows || 1000).toLocaleString()} oblíbení</span>
                            <span>Verze: ${currentModFilter.version}</span>
                        </div>
                    </div>
                    <button class="mc-btn ${isInstalled ? 'btn-download-success' : 'mc-btn-green'} btn-toggle-mod" data-mod="${escapeHtml(m.id)}">
                        <span>${isInstalled ? '✓ NAINSTALOVÁNO' : '📥 STÁHNOUT'}</span>
                    </button>
                </div>
            `;
        }).join('');

        // Bind interactive download with real feedback animations
        modsCardsList.querySelectorAll('.btn-toggle-mod').forEach(btn => {
            btn.addEventListener('click', async () => {
                const modId = btn.dataset.mod;
                const modItem = (mods || []).find(x => x.id === modId);
                const title = modItem ? modItem.title : modId;

                // Micro-animation: Button spinner state
                btn.disabled = true;
                btn.classList.add('btn-downloading');
                btn.innerHTML = `<span class="spinner-inline">⏳</span> <span>Stahuji...</span>`;

                try {
                    const res = await window.api.downloadModOrPack({
                        id: modId,
                        title: title,
                        projectType: currentModFilter.projectType || 'mod',
                        version: currentModFilter.version,
                        loader: currentModFilter.loader
                    });

                    if (res && res.success) {
                        btn.classList.remove('btn-downloading');
                        btn.classList.add('btn-download-success');
                        btn.innerHTML = `<span class="checkmark-anim">✓</span> <span>STAŽENO</span>`;

                        const sub = res.subfolder || 'mods';
                        showToast(`✓ ${title} byl úspěšně stažen do ${sub}/!`, 'success');
                        appendLog(`[DOWNLOAD] Soubor ${res.filename} stažen do složky ${sub}/.`);

                        const updatedList = await window.api.toggleMod(modId);
                        currentConfig.installedMods = updatedList;
                        await checkWardenProbe();
                    } else {
                        btn.classList.remove('btn-downloading');
                        btn.innerHTML = `<span>⚠️ Chyba</span>`;
                        showToast(`Chyba při stahování: ${res.error || 'Neznámá chyba'}`, 'error');
                    }
                } catch (e) {
                    btn.classList.remove('btn-downloading');
                    btn.innerHTML = `<span>⚠️ Chyba</span>`;
                    showToast(`Chyba: ${e.message}`, 'error');
                } finally {
                    setTimeout(() => {
                        btn.disabled = false;
                    }, 1200);
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

    // ── 3D Skin Viewer (skinview3d) Integration ────────────────────────────
    let skinViewer = null;
    let isBackEquipmentElytra = false;
    let isFlyingAnimationActive = false;
    let isAutoRotateActive = false;
    let lastLoadedSkinUrl = null;
    let lastLoadedCapeUrl = null;

    function initSkinViewer3D() {
        const canvas3D = document.getElementById('skinCanvas3D');
        if (!canvas3D || !window.skinview3d) return;

        try {
            skinViewer = new window.skinview3d.SkinViewer({
                canvas: canvas3D,
                width: 200,
                height: 300,
                model: currentConfig.customSkinVariant === 'slim' ? 'slim' : 'default'
            });

            skinViewer.camera.position.set(0, 0, 70);
            skinViewer.zoom = 0.95;
            skinViewer.fov = 48;
            skinViewer.controls.enableRotate = true;
            skinViewer.controls.enableZoom = true;
            skinViewer.controls.enablePan = false;
            skinViewer.animation = new window.skinview3d.IdleAnimation();

            // 3D Toolbar Buttons
            const btnFront = document.getElementById('btn3DFrontView');
            const btnBack = document.getElementById('btn3DBackView');
            const btnRotate = document.getElementById('btn3DRotateToggle');
            const btnElytra = document.getElementById('btn3DElytraToggle');
            const btnFlying = document.getElementById('btn3DFlyingToggle');
            const labelElytra = document.getElementById('label3DElytra');
            const labelFlying = document.getElementById('label3DFlying');

            if (btnFront) {
                btnFront.addEventListener('click', () => {
                    if (!skinViewer) return;
                    skinViewer.playerObject.rotation.y = 0;
                    btnFront.classList.add('active');
                    if (btnBack) btnBack.classList.remove('active');
                });
            }

            if (btnBack) {
                btnBack.addEventListener('click', () => {
                    if (!skinViewer) return;
                    // Rotate 180 deg to view cape / elytra from back
                    skinViewer.playerObject.rotation.y = Math.PI;
                    btnBack.classList.add('active');
                    if (btnFront) btnFront.classList.remove('active');
                });
            }

            if (btnRotate) {
                btnRotate.addEventListener('click', () => {
                    if (!skinViewer) return;
                    isAutoRotateActive = !isAutoRotateActive;
                    skinViewer.autoRotate = isAutoRotateActive;
                    skinViewer.autoRotateSpeed = 1.8;
                    btnRotate.classList.toggle('active', isAutoRotateActive);
                });
            }

            if (btnElytra) {
                btnElytra.addEventListener('click', () => {
                    if (!skinViewer) return;
                    isBackEquipmentElytra = !isBackEquipmentElytra;
                    skinViewer.playerObject.backEquipment = isBackEquipmentElytra ? 'elytra' : 'cape';
                    if (labelElytra) labelElytra.textContent = isBackEquipmentElytra ? '🧥 Plášť' : '🪽 Elytra';
                    btnElytra.classList.toggle('active', isBackEquipmentElytra);
                });
            }

            if (btnFlying) {
                btnFlying.addEventListener('click', () => {
                    if (!skinViewer) return;
                    isFlyingAnimationActive = !isFlyingAnimationActive;
                    if (isFlyingAnimationActive) {
                        skinViewer.animation = new window.skinview3d.FlyingAnimation();
                        if (labelFlying) labelFlying.textContent = '🧍 Postavit';
                        btnFlying.classList.add('active');
                    } else {
                        skinViewer.animation = new window.skinview3d.IdleAnimation();
                        if (labelFlying) labelFlying.textContent = '🚀 Létání';
                        btnFlying.classList.remove('active');
                    }
                });
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
                skinViewer.loadSkin(skinUrl, { model: isSlim ? 'slim' : 'default' });
            }

            if (capeUrl) {
                lastLoadedCapeUrl = capeUrl;
                skinViewer.loadCape(capeUrl, { backEquipment: isBackEquipmentElytra ? 'elytra' : 'cape' });
            } else if (capeUrl === null) {
                lastLoadedCapeUrl = null;
                skinViewer.loadCape(null);
            }
        } catch (e) {
            console.warn('[3D VIEWER] Chyba aktualizace skinu/pláště v 3D:', e);
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

            canvas.style.display = 'block';
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

    // ── Mojang Capes Fetcher & Renderer ─────────────────────────────────────
    async function loadMojangCapes() {
        const container = document.getElementById('mojangCapesList');
        const equippedBadge = document.getElementById('equippedCapeBadge');
        const equippedName = document.getElementById('equippedCapeName');
        if (!container) return;

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
                container.innerHTML = capes.map(c => {
                    const isActive = c.state === 'ACTIVE';
                    if (isActive) activeCapeFound = c;
                    return `
                        <div class="cape-item-card ${isActive ? 'active-cape' : ''}" data-cape-id="${escapeHtml(c.id)}" title="${escapeHtml(c.alias || 'Plášť')}">
                            <img src="${escapeHtml(c.url)}" class="cape-item-thumb" alt="Cape">
                            <span class="cape-item-name">${escapeHtml(c.alias || 'Plášť')}</span>
                        </div>
                    `;
                }).join('');

                if (equippedBadge && equippedName) {
                    if (activeCapeFound) {
                        equippedBadge.style.display = 'block';
                        equippedName.textContent = activeCapeFound.alias || 'Aktivní plášť';
                        updateSkinViewer3D(lastLoadedSkinUrl, activeCapeFound.url, currentConfig.customSkinVariant === 'slim');
                    } else {
                        equippedBadge.style.display = 'none';
                        updateSkinViewer3D(lastLoadedSkinUrl, null, currentConfig.customSkinVariant === 'slim');
                    }
                }

                // Bind click to equip cape on Mojang account
                container.querySelectorAll('.cape-item-card').forEach(card => {
                    card.addEventListener('click', async () => {
                        const capeId = card.dataset.capeId;
                        showToast('⏳ Nastavuji plášť na Mojang účtu...', 'info');
                        const equipRes = await window.api.setMojangCape(capeId);
                        if (equipRes && equipRes.success) {
                            showToast('✓ Plášť byl úspěšně aktivován na tvém Mojang účtu!', 'success');
                            await loadMojangCapes();
                        } else {
                            showToast('Chyba při nastavování pláště: ' + (equipRes.error || 'Neznámá chyba'), 'error');
                        }
                    });
                });
            } else {
                container.innerHTML = `<div class="cape-loading-hint">Pláště nelze načíst (${res.error || 'Nepřihlášen'}).</div>`;
            }
        } catch (e) {
            container.innerHTML = `<div class="cape-loading-hint">Chyba při načítání plášťů.</div>`;
        }
    }

    // ── Character & Skin Handlers ───────────────────────────────────────────
    let nickDebounce = null;
    if (inputNick) {
        inputNick.addEventListener('input', (e) => {
            clearTimeout(nickDebounce);
            const val = e.target.value.trim() || 'Steve';
            nickDebounce = setTimeout(() => {
                if (skinCaption) skinCaption.textContent = `Náhled: ${val}`;
                // Only fallback to minotar if no custom skin is set
                if (!currentConfig.customSkinPath && currentConfig.authType !== 'microsoft') {
                    const minotarSkin = `https://minotar.net/skin/${encodeURIComponent(val)}`;
                    drawSkinToCanvas(minotarSkin, currentConfig.customSkinVariant === 'slim');
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
            updateUserUI(currentConfig.username, currentConfig.authType, currentConfig.customSkinPath);
        });
        btnVariantSlim.addEventListener('click', async () => {
            currentConfig.customSkinVariant = 'slim';
            btnVariantSlim.classList.add('active');
            btnVariantClassic.classList.remove('active');
            await window.api.saveOfflineSkin({ variant: 'slim' });
            updateUserUI(currentConfig.username, currentConfig.authType, currentConfig.customSkinPath);
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
            btnUploadMojangSkin.innerHTML = '<span>⏳ Nahrávám na Mojang účet...</span>';

            try {
                const res = await window.api.uploadMojangSkin(filePath, variant);
                if (res && res.success) {
                    showToast('✓ Skin byl úspěšně nahrán a uložen na tvůj oficiální Mojang účet!', 'success');
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
                btnUploadMojangSkin.innerHTML = '<span>☁️ Nahrát skin na Mojang účet</span>';
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
                showToast('✓ Skin byl resetován na výchozí.', 'success');
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
                showToast('✓ Plášť byl skryt na tvém Mojang účtu.', 'success');
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
                showToast('✓ Offline skin byl uložen v launcheru!', 'success');
                appendLog(`[SKIN] Vlastní offline skin nastaven: ${destPath}`);
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
                showToast('✓ Offline plášť byl uložen v launcheru!', 'success');
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
            showToast('✓ Offline plášť byl odebrán.', 'info');
        });
    }

    // Offline / Warez: Save character nick & config
    if (btnSaveCharacter) {
        btnSaveCharacter.addEventListener('click', async () => {
            const nick = inputNick.value.trim() || 'Steve';
            const res = await window.api.loginOffline(nick);
            if (res && res.success) {
                currentConfig.username = nick;
                currentConfig.authType = 'offline';
                // Note: customSkinPath is kept!
                updateUserUI(nick, 'offline', currentConfig.customSkinPath);
                temporaryButtonText(btnSaveCharacter, '✓ Postava uložena!');
                showToast(`✓ Postava "${nick}" byla uložena s tvým skinem!`, 'success');
            }
        });
    }

    // Microsoft Account Interactive Login
    if (authMicrosoftBtn) {
        authMicrosoftBtn.addEventListener('click', async () => {
            authMicrosoftBtn.disabled = true;
            const originalText = authMicrosoftBtn.textContent;
            authMicrosoftBtn.textContent = '⏳ Čekám na Microsoft...';
            appendLog('[AUTH] Otevírám oficiální Microsoft přihlašovací okno...');

            try {
                const res = await window.api.loginMicrosoft();
                if (res && res.success) {
                    currentConfig.username = res.profile.name;
                    currentConfig.authType = 'microsoft';
                    currentConfig.microsoftAccount = res.auth;
                    updateUserUI(res.profile.name, 'microsoft', res.profile.skinUrl);
                    appendLog(`[AUTH] Úspěšné přihlášení Microsoft účtu: ${res.profile.name}`);
                    showToast(`✓ Úspěšně přihlášen Microsoft účet: ${res.profile.name}`, 'success');
                } else {
                    appendLog(`[AUTH] Přihlášení k Microsoft účtu selhalo: ${res.error || 'Zrušeno'}`);
                    showToast(`Přihlášení k Microsoft účtu: ${res.error || 'Bylo zrušeno'}`, 'error');
                }
            } catch (err) {
                appendLog(`[AUTH] Chyba při přihlašování: ${err.message}`);
            } finally {
                authMicrosoftBtn.disabled = false;
                authMicrosoftBtn.textContent = originalText;
            }
        });
    }

    // Offline Account Switcher
    if (authOfflineBtn) {
        authOfflineBtn.addEventListener('click', async () => {
            const nick = (inputNick ? inputNick.value.trim() : '') || currentConfig.username || 'Steve';
            const res = await window.api.loginOffline(nick);
            if (res && res.success) {
                currentConfig.username = nick;
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
                            if (javaPathInput) javaPathInput.value = pill.dataset.path;
                        });
                    });

                    if (sideJavaBadge) {
                        sideJavaBadge.textContent = list[0].label.includes('25') ? 'Java 25 (LTS)' : 'Java 21 (LTS)';
                    }
                } else {
                    javaDetectedList.innerHTML = `<span class="java-pill">Java 25/21 automatická detekce</span>`;
                }
            }
        } catch (e) {}
    }

    if (btnDetectJava) {
        btnDetectJava.addEventListener('click', async () => {
            const detected = await window.api.detectJava();
            if (javaPathInput) {
                javaPathInput.value = detected || '';
                appendLog(`[JAVA] Detekováno: ${detected}`);
                temporaryButtonText(btnDetectJava, '✓ Detekováno');
            }
        });
    }

    if (ramSlider && ramValueBadge) {
        ramSlider.addEventListener('input', (e) => {
            ramValueBadge.textContent = `${e.target.value} GB`;
        });
    }

    if (btnOpenGameDir) {
        btnOpenGameDir.addEventListener('click', () => window.api.openGameDir());
    }

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            const selectedRes = document.querySelector('input[name="res"]:checked')?.value || '1280x720';
            let resObj = { width: 1280, height: 720, fullscreen: false };

            if (selectedRes === 'fullscreen') {
                resObj.fullscreen = true;
            } else {
                const parts = selectedRes.split('x');
                resObj.width = parseInt(parts[0], 10) || 1280;
                resObj.height = parseInt(parts[1], 10) || 720;
            }

            const updated = {
                ramMax: parseInt(ramSlider?.value || '4', 10),
                javaPath: javaPathInput?.value.trim() || null,
                autoConnectServer: autoConnectCheck?.checked ?? true,
                resolution: resObj
            };

            await window.api.saveConfig(updated);
            currentConfig = { ...currentConfig, ...updated };
            appendLog('[CONFIG] Nastavení bylo uloženo.');
            temporaryButtonText(btnSaveSettings, '✓ Nastavení uloženo!');
        });
    }

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
        if (!progressContainer) return;
        progressContainer.style.display = 'flex';
        const percent = Math.min(Math.max(data.percent || 0, 0), 100);
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressText) progressText.textContent = data.text || 'Stahuji herní data...';
    });

    window.api.onLog((line) => appendLog(line));

    window.api.onExit((code) => {
        appendLog(`[LAUNCHER] Proces ukončen s kódem ${code}.`);
        resetPlayState();
        setTimeout(() => {
            if (progressContainer && !isRunning && !isLaunching) {
                progressContainer.style.display = 'none';
            }
        }, 3000);
    });

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
                    <span class="stat-pill stat-good">📦 Nalezeno módů: ${scan.modCount}</span>
                    <span class="stat-pill">🎨 Texture packů: ${scan.rpCount}</span>
                    <span class="stat-pill ${scan.hasConfig ? 'stat-good' : ''}">⚙ Nastavení módů: ${scan.hasConfig ? 'Ano' : 'Ne'}</span>
                    <span class="stat-pill ${scan.hasOptions ? 'stat-good' : ''}">🎮 Herní options.txt: ${scan.hasOptions ? 'Ano' : 'Ne'}</span>
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
            btnConfirmImport.textContent = '⏳ Importuji data instance...';

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
                    alert(`✓ Profil byl úspěšně importován!\nPřeneseno ${res.importedModCount} módů a veškerá herní nastavení.`);
                } else {
                    alert('Chyba při importu: ' + res.error);
                }
            } catch (e) {
                alert('Chyba: ' + e.message);
            } finally {
                btnConfirmImport.disabled = false;
                btnConfirmImport.innerHTML = '<span>✓ Dokončit import profilu</span>';
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
            btnConfirmUpgrade.innerHTML = '<span>🚀 Spustit upgrade</span>';
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
            btnConfirmUpgrade.textContent = '⏳ Probíhá upgrade...';
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
                                html += `<div style="font-weight:700; color:#86efac; margin-top:8px;">✓ Automaticky aktualizované módy (${res.upgradedMods.length}):</div>`;
                                html += res.upgradedMods.map(m => `
                                    <div class="result-mod-tag" style="background:#132a1e; color:#86efac;">
                                        ✓ ${escapeHtml(m.newFile)} (v${escapeHtml(m.version)})
                                    </div>
                                `).join('');
                            }

                            if (res.missingMods && res.missingMods.length > 0) {
                                html += `<div style="font-weight:700; color:#fbbf24; margin-top:10px;">⚠️ Módy čekající na vydání pro ${targetVer} (${res.missingMods.length}):</div>`;
                                html += res.missingMods.map(m => `
                                    <div class="result-mod-tag" style="background:#2a2313; color:#fde047;">
                                        ⏳ ${escapeHtml(m)} (Zatím bez odpovídající verze)
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
                btnConfirmUpgrade.innerHTML = '<span>🚀 Spustit upgrade</span>';
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

            showToast('✓ Nastavení profilu bylo uloženo!', 'success');
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
                showToast(`✓ Profil "${pName}" byl smazán.`, 'success');
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
                '⚠️ VAROVÁNÍ: Opravdu chceš smazat veškerá data launcheru?\n\n' +
                'Tato akce vymaže všechny stažené verze, instance, konfigurace a vrátí launcher do výchozího stavu.'
            );
            if (!confirmReset) return;

            btnResetLauncherData.disabled = true;
            btnResetLauncherData.textContent = '⏳ Probíhá mazání dat...';
            appendLog('[RESET] Zahájeno mazání dat launcheru...');

            try {
                const res = await window.api.resetLauncherData();
                if (res && res.success) {
                    showToast('✓ Data launcheru byla smazána a launcher resetován.', 'success');
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
                btnResetLauncherData.textContent = '🗑️ Smazat data launcheru (Reset)';
            }
        });
    }

    // ── Toast System ────────────────────────────────────────────────────────
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast-message ${type === 'error' ? 'toast-error' : type === 'info' ? 'toast-info' : ''}`;
        toast.innerHTML = `
            <span>${type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️'}</span>
            <span>${escapeHtml(message)}</span>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 4000);
    }

    // ── Time Formatter (Real Timestamps, No Fake History) ────────────────────
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
    function temporaryButtonText(btn, tempText, duration = 2000) {
        if (!btn) return;
        const originalText = btn.textContent;
        btn.textContent = tempText;
        setTimeout(() => {
            btn.textContent = originalText;
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
