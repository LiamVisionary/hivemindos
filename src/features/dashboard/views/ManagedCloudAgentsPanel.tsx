"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cloud,
  Coins,
  HardDrive,
  Link2,
  Network,
  Play,
  PlugZap,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Square,
  Trash2,
  WalletCards,
} from "lucide-react";

import {
  MANAGED_CLOUD_FUND_CONFIRMATION,
  type ManagedCloudAccount,
  type ManagedCloudAgent,
  type ManagedCloudIntegration,
  type ManagedCloudPlan,
  type HivemindCloudCommercialPlan,
} from "@/lib/services/managed-cloud-agents-contract";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import { LoadingBar, Skeleton, Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import "@/features/dashboard/views/zero-human-companies/theme.css";
import styles from "./ManagedCloudAgentsPanel.module.css";

type FundingWallet = {
  id: string;
  name: string;
  address: string;
  maxPaymentUsd: number;
  autoPayEnabled: boolean;
  balanceUsd: number;
};

type DashboardPayload = {
  ok: boolean;
  error?: string;
  configured: boolean;
  plans: ManagedCloudPlan[];
  commercialPlans: HivemindCloudCommercialPlan[];
  topUpAmountsUsd: number[];
  account: ManagedCloudAccount | null;
  agents: ManagedCloudAgent[];
  fundingWallets: FundingWallet[];
};

const REGIONS = [
  { id: "hel1", label: "Helsinki" },
  { id: "fsn1", label: "Falkenstein" },
  { id: "nbg1", label: "Nuremberg" },
  { id: "ash", label: "Ashburn" },
  { id: "hil", label: "Hillsboro" },
  { id: "sin", label: "Singapore" },
] as const;

function formatUsd(value: number, digits = 2) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function commercialPlanPrice(plan: HivemindCloudCommercialPlan) {
  if (plan.annualMinimumUsd !== null) return `${formatUsd(plan.annualMinimumUsd, 0)}/year minimum`;
  return `${formatUsd(plan.monthlyUsd || 0, 0)}/month`;
}

function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function statusTone(status: ManagedCloudAgent["status"]) {
  if (status === "running") return styles.live;
  if (status === "error") return styles.danger;
  if (status === "stopped") return styles.stopped;
  return styles.pending;
}

function assistantText(response: unknown): string {
  if (!response || typeof response !== "object") return "The managed agent returned an empty response.";
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return JSON.stringify(response, null, 2);
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === "string" ? first.message.content : JSON.stringify(response, null, 2);
}

async function managedCloudAction(body: Record<string, unknown>) {
  const response = await fetch("/api/managed-cloud-agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error || "Managed cloud action failed."));
  return payload;
}

function ManagedCloudLoading() {
  return (
    <section className={`${styles.root} zhc-root tabPanel`} role="status" aria-label="Loading managed cloud agents">
      <div className={styles.hero}>
        <div><Skeleton width={140} height={12} /><Skeleton width={330} height={32} style={{ marginTop: 12 }} /><Skeleton width="min(620px, 82vw)" height={13} style={{ marginTop: 14 }} /></div>
        <Skeleton width={180} height={74} radius={16} />
      </div>
      <div className={styles.loadingGrid}>
        <Skeleton height={360} radius={20} />
        <Skeleton height={360} radius={20} />
      </div>
    </section>
  );
}

export function ManagedCloudAgentsPanel() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("My Cloud Agent");
  const [planId, setPlanId] = useState<ManagedCloudPlan["id"]>("small");
  const [region, setRegion] = useState("hel1");
  const [modelTier, setModelTier] = useState<"fast" | "balanced">("fast");
  const [topUpUsd, setTopUpUsd] = useState(0.25);
  const [walletId, setWalletId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatReply, setChatReply] = useState("");
  const [integrations, setIntegrations] = useState<ManagedCloudIntegration[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [tailnetAuthKey, setTailnetAuthKey] = useState("");
  const [tailnetTag, setTailnetTag] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpAuthorization, setMcpAuthorization] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setError("");
    try {
      const response = await fetch("/api/managed-cloud-agents", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as DashboardPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load managed cloud agents.");
      setDashboard(payload);
      setWalletId((current) => current || payload.fundingWallets[0]?.id || "");
      setSelectedAgentId((current) => current && payload.agents.some((agent) => agent.id === current)
        ? current
        : payload.agents.find((agent) => agent.status === "running")?.id || payload.agents[0]?.id || "");
    } catch (refreshError) {
      if (!quiet) setError(refreshError instanceof Error ? refreshError.message : "Could not load managed cloud agents.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!dashboard?.agents.some((agent) => agent.status === "running" || ["provisioning", "starting", "stopping"].includes(agent.status))) return;
    const timer = window.setInterval(() => void refresh(true), 5_000);
    return () => window.clearInterval(timer);
  }, [dashboard?.agents, refresh]);

  const selectedPlan = useMemo(() => dashboard?.plans.find((plan) => plan.id === planId) || null, [dashboard?.plans, planId]);
  const selectedAgent = useMemo(() => dashboard?.agents.find((agent) => agent.id === selectedAgentId) || null, [dashboard?.agents, selectedAgentId]);
  const requiredToDeploy = selectedPlan ? selectedPlan.setupUsd + selectedPlan.runningUsdPerHour : 0;
  const needsFunding = (dashboard?.account?.balanceUsd || 0) + 1e-9 < requiredToDeploy;

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await refresh(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Managed cloud action failed.");
    } finally {
      setBusy("");
    }
  }, [refresh]);

  const refreshIntegrations = useCallback(async (instanceId: string) => {
    setIntegrationsLoading(true);
    try {
      const payload = await managedCloudAction({ action: "list_integrations", instanceId });
      setIntegrations(Array.isArray(payload.integrations) ? payload.integrations as ManagedCloudIntegration[] : []);
    } catch (integrationError) {
      setError(integrationError instanceof Error ? integrationError.message : "Could not load hosted integrations.");
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    const timer = window.setTimeout(() => void refreshIntegrations(selectedAgentId), 0);
    return () => window.clearTimeout(timer);
  }, [refreshIntegrations, selectedAgentId]);

  const deploy = useCallback(() => run("deploy", async () => {
    if (needsFunding) {
      if (!walletId) throw new Error("Choose a Base wallet to fund managed-agent credits.");
      await managedCloudAction({
        action: "top_up",
        walletAgentId: walletId,
        amountUsd: topUpUsd,
        confirmation: MANAGED_CLOUD_FUND_CONFIRMATION,
      });
    }
    await managedCloudAction({
      action: "create",
      name: name.trim(),
      planId,
      region,
      modelTier,
      idempotencyKey: crypto.randomUUID(),
    });
  }), [modelTier, name, needsFunding, planId, region, run, topUpUsd, walletId]);

  const fund = useCallback(() => run("fund", async () => {
    if (!walletId) throw new Error("Choose a Base wallet to fund managed-agent credits.");
    await managedCloudAction({ action: "top_up", walletAgentId: walletId, amountUsd: topUpUsd, confirmation: MANAGED_CLOUD_FUND_CONFIRMATION });
  }), [run, topUpUsd, walletId]);

  const lifecycle = useCallback((agent: ManagedCloudAgent, action: "start" | "stop" | "delete") => run(`${action}:${agent.id}`, async () => {
    if (action === "delete" && !(await confirmUserAction(`Delete ${agent.name} and its persistent workspace? This cannot be undone.`))) return;
    await managedCloudAction({ action, instanceId: agent.id });
  }), [run]);

  const sendChat = useCallback(() => run("chat", async () => {
    if (!selectedAgent || !chatDraft.trim()) return;
    const payload = await managedCloudAction({
      action: "chat",
      instanceId: selectedAgent.id,
      messages: [{ role: "user", content: chatDraft.trim() }],
    });
    setChatReply(assistantText(payload.response));
    setChatDraft("");
  }), [chatDraft, run, selectedAgent]);

  const connectTailnet = useCallback(() => run("tailnet", async () => {
    if (!selectedAgent || !tailnetAuthKey.trim()) throw new Error("Paste a one-off Tailscale auth key or tagged OAuth client secret.");
    await managedCloudAction({
      action: "connect_tailnet",
      instanceId: selectedAgent.id,
      authKey: tailnetAuthKey.trim(),
      advertiseTag: tailnetTag.trim() || undefined,
    });
    setTailnetAuthKey("");
    await refreshIntegrations(selectedAgent.id);
  }), [refreshIntegrations, run, selectedAgent, tailnetAuthKey, tailnetTag]);

  const pairBrain = useCallback(() => run("brain", async () => {
    if (!selectedAgent) return;
    const response = await fetch("/api/tailscale/devices", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { devices?: Array<{ self?: boolean; dnsName?: string }> };
    const localDnsName = payload.devices?.find((device) => device.self)?.dnsName?.replace(/\.$/, "") || "";
    if (!localDnsName) throw new Error("This machine must be connected to Tailscale before pairing the Shared Brain.");
    await managedCloudAction({ action: "pair_brain", instanceId: selectedAgent.id, localTailnetDnsName: localDnsName });
    await refreshIntegrations(selectedAgent.id);
  }), [refreshIntegrations, run, selectedAgent]);

  const addRemoteMcp = useCallback(() => run("mcp", async () => {
    if (!selectedAgent || !mcpName.trim() || !mcpUrl.trim()) throw new Error("Enter a short MCP name and its HTTPS endpoint.");
    await managedCloudAction({
      action: "add_mcp",
      instanceId: selectedAgent.id,
      integrationName: mcpName.trim(),
      integrationUrl: mcpUrl.trim(),
      authorization: mcpAuthorization.trim() || undefined,
    });
    setMcpName("");
    setMcpUrl("");
    setMcpAuthorization("");
    await refreshIntegrations(selectedAgent.id);
  }), [mcpAuthorization, mcpName, mcpUrl, refreshIntegrations, run, selectedAgent]);

  const removeIntegration = useCallback((integration: ManagedCloudIntegration) => run(`integration:${integration.id}`, async () => {
    if (!selectedAgent) return;
    await managedCloudAction({ action: "remove_integration", instanceId: selectedAgent.id, integrationId: integration.id });
    await refreshIntegrations(selectedAgent.id);
  }), [refreshIntegrations, run, selectedAgent]);

  if (!dashboard) return <ManagedCloudLoading />;

  return (
    <section className={`${styles.root} zhc-root tabPanel`} aria-label="Managed cloud agents">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><Cloud size={14} aria-hidden="true" /> Always-on HivemindOS</span>
          <h1>Managed Cloud Agents</h1>
          <p>Deploy a dedicated Hermes agent that keeps running when every personal machine is off. Its workspace persists across stops, restarts, and fresh compute.</p>
        </div>
        <div className={styles.balanceCard}>
          <span>Managed credit</span>
          <strong>{dashboard.account ? formatUsd(dashboard.account.balanceUsd, 3) : "Not funded"}</strong>
          <small>Base USDC · server-metered</small>
        </div>
      </header>

      {error ? <div className={styles.errorBanner} role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{error}</span></div> : null}
      {busy ? <LoadingBar style={{ marginBottom: 16 }} /> : null}

      <section className={styles.commercialPanel} aria-label="Hivemind Cloud commercial plans">
        <div className={styles.commercialHeading}>
          <div><span className={styles.kicker}>One commercial model</span><h2>Control plane subscription + metered managed usage</h2></div>
          <p>Subscriptions cover governance and collaboration. Agent hours, hosted apps, models, and APIs remain visible usage instead of being hidden inside a seat.</p>
        </div>
        <div className={styles.commercialGrid}>
          {(dashboard.commercialPlans || []).map((plan) => (
            <article key={plan.id} className={styles.commercialCard}>
              <div><span>{plan.availability.replace("-", " ")}</span><strong>{plan.label}</strong></div>
              <b>{commercialPlanPrice(plan)}</b>
              <p>{plan.audience}</p>
              <small>{plan.includedUsageUsd > 0 ? `${formatUsd(plan.includedUsageUsd, 0)} managed usage included` : "Managed usage billed separately"}</small>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.workspace}>
        <div className={styles.primaryColumn}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div><span className={styles.kicker}>One-click deploy</span><h2>Launch an always-on agent</h2></div>
              <ShieldCheck size={22} aria-hidden="true" />
            </div>

            <label className={styles.field}>
              <span>Agent name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="My Cloud Agent" />
            </label>

            <div className={styles.field}>
              <span>Size</span>
              <div className={styles.planGrid}>
                {dashboard.plans.map((plan) => (
                  <button key={plan.id} type="button" className={`${styles.planCard} ${planId === plan.id ? styles.selected : ""}`} onClick={() => setPlanId(plan.id)}>
                    <span className={styles.planTop}><strong>{plan.label}</strong>{planId === plan.id ? <CheckCircle2 size={16} aria-hidden="true" /> : null}</span>
                    <span>{plan.vcpus} vCPU · {plan.memoryGb} GB RAM</span>
                    <span>{plan.persistentStorageGb} GB persistent</span>
                    <b>{formatUsd(plan.runningUsdPerHour, 3)}/hour</b>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.twoFields}>
              <label className={styles.field}><span>Region</span><select value={region} onChange={(event) => setRegion(event.target.value)}>{REGIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label className={styles.field}><span>Model tier</span><select value={modelTier} onChange={(event) => setModelTier(event.target.value as "fast" | "balanced")}><option value="fast">Fast</option><option value="balanced">Balanced</option></select></label>
            </div>

            {needsFunding ? (
              <div className={styles.fundingBox}>
                <div><span className={styles.kicker}>Funding</span><strong>Choose a governed Base wallet</strong></div>
                <label className={styles.field}><span>Wallet</span><select value={walletId} onChange={(event) => setWalletId(event.target.value)}><option value="">Select a Base wallet</option>{dashboard.fundingWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {shortAddress(wallet.address)}</option>)}</select></label>
                <div className={styles.amountRow}>{dashboard.topUpAmountsUsd.map((amount) => <button type="button" key={amount} className={topUpUsd === amount ? styles.selectedAmount : ""} onClick={() => setTopUpUsd(amount)}>{formatUsd(amount)}</button>)}</div>
                <p>The click requests a server-authored Base USDC quote, then enforces the selected wallet&apos;s caps, budgets, and approvals before signing.</p>
              </div>
            ) : null}

            <button type="button" className={styles.deployButton} onClick={() => void deploy()} disabled={Boolean(busy) || name.trim().length < 2 || (needsFunding && !walletId)}>
              {busy === "deploy" ? <Spinner size={16} /> : <Cloud size={17} aria-hidden="true" />}
              {needsFunding ? `Fund ${formatUsd(topUpUsd)} & deploy` : "Deploy agent"}
            </button>
            <p className={styles.costNote}>{selectedPlan ? `${formatUsd(selectedPlan.setupUsd, 3)} setup · ${formatUsd(selectedPlan.runningUsdPerHour * 24, 2)}/day running · ${formatUsd(selectedPlan.stoppedUsdPerHour * 24, 2)}/day stopped` : ""}</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}><div><span className={styles.kicker}>Always-on capabilities</span><h2>Tailnet, Brain, and cloud MCPs</h2></div><Network size={21} aria-hidden="true" /></div>
            {selectedAgent ? (
              <div className={styles.integrationStack}>
                <div className={styles.capabilityStatusGrid}>
                  <div><span>Tailnet</span><strong>{selectedAgent.tailnet.status}</strong><small>{selectedAgent.tailnet.dnsName || "Not enrolled"}</small></div>
                  <div><span>Shared Brain</span><strong>{selectedAgent.sharedBrain.status}</strong><small>{selectedAgent.sharedBrain.deviceId ? "Syncthing identity ready" : "Not paired"}</small></div>
                  <div><span>Hosted apps</span><strong>{selectedAgent.integrations.status}</strong><small>Config generation {selectedAgent.integrations.generation}</small></div>
                </div>

                {selectedAgent.tailnet.status !== "connected" ? (
                  <details className={styles.advancedSetup}>
                    <summary><Link2 size={15} aria-hidden="true" />Connect this agent to your Tailnet</summary>
                    <p>Use a one-off, pre-approved auth key. For an OAuth client secret, grant <code>auth_keys</code> and enter its permitted tag.</p>
                    <label className={styles.field}><span>Tailscale credential</span><input type="password" autoComplete="off" value={tailnetAuthKey} onChange={(event) => setTailnetAuthKey(event.target.value)} placeholder="tskey-auth-…" /></label>
                    <label className={styles.field}><span>OAuth tag (only for client secrets)</span><input value={tailnetTag} onChange={(event) => setTailnetTag(event.target.value)} placeholder="tag:hivemind-agent" /></label>
                    <button type="button" className={styles.secondaryButton} onClick={() => void connectTailnet()} disabled={Boolean(busy) || !tailnetAuthKey.trim()}>{busy === "tailnet" ? <Spinner /> : <Network size={15} aria-hidden="true" />}Enroll and restart agent</button>
                  </details>
                ) : (
                  <button type="button" className={styles.secondaryButton} onClick={() => void pairBrain()} disabled={Boolean(busy) || selectedAgent.sharedBrain.status !== "ready"}>{busy === "brain" ? <Spinner /> : <HardDrive size={15} aria-hidden="true" />}Pair this machine&apos;s Shared Brain</button>
                )}

                <details className={styles.advancedSetup}>
                  <summary><PlugZap size={15} aria-hidden="true" />Promote a cloud-native remote MCP</summary>
                  <p>Only HTTPS MCPs can run independently in the cloud. Headers are encrypted by the hosted control plane and written only into this agent&apos;s protected runtime environment.</p>
                  <div className={styles.twoFields}>
                    <label className={styles.field}><span>Short name</span><input value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="github" /></label>
                    <label className={styles.field}><span>HTTPS MCP endpoint</span><input value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" /></label>
                  </div>
                  <label className={styles.field}><span>Authorization header (optional)</span><input type="password" autoComplete="off" value={mcpAuthorization} onChange={(event) => setMcpAuthorization(event.target.value)} placeholder="Bearer …" /></label>
                  <button type="button" className={styles.secondaryButton} onClick={() => void addRemoteMcp()} disabled={Boolean(busy) || !mcpName.trim() || !mcpUrl.trim()}>{busy === "mcp" ? <Spinner /> : <PlugZap size={15} aria-hidden="true" />}Encrypt, promote, and restart</button>
                </details>

                <div className={styles.integrationList}>
                  <div className={styles.integrationListHeading}><strong>Promoted capabilities</strong>{integrationsLoading ? <Spinner size={14} /> : null}</div>
                  {!integrationsLoading && integrations.length === 0 ? <p>No hosted capabilities promoted yet.</p> : null}
                  {integrations.map((integration) => (
                    <div key={integration.id} className={styles.integrationRow}>
                      <div><strong>{integration.name}</strong><span>{integration.kind.replaceAll("_", " ")} · {integration.status}</span></div>
                      <button type="button" onClick={() => void removeIntegration(integration)} disabled={Boolean(busy)} aria-label={`Remove ${integration.name}`}>{busy === `integration:${integration.id}` ? <Spinner /> : <Trash2 size={13} aria-hidden="true" />}</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div className={styles.emptyCompact}>Select a managed agent to configure always-on capabilities.</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div><span className={styles.kicker}>Your cloud</span><h2>Managed agents</h2></div>
              <button type="button" className={styles.iconButton} onClick={() => void refresh()} disabled={Boolean(busy)} aria-label="Refresh managed agents"><RefreshCw size={16} aria-hidden="true" /></button>
            </div>
            {dashboard.agents.length === 0 ? (
              <div className={styles.emptyState}><Bot size={30} aria-hidden="true" /><strong>No managed agents yet</strong><span>Choose a size and deploy your first always-on Hermes agent.</span></div>
            ) : (
              <div className={styles.agentList}>
                {dashboard.agents.map((agent) => {
                  const plan = dashboard.plans.find((item) => item.id === agent.planId);
                  return (
                    <article key={agent.id} className={`${styles.agentCard} ${selectedAgentId === agent.id ? styles.activeAgent : ""}`} onClick={() => setSelectedAgentId(agent.id)}>
                      <div className={styles.agentIdentity}><span className={styles.agentIcon}><Bot size={19} aria-hidden="true" /></span><div><h3>{agent.name}</h3><span>{plan?.label || agent.planId} · {REGIONS.find((item) => item.id === agent.region)?.label || agent.region}</span></div></div>
                      <span className={`${styles.status} ${statusTone(agent.status)}`}><i />{agent.status}</span>
                      <div className={styles.agentMeta}><span><Server size={14} aria-hidden="true" />{agent.model}</span><span><HardDrive size={14} aria-hidden="true" />{plan?.persistentStorageGb || "—"} GB persistent</span></div>
                      {agent.lastError ? <p className={styles.agentError}>{agent.lastError}</p> : null}
                      <div className={styles.agentActions}>
                        {agent.status === "stopped" ? <button type="button" onClick={(event) => { event.stopPropagation(); void lifecycle(agent, "start"); }} disabled={Boolean(busy)}>{busy === `start:${agent.id}` ? <Spinner /> : <Play size={14} aria-hidden="true" />}Start</button> : null}
                        {agent.status === "running" || agent.status === "error" ? <button type="button" onClick={(event) => { event.stopPropagation(); void lifecycle(agent, "stop"); }} disabled={Boolean(busy)}>{busy === `stop:${agent.id}` ? <Spinner /> : <Square size={13} aria-hidden="true" />}Stop</button> : null}
                        <button type="button" className={styles.deleteButton} onClick={(event) => { event.stopPropagation(); void lifecycle(agent, "delete"); }} disabled={Boolean(busy)}>{busy === `delete:${agent.id}` ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}Delete</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className={styles.secondaryColumn}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}><div><span className={styles.kicker}>Pay as you go</span><h2>Credits</h2></div><Coins size={21} aria-hidden="true" /></div>
            <p className={styles.panelCopy}>Add credit at any time. Compute stops automatically when credit is exhausted; the workspace stays on persistent storage.</p>
            <label className={styles.field}><span>Funding wallet</span><select value={walletId} onChange={(event) => setWalletId(event.target.value)}><option value="">Select a Base wallet</option>{dashboard.fundingWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {shortAddress(wallet.address)}</option>)}</select></label>
            <div className={styles.amountRow}>{dashboard.topUpAmountsUsd.map((amount) => <button type="button" key={amount} className={topUpUsd === amount ? styles.selectedAmount : ""} onClick={() => setTopUpUsd(amount)}>{formatUsd(amount)}</button>)}</div>
            <button type="button" className={styles.secondaryButton} disabled={Boolean(busy) || !walletId} onClick={() => void fund()}>{busy === "fund" ? <Spinner /> : <WalletCards size={15} aria-hidden="true" />}Add {formatUsd(topUpUsd)} credit</button>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}><div><span className={styles.kicker}>Browser chat</span><h2>{selectedAgent?.name || "Select an agent"}</h2></div><Send size={20} aria-hidden="true" /></div>
            {selectedAgent ? (
              <>
                <div className={styles.chatReply}>{chatReply || (selectedAgent.status === "running" ? "Your managed agent is ready for a message." : "Start this agent before chatting.")}</div>
                <textarea value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Ask your cloud agent to do something…" rows={5} disabled={selectedAgent.status !== "running" || Boolean(busy)} />
                <button type="button" className={styles.secondaryButton} onClick={() => void sendChat()} disabled={selectedAgent.status !== "running" || !chatDraft.trim() || Boolean(busy)}>{busy === "chat" ? <Spinner /> : <Send size={15} aria-hidden="true" />}Send message</button>
              </>
            ) : <div className={styles.emptyCompact}>Deploy or select a managed agent to chat here.</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}><div><span className={styles.kicker}>Capability reach</span><h2>What works while devices sleep</h2></div><ShieldCheck size={20} aria-hidden="true" /></div>
            <div className={styles.reachList}>
              <div className={styles.reachRow}><i className={styles.reachLive} /><div><strong>Cloud workspace + managed inference</strong><span>Available whenever the managed agent is running.</span></div></div>
              <div className={styles.reachRow}><i className={selectedAgent?.sharedBrain.status === "ready" ? styles.reachLive : styles.reachPending} /><div><strong>Shared Brain + cloud-safe apps</strong><span>Syncthing and encrypted remote MCP promotion remain active on the managed machine after your computer turns off.</span></div></div>
              <div className={styles.reachRow}><i className={styles.reachPending} /><div><strong>Machine MCPs + local files</strong><span>Require Tailnet enrollment and remain available only while the machine that owns them is online.</span></div></div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
