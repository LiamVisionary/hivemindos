#!/usr/bin/env python3
"""Dev-only LLM evaluation for HivemindOS standard memory retrieval outputs.

This adapter imports only the prompt modules from a pinned, audited checkout of
mem0ai/memory-benchmarks. Retrieval is produced separately through the real
HivemindOS conversation archive, full-vault index, and recall path.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import os
import random
import re
import statistics
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


PROMPT_SHA256 = {
    "locomo": "8ebac1ef60e9ab5caf99079fdaac038b85472e81491ed35e2d2655f3927c76c2",
    "longmemeval": "ba8cf60d26f1390ecbef0f07b3e950556fe3bc5a37ba4b5343f28217f18c144f",
    "beam": "a1c2a4822898411f90ab2915a72d2b2031f97437bdcc1b3ac2008fe93653267b",
}
PROMPT_PATH = {
    "locomo": "benchmarks/locomo/prompts.py",
    "longmemeval": "benchmarks/longmemeval/prompts.py",
    "beam": "benchmarks/beam/prompts.py",
}
HARNESS_COMMIT = "4b61c5d"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate dev-only HivemindOS standard-memory retrieval outputs")
    parser.add_argument("--benchmark", required=True, choices=sorted(PROMPT_PATH))
    parser.add_argument("--predictions-dir", required=True)
    parser.add_argument("--harness-root", required=True, help=f"Audited mem0ai/memory-benchmarks checkout at {HARNESS_COMMIT}")
    parser.add_argument("--answerer-model", default="gpt-4o")
    parser.add_argument("--judge-model", default="gpt-4o")
    parser.add_argument("--base-url", default=OPENAI_CHAT_URL)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--auth-mode", choices=["bearer", "none"], default="bearer")
    parser.add_argument("--provider-label", default="openai-direct")
    parser.add_argument("--provider-order", default=None, help="Comma-separated OpenRouter provider order, for example OpenAI")
    parser.add_argument("--cutoffs", default="50")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--progress-every", type=int, default=10)
    parser.add_argument("--max-items", type=int, default=None)
    parser.add_argument("--question-ids", default=None, help="JSON array or newline-delimited ids")
    parser.add_argument("--rerun", action="store_true")
    return parser.parse_args()


def load_prompt_module(benchmark: str, harness_root: Path) -> Any:
    path = harness_root / PROMPT_PATH[benchmark]
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != PROMPT_SHA256[benchmark]:
        raise RuntimeError(
            f"Prompt hash mismatch for {path}; expected audited {PROMPT_SHA256[benchmark]}, got {digest}"
        )
    spec = importlib.util.spec_from_file_location(f"hivemindos_{benchmark}_prompts", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load prompt module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(len(ordered) * quantile + 0.999999) - 1))
    return ordered[index]


def distribution(values: list[float], precision: int = 2) -> dict[str, float | int]:
    if not values:
        return {"samples": 0, "p50": 0, "p95": 0, "mean": 0}
    return {
        "samples": len(values),
        "p50": round(percentile(values, 0.50), precision),
        "p95": round(percentile(values, 0.95), precision),
        "mean": round(statistics.fmean(values), precision),
    }


def load_question_ids(path: str | None) -> set[str] | None:
    if not path:
        return None
    raw = Path(path).read_text(encoding="utf-8")
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            raise ValueError("not a list")
        return {str(item) for item in parsed}
    except (json.JSONDecodeError, ValueError):
        return {line.strip() for line in raw.splitlines() if line.strip()}


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def openai_model_family(model: str) -> str:
    """Normalize direct and OpenRouter model ids before applying API-family rules."""
    return model.lower().rsplit("/", 1)[-1].split(":", 1)[0]


def chat_token_limit_key(model: str) -> str:
    family = openai_model_family(model)
    return "max_completion_tokens" if family.startswith(("gpt-5", "o1", "o3", "o4")) else "max_tokens"


def supports_temperature(model: str) -> bool:
    family = openai_model_family(model)
    return not family.startswith(("gpt-5", "o1", "o3", "o4"))


class OpenAIChatClient:
    def __init__(self, model: str, api_key: str, semaphore: asyncio.Semaphore, base_url: str, provider_order: list[str] | None, timeout: float = 180.0):
        self.model = model
        self.api_key = api_key
        self.semaphore = semaphore
        self.base_url = base_url
        self.provider_order = provider_order
        self.timeout = timeout

    async def complete(self, system: str, user: str, *, structured: bool = False, max_tokens: int = 4096) -> dict[str, Any]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            chat_token_limit_key(self.model): max_tokens,
        }
        if supports_temperature(self.model):
            payload["temperature"] = 0
        if structured:
            payload["response_format"] = {"type": "json_object"}
        if self.provider_order:
            payload["provider"] = {"order": self.provider_order, "allow_fallbacks": False}
        async with self.semaphore:
            return await asyncio.to_thread(self._request_with_retries, payload)

    def _request_with_retries(self, payload: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(5):
            started = time.perf_counter()
            retry_delay = float(2**attempt)
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "hivemindos-standard-memory-benchmark/1",
            }
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            request = urllib.request.Request(
                self.base_url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    parsed = json.loads(response.read().decode("utf-8"))
                choice = parsed.get("choices", [{}])[0]
                content = choice.get("message", {}).get("content") or ""
                usage = parsed.get("usage") or {}
                details = usage.get("prompt_tokens_details") or {}
                return {
                    "text": content.strip(),
                    "usage": {
                        "input": int(usage.get("prompt_tokens") or 0),
                        "output": int(usage.get("completion_tokens") or 0),
                        "total": int(usage.get("total_tokens") or 0),
                        "cachedInput": int(details.get("cached_tokens") or 0),
                    },
                    "latencyMs": round((time.perf_counter() - started) * 1000, 2),
                    "finishReason": choice.get("finish_reason"),
                }
            except urllib.error.HTTPError as error:
                retryable = error.code == 429 or error.code >= 500
                detail = error.read().decode("utf-8", "replace")[:500]
                if not retryable or attempt == 4:
                    raise RuntimeError(f"Chat-completions HTTP {error.code}: {detail}") from error
                try:
                    error_payload = json.loads(detail)
                    metadata = error_payload.get("error", {}).get("metadata", {})
                    retry_delay = max(retry_delay, float(metadata.get("retry_after_seconds") or 0))
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt == 4:
                    raise RuntimeError(f"Chat-completions request failed: {error}") from error
            time.sleep(min(90.0, retry_delay + random.uniform(0.25, 1.25)))
        raise RuntimeError("Chat-completions request failed after retries")


def parse_structured(text: str) -> dict[str, Any]:
    raw = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    parsed = json.loads(raw)
    if isinstance(parsed, dict) and set(parsed) == {"final"}:
        nested = parsed["final"]
        parsed = json.loads(nested) if isinstance(nested, str) else nested
    return parsed if isinstance(parsed, dict) else {}


async def complete_structured_json(
    client: OpenAIChatClient,
    system: str,
    user: str,
    *,
    max_tokens: int = 4096,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    prompt = user
    for attempt in range(3):
        call = await client.complete(system, prompt, structured=True, max_tokens=max_tokens)
        calls.append(call)
        try:
            return calls, parse_structured(call["text"])
        except (json.JSONDecodeError, TypeError, ValueError):
            if attempt == 2:
                raise
            prompt = f"{user}\n\nReturn one strict JSON object only. Escape every backslash and quote according to JSON syntax; do not use Markdown fences."
    raise RuntimeError("Structured judge failed after retries")


def parse_yes_no(text: str) -> bool:
    region = re.split(r"</judge_thinking>|</thinking>", text, flags=re.IGNORECASE)[-1]
    lines = [line.strip().lower() for line in region.splitlines() if line.strip()]
    for line in reversed(lines):
        if line in {"yes", "no"}:
            return line == "yes"
    matches = re.findall(r"\b(yes|no)\b", region.lower())
    return bool(matches and matches[-1] == "yes")


def human_longmemeval_date(value: str) -> str:
    try:
        cleaned = re.sub(r"\s*\([A-Za-z]+\)\s*", " ", value).strip()
        return datetime.strptime(cleaned, "%Y/%m/%d %H:%M").strftime("%A, %B %d, %Y")
    except (ValueError, TypeError):
        return value


def strip_answer_marker(text: str) -> str:
    without_thinking = re.sub(r"[<\[]mem_thinking[>\]].*?[<\[]/mem_thinking[>\]]", "", text, flags=re.DOTALL)
    return without_thinking.rsplit("ANSWER:", 1)[-1].strip() if "ANSWER:" in without_thinking else without_thinking.strip()


def call_metrics(calls: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "calls": len(calls),
        "inputTokens": sum(call["usage"]["input"] for call in calls),
        "outputTokens": sum(call["usage"]["output"] for call in calls),
        "totalTokens": sum(call["usage"]["total"] for call in calls),
        "cachedInputTokens": sum(call["usage"]["cachedInput"] for call in calls),
        "latencyMs": round(sum(call["latencyMs"] for call in calls), 2),
    }


async def evaluate_locomo(item: dict[str, Any], cutoff: int, prompts: Any, answerer: OpenAIChatClient, judge: OpenAIChatClient) -> dict[str, Any]:
    memories = list(item["retrieval"]["search_results"])[:cutoff]
    answer_prompt = prompts.get_answer_generation_prompt(
        item["question"], memories, reference_date=item.get("reference_date"), user_profile=item.get("user_profile")
    )
    answer_call = await answerer.complete("", answer_prompt)
    generated = strip_answer_marker(answer_call["text"])
    expected = prompts.preprocess_answer(item["category"], item["ground_truth_answer"])
    judge_prompt = prompts.get_judge_prompt(item["category"], item["question"], expected, generated)
    judge_calls, parsed = await complete_structured_json(judge, prompts.JUDGE_SYSTEM_PROMPT, judge_prompt)
    correct = str(parsed.get("label", "")).upper() == "CORRECT"
    return {
        "judgment": "CORRECT" if correct else "WRONG",
        "score": 1.0 if correct else 0.0,
        "generated_answer": generated,
        "memories_evaluated": len(memories),
        "reason": parsed.get("reasoning", ""),
        "answerCall": call_metrics([answer_call]),
        "judgeCall": call_metrics(judge_calls),
    }


async def evaluate_longmemeval(item: dict[str, Any], cutoff: int, prompts: Any, answerer: OpenAIChatClient, judge: OpenAIChatClient) -> dict[str, Any]:
    memories = sorted(list(item["retrieval"]["search_results"])[:cutoff], key=lambda memory: memory.get("created_at") or "")
    question_date = human_longmemeval_date(item.get("question_date", ""))
    answer_prompt = prompts.get_answer_generation_prompt(
        question=item["question"], search_results=memories, question_date=question_date, user_profile=item.get("user_profile")
    )
    answer_call = await answerer.complete("", answer_prompt)
    generated = strip_answer_marker(answer_call["text"])
    judge_prompt = prompts.get_judge_prompt(
        question_type=item.get("question_type", ""),
        question_id=item["question_id"],
        question=item["question"],
        answer=item["ground_truth_answer"],
        response=generated,
        question_date=question_date,
    )
    judge_call = await judge.complete("", judge_prompt)
    correct = parse_yes_no(judge_call["text"])
    return {
        "judgment": "PASS" if correct else "FAIL",
        "score": 1.0 if correct else 0.0,
        "generated_answer": generated,
        "judge_raw": judge_call["text"],
        "memories_evaluated": len(memories),
        "answerCall": call_metrics([answer_call]),
        "judgeCall": call_metrics([judge_call]),
    }


async def evaluate_beam(item: dict[str, Any], cutoff: int, prompts: Any, answerer: OpenAIChatClient, judge: OpenAIChatClient) -> dict[str, Any]:
    memories = sorted(list(item["retrieval"]["search_results"])[:cutoff], key=lambda memory: memory.get("created_at") or "")
    answer_prompt = prompts.get_beam_answer_generation_prompt(item["question"], memories, top_k=cutoff)
    answer_call = await answerer.complete("", answer_prompt)
    generated = strip_answer_marker(answer_call["text"])
    judge_calls = []
    nugget_scores = []

    async def judge_nugget(nugget: str) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
        prompt = prompts.get_beam_nugget_judge_prompt(item["question"], nugget, generated)
        calls, parsed = await complete_structured_json(judge, prompts.BEAM_JUDGE_SYSTEM_PROMPT, prompt)
        return nugget, calls, parsed

    judged_nuggets = await asyncio.gather(*(judge_nugget(nugget) for nugget in item.get("rubric_nuggets", [])))
    for nugget, calls, parsed in judged_nuggets:
        judge_calls.extend(calls)
        raw_score = float(parsed.get("score", 0))
        score = 1.0 if raw_score >= 0.75 else 0.5 if raw_score >= 0.25 else 0.0
        nugget_scores.append({"nugget": nugget, "score": score, "reason": parsed.get("reason", "")})
    score = statistics.fmean(entry["score"] for entry in nugget_scores) if nugget_scores else 0.0
    return {
        "judgment": "SCORED",
        "score": score,
        "generated_answer": generated,
        "memories_evaluated": len(memories),
        "nugget_scores": nugget_scores,
        "eventOrderingTauSkipped": item.get("question_type") == "event_ordering",
        "answerCall": call_metrics([answer_call]),
        "judgeCall": call_metrics(judge_calls),
    }


def build_summary(items: list[dict[str, Any]], benchmark: str, cutoffs: list[int], args: argparse.Namespace) -> dict[str, Any]:
    metrics_by_cutoff: dict[str, Any] = {}
    dimension_key = "category_name" if benchmark == "locomo" else "question_type"
    for cutoff in cutoffs:
        label = f"top_{cutoff}"
        scored = [item for item in items if label in item.get("cutoff_results", {})]
        scores = [float(item["cutoff_results"][label]["score"]) for item in scored]
        pass_threshold = 0.5 if benchmark == "beam" else 1.0
        by_dimension: dict[str, list[float]] = defaultdict(list)
        by_chat_size: dict[str, list[float]] = defaultdict(list)
        for item in scored:
            by_dimension[str(item.get(dimension_key, "unknown"))].append(float(item["cutoff_results"][label]["score"]))
            if item.get("chat_size"):
                by_chat_size[str(item["chat_size"])].append(float(item["cutoff_results"][label]["score"]))
        answer_inputs = [
            float(item["cutoff_results"][label]["answerCall"]["inputTokens"])
            for item in scored
            if float(item["cutoff_results"][label]["answerCall"]["inputTokens"]) > 0
        ]
        answer_totals = [
            float(item["cutoff_results"][label]["answerCall"]["totalTokens"])
            for item in scored
            if float(item["cutoff_results"][label]["answerCall"]["totalTokens"]) > 0
        ]
        judge_totals = [
            float(item["cutoff_results"][label]["judgeCall"]["totalTokens"])
            for item in scored
            if float(item["cutoff_results"][label]["judgeCall"]["totalTokens"]) > 0
        ]
        answer_latency = [float(item["cutoff_results"][label]["answerCall"]["latencyMs"]) for item in scored]
        judge_latency = [float(item["cutoff_results"][label]["judgeCall"]["latencyMs"]) for item in scored]
        metrics_by_cutoff[label] = {
            "scorePercent": round(statistics.fmean(scores) * 100, 2) if scores else 0,
            "questions": len(scored),
            "passed": sum(1 for score in scores if score >= pass_threshold),
            "passThreshold": pass_threshold,
            "passRatePercent": round(sum(1 for score in scores if score >= pass_threshold) / len(scores) * 100, 2) if scores else 0,
            "byDimension": {
                key: {
                    "scorePercent": round(statistics.fmean(values) * 100, 2),
                    "questions": len(values),
                    "passRatePercent": round(sum(1 for score in values if score >= pass_threshold) / len(values) * 100, 2),
                }
                for key, values in sorted(by_dimension.items())
            },
            "byChatSize": {
                key: {"scorePercent": round(statistics.fmean(values) * 100, 2), "questions": len(values)}
                for key, values in sorted(by_chat_size.items())
            },
            "answerInputTokens": distribution(answer_inputs),
            "answerTotalTokens": distribution(answer_totals),
            "judgeTotalTokens": distribution(judge_totals),
            "tokenUsageStatus": "reported" if len(answer_inputs) == len(scored) else "unavailable" if not answer_inputs else "partial",
            "answerLatencyMs": distribution(answer_latency),
            "judgeLatencyMs": distribution(judge_latency),
        }
    search_latency = [float(item.get("retrieval", {}).get("search_latency_ms", 0)) for item in items]
    evaluation_configs = [item.get("evaluation_config") or {} for item in items]
    return {
        "schema": "hivemindos.standard-memory-evaluation.v1",
        "benchmark": benchmark,
        "devOnly": True,
        "answererModels": sorted({str(config.get("answererModel") or args.answerer_model) for config in evaluation_configs}),
        "judgeModels": sorted({str(config.get("judgeModel") or args.judge_model) for config in evaluation_configs}),
        "endpointProviders": sorted({str(config.get("provider") or "openai-direct") for config in evaluation_configs}),
        "promptSource": {"repository": "mem0ai/memory-benchmarks", "commit": HARNESS_COMMIT, "sha256": PROMPT_SHA256[benchmark]},
        "retrievalTopKLimit": 50,
        "searchLatencyMs": distribution(search_latency),
        "metricsByCutoff": metrics_by_cutoff,
        "completedAt": datetime.now().astimezone().isoformat(),
        "limitations": [
            "HivemindOS production recall exposes at most 50 hits, so Top-200 is not reported.",
            "Scores are model-judge measurements and should be reproduced before public comparison.",
            "BEAM event-ordering tau-b is recorded as skipped; the reported BEAM score is rubric-nugget compliance.",
        ],
    }


async def main() -> None:
    args = parse_args()
    if args.workers < 1:
        raise RuntimeError("--workers must be positive")
    if args.progress_every < 1:
        raise RuntimeError("--progress-every must be positive")
    api_key = os.getenv(args.api_key_env, "").strip() if args.auth_mode == "bearer" else ""
    if args.auth_mode == "bearer" and not api_key:
        raise RuntimeError(f"{args.api_key_env} is required; run through hive-env-run without printing the key")
    cutoffs = sorted({int(value) for value in args.cutoffs.split(",") if value.strip()})
    if not cutoffs or min(cutoffs) < 1 or max(cutoffs) > 50:
        raise RuntimeError("--cutoffs must stay within the product Top-50 limit")
    predictions_dir = Path(args.predictions_dir).resolve()
    prompts = load_prompt_module(args.benchmark, Path(args.harness_root).resolve())
    selected_ids = load_question_ids(args.question_ids)
    paths = sorted(path for path in predictions_dir.glob("*.json") if path.name not in {"retrieval-summary.json", "evaluation-summary.json"})
    items = []
    for path in paths:
        item = json.loads(path.read_text(encoding="utf-8"))
        if not item.get("question_id") or item.get("benchmark") != args.benchmark:
            continue
        if selected_ids and str(item["question_id"]) not in selected_ids:
            continue
        items.append((path, item))
    if args.max_items:
        items = items[: args.max_items]
    if not items:
        raise RuntimeError(f"No {args.benchmark} retrieval outputs found in {predictions_dir}")

    request_semaphore = asyncio.Semaphore(args.workers)
    item_semaphore = asyncio.Semaphore(args.workers)
    provider_order = [provider.strip() for provider in args.provider_order.split(",") if provider.strip()] if args.provider_order else None
    answerer = OpenAIChatClient(args.answerer_model, api_key, request_semaphore, args.base_url, provider_order)
    judge = OpenAIChatClient(args.judge_model, api_key, request_semaphore, args.base_url, provider_order)
    evaluator = {
        "locomo": evaluate_locomo,
        "longmemeval": evaluate_longmemeval,
        "beam": evaluate_beam,
    }[args.benchmark]
    progress = {"done": 0}
    progress_lock = asyncio.Lock()

    async def evaluate_one(path: Path, item: dict[str, Any]) -> dict[str, Any]:
        async with item_semaphore:
            results = item.setdefault("cutoff_results", {})
            for cutoff in cutoffs:
                label = f"top_{cutoff}"
                if label in results and not args.rerun:
                    continue
                results[label] = await evaluator(item, cutoff, prompts, answerer, judge)
                item["evaluation_config"] = {
                    "answererModel": args.answerer_model,
                    "judgeModel": args.judge_model,
                    "provider": args.provider_label,
                    "providerOrder": provider_order,
                    "authMode": args.auth_mode,
                    "promptCommit": HARNESS_COMMIT,
                    "promptSha256": PROMPT_SHA256[args.benchmark],
                }
                write_json_atomic(path, item)
            async with progress_lock:
                progress["done"] += 1
                score = results[f"top_{cutoffs[-1]}"]["score"]
                if progress["done"] % args.progress_every == 0 or progress["done"] == len(items):
                    print(f"[{progress['done']}/{len(items)}] {item['question_id']} score={score:.3f}", flush=True)
            return item

    evaluated = await asyncio.gather(*(evaluate_one(path, item) for path, item in items))
    summary = build_summary(evaluated, args.benchmark, cutoffs, args)
    write_json_atomic(predictions_dir / "evaluation-summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
