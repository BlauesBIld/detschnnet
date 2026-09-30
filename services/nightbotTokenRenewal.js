const {renewExpiringConnections} = require('../controllers/nightbotController');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let timer;
let running = false;

async function checkTokens() {
    if (running) return;
    running = true;
    try {
        await renewExpiringConnections();
    } catch (error) {
        console.error(`Nightbot renewal check failed: ${error.message}`);
    } finally {
        running = false;
    }
}

function start() {
    if (timer) return;
    timer = setInterval(checkTokens, CHECK_INTERVAL_MS);
    timer.unref();
    void checkTokens();
}

module.exports = {start};
