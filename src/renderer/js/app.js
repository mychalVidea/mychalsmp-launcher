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
            updateCharacterTabSkinPreview();
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

            // System Hardware & RAM detection (up to 80% of system RAM)
            try {
                const sysInfo = await window.api.getSystemInfo();
                if (sysInfo && sysInfo.maxAllowedRamGB) {
                    if (ramSlider) ramSlider.max = sysInfo.maxAllowedRamGB;
                    if (profileRamSlider) profileRamSlider.max = sysInfo.maxAllowedRamGB;
                    const newProfRam = document.getElementById('newProfileRamSlider');
                    if (newProfRam) newProfRam.max = sysInfo.maxAllowedRamGB;

                    const marks = document.querySelector('.slider-marks');
                    if (marks) {
                        marks.innerHTML = `
                            <span>2 GB</span>
                            <span>4 GB (Doporučeno)</span>
                            <span>8 GB</span>
                            <span>${sysInfo.maxAllowedRamGB} GB (Max 80% RAM)</span>
                        `;
                    }
                }
            } catch (sysErr) {
                console.warn('Detekce hardware RAM selhala:', sysErr);
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
            const isPinned = !!s.pinned;
            const backupBadge = isMychal ? '<span class="server-backup-badge" title="Záložní číselná IP při výpadku DNS: 130.61.89.37:25565">Záloha: 130.61.89.37</span>' : '';

            return `
                <div class="tracked-server-item ${isPinned ? 'is-pinned' : ''}">
                    <img src="assets/server-icon.png" class="item-server-icon">
                    <div class="item-info">
                        <div class="item-name">
                            ${escapeHtml(s.name)}
                            ${isPinned ? '<span title="Připnutý server" style="font-size: 11px; margin-left: 4px;">📌</span>' : ''}
                        </div>
                        <div class="item-ip">${escapeHtml(s.ip)}${backupBadge}</div>
                    </div>
                    <div class="tracked-server-actions">
                        <button class="btn-pin-server ${isPinned ? 'pinned' : ''}" data-server-id="${escapeHtml(s.id)}" title="${isPinned ? 'Odepnout server' : 'Připnout server na začátek'}">
                            📌
                        </button>
                        <button class="btn-quick-join" data-server="${escapeHtml(s.ip)}" title="Rychlé připojení">
                            ▶ Join
                        </button>
                        ${!isMychal ? `<button class="btn-del-server" data-server-id="${escapeHtml(s.id)}" title="Smazat server">✕</button>` : ''}
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

        // Bind pin buttons
        trackedServersList.querySelectorAll('.btn-pin-server').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sid = btn.dataset.serverId;
                togglePinServer(sid);
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

            const extraInfo = isMychal
                ? `<div class="server-full-telemetry" style="color: var(--brand-blue);">
                    Oficiální síťová infrastruktura MYCHAL SMP • Port: ${port}
                    <br><span style="color: #94a3b8; font-size: 12px;">🛡️ Záložní IP (Unknown host fallback): <strong style="color: #fff;">130.61.89.37:25565</strong></span>
                   </div>`
                : `<div class="server-full-telemetry">Vlastní přidaný server • Port: ${port}</div>`;

            const backupJoinBtn = isMychal ? `
                <button class="mc-btn mc-btn-secondary btn-quick-join-backup" data-server="130.61.89.37:25565" title="Připojit se přímo přes číselnou záložní IP">
                    <span>🌐 Záložní IP</span>
                </button>
            ` : '';

            return `
                <div class="server-full-card ${isPinned ? 'is-pinned-card' : ''}">
                    <img src="assets/server-icon.png" class="server-full-icon">
                    <div class="server-full-info">
                        <div class="server-full-name">
                            ${escapeHtml(s.name)}
                            ${isPinned ? '<span title="Připnutý server" style="font-size: 14px; margin-left: 6px;">📌 Pinned</span>' : ''}
                        </div>
                        <div class="server-full-ip">${escapeHtml(s.ip)}</div>
                        ${extraInfo}
                    </div>
                    <div class="server-full-actions" style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn-pin-server ${isPinned ? 'pinned' : ''}" data-server-id="${escapeHtml(s.id)}" title="${isPinned ? 'Odepnout server' : 'Připnout server na začátek'}" style="font-size: 16px; padding: 6px 10px;">
                            📌
                        </button>
                        ${backupJoinBtn}
                        <button class="mc-btn mc-btn-green btn-quick-join" data-server="${escapeHtml(s.ip)}">
                            <span>⚡ Quick Play</span>
                        </button>
                        ${!isMychal ? `<button class="mc-btn mc-btn-secondary btn-del-server" data-server-id="${escapeHtml(s.id)}" title="Smazat server" style="color: #ef4444;">✕</button>` : ''}
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

        // Bind backup quick join buttons
        fullList.querySelectorAll('.btn-quick-join-backup').forEach(btn => {
            btn.addEventListener('click', () => {
                const srv = btn.dataset.server;
                appendLog('[SÍŤ] Spouštím Quick Play přímo přes záložní číselnou IP 130.61.89.37:25565...');
                startLaunch(currentConfig.activeProfileId || 'minecraft-26.2', srv);
            });
        });

        // Bind pin buttons
        fullList.querySelectorAll('.btn-pin-server').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sid = btn.dataset.serverId;
                togglePinServer(sid);
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

    async function togglePinServer(serverId) {
        const servers = currentConfig.servers || [];
        const target = servers.find(s => s.id === serverId);
        if (target) {
            target.pinned = !target.pinned;
            await window.api.saveConfig({ servers });
            renderServerTracker();
            renderServersFullTab();
            showToast(target.pinned ? `📌 Server "${target.name}" byl připnut nahoru!` : `Server "${target.name}" byl odepnut.`, 'info');
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

    function openAddServerModal() {
        if (!modalAddServer) return;
        if (newServerNameInput) newServerNameInput.value = '';
        if (newServerIpInput) newServerIpInput.value = '';
        if (newServerPinnedCheck) newServerPinnedCheck.checked = true;
        modalAddServer.style.display = 'flex';
        setTimeout(() => newServerNameInput?.focus(), 50);
    }

    function closeAddServerModal() {
        if (modalAddServer) modalAddServer.style.display = 'none';
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
                lastJoined: Date.now()
            };

            const existing = currentConfig.servers || [];
            currentConfig.servers = [...existing, newServer];
            await window.api.saveConfig({ servers: currentConfig.servers });

            closeAddServerModal();
            renderServerTracker();
            renderServersFullTab();
            showToast(`✓ Server "${rawName}" byl úspěšně přidán${isPinned ? ' a připnut' : ''}!`, 'success');
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

    const btnLaunchWithoutSmp = document.getElementById('btnLaunchWithoutSmp');
    if (btnLaunchWithoutSmp) {
        btnLaunchWithoutSmp.addEventListener('click', () => {
            closeWardenModal();
            appendLog('[PROFIL] Spouštím hru bez připojení k serveru MYCHAL SMP (módy povoleny pro singleplayer a jiné servery)...');
            showToast('🎮 Spouštím hru bez připojení k SMP – módy povoleny.', 'info');
            startLaunch(currentConfig.activeProfileId, null);
        });
    }

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
                    setTimeout(async () => {
                        try {
                            await window.api.restartLauncher();
                        } catch (e) {
                            window.location.reload();
                        }
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

        const hasAnyPlayed = profiles.some(p => p.lastPlayed);
        const headingTitle = document.getElementById('profilesSectionTitle');
        const headingIcon = document.getElementById('profilesSectionIcon');
        if (headingTitle) {
            headingTitle.textContent = hasAnyPlayed ? 'Naposledy hrané profily' : 'Dostupné herní profily';
        }
        if (headingIcon) {
            headingIcon.textContent = hasAnyPlayed ? '🕒' : '🎮';
        }

        list.innerHTML = profiles.map(p => {
            const isActive = p.id === activeId;
            const iconSymbol = p.icon === 'sword' ? '⚔️' :
                               p.icon === 'latest' ? '✨' :
                               p.icon === 'chest' ? '📦' :
                               p.icon === 'upgrade' ? '⚡' :
                               p.icon === 'import' ? '📥' :
                               p.icon === 'shield' ? '🛡️' :
                               p.icon === 'rocket' ? '🚀' : '🎮';

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

        let actualServerIp = serverIp;
        if (actualServerIp && (actualServerIp.includes('mychalsmp.xyz') || actualServerIp.includes('mychalsmp'))) {
            if (currentIllegalMods && currentIllegalMods.length > 0) {
                // If launch wasn't explicitly triggered from quick play, don't block the user, simply launch without connecting to SMP
                actualServerIp = null;
                showToast('🛡️ Připojení na MYCHAL SMP přeskočeno (profil obsahuje nepovolené módy pro SMP). Hra spuštěna bez serveru.', 'info');
                appendLog('[BEZPEČNOST] Quick Play na MYCHAL SMP přeskočen z důvodu nepovolených módů v profilu. Hra spuštěna bez automatického připojení k serveru.');
            }
        }

        try {
            const res = await window.api.launchGame(profileId, actualServerIp);
            if (res && res.success) {
                isRunning = true;
                isLaunching = false;

                // Record real lastPlayed timestamp for profile
                const targetPid = profileId || currentConfig.activeProfileId;
                const launchedProfile = (currentConfig.profiles || []).find(x => x.id === targetPid);
                if (launchedProfile) {
                    launchedProfile.lastPlayed = Date.now();
                    window.api.saveConfig({ profiles: currentConfig.profiles });
                    renderProfilesList();
                }

                if (sidebarPlayBtn) {
                    sidebarPlayBtn.style.opacity = '1';
                    sidebarPlayBtn.style.background = '#ef4444';
                    sidebarPlayBtn.querySelector('span').textContent = '■';
                }
                const activeCard = document.querySelector(`.profile-row-card[data-profile-id="${targetPid}"]`);
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
            } else if (res && res.blockedByWarden) {
                appendLog(`[BEZPEČNOST] ${res.error}`);
                showToast('🛡️ Quick Play na MYCHAL SMP zablokován: Nalezeny nepovolené módy.', 'error');
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
                btnFront.onclick = () => {
                    if (!skinViewer) return;
                    isAutoRotateActive = false;
                    skinViewer.autoRotate = false;
                    if (btnRotate) btnRotate.classList.remove('active');
                    skinViewer.resetCameraPose();
                    skinViewer.playerWrapper.rotation.set(0, 0, 0);
                    skinViewer.playerObject.rotation.set(0, 0, 0);
                    btnFront.classList.add('active');
                    if (btnBack) btnBack.classList.remove('active');
                };
            }

            if (btnBack) {
                btnBack.onclick = () => {
                    if (!skinViewer) return;
                    isAutoRotateActive = false;
                    skinViewer.autoRotate = false;
                    if (btnRotate) btnRotate.classList.remove('active');
                    skinViewer.resetCameraPose();
                    skinViewer.playerWrapper.rotation.set(0, Math.PI, 0);
                    skinViewer.playerObject.rotation.set(0, 0, 0);
                    btnBack.classList.add('active');
                    if (btnFront) btnFront.classList.remove('active');
                };
            }

            if (btnRotate) {
                btnRotate.onclick = () => {
                    if (!skinViewer) return;
                    isAutoRotateActive = !isAutoRotateActive;
                    skinViewer.autoRotate = isAutoRotateActive;
                    skinViewer.autoRotateSpeed = 1.8;
                    btnRotate.classList.toggle('active', isAutoRotateActive);
                    if (isAutoRotateActive) {
                        if (btnFront) btnFront.classList.remove('active');
                        if (btnBack) btnBack.classList.remove('active');
                    }
                };
            }

            if (btnElytra) {
                btnElytra.onclick = () => {
                    if (!skinViewer) return;
                    isBackEquipmentElytra = !isBackEquipmentElytra;
                    skinViewer.playerObject.backEquipment = isBackEquipmentElytra ? 'elytra' : 'cape';
                    if (labelElytra) labelElytra.textContent = isBackEquipmentElytra ? '🧥 Plášť' : '🪽 Elytra';
                    btnElytra.classList.toggle('active', isBackEquipmentElytra);
                };
            }

            if (btnFlying) {
                btnFlying.onclick = () => {
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

    function updateCharacterTabSkinPreview() {
        if (!skinViewer) {
            initSkinViewer3D();
        } else {
            skinViewer.setSize(220, 310);
        }
        const isMicrosoft = currentConfig.authType === 'microsoft';
        const effectiveSkin = currentConfig.customSkinPath || (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.skinUrl : null);
        const effectiveCape = isMicrosoft ? null : (currentConfig.customCapePath ? (currentConfig.customCapePath.startsWith('http') || currentConfig.customCapePath.startsWith('file://') ? currentConfig.customCapePath : `file://${currentConfig.customCapePath}`) : null);
        const isSlim = currentConfig.customSkinVariant === 'slim';
        const name = (isMicrosoft && currentConfig.microsoftAccount ? currentConfig.microsoftAccount.username : currentConfig.username) || 'Steve';

        const skinSrc = effectiveSkin
            ? ((effectiveSkin.startsWith('http') || effectiveSkin.startsWith('file://')) ? effectiveSkin : `file://${effectiveSkin}`)
            : `https://minotar.net/skin/${encodeURIComponent(name)}`;

        updateSkinViewer3D(skinSrc, effectiveCape, isSlim);
        drawSkinToCanvas(skinSrc, isSlim);
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
            if (skinViewer) skinViewer.playerObject.skin.modelType = 'default';
            updateCharacterTabSkinPreview();
        });
        btnVariantSlim.addEventListener('click', async () => {
            currentConfig.customSkinVariant = 'slim';
            btnVariantSlim.classList.add('active');
            btnVariantClassic.classList.remove('active');
            await window.api.saveOfflineSkin({ variant: 'slim' });
            if (skinViewer) skinViewer.playerObject.skin.modelType = 'slim';
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
    if (window.api && window.api.onAuthStatus) {
        window.api.onAuthStatus((statusText) => {
            if (authMicrosoftBtn && authMicrosoftBtn.disabled) {
                authMicrosoftBtn.textContent = `⏳ ${statusText}`;
            }
            appendLog(`[AUTH] ${statusText}`);
        });
    }

    if (authMicrosoftBtn) {
        authMicrosoftBtn.addEventListener('click', async () => {
            authMicrosoftBtn.disabled = true;
            const originalText = authMicrosoftBtn.textContent;
            authMicrosoftBtn.textContent = '⏳ Čekám na okno Microsoftu...';
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
                    appendLog(`[AUTH] Přihlášení k Microsoft účtu: ${res.error || 'Zrušeno'}`);
                    showToast(res.error || 'Přihlášení bylo zrušeno', 'error');
                }
            } catch (err) {
                appendLog(`[AUTH] Chyba při přihlašování: ${err.message}`);
                showToast(`Chyba: ${err.message}`, 'error');
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

            const checkGameMode = document.getElementById('checkGameMode');
            const checkDiscreteGpu = document.getElementById('checkDiscreteGpu');
            const checkMangoHud = document.getElementById('checkMangoHud');
            const checkZink = document.getElementById('checkZink');
            const checkDisableVsync = document.getElementById('checkDisableVsync');
            const checkNativeWayland = document.getElementById('checkNativeWayland');
            const checkDiscordRpc = document.getElementById('checkDiscordRpc');
            const jvmArgsInput = document.getElementById('jvmArgsInput');
            const customEnvVarsInput = document.getElementById('customEnvVarsInput');

            const updated = {
                ramMax: parseInt(ramSlider?.value || '4', 10),
                javaPath: javaPathInput?.value.trim() || null,
                autoConnectServer: autoConnectCheck?.checked ?? true,
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

            await window.api.saveConfig(updated);
            currentConfig = { ...currentConfig, ...updated };
            appendLog('[CONFIG] Nastavení bylo uloženo.');
            temporaryButtonText(btnSaveSettings, '✓ Nastavení uloženo!');
        });
    }

    const btnPresetZgc = document.getElementById('btnPresetZgc');
    if (btnPresetZgc) {
        btnPresetZgc.addEventListener('click', () => {
            const jvmInput = document.getElementById('jvmArgsInput');
            if (jvmInput) {
                jvmInput.value = '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions -XX:+AlwaysPreTouch -XX:+DisableExplicitGC';
                showToast('⚡ Nastaveny doporučené parametry Generational ZGC (Java 21/25)!', 'info');
            }
        });
    }

    const btnPresetG1gc = document.getElementById('btnPresetG1gc');
    if (btnPresetG1gc) {
        btnPresetG1gc.addEventListener('click', () => {
            const jvmInput = document.getElementById('jvmArgsInput');
            if (jvmInput) {
                jvmInput.value = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch';
                showToast('Nastaveny standardní parametry G1GC.', 'info');
            }
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
                    if (fixTextElem) fixTextElem.textContent = crashData.autoFix.label || '⚡ Automatická oprava';
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
            btnApplyCrashFix.textContent = '⏳ Aplikuji opravu...';
            try {
                const res = await window.api.applyCrashFix(currentCrashData.autoFix, currentConfig.activeProfileId);
                if (res && res.success) {
                    showToast(`✓ ${res.message}`, 'success');
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
                btnApplyCrashFix.innerHTML = '<span id="btnApplyCrashFixText">⚡ Automatická oprava</span>';
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
                if (selectedIcon) selectedIcon.textContent = icon;

                options.forEach(o => {
                    o.classList.remove('active');
                    const check = o.querySelector('.custom-option-check');
                    if (check) check.textContent = '';
                });
                opt.classList.add('active');
                const check = opt.querySelector('.custom-option-check');
                if (check) check.textContent = '✓';

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
            showToast(`✓ Profil "${rawName}" byl úspěšně vytvořen!`, 'success');
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
