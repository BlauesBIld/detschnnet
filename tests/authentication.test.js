const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const {createAuthentication} = require('../services/authentication');
const {createLoginAccessRouter} = require('../routes/loginAccess');

const secret = 'authentication-test-secret';
process.env.ACCESS_TOKEN_SECRET = secret;
const ownerId = '00000000-0000-4000-8000-000000000001';
const adminId = '00000000-0000-4000-8000-000000000002';
const streamerId = '00000000-0000-4000-8000-000000000003';
const password = 'test-password';
const passwordHash = bcrypt.hashSync(password, 10);

async function setup(t) {
    const accounts = new Map([
        [ownerId, {uuid: ownerId, username: 'detschn', user_role: 'streamer', login_enabled: false, password_hash: passwordHash}],
        [adminId, {uuid: adminId, username: 'another-admin', user_role: 'admin', login_enabled: false, password_hash: passwordHash}],
        [streamerId, {uuid: streamerId, username: 'streamer', user_role: 'streamer', login_enabled: false, password_hash: passwordHash}]
    ]);
    let databaseError;
    const auth = createAuthentication({getUserByUuid: async uuid => {
        if (databaseError) throw databaseError;
        return accounts.get(uuid);
    }});
    const writes = [];
    const users = {
        getLoginAccessUsers: async () => [...accounts.values()],
        async setLoginEnabled(uuid, enabled) {
            const account = accounts.get(uuid);
            if (!account || account.username === 'detschn') return false;
            writes.push({uuid, enabled});
            account.login_enabled = enabled;
            return true;
        }
    };
    const app = express();
    app.set('views', path.join(__dirname, '../views'));
    app.set('view engine', 'ejs');
    app.use(cookieParser());
    app.use(express.urlencoded({extended: false}));
    app.use(session({secret: 'login-access-test-session', resave: false, saveUninitialized: false}));
    app.post('/login', async (req, res, next) => {
        try {await auth.authenticateUserLogin(req.body, [...accounts.values()], res);} catch (error) {next(error);}
    });
    app.get('/protected', auth.authenticateJWT, (req, res) => res.json(req.user));
    app.get('/admin', auth.authenticateAdmin, (req, res) => res.json(req.user));
    app.get('/public', auth.verifyToken, (req, res) => res.json({user: req.user || null}));
    app.use('/streamer/login-access', createLoginAccessRouter({users, auth}));
    app.use((error, req, res, next) => res.status(500).send('Database unavailable'));
    const server = await new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const token = (uuid, claims = {}) => jwt.sign({uuid, ...claims}, secret, {expiresIn: '1h'});
    const request = (url, {uuid, claims, cookie, body, method = body ? 'POST' : 'GET'} = {}) => fetch(
        `http://127.0.0.1:${server.address().port}${url}`, {
            method, redirect: 'manual',
            headers: {Cookie: cookie || (uuid ? `accessToken=${token(uuid, claims)}` : '')},
            body: body ? new URLSearchParams(body) : undefined
        });
    async function form() {
        const response = await request('/streamer/login-access', {uuid: ownerId});
        assert.equal(response.status, 200);
        const html = await response.text();
        return {csrfToken: html.match(/name="csrfToken" value="([a-f0-9]+)"/)[1], html,
            cookie: `accessToken=${token(ownerId)}; ${response.headers.get('set-cookie').split(';')[0]}`};
    }
    return {accounts, writes, request, form, token, failDatabase: () => {databaseError = new Error('offline');}};
}

test('only detschn can log in initially; bcrypt passwords and effective admin role are preserved', async t => {
    const s = await setup(t);
    for (const username of ['another-admin', 'streamer']) {
        const response = await s.request('/login', {body: {username, password}});
        assert.equal(response.status, 403);
        assert.doesNotMatch(response.headers.get('set-cookie') || '', /accessToken=ey/);
    }
    assert.equal((await s.request('/login', {body: {username: 'detschn', password: 'wrong'}})).status, 401);
    const response = await s.request('/login', {body: {username: 'detschn', password}});
    assert.equal(response.status, 302);
    const cookie = response.headers.get('set-cookie');
    const claims = jwt.verify(cookie.match(/accessToken=([^;]+)/)[1], secret);
    assert.equal(claims.role, 'admin');
    assert.equal(claims.uuid, ownerId);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
});

