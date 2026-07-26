#!/usr/bin/env node
// Unit tests for Hive Fusion: the orchestrator control flow (fan-out -> judge ->
// synthesize, with partial-failure, all-failure, synth-fallback, single-success,
// hosted-OpenRouter, quorum-release-with-straggler, emit-throw-on-disconnect,
// and judge-JSON-contract paths) plus the judge-analysis JSON parser. Runs offline:
// the orchestrator's provider callers are injected with fakes, and a tiny resolve
// hook lets Node import the project's .ts modules directly.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { runFusion } = await import("../src/lib/services/fusion/orchestrator.ts");
const { parseJudgeAnalysis, extractQuestion, analysisSummary, messageText } = await import(
  "../src/lib/services/fusion/prompts.ts"
);

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
}

function member(provider, model) {
  return { id: `${provider}:${model}`, label: `${model} · ${provider}`, provider, model, baseUrl: "http://x/v1", apiKey: "k" };
}

const P1 = member("openrouter", "alpha");
const P2 = member("venice", "beta");
const P3 = member("groq", "gamma");
const JUDGE = member("openai", "judge");
const SYNTH = member("openai", "synth");

const ANALYSIS_JSON = JSON.stringify({
  consensus: ["The sky appears blue due to Rayleigh scattering."],
  contradictions: [],
  partialCoverage: ["sunsets"],
  uniqueInsights: ["beta noted atmospheric thickness"],
  blindSpots: ["other planets"],
  recommendedFocus: "Explain Rayleigh scattering plainly.",
});

const messages = [{ role: "user", content: "Why is the sky blue?" }];

// A configurable fake set of callers + a fixed native plan.
function makeFakes({ failMembers = [], judgeText = ANALYSIS_JSON, synthThrows = false, judgeThrows = false } = {}) {
  const calls = [];
  const call = async (m) => {
    calls.push(m.id);
    if (m.id === JUDGE.id) {
      if (judgeThrows) throw new Error("judge offline");
      return { text: judgeText };
    }
    if (failMembers.includes(m.id)) throw new Error(`${m.label} timed out`);
    return { text: `Answer about the blue sky from ${m.label}.` };
  };
  const streamed = [];
  const stream = async (m, _messages, opts) => {
    if (synthThrows) throw new Error("synth offline");
    const chunks = ["The sky is blue ", "because of Rayleigh ", "scattering."];
    for (const c of chunks) opts.onDelta(c);
    streamed.push(m.id);
    return { text: chunks.join("") };
  };
  return { call, stream, calls, streamed };
}

const nativePlan = { mode: "native", participants: [P1, P2, P3], judge: JUDGE, synthesizer: SYNTH, notes: [] };
const resolveNative = async () => nativePlan;

function collector() {
  const events = [];
  return { emit: (e) => events.push(e), events, types: () => events.map((e) => e.type) };
}

// 1) Happy path: 3 succeed, judge runs, synth streams.
{
  const { call, stream, calls } = makeFakes();
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("happy: all 3 panel members + judge called", calls.length === 4);
  check("happy: judge ran on panel", calls.includes(JUDGE.id));
  check("happy: final text is the synthesized answer", result.finalText === "The sky is blue because of Rayleigh scattering.");
  check("happy: analysis parsed", result.analysis && result.analysis.consensus.length === 1);
  check("happy: meta counts", result.meta.participantsSucceeded === 3 && result.meta.participantsTotal === 3 && result.meta.judged === true);
  check("happy: emitted plan + judge.done + done", c.types().includes("plan") && c.types().includes("judge.done") && c.types().includes("done"));
  check("happy: 3 member.start and 3 member.done", c.events.filter((e) => e.type === "member.start").length === 3 && c.events.filter((e) => e.type === "member.done").length === 3);
  const synthText = c.events.filter((e) => e.type === "synth.delta").map((e) => e.delta).join("");
  check("happy: synth deltas reconstruct final text", synthText === result.finalText);
}

// 2) Partial failure: one member fails, judge still runs on the remaining two.
{
  const { call, calls } = makeFakes({ failMembers: [P2.id] });
  const { stream } = makeFakes();
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("partial: judge still ran (>=2 ok)", calls.includes(JUDGE.id) && result.meta.judged === true);
  check("partial: 2 succeeded", result.meta.participantsSucceeded === 2);
  const failedDone = c.events.find((e) => e.type === "member.done" && e.id === P2.id);
  check("partial: failed member.done marked not ok", failedDone && failedDone.ok === false);
  check("partial: still produced an answer", result.finalText.length > 0);
}

