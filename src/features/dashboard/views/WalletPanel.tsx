"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType, Dispatch, ElementType, SetStateAction } from "react";
import Image from "next/image";
import type { AgentWalletCardProps } from "@/components/wallet/AgentWalletCard";
import type { AgentWalletCardCompactProps } from "@/components/wallet/AgentWalletCardCompact";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentPaymentProvider, AgentSurvivalSnapshot, AgentWalletConfig, HoneyAgentReward } from "@/lib/types/agent-wallet";
import { resolveAgentWallet } from "@/lib/utils/agent-wallet";
import type { DashboardView, RuntimeUsageAnalytics, WalletActionState, WalletMoneyClawStatus, WalletVaultBackupStatus } from "@/features/dashboard/dashboard-types";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type WalletStats = {
  enabled: number;
  balance: number;
  critical: number;
};

type HoneyStats = {
  totalHoney: number;
  availableHoney: number;
  legacyHive: number;
  hiveQuote: number;
  rewardPoolHive: number;
  rewardPoolRemainingHive: number;
  rewardPoolSharePercent: number;
  hivePerMillionTokens: number;
};

type PaymentProviderCopy = Record<AgentPaymentProvider, {
  label: string;
  summary: string;
  setup: string;
}>;

type IconComponent = ElementType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
  height?: number;
  width?: number;
}>;

type EthereumProvider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type WalletWindow = Window & {
  ethereum?: EthereumProvider;
};

type WalletPanelProps = {
  AGENT_PAYMENT_PROVIDER_COPY: PaymentProviderCopy;
  AgentWalletCard: ComponentType<AgentWalletCardProps>;
  AgentWalletCardCompact: ComponentType<AgentWalletCardCompactProps>;
  Button: ElementType;
  ChevronLeft: IconComponent;
  Download: IconComponent;
  HandCoins: IconComponent;
  LoaderCircle: IconComponent;
  RUNTIME_LABELS: Record<string, string>;
  RefreshCcw: IconComponent;
  activeView: DashboardView;
  copyPaymentPrompt: (wallet: AgentWalletConfig) => void | Promise<void>;
  createDefaultAgentWallet: (agentId: string) => AgentWalletConfig;
  createLocalWallet: (agentId: string, network: string) => void | Promise<void>;
  displayAgents: AgentProfile[];
  claimAllHoneyToBankrHive: (recipientAddress?: string) => Promise<{ ok: boolean; error?: string; txHash?: string; amount?: number; recipientAddress?: string }>;
  enableHoneyLedger: () => void;
  formatHiveAmount: (amount: number) => string;
  formatRelativeTime: (timestamp: number) => string;
  getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  honeyLedgerEnabled: boolean;
  honeyStats: HoneyStats;
  initializeCoreWalletRails: (agentId: string) => Promise<void>;
  moneyClawStatusByEnvName: Record<string, WalletMoneyClawStatus | null | undefined>;
  refreshRuntimeUsage: () => void | Promise<void>;
  refreshRuntimeIntegrations: (agent?: AgentProfile | null) => void | Promise<void>;
  refreshWalletBalance: (agentId: string) => void | Promise<void>;
  renderAgentKey: (agent: AgentProfile, index: number) => string;
  resetWalletBurnClock: (agentId: string) => void;
  returnAllHiveToHoney: () => void | Promise<void>;
  runWalletVaultBackupAction: (action: "refresh" | "restore") => void | Promise<void>;
  runtimeUsage: RuntimeUsageAnalytics | null | undefined;
  runtimeUsageLoading: boolean;
  saveMoneyClawKey: (agentId: string, apiKey: string, options: { shareWithAllAgents: boolean }) => Promise<{ ok: boolean; error?: string }>;
  selectedAgent: AgentProfile | null;
  selectedHoneyReward: HoneyAgentReward | null;
  selectedWallet: AgentWalletConfig | null;
  selectedWalletSnapshot: AgentSurvivalSnapshot | null;
  sendWalletUsdc: (agentId: string) => void | Promise<void>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  setWalletExpanded: Dispatch<SetStateAction<boolean>>;
  setWalletPanelMode: Dispatch<SetStateAction<"wallets" | "usage">>;
  testX402Fetch: (agentId: string) => void | Promise<void>;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => void;
  updateWallet: (agentId: string, patch: Partial<AgentWalletConfig>) => void;
  updateWalletAction: (agentId: string, patch: WalletActionState) => void;
  vaultClass: ClassNameBuilder;
  walletActionsByAgent: Record<string, WalletActionState | undefined>;
  walletClass: ClassNameBuilder;
  walletExpanded: boolean;
  walletPanelMode: "wallets" | "usage";
  walletStats: WalletStats;
  walletVaultBackupBusy: boolean;
  walletVaultBackupMessage: string;
  walletVaultBackupStatus: WalletVaultBackupStatus | null | undefined;
  walletsByAgent: Record<string, AgentWalletConfig | undefined>;
};

