"use client";

import * as React from "react";
import { subscribeResearchSyncCode } from "@/lib/services/research-sync-code";
import { BBtn, BIcon, NiBadge, ServiceGlyph } from "./integrations-primitives";

// Hive Research brain bridge card (Integrations → Connections).
// Two directions, one card:
//  - Web → app: paste the one-time sync code from hivemindos.app/research and
//    the app pull-syncs learned lenses + verdicts into the shared brain.
//  - App → web: copy the local bridge token into the research page so the
//    hosted crew can use read-only shared-brain recall while you research.

type SyncStatus = {
  connected: boolean;
  walletAddress?: string | null;
  connectedAt?: string;
  lastSyncAt?: string;
  lastError?: string;
  importedFrameworks?: number;
  importedAnalyses?: number;
};

type StatusPayload = { ok?: boolean; error?: string; sync?: SyncStatus };
type BusyAction = "connect" | "sync" | "disconnect" | "token" | "rotate" | "";

async function responseJson<T extends { ok?: boolean; error?: string }>(response: Response) {
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok || !data?.ok) throw new Error(data?.error || "HivemindOS could not complete that action.");
  return data;
}

async function syncAction(action: "connect" | "sync" | "disconnect", code?: string) {
  return responseJson<StatusPayload>(await fetch("/api/research-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(code ? { action, code } : { action }),
  }));
}

