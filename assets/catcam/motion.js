(() => {
    'use strict';
    const $ = selector => document.querySelector(selector);
    const csrfToken = $('#camera-settings').elements.csrfToken.value;
    const list = $('#clip-list'), playback = $('#clip-playback'), video = $('#clip-video');
    const enable = $('#enable-notifications'), test = $('#test-notification'), help = $('#notification-help');
    const feedback = $('#clip-feedback');
    const date = timestamp => new Date(timestamp).toLocaleString();
    const duration = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
    let notifications = false, lastAlertAt = 0, selected, nextBefore, refreshTimer, loading = false, reloadRequested = false;
    const seenEvents = new Set();
    try {notifications = localStorage.getItem('camera-desktop-alerts') === 'true';} catch {}

    function updateNotificationButton() {
        const supported = 'Notification' in window;
        const active = supported && Notification.permission === 'granted' && notifications;
        enable.disabled = !supported;
        enable.textContent = active ? 'Disable desktop alerts' : 'Enable desktop alerts';
        test.hidden = !active;
        help.textContent = !supported ? 'Desktop notifications are not supported in this browser.' : active ?
            'Alerts enabled for this browser. Keep this page open; Windows notification settings also apply.' :
            'Keep this page open to receive desktop alerts.';
    }
    function notify(at, testing = false, recording = true) {
        if (!notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
        // Duplicate tabs share a notification tag; brief repeated motion does not flood the desktop.
        if (!testing && at - lastAlertAt < 5000) return;
        lastAlertAt = at;
        try {
            const notification = new Notification(testing ? 'Camera alert test' : 'Camera motion detected', {
                body: testing ? 'Desktop notifications are working.' : `${date(at)} — check the live camera. ${recording ? 'A motion clip is being saved.' : 'Recording is currently unavailable.'}`,
                tag: testing ? 'camera-test' : 'camera-motion', icon: '/img/mage.png', requireInteraction: !testing
            });
            notification.onclick = () => {window.focus(); notification.close();};
        } catch {help.textContent = 'The browser could not show a notification. Check browser and Windows notification settings.';}
    }
    enable.addEventListener('click', async () => {
        if (!('Notification' in window)) return;
        if (notifications && Notification.permission === 'granted') notifications = false;
        else {
            try {notifications = await Notification.requestPermission() === 'granted';} catch {notifications = false;}
        }
        try {localStorage.setItem('camera-desktop-alerts', String(notifications));} catch {}
        updateNotificationButton();
        if (Notification.permission === 'denied') help.textContent = 'Notifications are blocked. Allow them for this website in your browser’s site settings.';
    });
    test.addEventListener('click', () => notify(Date.now(), true));
    updateNotificationButton();

    async function request(url, body) {
        const response = await fetch(url, {credentials: 'same-origin', ...(body ? {method: 'POST',
            headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, csrfToken})} : {})});
        const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ?
            'Admin access expired. Sign in again and reload this page.' : json.error || 'The recordings could not be loaded.');
        return json;
    }
    function monitorStatus(state) {
        let text;
        if (!state.enabled) text = 'Motion monitoring is disabled.';
        else if (state.sensor !== 'listening') text = state.sensor === 'connecting' ? 'Connecting to camera motion events…' : 'Motion event connection lost. Reconnecting…';
        else if (state.recording === 'error') text = 'Motion alerts connected. Recording needs attention.';
        else if (state.motionActive) text = 'Motion detected — recording.';
        else if (state.recording !== 'ready') text = `Monitoring active. Warming the pre-event buffer (${Math.floor(state.bufferSeconds || 0)}/${state.preSeconds || 10}s).`;
        else text = 'Monitoring active · Pre-event buffer ready';
        $('#monitor-status').textContent = text;
        $('.motion-panel').dataset.active = String(Boolean(state.motionActive));
        $('#last-motion').textContent = state.lastMotionAt ? `Last motion: ${date(state.lastMotionAt)}` : 'No motion received since the monitor started.';
        $('#monitor-warning').textContent = state.warning || '';
        if (state.discord) {
            $('#discord-delivery').textContent = state.discord.lastError || (state.discord.lastSentAt ?
                `Last Discord message: ${date(state.discord.lastSentAt)}` : state.discord.enabled ? 'Discord alerts enabled. Waiting for motion.' : 'Discord alerts disabled.');
        }
    }
    function clipLabel(clip) {
        if (clip.status === 'recording') return 'Recording…';
        if (clip.status === 'failed') return clip.error || 'Recording unavailable';
        return `${duration(clip.duration)} · ${(clip.bytes / (1024 * 1024)).toFixed(1)} MB${clip.truncated ? ' · Partial clip' : ''}`;
    }
    function flagLabel(clip) {return clip.flagged ? 'Flagged — keep' : 'Flag to keep';}
    async function flagClip(clip, button) {
        button.disabled = true;
        feedback.textContent = '';
        try {
            const updated = await request(`/catcam/clips/${clip.id}/flag`, {flagged: !clip.flagged});
            if (selected?.id === clip.id) {selected = updated; updatePlaybackActions();}
            await loadClips();
            feedback.textContent = updated.flagged ? 'Flagged recording will be kept until you remove its flag.' : 'Flag removed. The three-day retention rule applies again.';
        } catch (error) {feedback.textContent = error.message;}
        finally {button.disabled = false;}
    }
    function renderClip(clip) {
        const card = document.createElement('article');
        card.className = 'clip-card';
        card.dataset.clipId = clip.id;
        const open = document.createElement('button');
        open.className = 'clip-open';
        open.disabled = clip.status !== 'ready';
        open.setAttribute('aria-label', `Play motion recording from ${date(clip.eventAt)}`);
        if (clip.posterUrl) {
            const image = document.createElement('img');
            image.src = clip.posterUrl;
            image.alt = '';
            image.loading = 'lazy';
            open.append(image);
        } else {
            const image = document.createElement('span');
            image.className = 'clip-no-poster';
            image.textContent = clip.status === 'recording' ? 'Recording…' : clip.status === 'failed' ? 'No video' : 'Play recording';
            open.append(image);
        }
        open.addEventListener('click', () => openClip(clip));
        const details = document.createElement('div');
        details.className = 'clip-details';
        const when = document.createElement('strong'); when.textContent = date(clip.eventAt);
        const description = document.createElement('span'); description.textContent = clipLabel(clip);
        const flag = document.createElement('button');
        flag.textContent = flagLabel(clip);
        flag.className = clip.flagged ? 'flag-button is-flagged' : 'flag-button';
        flag.addEventListener('click', () => flagClip(clip, flag));
        details.append(when, description, flag);
        card.append(open, details);
        return card;
    }
    async function loadClips(append = false) {
        if (loading) {reloadRequested = true; return;}
        loading = true;
        try {
            const params = new URLSearchParams();
            if ($('#clip-filter').value === 'flagged') params.set('flagged', 'true');
            if (append && nextBefore) params.set('before', nextBefore);
            const data = await request(`/catcam/clips?${params}`);
            if (!append) list.replaceChildren();
            const existing = new Set([...list.children].map(card => card.dataset.clipId));
            for (const clip of data.clips) if (!existing.has(clip.id)) list.append(renderClip(clip));
            nextBefore = data.nextBefore;
            $('#more-clips').hidden = !nextBefore;
            $('#clips-empty').hidden = list.children.length > 0;
            $('#clips-empty').textContent = $('#clip-filter').value === 'flagged' ? 'No flagged recordings.' : 'No motion recordings yet. New clips will appear here automatically.';
            if (selected) {
                const updated = data.clips.find(clip => clip.id === selected.id);
                if (updated) {selected = updated; updatePlaybackActions();}
            }
        } catch (error) {feedback.textContent = error.message; $('#clips-empty').textContent = 'Could not load recordings.';}
        finally {
            loading = false;
            if (reloadRequested) {reloadRequested = false; scheduleRefresh();}
        }
    }
    function scheduleRefresh() {clearTimeout(refreshTimer); refreshTimer = setTimeout(() => loadClips(), 300);}
    function actualDuration() {return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : selected?.duration || 0;}
    function markers() {
        const container = $('#motion-markers');
        container.replaceChildren();
        const length = actualDuration();
        if (!selected || !length) return;
        for (const eventAt of [...new Set(selected.events)]) {
            const offset = Math.max(0, Math.min(length, (eventAt - selected.startAt) / 1000));
            const marker = document.createElement('button');
            marker.className = 'motion-marker';
            marker.style.left = `${offset / length * 100}%`;
            marker.setAttribute('aria-label', `Motion detected at ${duration(offset)}`);
            marker.title = `Motion detected at ${duration(offset)}`;
            marker.addEventListener('click', () => {video.currentTime = offset; video.play().catch(() => {});});
            container.append(marker);
        }
    }
    function updatePlaybackActions() {
        if (!selected) return;
        $('#flag-current').textContent = flagLabel(selected);
        $('#flag-current').classList.toggle('is-flagged', selected.flagged);
        $('#clip-expiry').textContent = selected.flagged ? 'Kept until unflagged' : `Automatically deletes ${date(selected.expiresAt)}`;
    }
    function openClip(clip) {
        selected = clip;
        playback.hidden = false;
        $('#clip-title').textContent = `Motion — ${date(clip.eventAt)}`;
        video.src = clip.videoUrl;
        if (clip.posterUrl) video.poster = clip.posterUrl;
        else video.removeAttribute('poster');
        $('#download-clip').href = clip.videoUrl;
        $('#download-clip').download = `motion-${new Date(clip.eventAt).toISOString().replace(/[:.]/g, '-')}.mp4`;
        $('#clip-seek').value = '0';
        updatePlaybackActions();
        markers();
        video.play().catch(() => {});
        playback.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest'});
    }
    video.addEventListener('loadedmetadata', markers);
    video.addEventListener('timeupdate', () => {
        const total = actualDuration();
        $('#clip-time').textContent = `${duration(video.currentTime)} / ${duration(total)}`;
        $('#clip-seek').value = total ? String(video.currentTime / total * 1000) : '0';
    });
    video.addEventListener('error', () => {if (selected) feedback.textContent = 'This recording is unavailable or has expired. Refresh the recording list.';});
    $('#clip-seek').addEventListener('input', event => {if (selected) video.currentTime = Number(event.target.value) / 1000 * actualDuration();});
    $('#flag-current').addEventListener('click', event => {if (selected) flagClip(selected, event.currentTarget);});
    $('#close-clip').addEventListener('click', () => {selected = null; video.pause(); video.removeAttribute('src'); video.load(); playback.hidden = true;});
    $('#clip-filter').addEventListener('change', () => loadClips());
    $('#more-clips').addEventListener('click', () => loadClips(true));
    loadClips();

    const events = new EventSource('/catcam/events');
    events.addEventListener('status', event => {try {monitorStatus(JSON.parse(event.data));} catch {}});
    events.addEventListener('motion', event => {
        if (seenEvents.has(event.lastEventId)) return;
        seenEvents.add(event.lastEventId);
        if (seenEvents.size > 160) seenEvents.delete(seenEvents.values().next().value);
        try {const {at, recording} = JSON.parse(event.data); notify(at, false, recording); $('#last-motion').textContent = `Last motion: ${date(at)}`;} catch {}
    });
    events.addEventListener('clips', scheduleRefresh);
    events.onopen = () => {scheduleRefresh();};
    events.onerror = () => {$('#monitor-status').textContent = 'Alert connection interrupted. Reconnecting…';};
    window.addEventListener('pagehide', () => {events.close(); clearTimeout(refreshTimer);});
})();
