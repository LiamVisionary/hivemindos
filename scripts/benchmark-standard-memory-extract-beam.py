#!/usr/bin/env python3
"""Extract BEAM parquet rows into one-conversation JSON files for dev benchmarks."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
from typing import Any

import pyarrow.parquet as parquet


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract official BEAM parquet rows without loading a whole long-context split into memory")
    parser.add_argument("--parquet", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--offset", type=int, default=0, help="Global conversation index for the first row")
    return parser.parse_args()


def normalized_questions(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = ast.literal_eval(value)
    except (ValueError, SyntaxError):
        parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("BEAM probing_questions did not decode to an object")
    return parsed


def main() -> None:
    args = parse_args()
    source = Path(args.parquet).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    reader = parquet.ParquetFile(source)
    columns = ["conversation_id", "conversation_seed", "user_profile", "chat", "probing_questions"]
    written = []
    for local_index, batch in enumerate(reader.iter_batches(batch_size=1, columns=columns)):
        row = batch.to_pylist()[0]
        global_index = args.offset + local_index
        conversation = {
            "conversation_id": row.get("conversation_id") or f"conversation_{global_index}",
            "conversation_seed": row.get("conversation_seed") or {},
            "user_profile": row.get("user_profile") or {},
            "chat": row.get("chat") or [],
            "probing_questions": normalized_questions(row.get("probing_questions")),
        }
        path = output_dir / f"{global_index:03d}.json"
        path.write_text(json.dumps([conversation], ensure_ascii=False) + "\n", encoding="utf-8")
        written.append({"index": global_index, "file": path.name, "bytes": path.stat().st_size})
        print(f"[{local_index + 1}/{reader.metadata.num_rows}] {path.name} {path.stat().st_size} bytes", flush=True)
    manifest = {
        "schema": "hivemindos.beam-extract.v1",
        "source": source.name,
        "sourceSha256": digest,
        "sourceRows": reader.metadata.num_rows,
        "offset": args.offset,
        "files": written,
        "devOnly": True,
    }
    (output_dir / f"manifest-{args.offset:03d}.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
