"""Focused tests for the couple voice-channel notification."""

import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock


def load_voice_handler(bot):
    source = ast.parse(Path(__file__).with_name("app.py").read_text(encoding="utf-8"))
    names = {"COUPLE_USER_IDS", "COUPLE_NOTIFICATION_CHANNEL_ID", "COUPLE_VOICE_MESSAGE"}
    nodes = []
    for node in source.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in names for target in node.targets
        ):
            nodes.append(node)
        elif isinstance(node, ast.AsyncFunctionDef) and node.name == "on_voice_state_update":
            node.decorator_list = []
            nodes.append(node)
    module = ast.Module(
        body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *nodes],
        type_ignores=[],
    )
    ast.fix_missing_locations(module)
    namespace = {"bot": bot, "discord": SimpleNamespace(DiscordException=Exception)}
    exec(compile(module, str(Path(__file__).with_name("app.py")), "exec"), namespace)
    return namespace


class VoiceNotificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_when_the_pair_comes_together(self):
        destination = SimpleNamespace(send=AsyncMock())
        bot = SimpleNamespace(get_channel=lambda channel_id: destination, fetch_channel=AsyncMock())
        ns = load_voice_handler(bot)
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
        destination.send.assert_awaited_once_with(ns["COUPLE_VOICE_MESSAGE"])

        same_channel = SimpleNamespace(channel=together)
        await handler(second, same_channel, same_channel)
        await handler(stranger, empty, same_channel)
        await handler(second, same_channel, empty)
        self.assertEqual(destination.send.await_count, 1)

        await handler(first, SimpleNamespace(channel=separate), same_channel)
        self.assertEqual(destination.send.await_count, 2)
        bot.fetch_channel.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
