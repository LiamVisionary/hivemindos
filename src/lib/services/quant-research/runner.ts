import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  QuantResearchAgentAssignments,
  QuantResearchAuditResult,
  QuantResearchCandidateResult,
  QuantResearchRunManifest,
} from "@/lib/types/quant-research";
import { optionalEnv } from "@/lib/config/env";
import { pythonScriptCommand } from "@/lib/services/hive-env-command";
import {
  REQUIRED_QUANT_FACTOR_SERIES,
  validateQuantResearchAssignments,
} from "./policy";
import {
  buildQuantResearchWorkflow,
  renderResearchReport,
  runQuantResearchWorkflow,
} from "./workflow";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const ENGINE_MANIFEST = join(
  PROJECT_ROOT,
  "native",
  "quant-research-engine",
  "Cargo.toml",
);
const VALIDATOR_SCRIPT = join(
  PROJECT_ROOT,
  "scripts",
  "quant-research-validator.py",
);
const MAX_CANDIDATES = 32;
const MAX_BARS = 250_000;
const PROCESS_OUTPUT_LIMIT = 64 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

interface CandidateInput {
  id: string;
  hypothesis: string;
  economicRationale: string;
  strategy: JsonObject;
}

interface ParsedRunRequest {
  schemaVersion: 1;
  researchOnly: true;
  dataset: JsonObject & {
    id: string;
    source: string;
    asOf: string;
    bars: JsonObject[];
  };
  candidates: CandidateInput[];
  costs: JsonObject;
  split: {
    trainFraction: number;
    purgeBars: number;
  };
  validation: {
    marketReturns: number[];
    factorReturns: Record<string, number[]>;
    policy: JsonObject;
  };
  assignments: QuantResearchAgentAssignments;
}

interface BacktestResult extends JsonObject {
  datasetHash: string;
  strategyHash: string;
  observations: Array<{
    position: number;
    assetReturn: number;
    netReturn: number;
  }>;
  metrics: { meanReturn: number };
}

interface ValidationResult extends JsonObject {
  passed: boolean;
  failedGateIds: string[];
  gates: Array<{ id: string; passed: boolean }>;
}

interface CandidateArtifacts {
  input: CandidateInput;
  backtest: BacktestResult;
  backtestArtifactPath: string;
  backtestArtifactHash: string;
}

export interface ExecuteQuantResearchOptions {
  runRoot?: string;
  runId?: string;
  concurrency?: number;
  processTimeoutMs?: number;
}

