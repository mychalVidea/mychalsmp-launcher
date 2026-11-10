const fs = require('fs');
const path = require('path');
const { BASE_DIR, loadConfig, saveConfig } = require('./config');


/**
 * Lidsky čitelné názvy a kódování kláves Minecraftu (GLFW)
 */
const KEY_DEFINITIONS = {
    // Písmena
    'key.keyboard.a': { label: 'A', code: 'KeyA' },
    'key.keyboard.b': { label: 'B', code: 'KeyB' },
    'key.keyboard.c': { label: 'C', code: 'KeyC' },
    'key.keyboard.d': { label: 'D', code: 'KeyD' },
    'key.keyboard.e': { label: 'E', code: 'KeyE' },
    'key.keyboard.f': { label: 'F', code: 'KeyF' },
    'key.keyboard.g': { label: 'G', code: 'KeyG' },
    'key.keyboard.h': { label: 'H', code: 'KeyH' },
    'key.keyboard.i': { label: 'I', code: 'KeyI' },
    'key.keyboard.j': { label: 'J', code: 'KeyJ' },
    'key.keyboard.k': { label: 'K', code: 'KeyK' },
    'key.keyboard.l': { label: 'L', code: 'KeyL' },
    'key.keyboard.m': { label: 'M', code: 'KeyM' },
    'key.keyboard.n': { label: 'N', code: 'KeyN' },
    'key.keyboard.o': { label: 'O', code: 'KeyO' },
    'key.keyboard.p': { label: 'P', code: 'KeyP' },
    'key.keyboard.q': { label: 'Q', code: 'KeyQ' },
    'key.keyboard.r': { label: 'R', code: 'KeyR' },
    'key.keyboard.s': { label: 'S', code: 'KeyS' },
    'key.keyboard.t': { label: 'T', code: 'KeyT' },
    'key.keyboard.u': { label: 'U', code: 'KeyU' },
    'key.keyboard.v': { label: 'V', code: 'KeyV' },
    'key.keyboard.w': { label: 'W', code: 'KeyW' },
    'key.keyboard.x': { label: 'X', code: 'KeyX' },
    'key.keyboard.y': { label: 'Y', code: 'KeyY' },
    'key.keyboard.z': { label: 'Z', code: 'KeyZ' },

    // Čísla
    'key.keyboard.0': { label: '0', code: 'Digit0' },
    'key.keyboard.1': { label: '1', code: 'Digit1' },
    'key.keyboard.2': { label: '2', code: 'Digit2' },
    'key.keyboard.3': { label: '3', code: 'Digit3' },
    'key.keyboard.4': { label: '4', code: 'Digit4' },
    'key.keyboard.5': { label: '5', code: 'Digit5' },
    'key.keyboard.6': { label: '6', code: 'Digit6' },
    'key.keyboard.7': { label: '7', code: 'Digit7' },
    'key.keyboard.8': { label: '8', code: 'Digit8' },
    'key.keyboard.9': { label: '9', code: 'Digit9' },

    // Funkční klávesy
    'key.keyboard.f1': { label: 'F1', code: 'F1' },
    'key.keyboard.f2': { label: 'F2', code: 'F2' },
    'key.keyboard.f3': { label: 'F3', code: 'F3' },
    'key.keyboard.f4': { label: 'F4', code: 'F4' },
    'key.keyboard.f5': { label: 'F5', code: 'F5' },
    'key.keyboard.f6': { label: 'F6', code: 'F6' },
    'key.keyboard.f7': { label: 'F7', code: 'F7' },
    'key.keyboard.f8': { label: 'F8', code: 'F8' },
    'key.keyboard.f9': { label: 'F9', code: 'F9' },
    'key.keyboard.f10': { label: 'F10', code: 'F10' },
    'key.keyboard.f11': { label: 'F11', code: 'F11' },
    'key.keyboard.f12': { label: 'F12', code: 'F12' },

    // Speciální klávesy
    'key.keyboard.escape': { label: 'Esc', code: 'Escape' },
    'key.keyboard.space': { label: 'Mezerník', code: 'Space' },
    'key.keyboard.tab': { label: 'Tab', code: 'Tab' },
    'key.keyboard.caps.lock': { label: 'Caps Lock', code: 'CapsLock' },
    'key.keyboard.left.shift': { label: 'L-Shift', code: 'ShiftLeft' },
    'key.keyboard.right.shift': { label: 'R-Shift', code: 'ShiftRight' },
    'key.keyboard.left.control': { label: 'L-Ctrl', code: 'ControlLeft' },
    'key.keyboard.right.control': { label: 'R-Ctrl', code: 'ControlRight' },
    'key.keyboard.left.alt': { label: 'L-Alt', code: 'AltLeft' },
    'key.keyboard.right.alt': { label: 'R-Alt', code: 'AltRight' },
    'key.keyboard.left.win': { label: 'Win', code: 'MetaLeft' },
    'key.keyboard.right.win': { label: 'Win', code: 'MetaRight' },
    'key.keyboard.enter': { label: 'Enter', code: 'Enter' },
    'key.keyboard.backspace': { label: 'Backspace', code: 'Backspace' },

    // Navigační klávesy
    'key.keyboard.up': { label: 'Šipka Nahoru', code: 'ArrowUp' },
    'key.keyboard.down': { label: 'Šipka Dolů', code: 'ArrowDown' },
    'key.keyboard.left': { label: 'Šipka Vlevo', code: 'ArrowLeft' },
    'key.keyboard.right': { label: 'Šipka Vpravo', code: 'ArrowRight' },
    'key.keyboard.insert': { label: 'Insert', code: 'Insert' },
    'key.keyboard.delete': { label: 'Delete', code: 'Delete' },
    'key.keyboard.home': { label: 'Home', code: 'Home' },
    'key.keyboard.end': { label: 'End', code: 'End' },
    'key.keyboard.page.up': { label: 'Page Up', code: 'PageUp' },
    'key.keyboard.page.down': { label: 'Page Down', code: 'PageDown' },
    'key.keyboard.print.screen': { label: 'PrtSc', code: 'PrintScreen' },
    'key.keyboard.scroll.lock': { label: 'Scroll Lock', code: 'ScrollLock' },
    'key.keyboard.pause': { label: 'Pause', code: 'Pause' },

    // Interpunkce
    'key.keyboard.grave.accent': { label: '~ (Tilda)', code: 'Backquote' },
    'key.keyboard.minus': { label: '-', code: 'Minus' },
    'key.keyboard.equal': { label: '=', code: 'Equal' },
    'key.keyboard.left.bracket': { label: '[', code: 'BracketLeft' },
    'key.keyboard.right.bracket': { label: ']', code: 'BracketRight' },
    'key.keyboard.backslash': { label: '\\', code: 'Backslash' },
    'key.keyboard.semicolon': { label: ';', code: 'Semicolon' },
    'key.keyboard.apostrophe': { label: '\'', code: 'Quote' },
    'key.keyboard.comma': { label: ',', code: 'Comma' },
    'key.keyboard.period': { label: '.', code: 'Period' },
    'key.keyboard.slash': { label: '/', code: 'Slash' },

    // Myš
    'key.mouse.left': { label: 'Levé tl. myši', code: 'MouseLeft' },
    'key.mouse.right': { label: 'Pravé tl. myši', code: 'MouseRight' },
    'key.mouse.middle': { label: 'Kolečko myši', code: 'MouseMiddle' },
    'key.mouse.4': { label: 'Boční tl. myši 4', code: 'Mouse4' },
    'key.mouse.5': { label: 'Boční tl. myši 5', code: 'Mouse5' },

    // Neobsazeno
    'key.keyboard.unknown': { label: 'Neobsazeno', code: 'None' }
};

