#!/usr/bin/env node
// End-to-end wiring simulation for the Queen-voice barge-in detector.
//
// Drives the REAL detector (src/features/queen-voice/barge-in-detector.ts)
// through a faithful model of the sentence-streaming playback wiring
// (use-queen-bee-voice.ts watcher + spoken-reply-playback.ts resume anchoring)
// to prove the GATED peak-keyed onset-coincidence guard:
//
//   1. Onset-coincidence interrupt — the user starts talking EXACTLY as a new
//      sentence chunk's audio resumes, mid-reply — now fires < ~700ms (was a
//      floor-poisoning latch of ~3.5s worst case).
//   2. Mid-chunk interrupt still fires ~420ms (the sustain window).
//   3. ZERO false self-triggers on her OWN bleed across:
//        (a) normal bleed 0.03   (b) loud bleed 0.06
//        (c) first-chunk-after-slow-synth (grace is silent, synth TTFB > graceMs)
//      including a per-chunk onset transient (her resumed audio is briefly
//      louder than her steady bleed).
//
// Wiring model (matches the real code path):
//   - The watcher ticks every FRAME_MS and feeds mic RMS to updateBargeInDetector.
//   - Each chunk's audio RESUME (onFirstByte) stamps activity.underrunAt; the
//     watcher turns a fresh stamp into requestBargeInRecalibration (a resume
//     window). Order per tick: recalibrate-on-resume, THEN update — as in runTick.
//   - Mic RMS is her residual (echo-cancelled) bleed while only she talks; once
//     the user talks, the user's louder voice dominates the mic (max()), the
//     same convention the pinned unit test uses.
//
// Self-asserting: exits non-zero if any deliverable criterion fails.
//
// PRE-EXISTING detector characteristic this sim accounts for (NOT the onset
// latch, and NOT introduced here): the nominal trigger is echoFloor * 2.75, but
// `floorBlendAbove` drifts the floor upward by 0.004/frame during the 420ms
// sustain, so the threshold creeps into the signal. Measured on the PLAIN path
// (no recalibration window, so the guard is inert): over a 0.06 echo floor a
// user at 3.0-3.3x never breaks in, 3.7x+ fires at ~432ms. So the EFFECTIVE
// barge-in floor is ~3.7x, not 2.75x. This lives in the unchanged normal path;
// this sim therefore models a realistic conversational barge-in level (0.3 RMS,
// 5-10x a typical 0.03-0.06 residual-echo bleed), the same way the pinned unit
// test pairs a louder user (0.4) with the louder (0.06) echo. Reported as a
// separate follow-up, out of scope for the onset-coincidence fix.

import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("../scripts/lib/ts-relative-loader.mjs", import.meta.url));

const {
  BARGE_IN_TUNING,
  bargeInThreshold,
  createBargeInDetector,
  requestBargeInRecalibration,
  updateBargeInDetector,
} = await import("../src/features/queen-voice/barge-in-detector.ts");

const FRAME_MS = 16;
const CHUNK_MS = 2_500; // typical sentence-chunk cadence
const ONSET_MS = 64; // her resumed audio is briefly louder than steady bleed
const ONSET_GAIN = 1.4;

