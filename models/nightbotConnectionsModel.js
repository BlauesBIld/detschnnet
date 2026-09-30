const db = require('../services/database').config;

let schemaReady;

function ensureSchema() {
    if (!schemaReady) {
        // Existing connections have no expiry yet and will be refreshed on first use.
        schemaReady = db.query(`ALTER TABLE streamer_connections
            ADD COLUMN IF NOT EXISTS nightbot_expires_at TIMESTAMPTZ`).catch(error => {
            schemaReady = undefined;
            throw error;
        });
    }
    return schemaReady;
}

async function getStreamers() {
    await ensureSchema();
    const result = await db.query("SELECT DISTINCT streamer FROM streamer_connections WHERE platform = 'nightbot'");
    return result.rows.map(row => row.streamer);
}

async function withLockedConnection(streamer, action) {
    if (typeof streamer !== 'string' || !streamer) {
        throw new Error('A streamer is required for Nightbot authorization');
    }
    await ensureSchema();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // Transaction-scoped locking coordinates server processes and OAuth callbacks.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nightbot:${streamer}`]);
        const result = await client.query(
            "SELECT * FROM streamer_connections WHERE streamer = $1 AND platform = 'nightbot'",
            [streamer]
        );
        const connection = result.rows[0];
        const save = async tokens => {
            const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
            if (connection) {
                await client.query(`UPDATE streamer_connections
                    SET access_token = $1, refresh_token = $2, nightbot_expires_at = $3
                    WHERE streamer = $4 AND platform = 'nightbot'`,
                [tokens.access_token, tokens.refresh_token, expiresAt, streamer]);
            } else {
                await client.query(`INSERT INTO streamer_connections
                    (streamer, platform, access_token, refresh_token, nightbot_expires_at)
                    VALUES ($1, 'nightbot', $2, $3, $4)`,
                [streamer, tokens.access_token, tokens.refresh_token, expiresAt]);
            }
            return {...tokens, nightbot_expires_at: expiresAt};
        };
        const value = await action(connection, save);
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {getStreamers, withLockedConnection};
