import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { constants } from "fs";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { USEPOD_API_BASE, USEPOD_PROVIDER_BOND_USDC } from "@/lib/config/usepod-features";
import { generateWallet } from "@/lib/services/wallet/chain-wallet";
import { getWalletInfo, getWalletSecret, storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  bondDepositCodeFromEnrollmentCode,
  getUsePodBondUsdcBalance,
  postUsePodOperatorBond,
} from "@/lib/services/usepod/host-bond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HostSetupAction = "status" | "install" | "pair" | "pair-status" | "preflight" | "setup";
type HostSetupBody = {
  action?: HostSetupAction;
  hostToken?: string;
  tokenEnvName?: string;
  activatedModels?: unknown;
  displayName?: string;
};

const execFileAsync = promisify(execFile);
const USER_LOCAL_PREFIX = join(homedir(), ".local");
const USER_LOCAL_BIN = join(USER_LOCAL_PREFIX, "bin");
const USER_LOCAL_AGENT = join(USER_LOCAL_BIN, "usepod-agent");
const PAIRING_URL_FALLBACK = "https://usepod.ai/host/pair";
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const USEPOD_HOST_PROVIDER_WALLET_ID = "usepod-host-provider";

type ExecFailure = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: string | number;
  signal?: NodeJS.Signals;
};

type PairingSession = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  pairingCode: string;
  pairingUrl: string;
  status: "starting" | "waiting" | "paired" | "failed";
  error: string;
  startedAt: number;
};

type PairingClaimResult = {
  status: "claimed" | "missing-token" | "failed";
  message: string;
  enrolled?: boolean;
  walletAddress?: string;
  response?: unknown;
};

type UsePodHostEnrollment = {
  token: string;
  walletAddress: string;
  enrolled: boolean;
  bondAmountUsdc: number;
  bondDepositCode: string;
  profileStatus: string;
  bondSignature?: string;
};

type UsePodHostProfile = {
  status?: string;
  bond?: {
    amount_usdc?: number | string;
    deposit_code?: string;
  };
  metadata?: {
    enrollment_code?: string;
  };
};

type UsePodHostProviderGate =
  | { status: "ready"; message: string; walletAddress: string; bondSignature?: string }
  | { status: "funded"; message: string; walletAddress: string; bondAmountUsdc: number; balanceUsdc: number; depositCode: string }
  | { status: "needs-bond"; message: string; walletAddress: string; bondAmountUsdc: number; balanceUsdc: number; depositCode: string }
  | { status: "failed"; message: string; walletAddress?: string };

const globalPairingState = globalThis as typeof globalThis & {
  __hivemindUsePodPairing?: PairingSession;
};

function cleanOutput(value: unknown) {
  return String(value ?? "").trim();
}

function agentEnv() {
  return {
    ...process.env,
    PATH: [USER_LOCAL_BIN, process.env.PATH].filter(Boolean).join(":"),
  };
}

function errorDetails(label: string, error: unknown) {
  const failure = error as ExecFailure;
  const output = cleanOutput([failure.stdout, failure.stderr].filter(Boolean).join("\n"));
  const status = failure.code || failure.signal ? ` (${[failure.code, failure.signal].filter(Boolean).join(", ")})` : "";
  return [failure.message || `${label} failed${status}.`, output].filter(Boolean).join("\n\n");
}

function parsePairingCode(output: string) {
  return output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0] ?? "";
}

function parsePairingUrl(output: string) {
  return output.match(/https:\/\/usepod\.ai\/host\/pair[^\s]*/)?.[0] ?? PAIRING_URL_FALLBACK;
}

function parseEnvFileValues(raw: string, predicate: (key: string) => boolean) {
  const values: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !predicate(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) values.push(value);
  }
  return values;
}

