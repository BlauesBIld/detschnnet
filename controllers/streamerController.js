require('dotenv').config();
const path = require('path');
const querystring = require("querystring");
const crypto = require("crypto");
const botsMetaDataModel = require("../models/botsMetaDataModel");
const streamerConnectionsModel = require("../models/streamerConnectionsModel");

async function getTokensForStreamer(streamer) {
    return await streamerConnectionsModel.getStreamerConnections(streamer);
}

module.exports = {
    getTokensForStreamer
}