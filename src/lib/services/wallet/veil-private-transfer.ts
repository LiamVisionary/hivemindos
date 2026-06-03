import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { parseVeilCliJson, runVeilCli } from "@/lib/services/wallet/veil-cli";
import {
  VEIL_CASH_NETWORK,
  VEIL_CASH_USDC_DEPOSIT_MINIMUM,
  type VeilCashTransferAsset,
} from "@/lib/config/veil-cash";

type VeilTransferRecord = {
  transactionHash: string;
  blockNumber: number | null;
  asset: VeilCashTransferAsset;
  amount: string;
  recipient: string;
  type: "withdraw" | "transfer";
};

type VeilTransferTimingEvent = {
  label: string;
  detail?: string;
  startedAt: number;
  endedAt: number;
  elapsedMs: number;
  status: "completed" | "failed";
};

export type VeilTransferTimings = {
  startedAt: number;
  completedAt?: number;
  totalMs?: number;
  events: VeilTransferTimingEvent[];
};

export type VeilTransferProgressEvent = {
  label: string;
  detail?: string;
  elapsedMs: number;
  status: "started" | "completed" | "failed";
};

export type VeilPrivateTransferResult =
  | {
      status: "submitted";
      transfer: VeilTransferRecord;
      timings: VeilTransferTimings;
    }
  | {
      status: "shielding";
      shield: {
        transactionHash: string;
        blockNumber: number | null;
        amount: string;
        fee: string;
        totalSent: string;
      };
      pending: {
        asset: "USDC";
        amount: string;
        recipient: string;
        message: string;
      };
      timings: VeilTransferTimings;
    };

type ExecuteVeilPrivateTransferInput = {
  agentId?: string;
  asset: VeilCashTransferAsset;
  amount: string;
  recipient: string;
  recipientMode?: "public" | "registered";
  autoShield?: boolean;
  waitForShieldCompletion?: boolean;
  duplicateGuardEnabled?: boolean;
  duplicateGuardSeconds?: number;
  onProgress?: (event: VeilTransferProgressEvent) => void;
};

type PendingAutoCompletion = {
  startedAt: number;
  status: "running" | "completed" | "failed";
  message?: string;
  transfer?: VeilTransferRecord;
  promise?: Promise<VeilTransferRecord>;
};

const SHIELD_ACCEPTANCE_ATTEMPTS = 180;
const SHIELD_ACCEPTANCE_POLL_MS = 1_500;
const DEFAULT_COMPLETED_TRANSFER_TTL_MS = 15 * 60 * 1000;
const TRANSFER_LOCK_TTL_MS = 10 * 60 * 1000;
const completedTransferStatePath = join(homedir(), ".hivemindos", "veil-private-transfers.json");
const transferLockDir = join(homedir(), ".hivemindos", "veil-private-transfer-locks");
const pendingAutoCompletions = new Map<string, PendingAutoCompletion>();

export async function executeVeilPrivateTransfer(input: ExecuteVeilPrivateTransferInput): Promise<VeilPrivateTransferResult> {
  const timings = createTimingRecorder(input.onProgress);
  const command = input.recipientMode === "registered" ? "transfer" : "withdraw";
  const transferKey = input.autoShield && input.asset === "USDC" ? pendingTransferKey(input) : "";
  const pending = pendingAutoCompletionFor(input);
  if (pending?.status === "running") {
    if (input.waitForShieldCompletion && pending.promise) {
      const transfer = await timings.measure("Join pending private send", "Waiting for the already-running Veil completion.", () => pending.promise!);
      return submittedResult(transfer, timings.finish());
    }
    throw new Error("This private send is already waiting on a Veil shield deposit; HivemindOS will not start a duplicate transfer.");
  }
  if (pending?.status === "completed" && pending.transfer && duplicateGuardEnabled(input)) {
    return submittedResult(pending.transfer, timings.finish());
  }
  const durableCompleted = await timings.measure("Check replay guard", "Looking for a recently completed matching transfer.", () => readCompletedTransfer(input));
  if (durableCompleted) return submittedResult(durableCompleted, timings.finish());
  const lockAcquired = transferKey ? await acquireTransferLock(transferKey) : false;
  if (transferKey && !lockAcquired) {
    throw new Error("This private send is already running in another HivemindOS process. I will not submit a duplicate transfer.");
  }
  try {
    const transfer = await timings.measure(
      command === "transfer" ? "Generate proof and submit private transfer" : "Generate proof and submit private withdraw",
      `${input.amount} ${input.asset} to ${input.recipient}`,
      () => runPrivateTransferCommand(command, input.asset, input.amount, input.recipient),
    );
    if (input.autoShield) {
      if (duplicateGuardEnabled(input)) await writeCompletedTransfer(pendingTransferKey(input), transfer, completedTransferTtlMs(input));
      await releaseTransferLock(pendingTransferKey(input));
    }
    return submittedResult(transfer, timings.finish());
  } catch (error) {
    if (!shouldAutoShield(input, error)) {
      if (transferKey) await releaseTransferLock(transferKey);
      throw error;
    }
    try {
      return await shieldThenComplete(input as ExecuteVeilPrivateTransferInput & { asset: "USDC"; autoShield: true }, timings);
    } catch (shieldError) {
      if (transferKey) await releaseTransferLock(transferKey);
      throw shieldError;
    }
  }
}

