import { readFile, writeFile } from "fs/promises";
import path from "path";
import { getMiroSharkCompanionStatus } from "@/lib/services/miroshark/companion-client";
import {
  archiveMiroSharkRun,
  writeMiroSharkRunArtifact,
  type ArchivedMiroSharkRunBody,
  type MiroSharkArchiveResult,
} from "@/lib/services/miroshark/archive";
import type { AeonBrainRunIdentity } from "@/lib/services/aeon-brain/identity";

type MiroSharkResponse<T = Record<string, unknown>> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type RehearsalRequest = {
  scenario?: string;
  simulationId?: string;
  projectId?: string;
  graphId?: string;
  projectName?: string;
  platform?: "twitter" | "reddit" | "parallel" | "polymarket";
  rounds?: number;
  waitForPosts?: boolean;
  maxWaitMs?: number;
  vaultPath?: string;
  startExisting?: boolean;
};

type SwarmSnapshot = NonNullable<ArchivedMiroSharkRunBody["run"]>;

type MiroSharkConfig = {
  time_config?: Record<string, unknown>;
  agent_configs?: Array<Record<string, unknown>>;
};

const DEFAULT_WAIT_MS = 120_000;
const MAX_WAIT_MS = 480_000;

async function requestJson<T>(url: string, init?: RequestInit): Promise<MiroSharkResponse<T>> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });
  const payload = await response.json().catch(() => null) as MiroSharkResponse<T> | null;
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error ?? `MiroShark request failed: HTTP ${response.status}`);
  }
  return payload;
}

async function fetchJson(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  }).then((response) => response.json()).catch((error) => ({ success: false, error: String(error) }));
}

function buildRunLinks(baseUrl: string, simulationId: string) {
  return {
    runStatus: `${baseUrl}/api/simulation/${simulationId}/run-status`,
    runStatusDetail: `${baseUrl}/api/simulation/${simulationId}/run-status/detail`,
    actions: `${baseUrl}/api/simulation/${simulationId}/actions`,
    posts: `${baseUrl}/api/simulation/${simulationId}/posts`,
    timeline: `${baseUrl}/api/simulation/${simulationId}/timeline`,
    profiles: `${baseUrl}/api/simulation/${simulationId}/profiles`,
    beliefDrift: `${baseUrl}/api/simulation/${simulationId}/belief-drift`,
    influence: `${baseUrl}/api/simulation/${simulationId}/influence`,
    interactionNetwork: `${baseUrl}/api/simulation/${simulationId}/interaction-network`,
    demographics: `${baseUrl}/api/simulation/${simulationId}/demographics`,
    quality: `${baseUrl}/api/simulation/${simulationId}/quality`,
    markets: `${baseUrl}/api/simulation/${simulationId}/polymarket/markets`,
    lineage: `${baseUrl}/api/simulation/${simulationId}/lineage`,
    embedSummary: `${baseUrl}/api/simulation/${simulationId}/embed-summary`,
    transcriptJson: `${baseUrl}/api/simulation/${simulationId}/transcript.json`,
    threadJson: `${baseUrl}/api/simulation/${simulationId}/thread.json`,
    surfaceStats: `${baseUrl}/api/simulation/${simulationId}/surface-stats`,
    webhookLog: `${baseUrl}/api/simulation/${simulationId}/webhook-log`,
    report: `${baseUrl}/api/report/by-simulation/${simulationId}`,
    export: `${baseUrl}/api/simulation/${simulationId}/export`,
  };
}

function scenarioDoc(scenario: string) {
  const text = [
    "HivemindOS AEON rehearsal scenario",
    "",
    scenario,
    "",
    "Named seed participants for graph construction:",
    "- Maya Chen is the product lead proposing the plan and coordinating the launch.",
    "- Ravi Patel owns operations and watches cost, staffing, and execution risk.",
    "- Lena Brooks represents skeptical users who need trust, clarity, and proof.",
    "- Diego Morales is the implementation owner and raises delivery constraints.",
    "- Dr. Nora Singh is the external reviewer focused on compliance, safety, and public risk.",
    "",
    "Known relationships:",
    "- Maya Chen and Diego Morales collaborate on the plan.",
    "- Lena Brooks pressures Maya Chen for evidence before accepting the plan.",
    "- Dr. Nora Singh can delay or approve the plan based on the evidence.",
    "- Ravi Patel and Diego Morales debate whether the plan is operationally viable.",
  ].join("\n");

  return JSON.stringify([{
    title: "HivemindOS AEON rehearsal scenario",
    url: "hivemind://aeon-miroshark-rehearsal",
    text,
  }]);
}

