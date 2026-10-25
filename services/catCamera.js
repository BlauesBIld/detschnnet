const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {randomBytes, createCipheriv, createDecipheriv, createHash} = require('node:crypto');
const {WebSocket, WebSocketServer} = require('ws');
const cookieParser = require('cookie-parser');
const {validateDiscordWebhook} = require('./cameraDiscord');

class CameraError extends Error {
    constructor(message, status = 400) {super(message); this.status = status;}
}

function validateSettings(input, previous = {}) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const host = typeof input.host === 'string' ? input.host.trim() : '';
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = input.password === '' ? previous.password : input.password;
    const port = Number(input.port);
    const octets = host.split('.').map(Number);
    const privateAddress = net.isIP(host) === 4 && (octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
    if (!title || title.length > 80) throw new CameraError('Enter a camera name of up to 80 characters.');
    if (!privateAddress) throw new CameraError('Enter the camera’s private IPv4 address, for example 192.168.1.50.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CameraError('Enter a valid RTSP port.');
    if (!username || username.length > 64 || /[\x00-\x1f\x7f]/.test(username)) throw new CameraError('Enter a valid camera username.');
    if (typeof password !== 'string' || !password || password.length > 128 || /[\x00-\x1f\x7f]/.test(password)) {
        throw new CameraError('Enter the Camera Account password created in Tapo.');
    }
    if (!['high', 'low'].includes(input.quality)) throw new CameraError('Choose a video quality.');
    const motionEnabled = input.motionEnabled === undefined ? previous.motionEnabled ?? true : input.motionEnabled;
    if (![true, false, 'true', 'false'].includes(motionEnabled)) throw new CameraError('Choose whether motion monitoring is enabled.');
    const bool = (value, fallback) => {
        value = value === undefined ? fallback : value;
        if (![true, false, 'true', 'false'].includes(value)) throw new CameraError('Choose whether Discord alerts are enabled.');
        return value === true || value === 'true';
    };
    let discordWebhookUrl;
    try {discordWebhookUrl = validateDiscordWebhook(input.discordWebhookUrl === '' || input.discordWebhookUrl === undefined ?
        previous.discordWebhookUrl || '' : input.discordWebhookUrl);} catch (error) {throw new CameraError(error.message);}
    const discordRemove = bool(input.discordRemove, false);
    if (discordRemove) discordWebhookUrl = '';
    const discordEnabled = !discordRemove && bool(input.discordEnabled, previous.discordEnabled ?? false);
    const discordCooldownSeconds = Number(input.discordCooldownSeconds ?? previous.discordCooldownSeconds ?? 60);
    if (!Number.isInteger(discordCooldownSeconds) || discordCooldownSeconds < 15 || discordCooldownSeconds > 3600) {
        throw new CameraError('Choose a Discord cooldown between 15 and 3600 seconds.');
    }
    if (discordEnabled && !discordWebhookUrl) throw new CameraError('Save a Discord webhook URL before enabling alerts.');
    return {title, host, port, username, password, quality: input.quality, motionEnabled: motionEnabled === true || motionEnabled === 'true',
        discordWebhookUrl, discordEnabled, discordCooldownSeconds};
}

function createCameraStore({filename = path.join(__dirname, '../data/catcam/settings.enc'),
    encryptionKey = () => process.env.CATCAM_SETTINGS_KEY} = {}) {
    let pending = Promise.resolve();
    function key() {
        const value = encryptionKey();
        if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
            throw new CameraError('The server needs a CATCAM_SETTINGS_KEY before camera settings can be saved.', 503);
        }
        return Buffer.from(value, 'hex');
    }
    return {
        ready() {try {key(); return true;} catch {return false;}},
        async read() {
            let contents;
            try {contents = await fs.readFile(filename, 'utf8');} catch (error) {
                if (error.code === 'ENOENT') return null;
                throw new CameraError('Camera settings could not be read.', 503);
            }
            const secret = key();
            try {
                const value = JSON.parse(contents);
                const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(value.iv, 'hex'));
                decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
                const plaintext = Buffer.concat([decipher.update(Buffer.from(value.data, 'hex')), decipher.final()]);
                const settings = JSON.parse(plaintext.toString('utf8'));
                // Pause existing alerts once for the notification-checkbox rollout.
                // Keep the webhook; saving the new checkbox persists the next choice.
                if (value.version === 1) settings.discordEnabled = false;
                return validateSettings(settings);
            } catch {throw new CameraError('Camera settings could not be unlocked. Check the server encryption key.', 503);}
        },
        async save(input, {discordOnly = false} = {}) {
            const operation = pending.then(async () => {
                const previous = await this.read();
                if (discordOnly && !previous) throw new CameraError('Save your camera settings first.', 409);
                const allowed = discordOnly ? Object.fromEntries(['discordWebhookUrl', 'discordEnabled', 'discordCooldownSeconds', 'discordRemove']
                    .filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])) : input;
                const settings = validateSettings(discordOnly ? {...previous, ...allowed} : allowed, previous || {});
                const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
                const data = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]);
                const contents = JSON.stringify({version: 2, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex')});
                const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
                try {
                    await fs.mkdir(path.dirname(filename), {recursive: true, mode: 0o700});
                    await fs.writeFile(temporary, contents, {mode: 0o600, flag: 'wx'});
                    await fs.rename(temporary, filename);
                } catch {throw new CameraError('Camera settings could not be saved.', 503);}
                finally {await fs.unlink(temporary).catch(() => {});}
                return settings;
            });
            pending = operation.catch(() => {});
            return operation;
        }
    };
}

