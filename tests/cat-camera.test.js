const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const {WebSocket, WebSocketServer} = require('ws');
const {createAuthentication} = require('../services/authentication');
const {createCameraRouter} = require('../routes/catcam');
const {createClipStore} = require('../services/cameraClips');
const {CameraError, validateSettings, createCameraStore, createCameraBridge, createCameraStreams} = require('../services/catCamera');

const secret = 'catcam-test-jwt-secret';
process.env.ACCESS_TOKEN_SECRET = secret;
const input = {title: 'Milo’s window', host: '192.168.1.50', port: '554', username: 'camera-cat',
    password: 'private-p@ss:word/#', quality: 'high'};

async function setup(t, {streamLifetime = 60_000, accessInterval = 15_000, feedAccessInterval = 15_000} = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'detschn-catcam-test-'));
    const filename = path.join(directory, 'settings.enc');
    const key = 'ab'.repeat(32);
    const store = createCameraStore({filename, encryptionKey: () => key});
    const accounts = new Map([
        ['admin', {uuid: 'admin', username: 'admin', user_role: 'admin', login_enabled: true}],
        ['owner', {uuid: 'owner', username: 'detschn', user_role: 'streamer', login_enabled: false}],
        ['viewer', {uuid: 'viewer', username: 'viewer', user_role: 'streamer', login_enabled: true}],
        ['disabled', {uuid: 'disabled', username: 'disabled', user_role: 'admin', login_enabled: false}]
    ]);
    const upstream = new WebSocketServer({port: 0, host: '127.0.0.1'});
    await once(upstream, 'listening');
    const upstreamUrl = `ws://127.0.0.1:${upstream.address().port}/api/ws?src=private`;
    const bridgeCalls = [];
    const bridge = {async prepare(settings, quality) {bridgeCalls.push({settings, quality}); return upstreamUrl;}};
    const auth = createAuthentication({getUserByUuid: async uuid => accounts.get(uuid)});
    const streams = createCameraStreams({streamLifetime, accessInterval});
    const recordings = createClipStore({directory: path.join(directory, 'recordings')});
    let discordTests = 0;
    const monitor = {clips: recordings, refresh() {}, status: () => ({enabled: true, sensor: 'listening', recording: 'ready'}), subscribe: () => () => {},
        async testDiscord() {if (!(await store.read())?.discordWebhookUrl) throw new CameraError('Save a Discord webhook URL first.', 409); discordTests++;}};
    const camera = createCameraRouter({auth, store, bridge, streams, monitor, feedAccessInterval});
    const app = express();
    app.set('views', path.join(__dirname, '../views'));
    app.set('view engine', 'ejs');
    app.use(cookieParser());
    app.use(session({secret: 'camera-session-test', resave: false, saveUninitialized: false}));
    app.use('/catcam', camera.router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    camera.attach(server);
    t.after(async () => {
        streams.close();
        for (const client of upstream.clients) client.terminate();
        await new Promise(resolve => upstream.close(resolve));
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        assert.equal(path.dirname(directory), os.tmpdir());
        assert.match(path.basename(directory), /^detschn-catcam-test-/);
        await fs.rm(directory, {recursive: true, force: true});
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = (uuid = 'admin', options = {}) => jwt.sign({uuid, username: 'detschn', role: 'admin'}, options.secret || secret,
        {expiresIn: options.expired ? -1 : '1h'});
    const loginCookie = uuid => `accessToken=${token(uuid)}`;
    async function request(url = '', {cookie = '', body, method = body ? 'POST' : 'GET', headers = {}} = {}) {
        return fetch(`${base}/catcam${url}`, {method, redirect: 'manual', headers: {Cookie: cookie,
            ...(body ? {'Content-Type': 'application/json'} : {}), ...headers}, body: body ? JSON.stringify(body) : undefined});
    }
    async function form(uuid = 'admin') {
        const cookie = loginCookie(uuid);
        const response = await request('', {cookie});
        assert.equal(response.status, 200);
        const html = await response.text();
        return {csrfToken: html.match(/name="csrfToken" value="([a-f0-9]+)"/)[1], html,
            cookie: `${cookie}; ${response.headers.get('set-cookie').split(';')[0]}`};
    }
    async function ticket(form, quality = 'high') {
        const response = await request('/ticket', {cookie: form.cookie, body: {csrfToken: form.csrfToken, quality}});
        assert.equal(response.status, 200, await response.clone().text());
        return (await response.json()).url;
    }
    function connect(url, cookie, origin = base) {
        return new WebSocket(base.replace('http:', 'ws:') + url, {headers: {Cookie: cookie, Origin: origin}});
    }
    return {directory, filename, key, store, recordings, accounts, streams, upstream, upstreamUrl, bridgeCalls, base,
        token, loginCookie, request, form, ticket, connect, discordTests: () => discordTests};
}

test('all page, asset, settings and ticket routes require an enabled database admin', async t => {
    const s = await setup(t);
    for (const uuid of [null, 'viewer', 'disabled', 'missing']) {
        const cookie = uuid ? s.loginCookie(uuid) : '';
        for (const [url, body] of [['', null], ['/assets/camera.js', null], ['/assets/camera.css', null],
            ['/assets/motion.js', null], ['/assets/discord.js', null], ['/discord/settings', {}], ['/discord/test', {}], ['/status', null], ['/storage', null], ['/events', null], ['/clips', null],
            ['/clips/00000000-0000-4000-8000-000000000001/video', null], ['/clips/00000000-0000-4000-8000-000000000001/poster', null],
            ['/clips/00000000-0000-4000-8000-000000000001/flag', {flagged: true}], ['/clips/00000000-0000-4000-8000-000000000001/delete', {}], ['/settings', input], ['/ticket', {quality: 'high'}]]) {
            const response = await s.request(url, {cookie, body});
            assert.equal(response.status, uuid ? 403 : 401, `${uuid}: ${url}`);
        }
    }
    for (const value of ['bad', s.token('admin', {expired: true}), s.token('admin', {secret: 'forged'})]) {
        assert.equal((await s.request('', {cookie: `accessToken=${value}`})).status, 401);
    }
    assert.equal(s.bridgeCalls.length, 0);
    await assert.rejects(fs.access(s.filename));
    const owner = await s.form('owner');
    assert.match(owner.html, /Connection settings/);
});

test('settings survive restart encrypted, never return passwords, and retain a blank password', async t => {
    const s = await setup(t), form = await s.form();
    const saved = await s.request('/settings', {cookie: form.cookie, body: {...input, csrfToken: form.csrfToken}});
    assert.equal(saved.status, 200);
    assert.doesNotMatch(await saved.text(), /private-p|camera-cat|192\.168/);
    const disk = await fs.readFile(s.filename, 'utf8');
    assert.doesNotMatch(disk, /private-p|camera-cat|192\.168|Milo/);
    const restarted = createCameraStore({filename: s.filename, encryptionKey: () => s.key});
    assert.deepEqual(await restarted.read(), {...input, port: 554, motionEnabled: true, discordWebhookUrl: '', discordEnabled: false, discordCooldownSeconds: 60});
    assert.equal((await s.request('/settings', {cookie: form.cookie,
        body: {...input, password: '', title: 'Updated', csrfToken: form.csrfToken}})).status, 200);
    assert.equal((await restarted.read()).password, input.password);
    const page = await s.request('', {cookie: form.cookie});
    const html = await page.text();
    assert.match(html, /Updated/);
    assert.doesNotMatch(html, /private-p|p%40ss/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const wrongKey = createCameraStore({filename: s.filename, encryptionKey: () => 'cd'.repeat(32)});
    await assert.rejects(wrongKey.read(), /could not be unlocked/);
    assert.equal((await s.request('/assets/../settings.enc', {cookie: form.cookie})).status, 404);
});

test('settings and tickets reject missing/forged CSRF and unsafe camera targets', async t => {
    const s = await setup(t), form = await s.form();
    for (const csrfToken of [undefined, '0'.repeat(64), 'é'.repeat(64)]) {
        for (const url of ['/settings', '/ticket']) {
            assert.equal((await s.request(url, {cookie: form.cookie, body: {...input, csrfToken}})).status, 403);
        }
    }
    for (const host of ['127.0.0.1', '169.254.169.254', '8.8.8.8', 'camera.local', '192.168.1.1/../api', '::1']) {
        assert.equal((await s.request('/settings', {cookie: form.cookie, body: {...input, host, csrfToken: form.csrfToken}})).status, 400);
    }
    assert.equal((await s.request('/ticket', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 409);
    assert.throws(() => validateSettings({...input, quality: 'rtsp://other'}), CameraError);
    await assert.rejects(fs.access(s.filename));
    assert.equal(s.bridgeCalls.length, 0);
});

test('go2rtc receives encoded RTSP credentials and fixed paths; bridge errors are redacted', async () => {
    const calls = [];
    const bridge = createCameraBridge({fetchImpl: async (url, options) => {calls.push({url, options}); return new Response('');}});
    const url = await bridge.prepare({...input, port: 554}, 'low');
    assert.match(url, /^ws:\/\/127\.0\.0\.1:1984\/api\/ws\?src=detschn_catcam_/);
    const source = new URL(calls[0].url.searchParams.get('src'));
    assert.equal(source.pathname, '/stream2');
    assert.equal(decodeURIComponent(source.password), input.password);
    assert.equal(calls[0].options.method, 'PUT');
    assert.equal(source.hostname, input.host);
    const broken = createCameraBridge({fetchImpl: async () => {throw new Error(`rtsp://${input.password}@host`);}});
    await assert.rejects(broken.prepare(input, 'high'), error => error.status === 502 && !error.message.includes(input.password));
});

async function rejected(client, expected = 403) {
    client.on('error', () => {});
    await new Promise((resolve, reject) => {
        client.once('open', () => {client.terminate(); reject(new Error('Unauthorized socket opened'));});
        client.once('unexpected-response', (req, res) => {res.resume(); client.terminate();
            try {assert.equal(res.statusCode, expected); resolve();} catch (error) {reject(error);}});
        client.once('error', error => {if (!/before the connection was established/.test(error.message)) reject(error);});
    });
}

test('stream tickets are cookie-bound, same-origin, single-use and recheck the current admin role', async t => {
    const s = await setup(t), form = await s.form();
    await s.store.save(input);
    const ticket = await s.ticket(form);
    await rejected(s.connect('/catcam/live', form.cookie));
    await rejected(s.connect(ticket, s.loginCookie('viewer')));
    await rejected(s.connect(ticket, form.cookie, 'https://evil.example'));
    const client = s.connect(ticket, form.cookie);
    await once(client, 'open');
    client.on('error', () => {});
    await rejected(s.connect(ticket, form.cookie));
    client.terminate();
    const second = await s.ticket(form);
    s.accounts.get('admin').user_role = 'streamer';
    await rejected(s.connect(second, form.cookie));
    assert.equal((await s.request('/ticket', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 403);
});

test('authorized sockets relay MSE video but sanitize upstream errors and limit client commands', async t => {
    const s = await setup(t), form = await s.form();
    await s.store.save(input);
    const received = [];
    s.upstream.on('connection', client => client.on('message', data => {
        received.push(JSON.parse(data));
        client.send(JSON.stringify({type: 'mse', value: 'video/mp4; codecs="avc1.640029"'}));
        client.send(Buffer.from([0, 1, 2, 3]));
    }));
    const client = s.connect(await s.ticket(form), form.cookie);
    client.on('error', () => {});
    const messages = [];
    client.on('message', (data, binary) => messages.push({data, binary}));
    await once(client, 'open');
    const video = new Promise(resolve => client.on('message', (data, binary) => {if (binary) resolve();}));
    client.send(JSON.stringify({type: 'mse', value: 'avc1.640029'}));
    // Wait for actual binary output, rather than relying on message scheduling.
    await video;
    assert.deepEqual(received, [{type: 'mse', value: 'avc1.640029'}]);
    assert.ok(messages.some(message => message.binary && message.data.equals(Buffer.from([0, 1, 2, 3]))));
    const errorMessage = once(client, 'message');
    for (const upstreamClient of s.upstream.clients) upstreamClient.send(JSON.stringify({type: 'error', value: `rtsp://${input.password}@${input.host}`}));
    const [data] = await errorMessage;
    assert.doesNotMatch(data.toString(), /private-p|192\.168/);
    assert.match(data.toString(), /unavailable/);
    client.terminate();
    const commandClient = s.connect(await s.ticket(form), form.cookie);
    commandClient.on('error', () => {});
    await once(commandClient, 'open');
    const closed = once(commandClient, 'close');
    commandClient.send(JSON.stringify({type: 'config', value: 'unauthorized'}));
    assert.equal((await closed)[0], 1008);
});

test('saving settings invalidates tickets and active streams; long streams renew authorization', async t => {
    const s = await setup(t, {streamLifetime: 150}), form = await s.form();
    await s.store.save(input);
    const client = s.connect(await s.ticket(form), form.cookie);
    client.on('error', () => {});
    await once(client, 'open');
    const expired = await once(client, 'close');
    assert.equal(expired[0], 4000);
    const ticket = await s.ticket(form);
    const response = await s.request('/settings', {cookie: form.cookie, body: {...input, csrfToken: form.csrfToken}});
    assert.equal(response.status, 200);
    await rejected(s.connect(ticket, form.cookie));
});

test('ticket expiry and missing encryption keys fail closed', async t => {
    let now = 0;
    const streams = createCameraStreams({now: () => now, ticketLifetime: 1});
    const http = require('node:http');
    const server = http.createServer();
    streams.attach(server, async () => true);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {streams.close(); await new Promise(resolve => server.close(resolve));});
    const token = streams.issue('login', 'ws://127.0.0.1:1/');
    now = 2;
    const origin = `http://127.0.0.1:${server.address().port}`;
    await rejected(new WebSocket(`${origin.replace('http:', 'ws:')}/catcam/live?ticket=${token}`,
        {headers: {Origin: origin, Cookie: 'accessToken=login'}}));
    const store = createCameraStore({encryptionKey: () => ''});
    assert.equal(store.ready(), false);
    await assert.rejects(store.save(input), error => error.status === 503);
});

test('an active viewer loses the stream when their database admin role is revoked', async t => {
    const s = await setup(t, {accessInterval: 40}), form = await s.form();
    await s.store.save(input);
    const client = s.connect(await s.ticket(form), form.cookie);
    client.on('error', () => {});
    await once(client, 'open');
    const closed = once(client, 'close');
    s.accounts.get('admin').user_role = 'streamer';
    assert.equal((await closed)[0], 4003);
});

test('recording playback supports byte ranges and flagging requires session CSRF', async t => {
    const s = await setup(t), form = await s.form();
    const clip = await s.recordings.begin({eventAt: Date.now(), startAt: Date.now() - 10000});
    await fs.writeFile(s.recordings.file(clip.id), Buffer.from('test-mp4-video-content'));
    await fs.writeFile(s.recordings.file(clip.id, 'jpg'), Buffer.from([255, 216, 255, 217]));
    await s.recordings.update(clip.id, {status: 'ready', duration: 30, bytes: 22, poster: true});
    const range = await s.request(`/clips/${clip.id}/video`, {cookie: form.cookie, headers: {Range: 'bytes=0-3'}});
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-type'), 'video/mp4');
    assert.equal(await range.text(), 'test');
    assert.match(range.headers.get('cache-control'), /no-store/);
    assert.equal((await s.request(`/clips/${clip.id}/flag`, {cookie: form.cookie, body: {flagged: true}})).status, 403);
    const flagged = await s.request(`/clips/${clip.id}/flag`, {cookie: form.cookie, body: {flagged: true, csrfToken: form.csrfToken}});
    assert.equal(flagged.status, 200);
    assert.equal((await flagged.json()).flagged, true);
    const catalog = await s.request('/clips?flagged=true', {cookie: form.cookie});
    const data = await catalog.json();
    assert.equal(data.clips.length, 1);
    assert.equal(data.clips[0].expiresAt, null);
    assert.doesNotMatch(JSON.stringify(data), /catalog\.json|recordings\\|recordings\//);
    assert.equal((await s.request('/clips/not-a-uuid/video', {cookie: form.cookie})).status, 404);
    assert.equal((await s.request('/assets/catalog.json', {cookie: form.cookie})).status, 404);
});

test('monitoring can be disabled without losing the saved password or existing clips', async t => {
    const s = await setup(t), form = await s.form();
    await s.store.save(input);
    const response = await s.request('/settings', {cookie: form.cookie,
        body: {...input, password: '', motionEnabled: 'false', csrfToken: form.csrfToken}});
    assert.equal(response.status, 200);
    const settings = await s.store.read();
    assert.equal(settings.motionEnabled, false);
    assert.equal(settings.password, input.password);
    const html = (await s.form()).html;
    assert.doesNotMatch(html, /little window|favourite little housemate|A quiet place to check in/);
    assert.match(html, /Motion recordings/);
});

test('the live event feed ends when an administrator loses access', async t => {
    const s = await setup(t, {feedAccessInterval: 40}), form = await s.form();
    const response = await s.request('/events', {cookie: form.cookie});
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.match(Buffer.from(first.value).toString(), /event: status/);
    s.accounts.get('admin').user_role = 'streamer';
    let ended = false;
    while (!ended) ended = (await reader.read()).done;
    assert.equal(ended, true);
});


test('Discord settings are encrypted, hidden, admin/CSRF protected and independent of camera settings', async t => {
    const s = await setup(t), form = await s.form();
    const webhook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789';
    assert.equal((await s.request('/discord/settings', {cookie: form.cookie, body: {discordEnabled: true}})).status, 403);
    assert.equal((await s.request('/discord/test', {cookie: form.cookie, body: {}})).status, 403);
    assert.equal((await s.request('/discord/settings', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 409);
    await s.store.save(input);
    assert.equal((await s.request('/discord/test', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 409);
    const response = await s.request('/discord/settings', {cookie: form.cookie, body: {csrfToken: form.csrfToken,
        discordWebhookUrl: webhook, discordEnabled: true, discordCooldownSeconds: 60, host: '192.168.2.2'}});
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /abcdefghijklmnopqrstuvwxyz|123456789012345678/);
    assert.equal((await s.store.read()).host, input.host);
    assert.doesNotMatch(await fs.readFile(s.filename, 'utf8'), /discord|abcdefghijklmnopqrstuvwxyz/);
    assert.doesNotMatch(await (await s.request('', {cookie: form.cookie})).text(), /abcdefghijklmnopqrstuvwxyz|123456789012345678/);
    await s.store.save({...input, password: '', title: 'New title'});
    assert.equal((await s.store.read()).discordWebhookUrl, webhook);
    await s.store.save({discordWebhookUrl: '', discordCooldownSeconds: 120}, {discordOnly: true});
    assert.equal((await s.store.read()).discordWebhookUrl, webhook);
    assert.equal((await s.store.read()).title, 'New title');
    assert.equal((await s.request('/discord/test', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 200);
    assert.equal(s.discordTests(), 1);
    for (const bad of [{discordWebhookUrl: 'http://127.0.0.1:1984/'}, {discordCooldownSeconds: 1}, {discordEnabled: 'maybe'}]) {
        assert.equal((await s.request('/discord/settings', {cookie: form.cookie, body: {...bad, csrfToken: form.csrfToken}})).status, 400);
    }
    await s.store.save({discordRemove: true}, {discordOnly: true});
    assert.equal((await s.store.read()).discordWebhookUrl, '');
    assert.equal((await s.store.read()).password, input.password);
});


test('disk space is private and manual clip deletion requires admin access and session CSRF', async t => {
    const s = await setup(t), form = await s.form();
    const disk = await s.request('/storage', {cookie: form.cookie});
    assert.equal(disk.status, 200);
    assert.match(disk.headers.get('cache-control'), /no-store/);
    const usage = await disk.json();
    assert.ok(usage.totalBytes > 0 && usage.availableBytes >= 0 && usage.availableBytes <= usage.totalBytes);
    assert.deepEqual(Object.keys(usage).sort(), ['availableBytes', 'totalBytes']);
    const clip = await s.recordings.begin({eventAt: Date.now(), startAt: Date.now() - 10000});
    await fs.writeFile(s.recordings.file(clip.id), 'reviewed-video');
    await fs.writeFile(s.recordings.file(clip.id, 'jpg'), 'poster');
    await s.recordings.update(clip.id, {status: 'ready', poster: true});
    await s.recordings.flag(clip.id, true);
    assert.equal((await s.request('/clips/'+clip.id+'/delete', {cookie: form.cookie, body: {}})).status, 403);
    assert.equal((await s.request('/clips/'+clip.id+'/delete', {cookie: form.cookie, body: {csrfToken: '0'.repeat(64)}})).status, 403);
    assert.equal(await fs.readFile(s.recordings.file(clip.id), 'utf8'), 'reviewed-video');
    const response = await s.request('/clips/'+clip.id+'/delete', {cookie: form.cookie, body: {csrfToken: form.csrfToken}});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {deleted: true, id: clip.id});
    assert.equal((await s.request('/clips/'+clip.id+'/video', {cookie: form.cookie})).status, 404);
    await assert.rejects(fs.access(s.recordings.file(clip.id, 'jpg')));
    const active = await s.recordings.begin({eventAt: Date.now(), startAt: Date.now()});
    assert.equal((await s.request('/clips/'+active.id+'/delete', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 409);
    assert.equal((await s.request('/clips/not-a-uuid/delete', {cookie: form.cookie, body: {csrfToken: form.csrfToken}})).status, 404);
});
