import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "@/lib/home-dir";

export const AGENT_IDENTITY_REGISTRY_PATH = join(homedir(), ".hivemindos", "agent-identities.json");

export type AgentIdentityStatus = "draft" | "verified" | "retired";

export type AgentIdentityProof = {
  type: "wallet-signature" | "ens" | "erc8004" | "service-endpoint" | "manual";
  value: string;
  verifiedAt?: string;
};

export type AgentIdentityRecord = {
  id: string;
  agentId: string;
  displayName: string;
  handle?: string;
  walletAddress?: string;
  network?: string;
  chainId?: string;
  ensName?: string;
  erc8004EntityId?: string;
  serviceEndpoint?: string;
  x402Endpoint?: string;
  capabilities: string[];
  proofs: AgentIdentityProof[];
  status: AgentIdentityStatus;
  createdAt: string;
  updatedAt: string;
  fingerprint: string;
};

export type AgentIdentityInput = Partial<Omit<AgentIdentityRecord, "createdAt" | "updatedAt" | "fingerprint">> & {
  agentId: string;
};

export type AgentIdentityUpsertResult = {
  record: AgentIdentityRecord;
  warnings: string[];
};

type AgentIdentityRegistryFile = {
  version: 1;
  records: AgentIdentityRecord[];
};

export async function listAgentIdentities(): Promise<AgentIdentityRecord[]> {
  const registry = await readRegistry();
  return registry.records.filter((record) => record.status !== "retired");
}

export async function getAgentIdentity(idOrAgentId: string): Promise<AgentIdentityRecord | null> {
  const key = idOrAgentId.trim();
  if (!key) return null;
  const registry = await readRegistry();
  return registry.records.find((record) => record.id === key || record.agentId === key || record.handle === key || record.ensName === key) ?? null;
}

export async function upsertAgentIdentity(input: AgentIdentityInput): Promise<AgentIdentityUpsertResult> {
  const normalized = normalizeIdentityInput(input);
  const registry = await readRegistry();
  const now = new Date().toISOString();
  const index = registry.records.findIndex((record) => record.id === normalized.id || record.agentId === normalized.agentId);
  const existing = index >= 0 ? registry.records[index] : undefined;
  const record: AgentIdentityRecord = {
    id: normalized.id || existing?.id || identityId(normalized.agentId),
    agentId: normalized.agentId,
    displayName: normalized.displayName || existing?.displayName || normalized.agentId,
    handle: normalized.handle ?? existing?.handle,
    walletAddress: normalized.walletAddress ?? existing?.walletAddress,
    network: normalized.network ?? existing?.network,
    chainId: normalized.chainId ?? existing?.chainId,
    ensName: normalized.ensName ?? existing?.ensName,
    erc8004EntityId: normalized.erc8004EntityId ?? existing?.erc8004EntityId,
    serviceEndpoint: normalized.serviceEndpoint ?? existing?.serviceEndpoint,
    x402Endpoint: normalized.x402Endpoint ?? existing?.x402Endpoint,
    capabilities: unique(normalized.capabilities ?? existing?.capabilities ?? []),
    proofs: uniqueProofs(normalized.proofs ?? existing?.proofs ?? []),
    status: normalized.status ?? existing?.status ?? "draft",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    fingerprint: "",
  };
  const validation = validateIdentity(record);
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  record.fingerprint = identityFingerprint(record);
  if (index >= 0) registry.records[index] = record;
  else registry.records.push(record);
  await writeRegistry(registry);
  return { record, warnings: validation.warnings };
}

export async function retireAgentIdentity(idOrAgentId: string): Promise<AgentIdentityRecord | null> {
  const registry = await readRegistry();
  const index = registry.records.findIndex((record) => record.id === idOrAgentId || record.agentId === idOrAgentId);
  if (index < 0) return null;
  const record = {
    ...registry.records[index],
    status: "retired" as const,
    updatedAt: new Date().toISOString(),
  };
  record.fingerprint = identityFingerprint(record);
  registry.records[index] = record;
  await writeRegistry(registry);
  return record;
}

export async function resetAgentIdentityRegistryForTests() {
  await unlink(AGENT_IDENTITY_REGISTRY_PATH).catch(() => {});
}

async function readRegistry(): Promise<AgentIdentityRegistryFile> {
  const raw = await readFile(AGENT_IDENTITY_REGISTRY_PATH, "utf8").catch(() => "");
  if (!raw.trim()) return { version: 1, records: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<AgentIdentityRegistryFile>;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return { version: 1, records: parsed.records.filter(isIdentityRecord) };
    }
  } catch {}
  return { version: 1, records: [] };
}