async function pollTask(baseUrl: string, taskId: string) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const payload = await requestJson<{
      status?: string;
      progress?: number;
      message?: string;
      result?: Record<string, unknown>;
      error?: string;
    }>(`${baseUrl}/api/graph/task/${taskId}`);
    const data = payload.data ?? {};
    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error(data.error || data.message || "Graph build failed");
    await delay(2_000);
  }
  throw new Error("Timed out waiting for graph build");
}

async function pollPrepare(baseUrl: string, simulationId: string, taskId?: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const payload = await requestJson<{
      status?: string;
      progress?: number;
      message?: string;
      prepare_info?: Record<string, unknown>;
      error?: string;
    }>(`${baseUrl}/api/simulation/prepare/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulation_id: simulationId, task_id: taskId }),
    });
    const data = payload.data ?? {};
    if (data.status === "failed") throw new Error(data.error || data.message || "Simulation preparation failed");
    if (data.status === "ready" || data.status === "completed") return data;
    await delay(2_500);
  }
  throw new Error("Timed out waiting for agent preparation");
}

async function makeShortRunActive(installPath: string | undefined, simulationId: string) {
  if (!installPath) return;

  const configPath = path.join(installPath, "backend", "uploads", "simulations", simulationId, "simulation_config.json");
  const raw = await readFile(configPath, "utf8").catch(() => null);
  if (!raw) return;

  const config = JSON.parse(raw) as MiroSharkConfig;
  const agentCount = Math.max(1, config.agent_configs?.length ?? 1);
  const allHours = Array.from({ length: 24 }, (_, index) => index);
  const minAgents = Math.min(agentCount, Math.max(2, Math.ceil(agentCount / 2)));

  config.time_config = {
    ...(config.time_config ?? {}),
    agents_per_hour_min: minAgents,
    agents_per_hour_max: agentCount,
    peak_hours: allHours,
    peak_activity_multiplier: 1,
    off_peak_hours: [],
    off_peak_activity_multiplier: 1,
    morning_hours: allHours,
    morning_activity_multiplier: 1,
    work_hours: allHours,
    work_activity_multiplier: 1,
  };

  config.agent_configs = config.agent_configs?.map((agent) => ({
    ...agent,
    active_hours: allHours,
    activity_level: Math.max(0.95, Number(agent.activity_level ?? 0)),
  }));

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function prepareSimulation(baseUrl: string, simulationId: string) {
  const prepare = await requestJson<{ task_id?: string; status?: string }>(`${baseUrl}/api/simulation/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulation_id: simulationId, use_llm_for_profiles: true, parallel_profile_count: 5 }),
  });
  if (prepare.data?.status !== "ready") {
    await pollPrepare(baseUrl, simulationId, prepare.data?.task_id);
  }
}

