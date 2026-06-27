---
name: claymation-podcast-clip
description: Use when a user wants to transform a podcast/audio clip and speaker reference into a claymation-style short video with storyboarded scenes, captions, original audio preservation, and render QA.
---

# Claymation Podcast Clip

Turn a spoken clip into a stylized short while preserving the original meaning and audio.

## Contract

Use only audio and speaker images the user owns, has permission to use, or that are clearly licensed for the requested use. Do not clone voices; preserve the supplied audio unless the user explicitly asks for a separate narration workflow.

## Inputs

- Audio or video clip.
- Speaker reference photo if likeness styling is requested.
- Target duration, aspect ratio, caption style, and platform.
- Output: storyboard, prompts, generated clips, final video, or review packet.

## Workflow

1. Transcribe or accept the transcript. Use local transcription when possible; external transcription needs approval for private audio.
2. Split the clip into 2 to 4 second semantic beats.
3. For each beat, write one visual scene that reinforces the idea without literal overclutter.
4. Generate a clay figure reference and environment guide if likeness use is allowed.
5. Generate beat stills and clips. Keep identity consistent but avoid pretending the stylized figure is real footage.
6. Burn captions from the verified transcript. Preserve original audio.
7. Render and QA audio sync, caption timing, frame nonblankness, and file playback.

## Safety

- Do not use a speaker's likeness for deceptive endorsement or political persuasion.
- Do not publish clips without rights and approval.
- Do not upload private audio externally without explicit approval.

## Provenance

This is a HivemindOS-authored clean-room skill inspired by a public skill catalog. No unlicensed upstream text, JSON, or scripts are copied.
