let util = null;
try {
    util = require('minecraft-server-util');
} catch (e) {
    console.warn('[SERVER PING] Knihovna minecraft-server-util není dostupná, používám HTTP fallback:', e.message);
}

const BACKUP_SMP_IP = '130.61.89.37';

async function pingServer(host = 'mychalsmp.xyz', port = 25565, isFallback = false) {
    // 1. Try direct Minecraft protocol TCP Ping
    if (util && typeof util.status === 'function') {
        try {
            const result = await util.status(host, port, {
                timeout: 3500,
                enableSRV: true
            });

            return {
                online: true,
                host,
                port,
                isBackup: isFallback,
                players: {
                    online: result.players.online || 0,
                    max: result.players.max || 100
                },
                version: result.version ? result.version.name : '26.3',
                motd: result.motd ? (result.motd.clean || result.motd.raw) : 'MYCHAL SMP',
                latency: result.roundTripLatency || 15,
                favicon: result.favicon || null
            };
        } catch (directErr) {
            // Pokračujeme na HTTP fallback níže
        }
    }
        // 2. Fallback to global mcstatus.io API (handles proxy & FRP tunnels)
        try {
            const res = await fetch(`https://api.mcstatus.io/v2/status/java/${host}:${port}`);
            if (res.ok) {
                const data = await res.json();
                if (data.online) {
                    return {
                        online: true,
                        host,
                        port,
                        isBackup: isFallback,
                        players: {
                            online: data.players ? data.players.online : 0,
                            max: data.players ? data.players.max : 100
                        },
                        version: data.version ? data.version.name_clean : '26.3',
                        motd: data.motd ? data.motd.clean : 'MYCHAL SMP',
                        latency: 20,
                        favicon: data.icon || null
                    };
                }
            }
        } catch (apiErr) {
            // Both failed
        }

        // 3. If primary domain failed and host is mychalsmp.xyz, ping backup IP 130.61.89.37
        if (!isFallback && (host === 'mychalsmp.xyz' || host.includes('mychalsmp'))) {
            try {
                const backupRes = await pingServer(BACKUP_SMP_IP, port, true);
                if (backupRes && backupRes.online) {
                    return {
                        ...backupRes,
                        host: 'mychalsmp.xyz',
                        resolvedIp: BACKUP_SMP_IP,
                        isBackup: true
                    };
                }
            } catch (backupErr) {}
        }

        return {
            online: false,
            host,
            port,
            isBackup: isFallback,
            players: { online: 0, max: 0 },
            version: 'Offline',
            motd: 'Server je momentálně offline',
            latency: -1,
            favicon: null
        };
}

module.exports = { pingServer, BACKUP_SMP_IP };
