"use client";

import * as React from "react";
import { GitBranch, LoaderCircle, RefreshCcw, ShieldCheck } from "lucide-react";
import type { GitLawbStatus } from "@/lib/types/gitlawb";

type ProjectResponse = {
  ok?: boolean;
  projects?: Array<{ id: string; name: string; gitlawbRepo?: { repoName?: string } }>;
};

export function GitLawbIntegrationPanel() {
  const [status, setStatus] = React.useState<GitLawbStatus | null>(null);
  const [projects, setProjects] = React.useState<ProjectResponse["projects"]>([]);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    setMessage("");
    const [statusResponse, projectsResponse] = await Promise.all([
      fetch("/api/gitlawb/status").then((response) => response.json()).catch(() => null),
      fetch("/api/projects").then((response) => response.json()).catch(() => null),
    ]);
    if (statusResponse?.ok) setStatus(statusResponse.status);
    if (projectsResponse?.ok) setProjects(projectsResponse.projects ?? []);
  }, []);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const run = async (action: "setup-cli" | "identity" | "node/setup") => {
    setBusy(action);
    setMessage("");
    const response = await fetch(`/api/gitlawb/${action}`, { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setBusy("");
    if (data?.status) setStatus(data.status);
    setMessage(data?.message || data?.error || "GitLawb status updated.");
    await load();
  };

  const proofReady = Boolean(status?.cli.installed && status.identity.source === "local");
  const linkedCount = projects?.filter((project) => project.gitlawbRepo).length ?? 0;

  return (
    <section
      style={{
        display: "grid",
        gap: 14,
        padding: 18,
        border: "1px solid rgba(148,163,184,0.18)",
        borderRadius: 8,
        background: "rgba(15,23,42,0.48)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ShieldCheck aria-hidden="true" size={20} />
          <div>
            <h2 style={{ margin: 0, fontSize: 16, letterSpacing: 0 }}>Code Proof</h2>
            <p style={{ margin: "3px 0 0", color: "var(--muted-foreground, #94a3b8)", fontSize: 13 }}>
              Signed code provenance for HivemindOS projects.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} aria-label="Refresh Code Proof status" style={iconButtonStyle}>
          <RefreshCcw size={15} aria-hidden="true" />
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <StatusPill label={status?.cli.installed ? "CLI ready" : "CLI missing"} tone={status?.cli.installed ? "good" : "warn"} />
        <StatusPill label={status?.identity.did ? "DID ready" : "DID missing"} tone={status?.identity.did ? "good" : "warn"} />
        <StatusPill label={status?.node.healthy ? "Node healthy" : "Node optional"} tone={status?.node.healthy ? "good" : "neutral"} />
        <StatusPill label={`${linkedCount} linked project${linkedCount === 1 ? "" : "s"}`} tone={linkedCount ? "good" : "neutral"} />
      </div>

      {status?.identity.did ? (
        <code style={{ overflowWrap: "anywhere", color: "#cbd5e1", fontSize: 12 }}>{status.identity.did}</code>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <ActionButton busy={busy === "setup-cli"} disabled={Boolean(busy)} onClick={() => void run("setup-cli")}>
          <GitBranch size={14} aria-hidden="true" />
          {status?.cli.installed ? "Repair CLI" : "Install CLI"}
        </ActionButton>
        <ActionButton busy={busy === "identity"} disabled={Boolean(busy || !status?.cli.installed)} onClick={() => void run("identity")}>
          <ShieldCheck size={14} aria-hidden="true" />
          {status?.identity.did ? "Refresh DID" : "Create DID"}
        </ActionButton>
        <ActionButton busy={busy === "node/setup"} disabled={Boolean(busy)} onClick={() => void run("node/setup")}>
          <GitBranch size={14} aria-hidden="true" />
          Local node
        </ActionButton>
      </div>

      <small style={{ color: "var(--muted-foreground, #94a3b8)", lineHeight: 1.5 }}>
        {proofReady
          ? "Proof-ready mode is active. Local repo hosting remains lazy until a GitLawb-backed project needs it."
          : "Normal HivemindOS work keeps running if GitLawb is missing."}
      </small>
      {message ? <small style={{ color: "#fde68a", lineHeight: 1.5 }}>{message}</small> : null}
    </section>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "good" | "warn" | "neutral" }) {
  const colors = {
    good: ["rgba(45,212,191,0.14)", "rgba(94,234,212,0.34)", "#99f6e4"],
    warn: ["rgba(251,191,36,0.14)", "rgba(251,191,36,0.34)", "#fde68a"],
    neutral: ["rgba(148,163,184,0.12)", "rgba(148,163,184,0.24)", "#cbd5e1"],
  }[tone];
  return (
    <span style={{ border: `1px solid ${colors[1]}`, background: colors[0], color: colors[2], borderRadius: 7, padding: "5px 8px", fontSize: 11, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function ActionButton({ children, busy, disabled, onClick }: { children: React.ReactNode; busy?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={{ ...buttonStyle, opacity: disabled ? 0.55 : 1 }}>
      {busy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : children}
    </button>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(148,163,184,0.24)",
  borderRadius: 7,
  background: "rgba(15,23,42,0.62)",
  color: "inherit",
  cursor: "pointer",
};

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minHeight: 34,
  border: "1px solid rgba(94,234,212,0.34)",
  borderRadius: 7,
  background: "rgba(45,212,191,0.12)",
  color: "#99f6e4",
  padding: "7px 10px",
  fontWeight: 800,
  cursor: "pointer",
};

export default GitLawbIntegrationPanel;