// ---------------------------------------------------------------------------
// One simulated spoken reply. Returns the barge-in trigger time (0 = none) and
// the interrupt latency measured from when the user started talking.
// ---------------------------------------------------------------------------
function runReply({
  bleed, // her steady residual-echo RMS while speaking
  firstAudioMs = 0, // when the very first audio lands (models slow synth: grace is silent before this)
  chunkStartsMs, // ms offsets where a chunk's audio RESUMES (onFirstByte fires)
  userStartMs = Infinity, // when the user starts talking (Infinity = never)
  userRms = 0.3, // conversational barge-in level, independent of echo bleed
  totalMs,
  onFrame, // optional observer(t, detector)
}) {
  const detector = createBargeInDetector(0);
  const activity = { underrunAt: 0 };
  let lastUnderrunSeen = 0;
  let nextChunk = 0;

  for (let t = 0; t <= totalMs; t += FRAME_MS) {
    // Fire onFirstByte for any chunk whose audio resumes at/just before this
    // tick (spoken-reply-playback.ts stamps activity.underrunAt on resume).
    while (nextChunk < chunkStartsMs.length && chunkStartsMs[nextChunk] <= t) {
      activity.underrunAt = t;
      nextChunk += 1;
    }
    // Watcher tick: a new resume stamp opens a recalibration window first...
    if (activity.underrunAt > lastUnderrunSeen) {
      lastUnderrunSeen = activity.underrunAt;
      requestBargeInRecalibration(detector, t);
    }

    // ...then the mic RMS for this frame.
    const audioPlaying = t >= firstAudioMs;
    let bleedNow = audioPlaying ? bleed : 0;
    // Onset transient: for a short stretch after each chunk resume her bleed is
    // louder than steady state. This is exactly what the resume window (and the
    // guard's headroom) must absorb without reading it as the user.
    for (const cs of chunkStartsMs) {
      if (t >= cs && t < cs + ONSET_MS && audioPlaying) {
        bleedNow = Math.max(bleedNow, bleed * ONSET_GAIN);
      }
    }
    const talking = t >= userStartMs;
    const mic = talking ? Math.max(userRms, bleedNow) : bleedNow;

    updateBargeInDetector(detector, mic, t);
    if (onFrame) onFrame(t, detector);
    if (detector.triggered) {
      return {
        triggeredAt: t,
        latency: Number.isFinite(userStartMs) ? t - userStartMs : null,
        peakFloor: detector.peakFloor,
        threshold: bargeInThreshold(detector),
      };
    }
  }
  return {
    triggeredAt: 0,
    latency: null,
    peakFloor: detector.peakFloor,
    threshold: bargeInThreshold(detector),
  };
}

// A reply long enough to contain several sentence chunks.
const chunksFrom = (firstAudioMs, count = 5) =>
  Array.from({ length: count }, (_, i) => firstAudioMs + i * CHUNK_MS);

