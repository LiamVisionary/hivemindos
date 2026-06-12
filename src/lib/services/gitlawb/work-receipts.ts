// Verifies signed agent work receipts produced by collectors
// (scripts/agent-identity.mjs + the collector's POST /work-receipts).
//
// A receipt proves "this agent DID produced this commit on this machine" with
// an Ed25519 signature over a canonical JSON payload, plus a UCAN-shaped
// machine->agent delegation. Verification needs only the receipt itself (the
// public key is embedded in the did:key), so it works for any repo — including
// projects that are not hosted on GitLawb.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import type { GitLawbProof } from "@/lib/types/gitlawb";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_SPKI_PREFIX = Uint8Array.from(
  Buffer.from("302a300506032b6570032100", "hex"),
);
const RECEIPTS_VAULT_FILE = join(
  "Operations",
  "Brain Services",
  "Work Receipts.jsonl",
);

type WorkReceiptPayload = {
  v?: number;
  type?: string;
  agentDid?: string;
  agentId?: string;
  agentName?: string;
  machineId?: string;
  machineDid?: string;
  task?: { id?: string; title?: string; board?: string };
  repo?: {
    path?: string;
    remoteUrl?: string;
    branch?: string;
    commit?: string;
    dirty?: boolean;
    gitlawbRepoId?: string;
  };
  issuedAt?: string;
};

type WorkReceipt = {
  payload?: WorkReceiptPayload;
  signature?: string;
  delegation?: {
    payload?: { iss?: string; aud?: string; [key: string]: unknown };
    signature?: string;
  };
};

function base58btcDecode(text: string) {
  let value = 0n;
  for (const char of text) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base58 character: ${char}`);
    value = value * 58n + BigInt(index);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  let leadingZeros = 0;
  for (const char of text) {
    if (char !== "1") break;
    leadingZeros += 1;
  }
  if (leadingZeros > 0) {
    const padded = new Uint8Array(leadingZeros + bytes.length);
    padded.set(bytes, leadingZeros);
    bytes = padded;
  }
  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function publicKeyFromDidKey(did: string) {
  if (!did.startsWith("did:key:z"))
    throw new Error(`Not a base58btc did:key: ${did}`);
  const bytes = base58btcDecode(did.slice("did:key:z".length));
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) {
    throw new Error(`Not an ed25519 did:key: ${did}`);
  }
  return createPublicKey({
    key: Buffer.from(concatBytes([ED25519_SPKI_PREFIX, bytes.subarray(2)])),
    format: "der",
    type: "spki",
  });
}

// Must match canonicalJson in scripts/agent-identity.mjs exactly.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function verifyCanonical(
  payload: unknown,
  signatureBase64: string | undefined,
  did: string | undefined,
) {
  if (!signatureBase64 || !did) return false;
  try {
    return cryptoVerify(
      null,
      Uint8Array.from(Buffer.from(canonicalJson(payload), "utf8")),
      publicKeyFromDidKey(did),
      Uint8Array.from(Buffer.from(signatureBase64, "base64")),
    );
  } catch {
    return false;
  }
}

export function verifyWorkReceipt(receipt: WorkReceipt) {
  const payload = receipt?.payload;
  if (
    !payload ||
    payload.type !== "hivemind-work-receipt" ||
    !payload.agentDid
  ) {
    return { ok: false as const };
  }
  if (!verifyCanonical(payload, receipt.signature, payload.agentDid)) {
    return { ok: false as const };
  }
  const delegation = receipt.delegation?.payload;
  const delegationVerified = Boolean(
    delegation &&
    delegation.aud === payload.agentDid &&
    verifyCanonical(
      delegation,
      receipt.delegation?.signature,
      typeof delegation.iss === "string" ? delegation.iss : undefined,
    ),
  );
  return { ok: true as const, payload, delegationVerified };
}

function defaultVaultPath() {
  return (
    process.env.HIVEMINDOS_SYNC_PATH?.trim() ||
    process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH?.trim() ||
    join(homedir(), "Documents", "Obsidian", "hivemindos-vault")
  );
}

function receiptFilesFor(vaultPath?: string) {
  return [
    join(vaultPath?.trim() || defaultVaultPath(), RECEIPTS_VAULT_FILE),
    join(homedir(), ".hivemindos", "work-receipts.jsonl"),
  ];
}

function proofFromReceipt(
  payload: WorkReceiptPayload,
  delegationVerified: boolean,
): GitLawbProof {
  const issuedAtMs = Date.parse(payload.issuedAt ?? "");
  return {
    id: `work-receipt:${payload.task?.id ?? "unknown"}:${payload.agentDid}`,
    kind: "task",
    status: "verified",
    actorDid: payload.agentDid,
    repo: payload.repo?.remoteUrl || payload.repo?.path,
    branch: payload.repo?.branch,
    commit: payload.repo?.commit,
    title: payload.agentName
      ? `Signed by ${payload.agentName}`
      : "Signed work receipt",
    verifiedAt: Number.isNaN(issuedAtMs) ? Date.now() : issuedAtMs,
    metadata: {
      receipt: true,
      agentId: payload.agentId,
      machineId: payload.machineId,
      machineDid: payload.machineDid,
      delegationVerified,
      dirty: payload.repo?.dirty,
    },
  };
}

const receiptCache = new Map<
  string,
  { mtimeMs: number; byTaskId: Map<string, GitLawbProof> }
>();

function verifiedProofsFromFile(file: string) {
  if (!existsSync(file)) return null;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const cached = receiptCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.byTaskId;
  const byTaskId = new Map<string, GitLawbProof>();
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let receipt: WorkReceipt;
    try {
      receipt = JSON.parse(line) as WorkReceipt;
    } catch {
      continue;
    }
    const verification = verifyWorkReceipt(receipt);
    if (!verification.ok) continue;
    const taskId = verification.payload.task?.id;
    if (!taskId) continue;
    // Later receipts for the same task supersede earlier ones.
    byTaskId.set(
      taskId,
      proofFromReceipt(verification.payload, verification.delegationVerified),
    );
  }
  receiptCache.set(file, { mtimeMs, byTaskId });
  return byTaskId;
}

/** Verified, signature-checked work-receipt proofs indexed by kanban task id. */
export function verifiedWorkReceiptProofsByTask(vaultPath?: string) {
  const merged = new Map<string, GitLawbProof>();
  for (const file of receiptFilesFor(vaultPath)) {
    const fromFile = verifiedProofsFromFile(file);
    if (!fromFile) continue;
    for (const [taskId, proof] of fromFile) {
      if (!merged.has(taskId)) merged.set(taskId, proof);
    }
  }
  return merged;
}
