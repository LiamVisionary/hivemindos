import type { BeeAgentRole, BeeWorkerClass } from "@/lib/types/agent-runtime";

const BEE_ICON_ASSET_VERSION = "20260619-blue-worker-bees";

function beeIcon(path: string) {
  return `${path}?v=${BEE_ICON_ASSET_VERSION}`;
}

const WORKER_CLASS_ICON: Record<BeeWorkerClass, string> = {
  general: beeIcon("/icons/worker-bee-general-v5.png"),
  planner: beeIcon("/icons/worker-bee-planner-v2.png"),
  code: beeIcon("/icons/worker-bee-code-v2.png"),
  vision: beeIcon("/icons/worker-bee-vision-v2.png"),
  writer: beeIcon("/icons/worker-bee-writer-v2.png"),
  research: beeIcon("/icons/worker-bee-research-v2.png"),
  artist: beeIcon("/icons/worker-bee-artist-v2.png"),
  ops: beeIcon("/icons/worker-bee-ops-v2.png"),
  qa: beeIcon("/icons/worker-bee-qa-v2.png"),
  security: beeIcon("/icons/worker-bee-security-v2.png"),
};

export const BEE_ROLE_ICON_PATHS = [
  beeIcon("/icons/queen-bee-v2.png"),
  ...Object.values(WORKER_CLASS_ICON),
] as const;

export function beeRoleIconPath(role?: BeeAgentRole, workerClass: BeeWorkerClass = "general") {
  if (role === "queen") return beeIcon("/icons/queen-bee-v2.png");
  return WORKER_CLASS_ICON[workerClass] ?? WORKER_CLASS_ICON.general;
}
