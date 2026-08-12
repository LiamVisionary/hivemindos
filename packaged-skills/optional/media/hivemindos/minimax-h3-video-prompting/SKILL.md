---
name: minimax-h3-video-prompting
description: Write, rewrite, audit, or compile prompts specifically for MiniMax H3 audiovisual video generation. Use whenever the user names MiniMax H3, H3-Base-FL2VA, H3-Base-Ref2VA, Context-IR, T2VA, I2VA, FL2VA, L2VA, Ref2VA, first-frame, last-frame, first-and-last-frame, omni-reference, or full-reference H3 generation—even if they only ask for an ad, UGC clip, storyboard, dialogue scene, or reference-video prompt. Resolve the exact H3 task family before drafting; do not transfer Seedance, LTX, Kling, Veo, or older Hailuo syntax by analogy.
compatibility: Prompt authoring is local and requires no model call. Model execution requires a currently authorized MiniMax H3 runtime, current license/territory review, exact endpoint capability verification, and separate approval for private-reference upload and spend.
metadata:
  version: 1.0.1
---

# MiniMax H3 Video Prompting

Compile an approved video brief into the exact prompt family expected by MiniMax H3. Preserve the user's creative intent and spoken copy while making references, timing, camera behavior, sound, and terminal frame state explicit.

## Primary Sources And License Boundary

This is an original HivemindOS operating summary of MiniMaxAI's public materials, not a redistribution of their guides or examples:

