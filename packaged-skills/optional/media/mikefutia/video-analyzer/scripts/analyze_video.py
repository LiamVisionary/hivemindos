#!/usr/bin/env python3
"""
Video Analyzer — route a video file through the Gemini API for analysis.

Usage:
    python analyze_video.py <path-to-video> [--prompt "..."] [--fps N] [--model ...]

Env:
    GEMINI_API_KEY / GOOGLE_AI_STUDIO_API_KEY / GOOGLE_API_KEY — one required.
"""

import argparse
import os
import sys
import time
from pathlib import Path

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("ERROR: google-genai is not installed.", file=sys.stderr)
    print("Install google-genai==1.64.0 in an approved isolated virtual environment.", file=sys.stderr)
    sys.exit(1)


DEFAULT_PROMPT = """Analyze this video and return a structured markdown report with these exact sections.

CRITICAL ACCURACY RULES — follow these before anything else:
1. Only report what is ACTUALLY in the video. Do not infer, guess, or fill in plausible-sounding content. Many videos have silent audio tracks, no narration, no on-screen speaker, or no branding — this is NORMAL and you must report it accurately.
2. NEVER invent a presenter, creator, narrator, or speaker name. If no name is shown on screen or clearly spoken aloud, the video has no identified creator — say so.
3. NEVER fabricate a voiceover, dialogue, or transcript. If the audio track is silent, near-silent, or contains no speech, say "No speech detected" or "Audio track is silent."
4. Distinguish between what you SEE (high confidence) and what you INFER (lower confidence). If you must infer, label it: "(inferred)".
5. Screen recordings often have no audio at all, or only ambient keyboard/mouse noise. This is the default expectation, not an anomaly.

## Top-Level Summary
A 2-3 sentence overview of what actually happens in the video. Describe only what is demonstrably visible. Do not speculate about the creator's intent or identity.

## Scene-by-Scene Breakdown
Walk through the video in order, with `MM:SS` timestamps for each distinct scene, cut, or moment. For each scene, describe only what is actually visible:
- On-screen content (UI elements, text, images, products, people if clearly shown)
- Actions happening on screen (clicks, scrolls, cuts, transitions)
- Any visible on-screen text verbatim

## Audio
Report ONLY what you actually hear. Possible valid answers:
- "No audio track present" (if the file has no audio stream)
- "Audio track is silent — no speech, music, or sound effects detected" (if the track exists but contains no meaningful sound)
- "Ambient sound only: [describe, e.g. keyboard clicks, room tone]"
- A verbatim transcript of any speech with `MM:SS` timestamps, IF speech is actually present
- A description of music or sound effects, IF they are actually present

Do NOT invent a voiceover. Do NOT describe an "enthusiastic narrator" or attribute speech to anyone. If in doubt, say the audio is silent or unclear.

## Visual Details
List important visual elements that are actually visible on screen:
- On-screen text and captions (quote verbatim where possible)
- UI elements, app interfaces, tools being used (name them only if clearly identifiable)
- Product details, packaging, branding (only if actually shown)
- Anyone visible on screen (describe what you see — "a person in a webcam overlay" — do NOT invent a name)

## Key Moments
3-7 bulleted timestamped moments that a viewer would actually remember. Format: `[MM:SS] Description`. Base these only on what actually happens visually.

Be specific and concrete. When uncertain, say so. Prioritize accuracy over completeness — it is better to report less with confidence than more with confabulation."""


# Gemini inline upload cap is 20MB for total request size. Leave headroom for the prompt.
INLINE_SIZE_LIMIT_BYTES = 18 * 1024 * 1024

# How long to wait for Files API processing before giving up.
FILE_PROCESSING_TIMEOUT_SEC = 300
FILE_PROCESSING_POLL_INTERVAL_SEC = 3

SUPPORTED_EXTENSIONS = {
    ".mp4", ".mpeg", ".mpg", ".mov", ".avi",
    ".flv", ".webm", ".wmv", ".3gpp", ".3gp",
}

