const fs = require('fs');
const path = require('path');

const MOJANG_SERVICES_API = 'https://api.minecraftservices.com';

/**
 * Fetches the user's Minecraft profile from official Mojang services
 * includes player id, name, active skins, and available capes.
 */
async function getMojangProfile(accessToken) {
    if (!accessToken) {
        return { success: false, error: 'Chybí přístupový token Microsoft účtu.' };
    }
    try {
        const res = await fetch(`${MOJANG_SERVICES_API}/minecraft/profile`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Mojang API chyba (${res.status}): ${errText}` };
        }
        const profile = await res.json();
        return { success: true, profile };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Uploads a new custom skin (.png) directly to the official Mojang account.
 * Variant can be 'classic' (4px arms) or 'slim' (3px arms).
 */
async function uploadMojangSkin(accessToken, filePath, variant = 'classic') {
    if (!accessToken) {
        return { success: false, error: 'Chybí přístupový token Microsoft účtu.' };
    }
    if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Vybraný soubor se skinem nebyl nalezen.' };
    }

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });
        const formData = new FormData();
        const normVariant = variant && variant.toLowerCase() === 'slim' ? 'slim' : 'classic';
        formData.append('variant', normVariant);
        formData.append('file', blob, path.basename(filePath));

        const res = await fetch(`${MOJANG_SERVICES_API}/minecraft/profile/skins`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            body: formData
        });

        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Nahrávání skinu na Mojang účet selhalo (${res.status}): ${errText}` };
        }

        const data = await res.json();
        return { success: true, skin: data, variant: normVariant };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Resets the active skin back to the Mojang default.
 */
async function resetMojangSkin(accessToken) {
    if (!accessToken) {
        return { success: false, error: 'Chybí přístupový token Microsoft účtu.' };
    }
    try {
        const res = await fetch(`${MOJANG_SERVICES_API}/minecraft/profile/skins/active`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Reset skinu selhal (${res.status}): ${errText}` };
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Equips or unequips an official Mojang cape.
 * If capeId is null or empty, the cape is hidden/unequipped.
 */
async function setMojangCape(accessToken, capeId) {
    if (!accessToken) {
        return { success: false, error: 'Chybí přístupový token Microsoft účtu.' };
    }
    try {
        if (!capeId) {
            // Unequip / hide cape
            const res = await fetch(`${MOJANG_SERVICES_API}/minecraft/profile/capes/active`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!res.ok) {
                const errText = await res.text();
                return { success: false, error: `Skrytí pláště selhalo (${res.status}): ${errText}` };
            }
            return { success: true, capeId: null };
        } else {
            // Equip cape
            const res = await fetch(`${MOJANG_SERVICES_API}/minecraft/profile/capes/active`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ capeId })
            });
            if (!res.ok) {
                const errText = await res.text();
                return { success: false, error: `Aktivace pláště selhala (${res.status}): ${errText}` };
            }
            return { success: true, capeId };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    getMojangProfile,
    uploadMojangSkin,
    resetMojangSkin,
    setMojangCape
};