function createCameraBridge({baseUrl = process.env.CATCAM_BRIDGE_URL || 'http://127.0.0.1:1984',
    fetchImpl = fetch} = {}) {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
        throw new CameraError('Invalid camera bridge configuration.', 503);
    }
    const registrations = new Map();
    return {
        async prepare(settings, quality) {
            const source = new URL(`rtsp://${settings.host}:${settings.port}/${quality === 'low' ? 'stream2' : 'stream1'}`);
            source.username = settings.username;
            source.password = settings.password;
            const name = `detschn_catcam_${createHash('sha256').update(source.href).digest('hex').slice(0, 20)}`;
            if ((registrations.get(name) || 0) < Date.now()) {
                const url = new URL('/api/streams', base);
                url.searchParams.set('name', name);
                url.searchParams.set('src', source.href);
                try {
                    const response = await fetchImpl(url, {method: 'PUT', signal: AbortSignal.timeout(8000), redirect: 'error'});
                    await response.body?.cancel();
                    if (!response.ok) throw new Error('Bridge rejected stream');
                } catch {throw new CameraError('The video bridge is unavailable. Check that go2rtc is running on the server.', 502);}
                registrations.set(name, Date.now() + 30_000);
                if (registrations.size > 20) registrations.delete(registrations.keys().next().value);
            }
            const url = new URL('/api/ws', base);
            url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
            url.searchParams.set('src', name);
            return url.href;
        },
        async recordingUrl(settings) {
            const stream = new URL(await this.prepare(settings, 'high'));
            const url = new URL('/api/stream.mp4', base);
            url.searchParams.set('src', stream.searchParams.get('src'));
            url.searchParams.set('mp4', 'flac');
            return url.href;
        }
    };
}

