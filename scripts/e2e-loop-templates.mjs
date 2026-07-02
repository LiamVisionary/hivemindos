#!/usr/bin/env node
// Live e2e: drive the REAL app flow (/api/loops -> /api/queen-bee -> autonomous pickup)
// for every loop template against REAL fleet agents, then observe loop adherence,
// gate receipts, the independent judge, and (for evo) experiment/frontier state.
//
// Env:
//   DASHBOARD_URL          (default http://127.0.0.1:5021 — the working-tree dev server)
//   E2E_FORCE_MACHINE      machine device.name to constrain routing to (default Ubuntu pool); "" = default routing
//   E2E_TEMPLATES          comma list to filter templates (default all 7)
//   E2E_WAIT_MS            per-run global wait budget (default 540000 = 9m)
//   E2E_POLL_MS            board poll interval (default 4000)
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const DASH = (process.env.DASHBOARD_URL || "http://127.0.0.1:5021").replace(/\/+$/, "");
const FORCE_MACHINE = process.env.E2E_FORCE_MACHINE ?? "hivemindos-ubuntu-8gb-hel1-2";
const WAIT_MS = Number(process.env.E2E_WAIT_MS || 540_000);
const POLL_MS = Number(process.env.E2E_POLL_MS || 4_000);
const RUN = `looptpl-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;

const TOKEN = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await readEnvValue(new URL("../.env.local", import.meta.url), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

const ALL_TEMPLATES = [
  {
    id: "research",
    goal: "Investigate whether the loop receipt contract is being adhered to.",
    message: "Briefly research (from your own knowledge, no external tools needed) two concrete benefits of attaching evidence receipts to autonomous agent tasks. Cite your reasoning. Keep it under 200 words. Do NOT perform any external or irreversible action.",
  },
  {
    id: "operating-unit-learning",
    goal: "Improve an operating unit's onboarding activation while preserving its charter.",
    message: "Propose ONE concrete, low-risk experiment to improve user activation for a small product, and state the metric it would move and how you'd measure it. Keep it under 200 words. Do NOT spend money or take any external action.",
  },
  {
    id: "content",
    goal: "Draft and self-review a short announcement.",
    message: "Write a 3-sentence launch announcement for a feature called 'Loop Receipts'. Then save it as a deliverable by stating a path like /tmp/loop-receipts-announcement.txt and quoting its contents. Do NOT actually write files outside /tmp and do NOT take external actions.",
  },
  {
    id: "daily-brief",
    goal: "Produce a short daily brief with a delivery receipt.",
    message: "Produce a 4-bullet daily brief about the state of an autonomous agent loop system (use plausible illustrative content). Note where it would be delivered (e.g. a path under /tmp). Do NOT take external actions.",
  },
  {
    id: "code-fix",
    goal: "Fix a simple off-by-one bug against tests, lint, and types.",
    message: "Here is a buggy JS function: `function lastIndex(a){return a.length;}`. Explain the off-by-one bug and give the corrected one-liner. For each of test/lint/typecheck, state HONESTLY whether you actually ran it (you likely cannot run them here) — do not claim a command passed unless you truly ran it. Do NOT modify any real files.",
  },
  {
    id: "app-build-harness",
    goal: "Plan, build, and judge a tiny UI widget.",
    message: "Design (do not build for real) a tiny 'copy to clipboard' button component: give the plan, the component code, and what an independent judge should check. Provide an artifact path under /tmp if you would save it. Do NOT run a real build or take external actions.",
  },
  {
    id: "evo-benchmark",
    goal: "Improve a routing benchmark score via an optimizer loop.",
    message: "Propose ONE hypothesis to improve an agent-routing benchmark score, and describe the benchmark command and metric you'd use. State honestly that you have NOT run evo here. Do NOT take external actions.",
    benchmarkCommand: "pnpm test:queen-bee:router",
    benchmarkMetricName: "router_held_out_score",
  },
];

const filter = (process.env.E2E_TEMPLATES || "").split(",").map((s) => s.trim()).filter(Boolean);
const TEMPLATES = filter.length ? ALL_TEMPLATES.filter((t) => filter.includes(t.id)) : ALL_TEMPLATES;

function headers(extra = {}) {
  return { ...(TOKEN ? { "x-hivemindos-device-token": TOKEN } : {}), ...extra };
}
async function api(path, options = {}) {
  const res = await fetch(`${DASH}${path}`, {
    ...options,
    headers: headers({ ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 60_000),
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  if (!res.ok || data?.ok === false) throw new Error(`${options.method || "GET"} ${path} -> ${data?.error || res.status}`);
  return data;
}
async function readEnvValue(fileUrl, key) {
  const raw = await readFile(fileUrl, "utf8").catch(() => "");
  const m = raw.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}=(.*)$`, "m"));
  return m?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gateSummary(loop) {
  const gates = loop?.evalGates ?? [];
  const by = (s) => gates.filter((g) => g.status === s).map((g) => g.verifier || g.id);
  return { total: gates.length, passed: by("passed"), failed: by("failed"), pending: gates.filter((g) => g.status === "pending").map((g) => g.verifier || g.id), required: gates.filter((g) => g.required).length };
}

