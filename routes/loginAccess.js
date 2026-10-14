const express = require('express');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const authentication = require('../services/authentication');

function createLoginAccessRouter({users = require('../models/userModel'), auth = authentication} = {}) {
    const router = express.Router();
    router.use(auth.authenticateOwner);
    router.get('/', async (req, res, next) => {
        try {
            if (!req.session.loginAccessToken) req.session.loginAccessToken = randomBytes(32).toString('hex');
            res.render('login-access', {users: await users.getLoginAccessUsers(), csrfToken: req.session.loginAccessToken});
        } catch (error) {next(error);}
    });
    router.post('/', async (req, res, next) => {
        const {csrfToken, uuid, enabled} = req.body || {};
        const expected = req.session.loginAccessToken;
        if (typeof csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(csrfToken) || typeof expected !== 'string' ||
            csrfToken.length !== expected.length || !timingSafeEqual(Buffer.from(csrfToken), Buffer.from(expected))) {
            return res.status(403).send('This form has expired. Reload the login access page.');
        }
        if (typeof uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(uuid) || !['true', 'false'].includes(enabled)) {
            return res.status(400).send('Choose an account and a valid login setting.');
        }
        try {
            if (!await users.setLoginEnabled(uuid, enabled === 'true')) {
                return res.status(400).send('Account not found, or the account belongs to detschn.');
            }
            return res.redirect(303, '/streamer/login-access');
        } catch (error) {next(error);}
    });
    return router;
}

module.exports = {createLoginAccessRouter};
