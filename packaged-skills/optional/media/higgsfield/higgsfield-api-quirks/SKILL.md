---
name: higgsfield-api-quirks
description: Undocumented behavior, 500 triggers, and payload workarounds for Higgsfield generation models.
---
# Higgsfield API Quirks

This skill documents model-specific failures and payload requirements that differ from the standard API schema. Check these constraints before executing `higgsfield_generate`.

## Seedance 2.0

### Audio Input (500 Error Prevention)
Do **NOT** pass audio using `role: "audio"` inside the `medias` array. Doing so consistently triggers an Internal Server Error (HTTP 500).

**Correct schema:** Pass the audio file at the root of the `params` object as:

```json
input_audio: {"id": "<id>", "type": "media_input", "url": "<url>"}
```

### Resolution / Aspect Ratio
Seedance 2.0 ignores precise numeric `width` and `height` parameters, defaulting to a 1:1 aspect ratio if forced to rely on them. You **MUST** use the string `aspect_ratio` parameter (e.g., `aspect_ratio: "21:9"`, `"16:9"`, `"9:16"`) to enforce framing.

### Reference Limits
Seedance 2.0 has a hard limit of **9 reference slots** total (medias array + element tokens). A typical matchcut consumes 4 slots (start image, end image, and the two internal audio slots for bridge generation), leaving a maximum of 5 `<<<element_id>>>` tokens in the prompt.

## Kling 3.0

### Matchcut Incompatibilities
Kling 3.0 successfully supports matchcuts (`role: "start_image"` + `role: "end_image"`), but is **incompatible with element tokens** when using `end_image`. Do not pass `<<<id>>>` tokens into a Kling 3.0 matchcut prompt.

### Framerate Output
Kling 3.0 natively outputs at 30fps. If bridging 24fps source material, you must heavily re-encode (`ffmpeg -r 24`) before concatenation or the stitch will fail or drift.
