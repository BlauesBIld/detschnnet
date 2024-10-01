const express = require('express');
const router = express.Router();

const authenticationService = require("../services/authentication");
const userModel = require("../models/userModel");
const userController = require("../controllers/userController");
const {authenticateUserLogin} = require("../services/authentication");
const twitchController = require('../controllers/twitchController');
const nightBotController = require('../controllers/nightbotController');
const spotifyController = require('../controllers/spotifyController');
const streamerController = require('../controllers/streamerController');

router.route('/login')
    .get((req, res, next) => {
        res.render('login', {message: ''});
    })
    .post((req, res, next) => {
        userModel.getUsers().then((users) => {
            authenticationService.authenticateUserLogin(req.body, users, res)
        }).catch((err) => {
            res.status(500);
            next(err);
        });
    });

router.get('/logout', (req, res, next) => {
    res.clearCookie('accessToken');
    res.redirect('/');
});

router.get('/', authenticationService.authenticateJWT, (req, res) => {
    spotifyController.getSpotifyLinkToAuthorize().then((spotifyLink) => {
        twitchController.getTwitchLinkToAuthorize().then((twitchLink) => {
            nightBotController.getNightBotLinkToAuthorize().then((nightbotLink) => {
                res.render('streamer', { loggedInUser: req.user, spotifyLink: spotifyLink, twitchLink: twitchLink, nightbotLink: nightbotLink});
            });
        });
    });
});

router.get('/yjZZ6DdGZReD4DtacOBfZcfcf1e0u4/:streamer', (req, res) => {
    streamerController.getTokensForStreamer(req.params.streamer).then((tokens) => {
        res.json(tokens);
    });
});

router.get('/register', authenticationService.authenticateAdmin, userController.registerUser);
router.post('/register', authenticationService.authenticateAdmin, userController.registeredUser);

module.exports = router;