const fmt = (n) => (n == null ? "  —  " : `${String(n).padStart(4)}ms`);
let failures = 0;
const check = (label, cond, detail) => {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

// ===========================================================================
console.log("\n[1] Onset-coincidence: user starts EXACTLY at each mid-reply chunk seam");
console.log("    (bleed established by earlier chunks -> guard active -> must break in fast)");
// Sweep the user-start across every established chunk seam (chunk 2..5) at a
// range of sub-frame offsets around the seam. All must fire < 700ms.
{
  let worst = 0;
  let worstAt = null;
  for (const bleed of [0.03, 0.06]) {
    const seams = chunksFrom(0).slice(1); // skip chunk 0 (bleed not yet established)
    for (const seam of seams) {
      for (const off of [-16, 0, 16, 48, 96]) {
        const userStartMs = seam + off;
        const r = runReply({
          bleed,
          chunkStartsMs: chunksFrom(0),
          userStartMs,
          totalMs: userStartMs + 1_500,
        });
        assert.ok(r.triggeredAt > 0, `no trigger at bleed ${bleed}, seam ${seam}, off ${off}`);
        if (r.latency > worst) {
          worst = r.latency;
          worstAt = { bleed, seam, off, ...r };
        }
      }
    }
  }
  console.log(
    `    worst-case onset latency ${fmt(worst)} ` +
      `(bleed ${worstAt.bleed}, seam ${worstAt.seam}ms, offset ${worstAt.off}ms)`,
  );
  check("onset-coincidence fires < 700ms", worst < 700, `worst ${worst}ms`);
}

// ===========================================================================
console.log("\n[2] Mid-chunk interrupt (no seam nearby) still fires within the sustain window");
{
  let worst = 0;
  for (const bleed of [0.03, 0.06]) {
    // Start ~1.2s into a chunk, far from any resume window.
    const userStartMs = 2 * CHUNK_MS + 1_200;
    const r = runReply({
      bleed,
      chunkStartsMs: chunksFrom(0),
      userStartMs,
      totalMs: userStartMs + 1_500,
    });
    assert.ok(r.triggeredAt > 0, `no mid-chunk trigger at bleed ${bleed}`);
    worst = Math.max(worst, r.latency);
    console.log(`    bleed ${bleed}: latency ${fmt(r.latency)}`);
  }
  // Sustain is 420ms; a frame or two of slack is expected (16ms granularity).
  check(
    "mid-chunk fires ~420ms (sustainMs .. sustainMs+3 frames)",
    worst >= BARGE_IN_TUNING.sustainMs - FRAME_MS && worst <= BARGE_IN_TUNING.sustainMs + 3 * FRAME_MS,
    `worst ${worst}ms vs sustain ${BARGE_IN_TUNING.sustainMs}ms`,
  );
}

// ===========================================================================
console.log("\n[3] Zero false self-triggers on her own bleed (no user at all)");
{
  const cases = [
    { name: "(a) normal bleed 0.03", bleed: 0.03, firstAudioMs: 0 },
    { name: "(b) loud bleed 0.06", bleed: 0.06, firstAudioMs: 0 },
    {
      name: "(c) first-chunk-after-slow-synth 0.06 (TTFB 900ms > grace 600ms)",
      bleed: 0.06,
      firstAudioMs: 900,
    },
  ];
  for (const c of cases) {
    const chunkStartsMs = chunksFrom(c.firstAudioMs);
    const r = runReply({
      bleed: c.bleed,
      firstAudioMs: c.firstAudioMs,
      chunkStartsMs,
      totalMs: chunkStartsMs[chunkStartsMs.length - 1] + CHUNK_MS,
    });
    check(
      `no self-trigger — ${c.name}`,
      r.triggeredAt === 0,
      `floor->thr ${r.threshold.toFixed(3)}, peak ${r.peakFloor.toFixed(3)}` +
        (r.triggeredAt ? `, SELF-TRIGGERED @${r.triggeredAt}ms` : ""),
    );
  }
}

// ===========================================================================
// Contrast: the SAME onset-coincidence scenario against the pre-fix behaviour
// (guard disabled by making establishment impossible) to substantiate that the
// old absorb-only window latched the user out. Reuses the REAL update logic.
console.log("\n[4] Before/after contrast on the onset-coincidence scenario");
{
  const scenario = {
    bleed: 0.03,
    chunkStartsMs: chunksFrom(0),
    userStartMs: 2 * CHUNK_MS, // user starts exactly at chunk-2 seam
    totalMs: 2 * CHUNK_MS + 4_000,
  };
  const after = runReply(scenario);

  // Pre-fix: disable the guard by forcing establishment to never happen, then
  // restore. establishedFloorRatio is a runtime property (as-const is not a
  // freeze), so this cleanly neutralises the guard while keeping every other
  // line of the real detector identical to the shipped pre-fix behaviour.
  const savedRatio = BARGE_IN_TUNING.establishedFloorRatio;
  BARGE_IN_TUNING.establishedFloorRatio = Number.POSITIVE_INFINITY;
  let before;
  try {
    before = runReply(scenario);
  } finally {
    BARGE_IN_TUNING.establishedFloorRatio = savedRatio;
  }

  console.log(
    `    before (guard off): ${before.triggeredAt ? fmt(before.latency) : "never within window"}`,
  );
  console.log(`    after  (guard on):  ${fmt(after.latency)}`);
  check("guard restores a fast onset interrupt", after.latency != null && after.latency < 700);
  check(
    "guard is what fixed it (pre-fix latched much slower / never)",
    before.triggeredAt === 0 || before.latency > after.latency + 500,
    before.triggeredAt
      ? `before ${before.latency}ms vs after ${after.latency}ms`
      : "before never broke through the window",
  );
}

// ===========================================================================
console.log(
  `\nbarge-in-wiring-sim: ${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK(S) FAILED`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
