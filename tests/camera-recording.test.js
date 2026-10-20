const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {randomUUID} = require('node:crypto');
const ffmpeg = require('ffmpeg-static');
const {createClipStore, RETENTION_MS} = require('../services/cameraClips');
const {motionEvent} = require('../services/cameraMotion');
const {createCameraMonitor, parseSegments} = require('../services/cameraMonitor');
const {createDiscordAlerts} = require('../services/cameraDiscord');

async function temporary(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'detschn-recording-test-'));
    t.after(async () => {
        assert.equal(path.dirname(root), os.tmpdir());
        assert.match(path.basename(root), /^detschn-recording-test-/);
        await fs.rm(root, {recursive: true, force: true});
    });
    return root;
}

test('72-hour cleanup deletes only expired unflagged recordings and keeps flags across restarts', async t => {
    const root = await temporary(t);
    let clock = Date.now();
    const store = createClipStore({directory: root, now: () => clock});
    const old = await store.begin({eventAt: clock, startAt: clock - 10000});
    const kept = await store.begin({eventAt: clock, startAt: clock - 10000});
    for (const clip of [old, kept]) {
        await fs.writeFile(store.file(clip.id), 'video');
        await fs.writeFile(store.file(clip.id, 'jpg'), 'poster');
        await store.update(clip.id, {status: 'ready'});
    }
    await store.flag(kept.id, true);
    clock += RETENTION_MS - 1;
    assert.equal(await store.cleanup(), 0);
    clock += 1;
    const restarted = createClipStore({directory: root, now: () => clock});
    assert.equal(await restarted.init(), 1);
    await assert.rejects(fs.access(store.file(old.id)));
    await assert.rejects(fs.access(store.file(old.id, 'jpg')));
    assert.equal(await fs.readFile(store.file(kept.id), 'utf8'), 'video');
    assert.equal((await restarted.get(kept.id)).flagged, true);
    assert.equal((await restarted.list()).clips.length, 1);
    await restarted.flag(kept.id, false);
    assert.equal(await restarted.cleanup(), 1);
    await assert.rejects(fs.access(store.file(kept.id)));
});

test('restart recovery preserves completed clips and rejects corrupt catalogs and unsafe identifiers', async t => {
    const root = await temporary(t), store = createClipStore({directory: root});
    const clip = await store.begin({eventAt: Date.now(), startAt: Date.now() - 10000});
    const restarted = createClipStore({directory: root});
    await restarted.init();
    assert.equal((await restarted.get(clip.id)).status, 'failed');
    for (const id of ['../catalog', 'catalog.json', '/', '../' + randomUUID()]) {
        assert.throws(() => store.file(id), /not found/);
        await assert.rejects(store.get(id), /not found/);
    }
    await fs.writeFile(path.join(root, 'catalog.json'), '{broken');
    await assert.rejects(createClipStore({directory: root}).init(), /could not be read/);
    assert.equal(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'), '{broken');
});

test('an expired unflagged clip cannot be revived by a late flag request', async t => {
    const root = await temporary(t);
    let clock = Date.now();
    const store = createClipStore({directory: root, now: () => clock});
    const clip = await store.begin({eventAt: clock, startAt: clock - 10000});
    await fs.writeFile(store.file(clip.id), 'keep');
    await store.update(clip.id, {status: 'ready'});
    const flag = store.flag(clip.id, true);
    clock += RETENTION_MS;
    // Flag validation uses the clock at its actual serialized execution time.
    await assert.rejects(flag, /expired/);
    await store.cleanup();
    await assert.rejects(fs.access(store.file(clip.id)));
});

test('motion parser handles ONVIF attributes and boolean variants while ignoring unrelated events', () => {
    const event = value => ({topic: {_: 'tns1:RuleEngine/CellMotionDetector/Motion'},
        message: {message: {data: {simpleItem: {$: {Name: 'IsMotion', Value: value}}}}}});
    for (const value of [true, 'true', 1, '1']) assert.equal(motionEvent(event(value)).active, true);
    for (const value of [false, 'false', 0, '0']) assert.equal(motionEvent(event(value)).active, false);
    assert.equal(motionEvent(event('unknown')), null);
    assert.equal(motionEvent({...event(true), topic: {_: 'tns1:Device/Trigger/DigitalInput'}}), null);
    assert.equal(motionEvent({}), null);
    assert.deepEqual(parseSegments('part-00000001.mp4,0.000000,2.000000\npart-00000002.mp4,2.000000,4.000000\n../secret.ts,4,6\nincomplete'),
        [{name: 'part-00000001.mp4', start: 0, end: 2}, {name: 'part-00000002.mp4', start: 2, end: 4}]);
});

function execute(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, args, {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
        let error = '';
        child.stderr.on('data', data => {error += data;});
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve(error) : reject(new Error(error)));
    });
}
async function waitFor(check, timeout = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 150));}
    throw new Error('Timed out waiting for recording state');
}

