const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');

const secret = 'gallery-upload-test-secret';
process.env.ACCESS_TOKEN_SECRET = secret;
const {createGalleryRouter} = require('../routes/gallery');
const {createGalleryStore, MAX_FILES, MAX_FILE_BYTES} = require('../services/gallery');
const fixture = () => sharp({create: {width: 600, height: 900, channels: 3, background: '#b05273'}}).png().toBuffer();

async function setup(t, {enabled = true} = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'detschn-gallery-test-'));
    const root = path.join(directory, 'gallery'), tempDirectory = path.join(directory, 'temporary');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'img1.jpg'), await fixture());
    const store = createGalleryStore(root);
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    app.use(cookieParser());
    app.use(session({secret: 'test-session-secret', resave: false, saveUninitialized: false}));
    app.use('/my/gallery', createGalleryRouter({store, tempDirectory, enabled: () => enabled}));
    app.use('/img/gallery', express.static(root));
    app.use((error, req, res, next) => res.status(500).send(error.message));
    const server = await new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
    });
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        // mkdtemp created this directory under the explicit test root.
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('detschn-gallery-test-'));
        await fs.rm(directory, {recursive: true, force: true});
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({username: 'test-streamer', role: 'streamer'}, secret, {expiresIn: '1h'});
    async function form() {
        const response = await fetch(`${base}/my/gallery/upload`, {headers: {Cookie: `accessToken=${token}`}});
        assert.equal(response.status, 200);
        const text = await response.text();
        const csrf = text.match(/name="csrfToken" value="([a-f0-9]+)"/)[1];
        const cookie = response.headers.get('set-cookie').split(';')[0];
        return {csrf, cookie: `accessToken=${token}; ${cookie}`};
    }
    function post(body, cookie = '') {
        return fetch(`${base}/my/gallery/upload`, {method: 'POST', body, headers: {Cookie: cookie}, redirect: 'manual'});
    }
    function filesForm(csrf, files) {
        const body = new FormData();
        body.append('csrfToken', csrf);
        files.forEach(({data, name = 'photo.png', type = 'image/png'}) => body.append('photos', new Blob([data], {type}), name));
        return body;
    }
    return {base, root, tempDirectory, store, token, form, post, filesForm};
}

test('upload page and POST reject absent, expired and forged JWTs before writing temporary files', async t => {
    const s = await setup(t);
    for (const token of ['', jwt.sign({username: 'expired'}, secret, {expiresIn: -1}),
        jwt.sign({username: 'forged'}, 'wrong-secret', {expiresIn: '1h'})]) {
        const cookie = token ? `accessToken=${token}` : '';
        const page = await fetch(`${s.base}/my/gallery/upload`, {headers: {Cookie: cookie}});
        assert.match(await page.text(), /Please log in|session/);
        assert.equal(page.status, token ? 401 : 200);
        const posted = await s.post(s.filesForm('invalid', [{data: await fixture()}]), cookie);
        assert.equal(posted.status, token ? 401 : 200);
        assert.match(await posted.text(), /Please log in|session/);
        assert.deepEqual((await s.store.listPhotos()).map(photo => photo.id), [1]);
        await assert.rejects(fs.access(s.tempDirectory));
    }
});

test('authenticated multipart uploads create safe image names, previews and persistent catalog entries', async t => {
    const s = await setup(t), login = await s.form();
    const response = await s.post(s.filesForm(login.csrf, [{data: await fixture(), name: '../../escape.jpg'},
        {data: await fixture(), name: 'second.png'}]), login.cookie);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/my/gallery/upload');
    const photos = await s.store.listPhotos();
    assert.equal(photos.length, 3);
    for (const photo of photos.slice(1)) {
        assert.match(photo.id, /^upload-[a-f0-9-]{36}$/);
        const image = await fetch(s.base + photo.src);
        assert.equal(image.status, 200);
        const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
        assert.equal(metadata.format, 'jpeg');
        assert.equal(metadata.exif, undefined);
        const preview = await fetch(s.base + photo.thumbnail);
        const thumb = await sharp(Buffer.from(await preview.arrayBuffer())).metadata();
        assert.equal(thumb.format, 'webp');
        assert.ok(thumb.width <= 440 && thumb.height <= 572);
    }
    const restarted = createGalleryStore(s.root);
    assert.deepEqual(await restarted.listPhotos(), photos, 'restarting the app must preserve uploaded IDs');
    assert.deepEqual(await fs.readdir(s.tempDirectory), []);
    const catalog = await fetch(`${s.base}/my/gallery/photos`);
    assert.equal(catalog.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await catalog.json(), photos);
});

test('a valid JWT without the session form token cannot publish photos', async t => {
    const s = await setup(t), login = await s.form();
    for (const csrf of ['', '0'.repeat(64), 'é'.repeat(64)]) {
        const response = await s.post(s.filesForm(csrf, [{data: await fixture()}]), login.cookie);
        assert.equal(response.status, 403);
        assert.equal((await s.store.listPhotos()).length, 1);
        assert.deepEqual(await fs.readdir(s.tempDirectory), []);
    }
});

test('invalid and active-content files reject the whole batch without publishing earlier photos', async t => {
    const s = await setup(t), login = await s.form();
    for (const data of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')]) {
        const response = await s.post(s.filesForm(login.csrf, [{data: await fixture()}, {data, name: 'fake.png'}]), login.cookie);
        assert.equal(response.status, 400);
        assert.match(await response.text(), /could not be read/);
        assert.equal((await s.store.listPhotos()).length, 1);
        assert.deepEqual(await fs.readdir(s.tempDirectory), []);
    }
});

test('oversized files and too many photos are rejected and cleaned up', async t => {
    const s = await setup(t), login = await s.form();
    const huge = await s.post(s.filesForm(login.csrf, [{data: Buffer.alloc(MAX_FILE_BYTES + 1)}]), login.cookie);
    assert.equal(huge.status, 400);
    assert.match(await huge.text(), /15 MB/);
    const data = await fixture();
    const many = await s.post(s.filesForm(login.csrf, Array.from({length: MAX_FILES + 1}, () => ({data}))), login.cookie);
    assert.equal(many.status, 400);
    assert.ok((await many.text()).includes(`between 1 and ${MAX_FILES}`));
    assert.equal((await s.store.listPhotos()).length, 1);
    assert.deepEqual(await fs.readdir(s.tempDirectory), []);
});

test('temporary upload can be disabled without hiding existing gallery photos', async t => {
    const s = await setup(t, {enabled: false});
    const page = await fetch(`${s.base}/my/gallery/upload`, {headers: {Cookie: `accessToken=${s.token}`}});
    assert.equal(page.status, 404);
    const posted = await s.post(s.filesForm('invalid', [{data: await fixture()}]), `accessToken=${s.token}`);
    assert.equal(posted.status, 404);
    await assert.rejects(fs.access(s.tempDirectory));
    const catalog = await fetch(`${s.base}/my/gallery/photos`);
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).length, 1);
});
