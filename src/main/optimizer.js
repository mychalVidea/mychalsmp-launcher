/**
 * MYCHAL SMP Launcher - Performance & Profile Optimizer
 * Manages essential Fabric mods (Sodium, Lithium, Iris, Fabric API),
 * shaders (Complementary Reimagined), Minecraft GUI scale, and servers.dat.
 */

const fs = require('fs');
const path = require('path');
const { downloadModOrPack } = require('./modrinth');

/**
 * Ensures guiScale:2 in Minecraft's options.txt.
 */
function ensureOptionsGuiScale(gameDir, scale = 2) {
    try {
        if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir, { recursive: true });
        }
        const optionsPath = path.join(gameDir, 'options.txt');
        let content = '';
        if (fs.existsSync(optionsPath)) {
            content = fs.readFileSync(optionsPath, 'utf8');
        }

        const scaleRegex = /^guiScale:\s*\d+/m;
        if (scaleRegex.test(content)) {
            content = content.replace(scaleRegex, `guiScale:${scale}`);
        } else {
            content = (content ? content.trimEnd() + '\n' : '') + `guiScale:${scale}\n`;
        }

        fs.writeFileSync(optionsPath, content, 'utf8');
        return true;
    } catch (e) {
        console.warn('[OPTIMIZER] Nepodařilo se zapsat guiScale do options.txt:', e.message);
        return false;
    }
}

/**
 * Builds an uncompressed NBT buffer representing Minecraft's servers.dat format.
 */
function buildServersDatBuffer(serverList) {
    const buffers = [];

    function writeString(str) {
        const strBuf = Buffer.from(str, 'utf8');
        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16BE(strBuf.length, 0);
        return Buffer.concat([lenBuf, strBuf]);
    }

    // Root TAG_Compound (id 0x0A, empty name length 0)
    buffers.push(Buffer.from([0x0a, 0x00, 0x00]));

    // TAG_List, name = "servers", item type = TAG_Compound (0x0A)
    const listName = Buffer.from('servers', 'utf8');
    const listHeader = Buffer.alloc(1 + 2 + listName.length + 1 + 4);
    let offset = 0;
    listHeader.writeUInt8(0x09, offset++);
    listHeader.writeUInt16BE(listName.length, offset); offset += 2;
    listName.copy(listHeader, offset); offset += listName.length;
    listHeader.writeUInt8(0x0a, offset++);
    listHeader.writeInt32BE(serverList.length, offset); offset += 4;
    buffers.push(listHeader);

    for (const srv of serverList) {
        const srvName = srv.name || 'Minecraft Server';
        const srvIp = srv.ip || srv.address || 'mychalsmp.xyz';

        // TAG_String name="name"
        const nameKey = Buffer.from('name', 'utf8');
        const nameTagHdr = Buffer.alloc(1 + 2 + nameKey.length);
        nameTagHdr.writeUInt8(0x08, 0);
        nameTagHdr.writeUInt16BE(nameKey.length, 1);
        nameKey.copy(nameTagHdr, 3);
        buffers.push(nameTagHdr, writeString(srvName));

        // TAG_String name="ip"
        const ipKey = Buffer.from('ip', 'utf8');
        const ipTagHdr = Buffer.alloc(1 + 2 + ipKey.length);
        ipTagHdr.writeUInt8(0x08, 0);
        ipTagHdr.writeUInt16BE(ipKey.length, 1);
        ipKey.copy(ipTagHdr, 3);
        buffers.push(ipTagHdr, writeString(srvIp));

        // TAG_Byte name="acceptTextures" value=1
        const texKey = Buffer.from('acceptTextures', 'utf8');
        const texTag = Buffer.alloc(1 + 2 + texKey.length + 1);
        texTag.writeUInt8(0x01, 0);
        texTag.writeUInt16BE(texKey.length, 1);
        texKey.copy(texTag, 3);
        texTag.writeUInt8(1, 3 + texKey.length);
        buffers.push(texTag);

        // TAG_End of server entry
        buffers.push(Buffer.from([0x00]));
    }

    // Root TAG_End
    buffers.push(Buffer.from([0x00]));

    return Buffer.concat(buffers);
}

/**
 * Parses existing servers from an uncompressed NBT servers.dat.
 */
function parseExistingServersDat(buffer) {
    const servers = [];
    try {
        if (!buffer || buffer.length < 10 || buffer[0] !== 0x0a) return servers;
        let offset = 1;
        const rootNameLen = buffer.readUInt16BE(offset); offset += 2 + rootNameLen;

        while (offset < buffer.length - 1) {
            const tagId = buffer.readUInt8(offset++);
            if (tagId === 0x00) break;
            const nameLen = buffer.readUInt16BE(offset); offset += 2;
            const tagName = buffer.toString('utf8', offset, offset + nameLen); offset += nameLen;

            if (tagId === 0x09 && tagName === 'servers') {
                const itemType = buffer.readUInt8(offset++);
                const count = buffer.readInt32BE(offset); offset += 4;
                if (itemType === 0x0a) {
                    for (let i = 0; i < count; i++) {
                        let sName = '';
                        let sIp = '';
                        let sAccept = 1;
                        while (offset < buffer.length) {
                            const subTag = buffer.readUInt8(offset++);
                            if (subTag === 0x00) break;
                            const subNameLen = buffer.readUInt16BE(offset); offset += 2;
                            const subTagName = buffer.toString('utf8', offset, offset + subNameLen); offset += subNameLen;

                            if (subTag === 0x08) {
                                const strLen = buffer.readUInt16BE(offset); offset += 2;
                                const strVal = buffer.toString('utf8', offset, offset + strLen); offset += strLen;
                                if (subTagName === 'name') sName = strVal;
                                else if (subTagName === 'ip') sIp = strVal;
                            } else if (subTag === 0x01) {
                                sAccept = buffer.readInt8(offset++);
                            } else if (subTag === 0x02) {
                                offset += 2;
                            } else if (subTag === 0x03) {
                                offset += 4;
                            } else if (subTag === 0x04) {
                                offset += 8;
                            } else if (subTag === 0x07) {
                                const len = buffer.readInt32BE(offset); offset += 4 + len;
                            } else {
                                break;
                            }
                        }
                        if (sIp) {
                            servers.push({ name: sName || sIp, ip: sIp, acceptTextures: sAccept });
                        }
                    }
                }
            }
        }
    } catch (_) {}
    return servers;
}

