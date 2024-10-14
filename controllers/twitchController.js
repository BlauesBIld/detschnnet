require('dotenv').config();
const path = require('path');
const querystring = require("querystring");
const crypto = require("crypto");
const botsMetaDataModel = require("../models/botsMetaDataModel");
const botsAccessTokensModel = require("../models/botsAccessTokensModel");
const streamerConnectionsModel = require("../models/streamerConnectionsModel");

async function getUsersInChat(streamer) {
    try {
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'twitch');
        if (!connection) {
            throw new Error(`No Twitch connection for ${streamer}`);
        }

        const broadcaster_id = '138907996';
        const moderator_id = '138907996';

        const response = await fetch(`https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcaster_id}&moderator_id=${moderator_id}`, {
            method: 'GET',
            mode: "cors",
            headers: {
                'Client-ID': connection.client_id,
                'Authorization': `Bearer ${connection.access_token}`,
                'Content-Type': 'application/json'
            }
        });

        return response;
    } catch (error) {
        console.error(`Error getting users in chat for ${streamer}:`, error);
        throw error; // Or handle it as needed
    }
}


async function refreshUserAccessToken(streamer) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_secret');
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'twitch');

        if (!connection || !connection.refresh_token) {
            throw new Error(`No Twitch refresh token available for ${streamer}`);
        }

        let params = {
            client_id,
            client_secret,
            grant_type: 'refresh_token',
            refresh_token: connection.refresh_token
        };

        let formBody = Object.keys(params).map(key => encodeURIComponent(key) + "=" + encodeURIComponent(params[key])).join("&");

        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: formBody
        });

        const body = await response.json();

        if (!response.ok) {
            throw new Error(`Failed to refresh Twitch access token for ${streamer}: ${body.error} - ${body.message}`);
        }

        console.log("Setting new Twitch access token...");
        console.log(body);

        await streamerConnectionsModel.updateAccessTokenForStreamer(streamer, 'twitch', body.access_token);
        if (body.refresh_token) {
            await streamerConnectionsModel.updateRefreshTokenForStreamer(streamer, 'twitch', body.refresh_token);
        }

        return {access_token: body.access_token, refresh_token: body.refresh_token};
    } catch (error) {
        console.error(`Error refreshing Twitch access token for ${streamer}:`, error);
        throw error;
    }
}


async function banUser(streamer, user_id) {
    try {
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'twitch');
        if (!connection) {
            throw new Error(`No Twitch connection for ${streamer}`);
        }

        const client_id = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_id');

        console.log(`Banning user with id: ${user_id}`);
        const body = JSON.stringify({
            data: {
                user_id: `${user_id}`,
            }
        });

        console.log(body);

        const broadcaster_id = '138907996';
        const moderator_id = '138907996';

        const response = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcaster_id}&moderator_id=${moderator_id}`, {
            method: 'POST',
            mode: "cors",
            headers: {
                'Authorization': `Bearer ${connection.access_token}`,
                'Client-Id': client_id,
                'Content-Type': 'application/json'
            },
            body: body
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Failed to ban user ${user_id} for ${streamer}: ${response.status} ${errorBody}`);
        }

        const data = await response.json();
        console.log(`User ${user_id} banned successfully for ${streamer}:`, data);
        return data;
    } catch (error) {
        console.error(`Error banning user ${user_id} for ${streamer}:`, error);
        throw error;
    }
}


async function saveTokensForStreamer(streamer, access_token, refresh_token) {
    try {
        console.log(`Saving Twitch tokens for ${streamer}...`);
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'twitch');

        console.log(`Connection: ${connection}`);

        if (connection !== undefined) {
            await streamerConnectionsModel.updateAccessTokenForStreamer(streamer, 'twitch', access_token);
            await streamerConnectionsModel.updateRefreshTokenForStreamer(streamer, 'twitch', refresh_token);
            console.log(`Twitch tokens updated for ${streamer}.`);
        } else {
            await streamerConnectionsModel.insertStreamerConnection(streamer, 'twitch', access_token, refresh_token);
            console.log(`Twitch connection created for ${streamer}.`);
        }
    } catch (error) {
        console.error(`Error saving Twitch tokens for ${streamer}:`, error);
        throw error;
    }
}

async function getAndSaveTokensForStreamer(streamer, code) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_secret');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'redirect_uri');

        let getCodeBody = {
            client_id,
            client_secret,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirect_uri,
        };

        console.log(getCodeBody);

        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64')
            },
            body: querystring.stringify(getCodeBody)
        });

        const body = await response.json();

        console.log(`Setting new ${streamer} Twitch access and refresh token...`);
        console.log(body);

        await saveTokensForStreamer(streamer, body.access_token, body.refresh_token);

        return body;
    } catch (error) {
        console.error('Error getting and saving tokens for streamer:', error);
        throw error;
    }
}


async function getTwitchLinkToAuthorize() {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_id');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'redirect_uri');
        const scopes = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'scopes');

        const getCodeBody = {
            client_id,
            redirect_uri,
            response_type: 'code',
            scope: scopes
        };

        const params = new URLSearchParams(getCodeBody).toString();
        return `https://id.twitch.tv/oauth2/authorize?${params}`;
    } catch (error) {
        console.error('Failed to generate Twitch authorization link:', error);
        throw error;
    }
}

async function getAndSaveAppAccessToken() {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_secret');

        let params = {
            client_id,
            client_secret,
            grant_type: 'client_credentials'
        };

        let formBody = Object.keys(params).map(key => encodeURIComponent(key) + "=" + encodeURIComponent(params[key])).join("&");

        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: formBody
        });

        const body = await response.json();

        console.log("Setting new Twitch app access token...");
        console.log(body);

        await saveAppAccessTokenForPlatform('twitch', body.access_token);

        return body.access_token;
    } catch (error) {
        console.error('Error getting and saving app access token:', error);
        throw error;
    }
}

async function saveAppAccessTokenForPlatform(platform, access_token) {
    try {
        const currentAppAccessTokenEntry = await botsAccessTokensModel.getAccessTokenForPlatform(platform);
        if (currentAppAccessTokenEntry) {
            await botsAccessTokensModel.updateAccessTokenForPlatform(platform, access_token);
            console.log(`App access token updated for ${platform}.`);
        } else {
            await botsAccessTokensModel.insertAccessTokenForPlatform(platform, access_token);
            console.log(`App access token created for ${platform}.`);
        }
    } catch (error) {
        console.error('Error saving app access token:', error);
        throw error;
    }
}

async function getStreamUpTime(streamerName) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('twitch', 'client_id');
        let appAccessTokenEntry = await botsAccessTokensModel.getAccessTokenForPlatform('twitch');

        if (appAccessTokenEntry === undefined || appAccessTokenEntry === null) {
            await getAndSaveAppAccessToken();
            return getStreamUpTime(streamerName);
        } else {
            const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${streamerName}`, {
                method: 'GET',
                mode: "cors",
                headers: {
                    'Client-ID': client_id,
                    'Authorization': `Bearer ${appAccessTokenEntry.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            const body = await response.json();

            if (body.error && body.status === 401) {
                await getAndSaveAppAccessToken();
                return getStreamUpTime(streamerName);
            }
            return body;
        }
    } catch (error) {
        console.error(`Error getting stream up time for ${streamerName}:`, error);
        throw error;
    }
}

module.exports = {
    getUsersInChat,
    refreshUserAccessToken,
    banUser,
    getAndSaveTokensForStreamer,
    getTwitchLinkToAuthorize,
    getAndSaveAppAccessToken,
    getStreamUpTime
}
