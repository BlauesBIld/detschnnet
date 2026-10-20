const {MAX_SCREENSHOT_BYTES} = require('./cameraSnapshot');

// Webhook tokens are secrets. Only the validated Discord endpoint may receive them.
function validateDiscordWebhook(value) {
    if (typeof value !== 'string' || value.length > 400) throw new Error('Enter a valid Discord incoming webhook URL.');
    if (!value.trim()) return '';
    let url;
    try {url = new URL(value.trim());} catch {throw new Error('Enter a valid Discord incoming webhook URL.');}
    if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || url.port ||
        url.username || url.password || url.search || url.hash ||
        !/^\/api(?:\/v10)?\/webhooks\/\d{16,22}\/[A-Za-z0-9_-]{20,200}\/?$/.test(url.pathname)) {
        throw new Error('Use a standard HTTPS Discord incoming webhook URL.');
    }
    url.hostname = 'discord.com';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.href;
}

function createDiscordAlerts({fetchImpl = fetch, now = Date.now} = {}) {
    let url = '', enabled = false, cooldownSeconds = 60, nextAt = 0, inFlight = false;
    let lastSentAt = null, lastAttemptAt = null, rateLimitUntil = 0, lastScreenshot = null, lastError = '';
    const failure = (message, status = 502) => Object.assign(new Error(message), {status});
    return {
        configure(settings) {
            const next = validateDiscordWebhook(settings?.discordWebhookUrl || '');
            if (next !== url) {lastAttemptAt = null; rateLimitUntil = 0; lastSentAt = null; lastScreenshot = null; lastError = '';}
            url = next;
            enabled = Boolean(url && settings?.discordEnabled);
            cooldownSeconds = settings?.discordCooldownSeconds ?? 60;
            nextAt = Math.max(rateLimitUntil, lastAttemptAt === null ? 0 : lastAttemptAt + cooldownSeconds * 1000);
        },
        status() {return {configured: Boolean(url), enabled, cooldownSeconds, lastSentAt, lastScreenshot, lastError};},
        async send({test = false, screenshot} = {}) {
            if (!url || (!enabled && !test)) {
                if (test) throw failure('Save a Discord webhook URL first.', 409);
                return false;
            }
            if (inFlight || now() < nextAt) {
                if (test) throw failure('Discord alert cooldown is active. Wait before sending another test.', 429);
                return false;
            }
            inFlight = true;
            lastAttemptAt = now();
            nextAt = lastAttemptAt + cooldownSeconds * 1000;
            // Capture the destination so an old response cannot change a new webhook's status.
            const destination = url;
            let response;
            try {
                let image;
                if (screenshot) {
                    try {image = await screenshot();} catch {}
                }
                const attached = Buffer.isBuffer(image) && image.length >= 4 && image.length <= MAX_SCREENSHOT_BYTES &&
                    image[0] === 0xff && image[1] === 0xd8 && image.at(-2) === 0xff && image.at(-1) === 0xd9;
                // Settings can change while the event's video segment finishes.
                if (destination !== url || (!enabled && !test)) return false;
                const payload = {
                    content: test ? 'Camera notification test — Discord alerts are working.' : 'Motion detected on camera, please check.\nhttps://detschn.net/catcam',
                    allowed_mentions: {parse: []}
                };
                let body, headers;
                if (attached) {
                    payload.attachments = [{id: 0, filename: 'motion.jpg', description: test ? 'Current camera screenshot' : 'Camera screenshot at motion detection'}];
                    payload.embeds = [{image: {url: 'attachment://motion.jpg'}}];
                    body = new FormData();
                    body.set('payload_json', JSON.stringify(payload));
                    body.set('files[0]', new Blob([image], {type: 'image/jpeg'}), 'motion.jpg');
                } else {
                    if (screenshot) payload.content += '\nScreenshot unavailable for this event.';
                    headers = {'Content-Type': 'application/json'};
                    body = JSON.stringify(payload);
                }
                const target = new URL(destination);
                target.searchParams.set('wait', 'true');
                response = await fetchImpl(target.href, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
                    headers, body});
                if (response.status === 429) {
                    const retry = Number(response.headers.get('retry-after'));
                    if (destination === url && Number.isFinite(retry) && retry > 0) {
                        rateLimitUntil = now() + Math.min(retry, 3600) * 1000;
                        nextAt = Math.max(nextAt, rateLimitUntil);
                    }
                    throw failure('Discord rate-limited alerts. The next motion after the cooldown can send another message.');
                }
                if (!response.ok) throw failure(response.status === 401 || response.status === 404 ?
                    'Discord rejected the saved webhook. Replace it with a valid incoming webhook URL.' : 'Discord could not accept the alert.');
                if (destination === url) {lastSentAt = now(); lastScreenshot = attached; lastError = '';}
                return true;
            } catch (error) {
                const message = error.status ? error.message : 'Discord delivery failed. Check the webhook and server internet connection.';
                if (destination === url) lastError = message;
                if (test) throw failure(message);
                return false;
            } finally {
                await response?.body?.cancel().catch(() => {});
                inFlight = false;
            }
        }
    };
}

module.exports = {validateDiscordWebhook, createDiscordAlerts};
