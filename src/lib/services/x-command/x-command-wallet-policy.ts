import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { homedir } from "@/lib/home-dir";
import { MAX_SWAP_USD } from "@/lib/services/trading/dex-swap";

export type XCommandWalletPolicy = {
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

export type XCommandTradeReceipt = {
  id: string;
  jobId: string;
  authorizationWalletId: string;
  walletId: string;
  network: string;
  amountUsd: number;
  status: "started" | "complete" | "failed" | "uncertain";
  resultText?: string;
  error?: string;
  reference?: string;
  valueUsd?: number;
  startedAtMs: number;
  updatedAt: string;
};

type StoreFile = {
  version: 1;
  policy: XCommandWalletPolicy | null;
  receipts: XCommandTradeReceipt[];
};

const MAX_RECEIPTS = 500;
const ROLLING_DAY_MS = 24 * 60 * 60 * 1_000;

function storePath(): string {
  return process.env.HIVEMINDOS_X_COMMAND_POLICY_PATH?.trim()
    || join(homedir(), ".hivemindos", "x-command-wallet-policy.json");
}

function emptyStore(): StoreFile {
  return { version: 1, policy: null, receipts: [] };
}

type QueueSlot = { write: Promise<unknown> };
function queueSlot(): QueueSlot {
  const globals = globalThis as typeof globalThis & { __hivemindXCommandWalletPolicyQueue?: QueueSlot };
  if (!globals.__hivemindXCommandWalletPolicyQueue) {
    globals.__hivemindXCommandWalletPolicyQueue = { write: Promise.resolve() };
  }
  return globals.__hivemindXCommandWalletPolicyQueue;
}

function queued<T>(operation: () => Promise<T>): Promise<T> {
  const slot = queueSlot();
  const next = slot.write.then(operation, operation);
  slot.write = next.catch(() => undefined);
  return next;
}

async function readStore(): Promise<StoreFile> {
  const file = storePath();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyStore();
    throw new Error(`The HivemindOSBot wallet policy could not be read at ${file}.`);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.receipts)) throw new Error("invalid shape");
    const policy = parsed.policy && typeof parsed.policy === "object" ? parsed.policy as XCommandWalletPolicy : null;
    return {
      version: 1,
      policy: policy ? {
        ...policy,
        revision: typeof policy.revision === "string" && policy.revision.trim()
          ? policy.revision
          : `legacy:${policy.updatedAt}`,
        accounts: Array.isArray(policy.accounts) && policy.accounts.length
          ? policy.accounts
          : [{ walletId: policy.walletId, address: policy.address, network: policy.network }],
      } : null,
      receipts: (parsed.receipts as XCommandTradeReceipt[]).map((receipt) => ({
        ...receipt,
        authorizationWalletId: receipt.authorizationWalletId || receipt.walletId,
      })),
    };
  } catch {
    throw new Error(`The HivemindOSBot wallet policy at ${file} is corrupt. Automatic X trades are blocked until it is repaired.`);
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...store, receipts: store.receipts.slice(-MAX_RECEIPTS) }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, file);
}

function positiveNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`);
  return Math.round(number * 100) / 100;
}

export async function readXCommandWalletPolicy(): Promise<XCommandWalletPolicy | null> {
  return (await readStore()).policy;
}

export function saveXCommandWalletPolicy(input: Omit<XCommandWalletPolicy, "revision" | "authorizedAt" | "updatedAt" | "accounts"> & {
  accounts?: XCommandWalletPolicy["accounts"];
}): Promise<XCommandWalletPolicy> {
  return queued(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const walletId = input.walletId.trim();
    const address = input.address.trim();
    const network = input.network.trim();
    if (!walletId || !address || !network) throw new Error("Choose a local signing wallet for HivemindOSBot.");
    const maxTradeUsd = positiveNumber(input.maxTradeUsd, "The per-trade HivemindOSBot limit");
    if (maxTradeUsd > MAX_SWAP_USD) throw new Error(`The per-trade HivemindOSBot limit cannot exceed $${MAX_SWAP_USD}.`);
    const dailyTradeLimitUsd = positiveNumber(input.dailyTradeLimitUsd, "The daily HivemindOSBot limit");
    if (dailyTradeLimitUsd < maxTradeUsd) throw new Error("The daily HivemindOSBot limit must be at least the per-trade limit.");
    const slippageBps = Math.round(Number(input.slippageBps));
    if (!Number.isFinite(slippageBps) || slippageBps < 10 || slippageBps > 2_000) {
      throw new Error("HivemindOSBot slippage must be between 0.10% and 20.00%.");
    }
    const sameWalletAuthorization = store.policy?.walletId === walletId && store.policy?.authorizedAt;
    const accounts = (input.accounts?.length ? input.accounts : [{ walletId, address, network }])
      .map((account) => ({
        walletId: account.walletId.trim(),
        address: account.address.trim(),
        network: account.network.trim(),
      }))
      .filter((account, index, rows) => account.walletId && account.address && account.network
        && rows.findIndex((candidate) => candidate.walletId === account.walletId) === index);
    if (!accounts.length) throw new Error("The selected HivemindOSBot wallet has no local signing accounts.");
    const policy: XCommandWalletPolicy = {
      revision: randomUUID(),
      enabled: input.enabled === true,
      walletId,
      walletName: input.walletName.trim().slice(0, 120) || "HivemindOSBot wallet",
      address,
      network,
      accounts,
      maxTradeUsd,
      dailyTradeLimitUsd,
      slippageBps,
      authorizedAt: sameWalletAuthorization || now,
      updatedAt: now,
    };
    store.policy = policy;
    await writeStore(store);
    return policy;
  });
}

export function disableXCommandWalletPolicy(): Promise<XCommandWalletPolicy | null> {
  return queued(async () => {
    const store = await readStore();
    if (!store.policy) return null;
    store.policy = { ...store.policy, enabled: false, updatedAt: new Date().toISOString() };
    await writeStore(store);
    return store.policy;
  });
}

export function reserveXCommandTrade(input: {
  jobId: string;
  amountUsd: number;
  expectedPolicyRevision: string;
  accountWalletId: string;
  network: string;
  now?: number;
}): Promise<{ policy: XCommandWalletPolicy; receipt: XCommandTradeReceipt; duplicate: boolean }> {
  return queued(async () => {
    const store = await readStore();
    const policy = store.policy;
    if (!policy?.enabled) throw new Error("Automatic X trades are off. Authorize a HivemindOSBot wallet in the app first.");
    const jobId = input.jobId.trim();
    if (!jobId) throw new Error("The X trade job has no idempotency ID.");
    const existing = store.receipts.find((receipt) => receipt.jobId === jobId);
    if (existing) return { policy, receipt: existing, duplicate: true };
    if (input.expectedPolicyRevision.trim() !== policy.revision) {
      throw new Error("The HivemindOSBot wallet authorization changed while the trade was being quoted. The stale quote was not submitted.");
    }
    const accountWalletId = input.accountWalletId.trim();
    const network = input.network.trim();
    const authorizedAccount = policy.accounts.find((account) => account.walletId === accountWalletId && account.network === network);
    if (!authorizedAccount) {
      throw new Error("The quoted signing account is not part of the current HivemindOSBot wallet authorization.");
    }
    const amountUsd = positiveNumber(input.amountUsd, "The X trade amount");
    if (amountUsd > policy.maxTradeUsd + 1e-9) {
      throw new Error(`This $${amountUsd.toFixed(2)} trade exceeds the $${policy.maxTradeUsd.toFixed(2)} per-trade HivemindOSBot limit.`);
    }
    const now = input.now ?? Date.now();
    const cutoff = now - ROLLING_DAY_MS;
    const committed = store.receipts
      .filter((receipt) => receipt.authorizationWalletId === policy.walletId && receipt.startedAtMs >= cutoff && receipt.status !== "failed")
      .reduce((sum, receipt) => sum + receipt.amountUsd, 0);
    if (committed + amountUsd > policy.dailyTradeLimitUsd + 1e-9) {
      throw new Error(`This trade would exceed the $${policy.dailyTradeLimitUsd.toFixed(2)} rolling daily HivemindOSBot limit.`);
    }
    const receipt: XCommandTradeReceipt = {
      id: randomUUID(),
      jobId,
      authorizationWalletId: policy.walletId,
      walletId: accountWalletId,
      network,
      amountUsd,
      status: "started",
      startedAtMs: now,
      updatedAt: new Date(now).toISOString(),
    };
    store.receipts.push(receipt);
    await writeStore(store);
    return { policy, receipt, duplicate: false };
  });
}

export function completeXCommandTradeReceipt(
  jobId: string,
  result: Pick<XCommandTradeReceipt, "status"> & Partial<Pick<XCommandTradeReceipt, "resultText" | "error" | "reference" | "valueUsd">>,
): Promise<XCommandTradeReceipt> {
  return queued(async () => {
    const store = await readStore();
    const index = store.receipts.findIndex((receipt) => receipt.jobId === jobId.trim());
    if (index < 0) throw new Error("The HivemindOSBot trade reservation is missing; execution is blocked.");
    const current = store.receipts[index];
    const receipt: XCommandTradeReceipt = {
      ...current,
      status: result.status,
      ...(result.resultText ? { resultText: result.resultText.slice(0, 8_000) } : {}),
      ...(result.error ? { error: result.error.slice(0, 1_000) } : {}),
      ...(result.reference ? { reference: result.reference.slice(0, 300) } : {}),
      ...(Number.isFinite(result.valueUsd) ? { valueUsd: Number(result.valueUsd) } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.receipts[index] = receipt;
    await writeStore(store);
    return receipt;
  });
}

export async function listXCommandTradeReceipts(limit = 30): Promise<XCommandTradeReceipt[]> {
  const receipts = (await readStore()).receipts;
  return receipts.slice(-Math.max(1, Math.min(100, limit))).reverse();
}
