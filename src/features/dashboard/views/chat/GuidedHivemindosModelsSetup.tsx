"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Coins, Copy, LoaderCircle, Plus, RefreshCcw, Search, Wallet, X } from "lucide-react";
import type { AgentProfile, HivemindosModelsAgentConfig } from "@/lib/types/agent-runtime";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS,
  normalizeHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { fetchPersonalWalletBalance, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import { getDisplayWalletBalanceUsd, getSurvivalSnapshot, hasConfiguredAgentWallet } from "@/lib/utils/agent-wallet";
import { WalletSelectPanel, type PickableWallet } from "../trade/WalletSelectModal";
import {
  agentPickable,
  groupedUserPickables,
  isLocalPaymentSigningWallet,
  resolvePickableAccount,
  type PickableAgent,
} from "../trade/wallet-pickables";
import styles from "./HivemindosModelsSetup.module.css";

type SetupWallet = {
  vaultId: string;
  address: string;
  network: string;
  kind?: "personal" | "agent";
};

type SetupView = "setup" | "browse";

type ModelCreditState = {
  ok?: boolean;
  configured?: boolean;
  balanceUsd?: number | null;
  balanceLabel?: string;
  creditedUsd?: number;
  totalCreditedUsd?: number;
  totalDebitedUsd?: number;
  updatedAt?: string;
  message?: string;
  error?: string;
};

type GuidedHivemindosModelsSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  displayAgents?: PickableAgent[];
  walletsByAgent?: Record<string, unknown>;
  sharedVault?: { enabled?: boolean; vaultPath?: string } | null;
  onCancel: () => void;
  onComplete: (patch: Partial<AgentProfile>) => void | Promise<void>;
};

function networkLabel(network = "") {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network === "solana:mainnet") return "Solana";
  if (network === "solana:devnet") return "Solana devnet";
  if (network.startsWith("eip155:")) return "EVM";
  if (network.startsWith("solana:")) return "Solana";
  return network || "Unknown";
}

function walletAddressForPickable(pickable: PickableWallet): string {
  const wallet = pickable.wallet as unknown as Record<string, unknown>;
  return String(wallet.walletAddress || wallet.vaultAddress || wallet.address || "").trim();
}

function fundingKindForPickable(pickable: PickableWallet): HivemindosModelsAgentConfig["fundingWalletKind"] {
  return pickable.kind === "user" ? "personal" : "agent";
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(Math.max(0, value));
}

function CodeLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.code}>
        <code title={value}>{value}</code>
        <button
          type="button"
          className={styles.copy}
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export function GuidedHivemindosModelsSetup({
  agent,
  busy,
  displayAgents = [],
  walletsByAgent,
  sharedVault,
  onCancel,
  onComplete,
}: GuidedHivemindosModelsSetupProps) {
  const initialModel = normalizeHivemindosWalletPaidModel(agent?.model || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL);
  const [setupView, setSetupView] = useState<SetupView>("setup");
  const [creating, setCreating] = useState(false);
  const [personalBalancesLoading, setPersonalBalancesLoading] = useState(false);
  const [linkingWalletId, setLinkingWalletId] = useState("");
  const [message, setMessage] = useState("");
  const [personalWallets, setPersonalWallets] = useState<Array<Record<string, unknown>>>([]);
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [walletVaultId, setWalletVaultId] = useState(agent?.hivemindosModels?.walletVaultId ?? "");
  const [walletAddress, setWalletAddress] = useState(agent?.hivemindosModels?.walletAddress ?? "");
  const [walletNetwork, setWalletNetwork] = useState(agent?.hivemindosModels?.walletNetwork ?? "");
  const [creditState, setCreditState] = useState<ModelCreditState>({});
  const [creditRefreshing, setCreditRefreshing] = useState(false);
  const [creditFunding, setCreditFunding] = useState(false);

  const vaultPath = sharedVault?.enabled ? String(sharedVault.vaultPath || "").trim() : "";
  const isBusy = creating || Boolean(linkingWalletId) || busy === "hivemindos-models-setup";

  useEffect(() => {
    let ignore = false;
    void Promise.resolve().then(async () => {
      if (ignore) return;
      setPersonalBalancesLoading(true);
      const records = await fetchPersonalWalletRecords(vaultPath);
      return Promise.all(records.map(async (record) => {
        const address = String(record.address || "").trim();
        const network = String(record.network || "").trim();
        if (!address || !network) return record;
        const balance = await fetchPersonalWalletBalance(address, network);
        return balance ? {
          ...record,
          currentBalanceUsd: balance.currentBalanceUsd,
          nativeBalance: balance.nativeBalance,
          tokens: balance.tokens,
          lastOnchainSyncAt: balance.lastOnchainSyncAt,
          updatedAt: Date.now(),
        } : record;
      }));
    })
      .then((records) => { if (!ignore && Array.isArray(records)) setPersonalWallets(records); })
      .catch(() => { if (!ignore) setPersonalWallets([]); })
      .finally(() => { if (!ignore) setPersonalBalancesLoading(false); });
    return () => { ignore = true; };
  }, [vaultPath]);

  const walletPickables = useMemo<PickableWallet[]>(() => {
    const userPickables = groupedUserPickables(personalWallets, { accountFilter: isLocalPaymentSigningWallet })
      .map((pickable) => ({ ...pickable, pending: personalBalancesLoading }));
    const agentPickables = displayAgents.flatMap((candidate) => {
      const pickable = agentPickable(candidate, walletsByAgent);
      if (!hasConfiguredAgentWallet(candidate as Parameters<typeof hasConfiguredAgentWallet>[0], pickable.wallet)) return [];
      if ((pickable.wallet as unknown as { setupRequired?: boolean }).setupRequired) return [];
      if (!isLocalPaymentSigningWallet(pickable.wallet)) return [];
      return [{ ...pickable, statusOverride: { tone: "ok" as const, text: "Agent wallet" } }];
    });
    return [...userPickables, ...agentPickables];
  }, [displayAgents, personalBalancesLoading, personalWallets, walletsByAgent]);

  const selfFundingPickable = agent?.id ? resolvePickableAccount(walletPickables, agent.id) : null;
  const selfFundingAddress = !walletVaultId && selfFundingPickable?.kind === "agent" ? walletAddressForPickable(selfFundingPickable) : "";
  const effectiveWalletVaultId = walletVaultId || (selfFundingAddress ? selfFundingPickable?.id ?? "" : "");
  const effectiveWalletAddress = walletAddress || selfFundingAddress;
  const effectiveWalletNetwork = walletNetwork || (selfFundingAddress ? selfFundingPickable?.wallet.network ?? "" : "");
  const walletReady = Boolean(effectiveWalletVaultId && effectiveWalletAddress);
  const currentWalletId = effectiveWalletVaultId;
  const savedFundingPickable = effectiveWalletVaultId ? resolvePickableAccount(walletPickables, effectiveWalletVaultId) : null;
  const savedFundingBalanceUsd = savedFundingPickable ? getDisplayWalletBalanceUsd(savedFundingPickable.wallet) : null;
  const savedFundingBalanceCopy = savedFundingPickable?.pending
    ? "Refreshing balance"
    : savedFundingBalanceUsd !== null
      ? `Balance ${formatUsd(savedFundingBalanceUsd)}`
      : "";
  const savedFundingHelp = savedFundingPickable?.pending
    ? `Refreshing this wallet's live balance on ${networkLabel(effectiveWalletNetwork)}.`
    : savedFundingBalanceUsd !== null && savedFundingBalanceUsd > 0
      ? `${formatUsd(savedFundingBalanceUsd)} is available for HivemindOS Models. Add more USDC and native gas here when you want more runway.`
      : `Fund this address with USDC and enough native gas for payments on ${networkLabel(effectiveWalletNetwork)}.`;
  const modelCreditLabel = creditRefreshing && creditState.balanceUsd == null
    ? "Checking credits"
    : typeof creditState.balanceUsd === "number"
      ? `Model credits ${formatUsd(creditState.balanceUsd)}`
      : creditState.configured === false
        ? "No model credits yet"
        : agent?.hivemindosModels?.lastCreditBalanceLabel
          ? `Model credits ${agent.hivemindosModels.lastCreditBalanceLabel}`
          : "Model credits unknown";
  const modelCreditHelp = creditState.error
    ? creditState.error
    : creditState.message
      ? creditState.message
      : creditState.configured === false
        ? "Top up once to let this wallet pay future model calls from a prepaid hosted balance."
        : "Future model calls debit this hosted balance before asking the wallet to sign a new payment.";

  useEffect(() => {
    if (!walletReady || !effectiveWalletVaultId) {
      return undefined;
    }
    let ignore = false;
    const params = new URLSearchParams({ walletVaultId: effectiveWalletVaultId });
    void fetch(`/api/hivemindos/models/credits?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json().catch(() => ({ ok: false, error: `Credit balance returned HTTP ${response.status}.` })))
      .then((data: ModelCreditState) => {
        if (!ignore) setCreditState(data ?? {});
      })
      .catch((error) => {
        if (!ignore) setCreditState({ ok: false, error: error instanceof Error ? error.message : "Could not read model credits." });
      });
    return () => { ignore = true; };
  }, [effectiveWalletVaultId, walletReady]);

  function profilePatch(config: Partial<HivemindosModelsAgentConfig> = {}, model = selectedModel): Partial<AgentProfile> {
    const nextWalletVaultId = config.walletVaultId ?? effectiveWalletVaultId;
    const nextWalletAddress = config.walletAddress ?? effectiveWalletAddress;
    const nextWalletNetwork = config.walletNetwork ?? effectiveWalletNetwork;
    const now = new Date().toISOString();
    return {
      provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
      model: normalizeHivemindosWalletPaidModel(model),
      token: "",
      hivemindosModels: {
        walletVaultId: nextWalletVaultId,
        walletAddress: nextWalletAddress,
        walletNetwork: nextWalletNetwork,
        lastCheckedAt: now,
        lastTestStatus: nextWalletVaultId && nextWalletAddress ? "ready" : "needs-wallet",
        lastStatusMessage: nextWalletVaultId && nextWalletAddress
          ? "Wallet is saved for HivemindOS Models."
          : "Choose or create a wallet for HivemindOS Models.",
        lastCreditBalanceUsd: agent?.hivemindosModels?.lastCreditBalanceUsd,
        lastCreditBalanceLabel: agent?.hivemindosModels?.lastCreditBalanceLabel,
        lastCreditCheckedAt: agent?.hivemindosModels?.lastCreditCheckedAt,
        fundingWalletKind: config.fundingWalletKind ?? (nextWalletVaultId.startsWith("user:") ? "personal" : "agent"),
        ...config,
      },
    };
  }

  async function applyModel(model: string) {
    const normalized = normalizeHivemindosWalletPaidModel(model);
    setSelectedModel(normalized);
    setMessage("");
    try {
      await onComplete(profilePatch({}, normalized));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update HivemindOS Models settings.");
    }
  }

  async function createWallet() {
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          agentId: agent?.id,
          agentName: agent?.name,
          network: "eip155:8453",
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallet?: SetupWallet } | null;
      if (!response.ok || !data?.ok || !data.wallet) {
        setMessage(data?.error ?? `HivemindOS wallet creation failed with HTTP ${response.status}.`);
        return;
      }
      setWalletVaultId(data.wallet.vaultId);
      setWalletAddress(data.wallet.address);
      setWalletNetwork(data.wallet.network);
      setSetupView("setup");
      const patch = profilePatch({
        walletVaultId: data.wallet.vaultId,
        walletAddress: data.wallet.address,
        walletNetwork: data.wallet.network,
        fundingWalletKind: data.wallet.kind ?? "agent",
        fundingWalletLabel: "This agent wallet",
        lastTestStatus: "ready",
        lastStatusMessage: "Wallet saved. It now appears in Wallets.",
      });
      await onComplete(patch);
      setMessage("Wallet saved. It now appears in Wallets.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HivemindOS wallet creation failed.");
    } finally {
      setCreating(false);
    }
  }

  function openWalletBrowser() {
    setMessage("");
    setSetupView("browse");
  }

  async function linkWallet(pickable: PickableWallet) {
    if (linkingWalletId) return;
    setLinkingWalletId(pickable.id);
    setMessage("");
    const address = walletAddressForPickable(pickable);
    if (!address) {
      setLinkingWalletId("");
      setMessage("Choose a wallet with a local signing address.");
      return;
    }
    try {
      const response = await fetch("/api/hivemindos/models/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          walletVaultId: pickable.id,
          agentId: agent?.id,
          agentName: agent?.name,
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallet?: SetupWallet } | null;
      if (!response.ok || !data?.ok || !data.wallet) {
        setMessage(data?.error ?? `Could not link wallet with HTTP ${response.status}.`);
        return;
      }
      setWalletVaultId(data.wallet.vaultId);
      setWalletAddress(data.wallet.address);
      setWalletNetwork(data.wallet.network);
      setSetupView("setup");
      await onComplete(profilePatch({
        walletVaultId: data.wallet.vaultId,
        walletAddress: data.wallet.address,
        walletNetwork: data.wallet.network,
        fundingWalletKind: data.wallet.kind ?? fundingKindForPickable(pickable),
        fundingWalletLabel: pickable.name,
        lastTestStatus: "ready",
        lastStatusMessage: "Wallet linked and saved to Wallets.",
      }));
      setMessage("Wallet linked and saved to Wallets.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not link wallet.");
    } finally {
      setLinkingWalletId("");
    }
  }

  function linkSelectedWallet(selectedId: string) {
    const wallet = resolvePickableAccount(walletPickables, selectedId);
    if (!wallet) {
      setMessage("Choose a Base or Solana wallet that can sign model payments.");
      return;
    }
    void linkWallet(wallet);
  }

  async function refreshModelCredits() {
    if (!effectiveWalletVaultId) return;
    setCreditRefreshing(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ walletVaultId: effectiveWalletVaultId });
      const response = await fetch(`/api/hivemindos/models/credits?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as ModelCreditState | null;
      if (!response.ok || !data?.ok) {
        setCreditState({ ok: false, error: data?.error ?? `Credit balance returned HTTP ${response.status}.` });
        return;
      }
      setCreditState(data);
    } catch (error) {
      setCreditState({ ok: false, error: error instanceof Error ? error.message : "Could not read model credits." });
    } finally {
      setCreditRefreshing(false);
    }
  }

  async function topUpModelCredits() {
    if (!effectiveWalletVaultId) return;
    setCreditFunding(true);
    setMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletVaultId: effectiveWalletVaultId }),
      });
      const data = await response.json().catch(() => null) as ModelCreditState | null;
      if (!response.ok || !data?.ok) {
        const error = data?.error ?? `Credit top-up failed with HTTP ${response.status}.`;
        setCreditState((current) => ({ ...current, ok: false, error }));
        setMessage(error);
        return;
      }
      setCreditState(data);
      const balanceLabel = data.balanceLabel ?? (typeof data.balanceUsd === "number" ? formatUsd(data.balanceUsd) : "");
      await onComplete(profilePatch({
        lastCreditBalanceUsd: typeof data.balanceUsd === "number" ? String(data.balanceUsd) : "",
        lastCreditBalanceLabel: balanceLabel,
        lastCreditCheckedAt: new Date().toISOString(),
        lastTestStatus: "ready",
        lastStatusMessage: data.message || "HivemindOS Models credits funded.",
      }));
      setMessage(data.message || "HivemindOS Models credits funded.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not top up model credits.";
      setCreditState((current) => ({ ...current, ok: false, error: errorMessage }));
      setMessage(errorMessage);
    } finally {
      setCreditFunding(false);
    }
  }

  async function finishSetup() {
    setMessage("");
    try {
      await onComplete(profilePatch());
      onCancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not finish HivemindOS Models setup.");
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div className={styles.brandIcon}>
          <Wallet aria-hidden="true" />
        </div>
        <div className={styles.headText}>
          <h2>HivemindOS Models wallet</h2>
          <p>{walletReady ? "Wallet-paid inference is ready for this agent." : "Attach a wallet for per-call crypto settlement."}</p>
        </div>
        <button type="button" className={styles.closeButton} aria-label="Close HivemindOS Models setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </button>
      </div>

      <div className={`${styles.body} ${setupView === "browse" ? styles.bodyBrowse : ""}`}>
        {setupView === "browse" ? (
          <div className={styles.browseStack}>
            <WalletSelectPanel
              pickables={walletPickables}
              getSurvivalSnapshot={getSurvivalSnapshot}
              currentId={currentWalletId}
              onConfirm={linkSelectedWallet}
              onCancel={() => setSetupView("setup")}
              title="Link a funding wallet"
              subtitle="Pick one of your local wallets or a configured agent wallet. Balances match the Wallets and Trade views."
              confirmLabel={linkingWalletId ? "Linking wallet" : "Use for LLM calls"}
              cancelLabel="Back"
              confirmDisabled={isBusy}
              emptyCopy={personalBalancesLoading ? "Loading local wallets..." : "No local signing wallets were found."}
              panelClassName={styles.walletSelectorEmbed}
            />
          </div>
        ) : (
          <>
            <section className={`${styles.panel} ${styles.paymentPanel}`}>
              <span className={styles.eyebrow}>Payment wallet</span>
              <h3>{walletReady ? "Wallet saved" : "Choose a wallet"}</h3>
              {walletReady ? (
                <>
                  <div className={styles.status}>
                    <span className={styles.stat}><Wallet aria-hidden="true" /><b>{networkLabel(effectiveWalletNetwork)}</b></span>
                    <span className={styles.stat} data-tone="live"><Check aria-hidden="true" /><b>Saved to Wallets</b></span>
                    {savedFundingBalanceCopy ? (
                      <span className={styles.stat} data-tone={savedFundingBalanceUsd && savedFundingBalanceUsd > 0 ? "live" : "balance"}><b>{savedFundingBalanceCopy}</b></span>
                    ) : null}
                  </div>
                  <CodeLine label="Funding address" value={effectiveWalletAddress} />
                  <p className={styles.muted}>{savedFundingHelp}</p>
                  <div className={styles.creditBox}>
                    <div className={styles.creditMain}>
                      <span className={styles.creditIcon}><Coins aria-hidden="true" /></span>
                      <div className={styles.creditText}>
                        <span className={styles.fieldLabel}>Model credits</span>
                        <strong>{modelCreditLabel}</strong>
                        <span>{modelCreditHelp}</span>
                      </div>
                    </div>
                    <div className={styles.creditActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.ghost} ${styles.iconOnly}`}
                        disabled={creditRefreshing || creditFunding}
                        aria-label="Refresh HivemindOS Models credits"
                        onClick={() => void refreshModelCredits()}
                      >
                        <RefreshCcw className={creditRefreshing ? styles.spin : ""} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.primary}`}
                        disabled={isBusy || creditRefreshing || creditFunding}
                        onClick={() => void topUpModelCredits()}
                      >
                        {creditFunding ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
                        Top up credits
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.muted}>Create a fresh Base wallet for this agent, or link a local wallet already stored by HivemindOS.</p>
                  <div className={styles.actionRow}>
                    <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={isBusy} onClick={() => void createWallet()}>
                      {creating ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
                      New wallet
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={isBusy} onClick={openWalletBrowser}>
                      <Search aria-hidden="true" />
                      Existing wallet
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className={`${styles.panel} ${styles.modelPanel}`}>
              <span className={styles.eyebrow}>Model route</span>
              <h3>Route preference</h3>
              <div className={styles.models}>
                {HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={styles.model}
                    data-active={selectedModel === model.id || undefined}
                    aria-pressed={selectedModel === model.id}
                    onClick={() => void applyModel(model.id)}
                  >
                    <span>{model.name}</span>
                  </button>
                ))}
              </div>
              <p className={styles.muted}>{HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.find((model) => model.id === selectedModel)?.subtitle ?? "Best wallet-paid route"}</p>
            </section>
          </>
        )}
      </div>

      <div className={styles.foot}>
        <div className={styles.msg}>{message || (walletReady ? "This wallet is durable even if agent setup is canceled." : "Wallets are saved as soon as they are created or linked.")}</div>
        <div className={styles.footActions}>
          {walletReady ? (
            <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={isBusy} onClick={openWalletBrowser}>
              Change wallet
            </button>
          ) : null}
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!walletReady || isBusy} onClick={() => void finishSetup()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
