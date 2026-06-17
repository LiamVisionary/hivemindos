"use client";

import * as React from "react";
import { AgentCallModal, type AgentCallLocalTts, type AgentCallPhase, type AgentCallRealtime, type AgentCallRuntimeAgent } from "@/components/fleet/agent-call-modal";
import type { FleetAgent, FleetMachine } from "@/components/fleet/fleet-data";

type AgentPhoneCallResult = {
  ok?: boolean;
  error?: string;
  result?: {
    call?: {
      mode?: "byok" | "cloud" | "local-tts";
      localTts?: AgentCallLocalTts;
      realtime?: AgentCallRealtime;
      runtimeAgent?: AgentCallRuntimeAgent;
    };
  };
};

const harnessAgent: FleetAgent = {
  id: "harness-agent",
  name: "HarnessAgent",
  runtime: "Hermes",
  state: "ready",
  role: "Worker Bee",
  workerClass: "general",
  wallet: "-",
  balance: "off",
  task: "E2E agent call harness",
  since: "now",
};

const harnessMachine: FleetMachine = {
  id: "harness-mac",
  name: "Harness Mac",
  kind: "Desktop",
  role: "Primary",
  os: "macOS",
  tailnet: "local",
  ip: "127.0.0.1",
  ping: 0,
  cpu: 0,
  ram: 0,
  disk: 0,
  version: "e2e",
  versionState: "current",
  location: "Local",
  city: "Local",
  lat: 0,
  lon: 0,
  uptime: "now",
  agents: [harnessAgent],
};

type HarnessTarget = {
  agent: FleetAgent;
  machine: FleetMachine;
  rawAgent: Record<string, unknown>;
};

type HarnessLocalTtsCandidate = {
  id: string;
  model?: string;
  name?: string;
  voice?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fleetAgentFromRaw(raw: Record<string, unknown>): FleetAgent {
  const name = clean(raw.name) || clean(raw.id) || "HarnessAgent";
  const runtime = clean(raw.runtime) || "hermes";
  return {
    ...harnessAgent,
    id: clean(raw.id) || clean(raw.agentId) || harnessAgent.id,
    name,
    runtime,
    role: clean(raw.role) || clean(raw.workerClass) || runtime,
    task: clean(raw.task) || "E2E agent call harness",
  };
}

function fleetMachineFromRaw(raw: Record<string, unknown>): FleetMachine {
  const device = raw.device && typeof raw.device === "object" ? raw.device as Record<string, unknown> : {};
  const name = clean(device.name) || clean(raw.collectorHost) || "Harness Mac";
  return {
    ...harnessMachine,
    id: clean(raw.machineId) || clean(device.machineId) || harnessMachine.id,
    name,
    ip: clean(device.ip) || harnessMachine.ip,
    agents: [],
  };
}

async function discoverHarnessTarget(): Promise<HarnessTarget> {
  const response = await fetch("/api/fleet/discover?includeSnapshots=0&fresh=1", { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { machines?: Array<Record<string, unknown>> } | null;
  const machines = payload?.machines ?? [];
  const discovered: HarnessTarget[] = [];
  for (const machineRaw of machines) {
    const agents = Array.isArray(machineRaw.agents) ? machineRaw.agents : [];
    for (const rawAgent of agents) {
      if (!rawAgent || typeof rawAgent !== "object") continue;
      const agentRecord = rawAgent as Record<string, unknown>;
      if (!clean(agentRecord.id) || !clean(agentRecord.runtime)) continue;
      const machine = fleetMachineFromRaw(machineRaw);
      const agent = fleetAgentFromRaw(agentRecord);
      discovered.push({ agent, machine: { ...machine, agents: [agent] }, rawAgent: agentRecord });
    }
  }
  const adaptiveAgent = discovered.find((item) => {
    const haystack = `${item.agent.id} ${item.agent.name} ${clean(item.rawAgent.agentId)}`.toLowerCase();
    return haystack.includes("adaptiveagent");
  });
  if (adaptiveAgent) return adaptiveAgent;
  if (discovered[0]) return discovered[0];
  return { agent: harnessAgent, machine: harnessMachine, rawAgent: { id: harnessAgent.id, name: harnessAgent.name, runtime: harnessAgent.runtime } };
}

async function discoverHarnessLocalTtsCandidate(): Promise<HarnessLocalTtsCandidate | null> {
  const configResponse = await fetch("/api/phone?action=voice-config", { cache: "no-store" });
  const configData = await configResponse.json().catch(() => null) as {
    result?: {
      config?: {
        localTtsCandidates?: Array<{
          id?: string;
          model?: string;
          name?: string;
          ok?: boolean;
          port?: number;
          voice?: string;
        }>;
      };
    };
  } | null;
  return configData?.result?.config?.localTtsCandidates?.find((item): item is HarnessLocalTtsCandidate => Boolean(item.ok && item.id && item.port === 8799))
    ?? configData?.result?.config?.localTtsCandidates?.find((item): item is HarnessLocalTtsCandidate => Boolean(item.ok && item.id))
    ?? null;
}

const harnessPageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "var(--foreground, #221d14)",
  background:
    "radial-gradient(circle at 20% 18%, rgba(176, 127, 28, 0.12), transparent 24rem), radial-gradient(circle at 80% 76%, rgba(95, 143, 90, 0.14), transparent 24rem), linear-gradient(180deg, var(--bg-0, #f1ede3), var(--bg-1, #f8f4ec))",
};

const harnessControlsStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  justifyItems: "center",
  padding: 24,
  border: "1px solid var(--border, #d8cdbb)",
  borderRadius: 8,
  background: "var(--surface, #fbf8f1)",
  boxShadow: "0 18px 42px rgba(82, 61, 22, 0.14)",
};

const startButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(95, 143, 90, 0.55)",
  borderRadius: 7,
  padding: "10px 14px",
  background: "rgba(95, 143, 90, 0.13)",
  color: "var(--foreground, #221d14)",
  fontWeight: 700,
  opacity: 0.72,
};

const localTtsButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(176, 127, 28, 0.52)",
  borderRadius: 7,
  padding: "10px 14px",
  background: "rgba(176, 127, 28, 0.16)",
  color: "var(--foreground, #221d14)",
  fontWeight: 700,
};

export default function AgentCallE2EHarness() {
  const startButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [target, setTarget] = React.useState<HarnessTarget | null>(null);
  const [localTtsCandidate, setLocalTtsCandidate] = React.useState<HarnessLocalTtsCandidate | null>(null);
  const [session, setSession] = React.useState<{
    agent: FleetAgent;
    machine: FleetMachine;
    phase: AgentCallPhase;
    error?: string;
    localTts?: AgentCallLocalTts;
    realtime?: AgentCallRealtime;
    runtimeAgent?: AgentCallRuntimeAgent;
  } | null>(null);

  React.useEffect(() => {
    const button = startButtonRef.current;
    if (!button) return;
    button.dataset.hydrated = "true";
    button.style.opacity = "1";
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      discoverHarnessTarget(),
      discoverHarnessLocalTtsCandidate().catch(() => null),
    ]).then(([nextTarget, nextCandidate]) => {
      if (!cancelled) {
        setTarget(nextTarget);
        setLocalTtsCandidate(nextCandidate);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function startByokCall() {
    const currentTarget = target ?? await discoverHarnessTarget();
    setTarget(currentTarget);
    setSession({ agent: currentTarget.agent, machine: currentTarget.machine, phase: "ringing" });
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dashboard-agent-call",
          agent: currentTarget.rawAgent,
          machine: { id: currentTarget.machine.id, name: currentTarget.machine.name },
        }),
      });
      const data = await response.json().catch(() => null) as AgentPhoneCallResult | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `Call setup returned HTTP ${response.status}.`);
      const call = data?.result?.call;
      if (call?.mode !== "byok" || !call.realtime?.clientSecret) throw new Error("Harness did not receive BYOK Realtime credentials.");
      setSession({ agent: currentTarget.agent, machine: currentTarget.machine, phase: "ringing", realtime: call.realtime, runtimeAgent: call.runtimeAgent });
    } catch (error) {
      setSession({ agent: currentTarget.agent, machine: currentTarget.machine, phase: "failed", error: error instanceof Error ? error.message : "Could not start harness call." });
    }
  }

  async function startLocalTtsCall() {
    const currentTarget = target ?? await discoverHarnessTarget();
    const currentCandidate = localTtsCandidate ?? await discoverHarnessLocalTtsCandidate();
    setTarget(currentTarget);
    setLocalTtsCandidate(currentCandidate);
    setSession({ agent: currentTarget.agent, machine: currentTarget.machine, phase: "ringing" });
    try {
      if (!currentCandidate?.id) throw new Error("No validated Local TTS candidate was returned by voice-config.");
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dashboard-agent-call",
          agent: {
            ...currentTarget.rawAgent,
            voiceRuntime: "local-tts",
            voiceProviderId: currentCandidate.id,
            voiceModelId: currentCandidate.model,
            voiceId: currentCandidate.voice,
          },
          machine: { id: currentTarget.machine.id, name: currentTarget.machine.name },
        }),
      });
      const data = await response.json().catch(() => null) as AgentPhoneCallResult | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `Call setup returned HTTP ${response.status}.`);
      const call = data?.result?.call;
      if (call?.mode !== "local-tts" || !call.localTts?.appId) throw new Error("Harness did not receive Local TTS call config.");
      setSession({ agent: currentTarget.agent, machine: currentTarget.machine, phase: "ringing", localTts: call.localTts, runtimeAgent: call.runtimeAgent });
    } catch (error) {
      setSession({ agent: currentTarget.agent, machine: currentTarget.machine, phase: "failed", error: error instanceof Error ? error.message : "Could not start harness Local TTS call." });
    }
  }

  return (
    <main style={harnessPageStyle}>
      <div style={harnessControlsStyle}>
        <button
          ref={startButtonRef}
          type="button"
          data-testid="agent-call-harness-start"
          data-hydrated="false"
          onClick={() => void startByokCall()}
          style={startButtonStyle}
        >
          Start BYOK call
        </button>
        <button
          type="button"
          data-testid="agent-call-harness-local-tts-start"
          onClick={() => void startLocalTtsCall()}
          style={localTtsButtonStyle}
        >
          Start Local TTS call
        </button>
        <span data-testid="agent-call-harness-target">{target ? `${target.agent.name} on ${target.machine.name}` : "Discovering real agent..."}</span>
        <span data-testid="agent-call-harness-tts">{localTtsCandidate ? `Local TTS: ${localTtsCandidate.name || "validated"}` : "Discovering Local TTS..."}</span>
        <span data-testid="agent-call-harness-phase">{session?.phase ?? "idle"}</span>
      </div>
      {session ? (
        <AgentCallModal
          agent={session.agent}
          machine={session.machine}
          phase={session.phase}
          error={session.error}
          localTts={session.localTts}
          realtime={session.realtime}
          runtimeAgent={session.runtimeAgent}
          onVoiceConnected={() => {
            setSession((current) => current && (current.phase === "ringing" || current.phase === "answered")
              ? { ...current, phase: "talking" }
              : current);
          }}
          onClose={() => setSession(null)}
        />
      ) : null}
    </main>
  );
}
