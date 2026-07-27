"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { WalletActionInput } from "@/components/wallets-drop-in/CreateImportWalletModal";
import { MULTI_CHAIN_WALLET_LABEL, personalWalletNetworkForChainLabel } from "@/lib/config/personal-wallet-chains";
import { fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import {
  isOfficialMiniAppOrigin,
  miniAppWalletErrorResponse,
  miniAppWalletResponse,
  parseMiniAppWalletRequest,
  parsePersonalSignParams,
  parseRobinhoodUsdgTransferParams,
  parseTestnetFaucetRequestParams,
  type MiniAppWalletRpcRequest,
  type MiniAppWalletRpcResponse,
} from "@/lib/services/mini-app-wallet-bridge";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet, getSurvivalSnapshot, hasConfiguredAgentWallet } from "@/lib/utils/agent-wallet";
import { recoveryPhraseWalletGroupId } from "@/lib/utils/personal-wallet-grouping";
import { fetchBankrWallet } from "@/features/dashboard/views/trade/trade-api";
import { sendApprovedPersonalWalletAsset } from "@/lib/services/wallet/send-usdc-client";
import { WalletSelectModal, type PickableWallet } from "@/features/dashboard/views/trade/WalletSelectModal";
import {
  agentPickable,
  groupedUserPickables,
  resolvePickableAccount,
  type PickableAgent,
} from "@/features/dashboard/views/trade/wallet-pickables";

type MiniAppWalletBridgeProps = {
  activeAppUrl: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  agents?: PickableAgent[];
  walletsByAgent?: Record<string, unknown>;
  vaultPath?: string;
};

type SelectedSigningWallet = {
  walletId: string;
  kind: "local" | "bankr";
  address: string;
  network: string;
};

const PAID_AGENT_GATEWAY = process.env.NEXT_PUBLIC_PAID_AGENT_GATEWAY_API
  || "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev";

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function withSigningStatus(pickable: PickableWallet): PickableWallet {
  const wallet = pickable.wallet as AgentWalletConfig & { setupRequired?: boolean };
  const canSign = wallet.network.startsWith("eip155:")
    && isEvmAddress(wallet.walletAddress)
    && (pickable.kind === "bankr" || wallet.custodyMode === "local");
  return {
    ...pickable,
    statusOverride: canSign
      ? pickable.statusOverride ?? { tone: "ok", text: pickable.kind === "agent" ? "Agent wallet" : "Local wallet" }
      : { tone: "muted", text: wallet.custodyMode === "watch" ? "Watch only" : "Cannot sign" },
  };
}

