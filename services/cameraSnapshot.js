const {spawn} = require('node:child_process');

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

function extractCameraJpeg({filename, offset, ffmpegPath, spawnImpl = spawn, timeout = 8000}) {
    return new Promise((resolve, reject) => {
        const child = spawnImpl(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(Math.max(0, offset)),
            '-threads', '2', '-i', filename, '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2",
            '-threads', '2', '-q:v', '3', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'],
        {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
        const chunks = [];
        let size = 0;
        const timer = setTimeout(() => {child.kill('SIGKILL'); reject(new Error('Camera screenshot timed out.'));}, timeout);
        timer.unref?.();
        child.stderr?.on('data', () => {});
        child.stdout.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_SCREENSHOT_BYTES) {child.kill('SIGKILL'); return;}
            chunks.push(chunk);
        });
        child.once('error', () => {clearTimeout(timer); reject(new Error('Camera screenshot unavailable.'));});
        child.once('close', code => {
            clearTimeout(timer);
            if (code !== 0 || !size || size > MAX_SCREENSHOT_BYTES) return reject(new Error('Camera screenshot unavailable.'));
            resolve(Buffer.concat(chunks));
        });
    });
}

module.exports = {extractCameraJpeg, MAX_SCREENSHOT_BYTES};