async function savedUsePodHostBondSignature() {
  const candidates = [process.env.USEPOD_HOST_BOND_SIGNATURE?.trim() || ""];
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    candidates.push(...parseEnvFileValues(raw, (key) => key === "USEPOD_HOST_BOND_SIGNATURE"));
  }
  return candidates.find(Boolean) ?? "";
}

function normalizeEnvValue(value: string) {
  return value.replace(/^export\s+/, "").trim();
}

function quoteEnvValue(value: string) {
  if (!value || /[\s#'"\\$`]/.test(value)) {
    return `'${value.replace(/'/g, "'\"'\"'")}'`;
  }
  return value;
}

function upsertEnvValues(raw: string, values: Record<string, string>) {
  const remaining = new Map(Object.entries(values));
  const output: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      output.push(line);
      continue;
    }
    const match = normalizeEnvValue(line).match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) {
      output.push(line);
      continue;
    }
    const value = remaining.get(match[1]) ?? "";
    output.push(`${match[1]}=${quoteEnvValue(value)}`);
    remaining.delete(match[1]);
  }
  if (remaining.size && output.length && output[output.length - 1]?.trim()) output.push("");
  for (const [key, value] of remaining) {
    output.push(`${key}=${quoteEnvValue(value)}`);
  }
  return `${output.join("\n").replace(/\n*$/, "")}\n`;
}

async function saveUsePodHostEnvValues(values: Record<string, string>) {
  await mkdir(dirname(HIVE_ENV_FILE), { recursive: true, mode: 0o700 });
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  await writeFile(HIVE_ENV_FILE, upsertEnvValues(raw, values), { mode: 0o600 });
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function isSolanaAddress(value: string) {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function extractHostToken(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const values = new Set<unknown>();
  const stack: unknown[] = [data];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (/token/i.test(key)) values.add(value);
      if (value && typeof value === "object") stack.push(value);
    }
  }
  for (const value of values) {
    if (typeof value === "string" && value.startsWith("pod_host_")) return value.trim();
  }
  return "";
}

function hostProfileStatus(profile: UsePodHostProfile | null) {
  return profile?.status?.trim().toLowerCase() || "";
}

function hostProfileHasActiveBond(profile: UsePodHostProfile | null) {
  const status = hostProfileStatus(profile);
  return Boolean(status && status !== "pending");
}

function hostBondAmount(profile: UsePodHostProfile | null) {
  const raw = profile?.bond?.amount_usdc;
  const amount = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : USEPOD_PROVIDER_BOND_USDC;
}

function hostBondDepositCode(profile: UsePodHostProfile | null) {
  return profile?.bond?.deposit_code?.trim() ||
    bondDepositCodeFromEnrollmentCode(profile?.metadata?.enrollment_code) ||
    "";
}