export function MiniAppWalletBridge({ activeAppUrl, frameRef, agents = [], walletsByAgent = {}, vaultPath = "" }: MiniAppWalletBridgeProps) {
  const [pickables, setPickables] = useState<PickableWallet[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<MiniAppWalletRpcRequest | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<SelectedSigningWallet | null>(null);
  const selectedWalletRef = useRef<SelectedSigningWallet | null>(null);
  const selectionConfirmedRef = useRef(false);
  const activeChainRef = useRef("0x2105");
  const miniAppOrigin = useMemo(() => {
    try { return new URL(activeAppUrl).origin; } catch { return ""; }
  }, [activeAppUrl]);

  const postResponse = useCallback((response: MiniAppWalletRpcResponse) => {
    if (!miniAppOrigin || !isOfficialMiniAppOrigin(miniAppOrigin)) return;
    frameRef.current?.contentWindow?.postMessage(response, miniAppOrigin);
  }, [frameRef, miniAppOrigin]);

  const loadWallets = useCallback(async () => {
    setLoadingWallets(true);
    try {
      const [personalWallets, bankr] = await Promise.all([
        fetchPersonalWalletRecords(vaultPath),
        fetchBankrWallet(),
      ]);
      const userPickables = groupedUserPickables(personalWallets, {
        accountFilter: (wallet) => wallet.network.startsWith("eip155:"),
      }).map(withSigningStatus);
      const bankrPickables: PickableWallet[] = bankr?.configured && isEvmAddress(bankr.address || "") ? [{
        id: "bankr",
        name: "Bankr trading wallet",
        kind: "bankr",
        wallet: {
          ...createDefaultAgentWallet("bankr"),
          walletAddress: bankr.address || "",
          network: "eip155:8453",
          enabled: true,
          currentBalanceUsd: Number(bankr.balanceUsd) || 0,
        } as AgentWalletConfig,
        statusOverride: { tone: "ok", text: "Bankr-managed" },
      }] : [];
      const agentPickables = agents
        .map((agent) => agentPickable(agent, walletsByAgent))
        .filter((pickable) => hasConfiguredAgentWallet({ usePod: pickable.usePod } as Parameters<typeof hasConfiguredAgentWallet>[0], pickable.wallet))
        .filter((pickable) => !(pickable.wallet as AgentWalletConfig & { setupRequired?: boolean }).setupRequired)
        .map(withSigningStatus);
      setPickables([...userPickables, ...bankrPickables, ...agentPickables]);
    } finally {
      setLoadingWallets(false);
    }
  }, [agents, vaultPath, walletsByAgent]);

  useEffect(() => {
    void Promise.resolve().then(loadWallets);
  }, [loadWallets]);

  const walletActions = useMemo(() => ({
    onCreateWallet: async (input: WalletActionInput) => {
      const chain = String(input.chain || MULTI_CHAIN_WALLET_LABEL);
      const multiChain = chain === MULTI_CHAIN_WALLET_LABEL;
      const response = await fetch("/api/wallet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: `user:${globalThis.crypto?.randomUUID?.() || Date.now()}`,
          createKind: multiChain ? "multi-chain" : "single-network",
          network: multiChain ? undefined : personalWalletNetworkForChainLabel(chain),
          name: input.name,
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not create wallet.");
      return data;
    },
    onImportWallet: async (input: WalletActionInput) => {
      const secret = String(input.secret || "").trim();
      const recoveryPhrase = secret.split(/\s+/).length >= 12;
      const chain = String(input.chain || MULTI_CHAIN_WALLET_LABEL);
      const multiChain = chain === MULTI_CHAIN_WALLET_LABEL;
      if (multiChain && !recoveryPhrase) throw new Error("Multi-chain import requires a recovery phrase.");
      const accountIndex = Number.isInteger(Number(input.accountIndex)) && Number(input.accountIndex) >= 0 ? Number(input.accountIndex) : 0;
      const newWalletId = `user:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      const response = await fetch("/api/wallet/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: recoveryPhrase ? recoveryPhraseWalletGroupId(newWalletId, accountIndex) : newWalletId,
          network: multiChain ? undefined : personalWalletNetworkForChainLabel(chain),
          name: input.name,
          secret,
          importKind: recoveryPhrase ? "recovery-phrase" : "private-key",
          importTarget: multiChain ? "multi-chain" : "single-network",
          accountIndex,
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not import wallet.");
      return data;
    },
  }), [vaultPath]);

  const signMessage = useCallback(async (request: MiniAppWalletRpcRequest) => {
    const parsed = parsePersonalSignParams(request.params);
    if (!parsed) {
      postResponse(miniAppWalletErrorResponse(request.requestId, "The mini app sent an invalid signature request."));
      return;
    }
    const signingWallet = selectedWalletRef.current;
    if (!signingWallet || parsed.address.toLowerCase() !== signingWallet.address.toLowerCase()) {
      postResponse(miniAppWalletErrorResponse(request.requestId, "Choose the wallet again before signing."));
      return;
    }
    const response = await fetch("/api/mini-apps/wallet/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...signingWallet, message: parsed.message }),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; signature?: string; error?: string } | null;
    if (!response.ok || !data?.ok || !data.signature) {
      postResponse(miniAppWalletErrorResponse(request.requestId, data?.error || "HivemindOS could not sign the wallet message."));
      return;
    }
    postResponse(miniAppWalletResponse(request.requestId, data.signature));
  }, [postResponse]);

  const sendRobinhoodUsdg = useCallback(async (request: MiniAppWalletRpcRequest) => {
    const transfer = parseRobinhoodUsdgTransferParams(request.params);
    const signingWallet = selectedWalletRef.current;
    if (!transfer || !signingWallet || signingWallet.kind !== "local" || signingWallet.network !== "eip155:4663") {
      postResponse(miniAppWalletErrorResponse(request.requestId, "Only confirmed USDG payments from a selected local Robinhood Chain wallet are supported."));
      return;
    }
    if (transfer.from !== signingWallet.address.toLowerCase()) {
      postResponse(miniAppWalletErrorResponse(request.requestId, "The USDG payment source does not match the selected wallet."));
      return;
    }
    const configResponse = await fetch(`${PAID_AGENT_GATEWAY}/api/payments/robinhood-usdg`, { cache: "no-store" });
    const config = await configResponse.json().catch(() => null) as { ok?: boolean; chainId?: number; token?: string; recipient?: string; error?: string } | null;
    if (!configResponse.ok || !config?.ok || config.chainId !== 4663
      || config.token?.toLowerCase() !== transfer.tokenAddress
      || config.recipient?.toLowerCase() !== transfer.recipient) {
      postResponse(miniAppWalletErrorResponse(request.requestId, config?.error || "The official Robinhood USDG payment recipient could not be verified."));
      return;
    }
    const approved = window.confirm(`Send ${transfer.amountUsdg} USDG on Robinhood Chain to ${transfer.recipient}?\n\nThis funds an official HivemindOS Mini payment claim.`);
    if (!approved) {
      postResponse(miniAppWalletErrorResponse(request.requestId, "USDG payment was canceled."));
      return;
    }
    const result = await sendApprovedPersonalWalletAsset({
      agentId: signingWallet.walletId,
      toAddress: transfer.recipient,
      asset: "USDG",
      assetAmount: transfer.amountUsdg,
      tokenAddress: transfer.tokenAddress,
      confirmation: "SEND_TOKEN",
    });
    if (!result.ok || !result.signature) {
      postResponse(miniAppWalletErrorResponse(request.requestId, result.error || "HivemindOS could not send the USDG payment."));
      return;
    }
    postResponse(miniAppWalletResponse(request.requestId, result.signature));
  }, [postResponse]);

  const requestTestnetFaucet = useCallback(async (request: MiniAppWalletRpcRequest) => {
    const faucet = parseTestnetFaucetRequestParams(request.params);
    const signingWallet = selectedWalletRef.current;
    if (!faucet || !signingWallet || signingWallet.kind !== "local" || signingWallet.network !== "eip155:8453") {
      postResponse(miniAppWalletErrorResponse(request.requestId, "Choose a confirmed local Base wallet for this faucet payment."));
      return;
    }

    const catalogResponse = await fetch(`${PAID_AGENT_GATEWAY}/api/x402/testnet-faucet/assets`, { cache: "no-store" });
    const catalog = await catalogResponse.json().catch(() => null) as {
      available?: Array<{
        network?: string;
        networkLabel?: string;
        asset?: string;
        assetLabel?: string;
        amount?: string;
        priceUsd?: number;
      }>;
      error?: string;
    } | null;
    const pair = catalog?.available?.find((entry) => entry.network === faucet.network && entry.asset === faucet.asset);
    const priceUsd = Number(pair?.priceUsd);
    if (!catalogResponse.ok || !pair || !Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 0.99) {
      postResponse(miniAppWalletErrorResponse(request.requestId, catalog?.error || "The official faucet route and price could not be verified."));
      return;
    }

    const approved = window.confirm(
      `Request ${pair.amount} ${pair.assetLabel} on ${pair.networkLabel} for ${faucet.recipient}?\n\nPay up to $${priceUsd.toFixed(2)} USDC on Base for HivemindOS programmatic routing. Test tokens are free and have no monetary value.`,
    );
    if (!approved) {
      postResponse(miniAppWalletErrorResponse(request.requestId, "The faucet payment was canceled."));
      return;
    }

    const response = await fetch("/api/mini-apps/testnet-faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...signingWallet,
        ...faucet,
        confirmation: "TESTNET_FAUCET",
      }),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; faucet?: unknown; error?: string } | null;
    if (!response.ok || !data?.ok || !data.faucet) {
      postResponse(miniAppWalletErrorResponse(request.requestId, data?.error || "HivemindOS could not complete the faucet payment."));
      return;
    }
    postResponse(miniAppWalletResponse(request.requestId, data.faucet));
  }, [postResponse]);

  useEffect(() => {
    if (!miniAppOrigin || !isOfficialMiniAppOrigin(miniAppOrigin)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== miniAppOrigin || event.source !== frameRef.current?.contentWindow) return;
      const request = parseMiniAppWalletRequest(event.data);
      if (!request) return;
      if (request.method === "eth_requestAccounts") {
        selectionConfirmedRef.current = false;
        setPendingRequest(request);
        void loadWallets();
        return;
      }
      if (request.method === "eth_chainId") {
        postResponse(miniAppWalletResponse(request.requestId, activeChainRef.current));
        return;
      }
      if (request.method === "wallet_switchEthereumChain") {
        const requestedChain = Array.isArray(request.params) && request.params[0] && typeof request.params[0] === "object"
          ? String((request.params[0] as Record<string, unknown>).chainId || "").toLowerCase()
          : "";
        const requestedNetwork = requestedChain === "0x2105" ? "eip155:8453" : requestedChain === "0x1237" ? "eip155:4663" : "";
        const selected = selectedWalletRef.current;
        if (!requestedNetwork) {
          postResponse(miniAppWalletErrorResponse(request.requestId, "Mini-app wallet linking supports Base and Robinhood Chain."));
        } else if (selected && selected.network !== requestedNetwork) {
          postResponse(miniAppWalletErrorResponse(request.requestId, `Choose a ${requestedChain === "0x1237" ? "Robinhood Chain" : "Base"} wallet for this action.`));
        } else {
          activeChainRef.current = requestedChain;
          postResponse(miniAppWalletResponse(request.requestId, null));
        }
        return;
      }
      if (request.method === "eth_sendTransaction") {
        void sendRobinhoodUsdg(request).catch((error) => {
          postResponse(miniAppWalletErrorResponse(request.requestId, error instanceof Error ? error.message : "USDG payment failed."));
        });
        return;
      }
      if (request.method === "hivemindos_requestTestnetFaucet") {
        void requestTestnetFaucet(request).catch((error) => {
          postResponse(miniAppWalletErrorResponse(request.requestId, error instanceof Error ? error.message : "The faucet request failed."));
        });
        return;
      }
      void signMessage(request).catch((error) => {
        postResponse(miniAppWalletErrorResponse(request.requestId, error instanceof Error ? error.message : "Wallet signing failed."));
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, loadWallets, miniAppOrigin, postResponse, requestTestnetFaucet, sendRobinhoodUsdg, signMessage]);

  const cancelSelection = () => {
    if (selectionConfirmedRef.current) {
      selectionConfirmedRef.current = false;
      return;
    }
    if (pendingRequest) postResponse(miniAppWalletErrorResponse(pendingRequest.requestId, "Wallet selection was cancelled."));
    setPendingRequest(null);
  };

  const confirmSelection = (selectedId: string) => {
    if (!pendingRequest) return;
    const pickable = resolvePickableAccount(pickables, selectedId);
    const address = String(pickable?.wallet.walletAddress || "").trim();
    const canSign = pickable && pickable.wallet.network.startsWith("eip155:")
      && isEvmAddress(address)
      && (pickable.kind === "bankr" || pickable.wallet.custodyMode === "local");
    if (!pickable || !canSign) {
      postResponse(miniAppWalletErrorResponse(pendingRequest.requestId, "That wallet cannot sign mini-app messages."));
      setPendingRequest(null);
      return;
    }
    selectionConfirmedRef.current = true;
    const signingWallet: SelectedSigningWallet = {
      walletId: pickable.id,
      kind: pickable.kind === "bankr" ? "bankr" : "local",
      address,
      network: pickable.wallet.network,
    };
    activeChainRef.current = pickable.wallet.network === "eip155:4663" ? "0x1237" : "0x2105";
    selectedWalletRef.current = signingWallet;
    setSelectedWallet(signingWallet);
    postResponse(miniAppWalletResponse(pendingRequest.requestId, [address]));
    setPendingRequest(null);
  };

  return pendingRequest ? (
    <WalletSelectModal
      pickables={pickables}
      getSurvivalSnapshot={getSurvivalSnapshot}
      currentId={selectedWallet?.walletId || ""}
      onConfirm={confirmSelection}
      onClose={cancelSelection}
      title="Link a wallet"
      subtitle="Choose the wallet that should identify you to this HivemindOS mini app. Keys stay in HivemindOS."
      confirmLabel="Link wallet"
      walletActions={walletActions}
      onWalletsChanged={loadWallets}
      loading={loadingWallets && !pickables.length}
    />
  ) : null;
}
