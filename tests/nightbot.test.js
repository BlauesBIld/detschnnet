const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, dependencies, globals = {}) {
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        module, exports: module.exports, URLSearchParams, AbortSignal, Date,
        console: {error() {}},
        require(name) {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        },
        ...globals
    }, {filename: file});
    return module.exports;
}

const DAY = 86400000;
const initial = () => ({access_token: 'old-access', refresh_token: 'old-refresh',
    nightbot_expires_at: new Date(Date.now() + 20 * DAY)});
const tokens = {access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 2592000};
const response = (status, body = {}) => ({status, ok: status >= 200 && status < 300,
    json: async () => body, text: async () => JSON.stringify(body)});

// Exercise the actual model/controller together, with a transactional pool double.
function setup(rows = {chiara: initial()}, fetchHandler = async () => response(200, tokens)) {
    const records = new Map(Object.entries(rows));
    const locks = new Map();
    const queries = [];
    const requests = [];
    const db = {
        async query(sql) {
            queries.push(sql);
            if (sql.startsWith('ALTER TABLE')) return {};
            assert.match(sql, /SELECT DISTINCT streamer/);
            return {rows: [...records.keys()].map(streamer => ({streamer}))};
        },
        async connect() {
            let unlock, staged, key;
            return {
                async query(sql, args = []) {
                    queries.push(sql);
                    if (sql === 'BEGIN') return {};
                    if (sql.includes('pg_advisory_xact_lock')) {
                        key = args[0].slice('nightbot:'.length);
                        const previous = locks.get(key) || Promise.resolve();
                        const next = new Promise(resolve => { unlock = resolve; });
                        locks.set(key, next);
                        await previous;
                        return {};
                    }
                    if (sql.startsWith('SELECT *')) {
                        assert.ok(unlock, 'Read must follow lock acquisition');
                        return {rows: records.has(key) ? [{...records.get(key)}] : []};
                    }
                    if (sql.startsWith('UPDATE')) {
                        assert.match(sql, /access_token = \$1, refresh_token = \$2, nightbot_expires_at = \$3/);
                        staged = {access_token: args[0], refresh_token: args[1], nightbot_expires_at: args[2]};
                        return {};
                    }
                    if (sql.startsWith('INSERT')) {
                        staged = {access_token: args[1], refresh_token: args[2], nightbot_expires_at: args[3]};
                        return {};
                    }
                    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
                        if (sql === 'COMMIT' && staged) records.set(key, staged);
                        unlock?.();
                        unlock = undefined;
                        return {};
                    }
                    assert.fail(`Unexpected query: ${sql}`);
                },
                release() { assert.equal(unlock, undefined, 'Transaction must finish before release'); }
            };
        }
    };
    const model = load('models/nightbotConnectionsModel.js', {'../services/database': {config: db}});
    const api = load('controllers/nightbotController.js', {
        '../models/nightbotConnectionsModel': model,
        '../models/botsMetaDataModel': {getValueForPlatformAndName: async (platform, name) => `test-${name}`}
    }, {fetch: async (url, options) => {
        const request = {url, ...options};
        requests.push(request);
        return fetchHandler(request);
    }});
    return {api, records, queries, requests};
}

test('valid token sends once without refreshing', async () => {
    const h = setup();
    await h.api.sendMessageInChannel('chiara', 'gurke');
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].headers.Authorization, 'Bearer old-access');
});

test('401 refreshes both tokens atomically and retries the same message once', async () => {
    const h = setup(undefined, async request => request.url.endsWith('/token')
        ? response(200, tokens)
        : response(request.headers.Authorization === 'Bearer old-access' ? 401 : 200));
    await h.api.sendMessageInChannel('chiara', 'gurke');
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[0].body, h.requests[2].body);
    assert.equal(new URLSearchParams(h.requests[1].body).get('refresh_token'), 'old-refresh');
    assert.equal(h.records.get('chiara').refresh_token, 'new-refresh');
    assert.ok(h.records.get('chiara').nightbot_expires_at > Date.now() + 29 * DAY);
    assert.equal(h.queries.filter(sql => sql.startsWith('UPDATE')).length, 1);
});

