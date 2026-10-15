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

# Older deployments used "detschnet". Stop both exact website session names
# so the previous Node process cannot keep the port and serve stale routes.
while read -r website_session; do
    screen -S "$website_session" -X quit
done < <(screen -ls | awk '$1 ~ /^[0-9]+\.(detschnnet|detschnet)$/ {print $1}' || true)

for attempt in {1..20}; do
    if ! ss -ltnH 'sport = :13061' | grep -q .; then
        break
    fi
    sleep 0.5
done
if ss -ltnH 'sport = :13061' | grep -q .; then
    echo "Website port 13061 is still occupied after stopping the website sessions." >&2
    ss -ltnp 'sport = :13061' >&2
    exit 1
fi

mkdir -p logs
screen -dmS detschnnet bash -c 'cd /home/detschn/website/detschnnet && exec node app.js >> logs/website-startup.log 2>&1'

# This route must reject an anonymous visitor with 401. A 404 means stale code;
# checking the session alone would miss a Node startup or port-binding failure.
website_ready=false
for attempt in {1..20}; do
    website_status=$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' \
        http://127.0.0.1:13061/streamer/login-access || true)
    if [ "$website_status" = 401 ]; then
        website_ready=true
        break
    fi
    sleep 0.5
done
if [ "$website_ready" != true ]; then
    echo "Website failed its login-access route check (HTTP $website_status). See $site_dir/logs/website-startup.log." >&2
    exit 1
fi

screen -S beeri -X quit >/dev/null 2>&1 || true
screen -dmS beeri bash -c 'cd /home/detschn/website/detschnnet/bot && exec .venv/bin/python app.py'

sleep 2
if ! screen -ls | grep -q '[.]beeri[[:space:]]'; then
    echo "BeeriBot exited after startup. Check bot/.env and run it in the foreground for details." >&2
    exit 1
fi

screen -list