// 3) All members fail -> runFusion rejects, emits error.
{
  const { call, stream } = makeFakes({ failMembers: [P1.id, P2.id, P3.id] });
  const c = collector();
  let threw = false;
  try {
    await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  } catch {
    threw = true;
  }
  check("all-fail: rejected", threw);
  check("all-fail: emitted error event", c.types().includes("error"));
}

// 4) Synth fails but panel succeeded -> falls back to strongest panel answer (no throw).
{
  const { call } = makeFakes();
  const { stream } = makeFakes({ synthThrows: true });
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("synth-fallback: did not throw and returned panel text", result.finalText.startsWith("Answer about the blue sky"));
  check("synth-fallback: still emitted done", c.types().includes("done"));
}

// 4b) Synth fails AFTER streaming partial output -> keep partial, do NOT append a full panel answer.
{
  const { call } = makeFakes();
  const partialStream = async (m, _messages, opts) => {
    opts.onDelta("partial answer so far ");
    throw new Error("synth dropped mid-stream");
  };
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream: partialStream, emit: c.emit });
  check("mid-stream-fail: keeps only the partial synth text", result.finalText === "partial answer so far ");
  check("mid-stream-fail: does NOT concatenate a full panel answer", !result.finalText.includes("Answer about the blue sky"));
  const fallbackDeltas = c.events.filter((e) => e.type === "synth.delta");
  check("mid-stream-fail: no extra full-answer synth.delta emitted", fallbackDeltas.length === 1);
  check("mid-stream-fail: still finished (done)", c.types().includes("done"));
}

// 5) Single success -> judge skipped, synth still runs.
{
  const { call } = makeFakes({ failMembers: [P2.id, P3.id] });
  const { stream } = makeFakes();
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("single: judge skipped", c.types().includes("judge.skipped") && result.meta.judged === false);
  check("single: one succeeded", result.meta.participantsSucceeded === 1);
  check("single: synthesized answer present", result.finalText === "The sky is blue because of Rayleigh scattering.");
}

// 6) Judge throws -> judge.skipped, synth still runs without analysis.
{
  const { call, stream } = makeFakes({ judgeThrows: true });
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("judge-throw: judge skipped, analysis null", c.types().includes("judge.skipped") && result.analysis === null);
  check("judge-throw: still synthesized", result.finalText.length > 0);
}

// 7) Hosted OpenRouter mode -> single stream proxy, no panel calls, no judge.
{
  const orMember = member("openrouter", "openrouter/fusion");
  const orPlan = { mode: "openrouter", participants: [orMember], judge: null, synthesizer: orMember, notes: [] };
  const { call, stream, calls } = makeFakes();
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: async () => orPlan, call, stream, emit: c.emit });
  check("hosted: no panel/judge calls (only stream)", calls.length === 0);
  check("hosted: produced answer", result.finalText.length > 0);
  check("hosted: emitted synth.start + done, no member events", c.types().includes("synth.start") && c.types().includes("done") && !c.types().includes("member.start"));
}

// --- prompts.ts: judge analysis parser + helpers ---

// 8) Clean JSON.
{
  const a = parseJudgeAnalysis(ANALYSIS_JSON);
  check("parse: clean json consensus", a.consensus.length === 1 && a.recommendedFocus.includes("Rayleigh"));
}
// 9) Fenced JSON.
{
  const a = parseJudgeAnalysis("```json\n" + ANALYSIS_JSON + "\n```");
  check("parse: fenced json", a.blindSpots.includes("other planets"));
}
// 10) Prose-wrapped JSON.
{
  const a = parseJudgeAnalysis("Here is my analysis:\n" + ANALYSIS_JSON + "\nThanks!");
  check("parse: prose-wrapped json", a.uniqueInsights.length === 1);
}
// 11) Malformed -> raw fallback, arrays empty.
{
  const a = parseJudgeAnalysis("not json at all");
  check("parse: malformed falls back to raw", a.raw === "not json at all" && a.consensus.length === 0);
}
// 12) Non-array fields coerced safely.
{
  const a = parseJudgeAnalysis(JSON.stringify({ consensus: "single string", blindSpots: [1, 2] }));
  check("parse: non-array consensus -> empty, numbers coerced", a.consensus.length === 0 && a.blindSpots.length === 2);
}
// 13) extractQuestion uses latest non-empty user message.
{
  const q = extractQuestion([
    { role: "user", content: "first" },
    { role: "assistant", content: "..." },
    { role: "user", content: [{ type: "text", text: "the real question" }] },
  ]);
  check("extractQuestion: latest user text", q === "the real question");
}
// 14) messageText flattens parts.
{
  const t = messageText([{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "x" } }]);
  check("messageText: flattens parts", t.includes("hello") && t.includes("[image]"));
}
// 15) analysisSummary renders sections.
{
  const s = analysisSummary(parseJudgeAnalysis(ANALYSIS_JSON));
  check("analysisSummary: has consensus + focus", s.includes("Consensus") && s.includes("Focus:"));
}

