import { fleetMachineAccessDecisionFromAnswer, parseFleetMachineAccessRequest } from "@/lib/types/fleet-machine-policy";

export async function resolveChatFleetAccessAnswer(input: {
  answer: string;
  collectorUrl?: string;
  message: string;
}, fetcher: typeof fetch = fetch): Promise<{ handled: false } | { handled: true; prompt: string }> {
  const request = parseFleetMachineAccessRequest(input.message);
  if (!request.requested) return { handled: false };
  if (!request.capability) throw new Error(`Unknown Fleet access capability: ${request.rawCapability}.`);
  const decision = fleetMachineAccessDecisionFromAnswer(input.answer);
  if (!decision) throw new Error("Choose Allow 15 min, Always allow, or Deny.");
  const collectorUrl = input.collectorUrl?.trim();
  if (!collectorUrl) throw new Error("This agent's machine does not have a reachable Fleet collector.");
  const response = await fetcher("/api/fleet/policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve-access", capability: request.capability, collectorUrl, decision }),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `The Fleet collector rejected this decision (${response.status}).`);
  return {
    handled: true,
    prompt: decision === "deny"
      ? `Fleet access to ${request.capability} was denied. Do not use it; continue without it if possible, or explain why the task cannot continue.`
      : `Fleet access to ${request.capability} is now allowed${decision === "allow-temporary" ? " for 15 minutes" : ""}. Retry the blocked capability and continue.`,
  };
}