test('simultaneous 401s consume the old refresh token only once', async () => {
    let oldSends = 0, release;
    const bothSent = new Promise(resolve => {release = resolve;});
    const h = setup(undefined, async request => {
        if (request.url.endsWith('/token')) return response(200, tokens);
        if (request.headers.Authorization === 'Bearer old-access') {
            if (++oldSends === 2) release();
            await bothSent;
            return response(401);
        }
        return response(200);
    });
    await Promise.all([h.api.sendMessageInChannel('chiara', 'normal'),
        h.api.sendMessageInChannel('chiara', 'golden')]);
    assert.equal(h.requests.filter(r => r.url.endsWith('/token')).length, 1);
    assert.equal(h.requests.filter(r => r.url.endsWith('/send')).length, 4);
});

test('second 401 stops instead of looping', async () => {
    const h = setup(undefined, async r => r.url.endsWith('/token') ? response(200, tokens) : response(401));
    await assert.rejects(h.api.sendMessageInChannel('chiara', 'gurke'), /HTTP 401/);
    assert.equal(h.requests.length, 3);
});

test('non-401 errors do not refresh or retry the message', async () => {
    for (const status of [403, 429, 500]) {
        const h = setup(undefined, async () => response(status));
        await assert.rejects(h.api.sendMessageInChannel('chiara', 'gurke'), new RegExp(`HTTP ${status}`));
        assert.equal(h.requests.length, 1);
    }
});

test('background renewal handles legacy and expiring tokens without sending chat', async () => {
    const h = setup({legacy: {...initial(), nightbot_expires_at: null},
        due: {...initial(), nightbot_expires_at: new Date(Date.now() + DAY)}, fresh: initial()});
    await h.api.renewExpiringConnections();
    await h.api.renewExpiringConnections();
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(r => r.url.endsWith('/token')));
    assert.equal(h.records.get('fresh').access_token, 'old-access');
    assert.equal(h.queries.filter(sql => sql.startsWith('ALTER')).length, 1);
});

test('invalid grant preserves credentials, rolls back and gives reconnect guidance', async () => {
    const h = setup(undefined, async () => response(400, {error: 'invalid_grant', error_description: 'secret'}));
    await assert.rejects(h.api.refreshAccessToken('chiara'), error => {
        assert.match(error.message, /reconnect Nightbot/);
        assert.doesNotMatch(error.message, /secret|old-refresh/);
        return true;
    });
    assert.equal(h.records.get('chiara').access_token, 'old-access');
    assert.ok(h.queries.includes('ROLLBACK'));
});

test('malformed and unsuccessful token responses never overwrite saved tokens', async () => {
    for (const result of [response(200, {}), response(200, {...tokens, refresh_token: null}),
        response(500, tokens), response(200, {...tokens, expires_in: 0})]) {
        const h = setup(undefined, async () => result);
        await assert.rejects(h.api.refreshAccessToken('chiara'));
        assert.equal(h.records.get('chiara').refresh_token, 'old-refresh');
        assert.ok(!h.queries.some(sql => sql.startsWith('UPDATE')));
    }
});

test('one disconnected account does not block background renewal of another', async () => {
    const h = setup({broken: {...initial(), refresh_token: null, nightbot_expires_at: null},
        chiara: {...initial(), nightbot_expires_at: null}});
    await h.api.renewExpiringConnections();
    assert.equal(h.records.get('chiara').refresh_token, 'new-refresh');
});

test('OAuth callback saves expiry and both tokens for new and existing connections', async () => {
    for (const rows of [{}, {chiara: initial()}]) {
        const h = setup(rows);
        await h.api.getAndSaveTokensForStreamer('chiara', 'test-code');
        assert.equal(h.records.get('chiara').refresh_token, 'new-refresh');
        assert.equal(new URLSearchParams(h.requests[0].body).get('grant_type'), 'authorization_code');
    }
});

test('daily scheduler starts immediately, avoids overlapping runs and survives errors', async () => {
    let tick, interval, calls = 0, rejectRun;
    const service = load('services/nightbotTokenRenewal.js', {
        '../controllers/nightbotController': {renewExpiringConnections: () => {
            calls++;
            return new Promise((resolve, reject) => {rejectRun = reject;});
        }}
    }, {setInterval(callback, ms) {tick = callback; interval = ms; return {unref() {}};}});
    service.start();
    service.start();
    await tick();
    assert.equal(calls, 1);
    assert.equal(interval, DAY);
    rejectRun(new Error('temporary outage'));
    await new Promise(resolve => setImmediate(resolve));
    const next = tick();
    assert.equal(calls, 2);
    rejectRun(new Error('another outage'));
    await next;
});
