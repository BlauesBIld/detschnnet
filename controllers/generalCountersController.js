const generalCountersModel = require("../models/generalCountersModel");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

getCountersForStreamer = (streamer) => new Promise((resolve, reject) => {
    generalCountersModel.getCountersForStreamer(streamer)
        .then((counters) => {
            resolve(counters);
        }).catch((err) => {
        reject(err);
    });
});

getSingleCounterForStreamer = (streamer, counter) => new Promise((resolve, reject) => {
    generalCountersModel.getSingleCounterForStreamer(streamer, counter)
        .then((counter) => {
            resolve(counter);
        }).catch((err) => {
        reject(err);
    });
});

addToCounterForStreamer = (streamer, counter, amount) => new Promise((resolve, reject) => {
    generalCountersModel.addToCounterForStreamer(streamer, counter, amount)
        .then((counter) => {
            resolve(counter);
        }).catch((err) => {
        reject(err);
    });
});

module.exports = {
    getCountersForStreamer,
    getSingleCounterForStreamer,
    addToCounterForStreamer
}