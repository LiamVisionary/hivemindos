const GATEWAY_PORTS = [5000, 5001, 5002];

export type GatewayCallPayload = {
  scriptId?: string;
  title?: string;
  briefing?: string;
  returnAfterRoomReady?: boolean;
  voiceProviderId?: string;
};

export type GatewayCallResult = {
  ok: boolean;
  gateway?: string;
  result?: unknown;
  error?: string;
};

export type AgentCallIdentity = {
  id?: string;
  name?: string;
  runtime?: string;
  role?: string;
  task?: string;
  voiceProviderId?: string;
};

export type AgentCallMachine = {
  id?: string;
  name?: string;
};

export type AgentCallInput = {
  agent: AgentCallIdentity;
  machine?: AgentCallMachine;
};

async function gatewayBases(): Promise<string[]> {
  const live: string[] = [];
  for (const gatewayPort of GATEWAY_PORTS) {
    const base = `http://127.0.0.1:${gatewayPort}`;
    try {
      const response = await fetch(`${base}/voice/calls/ring-now`, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(1_200),
      });
      if (response.ok) live.push(base);
    } catch {
      // Try the next known Claw gateway port.
    }
  }
  return live.length ? live : GATEWAY_PORTS.map((gatewayPort) => `http://127.0.0.1:${gatewayPort}`);
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildAgentCallPayload(input: AgentCallInput): GatewayCallPayload {
  const agentName = clean(input.agent.name) || "Hivemind Agent";
  const runtime = clean(input.agent.runtime);
  const role = clean(input.agent.role);
  const task = clean(input.agent.task);
  const machineName = clean(input.machine?.name);
  const context = [
    `You are ${agentName}, calling Liam from HivemindOS.`,
    runtime || role ? `Agent context: ${[runtime, role].filter(Boolean).join(" / ")}.` : "",
    machineName ? `Machine: ${machineName}.` : "",
    task ? `Current work: ${task}.` : "",
    "Start with a concise status update, then ask what Liam wants to do next.",
  ].filter(Boolean).join("\n");

  return {
    title: agentName,
    briefing: context,
    returnAfterRoomReady: true,
    voiceProviderId: clean(input.agent.voiceProviderId) || undefined,
  };
}

async function gatewayJson(path: string, init?: RequestInit): Promise<GatewayCallResult> {
  const bases = await gatewayBases();
  if (bases.length === 0) {
    return { ok: false, error: "Gateway not reachable on 127.0.0.1:5000-5002. Start the claw gateway to ring the phone." };
  }
  let lastFailure: GatewayCallResult | null = null;
  const retryableStatuses = new Set([403, 404, 405]);
  try {
    for (const base of bases) {
      try {
        const response = await fetch(`${base}${path}`, {
          ...init,
          headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
          signal: AbortSignal.timeout(15_000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          const message = (result && typeof result === "object" && "error" in result && typeof result.error === "string")
            ? result.error
            : `Gateway returned HTTP ${response.status}.`;
          lastFailure = { ok: false, gateway: base, result, error: message };
          if (retryableStatuses.has(response.status)) continue;
          return lastFailure;
        }
        return { ok: true, gateway: base, result };
      } catch (error) {
        lastFailure = { ok: false, gateway: base, error: error instanceof Error ? error.message : "Gateway request failed." };
      }
    }
    return lastFailure ?? { ok: false, error: "Gateway request failed." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Gateway request failed." };
  }
}

export async function ringGatewayCall(payload: GatewayCallPayload): Promise<GatewayCallResult> {
  return gatewayJson("/voice/calls/ring-now", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function readGatewayVoiceConfig(): Promise<GatewayCallResult> {
  return gatewayJson("/voice/config", { method: "GET" });
}

export async function readGatewayVoiceDeviceStatus(): Promise<GatewayCallResult> {
  return gatewayJson("/voice/devices/status", { method: "GET" });
}

export function ringStoredPrompt(scriptId: string) {
  return ringGatewayCall({ scriptId });
}

export function ringAgentCall(input: AgentCallInput) {
  return ringGatewayCall(buildAgentCallPayload(input));
}
