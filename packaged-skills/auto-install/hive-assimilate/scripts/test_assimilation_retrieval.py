#!/usr/bin/env python3
"""Focused tests for Hive Assimilate retrieval and logging helpers."""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def load_script(name: str):
    path = SCRIPT_DIR / name
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AssimilationLoggingTests(unittest.TestCase):
    def test_large_inline_json_payload_is_not_treated_as_path(self) -> None:
        logger = load_script("log_assimilation_decision.py")
        payload = {
            "candidates": [
                {
                    "repo": "owner/repo",
                    "url": "https://github.com/owner/repo",
                    "stars": 123,
                    "description": "x" * 5000,
                }
            ],
            "result_count": 1,
            "limit": 5,
        }
        args = argparse.Namespace(
            payload=json.dumps(payload),
            candidate=[],
            request="payload edge case",
            phase="public-search",
            source="public-github",
            query="react dashboard",
            decision="retrieved",
            reason="test",
            selected_backbone="",
            assimilated="",
            not_assimilated="",
            verification="",
            note=[],
        )

        event = logger.event_from_args(args)

        self.assertEqual(event["payload"], {"result_count": 1, "limit": 5})
        self.assertEqual(event["candidates"][0]["repo"], "owner/repo")
        self.assertLessEqual(len(event["candidates"][0]["description"]), 500)

    def test_candidate_decision_aliases_are_normalized(self) -> None:
        logger = load_script("log_assimilation_decision.py")

        self.assertEqual(
            logger.split_candidate("repo::selected_donor::use it")["decision"],
            "selected-donor",
        )
        self.assertEqual(
            logger.split_candidate("repo::inspect::needs audit")["decision"],
            "inspected",
        )


class PublicQueryPlanningTests(unittest.TestCase):
    def test_failed_internal_prompts_expand_to_reusable_primitives(self) -> None:
        public = load_script("search_github_public.py")

        toast_queries = public.expanded_queries(
            "Move connected app completion toast from Fleet view to dashboard shell header React notification layer",
            True,
        )
        syncthing_queries = public.expanded_queries(
            "Make HivemindOS Syncthing shared-vault sync repair more robust with automatic start resume rescan reconnect",
            True,
        )
        x402_queries = public.expanded_queries(
            "Implement MiroShark x402 paid API run client in TypeScript with EIP-3009 USDC Base",
            True,
        )
        chat_queries = public.expanded_queries(
            "Next.js compact chat modal demo with chat composer assistant bubbles lottie animation",
            True,
        )

        self.assertIn("react toast notification queue", toast_queries)
        self.assertIn("syncthing rest api client", syncthing_queries)
        self.assertIn("x402 fetch typescript", x402_queries)
        self.assertIn("react chat modal", chat_queries)
        self.assertNotIn("tauri nextjs static export", chat_queries)


class LocalIndexSearchTests(unittest.TestCase):
    def test_relevance_filter_prefers_distinctive_overlap_over_star_noise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            index = Path(tmp) / "chunks.jsonl"
            records = [
                {
                    "repo": "popular/generic-dashboard",
                    "kind": "repo-summary",
                    "title": "React dashboard",
                    "text": "React TypeScript dashboard UI internal tool",
                    "stars": 40000,
                },
                {
                    "repo": "local/collector",
                    "kind": "repo-summary",
                    "title": "Telemetry collector port resolver",
                    "text": "dynamic local collector port resolution stale telemetry URL health endpoint",
                    "stars": 2,
                },
            ]
            index.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_DIR / "search_assimilation_index.py"),
                    "HivemindOS dynamic local collector port resolution for stale agent telemetry URLs",
                    "--index",
                    str(index),
                    "--json",
                    "--top",
                    "2",
                ],
                text=True,
                capture_output=True,
                check=True,
            )

        results = json.loads(completed.stdout)
        self.assertEqual([record["repo"] for record in results], ["local/collector"])


if __name__ == "__main__":
    unittest.main()
