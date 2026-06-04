"use client";

import * as React from "react";
import { AgentCallModal, type AgentCallPhase, type AgentCallRealtime, type AgentCallRuntimeAgent } from "@/components/fleet/agent-call-modal";
import type { FleetAgent, FleetMachine } from "@/components/fleet/fleet-data";

type AgentPhoneCallResult = {
  ok?: boolean;
  error?: string;
  result?: {
    call?: {
      mode?: "byok" | "cloud";
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

export default function AgentCallE2EHarness() {
  const startButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [session, setSession] = React.useState<{
    phase: AgentCallPhase;
    error?: string;
    realtime?: AgentCallRealtime;
    runtimeAgent?: AgentCallRuntimeAgent;
  } | null>(null);

  React.useEffect(() => {
    const button = startButtonRef.current;
    if (!button) return;
    button.dataset.hydrated = "true";
    button.style.opacity = "1";
  }, []);

  async function startCall() {
    setSession({ phase: "ringing" });
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dashboard-agent-call",
          agent: { id: harnessAgent.id, name: harnessAgent.name, runtime: harnessAgent.runtime },
          machine: { id: harnessMachine.id, name: harnessMachine.name },
        }),
      });
      const data = await response.json().catch(() => null) as AgentPhoneCallResult | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `Call setup returned HTTP ${response.status}.`);
      const call = data?.result?.call;
      if (call?.mode !== "byok" || !call.realtime?.clientSecret) throw new Error("Harness did not receive BYOK Realtime credentials.");
      setSession({ phase: "ringing", realtime: call.realtime, runtimeAgent: call.runtimeAgent });
    } catch (error) {
      setSession({ phase: "failed", error: error instanceof Error ? error.message : "Could not start harness call." });
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#07111f", color: "#f8fafc" }}>
      <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
        <button
          ref={startButtonRef}
          type="button"
          data-testid="agent-call-harness-start"
          data-hydrated="false"
          onClick={() => void startCall()}
          style={{ border: "1px solid rgba(94,234,212,0.5)", borderRadius: 7, padding: "10px 14px", background: "rgba(20,184,166,0.18)", color: "#f8fafc", fontWeight: 700, opacity: 0.6 }}
        >
          Start BYOK call
        </button>
        <span data-testid="agent-call-harness-phase">{session?.phase ?? "idle"}</span>
      </div>
      {session ? (
        <AgentCallModal
          agent={harnessAgent}
          machine={harnessMachine}
          phase={session.phase}
          error={session.error}
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