async function main() {
  if (!TOKEN) throw new Error("No HIVEMINDOS_DASHBOARD_DEVICE_TOKEN (env or .env.local). Cannot call the authed app API.");
  // Fleet discovery (fresh=1) occasionally returns a ready machine with an empty agents
  // list while its collector is busy; retry until the constrained pool actually has agents.
  let snapshot = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const fleet = await api("/api/fleet/discover?includeSnapshots=0&fresh=1", { timeoutMs: 30_000 }).catch(() => null);
    const machines = fleet?.machines || [];
    snapshot = FORCE_MACHINE
      ? machines.filter((m) => (m.device?.name || "") === FORCE_MACHINE)
      : machines.filter((m) => m.collector === "ready");
    if (snapshot.reduce((n, m) => n + (m.agents?.length || 0), 0) > 0) break;
    console.error(`[discover] attempt ${attempt}: constrained pool empty, retrying...`);
    await sleep(3_000);
  }
  if (snapshot.reduce((n, m) => n + (m.agents?.length || 0), 0) === 0) {
    throw new Error(`Constrained pool has no agents after retries (force=${FORCE_MACHINE || "(ready)"}).`);
  }
  const pool = snapshot.flatMap((m) => (m.agents || []).map((a) => a.name)).slice(0, 12);
  console.error(`[${RUN}] routing constrained to ${snapshot.map((m) => m.device?.name).join(", ")} — agents: ${pool.join(", ")}`);

  // Submit every template task (concurrently).
  const runs = [];
  for (const t of TEMPLATES) {
    const marker = `LOOPTPL_${RUN}_${t.id}`.replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
    try {
      const built = await api("/api/loops", {
        method: "POST",
        body: JSON.stringify({ templateId: t.id, goal: t.goal, maxAttempts: 1, benchmarkCommand: t.benchmarkCommand, benchmarkMetricName: t.benchmarkMetricName }),
      });
      const message = `${t.message}\n\nInclude this exact marker on its own line in your final result: ${marker}`;
      const submit = await api("/api/queen-bee", {
        method: "POST",
        body: JSON.stringify({ source: `loop-tpl-e2e:${RUN}`, mode: "act", priority: "high", taskTitle: `Loop template e2e: ${t.id} ${marker}`, message, loop: built.loop, fleetSnapshot: snapshot }),
        timeoutMs: 45_000,
      });
      runs.push({
        template: t.id, marker, taskId: submit.task?.id,
        routedTo: submit.route?.delegation?.agent?.name || submit.task?.assignee,
        routedMachine: submit.route?.targetMachine?.name,
        workerClass: submit.route?.delegation?.workerClass,
        delegated: submit.route?.delegation?.status === "delegated",
        pickupScheduled: submit.route?.autonomousPickupScheduled === true,
        requiredGates: gateSummary(built.loop).required,
        gatesAtSubmit: gateSummary(built.loop),
      });
      console.error(`[submit] ${t.id} -> task ${submit.task?.id} routed=${submit.route?.delegation?.agent?.name} delegated=${submit.route?.delegation?.status} pickup=${submit.route?.autonomousPickupScheduled}`);
    } catch (e) {
      runs.push({ template: t.id, marker, error: String(e.message || e) });
      console.error(`[submit-FAIL] ${t.id}: ${e.message || e}`);
    }
  }

  // Poll the board until all resolved (done/needs-human) or wait budget exhausted.
  const deadline = Date.now() + WAIT_MS;
  const resolved = (s) => s === "done" || s === "needs-human" || s === "archived";
  while (Date.now() < deadline) {
    const board = await api(`/api/kanban?include_archived=true&q=${encodeURIComponent(RUN)}`, { timeoutMs: 30_000 }).catch(() => null);
    const tasks = board?.board?.tasks || [];
    let pending = 0;
    for (const r of runs) {
      if (r.error || r.final) continue;
      const task = tasks.find((x) => x.id === r.taskId);
      if (task && resolved(task.status)) {
        r.final = snapshotTask(task, r.marker);
        console.error(`[done] ${r.template} -> ${task.status} (${r.final.markerSeen ? "marker✓" : "marker✗"}, receipts ${r.final.receipts.length}, gates ${r.final.gates.passed.length}P/${r.final.gates.failed.length}F/${r.final.gates.pending.length}·)`);
      } else {
        pending += 1;
        if (task) r.lastStatus = task.status;
      }
    }
    if (!pending) break;
    await sleep(POLL_MS);
  }
  // Mark timeouts.
  for (const r of runs) if (!r.error && !r.final) r.timedOut = true;

  const report = { run: RUN, dashboard: DASH, forceMachine: FORCE_MACHINE || "(default routing)", agentPool: pool, templates: runs, finishedAt: new Date().toISOString() };
  const out = new URL(`../.e2e-loop-templates-${RUN}.json`, import.meta.url);
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`\nReport written: ${out.pathname}`);
}

