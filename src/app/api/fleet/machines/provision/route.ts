import { initializeHetznerControlRoomMachine } from "@/lib/services/machine-provisioning/hetzner-control-room";
import {
  getProvisionJob,
  provisionJobView,
  startProvisionJob,
} from "@/lib/services/machine-provisioning/provision-runner";
import type { AgentRuntime } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProvisionBody = {
  projectName?: string;
  serverType?: string;
  serverLocation?: string;
  serverImage?: string;
  // Primary runtime installed at boot (HIVE_AGENT_RUNTIME).
  runtimeAgent?: AgentRuntime;
  // Full set of runtimes to install + seed onto the new box.
  seedRuntimes?: AgentRuntime[];
  // Source machine to clone the portable runtime state from.
  seedFromMachineId?: string;
  seedFromCollectorUrl?: string;
};

// POST: scaffold the machine project, then kick off a detached provision+seed job.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ProvisionBody;
  const projectName = body.projectName?.trim();
  if (!projectName) {
    return Response.json({ ok: false, error: "Machine name is required." }, { status: 400 });
  }

  const seedRuntimes = Array.isArray(body.seedRuntimes)
    ? Array.from(new Set(body.seedRuntimes.map((r) => String(r)).filter(Boolean))) as AgentRuntime[]
    : [];
  // The boot-installed runtime is the explicit primary, else the first seed runtime.
  const primaryRuntime = (body.runtimeAgent || seedRuntimes[0] || "hermes") as AgentRuntime;

  try {
    const machine = await initializeHetznerControlRoomMachine({
      projectName,
      serverType: body.serverType,
      serverLocation: body.serverLocation,
      serverImage: body.serverImage,
      runtimeAgent: primaryRuntime,
    });
    const job = await startProvisionJob({
      machine,
      seedRuntimes,
      seedFromMachineId: body.seedFromMachineId,
      seedFromCollectorUrl: body.seedFromCollectorUrl,
    });
    return Response.json({ ok: true, jobId: job.id, machine, job: provisionJobView(job) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not start provisioning." },
      { status: 500 },
    );
  }
}

// GET ?jobId=...&cursor=N : poll a running provision job for its phase + log tail.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const job = getProvisionJob(jobId);
  if (!job) {
    return Response.json({ ok: false, error: "Unknown or expired provision job." }, { status: 404 });
  }
  return Response.json({ ok: true, job: provisionJobView(job, Number.isFinite(cursor) ? cursor : 0) });
}
