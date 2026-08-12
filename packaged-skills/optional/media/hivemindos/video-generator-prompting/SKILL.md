---
name: video-generator-prompting
description: Route every generative-video prompt through guidance for the exact model runtime and endpoint. Use whenever an agent writes, revises, reviews, or submits prompts for LTX, Seedance, Kling, Veo, Runway, Wan, HunyuanVideo, CogVideoX, Higgsfield, MUAPI, Media Studio, ComfyUI video workflows, or any other text-to-video, image-to-video, audio-to-video, video-to-video, retake, extend, or lip-sync generator.
metadata:
  version: 1.7.0
---

# Video generator prompting

Never use one generic “cinematic prompt” template across video models. Identify the exact runtime and endpoint, load its guide, compile for that capability surface, and record the guide in the generation receipt.

## Required routing

1. Resolve the exact provider, model/workflow ID, endpoint, mode, duration, aspect ratio, frame inputs, and whether the endpoint actually accepts or generates synchronized audio.
2. Read `references/runtime-registry.json` and load the matched provider guide before writing the prompt.
3. If the runtime is LTX 2.3, read `references/ltx-2.3.md` completely.
4. If the runtime is Seedance 2.0, load `muapi-seedance-video` for MUAPI or `higgsfield-generate` plus `higgsfield-api-quirks` for Higgsfield. Do not apply LTX prompt structure by analogy.
5. If the runtime is MiniMax H3, load `minimax-h3-video-prompting`, resolve H3-Base-FL2VA versus H3-Base-Ref2VA and the exact T2VA/I2VA/FL2VA/L2VA/Ref2VA mode, then apply its current license/territory gate before any model call.
6. For an unregistered runtime, read its current primary documentation, add a reviewed registry entry and focused reference, then use it. Do not silently fall back to another model's guide.

## Compile and verify

- Match prompt detail and temporal coverage to the requested duration.
- Do not impose a generic client-side prompt-length cap. Preserve the authored prompt verbatim when the selected endpoint accepts it; shorten only to remove contradiction or irrelevant detail, never to satisfy a stale adapter limit.
- Describe events chronologically and make the final composition explicit after any camera move.
- Use visible physical behavior instead of internal emotion labels.
- Treat image-to-video anchors as frame-zero contracts. Describe motion after the anchor rather than redundantly repainting it.
- When readable UI or exact text is part of a physical device shot, generate the complete hand/device/screen state natively in a text-capable image anchor before video generation. Validate the text, anatomy, device count, and interaction state on that still, then preserve it with the runtime's start/middle/end or keyframe conditioning where useful. Do not default to pasting, perspective-warping, or superimposing a replacement screen over generated footage.
- A clean readable source anchor does not prove the generated video remains readable. Exact-screen shots must be checked on distributed decoded video frames, including frames between named anchors. If text drifts between start/middle/end, increase the video-generation resolution, reduce camera/subject motion, and add compatible same-image keyframes at a measured cadence before trying a different still. Record the cadence and stability tradeoff in the receipt.
- Put exact dialogue and audio direction in the positive prompt only when the selected endpoint supports them. Otherwise keep dialogue in editorial or conditioning tracks and keep dialogue/caption vocabulary out of positive visual conditioning.
- Keep negative constraints in the provider's negative field when one exists. Avoid contradictory positive instructions.
- Reject prompts that overload one shot with too many characters, actions, physics changes, camera moves, or spatial transformations.
- Never replace a failed generative shot with a deterministic editorial simulation. Reject and regenerate the provider shot. Authored compositing of real product/app pixels into an intentional tracking plate is allowed only when exact live-product pixels are the explicit shot contract and the technique was selected before generation; it is not a fallback for a malformed or blank generated device screen.
- Persist this receipt block with every request:

```json
{
  "promptGuide": {
    "id": "video-generator-prompting/<runtime>",
    "version": "<guide version>",
    "mode": "text-to-video|image-to-video|audio-to-video|video-to-video|retake|extend|lip-sync",
    "endpointCapabilities": {
      "acceptsImage": true,
      "acceptsAudio": false,
      "generatesAudio": false
    },
    "sourceUrls": ["<primary documentation URL>"]
  }
}
```

Fail closed when the exact runtime, mode, or guide is unknown. A technically successful generation is still a rejected take when it violates the shot contract, identity, prop handling, camera motivation, app-screen proof, or final composition.
