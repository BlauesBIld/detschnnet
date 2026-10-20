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

Install dependencies with `npm install`. Generate a random 32-byte encryption key:

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
not provide two-way talk, pan/tilt, recording or Tapo detection configuration.
Use the Tapo app for those functions. Viewing only starts on demand, pauses when
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

References: [TP-Link RTSP setup](https://www.tp-link.com/us/support/faq/2680/),
[go2rtc](https://github.com/AlexxIT/go2rtc),
[go2rtc WebSocket protocol](https://github.com/AlexxIT/go2rtc/blob/master/internal/api/ws/README.md).
