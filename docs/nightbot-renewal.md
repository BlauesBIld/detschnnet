# Nightbot authorization renewal

The application checks all saved Nightbot connections at startup and once a day.
It refreshes tokens with less than two days remaining, even without reward redemptions.
Message sends also check expiry, and retry once after a 401 with refreshed credentials.
Other failures are logged without retrying the chat message.

On first use, the application adds the nullable `nightbot_expires_at TIMESTAMPTZ`
column to `streamer_connections` with `ADD COLUMN IF NOT EXISTS`. The database
application role must own that table (or a database administrator must add this
column before deployment). Existing connections are renewed once to establish
their expiry. No credentials need to be copied or manually edited.

Both tokens and their expiry are saved in one database statement. A PostgreSQL
transaction advisory lock per streamer coordinates background jobs, redemptions,
and authorization callbacks across server processes. Token endpoint requests
have a 15-second timeout. Tokens and authorization codes are not included in
Nightbot-specific logs.

Deploy the updated application and restart it to activate renewal. The application
must remain running for background checks. Nightbot documents 30-day access
tokens and 60-day refresh tokens: https://api-docs.nightbot.tv/#refreshing-tokens
If a refresh token has already expired or been revoked, the streamer must reconnect
Nightbot once on the streamer page. A server outage lasting past refresh-token
expiry also requires reconnection. A failed database commit after Nightbot has
issued replacement tokens can require reconnection because provider rotation
and the local transaction cannot be committed atomically.

Run `npm test` for isolated controller, persistence, concurrency and scheduler
regressions. Tests mock PostgreSQL and HTTP; they never use live credentials or
send messages to Twitch.