MIME_TYPES = {
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpg",
    ".mov": "video/quicktime",
    ".avi": "video/avi",
    ".flv": "video/x-flv",
    ".webm": "video/webm",
    ".wmv": "video/wmv",
    ".3gpp": "video/3gpp",
    ".3gp": "video/3gpp",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Analyze a video with the Gemini API.")
    parser.add_argument("video_path", help="Path to the video file")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Custom analysis prompt")
    parser.add_argument("--fps", type=float, default=None, help="Custom frame rate for sampling")
    parser.add_argument("--model", default="gemini-3-flash", help="Gemini model ID")
    parser.add_argument("--confirm-upload", action="store_true", help="Confirm the user approved sending this video to Google Gemini")
    return parser.parse_args()


def validate_inputs(video_path: str) -> Path:
    path = Path(video_path).expanduser().resolve()
    if not path.exists():
        print(f"ERROR: File not found: {path}", file=sys.stderr)
        sys.exit(1)
    if not path.is_file():
        print(f"ERROR: Not a file: {path}", file=sys.stderr)
        sys.exit(1)
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        print(
            f"ERROR: Unsupported extension '{path.suffix}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            file=sys.stderr,
        )
        sys.exit(1)
    return path


def get_api_key() -> str:
    for key_name in ("GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_API_KEY"):
        key = os.environ.get(key_name)
        if key:
            return key
    print(
        "ERROR: No supported Gemini API credential is set.\n"
        "Configure GEMINI_API_KEY, GOOGLE_AI_STUDIO_API_KEY, or GOOGLE_API_KEY through approved credential settings.",
        file=sys.stderr,
    )
    sys.exit(1)


def delete_uploaded_file(client: genai.Client, uploaded_name: str) -> None:
    try:
        client.files.delete(name=uploaded_name)
        print("[info] Deleted the temporary Gemini Files API upload.", file=sys.stderr)
    except Exception as error:
        print(
            f"[warning] Gemini upload cleanup failed ({type(error).__name__}); Google's documented 48-hour retention may apply.",
            file=sys.stderr,
        )


def build_video_part(client: genai.Client, path: Path, fps: float | None) -> tuple[types.Part, str | None]:
    """Return a types.Part with the video attached, using inline data or Files API as appropriate."""
    size = path.stat().st_size
    mime_type = MIME_TYPES.get(path.suffix.lower(), "video/mp4")

    video_metadata = types.VideoMetadata(fps=fps) if fps else None

    if size <= INLINE_SIZE_LIMIT_BYTES:
        print(f"[info] Uploading inline ({size / 1024 / 1024:.1f} MB)...", file=sys.stderr)
        video_bytes = path.read_bytes()
        return (
            types.Part(
                inline_data=types.Blob(data=video_bytes, mime_type=mime_type),
                video_metadata=video_metadata,
            ),
            None,
        )

    print(f"[info] File is {size / 1024 / 1024:.1f} MB. Uploading via Files API...", file=sys.stderr)
    uploaded = client.files.upload(file=str(path))
    print(f"[info] Uploaded as {uploaded.name}. Waiting for processing...", file=sys.stderr)

    elapsed = 0
    while elapsed < FILE_PROCESSING_TIMEOUT_SEC:
        try:
            refreshed = client.files.get(name=uploaded.name)
            state = getattr(refreshed.state, "name", str(refreshed.state))
        except BaseException:
            delete_uploaded_file(client, uploaded.name)
            raise
        if state == "ACTIVE":
            print(f"[info] File processed in {elapsed}s.", file=sys.stderr)
            return (
                types.Part(
                    file_data=types.FileData(
                        file_uri=refreshed.uri,
                        mime_type=refreshed.mime_type or mime_type,
                    ),
                    video_metadata=video_metadata,
                ),
                uploaded.name,
            )
        if state == "FAILED":
            delete_uploaded_file(client, uploaded.name)
            print("ERROR: Gemini failed to process the uploaded file.", file=sys.stderr)
            sys.exit(1)
        time.sleep(FILE_PROCESSING_POLL_INTERVAL_SEC)
        elapsed += FILE_PROCESSING_POLL_INTERVAL_SEC

    delete_uploaded_file(client, uploaded.name)
    print(f"ERROR: File processing timed out after {FILE_PROCESSING_TIMEOUT_SEC}s.", file=sys.stderr)
    sys.exit(1)


def analyze(video_path: Path, prompt: str, fps: float | None, model: str) -> str:
    api_key = get_api_key()
    client = genai.Client(api_key=api_key)

    uploaded_name = None
    try:
        video_part, uploaded_name = build_video_part(client, video_path, fps)
        text_part = types.Part(text=prompt)

        print(f"[info] Running analysis with {model}...", file=sys.stderr)
        response = client.models.generate_content(
            model=model,
            contents=types.Content(parts=[video_part, text_part]),
        )
        return response.text or "(no response text returned)"
    finally:
        if uploaded_name:
            delete_uploaded_file(client, uploaded_name)


def main():
    args = parse_args()
    if not args.confirm_upload:
        print(
            "ERROR: External upload not confirmed. Obtain explicit user approval for this video, then pass --confirm-upload.",
            file=sys.stderr,
        )
        sys.exit(2)
    path = validate_inputs(args.video_path)
    result = analyze(path, args.prompt, args.fps, args.model)
    print(result)


if __name__ == "__main__":
    main()
