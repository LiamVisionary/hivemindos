"use client";

import * as React from "react";

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import { openExternalUrl } from "@/lib/native/open-external-url";
import type { XCommandIntent, XCommandTradeDraft } from "@/lib/types/x-command";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { getSurvivalSnapshot } from "@/lib/utils/agent-wallet";
import {
  WalletSelectModal,
  type PickableWallet,
} from "@/features/dashboard/views/trade/WalletSelectModal";
import {
  agentPickable,
  groupedUserPickables,
  resolvePickableAccount,
  type PickableAgent,
} from "@/features/dashboard/views/trade/wallet-pickables";
import { managedXReturnUrl } from "@/lib/services/managed-x-oauth-return";
import { BBtn, BIcon, NiBadge, ServiceGlyph } from "./integrations-primitives";
import { managedXStatusUrl } from "./integrations-view-helpers";
import type { ManagedXPanelStatus } from "./XAccountMcpPanel";

type Connection = { id: string; xUserId?: string; username?: string; scopes?: string; commandEnabled?: boolean; optedOut?: boolean; updatedAt?: string };
type Device = { id: string; name: string; enabled: boolean; createdAt: string; lastSeenAt?: string | null };
type Job = {
  id: string;
  kind: string;
  status: string;
  command?: string;
  resultText?: string | null;
  error?: string | null;
  transcriptUrl?: string | null;
  createdAt: string;
  replyStatus?: string;
  intent?: XCommandIntent | null;
  tradeDraft?: XCommandTradeDraft | null;
};
type Policy = {
  enabled: boolean;
  connectionId: string;
  username?: string;
  queenMode: "local" | "disabled";
  replyMode: "dashboard" | "auto-ai";
  maxPaidCommandUsd: number;
};
type WalletPolicy = {
  revision: string;
  enabled: boolean;
  walletId: string;
  walletName: string;
  address: string;
  network: string;
  accounts: Array<{ walletId: string; address: string; network: string }>;
  maxTradeUsd: number;
  dailyTradeLimitUsd: number;
  slippageBps: number;
  authorizedAt: string;
  updatedAt: string;
};
type TradeReceipt = {
  id: string;
  jobId: string;
  status: "started" | "complete" | "failed" | "uncertain";
  amountUsd: number;
  resultText?: string;
  error?: string;
  reference?: string;
  updatedAt: string;
};
type Payload = {
  ok: boolean;
  health?: { enabled?: boolean; configured?: boolean; missing?: string[]; bot?: { username?: string | null }; replies?: { enabled?: boolean; aiReplyApproved?: boolean } };
  creditAccounts?: Array<{ accountId: string; slug: string; updatedAt: string }>;
  selectedCreditAccountId?: string;
  creditsConfigured?: boolean;
  gatewayStatus?: number;
  gateway?: {
    error?: string;
    connections?: Connection[];
    devices?: Device[];
    jobs?: Job[];
    policy?: Policy | null;
    account?: { balanceUsd?: number };
  };
  local?: {
    paired?: boolean;
    device?: { id: string; name: string; pairedAt: string } | null;
    driver?: { running?: boolean; busy?: boolean; lastCompletedAt?: string | null; error?: string };
    walletPolicy?: WalletPolicy | null;
    tradeReceipts?: TradeReceipt[];
  };
  error?: string;
};

