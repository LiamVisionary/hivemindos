"use client";

import * as React from "react";

import { BBtn, BIcon, NiBadge, ServiceGlyph } from "./integrations-primitives";
import { readJson } from "./integrations-view-helpers";

type RuntimeTarget = {
  runtime: string;
  installed: boolean;
  configured: boolean;
};

type NotebookLmStatus = {
  installed: boolean;
  installStatus: "absent" | "installing" | "installed" | "error";
  installPhase?: string;
  version?: string;
  pythonVersion?: string;
  approximateBytes: number;
  authenticated: boolean;
  authStatus: "signed-out" | "signing-in" | "authenticated" | "error";
  authError?: string;
  error?: string;
  runtimeTargets: RuntimeTarget[];
  installedRuntimeCount: number;
  configuredRuntimeCount: number;
};

type StatusResponse = { ok?: boolean; status?: NotebookLmStatus; error?: string };
type BusyAction = "install" | "login" | "configure" | "logout" | "remove" | "";

export function NotebookLmIntegrationCard() {
  const [status, setStatus] = React.useState<NotebookLmStatus | null>(null);
  const [busy, setBusy] = React.useState<BusyAction>("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(async () => {
    const response = await fetch("/api/integrations/notebooklm", { cache: "no-store" });
    const data = await readJson<StatusResponse>(response);
    if (!response.ok || !data.status) throw new Error(data.error || "Could not read NotebookLM status.");
    setStatus(data.status);
    return data.status;
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not read NotebookLM status."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  React.useEffect(() => {
    if (status?.installStatus !== "installing" && status?.authStatus !== "signing-in") return;
    const timer = window.setInterval(() => {
      void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not refresh NotebookLM status."));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status?.authStatus, status?.installStatus, refresh]);

  async function run(action: Exclude<BusyAction, "">, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/integrations/notebooklm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targets: "all", ...extra }),
      });
      const data = await readJson<StatusResponse>(response);
      if (!response.ok || !data.status) throw new Error(data.error || "NotebookLM action failed.");
      setStatus(data.status);
      if (action === "install") setMessage("Installing the pinned NotebookLM client, MCP server, and local Chromium runtime. This may take a few minutes.");
      if (action === "login") setMessage("A browser window is opening. Finish Google sign-in there; HivemindOS will detect completion automatically.");
      if (action === "configure") setMessage("NotebookLM MCP registration refreshed for installed agent runtimes.");
      if (action === "logout") setMessage("Signed out of the active NotebookLM profile on this machine.");
      if (action === "remove") setMessage("NotebookLM package and runtime registrations removed. Your local NotebookLM authentication profile was preserved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "NotebookLM action failed.");
    } finally {
      setBusy("");
    }
  }

  function signOut() {
    if (!window.confirm("Sign out of NotebookLM on this machine? This clears the active local NotebookLM browser session.")) return;
    void run("logout", { confirmation: "SIGN_OUT_NOTEBOOKLM" });
  }

  function remove() {
    if (!window.confirm("Remove the local NotebookLM package and HivemindOS-managed runtime entries? The separate NotebookLM authentication profile will be preserved.")) return;
    void run("remove", { confirmation: "REMOVE_NOTEBOOKLM_PACKAGE" });
  }

  const activeRuntimes = status?.runtimeTargets.filter((target) => target.installed) ?? [];

  return (
    <section className="ni-browser-card" aria-labelledby="notebooklm-integration-title">
      <div className="ni-browser-head">
        <ServiceGlyph accent="#f0b24d" mono="Nl" size={52} radius={15} />
        <div className="ni-browser-copy">
          <div className="ni-browser-title-row">
            <h2 id="notebooklm-integration-title">NotebookLM</h2>
            {status?.authenticated
              ? <NiBadge good label="Signed in" />
              : status?.authStatus === "signing-in"
                ? <NiBadge warn label="Signing in" />
                : <NiBadge warn label="Local preview" />}
          </div>
          <p>Research across NotebookLM notebooks, sources, chat, notes, studio artifacts, deep research, and sharing through 34 local MCP tools.</p>
        </div>
      </div>

      <div className="fm-note" style={{ alignItems: "flex-start" }}>
        <BIcon name="shield" size={15} />
        <span>
          Installs the pinned unofficial <strong>notebooklm-py 0.8.0b1</strong> preview only on this machine. Google sign-in opens in a local browser and its cookies remain in NotebookLM&rsquo;s private local profile. This integration is not affiliated with Google.
        </span>
      </div>

      {!status && !error ? (
        <div className="ni-browser-loading" role="status" aria-label="Checking NotebookLM integration">
          <span className="ni-tspin" aria-hidden="true" />
          <span>Checking the local NotebookLM integration…</span>
        </div>
      ) : status ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <NiBadge
              good={status.installed}
              warn={status.installStatus === "installing"}
              label={status.installStatus === "installing"
                ? `Installing${status.installPhase ? ` · ${status.installPhase}` : ""}`
                : status.installed
                  ? `Installed · ${status.version}`
                  : "Not installed"}
            />
            {status.installed ? <NiBadge good={status.authenticated} warn={!status.authenticated} label={status.authenticated ? "Authentication ready" : "Sign-in required"} /> : null}
            {status.installed ? <NiBadge good={status.configuredRuntimeCount > 0} label={`${status.configuredRuntimeCount}/${status.installedRuntimeCount} runtimes`} /> : null}
          </div>

          {activeRuntimes.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {activeRuntimes.map((target) => (
                <span key={target.runtime} className={`ni-pill${target.configured ? " good" : ""}`}>
                  {target.runtime} · {target.configured ? "configured" : "available"}
                </span>
              ))}
            </div>
          ) : null}

          <div className="ni-browser-actions">
            {!status.installed ? (
              <BBtn variant="primary" disabled={busy !== "" || status.installStatus === "installing"} onClick={() => void run("install")}>
                {busy === "install" || status.installStatus === "installing" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="plug" size={15} />}
                {status.installStatus === "installing" ? "Installing NotebookLM…" : "Install NotebookLM · ~250 MB"}
              </BBtn>
            ) : (
              <>
                {!status.authenticated ? (
                  <BBtn variant="primary" disabled={busy !== "" || status.authStatus === "signing-in"} onClick={() => void run("login")}>
                    {busy === "login" || status.authStatus === "signing-in" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="key" size={14} />}
                    {status.authStatus === "signing-in" ? "Finish sign-in in browser…" : "Sign in with Google"}
                  </BBtn>
                ) : (
                  <BBtn disabled={busy !== ""} onClick={signOut}>
                    {busy === "logout" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="key" size={14} />}
                    Sign out
                  </BBtn>
                )}
                <BBtn disabled={busy !== ""} onClick={() => void run("configure")}>
                  {busy === "configure" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="sync" size={14} />}
                  Sync runtimes
                </BBtn>
                <BBtn disabled={busy !== ""} onClick={remove}>
                  {busy === "remove" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="trash" size={14} />}
                  Remove package
                </BBtn>
              </>
            )}
          </div>
        </>
      ) : null}

      {message ? <p className="ni-note good" role="status">{message}</p> : null}
      {status?.error ? <p className="ni-note" role="alert">{status.error}</p> : null}
      {status?.authError ? <p className="ni-note" role="alert">{status.authError}</p> : null}
      {error ? <p className="ni-note" role="alert">{error}</p> : null}
      <p className="ni-browser-footnote">NotebookLM uses undocumented Google APIs that can change without notice. Review generated or shared content before external use.</p>
    </section>
  );
}
