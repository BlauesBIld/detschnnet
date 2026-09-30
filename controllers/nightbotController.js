const botsMetaDataModel = require('../models/botsMetaDataModel');
const connections = require('../models/nightbotConnectionsModel');

const REFRESH_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

async function getCredentials() {
    const [client_id, client_secret, redirect_uri] = await Promise.all(
        ['client_id', 'client_secret', 'redirect_uri'].map(name =>
            botsMetaDataModel.getValueForPlatformAndName('nightbot', name))
    );
    return {client_id, client_secret, redirect_uri};
}

async function requestTokens(streamer, grant, credentials) {
    const response = await fetch('https://api.nightbot.tv/oauth2/token', {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        body: new URLSearchParams({...credentials, ...grant}).toString()
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) {
        const guidance = body?.error === 'invalid_grant'
            ? ' The grant is expired or revoked; reconnect Nightbot on the streamer page.'
            : '';
        // Never include the token response or submitted credentials in logs/errors.
        throw new Error(`Nightbot token request failed for ${streamer} (HTTP ${response.status}).${guidance}`);
    }
    if (typeof body.access_token !== 'string' || !body.access_token ||
        typeof body.refresh_token !== 'string' || !body.refresh_token ||
        !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
        throw new Error(`Nightbot returned incomplete tokens for ${streamer}; existing credentials were preserved`);
    }
    return body;
}

function needsRefresh(connection) {
    const expiresAt = new Date(connection.nightbot_expires_at).getTime();
    return !connection.access_token || !connection.nightbot_expires_at ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() + REFRESH_MARGIN_MS;
}

async function getAccessToken(streamer, {force = false, rejectedAccessToken} = {}) {
    // Load metadata before reserving a transaction client to avoid pool starvation under load.
    const credentials = await getCredentials();
    return connections.withLockedConnection(streamer, async (connection, save) => {
        if (!connection) {
            throw new Error(`No Nightbot connection for ${streamer}; reconnect Nightbot on the streamer page`);
        }
        // Another redemption or the background job may already have replaced the rejected token.
        const rejectedCurrentToken = rejectedAccessToken !== undefined &&
            connection.access_token === rejectedAccessToken;
        if (!force && !rejectedCurrentToken && !needsRefresh(connection)) {
            return connection.access_token;
        }
        if (!connection.refresh_token) {
            throw new Error(`No Nightbot refresh token for ${streamer}; reconnect Nightbot on the streamer page`);
        }
        const tokens = await requestTokens(streamer, {
            grant_type: 'refresh_token', refresh_token: connection.refresh_token
        }, credentials);
        await save(tokens);
        return tokens.access_token;
    });
}

async function refreshAccessToken(streamer) {
    return getAccessToken(streamer, {force: true});
}

async function sendMessageInChannel(streamer, message) {
    let accessToken = await getAccessToken(streamer);
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('https://api.nightbot.tv/1/channel/send', {
            method: 'POST',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({message})
        });
        if (response.status === 401 && attempt === 0) {
            await response.text();
            accessToken = await getAccessToken(streamer, {rejectedAccessToken: accessToken});
            continue;
        }
        if (!response.ok) {
            await response.text();
            throw new Error(`Failed to send Nightbot message for ${streamer}: HTTP ${response.status}`);
        }
        return response.json();
    }
}

async function renewExpiringConnections() {
    const streamers = await connections.getStreamers();
    for (const streamer of streamers) {
        try {
            await getAccessToken(streamer);
        } catch (error) {
            // One disconnected account must not prevent other accounts from renewing.
            console.error(`Nightbot background renewal failed for ${streamer}: ${error.message}`);
        }
    }
}

async function getAndSaveTokensForStreamer(streamer, code) {
    if (typeof code !== 'string' || !code) {
        throw new Error('A Nightbot authorization code is required');
    }
    const credentials = await getCredentials();
    return connections.withLockedConnection(streamer, async (connection, save) => {
        const tokens = await requestTokens(streamer, {grant_type: 'authorization_code', code}, credentials);
        await save(tokens);
        return tokens;
    });
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
    renewExpiringConnections,
    getAndSaveTokensForStreamer,
    getNightBotLinkToAuthorize
}
