#!/usr/bin/env python3
"""Exercise the private Hermes bridge's capability receipt path without Hermes."""

from __future__ import annotations

import contextlib
import io
import json
import os
import runpy
import sys
import types


class FakeHermesCLI:
    _stream_delta = lambda self, text: None


cli = types.ModuleType("cli")
cli.CLI_CONFIG = {}
cli.HermesCLI = FakeHermesCLI
sys.modules["cli"] = cli
hermes_cli = types.ModuleType("hermes_cli")
hermes_cli_main = types.ModuleType("hermes_cli.main")
hermes_cli_main.main = lambda: 0
sys.modules["hermes_cli"] = hermes_cli
sys.modules["hermes_cli.main"] = hermes_cli_main

capability_id = "skill:shared:selected-video"
os.environ["HIVEMINDOS_APPROVED_CAPABILITY_IDS"] = json.dumps([capability_id])
bridge_path = os.environ.get("HIVEMINDOS_TEST_HERMES_BRIDGE", "scripts/hermes-hivemind-stream.py")
namespace = runpy.run_path(bridge_path, run_name="hivemindos_bridge_test")
output = io.StringIO()
with contextlib.redirect_stdout(output):
    namespace["tool_progress"](None, "tool.started", "read_file", function_args={"path": capability_id})
    namespace["tool_progress"](None, "tool.completed", "read_file", is_error=False)
    namespace["tool_progress"](None, "tool.started", "terminal", function_args={"command": f"HIVEMINDOS_CAPABILITY_ID='{capability_id}' run-provider"})
    namespace["tool_progress"](None, "tool.completed", "terminal", is_error=False)
    namespace["tool_progress"](None, "tool.started", "terminal", function_args={"command": f"HIVEMINDOS_CAPABILITY_ID='{capability_id}' fail-provider"})
    namespace["tool_progress"](None, "tool.completed", "terminal", is_error=True)

events = [json.loads(line.split(namespace["EVENT_PREFIX"], 1)[1]) for line in output.getvalue().splitlines()]
capability_events = [event for event in events if event["type"].startswith("capability.")]
assert [event["type"] for event in capability_events] == ["capability.started", "capability.completed", "capability.started", "capability.failed"]
assert all(event["id"] == capability_id for event in capability_events)
assert not any(event["type"].startswith("capability.") and event.get("tool") == "read_file" for event in events)
print("Hermes capability receipt bridge tests passed")
