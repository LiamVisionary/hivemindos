import { collectSystemHealth, type SystemHealthReport } from "@/lib/services/system/system-health";

export type SmokeChecklistStatus = "pass" | "warn" | "fail" | "manual";

export type SmokeChecklistItem = {
  id: string;
  label: string;
  status: SmokeChecklistStatus;
  detail: string;
  evidence?: string[];
  nextAction?: string;
};

export type SmokeChecklistReport = {
  ok: boolean;
  generatedAt: string;
  items: SmokeChecklistItem[];
};

function item(id: string, label: string, status: SmokeChecklistStatus, detail: string, options: Omit<SmokeChecklistItem, "id" | "label" | "status" | "detail"> = {}): SmokeChecklistItem {
  return { id, label, status, detail, ...options };
}

export function buildSmokeChecklistFromHealth(health: SystemHealthReport): SmokeChecklistReport {
  const find = (id: string) => health.checks.find((check) => check.id === id);
  const auth = find("dashboard-auth");
  const vault = find("shared-vault");
  const env = find("shared-env");
  const project = find("project-workspace");
  const items: SmokeChecklistItem[] = [
    item(
      "dashboard-auth",
      "Dashboard auth",
      auth?.status === "ok" ? "pass" : "fail",
      auth?.detail ?? "Dashboard auth status was not reported.",
      { evidence: auth ? [auth.status] : [], nextAction: auth?.status === "ok" ? undefined : "Run dashboard-auth status and repair missing keys." },
    ),
    item(
      "collector-readiness",
      "Collector readiness",
      "manual",
      "Open Fleet or call /api/fleet/discover to confirm at least one ready collector.",
      { nextAction: "Use the Diagnostics cockpit once collector probes are enabled." },
    ),
    item(
      "shared-brain",
      "Shared brain and indexes",
      vault?.status === "ok" ? "pass" : vault?.status === "degraded" ? "warn" : "fail",
      vault?.detail ?? "Shared vault status was not reported.",
      { evidence: vault ? [vault.status] : [], nextAction: vault?.status === "ok" ? undefined : "Run pnpm vault:doctor or rebuild brain indexes." },
    ),
    item(
      "shared-env",
      "Shared env",
      env?.status === "ok" ? "pass" : "warn",
      env?.detail ?? "Shared env status was not reported.",
      { evidence: env ? [env.status] : [], nextAction: env?.status === "ok" ? undefined : "Add provider keys with hive-env-add when agents need them." },
    ),
    item(
      "runtime-chat",
      "Runtime chat",
      "manual",
      "Send one short message to a configured chat-capable agent and confirm the stream returns.",
      { nextAction: "Use Chat with a Hermes, OpenClaw, or HivemindOS runtime profile." },
    ),
    item(
      "work-board-task",
      "Work Board task",
      "manual",
      "Create one test Work Board task, move it through ready, and remove it after verification.",
      { nextAction: "Use Work to verify Kanban read/write and task mutation state." },
    ),
    item(
      "handoff-path",
      "Handoff path",
      "manual",
      "Send a small handoff or file transfer to a known machine/runtime and confirm acknowledgement.",
      { nextAction: "Use hive-handoff or the dashboard handoff flow." },
    ),
    item(
      "project-readiness",
      "Project readiness",
      project?.status === "ok" ? "pass" : "warn",
      project?.detail ?? "Project workspace status was not reported.",
      { evidence: project ? [project.status] : [] },
    ),
  ];
  return {
    ok: items.every((entry) => entry.status === "pass" || entry.status === "manual"),
    generatedAt: health.generatedAt,
    items,
  };
}

export async function collectSmokeChecklist(options: { vaultPath?: string; root?: string; now?: Date } = {}) {
  return buildSmokeChecklistFromHealth(await collectSystemHealth(options));
}
