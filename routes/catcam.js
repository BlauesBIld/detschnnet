const express = require('express');
const path = require('node:path');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const authentication = require('../services/authentication');
const {CameraError, createCameraStore, createCameraBridge, createCameraStreams} = require('../services/catCamera');
const {createCameraMonitor} = require('../services/cameraMonitor');

function createCameraRouter({auth = authentication, store = createCameraStore(), bridge = createCameraBridge(),
    streams = createCameraStreams(), monitor = createCameraMonitor({store, bridge}), feedAccessInterval = 15_000} = {}) {
    const router = express.Router();
    const feeds = new Set();
    router.use((req, res, next) => {
        res.set({'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY'});
        res.removeHeader('Access-Control-Allow-Origin');
        next();
    }, auth.authenticateAdmin);
    function csrf(req) {
        if (!req.session.cameraToken) req.session.cameraToken = randomBytes(32).toString('hex');
        return req.session.cameraToken;
    }
    router.use(express.json({limit: '4kb'}));
    router.use((req, res, next) => {
        if (['GET', 'HEAD'].includes(req.method)) return next();
        const expected = req.session.cameraToken, supplied = req.body?.csrfToken;
        if (typeof expected !== 'string' || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) ||
            !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return res.status(403).json({error: 'Your form expired. Reload the camera page.'});
        next();
    });
    router.get('/', async (req, res, next) => {
        try {
            let settings, setupError = '';
            try {settings = await store.read();} catch (error) {
                if (!(error instanceof CameraError)) throw error;
                setupError = error.message;
            }
            res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
            res.render('catcam', {loggedInUser: req.user, csrfToken: csrf(req), settings: settings ? {...settings, password: undefined} : null,
                storageReady: store.ready(), setupError});
        } catch (error) {next(error);}
    });
    router.get('/assets/:file', (req, res) => {
        const files = {'camera.js': 'application/javascript', 'motion.js': 'application/javascript', 'camera.css': 'text/css'};
        if (!Object.hasOwn(files, req.params.file)) return res.sendStatus(404);
        res.type(files[req.params.file]).sendFile(path.join(__dirname, '../assets/catcam', req.params.file));
    });
    router.post('/settings', async (req, res, next) => {
        try {
            const settings = await store.save(req.body);
            streams.invalidate();
            monitor.refresh();
            res.json({saved: true, title: settings.title, quality: settings.quality});
        } catch (error) {next(error);}
    });
    router.post('/ticket', async (req, res, next) => {
        try {
            const settings = await store.read();
            if (!settings) throw new CameraError('Save your camera settings first.', 409);
            const quality = req.body.quality || settings.quality;
            if (!['high', 'low'].includes(quality)) throw new CameraError('Choose a video quality.');
            const upstream = await bridge.prepare(settings, quality);
            const ticket = streams.issue(req.cookies.accessToken, upstream);
            res.json({url: `/catcam/live?ticket=${ticket}`});
        } catch (error) {next(error);}
    });
    router.get('/status', (req, res) => res.json(monitor.status()));
    router.get('/events', (req, res) => {
        if (feeds.size >= 32) return res.status(503).json({error: 'Too many alert connections. Close another camera tab and try again.'});
        res.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, private', 'X-Accel-Buffering': 'no'});
        res.flushHeaders();
        res.write('retry: 5000\n\n');
        let closed = false, checking = false;
        const send = event => {
            if (closed) return;
            if (res.writableLength > 256 * 1024) return res.end();
            res.write(`${event.id ? `id: ${event.id}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        };
        feeds.add(res);
        send({type: 'status', data: monitor.status()});
        const unsubscribe = monitor.subscribe(send, req.get('Last-Event-ID'));
        const timer = setInterval(async () => {
            if (checking || closed) return;
            checking = true;
            try {
                if (!await authorizeUpgrade(req)) {res.end(); return;}
                res.write(': heartbeat\n\n');
            } finally {checking = false;}
        }, feedAccessInterval);
        timer.unref();
        res.on('close', () => {closed = true; clearInterval(timer); unsubscribe(); feeds.delete(res);});
    });
    router.get('/clips', async (req, res, next) => {
        try {
            const before = req.query.before === undefined ? undefined : Number(req.query.before);
            if (before !== undefined && (!Number.isFinite(before) || before <= 0)) throw new CameraError('Invalid recording cursor.');
            res.json(await monitor.clips.list({flagged: req.query.flagged === 'true', before}));
        } catch (error) {next(error);}
    });
    router.post('/clips/:id/flag', async (req, res, next) => {
        try {
            const clip = await monitor.clips.flag(req.params.id, req.body.flagged);
            monitor.clipsChanged?.();
            res.json(clip);
        } catch (error) {next(error);}
    });
    for (const [route, extension, type] of [['video', 'mp4', 'video/mp4'], ['poster', 'jpg', 'image/jpeg']]) {
        router.get(`/clips/:id/${route}`, async (req, res, next) => {
            try {
                const clip = await monitor.clips.get(req.params.id);
                if (clip.status !== 'ready' || (extension === 'jpg' && !clip.poster)) throw new CameraError('This recording is not available yet.', 409);
                res.type(type);
                if (extension === 'mp4') res.set('Content-Disposition', `inline; filename="motion-${new Date(clip.eventAt).toISOString().replace(/[:.]/g, '-')}.mp4"`);
                res.sendFile(monitor.clips.file(clip.id, extension), {acceptRanges: true, cacheControl: false}, error => {
                    if (error && !res.headersSent) res.status(404).json({error: 'Recording file not found.'});
                });
            } catch (error) {next(error);}
        });
    }
    router.use((error, req, res, next) => {
        if (error instanceof CameraError) return res.status(error.status).json({error: error.message});
        // The general error handler logs errors; keep camera inputs and upstream URLs out of it.
        res.status(error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 503)
            .json({error: 'The camera request could not be completed. Try again.'});
    });
    function authorizeUpgrade(req) {
        return new Promise(resolve => {
            const timeout = setTimeout(() => resolve(false), 8000);
            timeout.unref();
            const finish = allowed => {clearTimeout(timeout); resolve(allowed);};
            // Reuse the normal database-backed guard without rendering a login page
            // into an upgraded connection. Only its allow/deny decision is needed.
            const response = {set() {return this;}, clearCookie() {return this;}, status() {return this;},
                render() {finish(false);}, send() {finish(false);}};
            Promise.resolve(auth.authenticateAdmin(req, response, error => finish(!error))).catch(() => finish(false));
        });
    }
    return {router, attach: server => streams.attach(server, authorizeUpgrade), startMonitoring: () => monitor.start(),
        stopMonitoring: () => {for (const response of feeds) response.end(); return monitor.stop();}};
}

module.exports = {createCameraRouter};