/**
 * Výchozí katalog Minecraft akcí a kláves
 */
const DEFAULT_ACTIONS = [
    // 🏃 Pohyb
    { id: 'key_key.forward', label: 'Jít dopředu', category: 'movement', defaultKey: 'key.keyboard.w' },
    { id: 'key_key.left', label: 'Jít doleva', category: 'movement', defaultKey: 'key.keyboard.a' },
    { id: 'key_key.back', label: 'Jít dozadu', category: 'movement', defaultKey: 'key.keyboard.s' },
    { id: 'key_key.right', label: 'Jít doprava', category: 'movement', defaultKey: 'key.keyboard.d' },
    { id: 'key_key.jump', label: 'Skok', category: 'movement', defaultKey: 'key.keyboard.space' },
    { id: 'key_key.sneak', label: 'Plížení (Sneak)', category: 'movement', defaultKey: 'key.keyboard.left.shift' },
    { id: 'key_key.sprint', label: 'Sprint', category: 'movement', defaultKey: 'key.keyboard.left.control' },

    // ⚔️ Hratelnost & Boj
    { id: 'key_key.attack', label: 'Útok / Ničení bloku', category: 'gameplay', defaultKey: 'key.mouse.left' },
    { id: 'key_key.use', label: 'Použít předmět / Položit blok', category: 'gameplay', defaultKey: 'key.mouse.right' },
    { id: 'key_key.pickItem', label: 'Vybrat blok (Pick Item)', category: 'gameplay', defaultKey: 'key.mouse.middle' },
    { id: 'key_key.drop', label: 'Odhodit vybraný předmět', category: 'gameplay', defaultKey: 'key.keyboard.q' },
    { id: 'key_key.swapOffhand', label: 'Prohodit předmět do druhé ruky', category: 'gameplay', defaultKey: 'key.keyboard.f' },

    // 🎒 Inventář & Rychlá lišta
    { id: 'key_key.inventory', label: 'Otevřít inventář', category: 'inventory', defaultKey: 'key.keyboard.e' },
    { id: 'key_key.hotbar.1', label: 'Rychlý slot 1', category: 'inventory', defaultKey: 'key.keyboard.1' },
    { id: 'key_key.hotbar.2', label: 'Rychlý slot 2', category: 'inventory', defaultKey: 'key.keyboard.2' },
    { id: 'key_key.hotbar.3', label: 'Rychlý slot 3', category: 'inventory', defaultKey: 'key.keyboard.3' },
    { id: 'key_key.hotbar.4', label: 'Rychlý slot 4', category: 'inventory', defaultKey: 'key.keyboard.4' },
    { id: 'key_key.hotbar.5', label: 'Rychlý slot 5', category: 'inventory', defaultKey: 'key.keyboard.5' },
    { id: 'key_key.hotbar.6', label: 'Rychlý slot 6', category: 'inventory', defaultKey: 'key.keyboard.6' },
    { id: 'key_key.hotbar.7', label: 'Rychlý slot 7', category: 'inventory', defaultKey: 'key.keyboard.7' },
    { id: 'key_key.hotbar.8', label: 'Rychlý slot 8', category: 'inventory', defaultKey: 'key.keyboard.8' },
    { id: 'key_key.hotbar.9', label: 'Rychlý slot 9', category: 'inventory', defaultKey: 'key.keyboard.9' },
    { id: 'key_key.saveToolbarActivator', label: 'Uložit lištu nástrojů (Kreativní mód)', category: 'inventory', defaultKey: 'key.keyboard.c' },
    { id: 'key_key.loadToolbarActivator', label: 'Načíst lištu nástrojů (Kreativní mód)', category: 'inventory', defaultKey: 'key.keyboard.x' },

    // 💬 Multiplayer & Komunikace
    { id: 'key_key.chat', label: 'Otevřít chat', category: 'multiplayer', defaultKey: 'key.keyboard.t' },
    { id: 'key_key.command', label: 'Zadat příkaz ( / )', category: 'multiplayer', defaultKey: 'key.keyboard.slash' },
    { id: 'key_key.playerlist', label: 'Seznam online hráčů (Tab)', category: 'multiplayer', defaultKey: 'key.keyboard.tab' },
    { id: 'key_key.socialInteractions', label: 'Obrazovka sociálních interakcí', category: 'multiplayer', defaultKey: 'key.keyboard.p' },

    // ⚙️ Různé & Zobrazení
    { id: 'key_key.togglePerspective', label: 'Změnit pohled kamery (F5)', category: 'misc', defaultKey: 'key.keyboard.f5' },
    { id: 'key_key.screenshot', label: 'Pořídit snímek obrazovky (F2)', category: 'misc', defaultKey: 'key.keyboard.f2' },
    { id: 'key_key.toggleGui', label: 'Skrýt / Zobrazit rozhraní (F1)', category: 'misc', defaultKey: 'key.keyboard.f1' },
    { id: 'key_key.fullscreen', label: 'Přepnout celou obrazovku (F11)', category: 'misc', defaultKey: 'key.keyboard.f11' },
    { id: 'key_key.advancements', label: 'Zobrazit pokroky (Advancements)', category: 'misc', defaultKey: 'key.keyboard.l' },
    { id: 'key_key.smoothCamera', label: 'Filmová / Plynulá kamera', category: 'misc', defaultKey: 'key.keyboard.unknown' },
    { id: 'key_key.spectatorOutlines', label: 'Zvýraznit obrysy hráčů (Divák)', category: 'misc', defaultKey: 'key.keyboard.unknown' },

    // 🧩 Módy (Standardní klávesy populárních módů)
    { id: 'key_voice_chat.voice_chat', label: 'Hlasový chat: Push to talk', category: 'mods', modName: 'Simple Voice Chat', defaultKey: 'key.keyboard.v' },
    { id: 'key_voice_chat.voice_chat_gui', label: 'Hlasový chat: Otevřít nastavení', category: 'mods', modName: 'Simple Voice Chat', defaultKey: 'key.keyboard.caps.lock' },
    { id: 'key_voice_chat.whisper', label: 'Hlasový chat: Šeptání (Whisper)', category: 'mods', modName: 'Simple Voice Chat', defaultKey: 'key.keyboard.h' },
    { id: 'key_voice_chat.mute_microphone', label: 'Hlasový chat: Ztlumit mikrofon', category: 'mods', modName: 'Simple Voice Chat', defaultKey: 'key.keyboard.m' },
    { id: 'key_voice_chat.disable_voice_chat', label: 'Hlasový chat: Ztlumit reproduktory', category: 'mods', modName: 'Simple Voice Chat', defaultKey: 'key.keyboard.unknown' },
    { id: 'key_key.zoomify.zoom', label: 'Přiblížení (Zoomify)', category: 'mods', modName: 'Zoomify', defaultKey: 'key.keyboard.c' },
    { id: 'key_key.zoom', label: 'Přiblížení (Zoom)', category: 'mods', modName: 'Zoom', defaultKey: 'key.keyboard.c' },
    { id: 'key_key.gamma', label: 'Noční vidění / Plný jas (Gamma)', category: 'mods', modName: 'Fullbright / Gamma', defaultKey: 'key.keyboard.g' },
    { id: 'key_modmenu.open_menu', label: 'Otevřít seznam módů (ModMenu)', category: 'mods', modName: 'ModMenu', defaultKey: 'key.keyboard.unknown' },
    { id: 'key_freecam.toggle', label: 'Přepnout volnou kameru (Freecam)', category: 'mods', modName: 'Freecam', defaultKey: 'key.keyboard.x' },
    { id: 'key_replaymod.start_stop_recording', label: 'Spustit / Zastavit nahrávání (ReplayMod)', category: 'mods', modName: 'ReplayMod', defaultKey: 'key.keyboard.unknown' }
];