- [Base T2VA/I2VA/FL2VA/L2VA guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
- [Full-reference Ref2VA guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)
- [MiniMax H3 repository and live capability table](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)

The source repository's current license text defines excluded territories, including the United States, European Union, United Kingdom, and Republic of Korea. Prompt drafting does not itself authorize model use, hosting, redistribution, or output use. Before submitting a job, verify the current license, operator location, provider authorization, endpoint terms, moderation/disclosure requirements, and intended output use. If authorization is unclear, return the prompt and the unresolved gate without calling the model.

## Required Reading

- Read [`references/base-modes.md`](references/base-modes.md) completely for T2VA, I2VA, FL2VA, or L2VA.
- Read [`references/full-reference.md`](references/full-reference.md) completely for Ref2VA, omni-reference, reference generation, source-video editing/continuation, or audio reuse/reference.
- When this skill is reached through `video-generator-prompting`, also preserve that router's receipt and artifact-QA contract.

## 1. Resolve The Exact Runtime Contract

Record these before writing the final prompt:

```text
Provider/runtime: [LOCAL H3 / MINIMAX PLATFORM / OTHER VERIFIED ADAPTER]
Model/checkpoint: [H3-BASE-FL2VA / H3-BASE-REF2VA / HOSTED H3 VARIANT]
Task mode: [T2VA / I2VA / FL2VA / L2VA / REF2VA]
Duration: [4-15S OR VERIFIED LIVE LIMIT]
Aspect ratio/resolution: [VERIFIED VALUES]
Inputs: [TEXT / FIRST FRAME / LAST FRAME / REFERENCES]
Audio input accepted: [YES/NO/UNKNOWN]
Native audio generated: [YES/NO/UNKNOWN]
License/territory status: [CONFIRMED / UNRESOLVED]
Private-reference upload approval: [APPROVED / NOT APPROVED / N/A]
Generation/spend approval: [APPROVED / NOT APPROVED]
```

MiniMax's repository currently describes 4–15 second audiovisual outputs, native stereo audio, an FL2VA checkpoint for text and optional boundary frames, and a Ref2VA checkpoint for multimodal references. Treat those as source-version facts, not permanent guarantees; validate the selected adapter or API before execution.

## 2. Pick One Prompt Family

| Mode | Inputs | Prompt job |
| --- | --- | --- |
| T2VA | Text only | Build the complete audiovisual timeline from text |
| I2VA | First image | Treat the image as frame zero and develop forward |
| FL2VA | First and last images | Describe the continuous observable path between anchors |
| L2VA | Last image | Infer a plausible earlier state and converge exactly on the final image |
| Ref2VA | Images, videos, and/or audio as verified | Define reusable subjects and asset roles, then write a six-section reference-aware timeline |

Do not mix the base three-field schema with the Ref2VA six-section schema. If a source image is only a reusable identity/style reference rather than a concrete boundary frame, use Ref2VA rather than pretending it is I2VA or FL2VA.

## 3. Compile Observable Playback

- Write the target timeline in English; keep dialogue, lyrics, and visible text in their original language.
- Preserve user-approved dialogue word-for-word and punctuation-for-punctuation inside `<d>[Language] ...</d>`.
- Give each actual vocal source one stable `(S1)`, `(S2)`, and so on across shots.
- Describe physical actions, reactions, camera movement, and sound in playback order. Replace internal emotion labels with visible or audible behavior.
- Give `[Shot 1]` no timestamp. Start later shots with strictly increasing `[Shot N] At MM:SS.mmm, ...` cut times inside the duration.
- Describe camera motion as type plus meaningful amplitude and speed inside the sentence. Do not append a keyword pile.
- Keep diegetic dialogue, singing, radio/phone music, and shot-synchronized effects in the main timeline. Reserve `overall_soundscape` for ambience/physical sounds and `non_diegetic_music` for audience-only score.
- State the observable final composition and ensure every action can finish within the time budget.

## 4. Protect Reference Semantics

- A first-frame image is the actual 0.00-second state; describe what happens after it rather than repainting it.
- First-and-last-frame prompting describes interpolation: subject motion, pose changes, prop state, camera/composition evolution, and final convergence. Prefer one continuous shot unless the brief actually requires cuts.
- A last-frame image belongs to the final shot, not automatically Shot 1. Build a plausible preceding state and land on the anchor at the effective duration.
- In Ref2VA, `<Subject N>` denotes reusable visible content; `<Picture N>` a concrete frame/planning anchor; `<Video N>` an edit, continuation, or temporal-structure source; and `<Audio N>` a copied or referenced audio signal.
- Keep every label's meaning stable across definitions, summary, retention analysis, timeline, and sound fields.
- Build an asset ground-truth manifest before prompting: for each image, video, or audio input, list only what is directly visible or audible, what the user explicitly approved, and what remains unknown. A static product still proves a composition and visible state—not hidden controls, intermediate interactions, navigation, animations, sounds, or causal product behavior. Keep unknown behavior out of the prompt or mark it as an approval blocker; never convert a plausible inference into a verified reference fact.
- Approval to use a concept is not approval to upload a private face, voice, room, product master, analytics export, unreleased UI, or source video.

## 5. UGC And Product-Creative Rules

- Use phone-native camera behavior only when the approved concept calls for it; H3 syntax does not make every output UGC.
- Lock truthful product behavior, approved claims, dialogue, pronunciation, wardrobe, props, room geography, speaker IDs, and final state before compiling.
- Exact app UI, packaging text, prices, metrics, subtitles, and legal disclosures should come from verified anchors or controlled post-production. Generated readability must still be checked across decoded frames.
- For a 25–30 second ad, do not ask a 15-second runtime to produce an unsupported duration. Split the approved five-beat spine into two or three independently reviewable H3 clips, carry the same approved references and continuity manifest forward, then assemble only after each clip passes QA.
- Use Ref2VA when stable character/product/voice references are needed across a clip. Use boundary-frame modes when the start or end composition itself is the contract.

## 6. Return A Reviewable Deliverable

```text
H3 Runtime Decision
- Provider/model/checkpoint:
- Mode and why:
- Live capabilities confirmed:
- License/territory status:
- Approval status:

Input And Continuity Map
- Reference assets and roles:
- Asset ground truth: [DIRECTLY OBSERVED / USER-APPROVED / UNKNOWN]
- Speaker IDs and exact dialogue:
- Fixed identity/product/room/prop facts:
- Boundary-frame contract:

Final MiniMax H3 Prompt
[ONLY THE SELECTED MODE'S EXACT SCHEMA]

QA Checklist
- Schema and section order:
- Timing and terminal state:
- Dialogue/visible-text fidelity:
- Reference-label consistency:
- Audio-layer separation:
- Claims, rights, privacy, and disclosure:
- Unsupported behavior/claim scan:

Generation Receipt Template
- Prompt guide: minimax-h3-video-prompting/1.0.1
- Source URLs:
- Provider job id:
- Input/output hashes:
- Artifact review result:
```

Do not generate, upload, publish, or spend merely because a valid prompt exists. After generation, review normal-speed playback, muted playback, audio-only playback, cut boundaries, lip sync, identity/product continuity, exact text/UI frames, and final composition before accepting the take.
