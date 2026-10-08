// Preload script for Microsoft Login window
// Safely stubs platform authenticator (Windows Hello) so Microsoft does not prompt
// for PIN/Hello on Linux, while preserving PublicKeyCredential so Microsoft's scripts never crash.

const { webFrame } = require('electron');

function safeStubWebAuthn() {
    try {
        if (typeof window !== 'undefined' && window.PublicKeyCredential) {
            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
            if (typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function') {
                window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
            }
        }
    } catch (e) {}
}

// Stub in isolated world
safeStubWebAuthn();

// Stub in main world where Microsoft's scripts execute
try {
    webFrame.executeJavaScript(`
        try {
            if (typeof window !== 'undefined' && window.PublicKeyCredential) {
                window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
                if (typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function') {
                    window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
                }
            }
        } catch (e) {}
    `);
} catch (e) {}

