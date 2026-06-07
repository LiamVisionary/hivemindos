#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { buildContextPack, estimateTokens, formatNumber, scenarios } from "./benchmark-context-savings.mjs";

const ROOT = process.cwd();
const DEFAULT_PROVIDER = process.env.HIVE_E2E_BENCH_PROVIDER || "openai";
const DEFAULT_MAX_CONTEXT_CHARS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 220;
const DEFAULT_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const args = {
    provider: DEFAULT_PROVIDER,
    model: process.env.HIVE_E2E_BENCH_MODEL || process.env.OPENAI_MODEL || "",
    scenario: "",
    repeats: 1,
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputDir: ".outputs/benchmarks",
    json: false,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--provider") {
      args.provider = next || "";
      index += 1;
    } else if (arg === "--model") {
      args.model = next || "";
      index += 1;
    } else if (arg === "--scenario") {
      args.scenario = next || "";
      index += 1;
    } else if (arg === "--repeats") {
      args.repeats = Number(next || 1);
      index += 1;
    } else if (arg === "--max-context-chars") {
      args.maxContextChars = Number(next || DEFAULT_MAX_CONTEXT_CHARS);
      index += 1;
    } else if (arg === "--max-output-tokens") {
      args.maxOutputTokens = Number(next || DEFAULT_MAX_OUTPUT_TOKENS);
      index += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(next || DEFAULT_TIMEOUT_MS);
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = next || args.outputDir;
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--input-price-per-million") {
      args.inputPricePerMillion = Number(next || 0);
      index += 1;
    } else if (arg === "--output-price-per-million") {
      args.outputPricePerMillion = Number(next || 0);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  args.provider = args.provider.toLowerCase().trim();
  if (!["openai", "openrouter", "usepod"].includes(args.provider)) {
    throw new Error(`Unsupported --provider ${args.provider}. Use openai, openrouter, or usepod.`);
  }
  if (!args.model) args.model = defaultModelForProvider(args.provider);
  if (!Number.isInteger(args.repeats) || args.repeats < 1) args.repeats = 1;
  if (!Number.isFinite(args.maxContextChars) || args.maxContextChars < 1000) args.maxContextChars = DEFAULT_MAX_CONTEXT_CHARS;
  if (!Number.isFinite(args.maxOutputTokens) || args.maxOutputTokens < 1) args.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) args.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(args.inputPricePerMillion) || args.inputPricePerMillion < 0) args.inputPricePerMillion = 0;
  if (!Number.isFinite(args.outputPricePerMillion) || args.outputPricePerMillion < 0) args.outputPricePerMillion = 0;
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/benchmark-e2e-token-savings.mjs [options]

Runs real provider-backed E2E token benchmarks using OpenAI-compatible
usage counters. Prompts are sent to the model. Secrets are read from env only
and are never written to the result artifact.

Options:
  --provider PROVIDER                   openai, openrouter, or usepod, default ${DEFAULT_PROVIDER}
  --model MODEL                         Model id, provider-specific default
  --scenario ID                         Run one scenario only
  --repeats N                           Runs per scenario/mode, default 1
  --max-context-chars N                 Cap sent context per call, default ${DEFAULT_MAX_CONTEXT_CHARS}
  --max-output-tokens N                 Completion cap, default ${DEFAULT_MAX_OUTPUT_TOKENS}
  --timeout-ms N                        Per-request timeout, default ${DEFAULT_TIMEOUT_MS}
  --output-dir PATH                     Result artifact folder, default .outputs/benchmarks
  --input-price-per-million N           Optional price annotation for prompt tokens
  --output-price-per-million N          Optional price annotation for completion tokens
  --json                                Print artifact JSON after the run

