---
name: social-video-publishing
description: Use when the user explicitly asks to publish, cross-post, upload, schedule, or dry-run videos to TikTok, Instagram, YouTube Shorts, Upload-Post, or similar social platforms. Includes safe gating, captions, hashtags, credential checks, and no-auto-post guardrails.
---

# Social Video Publishing

Publishing is a separate, explicit action after rendering.

## Hard Gate

Do not publish, cross-post, schedule, or enable auto-upload unless the user explicitly asks for live publishing or scheduling.

Allowed without explicit live intent:

- Credential presence checks.
- Dry-run validation.
- Caption/title/hashtag drafting.
- API capability inspection.

## Env

Use `~/.hivemindos/.env` and verify only presence, never values. Common names:

- `UPLOAD_POST_API_KEY`
- `UPLOAD_POST_USERNAME`
- Platform-specific OAuth/client variables when a project uses them.

## Workflow

1. Confirm the user wants live publish, schedule, or dry run.
2. Run `video-render-qa` on the asset first.
3. Prepare title, caption, hashtags, target platforms, and visibility.
4. Verify credentials are present without printing secrets.
5. Prefer dry-run or private/unlisted modes when testing.
6. Execute upload through the project's existing API/client.
7. Return platform result URLs or explicit failure messages.

## Guardrails

- Never turn on auto-upload as a side effect of setup.
- Never publish placeholder/test content unless the user explicitly asks.
- Preserve platform rate limits and retries; avoid upload loops.