/**
 * Převede klávesu Minecraftu na čitelný štítek
 */
function getKeyDisplay(mcKey) {
    if (!mcKey) return 'Neobsazeno';
    const def = KEY_DEFINITIONS[mcKey];
    if (def) return def.label;
    if (mcKey.startsWith('key.keyboard.')) {
        return mcKey.replace('key.keyboard.', '').toUpperCase();
    }
    if (mcKey.startsWith('key.mouse.')) {
        return `Myš ${mcKey.replace('key.mouse.', '')}`;
    }
    return mcKey;
}

/**
 * Převede Browser KeyboardEvent code / mouse button na Minecraft GLFW klíč
 */
function browserCodeToMinecraftKey(code, button = null) {
    if (button !== null && button !== undefined) {
        if (button === 0) return 'key.mouse.left';
        if (button === 2) return 'key.mouse.right';
        if (button === 1) return 'key.mouse.middle';
        if (button === 3) return 'key.mouse.4';
        if (button === 4) return 'key.mouse.5';
    }

    if (!code) return 'key.keyboard.unknown';

    // Prohledáme KEY_DEFINITIONS
    for (const [mcKey, val] of Object.entries(KEY_DEFINITIONS)) {
        if (val.code === code) {
            return mcKey;
        }
    }

    // Fallbacky pro písmena a čísla
    if (code.startsWith('Key')) {
        const letter = code.replace('Key', '').toLowerCase();
        return `key.keyboard.${letter}`;
    }
    if (code.startsWith('Digit')) {
        const digit = code.replace('Digit', '');
        return `key.keyboard.${digit}`;
    }
    if (code.startsWith('Numpad')) {
        const num = code.replace('Numpad', '').toLowerCase();
        return `key.keyboard.keypad.${num}`;
    }

    return 'key.keyboard.unknown';
}

