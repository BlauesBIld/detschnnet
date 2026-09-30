import asyncio
import re
import discord
from discord import app_commands
from discord.ext import commands
import os
from dotenv import load_dotenv
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import json
import uuid

BOT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BOT_DIR, ".env"))
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
CHANNEL_ID = int(os.getenv("CHANNEL_ID"))
DAILY_QUESTION_TASK: asyncio.Task | None = None
COUPLE_USER_IDS = frozenset({255195754702962688, 218644051770081281})
COUPLE_NOTIFICATION_CHANNEL_ID = 1376964700910391486
COUPLE_VOICE_MESSAGE = (
    "Hello, I can see that both of you just got together in a voice channel! "
    "Why don't you turn on your cameras so you can see each other and be even happier? "
    "I only see a win-win here ❤️😊"
)


intents = discord.Intents.default()
intents.voice_states = True

allowed = discord.AllowedMentions(
    everyone=False,
    roles=False,
    users=True,
    replied_user=True
)

bot = commands.Bot(
    command_prefix="!",
    intents=intents,
    allowed_mentions=allowed
)

STATE_FILE = os.path.join(BOT_DIR, "scheduled.json")
TZ = ZoneInfo("Europe/Vienna")
STATE_LOCK = asyncio.Lock()

DURATION_PATTERN = re.compile(r"(?i)(\d+)\s*([smhdw])")

MULTIPLIER = {
    "s": 1,
    "m": 60,
    "h": 60 * 60,
    "d": 60 * 60 * 24,
    "w": 60 * 60 * 24 * 7,
}

ONE_TIME_REMINDER_TASKS: dict[str, asyncio.Task] = {}
DAILY_TASKS: dict[str, asyncio.Task] = {}
TIMED_REMINDER_TASKS: dict[str, asyncio.Task] = {}

def _empty_state():
    return {"reminders": [], "daily": [], "timed_reminders": []}

def load_state():
    if not os.path.exists(STATE_FILE):
        return _empty_state()
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "reminders" not in data or "daily" not in data:
            return _empty_state()
        data["reminders"] = list(data.get("reminders", []))
        data["daily"] = list(data.get("daily", []))
        data["timed_reminders"] = list(data.get("timed_reminders", []))
        return data
    except Exception:
        return _empty_state()

def next_time_with_increment(current: str, inc: int, limit: str | None, wrap: bool) -> tuple[str, bool]:
    """
    Step 'current' by 'inc' minutes and return (next_hhmm, changed).

    - wrap=False:
        Linear stepping (no wrapping semantics). Clamp to limit only if the next linear step crosses it.
    - wrap=True:
        Circular stepping on a 24h clock. Clamp to limit only if the one-step arc (cur -> nxt) in the
        movement direction contains 'limit'. Otherwise keep the stepped time. Once you land on the limit,
        you stay there (subsequent steps keep clamping).
    """
    if inc == 0:
        return current, False

    day = 24 * 60
    cur = hhmm_to_minutes(current)
    nxt = cur + inc

    if limit is None:
        return minutes_to_hhmm((nxt if wrap else max(min(nxt, day - 1), 0)) % day), True

    limit_m = hhmm_to_minutes(limit)

    if not wrap:
        if inc < 0:
            if nxt <= limit_m:
                nxt = limit_m
        else:
            if nxt >= limit_m:
                nxt = limit_m
        nxt = max(min(nxt, day - 1), 0)
        return minutes_to_hhmm(nxt), True

    cur %= day
    nxt %= day

    def ccw_contains(a: int, b: int, x: int) -> bool:
        """
        Is x on the counter-clockwise arc from a down to b (inclusive of b)?
        a -> ... decreasing ... -> b
        """
        if a >= b:
            return b <= x <= a
        return x <= a or x >= b

    def cw_contains(a: int, b: int, x: int) -> bool:
        """
        Is x on the clockwise arc from a up to b (inclusive of b)?
        a -> ... increasing ... -> b
        """
        if b >= a:
            return a <= x <= b
        return x >= a or x <= b

    if cur == limit_m:
        return minutes_to_hhmm(limit_m), False

    if inc < 0:
        if ccw_contains(cur, nxt, limit_m):
            return minutes_to_hhmm(limit_m), True
        return minutes_to_hhmm(nxt), True
    else:
        if cw_contains(cur, nxt, limit_m):
            return minutes_to_hhmm(limit_m), True
        return minutes_to_hhmm(nxt), True