export async function executeQuantResearchRun(
  rawRequest: unknown,
  options: ExecuteQuantResearchOptions = {},
): Promise<QuantResearchRunManifest> {
  const request = parseRunRequest(rawRequest);
  const assignmentCheck = validateQuantResearchAssignments(request.assignments);
  if (!assignmentCheck.ok) {
    throw new Error(assignmentCheck.errors.join(" "));
  }
  const runRoot = resolve(options.runRoot ?? defaultRunRoot());
  const runId = safeIdentifier(options.runId ?? createRunId(), "runId");
  const runDirectory = join(runRoot, runId);
  const candidateDirectory = join(runDirectory, "candidates");
  await mkdir(runRoot, { recursive: true });
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      throw new Error(`Quant research run ${runId} already exists; run lineage is append-only.`);
    }
    throw error;
  }
  await mkdir(candidateDirectory, { recursive: true });
  const validationPolicy = enforceValidationPolicy(request.validation.policy);
  const concurrency = boundedInteger(options.concurrency ?? 4, 1, 8);
  const timeoutMs = boundedInteger(options.processTimeoutMs ?? 180_000, 5_000, 600_000);
  const startedAt = new Date().toISOString();

  try {
    await atomicWrite(
      join(runDirectory, "request.json"),
      stableJson({ ...request, validation: { ...request.validation, policy: validationPolicy } }),
    );

    const backtests = await mapWithConcurrency(
      request.candidates,
      concurrency,
      async (candidate) => executeBacktestCandidate(
        request,
        candidate,
        candidateDirectory,
        timeoutMs,
      ),
    );
    validateAlignedResearchInputs(request, backtests);
    const siblingCandidateReturns = backtests.map((candidate) =>
      candidate.backtest.observations.map((row) => row.netReturn)
    );
    const validated = await mapWithConcurrency(
      backtests,
      concurrency,
      async (candidate) => executeValidationCandidate({
        request,
        candidate,
        siblingCandidateReturns,
        validationPolicy,
        candidateDirectory,
        timeoutMs,
      }),
    );
    const candidateById = new Map(
      validated.map((item) => [item.candidate.candidateId, item.candidate]),
    );
    const auditById = new Map(
      validated.map((item) => [item.audit.candidateId, item.audit]),
    );
    const manifest = await runQuantResearchWorkflow({
      runRoot,
      runId,
      candidateIds: request.candidates.map((candidate) => candidate.id),
      executeCandidate: async (candidateId) => {
        const candidate = candidateById.get(candidateId);
        if (!candidate) throw new Error(`Missing candidate artifact for ${candidateId}.`);
        return candidate;
      },
      executeAudits: async (candidate) => {
        const audit = auditById.get(candidate.candidateId);
        if (!audit) throw new Error(`Missing audit artifact for ${candidate.candidateId}.`);
        return audit;
      },
    });
    const firstBacktest = backtests[0]?.backtest;
    const enriched: QuantResearchRunManifest = {
      ...manifest,
      startedAt,
      dataset: {
        id: request.dataset.id,
        source: request.dataset.source,
        asOf: request.dataset.asOf,
        bars: request.dataset.bars.length,
        datasetHash: firstBacktest?.datasetHash ?? "",
      },
      validationPolicy,
      assignments: request.assignments,
    };
    await atomicWrite(enriched.manifestPath, stableJson(enriched));
    await atomicWrite(enriched.reportPath, renderResearchReport(enriched));
    return enriched;
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    try {
      await persistFailedRun({
        runDirectory,
        runId,
        startedAt,
        request,
        validationPolicy,
        failureReason,
      });
    } catch (persistenceError) {
      const persistenceMessage = persistenceError instanceof Error
        ? persistenceError.message
        : String(persistenceError);
      throw new Error(
        `${failureReason} Failed-run lineage could not be persisted: ${persistenceMessage}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function listQuantResearchRuns(options: { runRoot?: string } = {}) {
  const runRoot = resolve(options.runRoot ?? defaultRunRoot());
  const entries = await readdir(runRoot, { withFileTypes: true }).catch(() => []);
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readManifest(join(runRoot, entry.name, "manifest.json"))),
  );
  return manifests
    .filter((manifest): manifest is QuantResearchRunManifest => Boolean(manifest))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

export async function getQuantResearchRun(
  runId: string,
  options: { runRoot?: string } = {},
) {
  const safeRunId = safeIdentifier(runId, "runId");
  const runRoot = resolve(options.runRoot ?? defaultRunRoot());
  return readManifest(join(runRoot, safeRunId, "manifest.json"));
}

async function executeBacktestCandidate(
  request: ParsedRunRequest,
  candidate: CandidateInput,
  candidateDirectory: string,
  timeoutMs: number,
): Promise<CandidateArtifacts> {
  const directory = join(candidateDirectory, candidate.id);
  await mkdir(directory, { recursive: true });
  await atomicWrite(join(directory, "candidate.json"), stableJson(candidate));
  const engineRequest = {
    schemaVersion: 1,
    researchOnly: true,
    dataset: request.dataset,
    strategy: candidate.strategy,
    costs: request.costs,
    split: request.split,
  };
  const backtest = await runRustEngine(engineRequest, timeoutMs) as BacktestResult;
  assertBacktestResult(backtest, candidate.id);
  const content = stableJson(backtest);
  const backtestArtifactPath = join(directory, "backtest.json");
  await atomicWrite(backtestArtifactPath, content);
  return {
    input: candidate,
    backtest,
    backtestArtifactPath,
    backtestArtifactHash: sha256(content),
  };
}

async function persistFailedRun(input: {
  runDirectory: string;
  runId: string;
  startedAt: string;
  request: ParsedRunRequest;
  validationPolicy: Record<string, number>;
  failureReason: string;
}) {
  const manifestPath = join(input.runDirectory, "manifest.json");
  const reportPath = join(input.runDirectory, "report.md");
  const manifest: QuantResearchRunManifest = {
    schemaVersion: 1,
    runId: input.runId,
    researchOnly: true,
    liveTradingEnabled: false,
    status: "failed",
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    graph: buildQuantResearchWorkflow({
      candidateIds: input.request.candidates.map((candidate) => candidate.id),
    }),
    candidates: [],
    audits: [],
    promotedCandidateIds: [],
    rejectedCandidateIds: input.request.candidates.map((candidate) => candidate.id),
    manifestPath,
    reportPath,
    dataset: {
      id: input.request.dataset.id,
      source: input.request.dataset.source,
      asOf: input.request.dataset.asOf,
      bars: input.request.dataset.bars.length,
      datasetHash: "",
    },
    validationPolicy: input.validationPolicy,
    assignments: input.request.assignments,
    failureReason: input.failureReason,
  };
  await atomicWrite(manifestPath, stableJson(manifest));
  await atomicWrite(reportPath, `# Quant Research Run ${input.runId}\n\nResearch-only run failed. Live trading remained disabled.\n\n## Failure\n\n${input.failureReason}\n`);
}

async function executeValidationCandidate(input: {
  request: ParsedRunRequest;
  candidate: CandidateArtifacts;
  siblingCandidateReturns: number[][];
  validationPolicy: Record<string, number>;
  candidateDirectory: string;
  timeoutMs: number;
}) {
  const returns = input.candidate.backtest.observations.map((row) => row.netReturn);
  const trainEnd = Math.floor(returns.length * input.request.split.trainFraction);
  const outStart = Math.min(
    returns.length,
    trainEnd + input.request.split.purgeBars,
  );
  const validationRequest = {
    schemaVersion: 1,
    researchOnly: true,
    candidateId: input.candidate.input.id,
    returns,
    inSampleReturns: returns.slice(0, trainEnd),
    outOfSampleReturns: returns.slice(outStart),
    marketReturns: input.request.validation.marketReturns,
    factorReturns: input.request.validation.factorReturns,
    positions: input.candidate.backtest.observations.map((row) => row.position),
    assetReturns: input.candidate.backtest.observations.map((row) => row.assetReturn),
    siblingCandidateReturns: input.siblingCandidateReturns,
    otherCandidateReturns: input.siblingCandidateReturns.filter(
      (_, index) => input.request.candidates[index]?.id !== input.candidate.input.id,
    ),
    claimedMetrics: {
      meanReturn: input.candidate.backtest.metrics.meanReturn,
    },
    costs: input.request.costs,
    policy: input.validationPolicy,
  };
  const validation = await runPythonValidator(validationRequest, input.timeoutMs) as ValidationResult;
  assertValidationResult(validation, input.candidate.input.id);
  const content = stableJson(validation);
  const validationArtifactPath = join(
    input.candidateDirectory,
    input.candidate.input.id,
    "validation.json",
  );
  await atomicWrite(validationArtifactPath, content);
  const validationArtifactHash = sha256(content);
  const artifactHash = sha256(
    `${input.candidate.backtestArtifactHash}:${validationArtifactHash}`,
  );
  const candidate: QuantResearchCandidateResult = {
    candidateId: input.candidate.input.id,
    passed: validation.passed,
    artifactHash,
    failedGateIds: validation.failedGateIds,
    backtestArtifactPath: input.candidate.backtestArtifactPath,
    backtestArtifactHash: input.candidate.backtestArtifactHash,
    validationArtifactPath,
    validationArtifactHash,
  };
  const regimeGate = validation.gates.find((gate) => gate.id === "regime_robustness");
  const factorGate = validation.gates.find((gate) => gate.id === "factor_residual_alpha");
  const audit: QuantResearchAuditResult = {
    candidateId: candidate.candidateId,
    regimePassed: regimeGate?.passed === true,
    factorPassed: factorGate?.passed === true,
  };
  return { candidate, audit };
}

async function runRustEngine(request: unknown, timeoutMs: number) {
  const override = optionalEnv("HIVEMINDOS_QUANT_ENGINE_PATH");
  const executableName = process.platform === "win32"
    ? "hivemind-quant-research-engine.exe"
    : "hivemind-quant-research-engine";
  const debugBinary = join(
    PROJECT_ROOT,
    "native",
    "quant-research-engine",
    "target",
    "debug",
    process.platform === "win32"
      ? "hivemind-quant-research-engine.exe"
      : "hivemind-quant-research-engine",
  );
  const releaseBinary = debugBinary.replace(`${join("target", "debug")}`, join("target", "release"));
  const packagedCandidates = [
    join(dirname(process.execPath), executableName),
    resolve(dirname(process.execPath), "..", "..", "MacOS", executableName),
    join(PROJECT_ROOT, "src-tauri", "binaries", stagedEngineName()),
  ];
  if (override) return runJsonProcess(override, [], request, timeoutMs);
  const packaged = packagedCandidates.find((candidate) => existsSync(candidate));
  if (packaged) return runJsonProcess(packaged, [], request, timeoutMs);
  if (existsSync(releaseBinary)) return runJsonProcess(releaseBinary, [], request, timeoutMs);
  if (existsSync(debugBinary)) return runJsonProcess(debugBinary, [], request, timeoutMs);
  return runJsonProcess(
    "cargo",
    ["run", "--quiet", "--manifest-path", ENGINE_MANIFEST],
    request,
    timeoutMs,
  );
}

function stagedEngineName() {
  const triple = process.platform === "darwin"
    ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : process.platform === "win32"
      ? "x86_64-pc-windows-msvc"
      : "x86_64-unknown-linux-gnu";
  const extension = process.platform === "win32" ? ".exe" : "";
  return `hivemind-quant-research-engine-${triple}${extension}`;
}

async function runPythonValidator(request: unknown, timeoutMs: number) {
  const pythonOverride = optionalEnv("HIVEMINDOS_QUANT_VALIDATOR_PYTHON");
  const override = optionalEnv("HIVEMINDOS_QUANT_VALIDATOR_PATH");
  const candidates = [
    override,
    VALIDATOR_SCRIPT,
    resolve(dirname(process.execPath), "..", "quant-research", "quant-research-validator.py"),
    resolve(process.cwd(), "..", "quant-research", "quant-research-validator.py"),
  ].filter(Boolean);
  const validatorPath = candidates.find((candidate) => existsSync(candidate));
  if (!validatorPath) {
    throw new Error(
      "The independent Python validator is missing. Reinstall HivemindOS or set HIVEMINDOS_QUANT_VALIDATOR_PATH.",
    );
  }
  if (pythonOverride) {
    return runJsonProcess(pythonOverride, [validatorPath], request, timeoutMs);
  }
  const python = pythonScriptCommand(validatorPath);
  return runJsonProcess(python.command, python.argv, request, timeoutMs);
}

function runJsonProcess(
  command: string,
  args: string[],
  input: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${command} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectProcess(error);
      else resolveProcess(result);
    };
    child.on("error", (error) => finish(
      new Error(`Could not start ${command}: ${error.message}`),
    ));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > PROCESS_OUTPUT_LIMIT) {
        child.kill("SIGKILL");
        finish(new Error(`${command} exceeded the output limit.`));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > PROCESS_OUTPUT_LIMIT) {
        child.kill("SIGKILL");
        finish(new Error(`${command} exceeded the error-output limit.`));
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(
          `${command} failed with exit ${code ?? "unknown"}: ${stderr.trim() || "no error output"}`,
        ));
        return;
      }
      try {
        finish(undefined, JSON.parse(stdout));
      } catch (error) {
        finish(new Error(
          `${command} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function parseRunRequest(value: unknown): ParsedRunRequest {
  if (!isRecord(value)) throw new Error("Quant research request must be an object.");
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1.");
  if (value.researchOnly !== true) {
    throw new Error("Quant research runs are research-only; live execution is disabled.");
  }
  if (!isRecord(value.dataset) || !Array.isArray(value.dataset.bars)) {
    throw new Error("A dataset with bars is required.");
  }
  if (value.dataset.bars.length < 3 || value.dataset.bars.length > MAX_BARS) {
    throw new Error(`Dataset bars must contain between 3 and ${MAX_BARS} rows.`);
  }
  if (!Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length > MAX_CANDIDATES) {
    throw new Error(`Candidates must contain between 1 and ${MAX_CANDIDATES} entries.`);
  }
  const candidateIds = new Set<string>();
  const candidates = value.candidates.map((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.strategy)) {
      throw new Error(`Candidate ${index + 1} needs a typed strategy.`);
    }
    const id = safeIdentifier(requiredString(candidate.id, `candidate ${index + 1} id`), "candidate id");
    if (candidateIds.has(id)) throw new Error(`Duplicate candidate id ${id}.`);
    candidateIds.add(id);
    return {
      id,
      hypothesis: requiredString(candidate.hypothesis, `${id} hypothesis`),
      economicRationale: requiredString(candidate.economicRationale, `${id} economicRationale`),
      strategy: candidate.strategy,
    };
  });
  if (!isRecord(value.costs) || !isRecord(value.split) || !isRecord(value.validation)) {
    throw new Error("costs, split, and validation are required.");
  }
  const marketReturns = numberArray(value.validation.marketReturns, "validation.marketReturns");
  if (!isRecord(value.validation.factorReturns)) {
    throw new Error("validation.factorReturns is required for factor decomposition.");
  }
  const factorReturns = Object.fromEntries(
    Object.entries(value.validation.factorReturns).map(([name, values]) => [
      name,
      numberArray(values, `validation.factorReturns.${name}`),
    ]),
  );
  const missingFactors = REQUIRED_QUANT_FACTOR_SERIES.filter(
    (name) => !(name in factorReturns),
  );
  if (missingFactors.length) {
    throw new Error(
      `Factor coverage is missing ${missingFactors.join(", ")}; require MKT, SMB, HML, RMW, CMA, MOM, and LOW_VOL.`,
    );
  }
  const assignments = isRecord(value.assignments)
    ? value.assignments as QuantResearchAgentAssignments
    : {};
  return {
    schemaVersion: 1,
    researchOnly: true,
    dataset: {
      ...value.dataset,
      id: requiredString(value.dataset.id, "dataset.id"),
      source: requiredString(value.dataset.source, "dataset.source"),
      asOf: requiredString(value.dataset.asOf, "dataset.asOf"),
      bars: value.dataset.bars.map((bar, index) => {
        if (!isRecord(bar)) throw new Error(`Dataset bar ${index + 1} must be an object.`);
        return bar;
      }),
    },
    candidates,
    costs: value.costs,
    split: {
      trainFraction: requiredFinite(value.split.trainFraction, "split.trainFraction"),
      purgeBars: boundedInteger(requiredFinite(value.split.purgeBars, "split.purgeBars"), 0, MAX_BARS),
    },
    validation: {
      marketReturns,
      factorReturns,
      policy: isRecord(value.validation.policy) ? value.validation.policy : {},
    },
    assignments,
  };
}

function validateAlignedResearchInputs(
  request: ParsedRunRequest,
  candidates: CandidateArtifacts[],
) {
  const observations = candidates[0]?.backtest.observations.length ?? 0;
  if (request.validation.marketReturns.length !== observations) {
    throw new Error(
      `validation.marketReturns has ${request.validation.marketReturns.length} rows; expected ${observations}.`,
    );
  }
  for (const [name, values] of Object.entries(request.validation.factorReturns)) {
    if (values.length !== observations) {
      throw new Error(`Factor ${name} has ${values.length} rows; expected ${observations}.`);
    }
  }
  if (candidates.some((candidate) => candidate.backtest.observations.length !== observations)) {
    throw new Error("Candidate backtests are not aligned to the same observation history.");
  }
}

function enforceValidationPolicy(policy: JsonObject): Record<string, number> {
  const number = (key: string, fallback: number) => {
    const value = policy[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  return {
    minObservations: Math.max(252, Math.round(number("minObservations", 252))),
    minHacTStat: Math.max(3, number("minHacTStat", 3)),
    maxHacPValue: Math.min(0.01, number("maxHacPValue", 0.01)),
    maxFdrQValue: Math.min(0.05, number("maxFdrQValue", 0.05)),
    bootstrapIterations: Math.max(10_000, Math.round(number("bootstrapIterations", 10_000))),
    bootstrapBlockSize: Math.max(5, Math.round(number("bootstrapBlockSize", 10))),
    placeboIterations: Math.max(2_000, Math.round(number("placeboIterations", 2_000))),
    maxPlaceboPValue: Math.min(0.05, number("maxPlaceboPValue", 0.05)),
    maxOosSharpeDegradation: Math.min(0.30, number("maxOosSharpeDegradation", 0.30)),
    maxProbabilityBacktestOverfit: Math.min(0.50, number("maxProbabilityBacktestOverfit", 0.50)),
    minPositiveRegimes: Math.max(2, Math.round(number("minPositiveRegimes", 2))),
    maxSingleRegimePnlShare: Math.min(0.70, number("maxSingleRegimePnlShare", 0.70)),
    minFactorAlphaTStat: Math.max(3, number("minFactorAlphaTStat", 3)),
    hacLags: Math.max(5, Math.round(number("hacLags", 5))),
    hmmStates: boundedInteger(number("hmmStates", 3), 2, 5),
    hmmIterations: Math.max(40, Math.round(number("hmmIterations", 40))),
    pboSegments: Math.max(6, Math.round(number("pboSegments", 8))),
    metricTolerance: Math.min(1e-8, number("metricTolerance", 1e-8)),
    minDeflatedSharpeProbability: Math.max(0.95, number("minDeflatedSharpeProbability", 0.95)),
    seed: Math.round(number("seed", 0)),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await operation(values[index]);
      }
    }),
  );
  return results;
}

async function readManifest(path: string) {
  const content = await readFile(path, "utf8").catch(() => "");
  if (!content) return null;
  try {
    const value = JSON.parse(content) as QuantResearchRunManifest;
    return value?.schemaVersion === 1 && value?.researchOnly === true ? value : null;
  } catch {
    return null;
  }
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createRunId() {
  return `quant-${new Date().toISOString().replace(/[:.]/g, "-")}-${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}`;
}

function defaultRunRoot() {
  return optionalEnv("HIVEMINDOS_QUANT_RESEARCH_RUN_ROOT") || join(
    homedir(),
    ".hivemindos",
    "quant-research",
    "runs",
  );
}

function safeIdentifier(value: string, label: string) {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(trimmed)) {
    throw new Error(`${label} must use letters, numbers, dots, underscores, or hyphens.`);
  }
  return trimmed;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requiredFinite(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function numberArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${label} must be a non-empty numeric array.`);
  }
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(`${label}[${index}] must be finite.`);
    }
    return item;
  });
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertBacktestResult(value: unknown, candidateId: string): asserts value is BacktestResult {
  if (!isRecord(value) || !Array.isArray(value.observations) || !isRecord(value.metrics)) {
    throw new Error(`Rust engine returned an invalid result for ${candidateId}.`);
  }
  if (typeof value.datasetHash !== "string" || typeof value.strategyHash !== "string") {
    throw new Error(`Rust engine omitted lineage hashes for ${candidateId}.`);
  }
}

function assertValidationResult(value: unknown, candidateId: string): asserts value is ValidationResult {
  if (!isRecord(value) || typeof value.passed !== "boolean" || !Array.isArray(value.gates) || !Array.isArray(value.failedGateIds)) {
    throw new Error(`Python validator returned an invalid result for ${candidateId}.`);
  }
}