/**
 * Získá všechny existující herní adresáře profilů
 */
function getAllProfileDirs() {
    const config = loadConfig();
    const dirs = new Set();

    // Výchozí BASE_DIR
    dirs.add(BASE_DIR);

    // Všechny profily
    for (const p of (config.profiles || [])) {
        const d = p.gameDir || BASE_DIR;
        dirs.add(d);
    }

    return Array.from(dirs);
}

/**
 * Přečte options.txt ze zadaného adresáře
 */
function readOptionsTxt(targetDir) {
    const optPath = path.join(targetDir, 'options.txt');
    if (!fs.existsSync(optPath)) return null;
    try {
        const raw = fs.readFileSync(optPath, 'utf-8');
        return raw;
    } catch (e) {
        console.warn(`[KEYBINDS] Nelze přečíst ${optPath}:`, e.message);
        return null;
    }
}

function normalizeKeyId(id) {
    if (!id) return '';
    return id.startsWith('key_') ? id : `key_${id}`;
}

/**
 * Naparsuje řádky options.txt do mapy klíč-hodnota
 */
function parseKeybindsFromOptions(content) {
    if (!content) return {};
    const binds = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('key_') && trimmed.includes(':')) {
            const idx = trimmed.indexOf(':');
            const keyId = trimmed.substring(0, idx).trim();
            const keyVal = trimmed.substring(idx + 1).trim();
            binds[keyId] = keyVal;
        }
    }
    return binds;
}

