const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

let getValueForPlatformAndName = (platform, name) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM bots_meta_data WHERE platform = $1 AND name = $2', [platform, name], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows[0].value);
        }
    });
});

module.exports = {
    getValueForPlatformAndName
}