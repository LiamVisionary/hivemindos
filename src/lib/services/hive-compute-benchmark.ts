import type { HiveComputeModelBenchmark } from "@/lib/types/hive-compute-marketplace";

export const HIVE_COMPUTE_BENCHMARK_METHOD_VERSION = 2;
export const HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT = 3;

type BenchmarkBackend = {
  kind: "lmstudio" | "openai" | "ollama";
  host: string;
};

type BenchmarkOptions = {
  backend: BenchmarkBackend;
  model: string;
  fetchImpl?: typeof fetch;
  now?: () => number | undefined;
  measuredAt?: () => string;
};

const BENCHMARK_TIMEOUT_MS = 120_000;
const PREFILL_PROMPT = [
  "Measure prompt processing speed. Read this fixed benchmark passage and answer only with OK.",
  "Local AI hosting needs repeatable measurements so a provider can price inference from observed throughput rather than model-name guesses.",
  "The passage intentionally repeats stable prose to create a meaningful prompt-prefill sample without using private user data.",
  ...Array.from({ length: 12 }, (_, index) => `Benchmark block ${index + 1}: compute, memory, latency, reliability, tokens, pricing, marketplace, hardware.`),
].join("\n");

const OUTPUT_PROMPT = "Write a numbered sequence of short neutral words. Continue until the token limit and do not stop early.";

export function isHiveComputeBenchmarkableModel(modelId: string) {
  return !/\bembed(?:ding)?\b/i.test(modelId);
}

function joinedUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function comparableModelId(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/:latest$/i, "");
}

function lmStudioApiRoot(host: string) {
  return host.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function lmStudioLoadedInstanceIds(payload: unknown, model: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const models = Array.isArray(record.models) ? record.models : [];
  const target = comparableModelId(model);
  const ids = new Set<string>();
  for (const item of models) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const instances = Array.isArray(row.loaded_instances)
      ? row.loaded_instances
      : Array.isArray(row.loadedInstances)
        ? row.loadedInstances
        : [];
    const instanceIds = instances.flatMap((instance) => {
      if (typeof instance === "string") return instance.trim() ? [instance.trim()] : [];
      if (!instance || typeof instance !== "object") return [];
      const id = String((instance as Record<string, unknown>).id ?? "").trim();
      return id ? [id] : [];
    });
    const rowIds = [row.key, row.modelKey].map(comparableModelId).filter(Boolean);
    if (rowIds.includes(target)) {
      for (const id of instanceIds) ids.add(id);
      continue;
    }
    for (const id of instanceIds) {
      if (comparableModelId(id) === target) ids.add(id);
    }
  }
  return ids;
}

function ollamaLoadedModelIds(payload: unknown, model: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const models = Array.isArray(record.models) ? record.models : [];
  const target = comparableModelId(model);
  const ids = new Set<string>();
  for (const item of models) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.model ?? row.name ?? "").trim();
    if (id && comparableModelId(id) === target) ids.add(id);
  }
  return ids;
}

async function loadedLmStudioInstances(options: BenchmarkOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(joinedUrl(lmStudioApiRoot(options.backend.host), "/api/v1/models"), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  });
  return lmStudioLoadedInstanceIds(await responseJson(response, "LM Studio model-state"), options.model);
}

async function loadedOllamaModels(options: BenchmarkOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(joinedUrl(options.backend.host, "/api/ps"), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  });
  return ollamaLoadedModelIds(await responseJson(response, "Ollama model-state"), options.model);
}

async function unloadLmStudioInstance(options: BenchmarkOptions, instanceId: string) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(joinedUrl(lmStudioApiRoot(options.backend.host), "/api/v1/models/unload"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instance_id: instanceId }),
    signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  });
  await responseJson(response, "LM Studio model unload");
}

async function unloadOllamaModel(options: BenchmarkOptions, model: string) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(joinedUrl(options.backend.host, "/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [], keep_alive: 0, stream: false }),
    signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  });
  await responseJson(response, "Ollama model unload");
}

