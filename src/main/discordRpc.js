const net = require('net');
const path = require('path');
const fs = require('fs');

/**
 * Native Zero-Dependency Discord Rich Presence (RPC) Client
 * Connects directly to Discord local IPC socket on Linux, Windows, and macOS.
 * Shows player username, server mychalsmp.xyz, active profile, and live elapsed playtime.
 * 
 * TODO: Dodělat / doladit Discord RPC:
 * - Prověřit nahrání assetů (mychalsmp_logo, minecraft) v Discord Developer Portalu pro App ID 1415597133855326318
 * - Doplnit případná interaktivní tlačítka (Web: mychalsmp.xyz, Připojit se)
 * - Doladit chování při uspání/probuzení PC a startu bez běžícího Discord klienta
 */

const DEFAULT_CLIENT_ID = '1415597133855326318'; // MYCHAL SMP Official Discord App

const OPCODES = {
    HANDSHAKE: 0,
    FRAME: 1,
    CLOSE: 2,
    PING: 3,
    PONG: 4
};

class DiscordRpcClient {
    constructor(clientId = DEFAULT_CLIENT_ID) {
        this.clientId = clientId;
        this.socket = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.currentActivity = null;
        this.reconnectTimer = null;
        this.readBuffer = Buffer.alloc(0);
    }

    /**
     * Resolves the Discord IPC socket path on current OS
     */
    getAvailableSocketPath() {
        if (process.platform === 'win32') {
            for (let i = 0; i < 10; i++) {
                const pipePath = `\\\\?\\pipe\\discord-ipc-${i}`;
                return pipePath; // On Windows, named pipe can be connected directly
            }
        } else {
            const searchDirs = [
                process.env.XDG_RUNTIME_DIR,
                process.env.TMPDIR,
                process.env.TMP,
                process.env.TEMP,
                '/tmp'
            ].filter(Boolean);

            for (const dir of searchDirs) {
                for (let i = 0; i < 10; i++) {
                    const socketPath = path.join(dir, `discord-ipc-${i}`);
                    if (fs.existsSync(socketPath)) {
                        return socketPath;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Connects to the Discord local IPC
     */
    connect() {
        if (this.isConnected || this.isConnecting) return;
        this.isConnecting = true;

        const socketPath = this.getAvailableSocketPath();
        if (!socketPath) {
            this.isConnecting = false;
            this.scheduleReconnect(15000);
            return;
        }

        try {
            const socket = net.createConnection(socketPath);

            socket.on('connect', () => {
                this.socket = socket;
                this.isConnecting = false;
                this.readBuffer = Buffer.alloc(0);
                this.sendHandshake();
            });

            socket.on('data', (data) => {
                this.handleData(data);
            });

            socket.on('error', () => {
                this.cleanup();
                this.scheduleReconnect(20000);
            });

            socket.on('close', () => {
                this.cleanup();
                this.scheduleReconnect(15000);
            });
        } catch (err) {
            this.cleanup();
            this.scheduleReconnect(20000);
        }
    }

    scheduleReconnect(delay = 15000) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    cleanup() {
        this.isConnected = false;
        this.isConnecting = false;
        if (this.socket) {
            try { this.socket.destroy(); } catch (e) {}
            this.socket = null;
        }
        this.readBuffer = Buffer.alloc(0);
    }

    sendPacket(opcode, payloadObj) {
        if (!this.socket || this.socket.destroyed) return;
        try {
            const jsonStr = JSON.stringify(payloadObj);
            const bodyBuffer = Buffer.from(jsonStr, 'utf-8');
            const header = Buffer.alloc(8);
            header.writeUInt32LE(opcode, 0);
            header.writeUInt32LE(bodyBuffer.length, 4);

            const packet = Buffer.concat([header, bodyBuffer]);
            this.socket.write(packet);
        } catch (e) {
            console.warn('[DISCORD RPC] Chyba při odesílání paketu:', e.message);
        }
    }

    sendHandshake() {
        this.sendPacket(OPCODES.HANDSHAKE, {
            v: 1,
            client_id: this.clientId
        });
    }

    handleData(chunk) {
        this.readBuffer = Buffer.concat([this.readBuffer, chunk]);

        while (this.readBuffer.length >= 8) {
            const opcode = this.readBuffer.readUInt32LE(0);
            const length = this.readBuffer.readUInt32LE(4);

            if (this.readBuffer.length < 8 + length) {
                // Wait for complete frame
                break;
            }

            const body = this.readBuffer.slice(8, 8 + length);
            this.readBuffer = this.readBuffer.slice(8 + length);

            try {
                const message = JSON.parse(body.toString('utf-8'));
                this.handleMessage(opcode, message);
            } catch (e) {}
        }
    }

    handleMessage(opcode, message) {
        if (opcode === OPCODES.FRAME) {
            if (message.cmd === 'DISPATCH' && message.evt === 'READY') {
                this.isConnected = true;
                // Resend current pending activity
                if (this.currentActivity) {
                    this.sendActivity(this.currentActivity);
                }
            } else if (opcode === OPCODES.PING) {
                this.sendPacket(OPCODES.PONG, message.data || {});
            }
        }
    }

    sendActivity(activity) {
        this.sendPacket(OPCODES.FRAME, {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: activity
            },
            nonce: Math.random().toString(36).substring(2, 15)
        });
    }

    /**
     * Updates Discord Rich Presence state
     * @param {Object} options
     * @param {string} options.username Player username
     * @param {string} options.server Name or IP of server (e.g. 'mychalsmp.xyz' or 'Singleplayer')
     * @param {string} options.profileName Active profile name (e.g. 'Minecraft 26.2')
     * @param {boolean} options.isPlaying Whether the game is actively running
     * @param {number} [options.startTime] Game session start timestamp ms
     */
    updateActivity(options = {}) {
        const {
            username = 'Hráč',
            server = 'mychalsmp.xyz',
            profileName = 'Minecraft 26.2',
            isPlaying = false,
            startTime = null
        } = options;

        let activity = null;

        if (isPlaying) {
            const isMychal = !server || server.toLowerCase().includes('mychalsmp');
            const serverLabel = isMychal ? 'mychalsmp.xyz' : server;

            activity = {
                details: isMychal ? 'Hraje na síti mychalsmp.xyz' : `Hraje na ${serverLabel}`,
                state: `Nick: ${username} | ${profileName}`,
                timestamps: {
                    start: startTime || Date.now()
                },
                assets: {
                    large_image: 'mychalsmp_logo',
                    large_text: 'MYCHAL SMP (mychalsmp.xyz)',
                    small_image: 'minecraft',
                    small_text: profileName
                }
            };
        } else {
            activity = {
                details: 'V launcheru MYCHAL SMP',
                state: `Nick: ${username} | Profil: ${profileName}`,
                assets: {
                    large_image: 'mychalsmp_logo',
                    large_text: 'MYCHAL SMP (mychalsmp.xyz)'
                }
            };
        }

        this.currentActivity = activity;

        if (this.isConnected) {
            this.sendActivity(activity);
        } else {
            this.connect();
        }
    }

    clearActivity() {
        this.currentActivity = null;
        if (this.isConnected) {
            this.sendActivity(null);
        }
    }

    shutdown() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.clearActivity();
        this.cleanup();
    }
}

// Singleton instance
const discordRpc = new DiscordRpcClient();

module.exports = {
    discordRpc,
    DiscordRpcClient
};
