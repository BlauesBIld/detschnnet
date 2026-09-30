#!/usr/bin/env bash
set -euo pipefail

. "$HOME/.profile"

eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/id_rsa"

site_dir=/home/detschn/website/detschnnet
cd "$site_dir"

git pull --ff-only origin main
npm install

if [ ! -x bot/.venv/bin/python ]; then
    python3 -m venv bot/.venv
fi
bot/.venv/bin/python -m pip install -r bot/requirements.txt

if [ ! -f bot/.env ]; then
    echo "Missing bot/.env. Add DISCORD_TOKEN and CHANNEL_ID on the server before deploying." >&2
    exit 1
fi

screen -S detschnnet -X quit >/dev/null 2>&1 || true
screen -dmS detschnnet bash -c 'cd /home/detschn/website/detschnnet && exec node app.js'

screen -S beeri -X quit >/dev/null 2>&1 || true
screen -dmS beeri bash -c 'cd /home/detschn/website/detschnnet/bot && exec .venv/bin/python app.py'

sleep 2
if ! screen -ls | grep -q '[.]beeri[[:space:]]'; then
    echo "BeeriBot exited after startup. Check bot/.env and run it in the foreground for details." >&2
    exit 1
fi

screen -list
