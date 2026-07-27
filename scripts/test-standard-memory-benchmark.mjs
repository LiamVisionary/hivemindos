import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  BEAM_QUESTION_TYPES,
  beamBatchMessages,
  extractBeamQuestions,
  extractBeamRubricNuggets,
  locomoSessions,
  longMemEvalSessions,
  parseBeamChat,
  parseIndexSpec,
  parseLocomoDate,
  parseLongMemEvalDate,
  splitMessagesForConversationNotes,
} from "./lib/standard-memory-benchmark.mjs";

assert.equal(new Date(parseLocomoDate("1:56 pm on 8 May, 2023")).toISOString(), "2023-05-08T13:56:00.000Z");
assert.equal(new Date(parseLongMemEvalDate("2023/05/01 (Mon) 21:05")).toISOString(), "2023-05-01T21:05:00.000Z");

const locomo = locomoSessions({
  conversation: {
    speaker_a: "Ada",
    speaker_b: "Grace",
    session_2_date_time: "2:00 pm on 9 May, 2023",
    session_2: [{ speaker: "Ada", text: "Later" }, { speaker: "Grace", text: "Recorded" }],
    session_1_date_time: "1:00 pm on 8 May, 2023",
    session_1: [{ speaker: "Ada", text: "Earlier", query: "photo", blip_caption: "a lake" }, { speaker: "Grace", text: "Saved" }],
  },
});
assert.deepEqual(locomo.map((session) => session.id), ["session_1", "session_2"]);
assert.match(locomo[0].messages[0].content, /Ada: Earlier \[Sharing image - query: photo\. The image shows: a lake\]/);
assert.equal(locomo[0].messages[1].role, "assistant");

const longMemEval = longMemEvalSessions({
  haystack_session_ids: ["late", "early"],
  haystack_dates: ["2023/05/02 (Tue) 10:00", "2023/05/01 (Mon) 10:00"],
  haystack_sessions: [
    [{ role: "user", content: "late" }, { role: "assistant", content: "late answer" }],
    [{ role: "user", content: "early" }, { role: "assistant", content: "early answer" }],
  ],
});
assert.deepEqual(longMemEval.map((session) => session.id), ["early", "late"]);

assert.deepEqual(parseBeamChat([[{ role: "user", content: "one" }], [{ role: "assistant", content: "two" }]]).length, 2);
assert.deepEqual(parseBeamChat([
  { "plan-2": [{ turns: [[{ role: "assistant", content: "second" }]] }], "plan-1": [{ turns: [[{ role: "user", content: "first" }]] }] },
]).flat().map((turn) => turn.content), ["first", "second"]);
assert.deepEqual(beamBatchMessages([{ role: "human", content: "hello" }, { role: "bot", content: "hi" }]).map((message) => message.role), ["user", "assistant"]);

const probingQuestions = extractBeamQuestions({
  probing_questions: {
    temporal_reasoning: [{ question_text: "last" }],
    abstention: [{ question_text: "first", rubric: { nuggets: [{ description: "declines" }] } }],
  },
});
assert.equal(probingQuestions[0].question_type, BEAM_QUESTION_TYPES[0]);
assert.equal(probingQuestions.at(-1).question_type, "temporal_reasoning");
assert.deepEqual(extractBeamRubricNuggets(probingQuestions[0]), ["declines"]);

const messages = [
  { role: "user", content: "a".repeat(20) },
  { role: "assistant", content: "b".repeat(20) },
  { role: "user", content: "c".repeat(20) },
  { role: "assistant", content: "d".repeat(20) },
];
const chunks = splitMessagesForConversationNotes(messages, 30);
assert.equal(chunks.length, 2);
assert.ok(chunks.every((chunk) => chunk.some((message) => message.role === "assistant")));
assert.deepEqual(parseIndexSpec("0-2,4,2", 5), [0, 1, 2, 4]);
assert.throws(() => parseIndexSpec("3-1", 5), /Invalid index range/);

