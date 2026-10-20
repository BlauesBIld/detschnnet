const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {randomUUID, createHash} = require('node:crypto');
const {EventEmitter} = require('node:events');
const {watchCameraMotion} = require('./cameraMotion');
const {createClipStore} = require('./cameraClips');
const {createDiscordAlerts} = require('./cameraDiscord');
const {extractCameraJpeg} = require('./cameraSnapshot');

const PRE_MS = 10_000, POST_MS = 20_000, MAX_MS = 120_000;

function parseSegments(csv) {
    return csv.trim().split(/\r?\n/).flatMap(line => {
        const match = line.match(/^"?(part-\d{8}\.mp4)"?,(-?[\d.]+),(-?[\d.]+)$/);
        if (!match) return [];
        const start = Number(match[2]), end = Number(match[3]);
        return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{name: match[1], start, end}] : [];
    });
}

function createCameraMonitor({store, bridge, clips = createClipStore(), now = Date.now,
    ffmpegPath = process.env.CATCAM_FFMPEG_PATH || require('ffmpeg-static'), spawnImpl = spawn,
    watchMotion = watchCameraMotion, discord = createDiscordAlerts(), readDiskSpace = () => clips.diskUsage(),
    preMs = PRE_MS, postMs = POST_MS, maxMs = MAX_MS} = {}) {
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    const epoch = randomUUID(), history = [];
    const screenshotTasks = new Set();
    const bufferRoot = path.resolve(clips.directory, '../buffer');
    let seq = 0, started = false, stopped = false, initialized = false, ticking = false, interval;
    let settings, fingerprint = '', settingsChecked = 0, sensor, recorder, session, segments = [], windows = [];
    let motionActive = false, motionTimes = [], broken = false, retryAt = 0, cleanupAt = 0, diskCheckedAt = 0;
    let renderChain = Promise.resolve(), lastState = '';
    const state = {enabled: false, sensor: 'connecting', recording: 'starting', bufferSeconds: 0,
        preSeconds: preMs / 1000, postSeconds: postMs / 1000, retentionDays: 3, lastMotionAt: null, motionActive: false, warning: ''};

    function publish(type, data) {
        const event = {id: `${epoch}:${++seq}`, type, data};
        history.push(event);
        if (history.length > 160) history.shift();
        bus.emit('event', event);
    }
    function snapshot() {return {...state, motionActive, discord: discord.status()};}
    function announce() {
        const value = JSON.stringify(snapshot());
        if (value !== lastState) {lastState = value; publish('status', snapshot());}
    }
    function noteMotion(active, at = now()) {
        if (stopped || !state.enabled) return;
        if (active && !motionActive) {
            const recording = Boolean(recorder && state.recording !== 'error');
            if (recording) motionTimes.push(at);
            state.lastMotionAt = at;
            publish('motion', {at, recording});
            // Delivery is independent of recording and never delays camera events.
            discord.send({screenshot: () => captureScreenshot(at)}).then(announce, announce);
        }
        motionActive = active;
        announce();
    }
    function run(args, {cwd, timeout = 45_000} = {}) {
        return new Promise((resolve, reject) => {
            const child = spawnImpl(ffmpegPath, args, {cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
            child.stderr?.on('data', () => {});
            const timer = setTimeout(() => {child.kill('SIGKILL'); reject(new Error('Recording operation timed out'));}, timeout);
            timer.unref?.();
            child.once('error', () => {clearTimeout(timer); reject(new Error('Recording runtime unavailable'));});
            child.once('exit', code => {clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Recording operation failed'));});
        });
    }
    async function removeSession(directory) {
        // Only remove a generated session immediately beneath our private buffer root.
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) !== bufferRoot || !/^[a-f0-9-]{36}$/.test(path.basename(resolved))) throw new Error('Invalid recording buffer directory');
        const stat = await fs.lstat(resolved).catch(() => null);
        if (!stat) return;
        if (stat.isSymbolicLink()) await fs.unlink(resolved);
        else await fs.rm(resolved, {recursive: true, force: true});
    }
    async function readSegments() {
        if (!session) return;
        let entries;
        try {entries = parseSegments(await fs.readFile(path.join(session.directory, 'segments.csv'), 'utf8'));} catch {return;}
        if (!entries.length) return;
        if (session.epoch === null) {
            const latest = entries.at(-1);
            const stat = await fs.stat(path.join(session.directory, latest.name)).catch(() => null);
            if (!stat) return;
            session.epoch = stat.mtimeMs - latest.end * 1000;
        }
        const known = new Map(segments.map(segment => [segment.name, segment]));
        for (const entry of entries) {
            const index = Number(entry.name.slice(5, 13));
            if (index > session.lastIndex) {
                const segment = {...entry, file: path.join(session.directory, entry.name),
                    startAt: session.epoch + entry.start * 1000, endAt: session.epoch + entry.end * 1000};
                known.set(entry.name, segment);
                session.lastIndex = index;
            }
        }
        segments = [...known.values()].sort((a, b) => a.startAt - b.startAt);
        state.bufferSeconds = Math.min(preMs / 1000, Math.max(0, (segments.at(-1).endAt - segments[0].startAt) / 1000));
        if (state.recording !== 'error') state.recording = state.bufferSeconds >= preMs / 1000 ? 'ready' : 'warming';
    }
    async function pruneBuffer() {
        if (!session || !segments.length) return;
        const neededFrom = Math.min(now() - preMs - 10_000, ...windows.map(window => window.startAt));
        const expired = segments.filter(segment => segment.endAt < neededFrom && !session.held.has(segment.name));
        for (const segment of expired) await fs.unlink(segment.file).catch(() => {});
        const names = new Set(expired.map(segment => segment.name));
        segments = segments.filter(segment => !names.has(segment.name));
    }
    function holdSegments(currentSession, selected) {
        for (const segment of selected) currentSession.held.set(segment.name, (currentSession.held.get(segment.name) || 0) + 1);
        return () => {
            for (const segment of selected) {
                const remaining = currentSession.held.get(segment.name) - 1;
                if (remaining) currentSession.held.set(segment.name, remaining);
                else currentSession.held.delete(segment.name);
            }
        };
    }
    function captureScreenshot(at) {
        const task = (async () => {
            const currentSession = session;
            const deadline = Date.now() + 6000;
            // Wait for the closed segment containing the event, never use an
            // older thumbnail or wait for the whole post-event clip to finish.
            while (!stopped && recorder && currentSession && session === currentSession && state.recording !== 'error' && Date.now() < deadline) {
                const segment = segments.find(item => item.startAt <= at && item.endAt > at);
                if (segment) {
                    const release = holdSegments(currentSession, [segment]);
                    try {
                        const offset = Math.min((at - segment.startAt) / 1000, Math.max(0, segment.end - segment.start - 0.1));
                        return await extractCameraJpeg({filename: segment.file, offset, ffmpegPath, spawnImpl});
                    } finally {release();}
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return null;
        })().catch(() => null);
        screenshotTasks.add(task);
        task.then(() => screenshotTasks.delete(task));
        return task;
    }
    function createWindow(at) {
        const window = {id: randomUUID(), eventAt: at, startAt: at - preMs, endAt: at + postMs,
            maxAt: at - preMs + maxMs, events: [at]};
        window.opened = clips.begin(window).then(() => publish('clips', {id: window.id}));
        // A storage failure is handled by the tick/render path, never as an unhandled rejection.
        window.opened.catch(() => {});
        windows.push(window);
        return window;
    }
    function finalize(window, force = false) {
        const selected = segments.filter(segment => segment.endAt > window.startAt && segment.startAt < window.endAt);
        const currentSession = session;
        const release = currentSession ? holdSegments(currentSession, selected) : () => {};
        windows = windows.filter(item => item !== window);
        const operation = renderChain.then(async () => {
            await window.opened;
            if (!selected.length || !currentSession) {
                await clips.update(window.id, {status: 'failed', error: 'No video was available for this motion event.'});
                publish('clips', {id: window.id});
                return;
            }
            const manifest = path.join(currentSession.directory, `${window.id}.concat`);
            const partial = clips.file(window.id, 'partial.mp4');
            try {
                const data = selected.map(segment => `file '${segment.name}'\nduration ${(segment.end - segment.start).toFixed(6)}\n`).join('');
                await fs.writeFile(manifest, data, {mode: 0o600});
                await run(['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '1',
                    '-i', manifest, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
                    '-movflags', '+faststart', partial], {cwd: currentSession.directory});
                const stat = await fs.stat(partial);
                if (!stat.size) throw new Error('Empty recording');
                await fs.rename(partial, clips.file(window.id));
                const startAt = selected[0].startAt, duration = selected.reduce((sum, item) => sum + item.end - item.start, 0);
                let poster = false;
                try {
                    await run(['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, (window.eventAt - startAt) / 1000)),
                        '-i', clips.file(window.id), '-frames:v', '1', '-vf', 'scale=480:-2', '-update', '1', clips.file(window.id, 'jpg')], {timeout: 15_000});
                    poster = true;
                } catch {await fs.unlink(clips.file(window.id, 'jpg')).catch(() => {});}
                await clips.update(window.id, {status: 'ready', startAt, duration, bytes: stat.size, poster,
                    events: window.events, truncated: force || selected.at(-1).endAt < window.endAt - 500});
            } catch {
                await fs.unlink(partial).catch(() => {});
                await fs.unlink(clips.file(window.id)).catch(() => {});
                await fs.unlink(clips.file(window.id, 'jpg')).catch(() => {});
                await clips.update(window.id, {status: 'failed', error: 'This motion clip could not be saved. Check recording status.'});
                state.warning = 'A motion clip could not be saved. Check available disk space and the recording service.';
            } finally {
                await fs.unlink(manifest).catch(() => {});
                release();
            }
            publish('clips', {id: window.id});
        });
        renderChain = operation.catch(() => {state.warning = 'Recording storage is unavailable.'; announce();});
        return renderChain;
    }
    async function stopSource({keepSensor = false} = {}) {
        if (!keepSensor) {sensor?.close(); sensor = null;}
        const child = recorder;
        recorder = null;
        if (child && child.exitCode === null) {
            await new Promise(resolve => {
                const timeout = setTimeout(() => {child.kill('SIGKILL'); resolve();}, 3500);
                child.once('exit', () => {clearTimeout(timeout); resolve();});
                child.kill('SIGTERM');
            });
        }
        await readSegments();
        for (const window of [...windows]) finalize(window, true);
        await renderChain;
        await Promise.all([...screenshotTasks]);
        if (session) await removeSession(session.directory);
        session = null;
        segments = [];
        if (!keepSensor) motionActive = false;
        motionTimes = [];
        state.bufferSeconds = 0;
    }
    async function startSource(value) {
        const source = await bridge.recordingUrl(value);
        const directory = path.join(bufferRoot, randomUUID());
        await fs.mkdir(directory, {recursive: true, mode: 0o700});
        session = {directory, epoch: null, held: new Map(), lastIndex: -1};
        state.recording = 'warming';
        state.warning = '';
        // Standalone MP4 segments preserve codec initialization data and avoid
        // an FFmpeg crash observed when concatenating this C500's MPEG-TS video.
        const child = spawnImpl(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-rw_timeout', '10000000',
            '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k',
            '-f', 'segment', '-segment_time', '2', '-segment_format', 'mp4', '-reset_timestamps', '1',
            '-segment_list', 'segments.csv', '-segment_list_type', 'csv', '-segment_list_size', '120', 'part-%08d.mp4'],
        {cwd: directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
        recorder = child;
        child.stderr?.on('data', () => {});
        const failed = () => {
            if (recorder !== child || stopped) return;
            state.recording = 'error';
            state.warning = 'Recording is disconnected. The server will retry automatically.';
            broken = true;
            retryAt = now() + 5000;
            announce();
        };
        child.once('error', failed);
        child.once('exit', failed);
    }
    async function tick() {
        if (ticking || stopped) return;
        ticking = true;
        try {
            if (!initialized) {
                await clips.init();
                await fs.mkdir(bufferRoot, {recursive: true, mode: 0o700});
                for (const entry of await fs.readdir(bufferRoot)) if (/^[a-f0-9-]{36}$/.test(entry)) await removeSession(path.join(bufferRoot, entry));
                initialized = true;
            }
            if (now() - cleanupAt > 60_000) {
                const deleted = await clips.cleanup();
                cleanupAt = now();
                if (deleted) publish('clips', {});
            }
            if (!settingsChecked || now() - settingsChecked >= 5000) {
                settingsChecked = now();
                const value = await store.read();
                discord.configure(value);
                const next = value ? createHash('sha256').update(JSON.stringify([value.host, value.port, value.username, value.password, value.motionEnabled])).digest('hex') : '';
                if (next !== fingerprint) {
                    await stopSource();
                    fingerprint = next;
                    broken = false;
                    state.enabled = Boolean(value && value.motionEnabled !== false);
                }
                settings = value;
            }
            if (!state.enabled) {
                state.recording = 'disabled'; state.sensor = 'disabled'; announce(); return;
            }
            if (!sensor) sensor = watchMotion(settings, {onMotion: active => noteMotion(active), onStatus: status => {
                state.sensor = status;
                announce();
            }});
            if (broken && now() < retryAt) return;
            if (broken || !recorder || !diskCheckedAt || now() - diskCheckedAt >= 10_000) {
                const disk = await readDiskSpace();
                diskCheckedAt = now();
                if (disk.availableBytes < 512 * 1024 * 1024) {
                    await stopSource({keepSensor: true});
                    state.recording = 'error'; state.warning = 'Recording paused: less than 512 MB of free disk space.';
                    retryAt = now() + 30_000; broken = true; announce(); return;
                }
            }
            if (broken || !recorder) {
                await stopSource({keepSensor: true});
                broken = false;
                await startSource(settings);
            }
            await readSegments();
            for (const at of motionTimes.splice(0)) {
                let window = windows.at(-1);
                if (!window || at > window.endAt || at >= window.maxAt) window = createWindow(at);
                else {window.events.push(at); window.endAt = Math.min(window.maxAt, at + postMs);}
            }
            if (motionActive && !windows.length) createWindow(now());
            let current = windows.at(-1);
            if (motionActive && current) {
                current.endAt = Math.min(current.maxAt, now() + postMs);
                if (now() >= current.maxAt) current = createWindow(current.maxAt);
            }
            const lastEnd = segments.at(-1)?.endAt || 0;
            for (const window of [...windows]) {
                if (now() >= window.endAt && lastEnd >= window.endAt) finalize(window);
                else if (now() > window.endAt + 15_000) finalize(window, true);
            }
            await pruneBuffer();
            announce();
        } catch {
            state.recording = 'error';
            state.warning = 'Motion recording is unavailable. Check the camera connection and server storage.';
            retryAt = now() + 10_000;
            broken = true;
            announce();
        } finally {ticking = false;}
    }
    return {
        clips, status: snapshot,
        async start() {
            if (started) return;
            started = true;
            interval = setInterval(tick, 1000);
            interval.unref?.();
            await tick();
        },
        refresh() {settingsChecked = 0;},
        refreshDiscord(value) {discord.configure(value); settingsChecked = 0; announce();},
        async testDiscord() {
            discord.configure(await store.read());
            try {return await discord.send({test: true, screenshot: () => captureScreenshot(now())});} finally {announce();}
        },
        clipsChanged(change = {}) {
            if (change.deleted && state.warning === 'Recording paused: less than 512 MB of free disk space.') retryAt = 0;
            publish('clips', change);
        },
        // Events are already sanitized and contain no camera credentials or URLs.
        subscribe(listener, after) {
            if (after && history.some(item => item.id === after)) {
                const index = history.findIndex(item => item.id === after);
                for (const event of history.slice(index + 1)) listener(event);
            }
            bus.on('event', listener);
            return () => bus.off('event', listener);
        },
        async stop() {stopped = true; clearInterval(interval); while (ticking) await new Promise(resolve => setTimeout(resolve, 20)); await stopSource();},
        // Kept available for deterministic monitoring tests; no public trigger route.
        noteMotion, tick
    };
}

module.exports = {createCameraMonitor, parseSegments, PRE_MS, POST_MS, MAX_MS};