// A ticket is minted only by the admin-protected POST route. It is short lived,
// single use, and bound to the exact login cookie; no camera credential reaches the browser.
function createCameraStreams({ticketLifetime = 15_000, streamLifetime = 30 * 60_000, accessInterval = 15_000, now = Date.now} = {}) {
    const tickets = new Map();
    const server = new WebSocketServer({noServer: true, maxPayload: 2048, perMessageDeflate: false});
    const fingerprint = value => createHash('sha256').update(value || '').digest('hex');
    function reject(socket, status = 403) {
        socket.end(`HTTP/1.1 ${status} ${status === 503 ? 'Service Unavailable' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    return {
        issue(cookie, upstream) {
            for (const [token, value] of tickets) if (value.expires <= now()) tickets.delete(token);
            if (tickets.size >= 1000) throw new CameraError('Too many camera connections. Try again shortly.', 503);
            const token = randomBytes(32).toString('hex');
            tickets.set(token, {cookie: fingerprint(cookie), upstream, expires: now() + ticketLifetime});
            return token;
        },
        invalidate() {
            tickets.clear();
            for (const client of server.clients) client.close(4001, 'Camera settings changed');
        },
        attach(httpServer, authorize) {
            const upgrade = async (req, socket, head) => {
                socket.on('error', () => {});
                let url, origin;
                try {url = new URL(req.url, 'http://localhost');} catch {return reject(socket);}
                if (url.pathname !== '/catcam/live') return reject(socket);
                try {origin = new URL(req.headers.origin);} catch {return reject(socket);}
                if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) return reject(socket);
                cookieParser()(req, {}, () => {});
                const token = url.searchParams.get('ticket');
                const ticket = tickets.get(token);
                if (!ticket || ticket.expires <= now() || ticket.cookie !== fingerprint(req.cookies?.accessToken)) return reject(socket);
                tickets.delete(token);
                // Recheck the database role after minting the ticket, and while streaming.
                if (!await authorize(req) || socket.destroyed) return reject(socket);
                if (server.clients.size >= 12) return reject(socket, 503);
                server.handleUpgrade(req, socket, head, client => {
                    const upstream = new WebSocket(ticket.upstream, {maxPayload: 8 * 1024 * 1024,
                        perMessageDeflate: false, handshakeTimeout: 8000, followRedirects: false});
                    let negotiation, negotiated = false;
                    const timer = setTimeout(() => client.close(4000, 'Renew camera access'), streamLifetime);
                    timer.unref();
                    let checking = false;
                    const accessTimer = setInterval(async () => {
                        if (checking) return;
                        checking = true;
                        try {if (!await authorize(req)) client.close(4003, 'Admin access required');}
                        finally {checking = false;}
                    }, accessInterval);
                    accessTimer.unref();
                    function stop() {clearTimeout(timer); clearInterval(accessTimer); upstream.terminate();}
                    function fail() {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({type: 'error', value: 'The camera stream is unavailable. Check its power, network and Camera Account settings.'}));
                            client.close(1011, 'Camera unavailable');
                        }
                    }
                    client.on('error', stop);
                    client.on('close', stop);
                    client.on('message', (data, binary) => {
                        let message;
                        try {message = JSON.parse(data.toString());} catch {return client.close(1008, 'Invalid request');}
                        if (binary || negotiated || message.type !== 'mse' || typeof message.value !== 'string' ||
                            !/^[a-zA-Z0-9.,]{1,512}$/.test(message.value)) return client.close(1008, 'Invalid request');
                        negotiated = true;
                        negotiation = JSON.stringify({type: 'mse', value: message.value});
                        if (upstream.readyState === WebSocket.OPEN) upstream.send(negotiation);
                    });
                    upstream.on('open', () => {if (negotiation) upstream.send(negotiation);});
                    upstream.on('message', (data, binary) => {
                        if (client.readyState !== WebSocket.OPEN) return;
                        if (client.bufferedAmount > 4 * 1024 * 1024) return client.close(1013, 'Connection too slow');
                        if (binary) return client.send(data, {binary: true});
                        let message;
                        try {message = JSON.parse(data.toString());} catch {return fail();}
                        // Never forward raw bridge errors: they can contain source credentials.
                        if (message.type === 'error') return fail();
                        if (message.type === 'mse' && typeof message.value === 'string' &&
                            /^video\/mp4; codecs="[a-zA-Z0-9., ]+"$/.test(message.value) && message.value.length < 512) {
                            client.send(JSON.stringify({type: 'mse', value: message.value}));
                        }
                    });
                    upstream.on('error', fail);
                    upstream.on('close', () => {if (client.readyState === WebSocket.OPEN) client.close(1011, 'Camera connection closed');});
                });
            };
            httpServer.on('upgrade', upgrade);
            httpServer.once('close', () => {this.close();});
        },
        close() {tickets.clear(); for (const client of server.clients) client.terminate(); server.close();}
    };
}

module.exports = {CameraError, validateSettings, createCameraStore, createCameraBridge, createCameraStreams};
