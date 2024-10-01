const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;

async function checkPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

async function authenticateUserLogin({username, password}, users, res) {
    const user = users.find((u) => { return u.username === username });
    if (user && await checkPassword(password, user.password_hash)) {
        const accessToken = jwt.sign({uuid: user.uuid, username: user.username, role: user.user_role}, ACCESS_TOKEN_SECRET, {expiresIn: '24h'});
        res.cookie('accessToken', accessToken, { httpOnly: true, secure: true });
        res.redirect('/streamer/');
    } else {
        const message = 'Wrong Username or Password!';
        res.render('login', {message: message});
    }
}

function authenticateJWT(req, res, next) {
    const token = req.cookies['accessToken'];
    if (token) {
        jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
            if (err) {
                const message = 'There was an error with your session. Please log in again.';
                res.render('login', {message: message});
            }
            req.user = user;
            next();
        });
    } else {
        const message = 'Please log in to access this page!';
        res.render('login', {message: message});
    }
}

function authenticateAdmin(req, res, next) {
    const token = req.cookies['accessToken'];
    if (token) {
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
            if (err) {
                const message = 'There was an error with your session. Please log in again.';
                return res.render('login', {message: message});
            } else if (user.role !== 'admin') {
                res.redirect('/streamer/');
            }
            req.user = user;
            next();
        });
    } else {
        const message = 'Please log in to access this page!';
        res.render('login', {message: message});
    }
}

function verifyToken(req, res, next) {
    const token = req.cookies['accessToken'];
    if (token) {
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
            if (err) {
                res.clearCookie('accessToken');
                res.redirect('/');
            } else {
                req.user = user;
                next();
            }
        });
    } else {
        next();
    }
}

module.exports = {
    authenticateUserLogin,
    authenticateJWT,
    authenticateAdmin,
    verifyToken
}
