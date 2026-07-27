#!/usr/bin/env python3
"""Focused behavior tests for the Swarm Sovereign Hermes plugin."""

from __future__ import annotations

import importlib.util
import socketserver
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch


PLUGIN_PATH = Path(__file__).parent / "hermes-plugins" / "swarm-sovereign-gateway" / "__init__.py"
SPEC = importlib.util.spec_from_file_location("swarm_sovereign_gateway_plugin", PLUGIN_PATH)
PLUGIN = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(PLUGIN)


class FakePairingStore:
    def __init__(self, approved):
        self.approved = approved

    def list_approved(self, platform):
        assert platform == "telegram"
        return self.approved


class FakeSessionStore:
    def get_or_create_session(self, source):
        return types.SimpleNamespace(session_id=f"session-{source.user_id}")


class FakeGateway:
    def __init__(self, approved):
        self.pairing_store = FakePairingStore(approved)
        self._session_model_overrides = {}
        self.evicted = []

    def _normalize_source_for_session_key(self, source):
        return source

    def _session_key_for_source(self, source):
        return f"key-{source.user_id}"

    def _evict_cached_agent(self, session_key):
        self.evicted.append(session_key)


def event(user_id, text, chat_type="group", message_type="text"):
    return types.SimpleNamespace(
        text=text,
        message_type=message_type,
        source=types.SimpleNamespace(
            platform=types.SimpleNamespace(value="telegram"),
            user_id=user_id,
            chat_type=chat_type,
        ),
    )


