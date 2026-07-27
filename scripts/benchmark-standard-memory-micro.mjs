#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_MANIFEST = "benchmarks/memory/micro-v1.json";

function usage() {
  return `Usage:
  node scripts/benchmark-standard-memory-micro.mjs --validate [--manifest <path>]
  node scripts/benchmark-standard-memory-micro.mjs --plan --project-name <name>
  node scripts/benchmark-standard-memory-micro.mjs --run --project-name <name>
  node scripts/benchmark-standard-memory-micro.mjs --report --project-name <name>

Validates the fixed one-minute standard-memory comparison panel. The panel is
an iteration gate, not a replacement for full LoCoMo, LongMemEval, or BEAM runs.
`;
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    outputRoot: ".outputs/benchmarks/standard-memory",
    harnessRoot: ".outputs/benchmarks/standard-memory/memory-benchmarks",
    answererModel: "gpt-5.4-mini",
    judgeModel: "gpt-5.4-mini",
    baseUrl: "http://127.0.0.1:8765/v1/chat/completions",
    providerLabel: "chatgpt-oauth",
    authMode: "none",
    workersPerSuite: 2,
    python: "python3",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--validate") args.validate = true;
    else if (arg === "--plan") args.plan = true;
    else if (arg === "--run") args.run = true;
    else if (arg === "--report") args.report = true;
    else if (arg === "--manifest") args.manifest = argv[++index];
    else if (arg === "--project-name") args.projectName = argv[++index];
    else if (arg === "--output-root") args.outputRoot = argv[++index];
    else if (arg === "--harness-root") args.harnessRoot = argv[++index];
    else if (arg === "--answerer-model") args.answererModel = argv[++index];
    else if (arg === "--judge-model") args.judgeModel = argv[++index];
    else if (arg === "--base-url") args.baseUrl = argv[++index];
    else if (arg === "--provider-label") args.providerLabel = argv[++index];
    else if (arg === "--auth-mode") args.authMode = argv[++index];
    else if (arg === "--workers-per-suite") args.workersPerSuite = Number(argv[++index]);
    else if (arg === "--python") args.python = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const actions = [args.validate, args.plan, args.run, args.report].filter(Boolean).length;
  if (!args.help && actions !== 1) throw new Error("Choose exactly one of --validate, --plan, --run, or --report");
  if (!args.help && !args.validate && !args.projectName?.trim()) throw new Error("--project-name is required");
  if (!Number.isInteger(args.workersPerSuite) || args.workersPerSuite < 1 || args.workersPerSuite > 4) {
    throw new Error("--workers-per-suite must be an integer from 1 to 4");
  }
  return args;
}

function roundedScore(questions, field) {
  return Math.round((questions.reduce((sum, question) => sum + Number(question[field]), 0) / questions.length) * 10_000) / 100;
}

function validateManifest(manifest) {
  if (manifest?.schema !== "hivemindos.standard-memory-micro.v1") throw new Error("Unexpected micro benchmark schema");
  const suites = manifest.suites ?? {};
  const expectedCounts = { locomo: 10, longmemeval: 6, beam1m: 10, beam10m: 10 };
  const ids = new Set();
  let questionCount = 0;
  for (const [key, expected] of Object.entries(expectedCounts)) {
    const suite = suites[key];
    if (!suite || suite.questions?.length !== expected) throw new Error(`${key} must contain ${expected} fixed questions`);
    if (suite.reference?.model !== "gpt-5" || suite.reference?.retrievalTopK !== 50) {
      throw new Error(`${key} must retain the Mem0 GPT-5 Top-50 reference`);
    }
    const referenceScore = roundedScore(suite.questions, "referenceScore");
    const baselineScore = roundedScore(suite.questions, "baselineScore");
    if (Math.abs(referenceScore - Number(suite.reference.scorePercent)) > 0.01) throw new Error(`${key} reference aggregate drifted`);
    if (Math.abs(baselineScore - Number(suite.baseline.scorePercent)) > 0.01) throw new Error(`${key} baseline aggregate drifted`);
    for (const question of suite.questions) {
      if (!question.id || ids.has(question.id)) throw new Error(`Duplicate or missing micro question id: ${question.id}`);
      ids.add(question.id);
      questionCount += 1;
    }
  }
  if (questionCount !== manifest.selection?.questionCount) throw new Error("Micro question count does not match selection metadata");
  return { questionCount, suiteCount: Object.keys(expectedCounts).length };
}

const PROJECT_SUFFIX = {
  locomo: "locomo",
  longmemeval: "longmemeval",
  beam1m: "beam1m",
  beam10m: "beam10m",
};

function predictionsDirectory(outputRoot, projectName, suiteKey, suite) {
  return join(resolve(outputRoot), suite.benchmark, `predicted_${projectName}-${PROJECT_SUFFIX[suiteKey]}`);
}

