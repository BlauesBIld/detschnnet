const express = require('express');
const router = express.Router();

const fs = require('fs');
const path = require('path');

const marked = require('marked');
const gamesController = require('../controllers/gamesController');
const devlogsController = require('../controllers/devlogsController');
const authenticationService = require("../services/authentication");
const jwt = require("jsonwebtoken");

router.get('/create', authenticationService.authenticateAdmin, (req, res) => {
    res.render('createGame', {title: "Create new game", loggedInUser: req.user});
});
router.post('/create', authenticationService.authenticateAdmin, gamesController.createGame);

router.get('/:gameUuid/edit', authenticationService.authenticateAdmin, (req, res) => {
    gamesController.getGameByUuid(req.params.gameUuid).then((game) => {
        let imageNames = getImageNamesFromGame(game);
        console.log(imageNames);
        res.render('editGame', {title: game.title, game, loggedInUser: req.user, imageNames: imageNames});
    });
});
router.post('/:gameUuid/edit', authenticationService.authenticateAdmin, gamesController.updateGame);


function getImageNamesFromGame(game) {
    const directoryPath = path.join('.', 'public', 'img', 'games', game.uuid);

    let imageNames = [];

    try {
        imageNames = fs.readdirSync(directoryPath);

        imageNames = imageNames.filter(file => {
            return path.extname(file).match(/\.(jpg|jpeg|png|JPG|JPEG|PNG)$/);
        });

        imageNames.sort((a, b) => {
            if (a === 'cover.JPG') return -1;
            if (b === 'cover.JPG') return 1;
            return 0;
        });
    } catch (error) {
        console.error("Error reading directory: ", error);
    }

    return imageNames;
}

router.get('/:gameUuid', authenticationService.verifyToken, (req, res) => {
    gamesController.getGameByUuid(req.params.gameUuid).then((game) => {
        game.descriptionHtml = marked.marked(game.description);

        let imageNames = getImageNamesFromGame(game);
        console.log(imageNames);

        res.render('game', {
            title: game.title,
            game,
            loggedInUser: req.user,
            imageNames: imageNames
        });
    });
});

module.exports = router;