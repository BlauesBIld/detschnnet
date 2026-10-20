const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {CameraError} = require('./catCamera');

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

function createClipStore({directory = path.join(__dirname, '../data/catcam/recordings'), now = Date.now} = {}) {
    const root = path.resolve(directory), catalogFile = path.join(root, 'catalog.json');
    let catalog, loading, pending = Promise.resolve();
    async function load() {
        if (catalog) return;
        if (!loading) loading = (async () => {
            await fs.mkdir(root, {recursive: true, mode: 0o700});
            let parsed;
            try {parsed = JSON.parse(await fs.readFile(catalogFile, 'utf8'));} catch (error) {
                if (error.code !== 'ENOENT') throw new CameraError('The recording catalog could not be read.', 503);
                parsed = {version: 1, revision: 0, clips: []};
            }
            if (parsed.version !== 1 || !Array.isArray(parsed.clips) || parsed.clips.some(clip => !validId(clip.id) ||
                !Number.isFinite(clip.eventAt) || typeof clip.flagged !== 'boolean')) throw new CameraError('The recording catalog is invalid.', 503);
            catalog = parsed;
        })().catch(error => {loading = null; throw error;});
        await loading;
    }
    async function write(next) {
        const temporary = path.join(root, `${randomUUID()}.catalog.tmp`);
        next.revision = (catalog.revision || 0) + 1;
        try {
            await fs.writeFile(temporary, JSON.stringify(next), {mode: 0o600, flag: 'wx'});
            await fs.rename(temporary, catalogFile);
            catalog = next;
        } finally {await fs.unlink(temporary).catch(() => {});}
    }
    function transaction(operation) {
        const result = pending.then(async () => {await load(); return operation();});
        pending = result.catch(() => {});
        return result;
    }
    function publicClip(clip) {
        return {...clip, videoUrl: clip.status === 'ready' ? `/catcam/clips/${clip.id}/video` : null,
            posterUrl: clip.poster ? `/catcam/clips/${clip.id}/poster` : null,
            expiresAt: clip.flagged ? null : clip.eventAt + RETENTION_MS};
    }
    return {
        directory: root,
        file(id, extension = 'mp4') {
            if (!validId(id) || !['mp4', 'jpg', 'partial.mp4'].includes(extension)) throw new CameraError('Recording not found.', 404);
            return path.join(root, `${id}.${extension}`);
        },
        async init() {
            await transaction(async () => {
                const clips = catalog.clips.map(clip => clip.status === 'recording' ? {...clip, status: 'failed',
                    error: 'Recording was interrupted by a server restart.'} : clip);
                if (clips.some((clip, i) => clip !== catalog.clips[i])) await write({...catalog, clips});
                for (const name of await fs.readdir(root)) {
                    if (/^[a-f0-9-]{36}\.(?:partial\.mp4|catalog\.tmp)$/.test(name)) await fs.unlink(path.join(root, name)).catch(() => {});
                }
            });
            return this.cleanup();
        },
        async list({flagged = false, before, limit = 50} = {}) {
            await pending;
            await load();
            const sorted = catalog.clips.filter(clip => (!flagged || clip.flagged) &&
                (clip.flagged || clip.eventAt > now() - RETENTION_MS) && (!before || clip.eventAt < before))
                .sort((a, b) => b.eventAt - a.eventAt || b.id.localeCompare(a.id));
            const clips = sorted.slice(0, limit).map(publicClip);
            return {clips, revision: catalog.revision, nextBefore: sorted.length > limit ? clips.at(-1).eventAt : null};
        },
        async get(id) {
            if (!validId(id)) throw new CameraError('Recording not found.', 404);
            await pending;
            await load();
            const clip = catalog.clips.find(clip => clip.id === id);
            if (!clip || (!clip.flagged && clip.eventAt <= now() - RETENTION_MS)) throw new CameraError('Recording not found or expired.', 404);
            return publicClip(clip);
        },
        begin({id = randomUUID(), eventAt, startAt}) {
            return transaction(async () => {
                if (!validId(id) || !Number.isFinite(eventAt) || !Number.isFinite(startAt) || catalog.clips.some(clip => clip.id === id)) {
                    throw new CameraError('Invalid recording.', 400);
                }
                const clip = {id, eventAt, startAt, events: [eventAt], flagged: false, status: 'recording', duration: 0, bytes: 0, poster: false};
                await write({...catalog, clips: [...catalog.clips, clip]});
                return publicClip(clip);
            });
        },
        update(id, patch) {
            return transaction(async () => {
                const clip = catalog.clips.find(clip => clip.id === id);
                if (!clip) throw new CameraError('Recording not found.', 404);
                const updated = {...clip};
                for (const key of ['status', 'startAt', 'events', 'duration', 'bytes', 'poster', 'error', 'truncated']) {
                    if (Object.hasOwn(patch, key)) updated[key] = patch[key];
                }
                await write({...catalog, clips: catalog.clips.map(item => item.id === id ? updated : item)});
                return publicClip(updated);
            });
        },
        flag(id, flagged) {
            return transaction(async () => {
                if (typeof flagged !== 'boolean' || !validId(id)) throw new CameraError('Invalid flag request.', 400);
                const clip = catalog.clips.find(item => item.id === id);
                if (!clip || (!clip.flagged && clip.eventAt <= now() - RETENTION_MS)) throw new CameraError('Recording not found or expired.', 404);
                const updated = {...clip, flagged};
                await write({...catalog, clips: catalog.clips.map(item => item.id === id ? updated : item)});
                return publicClip(updated);
            });
        },
        cleanup() {
            return transaction(async () => {
                const expired = catalog.clips.filter(clip => !clip.flagged && clip.eventAt <= now() - RETENTION_MS);
                // Delete files before removing catalog entries so an I/O failure is retried.
                for (const clip of expired) {
                    for (const extension of ['mp4', 'jpg', 'partial.mp4']) {
                        try {await fs.unlink(this.file(clip.id, extension));} catch (error) {if (error.code !== 'ENOENT') throw error;}
                    }
                }
                if (expired.length) {
                    const ids = new Set(expired.map(clip => clip.id));
                    await write({...catalog, clips: catalog.clips.filter(clip => !ids.has(clip.id))});
                }
                return expired.length;
            });
        }
    };
}

module.exports = {createClipStore, RETENTION_MS, validId};