async function benchmarkWithModelCleanup<T>(options: BenchmarkOptions, benchmark: () => Promise<T>) {
  if (options.backend.kind === "openai") return benchmark();
  const before = options.backend.kind === "ollama"
    ? await loadedOllamaModels(options)
    : await loadedLmStudioInstances(options);
  let result: T | undefined;
  let benchmarkFailure: unknown;
  try {
    result = await benchmark();
  } catch (error) {
    benchmarkFailure = error;
  }

  let cleanupFailure: unknown;
  try {
    const after = options.backend.kind === "ollama"
      ? await loadedOllamaModels(options)
      : await loadedLmStudioInstances(options);
    const benchmarkOwned = [...after].filter((id) => !before.has(id));
    for (const id of benchmarkOwned) {
      if (options.backend.kind === "ollama") await unloadOllamaModel(options, id);
      else await unloadLmStudioInstance(options, id);
    }
  } catch (error) {
    cleanupFailure = error;
  }

  if (benchmarkFailure && cleanupFailure) {
    const benchmarkMessage = benchmarkFailure instanceof Error ? benchmarkFailure.message : String(benchmarkFailure);
    const cleanupMessage = cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure);
    throw new Error(`${benchmarkMessage} Model cleanup also failed: ${cleanupMessage}`);
  }
  if (cleanupFailure) throw cleanupFailure;
  if (benchmarkFailure) throw benchmarkFailure;
  return result as T;
}

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function responseJson(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} benchmark returned HTTP ${response.status}.`);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error(`${label} benchmark returned an invalid JSON response.`);
  return data as Record<string, unknown>;
}

async function ollamaSample(options: BenchmarkOptions, maxTokens: number) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(joinedUrl(options.backend.host, "/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: PREFILL_PROMPT }],
      stream: false,
      options: { temperature: 0, num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  });
  const data = await responseJson(response, "Ollama");
  const promptTokens = positive(data.prompt_eval_count);
  const promptSeconds = positive(data.prompt_eval_duration) / 1_000_000_000;
  const outputTokens = positive(data.eval_count);
  const outputSeconds = positive(data.eval_duration) / 1_000_000_000;
  if (!promptTokens || !promptSeconds || !outputTokens || !outputSeconds) {
    throw new Error("Ollama benchmark response did not include prompt/output timing fields.");
  }
  return {
    inputTokensPerSecond: promptTokens / promptSeconds,
    outputTokensPerSecond: outputTokens / outputSeconds,
  };
}

async function benchmarkOllama(options: BenchmarkOptions): Promise<HiveComputeModelBenchmark> {
  await ollamaSample(options, 8);
  const samples: Array<{ inputTokensPerSecond: number; outputTokensPerSecond: number }> = [];
  for (let index = 0; index < HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT; index += 1) {
    samples.push(await ollamaSample(options, 64));
  }
  return {
    inputTokensPerSecond: rounded(median(samples.map((sample) => sample.inputTokensPerSecond))),
    outputTokensPerSecond: rounded(median(samples.map((sample) => sample.outputTokensPerSecond))),
    measuredAt: options.measuredAt?.() ?? new Date().toISOString(),
    sampleSize: HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT,
    methodVersion: HIVE_COMPUTE_BENCHMARK_METHOD_VERSION,
    warmupCompleted: true,
    source: "local-benchmark",
  };
}

async function openAiSample(
  options: BenchmarkOptions,
  prompt: string,
  maxTokens: number,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const startedAt = now() ?? performance.now();
  const response = await fetchImpl(joinedUrl(options.backend.host, "/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  });
  const finishedAt = now() ?? performance.now();
  const data = await responseJson(response, "OpenAI-compatible");
  const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : {};
  return {
    promptTokens: positive(usage.prompt_tokens ?? usage.promptTokens),
    outputTokens: positive(usage.completion_tokens ?? usage.completionTokens),
    elapsedSeconds: Math.max(0.001, (finishedAt - startedAt) / 1_000),
  };
}

async function benchmarkOpenAiCompatible(options: BenchmarkOptions): Promise<HiveComputeModelBenchmark> {
  await openAiSample(options, OUTPUT_PROMPT, 8);
  const inputSamples: number[] = [];
  const outputSamples: number[] = [];
  for (let index = 0; index < HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT; index += 1) {
    const prefill = await openAiSample(options, PREFILL_PROMPT, 1);
    if (!prefill.promptTokens) {
      throw new Error("OpenAI-compatible benchmark response did not include prompt token usage.");
    }
    inputSamples.push(prefill.promptTokens / prefill.elapsedSeconds);
  }
  for (let index = 0; index < HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT; index += 1) {
    const output = await openAiSample(options, OUTPUT_PROMPT, 96);
    if (!output.outputTokens) {
      throw new Error("OpenAI-compatible benchmark response did not include output token usage.");
    }
    outputSamples.push(output.outputTokens / output.elapsedSeconds);
  }
  return {
    inputTokensPerSecond: rounded(median(inputSamples)),
    outputTokensPerSecond: rounded(median(outputSamples)),
    measuredAt: options.measuredAt?.() ?? new Date().toISOString(),
    sampleSize: HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT,
    methodVersion: HIVE_COMPUTE_BENCHMARK_METHOD_VERSION,
    warmupCompleted: true,
    source: "local-benchmark",
  };
}

export async function benchmarkHiveComputeModel(options: BenchmarkOptions): Promise<HiveComputeModelBenchmark> {
  if (!options.model.trim()) throw new Error("A model id is required for Hive Compute benchmarking.");
  if (!isHiveComputeBenchmarkableModel(options.model)) {
    throw new Error(`${options.model} is an embedding model and cannot serve Hive Compute chat jobs.`);
  }
  return benchmarkWithModelCleanup(
    options,
    () => options.backend.kind === "ollama" ? benchmarkOllama(options) : benchmarkOpenAiCompatible(options),
  );
}
