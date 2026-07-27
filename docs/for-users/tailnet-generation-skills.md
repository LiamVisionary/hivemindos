---
title: "Tailnet Generation Skills"
---

# Tailnet Generation Skills

HivemindOS can document private generation services as shared skills.

These skills are not the services themselves. They are reusable operating recipes. They tell agents how to call a local or Tailnet generation endpoint, how to verify the output, and where to add future providers.

The bundled templates live in the app repo under:

```text
skills/
```

During setup, HivemindOS seeds those bundled skills into the shared vault shelf:

```text
<shared-vault>/Skills/
```

Agents then discover them through the shared-skill index at:

```text
<shared-vault>/Skills/README.md
```

## Bundled Generation Skills

HivemindOS currently bundles three generation-skill templates:

- `tailscale-generation-skill-authoring`
  - explains how to add or update Tailnet/local generation skills
  - defines category routing rules
  - provides a provider-block template
- `comfyui-image-generation`
  - home for image generation providers
  - includes Tailnet and local image-generation templates
  - includes a Z-Image provider template
- `localtts`
  - home for TTS / speech generation providers
  - includes Tailnet and local TTS templates
  - includes a basic endpoint contract: `/health`, `/v1/models`, `GET /v1/voices`, `/voices`, `/v1/voices/<voice-id>`, `POST /v1/voices`, `/v1/audio/speech`, `/tts/synthesize`, `/synthesize`, `/api/tts`, `/openapi.json`, and `/docs`
  - includes a Qwen3-TTS provider template

These templates are deliberately abstract. The app bundle should not ship a user's private Tailnet IPs, personal machine names, prompts, voice samples, or local filesystem paths. Those details belong in the user's shared vault copy after setup.

## Category Routing

Generation providers should be organized by output type, not by individual model or machine.

Use these homes:

- Image generation: `comfyui-image-generation`
  - ComfyUI, Z-Image, Flux, SDXL, Stable Diffusion, inpainting, image editing
- TTS / speech audio: `localtts`
  - Qwen3-TTS, Kokoro, Chatterbox, Dia, Orpheus, XTTS, speech endpoints
- Video generation: create or update a dedicated video generation skill
  - for example `local-video-generation`
- 3D model generation: create or update a dedicated 3D generation skill
  - for example `local-3d-generation`
- Music/song generation: use a separate music/audio-generation skill, not TTS

Avoid creating one skill per model when a category skill exists. Add a provider block to the category skill instead.

## Local And Tailnet Modes

The same category skill should cover both local and Tailnet variants of the same output type.

### Tailnet mode

Use this when the generator runs on a different HivemindOS machine and clients connect over Tailscale.

The client should only need:

- Tailnet URL or MagicDNS name
- model/preset ID
- generation request shape
- output verification steps

The client should not need:

- the model repo
- service source files
- LaunchAgent/systemd unit
- local model directories
- localhost listener

### Local mode

Use this when the current machine runs the generator.

Local mode can document:

- localhost URL
- service directory
- launchd/systemd/docker lifecycle
- local model paths
- hardware constraints
- local logs

Local mode should be clearly labeled so agents do not mistakenly run service host diagnostics on a client machine.

## Provider Block Shape

Provider blocks should include:

```markdown
### Provider name block

Use this block for ...

**Route modes**

- Tailnet mode: `http(s)://<tailnet-host>:<port>`
- Local mode: `http://127.0.0.1:<port>`
- Prefer Tailnet mode when the provider runs on another HivemindOS machine.
- Use localhost only when the service runs on the current machine or when
  debugging on the service host.

**Client configuration**

- Required URL: `<BASE_URL>`
- Model/default preset: `<MODEL_ID>`
- Output extension: `.png`, `.wav`, `.mp4`, `.glb`, etc.
- Auth, if any: environment variable name only. Never include secret values.

**Tailnet client preflight**

```bash
curl -fsS --max-time 5 http://<tailnet-host>:<port>/health
curl -fsS --max-time 5 http://<tailnet-host>:<port>/v1/models
curl -fsS --max-time 5 http://<tailnet-host>:<port>/v1/voices
```

**Local client preflight**

```bash
curl -fsS --max-time 5 http://127.0.0.1:<port>/health
curl -fsS --max-time 5 http://127.0.0.1:<port>/v1/models
curl -fsS --max-time 5 http://127.0.0.1:<port>/v1/voices
lsof -nP -iTCP:<port> -sTCP:LISTEN || true
```

**Generation example**

```bash
curl -fsS -X POST http://<host>:<port>/<generation-endpoint> \
  -H 'Content-Type: application/json' \
  -d '{...}' \
  -o /tmp/output.ext
```

**Verification**

```bash
ls -lh /tmp/output.ext
file /tmp/output.ext
```

**Service-host diagnostics only**

- Service directory: `<path>`
- Service manager: `launchctl`, `systemctl`, `docker`, or direct process
- Logs: `<path or command>`
- Known failure modes: `<list>`
```

## Setup Behavior

`setup.sh` calls:

```bash
scripts/seed-shared-skills.sh
```

That script copies every bundled skill under `skills/*/SKILL.md` into the shared vault Skills shelf if the skill is not already present. It keeps existing shared skill files intact, but writes `.hivemind-skill-source.json` metadata so the shelf knows the skill came from the HivemindOS bundle.

The runtime baseline skill remains `karpathy-guidelines`. Setup may mirror that baseline skill into local agent runtime folders, while the full shared shelf is advertised through managed instructions.

`setup.ps1` mirrors the bundled-skill seeding behavior for Windows setup.

## Privacy And Reliability

Do not commit private Tailnet IPs, real personal machine names, private prompts, voice samples, transcripts, or machine-specific paths into bundled app skills. Use placeholders in bundled templates and let each user's shared vault copy store their deployment-specific values.

Raw `100.x` Tailscale IPs are useful examples, but they are not permanent identifiers. Prefer MagicDNS or a stable Tailscale Serve name when available.

Keep generation services private to the Tailnet unless the user explicitly asks
for a public exposure model.
