import { getMiroSharkAdminToken, getMiroSharkCompanionStatus } from "@/lib/services/miroshark/companion-client";
import { cachedCall } from "@/lib/services/async-cache";
import { readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Swarm view polls the per-simulation GET branch every ~2s, and each poll
// fans out ~29 companion sub-fetches. Without coalescing, overlapping polls (and
// multiple open tabs) each re-issue the whole fan-out, sustaining 13-18 upstream
// round-trips/sec during a run. We mirror the in-flight-dedupe + short-TTL Promise
// cache used elsewhere (see notifications/route.ts and src/lib/services/async-cache.ts):
// overlapping polls within the TTL await the SAME underlying promise. Live data
// (run-status/actions/posts/timeline/realtime profiles/agent-stats/observability)
// stays on a short TTL; rarely-changing data (templates/lineage/transcript/
// embed-summary/report/interview-history/entities/project) gets a longer TTL so it
// is fetched roughly once per simulation rather than every poll. Only successful
// results are cached — see fetchJsonCached — so a failed sub-fetch never poisons
// the cache, exactly matching today's per-fetch error fallback shape.
const SWARM_LIVE_TTL_MS = 1_500;
const SWARM_SLOW_TTL_MS = 30_000;

type MiroSharkResponse<T = Record<string, unknown>> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type SwarmRunRequest = {
  action?: "run" | "stop" | "inject" | "fork" | "branch" | "publish" | "ask" | "suggest" | "fetch-url" | "report" | "interview" | "resolve" | "outcome";
  simulationId?: string;
  event?: string;
  question?: string;
  textPreview?: string;
  url?: string;
  agentName?: string;
  scenario?: string;
  rounds?: number;
  platform?: "twitter" | "reddit" | "parallel" | "polymarket";
  templateId?: string;
  projectName?: string;
};

type SwarmJob = {
  ok: boolean;
  jobId: string;
  status: "queued" | "running" | "started" | "failed";
  step: string;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  baseUrl?: string;
  projectId?: string;
  graphId?: string;
  simulationId?: string;
  rounds?: number;
  platform?: string;
  templateId?: string;
  projectName?: string;
  links?: Record<string, string>;
};

type MiroSharkConfig = {
  time_config?: Record<string, unknown>;
  agent_configs?: Array<Record<string, unknown>>;
};

type MiroSharkPostsPayload = {
  success?: boolean;
  data?: {
    count?: number;
    posts?: Array<{
      content?: string;
      quote_content?: string | null;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const globalJobs = globalThis as typeof globalThis & {
  __hivemindMirosharkJobs?: Map<string, SwarmJob>;
};
const jobs = globalJobs.__hivemindMirosharkJobs ?? new Map<string, SwarmJob>();
globalJobs.__hivemindMirosharkJobs = jobs;

function updateJob(jobId: string, patch: Partial<SwarmJob>) {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, { ...current, ...patch });
}

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
  }).then((r) => r.json()).catch((error) => ({ success: false, error: String(error) }));
}

// Coalescing + TTL wrapper around fetchJson. cachedCall caches the *promise* so
// overlapping polls share one underlying request, and evicts on rejection so a
// failure is never cached. fetchJson itself never rejects (it resolves to a
// `{ success: false, error }` fallback), so we throw on that shape to trigger
// eviction, then catch at the boundary and return the identical fallback object.
// Net effect: callers see the exact same value/shape as a bare fetchJson, but a
// successful result is reused within `ttlMs` and a failure is retried next poll.
async function fetchJsonCached(key: string, ttlMs: number, url: string, init?: RequestInit) {
  try {
    return await cachedCall(key, ttlMs, async () => {
      const payload = await fetchJson(url, init);
      if (payload && typeof payload === "object" && (payload as { success?: unknown }).success === false) {
        throw payload;
      }
      return payload;
    });
  } catch (thrown) {
    // The thrown value is the fetchJson fallback object itself; pass it through
    // unchanged so the response shape is byte-identical to the uncached path.
    if (thrown && typeof thrown === "object" && (thrown as { success?: unknown }).success === false) {
      return thrown;
    }
    return { success: false, error: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

function extractId(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  }
  return undefined;
}

function payloadData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, "data") ? record.data : value;
}