async function fetchUsePodHostProfile(token: string) {
  const response = await fetch(`${USEPOD_API_BASE}/v1/host/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null) as UsePodHostProfile | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUsePodHostBond(token: string, timeoutMs: number) {
  const startedAt = Date.now();
  let profile = await fetchUsePodHostProfile(token);
  while (!hostProfileHasActiveBond(profile) && Date.now() - startedAt < timeoutMs) {
    await sleep(2_000);
    profile = await fetchUsePodHostProfile(token);
  }
  return profile;
}

async function savedUsePodHostWalletAddress() {
  const candidates: string[] = [
    process.env.USEPOD_HOST_WALLET_ADDRESS?.trim() || "",
    process.env.USEPOD_HOST_WALLET?.trim() || "",
    process.env.SOLANA_WALLET_ADDRESS?.trim() || "",
  ];
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    candidates.push(...parseEnvFileValues(raw, (key) => (
      key === "USEPOD_HOST_WALLET_ADDRESS" ||
      key === "USEPOD_HOST_WALLET" ||
      key === "SOLANA_WALLET_ADDRESS"
    )));
  }
  return candidates.find(isSolanaAddress) ?? "";
}

async function ensureUsePodHostWalletAddress() {
  const savedAddress = await savedUsePodHostWalletAddress();
  if (savedAddress) return savedAddress;

  const existing = await getWalletInfo(USEPOD_HOST_PROVIDER_WALLET_ID).catch(() => null);
  if (existing?.address && isSolanaAddress(existing.address)) {
    await saveUsePodHostEnvValues({ USEPOD_HOST_WALLET_ADDRESS: existing.address });
    return existing.address;
  }

  const wallet = generateWallet("solana:mainnet");
  await storeWalletSecret({
    agentId: USEPOD_HOST_PROVIDER_WALLET_ID,
    address: wallet.address,
    network: wallet.network,
    secret: wallet.secret,
  });
  await saveUsePodHostEnvValues({ USEPOD_HOST_WALLET_ADDRESS: wallet.address });
  return wallet.address;
}

function enrollmentDisplayName(body: HostSetupBody) {
  const requested = body.displayName?.trim();
  if (requested) return requested.slice(0, 80);
  return "HivemindOS This Mac";
}

async function enrollUsePodHostProvider(body: HostSetupBody): Promise<UsePodHostEnrollment> {
  const existing = await savedUsePodHostTokenCandidates(body);
  if (existing[0]) {
    const profile = await fetchUsePodHostProfile(existing[0]);
    return {
      token: existing[0],
      walletAddress: await ensureUsePodHostWalletAddress(),
      enrolled: false,
      bondAmountUsdc: hostBondAmount(profile),
      bondDepositCode: hostBondDepositCode(profile),
      profileStatus: hostProfileStatus(profile),
    };
  }

  const walletAddress = await ensureUsePodHostWalletAddress();
  const response = await fetch(`${USEPOD_API_BASE}/v1/host/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: enrollmentDisplayName(body),
      wallet: walletAddress,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data ? String(data.message) : JSON.stringify(data);
    throw new Error(`UsePod host enrollment failed (${response.status}): ${message || response.statusText}`);
  }
  const token = extractHostToken(data);
  if (!token) throw new Error("UsePod host enrollment did not return a provider token.");
  const profile = await fetchUsePodHostProfile(token);
  await saveUsePodHostEnvValues({
    USEPOD_HOST_TOKEN: token,
    USEPOD_HOST_WALLET_ADDRESS: walletAddress,
  });
  return {
    token,
    walletAddress,
    enrolled: true,
    bondAmountUsdc: hostBondAmount(profile),
    bondDepositCode: hostBondDepositCode(profile),
    profileStatus: hostProfileStatus(profile),
  };
}

async function savedUsePodHostTokenCandidates(body: HostSetupBody) {
  const candidates: string[] = [
    body.hostToken?.trim() || "",
  ];
  const envNames = new Set(
    ["USEPOD_HOST_TOKEN", body.tokenEnvName?.trim()].filter((value): value is string => Boolean(value)),
  );
  for (const envName of envNames) {
    candidates.push(process.env[envName]?.trim() || "");
  }

  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    for (const envName of envNames) {
      candidates.push(...parseEnvFileValues(raw, (key) => key === envName));
    }
    candidates.push(...parseEnvFileValues(raw, (key) => /^USEPOD_HOST_TOKEN(?:_|$)/.test(key)));
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (/^USEPOD_HOST_TOKEN(?:_|$)/.test(key)) candidates.push(value?.trim() || "");
  }

  return Array.from(new Set(candidates.filter((candidate) => candidate.startsWith("pod_host_"))));
}

