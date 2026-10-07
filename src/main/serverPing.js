const util = require('minecraft-server-util');

async function pingServer(host = 'mychalsmp.xyz', port = 25565) {
    // 1. Try direct Minecraft protocol TCP Ping
    try {
        const result = await util.status(host, port, {
            timeout: 3500,
            enableSRV: true
        });

        return {
            online: true,
            host,
            port,
            players: {
                online: result.players.online || 0,
                max: result.players.max || 100
            },
            version: result.version ? result.version.name : '26.2 / 1.21.4',
            motd: result.motd ? (result.motd.clean || result.motd.raw) : 'MYCHAL SMP',
            latency: result.roundTripLatency || 15,
            favicon: result.favicon || null
        };
    } catch (directErr) {
        // 2. Fallback to global mcstatus.io API (handles proxy & FRP tunnels)
        try {
            const res = await fetch(`https://api.mcstatus.io/v2/status/java/${host}:${port}`);
            if (res.ok) {
                const data = await res.json();
                return {
                    online: data.online,
                    host,
                    port,
                    players: {
                        online: data.players ? data.players.online : 0,
                        max: data.players ? data.players.max : 100
                    },
                    version: data.version ? data.version.name_clean : '26.2',
                    motd: data.motd ? data.motd.clean : 'MYCHAL SMP',
                    latency: 20,
                    favicon: data.icon || null
                };
            }
        } catch (apiErr) {
            // Both failed
        }

        return {
            online: false,
            host,
            port,
            players: { online: 0, max: 0 },
            version: 'Offline',
            motd: 'Server je momentálně offline',
            latency: -1,
            favicon: null
        };
    }
}

module.exports = { pingServer };