async def save_state(state):
    async with STATE_LOCK:
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, STATE_FILE)

async def add_reminder_record(channel_id: int, user_id: int, message: str, fire_at_utc: datetime):
    state = load_state()
    rec = {
        "id": str(uuid.uuid4()),
        "channel_id": channel_id,
        "user_id": user_id,
        "message": message,
        "fire_at_utc": fire_at_utc.replace(tzinfo=ZoneInfo("UTC")).isoformat(),
        "created_at_utc": datetime.now(tz=ZoneInfo("UTC")).isoformat(),
        "type": "one_time"
    }
    state["reminders"].append(rec)
    await save_state(state)
    return rec

async def remove_reminder_record(reminder_id: str):
    state = load_state()
    before = len(state["reminders"])
    state["reminders"] = [r for r in state["reminders"] if r.get("id") != reminder_id]
    if len(state["reminders"]) != before:
        await save_state(state)

async def add_daily_record(channel_id: int, user_id: int, message: str, time_str: str,
                           increment_minutes: int = 0, limit_time_str: str | None = None, wrap: bool = False):
    """
    time_str: 'HH:MM' in Europe/Vienna
    increment_minutes: shift by minutes for next day (can be negative)
    limit_time_str: 'HH:MM' clamp time once reached (required if increment_minutes != 0)
    """
    state = load_state()
    rec = {
        "id": str(uuid.uuid4()),
        "channel_id": channel_id,
        "user_id": user_id,
        "message": message,
        "time_str": time_str,
        "timezone": "Europe/Vienna",
        "increment_minutes": int(increment_minutes),
        "limit_time_str": limit_time_str,
        "type": "daily",
        "wrap": bool(wrap),
    }
    state["daily"].append(rec)
    await save_state(state)
    return rec

async def update_daily_time(rec_id: str, new_time_str: str):
    state = load_state()
    for rec in state["daily"]:
        if rec.get("id") == rec_id:
            rec["time_str"] = new_time_str
            break
    await save_state(state)

async def delete_daily_by_index(index_one_based: int) -> bool:
    """Delete daily entry by 1-based index in current state list order. Cancels running task."""
    state = load_state()
    idx = index_one_based - 1
    if idx < 0 or idx >= len(state["daily"]):
        return False
    rec = state["daily"].pop(idx)
    await save_state(state)

    rec_id = rec.get("id")
    task = DAILY_TASKS.get(rec_id)
    if task and not task.done():
        task.cancel()
    DAILY_TASKS.pop(rec_id, None)
    return True

def parse_duration(text: str) -> int | None:
    """
    Supports '30s', '15m', '2h', '10d', '1w', and combos like '1h30m' or '2d4h'.
    Returns total seconds or None if invalid.
    """
    total = 0
    position = 0
    for match in DURATION_PATTERN.finditer(text):
        if text[position:match.start()].strip():
            return None
        try:
            total += int(match.group(1)) * MULTIPLIER[match.group(2).lower()]
        except ValueError:
            return None
        position = match.end()
    return total if position and not text[position:].strip() and total > 0 else None

def parse_hhmm(time_str: str) -> tuple[int, int] | None:
    if not re.fullmatch(r"\d{2}:\d{2}", time_str.strip()):
        return None
    hh = int(time_str[:2])
    mm = int(time_str[3:5])
    if 0 <= hh <= 23 and 0 <= mm <= 59:
        return hh, mm
    return None

def hhmm_to_minutes(time_str: str) -> int:
    hh, mm = parse_hhmm(time_str)
    return hh * 60 + mm

def minutes_to_hhmm(total_minutes: int) -> str:
    total_minutes %= (24 * 60)
    hh = total_minutes // 60
    mm = total_minutes % 60
    return f"{hh:02d}:{mm:02d}"

