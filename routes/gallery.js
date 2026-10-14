const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const authentication = require('../services/authentication');
const {createGalleryStore, GalleryUploadError, MAX_FILES, MAX_FILE_BYTES} = require('../services/gallery');

function createGalleryRouter({store = createGalleryStore(), tempDirectory = path.join(os.tmpdir(), 'detschn-gallery-upload'), auth = authentication,
    enabled = () => process.env.GALLERY_UPLOAD_ENABLED !== 'false'} = {}) {
    const router = express.Router();
    const upload = fileUpload({useTempFiles: true, tempFileDir: tempDirectory, createParentPath: true,
        limits: {fileSize: MAX_FILE_BYTES, files: MAX_FILES + 1, fields: 2, fieldSize: 1024, parts: MAX_FILES + 3},
        uploadTimeout: 60_000});

    function temporaryPage(req, res, next) {
        res.set('Cache-Control', 'no-store');
        if (!enabled()) return res.status(404).send('The temporary gallery upload page is closed.');
        next();
    }
    function csrfToken(req) {
        if (!req.session.galleryUploadToken) req.session.galleryUploadToken = randomBytes(32).toString('hex');
        return req.session.galleryUploadToken;
    }
    function allFiles(req) {return Object.values(req.files || {}).flat();}
    async function cleanup(req) {
        await Promise.all(allFiles(req).map(file => {
            if (!file.tempFilePath || path.dirname(path.resolve(file.tempFilePath)) !== path.resolve(tempDirectory)) return;
            return fs.unlink(file.tempFilePath).catch(() => {});
        }));
    }
    async function renderPage(req, res, message = '', status = 200) {
        const photos = await store.listPhotos();
        res.status(status).render('gallery-upload', {loggedInUser: req.user, csrfToken: csrfToken(req), photos,
            maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, message});
    }

    router.get('/photos', async (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        try {res.json(await store.listPhotos());} catch (error) {next(error);}
    });
    router.get('/upload', temporaryPage, auth.authenticateAdmin, async (req, res, next) => {
        try {
            const message = req.session.galleryUploadMessage || '';
            delete req.session.galleryUploadMessage;
            await renderPage(req, res, message);
        } catch (error) {next(error);}
    });
    router.post('/upload', temporaryPage, auth.authenticateAdmin, (req, res, next) => {
        // Authentication runs before multipart parsing and temporary-file writes.
        res.on('finish', () => {cleanup(req);});
        next();
    }, upload, async (req, res, next) => {
        try {
            const token = req.body?.csrfToken;
            const expected = req.session.galleryUploadToken;
            if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof expected !== 'string' || token.length !== expected.length ||
                !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
                return await renderPage(req, res, 'This upload form has expired. Please choose your photos again.', 403);
            }
            if (Object.keys(req.files || {}).some(field => field !== 'photos')) {
                throw new GalleryUploadError('Choose photos using the photo picker.');
            }
            const files = req.files?.photos ? [].concat(req.files.photos) : [];
            const count = await store.addPhotos(files);
            req.session.galleryUploadMessage = `Added ${count} ${count === 1 ? 'photo' : 'photos'} to the map. Reload the last page to see them.`;
            res.redirect(303, '/my/gallery/upload');
        } catch (error) {
            if (error instanceof GalleryUploadError) {
                try {await renderPage(req, res, error.message, error.status);} catch (renderError) {next(renderError);}
            } else next(error);
        } finally {await cleanup(req);}
    });
    router.use((error, req, res, next) => {cleanup(req); next(error);});
    return router;
}

module.exports = {createGalleryRouter};
