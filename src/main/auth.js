const crypto = require('crypto');
const path = require('path');
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
        let handled = false;

        const updateStatus = (statusText) => {
            if (parentWindow && !parentWindow.isDestroyed()) {
                parentWindow.webContents.send('auth-status', statusText);
            }
        };

        const safeCloseAuthWin = () => {
            if (authWin && !authWin.isDestroyed()) {
                try {
                    authWin.close();
                } catch (e) {}
            }
            authWin = null;
        };

        const translateAuthError = (err) => {
            if (!err) return "Přihlášení k Microsoft účtu selhalo.";
            const raw = typeof err === 'string' ? err : (err.ts || err.message || String(err));
            if (raw.includes('userNotFound')) {
                return "Tento Microsoft účet zatím nemá vytvořený profil Xbox. Vytvoř si ho zdarma na xbox.com.";
            }
            if (raw.includes('child')) {
                return "Tento účet je vedený jako dětský a vyžaduje schválení rodinným účtem Microsoft Family.";
            }
            if (raw.includes('bannedCountry')) {
                return "Xbox Live není v této zemi dostupné.";
            }
            if (raw.includes('minecraft.login') || raw.includes('entitlements')) {
                return "K tomuto Microsoft účtu nebyla nalezena zakoupená licence hry Minecraft Java Edition.";
            }
            if (raw.includes('microsoft')) {
                return "Chyba při komunikaci s přihlašovacím serverem Microsoftu.";
            }
            return raw;
        };

        try {
            const authManager = new msmc.Auth("select_account");
            const redirectUri = authManager.token.redirect; // https://login.live.com/oauth20_desktop.srf
            const authUrl = authManager.createLink();

            authManager.on('load', (eventCode) => {
                switch (eventCode) {
                    case 'load.auth.microsoft':
                        updateStatus('Ověřuji Microsoft token...');
                        break;
                    case 'load.auth.xboxLive.1':
                    case 'load.auth.xboxLive.2':
                        updateStatus('Přihlašuji k Xbox Live...');
                        break;
                    case 'load.auth.xsts':
                        updateStatus('Získávám Xbox Security Token...');
                        break;
                    case 'load.auth.minecraft.login':
                        updateStatus('Ověřuji Minecraft účet u Mojangu...');
                        break;
                    case 'load.auth.minecraft.profile':
                        updateStatus('Stahuji Minecraft profil a skin...');
                        break;
                    default:
                        updateStatus('Komunikuji se servery...');
                        break;
                }
            });

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
                    contextIsolation: true,
                    preload: path.join(__dirname, 'msAuthPreload.js')
                }
            });

            // Match real OS User-Agent: on Linux, do NOT spoof Windows NT, otherwise Microsoft prompts for Windows Hello
            const userAgent = process.platform === 'linux'
                ? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
            authWin.webContents.setUserAgent(userAgent);

            // Extra safeguard: suppress WebAuthn / Passkeys on every page transition in the main world
            authWin.webContents.on('dom-ready', () => {
                authWin.webContents.executeJavaScript(`
                    try {
                        delete window.PublicKeyCredential;
                        Object.defineProperty(window, 'PublicKeyCredential', {
                            get: () => undefined,
                            configurable: false
                        });
                    } catch (e) {}
                `).catch(() => {});
            });

            const handlePotentialRedirect = async (url) => {
                if (handled || !url) return;
                if (url.startsWith(redirectUri) || url.includes('oauth20_desktop.srf') || url.includes('/nativeclient')) {
                    handled = true;
                    try {
                        const parsed = new URL(url);
                        const code = parsed.searchParams.get("code");
                        const error = parsed.searchParams.get("error");
                        const errorDescription = parsed.searchParams.get("error_description");

                        if (error) {
                            safeCloseAuthWin();
                            resolve({
                                success: false,
                                error: translateAuthError(errorDescription || error)
                            });
                            return;
                        }

                        if (code) {
                            safeCloseAuthWin();
                            updateStatus('Ověřuji Xbox účet...');

                            // Exchange authorization code for Xbox Live & Minecraft tokens with timeout
                            const exchangePromise = (async () => {
                                const xbox = await authManager.login(code);
                                updateStatus('Načítám Minecraft profil...');
                                const token = await xbox.getMinecraft();
                                return token;
                            })();

                            const timeoutPromise = new Promise((_, reject) => {
                                setTimeout(() => {
                                    reject(new Error("Časový limit pro spojení se servery Microsoft vypršel (35s). Zkontroluj internetové připojení."));
                                }, 35000);
                            });

                            const token = await Promise.race([exchangePromise, timeoutPromise]);

                            if (!token || !token.mclc()) {
                                throw new Error("Nepodařilo se získat Minecraft přístupový token.");
                            }

                            if (token.isDemo && token.isDemo()) {
                                throw new Error("Tento Microsoft účet nemá zakoupenou licenci hry Minecraft Java Edition (demo účet).");
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
                        safeCloseAuthWin();
                        resolve({
                            success: false,
                            error: translateAuthError(e)
                        });
                    }
                }
            };

            // 1. Intercept at network level immediately (before page body loads)
            authWin.webContents.session.webRequest.onBeforeRequest({
                urls: [
                    'https://login.live.com/oauth20_desktop.srf*',
                    'https://login.microsoftonline.com/common/oauth2/nativeclient*'
                ]
            }, (details, callback) => {
                if (details.url && (details.url.includes('code=') || details.url.includes('error='))) {
                    handlePotentialRedirect(details.url);
                    callback({ cancel: true });
                } else {
                    callback({});
                }
            });

            // 2. Navigation events fallbacks
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
                        error: "Přihlašovací okno bylo zavřeno."
                    });
                }
            });

            await authWin.loadURL(authUrl);
        } catch (err) {
            safeCloseAuthWin();
            console.error("Chyba při Microsoft přihlášení:", err);
            resolve({
                success: false,
                error: translateAuthError(err)
            });
        }
    });
}

module.exports = {
    getOfflineUUID,
    createOfflineAuth,
    loginMicrosoft
};
