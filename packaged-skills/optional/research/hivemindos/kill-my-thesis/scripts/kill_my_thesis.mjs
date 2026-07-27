#!/usr/bin/env node
// Cross-family adversarial thesis gate.
// Sends a thesis/wiki markdown file to a NON-Anthropic model for hostile review
// and writes a structured verdict file. Fail-closed: anything other than an
// explicit PUBLISHABLE verdict exits non-zero.
//
// Usage:
//   hive-env-run -- node kill_my_thesis.mjs <thesis.md> [--out <verdict.md>] [--model <id>] [--topic "<extra context>"]
//
// Exit codes: 0 PUBLISHABLE · 2 NEEDS WORK · 3 DO NOT PUBLISH · 1 error/no-verdict (fail closed)
//
// Keys (loaded via hive-env-run, never hardcoded): OPENROUTER_API_KEY preferred,
// GEMINI_API_KEY / GOOGLE_API_KEY as Google-direct fallback.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

const ANTHROPIC_FAMILY = /claude|anthropic|fable|mythos/i;
const OPENROUTER_MODELS = ["x-ai/grok-4.3", "google/gemini-2.5-pro", "google/gemini-2.5-flash"];
const GOOGLE_DIRECT_MODEL = "gemini-2.5-pro";
const MAX_THESIS_CHARS = 100_000;

function usageExit(msg) {
  if (msg) console.error(`kill-my-thesis: ${msg}`);
  console.error("usage: kill_my_thesis.mjs <thesis.md> [--out <verdict.md>] [--model <id>] [--topic <extra context>]");
  process.exit(1);
}

const args = process.argv.slice(2);
let thesisPath = null, outPath = null, modelOverride = null, topic = "";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out") outPath = args[++i];
  else if (a === "--model") modelOverride = args[++i];
  else if (a === "--topic") topic = args[++i] ?? "";
  else if (!thesisPath) thesisPath = a;
  else usageExit(`unexpected argument: ${a}`);
}
if (!thesisPath) usageExit("missing thesis file");
thesisPath = resolve(thesisPath);

let thesis;
try {
  thesis = readFileSync(thesisPath, "utf8");
} catch (e) {
  usageExit(`cannot read ${thesisPath}: ${e.message}`);
}
if (!thesis.trim()) usageExit("thesis file is empty");
if (thesis.length > MAX_THESIS_CHARS) {
  console.error(`kill-my-thesis: thesis truncated to ${MAX_THESIS_CHARS} chars for review`);
  thesis = thesis.slice(0, MAX_THESIS_CHARS);
}

if (modelOverride && ANTHROPIC_FAMILY.test(modelOverride)) {
  usageExit(
    `refusing model "${modelOverride}": the adversarial reviewer must be a different model family than the (Claude) synthesis layer. Pick a non-Anthropic model.`
  );
}

const stamp = new Date().toISOString().slice(0, 10);
if (!outPath) {
  const base = basename(thesisPath).replace(/\.md$/i, "");
  outPath = resolve(dirname(thesisPath), `kill-my-thesis-${base}-${stamp}.md`);
} else {
  outPath = resolve(outPath);
}

const PROMPT = `You are a hostile counterparty reviewing a research thesis you did not write and have no stake in. Your job is to break it, not to improve it. Be specific and quantitative; vague criticism is worthless. Judge only what is on the page — an argument that depends on data not present in the document is an argument that fails.
${topic ? `\nExtra reviewer context from the operator: ${topic}\n` : ""}
Return STRICT markdown with exactly these sections, in this order:

## Key Line Audit
The single weakest load-bearing claim in the thesis. Quote it. Then: the specific data that would CONFIRM it, and the specific data that would INVALIDATE it.

## Unstated Assumptions
The assumptions the thesis makes without stating them. For each: what happens to the thesis if the assumption is false.

## Structural Bear Case
The strongest coherent argument AGAINST the thesis, written as if you held the opposite position. Use comparables and precedents where they exist.

## Kill Conditions
Exactly 3 specific, measurable conditions that would break the thesis. Each must be checkable against observable data (a price level, a dated event, a metric threshold) — not a vibe.

## Verdict
One line, exactly: \`VERDICT: PUBLISHABLE\` or \`VERDICT: NEEDS WORK\` or \`VERDICT: DO NOT PUBLISH\`
Then one paragraph justifying it. NEEDS WORK must name the specific section(s) that fail. Default to NEEDS WORK when uncertain — a false PUBLISHABLE is far more costly than a false NEEDS WORK.

--- THESIS UNDER REVIEW ---

${thesis}`;

async function callOpenRouter(model) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, error: "OPENROUTER_API_KEY absent" };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: PROMPT }],
      temperature: 0.4,
      // Reasoning models can burn the whole budget thinking and return an empty
      // completion; a generous ceiling keeps text flowing without capping quality.
      max_tokens: 16000,
    }),
  });
  if (!res.ok) return { ok: false, error: `openrouter ${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}` };
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return { ok: false, error: `openrouter ${model}: empty completion` };
  return { ok: true, text, model: data?.model ?? model, provider: "openrouter" };
}

async function callGoogleDirect(model) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY/GOOGLE_API_KEY absent" };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
    }
  );
  if (!res.ok) return { ok: false, error: `google ${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}` };
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) return { ok: false, error: `google ${model}: empty completion` };
  return { ok: true, text, model, provider: "google" };
}

const attempts = [];
const plan = modelOverride
  ? [() => callOpenRouter(modelOverride), () => callGoogleDirect(modelOverride)]
  : [
      ...OPENROUTER_MODELS.map((m) => () => callOpenRouter(m)),
      () => callGoogleDirect(GOOGLE_DIRECT_MODEL),
    ];

let result = null;
for (const attempt of plan) {
  result = await attempt();
  if (result.ok) break;
  attempts.push(result.error);
  console.error(`kill-my-thesis: ${result.error} — trying next reviewer`);
}

if (!result?.ok) {
  console.error("kill-my-thesis: FAIL-CLOSED — no cross-family reviewer reachable. No verdict granted.");
  console.error(attempts.map((a) => `  - ${a}`).join("\n"));
  process.exit(1);
}

const match = result.text.match(/VERDICT:\s*(PUBLISHABLE|NEEDS WORK|DO NOT PUBLISH)/i);
const verdict = match ? match[1].toUpperCase() : null;

const header = `---
verdict: ${verdict ?? "NO VERDICT (fail-closed)"}
reviewer_model: ${result.model}
reviewer_provider: ${result.provider}
thesis_file: ${thesisPath}
reviewed: ${new Date().toISOString()}
---

`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header + result.text.trim() + "\n");

console.log(`reviewer: ${result.model} (${result.provider})`);
console.log(`report:   ${outPath}`);
if (!verdict) {
  console.error("kill-my-thesis: FAIL-CLOSED — reviewer returned no parseable VERDICT line. Treat as NEEDS WORK.");
  process.exit(1);
}
console.log(`verdict:  ${verdict}`);
process.exit(verdict === "PUBLISHABLE" ? 0 : verdict === "NEEDS WORK" ? 2 : 3);