function pendingAutoCompletionFor(input: ExecuteVeilPrivateTransferInput) {
  if (!input.autoShield || input.asset !== "USDC") return undefined;
  return pendingAutoCompletions.get(pendingTransferKey(input));
}

export function veilPrivateTransferErrorMessage(error: unknown): string {
  const structured = structuredCliError(error);
  if (structured) return structured;
  const message = error instanceof Error ? error.message : "Veil private transfer failed.";
  if (message === "VEIL_CLI_MISSING" || /ENOENT/.test(message)) return "Veil CLI is not installed. Run Setup Veil before private transfers.";
  return redactHexSecrets(message);
}

async function runPrivateTransferCommand(
  command: "withdraw" | "transfer",
  asset: VeilCashTransferAsset,
  amount: string,
  recipient: string,
): Promise<VeilTransferRecord> {
  const { stdout } = await runVeilCli([command, asset, amount, recipient, "--json"], {
    timeout: 180_000,
    maxBuffer: 800_000,
  });
  const result = parseVeilCliJson(stdout);
  return {
    transactionHash: stringValue(result.transactionHash),
    blockNumber: numberValue(result.blockNumber),
    asset: normalizeAssetValue(result.asset) ?? asset,
    amount: stringValue(result.amount) || amount,
    recipient: stringValue(result.recipient) || recipient,
    type: normalizeTransferType(result.type) ?? command,
  };
}