// --- orchestrator: quorum release + judge JSON contract ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 16) Quorum release: a hung member no longer holds the panel barrier. Two fast
// successes reach quorum, the straggler gets only the (shortened) grace, is
// marked timed-out in member.done + meta, and its late result is swallowed.
{
  process.env.HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS = "80";
  try {
    let lateResolved = false;
    const call = async (m) => {
      if (m.id === JUDGE.id) return { text: ANALYSIS_JSON };
      if (m.id === P3.id) {
        return new Promise((resolve) =>
          setTimeout(() => {
            lateResolved = true;
            resolve({ text: "late straggler answer" });
          }, 600),
        );
      }
      return { text: `Answer about the blue sky from ${m.label}.` };
    };
    const { stream } = makeFakes();
    const c = collector();
    const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
    check("quorum: released while the straggler was still pending", lateResolved === false);
    const dones = c.events.filter((e) => e.type === "member.done");
    check("quorum: exactly one member.done per member", dones.length === 3 && new Set(dones.map((e) => e.id)).size === 3);
    const stragglerDone = dones.find((e) => e.id === P3.id);
    check("quorum: straggler member.done marked timed-out", stragglerDone && stragglerDone.ok === false && /straggler grace/.test(stragglerDone.error ?? ""));
    check("quorum: meta stays honest (2/3, judged)", result.meta.participantsSucceeded === 2 && result.meta.participantsTotal === 3 && result.meta.judged === true);
    check("quorum: straggler marked failed in meta panel", result.meta.panel.find((p) => p.id === P3.id)?.ok === false);
    check("quorum: synthesized answer produced", result.finalText.length > 0);
    const eventCountAtReturn = c.events.length;
    await sleep(700);
    check("quorum: late straggler eventually resolved", lateResolved === true);
    check("quorum: late result swallowed — no extra events after done", c.events.length === eventCountAtReturn);
  } finally {
    delete process.env.HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS;
  }
}

// 17) All-but-one settled with a single success also releases: one ok + one
// failed reaches quorum, the hung last member is cut at the grace, judge skipped.
{
  process.env.HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS = "60";
  try {
    const call = async (m) => {
      if (m.id === JUDGE.id) return { text: ANALYSIS_JSON };
      if (m.id === P2.id) throw new Error("beta down");
      // Hung forever; a bare pending promise does not hold the process open.
      if (m.id === P3.id) return new Promise(() => {});
      return { text: `Answer about the blue sky from ${m.label}.` };
    };
    const { stream } = makeFakes();
    const c = collector();
    const startedAt = Date.now();
    const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
    check("all-but-one: released within the grace, not the member timeout", Date.now() - startedAt < 2_000);
    check("all-but-one: single success, judge skipped, judged=false", result.meta.participantsSucceeded === 1 && c.types().includes("judge.skipped") && result.meta.judged === false);
    check("all-but-one: 3 member.done events", c.events.filter((e) => e.type === "member.done").length === 3);
    check("all-but-one: still answered", result.finalText.length > 0 && c.types().includes("done"));
  } finally {
    delete process.env.HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS;
  }
}

