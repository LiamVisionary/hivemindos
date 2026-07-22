// A/B benchmark: current weighted-sum fusion vs reciprocal-rank fusion (RRF)
// over the same per-signal scores from the agent-memory scorer. Standalone
// experiment (NOT in the pnpm test gate): deterministic labeled fixtures, a
// local fake embedding server (character trigrams) so the semantic lane
// participates, and MRR / hit@k per query class. Run:
//   node scripts/benchmark-fusion-rrf.mjs
import http from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_MEMORY_PROOFS = "off";
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;

const core = await import("../src/lib/services/obsidian/agent-memory/core.ts");
const scoring = await import("../src/lib/services/obsidian/agent-memory/scoring.ts");
const embeddings = await import("../src/lib/services/obsidian/agent-memory/embeddings.ts");

// --- fake embedding server (same trigram scheme as the hardening suite) ----
function fakeVector(text) {
  const vector = new Array(96).fill(0);
  const lower = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  for (let index = 0; index + 3 <= lower.length; index += 1) {
    const tri = lower.slice(index, index + 3);
    let hash = 0;
    for (const char of tri) hash = (hash * 31 + char.charCodeAt(0)) % 96;
    vector[hash] += 1;
  }
  return vector;
}
const embedServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: inputs.map((text, index) => ({ index, embedding: fakeVector(String(text)) })) }));
  });
});
await new Promise((resolveListen) => embedServer.listen(0, "127.0.0.1", resolveListen));
process.env.HIVEMINDOS_EMBEDDINGS_URL = `http://127.0.0.1:${embedServer.address().port}/v1`;

// --- fixture corpus --------------------------------------------------------
const tmp = await mkdtemp(join(tmpdir(), "hivemindos-fusion-bench-"));
const vaultPath = join(tmp, "vault");
await mkdir(vaultPath, { recursive: true });
await writeFile(join(vaultPath, "Shared Context.md"), "# Shared Context\n\nBenchmark vault.\n");

const TOPICS = [
  ["collector env sync retries through the offline queue", "The collector retries env pushes with hive-env-add --retry-pending and reconciles from peers every ten minutes.", "learning"],
  ["Tauri updater signing key lives in the home tauri folder", "Losing the updater private key strands every installed desktop; the key file is hivemindos-updater.key.", "instruction"],
  ["Queen voice flattens history into one user message", "The voice pipeline concatenates prior turns because the TTS brain rejects multi-message context.", "learning"],
  ["Kanban board truth lives in sharded storage", "Work Board state is stored in shards with tombstones winning over stale entries during merges.", "learning"],
  ["Fleet watchdog force-restarts dead collectors over linkd shell", "The health watchdog probes collectors and restarts them through POST /api/fleet/shell on the remote machine.", "learning"],
  ["Wallet add-chain re-derives keys from the vault secret", "Adding a chain to an existing wallet re-derives from the stored mnemonic instead of generating fresh entropy.", "decision"],
  ["Dashboard auth gate loads only from src proxy", "Next sixteen with a src layout ignores a root middleware file; every API route is gated in src/proxy.ts.", "learning"],
  ["LM Studio app running does not mean the server is running", "Check lms server status; the desktop app does not start the OpenAI-compatible port automatically.", "learning"],
  ["Telegram tip bot runs on the VPS not the Mac", "Never re-enable the Mac autostart while the VPS systemd service owns the bot token.", "instruction"],
  ["Windows in-place upgrade ships stale resources", "The installer updates the executable but not bundled resources; an NSIS hook forces the resource copy.", "learning"],
  ["Ollama tags endpoint lists local models", "The tags API on port eleven-four-three-four enumerates pulled models for the runtime adapter.", "learning"],
  ["Stake page seasons are backward-looking receipted reports", "Holder communications must never promise forward yield; seasons summarize what already happened with receipts.", "instruction"],
];

const seeded = [];
for (const [title, content, type] of TOPICS) {
  const filler = Array.from({ length: 30 }, (unused, i) => `Routine paragraph ${i} about unrelated fleet housekeeping, scheduling chatter, and periodic maintenance notes for padding.`);
  const long = seeded.length % 3 === 0; // every third memory is long → chunked
  const body = long ? [...filler.slice(0, 26), content, ...filler.slice(26)].join("\n\n") : content;
  const written = await core.rememberAgentMemory({ vaultPath, type, title, content: body });
  seeded.push({ id: written.record.id, title });
}

// Labeled queries: [query, targetTitle, class]
const QUERIES = [
  ["hive-env-add retry-pending queue", TOPICS[0][0], "exact-token"],
  ["how do env keys reach other machines when a push fails", TOPICS[0][0], "paraphrase"],
  ["hivemindos-updater.key", TOPICS[1][0], "exact-token"],
  ["what happens if we lose the desktop update signing secret", TOPICS[1][0], "paraphrase"],
  ["voice pipeline multi message context rejected", TOPICS[2][0], "paraphrase"],
  ["tombstones win during kanban merge", TOPICS[3][0], "exact-token"],
  ["where is work board state actually stored", TOPICS[3][0], "paraphrase"],
  ["POST /api/fleet/shell restart", TOPICS[4][0], "exact-token"],
  ["how do dead collectors get revived automatically", TOPICS[4][0], "paraphrase"],
  ["wallet mnemonic re-derivation on add chain", TOPICS[5][0], "paraphrase"],
  ["root middleware.ts silently ignored", TOPICS[6][0], "exact-token"],
  ["why do api routes 401 when middleware exists at repo root", TOPICS[6][0], "paraphrase"],
  ["lms server status check", TOPICS[7][0], "exact-token"],
  ["desktop app open but port 1234 closed", TOPICS[7][0], "paraphrase"],
  ["tip bot autostart conflict", TOPICS[8][0], "paraphrase"],
  ["NSIS hook resource copy", TOPICS[9][0], "exact-token"],
  ["windows updater leaves old files behind", TOPICS[9][0], "paraphrase"],
  ["ollama port 11434 model list", TOPICS[10][0], "exact-token"],
  ["forward yield promises to holders", TOPICS[11][0], "paraphrase"],
  ["receipted backward-looking season report", TOPICS[11][0], "exact-token"],
];

