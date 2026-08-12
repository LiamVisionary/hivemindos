# MiniMax H3 Full-Reference Compiler

Use this reference for H3-Base-Ref2VA and verified hosted H3 omni/full-reference modes. It paraphrases the official Ref2VA guide and does not reproduce its example.

## Exact Section Order

Return all six sections in English, preserving original language only inside dialogue/lyrics `<d>` blocks and visible scene text:

```text
subject_definitions:
...

summary:
...

retention_analysis:
...

detailed_description:
...

overall_soundscape:
...

non_diegetic_music:
...
```

Do not substitute the base-mode `integrated_multimodal_description` field for `detailed_description`.

## Define Reference Labels

Assign each asset/content unit one stable role:

- `<Subject N>`: reusable visible content such as a person, object, environment, clothing, prop, interface, style, action, expression, or pose.
- `<Picture N>`: the image itself when it is a first/key/last/edited frame or storyboard/composition anchor.
- `<Video N>`: the whole source when it is directly edited, continued, or supplies temporal/camera/cut structure.
- `<Audio N>`: a standalone signal or explicitly enabled source-video audio track that is copied or referenced.

An image that only defines identity/style belongs inside a subject definition rather than receiving a redundant standalone picture line. A visible person or action taken from a video remains a `<Subject N>`; `<Video N>` describes the asset/structural relationship.

Video and audio labels have independent numbering. A video with sound does not automatically create an audio label. Create `<Audio N>` only when the audio has an explicit target role.

In `subject_definitions`, give each tracked item one line naming what it denotes, the source asset, its role, and the characteristics that matter. When audio maps to a target speaker, reuse the target speaker's global `(Sx)` ID rather than assigning an independent number.

## Write The Summary

Start with one bracketed task-type prefix. Combine distinct applicable types with ` + `:

- `keyframe completion`: an image is a concrete target frame
- `reference generation`: an asset guides character, scene, style, action, camera, or storyboard without being a concrete frame/source edit
- `video editing`: an existing video is directly modified
- `video continuation`: new content begins from an existing video's boundary
- `audio reuse`: source audio is copied in full or part
- `audio reference`: only style, timbre, words, texture, beat, or continuity guides new audio

Then summarize the target video and main reference relationships in one short paragraph using only labels already defined. If directly editing a video, state that the target is an edited version of that `<Video N>`.

## Write Retention Analysis

Use one line per defined label. Do not change the role established in `subject_definitions`.

Visible relationship markers:

- `fully_preserved`: the defined role is retained
- `partially_preserved`: it remains but specified attributes change or are only partly retained
- `attribute_transfer`: characteristics move to a different identifiable target
- `weak_reference`: only broad style/category/composition/atmosphere similarity remains

Audio relationship markers:

- `fully_copy`: the complete signal becomes the complete final audio track
- `partially_copy`: a portion/layer is copied or other layers are changed
- `reference`: the signal is not copied, but its specific timbre/rhythm/style/words/texture guides output
- `weak_reference`: only broad category/atmosphere similarity remains

State where visible items appear and what is preserved/transferred. Do not count newly authored target actions or backgrounds as reference losses when they do not contradict the defined role.

## Write Detailed Description

Before `[Shot 1]`, establish the target style in one or two English sentences. Then describe playback in detail:

- current composition and environment
- subject appearance, position, and referenced characteristics
- actions and state transitions
- camera movement
- current sound/dialogue
- exact point each reference takes effect
- inherited and terminal state

Shot 1 has no timestamp. Later cuts use increasing `[Shot N] At MM:SS.mmm, ...` notation. Generation descriptions normally need enough detail to remove ambiguity; MiniMax's guide suggests roughly 350–500 English words, but dialogue density and task complexity take precedence over mechanically hitting a count.

At a subject's first clear appearance, name its label, visible characteristics, frame position, and action. Reuse the label later without redefining it. Cite concrete anchors naturally as beginning from, passing through, or ending on the relevant picture.

When a referenced subject speaks, write `<Subject N> (Sx)` and reuse the same speaker ID. If directly reused soundtrack/BGM contains a vocal cue without an independently acting speaker, use the audio label as the audible source rather than inventing `(Sx)`. For unintelligible reused speech, write `[unclear]` rather than guessing.

Copy referenced words only when the audio is directly reused or the user explicitly requests reperformance. If only voice timbre/delivery is referenced, do not import the source dialogue.

## Sound Sections

Keep shot-specific dialogue, singing, and synchronized effects in `detailed_description`.

Use `overall_soundscape` for whole-video ambience and physical sounds. Use `non_diegetic_music` for audience-only score. When reference audio contributes to one of these layers, name its copy/reference relationship only in the matching sound field. If one source contributes to both, describe the relevant relationship separately in both fields.

## Ref2VA QA

- exact six-section order
- every used label is defined; every definition has a later role
- label meanings and speaker IDs remain stable
- task-type prefix matches actual asset roles
- retention markers come from the correct visible/audio set
- reference images used only for identity are not mislabeled as keyframes
- source video is called editing/continuation only when directly edited/continued
- source audio is not assumed active merely because a video contains sound
- detailed description is playback-complete rather than a plot summary
- dialogue reuse versus timbre reference is explicit
- ambience, physical sounds, dialogue, diegetic music, and audience-only score are separated
- timing, final state, rights, privacy, and upload approvals are reviewable
