# Temporary gallery uploads

Log in at `/streamer/login` with an existing streamer account, then select **Upload gallery photos** on the dashboard. The page is also available at `/my/gallery/upload`; both the page and its POST handler require a valid `accessToken` JWT cookie. Invalid or expired tokens stop before multipart parsing.

Select up to 50 JPG, PNG or WebP photos (15 MB per file). Each batch is checked before publishing any photo. The server creates an oriented JPEG for the viewer and a small WebP preview, then redirects back to the upload page. Refresh `/my/love.html` to see new photos on the last page. Uploading is protected by a session form token.

The public photo list at `/my/gallery/photos` includes the existing `public/img/gallery/img*.jpg` photos and uploaded files. Original photo IDs remain numeric; upload IDs are generated UUIDs and stay stable across app restarts and subsequent uploads. The map no longer has a fixed 20-photo limit.

Uploads live in `public/img/gallery/uploads/`, with previews in its `thumbs/` subdirectory. These files are ignored by Git and preserved by the existing `git pull` deployment script. Include that directory in server backups; uploads are not stored on GitHub. The photos remain public, just like the existing gallery. The upload page itself is protected.

Set `GALLERY_UPLOAD_ENABLED=false` in the server environment and restart the app to close the temporary upload page and hide its dashboard link. The public gallery and uploaded photos remain available. Remove the flag or set it to `true` to re-enable uploading.

Image processing uses Sharp 0.35 and requires Node.js 20.9 or newer. The dependency is installed by the existing `npm install` deployment step.
