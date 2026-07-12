"use client";

import * as React from "react";

import { openExternalUrl } from "@/lib/native/open-external-url";
import { BBtn, BIcon, Badge, ServiceGlyph } from "./integrations-primitives";
import { readJson } from "./integrations-view-helpers";

type RobinhoodAccount = { id: string; label: string; agentic: boolean };
type RobinhoodStatus = {
  ok?: boolean;
  connected: boolean;
  authorizationPending: boolean;
  authorizationUrl?: string;
  selectedAccountId?: string;
  accounts: RobinhoodAccount[];
  tools: Array<{ name: string; description?: string }>;
  missingTools: string[];
  error?: string;
};

const POLL_MS = 1500;
const POLL_WINDOW_MS = 5 * 60 * 1000;

export function RobinhoodMcpPanel() {
  const [status, setStatus] = React.useState<RobinhoodStatus | null>(null);
  const [busy, setBusy] = React.useState<"load" | "connect" | "disconnect" | "account" | "">("load");
  const [message, setMessage] = React.useState("");
  const [pollUntil, setPollUntil] = React.useState(0);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/robinhood-mcp", { cache: "no-store" });
      const data = await readJson<RobinhoodStatus>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not read Robinhood MCP status.");
      setStatus(data);
      if (data.connected) setPollUntil(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read Robinhood MCP status.");
    } finally {
      setBusy((current) => current === "load" ? "" : current);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  React.useEffect(() => {
    if (!pollUntil || Date.now() >= pollUntil || status?.connected) return undefined;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, pollUntil, status?.connected]);

  async function connect() {
    setBusy("connect");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/robinhood-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      const data = await readJson<RobinhoodStatus>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not start Robinhood authorization.");
      setStatus(data);
      if (data.authorizationUrl) {
        await openExternalUrl(data.authorizationUrl);
        setMessage("Robinhood sign-in opened in your browser. Finish there; this panel will reconnect automatically.");
        setPollUntil(Date.now() + POLL_WINDOW_MS);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start Robinhood authorization.");
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/robinhood-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const data = await readJson<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not disconnect Robinhood.");
      setStatus({ connected: false, authorizationPending: false, accounts: [], tools: [], missingTools: [] });
      setMessage("Removed the local Robinhood OAuth session. You can also revoke access from Robinhood account settings.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect Robinhood.");
    } finally {
      setBusy("");
    }
  }

  async function selectAccount(accountId: string) {
    setBusy("account");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/robinhood-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select-account", accountId }),
      });
      const data = await readJson<RobinhoodStatus>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not select the Agentic account.");
      setStatus(data);
      setMessage("Robinhood Agentic account selected for governed trades.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not select the Agentic account.");
    } finally {
      setBusy("");
    }
  }

  const connected = status?.connected === true;
  const selected = status?.selectedAccountId || "";
  return (
    <div className="fm-row" style={{ marginBottom: 16 }}>
      <div className="fm-rowhead">
        <ServiceGlyph accent="#62c78f" mono="Rh" size={40} radius={10} />
        <div className="grow">
          <div className="fm-rname">Robinhood Trading MCP <Badge tone="live">Official</Badge></div>
          <div className="fm-rsub">
            {connected ? `${status?.tools.length ?? 0} tools · OAuth connected` : "Dedicated Agentic brokerage account · OAuth"}
          </div>
        </div>
        {busy ? <span className="ni-tspin" role="status" aria-label="Updating Robinhood connection" /> : null}
        {connected
          ? <BBtn sm disabled={Boolean(busy)} onClick={() => void disconnect()}><BIcon name="trash" size={13} /> Disconnect</BBtn>
          : <BBtn variant="primary" sm disabled={Boolean(busy)} onClick={() => void connect()}><BIcon name="plug" size={13} /> Connect Robinhood</BBtn>}
      </div>

      <div className="fm-note" style={{ marginTop: 10 }}>
        <BIcon name="shield" size={15} />
        <span>Account and market reads are available to the hive. Equity orders use Robinhood&apos;s review tool, then HivemindOS caps and explicit confirmation before placement. Raw place/cancel tools are not exposed.</span>
      </div>

      {connected && status?.accounts.length ? (
        <label className="fb-label" style={{ marginTop: 12 }}>Agentic trading account
          <select
            className="fb-field"
            value={selected}
            disabled={busy === "account"}
            onChange={(event) => void selectAccount(event.target.value)}
          >
            <option value="" disabled>Choose the dedicated Agentic account</option>
            {status.accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.label}{account.agentic ? " · Agentic" : ""} · ••••{account.id.slice(-4)}</option>
            ))}
          </select>
        </label>
      ) : null}

      {connected && status?.missingTools.length ? (
        <p className="ni-note">Robinhood did not expose expected tools: {status.missingTools.join(", ")}. Account onboarding or permissions may still be incomplete.</p>
      ) : null}
      {status?.error ? <p className="ni-note">{status.error}</p> : null}
      {message ? <p className="ni-note">{message}</p> : null}
    </div>
  );
}
