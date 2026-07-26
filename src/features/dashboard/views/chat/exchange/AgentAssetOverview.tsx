"use client";

/* Click an agent's name in the chat thread → a compact overview of that
 * agent's assets: wallet balance/runway/holdings and mailbox/pending mail,
 * with modals for full detail, funding (same rail as the Wallets route), and
 * the agent's email threads. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, HandCoins, LoaderCircle, Mail, Wallet, X } from "lucide-react";

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig, AgentWalletTokenBalance } from "@/lib/types/agent-wallet";
import {
  getDisplayWalletBalanceUsd,
  getSurvivalSnapshot,
  hasConfiguredAgentWallet,
  resolveAgentWallet,
} from "@/lib/utils/agent-wallet";
import { fundingNetworkLabel } from "@/lib/services/wallet/fund-agent-client";

import { POP_STYLE } from "./composer-primitives";
import { AgentFundModal } from "./AgentFundModal";
import styles from "./agent-asset-overview.module.css";

export type AgentAssetAnchor = { x: number; y: number };

type ChipTone = "ok" | "warn" | "danger" | "muted";

type AgentMailThread = {
  id: string;
  providerLabel?: string;
  subject?: string;
  preview?: string;
  direction?: string;
  messageCount?: number;
  updatedAt?: number;
  labels?: string[];
  inboxAddress?: string;
};

type AgentMailboxSummary = { address: string; status?: string; providerLabel?: string; detail?: string };

type AgentMailState = {
  configured: boolean;
  mailboxes: AgentMailboxSummary[];
  threads: AgentMailThread[];
  pendingCount: number;
  canProvision: boolean;
  providerDetail: string;
};

type ThreadDetail = { body?: string; note?: string };

/** A thread still waiting on us: last activity inbound, marked unread by the
 *  provider, or an outbound send stuck in the queue. */
function isPendingThread(thread: AgentMailThread): boolean {
  if (thread.direction === "inbound" || thread.direction === "queued") return true;
  return Array.isArray(thread.labels) && thread.labels.includes("unread");
}

function buildMailState(
  mailboxData: Record<string, unknown> | null,
  inboxData: Record<string, unknown> | null,
): AgentMailState {
  const inboxMailboxes = Array.isArray(inboxData?.mailboxes) ? inboxData.mailboxes as AgentMailboxSummary[] : [];
  const storeMailboxes = Array.isArray(mailboxData?.mailboxes)
    ? (mailboxData.mailboxes as Array<{ address?: string; status?: string; providerId?: string; detail?: string }>)
      .map((row) => ({
        address: String(row.address || ""),
        status: row.status,
        providerLabel: row.providerId ? String(row.providerId) : undefined,
        detail: row.detail,
      }))
    : [];
  const byAddress = new Map<string, AgentMailboxSummary>();
  for (const mailbox of [...inboxMailboxes, ...storeMailboxes]) {
    const key = mailbox.address.trim().toLowerCase();
    if (key && !byAddress.has(key)) byAddress.set(key, mailbox);
  }
  const threads = Array.isArray(inboxData?.threads) ? inboxData.threads as AgentMailThread[] : [];
  const providerStatus = (mailboxData?.providerStatus ?? {}) as { ready?: boolean; canProvision?: boolean; detail?: string };
  return {
    configured: inboxData?.configured === true || providerStatus.ready === true,
    mailboxes: [...byAddress.values()],
    threads,
    pendingCount: threads.filter(isPendingThread).length,
    canProvision: providerStatus.canProvision === true,
    providerDetail: String(providerStatus.detail || inboxData?.detail || ""),
  };
}

function walletChip(wallet: AgentWalletConfig, snapshot: ReturnType<typeof getSurvivalSnapshot>): { tone: ChipTone; text: string } {
  if (!wallet.enabled) return { tone: "muted", text: "Spend off" };
  if (snapshot.tier === "critical" || snapshot.tier === "dead") return { tone: "danger", text: "Needs funding" };
  if (snapshot.tier === "low_compute") return { tone: "warn", text: "Low compute" };
  if (snapshot.daysRemaining != null) return { tone: "ok", text: `${snapshot.daysRemaining.toFixed(1)} days runway` };
  return { tone: "ok", text: "Can spend" };
}

function sortedHoldings(wallet: AgentWalletConfig): AgentWalletTokenBalance[] {
  const tokens = (wallet.tokens ?? []).filter((token) => Number(token.balance) > 0);
  return [...tokens].sort((left, right) => (Number(right.valueUsd) || 0) - (Number(left.valueUsd) || 0));
}

