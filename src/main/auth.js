const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const msmc = require('msmc');

/**
 * Generates an authentic offline UUID v3 based on player name, identical to Minecraft offline mode.
 */
function getOfflineUUID(username) {
    const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
    md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
    md5[8] = (md5[8] & 0x3f) | 0x80; // variant
    const hex = md5.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Creates an offline authorization session compatible with MCLC.
 */
function createOfflineAuth(username) {
    const cleanName = (username || 'Hrac').trim().substring(0, 16);
    const uuid = getOfflineUUID(cleanName);
    return {
        access_token: 'offline_token_' + uuid,
        client_token: 'offline_client_' + uuid,
        uuid: uuid,
        name: cleanName,
        user_properties: '{}',
        meta: {
            type: 'mojang',
            demo: false
        },
        skinUrl: `https://minotar.net/skin/${cleanName}`
    };
}

/**
 * Interactive Microsoft Login using Electron BrowserWindow with real Chrome User-Agent
 * and event interceptors for OAuth redirect codes.
 */
async function loginMicrosoft(parentWindow) {
    return new Promise(async (resolve) => {
        let authWin = null;
        try {
            const authManager = new msmc.Auth("select_account");
            const redirectUri = authManager.token.redirect; // https://login.live.com/oauth20_desktop.srf
            const authUrl = authManager.createLink();

            authWin = new BrowserWindow({
                width: 540,
                height: 700,
                parent: parentWindow || undefined,
                modal: !!parentWindow,
                title: "Přihlášení k Microsoft účtu – MYCHAL SMP",
                backgroundColor: '#1b1b2f',
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            // Modern Chrome User-Agent so Microsoft does not flag or block Electron on Linux
            authWin.webContents.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            );

            let handled = false;

            const handlePotentialRedirect = async (url) => {
                if (handled || !url) return;
                if (url.startsWith(redirectUri)) {
                    handled = true;
                    try {
                        const parsed = new URL(url);
                        const code = parsed.searchParams.get("code");
                        const error = parsed.searchParams.get("error");
                        const errorDescription = parsed.searchParams.get("error_description");

                        if (error) {
                            if (authWin && !authWin.isDestroyed()) authWin.close();
                            resolve({
                                success: false,
                                error: errorDescription || error || "Přihlášení selhalo."
                            });
                            return;
                        }

                        if (code) {
                            if (authWin && !authWin.isDestroyed()) authWin.close();

                            // Exchange authorization code for Xbox Live & Minecraft tokens
                            const xbox = await authManager.login(code);
                            const token = await xbox.getMinecraft();

                            if (!token || !token.mclc()) {
                                throw new Error("Nepodařilo se získat Minecraft přístupový token.");
                            }

                            const mclcAuth = token.mclc();
                            const profile = token.profile;

                            resolve({
                                success: true,
                                auth: mclcAuth,
                                profile: {
                                    name: profile.name,
                                    id: profile.id,
                                    skinUrl: profile.skins && profile.skins.length > 0
                                        ? profile.skins[0].url
                                        : `https://minotar.net/skin/${profile.name}`,
                                    skins: profile.skins || [],
                                    capes: profile.capes || []
                                }
                            });
                            return;
                        }
                    } catch (e) {
                        if (authWin && !authWin.isDestroyed()) authWin.close();
                        resolve({
                            success: false,
                            error: e.message || "Chyba při zpracování tokenu Microsoft."
                        });
                    }
                }
            };

            authWin.webContents.on('will-navigate', (e, targetUrl) => {
                handlePotentialRedirect(targetUrl);
            });

            authWin.webContents.on('will-redirect', (e, targetUrl) => {
                handlePotentialRedirect(targetUrl);
            });

            authWin.webContents.on('did-navigate', (e, targetUrl) => {
                handlePotentialRedirect(targetUrl);
            });

            authWin.webContents.on('did-finish-load', () => {
                if (authWin && !authWin.isDestroyed()) {
                    handlePotentialRedirect(authWin.webContents.getURL());
                }
            });

            authWin.on('closed', () => {
                authWin = null;
                if (!handled) {
                    resolve({
                        success: false,
                        error: "Přihlašovací okno bylo zavřeno uživatelem."
                    });
                }
            });

            await authWin.loadURL(authUrl);
        } catch (err) {
            if (authWin && !authWin.isDestroyed()) authWin.close();
            console.error("Chyba při Microsoft přihlášení:", err);
            resolve({
                success: false,
                error: err.message || "Přihlášení bylo zrušeno nebo selhalo."
            });
        }
    });
}

module.exports = {
    getOfflineUUID,
    createOfflineAuth,
    loginMicrosoft
};