def clamp_with_increment(current: str, inc: int, limit: str | None) -> tuple[str, bool]:
    """
    Returns (next_time_str, changed) applying increment and clamping to limit edge.
    If inc == 0 or limit is None -> just return current (no change).
    When inc < 0: move earlier daily until <= limit, then clamp to limit.
    When inc > 0: move later daily until >= limit, then clamp to limit.
    """
    if inc == 0 or not limit:
        return current, False
    cur = hhmm_to_minutes(current)
    nxt = cur + inc
    limit_m = hhmm_to_minutes(limit)
    changed = True

    if inc < 0:
        if nxt <= limit_m:
            nxt = limit_m
    else:
        if nxt >= limit_m:
            nxt = limit_m
    return minutes_to_hhmm(nxt), changed

def next_run_at_hhmm(time_str: str, tz: ZoneInfo) -> datetime:
    hhmm = parse_hhmm(time_str)
    if not hhmm:
        raise ValueError("Invalid HH:MM time")
    hour, minute = hhmm
    now_local = datetime.now(tz)
    target_today = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target_today <= now_local:
        target_today += timedelta(days=1)
    return target_today.astimezone(ZoneInfo("UTC"))

async def send_reminder(channel_id: int, user_id: int, message: str):
    channel = bot.get_channel(channel_id)
    if channel is None:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception:
            return
    try:
        await channel.send(f"⏰ <@{user_id}> **Reminder:** {message}", allowed_mentions=allowed)
    except Exception:
        pass

async def schedule_one_time_reminder_task(rec: dict):
    reminder_id = rec["id"]
    try:
        fire_at_utc = datetime.fromisoformat(rec["fire_at_utc"]).replace(tzinfo=ZoneInfo("UTC"))
        now_utc = datetime.now(tz=ZoneInfo("UTC"))
        delay = max(0, (fire_at_utc - now_utc).total_seconds())
        await asyncio.sleep(delay)
        await send_reminder(rec["channel_id"], rec["user_id"], rec["message"])
        await remove_reminder_record(reminder_id)
    finally:
        if ONE_TIME_REMINDER_TASKS.get(reminder_id) is asyncio.current_task():
            ONE_TIME_REMINDER_TASKS.pop(reminder_id, None)

async def ensure_all_one_time_reminders_loaded():
    state = load_state()
    for rec in state["reminders"]:
        rec_id = rec.get("id")
        if not rec_id:
            continue
        task = ONE_TIME_REMINDER_TASKS.get(rec_id)
        if task and not task.done():
            continue
        ONE_TIME_REMINDER_TASKS[rec_id] = asyncio.create_task(schedule_one_time_reminder_task(rec))

async def add_timed_reminder_record(channel_id: int, user_id: int, message: str,
                                    interval_seconds: int, interval_text: str,
                                    first_fire_at_utc: datetime):
    state = load_state()
    rec = {
        "id": str(uuid.uuid4()),
        "channel_id": channel_id,
        "user_id": user_id,
        "message": message,
        "interval_seconds": interval_seconds,
        "interval_text": interval_text,
        "next_fire_at_utc": first_fire_at_utc.isoformat(),
        "type": "timed",
    }
    state["timed_reminders"].append(rec)
    await save_state(state)
    return rec

