(() => {
    'use strict';
    const form = document.querySelector('#camera-settings');
    const video = document.querySelector('#video');
    const start = document.querySelector('#start');
    const reconnect = document.querySelector('#reconnect');
    const quality = document.querySelector('#view-quality');
    const message = document.querySelector('#stream-message');
    const placeholder = document.querySelector('#placeholder');
    const csrfToken = form.elements.csrfToken.value;
    let wanted = false, generation = 0, socket, mediaSource, sourceBuffer, objectUrl, retryTimer, healthTimer;
    let queue = [], queuedBytes = 0, retryDelay = 2000, lastFrame = 0;
    const Media = window.ManagedMediaSource || window.MediaSource;

    function status(text, state) {
        document.querySelector('#status').textContent = text;
        document.querySelector('#status-dot').dataset.state = state;
    }
    async function post(url, data) {
        const response = await fetch(url, {method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...data, csrfToken})});
        const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
        if (!response.ok) {
            const error = new Error(response.status === 401 || response.status === 403 ? 'Admin access expired. Sign in again and reload this page.' : body.error || 'The camera request failed. Try again.');
            error.status = response.status;
            throw error;
        }
        return body;
    }
    function cleanup() {
        clearTimeout(retryTimer);
        clearInterval(healthTimer);
        if (socket) {socket.onclose = null; socket.close(); socket = null;}
        video.pause();
        video.hidden = true;
        video.removeAttribute('src');
        video.srcObject = null;
        video.load();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        sourceBuffer = null;
        mediaSource = null;
        queue = [];
        queuedBytes = 0;
        placeholder.hidden = false;
        document.querySelector('#video-label').hidden = true;
    }
    function stop() {
        wanted = false;
        generation++;
        cleanup();
        start.textContent = 'Start live view';
        reconnect.hidden = true;
        status('Not connected', 'idle');
    }
    function retry(error, attempt) {
        if (attempt !== generation || !wanted) return;
        generation++;
        cleanup();
        if ([401, 403, 409].includes(error?.status)) {
            stop();
            message.textContent = error.message;
            status('Access or setup needed', 'error');
            return;
        }
        message.textContent = error?.message || 'Connection interrupted. Reconnecting automatically…';
        status('Reconnecting…', 'connecting');
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
    }
    function flush(attempt) {
        if (attempt !== generation || !sourceBuffer || sourceBuffer.updating) return;
        try {
            const buffered = sourceBuffer.buffered;
            if (buffered.length) {
                const end = buffered.end(buffered.length - 1);
                if (end - video.currentTime > 3 || video.currentTime < buffered.start(0)) video.currentTime = Math.max(buffered.start(0), end - 0.5);
                if (video.currentTime - buffered.start(0) > 20) {
                    sourceBuffer.remove(buffered.start(0), video.currentTime - 10);
                    return;
                }
            }
            if (queue.length) {
                const chunk = queue.shift();
                queuedBytes -= chunk.byteLength;
                sourceBuffer.appendBuffer(chunk);
            }
        } catch {retry(new Error('Playback interrupted. Reconnecting…'), attempt);}
    }
    async function connect() {
        const attempt = ++generation;
        cleanup();
        if (!wanted || document.hidden) return;
        status('Connecting…', 'connecting');
        message.textContent = '';
        if (!Media) {
            stop();
            message.textContent = 'This browser does not support live playback. Try current Chrome, Edge, Firefox, or Safari 17.1 or later.';
            return;
        }
        const codecs = ['avc1.42E01E', 'avc1.640029', 'avc1.64002A', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus']
            .filter(codec => Media.isTypeSupported(`video/mp4; codecs="${codec}"`)).join(',');
        if (!codecs.includes('avc1')) {stop(); message.textContent = 'This browser cannot decode the camera’s H.264 video.'; return;}
        try {
            const ticket = await post('/catcam/ticket', {quality: quality.value});
            if (attempt !== generation || !wanted) return;
            mediaSource = new Media();
            const currentMedia = mediaSource;
            const url = new URL(ticket.url, location.origin);
            url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(url);
            socket.binaryType = 'arraybuffer';
            const currentSocket = socket;
            let sourceOpened = false, socketOpened = false, requested = false;
            function negotiate() {
                if (!sourceOpened || !socketOpened || requested || attempt !== generation) return;
                requested = true;
                currentSocket.send(JSON.stringify({type: 'mse', value: codecs}));
            }
            currentMedia.addEventListener('sourceopen', () => {sourceOpened = true; negotiate();}, {once: true});
            currentSocket.onopen = () => {socketOpened = true; negotiate();};
            currentSocket.onmessage = event => {
                if (attempt !== generation) return;
                try {
                    if (typeof event.data === 'string') {
                        const data = JSON.parse(event.data);
                        if (data.type === 'error') return retry(new Error(data.value), attempt);
                        if (data.type !== 'mse' || sourceBuffer) return;
                        if (!Media.isTypeSupported(data.value)) throw new Error('Unsupported codec');
                        sourceBuffer = currentMedia.addSourceBuffer(data.value);
                        sourceBuffer.addEventListener('updateend', () => flush(attempt));
                        sourceBuffer.addEventListener('error', () => retry(new Error('Video decoding failed. Reconnecting…'), attempt));
                    } else {
                        lastFrame = Date.now();
                        queue.push(event.data);
                        queuedBytes += event.data.byteLength;
                        if (queuedBytes > 8 * 1024 * 1024) throw new Error('Playback backlog');
                        flush(attempt);
                    }
                } catch {retry(new Error('Unable to play this stream. Reconnecting…'), attempt);}
            };
            currentSocket.onclose = event => retry(event.code === 4000 ? null : new Error('Camera connection interrupted. Reconnecting…'), attempt);
            currentSocket.onerror = () => {}; // close supplies a single retry path
            video.hidden = false;
            if (window.ManagedMediaSource) {
                video.disableRemotePlayback = true;
                video.srcObject = currentMedia;
            } else {
                objectUrl = URL.createObjectURL(currentMedia);
                video.src = objectUrl;
            }
            video.play().catch(() => {message.textContent = 'Press Play on the video to start playback.';});
            lastFrame = Date.now();
            healthTimer = setInterval(() => {
                if (Date.now() - lastFrame > 20_000) retry(new Error('No video received. Check the camera and reconnect.'), attempt);
            }, 5000);
        } catch (error) {retry(error, attempt);}
    }
    video.addEventListener('playing', () => {
        if (!wanted) return;
        placeholder.hidden = true;
        document.querySelector('#video-label').hidden = false;
        status('Live', 'live');
        message.textContent = '';
        retryDelay = 2000;
    });
    video.addEventListener('error', () => {if (wanted) retry(new Error('Video playback failed. Reconnecting…'), generation);});
    start.addEventListener('click', () => {
        if (wanted) return stop();
        wanted = true;
        start.textContent = 'Stop live view';
        reconnect.hidden = false;
        retryDelay = 2000;
        connect();
    });
    reconnect.addEventListener('click', () => {if (wanted) {retryDelay = 2000; connect();}});
    quality.addEventListener('change', () => {if (wanted) connect();});
    document.querySelector('#fullscreen').addEventListener('click', async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (document.querySelector('#player').requestFullscreen) await document.querySelector('#player').requestFullscreen();
            else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        } catch {message.textContent = 'Fullscreen is unavailable in this browser.';}
    });
    document.addEventListener('visibilitychange', () => {
        if (!wanted) return;
        if (document.hidden) {generation++; cleanup(); status('Paused while this tab is hidden', 'idle');}
        else connect();
    });
    window.addEventListener('pagehide', stop);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const save = document.querySelector('#save'), feedback = document.querySelector('#save-message');
        save.disabled = true;
        feedback.classList.remove('error');
        feedback.textContent = 'Saving…';
        try {
            const result = await post('/catcam/settings', Object.fromEntries(new FormData(form)));
            stop();
            form.elements.password.value = '';
            form.elements.password.required = false;
            form.elements.password.placeholder = 'Leave blank to keep saved password';
            document.title = `${result.title} · DetschnNet`;
            quality.value = result.quality;
            start.disabled = false;
            document.querySelector('#empty-title').textContent = 'Camera ready';
            document.querySelector('#empty-description').textContent = 'Start live view to monitor the camera.';
            message.textContent = '';
            feedback.textContent = 'Settings saved. Start the live view to test your camera.';
            form.dispatchEvent(new Event('camera-configured'));
        } catch (error) {feedback.classList.add('error'); feedback.textContent = error.message;}
        finally {save.disabled = false;}
    });
})();