test('only detschn may view or change login access, even after another admin is enabled', async t => {
    const s = await setup(t);
    for (const uuid of [adminId, streamerId]) {
        s.accounts.get(uuid).login_enabled = true;
        for (const method of ['GET', 'POST']) {
            assert.equal((await s.request('/streamer/login-access', {uuid, method})).status, 403);
        }
    }
    assert.equal((await s.request('/streamer/login-access')).status, 401);
    assert.equal(s.writes.length, 0);
    const form = await s.form();
    assert.match(form.html, /Always enabled/);
    assert.match(form.html, /another-admin/);
    assert.doesNotMatch(form.html, /password_hash|\$2b\$/);
});

test('owner can enable and disable accounts; login and existing sessions follow each change', async t => {
    const s = await setup(t), form = await s.form();
    for (const enabled of ['true', 'false']) {
        const response = await s.request('/streamer/login-access', {cookie: form.cookie,
            body: {csrfToken: form.csrfToken, uuid: streamerId, enabled}});
        assert.equal(response.status, 303);
        const expected = enabled === 'true' ? 200 : 403;
        assert.equal((await s.request('/protected', {uuid: streamerId})).status, expected);
        assert.equal((await s.request('/login', {body: {username: 'streamer', password}})).status, enabled === 'true' ? 302 : 403);
    }
    assert.deepEqual(s.writes, [{uuid: streamerId, enabled: true}, {uuid: streamerId, enabled: false}]);
});

test('login controls reject missing or forged CSRF, invalid values and attempts to disable detschn', async t => {
    const s = await setup(t), form = await s.form();
    for (const csrfToken of ['', '0'.repeat(64), 'é'.repeat(64)]) {
        assert.equal((await s.request('/streamer/login-access', {cookie: form.cookie,
            body: {csrfToken, uuid: streamerId, enabled: 'true'}})).status, 403);
    }
    for (const body of [{uuid: ownerId, enabled: 'false'}, {uuid: streamerId, enabled: 'yes'},
        {uuid: "' OR 1=1 --", enabled: 'true'}]) {
        assert.equal((await s.request('/streamer/login-access', {cookie: form.cookie,
            body: {...body, csrfToken: form.csrfToken}})).status, 400);
    }
    assert.equal(s.writes.length, 0);
});

test('database identity overrides stale JWT roles and names; deleted or disabled users lose access', async t => {
    const s = await setup(t);
    s.accounts.get(streamerId).login_enabled = true;
    assert.equal((await s.request('/admin', {uuid: streamerId, claims: {role: 'admin', username: 'detschn'}})).status, 403);
    const owner = await s.request('/admin', {uuid: ownerId, claims: {role: 'streamer'}});
    assert.equal(owner.status, 200);
    assert.equal((await owner.json()).role, 'admin');
    s.accounts.get(adminId).login_enabled = true;
    assert.equal((await s.request('/admin', {uuid: adminId})).status, 200);
    s.accounts.get(adminId).user_role = 'streamer';
    assert.equal((await s.request('/admin', {uuid: adminId, claims: {role: 'admin'}})).status, 403);
    s.accounts.delete(streamerId);
    assert.equal((await s.request('/protected', {uuid: streamerId})).status, 403);
    assert.deepEqual(await (await s.request('/public', {uuid: streamerId})).json(), {user: null});
});

test('invalid sessions and database failures cannot pass authentication or owner guards', async t => {
    const s = await setup(t);
    for (const cookie of ['accessToken=garbage', `accessToken=${jwt.sign({uuid: ownerId}, secret, {expiresIn: -1})}`,
        `accessToken=${jwt.sign({username: 'detschn'}, secret)}`, `accessToken=${jwt.sign({uuid: ownerId}, 'forged')}`]) {
        assert.equal((await s.request('/admin', {cookie})).status, 401);
    }
    s.failDatabase();
    for (const url of ['/protected', '/admin', '/streamer/login-access']) {
        assert.equal((await s.request(url, {uuid: ownerId})).status, 500);
    }
});
