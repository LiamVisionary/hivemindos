#!/usr/bin/env python3
"""Local helper for video shot/transcript breakdowns.

This script intentionally stays local-only. It probes a video, detects scene
cuts, extracts representative frames/contact sheets, runs OCR when tesseract is
available, and writes a rough draft for an agent to clean up.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(args: list[str], *, capture: bool = True, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if check and result.returncode != 0:
        combined = "\n".join(part for part in [result.stdout, result.stderr] if part)
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(args)}\n{combined}")
    return result


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"Required tool not found on PATH: {name}")
    return path


def probe_video(video: Path) -> dict:
    require_tool("ffprobe")
    result = run(
        [
            "ffprobe",
            "-hide_banner",
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            str(video),
        ]
    )
    return json.loads(result.stdout)


def duration_from_probe(probe: dict) -> float:
    fmt = probe.get("format") or {}
    try:
        return float(fmt.get("duration") or 0)
    except (TypeError, ValueError):
        return 0.0


def detect_scene_cuts(video: Path, threshold: float, min_gap: float) -> list[float]:
    require_tool("ffmpeg")
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(video),
            "-vf",
            f"select='gt(scene,{threshold})',showinfo",
            "-f",
            "null",
            "-",
        ],
        capture=True,
        check=False,
    )
    text = "\n".join(part for part in [result.stdout, result.stderr] if part)
    raw = sorted(float(match.group(1)) for match in re.finditer(r"pts_time:([0-9.]+)", text))
    cuts: list[float] = []
    for value in raw:
        if not cuts or value - cuts[-1] >= min_gap:
            cuts.append(value)
    return cuts


def segment_ranges(cuts: list[float], duration: float) -> list[dict]:
    points = [0.0]
    for cut in cuts:
        if 0 < cut < duration and cut - points[-1] > 0.02:
            points.append(cut)
    if duration > points[-1]:
        points.append(duration)
    segments = []
    for index, (start, end) in enumerate(zip(points, points[1:]), start=1):
        if end - start <= 0.02:
            continue
        segments.append(
            {
                "index": index,
                "start": round(start, 3),
                "end": round(end, 3),
                "midpoint": round(start + ((end - start) / 2), 3),
            }
        )
    return segments


def extract_frame(video: Path, output: Path, timestamp: float) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{timestamp:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(output),
        ],
        capture=True,
    )


def make_contact_sheet(video: Path, output: Path, fps: int, scale_width: int, tile: str) -> bool:
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-vf",
            f"fps={fps},scale={scale_width}:-1,tile={tile}:padding=6:margin=6:color=white",
            "-frames:v",
            "1",
            "-update",
            "1",
            str(output),
        ],
        capture=True,
        check=False,
    )
    return result.returncode == 0 and output.exists()


def sample_frames(video: Path, frames_dir: Path, fps: int) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("frame_*.jpg"):
        old.unlink()
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-vf",
            f"fps={fps}",
            str(frames_dir / "frame_%04d.jpg"),
        ],
        capture=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(frames_dir.glob("frame_*.jpg"))


def run_ocr(frames: list[Path], fps: int, output: Path) -> list[dict]:
    if not shutil.which("tesseract"):
        output.write_text("time\ttext\n", encoding="utf-8")
        return []
    rows = []
    with output.open("w", encoding="utf-8") as handle:
        handle.write("time\ttext\n")
        for frame in frames:
            match = re.search(r"frame_(\d+)\.jpg$", frame.name)
            if not match:
                continue
            timestamp = (int(match.group(1)) - 1) / fps
            result = run(["tesseract", str(frame), "stdout", "--psm", "6"], capture=True, check=False)
            text = re.sub(r"\s+", " ", result.stdout or "").strip()
            if not text:
                continue
            rows.append({"time": round(timestamp, 3), "text": text})
            handle.write(f"{timestamp:.3f}\t{text}\n")
    return rows


def extract_audio(video: Path, output: Path) -> bool:
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output),
        ],
        capture=True,
        check=False,
    )
    return result.returncode == 0 and output.exists()


def collect_ocr_for_segment(rows: list[dict], start: float, end: float) -> str:
    texts = [row["text"] for row in rows if start <= float(row["time"]) < end]
    compact: list[str] = []
    previous = ""
    for text in texts:
        if text == previous:
            continue
        compact.append(text)
        previous = text
    return " / ".join(compact)


def format_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    rest = seconds - (minutes * 60)
    if math.isclose(rest, round(rest), abs_tol=0.05):
        return f"{minutes}:{int(round(rest)):02d}"
    return f"{minutes}:{rest:04.1f}".rstrip("0").rstrip(".")


def write_draft(path: Path, segments: list[dict], ocr_rows: list[dict], source: Path) -> None:
    lines = [
        f"# Video Shot Transcript Draft",
        "",
        f"Source: `{source}`",
        "",
        "This is a mechanical draft. Inspect the representative frames and clean the OCR/transcript before sending a final answer.",
        "",
    ]
    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        ocr = collect_ocr_for_segment(ocr_rows, start, end)
        transcript = f'"{ocr}"' if ocr else "no local caption text found"
        frame = f"representative-frames/segment_{segment['index']:03d}_{segment['midpoint']:.3f}.jpg"
        lines.append(f"{format_time(start)}-{format_time(end)}: {transcript} | [describe visual angle/pose from `{frame}`]")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create local artifacts for a video shot/transcript breakdown.")
    parser.add_argument("video", help="Path to the video file")
    parser.add_argument("--out", help="Output directory. Defaults to /tmp/video-shot-transcript-<stem>")
    parser.add_argument("--scene-threshold", type=float, default=0.15)
    parser.add_argument("--min-cut-gap", type=float, default=0.2)
    parser.add_argument("--ocr-fps", type=int, default=3)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    video = Path(args.video).expanduser().resolve()
    if not video.exists():
        print(f"Video not found: {video}", file=sys.stderr)
        return 2

    out = Path(args.out).expanduser().resolve() if args.out else Path(f"/tmp/video-shot-transcript-{video.stem}").resolve()
    out.mkdir(parents=True, exist_ok=True)

    probe = probe_video(video)
    duration = duration_from_probe(probe)
    cuts = detect_scene_cuts(video, args.scene_threshold, args.min_cut_gap)
    segments = segment_ranges(cuts, duration)

    representative_dir = out / "representative-frames"
    for segment in segments:
        frame_name = f"segment_{segment['index']:03d}_{segment['midpoint']:.3f}.jpg"
        extract_frame(video, representative_dir / frame_name, float(segment["midpoint"]))

    make_contact_sheet(video, out / "contact-sheet-1fps.jpg", 1, 180, "7x4")
    make_contact_sheet(video, out / "contact-sheet-2fps.jpg", 2, 144, "9x6")

    frames = sample_frames(video, out / "ocr-frames", max(1, args.ocr_fps))
    ocr_rows = run_ocr(frames, max(1, args.ocr_fps), out / "ocr.tsv")
    audio_ok = extract_audio(video, out / "audio.wav")

    manifest = {
        "source": str(video),
        "output": str(out),
        "duration": duration,
        "sceneThreshold": args.scene_threshold,
        "minCutGap": args.min_cut_gap,
        "cuts": cuts,
        "segments": segments,
        "tools": {
            "ffmpeg": bool(shutil.which("ffmpeg")),
            "ffprobe": bool(shutil.which("ffprobe")),
            "tesseract": bool(shutil.which("tesseract")),
        },
        "artifacts": {
            "audioWav": "audio.wav" if audio_ok else None,
            "ocrTsv": "ocr.tsv",
            "contactSheets": [
                name
                for name in ["contact-sheet-1fps.jpg", "contact-sheet-2fps.jpg"]
                if (out / name).exists()
            ],
        },
        "probe": probe,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    write_draft(out / "draft.md", segments, ocr_rows, video)

    print(json.dumps({"ok": True, "out": str(out), "segments": len(segments), "cuts": len(cuts)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