function snapshotTask(task, marker) {
  const result = String(task.result || "");
  const receipts = task.loopReceipts || [];
  return {
    status: task.status,
    assignee: task.assignee,
    markerSeen: result.includes(marker),
    gates: gateSummary(task.loop),
    receipts: receipts.map((r) => ({ gateId: r.gateId, status: r.status, source: r.metadata?.source, summary: String(r.summary || "").slice(0, 120) })),
    judgeRan: receipts.some((r) => r.metadata?.source === "judge"),
    selfReportSeen: /```loop-receipts/i.test(result) || receipts.some((r) => r.metadata?.source === "self-report"),
    deliverables: (task.deliverables || []).map((d) => d.path || d.url).filter(Boolean),
    experiments: task.loop?.observation?.totalExperiments,
    frontier: task.loop?.observation?.frontier?.length,
    resultPreview: result.slice(0, 600),
  };
}

// Template tasks land on the REAL shared Work Board; sweep every marker-titled
// task (this run and any stray from a crashed prior run) so E2E runs don't leave
// LOOPTPL_* cards on the user-visible board. The per-task snapshots survive in the
// report JSON written above. E2E_KEEP_TASKS=1 skips this for live debugging.
async function cleanupLoopTemplateTasks() {
  if (process.env.E2E_KEEP_TASKS === "1") return { skipped: "E2E_KEEP_TASKS=1" };
  const outcome = { deletedTasks: 0, errors: [] };
  try {
    const board = await api("/api/kanban?include_archived=true", { timeoutMs: 30_000 });
    const junk = (board.board?.tasks || []).filter((task) =>
      /LOOPTPL_/.test(String(task.title || "")) || /^loop-tpl-e2e:/.test(String(task.source || "")),
    );
    for (const task of junk) {
      try {
        await api("/api/kanban", { method: "DELETE", body: JSON.stringify({ taskId: task.id }) });
        outcome.deletedTasks += 1;
      } catch (e) {
        outcome.errors.push(`delete task ${task.id}: ${e.message}`);
      }
    }
  } catch (e) {
    outcome.errors.push(`list default board: ${e.message}`);
  }
  return outcome;
}

main()
  .catch((e) => { console.error("E2E FAILED:", e.message || e); process.exitCode = 1; })
  .finally(async () => {
    const cleanup = await cleanupLoopTemplateTasks().catch((e) => ({ errors: [String(e?.message || e)] }));
    console.error(`[cleanup] ${JSON.stringify(cleanup)}`);
  });