async function startSimulation(input: {
  baseUrl: string;
  simulationId: string;
  platform: NonNullable<RehearsalRequest["platform"]>;
  rounds: number;
}) {
  await requestJson(`${input.baseUrl}/api/simulation/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulation_id: input.simulationId, platform: input.platform, max_rounds: input.rounds, force: true }),
  });
}

async function simulationIsRunning(baseUrl: string, simulationId: string) {
  const payload = await fetchJson(`${baseUrl}/api/simulation/${simulationId}/run-status`);
  const text = JSON.stringify(payload).toLowerCase();
  return /"runner_status"\s*:\s*"running"|"_running"\s*:\s*true|"status"\s*:\s*"running"/.test(text);
}

function isAlreadyRunningStartError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /current status:\s*running|already running/i.test(message);
}

function shouldPrepareBeforeStart(error: unknown) {
  return /call \/prepare endpoint first|simulation not ready/i.test(error instanceof Error ? error.message : String(error));
}

async function createSimulation(input: {
  baseUrl: string;
  installPath?: string;
  scenario: string;
  projectName: string;
  platform: NonNullable<RehearsalRequest["platform"]>;
  rounds: number;
}) {
  const form = new FormData();
  form.set("simulation_requirement", input.scenario);
  form.set("project_name", input.projectName);
  form.set("additional_context", "Created by AEON through the HivemindOS hive MiroShark endpoint.");
  form.set("url_docs", scenarioDoc(input.scenario));

  const ontology = await requestJson<{ project_id?: string }>(`${input.baseUrl}/api/graph/ontology/generate`, {
    method: "POST",
    body: form,
  });
  const projectId = ontology.data?.project_id;
  if (!projectId) throw new Error("MiroShark did not return a project_id");

  const build = await requestJson<{ task_id?: string }>(`${input.baseUrl}/api/graph/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, graph_name: input.projectName, chunk_size: 700, chunk_overlap: 80 }),
  });
  const buildTaskId = build.data?.task_id;
  if (!buildTaskId) throw new Error("MiroShark did not return a graph build task_id");
  const graphTask = await pollTask(input.baseUrl, buildTaskId);
  const graphId = typeof graphTask.result?.graph_id === "string" ? graphTask.result.graph_id : undefined;
  if (!graphId) throw new Error("MiroShark graph build completed without graph_id");

  const simulation = await requestJson<{ simulation_id?: string }>(`${input.baseUrl}/api/simulation/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      graph_id: graphId,
      enable_twitter: input.platform === "twitter" || input.platform === "parallel",
      enable_reddit: input.platform === "reddit" || input.platform === "parallel",
      enable_polymarket: input.platform === "polymarket" || input.platform === "parallel",
    }),
  });
  const simulationId = simulation.data?.simulation_id;
  if (!simulationId) throw new Error("MiroShark did not return a simulation_id");

  await prepareSimulation(input.baseUrl, simulationId);
  await makeShortRunActive(input.installPath, simulationId);

  await startSimulation({
    baseUrl: input.baseUrl,
    simulationId,
    platform: input.platform,
    rounds: input.rounds,
  });

  return { projectId, graphId, simulationId };
}

async function snapshotRun(input: {
  baseUrl: string;
  simulationId: string;
  projectId?: string;
  graphId?: string;
  platform: NonNullable<RehearsalRequest["platform"]>;
  rounds: number;
}): Promise<SwarmSnapshot> {
  const socialPlatform = input.platform === "reddit" ? "reddit" : "twitter";
  const links = buildRunLinks(input.baseUrl, input.simulationId);
  const [
    runStatus,
    runStatusDetail,
    actions,
    posts,
    timeline,
    profiles,
    beliefDrift,
    influence,
    interactionNetwork,
    quality,
    report,
    interviewHistory,
  ] = await Promise.all([
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/run-status`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/run-status/detail?platform=${socialPlatform}`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/actions?platform=${socialPlatform}`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/posts?platform=${socialPlatform}&limit=500`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/timeline`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/profiles?platform=${socialPlatform}`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/belief-drift`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/influence`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/interaction-network`),
    fetchJson(`${input.baseUrl}/api/simulation/${input.simulationId}/quality`),
    fetchJson(`${input.baseUrl}/api/report/by-simulation/${input.simulationId}`),
    fetchJson(`${input.baseUrl}/api/simulation/interview/history?simulation_id=${encodeURIComponent(input.simulationId)}`),
  ]);

  return {
    simulationId: input.simulationId,
    projectId: input.projectId,
    graphId: input.graphId,
    platform: input.platform,
    rounds: input.rounds,
    status: statusLabel(runStatus, runStatusDetail),
    runStatus,
    runStatusDetail,
    actions,
    posts,
    timeline,
    profiles,
    beliefDrift,
    influence,
    interactionNetwork,
    quality,
    report,
    interviewHistory,
    links,
  };
}

async function waitForSnapshot(input: Parameters<typeof snapshotRun>[0] & { maxWaitMs: number }) {
  const deadline = Date.now() + input.maxWaitMs;
  let latest = await snapshotRun(input);
  while (Date.now() < deadline) {
    if (hasVisiblePosts(latest) || isTerminal(latest)) return latest;
    await delay(8_000);
    latest = await snapshotRun(input);
  }
  return latest;
}

function statusLabel(...payloads: unknown[]) {
  for (const payload of payloads) {
    const label = findString(payload, ["status", "state", "phase"]);
    if (label) return label;
  }
  return "started";
}

function findString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string") return direct;
    if (direct && typeof direct === "object") {
      const nested = findString(direct, keys);
      if (nested) return nested;
    }
  }
  return undefined;
}

function postsFromSnapshot(snapshot: SwarmSnapshot): Array<Record<string, unknown>> {
  const payload = snapshot.posts as { data?: { posts?: Array<Record<string, unknown>> } } | undefined;
  return Array.isArray(payload?.data?.posts) ? payload.data.posts : [];
}

function hasVisiblePosts(snapshot: SwarmSnapshot) {
  return postsFromSnapshot(snapshot).some((post) => String(post.quote_content || post.content || "").trim());
}

function isTerminal(snapshot: SwarmSnapshot) {
  const text = JSON.stringify([snapshot.runStatus, snapshot.runStatusDetail, snapshot.status]).toLowerCase();
  return /\b(complete|completed|failed|stopped|terminated|error)\b/.test(text);
}

