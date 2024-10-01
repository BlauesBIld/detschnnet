const userCountersModel = require('../models/userCountersModel');
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

getCountersForUserByStreamer = (username, streamer) => new Promise((resolve, reject) => {
    userCountersModel.getCountersForUserByStreamer(username, streamer)
        .then((counters) => {
            userCountersModel.getDistinctUserCountersForStreamer(streamer).then((distinctCounters) => {
                let emptyUserCounter = []
                distinctCounters.forEach((counter) => {
                    if (counters.find(c => c.name === counter.name)) {
                        emptyUserCounter.push(counters.find(c => c.name === counter.name))
                    } else {
                        emptyUserCounter.push({
                            username: username,
                            streamer: streamer,
                            name: counter.name,
                            value: 0
                        })
                    }
                });
                resolve(emptyUserCounter);
            });
        }).catch((err) => {
        reject(err);
    });
});

addAmountToUserCounter = (username, streamer, counter, amount) => new Promise((resolve, reject) => {
    userCountersModel.addAmountToUserCounter(username, streamer, counter, amount)
        .then((counter) => {
            resolve(counter);
        }).catch((err) => {
        reject(err);
    });
});

getSingleUserCounterForUserByStreamer = (username, streamer, counter) => new Promise((resolve, reject) => {
    userCountersModel.getSingleCounterForUserByStreamer(username, streamer, counter)
        .then((counter) => {
            resolve(counter);
        }).catch((err) => {
        reject(err);
    });
});

addNewUserCounter = (username, streamer, counter) => new Promise((resolve, reject) => {
    userCountersModel.addNewUserCounter(username, streamer, counter)
        .then((counter) => {
            resolve(counter);
        }).catch((err) => {
        reject(err);
    });
});

module.exports = {
    getCountersForUserByStreamer,
    addAmountToUserCounter,
    getSingleUserCounterForUserByStreamer,
    addNewUserCounter
}
