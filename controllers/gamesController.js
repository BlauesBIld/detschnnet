const {v4: uuidv4} = require('uuid');

const gamesModel = require('../models/gamesModel');

function getGames() {
    return gamesModel.getGames();
}

function getGameByUuid(uuid) {
    return gamesModel.getGameByUuid(uuid);
}

function createGame(req, res, next) {
    if (!req.body.title || !req.body.description || !req.files.cover_image) {
        res.status(400);
        next('Invalid input');
    } else {
        let fileFormat = req.files.cover_image.name.split('.').pop();
        req.body.cover_image_name = "cover." + fileFormat;

        gamesModel.insertGame(req.body)
            .then((gameUuid) => {
                uploadImage(req.files.cover_image, gameUuid, req.body.cover_image_name);
                res.redirect('/');
            })
            .catch((err) => {
                res.status(500);
                next(err);
            });
    }
}

function uploadImage(image, game_uuid, filename) {
    const path = "./public/img/games/" + game_uuid + "/" + filename;
    image.mv(path, function (err) {
        if (err) {
            console.log(err);
        }
    });
}

function updateGame(req, res, next) {
    if (!req.body.title || !req.body.description) {
        res.status(400);
        next('Invalid input');
    } else {
        gamesModel.updateGame(req.params.gameUuid, req.body)
            .then(() => {
                if (req.files !== null && req.files.images !== null) {
                    let images = Array.isArray(req.files.images) ? req.files.images : [req.files.images];

                    for (let image of images) {
                        let fileFormat = image.name.split('.').pop();
                        uploadImage(image, req.params.gameUuid, uuidv4() + "." + fileFormat);
                    }
                }
                res.redirect('/games/' + req.params.gameUuid);
            })
            .catch((err) => {
                res.status(500);
                next(err);
            });
    }
}

module.exports = {
    createGame,
    getGames,
    getGameByUuid,
    updateGame
};