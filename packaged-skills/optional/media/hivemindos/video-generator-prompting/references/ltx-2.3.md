# LTX 2.3 prompt guide

Guide ID: `video-generator-prompting/ltx-2.3`  
Version: `1.6.1`  
Reviewed: `2026-07-18`

Primary sources:

- [Official LTX 2.3 prompt guide](https://ltx.io/blog/ltx-2-3-prompt-guide)
- [Official LTX prompting documentation](https://docs.ltx.io/open-source-model/usage-guides/prompting-guide)
- [Official LTX image-to-video guide](https://docs.ltx.io/open-source-model/usage-guides/image-to-video)
- [Official LTX text-to-video guide](https://docs.ltx.io/open-source-model/usage-guides/text-to-video)

## Runtime rules

LTX 2.3 is unusually responsive to detailed temporal direction. Write enough action to cover the whole duration; an underspecified long clip tends to rush its only described action and improvise the remainder.

Use flowing present-tense natural language. Four to eight descriptive sentences is a useful baseline for a simple shot, but duration and choreography decide the actual length. A long single take with dialogue, eyelines, prop behavior, and a motivated camera reveal may use several chronological prose paragraphs so long as they describe one coherent physical sequence rather than competing shot ideas. Order the prompt as the viewer experiences the shot:

1. Establish shot scale and camera position.
2. State the frame-zero relationship or, for text-to-video, the essential scene and subject.
3. Describe the action as a chronological physical sequence.
4. Direct visible acting with eye lines, pauses, breathing, head turns, hand motion, and mouth/jaw changes rather than labels such as “sad” or “confused.”
5. State exactly when and how the camera moves relative to the subject.
6. Describe where every important subject and prop is after the move and how the shot ends.
7. Add acoustic environment and quoted dialogue only if the selected endpoint supports synchronized audio.

## Mode-specific guidance

### Image to video

The image already defines appearance, lighting, framing, and spatial layout. Concentrate the prompt on motion beginning from that exact frame: what moves first, what stays fixed, how the camera responds, and the final composition. Preserve identity and required props, but do not spend the entire prompt redescribing nouns already visible.

Use exact prior last-frame input for a seamless continuation. A different camera angle is a new shot and needs an explicit identity/continuity plan.

A runtime may expose optional middle and end anchors. Use them when an important spatial move or final composition is difficult to guarantee from prose alone—for example, a pan that must finish on a specific product plate. The start anchor remains frame zero; a middle anchor constrains an authored intermediate composition; an end anchor constrains the final composition. Do not add redundant anchors to a simple performance shot, and do not use several incompatible anchors to force an impossible transformation. A narrow exception is a nearly static macro whose exact readable screen, hand anatomy, or prop state is more important than motion: the same accepted native frame may constrain start, middle, and end while the prompt allows only subtle micro-motion. Record that stability tradeoff in the receipt. For Ami Media Studio, the supported fields are `middle_image_base64` / `middle_image_url`, `end_image_base64` / `end_image_url`, or explicit `keyframes`. Remote clients should use base64 or server-fetchable URLs.

When a handheld device must show readable UI, solve the physical shot before LTX. Generate one complete native image anchor with a text-capable image model: the real hand, device, glass, perspective, exact screen text, and intended thumb/action state must already coexist in the still. Reject extra hands, blank screens, malformed devices, misspelled text, and wrong interaction states before submitting video. Then ask LTX to preserve that exact screen while animating only the necessary hand, camera, light, and ambience. Do not generate a generic plate and later superimpose a synthetic screen merely because the original device generation failed. Use a tracked live-app composite only when exact product pixels are the predeclared purpose of the shot.

Do not mistake anchor quality for video quality. LTX can reproduce the accepted start, middle, and end images while scrambling small typography in the uninspected frames between them, especially when the video latent is much smaller than the final delivery frame or the prompt asks for a push-in. For a nearly static exact-screen macro that fails this way, keep the accepted still, raise the LTX source resolution to at least the final delivery dimensions when the endpoint can support it, lock the camera, remove focus/zoom motion, and reinforce the same compatible image at a measured cadence. The verified Ami desk-send repair used one continuous 49-frame, 24 fps regular-LTX take at 1152×2048 with the same native GPT Image 2 anchor at frames 0, 8, 16, 24, 32, 40, and 48. Treat eight frames as a verified recipe for this narrow macro, not a universal cadence for every scene. Inspect at least seven distributed full-resolution decoded frames, including in-between frames, and require exact text, anatomy, and interaction state in every inspected frame before assembly.

### Text to video

Describe the complete scene because there is no visual anchor: environment, lighting, subject, wardrobe, action, camera, end state, and supported audio. Prefer a single clear subject and action arc.

### Dialogue and audio

When the endpoint supports synchronized audio, split longer dialogue into short quoted phrases and interleave physical acting beats and pauses. Specify language or accent only when needed. Describe ambience and voice qualities precisely.

Media Studio's native MLX Regular and IC Dual Character workflows jointly generate video and 48 kHz stereo audio. They do not accept an uploaded conditioning-audio track, but they do support prompt-directed ambience, voices, quoted dialogue, and native dialogue motion. Preserve that native soundtrack through assembly when dialogue was generated with the picture; do not replace or dynamically normalize it before lip-sync review.

For Media Studio source-video extension, inspect whether the input actually has an audio stream. Existing source audio is preserved and LTX generates the appended interval. A mute source causes LTX to generate synchronized audio across the complete output timeline. Prompt ambience, foley, and dialogue for the whole completed shot in that case; do not describe only the appended seconds. The completed MCP receipt reports `audio_mode: "extend"` for preserved source audio and `audio_mode: "generate"` for full-timeline generation.

Voice continuity is conditioned by the audio retained in the supplied source video, not by visual identity alone. When one actor speaks in multiple generated beats, extend from the complete accumulated audiovisual output so the next call still contains an audible exemplar of that actor's established voice. Do not extract a silent final tail and use it to condition a later speaking extension: it may preserve the face, room, and pose while allowing LTX to invent a second voice. A tail-only extension is acceptable only when no later same-speaker speech is required or the tail itself contains a verified voice exemplar. After the completed source is generated, run exact transcript QA with diarization and require every authored line by that actor to resolve to one speaker ID. Record the accumulated source hash and speaker-continuity receipt with the generation lineage.

For `ltx23-ic-dual-character-lora`, use a single coherent frame-zero identity/staging reference by default when two distinct people are visibly present across the planned coverage. Name both visible characters with durable visual identifiers, then write explicit timed shot blocks such as `[Shot 1, 0.0-3.3s]`. State camera direction, who speaks, exact quoted dialogue, who listens with a closed mouth, coherent eyelines, wardrobe continuity, and native ambience. Do not use the dual-character LoRA for an unseen first-person camera operator plus one visible subject; its two-person prior can materialize the hidden operator. The reviewed high-quality recipe is `1024x576` landscape or an equivalent divisible-by-64 orientation, `241` frames, `24` fps, CFG `1.0`, IC LoRA strength `0.80`, distilled 8-step first pass plus 3-step refinement. The workflow performs its own shot changes; do not add middle/end anchors unless the story contract truly requires them.

For `ltx23-regular-fp8`, use chronological physical direction and native generated audio when the request depends on it. Keep captions, UI copy, and rendered text out of the positive prompt unless they are literally wanted in the generated frame. When exact text already exists in a native image anchor, quote it only as a preservation contract: state that the existing wording, punctuation, composer/sent state, and glass perspective remain unchanged rather than asking LTX to invent new typography.

### Embodied first-person locomotion (Ami automation paused)

Do not currently select generated embodied first-person narratives for Ami social videos. This includes a walking unseen operator whose forearms, hands, order book, or other tools remain visible while the operator approaches a subject, conducts dialogue, and performs a motivated reveal. Across reviewed takes, the format has not yet been consistently convincing enough in limb attachment and motion, prop physics, arrival timing, subject eyelines, camera geography, and delayed reveals. Locked objective viewpoints such as an inside-fridge camera are a different grammar and are not covered by this hold.

Keep the following better-performing experiment as diagnostic guidance for a future re-evaluation, not as permission to resume the format. For an unseen POV operator with only one visible subject, `ltx23-better-motion-lora` at strength `0.30` was a better prior than `ltx23-ic-dual-character-lora` at `0.80`; the IC workflow is intended for two visible identity-critical characters, while Better Motion more directly supports operator body and camera travel. The improved take used `576x1024`, `24 fps`, CFG `1.0`, one frame-zero anchor, native joint audio, a full eight-step first pass plus three-step refinement, a new seed, and `15.04s` of generated duration. It allowed continuous approach through `5.8s`, a silent stopped settle from `5.8-6.5s`, and dialogue only after `6.5s`; user-supplied ASR evidence placed the first word at `6.78s`.

The locomotion prompt made observable mechanics explicit: motion begins on frame one; forward steps remain continuous; the operator and camera rotate together before direction changes; there is no strafing; one final footstep is followed by a complete stop. Visible forearms bob and swing on every step, wrists flex, fingers adjust, the book changes height and angle, and the hands repeatedly dip partly outside the lower frame so they cannot remain a preserved sticker-like foreground plate. This was better than the earlier attempt but was not approved as a sufficiently strong social-video format.

The current Ami Media Studio MCP submission path has no client-side 4,000-character prompt limit. Preserve long, detailed natural-language prompts without truncation. This was runtime-verified on 2026-07-16 when `media_generate_video` accepted a 10,093-character regular-LTX prompt and began the generation job. This is an endpoint fact, not a recommendation to add filler: every sentence should specify duration coverage, visible motion, eyelines, dialogue timing, prop continuity, camera triggers, audio, or the final composition.

## Strengths and avoidance

Lean into clear cinematic composition, one-subject human nuance, explicit camera language, coherent lighting, atmosphere, and restrained stylization.

Avoid readable text and logos, overloaded ensembles, chaotic physics, conflicting lighting, contradictory camera instructions, numerical micromanagement, and prompts that ask one shot to perform several unrelated transformations. Put rendered text, anatomy, identity drift, temporal instability, and unwanted objects in the negative prompt when supported.

## Preflight checklist

- Exact LTX workflow and mode identified.
- Prompt detail plausibly fills the duration.
- Image-to-video prompt advances from frame zero rather than repainting it.
- Actions are chronological and physically observable.
- Camera movement has a trigger and explicit end composition.
- Dialogue/audio appears only when the endpoint supports it.
- Same-actor speaking extensions retain the earlier native voice exemplar in the accumulated source and pass a one-speaker diarization gate.
- Positive prompt contains no contradictory or text-priming instructions.
- Required identity, prop, gaze, and native device-screen contracts are represented.
- Exact-screen video QA samples distributed decoded frames between anchors; it does not inspect only the source still or named anchor timestamps.
- Guide ID/version and endpoint capabilities are stored in the request receipt.
- A failed take is rejected and regenerated; it is never replaced by a deterministic simulation of the missing shot.
