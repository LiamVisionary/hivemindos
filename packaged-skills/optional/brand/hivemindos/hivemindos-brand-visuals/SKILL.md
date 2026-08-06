---
name: hivemindos-brand-visuals
description: Generate and deliver HivemindOS brand visuals — logos, sigils, abstract emblems, banners, and other identity assets — using one clear visual thesis, genuinely distinct directions, mark-first review, verified image outputs, and the correct delivery target.
---

# HivemindOS Brand Visuals

Use this skill when the user wants a HivemindOS-branded visual asset generated, verified, and delivered somewhere practical for sharing.

This is the umbrella for:
- abstract sigils and emblems
- logo-like identity graphics
- brand banners and social imagery
- image-only delivery flows where the image itself is the product

## Core workflow

1. Clarify the destination only if needed.
   - If the request says Telegram or another platform explicitly, use that target.
   - If the request is just to generate the image, deliver locally or return the file path.

2. Write the brand job in one concrete sentence:
   - `[Brand] is a [specific product] for [specific audience] that should signal [specific promise].`
   - If the product, audience, or promise is unknown and materially changes the result, ask.

3. Choose one sharp visual thesis.
   - Use one primary metaphor or meaning-bearing mechanism.
   - Add at most one supporting geometric device.
   - Do not force every brand trait into the mark.

4. Generate the image with:
   - logo, emblem, sigil, or identity-system language appropriate to the request
   - no readable text unless typography is explicitly part of the direction
   - high contrast and centered composition for mark-only studies

5. Verify the output is a real image.
   - Check file type, dimensions, and size.
   - Reject blank, tiny, or corrupted outputs.

6. Review the mark before polishing the presentation.
   - Inspect it alone on a neutral background and at small size.
   - Reject a concept that only looks good because of mockup lighting, texture, or scenery.
   - Apply the chosen mark to mockups only after its silhouette and visual idea hold up.

7. Deliver the image in the requested channel.
   - For Telegram or similar chat delivery, send the image as media rather than pasting text.
   - Keep captions minimal unless the user asked for copy.

## Prompting guidance

- Start from the concrete product, audience, and visual thesis. A prompt recipe without that grounding tends to collapse into generic category imagery.
- Treat hexagons as one option, not a diagnosis or house default. Hexes are not inherently difficult; semantic overconstraint is. Do not automatically stack hexagons, honeycombs, nodes, swarm motion, protected cores, sacred geometry, and intelligence symbolism.
- Prefer one visual sentence, such as “independent parts forming a calm whole” or “a protected opening into coordinated work.” Translate that sentence into shape, negative space, rhythm, or typography.
- Delete prestige adjectives that do not change a visible decision. Piles of words such as “timeless,” “iconic,” “luxurious,” “sophisticated,” and “meaningful” usually add noise rather than direction.
- When generating multiple directions, change the underlying system:
  - metaphor
  - silhouette and negative space
  - geometric versus organic construction
  - symbol versus monogram versus wordmark
  - typography and proportion
  Do not submit the same node network or honeycomb in different colors.
- For HivemindOS, avoid literal bees, robot heads, brains, and generic AI node graphs unless the user explicitly chooses one of those directions.
- Once a direction wins, iterate one variable at a time instead of rewriting the entire prompt.
- Use negative prompts to suppress text, watermarking, blur, and low-quality artifacts.

## Diagnosing repetitive results

- If every option feels like the same generic AI-infrastructure logo, hold the prompt structure constant and test it on unrelated concrete brands. If the outputs improve, the original brand semantics were overloaded; if they still converge, the prompt recipe is the problem.
- Make each test brand concrete enough to imply a distinct form language. Changing only the invented name is not a meaningful test.
- Separate generator quality from art direction quality. A technically polished image can still be a weak identity concept.

## Verification checklist

- The file opens as a valid image
- The dimensions are reasonable for the task
- The file size is non-trivial
- The image actually contains a visible composition
- Each proposed direction has a distinct visual thesis and silhouette
- The preferred mark still works without presentation-board polish

## Delivery guidance

- Prefer native media upload paths over inline links when the platform supports it.
- Discover the correct target if the platform has multiple DMs/channels.
- Keep the message body minimal for image-first delivery.

## Pitfalls

- Do not return a file path without verifying it exists.
- Do not assume a generated image is good just because the job completed.
- Do not include unreadable text in the design unless the user explicitly wants typography.
- Do not hard-code platform targets when the environment provides a discovery step.
- Do not present a raster image-model concept as a finished vector identity, an original trademark, or a trademark-safe mark. Treat it as concept exploration that still needs vector construction and clearance.

## Support files

Use `references/` for prompt variants, platform-specific delivery notes, and example compositions.
Use `templates/` for reusable prompt skeletons.
Use `scripts/` for repeatable checks or delivery helpers.
