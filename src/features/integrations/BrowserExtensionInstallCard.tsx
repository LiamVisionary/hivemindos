"use client";

import * as React from "react";
import { nativeOrFetch } from "@/lib/native/bridge";
import { BBtn, BIcon, NiBadge, ServiceGlyph } from "./integrations-primitives";

type BrowserTarget = {
  id: string;
  label: string;
  extensionManagementUrl: string;
};

type InstallStatus = {
  ok?: boolean;
  error?: string;
  available: boolean;
  prepared: boolean;
  version: string;
  installedVersion: string;
  installPath: string;
  rollbackAvailable: boolean;
  browsers: BrowserTarget[];
};

type DeliverableActionResult = { ok?: boolean; error?: string };
type BusyAction = "prepare" | "reveal" | "open" | "copy" | "";

async function responseJson<T extends { ok?: boolean; error?: string }>(response: Response) {
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok || !data?.ok) throw new Error(data?.error || "HivemindOS could not complete that action.");
  return data;
}

async function loadInstallStatus() {
  return responseJson<InstallStatus>(await fetch("/api/integrations/browser-extension", { cache: "no-store" }));
}

async function prepareInstall() {
  return responseJson<InstallStatus>(await fetch("/api/integrations/browser-extension", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare-install" }),
  }));
}

async function openExtensionsPage(browserId: string) {
  await responseJson<{ ok?: boolean; error?: string; opened?: boolean }>(await fetch("/api/integrations/browser-extension", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "open-extensions", browserId }),
  }));
}

async function revealInstallPath(path: string) {
  const result = await nativeOrFetch<DeliverableActionResult>({
    command: "open_deliverable",
    args: { action: "reveal", path },
    fallback: async () => {
      const response = await fetch("/api/kanban/deliverable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reveal", path }),
      });
      return response.json().catch(() => ({ ok: false, error: "Could not show the extension folder." })) as Promise<DeliverableActionResult>;
    },
  });
  if (!result?.ok) throw new Error(result?.error || "Could not show the extension folder.");
}

export function BrowserExtensionInstallCard() {
  const [status, setStatus] = React.useState<InstallStatus | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = React.useState("");
  const [busy, setBusy] = React.useState<BusyAction>("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    void loadInstallStatus()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setSelectedBrowserId((current) => current || next.browsers[0]?.id || "");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not check the browser extension.");
      });
    return () => { active = false; };
  }, []);

  const selectedBrowser = status?.browsers.find((browser) => browser.id === selectedBrowserId);

  async function run(action: Exclude<BusyAction, "">, operation: () => Promise<void>) {
    setBusy(action);
    setMessage("");
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HivemindOS could not complete that action.");
    } finally {
      setBusy("");
    }
  }

  function install() {
    void run("prepare", async () => {
      const next = await prepareInstall();
      setStatus(next);
      const browserId = selectedBrowserId || next.browsers[0]?.id || "";
      setSelectedBrowserId(browserId);
      await revealInstallPath(next.installPath);
      if (browserId) await openExtensionsPage(browserId);
      setMessage(browserId
        ? "The folder is ready. Turn on Developer mode, choose Load unpacked, then select the revealed folder."
        : "The folder is ready. Open your Chromium browser's extensions page and choose Load unpacked.");
    });
  }

  function reveal() {
    if (!status?.installPath) return;
    void run("reveal", async () => {
      await revealInstallPath(status.installPath);
      setMessage("Extension folder revealed in Finder.");
    });
  }

  function openBrowser() {
    if (!selectedBrowserId) return;
    void run("open", async () => {
      await openExtensionsPage(selectedBrowserId);
      setMessage("Extensions opened. Turn on Developer mode, choose Load unpacked, then select the prepared folder.");
    });
  }

  function copyPath() {
    if (!status?.installPath) return;
    void run("copy", async () => {
      await navigator.clipboard.writeText(status.installPath);
      setMessage("Extension folder path copied.");
    });
  }

  return (
    <section className="ni-browser-card" aria-labelledby="browser-extension-title">
      <div className="ni-browser-head">
        <ServiceGlyph accent="var(--honey)" mono="Hm" size={52} radius={15} />
        <div className="ni-browser-copy">
          <div className="ni-browser-title-row">
            <h2 id="browser-extension-title">HivemindOS Browser</h2>
            {status?.prepared
              ? <NiBadge good label={`Ready${status.installedVersion ? ` · v${status.installedVersion}` : ""}`} />
              : <NiBadge warn label="Optional extension" />}
          </div>
          <p>Bring the current page into your hive, chat with any agent, and run approved browser actions from a side panel.</p>
        </div>
      </div>

      {!status && !error ? (
        <div className="ni-browser-loading" role="status" aria-label="Checking browser extension availability">
          <span className="ni-tspin" aria-hidden="true" />
          <span>Checking compatible browsers…</span>
        </div>
      ) : (
        <>
          <ol className="ni-browser-steps">
            <li><span>1</span><p>Choose a compatible Chromium browser.</p></li>
            <li><span>2</span><p>Prepare the extension and open its Extensions page.</p></li>
            <li><span>3</span><p>Turn on <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, and select the revealed folder.</p></li>
          </ol>

          <div className="ni-browser-controls">
            <label>
              <span>Browser</span>
              <select
                value={selectedBrowserId}
                onChange={(event) => setSelectedBrowserId(event.target.value)}
                disabled={busy !== "" || !status?.browsers.length}
              >
                {status?.browsers.length
                  ? status.browsers.map((browser) => <option key={browser.id} value={browser.id}>{browser.label}</option>)
                  : <option value="">No supported browser detected</option>}
              </select>
            </label>
            <BBtn variant="primary" disabled={busy !== "" || status?.available === false} onClick={install}>
              {busy === "prepare" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="plug" size={15} />}
              {status?.prepared ? "Prepare again & open" : "Prepare & open browser"}
            </BBtn>
          </div>

          {status?.prepared ? (
            <div className="ni-browser-ready">
              <code>{status.installPath}</code>
              <div className="ni-browser-actions">
                <BBtn sm disabled={busy !== ""} onClick={reveal}>
                  {busy === "reveal" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="folder" size={14} />}
                  Show folder
                </BBtn>
                <BBtn sm disabled={busy !== "" || !selectedBrowser} onClick={openBrowser}>
                  {busy === "open" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="browser" size={14} />}
                  Open Extensions
                </BBtn>
                <BBtn sm disabled={busy !== ""} onClick={copyPath}>
                  {busy === "copy" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="copy" size={14} />}
                  Copy path
                </BBtn>
              </div>
            </div>
          ) : null}
        </>
      )}

      {message ? <p className="ni-note good" role="status">{message}</p> : null}
      {error ? <p className="ni-note" role="alert">{error}</p> : null}
      <p className="ni-browser-footnote">Browsers require the final Load unpacked confirmation; extensions cannot silently install themselves.</p>
    </section>
  );
}