/**
 * Aktualizuje řádky options.txt novými hodnotami kláves při zachování všech ostatních voleb
 */
function updateOptionsContent(originalContent, updatedBinds) {
    const lines = (originalContent || '').split(/\r?\n/);
    const handledKeys = new Set();
    const newLines = [];

    // Normalizace updatedBinds tak, aby klíče měly vždy korektní Minecraft prefix key_
    const normalizedBinds = {};
    for (const [k, v] of Object.entries(updatedBinds || {})) {
        const norm = normalizeKeyId(k);
        normalizedBinds[norm] = v;
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('key_') && trimmed.includes(':')) {
            const idx = trimmed.indexOf(':');
            const keyId = trimmed.substring(0, idx).trim();
            const normKey = normalizeKeyId(keyId);
            if (Object.prototype.hasOwnProperty.call(normalizedBinds, normKey)) {
                newLines.push(`${normKey}:${normalizedBinds[normKey]}`);
                handledKeys.add(normKey);
            } else {
                newLines.push(line);
                handledKeys.add(normKey);
            }
        } else {
            newLines.push(line);
        }
    }

    // Doplnění bindů, které v původním souboru ještě nebyly
    for (const [normKey, keyVal] of Object.entries(normalizedBinds)) {
        if (!handledKeys.has(normKey)) {
            newLines.push(`${normKey}:${keyVal}`);
            handledKeys.add(normKey);
        }
    }

    return newLines.join('\n');
}

/**
 * Načte všechny klávesové zkratky (vanilla i módy), detekuje konflikty a vrátí je pro UI
 */