function payloadArray(value: unknown): unknown[] {
  const data = payloadData(value);
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["items", "markets", "history", "reports", "entities", "data", "posts"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
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
    shareCard: `${baseUrl}/api/simulation/${simulationId}/share-card.png`,
    replayGif: `${baseUrl}/api/simulation/${simulationId}/replay.gif`,
    transcriptMd: `${baseUrl}/api/simulation/${simulationId}/transcript.md`,
    transcriptJson: `${baseUrl}/api/simulation/${simulationId}/transcript.json`,
    trajectoryCsv: `${baseUrl}/api/simulation/${simulationId}/trajectory.csv`,
    trajectoryJsonl: `${baseUrl}/api/simulation/${simulationId}/trajectory.jsonl`,
    chartSvg: `${baseUrl}/api/simulation/${simulationId}/chart.svg`,
    threadTxt: `${baseUrl}/api/simulation/${simulationId}/thread.txt`,
    threadJson: `${baseUrl}/api/simulation/${simulationId}/thread.json`,
    reproduceJson: `${baseUrl}/api/simulation/${simulationId}/reproduce.json`,
    notebook: `${baseUrl}/api/simulation/${simulationId}/notebook.ipynb`,
    surfaceStats: `${baseUrl}/api/simulation/${simulationId}/surface-stats`,
    webhookLog: `${baseUrl}/api/simulation/${simulationId}/webhook-log`,
    dkgCitation: `${baseUrl}/api/simulation/${simulationId}/dkg-citation`,
    report: `${baseUrl}/api/report/by-simulation/${simulationId}`,
    export: `${baseUrl}/api/simulation/${simulationId}/export`,
  };
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
    await new Promise((resolve) => setTimeout(resolve, 2_000));
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
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  throw new Error("Timed out waiting for agent preparation");
}

