---
name: video-shot-transcript
description: 'Use when a user asks to dissect a local video into unique shots, angles, poses, or frame divisions and wants the transcript or visible captions aligned to each division. Trigger for "break this video down", "dissect by frames", "unique angles", "shot list", "transcript at each cut", "describe every scene", TikTok/Reels/Shorts analysis, or any request to produce timestamp ranges like `0:00-0:02: "..." | visual description`.'
---

# Video Shot Transcript

Create a timestamped shot list that combines visual angle/pose changes with spoken transcript, embedded subtitles, or on-screen captions.

## Output Shape

Default to this compact format unless the user asks for a table:

```text
0:00-0:02.3: "This is a message to all finance bros" | man sitting at a desk, hands steepled in front of him, looking at the camera; dark office, map behind him, keyboard in foreground.
0:02.3-0:03.2: no captioned dialogue | full-body silhouette on a pale gray background, hand to chin in a thinking pose, looking slightly downward.
```

Use `no captioned dialogue`, `onscreen text: "..."`, or `transcript uncertain: "..."` instead of inventing words.

## Privacy Rule

Treat user-supplied local media as private by default.

- Do not upload audio, video, frames, or transcripts to an external transcription or vision service unless the user explicitly approves that transfer after being told what will be uploaded.
- Try local sources first: embedded subtitles, visible captions through OCR, local ASR tools, and manual frame inspection.
- If a cloud transcription would materially improve the result, ask for approval in plain language and continue with local evidence if approval is not granted.

## Workflow

1. Probe the media with `ffprobe` and record duration, FPS, dimensions, streams, and embedded subtitle tracks.
2. Detect candidate visual cuts with FFmpeg scene detection. Start around `scene=0.15`; raise toward `0.26` if there are too many false positives, lower toward `0.08` for subtle cuts.
3. Generate contact sheets at 1-3 fps and representative frames at segment midpoints. Inspect the sheets visually; scene detection finds cuts, but the agent decides which angles are unique.
4. Gather transcript evidence in this order:
   - Embedded subtitles/captions if present.
   - On-screen captions via local OCR, usually `tesseract`.
   - Local audio transcription if a local tool is already installed (`whisper`, `whisper-cli`, `whisper-cpp`, `faster-whisper`, or similar).
   - Cloud transcription only after explicit approval.
5. Align words/captions to the shot boundaries. When caption timing is approximate, use the visual caption appearance times and explain uncertainty only where it matters.
6. Write the final shot list all the way to the end of the video. Preserve short transition flashes when they are visually meaningful; otherwise merge near-duplicate cut detections into the surrounding shot.

## Helper Script

If this skill directory has `scripts/dissect_video.py`, use it for the mechanical pass:

```bash
python3 scripts/dissect_video.py /path/to/video.mp4 --out /tmp/video-shot-transcript
```

The script writes:

- `manifest.json` with probe metadata, detected cuts, and segment ranges.
- `representative-frames/` midpoint frames for each segment.
- `contact-sheet-1fps.jpg` and `contact-sheet-2fps.jpg` when FFmpeg can create them.
- `ocr.tsv` when `tesseract` is installed.
- `audio.wav` for local ASR or user-approved transcription.
- `draft.md` as a rough local-only starting point.

The script output is not the final answer. Use it to reduce grunt work, then inspect frames and clean the transcript.

## Manual Commands

Probe:

```bash
ffprobe -hide_banner -v error -show_format -show_streams /path/to/video.mp4
```

Detect cuts:

```bash
ffmpeg -hide_banner -i /path/to/video.mp4 \
  -vf "select='gt(scene,0.15)',showinfo" \
  -f null -
```

Generate contact sheets:

```bash
ffmpeg -hide_banner -y -i /path/to/video.mp4 \
  -vf "fps=2,scale=144:-1,tile=9x6:padding=6:margin=6:color=white" \
  -frames:v 1 -update 1 /tmp/video-2fps-sheet.jpg
```

Extract local transcription audio:

```bash
ffmpeg -hide_banner -y -i /path/to/video.mp4 \
  -vn -ac 1 -ar 16000 -c:a pcm_s16le /tmp/video-audio.wav
```

OCR sampled frames:

```bash
ffmpeg -hide_banner -y -i /path/to/video.mp4 -vf fps=3 /tmp/video-frames/frame_%04d.jpg
for f in /tmp/video-frames/frame_*.jpg; do
  tesseract "$f" stdout --psm 6 2>/dev/null
done
```

## Visual Description Guidance

- Name the shot type when clear: desk medium shot, side profile, extreme close-up, full-body silhouette, cash close-up, title card, transition flash.
- Capture pose, gaze, camera distance, lighting, background, and important foreground objects.
- Mention visible text separately from spoken transcript when the video uses title cards.
- Do not over-describe tiny movements inside a continuous shot unless the user asked for frame-level motion.
- Keep timestamps precise enough to be useful. Tenths of a second are fine for short social clips.

## Final Check

Before replying:

- Confirm the segments cover `0:00` through the actual end time.
- Check that no transcript phrase is assigned to a shot where it is not visible/heard.
- Mark uncertain transcript instead of guessing.
- If audio was not transcribed locally and no external upload was approved, say the transcript came from visible captions or embedded subtitles.
