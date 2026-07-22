#!/usr/bin/env python3
"""Run Hermes CLI with a machine-readable live stream for HivemindOS chat."""

from __future__ import annotations

import json
import sys

import cli


EVENT_PREFIX = "__HIVEMIND_HERMES_EVENT__"


def emit_event(event_type: str, **payload: object) -> None:
    print(
        EVENT_PREFIX + json.dumps({"type": event_type, **payload}, ensure_ascii=False),
        flush=True,
    )


display = cli.CLI_CONFIG.setdefault("display", {})
display.update(
    {
        "streaming": True,
        "inline_diffs": False,
        "tool_progress": "off",
        "show_reasoning": False,
        "final_response_markdown": "raw",
    }
)

original_stream_delta = cli.HermesCLI._stream_delta


def emit_stream_text(self: object, text: str) -> None:
    if not text:
        return
    if not getattr(self, "_stream_box_opened", False):
        text = text.lstrip("\n")
        if not text:
            return
        self._stream_box_opened = True
    emit_event("assistant.delta", delta=text)


def flush_stream(_self: object) -> None:
    return


def stream_delta(self: object, text: str | None) -> None:
    original_stream_delta(self, text)
    if text is None:
        emit_event("assistant.segment_end")


def tool_generating(_self: object, tool_name: str) -> None:
    emit_event("tool.generating", name=str(tool_name or "tool"))


def tool_progress(
    _self: object,
    event_type: str,
    function_name: str | None = None,
    preview: str | None = None,
    function_args: dict | None = None,
    **kwargs: object,
) -> None:
    del preview, function_args
    if event_type not in {"tool.started", "tool.completed"}:
        return
    is_error = bool(kwargs.get("is_error"))
    output_type = "tool.failed" if event_type == "tool.completed" and is_error else event_type
    emit_event(
        output_type,
        name=str(function_name or "tool"),
        status="failed" if is_error else "completed" if event_type == "tool.completed" else "running",
    )


cli.HermesCLI._emit_stream_text = emit_stream_text
cli.HermesCLI._flush_stream = flush_stream
cli.HermesCLI._stream_delta = stream_delta
cli.HermesCLI._on_tool_gen_start = tool_generating
cli.HermesCLI._on_tool_progress = tool_progress

from hermes_cli.main import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