function buildVerdict(input: {
  request: RehearsalRequest;
  identity: AeonBrainRunIdentity;
  archive: MiroSharkArchiveResult;
  snapshot: SwarmSnapshot;
}) {
  const posts = postsFromSnapshot(input.snapshot)
    .map((post) => String(post.quote_content || post.content || "").trim())
    .filter(Boolean);
  const status = input.archive.summary.status ?? input.snapshot.status ?? "unknown";
  const headline = posts.length
    ? `${posts.length} visible posts captured; review the archived run before acting.`
    : `No visible posts captured yet; AEON should treat this as a launched/pending rehearsal.`;
  const nextAction = posts.length
    ? "Read `run.md`, `posts.md`, and the exact JSON artifacts in the shared vault, then convert the strongest disagreement into one task or decision note."
    : "Run this endpoint again with the returned simulationId to collect a later snapshot.";

  const markdown = [
    "---",
    "type: aeon-miroshark-rehearsal",
    `simulation_id: ${input.archive.summary.simulationId}`,
    `aeon_repository: ${input.identity.repository}`,
    `aeon_run_id: ${input.identity.runId}`,
    `status: ${status}`,
    "---",
    "",
    `# AEON MiroShark Rehearsal - ${input.archive.summary.simulationId}`,
    "",
    "## Verdict",
    "",
    headline,
    "",
    "## Next Action",
    "",
    nextAction,
    "",
    "## Scenario",
    "",
    input.request.scenario?.trim() || "Collected from an existing MiroShark simulation.",
    "",
    "## Archive",
    "",
    `- Run: [[${input.archive.summary.folder}/run]]`,
    `- Posts: [[${input.archive.summary.folder}/posts]]`,
    `- Exact data: \`${input.archive.summary.folder}/run.json\``,
  ].join("\n");

  return {
    status,
    headline,
    nextAction,
    visiblePosts: posts.length,
    markdown,
  };
}

function clampRounds(value: unknown) {
  return Math.max(1, Math.min(200, Number(value ?? 5) || 5));
}

function clampWaitMs(value: unknown) {
  return Math.max(0, Math.min(MAX_WAIT_MS, Number(value ?? DEFAULT_WAIT_MS) || DEFAULT_WAIT_MS));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAeonMiroSharkRehearsal(input: RehearsalRequest, identity: AeonBrainRunIdentity, options: { requestUrl?: string } = {}) {
  const status = await getMiroSharkCompanionStatus({ requestUrl: options.requestUrl });
  if (!status.ok) throw Object.assign(new Error(status.error ?? "MiroShark is not connected"), { status: 503 });

  const platform = input.platform ?? "twitter";
  const rounds = clampRounds(input.rounds);
  const scenario = input.scenario?.trim();
  let simulationId = input.simulationId?.trim();
  let projectId = input.projectId?.trim() || undefined;
  let graphId = input.graphId?.trim() || undefined;

  if (!simulationId) {
    if (!scenario) throw Object.assign(new Error("scenario is required when simulationId is not provided"), { status: 400 });
    const created = await createSimulation({
      baseUrl: status.baseUrl,
      installPath: status.installPath,
      scenario,
      projectName: input.projectName?.trim() || `AEON rehearsal ${new Date().toISOString().slice(0, 16)}`,
      platform,
      rounds,
    });
    simulationId = created.simulationId;
    projectId = created.projectId;
    graphId = created.graphId;
  } else if (input.startExisting) {
    const startInput = {
      baseUrl: status.baseUrl,
      simulationId,
      platform,
      rounds,
    };
    if (!await simulationIsRunning(status.baseUrl, simulationId)) {
      try {
        await startSimulation(startInput);
      } catch (error) {
        if (isAlreadyRunningStartError(error)) {
          // MiroShark can report "not ready" while also keeping the runner alive.
        } else if (shouldPrepareBeforeStart(error)) {
          await prepareSimulation(status.baseUrl, simulationId);
          await startSimulation(startInput);
        } else {
          throw error;
        }
      }
    }
  }

  const snapshotInput = {
    baseUrl: status.baseUrl,
    simulationId,
    projectId,
    graphId,
    platform,
    rounds,
  };
  const snapshot = input.waitForPosts === false
    ? await snapshotRun(snapshotInput)
    : await waitForSnapshot({ ...snapshotInput, maxWaitMs: clampWaitMs(input.maxWaitMs) });

  const archive = await archiveMiroSharkRun({
    vaultPath: input.vaultPath,
    scenario,
    run: snapshot,
  });
  const verdict = buildVerdict({ request: input, identity, archive, snapshot });
  const [markdownPath, jsonPath] = await Promise.all([
    writeMiroSharkRunArtifact({
      archivePath: archive.archivePath,
      folder: archive.summary.folder,
      filename: "aeon-rehearsal.md",
      content: verdict.markdown,
    }),
    writeMiroSharkRunArtifact({
      archivePath: archive.archivePath,
      folder: archive.summary.folder,
      filename: "aeon-rehearsal.json",
      content: JSON.stringify({ identity, request: input, verdict, summary: archive.summary }, null, 2),
    }),
  ]);

  return {
    ok: true,
    identity,
    baseUrl: status.baseUrl,
    archivePath: archive.archivePath,
    summary: archive.summary,
    verdict: {
      status: verdict.status,
      headline: verdict.headline,
      nextAction: verdict.nextAction,
      visiblePosts: verdict.visiblePosts,
      markdownPath,
      jsonPath,
    },
  };
}