function scenarioDoc(scenario: string) {
  const text = [
    "HivemindOS swarm scenario",
    "",
    scenario,
    "",
    "Named seed participants for graph construction:",
    "- Maya Chen is the product lead proposing the plan and coordinating the launch.",
    "- Ravi Patel owns a local cafe and worries about pricing, staffing, and reputation.",
    "- Lena Brooks represents parents and residents who need trust, affordability, and clear safety rules.",
    "- Diego Morales coordinates deliveries and raises concerns about handoffs, timing, and worker incentives.",
    "- Dr. Nora Singh is the city health inspector focused on food safety, compliance, and public risk.",
    "",
    "Known relationships:",
    "- Maya Chen collaborates with Ravi Patel and Diego Morales to design the launch.",
    "- Lena Brooks pressures Maya Chen and Dr. Nora Singh for transparency before approval.",
    "- Dr. Nora Singh can delay or approve the launch based on safety evidence.",
    "- Ravi Patel and Diego Morales debate whether operational load makes the launch viable.",
  ].join("\n");

  return JSON.stringify([{
    title: "HivemindOS swarm scenario",
    url: "hivemind://swarm-scenario",
    text,
  }]);
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

function cleanPostsPayload(payload: unknown) {
  const postsPayload = payload as MiroSharkPostsPayload;
  const posts = postsPayload.data?.posts;
  if (!Array.isArray(posts)) return payload;

  const visiblePosts = posts.filter((post) => (post.quote_content || post.content || "").trim().length > 0);
  return {
    ...postsPayload,
    data: {
      ...postsPayload.data,
      raw_count: postsPayload.data?.count ?? posts.length,
      count: visiblePosts.length,
      posts: visiblePosts,
    },
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as SwarmRunRequest | null;
  if (body?.action && body.action !== "run") {
    try {
      const status = await getMiroSharkCompanionStatus({ requestUrl: request.url });
      if (!status.ok) return Response.json({ ok: false, error: status.error ?? "MiroShark is not connected" }, { status: 503 });
      const baseUrl = status.baseUrl;
      if (body.action === "ask") {
        const question = (body.question ?? body.scenario ?? "").trim();
        if (!question) return Response.json({ ok: false, error: "question is required" }, { status: 400 });
        const payload = await requestJson(`${baseUrl}/api/simulation/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        return Response.json({ ok: true, action: body.action, payload });
      }
      if (body.action === "suggest") {
        const textPreview = (body.textPreview ?? body.scenario ?? "").trim();
        if (!textPreview) return Response.json({ ok: false, error: "textPreview is required" }, { status: 400 });
        const payload = await requestJson(`${baseUrl}/api/simulation/suggest-scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text_preview: textPreview, simulation_prompt: body.question }),
        });
        return Response.json({ ok: true, action: body.action, payload });
      }
      if (body.action === "fetch-url") {
        const url = body.url?.trim();
        if (!url) return Response.json({ ok: false, error: "url is required" }, { status: 400 });
        const payload = await requestJson(`${baseUrl}/api/graph/fetch-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        return Response.json({ ok: true, action: body.action, payload });
      }
      const simulationId = body.simulationId?.trim();
      if (!simulationId) return Response.json({ ok: false, error: "simulationId is required" }, { status: 400 });
      if (body.action === "stop") {
        const payload = await requestJson(`${baseUrl}/api/simulation/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simulation_id: simulationId }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
      if (body.action === "publish") {
        const adminToken = getMiroSharkAdminToken(status.installPath);
        if (!adminToken) {
          return Response.json({
            ok: false,
            action: body.action,
            simulationId,
            error: "MiroShark publish auth is not configured. Use Configure publish auth in the Swarm tab.",
          }, { status: 400 });
        }
        const payload = await requestJson(`${baseUrl}/api/simulation/${simulationId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ simulation_id: simulationId }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
      if (body.action === "report") {
        const payload = await requestJson(`${baseUrl}/api/report/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simulation_id: simulationId }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
      if (body.action === "interview") {
        const agentName = body.agentName?.trim();
        const question = body.question?.trim();
        if (!agentName || !question) return Response.json({ ok: false, error: "agentName and question are required" }, { status: 400 });
        const payload = await requestJson(`${baseUrl}/api/simulation/interview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simulation_id: simulationId, agent_name: agentName, question }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
      if (body.action === "resolve" || body.action === "outcome") {
        const adminToken = getMiroSharkAdminToken(status.installPath);
        if (!adminToken) {
          return Response.json({
            ok: false,
            action: body.action,
            simulationId,
            error: "MiroShark admin auth is not configured. Use Configure publish auth in the Swarm tab.",
          }, { status: 400 });
        }
        const payload = await requestJson(`${baseUrl}/api/simulation/${simulationId}/${body.action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ outcome: body.event?.trim() || "resolved from HivemindOS" }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
      if (body.action === "inject") {
        const event = body.event?.trim();
        if (!event) return Response.json({ ok: false, error: "event is required" }, { status: 400 });
        const payload = await requestJson(`${baseUrl}/api/simulation/${simulationId}/director/inject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_text: event }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
      if (body.action === "fork" || body.action === "branch") {
        const event = body.event?.trim() || "HivemindOS counterfactual branch";
        const payload = await requestJson(`${baseUrl}/api/simulation/${body.action === "fork" ? "fork" : "branch-counterfactual"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body.action === "fork"
            ? JSON.stringify({ parent_simulation_id: simulationId, simulation_requirement: event })
            : JSON.stringify({
              parent_simulation_id: simulationId,
              injection_text: event,
              trigger_round: 1,
              label: event.slice(0, 64),
            }),
        });
        return Response.json({ ok: true, action: body.action, simulationId, payload });
      }
    } catch (error) {
      return Response.json({
        ok: false,
        action: body.action,
        simulationId: body.simulationId,
        error: error instanceof Error ? error.message : "MiroShark action failed",
      }, { status: 400 });
    }
  }

  const scenario = body?.scenario?.trim();
  if (!scenario) {
    return Response.json({ ok: false, error: "Scenario is required" }, { status: 400 });
  }

  const jobId = `swarm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const projectName = body?.projectName?.trim() || `HivemindOS swarm ${new Date().toISOString().slice(0, 16)}`;
  const rounds = Math.max(1, Math.min(200, Number(body?.rounds ?? 5)));
  const platform = body?.platform ?? "twitter";
  const templateId = body?.templateId?.trim();
  jobs.set(jobId, {
    ok: true,
    jobId,
    status: "queued",
    step: "queued",
    message: "Queued",
    startedAt: Date.now(),
    rounds,
    platform,
    templateId,
    projectName,
  });

  void (async () => {
    try {
      updateJob(jobId, { status: "running", step: "connect", message: "Checking MiroShark" });
      const status = await getMiroSharkCompanionStatus({ requestUrl: request.url });
      if (!status.ok) throw new Error(status.error ?? "MiroShark is not connected");
      const baseUrl = status.baseUrl;
      updateJob(jobId, { baseUrl, step: "ontology", message: "Generating ontology" });

      const form = new FormData();
      form.set("simulation_requirement", scenario);
      form.set("project_name", projectName);
      form.set("additional_context", "Created and launched from HivemindOS Swarm controls.");
      form.set("url_docs", scenarioDoc(scenario));

      const ontology = await requestJson<{ project_id?: string; ontology?: unknown }>(`${baseUrl}/api/graph/ontology/generate`, {
        method: "POST",
        body: form,
      });
      const projectId = ontology.data?.project_id;
      if (!projectId) throw new Error("MiroShark did not return a project_id");
      updateJob(jobId, { projectId, step: "graph", message: "Building graph" });

      const build = await requestJson<{ task_id?: string }>(`${baseUrl}/api/graph/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, graph_name: projectName, chunk_size: 700, chunk_overlap: 80 }),
      });
      const buildTaskId = build.data?.task_id;
      if (!buildTaskId) throw new Error("MiroShark did not return a graph build task_id");
      const graphTask = await pollTask(baseUrl, buildTaskId);
      const graphId = typeof graphTask.result?.graph_id === "string" ? graphTask.result.graph_id : undefined;
      if (!graphId) throw new Error("MiroShark graph build completed without graph_id");
      const nodeCount = Number(graphTask.result?.node_count ?? 0);
      if (nodeCount < 1) {
        throw new Error("MiroShark built an empty graph. Add concrete actors, organizations, and relationships to the scenario.");
      }
      updateJob(jobId, { graphId, step: "simulation", message: "Creating simulation" });

      const simulation = await requestJson<{ simulation_id?: string }>(`${baseUrl}/api/simulation/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          graph_id: graphId,
          enable_twitter: platform === "twitter" || platform === "parallel",
          enable_reddit: platform === "reddit" || platform === "parallel",
          enable_polymarket: platform === "polymarket" || platform === "parallel",
        }),
      });
      const simulationId = simulation.data?.simulation_id;
      if (!simulationId) throw new Error("MiroShark did not return a simulation_id");
      const resultPlatform = platform === "reddit" ? "reddit" : "twitter";
      updateJob(jobId, { simulationId, step: "prepare", message: "Preparing agents" });

      const prepare = await requestJson<{ task_id?: string; status?: string }>(`${baseUrl}/api/simulation/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulation_id: simulationId, use_llm_for_profiles: true, parallel_profile_count: 5 }),
      });
      if (prepare.data?.status !== "ready") {
        await pollPrepare(baseUrl, simulationId, prepare.data?.task_id);
      }
      await makeShortRunActive(status.installPath, simulationId);
      updateJob(jobId, { step: "start", message: "Starting simulation" });

      await requestJson(`${baseUrl}/api/simulation/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulation_id: simulationId, platform, max_rounds: rounds, force: true }),
      });
      updateJob(jobId, {
        status: "started",
        step: "started",
        message: "Simulation started",
        finishedAt: Date.now(),
        templateId,
        links: {
          ...buildRunLinks(baseUrl, simulationId),
          actions: `${baseUrl}/api/simulation/${simulationId}/actions?platform=${resultPlatform}`,
          posts: `${baseUrl}/api/simulation/${simulationId}/posts?platform=${resultPlatform}`,
          profiles: `${baseUrl}/api/simulation/${simulationId}/profiles?platform=${resultPlatform}`,
        },
      });
    } catch (error) {
      updateJob(jobId, {
        ok: false,
        status: "failed",
        step: "failed",
        message: "Run failed",
        error: error instanceof Error ? error.message : "Unknown MiroShark run error",
        finishedAt: Date.now(),
      });
    }
  })();

  return Response.json(jobs.get(jobId));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const metadata = searchParams.get("metadata");
  if (metadata === "1") {
    const status = await getMiroSharkCompanionStatus({ requestUrl: request.url });
    if (!status.ok) {
      return Response.json({ ok: false, error: status.error ?? "MiroShark is not connected" }, { status: 503 });
    }
    const [templates, templateCapabilities, history, publicRuns, simulationList, trending, observabilityStats, observabilityEvents, llmCalls, settings, mcpStatus, pushVapidKey] = await Promise.all([
      fetchJson(`${status.baseUrl}/api/templates/list`),
      fetchJson(`${status.baseUrl}/api/templates/capabilities`),
      fetchJson(`${status.baseUrl}/api/simulation/history`),
      fetchJson(`${status.baseUrl}/api/simulation/public`),
      fetchJson(`${status.baseUrl}/api/simulation/list`),
      fetchJson(`${status.baseUrl}/api/simulation/trending`),
      fetchJson(`${status.baseUrl}/api/observability/stats`),
      fetchJson(`${status.baseUrl}/api/observability/events?limit=30`),
      fetchJson(`${status.baseUrl}/api/observability/llm-calls?limit=20`),
      fetchJson(`${status.baseUrl}/api/settings`),
      fetchJson(`${status.baseUrl}/api/mcp/status`),
      fetchJson(`${status.baseUrl}/api/simulation/push/vapid-public-key`),
    ]);
    const templateDetails = await Promise.all(
      payloadArray(templates).slice(0, 12).flatMap((template) => {
        const templateId = extractId(template, ["id", "template_id"]);
        return templateId ? [fetchJson(`${status.baseUrl}/api/templates/${encodeURIComponent(templateId)}?enrich=true`)] : [];
      }),
    );
    return Response.json({
      ok: true,
      baseUrl: status.baseUrl,
      templates,
      templateCapabilities,
      templateDetails,
      history,
      publicRuns,
      simulationList,
      trending,
      observabilityStats,
      observabilityEvents,
      llmCalls,
      settings,
      mcpStatus,
      pushVapidKey,
    });
  }

  const jobId = searchParams.get("job_id");
  if (jobId) {
    const job = jobs.get(jobId);
    if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
    return Response.json(job);
  }
  const simulationId = searchParams.get("simulation_id");
  const requestedPlatform = searchParams.get("platform") || "twitter";
  const platform = requestedPlatform === "reddit" || requestedPlatform === "polymarket" || requestedPlatform === "parallel" ? requestedPlatform : "twitter";
  const socialPlatform = platform === "reddit" ? "reddit" : "twitter";
  const limit = Math.max(1, Math.min(2_000, Number(searchParams.get("limit") ?? 500) || 500));
  if (!simulationId) {
    return Response.json({ ok: false, error: "simulation_id is required" }, { status: 400 });
  }
  const status = await getMiroSharkCompanionStatus({ requestUrl: request.url });
  if (!status.ok) {
    return Response.json({ ok: false, error: status.error ?? "MiroShark is not connected" }, { status: 503 });
  }
  const links = buildRunLinks(status.baseUrl, simulationId);
  const graphId = searchParams.get("graph_id") ?? "";
  const projectId = searchParams.get("project_id") ?? "";

  // Live aggregate: the data that actually changes every poll. Wrap the whole
  // fan-out (including marketPrices, which depends on `markets`) in one cachedCall
  // keyed by the real request identity, so overlapping polls within SWARM_LIVE_TTL_MS
  // — including multiple open Swarm tabs — await a single in-flight promise instead
  // of each re-issuing the fan-out. Sub-fetches inside stay as bare fetchJson, so an
  // individual failure still resolves to its `{ success: false }` fallback; we only
  // cache the aggregate when the whole batch resolves (a throw would evict the entry).
  const liveKey = `miroshark:swarm:live:${status.baseUrl}|${simulationId}|${socialPlatform}|${limit}`;
  const livePromise = cachedCall(liveKey, SWARM_LIVE_TTL_MS, async () => {
    const [runStatus, runStatusDetail, actions, posts, timeline, profiles, realtimeProfiles, beliefDrift, counterfactual, agentStats, influence, interactionNetwork, demographics, quality, markets, surfaceStats, threadJson, webhookLog, graphData, observabilityStats, observabilityEvents, llmCalls] = await Promise.all([
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/run-status`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/run-status/detail?platform=${socialPlatform}`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/actions?platform=${socialPlatform}`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/posts?platform=${socialPlatform}&limit=${limit}`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/timeline`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/profiles?platform=${socialPlatform}`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/profiles/realtime`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/belief-drift`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/counterfactual`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/agent-stats`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/influence`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/interaction-network`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/demographics`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/quality`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/polymarket/markets`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/surface-stats`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/thread.json`),
      fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/webhook-log`),
      graphId ? fetchJson(`${status.baseUrl}/api/graph/data/${encodeURIComponent(graphId)}?limit=100`) : Promise.resolve({ success: false, error: "graph_id unavailable" }),
      fetchJson(`${status.baseUrl}/api/observability/stats`),
      fetchJson(`${status.baseUrl}/api/observability/events?limit=30`),
      fetchJson(`${status.baseUrl}/api/observability/llm-calls?limit=20`),
    ]);
    const marketPrices = await Promise.all(
      payloadArray(markets).slice(0, 8).flatMap((market) => {
        const marketId = extractId(market, ["market_id", "id"]);
        return marketId ? [fetchJson(`${status.baseUrl}/api/simulation/${simulationId}/polymarket/market/${encodeURIComponent(marketId)}/prices`)] : [];
      }),
    );
    return { runStatus, runStatusDetail, actions, posts, timeline, profiles, realtimeProfiles, beliefDrift, counterfactual, agentStats, influence, interactionNetwork, demographics, quality, markets, marketPrices, surfaceStats, threadJson, webhookLog, graphData, observabilityStats, observabilityEvents, llmCalls };
  });

  // Rarely-changing sub-fetches: lineage/transcript/embed-summary/report/
  // interview-history/entities/project are written roughly once per run (graph
  // build, end-of-run report, ad-hoc interviews) and otherwise unchanged. Each gets
  // a longer SWARM_SLOW_TTL_MS via fetchJsonCached so they leave the 2s hot path
  // without altering the response shape. They run concurrently with the live
  // batch: both promises are started before either is awaited (fetchJson and
  // fetchJsonCached never reject, so awaiting them jointly cannot leave an
  // unhandled rejection behind).
  const slowPromise = Promise.all([
    fetchJsonCached(`miroshark:swarm:slow:lineage:${status.baseUrl}|${simulationId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/simulation/${simulationId}/lineage`),
    fetchJsonCached(`miroshark:swarm:slow:transcript:${status.baseUrl}|${simulationId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/simulation/${simulationId}/transcript.json`),
    fetchJsonCached(`miroshark:swarm:slow:embedSummary:${status.baseUrl}|${simulationId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/simulation/${simulationId}/embed-summary`),
    fetchJsonCached(`miroshark:swarm:slow:report:${status.baseUrl}|${simulationId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/report/by-simulation/${simulationId}`),
    fetchJsonCached(`miroshark:swarm:slow:interviewHistory:${status.baseUrl}|${simulationId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/simulation/interview/history?simulation_id=${encodeURIComponent(simulationId)}`),
    graphId ? fetchJsonCached(`miroshark:swarm:slow:entities:${status.baseUrl}|${graphId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/simulation/entities/${encodeURIComponent(graphId)}`) : Promise.resolve({ success: false, error: "graph_id unavailable" }),
    projectId ? fetchJsonCached(`miroshark:swarm:slow:project:${status.baseUrl}|${projectId}`, SWARM_SLOW_TTL_MS, `${status.baseUrl}/api/graph/project/${encodeURIComponent(projectId)}`) : Promise.resolve({ success: false, error: "project_id unavailable" }),
  ]);
  const [live, slow] = await Promise.all([livePromise, slowPromise]);
  const [lineage, transcriptJson, embedSummary, report, interviewHistory, entities, project] = slow;

  const { runStatus, runStatusDetail, actions, posts, timeline, profiles, realtimeProfiles, beliefDrift, counterfactual, agentStats, influence, interactionNetwork, demographics, quality, markets, marketPrices, surfaceStats, threadJson, webhookLog, graphData, observabilityStats, observabilityEvents, llmCalls } = live;
  return Response.json({
    ok: true,
    simulationId,
    platform,
    links,
    runStatus,
    runStatusDetail,
    actions,
    posts: cleanPostsPayload(posts),
    timeline,
    profiles,
    realtimeProfiles,
    beliefDrift,
    counterfactual,
    agentStats,
    influence,
    interactionNetwork,
    demographics,
    quality,
    markets,
    marketPrices,
    surfaceStats,
    lineage,
    threadJson,
    transcriptJson,
    embedSummary,
    webhookLog,
    report,
    interviewHistory,
    graphData,
    entities,
    project,
    observabilityStats,
    observabilityEvents,
    llmCalls,
  });
}
