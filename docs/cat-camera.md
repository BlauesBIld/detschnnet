# Admin cat camera

Open `/catcam`, or use **Cat camera** on the logged-in dashboard. All camera
pages, assets, setting changes, stream tickets and WebSocket connections require
an enabled administrator account. This includes the existing owner, detschn.
Permissions come from the database, not role claims in an old login token.

The home server connects to the Tapo camera over RTSP. A local go2rtc process
converts that video to fragmented MP4; the website forwards it over an authenticated,
same-origin WebSocket. Remote viewing uses the website's existing HTTPS port.
There is no need for a cloud subscription or camera port forwarding.

## 1. Prepare the camera

1. Complete the camera's setup in Tapo on 2.4 GHz Wi-Fi.
2. Open **Camera settings → Advanced settings → Camera Account** and create the
   separate camera username/password. These are not your TP-Link login credentials.
3. Reserve the camera's local IP address in the router. The page accepts private
   IPv4 addresses in 10/8, 172.16/12 or 192.168/16; the server must be able to reach it.
4. Keep the camera powered, Privacy Mode off while viewing, and its siren/light
   alarm off if you don't want it startling your cat.
5. Enable **Motion Detection** in the Tapo app. The server listens to the camera's
   ONVIF events on local port 2020, using the same separate Camera Account.

## 2. Run go2rtc on the home server

