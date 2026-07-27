#!/usr/bin/env python3
"""Bounded public Reddit collector for the HivemindOS reddit-voc-research skill.

Adapted from mikefutia/reddit-research-agent at pinned commit
379d8e63801585e59e0660fe66a5e8a61fe51747 (MIT). It deliberately performs no
analysis: it writes normalized source records for an agent to validate and
synthesize. The API key is read only from SCRAPECREATORS_API_KEY.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_URL = "https://api.scrapecreators.com"
SUBREDDIT_RE = re.compile(r"^[A-Za-z0-9_]{2,21}$")


def first(value: Any, *keys: str, default: Any = None) -> Any:
    if not isinstance(value, dict):
        return default
    for key in keys:
        if value.get(key) is not None:
            return value[key]
    return default


def reddit_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.startswith("/"):
        raw = f"https://www.reddit.com{raw}"
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (host == "reddit.com" or host.endswith(".reddit.com") or host == "redd.it"):
        return None
    return urllib.parse.urlunparse(parsed._replace(fragment=""))


def api_get(path: str, params: dict[str, str], api_key: str) -> Any:
    base_url = os.environ.get("REDDIT_VOC_SCRAPECREATORS_BASE_URL", BASE_URL).rstrip("/")
    url = f"{base_url}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"x-api-key": api_key, "accept": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "ignore")[:300]
            if error.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"{path} returned HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"Could not reach {path}: {error.reason}") from error
    raise RuntimeError(f"Could not reach {path}.")


def post_rows(payload: Any, fallback_subreddit: str) -> list[dict[str, Any]]:
    root = payload if isinstance(payload, dict) else {}
    data = root.get("data") if isinstance(root.get("data"), dict) else {}
    candidates = next((value for value in (root.get("posts"), root.get("results"), data.get("posts"), data.get("children")) if isinstance(value, list)), [])
    rows: list[dict[str, Any]] = []
    for candidate in candidates:
        wrapper = candidate if isinstance(candidate, dict) else {}
        row = wrapper.get("data") if isinstance(wrapper.get("data"), dict) else wrapper
        url = reddit_url(first(row, "permalink", "url", "postUrl", "link"))
        title = str(row.get("title") or "").strip()
        if not url or not title:
            continue
        subreddit = first(row, "subreddit", "subredditName", default=fallback_subreddit)
        if isinstance(subreddit, dict):
            subreddit = first(subreddit, "name", "display_name", default=fallback_subreddit)
        rows.append({
            "id": str(first(row, "id", "name", default=url)),
            "title": title[:500],
            "body": str(first(row, "selftext", "body", "content", default=""))[:5000],
            "url": url,
            "subreddit": str(subreddit or fallback_subreddit).removeprefix("r/")[:64],
            "score": int(float(first(row, "score", "votes", "ups", "upvotes", default=0) or 0)),
            "num_comments": int(float(first(row, "num_comments", "numComments", "commentsCount", default=0) or 0)),
            "created_at": first(row, "created_at_iso", "created_at", "createdUtc"),
        })
    return rows


def flatten_comments(node: Any, thread_url: str, output: list[dict[str, Any]], depth: int = 0) -> None:
    if depth > 12:
        return
    if isinstance(node, list):
        for item in node:
            flatten_comments(item, thread_url, output, depth)
        return
    if not isinstance(node, dict):
        return
    row = node.get("data") if isinstance(node.get("data"), dict) else node
    body = str(first(row, "body", "content", default="")).strip()
    if body and body not in ("[deleted]", "[removed]"):
        output.append({
            "id": str(first(row, "id", "name", default="")),
            "body": body[:2000],
            "score": int(float(first(row, "score", "votes", "ups", "likes", default=0) or 0)),
            "depth": max(0, int(first(row, "depth", default=depth) or depth)),
            "url": reddit_url(first(row, "permalink", "url", "link")) or thread_url,
        })
    replies = row.get("replies")
    if replies:
        flatten_comments(replies, thread_url, output, depth + 1)
    for key in ("comments", "children", "results", "items"):
        child = row.get(key)
        if child and child is not replies:
            flatten_comments(child, thread_url, output, depth + 1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect bounded public Reddit VOC source data.")
    parser.add_argument("--query", required=True)
    parser.add_argument("--subreddits", nargs="+", required=True)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--comments-per-thread", type=int, default=20)
    parser.add_argument("--sort", choices=("relevance", "hot", "top", "new", "comments"), default="relevance")
    parser.add_argument("--timeframe", choices=("day", "week", "month", "year", "all"), default="year")
    parser.add_argument("--outdir", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("SCRAPECREATORS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: SCRAPECREATORS_API_KEY is not configured. Check it with hive-env-check; never paste it into chat.", file=sys.stderr)
        return 2
    query = " ".join(args.query.split())[:120]
    subreddits = list(dict.fromkeys(value.removeprefix("r/") for value in args.subreddits))
    if not query or not 1 <= len(subreddits) <= 5 or any(not SUBREDDIT_RE.fullmatch(value) for value in subreddits):
        print("ERROR: supply a query and 1-5 valid subreddit names.", file=sys.stderr)
        return 2
    thread_limit = max(1, min(20, args.threads))
    comment_limit = max(1, min(40, args.comments_per_thread))
    output_root = Path(args.outdir).expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")[:64] or "reddit-voc"
    run_dir = output_root / f"{slug}-{stamp}"
    run_dir.mkdir(mode=0o700)

    all_posts: list[dict[str, Any]] = []
    credits = 0
    for subreddit in subreddits:
        payload = api_get("/v1/reddit/subreddit/search", {
            "subreddit": subreddit, "query": query, "sort": args.sort, "timeframe": args.timeframe,
        }, api_key)
        credits += 1
        all_posts.extend(post_rows(payload, subreddit))

    ranked = sorted(all_posts, key=lambda post: (post["num_comments"], post["score"]), reverse=True)
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for post in ranked:
        if post["url"] in seen:
            continue
        seen.add(post["url"])
        selected.append(post)
        if len(selected) >= thread_limit:
            break
    if not selected:
        print("ERROR: no relevant public Reddit threads were returned.", file=sys.stderr)
        return 1

    threads: list[dict[str, Any]] = []
    for rank, post in enumerate(selected, 1):
        payload = api_get("/v1/reddit/post/comments", {"url": post["url"], "trim": "true"}, api_key)
        credits += 1
        comments: list[dict[str, Any]] = []
        flatten_comments(payload, post["url"], comments)
        comments.sort(key=lambda comment: comment["score"], reverse=True)
        threads.append({"rank": rank, **post, "comments": comments[:comment_limit]})

    result = {
        "schema": "hivemindos-reddit-voc-source-v1",
        "query": query,
        "subreddits": subreddits,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider_credits_used": credits,
        "threads": threads,
    }
    destination = run_dir / "sources.json"
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(str(destination))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
