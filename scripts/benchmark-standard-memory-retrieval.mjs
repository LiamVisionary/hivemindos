#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { register } from "node:module";

import {
  beamBatchMessages,
  beamBatchStartedAt,
  extractBeamQuestions,
  extractBeamRubricNuggets,
  formatHumanDate,
  locomoSessions,
  longMemEvalSessions,
  parseBeamChat,
  parseIndexSpec,
  percentile,
  splitMessagesForConversationNotes,
} from "./lib/standard-memory-benchmark.mjs";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { syncConversationNoteForSession } = await import("../src/lib/services/obsidian/conversation-notes.ts");
const { recallAgentMemory } = await import("../src/lib/services/obsidian/agent-memory/core.ts");
const { rebuildFullVaultSearchIndex } = await import("../src/lib/services/obsidian/full-vault-search-index.ts");

const ADAPTER_VERSION = "hivemindos-standard-memory-v1";
const MEM0_HARNESS_COMMIT = "4b61c5d";
const PRODUCT_TOP_K_LIMIT = 50;
const DEFAULT_OUTPUT_ROOT = ".outputs/benchmarks/standard-memory";

function usage() {
  return `Usage:
  node scripts/benchmark-standard-memory-retrieval.mjs --benchmark <locomo|longmemeval|beam> --dataset <json> --project-name <name> [options]

Options:
  --output-root <path>      Default: ${DEFAULT_OUTPUT_ROOT}
  --top-k <1-50>           Default: 50 (the production recall limit)
  --conversations <spec>   Conversation indices, e.g. 0-9 or 0,2,4
  --max-questions <n>      Bound questions after benchmark filtering
  --question-ids <path>    JSON array or newline-delimited question ids
  --chat-size <1M|10M>     Required for BEAM normalized datasets
  --conversation-offset n  Global BEAM index for a split one-row dataset
  --keep-vaults            Preserve temporary benchmark vaults under the output root
  --help                    Show this message
`;
}

function parseArgs(argv) {
  const args = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    topK: PRODUCT_TOP_K_LIMIT,
    keepVaults: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--keep-vaults") args.keepVaults = true;
    else if (arg === "--benchmark") args.benchmark = argv[++index];
    else if (arg === "--dataset") args.dataset = argv[++index];
    else if (arg === "--project-name") args.projectName = argv[++index];
    else if (arg === "--output-root") args.outputRoot = argv[++index];
    else if (arg === "--top-k") args.topK = Number(argv[++index]);
    else if (arg === "--conversations") args.conversations = argv[++index];
    else if (arg === "--max-questions") args.maxQuestions = Number(argv[++index]);
    else if (arg === "--question-ids") args.questionIds = argv[++index];
    else if (arg === "--chat-size") args.chatSize = argv[++index];
    else if (arg === "--conversation-offset") args.conversationOffset = Number(argv[++index]);
    else if (arg === "--distilled") args.distilled = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.help) return args;
  if (!new Set(["locomo", "longmemeval", "beam"]).has(args.benchmark)) throw new Error("--benchmark must be locomo, longmemeval, or beam");
  if (!args.dataset) throw new Error("--dataset is required");
  if (!args.projectName) throw new Error("--project-name is required");
  if (!Number.isInteger(args.topK) || args.topK < 1 || args.topK > PRODUCT_TOP_K_LIMIT) {
    throw new Error(`--top-k must be an integer from 1 to ${PRODUCT_TOP_K_LIMIT}; production recall does not expose Top-200`);
  }
  if (args.maxQuestions !== undefined && (!Number.isInteger(args.maxQuestions) || args.maxQuestions < 1)) {
    throw new Error("--max-questions must be a positive integer");
  }
  if (args.benchmark === "beam" && !new Set(["1M", "10M", "100K", "500K"]).has(args.chatSize)) {
    throw new Error("BEAM requires --chat-size 100K, 500K, 1M, or 10M");
  }
  if (args.conversationOffset !== undefined && (!Number.isInteger(args.conversationOffset) || args.conversationOffset < 0)) {
    throw new Error("--conversation-offset must be a non-negative integer");
  }
  return args;
}

