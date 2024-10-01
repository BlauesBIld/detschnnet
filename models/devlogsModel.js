const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');


let getDevlogs = () => new Promise((resolve, reject) => {
    db.query('SELECT * FROM devlogs', function (err, result, fields) {
        if (err) reject(err);
        resolve(result.rows);
    });
});

let getDevlogByUuid = (uuid) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM devlogs WHERE uuid = $1', [uuid], function (err, result, fields) {
        if (err) reject(err);
        resolve(result.rows[0]);
    });
});

let getDevlogsByGame = (game_uuid) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM devlogs WHERE game_uuid = $1', [game_uuid], function (err, result, fields) {
        if (err) reject(err);
        resolve(result.rows);
    });
});

let insertDevlog = (title, content, author) => new Promise((resolve, reject) => {
    let new_uuid = uuidv4();
    db.query('INSERT INTO devlogs (uuid, game_uuid, creation_timestamp, title, description, tags, image_name) VALUES ($1, $2, $3, $4, $5, $6, $7)', [new_uuid, game_uuid, creation_timestamp, title, content, tags, image_name], function (err, result, fields) {
        if (err) reject(err)
        resolve(new_uuid);
    });
});

module.exports = {
    getDevlogs,
    getDevlogByUuid,
    getDevlogsByGame,
    insertDevlog
}