export function WalletPanel(props: WalletPanelProps) {
  const { AGENT_PAYMENT_PROVIDER_COPY, AgentWalletCard, AgentWalletCardCompact, Button, ChevronLeft, Download, HandCoins, LoaderCircle, RUNTIME_LABELS, RefreshCcw, activeView, claimAllHoneyToBankrHive, copyPaymentPrompt, createDefaultAgentWallet, createLocalWallet, displayAgents, enableHoneyLedger, formatHiveAmount, formatRelativeTime, getSurvivalSnapshot, honeyLedgerEnabled, honeyStats, initializeCoreWalletRails, moneyClawStatusByEnvName, refreshRuntimeIntegrations, refreshRuntimeUsage, refreshWalletBalance, renderAgentKey, resetWalletBurnClock, returnAllHiveToHoney, runWalletVaultBackupAction, runtimeUsage, runtimeUsageLoading, saveMoneyClawKey, selectedAgent, selectedHoneyReward, selectedWallet, selectedWalletSnapshot, sendWalletUsdc, setSelectedAgentId, setWalletExpanded, setWalletPanelMode, testX402Fetch, updateAgentProfile, updateWallet, updateWalletAction, vaultClass, walletActionsByAgent, walletClass, walletExpanded, walletPanelMode, walletStats, walletVaultBackupBusy, walletVaultBackupMessage, walletVaultBackupStatus, walletsByAgent } = props;
  const refreshedUsePodAgentIds = useRef<Set<string>>(new Set());
  const [bankrClaimBusy, setBankrClaimBusy] = useState(false);
  const [bankrConnectBusy, setBankrConnectBusy] = useState(false);
  const [bankrClaimStatus, setBankrClaimStatus] = useState("");
  const [bankrRecipientAddress, setBankrRecipientAddress] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("hivemindos.bankrRecipientAddress") ?? "";
  });
  const bankrRecipientReady = /^0x[a-fA-F0-9]{40}$/.test(bankrRecipientAddress.trim());
  const effectiveSelectedWallet = selectedAgent && selectedWallet ? resolveAgentWallet(selectedAgent, selectedWallet) : selectedWallet;
  const effectiveSelectedWalletSnapshot = effectiveSelectedWallet ? getSurvivalSnapshot(effectiveSelectedWallet) : selectedWalletSnapshot;

  async function refreshUsePodWallet(agent: AgentProfile) {
    const nextUsePod = {
      ...(agent.usePod ?? {}),
      lastTestStatus: "checking",
      lastStatusMessage: "Checking UsePod balance.",
    };
    updateAgentProfile(agent.id, { usePod: nextUsePod });
    await refreshRuntimeIntegrations({ ...agent, provider: "usepod", usePod: nextUsePod });
  }

  useEffect(() => {
    if (activeView !== "wallet" || walletPanelMode !== "wallets") return;
    for (const agent of displayAgents) {
      if (agent.provider !== "usepod" || refreshedUsePodAgentIds.current.has(agent.id)) continue;
      refreshedUsePodAgentIds.current.add(agent.id);
      void refreshRuntimeIntegrations(agent);
    }
  }, [activeView, displayAgents, refreshRuntimeIntegrations, walletPanelMode]);

  async function connectBaseWallet() {
    const provider = (window as WalletWindow).ethereum;
    if (!provider) {
      setBankrClaimStatus("No browser wallet found. Paste your Bankr receiving address instead.");
      return;
    }

    setBankrConnectBusy(true);
    setBankrClaimStatus("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts.find((account) => /^0x[a-fA-F0-9]{40}$/.test(account));
      if (!address) {
        setBankrClaimStatus("Wallet connected, but no EVM address was returned.");
        return;
      }

      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }).catch(async (error: unknown) => {
        const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
        if (code !== 4902) return;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x2105",
            chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"],
          }],
        });
      });

      setBankrRecipientAddress(address);
      window.localStorage.setItem("hivemindos.bankrRecipientAddress", address);
      setBankrClaimStatus("Base wallet connected. Ready to claim Bankr HIVE.");
    } catch (error) {
      setBankrClaimStatus(error instanceof Error ? error.message : "Could not connect wallet.");
    } finally {
      setBankrConnectBusy(false);
    }
  }

  async function claimBankrHive() {
    const recipientAddress = bankrRecipientAddress.trim();
    if (!bankrRecipientReady) {
      setBankrClaimStatus("Enter a valid Bankr EVM receiving address first.");
      return;
    }
    setBankrClaimBusy(true);
    setBankrClaimStatus("Sending Bankr HIVE transaction...");
    window.localStorage.setItem("hivemindos.bankrRecipientAddress", recipientAddress);
    const result = await claimAllHoneyToBankrHive(recipientAddress);
    setBankrClaimBusy(false);
    if (!result.ok) {
      setBankrClaimStatus(result.error ?? "Bankr HIVE claim failed.");
      return;
    }
    const hash = result.txHash ? ` Tx ${result.txHash.slice(0, 10)}...${result.txHash.slice(-6)}.` : "";
    setBankrClaimStatus(`Sent ${formatHiveAmount(result.amount ?? 0)} HIVE to Bankr.${hash}`);
  }
  return (<>
      {activeView === "wallet" ? (
      <section className={walletClass("walletPanel", "tabPanel")}>
        <div className={walletClass("walletHeader")}>
          <div>
            <p className="eyebrow">Spending safety</p>
            <h2>Wallets</h2>
            <p>
              Manage payment rails by default, with runtime usage one click away when you need the bill of materials.
            </p>
          </div>
          <div className={walletClass("walletTotals")} aria-label="Wallet summary">
            <span>
              Can spend
              <strong>{walletStats.enabled}</strong>
            </span>
            <span>
              Available
              <strong>${walletStats.balance.toFixed(2)}</strong>
            </span>
            <span>
              Need funding
              <strong>{walletStats.critical}</strong>
            </span>
          </div>
        </div>

        <div className={walletClass("walletSegmented")} role="tablist" aria-label="Wallet panel mode">
          {[
            ["wallets", "Wallets"],
            ["usage", "Usage"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={walletPanelMode === mode}
              className={walletClass("walletSegment", walletPanelMode === mode && "walletSegmentActive")}
              onClick={() => setWalletPanelMode(mode as "wallets" | "usage")}
            >
              {label}
            </button>
          ))}
        </div>

        {walletPanelMode === "usage" ? (
        <section className={walletClass("usagePanel")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Runtime analytics</p>
              <h3 className="m-0 text-base font-bold">Token usage</h3>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => void refreshRuntimeUsage()} disabled={runtimeUsageLoading}>
              {runtimeUsageLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
              Refresh
            </Button>
          </div>
          {runtimeUsage?.error ? <p className="m-0 text-xs text-[#fecdd3]">{runtimeUsage.error}</p> : null}
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["Sessions", runtimeUsage?.totals?.sessions?.toLocaleString() ?? "0"],
              ["Tokens", runtimeUsage?.totals?.tokens?.toLocaleString() ?? "0"],
              ["Output", runtimeUsage?.totals?.outputTokens?.toLocaleString() ?? "0"],
              ["Est. cost", `$${(runtimeUsage?.totals?.estimatedCostUsd ?? 0).toFixed(4)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(15,23,42,0.55)] p-3">
                <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">{label}</span>
                <strong className="mt-1 block text-xl">{value}</strong>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <strong className="text-sm">Models</strong>
              <div className="mt-2 grid gap-2">
                {(runtimeUsage?.models ?? []).slice(0, 6).map((model) => (
                  <div key={model.model} className="flex items-center justify-between gap-3 rounded-md border border-[rgba(148,163,184,0.10)] px-3 py-2 text-xs">
                    <span className="min-w-0 break-words">{model.model}</span>
                    <b>{model.tokens.toLocaleString()}</b>
                  </div>
                ))}
                {runtimeUsage?.models?.length ? null : <p className="m-0 text-xs text-[var(--muted)]">No token rows found yet.</p>}
              </div>
            </div>
            <div>
              <strong className="text-sm">Recent sessions</strong>
              <div className="mt-2 grid gap-2">
                {(runtimeUsage?.rows ?? []).slice(0, 6).map((row) => (
                  <div key={`${row.runtime}-${row.sessionId}`} className="grid gap-1 rounded-md border border-[rgba(148,163,184,0.10)] px-3 py-2 text-xs">
                    <span className="font-semibold">{RUNTIME_LABELS[row.runtime]} · {row.model}</span>
                    <span className="text-[var(--muted)]">{row.totalTokens.toLocaleString()} tokens · {formatRelativeTime(Date.parse(row.updatedAt))}</span>
                  </div>
                ))}
                {runtimeUsage?.rows?.length ? null : <p className="m-0 text-xs text-[var(--muted)]">Hermes/OpenClaw usage appears here when local counters are readable.</p>}
              </div>
            </div>
          </div>
        </section>
        ) : null}

        {walletPanelMode === "wallets" ? (
        <div className={walletClass("walletWorkspace")}>
          {walletExpanded && selectedAgent && effectiveSelectedWallet && effectiveSelectedWalletSnapshot ? (
            (() => {
              const walletAction = walletActionsByAgent[selectedAgent.id] ?? {};
              const moneyClawEnvName = effectiveSelectedWallet.moneyClawEnvName?.trim() || "MONEYCLAW_API_KEY";
              return (
            <div className={walletClass("walletDetail")}>
              <button
                type="button"
                className={walletClass("walletBackBtn")}
                onClick={() => setWalletExpanded(false)}
              >
                <ChevronLeft aria-hidden="true" width={16} height={16} />
                All wallets
              </button>
              <AgentWalletCard
                agentName={selectedAgent.name}
                machineName={selectedAgent.machineName}
                agentUsePod={selectedAgent.usePod}
                wallet={effectiveSelectedWallet}
                survival={effectiveSelectedWalletSnapshot}
                honeyReward={selectedHoneyReward}
                honeyLedgerEnabled={honeyLedgerEnabled}
                providerCopy={AGENT_PAYMENT_PROVIDER_COPY[effectiveSelectedWallet.provider]}
                providerOptions={Object.entries(AGENT_PAYMENT_PROVIDER_COPY) as Array<[AgentPaymentProvider, typeof AGENT_PAYMENT_PROVIDER_COPY[AgentPaymentProvider]]>}
                moneyClawStatus={moneyClawStatusByEnvName[moneyClawEnvName] ?? null}
                walletAction={walletAction}
                onUpdateWallet={(patch) => updateWallet(selectedAgent.id, patch)}
                onUpdateAction={(patch) => updateWalletAction(selectedAgent.id, patch)}
                onSaveMoneyClawKey={(apiKey, options) => saveMoneyClawKey(selectedAgent.id, apiKey, options)}
                onUpdateUsePod={async (patch) => {
                  const nextUsePod = { ...(selectedAgent.usePod ?? {}), ...patch };
                  updateAgentProfile(selectedAgent.id, { usePod: nextUsePod });
                  await refreshRuntimeIntegrations({ ...selectedAgent, usePod: nextUsePod, provider: "usepod" });
                }}
                onResetRunway={() => resetWalletBurnClock(selectedAgent.id)}
                onCopyPaymentPrompt={() => copyPaymentPrompt(effectiveSelectedWallet)}
                onCreateLocalWallet={() => createLocalWallet(selectedAgent.id, effectiveSelectedWallet.network)}
                onRefreshBalance={() => { void (effectiveSelectedWallet.provider === "usepod" ? refreshUsePodWallet(selectedAgent) : refreshWalletBalance(selectedAgent.id)); }}
                onSendUsdc={() => sendWalletUsdc(selectedAgent.id)}
                onCallX402={() => testX402Fetch(selectedAgent.id)}
              />
            </div>
              );
            })()
          ) : displayAgents.length > 0 ? (
            <div className={walletClass("walletGridList")} role="list" aria-label="Agent wallets">
              {displayAgents.map((agent, agentIndex) => {
                const wallet = resolveAgentWallet(agent, walletsByAgent[agent.id] ?? createDefaultAgentWallet(agent.id));
                const snapshot = getSurvivalSnapshot(wallet);
                return (
                  <div role="listitem" key={renderAgentKey(agent, agentIndex)}>
                    <AgentWalletCardCompact
                      agentName={agent.name}
                      agentUsePod={agent.usePod}
                      wallet={wallet}
                      survival={snapshot}
                      onOpen={() => {
                        setSelectedAgentId(agent.id);
                        setWalletExpanded(true);
                      }}
                      onInitialize={async () => {
                        setSelectedAgentId(agent.id);
                        await initializeCoreWalletRails(agent.id);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={walletClass("walletEmpty")}>
              <strong>No agents yet</strong>
              <p>Connect an agent first, then configure its spending limits and survival rails.</p>
            </div>
          )}

          <aside className={walletClass("hiveRail", !honeyLedgerEnabled && "hiveRailDormant")} aria-label="Bankr rewards">
            <header className={walletClass("hiveRailHeader")}>
              <div>
                <p className="eyebrow">Bankr rewards</p>
                <h3>{honeyLedgerEnabled ? "Honey rewards" : "Honey rewards off"}</h3>
              </div>
              <Image
                className={walletClass("hiveRailPot")}
                src="/icons/generated/honey-pot.png"
                alt=""
                width={96}
                height={96}
                aria-hidden="true"
                priority
                unoptimized
              />
            </header>

            {honeyLedgerEnabled ? (
              <>
                <dl className={walletClass("hiveRailStats")}>
                  <div>
                    <dt>Total Honey</dt>
                    <dd>{formatHiveAmount(honeyStats.totalHoney)}</dd>
                  </div>
                  <div>
                    <dt>Ready to claim</dt>
                    <dd>{formatHiveAmount(honeyStats.availableHoney)}</dd>
                  </div>
                  <div>
                    <dt>Legacy HIVE</dt>
                    <dd>{formatHiveAmount(honeyStats.legacyHive)}</dd>
                  </div>
                </dl>

                <div className={walletClass("hiveRailRecipient")}>
                  <div className={walletClass("hiveRailRecipientHeader")}>
                    <label htmlFor="bankr-hive-recipient">Bankr receiving address</label>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void connectBaseWallet()}
                      disabled={bankrConnectBusy || bankrClaimBusy}
                    >
                      <HandCoins aria-hidden="true" />
                      {bankrConnectBusy ? "Connecting..." : "Connect Base wallet"}
                    </Button>
                  </div>
                  <input
                    id="bankr-hive-recipient"
                    type="text"
                    inputMode="text"
                    spellCheck={false}
                    value={bankrRecipientAddress}
                    onChange={(event) => {
                      setBankrRecipientAddress(event.target.value);
                      setBankrClaimStatus("");
                    }}
                    placeholder="0x..."
                    aria-invalid={bankrRecipientAddress.trim().length > 0 && !bankrRecipientReady}
                  />
                </div>

                <Button
                  type="button"
                  size="sm"
                  className={walletClass("hiveRailConvert")}
                  disabled={bankrClaimBusy || honeyStats.availableHoney <= 0 || !bankrRecipientReady}
                  onClick={() => void claimBankrHive()}
                  aria-label={`Claim ${formatHiveAmount(honeyStats.hiveQuote)} HIVE to your Bankr wallet`}
                >
                  <Image
                    className={walletClass("hiveRailConvertIcon")}
                    src="/icons/generated/honey-hive-icon.png"
                    alt=""
                    width={30}
                    height={30}
                    aria-hidden="true"
                    priority
                    unoptimized
                  />
                  <span>
                    <span>{bankrClaimBusy ? "Claiming Bankr HIVE..." : "Claim Bankr HIVE"}</span>
                    <span>{formatHiveAmount(honeyStats.availableHoney)} Honey → {formatHiveAmount(honeyStats.hiveQuote)} HIVE on Base</span>
                  </span>
                </Button>

                {bankrClaimStatus ? <p className={walletClass("hiveRailClaimStatus")}>{bankrClaimStatus}</p> : null}

                {honeyStats.legacyHive > 0 ? (
                  <div className={walletClass("hiveRailLegacy")}>
                    <p>
                      This is not Bankr HIVE. It is an old ledger-only conversion. Move it back to Honey.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={returnAllHiveToHoney}
                      aria-label={`Move ${formatHiveAmount(honeyStats.legacyHive)} legacy HIVE back to Honey`}
                    >
                      <RefreshCcw aria-hidden="true" />
                      Move back to Honey
                    </Button>
                  </div>
                ) : null}

                <details className={walletClass("hiveRailDetails")}>
                  <summary>Reward pool</summary>
                  <dl>
                    <div>
                      <dt>Pool size</dt>
                      <dd>
                        {formatHiveAmount(honeyStats.rewardPoolHive)} HIVE
                        <small>{formatHiveAmount(honeyStats.rewardPoolRemainingHive)} available to award</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Pool source</dt>
                      <dd>
                        {honeyStats.rewardPoolSharePercent.toFixed(4)}%
                        <small>of HIVE volume</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {formatHiveAmount(honeyStats.hivePerMillionTokens)}
                        <small>HIVE per 1M tokens</small>
                      </dd>
                    </div>
                  </dl>
                </details>
              </>
            ) : (
              <>
                <p className={walletClass("hiveRailBlurb")}>
                  Watch supported local runtimes for real token usage, earn Honey, then claim Bankr HIVE once payout settlement is wired.
                </p>
                <Button type="button" size="sm" onClick={enableHoneyLedger}>
                  <HandCoins aria-hidden="true" />
                  Enable Honey ledger
                </Button>
                <details className={walletClass("hiveRailDetails")}>
                  <summary>What gets sent?</summary>
                  <p>
                    Agent id, workspace id, token count, model label, source, event id, and timestamp.
                    Prompts, responses, files, wallet keys, and machine details are not sent.
                    Hermes CLI usage is read from Hermes' own token counters while the dashboard is running.
                  </p>
                </details>
              </>
            )}

            <details className={walletClass("hiveRailDetails")}>
              <summary>Encrypted wallet vault</summary>
              <dl>
                <div>
                  <dt>Local vault</dt>
                  <dd>
                    {walletVaultBackupStatus?.vaultExists ? `${walletVaultBackupStatus.recordCount} record${walletVaultBackupStatus.recordCount === 1 ? "" : "s"}` : "Not created"}
                    <small>{walletVaultBackupStatus?.envKeyConfigured ? "env key" : walletVaultBackupStatus?.keyExists ? "file key" : "no key"}</small>
                  </dd>
                </div>
                <div>
                  <dt>Shared vault</dt>
                  <dd>
                    {walletVaultBackupStatus?.backupExists ? "Ready" : "Missing"}
                    <small>{walletVaultBackupStatus?.updatedAt ? formatRelativeTime(Date.parse(walletVaultBackupStatus.updatedAt)) : "not refreshed"}</small>
                  </dd>
                </div>
                <div>
                  <dt>GPG</dt>
                  <dd>
                    {walletVaultBackupStatus?.gpgAvailable ? "Available" : "Missing"}
                    <small>{walletVaultBackupStatus?.recipientConfigured ? "recipient ready" : "recipient missing"}</small>
                  </dd>
                </div>
              </dl>
              <div className={walletClass("walletVaultActions")}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(walletVaultBackupBusy) || !walletVaultBackupStatus?.vaultExists || !walletVaultBackupStatus?.gpgAvailable || !walletVaultBackupStatus?.recipientConfigured}
                  onClick={() => runWalletVaultBackupAction("refresh")}
                >
                  <RefreshCcw aria-hidden="true" />
                  Sync
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(walletVaultBackupBusy) || !walletVaultBackupStatus?.backupExists || !walletVaultBackupStatus?.gpgAvailable}
                  onClick={() => runWalletVaultBackupAction("restore")}
                >
                  <Download aria-hidden="true" />
                  Restore
                </Button>
              </div>
              {walletVaultBackupMessage ? <p>{walletVaultBackupMessage}</p> : null}
            </details>

          </aside>
        </div>
        ) : null}
      </section>
      ) : null}

  </>);
}