async function shieldThenComplete(
  input: ExecuteVeilPrivateTransferInput & { asset: "USDC"; autoShield: true },
  timings: TimingRecorder,
): Promise<VeilPrivateTransferResult> {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    throw new Error("Ready private USDC is not sufficient. Select an agent-local wallet so HivemindOS can shield funds automatically.");
  }
  const stored = await getWalletSecret(agentId);
  if (!stored) {
    throw new Error("Ready private USDC is not sufficient, and no encrypted local Base wallet key exists for this agent. Create or restore the local wallet before automatic shielding.");
  }
  if (stored.info.network !== VEIL_CASH_NETWORK) {
    throw new Error("Automatic Veil shielding requires this agent's encrypted local wallet to be on Base mainnet.");
  }

  const balance = await timings.measure("Read Veil balances", "Checking ready private, queued, and public USDC.", () => readUsdcBalance(stored.secret).catch(() => null));
  const sendAmount = Number(input.amount);
  const readyPrivate = balance?.privateBalance ?? 0;
  const missing = Math.max(0, sendAmount - readyPrivate);
  const shieldAmount = formatUsdc(Math.max(VEIL_CASH_USDC_DEPOSIT_MINIMUM, missing));
  if (balance && readyPrivate < sendAmount && readyPrivate + balance.queueBalance >= sendAmount) {
    const pendingKey = pendingTransferKey(input);
    const promise = startPendingAutoCompletion(input, stored.secret, pendingKey);
    if (input.waitForShieldCompletion) {
      const transfer = await timings.measure("Wait for private funds", "Waiting for queued shielded USDC to become spendable.", () => promise);
      return submittedResult(transfer, timings.finish());
    }
    void promise.catch(() => undefined);
    return {
      status: "shielding",
      shield: {
        transactionHash: "",
        blockNumber: null,
        amount: formatUsdc(balance.queueBalance),
        fee: "",
        totalSent: formatUsdc(balance.queueBalance),
      },
      pending: {
        asset: "USDC",
        amount: input.amount,
        recipient: input.recipient,
        message: "Shielding is already queued. HivemindOS will complete the private send after Veil accepts the queued deposit into the private pool.",
      },
      timings: timings.finish(),
    };
  }
  if (balance && balance.publicUsdc < Number(shieldAmount)) {
    throw new Error(`Ready private USDC is not sufficient. Add at least ${shieldAmount} USDC plus Base gas to this agent's spend balance so HivemindOS can shield and complete the private send.`);
  }

  const pendingKey = pendingTransferKey(input);
  const existing = pendingAutoCompletions.get(pendingKey);
  if (existing?.status === "running") {
    if (input.waitForShieldCompletion && existing.promise) {
      const transfer = await timings.measure("Join pending private send", "Waiting for the already-running Veil completion.", () => existing.promise!);
      return submittedResult(transfer, timings.finish());
    }
    throw new Error("This private send is already waiting on a Veil shield deposit; HivemindOS will not start a duplicate shield step.");
  }
  if (existing?.status === "completed" && existing.transfer && duplicateGuardEnabled(input)) {
    return submittedResult(existing.transfer, timings.finish());
  }

  const { stdout } = await timings.measure("Shield public USDC", `Depositing ${shieldAmount} USDC into Veil.`, () => runVeilCli(["deposit", "USDC", shieldAmount, "--json"], {
      env: { WALLET_KEY: stored.secret } as unknown as NodeJS.ProcessEnv,
      timeout: 240_000,
      maxBuffer: 800_000,
    }));
  const deposit = parseVeilCliJson(stdout);
  const promise = startPendingAutoCompletion(input, stored.secret, pendingKey);
  if (input.waitForShieldCompletion) {
    const transfer = await timings.measure("Complete private withdraw", "Waiting for shield acceptance, then submitting the private withdraw.", () => promise);
    return submittedResult(transfer, timings.finish());
  }

  void promise.catch(() => undefined);

  return {
    status: "shielding",
    shield: {
      transactionHash: stringValue(deposit.hash) || stringValue(deposit.transactionHash),
      blockNumber: numberValue(deposit.blockNumber),
      amount: stringValue(deposit.amount) || shieldAmount,
      fee: stringValue(deposit.fee),
      totalSent: stringValue(deposit.totalSent) || shieldAmount,
    },
    pending: {
      asset: "USDC",
      amount: input.amount,
      recipient: input.recipient,
      message: "Shielding started. HivemindOS will complete the private send after Veil accepts the deposit into the private pool.",
    },
    timings: timings.finish(),
  };
}

function startPendingAutoCompletion(
  input: ExecuteVeilPrivateTransferInput & { asset: "USDC"; autoShield: true },
  walletKey: string,
  pendingKey: string,
): Promise<VeilTransferRecord> {
  const existing = pendingAutoCompletions.get(pendingKey);
  if (existing?.status === "running" && existing.promise) return existing.promise;
  if (existing?.status === "completed" && existing.transfer && duplicateGuardEnabled(input)) return Promise.resolve(existing.transfer);

  const promise = waitForShieldAcceptanceAndTransfer(input, walletKey)
    .then((transfer) => {
      pendingAutoCompletions.set(pendingKey, {
        startedAt: Date.now(),
        status: "completed",
        message: transfer.transactionHash,
        transfer,
      });
      if (duplicateGuardEnabled(input)) void writeCompletedTransfer(pendingKey, transfer, completedTransferTtlMs(input));
      void releaseTransferLock(pendingKey);
      return transfer;
    })
    .catch((error: unknown) => {
      pendingAutoCompletions.set(pendingKey, {
        startedAt: Date.now(),
        status: "failed",
        message: veilPrivateTransferErrorMessage(error),
      });
      void releaseTransferLock(pendingKey);
      throw error;
    });

  pendingAutoCompletions.set(pendingKey, {
    startedAt: Date.now(),
    status: "running",
    promise,
  });

  return promise;
}

function submittedResult(transfer: VeilTransferRecord, timings: VeilTransferTimings): VeilPrivateTransferResult {
  return {
    status: "submitted",
    transfer,
    timings,
  };
}

