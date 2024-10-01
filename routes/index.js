const express = require('express');
const router = express.Router();

const authenticationService = require("../services/authentication");
const gamesController = require("../controllers/gamesController");

router.get('/', authenticationService.verifyToken, (req, res) => {
    res.render('index', {title: "Welcome", loggedInUser: req.user});
});

router.get('/old', authenticationService.verifyToken, (req, res) => {
    gamesController.getGames().then((games) => {
        //shuffle games
        for (let i = games.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [games[i], games[j]] = [games[j], games[i]];
        }
        res.render('index', {title: "Welcome", games, loggedInUser: req.user});
    });
});

router.get('/logout', (req, res, next) => {
    res.clearCookie('accessToken');
    res.redirect('/');
});

router.get('/aboutme', authenticationService.verifyToken, (req, res) => {
    res.render('aboutme', {title: "Me - Dejan", loggedInUser: req.user});
});

module.exports = router;