Recommended:
  ./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings`);
}

function defaultModelForProvider(provider) {
  if (provider === "openrouter") return "openai/gpt-4.1-mini";
  if (provider === "usepod") return "gpt-5.5";
  return "gpt-4o-mini";
}

function providerConfig(provider) {
  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing. Run through ./scripts/hive-env-run or set the key in the environment.");
    return {
      provider: "openrouter",
      label: "OpenRouter OpenAI-compatible Chat Completions",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/multica-ai/hivemind-os",
        "X-Title": "HivemindOS E2E Token Benchmark",
      },
      includeUsage: true,
    };
  }
  if (provider === "usepod") {
    const token = process.env.USEPOD_TOKEN;
    if (!token) throw new Error("USEPOD_TOKEN is missing. Run through ./scripts/hive-env-run or set the key in the environment.");
    return {
      provider: "usepod",
      label: "UsePod OpenAI-compatible Proxy",
      url: `https://api.usepod.ai/proxy/${encodeURIComponent(token)}/v1/chat/completions`,
      headers: {},
      includeUsage: false,
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Run through ./scripts/hive-env-run or set the key in the environment.");
  return {
    provider: "openai",
    label: "OpenAI Chat Completions",
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    includeUsage: false,
  };
}

function capContext(text, maxChars) {
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
      originalChars: text.length,
      sentChars: text.length,
      estimatedOriginalTokens: estimateTokens(text),
      estimatedSentTokens: estimateTokens(text),
    };
  }
  const marker = "\n[context truncated for live E2E benchmark]\n";
  const sent = `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
  return {
    text: sent,
    truncated: true,
    originalChars: text.length,
    sentChars: sent.length,
    estimatedOriginalTokens: estimateTokens(text),
    estimatedSentTokens: estimateTokens(sent),
  };
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function buildMessages({ scenario, mode, label, context }) {
  return [
    {
      role: "system",
      content: [
        "You are running a token benchmark for HivemindOS.",
        "Use only the provided context.",
        "Return compact valid JSON only, with keys answer, actions, and confidence.",
        "Keep the answer brief and do not include markdown.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Scenario: ${scenario.id} - ${scenario.title}`,
        `Mode: ${mode}`,
        `Context strategy: ${label}`,
        `Task: ${scenario.task}`,
        "",
        "Return JSON shaped like:",
        '{"answer":"one sentence","actions":["one short action"],"confidence":0.5}',
        "",
        "Context:",
        context,
      ].join("\n"),
    },
  ];
}

async function callChatCompletions({ config, model, messages, maxOutputTokens, timeoutMs, responseFormat = true }) {
  const body = {
    model,
    messages,
    temperature: 0,
    max_tokens: maxOutputTokens,
  };
  if (responseFormat) body.response_format = { type: "json_object" };
  if (config.includeUsage) body.usage = { include: true };
  const startedAt = performance.now();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || response.statusText || "OpenAI request failed";
    if (responseFormat && /response_format|max_tokens|temperature/i.test(message)) {
      return callChatCompletions({ config, model, messages, maxOutputTokens, timeoutMs, responseFormat: false });
    }
    throw new Error(`${config.provider} ${response.status}: ${message}`);
  }
  return { data, durationMs, usedJsonResponseFormat: responseFormat };
}

function parseJsonResult(content) {
  try {
    const parsed = JSON.parse(content);
    return {
      ok: Boolean(parsed && typeof parsed.answer === "string" && parsed.answer.trim()),
      keys: parsed && typeof parsed === "object" ? Object.keys(parsed).sort() : [],
    };
  } catch {
    return { ok: false, keys: [] };
  }
}

function tokenCost(record, args) {
  const promptCost = (record.usage.promptTokens / 1_000_000) * args.inputPricePerMillion;
  const completionCost = (record.usage.completionTokens / 1_000_000) * args.outputPricePerMillion;
  return promptCost + completionCost;
}

