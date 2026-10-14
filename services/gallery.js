const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const sharp = require('sharp');

const MAX_FILES = 50;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const UPLOAD_NAME = /^upload-[a-f0-9-]{36}\.jpg$/;

class GalleryUploadError extends Error {
    constructor(message) {super(message); this.status = 400;}
}

async function readDirectory(directory) {
    try {return await fs.readdir(directory, {withFileTypes: true});}
    catch (error) {if (error.code === 'ENOENT') return []; throw error;}
}

function createGalleryStore(root = path.join(__dirname, '../public/img/gallery')) {
    const uploads = path.join(root, 'uploads');
    const previews = path.join(uploads, 'thumbs');

    async function listPhotos() {
        const originals = (await readDirectory(root))
            .filter(entry => entry.isFile() && /^img[1-9]\d*\.jpg$/.test(entry.name))
            .map(entry => ({id: Number(entry.name.slice(3, -4)), name: entry.name}))
            .sort((a, b) => a.id - b.id);
        const photos = await Promise.all(originals.map(async ({id, name}) => {
            const src = `/img/gallery/${name}`;
            const thumbnail = `/img/gallery/thumbs/img${id}.webp`;
            const hasPreview = await fs.access(path.join(root, 'thumbs', `img${id}.webp`)).then(() => true, () => false);
            return {id, src, thumbnail: hasPreview ? thumbnail : src};
        }));
        const additions = await Promise.all((await readDirectory(uploads))
            .filter(entry => entry.isFile() && UPLOAD_NAME.test(entry.name))
            .map(async entry => {
                const id = entry.name.slice(0, -4);
                const hasPreview = await fs.access(path.join(previews, `${id}.webp`)).then(() => true, () => false);
                if (!hasPreview) return null;
                const stat = await fs.stat(path.join(uploads, entry.name));
                return {id, src: `/img/gallery/uploads/${entry.name}`,
                    thumbnail: `/img/gallery/uploads/thumbs/${id}.webp`, time: stat.mtimeMs};
            }));
        additions.filter(Boolean).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
            .forEach(({time, ...photo}) => photos.push(photo));
        return photos;
    }

    async function addPhotos(files) {
        if (!files.length || files.length > MAX_FILES) {
            throw new GalleryUploadError(`Choose between 1 and ${MAX_FILES} photos.`);
        }
        if (files.some(file => file.truncated || file.size > MAX_FILE_BYTES || file.size === 0)) {
            throw new GalleryUploadError('Each photo must be non-empty and at most 15 MB.');
        }
        // Validate and encode the whole batch before publishing any files.
        // Original upload names and MIME declarations never become stored paths.
        const encoded = [];
        for (const file of files) {
            try {
                const input = file.tempFilePath || file.data;
                const image = sharp(input, {limitInputPixels: 80_000_000, failOn: 'error'});
                const metadata = await image.metadata();
                if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) {
                    throw new Error('Unsupported image');
                }
                const full = await image.rotate().resize({width: 3840, height: 3840, fit: 'inside', withoutEnlargement: true})
                    .jpeg({quality: 90}).toBuffer();
                const preview = await sharp(full).resize({width: 440, height: 572, fit: 'inside', withoutEnlargement: true})
                    .webp({quality: 80}).toBuffer();
                encoded.push({id: `upload-${randomUUID()}`, full, preview});
            } catch (error) {
                throw new GalleryUploadError(`“${file.name}” could not be read. Choose a valid JPG, PNG or WebP photo (up to 80 megapixels).`);
            }
        }
        await fs.mkdir(previews, {recursive: true});
        const written = [];
        try {
            for (const {id, full, preview} of encoded) {
                const thumbnailPath = path.join(previews, `${id}.webp`);
                const imagePath = path.join(uploads, `${id}.jpg`);
                await fs.writeFile(thumbnailPath, preview, {flag: 'wx'});
                written.push(thumbnailPath);
                await fs.writeFile(imagePath, full, {flag: 'wx'});
                written.push(imagePath);
            }
        } catch (error) {
            await Promise.all(written.map(file => fs.unlink(file).catch(() => {})));
            throw error;
        }
        return encoded.length;
    }

    return {listPhotos, addPhotos};
}

module.exports = {createGalleryStore, GalleryUploadError, MAX_FILES, MAX_FILE_BYTES};
