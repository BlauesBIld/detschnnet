const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const isOwner = user => user?.username === 'detschn';
const isAdmin = user => isOwner(user) || user?.role === 'admin';
const canLogin = user => Boolean(user && (isOwner(user) || user.login_enabled === true));
const identity = user => ({uuid: user.uuid, username: user.username,
    role: isOwner(user) ? 'admin' : user.user_role});

// Resolve the account on every request: old JWTs must not retain disabled access
// or outdated administrator rights. Load the model lazily for public visitors.
function createAuthentication({getUserByUuid = uuid => require('../models/userModel').getUserByUuid(uuid)} = {}) {
    async function authenticateUserLogin({username, password}, users, res) {
        const user = users.find(user => user.username === username);
        if (!user || typeof password !== 'string' || !await bcrypt.compare(password, user.password_hash)) {
            return res.status(401).render('login', {message: 'Wrong Username or Password!'});
        }
        if (!canLogin(user)) {
            res.clearCookie('accessToken');
            return res.status(403).render('login', {message: 'Login for this account is disabled. Please contact detschn.'});
        }
        const accessToken = jwt.sign(identity(user), process.env.ACCESS_TOKEN_SECRET, {expiresIn: '24h'});
        res.cookie('accessToken', accessToken, {httpOnly: true, secure: true, sameSite: 'lax'});
        return res.redirect('/streamer/');
    }

    function authenticate(optional = false) {
        return async (req, res, next) => {
            res.set('Cache-Control', 'no-store');
            const token = req.cookies?.accessToken;
            let claims;
            if (token) {
                try {
                    claims = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
                    if (typeof claims.uuid !== 'string') throw new Error('Missing account ID');
                } catch {
                    res.clearCookie('accessToken');
                    if (optional) return next();
                    return res.status(401).render('login', {message: 'There was an error with your session. Please log in again.'});
                }
            } else {
                if (optional) return next();
                return res.status(401).render('login', {message: 'Please log in to access this page!'});
            }
            try {
                const user = await getUserByUuid(claims.uuid);
                if (!canLogin(user)) {
                    res.clearCookie('accessToken');
                    if (optional) return next();
                    return res.status(403).render('login', {message: 'Login for this account is disabled. Please contact detschn.'});
                }
                req.user = identity(user);
                return next();
            } catch (error) {return next(error);}
        };
    }

    const authenticateJWT = authenticate();
    const requirePermission = (check, message) => (req, res, next) => authenticateJWT(req, res, error => {
        if (error) return next(error);
        if (!check(req.user)) return res.status(403).send(message);
        return next();
    });
    return {
        authenticateUserLogin,
        authenticateJWT,
        authenticateAdmin: requirePermission(isAdmin, 'Administrator access required.'),
        authenticateOwner: requirePermission(isOwner, 'Only detschn can manage login access.'),
        verifyToken: authenticate(true)
    };
}

module.exports = {...createAuthentication(), createAuthentication, isOwner, isAdmin};
