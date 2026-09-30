# BeeriBot

The bot is deployed with detschnnet but runs in its own Python process inside the beeri screen session.

Before the first deployment, create /home/detschn/website/detschnnet/bot/.env on the server with DISCORD_TOKEN and CHANNEL_ID (see .env.example). Keep this file out of Git. The server needs Python 3.10 or newer, python3-venv, and screen.

If an existing bot has reminders, copy its scheduled.json to /home/detschn/website/detschnnet/bot/scheduled.json before starting this instance. This file is ignored by Git and survives future pulls. Stop the old bot before the new one starts so both do not respond at once.

A push to main uploads deploy-script.sh and runs it on the server. The script pulls the repository, installs Python dependencies into bot/.venv, and restarts the detschnnet and beeri screen sessions. Use screen -r beeri on the server to view the bot.

Use `/timedreminder interval:15d start_in:2h12m message:...` to send the first reminder in 2 hours and 12 minutes, then every 15 days. Omit `start_in` to send the first reminder immediately. The message is optional and defaults to "Timed reminder". Durations use `s`, `m`, `h`, `d`, or `w`, including combinations such as `1h30m`. Use `/listtimedreminder` to see your reminders and their next send times in the current channel, then `/deletetimedreminder index:1` to stop one. Timed reminders are saved in `scheduled.json` and resume after a restart. If the bot was offline for a scheduled send, it sends once on startup and continues on the original interval.