function summarizePair(scenario, records, args) {
  const baseline = records.filter((record) => record.scenarioId === scenario.id && record.mode === "baseline");
  const hive = records.filter((record) => record.scenarioId === scenario.id && record.mode === "hive");
  const sum = (items, getter) => items.reduce((total, item) => total + getter(item), 0);
  const average = (items, getter) => (items.length ? sum(items, getter) / items.length : 0);
  const baselinePrompt = average(baseline, (record) => record.usage.promptTokens);
  const hivePrompt = average(hive, (record) => record.usage.promptTokens);
  const baselineTotal = average(baseline, (record) => record.usage.totalTokens);
  const hiveTotal = average(hive, (record) => record.usage.totalTokens);
  const promptSaved = Math.max(0, baselinePrompt - hivePrompt);
  const totalSaved = Math.max(0, baselineTotal - hiveTotal);
  const baselineCost = sum(baseline, (record) => tokenCost(record, args)) / Math.max(1, baseline.length);
  const hiveCost = sum(hive, (record) => tokenCost(record, args)) / Math.max(1, hive.length);
  return {
    id: scenario.id,
    title: scenario.title,
    baselinePromptTokens: Math.round(baselinePrompt),
    hivePromptTokens: Math.round(hivePrompt),
    promptTokensSaved: Math.round(promptSaved),
    promptTokensSavedPercent: baselinePrompt > 0 ? (promptSaved / baselinePrompt) * 100 : 0,
    baselineTotalTokens: Math.round(baselineTotal),
    hiveTotalTokens: Math.round(hiveTotal),
    totalTokensSaved: Math.round(totalSaved),
    totalTokensSavedPercent: baselineTotal > 0 ? (totalSaved / baselineTotal) * 100 : 0,
    baselineCost,
    hiveCost,
    costSaved: Math.max(0, baselineCost - hiveCost),
    baselineTruncated: baseline.some((record) => record.context.truncated),
    hiveTruncated: hive.some((record) => record.context.truncated),
    records: {
      baseline: baseline.length,
      hive: hive.length,
    },
  };
}