function buildPlan(manifest, args) {
  const outputRoot = resolve(args.outputRoot);
  const harnessRoot = resolve(args.harnessRoot);
  const idsRoot = join(outputRoot, "micro", args.projectName, "question-ids");
  const retrievalSteps = [];
  const evaluationSteps = [];
  for (const [suiteKey, suite] of Object.entries(manifest.suites)) {
    const idsPath = join(idsRoot, `${suiteKey}.json`);
    const projectName = `${args.projectName}-${PROJECT_SUFFIX[suiteKey]}`;
    const predictionsDir = predictionsDirectory(outputRoot, args.projectName, suiteKey, suite);
    const retrievalArgs = [
      "scripts/benchmark-standard-memory-retrieval.mjs",
      "--benchmark", suite.benchmark,
      "--dataset", resolve(suite.dataset),
      "--project-name", projectName,
      "--output-root", outputRoot,
      "--top-k", "50",
      "--question-ids", idsPath,
    ];
    if (suite.conversations) retrievalArgs.push("--conversations", String(suite.conversations));
    if (suite.chatSize) retrievalArgs.push("--chat-size", suite.chatSize);
    if (suite.conversationOffset !== undefined) retrievalArgs.push("--conversation-offset", String(suite.conversationOffset));
    retrievalSteps.push({ suite: suiteKey, command: process.execPath, args: retrievalArgs, predictionsDir, idsPath });
    evaluationSteps.push({
      suite: suiteKey,
      command: args.python,
      args: [
        "scripts/benchmark-standard-memory-evaluate.py",
        "--benchmark", suite.benchmark,
        "--predictions-dir", predictionsDir,
        "--harness-root", harnessRoot,
        "--answerer-model", args.answererModel,
        "--judge-model", args.judgeModel,
        "--base-url", args.baseUrl,
        "--auth-mode", args.authMode,
        "--provider-label", args.providerLabel,
        "--workers", String(args.workersPerSuite),
        "--question-ids", idsPath,
        "--progress-every", String(suite.questions.length),
      ],
      predictionsDir,
      idsPath,
    });
  }
  return {
    schema: "hivemindos.standard-memory-micro-plan.v1",
    version: manifest.version,
    projectName: args.projectName,
    questionCount: manifest.selection.questionCount,
    targetRuntimeSeconds: manifest.selection.targetRuntimeSeconds,
    totalEvaluationWorkers: args.workersPerSuite * evaluationSteps.length,
    retrievalSteps,
    evaluationSteps,
  };
}

async function writeQuestionIdFiles(manifest, plan) {
  for (const step of plan.retrievalSteps) {
    const questions = manifest.suites[step.suite].questions.map((question) => question.id);
    await mkdir(resolve(step.idsPath, ".."), { recursive: true });
    await writeFile(step.idsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
  }
}

function runStep(step) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(step.command, step.args, { cwd: process.cwd(), stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${step.suite} command failed (${signal ?? code}): ${step.command} ${step.args.join(" ")}`));
    });
  });
}

function distribution(values) {
  if (!values.length) return { samples: 0, p50: 0, p95: 0, mean: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (quantile) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
  const round = (value) => Math.round(value * 100) / 100;
  return {
    samples: values.length,
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

async function buildReport(manifest, args, elapsedSeconds) {
  const suites = {};
  for (const [suiteKey, suite] of Object.entries(manifest.suites)) {
    const predictionsDir = predictionsDirectory(args.outputRoot, args.projectName, suiteKey, suite);
    const items = [];
    for (const question of suite.questions) {
      const item = JSON.parse(await readFile(join(predictionsDir, `${question.id}.json`), "utf8"));
      if (item.question_id !== question.id || item.cutoff_results?.top_50?.score === undefined) {
        throw new Error(`${suiteKey}/${question.id} is not fully evaluated`);
      }
      items.push(item);
    }
    const scores = items.map((item) => Number(item.cutoff_results.top_50.score));
    const scorePercent = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10_000) / 100;
    const config = items[0].evaluation_config ?? {};
    suites[suiteKey] = {
      questions: items.length,
      reference: suite.reference,
      baseline: suite.baseline,
      candidate: {
        model: config.answererModel ?? args.answererModel,
        judgeModel: config.judgeModel ?? args.judgeModel,
        provider: config.provider ?? args.providerLabel,
        scorePercent,
        gapToReferencePoints: Math.round((scorePercent - Number(suite.reference.scorePercent)) * 100) / 100,
        deltaFromBaselinePoints: Math.round((scorePercent - Number(suite.baseline.scorePercent)) * 100) / 100,
        retrievalLatencyMs: distribution(items.map((item) => Number(item.retrieval.search_latency_ms))),
        answerLatencyMs: distribution(items.map((item) => Number(item.cutoff_results.top_50.answerCall?.latencyMs ?? 0))),
        judgeLatencyMs: distribution(items.map((item) => Number(item.cutoff_results.top_50.judgeCall?.latencyMs ?? 0))),
      },
    };
  }
  return {
    schema: "hivemindos.standard-memory-micro-report.v1",
    version: manifest.version,
    projectName: args.projectName,
    questionCount: manifest.selection.questionCount,
    elapsedSeconds,
    suites,
    limitations: [manifest.selection.use, manifest.selection.calibrationDisclosure],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const manifest = JSON.parse(await readFile(resolve(args.manifest), "utf8"));
  const result = validateManifest(manifest);
  if (args.validate) {
    console.log(`${manifest.version}: ${result.questionCount} fixed questions across ${result.suiteCount} suites; manifest valid.`);
    return;
  }
  const plan = buildPlan(manifest, args);
  if (args.plan) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (args.report) {
    console.log(JSON.stringify(await buildReport(manifest, args), null, 2));
    return;
  }
  const started = performance.now();
  await writeQuestionIdFiles(manifest, plan);
  for (const step of plan.retrievalSteps) await runStep(step);
  await Promise.all(plan.evaluationSteps.map(runStep));
  const elapsedSeconds = Math.round((performance.now() - started) / 10) / 100;
  const report = await buildReport(manifest, args, elapsedSeconds);
  const reportPath = join(resolve(args.outputRoot), "micro", args.projectName, "micro-report.json");
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
