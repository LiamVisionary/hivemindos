"use client";

import { useEffect, useRef, useState } from "react";
import type { ElementType } from "react";
import type { AgentRuntime } from "@/lib/types/agent-runtime";

// Self-contained one-click provisioning panel for the "New Hetzner agent box"
// modal (Mechanism A, app-side). It lets the user pick which runtimes to pre-seed
// and which fleet machine to clone their portable state from, then provisions +
// seeds the box via /api/fleet/machines/provision, streaming the job log.
//
// Kept self-contained (fetches the fleet list itself, owns all its state) so it
// adds the one-click flow without threading new state through DashboardApp.

// Runtimes that have a portable-state manifest (scripts/lib/runtime-portable-state.mjs).
const SEEDABLE_RUNTIMES: Array<{ id: AgentRuntime; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "hermes", label: "Hermes" },
  { id: "openclaw", label: "OpenClaw" },
  { id: "aeon", label: "Aeon" },
  { id: "opencode", label: "OpenCode" },
  { id: "openhands", label: "OpenHands" },
  { id: "aider", label: "Aider" },
  { id: "gemini", label: "Gemini" },
];

type CloneSource = {
  machineId: string;
  name: string;
  collectorUrl: string;
  runtimes: string[];
  self: boolean;
};

type MachineDraft = {
  projectName: string;
  serverType: string;
  serverLocation: string;
  serverImage: string;
};

type Props = {
  machineInitDraft: MachineDraft;
  fleetClass: (...names: Array<string | false | null | undefined>) => string;
  Button: ElementType;
  LoaderCircle: ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
  Plus: ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
};