async function pathExists(path) {
  return Boolean(await stat(path).catch(() => null));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function loadQuestionIds(path) {
  if (!path) return null;
  const raw = await readFile(resolve(path), "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return new Set(parsed.map(String));
  } catch {
    return new Set(raw.split("\n").map((line) => line.trim()).filter(Boolean));
  }
}

function boundedQuestions(questions, ids, maximum) {
  const filtered = ids ? questions.filter((question) => ids.has(String(question.question_id))) : questions;
  return maximum ? filtered.slice(0, maximum) : filtered;
}

function runtimeSession({ sessionId, vaultPath, startedAt, messages, agentName = "Benchmark Assistant" }) {
  const now = startedAt + Math.max(1, messages.length) * 1_000;
  return {
    id: sessionId,
    sessionId,
    runtime: "standard-memory-benchmark",
    source: "hivemindos-chat",
    agentId: "standard-memory-benchmark",
    agentName,
    sharedVaultPath: vaultPath,
    startedAt,
    updatedAt: now,
    endedAt: now,
    endReason: "benchmark-fixture-complete",
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content: message.content,
      createdAt: startedAt + index * 1_000,
    })),
  };
}

async function archiveSessions(vaultPath, prefix, sessions, agentName) {
  let written = 0;
  for (const [sessionIndex, session] of sessions.entries()) {
    const chunks = splitMessagesForConversationNotes(session.messages);
    for (const [chunkIndex, messages] of chunks.entries()) {
      const result = await syncConversationNoteForSession(runtimeSession({
        sessionId: `${prefix}-${session.id}-${sessionIndex}-${chunkIndex}`,
        vaultPath,
        startedAt: session.startedAt + chunkIndex,
        messages,
        agentName,
      }));
      if (result) written += 1;
    }
  }
  return written;
}

function searchResultsForRecall(recalled) {
  return recalled.hits.map((hit) => ({
    id: hit.id,
    memory: hit.excerpt,
    score: hit.score,
    created_at: hit.createdAt,
    updated_at: hit.updatedAt,
    metadata: {
      note_path: hit.notePath,
      type: hit.type,
      matched: hit.matched,
      collection: hit.searchCollection,
    },
  }));
}

async function retrieve(vaultPath, question, topK) {
  const started = performance.now();
  const recalled = await recallAgentMemory({
    vaultPath,
    query: question,
    scope: "full-vault",
    limit: topK,
    trackUsage: false,
  });
  return {
    results: searchResultsForRecall(recalled),
    latencyMs: performance.now() - started,
    recallScope: recalled.recallScope,
    augmentedFromVault: recalled.augmentedFromVault,
  };
}

