---
name: video-analyzer
description: Use when the user explicitly wants a local video sent to Google Gemini for a structured, timestamped report covering scenes, visible text, audio, visual details, and key moments. Requires approval for the specific upload, a named Gemini API credential, and the pinned google-genai dependency; prefer local-only video analysis when external upload is unnecessary.
license: MIT
argument-hint: <path/to/video.mp4> [--prompt "..."] [--fps N] [--model ...]
disable-model-invocation: true
allowed-tools: Bash, Read
---
# Analyze Video

Analyze a video file with Gemini and return a structured markdown report.

## HivemindOS Integration

- This is an optional external media-analysis workflow. Prefer the local-only `video-shot-transcript` skill unless the user specifically chooses Gemini or needs Gemini's native video understanding.
- Before every run, name the exact video path, explain that the complete video and prompt will be sent to Google, identify the selected model, and obtain explicit approval for that upload. Confirm the user has the right to share the material and call out sensitive meeting, customer, health, financial, or identity content.
- Files up to 18 MB are sent inline. Larger files use Google's Files API; the helper requests deletion after analysis, but if cleanup fails Google documents retention for up to 48 hours.
- Check only whether `GEMINI_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`, or `GOOGLE_API_KEY` is set. Never ask the user to paste a key into chat, print a key, inspect arbitrary env files, or modify a shell profile.
- Installing or updating Python or `google-genai` is a separate side effect. Require approval, use an isolated virtual environment, pin `google-genai==1.64.0`, upgrade pip first, and never use a global install or `--break-system-packages`.
- The script's `--confirm-upload` flag is a technical consent gate, not a substitute for user approval. Add it only after the approval above.

## Prerequisites

- Python 3.10+
- `google-genai==1.64.0` installed in an isolated Python environment after explicit approval
- One supported Gemini credential available through the project environment first or the shared hive env as fallback: `GEMINI_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`, or `GOOGLE_API_KEY`

## Steps

1. Parse the arguments from `$ARGUMENTS`:
   - **video path** (required) — path to the video file
   - **--prompt** (optional) — custom analysis prompt; defaults to a structured-report prompt with anti-hallucination rules
   - **--fps** (optional) — custom frame sampling rate (useful for catching sub-second cuts in fast-paced footage)
   - **--model** (optional) — Gemini model ID; defaults to stable `gemini-3-flash`

2. Verify the video file exists at the given path. If not, report the error and stop.

3. Run the analysis script using the absolute path to its install location:

```bash
hive-env-run -- "<PYTHON_WITH_GOOGLE_GENAI>" "<INSTALLED_SKILL_DIR>/scripts/analyze_video.py" "$VIDEO_PATH" --confirm-upload
```

4. The script will:
   - Upload the approved video — inline for files ≤18MB, Files API for larger files (with up-to-300s polling for ACTIVE state and a best-effort delete after analysis)
   - Send the prompt to Gemini with the video attached
   - Print the full markdown report to stdout (info/progress lines go to stderr)

5. Capture stdout and present the report to the user.

6. If the script exits with an error, help the user troubleshoot:
   - **Missing API key**: run `hive-env-check` separately for `GEMINI_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`, and `GOOGLE_API_KEY`; report set or missing status only and never print a credential value.
   - **Unsupported format**: must be one of mp4, mov, avi, webm, mpeg, mpg, wmv, 3gpp, 3gp, flv
   - **Upload timeout**: large file or slow connection — retry, or use a shorter clip
   - **Model error / 404**: try a different model with `--model gemini-2.5-flash`

## Output

A markdown report printed to stdout with these sections:

- **Top-Level Summary** — 2-3 sentence overview of what actually happens
- **Scene-by-Scene Breakdown** — `MM:SS` timestamps for each cut/scene with on-screen content, actions, and verbatim text
- **Audio** — verbatim transcript with timestamps, OR an honest "no audio / silent / ambient only" note (the prompt explicitly forbids inventing narrators)
- **Visual Details** — on-screen text, UI elements, products, branding, people
- **Key Moments** — 3-7 timestamped highlights a viewer would remember