Install a current stable binary matching the server's architecture from the
[official go2rtc releases](https://github.com/AlexxIT/go2rtc/releases).
The existing deployment script uses a Linux server; configure a persistent service
for go2rtc using your normal service manager, under an unprivileged user.

Create a `go2rtc.yaml` in its working directory:

```yaml
api:
  listen: "127.0.0.1:1984"
rtsp:
  listen: ""
webrtc:
  listen: ""
```

Run the binary with `go2rtc -config /absolute/path/to/go2rtc.yaml` and keep it running
across reboots. Start it manually first to check the service. Bind the API to
loopback as shown. **Do not forward port 1984 or proxy the full go2rtc API publicly.**
The API can configure sources and exposes credentials to trusted local callers.
The app creates its own stream aliases as needed; do not put camera passwords in
the YAML file. Dynamic aliases are restored automatically after bridge restarts.

If you use Docker, publish the bridge port on loopback only, e.g.
`127.0.0.1:1984:1984`, and bind go2rtc's API to `:1984` inside the container.
Do not publish its RTSP/WebRTC ports. A website running in a separate container
instead needs a private container network and an appropriate bridge URL.

## 3. Configure the website

Install dependencies with `npm install`. This includes the ONVIF client and an
FFmpeg binary for the server's operating system; no sudo installation is needed.
An existing compatible binary can be selected using `CATCAM_FFMPEG_PATH`.
Generate a random 32-byte encryption key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Add it to the website's existing `.env` on the server (never commit the real key):

```dotenv
CATCAM_SETTINGS_KEY=YOUR_64_CHARACTER_HEX_KEY
CATCAM_BRIDGE_URL=http://127.0.0.1:1984
```

Restart the website so it loads the environment and the new routes. Keep a secure
backup of the key with your server secrets. Camera settings are stored using
AES-256-GCM in `data/catcam/settings.enc`, outside public files and excluded from
Git. Back up this encrypted file too. Changing or losing the key makes existing
settings unreadable; restore the matching key, or move the old encrypted file
aside and configure the camera again. Do not copy a production `.env` into chat.

## 4. Allow WebSockets through your HTTPS reverse proxy

The current home server uses Apache. Put the specific WebSocket route before the
existing catch-all website proxy in its HTTPS virtual host:

```apache
ProxyPreserveHost On
ProxyPass /catcam/live http://127.0.0.1:13061/catcam/live upgrade=websocket timeout=90
ProxyPassReverse /catcam/live http://127.0.0.1:13061/catcam/live
ProxyPass / http://127.0.0.1:13061/
ProxyPassReverse / http://127.0.0.1:13061/
```

The normal HTTP proxy carries the motion-event feed, thumbnails and MP4 playback,
including byte-range seeking. Do not cache `/catcam` or its subroutes. The event
feed sends a heartbeat every 15 seconds. The existing Apache setup already has
these routes; motion recording does not need another public port.

For Nginx, add this location inside the existing HTTPS virtual host. Retain your
normal HTTPS setup and existing locations. The website listens on port 13061:

```nginx
location ^~ /catcam/ {
    proxy_pass http://127.0.0.1:13061;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 90s;
    # URLs contain single-use, short-lived stream tickets.
    access_log off;
}
```

Use `nginx -t` before reloading Nginx. Other proxies need equivalent WebSocket
upgrade support and must preserve the browser's Origin and Host. Do not rewrite
Origin to bypass the same-origin check. HTTPS is required for the existing secure
login cookie on remote connections. A CDN must also allow WebSockets and bypass
caching for `/catcam` and `/catcam/*`.

## 5. Save and test

Log in as an enabled admin, open `/catcam`, and enter the camera name, private IP,
RTSP port (normally 554), Camera Account username/password and default quality.
Save, then select **Start live view**. High quality selects Tapo `/stream1`; low
bandwidth selects `/stream2`. Saving settings stops existing viewers so they can
reconnect with the new configuration. Leaving the password blank keeps its saved
value. It is never sent back to the browser.

Video starts muted and offers native audio controls for compatible camera audio.
Unsupported audio tracks are omitted rather than transcoded. This feature does
not provide two-way talk, pan/tilt or Tapo detection configuration.
Use the Tapo app for those functions. Live viewing starts on demand, pauses when
the browser tab is hidden, and reconnects on interruptions. Modern Chrome, Edge
and Firefox support MSE; recent Safari uses ManagedMediaSource (Safari 17.1+ on
iPhone). Older browsers without either API show a compatibility message.

Test with mobile data outside your Wi-Fi and with a non-admin account. Directly
opening `/catcam`, `/catcam/assets/camera.js` or submitting `/catcam/ticket` without
admin access must return 401/403, and an unauthorized WebSocket must fail too.
Tickets expire after 15 seconds, are single use and tied to the login cookie.
The database role is rechecked at WebSocket connection and every 15 seconds while
streaming (checks time out closed after eight seconds if the database is unavailable).
Streams also renew their connection after 30 minutes, obtaining fresh authorization.
Up to 12 streams can be active at a time; this is intended for a few private viewers.

If playback fails, check camera power/Privacy Mode, its IP and Camera Account,
go2rtc availability, and proxy upgrade headers. Do not log camera request bodies
or the bridge's stream-registration query strings: these contain credentials.
No camera password or raw bridge error is returned to a viewer. A saved-settings
confirmation confirms storage only; actual camera connectivity is tested by
starting live view.

## 6. Motion alerts and recordings

Motion monitoring and recording default to **Enabled** in Connection settings.
The website process continuously maintains a short, private video buffer, using
the high-quality stream regardless of the live-view quality selection. The page's
monitoring panel shows connection and buffer status. Allow about 10 seconds for
the pre-event buffer to warm after startup or a camera-settings change.

Each motion event saves roughly 10 seconds before detection and 20 seconds after
it. Timing follows the camera's video keyframes, so clip boundaries can vary by a
few seconds. Further motion extends the clip; continuous activity splits into
clips of roughly two minutes. Interruptions may produce a clip marked **Partial**.
Recordings use browser-playable H.264/AAC MP4 with fast-start metadata, thumbnails,
download links and a timeline with clickable red dots at detection times.

Click **Enable desktop alerts** and allow notifications in the browser. Use
**Test alert** to verify the PC can display them. This preference is specific to
the browser. Keep the page open and the PC awake for alerts; browser restrictions
and Windows Do Not Disturb can suppress them. Camera motion is not specific to
cats and can also include people, other animals or environmental movement.
Recording continues on the server without an open page. A recording failure does
not stop motion alerts while the camera's event connection is available.

Unflagged clips expire **72 hours after their first motion event**. The server
removes expired video, thumbnail and catalog data at startup and at least once a
minute while running. **Flag to keep** preserves a clip until unflagged. Removing
the flag from an already-old clip makes it expire immediately; the next cleanup
removes its files. Flags survive website restarts. The **Flagged** filter lists
preserved recordings.

Files live outside public assets in `data/catcam/recordings/`; the short rolling
buffer lives in `data/catcam/buffer/`. Both are excluded from Git. All clip lists,
videos, thumbnails, flags, status and event streams require enabled admin access.
Flag requests also require the page's session CSRF token. Admin access is
rechecked every 15 seconds for an open event feed.

Keep the website and go2rtc running continuously. Recording pauses if less than
512 MB of disk space remains, and retries automatically; flagged clips are never
deleted to reclaim space. The monitoring panel reports camera, recording and
storage problems without exposing connection credentials.

## 7. Discord alerts

On the admin camera page, expand **Discord alerts**, paste a Discord incoming
webhook URL, select **Enabled**, and save. Create the webhook in the destination
Discord channel's **Integrations → Webhooks** settings. Use **Send test message**
after saving to check delivery. The channel receives “Motion detected on camera,
please check” with a JPEG screenshot from the motion event and a link to the admin
camera page. Video, camera IP and camera credentials are not included. Discord messages continue when the browser
is closed, while the website's motion monitoring is enabled.

The screenshot is extracted from the buffered video at the event's timestamp,
resized to at most 1280 pixels wide, and uploaded directly as a Discord attachment.
The server waits a few seconds for the relevant video segment to close, rather
than waiting for the full clip. If a screenshot is unavailable (for example during
startup or a camera outage), the text alert is still sent and says so. The
message cooldown also prevents unnecessary screenshot processing. Tests include
a current screenshot when the recording buffer is available. The page reports
whether the last successful message had a screenshot.

Screenshots sent to Discord are accessible in the webhook's destination channel.
The website's three-day cleanup applies to local recordings, not Discord uploads.

The default message cooldown is 60 seconds, adjustable from 15 to 3600 seconds.
Repeated active-state events do not create more messages. Motion that restarts
during the cooldown still records video normally, but does not send another
Discord message. Tests share the cooldown. Failed requests are not queued or
retried, so there is no delayed message flood; a later motion event can try again.
Discord rate-limit responses can extend the waiting period. The page reports the
last delivery time or a short delivery error.

The webhook URL contains a secret token and is encrypted with the camera settings.
It is never displayed after saving. A blank URL keeps the saved webhook; the
removal checkbox clears it and disables Discord alerts. Discord settings can be
changed without disconnecting live viewers or restarting the recorder. Only
standard HTTPS Discord incoming webhook URLs are accepted, and redirects are
blocked. Saving and testing require admin access and the page's CSRF token.

All motion remains eligible for recording and alerts. The C500's person detection
does not make non-person motion a reliable cat classification. For a lost-cat
search, keep all-motion coverage; any future classifier should initially add
labels for review rather than suppress recordings or alerts.

References: [TP-Link RTSP setup](https://www.tp-link.com/us/support/faq/2680/),
[go2rtc](https://github.com/AlexxIT/go2rtc),
[go2rtc WebSocket protocol](https://github.com/AlexxIT/go2rtc/blob/master/internal/api/ws/README.md).