const summaryFixture = mkdtempSync(join(tmpdir(), "hivemindos-standard-memory-summary-"));
try {
  writeFileSync(join(summaryFixture, "question.json"), JSON.stringify({
    question_id: "fixture",
    benchmark: "longmemeval",
    answer_session_ids: ["answer_session_1"],
    retrieval: {
      search_latency_ms: 12.5,
      total_results: 1,
      search_results: [{ metadata: { note_path: "Memory/Conversations/answer-session-1.md" } }],
    },
    cutoff_results: {
      top_50: { score: 1, answerCall: { inputTokens: 123 } },
    },
  }));
  const summaryRun = spawnSync(process.execPath, [
    "scripts/summarize-standard-memory-benchmark.mjs",
    "--benchmark", "longmemeval",
    "--predictions-dir", summaryFixture,
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(summaryRun.status, 0, summaryRun.stderr);
  const summary = JSON.parse(summaryRun.stdout);
  assert.equal(summary.scoreStatus, "complete");
  assert.equal(summary.scorePercent, 100);
  assert.equal(summary.evidenceRecall.top1.rate, 100);
} finally {
  rmSync(summaryFixture, { recursive: true, force: true });
}

const evaluatorCompatibilityRun = spawnSync("python3", ["-c", String.raw`
import importlib.util
import asyncio
import time
spec = importlib.util.spec_from_file_location("standard_memory_evaluate", "scripts/benchmark-standard-memory-evaluate.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.chat_token_limit_key("gpt-5") == "max_completion_tokens"
assert module.chat_token_limit_key("openai/gpt-5:nitro") == "max_completion_tokens"
assert module.supports_temperature("openai/gpt-5") is False
assert module.chat_token_limit_key("openai/gpt-4o") == "max_tokens"
assert module.supports_temperature("openai/gpt-4o") is True
class FakeStructuredClient:
    def __init__(self): self.calls = 0
    async def complete(self, system, user, structured=False, max_tokens=4096):
        self.calls += 1
        text = '{"reason":"bad\\q"}' if self.calls == 1 else '{"score":1,"reason":"valid"}'
        return {"text": text, "usage": {"input": 0, "output": 0, "total": 0, "cachedInput": 0}, "latencyMs": 1}
client = FakeStructuredClient()
calls, parsed = asyncio.run(module.complete_structured_json(client, "", "judge"))
assert len(calls) == 2 and parsed["score"] == 1
class FakeBeamClient:
    def __init__(self, text, delay=0): self.text, self.delay = text, delay
    async def complete(self, system, user, structured=False, max_tokens=4096):
        if self.delay: await asyncio.sleep(self.delay)
        return {"text": self.text, "usage": {"input": 0, "output": 0, "total": 0, "cachedInput": 0}, "latencyMs": self.delay * 1000}
class FakeBeamPrompts:
    BEAM_JUDGE_SYSTEM_PROMPT = "judge"
    @staticmethod
    def get_beam_answer_generation_prompt(question, memories, top_k=None): return question
    @staticmethod
    def get_beam_nugget_judge_prompt(question, nugget, generated): return nugget
async def check_parallel_beam_nuggets():
    item = {"question": "q", "retrieval": {"search_results": []}, "rubric_nuggets": ["a", "b", "c"], "question_type": "summarization"}
    started = time.perf_counter()
    result = await module.evaluate_beam(item, 50, FakeBeamPrompts(), FakeBeamClient("answer"), FakeBeamClient('{"score":1,"reason":"ok"}', 0.05))
    elapsed = time.perf_counter() - started
    assert elapsed < 0.12, elapsed
    assert result["score"] == 1
asyncio.run(check_parallel_beam_nuggets())
`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(evaluatorCompatibilityRun.status, 0, evaluatorCompatibilityRun.stderr);

const oauthProxySyntax = spawnSync(process.execPath, ["--check", "scripts/benchmark-openai-oauth-proxy.mjs"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});
assert.equal(oauthProxySyntax.status, 0, oauthProxySyntax.stderr);

const microManifest = JSON.parse(readFileSync(new URL("../benchmarks/memory/micro-v1.json", import.meta.url), "utf8"));
assert.equal(microManifest.schema, "hivemindos.standard-memory-micro.v1");
assert.equal(microManifest.selection.questionCount, 36);
assert.deepEqual(
  Object.fromEntries(Object.entries(microManifest.suites).map(([key, suite]) => [key, suite.questions.length])),
  { locomo: 10, longmemeval: 6, beam1m: 10, beam10m: 10 },
);
assert.ok(Object.values(microManifest.suites).every((suite) => suite.reference.model === "gpt-5"));
assert.ok(Object.values(microManifest.suites).every((suite) => suite.reference.retrievalTopK === 50));
const microValidation = spawnSync(process.execPath, [
  "scripts/benchmark-standard-memory-micro.mjs",
  "--validate",
  "--manifest", "benchmarks/memory/micro-v1.json",
], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(microValidation.status, 0, microValidation.stderr);
assert.match(microValidation.stdout, /36 fixed questions/);
const microPnpmSeparatorValidation = spawnSync(process.execPath, [
  "scripts/benchmark-standard-memory-micro.mjs",
  "--",
  "--validate",
  "--manifest", "benchmarks/memory/micro-v1.json",
], { encoding: "utf8" });
assert.equal(microPnpmSeparatorValidation.status, 0, microPnpmSeparatorValidation.stderr);

const microPlanRun = spawnSync(process.execPath, [
  "scripts/benchmark-standard-memory-micro.mjs",
  "--plan",
  "--project-name", "micro-test",
  "--manifest", "benchmarks/memory/micro-v1.json",
], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(microPlanRun.status, 0, microPlanRun.stderr);
const microPlan = JSON.parse(microPlanRun.stdout);
assert.equal(microPlan.questionCount, 36);
assert.equal(microPlan.retrievalSteps.length, 4);
assert.equal(microPlan.evaluationSteps.length, 4);
assert.equal(microPlan.totalEvaluationWorkers, 8);
assert.ok(microPlan.retrievalSteps.some((step) => step.args.includes("26")));
assert.ok(microPlan.retrievalSteps.some((step) => step.args.includes("2")));

const microReportFixture = mkdtempSync(join(tmpdir(), "hivemindos-standard-memory-micro-report-"));
try {
  const suffixes = { locomo: "locomo", longmemeval: "longmemeval", beam1m: "beam1m", beam10m: "beam10m" };
  for (const [suiteKey, suite] of Object.entries(microManifest.suites)) {
    const benchmarkFolder = suite.benchmark;
    const predictionsDir = join(microReportFixture, benchmarkFolder, `predicted_micro-test-${suffixes[suiteKey]}`);
    mkdirSync(predictionsDir, { recursive: true });
    for (const question of suite.questions) {
      writeFileSync(join(predictionsDir, `${question.id}.json`), JSON.stringify({
        question_id: question.id,
        benchmark: suite.benchmark,
        question_type: question.dimension,
        retrieval: { search_latency_ms: 1, total_results: 1, search_results: [{ memory: "fixture" }] },
        cutoff_results: { top_50: { score: question.baselineScore, answerCall: { latencyMs: 2 }, judgeCall: { latencyMs: 3 } } },
        evaluation_config: { answererModel: "gpt-5.4-mini", judgeModel: "gpt-5.4-mini", provider: "chatgpt-oauth" },
      }));
    }
  }
  const microReportRun = spawnSync(process.execPath, [
    "scripts/benchmark-standard-memory-micro.mjs",
    "--report",
    "--project-name", "micro-test",
    "--output-root", microReportFixture,
    "--manifest", "benchmarks/memory/micro-v1.json",
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(microReportRun.status, 0, microReportRun.stderr);
  const microReport = JSON.parse(microReportRun.stdout);
  assert.equal(microReport.questionCount, 36);
  assert.equal(microReport.suites.locomo.candidate.scorePercent, 80);
  assert.equal(microReport.suites.beam1m.candidate.scorePercent, 41.17);
  assert.equal(microReport.suites.beam10m.reference.scorePercent, 41);
} finally {
  rmSync(microReportFixture, { recursive: true, force: true });
}

console.log("standard memory benchmark helpers: ok");