class SwarmSovereignGatewayPluginTests(unittest.TestCase):
    def setUp(self):
        PLUGIN._session_access.clear()
        PLUGIN._owner_user_ids = None
        self.primary_runtime = {
            "model": "swarm-sovereign-26b",
            "provider": "custom",
            "api_key": "local-placeholder",
            "base_url": "http://127.0.0.1:1234/v1",
            "api_mode": "chat_completions",
        }
        self.fallback_runtime = {
            "model": "gpt-5.6-luna",
            "provider": "openai-codex",
            "api_key": "oauth-placeholder",
            "base_url": "https://chatgpt.com/backend-api/codex",
            "api_mode": "codex_responses",
        }
        PLUGIN._runtime_override = self.primary_runtime
        PLUGIN._primary_runtime_override = self.primary_runtime
        self.runtime_patch = patch.object(
            PLUGIN,
            "select_runtime_override",
            return_value=self.primary_runtime,
            create=True,
        )
        self.runtime_patch.start()
        self.addCleanup(self.runtime_patch.stop)

    def test_primary_health_probe_has_a_hard_three_second_budget_and_requires_model(self):
        calls = []

        def healthy_request(url, timeout_seconds):
            calls.append((url, timeout_seconds))
            return {"data": [{"id": "swarm-sovereign-26b"}]}

        self.assertTrue(PLUGIN.primary_model_is_available({}, request_json=healthy_request))
        self.assertEqual(calls, [("http://127.0.0.1:1234/v1/models", 3.0)])

        self.assertFalse(
            PLUGIN.primary_model_is_available(
                {},
                request_json=lambda _url, _timeout: {"data": [{"id": "another-model"}]},
            )
        )
        self.assertFalse(
            PLUGIN.primary_model_is_available(
                {},
                request_json=lambda _url, _timeout: None,
            )
        )

    def test_health_request_stops_at_one_total_deadline_when_server_hangs(self):
        release_handler = threading.Event()

        class HangingHandler(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.recv(4_096)
                release_handler.wait(2)

        class HangingServer(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

        server = HangingServer(("127.0.0.1", 0), HangingHandler)
        server_thread = threading.Thread(
            target=lambda: server.serve_forever(poll_interval=0.01),
            daemon=True,
        )
        server_thread.start()
        started_at = time.monotonic()
        try:
            payload = PLUGIN._request_json_with_deadline(
                f"http://127.0.0.1:{server.server_address[1]}/v1/models",
                0.2,
            )
        finally:
            release_handler.set()
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=1)

        self.assertIsNone(payload)
        self.assertLess(time.monotonic() - started_at, 0.5)

    def test_unhealthy_primary_routes_directly_to_luna_and_recovers_to_swarm(self):
        self.runtime_patch.stop()
        gateway = FakeGateway([{"user_id": "owner"}])
        store = FakeSessionStore()

        with (
            patch.object(PLUGIN, "primary_model_is_available", return_value=False),
            patch.object(
                PLUGIN,
                "resolve_fallback_runtime_override",
                return_value=self.fallback_runtime,
            ),
        ):
            result = PLUGIN.pre_gateway_dispatch(
                event("owner", "@SwarmSovereignBot status"), gateway, store
            )
            self.assertEqual(result["action"], "rewrite")
            self.assertEqual(
                gateway._session_model_overrides["key-owner"], self.fallback_runtime
            )
            self.assertEqual(gateway.evicted, ["key-owner"])

            PLUGIN.pre_gateway_dispatch(
                event("owner", "@SwarmSovereignBot status again"), gateway, store
            )
            self.assertEqual(
                gateway.evicted,
                ["key-owner"],
                "identical fallback runtime must preserve the cached Luna agent",
            )

        with patch.object(PLUGIN, "primary_model_is_available", return_value=True):
            PLUGIN.pre_gateway_dispatch(
                event("owner", "@SwarmSovereignBot recovered?"), gateway, store
            )
        self.assertEqual(
            gateway._session_model_overrides["key-owner"], self.primary_runtime
        )
        self.assertEqual(gateway.evicted, ["key-owner", "key-owner"])

    def test_solara_aliases_are_plain_read_only_messages_for_the_paired_owner(self):
        gateway = FakeGateway([{"user_id": "owner"}])
        store = FakeSessionStore()

        for text in ("Hey Sol", "Hey Solara, do the thing", "Sol", "Solara", "gpt5.6 sol"):
            owner_result = PLUGIN.pre_gateway_dispatch(event("owner", text), gateway, store)
            self.assertEqual(owner_result["action"], "rewrite")
            self.assertIn("Read-only Telegram turn", owner_result["text"])
            self.assertNotIn("Owner-authenticated Solara turn", owner_result["text"])
            self.assertEqual(PLUGIN._session_access["session-owner"], "read_only")

        blocked = PLUGIN.pre_tool_call("terminal", "session-owner")
        self.assertEqual(blocked["action"], "block")
        self.assertIsNone(PLUGIN.pre_tool_call("web_search", "session-owner"))

    def test_public_group_mention_is_web_only_and_public_dm_is_denied(self):
        gateway = FakeGateway([{"user_id": "owner"}])
        store = FakeSessionStore()
        guest_event = event("guest", "@SwarmSovereignBot what's new?")
        result = PLUGIN.pre_gateway_dispatch(guest_event, gateway, store)
        self.assertEqual(result["action"], "rewrite")
        self.assertIn("Read-only Telegram turn", result["text"])
        self.assertTrue(guest_event.source.role_authorized)
        self.assertEqual(PLUGIN._session_access["session-guest"], "read_only")

        self.assertIsNone(PLUGIN.pre_tool_call("web_search", "session-guest"))
        blocked = PLUGIN.pre_tool_call("terminal", "session-guest")
        self.assertEqual(blocked["action"], "block")
        denied = PLUGIN.pre_gateway_dispatch(
            event("another-guest", "hello", chat_type="dm"), gateway, store
        )
        self.assertEqual(denied, {"action": "skip", "reason": "public-dm-denied"})

    def test_public_slash_commands_are_denied_before_gateway_handlers(self):
        gateway = FakeGateway([{"user_id": "owner"}])
        store = FakeSessionStore()
        for text in ("/model gpt-5.6-sol", "@SwarmSovereignBot /restart"):
            result = PLUGIN.pre_gateway_dispatch(event("guest", text), gateway, store)
            self.assertEqual(result, {"action": "skip", "reason": "public-command-denied"})

    def test_runtime_override_is_scoped_to_each_telegram_session(self):
        gateway = FakeGateway([{"user_id": "owner"}])
        store = FakeSessionStore()
        result = PLUGIN.pre_gateway_dispatch(event("owner", "@SwarmSovereignBot status"), gateway, store)
        self.assertEqual(result["action"], "rewrite")
        self.assertEqual(gateway._session_model_overrides["key-owner"], self.primary_runtime)
        self.assertEqual(gateway.evicted, ["key-owner"])

        PLUGIN.pre_gateway_dispatch(event("owner", "@SwarmSovereignBot status again"), gateway, store)
        self.assertEqual(gateway.evicted, ["key-owner"], "identical override must preserve the cached agent")

    def test_owner_resolution_fails_closed_when_pairing_is_ambiguous(self):
        gateway = FakeGateway([{"user_id": "one"}, {"user_id": "two"}])
        self.assertEqual(PLUGIN.resolve_owner_user_ids(gateway, {}), frozenset())
        self.assertEqual(
            PLUGIN.resolve_owner_user_ids(gateway, {"owner_telegram_user_ids": ["one"]}),
            frozenset({"one"}),
        )


if __name__ == "__main__":
    unittest.main()