export function XCommandBotPanel({ onOpenXSetup, onReviewTradeDraft, displayAgents = [], walletsByAgent, vaultPath }: {
  onOpenXSetup?: () => void;
  onReviewTradeDraft?: (draft: XCommandTradeDraft) => void;
  displayAgents?: PickableAgent[];
  walletsByAgent?: Record<string, unknown>;
  vaultPath?: string;
}) {
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [selectedAccount, setSelectedAccount] = React.useState("");
  const [enabled, setEnabled] = React.useState(false);
  const [maxSpend, setMaxSpend] = React.useState("2.50");
  const [managedStatus, setManagedStatus] = React.useState<ManagedXPanelStatus | null>(null);
  const [oauthPolling, setOauthPolling] = React.useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = React.useState(false);
  const [walletsLoading, setWalletsLoading] = React.useState(false);
  const [walletPickables, setWalletPickables] = React.useState<PickableWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = React.useState("");
  const [walletPolicyEnabled, setWalletPolicyEnabled] = React.useState(false);
  const [maxTradeUsd, setMaxTradeUsd] = React.useState("5");
  const [dailyTradeLimitUsd, setDailyTradeLimitUsd] = React.useState("25");
  const [slippagePercent, setSlippagePercent] = React.useState("1");
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");

  const refreshManaged = React.useCallback(async (accountId: string, slug: string) => {
    if (!accountId) {
      setManagedStatus(null);
      return null;
    }
    const response = await fetch(managedXStatusUrl(accountId, slug), { cache: "no-store" });
    const data = await response.json().catch(() => null) as (ManagedXPanelStatus & { ok?: boolean; error?: string }) | null;
    if (!response.ok || data?.ok === false || !data) throw new Error(data?.error || "Could not load managed X credits.");
    setManagedStatus(data);
    return data;
  }, []);

  const load = React.useCallback(async (accountId = selectedAccount) => {
    setBusy((current) => current || "load");
    setMessage("");
    try {
      const query = accountId ? `?creditAccountId=${encodeURIComponent(accountId)}` : "";
      const response = await fetch(`/api/integrations/x-command${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not load the X bot connection.");
      setPayload(data);
      const nextAccount = data.selectedCreditAccountId || "";
      const policy = data.gateway?.policy ?? null;
      setSelectedAccount(nextAccount);
      setEnabled(policy?.enabled === true);
      setMaxSpend(String(policy?.maxPaidCommandUsd ?? 2.5));
      const walletPolicy = data.local?.walletPolicy ?? null;
      setSelectedWalletId(walletPolicy?.walletId || "");
      setWalletPolicyEnabled(walletPolicy?.enabled === true);
      setMaxTradeUsd(String(walletPolicy?.maxTradeUsd ?? 5));
      setDailyTradeLimitUsd(String(walletPolicy?.dailyTradeLimitUsd ?? 25));
      setSlippagePercent(String((walletPolicy?.slippageBps ?? 100) / 100));
      const selectedSummary = data.creditAccounts?.find((account) => account.accountId === nextAccount) ?? data.creditAccounts?.[0];
      await refreshManaged(nextAccount, selectedSummary?.slug || "default").catch(() => null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the X bot connection.");
    } finally {
      setBusy("");
    }
  }, [refreshManaged, selectedAccount]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(""), 0);
    return () => window.clearTimeout(timer);
    // Initial read intentionally ignores the current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!oauthPolling) return undefined;
    const account = payload?.creditAccounts?.find((item) => item.accountId === selectedAccount) ?? payload?.creditAccounts?.[0];
    if (!selectedAccount || !account) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > 5 * 60_000) {
        window.clearInterval(timer);
        setOauthPolling(false);
        setMessage("X sign-in is still pending. Finish in the browser, then press Refresh.");
        return;
      }
      void refreshManaged(selectedAccount, account.slug).then((status) => {
        if ((status?.connections?.length ?? 0) > 0) {
          window.clearInterval(timer);
          setOauthPolling(false);
          setMessage("Managed X account connected.");
          void load(selectedAccount);
        }
      }).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [load, oauthPolling, payload?.creditAccounts, refreshManaged, selectedAccount]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/x-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creditAccountId: selectedAccount, ...body }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `X bot update failed (${response.status}).`);
      await load(selectedAccount);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "X bot update failed.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function savePolicy() {
    const cap = Number(maxSpend);
    if (!Number.isFinite(cap) || cap < 0 || cap > 25) {
      setMessage("The per-command cap must be between $0 and $25.");
      return;
    }
    const saved = await post({
      action: "configure",
      enabled,
      queenMode: "local",
      replyMode: "dashboard",
      maxPaidCommandUsd: cap,
    }, "save");
    if (saved) setMessage(enabled
      ? `X commands enabled for all ${payload?.gateway?.connections?.length ?? 0} connected identities.`
      : "X commands are disabled for every connected identity.");
  }

  async function startManagedOAuth() {
    const account = payload?.creditAccounts?.find((item) => item.accountId === selectedAccount) ?? payload?.creditAccounts?.[0];
    if (!selectedAccount || !account) {
      setMessage("Fund HivemindOS hosted credits before connecting X.");
      return;
    }
    setBusy("managed-oauth");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/x-managed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "oauth-start",
          creditAccountId: selectedAccount,
          slug: account.slug,
          returnUrl: managedXReturnUrl(selectedAccount, account.slug, "integrations", "xbot"),
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; authorizationUrl?: string; error?: string } | null;
      if (!response.ok || data?.ok === false || !data?.authorizationUrl) {
        throw new Error(data?.error || "Managed X sign-in did not return an authorization URL.");
      }
      await openExternalUrl(data.authorizationUrl);
      setOauthPolling(true);
      setMessage(isTauriDesktopRuntime()
        ? "Opened X sign-in in your browser. Finish there; this X Bot page will refresh automatically."
        : "Opened X sign-in. Finish there and you will return to this X Bot page.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start managed X sign-in.");
    } finally {
      setBusy("");
    }
  }

  async function openWalletPicker() {
    setWalletsLoading(true);
    setWalletPickerOpen(true);
    setMessage("");
    try {
      const records = await fetchPersonalWalletRecords(vaultPath);
      const supported = (wallet: AgentWalletConfig) => Boolean(wallet.walletAddress?.trim())
        && wallet.custodyMode === "local"
        && ["eip155:8453", "eip155:4663", "solana:mainnet"].includes(wallet.network);
      const users = groupedUserPickables(records, { accountFilter: supported });
      const agents = displayAgents
        .map((agent) => agentPickable(agent, walletsByAgent))
        .filter((pickable) => supported(pickable.wallet));
      setWalletPickables([...users, ...agents]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load local signing wallets.");
    } finally {
      setWalletsLoading(false);
    }
  }

  async function saveWalletPolicy() {
    const maxTrade = Number(maxTradeUsd);
    const dailyLimit = Number(dailyTradeLimitUsd);
    const slippageBps = Math.round(Number(slippagePercent) * 100);
    if (!selectedWalletId) {
      setMessage("Choose the HivemindOSBot wallet first.");
      return;
    }
    if (!(maxTrade > 0 && maxTrade <= 10)) {
      setMessage("The automatic per-trade limit must be between $0.01 and $10.00.");
      return;
    }
    if (!(dailyLimit >= maxTrade)) {
      setMessage("The rolling daily limit must be at least the per-trade limit.");
      return;
    }
    if (!(slippageBps >= 10 && slippageBps <= 2_000)) {
      setMessage("Maximum slippage must be between 0.10% and 20.00%.");
      return;
    }
    const container = walletPickables.find((pickable) => pickable.id === selectedWalletId
      || pickable.accounts?.some((account) => account.id === selectedWalletId));
    const resolved = resolvePickableAccount(walletPickables, selectedWalletId);
    const walletIds = container?.accounts?.map((account) => account.id)
      ?? local?.walletPolicy?.accounts?.map((account) => account.walletId)
      ?? (resolved ? [resolved.id] : [selectedWalletId]);
    const saved = await post({
      action: "save-wallet-policy",
      walletId: container?.id || selectedWalletId,
      walletIds,
      walletName: container?.name || resolved?.name || "HivemindOSBot wallet",
      walletPolicyEnabled,
      maxTradeUsd: maxTrade,
      dailyTradeLimitUsd: dailyLimit,
      slippageBps,
    }, "wallet-policy");
    if (saved) setMessage(walletPolicyEnabled
      ? "HivemindOSBot wallet authorized. Eligible X trades now execute without a per-order approval prompt."
      : "HivemindOSBot automatic trades are off.");
  }

  const health = payload?.health;
  const gateway = payload?.gateway;
  const connections = gateway?.connections ?? [];
  const devices = gateway?.devices ?? [];
  const jobs = gateway?.jobs ?? [];
  const accounts = payload?.creditAccounts ?? [];
  const local = payload?.local;
  const selectedManagedAccount = managedStatus?.creditAccounts?.find((account) => account.accountId === selectedAccount)
    ?? managedStatus?.creditAccounts?.[0];
  const hostedBalanceLabel = managedStatus?.credits?.balanceLabel
    || selectedManagedAccount?.balanceLabel
    || (typeof gateway?.account?.balanceUsd === "number" ? `$${gateway.account.balanceUsd.toFixed(2)}` : "Not available");
  const selectedWalletLabel = local?.walletPolicy?.walletName || "No wallet selected";
  const botName = health?.bot?.username ? `@${health.bot.username.replace(/^@/, "")}` : "the HivemindOS bot";
  const working = Boolean(busy);

  return (
    <div className="ni-stage ni-pad" style={{ display: "grid", gap: 18 }}>
      <div className="ni-atool">
        <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
          <ServiceGlyph accent="var(--honey)" mono="XQ" size={44} radius={12} />
          <div style={{ minWidth: 0 }}>
            <h2>X command bot</h2>
            <p>Reply to a post for analysis, execute a bounded token or stock-token order, run a Mini app, or ask your paired Queen naturally.</p>
          </div>
        </div>
        <div className="ni-abtns">
          <NiBadge good={health?.enabled === true && gateway?.policy?.enabled === true} warn={health?.configured === true} label={
            health?.enabled !== true ? "awaiting bot account" : gateway?.policy?.enabled ? "enabled" : "ready to enable"
          } />
          <BBtn sm onClick={() => void load(selectedAccount)} disabled={working}><BIcon name="refresh" size={13} /> Refresh</BBtn>
        </div>
      </div>

      {health?.enabled !== true ? (
        <div className="fm-note" style={{ alignItems: "flex-start" }}>
          <BIcon name="alert" size={15} />
          <span>
            The application, queue, and policy rails are installed. The hosted listener remains off until the new X account's numeric ID and developer credentials are added, so it cannot accidentally answer from another account.
          </span>
        </div>
      ) : null}

      {accounts.length > 1 ? (
        <label className="fb-label">Hosted credit account
          <select className="fb-field fb-mono" value={selectedAccount} onChange={(event) => void load(event.target.value)} disabled={working}>
            {accounts.map((account) => <option key={`${account.accountId}:${account.slug}`} value={account.accountId}>{account.accountId} · {account.slug}</option>)}
          </select>
        </label>
      ) : null}

      {!payload?.creditsConfigured ? (
        <div className="ni-empty">
          <strong>Hosted credits are required.</strong>
          <span>The X bot uses the same HivemindOS credit balance as Mini apps and enforces your per-command cap before starting paid work.</span>
        </div>
      ) : null}

      <section className="x-method-panel" aria-label="Hosted X credits">
        <div className="ni-connhead">
          <strong>Hosted credit balance</strong>
          <NiBadge good={payload?.creditsConfigured === true} warn={payload?.creditsConfigured !== true} label={hostedBalanceLabel} />
        </div>
        <div className="x-method-detail">
          <div className="ni-connrow x-info-row">
            <ServiceGlyph accent="var(--honey)" mono="Cr" size={30} radius={9} />
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div className="cname">{hostedBalanceLabel}</div>
              <div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>Mini apps, transcripts, and managed X API usage debit this hosted balance.</div>
            </div>
            <span className="ckey">credits</span>
          </div>
        </div>
      </section>

      {connections.length ? (
        <section className="x-method-panel" aria-label="X bot account policy">
          <div className="ni-connhead">
            <strong>1. Connect the X identities allowed to command your hive</strong>
            <NiBadge good={gateway?.policy?.enabled === true} warn={!gateway?.policy?.enabled} label={gateway?.policy?.enabled ? "commands on" : "commands off"} />
          </div>
          <div className="x-method-detail">
            <div className="x-connection-list" aria-label="Connected X identities">
              {connections.map((connection) => (
                <div className="ni-connrow" key={connection.id}>
                  <ServiceGlyph accent={connection.commandEnabled ? "var(--live)" : "var(--honey)"} mono="X" size={30} radius={9} />
                  <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <div className="cname">{connection.username ? `@${connection.username}` : connection.xUserId || connection.id}</div>
                    <div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>Uses this hosted balance and the shared command limit.</div>
                  </div>
                  <span className="ckey">{connection.optedOut ? "stopped on X" : connection.commandEnabled ? "bot enabled" : "connected"}</span>
                </div>
              ))}
            </div>
            <label className="fb-label">Maximum automatic paid command
              <div className="fm-keyrow">
                <span style={{ color: "var(--fg-3)" }}>$</span>
                <input className="fb-field fb-mono" type="number" min="0" max="25" step="0.01" value={maxSpend} onChange={(event) => setMaxSpend(event.target.value)} disabled={working} />
              </div>
              <span className="ni-note" style={{ margin: 0 }}>A paid Mini run is rejected before reservation when its server-calculated price exceeds this cap. Set $0 to disable paid commands.</span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "var(--fg-2)", fontSize: 13 }}>
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              <span><strong>Enable X commands for every connected identity.</strong><br />Each numeric X user ID remains a durable boundary. <code>stop</code> disables only the identity that sends it; the others keep working.</span>
            </label>
            <div className="x-actions">
              <BBtn variant="primary" onClick={() => void savePolicy()} disabled={working || !connections.length}>
                {busy === "save" ? <><span className="ni-spin" /> Saving…</> : <><BIcon name="shield" size={14} /> Save command policy</>}
              </BBtn>
            </div>
          </div>
        </section>
      ) : (
        <div className="ni-empty">
          <strong>Connect an X account first.</strong>
          <span>The bot reuses the managed X OAuth connection already tied to your hosted credit account; it does not create another copy of your X token.</span>
          <BBtn variant="primary" disabled={working || !payload?.creditsConfigured} onClick={() => void startManagedOAuth()}>
            {busy === "managed-oauth" || oauthPolling ? <><span className="ni-spin" /> Connecting X…</> : <><BIcon name="plug" size={14} /> Connect managed X account</>}
          </BBtn>
          {onOpenXSetup ? <BBtn sm onClick={onOpenXSetup}>Advanced X setup</BBtn> : null}
        </div>
      )}

      <section className="x-method-panel" aria-label="HivemindOSBot wallet authorization">
        <div className="ni-connhead">
          <strong>2. Choose the HivemindOSBot wallet</strong>
          <NiBadge
            good={local?.walletPolicy?.enabled === true}
            warn={Boolean(local?.walletPolicy)}
            label={local?.walletPolicy?.enabled ? "automatic trades on" : local?.walletPolicy ? "trades off" : "not authorized"}
          />
        </div>
        <div className="x-method-detail">
          <p className="x-muted">Authorize this once. HivemindOS automatically uses the compatible account and network inside the selected wallet, then executes eligible X orders under these limits with no per-order approval prompt. Wallet keys stay on this device.</p>
          <div className="ni-connrow x-info-row">
            <ServiceGlyph accent={local?.walletPolicy?.enabled ? "var(--live)" : "var(--honey)"} mono="W" size={30} radius={9} />
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div className="cname">{selectedWalletLabel}</div>
              <div style={{ color: "var(--fg-4)", fontSize: 11.5, overflowWrap: "anywhere" }}>
                {local?.walletPolicy?.accounts?.length
                  ? local.walletPolicy.accounts.map((account) => account.network).join(" · ")
                  : "Choose one local multi-chain or single-chain signing wallet."}
              </div>
            </div>
            <BBtn sm onClick={() => void openWalletPicker()} disabled={working}>Choose wallet</BBtn>
          </div>
          <div className="fb-grid2">
            <label className="fb-label">Maximum per trade
              <div className="fm-keyrow"><span style={{ color: "var(--fg-3)" }}>$</span><input className="fb-field fb-mono" type="number" min="0.01" max="10" step="0.01" value={maxTradeUsd} onChange={(event) => setMaxTradeUsd(event.target.value)} disabled={working} /></div>
            </label>
            <label className="fb-label">Rolling 24-hour limit
              <div className="fm-keyrow"><span style={{ color: "var(--fg-3)" }}>$</span><input className="fb-field fb-mono" type="number" min="0.01" step="0.01" value={dailyTradeLimitUsd} onChange={(event) => setDailyTradeLimitUsd(event.target.value)} disabled={working} /></div>
            </label>
          </div>
          <label className="fb-label">Maximum slippage
            <div className="fm-keyrow"><input className="fb-field fb-mono" type="number" min="0.1" max="20" step="0.1" value={slippagePercent} onChange={(event) => setSlippagePercent(event.target.value)} disabled={working} /><span style={{ color: "var(--fg-3)" }}>%</span></div>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "var(--fg-2)", fontSize: 13 }}>
            <input type="checkbox" checked={walletPolicyEnabled} onChange={(event) => setWalletPolicyEnabled(event.target.checked)} />
            <span><strong>Allow bounded automatic trades requested from my connected X accounts.</strong><br />Unknown assets, incompatible networks, missing liquidity, changed keys, duplicate jobs, and limit violations fail closed.</span>
          </label>
          <div className="x-actions">
            <BBtn variant="primary" onClick={() => void saveWalletPolicy()} disabled={working || !selectedWalletId}>
              {busy === "wallet-policy" ? <><span className="ni-spin" /> Authorizing…</> : <><BIcon name="shield" size={14} /> Save wallet authorization</>}
            </BBtn>
          </div>
        </div>
      </section>

      <section className="x-method-panel" aria-label="Local Queen pairing">
        <div className="ni-connhead">
          <strong>3. Pair this HivemindOS app</strong>
          <NiBadge good={local?.paired === true && local?.driver?.running === true} warn={local?.paired === true} label={local?.paired ? local.driver?.running ? "online" : "paired" : "not paired"} />
        </div>
        <p className="x-muted">Post and token analysis reaches this Queen as a typed, read-only job with tool calling off. Trade jobs use only the HivemindOSBot wallet authorization above and are signed locally; the hosted X service never receives a wallet key.</p>
        <div className="x-actions">
          {!local?.paired ? (
            <BBtn variant="primary" disabled={working || !payload?.creditsConfigured} onClick={() => void post({ action: "pair-device", name: "HivemindOS Queen" }, "pair") }>
              {busy === "pair" ? <><span className="ni-spin" /> Pairing…</> : <><BIcon name="network" size={14} /> Pair this Queen</>}
            </BBtn>
          ) : (
            <>
              <BBtn disabled={working} onClick={() => void post({ action: "start-driver" }, "driver")}><BIcon name="refresh" size={13} /> Resume bridge</BBtn>
              <BBtn disabled={working || !local.device?.id} onClick={() => void post({ action: "revoke-device", deviceId: local.device?.id }, "revoke")}><BIcon name="trash" size={13} /> Revoke this device</BBtn>
            </>
          )}
          <BBtn onClick={() => void openExternalUrl("https://hivemindos.app/x-bot/")}><BIcon name="plug" size={13} /> Open web setup</BBtn>
        </div>
        {local?.driver?.error ? <p className="ni-note">{local.driver.error}</p> : null}
        {devices.length ? (
          <div className="x-connection-list">
            {devices.map((device) => (
              <div className="ni-connrow" key={device.id}>
                <ServiceGlyph accent={device.enabled ? "var(--live)" : "var(--fg-3)"} mono="Q" size={30} radius={9} />
                <div style={{ minWidth: 0, flex: "1 1 auto" }}><div className="cname">{device.name}</div><div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>Last seen {device.lastSeenAt || "never"}</div></div>
                <span className="ckey">{device.enabled ? "active" : "revoked"}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="x-method-panel" aria-label="X bot commands">
        <div className="ni-connhead"><strong>Commands</strong><NiBadge good label="allowlisted" /></div>
        <div className="x-method-detail">
          <code>Reply: {botName} what do you think about this post?</code>
          <code>Reply: {botName} what do you think of this token?</code>
          <code>{botName} buy $5 of ETH</code>
          <code>{botName} buy $5 of AAPL stock</code>
          <code>{botName} buy $5 of 0x…contract</code>
          <code>Reply: {botName} transcript</code>
          <p className="x-muted"><code>stop</code> remains the safety opt-out. Analysis stays private. Buy and sell commands execute only when they fit the selected HivemindOSBot wallet, compatible network, liquidity checks, and the authorization limits above.</p>
        </div>
      </section>

      <section className="x-method-panel" aria-label="Recent X bot jobs">
        <div className="ni-connhead"><strong>Recent commands</strong><NiBadge good={jobs.some((job) => job.status === "complete")} label={`${jobs.length} shown`} /></div>
        {jobs.length ? (
          <div className="x-connection-list">
            {jobs.map((job) => (
              <div className="ni-connrow" key={job.id} style={{ alignItems: "flex-start" }}>
                <ServiceGlyph accent={job.status === "complete" ? "var(--live)" : job.status === "failed" ? "var(--danger)" : "var(--honey)"} mono={job.kind.includes("analysis") ? "Q" : job.kind === "trade-draft" ? "T" : "X"} size={30} radius={9} />
                <div style={{ minWidth: 0, flex: "1 1 auto", display: "grid", gap: 4 }}>
                  <div className="cname">{job.command || job.kind}</div>
                  <div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>{job.status} · reply {job.replyStatus || "none"} · {job.createdAt}</div>
                  {job.error ? <div style={{ color: "var(--danger)", fontSize: 12 }}>{job.error}</div> : null}
                  {job.resultText ? <div style={{ color: "var(--fg-2)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{job.resultText}</div> : null}
                  {job.tradeDraft && onReviewTradeDraft ? (
                    <BBtn sm onClick={() => onReviewTradeDraft({ ...job.tradeDraft!, requestId: job.id })}>
                      <BIcon name="trade" size={13} /> Review in Trade desk
                    </BBtn>
                  ) : null}
                  {job.transcriptUrl ? <button type="button" onClick={() => void openExternalUrl(job.transcriptUrl as string)} style={{ justifySelf: "start", background: "none", border: 0, color: "var(--honey)", padding: 0, cursor: "pointer" }}>Open transcript →</button> : null}
                </div>
                <span className="ckey">{job.kind}</span>
              </div>
            ))}
          </div>
        ) : <div className="ni-empty"><strong>No commands yet.</strong><span>After the bot account is live, requested mentions appear here with their billing, execution, and reply state.</span></div>}
      </section>

      {message ? <p className="ni-note" role="status">{message}</p> : null}
      {walletPickerOpen ? (
        <WalletSelectModal
          pickables={walletPickables}
          getSurvivalSnapshot={getSurvivalSnapshot}
          currentId={selectedWalletId}
          title="Choose the HivemindOSBot wallet"
          subtitle="Choose once. HivemindOS will automatically use the compatible account and network for eligible X trades."
          confirmLabel="Use for HivemindOSBot"
          loading={walletsLoading}
          onConfirm={setSelectedWalletId}
          onClose={() => setWalletPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default XCommandBotPanel;
