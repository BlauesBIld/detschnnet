const express = require('express');
const router = express.Router();
const fs = require('fs');
const winston = require('winston');

const spotifyController = require('../controllers/spotifyController.js');
const authenticationService = require("../services/authentication");

const spotifyLogger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({filename: 'logs/spotify.log'})
    ]
});

router.get('/saveConnection', authenticationService.authenticateJWT, (req, res) => {
    if (req.query.error) {
        console.log(req.query.error);
    } else {
        spotifyController.getAndSaveTokensForStreamer(req.user.username, req.query.code).then((body) => {
            spotifyLogger.info('New SPOTIFY access token saved! code: ' + req.query.code + ' access token: ' + body.access_token + ' refresh token: ' + body.refresh_token);
            res.redirect('/streamer');
        }).catch(err => {
            console.log(err);
            res.status(500).json(err);
        });
    }
});

router.get('/:streamer/currentSongTitle', (req, res) => {
    spotifyController.getCurrentSongTitle(req.params.streamer).then(body => {
        let resBody = {};
        if (body.status === 204) {
            resBody = {
                'name': '-',
                'artist': '-'
            }
        } else {
            resBody = {
                'name': body.item.name,
                'artist': body.item.artists[0].name
            }
        }
        res.status(200).json(resBody);
    }).catch(err => {
        console.log(err);
        res.status(500).json(err);
    });
});

module.exports = router