/**
 * Synchronizes servers.dat in gameDir ensuring MYCHAL SMP is first,
 * followed by tracked servers, preserving existing servers.
 */
function syncServersDat(gameDir, additionalServers = []) {
    try {
        if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir, { recursive: true });
        }
        const srvFile = path.join(gameDir, 'servers.dat');
        let existing = [];
        if (fs.existsSync(srvFile)) {
            existing = parseExistingServersDat(fs.readFileSync(srvFile));
        }

        const map = new Map();
        // 1. MYCHAL SMP always at top
        map.set('mychalsmp.xyz', {
            name: 'MYCHAL SMP',
            ip: 'mychalsmp.xyz',
            acceptTextures: 1
        });

        // 2. Tracked servers from launcher
        for (const s of (additionalServers || [])) {
            const ip = (s.ip || s.subdomain || '').trim();
            if (ip && !map.has(ip.toLowerCase())) {
                map.set(ip.toLowerCase(), {
                    name: s.name || ip,
                    ip: ip,
                    acceptTextures: 1
                });
            }
        }

        // 3. Existing user servers
        for (const s of existing) {
            const ip = (s.ip || '').trim();
            if (ip && !map.has(ip.toLowerCase())) {
                map.set(ip.toLowerCase(), s);
            }
        }

        const finalServers = Array.from(map.values());
        const buf = buildServersDatBuffer(finalServers);
        fs.writeFileSync(srvFile, buf);
        return true;
    } catch (err) {
        console.warn('[OPTIMIZER] Chyba při synchronizaci servers.dat:', err.message);
        return false;
    }
}

/**
 * Checks if essential optimization mods are already present in gameDir.
 */
function checkInstalledOptimizationMods(gameDir) {
    const modsDir = path.join(gameDir, 'mods');
    const shaderDir = path.join(gameDir, 'shaderpacks');

    const result = {
        hasFabricApi: false,
        hasSodium: false,
        hasLithium: false,
        hasIris: false,
        hasComplementary: false
    };

    if (fs.existsSync(modsDir)) {
        const files = fs.readdirSync(modsDir).map(f => f.toLowerCase());
        result.hasFabricApi = files.some(f => f.includes('fabric-api') || f.includes('fabric_api'));
        result.hasSodium = files.some(f => f.includes('sodium'));
        result.hasLithium = files.some(f => f.includes('lithium'));
        result.hasIris = files.some(f => f.includes('iris'));
    }

    if (fs.existsSync(shaderDir)) {
        const sFiles = fs.readdirSync(shaderDir).map(f => f.toLowerCase());
        result.hasComplementary = sFiles.some(f => f.includes('complementary'));
    }

    return result;
}

/**
 * Downloads essential optimization mods and shaders for the target version and loader.
 */
async function installOptimizationPack(gameDir, version = '26.2', onProgress) {
    const installed = checkInstalledOptimizationMods(gameDir);

    const items = [
        { id: 'fabric-api', title: 'Fabric API', projectType: 'mod', needed: !installed.hasFabricApi },
        { id: 'sodium', title: 'Sodium', projectType: 'mod', needed: !installed.hasSodium },
        { id: 'lithium', title: 'Lithium', projectType: 'mod', needed: !installed.hasLithium },
        { id: 'iris', title: 'Iris Shaders', projectType: 'mod', needed: !installed.hasIris },
        { id: 'complementary-reimagined', title: 'Complementary Reimagined', projectType: 'shader', needed: !installed.hasComplementary }
    ];

    const neededItems = items.filter(i => i.needed);
    let done = 0;
    const total = neededItems.length;

    for (const item of neededItems) {
        try {
            if (onProgress) {
                onProgress({
                    current: done + 1,
                    total,
                    percent: Math.round(((done) / total) * 100),
                    status: `Instaluji ${item.title}...`
                });
            }

            await downloadModOrPack({
                id: item.id,
                title: item.title,
                projectType: item.projectType,
                version: version || '26.2',
                loader: 'fabric'
            }, gameDir);

            done++;
        } catch (err) {
            console.warn(`[OPTIMIZER] Instalace ${item.title} selhala:`, err.message);
        }
    }

    if (onProgress) {
        onProgress({
            current: total,
            total,
            percent: 100,
            status: 'Optimalizační balíček připraven'
        });
    }

    return { success: true, installedCount: done };
}

module.exports = {
    ensureOptionsGuiScale,
    syncServersDat,
    checkInstalledOptimizationMods,
    installOptimizationPack
};