function shortAddress(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTokenAmount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 4 });
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.iconBtn}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

export function AgentAssetOverview({
  agent,
  anchor,
  onClose,
  walletsByAgent,
  refreshWalletBalance,
  setActiveView,
  vaultPath,
  formatRelativeTime,
}: {
  agent: AgentProfile;
  anchor: AgentAssetAnchor;
  onClose: () => void;
  walletsByAgent?: Record<string, AgentWalletConfig>;
  refreshWalletBalance?: (agentId: string) => Promise<AgentWalletConfig | null | undefined>;
  setActiveView?: (view: string) => void;
  vaultPath?: string;
  formatRelativeTime?: (timestamp: number) => string;
}) {
  const [modal, setModal] = useState<null | "wallet" | "fund" | "emails">(null);
  const [freshWallet, setFreshWallet] = useState<AgentWalletConfig | null>(null);
  const [walletRefreshing, setWalletRefreshing] = useState(false);
  const [mail, setMail] = useState<AgentMailState | null>(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [creatingMailbox, setCreatingMailbox] = useState(false);
  const [mailError, setMailError] = useState("");
  const mailFetchSeq = useRef(0);

  const storedWallet = walletsByAgent?.[agent.id];
  const wallet = useMemo(
    () => resolveAgentWallet(agent, freshWallet ?? storedWallet),
    [agent, freshWallet, storedWallet],
  );
  const configured = hasConfiguredAgentWallet(agent, wallet);
  const balanceUsd = getDisplayWalletBalanceUsd(wallet);
  const snapshot = useMemo(() => getSurvivalSnapshot(wallet), [wallet]);
  const chip = walletChip(wallet, snapshot);
  const holdings = useMemo(() => sortedHoldings(wallet), [wallet]);
  const address = wallet.walletAddress || wallet.vaultAddress || "";
  const networkLabel = fundingNetworkLabel(String(wallet.network || ""));

  const loadMail = useCallback(() => {
    const seq = ++mailFetchSeq.current;
    setMailLoading(true);
    setMailError("");
    void Promise.all([
      fetch(`/api/agents/mailbox?agentId=${encodeURIComponent(agent.id)}`)
        .then((response) => response.json()).catch(() => null),
      fetch(`/api/agents/inbox?agentId=${encodeURIComponent(agent.id)}`)
        .then((response) => response.json()).catch(() => null),
    ]).then(([mailboxData, inboxData]) => {
      if (mailFetchSeq.current !== seq) return;
      setMail(buildMailState(mailboxData, inboxData));
    }).finally(() => {
      if (mailFetchSeq.current === seq) setMailLoading(false);
    });
  }, [agent.id]);

  useEffect(() => {
    let ignore = false;
    void Promise.resolve().then(() => { if (!ignore) loadMail(); });
    return () => { ignore = true; mailFetchSeq.current += 1; };
  }, [agent.id, loadMail]);

  useEffect(() => {
    if (!refreshWalletBalance) return undefined;
    const hasAddress = Boolean(storedWallet?.walletAddress || storedWallet?.vaultAddress);
    if (!hasAddress) return undefined;
    let ignore = false;
    void Promise.resolve().then(async () => {
      if (ignore) return;
      setWalletRefreshing(true);
      try {
        const updated = await refreshWalletBalance(agent.id);
        if (!ignore && updated) setFreshWallet(updated);
      } catch {
        // Balance refresh is best-effort; the stored snapshot still renders.
      } finally {
        if (!ignore) setWalletRefreshing(false);
      }
    });
    return () => { ignore = true; };
    // Refresh once per agent per open — not on every walletsByAgent identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, refreshWalletBalance]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setModal((current) => {
        if (current) return null;
        onClose();
        return current;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const createMailbox = () => {
    setCreatingMailbox(true);
    setMailError("");
    void fetch("/api/agents/mailbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", agentId: agent.id, agentName: agent.name }),
    })
      .then((response) => response.json())
      .then((data: { ok?: boolean; error?: string } | null) => {
        if (!data?.ok) throw new Error(data?.error || "Could not create a mailbox.");
        loadMail();
      })
      .catch((cause) => setMailError(cause instanceof Error ? cause.message : "Could not create a mailbox."))
      .finally(() => setCreatingMailbox(false));
  };

  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.max(8, Math.min(anchor.x, viewportWidth - 340));
  const top = Math.max(8, Math.min(anchor.y, viewportHeight - 440));

  const openWalletsView = setActiveView
    ? () => { setActiveView("wallet"); onClose(); }
    : undefined;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 190 }} />
      <div
        data-cx-pop
        className={`cx-pop ${styles.pop}`}
        role="dialog"
        aria-label={`${agent.name} assets overview`}
        style={{ left, top, ...POP_STYLE, padding: 12 }}
      >
        <header className={styles.popHeader}>
          <div className={styles.popHeaderCopy}>
            <span className={styles.popName}>{agent.name}</span>
            <span className={styles.popSub}>
              {[agent.runtime, agent.machineName].filter(Boolean).join(" · ") || "Agent assets"}
            </span>
          </div>
          <button type="button" className={styles.iconBtn} aria-label="Close overview" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        <section className={styles.section} aria-label="Wallet">
          <span className={styles.sectionLabel}>
            <Wallet aria-hidden="true" /> Wallet
            {walletRefreshing ? <LoaderCircle size={11} className={styles.spin} aria-hidden="true" /> : null}
          </span>
          {configured ? (
            <>
              <div className={styles.balanceRow}>
                <span className={styles.balance}>{formatUsd(balanceUsd)}</span>
                <span className={styles.chip} data-tone={chip.tone}>{chip.text}</span>
              </div>
              {holdings.length ? (
                <div className={styles.rows}>
                  {holdings.slice(0, 4).map((token) => (
                    <div key={`${token.symbol}-${token.tokenAddress ?? token.network}`} className={styles.holdingRow}>
                      <span className={styles.holdingSym}>{token.symbol}</span>
                      <span className={styles.holdingAmount}>{formatTokenAmount(Number(token.balance) || 0)}</span>
                      <span className={styles.holdingVal}>{token.valueUsd != null ? formatUsd(Number(token.valueUsd) || 0) : ""}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {address ? (
                <div className={styles.addrRow}>
                  <span className={styles.addrText}>{networkLabel} · {shortAddress(address)}</span>
                  <CopyButton value={address} label={`Copy ${agent.name} wallet address`} />
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.empty}>No wallet configured for this agent yet.</p>
          )}
        </section>

        <section className={styles.section} aria-label="Email">
          <span className={styles.sectionLabel}>
            <Mail aria-hidden="true" /> Email
            {mailLoading ? <LoaderCircle size={11} className={styles.spin} aria-hidden="true" /> : null}
          </span>
          {mail === null ? (
            <div className={styles.rows} role="status" aria-label="Loading agent mail">
              <div className={styles.skel} style={{ width: "82%" }} />
              <div className={styles.skel} style={{ width: "58%" }} />
            </div>
          ) : mail.mailboxes.length ? (
            <>
              <span className={styles.mailAddress}>{mail.mailboxes[0].address}</span>
              <div className={styles.mailMeta}>
                {mail.mailboxes.length > 1 ? <span>+{mail.mailboxes.length - 1} more</span> : null}
                <span>{mail.threads.length} {mail.threads.length === 1 ? "thread" : "threads"}</span>
                {mail.pendingCount > 0 ? (
                  <span className={styles.chip} data-tone="warn" title="Inbound threads awaiting a reply, unread mail, or queued sends">
                    {mail.pendingCount} pending
                  </span>
                ) : (
                  <span className={styles.chip} data-tone="ok">Clear</span>
                )}
              </div>
            </>
          ) : (
            <p className={styles.empty}>No mailbox for this agent yet.</p>
          )}
        </section>

        <footer className={styles.footer}>
          <button type="button" className={styles.footerBtn} onClick={() => setModal("wallet")}>
            <Wallet aria-hidden="true" /> Wallet
          </button>
          <button type="button" className={styles.footerBtn} onClick={() => setModal("fund")}>
            <HandCoins aria-hidden="true" /> Fund
          </button>
          <button type="button" className={styles.footerBtn} onClick={() => setModal("emails")}>
            <Mail aria-hidden="true" /> Emails
          </button>
        </footer>
      </div>

      {modal === "wallet" ? (
        <WalletDetailModal
          agent={agent}
          wallet={wallet}
          configured={configured}
          balanceUsd={balanceUsd}
          statusCopy={snapshot.statusCopy}
          chip={chip}
          holdings={holdings}
          address={address}
          networkLabel={networkLabel}
          onFund={() => setModal("fund")}
          onOpenWallets={openWalletsView}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "fund" ? (
        <AgentFundModal
          agent={agent}
          recipientWallet={wallet}
          walletsByAgent={walletsByAgent}
          vaultPath={vaultPath}
          refreshWalletBalance={refreshWalletBalance
            ? async (agentId: string) => {
              const updated = await refreshWalletBalance(agentId);
              if (updated) setFreshWallet(updated);
              return updated;
            }
            : undefined}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "emails" ? (
        <AgentEmailsModal
          agent={agent}
          mail={mail}
          mailLoading={mailLoading}
          mailError={mailError}
          creatingMailbox={creatingMailbox}
          onCreateMailbox={createMailbox}
          onReload={loadMail}
          formatRelativeTime={formatRelativeTime}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

function WalletDetailModal({
  agent,
  wallet,
  configured,
  balanceUsd,
  statusCopy,
  chip,
  holdings,
  address,
  networkLabel,
  onFund,
  onOpenWallets,
  onClose,
}: {
  agent: AgentProfile;
  wallet: AgentWalletConfig;
  configured: boolean;
  balanceUsd: number;
  statusCopy: string;
  chip: { tone: ChipTone; text: string };
  holdings: AgentWalletTokenBalance[];
  address: string;
  networkLabel: string;
  onFund: () => void;
  onOpenWallets?: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`${agent.name} wallet`}>
        <header className={styles.modalHeader}>
          <Wallet aria-hidden="true" />
          <h2>{agent.name} wallet</h2>
          <button type="button" className={styles.modalClose} aria-label="Close wallet detail" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={styles.modalBody}>
          {configured ? (
            <>
              <div className={styles.balanceRow}>
                <span className={styles.balance}>{formatUsd(balanceUsd)}</span>
                <span className={styles.chip} data-tone={chip.tone}>{chip.text}</span>
              </div>
              <p className={styles.help}>{statusCopy}</p>

              {holdings.length ? (
                <div className={styles.modalSection}>
                  <span className={styles.modalSectionTitle}>Holdings</span>
                  <div className={styles.rows}>
                    {holdings.map((token) => (
                      <div key={`${token.symbol}-${token.tokenAddress ?? token.network}`} className={styles.holdingRow}>
                        <span className={styles.holdingSym}>{token.symbol}</span>
                        <span className={styles.holdingAmount}>{formatTokenAmount(Number(token.balance) || 0)}</span>
                        <span className={styles.holdingVal}>{token.valueUsd != null ? formatUsd(Number(token.valueUsd) || 0) : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className={styles.modalSection}>
                <span className={styles.modalSectionTitle}>Account</span>
                {address ? (
                  <div className={styles.kvRow}>
                    <span>Address</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className={styles.addrText}>{address}</span>
                      <CopyButton value={address} label="Copy wallet address" />
                    </span>
                  </div>
                ) : null}
                <div className={styles.kvRow}><span>Network</span><span>{networkLabel}</span></div>
                <div className={styles.kvRow}><span>Provider</span><span>{wallet.provider}</span></div>
                <div className={styles.kvRow}><span>Spend</span><span>{wallet.enabled ? "Enabled" : "Off"}</span></div>
                {wallet.maxPaymentUsd > 0 ? (
                  <div className={styles.kvRow}><span>Per-payment cap</span><span>{formatUsd(wallet.maxPaymentUsd)}</span></div>
                ) : null}
                {wallet.dailyBudgetUsd ? (
                  <div className={styles.kvRow}><span>Daily budget</span><span>{formatUsd(wallet.dailyBudgetUsd)}</span></div>
                ) : null}
              </div>
            </>
          ) : (
            <p className={styles.help}>
              No wallet is configured for {agent.name} yet. Set one up from the Wallets view to give this agent a balance
              it can spend from.
            </p>
          )}

          <div className={styles.modalActions}>
            {configured ? (
              <button type="button" className={styles.primaryBtn} onClick={onFund}>
                <HandCoins size={14} aria-hidden="true" /> Fund agent
              </button>
            ) : null}
            {onOpenWallets ? (
              <button type="button" className={styles.secondaryBtn} onClick={onOpenWallets}>
                <ArrowUpRight size={14} aria-hidden="true" /> Open Wallets view
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function AgentEmailsModal({
  agent,
  mail,
  mailLoading,
  mailError,
  creatingMailbox,
  onCreateMailbox,
  onReload,
  formatRelativeTime,
  onClose,
}: {
  agent: AgentProfile;
  mail: AgentMailState | null;
  mailLoading: boolean;
  mailError: string;
  creatingMailbox: boolean;
  onCreateMailbox: () => void;
  onReload: () => void;
  formatRelativeTime?: (timestamp: number) => string;
  onClose: () => void;
}) {
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ThreadDetail | null>>({});

  const openThread = (threadId: string) => {
    setExpandedThreadId((current) => (current === threadId ? null : threadId));
    if (details[threadId] !== undefined) return;
    setDetails((current) => ({ ...current, [threadId]: null }));
    void fetch(`/api/agents/inbox?threadId=${encodeURIComponent(threadId)}`)
      .then((response) => response.json())
      .then((data: { ok?: boolean; body?: string; note?: string; error?: string } | null) => {
        setDetails((current) => ({
          ...current,
          [threadId]: data?.ok
            ? { body: data.body, note: data.note }
            : { note: data?.error || "Could not load this email." },
        }));
      })
      .catch(() => {
        setDetails((current) => ({ ...current, [threadId]: { note: "Could not load this email." } }));
      });
  };

  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`${agent.name} emails`}>
        <header className={styles.modalHeader}>
          <Mail aria-hidden="true" />
          <h2>{agent.name} emails</h2>
          <button type="button" className={styles.modalClose} aria-label="Close emails" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={styles.modalBody}>
          {mail === null || (mailLoading && !mail.threads.length && !mail.mailboxes.length) ? (
            <div className={styles.rows} role="status" aria-label="Loading agent mail">
              <div className={styles.skel} style={{ width: "92%" }} />
              <div className={styles.skel} style={{ width: "74%" }} />
              <div className={styles.skel} style={{ width: "83%" }} />
            </div>
          ) : (
            <>
              <div className={styles.modalSection}>
                <span className={styles.modalSectionTitle}>Mailboxes</span>
                {mail.mailboxes.length ? (
                  <div className={styles.rows}>
                    {mail.mailboxes.map((mailbox) => (
                      <div key={mailbox.address} className={styles.kvRow}>
                        <span className={styles.addrText} style={{ color: "inherit" }}>{mailbox.address}</span>
                        <span>{mailbox.status === "issue" || mailbox.status === "blocked" ? mailbox.detail || mailbox.status : mailbox.providerLabel || "ready"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className={styles.help}>
                      {mail.providerDetail || `No mailbox exists for ${agent.name} yet.`}
                    </p>
                    {mail.canProvision ? (
                      <div className={styles.modalActions}>
                        <button type="button" className={styles.primaryBtn} disabled={creatingMailbox} onClick={onCreateMailbox}>
                          {creatingMailbox
                            ? <LoaderCircle size={14} className={styles.spin} aria-hidden="true" />
                            : <Mail size={14} aria-hidden="true" />}
                          {creatingMailbox ? "Creating mailbox" : "Create mailbox"}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
                {mailError ? <p className={styles.error}>{mailError}</p> : null}
              </div>

              <div className={styles.modalSection}>
                <span className={styles.modalSectionTitle}>
                  Threads{mail.pendingCount > 0 ? ` · ${mail.pendingCount} pending` : ""}
                </span>
                {mail.threads.length ? (
                  <div className={styles.rows}>
                    {mail.threads.map((thread) => {
                      const expanded = expandedThreadId === thread.id;
                      const detail = details[thread.id];
                      return (
                        <button key={thread.id} type="button" className={styles.threadRow} onClick={() => openThread(thread.id)}>
                          <span className={styles.threadTop}>
                            <span className={styles.threadSubject}>{thread.subject || "(no subject)"}</span>
                            {isPendingThread(thread) ? <span className={styles.chip} data-tone="warn">pending</span> : null}
                            <span className={styles.threadTime}>
                              {thread.updatedAt
                                ? (formatRelativeTime?.(thread.updatedAt) ?? new Date(thread.updatedAt).toLocaleDateString())
                                : ""}
                            </span>
                          </span>
                          {thread.preview ? <span className={styles.threadPreview}>{thread.preview}</span> : null}
                          {expanded ? (
                            detail === null || detail === undefined ? (
                              <span className={styles.threadBody} role="status" aria-label="Loading email body">
                                <span className={styles.skel} style={{ display: "block", width: "76%" }} />
                              </span>
                            ) : (
                              <span className={styles.threadBody}>{detail.body || detail.note || "No body available."}</span>
                            )
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles.help}>No email threads for this agent yet.</p>
                )}
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryBtn} disabled={mailLoading} onClick={onReload}>
                  {mailLoading ? <LoaderCircle size={14} className={styles.spin} aria-hidden="true" /> : null}
                  {mailLoading ? "Refreshing" : "Refresh"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
