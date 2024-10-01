const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

getStreamerByTwitchId = (twitchId) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM streamers WHERE twitch_id = ?', [twitchId], function (err, result, fields) {
        if (err) {
            reject(err)
        } else {
            resolve(result[0]);
        }
    });
});