function shortWallet(address: string | null | undefined) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function HiveResearchSyncCard() {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState<BusyAction>("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [bridgeToken, setBridgeToken] = React.useState("");

  React.useEffect(() => {
    let active = true;
    fetch("/api/research-sync", { cache: "no-store" })
      .then((response) => responseJson<StatusPayload>(response))
      .then((payload) => {
        if (active) setStatus(payload.sync ?? { connected: false });
      })
      .catch((cause: unknown) => {
        if (active) {
          setStatus({ connected: false });
          setError(cause instanceof Error ? cause.message : "Could not check the research sync.");
        }
      });
    return () => { active = false; };
  }, []);

  // Deep link (hivemindos://research/sync?code=hrsc_...): the dashboard parks
  // the one-time code and this card claims it exactly once — the code is
  // single-use, so a claimed code is never re-submitted and the manual paste
  // input stays as the fallback. Only stable setters + module functions are
  // referenced, so the empty dependency list is sound.
  React.useEffect(() => subscribeResearchSyncCode((deepLinkedCode) => {
    setBusy("connect");
    setMessage("");
    setError("");
    void syncAction("connect", deepLinkedCode)
      .then((payload) => {
        setStatus(payload.sync ?? { connected: true });
        setCode("");
        setMessage("Connected from hivemindos.app/research — no need to paste the code. Your research lenses and verdicts now sync into the shared brain.");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The sync code from hivemindos.app/research could not be redeemed.");
      })
      .finally(() => setBusy(""));
  }), []);

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

  function connect() {
    if (!code.trim()) return;
    void run("connect", async () => {
      const payload = await syncAction("connect", code.trim());
      setStatus(payload.sync ?? { connected: true });
      setCode("");
      setMessage("Connected. Your research lenses and verdicts now sync into the shared brain.");
    });
  }

  function syncNow() {
    void run("sync", async () => {
      const payload = await syncAction("sync");
      setStatus(payload.sync ?? status);
      setMessage(payload.sync?.lastError ? "" : "Synced.");
    });
  }

  function disconnect() {
    void run("disconnect", async () => {
      const payload = await syncAction("disconnect");
      setStatus(payload.sync ?? { connected: false });
      setMessage("Disconnected. The gateway sync token was revoked.");
    });
  }

  function copyBridgeToken() {
    void run("token", async () => {
      const payload = await responseJson<{ ok?: boolean; error?: string; token?: string }>(
        await fetch("/api/research-bridge/token", { cache: "no-store" }),
      );
      const token = payload.token ?? "";
      setBridgeToken(token);
      await navigator.clipboard.writeText(token);
      setMessage("Bridge token copied. Paste it in the Local Brain panel on hivemindos.app/research.");
    });
  }

  function rotateBridgeToken() {
    void run("rotate", async () => {
      const payload = await responseJson<{ ok?: boolean; error?: string; token?: string }>(
        await fetch("/api/research-bridge/token", { method: "POST" }),
      );
      setBridgeToken(payload.token ?? "");
      setMessage("Bridge token rotated. Previously paired pages must paste the new one.");
    });
  }

  return (
    <section className="ni-browser-card" aria-labelledby="hive-research-sync-title">
      <div className="ni-browser-head">
        <ServiceGlyph accent="var(--honey)" mono="Hr" size={52} radius={15} />
        <div className="ni-browser-copy">
          <div className="ni-browser-title-row">
            <h2 id="hive-research-sync-title">Hive Research</h2>
            {status?.connected
              ? <NiBadge good label={`Synced${status.walletAddress ? ` · ${shortWallet(status.walletAddress)}` : ""}`} />
              : <NiBadge warn label="Not linked" />}
          </div>
          <p>Link hivemindos.app/research: research lenses and verdicts flow into your shared brain, and the hosted crew can use read-only brain recall while you research.</p>
        </div>
      </div>

      {!status ? (
        <div className="ni-browser-loading" role="status" aria-label="Checking Hive Research sync">
          <span className="ni-tspin" aria-hidden="true" />
          <span>Checking Hive Research sync…</span>
        </div>
      ) : status.connected ? (
        <>
          <div className="ni-browser-ready">
            <code>
              {`${status.importedFrameworks ?? 0} lens${(status.importedFrameworks ?? 0) === 1 ? "" : "es"} · ${status.importedAnalyses ?? 0} verdict${(status.importedAnalyses ?? 0) === 1 ? "" : "s"} in the shared brain${status.lastSyncAt ? ` · last sync ${new Date(status.lastSyncAt).toLocaleString()}` : ""}`}
            </code>
            <div className="ni-browser-actions">
              <BBtn sm disabled={busy !== ""} onClick={syncNow}>
                {busy === "sync" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="refresh" size={14} />}
                Sync now
              </BBtn>
              <BBtn sm disabled={busy !== ""} onClick={copyBridgeToken}>
                {busy === "token" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="plug" size={14} />}
                Copy bridge token
              </BBtn>
              <BBtn sm disabled={busy !== ""} onClick={rotateBridgeToken}>
                {busy === "rotate" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="refresh" size={14} />}
                Rotate token
              </BBtn>
              <BBtn sm disabled={busy !== ""} onClick={disconnect}>
                {busy === "disconnect" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="trash" size={14} />}
                Disconnect
              </BBtn>
            </div>
          </div>
          {status.lastError ? <p className="ni-note" role="alert">{status.lastError}</p> : null}
          {bridgeToken ? <p className="ni-note">Bridge token ready: <code>{bridgeToken}</code></p> : null}
        </>
      ) : (
        <>
          <div className="ni-browser-controls">
            <label>
              <span>Sync code</span>
              <input
                type="text"
                value={code}
                placeholder="hrsc_… (from hivemindos.app/research → Sync to app)"
                onChange={(event) => setCode(event.target.value)}
                disabled={busy !== ""}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <BBtn variant="primary" disabled={busy !== "" || !code.trim()} onClick={connect}>
              {busy === "connect" ? <span className="ni-spin" aria-hidden="true" /> : <BIcon name="plug" size={15} />}
              Connect
            </BBtn>
          </div>
          {/* Recall-only pairing works without the memory sync above. */}
          <div className="ni-browser-actions">
            <BBtn sm disabled={busy !== ""} onClick={copyBridgeToken}>
              {busy === "token" ? <span className="ni-tspin" aria-hidden="true" /> : <BIcon name="key" size={14} />}
              Copy bridge token for the research page
            </BBtn>
          </div>
        </>
      )}

      {message ? <p className="ni-note good">{message}</p> : null}
      {error ? <p className="ni-note" role="alert">{error}</p> : null}
    </section>
  );
}
