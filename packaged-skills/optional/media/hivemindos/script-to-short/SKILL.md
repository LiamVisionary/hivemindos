---
name: script-to-short
description: Use when generating short-form video scripts, narration, titles, hashtags, search terms, or structured creative briefs for TikTok, Reels, Shorts, faceless videos, ads, explainers, or stock-media-driven video generation.
---

# Script To Short

Turn a topic into structured short-form video inputs.

## Output Shape

Return structured data when possible:

```json
{
  "script": "",
  "search_terms": [],
  "title": "",
  "caption": "",
  "hashtags": [],
  "duration_target_seconds": 0,
  "style_notes": ""
}
```

## Workflow

1. Clarify platform, audience, duration, tone, and CTA only if missing details would change the result.
2. Write narration for spoken delivery, not essay text.
3. Keep sentences short enough for TTS and subtitles.
4. Generate visual search terms that map to concrete footage, not abstract slogans.
5. Include title/caption/hashtags only if useful for the requested workflow.
6. If the result will feed a renderer, avoid markdown and return plain structured fields.

## Defaults

- Use 15-30 seconds for short-form when unspecified.
- Favor one clear idea over a list of tips unless the user asks for a list format.
- For stock-media videos, search terms should describe visible scenes, objects, locations, and actions.
