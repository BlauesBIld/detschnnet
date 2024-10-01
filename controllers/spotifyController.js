require('dotenv').config();
const path = require('path');
const querystring = require("querystring");
const crypto = require("crypto");
const botsMetaDataModel = require("../models/botsMetaDataModel");
const streamerConnectionsModel = require("../models/streamerConnectionsModel");

async function saveTokensForStreamer(streamer, access_token, refresh_token) {
    try {
        console.log(`Saving Spotify tokens for ${streamer}...`);
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'spotify');

        console.log(`Connection: ${connection}`);

        if (connection !== undefined) {
            await streamerConnectionsModel.updateAccessTokenForStreamer(streamer, 'spotify', access_token);
            await streamerConnectionsModel.updateRefreshTokenForStreamer(streamer, 'spotify', refresh_token);
            console.log(`Spotify tokens updated for ${streamer}.`);
        } else {
            await streamerConnectionsModel.insertStreamerConnection(streamer, 'spotify', access_token, refresh_token);
            console.log(`Spotify connection created for ${streamer}.`);
        }
    } catch (error) {
        console.error(`Error saving Spotify tokens for ${streamer}:`, error);
        throw error;
    }
}


async function getAndSaveTokensForStreamer(streamer, code) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'client_secret');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'redirect_uri');

        let getCodeBody = {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: "http://localhost:3000/spotify/saveConnection",
        };

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            },
            body: querystring.stringify(getCodeBody)
        });

        const body = await response.json();

        console.log("Setting new access and refresh token...");
        console.log(body);

        await saveTokensForStreamer(streamer, body.access_token, body.refresh_token);

        return body;
    } catch (error) {
        console.error('Error getting and saving tokens:', error);
        throw error;
    }
}


async function getCurrentSongTitle(streamer) {
    try {
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'spotify');
        if (connection === undefined) {
            throw new Error(`No Spotify connection for ${streamer}`);
        }

        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            method: 'GET',
            mode: "cors",
            headers: {
                'Authorization': 'Bearer ' + connection.access_token,
            },
        });
        console.log("Response: " + response);
        console.log("Status: " + response.status);
        if(response.status === 204) {
            return response;
        }
        const body = await response.json();
        console.log("Body: " + body);

        if(body.error && body.error.status === 401) {
            await refreshAccessToken(streamer);
            return getCurrentSongTitle(streamer);
        }
        return body;
    } catch (error) {
        console.error(`Error fetching current song for ${streamer}:`, error);
        throw error;
    }
}


generateNewCodeChallenge = () => {
    botsMetaDataModel.getValueForPlatformAndName('spotify', 'verifier').then(verifier => {
        const crypto = require('crypto');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64');
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        crypto.subtle.digest('SHA-256', data).then(digest => {
            console.log(digest);
            console.log(base64encode(digest));
        });
        return challenge;
    });
}

function base64encode(string) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(string)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function refreshAccessToken(streamer) {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'client_id');
        const client_secret = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'client_secret');
        const connection = await streamerConnectionsModel.getStreamerConnectionByPlatform(streamer, 'spotify');

        if (!connection || !connection.refresh_token) {
            throw new Error(`No Spotify refresh token available for ${streamer}`);
        }

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            mode: "cors",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64'),
            },
            body: querystring.stringify({
                grant_type: 'refresh_token',
                refresh_token: connection.refresh_token,
            }),
        });

        const body = await response.json();

        if (body.access_token) {
            console.log(`Spotify Access Token for ${streamer} refreshed.`);
            console.log(body);
            await streamerConnectionsModel.updateAccessTokenForStreamer(streamer, 'spotify', body.access_token);
            return body.access_token;
        } else {
            throw new Error(`Failed to refresh Spotify access token for ${streamer}`);
        }
    } catch (error) {
        console.error(`Error refreshing Spotify access token for ${streamer}:`, error);
        throw error;
    }
}


async function getSpotifyLinkToAuthorize() {
    try {
        const client_id = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'client_id');
        const redirect_uri = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'redirect_uri');
        const scopes = await botsMetaDataModel.getValueForPlatformAndName('spotify', 'scopes');

        const params = new URLSearchParams({
            response_type: 'code',
            client_id,
            redirect_uri,
            scope: scopes,
        }).toString();

        return `https://accounts.spotify.com/authorize?${params}`;
    } catch (error) {
        console.error('Failed to generate Spotify authorization link:', error);
        throw error;
    }
}

module.exports = {
    getAndSaveTokensForStreamer,
    getCurrentSongTitle,
    refreshAccessToken,
    getSpotifyLinkToAuthorize
}