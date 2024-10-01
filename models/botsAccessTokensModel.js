const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

let insertAccessTokenForPlatform = (platform, access_token) => new Promise((resolve, reject) => {
    db.query('INSERT INTO bots_access_tokens (platform, access_token) VALUES ($1, $2)', [platform, access_token], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result);
        }
    });
});

let getAccessTokenForPlatform = (platform) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM bots_access_tokens WHERE platform = $1', [platform], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

let updateAccessTokenForPlatform = (platform, access_token) => new Promise((resolve, reject) => {
    db.query('UPDATE bots_access_tokens SET access_token = $1 WHERE platform = $2', [access_token, platform], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result);
        }
    });
});

module.exports = {
    insertAccessTokenForPlatform,
    getAccessTokenForPlatform,
    updateAccessTokenForPlatform
}