async function writeRegistry(registry: AgentIdentityRegistryFile) {
  await mkdir(dirname(AGENT_IDENTITY_REGISTRY_PATH), { recursive: true });
  const tmp = `${AGENT_IDENTITY_REGISTRY_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmp, AGENT_IDENTITY_REGISTRY_PATH);
}

function normalizeIdentityInput(input: AgentIdentityInput): AgentIdentityInput {
  const agentId = cleanRequired(input.agentId, "agentId");
  return {
    ...input,
    id: cleanText(input.id),
    agentId,
    displayName: cleanText(input.displayName),
    handle: cleanHandle(input.handle),
    walletAddress: cleanText(input.walletAddress),
    network: cleanText(input.network),
    chainId: cleanText(input.chainId),
    ensName: cleanEns(input.ensName),
    erc8004EntityId: cleanText(input.erc8004EntityId),
    serviceEndpoint: cleanUrl(input.serviceEndpoint),
    x402Endpoint: cleanUrl(input.x402Endpoint),
    capabilities: unique((input.capabilities ?? []).map((item) => cleanText(item)).filter((item): item is string => Boolean(item))),
    proofs: (input.proofs ?? []).filter(isProofInput),
    status: cleanStatus(input.status),
  };
}

function validateIdentity(record: AgentIdentityRecord) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!record.agentId.trim()) errors.push("agentId is required.");
  if (!record.displayName.trim()) errors.push("displayName is required.");
  if (record.walletAddress?.startsWith("0x") && !/^0x[a-fA-F0-9]{40}$/.test(record.walletAddress)) {
    errors.push("walletAddress is not a valid EVM address.");
  }
  if (record.ensName && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(record.ensName)) {
    errors.push("ensName must look like a dotted ENS name.");
  }
  for (const endpoint of [record.serviceEndpoint, record.x402Endpoint].filter(Boolean)) {
    if (!endpoint) continue;
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" && !isLocalHost(parsed.hostname)) {
      warnings.push(`${endpoint} is not HTTPS; only local development endpoints should use plain HTTP.`);
    }
  }
  if (!record.walletAddress && !record.ensName && !record.erc8004EntityId) {
    warnings.push("Identity has no wallet, ENS name, or ERC-8004 entity id yet.");
  }
  if (record.capabilities.length === 0) warnings.push("Identity has no advertised capabilities yet.");
  return { errors, warnings };
}

function identityId(agentId: string) {
  return agentId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || `agent-${randomUUID()}`;
}

function identityFingerprint(record: AgentIdentityRecord) {
  const stable = {
    id: record.id,
    agentId: record.agentId,
    displayName: record.displayName,
    handle: record.handle,
    walletAddress: record.walletAddress,
    network: record.network,
    chainId: record.chainId,
    ensName: record.ensName,
    erc8004EntityId: record.erc8004EntityId,
    serviceEndpoint: record.serviceEndpoint,
    x402Endpoint: record.x402Endpoint,
    capabilities: [...record.capabilities].sort(),
    proofs: record.proofs.map((proof) => `${proof.type}:${proof.value}`).sort(),
    status: record.status,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function isIdentityRecord(value: unknown): value is AgentIdentityRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AgentIdentityRecord>;
  return typeof record.id === "string" && typeof record.agentId === "string" && typeof record.displayName === "string";
}

function isProofInput(value: unknown): value is AgentIdentityProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<AgentIdentityProof>;
  return ["wallet-signature", "ens", "erc8004", "service-endpoint", "manual"].includes(String(proof.type)) && typeof proof.value === "string" && proof.value.trim().length > 0;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function uniqueProofs(values: AgentIdentityProof[]) {
  const seen = new Set<string>();
  return values.filter((proof) => {
    const key = `${proof.type}:${proof.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanRequired(value: unknown, label: string) {
  const cleaned = cleanText(value);
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanHandle(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  return text.replace(/^@/, "");
}

function cleanEns(value: unknown) {
  const text = cleanText(value);
  return text?.toLowerCase();
}

function cleanStatus(value: unknown): AgentIdentityStatus | undefined {
  return value === "draft" || value === "verified" || value === "retired" ? value : undefined;
}

function cleanUrl(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  try {
    return new URL(text).toString();
  } catch {
    throw new Error(`Invalid URL: ${text}`);
  }
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}
