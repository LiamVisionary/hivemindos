# Workflows

Reusable reference data that agents sample from when producing a deliverable.

Skills tell an agent **how** to do something. Workflow banks are **what it picks from** while doing it.
A hook, a call to action, a shot type, a platform's frame rate ceiling — an agent should look these up
rather than invent them fresh on every request, and the app should be able to render the same data in a
list without re-deriving it.

Keep that line sharp. If a thing has steps, it is a skill and belongs in the shared skills shelf. If it
is a table you take a row out of, it is a bank and belongs here.

## Layout

One directory per deliverable kind, matching `KanbanDeliverableKind` in `src/lib/types/kanban.ts` so the
banks line up with what agents actually hand back. Two exceptions: `copy/` (calls to action and
objections are needed by video, web, and email alike, so they live at the top level rather than being
duplicated into each) and `gtm/` (go-to-market banks keyed by channel rather than by deliverable kind).

```
workflows/
  video/
    hooks.json       72 hook frameworks       (authored)
    HOOKS.md         generated from hooks.json
    platforms.json   per-platform video specs (derived)
    shots.json       shot-type vocabulary     (authored)
  copy/
    ctas.json        18 closing lines         (authored)
  web/
    sections.json    page-section archetypes  (authored)
  gtm/
    reddit/
      templates.json post/comment skeletons, timing windows, intent queries (authored)
    cold-email/
      templates.json first-touch skeleton, frameworks, sequence spine, subject formulas, anti-patterns (authored)
    creator-rewards/
      templates.json readiness, roster criteria, payout controls, diagnostics, cohort rules, scorecard, paid handoff (authored)
    performance-creative/
      templates.json transformation brief, public-ad research fields, hook shapes, five-beat scripts, storyboard QA, controlled variants, claim gates (authored)
    linkedin/
      templates.json hook shapes, content rotation, warming stages, DM spine, sell-by-chat, safety caps (authored)
    b2b-social/
      templates.json voice-foundation assets, content plays, repurposing targets, weekly rhythm, tooling caps (authored)
    outreach-brief/
      templates.json brief sections + evidence, copy constraints, cold-call spine, pipeline flags, metric triage (authored)
    x-warm-outreach/
      templates.json 14-day ladder, lead sources, reply shapes, DM skeletons, pacing rules (authored)
    organic-reach/
      templates.json pillars, post-type skeletons, viral wrappers, team roles, positioning, proof library, IG rules (authored)
    events/
      templates.json fit test, anchor criteria, invite skeletons, +1 activation loop, room design, follow-up touches, warm-intro rules (authored)
```

## Every bank declares its provenance

This is the load-bearing convention. A bank without provenance is a bank an agent will over-trust.

| `provenance` | Means | Obligation |
| --- | --- | --- |
| `authored` | We wrote it. | Never present it to a user as "proven", "high-converting", or backed by data. It is a starting point, not a result. |
| `derived` | Read from a primary source (a vendor's own docs, a spec, a public dataset). | Must carry `source` and `verifiedOn`. Goes stale. Re-verify before trusting a value older than ~90 days. |
| `extracted` | Copied from a third party. | Must carry `source` and their license. **Do not add extracted banks to this repository** — it is public and MIT, and redistributing someone else's content under our license is not ours to do. |

Required top-level keys on every bank: `version`, `provenance`, `license`, `verifiedOn`, `note`, `count`.
Add `source` whenever `provenance` is not `authored`.

Two further rules that matter more than they look:

**Say what you don't know.** `platforms.json` carries an `unknown` array per platform and an `omitted`
block explaining what was left out and why. We do not encode safe-area insets, because every number we
found came from SEO content and no vendor publishes them. An absent field is honest; a guessed field is
a landmine, because agents cannot tell the difference.

**Mark what isn't constant.** TikTok publishes no fixed upload duration — the cap is per-creator and is
returned by the `creator_info` API. So `maxDurationSec` is `null`, `volatile` names the field, and
`maxDurationResolver` says where to get the real answer at runtime. Freezing a plausible number there
would have been wrong for most accounts and would have failed silently.

## Placeholder slots are UPPERCASE on purpose

Templates in `hooks.json` and `ctas.json` use `[LIKE THIS]`. That is not a style choice.

The Deliverable Acceptance gate in `src/lib/services/deliverables/acceptance-contracts.ts` matches
`/\[[A-Z_ ]{3,}\]/` and hard-fails a deliverable on a hit. The check is deliberately case-sensitive so
ordinary prose like `[see menu]` is not a false positive. Uppercasing our slots means a template that
reaches a real page or script **unfilled** is caught by machinery that already exists, with no new code.

The protection only holds if new slots stay uppercase, avoid hyphens and digits, and run at least three
characters — `[N]` and `[SECOND-ORDER PAIN]` both slip through. Verify with:

```bash
node -e 'const {hooks}=require("./workflows/video/hooks.json");
const g=/\[[A-Z_ ]{3,}\]/;
console.log(hooks.flatMap(h=>(h.hook.match(/\[[^\]]*\]/g)??[]).filter(s=>!g.test(s))))'
```

An empty array means every slot is visible to the gate.

## Editing

JSON is the source of truth. `HOOKS.md` is generated:

```bash
node scripts/build-workflow-docs.mjs          # regenerate
node scripts/build-workflow-docs.mjs --check  # fail if the committed Markdown is stale
```

Never hand-edit a generated `.md`. Keep JSON banks under the 1500-line file-size ratchet by writing one
record per line rather than pretty-printing.

## Adding a bank

1. Pick the directory by deliverable kind, or `copy/` if more than one kind needs it.
2. Declare `provenance` honestly. If you did not read a primary source, it is `authored`.
3. Give every record a stable id. Ids are referenced from prompts and app code and must not be renumbered.
4. List what you left out in `unknown` / `omitted`, and flag runtime-resolved values in `volatile`.
5. If it needs a Markdown view, add a renderer to `scripts/build-workflow-docs.mjs` rather than writing
   the Markdown by hand.
