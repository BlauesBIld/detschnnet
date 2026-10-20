const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateDiscordWebhook, createDiscordAlerts} = require('../services/cameraDiscord');
const url = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789';
const settings = {discordWebhookUrl: url, discordEnabled: true, discordCooldownSeconds: 60};

test('Discord destinations reject private URLs, deceptive hosts, credentials and redirects', async () => {
    assert.equal(validateDiscordWebhook(url), url);
    assert.equal(validateDiscordWebhook(url.replace('discord.com', 'discordapp.com')), url);
    for (const invalid of ['http://127.0.0.1:1984/api/streams', url.replace('https:', 'http:'),
        url.replace('discord.com', 'discord.com.evil.example'), url.replace('discord.com', 'discord.com@127.0.0.1'),
        url + '?redirect=http://localhost', url + '#token', url.replace('/api/webhooks/', '/other/'),
        url.replace('discord.com', 'discord.com:8443')]) assert.throws(() => validateDiscordWebhook(invalid), /webhook URL/);
    let calls = 0;
    const alerts = createDiscordAlerts({fetchImpl: async (target, options) => {
        calls++;
        assert.equal(options.redirect, 'error');
        throw new Error(`request failed with secret ${target}`);
    }});
    alerts.configure(settings);
    assert.equal(await alerts.send(), false);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(alerts.status()), /abcdefghijklmnopqrstuvwxyz|webhooks|123456789012345678/);
});

test('Discord alerts send fixed text without mentions and enforce cooldown for motion and test messages', async () => {
    let clock = 100000, calls = [];
    const alerts = createDiscordAlerts({now: () => clock, fetchImpl: async (target, options) => {
        calls.push({target, options});
        return new Response('{}', {status: 200});
    }});
    alerts.configure(settings);
    assert.equal(await alerts.send(), true);
    assert.equal(await alerts.send(), false);
    await assert.rejects(alerts.send({test: true}), /cooldown/);
    assert.equal(calls.length, 1);
    const payload = JSON.parse(calls[0].options.body);
    assert.match(payload.content, /Motion detected on camera, please check/);
    assert.deepEqual(payload.allowed_mentions, {parse: []});
    assert.match(calls[0].target, /\?wait=true$/);
    assert.equal(alerts.status().lastSentAt, clock);
    clock += 60000;
    alerts.configure({...settings, discordCooldownSeconds: 120});
    assert.equal(await alerts.send(), false);
    alerts.configure(settings);
    assert.equal(await alerts.send({test: true}), true);
    assert.match(JSON.parse(calls[1].options.body).content, /notification test/);
    alerts.configure({...settings, discordEnabled: false});
    clock += 60000;
    assert.equal(await alerts.send(), false);
    assert.equal(calls.length, 2);
});

test('Discord respects rate limits and does not queue messages or expose server errors', async () => {
    let clock = 100000, calls = 0;
    const alerts = createDiscordAlerts({now: () => clock, fetchImpl: async () => {
        calls++;
        return new Response('private upstream response', {status: 429, headers: {'Retry-After': '120'}});
    }});
    alerts.configure(settings);
    assert.equal(await alerts.send(), false);
    clock += 60000;
    alerts.configure({...settings, discordCooldownSeconds: 15});
    assert.equal(await alerts.send(), false);
    assert.equal(calls, 1);
    assert.match(alerts.status().lastError, /rate-limited/);
    clock += 60000;
    await assert.rejects(alerts.send({test: true}), /rate-limited/);
    assert.equal(calls, 2);
    assert.doesNotMatch(alerts.status().lastError, /private/);
});

test('an in-flight Discord request cannot fan out or affect a replacement webhook status', async () => {
    let finish, calls = 0;
    const alerts = createDiscordAlerts({fetchImpl: () => {calls++; return new Promise(resolve => {finish = resolve;});}});
    alerts.configure(settings);
    const sending = alerts.send();
    assert.equal(await alerts.send(), false);
    assert.equal(calls, 1);
    alerts.configure({...settings, discordWebhookUrl: ''});
    finish(new Response('{}', {status: 200}));
    await sending;
    assert.equal(alerts.status().lastSentAt, null);
    assert.equal(alerts.status().configured, false);
    await assert.rejects(alerts.send({test: true}), /Save a Discord webhook/);
});

test('motion screenshots upload as a JPEG attachment with a matching inline image', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    let captures = 0, calls = 0;
    const alerts = createDiscordAlerts({fetchImpl: async (target, options) => {
        calls++;
        assert.equal(options.headers, undefined, 'fetch supplies the multipart boundary');
        const request = new Request(target, {method: 'POST', body: options.body});
        assert.match(request.headers.get('content-type'), /multipart\/form-data; boundary=/);
        const form = await request.formData(), payload = JSON.parse(form.get('payload_json'));
        const image = form.get('files[0]');
        assert.equal(image.type, 'image/jpeg');
        assert.equal(image.name, 'motion.jpg');
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
        assert.equal(payload.attachments[0].filename, image.name);
        assert.equal(payload.embeds[0].image.url, 'attachment://motion.jpg');
        assert.deepEqual(payload.allowed_mentions, {parse: []});
        return new Response('{}', {status: 200});
    }});
    const screenshot = async () => {captures++; return jpeg;};
    alerts.configure(settings);
    assert.equal(await alerts.send({screenshot}), true);
    assert.equal(alerts.status().lastScreenshot, true);
    assert.equal(await alerts.send({screenshot}), false);
    assert.equal(captures, 1);
    assert.equal(calls, 1);
});

test('unavailable or oversized screenshots fall back to text without losing the alert', async () => {
    const calls = [];
    const alerts = createDiscordAlerts({fetchImpl: async (target, options) => {calls.push(options); return new Response('{}', {status: 200});}});
    alerts.configure(settings);
    assert.equal(await alerts.send({screenshot: async () => {throw new Error('private recording path');}}), true);
    assert.match(JSON.parse(calls[0].body).content, /Screenshot unavailable/);
    assert.equal(alerts.status().lastScreenshot, false);
    assert.equal(alerts.status().lastError, '');
    alerts.configure({...settings, discordWebhookUrl: url.replace('123456789012345678', '223456789012345678')});
    assert.equal(await alerts.send({screenshot: async () => Buffer.alloc(2 * 1024 * 1024 + 1)}), true);
    assert.equal(typeof calls[1].body, 'string');
    assert.doesNotMatch(JSON.stringify(calls), /private recording/);
});

test('disabling Discord while a screenshot is being prepared cancels its upload', async () => {
    let captured, calls = 0;
    const alerts = createDiscordAlerts({fetchImpl: async () => {calls++; return new Response('{}', {status: 200});}});
    alerts.configure(settings);
    const sending = alerts.send({screenshot: () => new Promise(resolve => {captured = resolve;})});
    alerts.configure({...settings, discordEnabled: false});
    captured(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    assert.equal(await sending, false);
    assert.equal(calls, 0);
    assert.equal(alerts.status().lastSentAt, null);
});