async function createVault(outputRoot, label, keepVaults) {
  if (keepVaults) {
    const root = join(outputRoot, "vaults", label);
    await mkdir(root, { recursive: true });
    return { root, cleanup: async () => undefined };
  }
  const root = await mkdtemp(join(tmpdir(), "hivemindos-standard-memory-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function commonResult({ benchmark, questionId, question, groundTruth, retrieval, extra = {} }) {
  return {
    question_id: questionId,
    benchmark,
    question,
    ground_truth_answer: String(groundTruth ?? ""),
    retrieval: {
      search_query: question,
      search_results: retrieval.results,
      search_latency_ms: Math.round(retrieval.latencyMs * 10) / 10,
      total_results: retrieval.results.length,
      recall_scope: retrieval.recallScope,
      augmented_from_vault: retrieval.augmentedFromVault,
      adapter_version: ADAPTER_VERSION,
      top_k: retrieval.results.length,
    },
    ...extra,
  };
}

async function runLocomo({ dataset, predictionsDir, args, questionIds, latencies }) {
  const indices = args.conversations ? parseIndexSpec(args.conversations, dataset.length) : dataset.map((_, index) => index);
  let processed = 0;
  for (const conversationIndex of indices) {
    const entry = dataset[conversationIndex];
    const sessions = locomoSessions(entry);
    const vault = await createVault(resolve(args.outputRoot), `locomo-${conversationIndex}`, args.keepVaults);
    try {
      const noteCount = await archiveSessions(vault.root, `locomo-${conversationIndex}`, sessions, entry.conversation?.speaker_b ?? "Assistant");
      // Optional write-time distillation sidecar (prototype): archive one
      // dated fact note per session through the same product ingestion path.
      if (args.distilled) {
        const sidecarRaw = await readFile(join(resolve(args.distilled), `conv${conversationIndex}.json`), "utf8").catch(() => null);
        const sidecar = sidecarRaw ? JSON.parse(sidecarRaw) : null;
        if (sidecar?.facts) {
          const factSessions = sessions.map((session) => {
            const sessionIndex = Number(session.id.match(/\d+/)?.[0]);
            const lines = sidecar.facts[String(sessionIndex)] ?? [];
            if (!lines.length) return null;
            return {
              id: `${session.id}-facts`,
              startedAt: session.startedAt + 500,
              // Conversation notes require >=2 messages ending with an
              // assistant turn; facts stay in the user turn so user-grounded
              // excerpt filtering never strips them.
              messages: [
                { role: "user", content: `Distilled durable facts from the ${session.date} session:\n${lines.join("\n")}` },
                { role: "assistant", content: "Recorded the distilled session facts." },
              ],
            };
          }).filter(Boolean);
          if (factSessions.length) await archiveSessions(vault.root, `locomo-${conversationIndex}-facts`, factSessions, "Memory Distiller");
        }
      }
      const indexResult = await rebuildFullVaultSearchIndex({ root: vault.root });
      let questions = (entry.qa ?? entry.qa_pairs ?? []).map((qa, questionIndex) => ({
        ...qa,
        question_id: `conv${conversationIndex}_q${questionIndex}`,
        question_index: questionIndex,
      })).filter((qa) => [1, 2, 3, 4].includes(qa.category));
      if (questionIds) questions = questions.filter((question) => questionIds.has(question.question_id));
      if (args.maxQuestions) questions = questions.slice(0, args.maxQuestions);
      const referenceDate = sessions.length ? formatHumanDate(sessions.at(-1).startedAt) : "2023";
      for (const qa of questions) {
        const path = join(predictionsDir, `${qa.question_id}.json`);
        if (await pathExists(path)) continue;
        const retrieval = await retrieve(vault.root, qa.question, args.topK);
        latencies.push(retrieval.latencyMs);
        await writeJsonAtomic(path, commonResult({
          benchmark: "locomo",
          questionId: qa.question_id,
          question: qa.question,
          groundTruth: qa.answer,
          retrieval,
          extra: {
            conversation_idx: conversationIndex,
            category: qa.category,
            category_name: { 1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop" }[qa.category],
            evidence: qa.evidence ?? [],
            user_id: `hivemindos_locomo_${conversationIndex}`,
            reference_date: referenceDate,
            ingestion: { notes: noteCount, indexed: indexResult.indexed },
          },
        }));
        processed += 1;
        if (processed % 25 === 0) console.log(`Retrieved ${processed} LoCoMo questions`);
      }
    } finally {
      await vault.cleanup();
    }
  }
  return processed;
}

async function runLongMemEval({ dataset, predictionsDir, args, questionIds, latencies }) {
  const questions = boundedQuestions(dataset, questionIds, args.maxQuestions);
  let processed = 0;
  for (const question of questions) {
    const path = join(predictionsDir, `${question.question_id}.json`);
    if (await pathExists(path)) continue;
    const vault = await createVault(resolve(args.outputRoot), `longmemeval-${question.question_id}`, args.keepVaults);
    try {
      const sessions = longMemEvalSessions(question);
      const noteCount = await archiveSessions(vault.root, `longmemeval-${question.question_id}`, sessions, "Assistant");
      const indexResult = await rebuildFullVaultSearchIndex({ root: vault.root });
      const retrieval = await retrieve(vault.root, question.question, args.topK);
      latencies.push(retrieval.latencyMs);
      await writeJsonAtomic(path, commonResult({
        benchmark: "longmemeval",
        questionId: question.question_id,
        question: question.question,
        groundTruth: question.answer,
        retrieval,
        extra: {
          question_type: question.question_type,
          question_date: question.question_date ?? "",
          is_abstention: String(question.question_id).endsWith("_abs"),
          user_id: `hivemindos_${question.question_id}`,
          answer_session_ids: question.answer_session_ids ?? [],
          ingestion: { notes: noteCount, indexed: indexResult.indexed },
        },
      }));
      processed += 1;
      if (processed % 10 === 0) console.log(`Retrieved ${processed}/${questions.length} LongMemEval questions`);
    } finally {
      await vault.cleanup();
    }
  }
  return processed;
}

async function runBeam({ dataset, predictionsDir, args, questionIds, latencies }) {
  const indices = args.conversations ? parseIndexSpec(args.conversations, dataset.length) : dataset.map((_, index) => index);
  let processed = 0;
  for (const conversationIndex of indices) {
    const conversation = dataset[conversationIndex];
    const globalConversationIndex = (args.conversationOffset ?? 0) + conversationIndex;
    const vault = await createVault(resolve(args.outputRoot), `beam-${args.chatSize}-${globalConversationIndex}`, args.keepVaults);
    try {
      const batches = parseBeamChat(conversation.chat);
      const sessions = batches.map((batch, batchIndex) => ({
        id: `batch-${batchIndex}`,
        startedAt: beamBatchStartedAt(batch, batchIndex),
        messages: beamBatchMessages(batch),
      }));
      const noteCount = await archiveSessions(vault.root, `beam-${args.chatSize}-${globalConversationIndex}`, sessions, "Assistant");
      const indexResult = await rebuildFullVaultSearchIndex({ root: vault.root });
      let questions = extractBeamQuestions(conversation).map((question, questionIndex) => ({
        ...question,
        question_index: questionIndex,
        question_id: `${args.chatSize}_${globalConversationIndex}_q${questionIndex}_${question.question_type}`,
      }));
      if (questionIds) questions = questions.filter((question) => questionIds.has(question.question_id));
      if (args.maxQuestions) questions = questions.slice(0, args.maxQuestions);
      for (const question of questions) {
        const path = join(predictionsDir, `${question.question_id}.json`);
        if (await pathExists(path)) continue;
        const questionText = String(question.question_text ?? question.question ?? "");
        const nuggets = extractBeamRubricNuggets(question);
        const retrieval = await retrieve(vault.root, questionText, args.topK);
        latencies.push(retrieval.latencyMs);
        await writeJsonAtomic(path, commonResult({
          benchmark: "beam",
          questionId: question.question_id,
          question: questionText,
          groundTruth: nuggets.join(" | "),
          retrieval,
          extra: {
            chat_size: args.chatSize,
            conversation_idx: globalConversationIndex,
            conversation_id: conversation.conversation_id ?? "",
            question_type: question.question_type,
            question_type_idx: question.question_index,
            difficulty: question.difficulty ?? "unknown",
            rubric_nuggets: nuggets,
            source_chat_ids: question.source_chat_ids ?? [],
            user_id: `hivemindos_beam_${args.chatSize}_${globalConversationIndex}`,
            ingestion: { notes: noteCount, indexed: indexResult.indexed, batches: batches.length },
          },
        }));
        processed += 1;
        if (processed % 10 === 0) console.log(`Retrieved ${processed} BEAM ${args.chatSize} questions`);
      }
    } finally {
      await vault.cleanup();
    }
  }
  return processed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const datasetPath = resolve(args.dataset);
  const outputRoot = resolve(args.outputRoot);
  const predictionsDir = join(outputRoot, args.benchmark, `predicted_${args.projectName}`);
  await mkdir(predictionsDir, { recursive: true });
  const datasetStat = await stat(datasetPath);
  const dataset = await readJson(datasetPath);
  if (!Array.isArray(dataset)) throw new Error(`Dataset must be a JSON array: ${datasetPath}`);
  const questionIds = await loadQuestionIds(args.questionIds);
  const latencies = [];
  const startedAt = new Date().toISOString();
  console.log(`${args.benchmark} retrieval | ${dataset.length} dataset rows | Top-${args.topK} | output ${predictionsDir}`);
  const input = { dataset, predictionsDir, args, questionIds, latencies };
  const processed = args.benchmark === "locomo"
    ? await runLocomo(input)
    : args.benchmark === "longmemeval"
      ? await runLongMemEval(input)
      : await runBeam(input);
  const summary = {
    schema: "hivemindos.standard-memory-retrieval.v1",
    benchmark: args.benchmark,
    projectName: args.projectName,
    adapterVersion: ADAPTER_VERSION,
    upstreamHarness: { repository: "mem0ai/memory-benchmarks", commit: MEM0_HARNESS_COMMIT },
    productPath: ["syncConversationNoteForSession", "rebuildFullVaultSearchIndex", "recallAgentMemory"],
    dataset: { file: basename(datasetPath), bytes: datasetStat.size, rows: dataset.length },
    topK: args.topK,
    processed,
    resumedOrExisting: Math.max(0, (await readdir(predictionsDir)).filter((name) => name.endsWith(".json") && name !== "retrieval-summary.json").length - processed),
    retrievalLatencyMs: {
      samples: latencies.length,
      p50: Math.round(percentile(latencies, 0.5) * 100) / 100,
      p95: Math.round(percentile(latencies, 0.95) * 100) / 100,
      mean: latencies.length ? Math.round((latencies.reduce((sum, value) => sum + value, 0) / latencies.length) * 100) / 100 : 0,
    },
    startedAt,
    completedAt: new Date().toISOString(),
    devOnly: true,
  };
  await writeJsonAtomic(join(predictionsDir, "retrieval-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
