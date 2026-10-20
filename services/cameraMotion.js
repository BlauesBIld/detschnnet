const {Cam} = require('onvif');

function motionEvent(message) {
    const topic = typeof message?.topic === 'string' ? message.topic : message?.topic?._;
    if (typeof topic !== 'string' || !/motion/i.test(topic)) return null;
    const data = message.message?.message?.data?.simpleItem;
    for (const item of [].concat(data || [])) {
        const attrs = item.$ || item;
        const name = attrs.Name ?? attrs.name;
        const value = attrs.Value ?? attrs.value;
        if (!/^(IsMotion|State|Motion|LogicalState)$/i.test(String(name))) continue;
        if (value === true || value === 'true' || value === '1' || value === 1) return {topic, active: true};
        if (value === false || value === 'false' || value === '0' || value === 0) return {topic, active: false};
    }
    return null;
}

function watchCameraMotion(settings, {onMotion, onStatus, retryMs = 10_000, CamClass = Cam} = {}) {
    let stopped = false, camera, timer;
    const topics = new Map();
    function release() {
        const current = camera;
        camera = null;
        if (current) {
            current.removeAllListeners('event');
            current.unsubscribe(() => {});
        }
        topics.clear();
    }
    function retry() {
        if (stopped || timer) return;
        onStatus('disconnected');
        release();
        onMotion(false);
        timer = setTimeout(() => {timer = null; connect();}, retryMs);
        timer.unref?.();
    }
    function connect() {
        if (stopped) return;
        onStatus('connecting');
        const current = new CamClass({hostname: settings.host, port: 2020, username: settings.username,
            password: settings.password, autoconnect: false, preserveAddress: true, timeout: 75_000});
        camera = current;
        const failed = () => {if (camera === current) retry();};
        current.on('error', failed);
        current.on('eventsError', failed);
        current.connect(error => {
            if (stopped || camera !== current) return;
            if (error) return retry();
            current.createPullPointSubscription(error => {
                if (stopped || camera !== current) return;
                if (error) return retry();
                onStatus('listening');
                current.on('event', message => {
                    if (stopped || camera !== current) return;
                    const motion = motionEvent(message);
                    if (!motion) return;
                    topics.set(motion.topic, motion.active);
                    onMotion([...topics.values()].some(Boolean));
                });
            });
        });
    }
    connect();
    return {close() {stopped = true; clearTimeout(timer); release();}};
}

module.exports = {motionEvent, watchCameraMotion};
