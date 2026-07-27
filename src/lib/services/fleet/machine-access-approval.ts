import type { KanbanTask } from "@/lib/types/kanban";
import {
  parseFleetMachineAccessRequest,
  type FleetMachineAccessCapability,
} from "@/lib/types/fleet-machine-policy";
import { assertFleetCollectorUrl } from "@/lib/services/local-collector-url";

const ANSWER_DECISIONS = new Map([
  ["allow 15 min", "allow-temporary"],
  ["always allow", "allow"],
  ["deny", "deny"],
] as const);

type FleetAccessAnswer = "allow 15 min" | "always allow" | "deny";
type FleetAccessDecision = "allow-temporary" | "allow" | "deny";

export type FleetAccessApprovalResolution = {
  handled: true;
  capability: FleetMachineAccessCapability;
  decision: FleetAccessDecision;
  collectorUrl: string;
};

function requestedCapability(task: Pick<KanbanTask, "result">): FleetMachineAccessCapability | null {
  const request = parseFleetMachineAccessRequest(task.result);
  if (!request.requested) return null;
  if (!request.capability) {
    throw new Error(`The agent requested an unknown Fleet access capability: ${request.rawCapability}.`);
  }
  return request.capability;
}

function answerDecision(answer: unknown): FleetAccessDecision | null {
  const normalized = typeof answer === "string" ? answer.trim().toLowerCase() : "";
  return ANSWER_DECISIONS.get(normalized as FleetAccessAnswer) ?? null;
}

export async function resolveFleetMachineAccessAnswer(
  task: Pick<KanbanTask, "result" | "targetMachine">,
  answer: unknown,
  fetcher: typeof fetch = fetch,
): Promise<FleetAccessApprovalResolution | { handled: false }> {
  const capability = requestedCapability(task);
  if (!capability) return { handled: false };

  const decision = answerDecision(answer);
  if (!decision) {
    throw new Error("Choose Allow 15 min, Always allow, or Deny for this Fleet access request.");
  }

  const collectorUrl = assertFleetCollectorUrl(task.targetMachine?.collectorUrl);
  const response = await fetcher(`${collectorUrl}/fleet-policy`, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve-access", capability, decision }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `The collector rejected this access decision (${response.status}).`);
  }

  return { handled: true, capability, decision, collectorUrl };
}