export function MachineProvisionPanel({ machineInitDraft, fleetClass, Button, LoaderCircle, Plus }: Props) {
  const [sources, setSources] = useState<CloneSource[]>([]);
  const [seedFromMachineId, setSeedFromMachineId] = useState<string>("__local__");
  const [seedRuntimes, setSeedRuntimes] = useState<AgentRuntime[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);
  const pollRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Load the fleet list so the user can clone from another machine. Best-effort:
  // if discovery is unavailable, "This machine" is still offered as the source.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fleet/discover", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.machines) return;
        const list: CloneSource[] = [];
        for (const machine of data.machines as Array<Record<string, unknown>>) {
          const device = (machine.device ?? {}) as Record<string, unknown>;
          const caps = (machine.capabilities ?? {}) as Record<string, unknown>;
          const collectorUrl = String(device.collectorUrl ?? "");
          const runtimes = Array.isArray(caps.runtimes) ? (caps.runtimes as string[]) : [];
          if (machine.collector !== "ready" || !collectorUrl) continue;
          list.push({
            machineId: String(machine.machineId ?? device.dnsName ?? device.name ?? ""),
            name: String(device.name ?? "machine"),
            collectorUrl,
            runtimes,
            self: device.self === true,
          });
        }
        setSources(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // When the clone source changes, default the seed set to whatever that machine
  // already runs (handled in the event below, not an effect, to avoid cascades).
  const handleSourceChange = (machineId: string) => {
    setSeedFromMachineId(machineId);
    const source = sources.find((s) => s.machineId === machineId);
    if (source && source.runtimes.length) {
      setSeedRuntimes(
        source.runtimes.filter((r) => SEEDABLE_RUNTIMES.some((s) => s.id === r)) as AgentRuntime[],
      );
    }
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const toggleRuntime = (id: AgentRuntime) => {
    setSeedRuntimes((current) =>
      current.includes(id) ? current.filter((r) => r !== id) : [...current, id],
    );
  };

  const pollJob = async (jobId: string, cursor: number) => {
    if (!pollRef.current) return;
    let data: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`/api/fleet/machines/provision?jobId=${encodeURIComponent(jobId)}&cursor=${cursor}`, {
        cache: "no-store",
      });
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      window.setTimeout(() => void pollJob(jobId, cursor), 2500);
      return;
    }
    if (!data?.ok) {
      setError(String((data?.error as string) || "Lost track of the provisioning job."));
      setRunning(false);
      pollRef.current = false;
      return;
    }
    const job = data.job as Record<string, unknown>;
    const tail = Array.isArray(job.logTail) ? (job.logTail as string[]) : [];
    if (tail.length) setLog((prev) => [...prev, ...tail]);
    setPhase(String(job.phase ?? ""));
    const nextCursor = Number(job.cursor ?? cursor);
    if (job.status === "running") {
      window.setTimeout(() => void pollJob(jobId, nextCursor), 1500);
    } else {
      setStatus(String(job.status ?? ""));
      setRunning(false);
      pollRef.current = false;
      if (job.status === "failed") setError(String(job.error ?? "Provisioning failed."));
    }
  };

  const provision = async () => {
    setError("");
    setStatus("");
    setLog([]);
    setRunning(true);
    setPhase("starting");
    pollRef.current = true;
    const source = sources.find((s) => s.machineId === seedFromMachineId);
    const body = {
      projectName: machineInitDraft.projectName,
      serverType: machineInitDraft.serverType,
      serverLocation: machineInitDraft.serverLocation,
      serverImage: machineInitDraft.serverImage,
      runtimeAgent: seedRuntimes[0],
      seedRuntimes,
      seedFromMachineId: seedFromMachineId === "__local__" ? "" : seedFromMachineId,
      seedFromCollectorUrl: source && !source.self ? source.collectorUrl : "",
    };
    let data: Record<string, unknown> | null = null;
    try {
      const res = await fetch("/api/fleet/machines/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start provisioning.");
      setRunning(false);
      pollRef.current = false;
      return;
    }
    if (!data?.ok || !data.jobId) {
      setError(String((data?.error as string) || "Could not start provisioning."));
      setRunning(false);
      pollRef.current = false;
      return;
    }
    void pollJob(String(data.jobId), 0);
  };

  const canProvision = Boolean(machineInitDraft.projectName.trim()) && seedRuntimes.length > 0 && !running;

  return (
    <section className={fleetClass("machineProvisionPanel")} style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <strong>One-click provision &amp; clone runtimes</strong>
        <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.75 }}>
          Provisions the box and seeds it with the runtimes below, cloning their skills, memories and
          non-secret config from the source machine. Provider keys arrive via the shared hive env; login
          tokens and session history are never copied. Needs the hcloud CLI + your HCLOUD_TOKEN on this
          machine.
        </p>
      </div>

      <label className={fleetClass("agentSettingsField")}>
        <span>Clone runtimes from</span>
        <select value={seedFromMachineId} onChange={(event) => handleSourceChange(event.target.value)} disabled={running}>
          <option value="__local__">This machine</option>
          {sources
            .filter((s) => !s.self)
            .map((s) => (
              <option key={s.machineId} value={s.machineId}>
                {s.name}
                {s.runtimes.length ? ` (${s.runtimes.length} runtimes)` : ""}
              </option>
            ))}
        </select>
      </label>

      <fieldset className={fleetClass("agentSettingsField")} style={{ border: "none", padding: 0, margin: "10px 0 0" }}>
        <span>Pre-seed these runtimes</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {SEEDABLE_RUNTIMES.map((rt) => (
            <label key={rt.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={seedRuntimes.includes(rt.id)}
                onChange={() => toggleRuntime(rt.id)}
                disabled={running}
              />
              {rt.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ marginTop: 12 }}>
        <Button type="button" onClick={provision} disabled={!canProvision}>
          {running ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
          {running ? `Provisioning… (${phase})` : "Provision now"}
        </Button>
      </div>

      {error ? (
        <div className={fleetClass("machineInitError")} style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {log.length ? (
        <pre
          style={{
            marginTop: 12,
            maxHeight: 220,
            overflow: "auto",
            fontSize: 11,
            lineHeight: 1.5,
            background: "rgba(0,0,0,0.35)",
            padding: 10,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {log.join("\n")}
          {status === "succeeded" ? "\n\n✅ Provisioning complete." : ""}
          <div ref={logEndRef} />
        </pre>
      ) : null}
    </section>
  );
}