function activatedModelsFromBody(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

async function getUsePodAgentPath() {
  try {
    const result = await execFileAsync("sh", ["-lc", "command -v usepod-agent"], {
      env: agentEnv(),
      timeout: 5_000,
    });
    return cleanOutput(result.stdout);
  } catch {
    try {
      await access(USER_LOCAL_AGENT, constants.X_OK);
      return USER_LOCAL_AGENT;
    } catch {
      return "";
    }
  }
}

async function getUsePodAgentStatus() {
  const agentPath = await getUsePodAgentPath();
  const installed = Boolean(agentPath);
  if (!installed) return { installed, version: "", path: "" };
  const version = await execFileAsync(agentPath, ["--version"], {
    env: agentEnv(),
    timeout: 8_000,
  })
    .then((result) => cleanOutput(result.stdout || result.stderr))
    .catch(() => "");
  return { installed, version, path: agentPath };
}

function stopPairingSession(reason: string) {
  const existing = globalPairingState.__hivemindUsePodPairing;
  if (!existing || existing.status === "paired" || existing.status === "failed") return;
  existing.status = "failed";
  existing.error = reason;
  if (!existing.child.killed) existing.child.kill("SIGTERM");
}

async function installUsePodAgent() {
  await mkdir(USER_LOCAL_BIN, { recursive: true });
  try {
    const result = await execFileAsync("sh", ["-c", "curl -fsSL https://usepod.ai/install.sh | sh"], {
      env: {
        ...agentEnv(),
        USEPOD_PREFIX: USER_LOCAL_PREFIX,
      },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return cleanOutput(result.stdout || result.stderr);
  } catch (error) {
    throw new Error(errorDetails("UsePod host install", error));
  }
}

async function startUsePodPairing() {
  const existing = globalPairingState.__hivemindUsePodPairing;
  if (existing && existing.status !== "paired" && existing.status !== "failed" && !existing.child.killed) {
    return existing;
  }

  const agentPath = await getUsePodAgentPath();
  if (!agentPath) throw new Error(`usepod-agent is not installed at ${USER_LOCAL_AGENT}.`);
  const child = spawn(agentPath, ["setup"], {
    env: agentEnv(),
  });
  const session: PairingSession = {
    child,
    output: "",
    pairingCode: "",
    pairingUrl: PAIRING_URL_FALLBACK,
    status: "starting",
    error: "",
    startedAt: Date.now(),
  };
  const appendOutput = (chunk: Buffer) => {
    session.output = cleanOutput(`${session.output}\n${chunk.toString("utf8")}`);
    session.pairingCode ||= parsePairingCode(session.output);
    session.pairingUrl = parsePairingUrl(session.output);
    if (session.pairingCode && session.status === "starting") session.status = "waiting";
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("error", (error) => {
    session.status = "failed";
    session.error = error.message;
  });
  child.on("exit", (code, signal) => {
    if (code === 0) {
      session.status = "paired";
      return;
    }
    session.status = "failed";
    session.error = cleanOutput([
      `usepod-agent setup exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
      session.output,
    ].join("\n\n"));
  });
  globalPairingState.__hivemindUsePodPairing = session;

  const prompt = await waitForPairingPrompt(session);
  return prompt;
}

function waitForPairingPrompt(session: PairingSession) {
  return new Promise<PairingSession>((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.pairingCode || session.status === "paired") {
        clearInterval(timer);
        resolve(session);
        return;
      }
      if (session.status === "failed") {
        clearInterval(timer);
        reject(new Error(session.error || "UsePod host pairing failed before a code was created."));
        return;
      }
      if (Date.now() - startedAt > 15_000) {
        clearInterval(timer);
        reject(new Error(cleanOutput([
          "UsePod host pairing did not print a pairing code within 15 seconds.",
          session.output,
        ].join("\n\n"))));
      }
    }, 250);
  });
}

function pairingSessionResponse(session: PairingSession) {
  return {
    pairingCode: session.pairingCode,
    pairingUrl: session.pairingUrl || PAIRING_URL_FALLBACK,
    status: session.status,
    error: session.error,
    output: session.output,
    startedAt: session.startedAt,
  };
}

async function claimUsePodPairing(pairingCode: string, body: HostSetupBody): Promise<PairingClaimResult> {
  let enrollment: UsePodHostEnrollment;
  try {
    enrollment = await enrollUsePodHostProvider(body);
  } catch (error) {
    return {
      status: "missing-token",
      message: error instanceof Error ? error.message : "UsePod host enrollment failed.",
    };
  }
  const activatedModels = activatedModelsFromBody(body.activatedModels);
  let lastError = "";
  const tokens = Array.from(new Set([enrollment.token, ...await savedUsePodHostTokenCandidates(body)]));
  for (const token of tokens) {
    const response = await fetch(`${USEPOD_API_BASE}/v1/host/pair/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pair_code: pairingCode, activated_models: activatedModels }),
      cache: "no-store",
    });
    const data = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
    if (response.ok) {
      return {
        status: "claimed",
        message: enrollment.enrolled
          ? "UsePod host provider token created and pairing accepted."
          : "UsePod host provider token accepted the pairing code.",
        enrolled: enrollment.enrolled,
        walletAddress: enrollment.walletAddress,
        response: data,
      };
    }
    const error = data && typeof data === "object" && "message" in data ? String(data.message) : JSON.stringify(data);
    lastError = `UsePod pair claim failed (${response.status}): ${error || response.statusText}`;
  }
  return {
    status: "failed",
    message: lastError || "UsePod pair claim failed with every saved token.",
    enrolled: enrollment.enrolled,
    walletAddress: enrollment.walletAddress,
  };
}

async function ensureUsePodHostProviderReady(body: HostSetupBody): Promise<UsePodHostProviderGate> {
  let enrollment: UsePodHostEnrollment;
  try {
    enrollment = await enrollUsePodHostProvider(body);
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "UsePod host provider enrollment failed.",
    };
  }

  const profile = await fetchUsePodHostProfile(enrollment.token);
  if (hostProfileHasActiveBond(profile)) {
    return {
      status: "ready",
      message: "UsePod provider bond is active.",
      walletAddress: enrollment.walletAddress,
    };
  }

  const bondAmountUsdc = hostBondAmount(profile) || enrollment.bondAmountUsdc;
  const depositCode = hostBondDepositCode(profile) || enrollment.bondDepositCode;
  const submittedBondSignature = await savedUsePodHostBondSignature();
  if (submittedBondSignature) {
    const creditedProfile = await waitForUsePodHostBond(enrollment.token, 60_000);
    if (hostProfileHasActiveBond(creditedProfile)) {
      return {
        status: "ready",
        message: "UsePod provider bond is active.",
        walletAddress: enrollment.walletAddress,
        bondSignature: submittedBondSignature,
      };
    }
    return {
      status: "needs-bond",
      message: "UsePod bond transaction was submitted and is still being credited. Setup will pair automatically after UsePod marks the bond active.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode,
    };
  }
  if (!depositCode) {
    return {
      status: "needs-bond",
      message: "UsePod created the provider account, but did not return a bond deposit code yet.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode: "",
    };
  }

  const wallet = await getWalletSecret(USEPOD_HOST_PROVIDER_WALLET_ID).catch(() => null);
  if (!wallet || wallet.info.address !== enrollment.walletAddress) {
    return {
      status: "needs-bond",
      message: "UsePod provider bond needs a local provider wallet key before it can be posted automatically.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode,
    };
  }

  const bond = await postUsePodOperatorBond({
    fromAddress: enrollment.walletAddress,
    secret: wallet.secret,
    amountUsdc: bondAmountUsdc,
    depositCode,
  });
  if (bond.status === "needs-funds") {
    return {
      status: "needs-bond",
      message: `Provider wallet has $${bond.balanceUsdc.toFixed(2)} USDC; UsePod requires $${bond.requiredUsdc.toFixed(2)} USDC for the operator bond.`,
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: bond.balanceUsdc,
      depositCode,
    };
  }

  await saveUsePodHostEnvValues({ USEPOD_HOST_BOND_SIGNATURE: bond.signature });
  const creditedProfile = await waitForUsePodHostBond(enrollment.token, 60_000);
  if (!hostProfileHasActiveBond(creditedProfile)) {
    return {
      status: "needs-bond",
      message: "UsePod bond transaction was submitted and is still being credited. Setup will pair automatically after UsePod marks the bond active.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode,
    };
  }

  return {
    status: "ready",
    message: "UsePod operator bond posted.",
    walletAddress: enrollment.walletAddress,
    bondSignature: bond.signature,
  };
}

async function preflightUsePodHostProvider(body: HostSetupBody): Promise<UsePodHostProviderGate> {
  let enrollment: UsePodHostEnrollment;
  try {
    enrollment = await enrollUsePodHostProvider(body);
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "UsePod host provider enrollment failed.",
    };
  }

  const profile = await fetchUsePodHostProfile(enrollment.token);
  if (hostProfileHasActiveBond(profile)) {
    return {
      status: "ready",
      message: "UsePod provider bond is active.",
      walletAddress: enrollment.walletAddress,
    };
  }

  const bondAmountUsdc = hostBondAmount(profile) || enrollment.bondAmountUsdc;
  const depositCode = hostBondDepositCode(profile) || enrollment.bondDepositCode;
  const balanceUsdc = await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0);
  if (balanceUsdc >= bondAmountUsdc) {
    return {
      status: "funded",
      message: "UsePod provider wallet is funded. Setup can post the operator bond.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc,
      depositCode,
    };
  }
  return {
    status: "needs-bond",
    message: `Provider wallet has $${balanceUsdc.toFixed(2)} USDC; UsePod requires $${bondAmountUsdc.toFixed(2)} USDC for the operator bond.`,
    walletAddress: enrollment.walletAddress,
    bondAmountUsdc,
    balanceUsdc,
    depositCode,
  };
}

