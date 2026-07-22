#!/usr/bin/env python3
"""Launch the pinned Hound MCP server behind HivemindOS guardrails."""

from hound_guard import install_hound_guard


install_hound_guard()

from master_fetch.server import main  # noqa: E402


if __name__ == "__main__":
    main()
