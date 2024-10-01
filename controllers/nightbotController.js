require('dotenv').config();
const path = require('path');
const querystring = require("querystring");
const botsMetaDataModel = require("../models/botsMetaDataModel");
const streamerConnectionsModel = require("../models/streamerConnectionsModel");
let {getSpotifyLinkToAuthorize} = require("./spotifyController");

async function sendMessageInChannel(streamer, message) {
    try {
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'nightbot');
        if (!connection) {
            throw new Error(`No Nightbot connection for ${streamer}`);
        }

        const response = await fetch('https://api.nightbot.tv/1/channel/send', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${connection.access_token}`,
            },
            body: JSON.stringify({
                'message': message
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Failed to send message for ${streamer}: ${response.status} ${errorBody}`);
        }

        const data = await response.json();
        console.log(`Message sent successfully for ${streamer}:`, data);
        return data;
    } catch (error) {
        console.error(`Error sending message for ${streamer}:`, error);
        throw error;
    }
}


async function refreshAccessToken(streamer) {
    try {
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'nightbot');
        if (!connection) {
            throw new Error(`No Nightbot connection for ${streamer}`);
        }

        const client_id = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'client_secret');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'redirect_uri');

        let params = {
            client_id,
            client_secret,
            grant_type: 'refresh_token',
            redirect_uri,
            refresh_token: connection.refresh_token
        };

        let formBody = Object.keys(params).map(key => {
            let encodedKey = encodeURIComponent(key);
            let encodedValue = encodeURIComponent(params[key]);
            return `${encodedKey}=${encodedValue}`;
        }).join("&");

        const response = await fetch('https://api.nightbot.tv/oauth2/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: formBody
        });

        const body = await response.json();

        if (body.error) {
            throw new Error(`Failed to refresh Nightbot access token for ${streamer}: ${body.error_description}`);
        }

        console.log("Setting new Nightbot access token...");
        console.log(body);

        await saveTokensForStreamer(streamer, body.access_token, body.refresh_token);
    } catch (error) {
        console.error(`Error refreshing Nightbot access token for ${streamer}:`, error);
        throw error;
    }
}

async function saveTokensForStreamer(streamer, access_token, refresh_token) {
    try {
        console.log(`Saving Nightbot tokens for ${streamer}...`);
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'nightbot');

        if (connection) {
            await streamerConnectionsModel.updateAccessTokenForStreamer(streamer, 'nightbot', access_token);
            await streamerConnectionsModel.updateRefreshTokenForStreamer(streamer, 'nightbot', refresh_token);
            console.log(`Nightbot tokens updated for ${streamer}.`);
        } else {
            await streamerConnectionsModel.insertStreamerConnection(streamer, 'nightbot', access_token, refresh_token);
            console.log(`Nightbot connection created for ${streamer}.`);
        }
    } catch (error) {
        console.error(`Error saving Nightbot tokens for ${streamer}:`, error);
        // Handle the error as needed, possibly rethrow or manage it based on your application's needs
        throw error;
    }
}


async function getAndSaveTokensForStreamer(streamer, code) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'client_secret');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'redirect_uri');

        let getCodeBody = {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirect_uri,
        };

        const response = await fetch('https://api.nightbot.tv/oauth2/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            },
            body: querystring.stringify(getCodeBody)
        });

        const body = await response.json();

        console.log(`Setting new ${streamer} nightbot access and refresh token...`);
        console.log(body);

        await saveTokensForStreamer(streamer, body.access_token, body.refresh_token);

        return body;
    } catch (error) {
        console.error('Error getting and saving tokens for streamer:', error);
        throw error;
    }
}

async function getNightBotLinkToAuthorize(streamer) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'client_id');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'redirect_uri');
        const scope = await botsMetaDataModel.getValueForPlatformAndName('nightbot', 'scopes');

        const getCodeBody = {
            client_id,
            response_type: 'code',
            redirect_uri,
            scope,
        };

        const params = new URLSearchParams(getCodeBody).toString();
        return `https://api.nightbot.tv/oauth2/authorize?${params}`;
    } catch (error) {
        console.error('Failed to generate NightBot authorization link:', error);
        throw error;
    }
}

module.exports = {
    sendMessageInChannel,
    refreshAccessToken,
    getAndSaveTokensForStreamer,
    getNightBotLinkToAuthorize
}