function getKeybinds(profileId = null) {
    const config = loadConfig();
    const allDirs = getAllProfileDirs();
    const targetDir = (config.profiles || []).find(p => p.id === (profileId || config.activeProfileId))?.gameDir || BASE_DIR;

    // 1. Získáme existující bindy z aktivního profilu, globálního options.txt a ostatních profilů
    let mergedFileBinds = {};

    // Nejprve projdeme všechny soubory options.txt a posbíráme i případné módy z jiných profilů
    for (const d of allDirs) {
        const content = readOptionsTxt(d);
        if (content) {
            const parsed = parseKeybindsFromOptions(content);
            mergedFileBinds = { ...mergedFileBinds, ...parsed };
        }
    }

    // Pokud existuje options.txt pro cílový profil, má nejvyšší prioritu
    const activeContent = readOptionsTxt(targetDir);
    if (activeContent) {
        const activeParsed = parseKeybindsFromOptions(activeContent);
        mergedFileBinds = { ...mergedFileBinds, ...activeParsed };
    }

    // 2. Přidáme uložené globální bindy z configu (pokud existují)
    if (config.globalKeybinds && typeof config.globalKeybinds === 'object') {
        mergedFileBinds = { ...mergedFileBinds, ...config.globalKeybinds };
    }

    // 3. Poskládáme seznam akcí: výchozí šablona + jakékoliv další akce nalezené v souborech options.txt (z módů)
    const actionMap = new Map();

    for (const act of DEFAULT_ACTIONS) {
        actionMap.set(act.id, { ...act });
    }

    // Projdeme nalezené klíče ze souborů: pokud některý není v DEFAULT_ACTIONS (pochází z módu nebo debug zkratek), vytvoříme pro něj položku
    for (const [keyId, keyVal] of Object.entries(mergedFileBinds)) {
        if (!actionMap.has(keyId)) {
            const cleanName = keyId.replace(/^key_/, '').replace(/^key\./, '');
            const parts = cleanName.split('.');
            const rawLabel = parts[parts.length - 1]
                .replace(/_/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase());

            const isDebug = cleanName.toLowerCase().includes('debug') || keyId.toLowerCase().includes('debug');
            let label = `Mód: ${rawLabel}`;
            let category = 'mods';
            let modName = parts.length > 1 ? parts[0] : 'Nainstalovaný mód';

            if (isDebug) {
                category = 'misc';
                modName = 'F3 Debug';
                if (cleanName.includes('clearChat')) {
                    label = 'F3 + D (Smazat chat)';
                } else if (cleanName.includes('reloadChunks')) {
                    label = 'F3 + A (Znovu načíst chunky)';
                } else if (cleanName.includes('showHitboxes')) {
                    label = 'F3 + B (Zobrazit hitboxy)';
                } else if (cleanName.includes('copyCoordinates')) {
                    label = 'F3 + C (Kopírovat souřadnice)';
                } else if (cleanName.includes('cycleRenderDistance')) {
                    label = 'F3 + F (Změnit dohled)';
                } else if (cleanName.includes('chunkBoundaries')) {
                    label = 'F3 + G (Hranice chunků)';
                } else if (cleanName.includes('advancedTooltips')) {
                    label = 'F3 + H (Pokročilé popisky)';
                } else {
                    label = `F3 + ${rawLabel}`;
                }
            }

            actionMap.set(keyId, {
                id: keyId,
                label,
                category,
                modName,
                defaultKey: keyVal,
                isDebug
            });
        }
    }

    // 4. Přiřadíme aktuální klávesy
    const bindList = [];
    const keyUsageMap = new Map(); // scopeKey -> [actionItems]

    for (const [id, act] of actionMap.entries()) {
        const currentKey = mergedFileBinds[id] || act.defaultKey || 'key.keyboard.unknown';
        const keyDef = KEY_DEFINITIONS[currentKey] || { label: getKeyDisplay(currentKey), code: 'Custom' };
        const isDebug = Boolean(act.isDebug || id.toLowerCase().includes('debug'));

        const bindItem = {
            id,
            label: act.label,
            category: act.category,
            modName: act.modName || null,
            defaultKey: act.defaultKey,
            key: currentKey,
            keyDisplay: keyDef.label,
            keyCode: keyDef.code,
            isDebug,
            hasConflict: false,
            conflictsWith: []
        };

        bindList.push(bindItem);

        // Zaznamenáme použití klávesy pro detekci konfliktů (kromě neobsazených).
        // F3 debug zkratky mají vlastní namespace 'debug:', protože vyžadují držení klávesy F3
        // a NEKOLIDUJÍ s běžnými herními klávesami (např. D pro chůzi vs F3+D pro smazání chatu).
        if (currentKey && currentKey !== 'key.keyboard.unknown') {
            const usageKey = `${isDebug ? 'debug:' : 'normal:'}${currentKey}`;
            if (!keyUsageMap.has(usageKey)) {
                keyUsageMap.set(usageKey, []);
            }
            keyUsageMap.get(usageKey).push(bindItem);
        }
    }

    // 5. Vyhodnocení konfliktů (pouze pokud stejná klávesa koliduje v rámci stejné skupiny)
    let conflictCount = 0;
    for (const [k, items] of keyUsageMap.entries()) {
        if (items.length > 1) {
            conflictCount++;
            for (const item of items) {
                item.hasConflict = true;
                item.conflictsWith = items
                    .filter(other => other.id !== item.id)
                    .map(other => ({ id: other.id, label: other.label, category: other.category }));
            }
        }
    }

    const boundCount = bindList.filter(b => b.key && b.key !== 'key.keyboard.unknown').length;
    const unboundCount = bindList.length - boundCount;

    return {
        success: true,
        binds: bindList,
        stats: {
            total: bindList.length,
            bound: boundCount,
            unbound: unboundCount,
            conflictCount
        },
        keyDefinitions: KEY_DEFINITIONS
    };
}

