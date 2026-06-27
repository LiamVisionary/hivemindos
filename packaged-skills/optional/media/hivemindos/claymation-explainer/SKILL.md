---
name: claymation-explainer
description: Use when a user wants a playful claymation-style explainer, ad, launch video, product story, or short educational animation with storyboard, character references, voiceover, generated clips, captions, and final assembly.
---

# Claymation Explainer

Produce a claymation-style explainer workflow from brief to verified video.

## Inputs

- Product/topic, audience, duration, aspect ratio, message, CTA, and brand constraints.
- Required voice, captions, and delivery format.
- Whether to generate media or only create the production plan and prompts.

## Workflow

1. Write a simple story spine: problem, character, discovery, mechanism, outcome, CTA.
2. Create a shot list with duration, action, text/caption, voiceover line, and required asset.
3. Generate character references first. Keep identity, materials, colors, and proportions consistent.
4. Generate scene stills before motion. Verify they match the storyboard and do not contain broken text.
5. Generate clips through a discovered video provider. Use short shots and stable camera directions.
6. Generate or record voiceover. Ask before cloning or uploading a private voice sample.
7. Assemble with captions, music/SFX if approved, and local QA.

## Capability Map

- Image/video generation: use configured media capabilities and verify every asset.
- Audio: TTS/local voice services when available; external voice upload needs approval.
- Assembly: use FFmpeg, `short-video-assembly`, `subtitle-timing`, and `video-render-qa` where available.

## QA Checklist

- Character remains recognizable.
- Captions are readable on mobile.
- Product claims are approved.
- Audio and captions align.
- Final file plays start to finish.

## Provenance

This is a HivemindOS-authored clean-room skill inspired by a public skill catalog. No unlicensed upstream text, JSON, or scripts are copied.