// 18) Judge replies with prose -> exactly one corrective retry -> retry parses -> judged=true.
{
  const judgeCalls = [];
  const call = async (m, msgs) => {
    if (m.id === JUDGE.id) {
      judgeCalls.push(msgs);
      return { text: judgeCalls.length === 1 ? "Sure! Here are my thoughts in prose, not JSON." : ANALYSIS_JSON };
    }
    return { text: `Answer about the blue sky from ${m.label}.` };
  };
  const { stream } = makeFakes();
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("judge-retry: judge called exactly twice", judgeCalls.length === 2);
  const nudge = judgeCalls[1][judgeCalls[1].length - 1];
  check("judge-retry: corrective nudge appended as final user turn", nudge.role === "user" && /ONLY the JSON object/.test(nudge.content));
  check("judge-retry: retry parsed -> judged=true with analysis", result.meta.judged === true && result.analysis && result.analysis.consensus.length === 1);
  check("judge-retry: judge.done emitted", c.types().includes("judge.done"));
}

// 19) Judge replies with prose twice -> judge.skipped with a parse reason,
// judged stays false, analysis stays null (meta + telemetry honesty).
{
  let judgeCallCount = 0;
  const call = async (m) => {
    if (m.id === JUDGE.id) {
      judgeCallCount += 1;
      return { text: "Still prose, still not JSON." };
    }
    return { text: `Answer about the blue sky from ${m.label}.` };
  };
  const { stream } = makeFakes();
  const c = collector();
  const result = await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit: c.emit });
  check("judge-unparseable: retried once then gave up", judgeCallCount === 2);
  const skipped = c.events.find((e) => e.type === "judge.skipped");
  check("judge-unparseable: judge.skipped with parse-failure reason", skipped && /parseable JSON/.test(skipped.reason));
  check("judge-unparseable: judged=false, analysis null, no judge.done", result.meta.judged === false && result.analysis === null && !c.types().includes("judge.done"));
  check("judge-unparseable: still synthesized", result.finalText.length > 0 && c.types().includes("done"));
}

// --- orchestrator: emit throws mid-panel (client disconnect) must not hang ---

// A fake SSE controller: once the client "disconnects", every subsequent emit
// throws (route-stream's send() calls controller.enqueue, which throws after
// the client cancels). The first member.done trips the disconnect.
function disconnectingEmitter() {
  const events = [];
  let cancelled = false;
  const emit = (e) => {
    if (e.type === "member.done") cancelled = true;
    if (cancelled) throw new Error("Invalid state: Controller is already closed");
    events.push(e);
  };
  return { emit, events };
}

// Mirrors route-stream's try/catch/finally around runFusion, racing against a
// hang sentinel: pre-fix, an emit throw inside the panel barrier left runFusion
// pending forever, so the finally that finalizes the runtime chat session never
// ran. Also asserts the rejected member chains left no unhandled rejections.
async function checkRunFusionSettles(label, { call, emit }) {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { stream } = makeFakes();
    let finallyRan = false;
    const outcome = await Promise.race([
      (async () => {
        try {
          await runFusion({ messages, resolvePlan: resolveNative, call, stream, emit });
          return "resolved";
        } catch {
          return "rejected";
        } finally {
          finallyRan = true;
        }
      })(),
      sleep(1_500).then(() => "hung"),
    ]);
    check(`${label}: runFusion settled instead of hanging`, outcome !== "hung");
    check(`${label}: settled as a rejection (propagates to route-stream's catch)`, outcome === "rejected");
    check(`${label}: the route-stream finally path was reached`, finallyRan === true);
    // Let any stray rejected chains surface before asserting none leaked.
    await sleep(20);
    check(`${label}: no unhandled rejections`, unhandled.length === 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

// 20) Disconnect mid-panel with a hung straggler: the fast members' member.done
// emits throw, so their chains reject — the barrier must still count them,
// reach quorum, release at the grace, and let runFusion settle.
{
  process.env.HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS = "60";
  try {
    const call = async (m) => {
      if (m.id === JUDGE.id) return { text: ANALYSIS_JSON };
      // Hung forever; a bare pending promise does not hold the process open.
      if (m.id === P3.id) return new Promise(() => {});
      return { text: `Answer about the blue sky from ${m.label}.` };
    };
    await checkRunFusionSettles("disconnect-straggler", { call, emit: disconnectingEmitter().emit });
  } finally {
    delete process.env.HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS;
  }
}

// 21) Disconnect with every member settling: all three chains reject on their
// member.done emit, the barrier counts all of them and releases without a
// grace wait, and runFusion settles (rejecting at the next emit).
{
  const { call } = makeFakes();
  await checkRunFusionSettles("disconnect-all-settled", { call, emit: disconnectingEmitter().emit });
}

console.log(`\n✓ Hive Fusion: ${passed} assertions passed.`);
