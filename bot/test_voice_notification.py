"""Focused tests for the couple voice-channel notification."""

import ast
import asyncio
from datetime import datetime, timedelta
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock
import uuid
from zoneinfo import ZoneInfo


def load_voice_handler(bot, state_file):
    source = ast.parse(Path(__file__).with_name("app.py").read_text(encoding="utf-8"))
    names = {
        "COUPLE_USER_IDS", "COUPLE_NOTIFICATION_CHANNEL_ID",
        "COUPLE_NOTIFICATION_COOLDOWN", "COUPLE_VOICE_MESSAGE",
    }
    functions = {
        "load_couple_notification_time", "save_couple_notification_time",
        "on_voice_state_update",
    }
    nodes = []
    for node in source.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in names for target in node.targets
        ):
            nodes.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in functions:
            node.decorator_list = []
            nodes.append(node)
    module = ast.Module(
        body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *nodes],
        type_ignores=[],
    )
    ast.fix_missing_locations(module)
    namespace = {
        "asyncio": asyncio, "bot": bot, "datetime": datetime,
        "discord": SimpleNamespace(DiscordException=Exception),
        "os": os, "timedelta": timedelta, "ZoneInfo": ZoneInfo,
        "COUPLE_NOTIFICATION_LOCK": asyncio.Lock(),
        "COUPLE_NOTIFICATION_STATE_FILE": str(state_file),
    }
    exec(compile(module, str(Path(__file__).with_name("app.py")), "exec"), namespace)
    return namespace


class VoiceNotificationTests(unittest.IsolatedAsyncioTestCase):
    def make_state_file(self):
        state_file = Path(__file__).with_name(f".test_voice_notification_{uuid.uuid4().hex}.txt")
        self.addCleanup(lambda: state_file.unlink(missing_ok=True))
        self.addCleanup(lambda: Path(str(state_file) + ".tmp").unlink(missing_ok=True))
        return state_file

    async def test_only_when_the_pair_comes_together(self):
        state_file = self.make_state_file()
        destination = SimpleNamespace(send=AsyncMock())
        bot = SimpleNamespace(get_channel=lambda channel_id: destination, fetch_channel=AsyncMock())
        ns = load_voice_handler(bot, state_file)
        handler = ns["on_voice_state_update"]
        first_id, second_id = sorted(ns["COUPLE_USER_IDS"])
        first = SimpleNamespace(id=first_id)
        second = SimpleNamespace(id=second_id)
        stranger = SimpleNamespace(id=123)
        empty = SimpleNamespace(channel=None)
        together = SimpleNamespace(voice_states={first_id: object(), second_id: object()})
        separate = SimpleNamespace(voice_states={first_id: object()})

        await handler(first, empty, SimpleNamespace(channel=separate))
        destination.send.assert_not_awaited()

        await handler(second, empty, SimpleNamespace(channel=together))
        mentions = " ".join(f"<@{user_id}>" for user_id in sorted(ns["COUPLE_USER_IDS"]))
        destination.send.assert_awaited_once_with(f"{mentions}\n{ns['COUPLE_VOICE_MESSAGE']}")
        self.assertTrue(state_file.exists())

        same_channel = SimpleNamespace(channel=together)
        await handler(second, same_channel, same_channel)
        await handler(stranger, empty, same_channel)
        await handler(second, same_channel, empty)
        self.assertEqual(destination.send.await_count, 1)

        await handler(first, SimpleNamespace(channel=separate), same_channel)
        self.assertEqual(destination.send.await_count, 1)

        ns["save_couple_notification_time"](datetime.now(ZoneInfo("UTC")) - timedelta(hours=11, minutes=59))
        await handler(first, SimpleNamespace(channel=separate), same_channel)
        self.assertEqual(destination.send.await_count, 1)

        ns["save_couple_notification_time"](datetime.now(ZoneInfo("UTC")) - timedelta(hours=12, minutes=1))
        await handler(first, SimpleNamespace(channel=separate), same_channel)
        self.assertEqual(destination.send.await_count, 2)
        bot.fetch_channel.assert_not_awaited()

    async def test_simultaneous_updates_send_once(self):
        destination = SimpleNamespace(send=AsyncMock())
        bot = SimpleNamespace(get_channel=lambda channel_id: destination)
        ns = load_voice_handler(bot, self.make_state_file())
        first_id, second_id = sorted(ns["COUPLE_USER_IDS"])
        channel = SimpleNamespace(voice_states={first_id: object(), second_id: object()})
        empty = SimpleNamespace(channel=None)

        await asyncio.gather(
            ns["on_voice_state_update"](SimpleNamespace(id=first_id), empty, SimpleNamespace(channel=channel)),
            ns["on_voice_state_update"](SimpleNamespace(id=second_id), empty, SimpleNamespace(channel=channel)),
        )
        self.assertEqual(destination.send.await_count, 1)


if __name__ == "__main__":
    unittest.main()
