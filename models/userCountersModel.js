const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

getCountersForUserByStreamer = (username, streamer) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM user_counters WHERE username = $1 AND streamer = $2', [username, streamer], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows);
        }
    });
});

getSingleCounterForUserByStreamer = (username, streamer, counter) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM user_counters WHERE username = $1 AND streamer = $2 AND name = $3', [username, streamer, counter], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

addAmountToUserCounter = (username, streamer, counterName, amount) => new Promise((resolve, reject) => {
    const query = 'UPDATE user_counters SET value = value + $1 WHERE username = $2 AND streamer = $3 AND name = $4 RETURNING *';

    db.query(query, [amount, username, streamer, counterName], function (err, result) {
        if (err) {
            console.log(err);
            reject(err);
        } else {
            resolve(result.rows[0]);
        }
    });
});

getDistinctUserCountersForStreamer = (streamer) => new Promise((resolve, reject) => {
    db.query('SELECT DISTINCT name FROM user_counters WHERE streamer = $1', [streamer], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows);
        }
    });
});

addNewUserCounter = (username, streamer, counter) => new Promise((resolve, reject) => {
    db.query('INSERT INTO user_counters (username, streamer, name, value) VALUES ($1, $2, $3, 0) RETURNING *', [username, streamer, counter], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

module.exports = {
    getCountersForUserByStreamer,
    getSingleCounterForUserByStreamer,
    addAmountToUserCounter,
    getDistinctUserCountersForStreamer,
    addNewUserCounter
}