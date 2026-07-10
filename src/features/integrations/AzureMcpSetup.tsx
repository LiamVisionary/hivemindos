"use client";

import * as React from "react";

import { BBtn, BIcon, NiBadge } from "./integrations-primitives";
import { readJson } from "./integrations-view-helpers";

type RuntimeTarget = {
  runtime: string;
  installed: boolean;
  configured: boolean;
  access?: "read" | "manage";
};

type AzureMcpStatus = {
  installed: boolean;
  installStatus: "absent" | "installing" | "installed" | "error";
  installPhase?: string;
  version?: string;
  package: string;
  approximateBytes: number;
  access: "read" | "manage";
  telemetry: "disabled";
  error?: string;
  managementConfirmation: string;
  runtimeTargets: RuntimeTarget[];
  installedRuntimeCount: number;
  configuredRuntimeCount: number;
};

type StatusResponse = { ok?: boolean; status?: AzureMcpStatus; error?: string };

export function AzureMcpSetup() {
  const [status, setStatus] = React.useState<AzureMcpStatus | null>(null);
  const [busy, setBusy] = React.useState("");
  const [note, setNote] = React.useState("");

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/azure/mcp", { cache: "no-store" });
      const data = await readJson<StatusResponse>(response);
      if (!response.ok || !data.status) throw new Error(data.error || "Could not read Azure MCP status.");
      setStatus(data.status);
      return data.status;
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not read Azure MCP status.");
      return null;
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  React.useEffect(() => {
    if (status?.installStatus !== "installing") return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [status?.installStatus, refresh]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setNote("");
    try {
      const response = await fetch("/api/integrations/azure/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targets: "all", ...extra }),
      });
      const data = await readJson<StatusResponse>(response);
      if (!response.ok || !data.status) throw new Error(data.error || "Azure MCP action failed.");
      setStatus(data.status);
      if (action === "install") setNote("Downloading the pinned Microsoft Azure MCP. This is about 114 MB and may take a few minutes.");
      if (action === "configure") setNote(extra.access === "manage" ? "Management mode enabled for configured runtimes." : "Read-only mode enabled for configured runtimes.");
      if (action === "remove") setNote("Azure MCP removed from this machine and its runtime configs.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Azure MCP action failed.");
    } finally {
      setBusy("");
    }
  }

  function enableManagement() {
    if (!status) return;
    const confirmed = window.confirm(
      "Enable Azure MCP management mode? Agents may create, change, or delete Azure resources allowed by your Azure RBAC. Those resources can incur charges. HivemindOS cannot enforce a hard Azure spending cap.",
    );
    if (!confirmed) return;
    void run("configure", { access: "manage", confirmation: status.managementConfirmation });
  }

  function remove() {
    if (!window.confirm("Remove the local Azure MCP package and its HivemindOS-managed runtime entries from this machine?")) return;
    void run("remove");
  }

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div className="fm-sec" style={{ margin: "4px 0 0" }}>Local-first MCP</div>
      <div className="fm-note" style={{ alignItems: "flex-start" }}>
        <BIcon name="shield" size={15} />
        <span style={{ lineHeight: 1.55 }}>
          Installs Microsoft&rsquo;s official <strong>@azure/mcp 2.0.4</strong> only on this machine. It starts read-only,
          disables Microsoft telemetry, uses your own Azure identity and RBAC, and does not create an Azure subscription or resource.
        </span>
      </div>

      {!status ? (
        <div className="fm-note" role="status" aria-label="Loading Azure MCP status">
          <span className="ni-spin" /> <span>Checking the local Azure MCP…</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <NiBadge
              good={status.installed}
              warn={status.installStatus === "installing"}
              label={status.installStatus === "installing" ? `Installing${status.installPhase ? ` · ${status.installPhase}` : ""}` : status.installed ? `Installed · ${status.version}` : "Not installed"}
            />
            <NiBadge good={status.access === "read"} warn={status.access === "manage"} label={status.access === "read" ? "Read-only" : "Management enabled"} />
            <NiBadge good label="Telemetry off" />
          </div>

          {status.runtimeTargets.some((target) => target.installed) ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {status.runtimeTargets.filter((target) => target.installed).map((target) => (
                <span key={target.runtime} className={`ni-pill${target.configured ? " good" : ""}`}>
                  {target.runtime}{target.configured ? ` · ${target.access === "manage" ? "manage" : "read"}` : " · available"}
                </span>
              ))}
            </div>
          ) : null}

          {status.error ? <p className="ni-note">{status.error}</p> : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!status.installed ? (
              <BBtn variant="primary" onClick={() => void run("install")} disabled={Boolean(busy) || status.installStatus === "installing"}>
                {busy === "install" || status.installStatus === "installing" ? <span className="ni-spin" /> : <BIcon name="plug" size={14} />}
                {status.installStatus === "installing" ? "Installing Azure MCP…" : "Install read-only MCP · ~114 MB"}
              </BBtn>
            ) : (
              <>
                {status.access === "read" ? (
                  <BBtn onClick={enableManagement} disabled={Boolean(busy)}>
                    {busy === "configure" ? <span className="ni-spin" /> : <BIcon name="alert" size={14} />} Enable management
                  </BBtn>
                ) : (
                  <BBtn variant="primary" onClick={() => void run("configure", { access: "read" })} disabled={Boolean(busy)}>
                    {busy === "configure" ? <span className="ni-spin" /> : <BIcon name="shield" size={14} />} Return to read-only
                  </BBtn>
                )}
                <BBtn onClick={() => void run("configure", { access: status.access, ...(status.access === "manage" ? { confirmation: status.managementConfirmation } : {}) })} disabled={Boolean(busy)}>
                  <BIcon name="sync" size={14} /> Sync runtimes
                </BBtn>
                <BBtn onClick={remove} disabled={Boolean(busy)}>
                  {busy === "remove" ? <span className="ni-spin" /> : <BIcon name="trash" size={14} />} Remove
                </BBtn>
              </>
            )}
          </div>
        </>
      )}
      {note ? <p className="ni-note">{note}</p> : null}
    </section>
  );
}