function printTable(artifact) {
  console.log("HivemindOS live E2E token benchmark");
  console.log(`Provider: ${artifact.providerLabel}`);
  console.log(`Model: ${artifact.model}`);
  console.log(`Runs: ${artifact.repeats} per scenario/mode`);
  console.log(`Artifact: ${artifact.artifactPath}\n`);
  const header = ["Scenario", "Baseline prompt", "Hive prompt", "Prompt saved", "Total saved", "Truncated"];
  const rows = artifact.summary.map((result) => [
    result.id,
    formatNumber(result.baselinePromptTokens),
    formatNumber(result.hivePromptTokens),
    `${formatNumber(result.promptTokensSaved)} (${result.promptTokensSavedPercent.toFixed(1)}%)`,
    `${formatNumber(result.totalTokensSaved)} (${result.totalTokensSavedPercent.toFixed(1)}%)`,
    result.baselineTruncated || result.hiveTruncated ? "yes" : "no",
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
  const totals = artifact.totals;
  console.log("");
  console.log(`Total baseline prompt tokens: ${formatNumber(totals.baselinePromptTokens)}`);
  console.log(`Total hive prompt tokens:     ${formatNumber(totals.hivePromptTokens)}`);
  console.log(`Prompt tokens saved:          ${formatNumber(totals.promptTokensSaved)} (${totals.promptTokensSavedPercent.toFixed(1)}%)`);
  console.log(`Total tokens saved:           ${formatNumber(totals.totalTokensSaved)} (${totals.totalTokensSavedPercent.toFixed(1)}%)`);
  if (artifact.pricing.inputPricePerMillion > 0 || artifact.pricing.outputPricePerMillion > 0) {
    console.log(`Estimated cost saved:         $${totals.costSaved.toFixed(6)}`);
  }
}

async function runBenchmark(args) {
  const config = providerConfig(args.provider);
  const selected = args.scenario
    ? scenarios.filter((scenario) => scenario.id === args.scenario)
    : scenarios;
  if (!selected.length) {
    throw new Error(`No benchmark scenario matched ${args.scenario}. Available: ${scenarios.map((scenario) => scenario.id).join(", ")}`);
  }
  const records = [];
  for (const scenario of selected) {
    for (const mode of ["baseline", "hive"]) {
      const pack = buildContextPack(scenario[mode], scenario.task);
      const capped = capContext(pack.text, args.maxContextChars);
      for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
        const messages = buildMessages({
          scenario,
          mode,
          label: scenario[mode].label,
          context: capped.text,
        });
        const { data, durationMs, usedJsonResponseFormat } = await callChatCompletions({
          config,
          model: args.model,
          messages,
          maxOutputTokens: args.maxOutputTokens,
          timeoutMs: args.timeoutMs,
        });
        const content = data?.choices?.[0]?.message?.content || "";
        const parsed = parseJsonResult(content);
        const usage = data?.usage || {};
        records.push({
          scenarioId: scenario.id,
          mode,
          label: scenario[mode].label,
          repeat,
          durationMs,
          providerResponseId: data?.id || "",
          finishReason: data?.choices?.[0]?.finish_reason || "",
          usedJsonResponseFormat,
          usage: {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          },
          response: {
            parsedJson: parsed.ok,
            jsonKeys: parsed.keys,
            outputChars: content.length,
          },
          context: {
            files: pack.files.length,
            snippets: pack.snippets,
            sections: pack.sections,
            truncated: capped.truncated,
            originalChars: capped.originalChars,
            sentChars: capped.sentChars,
            estimatedOriginalTokens: capped.estimatedOriginalTokens,
            estimatedSentTokens: capped.estimatedSentTokens,
            sentContextSha256: hashText(capped.text),
          },
        });
      }
    }
  }
  const summary = selected.map((scenario) => summarizePair(scenario, records, args));
  const totals = summary.reduce((acc, result) => {
    acc.baselinePromptTokens += result.baselinePromptTokens;
    acc.hivePromptTokens += result.hivePromptTokens;
    acc.promptTokensSaved += result.promptTokensSaved;
    acc.baselineTotalTokens += result.baselineTotalTokens;
    acc.hiveTotalTokens += result.hiveTotalTokens;
    acc.totalTokensSaved += result.totalTokensSaved;
    acc.costSaved += result.costSaved;
    return acc;
  }, {
    baselinePromptTokens: 0,
    hivePromptTokens: 0,
    promptTokensSaved: 0,
    baselineTotalTokens: 0,
    hiveTotalTokens: 0,
    totalTokensSaved: 0,
    costSaved: 0,
  });
  totals.promptTokensSavedPercent = totals.baselinePromptTokens > 0 ? (totals.promptTokensSaved / totals.baselinePromptTokens) * 100 : 0;
  totals.totalTokensSavedPercent = totals.baselineTotalTokens > 0 ? (totals.totalTokensSaved / totals.baselineTotalTokens) * 100 : 0;
  const generatedAt = new Date().toISOString();
  const artifactName = `e2e-token-savings-${generatedAt.replace(/[:.]/g, "-")}.json`;
  const outputDir = join(ROOT, args.outputDir);
  const artifactPath = join(outputDir, artifactName);
  const artifact = {
    generatedAt,
    benchmarkType: "live-e2e-provider-token-usage",
    isLiveE2EAgentRun: true,
    usesProviderReportedUsage: true,
    usesProviderBillingInvoice: false,
    provider: config.provider,
    providerLabel: config.label,
    model: args.model,
    repeats: args.repeats,
    maxContextChars: args.maxContextChars,
    maxOutputTokens: args.maxOutputTokens,
    pricing: {
      inputPricePerMillion: args.inputPricePerMillion,
      outputPricePerMillion: args.outputPricePerMillion,
      note: "Pricing is optional annotation only; token usage comes from provider response usage counters.",
    },
    summary,
    totals,
    records,
    artifactPath,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

async function main() {
  const args = parseArgs(process.argv);
  const artifact = await runBenchmark(args);
  if (args.json) {
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }
  printTable(artifact);
}

main().catch((error) => {
  console.error(`benchmark-e2e-token-savings: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
