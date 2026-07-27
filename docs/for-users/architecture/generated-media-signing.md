---
title: "Generated Media Signing"
---

# Generated Media Signing

How generated images reach phone clients privately: hub-side caching plus
short-lived signed URLs, so media only ever travels hub → client over the
tailnet.

## Why this exists

Connected image apps (ComfyUI, Image Studio, Z-Image, LocalAI, …) usually
answer with URLs that only resolve from the hub machine itself
(`http://127.0.0.1:7860/…`), or with inline `data:` payloads. The dashboard
browser runs on the hub, so it can fetch those directly. A phone cannot — and
native image loaders on the phone carry neither the dashboard session cookie
nor the device-token header, so they also can't pass normal dashboard auth.

The answer is two pieces, both under `src/lib/services/chat/`:

1. **Cache** (`generated-media-cache.ts`) — `cacheGeneratedImageForPhone(url)`
   pulls each result onto hub disk at
   `~/.hivemindos/cache/generated-media/<sha256 of source>.<ext>`. Accepts
   hub-local `generated-media` paths, `data:image/…` payloads, and HTTP(S)
   URLs (fetched by the hub, which _can_ reach them). Validates by magic
   number, caps at 64 MB.
2. **Signing** (`generated-media-signing.ts`) — mints and verifies
   path-scoped, expiring HMAC capabilities for `/api/chat/generated-media`.

## The URL contract

```
/api/chat/generated-media?path=<absolute path>&exp=<epoch ms>&sig=<hex hmac>
sig = HMAC-SHA256(secret, "generated-media.v1\n<path>\n<exp>")
```

- Scope: one absolute path and one expiry. A leaked URL grants exactly one
  already-generated file, until `exp` (default TTL 1 hour,
  `DEFAULT_SIGNED_MEDIA_TTL_MS`).
- Verification is constant-time and rejects malformed `exp`/`sig` shapes
  outright.
- Secret: `HIVEMINDOS_DASHBOARD_AUTH_SECRET` when configured — rotating it
  invalidates every outstanding URL. Hubs without dashboard auth get a
  per-install random secret at `~/.hivemindos/generated-media-signing.secret`
  (created 0600 on first use).

`/api/chat/generated-media` accepts a valid signature **or** normal dashboard
auth (session cookie / device token) — the signature path is an alternative
for native loaders, never a replacement. Either way the route keeps its own
safety checks: image extensions only, magic-number validation, size cap. The
route authenticates itself, so it belongs to the self-authenticating
allowlist in `src/proxy.ts`.

## Phone image generation flow

`POST /api/phone` with `action: "image-generation"` (used by HivemindOS
Mobile's `/image-gen` command):

1. Runs the same orchestration as the dashboard's
   `/api/chat/image-generation` — both are thin wrappers over
   `runChatImageGeneration()` in `src/lib/services/chat/image-generation.ts`
   (connected-app discovery, scoring, endpoint probing, job polling,
   generation metrics).
2. Caches every result image onto hub disk (piece 1 above).
3. Answers with signed relative URLs (piece 2), plus app/model/machine
   metadata.

The client is expected to download each image **once**, promptly, and store
it locally — signed URLs are transport, not storage. Expiry is deliberately
short; history should render from the client's own copy.

Net effect: the image crosses exactly one client-visible network boundary —
hub → phone, inside the WireGuard-encrypted tailnet. The phone never talks to
the image app, and no media transits any third-party service.
