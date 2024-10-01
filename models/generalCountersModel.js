const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

getCountersForStreamer = (streamer) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM general_counters WHERE streamer = $1', [streamer], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows);
        }
    });
});

getSingleCounterForStreamer = (streamer, counter) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM general_counters WHERE streamer = $1 AND name = $2', [streamer, counter], function (err, result, fields) {
        if (err) {
            console.log(err)
            reject(err)
        } else {
            resolve(result.rows[0]);
        }
    });
});

addToCounterForStreamer = (streamer, counterName, amount) => new Promise((resolve, reject) => {
    const query = 'UPDATE general_counters SET value = value + $1 WHERE streamer = $2 AND name = $3 RETURNING *';

    db.query(query, [amount, streamer, counterName], function (err, result) {
        if (err) {
            console.log(err);
            reject(err);
        } else {
            resolve(result.rows[0]);
        }
    });
});

module.exports = {
    getCountersForStreamer,
    getSingleCounterForStreamer,
    addToCounterForStreamer
}
