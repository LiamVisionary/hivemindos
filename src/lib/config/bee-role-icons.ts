import type { BeeAgentRole, BeeWorkerClass } from "@/lib/types/agent-runtime";

const WORKER_CLASS_ICON: Record<BeeWorkerClass, string> = {
  general: "/icons/worker-bee-general-v3.png",
  planner: "/icons/worker-bee-planner-v2.png",
  code: "/icons/worker-bee-code-v2.png",
  vision: "/icons/worker-bee-vision-v2.png",
  writer: "/icons/worker-bee-writer-v2.png",
  research: "/icons/worker-bee-research-v2.png",
  artist: "/icons/worker-bee-artist-v2.png",
  ops: "/icons/worker-bee-ops-v2.png",
  qa: "/icons/worker-bee-qa-v2.png",
};

export const BEE_ROLE_ICON_PATHS = [
  "/icons/queen-bee-v2.png",
  ...Object.values(WORKER_CLASS_ICON),
] as const;

export function beeRoleIconPath(role?: BeeAgentRole, workerClass: BeeWorkerClass = "general") {
  if (role === "queen") return "/icons/queen-bee-v2.png";
  return WORKER_CLASS_ICON[workerClass] ?? WORKER_CLASS_ICON.general;
}