async function waitForShieldAcceptanceAndTransfer(
  input: ExecuteVeilPrivateTransferInput & { asset: "USDC"; autoShield: true },
  walletKey: string,
): Promise<VeilTransferRecord> {
  for (let attempt = 0; attempt < SHIELD_ACCEPTANCE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(SHIELD_ACCEPTANCE_POLL_MS);
    const completed = await readCompletedTransfer(input);
    if (completed) return completed;
    const balance = await readUsdcBalance(walletKey).catch(() => null);
    if (!balance || balance.privateBalance < Number(input.amount)) continue;
    return await runPrivateTransferCommand(input.recipientMode === "registered" ? "transfer" : "withdraw", "USDC", input.amount, input.recipient);
  }
  throw new Error("Timed out waiting for Veil to accept the shield deposit.");
}

type TimingRecorder = ReturnType<typeof createTimingRecorder>;

function createTimingRecorder(onProgress?: (event: VeilTransferProgressEvent) => void) {
  const startedAt = Date.now();
  const events: VeilTransferTimingEvent[] = [];
  const emit = (label: string, detail: string | undefined, status: VeilTransferProgressEvent["status"], elapsedMs = Date.now() - startedAt) => {
    onProgress?.({ label, detail, status, elapsedMs });
  };
  return {
    async measure<T>(label: string, detail: string | undefined, operation: () => Promise<T>): Promise<T> {
      const stepStartedAt = Date.now();
      emit(label, detail, "started", stepStartedAt - startedAt);
      try {
        const result = await operation();
        const endedAt = Date.now();
        const elapsedMs = endedAt - stepStartedAt;
        events.push({ label, detail, startedAt: stepStartedAt, endedAt, elapsedMs, status: "completed" });
        emit(label, timingDetail(detail, elapsedMs), "completed", endedAt - startedAt);
        return result;
      } catch (error) {
        const endedAt = Date.now();
        const elapsedMs = endedAt - stepStartedAt;
        events.push({ label, detail, startedAt: stepStartedAt, endedAt, elapsedMs, status: "failed" });
        emit(label, timingDetail(detail, elapsedMs), "failed", endedAt - startedAt);
        throw error;
      }
    },
    finish(): VeilTransferTimings {
      const completedAt = Date.now();
      return {
        startedAt,
        completedAt,
        totalMs: completedAt - startedAt,
        events: [...events],
      };
    },
  };
}

function timingDetail(detail: string | undefined, elapsedMs: number) {
  const suffix = `${elapsedMs}ms`;
  return detail ? `${detail} (${suffix})` : suffix;
}

type CompletedTransferState = {
  transfers?: Record<string, { completedAt: number; expiresAt?: number; transfer: VeilTransferRecord }>;
};

async function readCompletedTransfer(input: ExecuteVeilPrivateTransferInput): Promise<VeilTransferRecord | null> {
  if (!input.autoShield || input.asset !== "USDC") return null;
  if (!duplicateGuardEnabled(input)) return null;
  const key = pendingTransferKey(input);
  const state = await readCompletedTransferState();
  const record = state.transfers?.[key];
  if (!record) return null;
  const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : record.completedAt + completedTransferTtlMs(input);
  if (Date.now() > expiresAt) return null;
  return record.transfer;
}

async function writeCompletedTransfer(key: string, transfer: VeilTransferRecord, ttlMs = DEFAULT_COMPLETED_TRANSFER_TTL_MS) {
  if (ttlMs <= 0) return;
  const state = await readCompletedTransferState();
  const transfers = { ...(state.transfers ?? {}) };
  const now = Date.now();
  for (const [entryKey, entry] of Object.entries(transfers)) {
    const expiresAt = typeof entry.expiresAt === "number" ? entry.expiresAt : entry.completedAt + DEFAULT_COMPLETED_TRANSFER_TTL_MS;
    if (expiresAt <= now) delete transfers[entryKey];
  }
  transfers[key] = { completedAt: now, expiresAt: now + ttlMs, transfer };
  await mkdir(dirname(completedTransferStatePath), { recursive: true, mode: 0o700 });
  await writeFile(completedTransferStatePath, `${JSON.stringify({ transfers }, null, 2)}\n`, { mode: 0o600 });
}

function duplicateGuardEnabled(input: ExecuteVeilPrivateTransferInput) {
  return input.duplicateGuardEnabled !== false && completedTransferTtlMs(input) > 0;
}

function completedTransferTtlMs(input: ExecuteVeilPrivateTransferInput) {
  const seconds = Number(input.duplicateGuardSeconds);
  if (!Number.isFinite(seconds)) return DEFAULT_COMPLETED_TRANSFER_TTL_MS;
  return Math.max(0, Math.round(seconds * 1000));
}