async def advance_timed_reminder_record(rec_id: str, due_at_utc: datetime,
                                        interval_seconds: int) -> datetime | None:
    """Keep the next send on the original UTC interval, skipping missed sends."""
    state = load_state()
    for rec in state["timed_reminders"]:
        if rec.get("id") == rec_id:
            now_utc = datetime.now(tz=ZoneInfo("UTC"))
            steps = max(1, int((now_utc - due_at_utc).total_seconds() // interval_seconds) + 1)
            next_fire_at_utc = due_at_utc + timedelta(seconds=steps * interval_seconds)
            rec["next_fire_at_utc"] = next_fire_at_utc.isoformat()
            await save_state(state)
            return next_fire_at_utc
    return None

async def schedule_one_timed_reminder_task(rec: dict):
    rec_id = rec["id"]
    interval_seconds = int(rec["interval_seconds"])
    due_at_utc = datetime.fromisoformat(rec["next_fire_at_utc"])
    try:
        while True:
            delay = (due_at_utc - datetime.now(tz=ZoneInfo("UTC"))).total_seconds()
            if delay > 0:
                await asyncio.sleep(min(delay, 3600))
                continue

            next_fire_at_utc = await advance_timed_reminder_record(rec_id, due_at_utc, interval_seconds)
            if next_fire_at_utc is None:
                return
            due_at_utc = next_fire_at_utc
            await send_reminder(rec["channel_id"], rec["user_id"], rec["message"])
    finally:
        if TIMED_REMINDER_TASKS.get(rec_id) is asyncio.current_task():
            TIMED_REMINDER_TASKS.pop(rec_id, None)

async def ensure_all_timed_reminders_loaded():
    state = load_state()
    for rec in state["timed_reminders"]:
        rec_id = rec.get("id")
        if not rec_id:
            continue
        task = TIMED_REMINDER_TASKS.get(rec_id)
        if task and not task.done():
            continue
        TIMED_REMINDER_TASKS[rec_id] = asyncio.create_task(schedule_one_timed_reminder_task(rec))

async def schedule_one_daily_task(rec: dict):
    """
    Wait until next time-of-day in Europe/Vienna, send, then possibly shift for the next day by increment,
    clamped by limit. Persist the new time if it changes, so it survives restarts.
    """
    rec_id = rec["id"]
    time_str = rec["time_str"]
    inc = int(rec.get("increment_minutes", 0))
    limit_time = rec.get("limit_time_str")
    wrap = bool(rec.get("wrap", False))

    try:
        while True:
            next_utc = next_run_at_hhmm(time_str, TZ)
            now_utc = datetime.now(tz=ZoneInfo("UTC"))
            delay = max(0, (next_utc - now_utc).total_seconds())
            await asyncio.sleep(delay)

            await send_reminder(rec["channel_id"], rec["user_id"], rec["message"])

            new_time, _ = next_time_with_increment(time_str, inc, limit_time, wrap)
            if new_time != time_str:
                time_str = new_time
                await update_daily_time(rec_id, time_str)
    finally:
        if DAILY_TASKS.get(rec_id) is asyncio.current_task():
            DAILY_TASKS.pop(rec_id, None)

async def ensure_all_dailies_loaded():
    state = load_state()
    for rec in state["daily"]:
        rec_id = rec.get("id")
        if not rec_id:
            continue
        task = DAILY_TASKS.get(rec_id)
        if task and not task.done():
            continue
        DAILY_TASKS[rec_id] = asyncio.create_task(schedule_one_daily_task(rec))

async def schedule_reminder(destination, author, delay_seconds: int, message: str):
    fire_at_utc = datetime.now(tz=ZoneInfo("UTC")) + timedelta(seconds=delay_seconds)
    rec = await add_reminder_record(destination.id, author.id, message, fire_at_utc)
    ONE_TIME_REMINDER_TASKS[rec["id"]] = asyncio.create_task(schedule_one_time_reminder_task(rec))

@bot.tree.command(name="reminder", description="Set a reminder like '30s', '15m', '2h', '3d' (supports combos like 1h30m).")
@app_commands.describe(when="Time like 30s, 15m, 2h, 3d, or combos like 1h30m",
                       message="What should I remind you about?")
async def remind_slash(interaction: discord.Interaction, when: str, message: str):
    seconds = parse_duration(when)
    if seconds is None:
        await interaction.response.send_message(
            "❌ Invalid time. Try examples like `30s`, `15m`, `2h`, `3d`, or combos like `1h30m`.",
            ephemeral=True
        )
        return

    await interaction.response.send_message(
        f"Reminder set! ✅ I’ll remind you in **{when}** about: _{message}_"
    )

    asyncio.create_task(schedule_reminder(interaction.channel, interaction.user, seconds, message))

@bot.tree.command(name="timedreminder", description="Repeat a reminder at an interval, with an optional starting delay.")
@app_commands.describe(
    interval="Time between reminders, e.g. 15d or 1h30m",
    start_in="Optional delay before the first reminder, e.g. 2h12m; starts now if omitted",
    message="What should I remind you about?",
)
async def timedreminder_slash(interaction: discord.Interaction, interval: str,
                              start_in: str | None = None, message: str = "Timed reminder"):
    interval_seconds = parse_duration(interval)
    start_seconds = parse_duration(start_in) if start_in is not None else 0
    if interval_seconds is None or start_seconds is None:
        await interaction.response.send_message(
            "❌ Invalid time. Use `30s`, `15m`, `2h`, `3d`, `1w`, or combinations like `2h12m`.",
            ephemeral=True,
        )
        return

    try:
        first_fire_at_utc = datetime.now(tz=ZoneInfo("UTC")) + timedelta(seconds=start_seconds)
        timedelta(seconds=interval_seconds)
    except OverflowError:
        await interaction.response.send_message("❌ That duration is too long.", ephemeral=True)
        return

    rec = await add_timed_reminder_record(
        interaction.channel.id, interaction.user.id, message, interval_seconds, interval, first_fire_at_utc
    )
    TIMED_REMINDER_TASKS[rec["id"]] = asyncio.create_task(schedule_one_timed_reminder_task(rec))
    first_local = first_fire_at_utc.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S (%Z)")
    start_description = "starting **now**" if start_in is None else f"first at **{first_local}**"
    await interaction.response.send_message(
        f"✅ Timed reminder set, {start_description}, then every **{interval}**: _{message}_"
    )

@bot.tree.command(name="listtimedreminder", description="List your repeating timed reminders in this channel.")
async def listtimedreminder_slash(interaction: discord.Interaction):
    state = load_state()
    reminders = [r for r in state["timed_reminders"]
                 if r.get("user_id") == interaction.user.id and r.get("channel_id") == interaction.channel.id]
    if not reminders:
        await interaction.response.send_message("No timed reminders saved in this channel for you.", ephemeral=True)
        return

    lines = []
    for index, rec in enumerate(reminders, start=1):
        next_local = datetime.fromisoformat(rec["next_fire_at_utc"]).astimezone(TZ)
        next_str = next_local.strftime("%Y-%m-%d %H:%M:%S (%Z)")
        lines.append(
            f"**{index}.** Every {rec.get('interval_text', str(rec['interval_seconds']) + 's')}; "
            f"next: {next_str} — _{rec['message']}_"
        )
    await interaction.response.send_message("\n".join(lines), ephemeral=True)

@bot.tree.command(name="deletetimedreminder", description="Delete a timed reminder by its index from /listtimedreminder.")
@app_commands.describe(index="Index from /listtimedreminder (starting at 1)")
async def deletetimedreminder_slash(interaction: discord.Interaction, index: int):
    state = load_state()
    reminders = state["timed_reminders"]
    filtered = [(i, r) for i, r in enumerate(reminders)
                if r.get("user_id") == interaction.user.id and r.get("channel_id") == interaction.channel.id]
    if index < 1 or index > len(filtered):
        await interaction.response.send_message(
            "❌ Invalid index. Use `/listtimedreminder` to see valid indices.", ephemeral=True
        )
        return

    global_index, rec = filtered[index - 1]
    reminders.pop(global_index)
    await save_state(state)
    task = TIMED_REMINDER_TASKS.pop(rec["id"], None)
    if task and not task.done():
        task.cancel()
    await interaction.response.send_message(f"🗑️ Deleted timed reminder **{index}**: _{rec['message']}_.")

@bot.tree.command(
    name="daily",
    description="Set a daily reminder at a specific time (HH:MM, Europe/Vienna), optionally with increment and limit."
)
@app_commands.describe(
    time="Time in 24h format, e.g. 22:00, 12:45, 09:00",
    message="What should I remind you about daily?",
    increment_minutes="Minutes to shift each next day (negative = earlier, positive = later). Example: -30",
    limit_time="HH:MM limit time. Example: 15:00",
    wrap="If true, when crossing midnight in the increment direction, jump to the limit time (then continue towards it and stop at it)."
)
async def daily_slash(
    interaction: discord.Interaction,
    time: str,
    message: str,
    increment_minutes: int = 0,
    limit_time: str | None = None,
    wrap: bool = False,   # <--- NEW
):
    if not parse_hhmm(time):
        await interaction.response.send_message(
            "❌ Invalid time. Use 24h format like `22:00`, `12:45`, or `09:00`.",
            ephemeral=True
        )
        return

    if increment_minutes != 0:
        if not limit_time or not parse_hhmm(limit_time):
            await interaction.response.send_message(
                "❌ With a non-zero increment you must provide a valid `limit_time` like `15:00`.",
                ephemeral=True
            )
            return

    rec = await add_daily_record(
        interaction.channel.id,
        interaction.user.id,
        message,
        time,
        increment_minutes=increment_minutes,
        limit_time_str=limit_time,
        wrap=wrap,
    )

    task = asyncio.create_task(schedule_one_daily_task(rec))
    DAILY_TASKS[rec["id"]] = task

    next_local = next_run_at_hhmm(time, TZ).astimezone(TZ)
    when_str = next_local.strftime("%Y-%m-%d %H:%M")

    progression = ""
    if increment_minutes != 0 and limit_time:
        direction = "earlier" if increment_minutes < 0 else "later"
        mode = "wrap to" if wrap else "stick at"
        progression = f"\n➡️ Then {abs(increment_minutes)} min {direction} each day, {mode} **{limit_time}**."

    await interaction.response.send_message(
        f"✅ Daily reminder set for **{time}** (Europe/Vienna). I’ll ping you every day starting **{when_str}**: _{message}_"
        + progression
    )

@bot.tree.command(name="listdailies", description="List your saved daily reminders.")
async def listdailies_slash(interaction: discord.Interaction):
    state = load_state()
    dailies = [d for d in state["daily"] if d.get("user_id") == interaction.user.id and d.get("channel_id") == interaction.channel.id]

    if not dailies:
        await interaction.response.send_message("No daily reminders saved in this channel for you.", ephemeral=True)
        return

    lines = []
    for i, d in enumerate(dailies, start=1):
        inc = int(d.get("increment_minutes", 0))
        lim = d.get("limit_time_str")
        inc_part = f", inc: {inc} min" if inc != 0 else ""
        lim_part = f", limit: {lim}" if inc != 0 and lim else ""
        lines.append(f"**{i}.** {d['time_str']} — _{d['message']}_ (tz: {d.get('timezone','Europe/Vienna')}{inc_part}{lim_part})")

    await interaction.response.send_message("\n".join(lines))

@bot.tree.command(name="deletedaily", description="Delete a daily reminder by its index from /listdailies.")
@app_commands.describe(index="Index from /listdailies (starting at 1)")
async def deletedaily_slash(interaction: discord.Interaction, index: int):
    state = load_state()
    dailies_all = state["daily"]
    filtered = [(i, d) for i, d in enumerate(dailies_all) if d.get("user_id") == interaction.user.id and d.get("channel_id") == interaction.channel.id]

    if index < 1 or index > len(filtered):
        await interaction.response.send_message("❌ Invalid index. Use `/listdailies` to see valid indices.", ephemeral=True)
        return

    global_idx, rec = filtered[index - 1]
    dailies_all.pop(global_idx)
    await save_state(state)

    rec_id = rec.get("id")
    task = DAILY_TASKS.get(rec_id)
    if task and not task.done():
        task.cancel()
    DAILY_TASKS.pop(rec_id, None)

    await interaction.response.send_message(f"🗑️ Deleted daily reminder **{index}**: _{rec['message']}_ at {rec['time_str']}.")

TARGET_DATE = datetime(2025, 11, 11, tzinfo=TZ)
START_DATE = datetime(2025, 10, 13, tzinfo=TZ).date()
QUESTIONS_FILE = os.path.join(BOT_DIR, "dailyquestions.txt")

POST_HOUR = 21
POST_MINUTE = 0

ROLLOVER_HOUR = 20
ROLLOVER_MINUTE = 55

def effective_question_date(now_local: datetime) -> datetime.date:
    """
    Until 21:55 local -> use yesterday's question.
    From 21:55 onward -> use today's question.
    (We still schedule the actual send at 22:00.)
    """
    cutoff = now_local.replace(hour=ROLLOVER_HOUR, minute=ROLLOVER_MINUTE, second=0, microsecond=0)
    if now_local < cutoff:
        return now_local.date() - timedelta(days=1)
    return now_local.date()

async def send_daily_question():
    """Posts the countdown and the appropriate question based on 22:00 rollover."""
    channel = bot.get_channel(CHANNEL_ID)
    if not channel:
        try:
            channel = await bot.fetch_channel(CHANNEL_ID)
        except Exception as e:
            print(f"Could not fetch channel: {e}")
            return

    now_local = datetime.now(TZ)
    today = now_local.date()

    if today > TARGET_DATE.date():
        return

    days_left = (TARGET_DATE.date() - today).days
    if days_left < 0:
        return

    weeks, days = divmod(days_left, 7)
    countdown_text = (
        f"❤️ **{weeks} week{'s' if weeks != 1 else ''}** and **{days} day{'s' if days != 1 else ''}** left until **we meet**! ❤️"
    )

    try:
        with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
            questions = [line.strip() for line in f if line.strip()]
    except Exception as e:
        print(f"Error reading questions file: {e}")
        return

    eqd = effective_question_date(now_local)

    if eqd > TARGET_DATE.date():
        return

    index = (eqd - START_DATE).days
    print("Effective question date:", eqd, "Index:", index)
    if index < 0 or index >= len(questions):
        return

    question = questions[index]

    label_date = eqd.strftime('%b %d')
    message = f"{countdown_text}\n\n💬 **Daily Question for {label_date}:** {question}"

    try:
        await channel.send(message)
    except Exception as e:
        print(f"Failed to send daily question: {e}")

async def schedule_daily_question():
    """Schedules send_daily_question() every day at the configured post time."""
    while True:
        now = datetime.now(TZ)
        target_time = now.replace(hour=POST_HOUR, minute=POST_MINUTE, second=0, microsecond=0)
        if target_time <= now:
            target_time += timedelta(days=1)
        await asyncio.sleep((target_time - now).total_seconds())
        await send_daily_question()

def get_last_available_timeslot() -> datetime:
    """
    Returns a tz-aware datetime in Europe/Vienna representing the most recent
    'official posting slot'.

    Rule:
    - If we're before rollover (21:55), then the last valid slot is *yesterday* at 22:00.
    - If we're 21:55 or after, then the last valid slot is *today* at 22:00.
    """
    now_local = datetime.now(TZ)

    cutoff_today = now_local.replace(
        hour=ROLLOVER_HOUR,
        minute=ROLLOVER_MINUTE,
        second=0,
        microsecond=0
    )

    if now_local < cutoff_today:
        # use yesterday
        ref_day = now_local.date() - timedelta(days=1)
    else:
        # use today
        ref_day = now_local.date()

    slot_local = datetime(
        ref_day.year,
        ref_day.month,
        ref_day.day,
        POST_HOUR,
        POST_MINUTE,
        tzinfo=TZ
    )
    return slot_local

# >>> ADDED
def build_question_message_for_day(day: datetime.date) -> str | None:
    """
    Build the same style of message send_daily_question() would have produced
    for a given calendar day `day`.

    - Countdown is based on that 'day'
    - Question index uses effective_question_date() with that day's rollover rule
      (which means: before 21:55 = yesterday's question, after 21:55 = today's question)
      We simulate 22:00, which is after rollover.
    """
    if day > TARGET_DATE.date():
        return None

    days_left = (TARGET_DATE.date() - day).days
    if days_left < 0:
        return None

    weeks, days = divmod(days_left, 7)
    countdown_text = (
        f"❤️ **{weeks} week{'s' if weeks != 1 else ''}** and **{days} day{'s' if days != 1 else ''}** left until **we meet**! ❤️"
    )

    try:
        with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
            questions = [line.strip() for line in f if line.strip()]
    except Exception as e:
        print(f"Error reading questions file (questionat): {e}")
        return None

    simulated_now = datetime(
        day.year,
        day.month,
        day.day,
        POST_HOUR,
        POST_MINUTE,
        tzinfo=TZ
    )

    eqd = effective_question_date(simulated_now)

    if eqd > TARGET_DATE.date():
        return None

    index = (eqd - START_DATE).days
    if index < 0 or index >= len(questions):
        return None

    question = questions[index]
    label_date = eqd.strftime('%b %d')

    message = (
        f"{countdown_text}\n\n"
        f"💬 **Daily Question for {label_date}:** {question}"
    )

    return message

@bot.tree.command(
    name="questionat",
    description="Show the daily question for a relative day. 0 = today, -1 = yesterday, 1 = tomorrow."
)
@app_commands.describe(
    offset_days="0 = today's question, -1 = yesterday's, 1 = tomorrow's, etc."
)
async def questionat_slash(interaction: discord.Interaction, offset_days: int):
    today_local = datetime.now(TZ).date()
    target_day = today_local + timedelta(days=offset_days)
    message = build_question_message_for_day(target_day)

    if message is None:
        await interaction.response.send_message(
            "⚠️ No question for that day (maybe before start or past the target date).",
            ephemeral=True
        )
        return

    await interaction.response.send_message(message)

@bot.tree.command(
    name="listreminders",
    description="List your pending one-time reminders in this channel."
)
async def listreminders_slash(interaction: discord.Interaction):
    state = load_state()
    now_utc = datetime.now(tz=ZoneInfo("UTC"))

    my_rems = []
    for r in state.get("reminders", []):
        if r.get("user_id") != interaction.user.id:
            continue
        if r.get("channel_id") != interaction.channel.id:
            continue

        try:
            fire_at_utc = datetime.fromisoformat(r.get("fire_at_utc")).replace(tzinfo=ZoneInfo("UTC"))
        except Exception:
            continue

        my_rems.append((r, fire_at_utc))

    if not my_rems:
        await interaction.response.send_message(
            "You don't have any scheduled one-time reminders in this channel.",
            ephemeral=True
        )
        return

    my_rems.sort(key=lambda pair: pair[1])

    lines = []
    for idx, (rec, fire_at_utc) in enumerate(my_rems, start=1):
        fire_local = fire_at_utc.astimezone(TZ)
        when_str = fire_local.strftime("%Y-%m-%d %H:%M (%Z)")
        msg = rec.get("message", "")
        lines.append(f"**{idx}.** {when_str} — _{msg}_")

    await interaction.response.send_message(
        "\n".join(lines),
        ephemeral=True
    )

@bot.event
async def on_voice_state_update(member: discord.Member, before: discord.VoiceState,
                                after: discord.VoiceState):
    if member.id not in COUPLE_USER_IDS or after.channel is None:
        return
    if before.channel == after.channel:
        return

    other_user_id = next(user_id for user_id in COUPLE_USER_IDS if user_id != member.id)
    if other_user_id not in after.channel.voice_states:
        return

    channel = bot.get_channel(COUPLE_NOTIFICATION_CHANNEL_ID)
    if channel is None:
        try:
            channel = await bot.fetch_channel(COUPLE_NOTIFICATION_CHANNEL_ID)
        except discord.DiscordException as exc:
            print(f"Could not fetch couple notification channel: {exc}")
            return

    try:
        await channel.send(COUPLE_VOICE_MESSAGE)
    except discord.DiscordException as exc:
        print(f"Could not send couple voice notification: {exc}")


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    await bot.tree.sync()

    await ensure_all_one_time_reminders_loaded()
    await ensure_all_dailies_loaded()
    await ensure_all_timed_reminders_loaded()

    global DAILY_QUESTION_TASK
    if DAILY_QUESTION_TASK is None or DAILY_QUESTION_TASK.done():
        DAILY_QUESTION_TASK = asyncio.create_task(schedule_daily_question())
        print(f"📅 Daily couple questions scheduled with {POST_HOUR} rollover (Europe/Vienna).")
    else:
        print("↩️ Daily question scheduler already running; skip starting another.")

bot.run(DISCORD_TOKEN)
