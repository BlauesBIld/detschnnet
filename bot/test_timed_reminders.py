"""Focused reminder tests that do not start the Discord bot."""

import ast
import asyncio
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
import uuid
from zoneinfo import ZoneInfo


FUNCTIONS = {
    "_empty_state", "load_state", "save_state", "parse_duration",
    "add_timed_reminder_record", "advance_timed_reminder_record",
    "schedule_one_timed_reminder_task", "ensure_all_timed_reminders_loaded",
    "timedreminder_slash", "deletetimedreminder_slash",
}


def load_reminder_functions(state_file):
    source = ast.parse(Path(__file__).with_name("app.py").read_text(encoding="utf-8"))
    functions = []
    for node in source.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FUNCTIONS:
            node.decorator_list = []
            functions.append(node)
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
                              *functions], type_ignores=[])
    ast.fix_missing_locations(module)
    namespace = {
        "asyncio": asyncio, "datetime": datetime, "timedelta": timedelta,
        "json": json, "os": os, "re": re, "uuid": uuid, "ZoneInfo": ZoneInfo,
        "STATE_FILE": str(state_file), "STATE_LOCK": asyncio.Lock(),
        "DURATION_PATTERN": re.compile(r"(?i)(\d+)\s*([smhdw])"),
        "MULTIPLIER": {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800},
        "TIMED_REMINDER_TASKS": {},
        "TZ": ZoneInfo("Europe/Vienna"),
    }
    exec(compile(module, str(Path(__file__).with_name("app.py")), "exec"), namespace)
    return namespace


class TimedReminderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.state_file = Path(__file__).with_name(f".test_scheduled_{uuid.uuid4().hex}.json")
        self.addAsyncCleanup(self._cleanup)
        self.ns = load_reminder_functions(self.state_file)

    async def _cleanup(self):
        self.state_file.unlink(missing_ok=True)
        Path(str(self.state_file) + ".tmp").unlink(missing_ok=True)

    async def test_duration_format_and_existing_state(self):
        parse = self.ns["parse_duration"]
        self.assertEqual(parse("15d"), 15 * 86400)
        self.assertEqual(parse("2h12m"), 2 * 3600 + 12 * 60)
        self.assertEqual(parse("1w 2d 3h"), 9 * 86400 + 3 * 3600)
        self.assertIsNone(parse("15days"))
        self.assertIsNone(parse("0s"))
        self.assertIsNone(parse("9" * 5000 + "s"))
        Path(self.ns["STATE_FILE"]).write_text('{"reminders": [], "daily": []}', encoding="utf-8")
        self.assertEqual(self.ns["load_state"]()["timed_reminders"], [])

    async def test_missed_send_keeps_original_interval(self):
        due = datetime.now(ZoneInfo("UTC")) - timedelta(seconds=35)
        rec = await self.ns["add_timed_reminder_record"](1, 2, "test", 10, "10s", due)
        next_due = await self.ns["advance_timed_reminder_record"](rec["id"], due, 10)
        self.assertGreater(next_due, datetime.now(ZoneInfo("UTC")))
        self.assertEqual((next_due - due).total_seconds() % 10, 0)
        saved = self.ns["load_state"]()["timed_reminders"][0]
        self.assertEqual(saved["next_fire_at_utc"], next_due.isoformat())

    async def test_overdue_reminder_is_restored_on_startup(self):
        sent = asyncio.Event()
        async def fake_send(channel_id, user_id, message):
            sent.set()
        self.ns["send_reminder"] = fake_send
        due = datetime.now(ZoneInfo("UTC")) - timedelta(seconds=35)
        rec = await self.ns["add_timed_reminder_record"](1, 2, "resume", 10, "10s", due)
        await self.ns["ensure_all_timed_reminders_loaded"]()
        await asyncio.wait_for(sent.wait(), timeout=2)
        saved = self.ns["load_state"]()["timed_reminders"][0]
        self.assertGreater(datetime.fromisoformat(saved["next_fire_at_utc"]), datetime.now(ZoneInfo("UTC")))
        task = self.ns["TIMED_REMINDER_TASKS"].pop(rec["id"])
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def test_command_example_starts_after_offset(self):
        responses = []
        async def respond(message, **kwargs):
            responses.append(message)
        interaction = SimpleNamespace(
            channel=SimpleNamespace(id=1), user=SimpleNamespace(id=2),
            response=SimpleNamespace(send_message=respond),
        )
        before = datetime.now(ZoneInfo("UTC"))
        await self.ns["timedreminder_slash"](interaction, "15d", "2h12m")
        rec = self.ns["load_state"]()["timed_reminders"][0]
        self.assertEqual(rec["interval_seconds"], 15 * 86400)
        self.assertEqual(rec["message"], "Timed reminder")
        first_due = datetime.fromisoformat(rec["next_fire_at_utc"])
        offset_error = (first_due - before - timedelta(hours=2, minutes=12)).total_seconds()
        self.assertGreaterEqual(offset_error, 0)
        self.assertLess(offset_error, 1)
        self.assertIn("every **15d**", responses[0])
        task = self.ns["TIMED_REMINDER_TASKS"].pop(rec["id"])
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def test_command_without_delay_sends_immediately(self):
        sent = asyncio.Event()
        async def fake_send(channel_id, user_id, message):
            sent.set()
        self.ns["send_reminder"] = fake_send
        responses = []
        async def respond(message, **kwargs):
            responses.append(message)
        interaction = SimpleNamespace(
            channel=SimpleNamespace(id=1), user=SimpleNamespace(id=2),
            response=SimpleNamespace(send_message=respond),
        )
        before = datetime.now(ZoneInfo("UTC"))
        await self.ns["timedreminder_slash"](interaction, "15d")
        await asyncio.wait_for(sent.wait(), timeout=1)
        rec = self.ns["load_state"]()["timed_reminders"][0]
        first_due = datetime.fromisoformat(rec["next_fire_at_utc"]) - timedelta(days=15)
        self.assertLess((first_due - before).total_seconds(), 1)
        self.assertIn("starting **now**", responses[0])
        task = self.ns["TIMED_REMINDER_TASKS"].pop(rec["id"])
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def test_scheduler_fires_and_delete_cancels_only_own_reminder(self):
        sent = asyncio.Event()
        async def fake_send(channel_id, user_id, message):
            sent.set()
        self.ns["send_reminder"] = fake_send
        first_due = datetime.now(ZoneInfo("UTC")) + timedelta(milliseconds=30)
        mine = await self.ns["add_timed_reminder_record"](1, 2, "mine", 1, "1s", first_due)
        other = await self.ns["add_timed_reminder_record"](1, 3, "other", 1, "1s", first_due + timedelta(hours=1))
        task = asyncio.create_task(self.ns["schedule_one_timed_reminder_task"](mine))
        self.ns["TIMED_REMINDER_TASKS"][mine["id"]] = task
        await asyncio.wait_for(sent.wait(), timeout=2)
        saved = self.ns["load_state"]()["timed_reminders"][0]
        self.assertEqual(saved["next_fire_at_utc"], (first_due + timedelta(seconds=1)).isoformat())

        responses = []
        async def respond(message, **kwargs):
            responses.append(message)
        interaction = SimpleNamespace(
            channel=SimpleNamespace(id=1), user=SimpleNamespace(id=2),
            response=SimpleNamespace(send_message=respond),
        )
        await self.ns["deletetimedreminder_slash"](interaction, 1)
        await asyncio.sleep(0)
        self.assertTrue(task.cancelled())
        self.assertIn("Deleted timed reminder", responses[0])
        self.assertEqual([r["id"] for r in self.ns["load_state"]()["timed_reminders"]], [other["id"]])


if __name__ == "__main__":
    unittest.main()
