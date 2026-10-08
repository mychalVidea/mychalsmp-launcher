// Preload script for Microsoft Login window
// Disables WebAuthn / Passkeys in both main world and isolated world
// so Microsoft does not prompt for Windows Hello / PIN on Linux

const { webFrame } = require('electron');

function disableWebAuthn() {
    try {
        delete window.PublicKeyCredential;
        Object.defineProperty(window, 'PublicKeyCredential', {
            get: () => undefined,
            configurable: false
        });
    } catch (e) {}
}

// Disable in isolated world
disableWebAuthn();

// Disable in main world where Microsoft's scripts execute
try {
    webFrame.executeJavaScript(`
        try {
            delete window.PublicKeyCredential;
            Object.defineProperty(window, 'PublicKeyCredential', {
                get: () => undefined,
                configurable: false
            });
        } catch (e) {}
    `);
} catch (e) {}
