# MiniMax H3 Base-Mode Compiler

Use this reference only for MiniMax H3 T2VA, I2VA, FL2VA, and L2VA prompts. It paraphrases the official base guide and preserves only the functional field and alignment syntax needed to compile prompts.

## Select The Mode

- **T2VA:** no image anchor; construct the complete audiovisual timeline.
- **I2VA:** one image is the first frame at 0.00 seconds; develop forward.
- **FL2VA:** the first and last images are hard boundary states; describe the path between them.
- **L2VA:** one image is the terminal frame; construct a plausible lead-in and converge on it.

## Exact Outer Schema

T2VA begins with the three fields. Keyframe modes begin with their alignment instruction, one blank line, then the same three fields.

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

Use these functional alignment forms:

```text
I2VA
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

FL2VA
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.

L2VA
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

Replace `N` with the actual last shot and `S.SS` with the effective duration to exactly two decimal places.

## Write The Integrated Timeline

Start `[Shot 1]` with the medium/style and initial composition. For anchored modes, derive visual facts from the image; for T2VA, use only facts consistent with the brief.

Every shot should establish the relevant subset of:

- framing and subject position
- identity, wardrobe, scene, lighting, and key props
- observable action and state change
- motivated camera behavior
- current dialogue, singing, diegetic music, effects, or silence
- the state inherited by the next shot

Shot 1 has no timestamp. A later cut begins with:

```text
[Shot 2] At 00:03.500, the camera cuts to ...
```

Use strictly increasing cut times inside the duration. A cut must reveal new subject, space, state, viewpoint, or time information. Use camera motion for a modest framing/distance change.

## Camera Language

Choose the physically correct move:

- zoom in/out changes focal length while the body stays put
- push in/pull out moves the camera forward/backward
- pan pivots horizontally; truck translates horizontally
- tilt pivots vertically; pedestal translates vertically
- arc travels around the subject; tracking follows it
- static holds camera and lens still
- roll rotates around the lens axis
- POV uses the subject's viewpoint
- slight/strong shake states instability

Add `with small amplitude` or `with large amplitude`, and `at slow speed` or `at fast speed`, only when the magnitude or pace changes the intended result. Write one natural sentence, such as a slow small push toward a prop; do not add detached labels.

## Dialogue And Vocal Sources

- Assign `(S1)`, `(S2)`, and so on in first-vocal-event order and reuse them across shots.
- Put identity, voice, delivery, and action outside `<d>`.
- Put only the language tag and exact approved words inside `<d>[Language] ...</d>`.
- Preserve every approved word and punctuation mark; do not translate or improve the copy during prompt compilation.
- For an off-screen voiceover, say that the speaker `says in an off-screen voiceover`, then explicitly state that the corresponding on-screen character's lips remain closed.
- If one line crosses a cut, use `<scenetrans>` at the connection and state that audio continues across the cut.
- Use `<cutoff>` only when the video intentionally ends before speech finishes.

Visible text uses English double quotation marks and preserves its original content. Do not invent readable app text, metrics, labels, or claims.

## Sound Fields

`overall_soundscape` is one continuous 1–4 sentence paragraph covering ambience, actions, and nonverbal human sounds across the whole video. Do not repeat dialogue, lyrics, or diegetic music. Use `N/A` only when the user explicitly wants complete silence.

`non_diegetic_music` is 1–3 sentences covering audience-only instrumentation, tempo/rhythm, and dynamic development. Do not explain its emotional function. Use `N/A` when there is no audience-only score.

## Boundary Logic

### I2VA

Start with the visible anchor facts, preserve identity/clothing/colors/objects/spatial relationships, then describe action onset, development, and a clear result. The anchor is frame zero.

### FL2VA

Do not merely describe two stills. Explain each intermediate physical change that makes the ending reachable: body path, pose, prop manipulation, composition, camera, light, and settling motion. Prefer one continuous shot unless the user specified cuts.

### L2VA

Infer an earlier state compatible with the final image. In the last shot, progressively narrow pose, object, camera, light, and composition differences until the effective-duration frame matches the anchor.

## Base-Mode QA

- selected mode matches actual inputs
- alignment instruction is first and is followed by one blank line when required
- all three fields exist in the correct order
- last-shot index and two-decimal duration are correct
- later cuts use increasing `MM:SS.mmm` times
- dialogue and visible text are exact
- speaker IDs are stable
- diegetic and non-diegetic audio are not mixed
- actions and camera moves fit the duration
- final composition is explicit
