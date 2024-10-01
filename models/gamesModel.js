const db = require('../services/database.js').config;
const fs = require('fs');
const {v4: uuidv4} = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

let getGames = () => new Promise((resolve, reject) => {
    db.query('SELECT * FROM games', function (err, result, fields) {
        if (err) reject(err);
        resolve(result.rows);
    });
});

let getGameByUuid = (uuid) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM games WHERE uuid = $1', [uuid], function (err, result, fields) {
        if (err) {
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

let getGameByTitle = (title) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM games WHERE title = $1', [title], function (err, result, fields) {
        if (err) {
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

function setDefaultValuesIfEmpty(gameData) {
    gameData.engine = gameData.engine === '' ? 'No Engine' : gameData.engine;
    gameData.genre = gameData.genre === '' ? '-' : gameData.genre;
    gameData.platform = gameData.platform === '' ? '-' : gameData.platform;
    gameData.tags = gameData.tags === '' ? '-' : gameData.tags;
    gameData.languages_and_tools = gameData.languages_and_tools === '' ? '-' : gameData.languages_and_tools;
}

let insertGame = (gameData) => new Promise((resolve, reject) => {
    let publish_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let uuid = uuidv4();
    setDefaultValuesIfEmpty(gameData);
    db.query('INSERT INTO games (uuid, title, engine, description, status, genre, platform, github, tags, publish_date, languages_and_tools) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [uuid, gameData.title, gameData.engine, gameData.description, gameData.status, gameData.genre, gameData.platform, gameData.github, gameData.tags, publish_date, gameData.languages_and_tools], function (err, result, fields) {
        if (err) reject(err)
        resolve(uuid);
    });
});

let updateGame = (uuid, gameData) => new Promise((resolve, reject) => {
    setDefaultValuesIfEmpty(gameData);
    db.query('UPDATE games SET title = $1, engine = $2, description = $3, status = $4, genre = $5, platform = $6, github = $7, tags = $8, languages_and_tools = $9 WHERE uuid = $10', [gameData.title, gameData.engine, gameData.description, gameData.status, gameData.genre, gameData.platform, gameData.github, gameData.tags, gameData.languages_and_tools, uuid], function (err, result, fields) {
        if (err) reject(err)
        resolve();
    });
});

module.exports = {
    getGames,
    getGameByUuid,
    getGameByTitle,
    insertGame,
    updateGame
}