async function acquireTransferLock(key: string) {
  const lockPath = transferLockPath(key);
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(lockPath, JSON.stringify({ key, startedAt: Date.now() }) + "\n", { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    const stale = await isStaleTransferLock(lockPath);
    if (!stale) return false;
    await rm(lockPath, { force: true }).catch(() => undefined);
    try {
      await writeFile(lockPath, JSON.stringify({ key, startedAt: Date.now() }) + "\n", { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
}

async function releaseTransferLock(key: string) {
  await rm(transferLockPath(key), { force: true }).catch(() => undefined);
}

async function isStaleTransferLock(lockPath: string) {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { startedAt?: unknown };
    const startedAt = Number(parsed.startedAt);
    return Number.isFinite(startedAt) && Date.now() - startedAt > TRANSFER_LOCK_TTL_MS;
  } catch {
    return false;
  }
}

function transferLockPath(key: string) {
  return join(transferLockDir, `${Buffer.from(key).toString("base64url")}.lock`);
}

async function readCompletedTransferState(): Promise<CompletedTransferState> {
  try {
    const parsed = JSON.parse(await readFile(completedTransferStatePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const transfers = (parsed as CompletedTransferState).transfers;
    if (!transfers || typeof transfers !== "object") return {};
    return { transfers };
  } catch {
    return {};
  }
}

async function readUsdcBalance(walletKey: string): Promise<{ privateBalance: number; queueBalance: number; publicUsdc: number }> {
  const { stdout } = await runVeilCli(["balance", "--pool", "usdc", "--json"], {
    env: { WALLET_KEY: walletKey } as unknown as NodeJS.ProcessEnv,
    timeout: 180_000,
    maxBuffer: 800_000,
  });
  const parsed = parseVeilCliJson(stdout);
  return {
    privateBalance: numberFromPath(parsed, ["private", "balance"]),
    queueBalance: numberFromPath(parsed, ["queue", "balance"]),
    publicUsdc: numberFromPath(parsed, ["wallet", "usdc"]),
  };
}

function shouldAutoShield(input: ExecuteVeilPrivateTransferInput, error: unknown) {
  if (!input.autoShield || input.asset !== "USDC" || input.recipientMode === "registered") return false;
  const message = rawCliErrorMessage(error).toLowerCase();
  return message.includes("no_utxos")
    || message.includes("no unspent")
    || message.includes("insufficient balance");
}

function structuredCliError(error: unknown): string {
  const output = rawCliErrorMessage(error);
  if (!output.trim()) return "";
  try {
    const parsed = parseVeilCliJson(output);
    const message = stringValue(parsed.error);
    const code = stringValue(parsed.errorCode);
    if (code === "NO_UTXOS" || /no unspent utxos/i.test(message)) {
      return "Ready private USDC is not sufficient yet. HivemindOS can shield from the agent spend balance automatically when the agent has at least the Veil minimum available.";
    }
    if (code === "INSUFFICIENT_BALANCE" || /insufficient balance/i.test(message)) {
      return "Ready private USDC is below the requested amount. HivemindOS can shield the difference automatically when the agent spend balance has enough USDC and gas.";
    }
    return [code, message].filter(Boolean).join(": ").replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
  } catch {
    return "";
  }
}

function rawCliErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return error instanceof Error ? error.message : "";
  const record = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  return [record.stdout, record.stderr, record.message].filter((value): value is string => typeof value === "string").join("\n");
}

function pendingTransferKey(input: ExecuteVeilPrivateTransferInput) {
  return [
    input.agentId ?? "workspace",
    input.asset,
    Number(input.amount).toFixed(6),
    input.recipient.toLowerCase(),
  ].join(":");
}

function normalizeAssetValue(value: unknown): VeilCashTransferAsset | null {
  if (value === "ETH" || value === "USDC") return value;
  return null;
}

function normalizeTransferType(value: unknown): "withdraw" | "transfer" | null {
  if (value === "withdraw" || value === "transfer") return value;
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberFromPath(record: Record<string, unknown>, path: string[]): number {
  let current: unknown = record;
  for (const part of path) {
    if (!current || typeof current !== "object") return 0;
    current = (current as Record<string, unknown>)[part];
  }
  const numeric = Number(current);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatUsdc(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactHexSecrets(value: string) {
  return value.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}