test('motion notifications continue when the recording runtime is unavailable', async t => {
    let monitor;
    t.after(async () => monitor?.stop());
    const root = await temporary(t), clips = createClipStore({directory: path.join(root, 'recordings')});
    const events = [];
    let sensorClosed = false, discordMessages = 0;
    const discord = createDiscordAlerts({fetchImpl: async () => {discordMessages++; return new Response('{}', {status: 200});}});
    monitor = createCameraMonitor({clips, ffmpegPath: path.join(root, 'missing-ffmpeg'),
        discord, store: {read: async () => ({host: '192.168.1.50', motionEnabled: true, discordEnabled: true,
            discordWebhookUrl: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789'})},
        bridge: {recordingUrl: async () => 'http://127.0.0.1/unavailable'},
        watchMotion: (settings, {onStatus}) => {onStatus('listening'); return {close() {sensorClosed = true;}};}});
    monitor.subscribe(event => events.push(event));
    await monitor.start();
    await waitFor(() => monitor.status().recording === 'error');
    monitor.noteMotion(true);
    monitor.noteMotion(true);
    monitor.noteMotion(false);
    await waitFor(() => discord.status().lastSentAt);
    assert.equal(monitor.status().sensor, 'listening');
    assert.equal(sensorClosed, false);
    assert.ok(events.some(event => event.type === 'motion' && event.data.recording === false));
    assert.equal((await clips.list()).clips.length, 0);
    assert.equal(discordMessages, 1);
    assert.doesNotMatch(JSON.stringify(events), /abcdefghijklmnopqrstuvwxyz|webhooks/);
});

test('real FFmpeg captures pre/post-event footage, saves playable H.264/AAC MP4 and aligns motion markers', {timeout: 35000}, async t => {
    let monitor, server;
    t.after(async () => {await monitor?.stop(); if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}});
    const root = await temporary(t), source = path.join(root, 'source.mp4');
    await execute(['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '25', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-g', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source]);
    const bytes = await fs.readFile(source);
    server = http.createServer((req, res) => {res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Content-Length', bytes.length); res.end(bytes);});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const clips = createClipStore({directory: path.join(root, 'recordings')});
    const events = [];
    monitor = createCameraMonitor({store: {read: async () => ({host: '192.168.1.50', port: 554, username: 'test', password: 'secret', motionEnabled: true})},
        bridge: {recordingUrl: async () => `http://127.0.0.1:${server.address().port}/source.mp4`}, clips, ffmpegPath: ffmpeg,
        preMs: 2000, postMs: 2000, maxMs: 10000,
        watchMotion: (settings, {onStatus}) => {onStatus('listening'); return {close() {}};},
        spawnImpl: (file, args, options) => {
            if (args.includes('-segment_list')) {args = [...args]; args.splice(args.indexOf('-i'), 0, '-re');}
            return spawn(file, args, options);
        }});
    monitor.subscribe(event => events.push(event));
    await monitor.start();
    await waitFor(() => monitor.status().recording === 'ready');
    const triggered = Date.now();
    monitor.noteMotion(true, triggered);
    await new Promise(resolve => setTimeout(resolve, 200));
    monitor.noteMotion(false);
    const clip = await waitFor(async () => (await clips.list()).clips.find(clip => clip.status === 'ready'));
    assert.ok(events.some(event => event.type === 'motion' && event.data.at === triggered));
    assert.ok(clip.duration >= 3.5, 'clip includes pre-event and post-event video');
    const offset = (clip.events[0] - clip.startAt) / 1000;
    assert.ok(offset > 0.5 && offset < clip.duration, `motion marker is inside the clip: ${offset}s`);
    assert.ok(clip.poster);
    const mp4 = await fs.readFile(clips.file(clip.id));
    assert.ok(mp4.indexOf(Buffer.from('moov')) < mp4.indexOf(Buffer.from('mdat')), 'MP4 is optimized for browser playback');
    const decoded = await execute(['-hide_banner', '-i', clips.file(clip.id), '-f', 'null', '-']);
    assert.match(decoded, /Video: h264/);
    assert.match(decoded, /Audio: aac/);
    assert.doesNotMatch(JSON.stringify(events), /192\.168|secret|password/);
    await clips.flag(clip.id, true);
    assert.equal((await clips.get(clip.id)).expiresAt, null);
});
