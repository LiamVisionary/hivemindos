// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useMemo } from "react";
import { nativeRuntimeFileRequest } from "@/lib/native/runtime-files";
import { readNativeRuntimeUsage } from "@/lib/native/runtime-usage";

export function useWalletFilesController(props: any) {
  const { buildAgentPaymentPrompt, createDefaultAgentWallet, createDefaultHoneyTreasuryConfig, displayAgents, duplicateAgentDraft, agents, honeyLedgerEnabled, normalizeMoney, openAgentCreationModal, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, selectedAgent, selectedAgentId, setAgents, setDuplicateAgentDraft, setHoneyLedgerEnabled, setHoneyTreasury, setMaintenanceBusy, setMaintenanceMessage, setMaintenanceReport, setMessagesByAgent, setMoneyClawLoadingEnvName, setMoneyClawStatusByEnvName, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setRuntimeFileRoots, setRuntimeFileStatus, setRuntimeFiles, setRuntimeUsage, setRuntimeUsageLoading, setSelectedAgentId, setSharedVault, setWalletActionsByAgent, setWalletVaultBackupBusy, setWalletVaultBackupMessage, setWalletVaultBackupStatus, setWalletsByAgent, sharedVault, updateAgentProfile, walletActionsByAgent, walletsByAgent } = props;
  const deleteFetchTimeoutMs = 20_000;
  const duplicateFetchTimeoutMs = 180_000;
  function updateSharedVault(patch: Partial<SharedVaultConfig>) {
    setSharedVault((current) => ({ ...current, ...patch }));
  }

  function updateWallet(agentId: string, patch: Partial<AgentWalletConfig>) {
    setWalletsByAgent((current) => {
      const existing = current[agentId] ?? createDefaultAgentWallet(agentId);
      return {
        ...current,
        [agentId]: {
          ...existing,
          ...patch,
          updatedAt: Date.now(),
        },
      };
    });
  }

  function resetWalletBurnClock(agentId: string) {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    updateWallet(agentId, {
      currentBalanceUsd: normalizeMoney(wallet.currentBalanceUsd, wallet.seedBalanceUsd),
      survivalStartedAt: Date.now(),
    });
  }

  async function copyPaymentPrompt(config: AgentWalletConfig) {
    await navigator.clipboard?.writeText(buildAgentPaymentPrompt(config)).catch(() => undefined);
  }

  async function refreshMoneyClawStatus(agentId: string) {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    const envName = wallet.moneyClawEnvName?.trim() || "MONEYCLAW_API_KEY";
    setMoneyClawLoadingEnvName(envName);
    const response = await fetch(`/api/wallet/moneyclaw?envName=${encodeURIComponent(envName)}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      status?: WalletMoneyClawStatus;
      error?: string;
    } | null;
    setMoneyClawStatusByEnvName((current) => ({
      ...current,
      [envName]: data?.status ?? {
        configured: false,
        apiKeyEnvName: envName,
        errors: { status: data?.error ?? "Could not check MoneyClaw." },
      },
    }));
    setMoneyClawLoadingEnvName("");
  }

  async function saveMoneyClawKey(
    agentId: string,
    apiKey: string,
    options: { shareWithAllAgents: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    const agent = displayAgents.find((item) => item.id === agentId);
    const envName = wallet.moneyClawEnvName?.trim() || "MONEYCLAW_API_KEY";
    const key = apiKey.trim();
    if (!key.startsWith("mcl_")) return { ok: false, error: "MoneyClaw keys should start with mcl_." };

    const validateResponse = await fetch("/api/wallet/moneyclaw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key, envName }),
    }).catch(() => null);
    const validateData = await validateResponse?.json().catch(() => null) as {
      ok?: boolean;
      status?: WalletMoneyClawStatus;
      error?: string;
    } | null;
    if (!validateResponse?.ok || !validateData?.ok) {
      return { ok: false, error: validateData?.error ?? "MoneyClaw could not validate this key." };
    }

    if (options.shareWithAllAgents) {
      const saveResponse = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: "shared",
          key: envName,
          value: key,
          promoteToShared: true,
        }),
      }).catch(() => null);
      const saveData = await saveResponse?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!saveResponse?.ok || !saveData?.ok) {
        return { ok: false, error: saveData?.error ?? "Could not save the MoneyClaw key." };
      }
    } else {
      if (!agent) return { ok: false, error: "Could not find this agent." };
      updateAgentProfile(agentId, {
        agentEnv: {
          ...(agent.agentEnv ?? {}),
          [envName]: key,
        },
      });
    }

    if (validateData.status) {
      setMoneyClawStatusByEnvName((current) => ({ ...current, [envName]: validateData.status! }));
    }
    return { ok: true };
  }

  async function initializeCoreWalletRails(agentId: string) {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    updateWalletAction(agentId, { busy: true, error: "", message: "Initializing payment rails..." });
    updateWallet(agentId, {
      enabled: false,
      provider: "moneyclaw",
      tokenSymbol: wallet.tokenSymbol || "USDC",
      maxPaymentUsd: wallet.maxPaymentUsd > 0 ? wallet.maxPaymentUsd : 0.5,
      approvalRequiredOverUsd: wallet.approvalRequiredOverUsd > 0 ? wallet.approvalRequiredOverUsd : 2,
      moneyClawEnvName: wallet.moneyClawEnvName || "MONEYCLAW_API_KEY",
      autoPayEnabled: false,
      survivalStartedAt: wallet.survivalStartedAt || Date.now(),
    });
    if (!wallet.walletAddress && !wallet.vaultAddress) {
      await createLocalWallet(agentId, wallet.network || "eip155:8453");
    } else {
      updateWalletAction(agentId, { busy: false, error: "", message: "Core rails initialized. Refresh balances after funding." });
    }
    await refreshMoneyClawStatus(agentId);
  }

  async function refreshHoneyLedger() {
    if (!honeyLedgerEnabled) return;
    const response = await fetch("/api/honey-ledger", { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; ledger?: HoneyTreasuryConfig } | null;
    if (data?.ok && data.ledger) {
      setHoneyTreasury({
        ...createDefaultHoneyTreasuryConfig(),
        ...data.ledger,
        agentTokenUsage: data.ledger.agentTokenUsage ?? {},
        agentHoneyExchanged: data.ledger.agentHoneyExchanged ?? {},
        agentHiveBalances: data.ledger.agentHiveBalances ?? {},
      });
    }
  }

  async function observeHoneyUsage(force = false) {
    if (!force && !honeyLedgerEnabled) return;
    const response = await fetch("/api/honey-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "observe" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; ledger?: HoneyTreasuryConfig } | null;
    if (data?.ledger) {
      setHoneyTreasury({
        ...createDefaultHoneyTreasuryConfig(),
        ...data.ledger,
        agentTokenUsage: data.ledger.agentTokenUsage ?? {},
        agentHoneyExchanged: data.ledger.agentHoneyExchanged ?? {},
        agentHiveBalances: data.ledger.agentHiveBalances ?? {},
      });
      return;
    }
    await refreshHoneyLedger();
  }

  async function refreshRuntimeUsage() {
    setRuntimeUsageLoading(true);
    const nativeData = await readNativeRuntimeUsage({ force: true });
    const response = nativeData?.ok ? null : await fetch("/api/runtime-usage", { cache: "no-store" }).catch(() => null);
    const data = nativeData?.ok ? nativeData : await response?.json().catch(() => null) as RuntimeUsageAnalytics | null;
    setRuntimeUsage(data ?? { ok: false, error: "Could not read runtime usage." });
    setRuntimeUsageLoading(false);
  }

  async function refreshWalletVaultBackupStatus() {
    const vaultPath = sharedVault.enabled ? sharedVault.vaultPath.trim() : "";
    const params = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : "";
    const response = await fetch(`/api/wallet/vault-backup${params}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      status?: WalletVaultBackupStatus;
      error?: string;
    } | null;
    if (data?.status) {
      setWalletVaultBackupStatus(data.status);
      if (!data.ok && data.error) setWalletVaultBackupMessage(data.error);
      return;
    }
    if (data?.error) setWalletVaultBackupMessage(data.error);
  }

  async function runWalletVaultBackupAction(action: "refresh" | "restore") {
    setWalletVaultBackupBusy(action);
    setWalletVaultBackupMessage(action === "refresh" ? "Syncing encrypted wallet vault..." : "Restoring wallet vault locally...");
    const response = await fetch("/api/wallet/vault-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        vaultPath: sharedVault.enabled ? sharedVault.vaultPath.trim() : undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      status?: WalletVaultBackupStatus;
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.status) {
      setWalletVaultBackupMessage(data?.error ?? "Wallet vault backup action failed.");
      setWalletVaultBackupBusy("");
      return;
    }
    setWalletVaultBackupStatus(data.status);
    setWalletVaultBackupMessage(action === "refresh"
      ? "Encrypted wallet vault synced to the shared brain."
      : "Wallet vault restored locally. Refresh balances before spending.");
    setWalletVaultBackupBusy("");
  }

  async function refreshMaintenanceReport() {
    setMaintenanceBusy("check");
    setMaintenanceMessage("");
    const response = await fetch("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: displayAgents, sharedVault }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MaintenanceReport | null;
    setMaintenanceReport(data ?? { ok: false, error: "Could not run maintenance checks." });
    setMaintenanceBusy("");
  }

  async function runMaintenanceAction(action: string) {
    setMaintenanceBusy(action);
    setMaintenanceMessage("");
    const response = await fetch("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sharedVault }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
    setMaintenanceMessage(data?.ok ? data.message ?? "Repair completed." : data?.error ?? "Repair failed.");
    setMaintenanceBusy("");
    await refreshMaintenanceReport();
  }

  async function runtimeFileRequest(body: Record<string, unknown>) {
    const nativeData = await nativeRuntimeFileRequest({
      agents: displayAgents,
      sharedVault,
      ...body,
    });
    if (nativeData) return nativeData as RuntimeFilePayload;
    const response = await fetch("/api/runtime-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: displayAgents, sharedVault, ...body }),
    }).catch(() => null);
    return response?.json().catch(() => null) as Promise<RuntimeFilePayload | null>;
  }

  async function refreshRuntimeFileRoots() {
    setRuntimeFileStatus("");
    const data = await runtimeFileRequest({ action: "roots" });
    if (!data?.ok) {
      setRuntimeFileStatus(data?.error ?? "Could not load runtime file roots.");
      return;
    }
    const roots = data.roots ?? [];
    setRuntimeFileRoots(roots);
    const nextRoot = runtimeFileRootKey || roots[0]?.key || "";
    setRuntimeFileRootKey(nextRoot);
    if (nextRoot) await listRuntimeFiles(nextRoot, runtimeFilePath);
  }

  async function listRuntimeFiles(rootKey = runtimeFileRootKey, path = runtimeFilePath) {
    if (!rootKey) return;
    setRuntimeFileStatus("Loading files...");
    const data = await runtimeFileRequest({ action: "list", rootKey, path });
    if (!data?.ok) {
      setRuntimeFiles([]);
      setRuntimeFileStatus(data?.error ?? "Could not list files.");
      return;
    }
    setRuntimeFileRoots(data.roots ?? runtimeFileRoots);
    setRuntimeFiles(data.files ?? []);
    setRuntimeFilePath(path);
    setRuntimeFileStatus("");
  }

  async function openRuntimeFile(file: RuntimeFileEntry) {
    if (file.type === "dir") {
      await listRuntimeFiles(runtimeFileRootKey, file.relativePath);
      return;
    }
    setRuntimeFileStatus("Opening file...");
    const data = await runtimeFileRequest({ action: "read", rootKey: runtimeFileRootKey, path: file.relativePath });
    if (!data?.ok || !data.file) {
      setRuntimeFileStatus(data?.error ?? "Could not open file.");
      return;
    }
    setRuntimeFileOpen(data.file);
    setRuntimeFileDraft(data.file.content ?? "");
    setRuntimeFileStatus("");
  }

  async function saveRuntimeFile() {
    if (!runtimeFileOpen) return;
    setRuntimeFileStatus("Saving file...");
    const data = await runtimeFileRequest({
      action: "write",
      rootKey: runtimeFileRootKey,
      path: runtimeFileOpen.relativePath,
      content: runtimeFileDraft,
    });
    if (!data?.ok || !data.file) {
      setRuntimeFileStatus(data?.error ?? "Could not save file.");
      return;
    }
    setRuntimeFileOpen(data.file);
    setRuntimeFileDraft(data.file.content ?? "");
    setRuntimeFileStatus("Saved.");
    await listRuntimeFiles(runtimeFileRootKey, runtimeFilePath);
  }

  async function returnAllHiveToHoney() {
    if (!honeyLedgerEnabled) return;
    await fetch("/api/honey-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return-to-honey" }),
    }).catch(() => null);
    await refreshHoneyLedger();
  }

  async function claimAllHoneyToBankrHive(recipientAddress?: string) {
    if (!honeyLedgerEnabled) return { ok: false, error: "Honey rewards are off." };
    const response = await fetch("/api/honey-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim-bankr-hive", recipientAddress }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      ledger?: HoneyTreasuryConfig;
      txHash?: string;
      amount?: number;
      recipientAddress?: string;
      error?: string;
    } | null;
    if (data?.ledger) {
      setHoneyTreasury({
        ...createDefaultHoneyTreasuryConfig(),
        ...data.ledger,
        agentTokenUsage: data.ledger.agentTokenUsage ?? {},
        agentHoneyExchanged: data.ledger.agentHoneyExchanged ?? {},
        agentHiveBalances: data.ledger.agentHiveBalances ?? {},
      });
    }
    if (!response?.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? "Bankr HIVE claim failed." };
    }
    return {
      ok: true,
      txHash: data.txHash ?? "",
      amount: Number(data.amount ?? 0) || 0,
      recipientAddress: data.recipientAddress ?? "",
    };
  }

  async function enableHoneyLedger() {
    setHoneyLedgerEnabled(true);
    await observeHoneyUsage(true);
  }

  function updateWalletAction(agentId: string, patch: Partial<WalletActionState>) {
    setWalletActionsByAgent((current) => ({
      ...current,
      [agentId]: { ...(current[agentId] ?? {}), ...patch },
    }));
  }

  async function createLocalWallet(agentId: string, network: string) {
    updateWalletAction(agentId, { busy: true, error: "", message: "Creating local wallet..." });
    const response = await fetch("/api/wallet/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        network,
        vaultPath: sharedVault.enabled ? sharedVault.vaultPath.trim() : undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      wallet?: { address: string; network: string };
      vaultSync?: { ok?: boolean; error?: string };
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.wallet) {
      updateWalletAction(agentId, { busy: false, error: data?.error ?? "Could not create wallet.", message: "" });
      return;
    }
    updateWallet(agentId, {
      custodyMode: "local",
      vaultAddress: data.wallet.address,
      walletAddress: data.wallet.address,
      network: data.wallet.network,
      enabled: false,
      survivalStartedAt: Date.now(),
    });
    updateWalletAction(agentId, {
      busy: false,
      error: "",
      message: data.vaultSync?.ok
        ? "Wallet created and encrypted vault synced to the shared brain."
        : `Wallet created. Encrypted vault sync needs attention: ${data.vaultSync?.error ?? "not refreshed"}`,
    });
    await refreshWalletVaultBackupStatus();
  }

  async function refreshWalletBalance(agentId: string) {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    const address = wallet.walletAddress || wallet.vaultAddress;
    if (!address) {
      updateWalletAction(agentId, { error: "Create or paste a wallet address first.", message: "" });
      return;
    }
    updateWalletAction(agentId, { busy: true, error: "", message: "Checking on-chain balance..." });
    const response = await fetch("/api/wallet/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, network: wallet.network }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      balance?: { tokenBalance: number; nativeBalance: number; fetchedAt: number };
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.balance) {
      updateWalletAction(agentId, { busy: false, error: data?.error ?? "Could not fetch balance.", message: "" });
      return;
    }
    updateWallet(agentId, {
      currentBalanceUsd: normalizeMoney(data.balance.tokenBalance),
      onchainBalanceUsd: normalizeMoney(data.balance.tokenBalance),
      nativeBalance: data.balance.nativeBalance,
      lastOnchainSyncAt: data.balance.fetchedAt,
      survivalStartedAt: Date.now(),
    });
    updateWalletAction(agentId, { busy: false, error: "", message: `Balance refreshed: ${data.balance.tokenBalance.toFixed(6)} USDC.` });
  }

  async function sendWalletUsdc(agentId: string) {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    const action = walletActionsByAgent[agentId] ?? {};
    const amount = Number(action.sendAmount);
    updateWalletAction(agentId, { busy: true, error: "", message: "Creating payment approval..." });
    const approvalResponse = await fetch("/api/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        agentId,
        toAddress: action.sendTo,
        amountUsd: amount,
        maxPaymentUsd: wallet.maxPaymentUsd,
        confirmation: action.confirmation,
      }),
    }).catch(() => null);
    const approvalData = await approvalResponse?.json().catch(() => null) as {
      ok?: boolean;
      approvalToken?: string;
      error?: string;
    } | null;
    if (!approvalResponse?.ok || !approvalData?.ok || !approvalData.approvalToken) {
      updateWalletAction(agentId, { busy: false, error: approvalData?.error ?? "Could not create payment approval.", message: "" });
      return;
    }

    updateWalletAction(agentId, { busy: true, error: "", message: "Sending USDC..." });
    const response = await fetch("/api/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        agentId,
        toAddress: action.sendTo,
        amountUsd: amount,
        maxPaymentUsd: wallet.maxPaymentUsd,
        confirmation: action.confirmation,
        approvalToken: approvalData.approvalToken,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      signature?: string;
      network?: string;
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok) {
      updateWalletAction(agentId, { busy: false, error: data?.error ?? "Could not send USDC.", message: "" });
      return;
    }
    updateWalletAction(agentId, { busy: false, error: "", message: `Sent. Transaction: ${data.signature}`, confirmation: "" });
    await refreshWalletBalance(agentId);
  }

  async function testX402Fetch(agentId: string) {
    const wallet = walletsByAgent[agentId] ?? createDefaultAgentWallet(agentId);
    const action = walletActionsByAgent[agentId] ?? {};
    const url = (action.x402Url || wallet.x402BaseUrl || "http://localhost:5020/api/wallet/x402/mock-paid").trim();
    updateWalletAction(agentId, { busy: true, error: "", message: "Calling paid x402 endpoint..." });
    const response = await fetch("/api/wallet/x402", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        url,
        method: action.x402Method || "GET",
        policy: wallet,
        confirmation: action.x402Confirmation,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      result?: { status?: number; amountUsd?: number; paid?: boolean };
    } | null;
    if (!response?.ok || !data?.ok) {
      updateWalletAction(agentId, { busy: false, error: data?.error ?? "x402 request failed.", message: "" });
      return;
    }
    updateWalletAction(agentId, {
      busy: false,
      error: "",
      x402Confirmation: "",
      message: `x402 returned ${data.result?.status ?? "ok"}${data.result?.paid ? ` after $${(data.result.amountUsd ?? 0).toFixed(4)} payment` : ""}.`,
    });
    await refreshWalletBalance(agentId);
  }

  function addAgentToMachine(machine: MachineGroup, runtime: AgentRuntime = "hermes") {
    openAgentCreationModal(machine, runtime);
  }

  function requestDuplicateAgent(agentId?: string) {
    const source = agentId
      ? displayAgents.find((agent) => agent.id === agentId) ?? selectedAgent
      : selectedAgent;
    if (!source) return;
    setDuplicateAgentDraft({
      agentId: source.id,
      copyMemories: false,
      copyEnv: true,
      copyChats: false,
    });
  }

  function copyDuplicatedChats(sourceId: string, nextId: string) {
    setMessagesByAgent((current) => {
      const additions: Record<string, ChatMessage[]> = {};
      for (const [key, messages] of Object.entries(current)) {
        if (key === sourceId) {
          additions[nextId] = messages.map((message) => ({ ...message }));
        } else if (key.startsWith(`${sourceId}::`)) {
          additions[`${nextId}${key.slice(sourceId.length)}`] = messages.map((message) => ({ ...message }));
        }
      }
      return Object.keys(additions).length ? { ...current, ...additions } : current;
    });
  }

  function attachDuplicatedAgent(source: AgentProfile, next: AgentProfile) {
    const enriched = {
      ...next,
      sessionKey: undefined,
      agentEnv: duplicateAgentDraft?.copyEnv ? { ...(source.agentEnv ?? {}) } : undefined,
      memoryForkedFromAgentId: duplicateAgentDraft?.copyMemories ? source.id : undefined,
    };
    setAgents((current) => [...current, enriched]);
    setSelectedAgentId(enriched.id);
    if (duplicateAgentDraft?.copyChats) {
      copyDuplicatedChats(source.id, enriched.id);
    }
    return enriched;
  }

  async function createAeonDuplicateGitHubRepo(source: AgentProfile, duplicate: AgentProfile) {
    try {
      const response = await fetch("/api/runtimes/aeon/github-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          agent: duplicate,
          name: duplicate.aeonRepoName || duplicate.name || `${source.aeonRepoName || source.name}-copy`,
          description: `AEON Agent workspace duplicated from ${source.aeonRepo || source.name}.`,
          visibility: "private",
          autoIncrement: true,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; repo?: string; branch?: string; pushError?: string; error?: string } | null;
      if (!response.ok || data?.ok === false || !data?.repo) {
        throw new Error(data?.error || "Could not create the duplicate GitHub repo.");
      }
      const patch = { aeonRepo: data.repo, aeonBranch: data.branch || duplicate.aeonBranch || "main", aeonMode: "github" as const };
      updateAgentProfile(duplicate.id, patch);
      if (data.pushError) {
        console.warn(`Created ${data.repo}, but the background AEON push did not complete: ${data.pushError}`);
      }
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "Could not push duplicated AEON agent to GitHub.");
    }
  }

  async function duplicateAeonAgent(source: AgentProfile) {
    const response = await fetch("/api/runtimes/aeon/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "duplicate",
        agent: source,
        name: `${source.aeonRepoName || source.name || "AEON"} Copy`,
      }),
      signal: AbortSignal.timeout(duplicateFetchTimeoutMs),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; agent?: AgentProfile; error?: string } | null;
    if (!response.ok || data?.ok === false || !data?.agent) {
      throw new Error(data?.error || "Could not duplicate the AEON workspace.");
    }
    const duplicate = attachDuplicatedAgent(source, {
      ...source,
      ...data.agent,
      name: `${source.name} Copy`,
      aeonRepo: "",
      aeonMode: "local",
    });
    if (source.aeonRepo?.trim()) {
      void createAeonDuplicateGitHubRepo(source, duplicate);
    }
  }

  async function duplicateAgent() {
    if (!duplicateAgentDraft) return;
    const source = displayAgents.find((agent) => agent.id === duplicateAgentDraft.agentId) ?? selectedAgent;
    if (!source) return;
    if (source.runtime === "aeon") {
      try {
        await duplicateAeonAgent(source);
        setDuplicateAgentDraft(null);
      } catch (error) {
        alert(error instanceof Error ? error.message : "Could not duplicate this AEON agent.");
      }
      return;
    }
    const nextId = `${source.runtime}-${Date.now()}`;
    attachDuplicatedAgent(source, {
      ...source,
      id: nextId,
      name: `${source.name} Copy`,
    });
    setDuplicateAgentDraft(null);
  }

  async function deleteAgent(agentId = selectedAgent?.id, options?: { aeonDeleteDepth?: "local" | "github" | "both"; onProgress?: (progress: { step: "local" | "github"; status: "idle" | "working" | "done" | "failed"; message?: string }) => void }) {
    if (!agentId) return;
    const agent = displayAgents.find((item) => item.id === agentId) ?? agents.find((item) => item.id === agentId) ?? selectedAgent;
    if (agent?.runtime === "aeon" && options?.aeonDeleteDepth) {
      const staleLocalDeleteError = (message: string) => (
        /does not exist/i.test(message)
        || /does not look like an AEON workspace/i.test(message)
        || /does not appear to be a local folder/i.test(message)
        || /does not appear to be a local/i.test(message)
        || /unsupported remote AEON workspace action/i.test(message)
      );
      try {
        if (options.aeonDeleteDepth === "local" || options.aeonDeleteDepth === "both") {
          options.onProgress?.({ step: "local", status: "working" });
          try {
            const response = await fetch("/api/runtimes/aeon/workspaces", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete-local", agent }),
              signal: AbortSignal.timeout(deleteFetchTimeoutMs),
            });
            const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
            if (!response.ok || data?.ok === false) throw new Error(data?.error || "Could not delete the local AEON repo.");
            options.onProgress?.({ step: "local", status: "done" });
          } catch (error) {
            const message = error instanceof DOMException && error.name === "TimeoutError"
              ? `Local repo deletion timed out after ${Math.round(deleteFetchTimeoutMs / 1000)} seconds.`
              : error instanceof Error ? error.message : "Could not delete the local AEON repo.";
            if (!staleLocalDeleteError(message)) {
              options.onProgress?.({ step: "local", status: "failed", message });
              return { ok: false, error: message };
            }
            options.onProgress?.({
              step: "local",
              status: "done",
              message: "Local folder was missing or no longer looked like an AEON workspace, so HivemindOS removed the stale roster entry.",
            });
          }
        }
        if (options.aeonDeleteDepth === "github" || options.aeonDeleteDepth === "both") {
          if (!agent.aeonRepo?.trim()) throw new Error("No GitHub repo is configured for this AEON agent.");
          options.onProgress?.({ step: "github", status: "working" });
          const response = await fetch("/api/runtimes/aeon/github-repos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", agent, repo: agent.aeonRepo }),
            signal: AbortSignal.timeout(deleteFetchTimeoutMs),
          });
          const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
          if (!response.ok || data?.ok === false) throw new Error(data?.error || "Could not delete the GitHub AEON repo.");
          options.onProgress?.({ step: "github", status: "done" });
        }
      } catch (error) {
        const message = error instanceof DOMException && error.name === "TimeoutError"
          ? `GitHub repo deletion timed out after ${Math.round(deleteFetchTimeoutMs / 1000)} seconds.`
          : error instanceof Error ? error.message : "Could not delete the AEON agent.";
        options.onProgress?.({ step: "github", status: "failed", message });
        return { ok: false, error: message };
      }
    }
    const next = agents.filter((agent) => agent.id !== agentId);
    setAgents(next);
    if (selectedAgentId === agentId) {
      setSelectedAgentId(next[0]?.id ?? "");
    }
    setMessagesByAgent((current) => {
      const nextMessages = { ...current };
      delete nextMessages[agentId];
      return nextMessages;
    });
    return { ok: true };
  }

  return { updateSharedVault, updateWallet, resetWalletBurnClock, copyPaymentPrompt, refreshMoneyClawStatus, saveMoneyClawKey, initializeCoreWalletRails, refreshHoneyLedger, observeHoneyUsage, refreshRuntimeUsage, refreshWalletVaultBackupStatus, runWalletVaultBackupAction, refreshMaintenanceReport, runMaintenanceAction, runtimeFileRequest, refreshRuntimeFileRoots, listRuntimeFiles, openRuntimeFile, saveRuntimeFile, returnAllHiveToHoney, claimAllHoneyToBankrHive, enableHoneyLedger, updateWalletAction, createLocalWallet, refreshWalletBalance, sendWalletUsdc, testX402Fetch, addAgentToMachine, requestDuplicateAgent, duplicateAgent, deleteAgent };
}