// --- score once, fuse twice ------------------------------------------------
const { records } = await core.listAgentMemoryRecords({ vaultPath });
const targetIdByTitle = new Map(seeded.map((memory) => [memory.title, memory.id]));

const RRF_K = 60;
// Retrieval families fused by rank; priors fused as one additional list.
function rrfFuse(scoredRecords) {
  const families = ["exactFamily", "lexical", "semantic", "entity", "priors"];
  const ranks = new Map(scoredRecords.map((row) => [row.id, {}]));
  for (const family of families) {
    const ranked = [...scoredRecords].filter((row) => row[family] > 0).sort((a, b) => b[family] - a[family]);
    ranked.forEach((row, index) => { ranks.get(row.id)[family] = index + 1; });
  }
  return scoredRecords.map((row) => {
    const familyRanks = ranks.get(row.id);
    let fused = 0;
    for (const family of families) {
      if (familyRanks[family]) fused += 1 / (RRF_K + familyRanks[family]);
    }
    return { id: row.id, score: fused };
  }).sort((a, b) => b.score - a.score);
}

async function rankForQuery(query) {
  const input = { query };
  const lexicalScores = scoring.bm25ScoresForRecords(records, input);
  const semanticScores = await embeddings.semanticScoresForRecords(vaultPath, query, records);
  const scored = records.map((record) => {
    const lexical = lexicalScores.get(record.id);
    const semantic = semanticScores.get(record.id);
    const { score, scoreDetails } = scoring.scoreAgentMemory(record, input, lexical, semantic);
    return {
      id: record.id,
      weightedSum: score,
      exactFamily: (scoreDetails.exact ?? 0) + (scoreDetails.coverage ?? 0),
      lexical: scoreDetails.lexical ?? 0,
      semantic: scoreDetails.semantic ?? 0,
      entity: scoreDetails.entity ?? 0,
      priors: (scoreDetails.temporal ?? 0) + (scoreDetails.recency ?? 0) + (scoreDetails.usage ?? 0)
        + (scoreDetails.confidence ?? 0) + (scoreDetails.intent ?? 0) + (scoreDetails.status ?? 0),
    };
  });
  const baseline = [...scored].sort((a, b) => b.weightedSum - a.weightedSum).map((row) => row.id);
  const rrf = rrfFuse(scored).map((row) => row.id);
  return { baseline, rrf };
}

function metricAccumulator() {
  return { queries: 0, mrr: 0, hit1: 0, hit3: 0 };
}
function record(accumulator, ranking, targetId) {
  const rank = ranking.indexOf(targetId) + 1;
  accumulator.queries += 1;
  if (rank > 0) {
    accumulator.mrr += 1 / rank;
    if (rank === 1) accumulator.hit1 += 1;
    if (rank <= 3) accumulator.hit3 += 1;
  }
}

const perClass = new Map();
for (const [query, targetTitle, klass] of QUERIES) {
  const targetId = targetIdByTitle.get(targetTitle);
  const { baseline, rrf } = await rankForQuery(query);
  if (!perClass.has(klass)) perClass.set(klass, { baseline: metricAccumulator(), rrf: metricAccumulator() });
  record(perClass.get(klass).baseline, baseline, targetId);
  record(perClass.get(klass).rrf, rrf, targetId);
}

const overall = { baseline: metricAccumulator(), rrf: metricAccumulator() };
for (const { baseline, rrf } of perClass.values()) {
  for (const [side, acc] of [["baseline", baseline], ["rrf", rrf]]) {
    overall[side].queries += acc.queries;
    overall[side].mrr += acc.mrr;
    overall[side].hit1 += acc.hit1;
    overall[side].hit3 += acc.hit3;
  }
}

function show(label, acc) {
  const n = acc.queries || 1;
  return `${label}: MRR ${(acc.mrr / n).toFixed(3)} · hit@1 ${(acc.hit1 / n * 100).toFixed(0)}% · hit@3 ${(acc.hit3 / n * 100).toFixed(0)}% (${acc.queries} queries)`;
}

console.log("Fusion A/B — current weighted-sum vs RRF (k=60), identical signals\n");
for (const [klass, sides] of perClass) {
  console.log(`[${klass}]`);
  console.log("  " + show("weighted-sum", sides.baseline));
  console.log("  " + show("rrf         ", sides.rrf));
}
console.log("[overall]");
console.log("  " + show("weighted-sum", overall.baseline));
console.log("  " + show("rrf         ", overall.rrf));

embedServer.close();
