#!/usr/bin/env node

// Dev-only PROTOTYPE: Mem0-style write-time distillation for conversation
// archives, used to measure whether ingestion-time fact extraction closes the
// remaining benchmark gap before any productization decision. For each session
// of a LoCoMo conversation it asks the configured OpenAI-compatible endpoint
// (the loopback claude CLI adapter) to extract dated durable facts, and writes
// them as sidecar JSON keyed by conversation/session so the retrieval harness
// can ingest them as additional notes. The extraction prompt is generic memory
// distillation — it knows nothing about any benchmark's question styles.

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const DISTILL_PROMPT = `You are a memory distillation service. Given one conversation session with its date, extract the durable facts a personal memory system should retain.

Rules:
- One fact per line, formatted as: [YYYY-MM-DD] <speaker>: <fact>
- Resolve every relative time expression ("yesterday", "last weekend", "next Friday", "two weeks ago") into an absolute date using the session date.
- Keep concrete details verbatim: names, places, numbers, amounts, titles, quoted phrases, and what is shown in any described image or attachment.
- Record events, plans (with their planned dates), purchases, preferences, relationships, achievements, health and life updates, and stated opinions.
- Attribute each fact to the speaker it is about.
- Do not summarize away specifics; a fact list with exact details beats prose.
- Output only the fact lines, nothing else.`;

function parseArgs(argv) {
  const args = { baseUrl: "http://127.0.0.1:8767/v1/chat/completions", model: "claude-sonnet-5", sessionsPerCall: 5, timeoutMs: 300_000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dataset") args.dataset = argv[++index];
    else if (argv[index] === "--output") args.output = argv[++index];
    else if (argv[index] === "--conversations") args.conversations = argv[++index];
    else if (argv[index] === "--base-url") args.baseUrl = argv[++index];
    else if (argv[index] === "--model") args.model = argv[++index];
    else if (argv[index] === "--sessions-per-call") args.sessionsPerCall = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.dataset || !args.output) throw new Error("--dataset and --output are required");
  return args;
}

// Mirrors the harness lib's locomo session extraction shape (session_N keys +
// session_N_date_time) without importing app code.
function locomoSessions(entry) {
  const conv = entry.conversation ?? {};
  const sessions = [];
  for (const key of Object.keys(conv)) {
    const match = key.match(/^session_(\d+)$/);
    if (!match || !Array.isArray(conv[key])) continue;
    const dateTime = conv[`session_${match[1]}_date_time`] ?? "";
    const lines = conv[key].map((turn) => {
      const caption = turn.blip_caption ? ` [Sharing image: ${turn.blip_caption}]` : "";
      return `${turn.speaker}: ${turn.text ?? ""}${caption}`;
    });
    sessions.push({ index: Number(match[1]), dateTime, text: lines.join("\n") });
  }
  return sessions.sort((left, right) => left.index - right.index);
}

async function complete(baseUrl, model, prompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    });
    if (!response.ok) throw new Error(`distill HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const payload = await response.json();
    return String(payload.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(await readFile(resolve(args.dataset), "utf8"));
  const indices = args.conversations
    ? args.conversations.split(",").map((value) => Number(value.trim()))
    : dataset.map((_, index) => index);
  await mkdir(resolve(args.output), { recursive: true });
  let calls = 0;
  for (const conversationIndex of indices) {
    const outPath = join(resolve(args.output), `conv${conversationIndex}.json`);
    if (await stat(outPath).catch(() => null)) {
      console.log(`conv${conversationIndex}: already distilled, skipping`);
      continue;
    }
    const sessions = locomoSessions(dataset[conversationIndex]);
    const facts = {};
    for (let start = 0; start < sessions.length; start += args.sessionsPerCall) {
      const batch = sessions.slice(start, start + args.sessionsPerCall);
      const prompt = [
        DISTILL_PROMPT,
        ...batch.map((session) => `\n=== SESSION ${session.index} (date: ${session.dateTime}) ===\n${session.text}`),
        "\nFor each session, output a heading line '## SESSION <number>' followed by its fact lines.",
      ].join("\n");
      const text = await complete(args.baseUrl, args.model, prompt, args.timeoutMs);
      calls += 1;
      let current = null;
      for (const line of text.split("\n")) {
        const heading = line.match(/^##\s*SESSION\s+(\d+)/i);
        if (heading) { current = Number(heading[1]); facts[current] = facts[current] ?? []; continue; }
        if (current !== null && line.trim()) facts[current].push(line.trim());
      }
      console.log(`conv${conversationIndex}: sessions ${batch.map((s) => s.index).join(",")} distilled (${calls} calls)`);
    }
    const sessionDates = Object.fromEntries(sessions.map((session) => [session.index, session.dateTime]));
    await writeFile(outPath, `${JSON.stringify({ conversationIndex, sessionDates, facts }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ ok: true, calls, output: resolve(args.output) }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
