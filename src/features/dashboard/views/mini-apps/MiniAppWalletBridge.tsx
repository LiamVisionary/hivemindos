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
  type MiniAppWalletRpcRequest,
  type MiniAppWalletRpcResponse,
} from "@/lib/services/mini-app-wallet-bridge";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet, getSurvivalSnapshot, hasConfiguredAgentWallet } from "@/lib/utils/agent-wallet";
import { recoveryPhraseWalletGroupId } from "@/lib/utils/personal-wallet-grouping";
import { fetchBankrWallet } from "@/features/dashboard/views/trade/trade-api";
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
};

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
        postResponse(miniAppWalletResponse(request.requestId, "0x2105"));
        return;
      }
      if (request.method === "wallet_switchEthereumChain") {
        const requestedChain = Array.isArray(request.params) && request.params[0] && typeof request.params[0] === "object"
          ? String((request.params[0] as Record<string, unknown>).chainId || "").toLowerCase()
          : "";
        postResponse(requestedChain === "0x2105"
          ? miniAppWalletResponse(request.requestId, null)
          : miniAppWalletErrorResponse(request.requestId, "Mini-app wallet linking is limited to Base."));
        return;
      }
      void signMessage(request).catch((error) => {
        postResponse(miniAppWalletErrorResponse(request.requestId, error instanceof Error ? error.message : "Wallet signing failed."));
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, loadWallets, miniAppOrigin, postResponse, signMessage]);

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
    };
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