/**
 * Uloží klávesy globálně do všech profilů i do launcher-config.json
 */
function saveKeybinds(updatedBinds, profileId = null) {
    if (!updatedBinds || typeof updatedBinds !== 'object') {
        throw new Error('Neplatná data bindů pro uložení');
    }

    const allDirs = getAllProfileDirs();
    let updatedCount = 0;

    // 1. Zaktualizujeme všechny soubory options.txt ve všech existujících profilech
    for (const d of allDirs) {
        try {
            if (!fs.existsSync(d)) {
                fs.mkdirSync(d, { recursive: true });
            }
            const optPath = path.join(d, 'options.txt');
            const existingContent = fs.existsSync(optPath) ? fs.readFileSync(optPath, 'utf-8') : '';
            const newContent = updateOptionsContent(existingContent, updatedBinds);
            fs.writeFileSync(optPath, newContent, 'utf-8');
            updatedCount++;
        } catch (err) {
            console.error(`[KEYBINDS] Chyba při zápisu options.txt do ${d}:`, err.message);
        }
    }

    // 2. Uložíme do launcher-config.json jako globalKeybinds pro všechny budoucí profily
    try {
        const curConfig = loadConfig();
        const mergedGlobal = { ...(curConfig.globalKeybinds || {}), ...updatedBinds };
        saveConfig({ globalKeybinds: mergedGlobal });
    } catch (cfgErr) {
        console.warn('[KEYBINDS] Nelze uložit globalKeybinds do configu:', cfgErr.message);
    }

    return {
        success: true,
        updatedProfilesCount: updatedCount,
        totalBinds: Object.keys(updatedBinds).length
    };
}

/**
 * Obnoví všechny klávesy na výchozí hodnoty a uloží globálně
 */
function resetKeybindsToDefaults() {
    const defaultMap = {};
    for (const act of DEFAULT_ACTIONS) {
        defaultMap[act.id] = act.defaultKey;
    }
    return saveKeybinds(defaultMap);
}

/**
 * Synchronizuje globální klávesové zkratky do konkrétního profilu před spuštěním hry
 * @param {string} targetDirOrProfileId Profil ID nebo přímo absolutní cesta k instanci
 */
function syncKeybindsToProfile(targetDirOrProfileId, explicitGlobalBinds = null) {
    try {
        const curConfig = loadConfig();
        const globalBinds = explicitGlobalBinds || curConfig.globalKeybinds;
        if (!globalBinds || Object.keys(globalBinds).length === 0) {
            return { success: true, message: 'Žádné globální bindy k synchronizaci' };
        }

        let targetDir = BASE_DIR;
        if (targetDirOrProfileId) {
            if (path.isAbsolute(targetDirOrProfileId)) {
                targetDir = targetDirOrProfileId;
            } else {
                const foundProf = (curConfig.profiles || []).find(p => p.id === targetDirOrProfileId);
                if (foundProf && foundProf.gameDir) {
                    targetDir = foundProf.gameDir;
                } else {
                    const instPath = path.join(BASE_DIR, 'instances', targetDirOrProfileId);
                    targetDir = fs.existsSync(instPath) ? instPath : BASE_DIR;
                }
            }
        }
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const optPath = path.join(targetDir, 'options.txt');
        if (fs.existsSync(optPath)) {
            // Options.txt již existuje - 100% respektujeme konfiguraci hráče a nepřepisujeme žádná herní nastavení!
            return { success: true, message: 'Zachováno existující nastavení hráče v options.txt' };
        } else {
            // Pouze pokud soubor ještě neexistuje vůbec (čistý nový profil), vytvoříme ho s globálními bindy
            const newContent = updateOptionsContent('', globalBinds);
            fs.writeFileSync(optPath, newContent, 'utf-8');
        }

        return { success: true, synced: true };
    } catch (err) {
        console.warn('[KEYBINDS] Chyba synchronizace do profilu:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    KEY_DEFINITIONS,
    DEFAULT_ACTIONS,
    getKeyDisplay,
    browserCodeToMinecraftKey,
    getKeybinds,
    saveKeybinds,
    resetKeybindsToDefaults,
    syncKeybindsToProfile
};