function waitForPairingCompletion(session: PairingSession) {
  return new Promise<PairingSession>((resolve) => {
    if (session.status === "paired" || session.status === "failed") {
      resolve(session);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.status === "paired" || session.status === "failed" || Date.now() - startedAt > 60_000) {
        clearInterval(timer);
        resolve(session);
      }
    }, 500);
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as HostSetupBody;
    const action = body.action;
    if (action === "status") {
      return NextResponse.json({ ok: true, action, status: await getUsePodAgentStatus() });
    }
    if (action === "install") {
      const output = await installUsePodAgent();
      return NextResponse.json({ ok: true, action, output, status: await getUsePodAgentStatus() });
    }
    if (action === "preflight") {
      const provider = await preflightUsePodHostProvider(body);
      return NextResponse.json({ ok: true, action, status: provider.status, provider });
    }
    if (action === "pair" || action === "setup") {
      const provider = await ensureUsePodHostProviderReady(body);
      if (provider.status !== "ready") {
        stopPairingSession(provider.message);
        return NextResponse.json({ ok: true, action, status: provider.status, provider, claim: null });
      }
      const pairing = await startUsePodPairing();
      const claim = pairing.pairingCode ? await claimUsePodPairing(pairing.pairingCode, body) : null;
      const settledPairing = claim?.status === "claimed" ? await waitForPairingCompletion(pairing) : pairing;
      return NextResponse.json({ ok: true, action, ...pairingSessionResponse(settledPairing), provider, claim });
    }
    if (action === "pair-status") {
      const pairing = globalPairingState.__hivemindUsePodPairing;
      return NextResponse.json({
        ok: true,
        action,
        ...(pairing ? pairingSessionResponse(pairing) : {
          pairingCode: "",
          pairingUrl: PAIRING_URL_FALLBACK,
          status: "idle",
          error: "",
          output: "",
          startedAt: 0,
        }),
      });
    }
    return NextResponse.json({ ok: false, error: "Unknown UsePod host setup action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "UsePod host setup failed.",
    }, { status: 500 });
  }
}
