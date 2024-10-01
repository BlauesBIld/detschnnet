const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

let insertStreamerConnection = (streamer, platform, access_token, refresh_token) => new Promise((resolve, reject) => {
    db.query('INSERT INTO streamer_connections (streamer, platform, access_token, refresh_token) VALUES ($1, $2, $3, $4)', [streamer, platform, access_token, refresh_token], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result);
        }
    });
});

let updateAccessTokenForStreamer = (streamer, platform, access_token) => new Promise((resolve, reject) => {
    db.query('UPDATE streamer_connections SET access_token = $1 WHERE streamer = $2 AND platform = $3', [access_token, streamer, platform], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result);
        }
    });
});

let updateRefreshTokenForStreamer = (streamer, platform, refresh_token) => new Promise((resolve, reject) => {
    db.query('UPDATE streamer_connections SET refresh_token = $1 WHERE streamer = $2 AND platform = $3', [refresh_token, streamer, platform], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result);
        }
    });
});

let getStreamerConnections = (streamer) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM streamer_connections WHERE streamer = $1', [streamer], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows);
        }
    });
});

let getStreamerConnectionByPlatform = (streamer, platform) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM streamer_connections WHERE streamer = $1 AND platform = $2', [streamer, platform], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

module.exports = {
    insertStreamerConnection,
    getStreamerConnections,
    getStreamerConnectionByPlatform,
    updateAccessTokenForStreamer,
    updateRefreshTokenForStreamer
}