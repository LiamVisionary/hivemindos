// Per-agent cryptographic identity for HivemindOS work receipts.
//
// Every agent gets its own Ed25519 keypair expressed as a standard did:key
// (multibase base58btc of multicodec ed25519-pub), matching GitLawb's
// recommended identity type for agents. The machine also gets one, and signs a
// UCAN-shaped delegation for each agent key so receipts carry a verifiable
// machine -> agent chain. None of this requires the repo to live on GitLawb:
// a signed work receipt proves which agent produced which commit on which
// machine for any git checkout.

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const IDENTITY_DIR =
  process.env.HIVEMINDOS_AGENT_IDENTITY_DIR ||
  join(homedir(), ".hivemindos", "agent-identities");
const MACHINE_IDENTITY_NAME = "_machine";
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// multicodec ed25519-pub (0xed) varint-encoded, per the did:key spec.
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);
// DER prefix for an Ed25519 SPKI public key; appending the raw 32-byte key
// yields a structure node:crypto can import.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base58btcEncode(bytes) {
  let value = BigInt("0x" + (bytes.toString("hex") || "0"));
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}

function base58btcDecode(text) {
  let value = 0n;
  for (const char of text) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base58 character: ${char}`);
    value = value * 58n + BigInt(index);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let bytes = Buffer.from(hex, "hex");
  let leadingZeros = 0;
  for (const char of text) {
    if (char !== "1") break;
    leadingZeros += 1;
  }
  if (leadingZeros > 0)
    bytes = Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
  return bytes;
}

export function didKeyFromRawPublicKey(rawPublicKey) {
  return `did:key:z${base58btcEncode(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPublicKey]))}`;
}

export function rawPublicKeyFromDidKey(did) {
  const value = String(did || "");
  if (!value.startsWith("did:key:z"))
    throw new Error(`Not a base58btc did:key: ${value}`);
  const bytes = base58btcDecode(value.slice("did:key:z".length));
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) {
    throw new Error(`Not an ed25519 did:key: ${value}`);
  }
  return bytes.subarray(2);
}

function publicKeyObjectFromDid(did) {
  const raw = rawPublicKeyFromDidKey(did);
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

// Deterministic JSON so signatures are stable regardless of key insertion order.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sanitizeIdentityName(name) {
  const cleaned = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned && cleaned !== MACHINE_IDENTITY_NAME) return cleaned;
  return `agent-${createHash("sha256")
    .update(String(name || "unknown"))
    .digest("hex")
    .slice(0, 12)}`;
}

function identityPath(name) {
  return join(IDENTITY_DIR, `${name}.json`);
}

function readIdentityFile(name) {
  try {
    const parsed = JSON.parse(readFileSync(identityPath(name), "utf8"));
    if (parsed?.did && parsed?.privateKeyPem) return parsed;
  } catch {
    // Missing or unreadable: caller creates a fresh identity.
  }
  return null;
}

function writeIdentityFile(name, identity) {
  mkdirSync(IDENTITY_DIR, { recursive: true, mode: 0o700 });
  const path = identityPath(name);
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(identity, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temp, path);
}

function createIdentity(subject) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(ED25519_SPKI_PREFIX.length);
  return {
    did: didKeyFromRawPublicKey(rawPublicKey),
    subject,
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    createdAt: new Date().toISOString(),
  };
}

function signCanonical(payload, privateKeyPem) {
  return cryptoSign(
    null,
    Buffer.from(canonicalJson(payload), "utf8"),
    privateKeyPem,
  ).toString("base64");
}

export function verifyCanonical(payload, signatureBase64, did) {
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      publicKeyObjectFromDid(did),
      Buffer.from(String(signatureBase64 || ""), "base64"),
    );
  } catch {
    return false;
  }
}

export function ensureMachineIdentity(machineId) {
  const existing = readIdentityFile(MACHINE_IDENTITY_NAME);
  if (existing) return existing;
  const identity = createIdentity(machineId || "machine");
  writeIdentityFile(MACHINE_IDENTITY_NAME, identity);
  return identity;
}

// UCAN-shaped machine -> agent delegation: the machine key attests that this
// agent key may sign work receipts produced on this machine. Swap for real gl
// UCAN issuance once the CLI exposes it.
function delegationForAgent(machineIdentity, agentDid, machineId) {
  const payload = {
    v: 1,
    type: "hivemind-delegation",
    iss: machineIdentity.did,
    aud: agentDid,
    can: ["work-receipt/sign"],
    with: `hivemind-machine:${machineId || "unknown"}`,
    iat: new Date().toISOString(),
  };
  return {
    payload,
    signature: signCanonical(payload, machineIdentity.privateKeyPem),
  };
}

export function ensureAgentIdentity(agentKey, options = {}) {
  const name = sanitizeIdentityName(agentKey);
  let identity = readIdentityFile(name);
  if (!identity) {
    identity = createIdentity(String(agentKey || "agent"));
  }
  if (!identity.delegation && options.machineId !== undefined) {
    const machineIdentity = ensureMachineIdentity(options.machineId);
    identity.delegation = delegationForAgent(
      machineIdentity,
      identity.did,
      options.machineId,
    );
    identity.machineDid = machineIdentity.did;
  }
  writeIdentityFile(name, identity);
  return identity;
}

export function agentDid(agentKey, options = {}) {
  return ensureAgentIdentity(agentKey, options).did;
}

export function signWorkReceipt(input) {
  const identity = ensureAgentIdentity(input.agentKey, {
    machineId: input.machineId,
  });
  const payload = {
    v: 1,
    type: "hivemind-work-receipt",
    agentDid: identity.did,
    agentId: input.agentId || String(input.agentKey || ""),
    agentName: input.agentName || undefined,
    machineId: input.machineId || undefined,
    machineDid: identity.machineDid || undefined,
    task:
      input.task && (input.task.id || input.task.title)
        ? {
            id: input.task.id || undefined,
            title: input.task.title || undefined,
            board: input.task.board || undefined,
          }
        : undefined,
    repo: input.repo
      ? {
          path: input.repo.path || undefined,
          remoteUrl: input.repo.remoteUrl || undefined,
          branch: input.repo.branch || undefined,
          commit: input.repo.commit || undefined,
          dirty:
            input.repo.dirty === undefined
              ? undefined
              : Boolean(input.repo.dirty),
          gitlawbRepoId: input.repo.gitlawbRepoId || undefined,
        }
      : undefined,
    issuedAt: new Date().toISOString(),
  };
  return {
    payload,
    signature: signCanonical(payload, identity.privateKeyPem),
    delegation: identity.delegation || undefined,
  };
}

export function verifyWorkReceipt(receipt) {
  const payload = receipt?.payload;
  if (
    !payload ||
    payload.type !== "hivemind-work-receipt" ||
    !payload.agentDid
  ) {
    return { ok: false, error: "Not a work receipt." };
  }
  if (!verifyCanonical(payload, receipt.signature, payload.agentDid)) {
    return { ok: false, error: "Agent signature did not verify." };
  }
  if (receipt.delegation?.payload) {
    const delegation = receipt.delegation.payload;
    const delegationValid =
      delegation.aud === payload.agentDid &&
      verifyCanonical(delegation, receipt.delegation.signature, delegation.iss);
    if (!delegationValid) return { ok: true, delegationVerified: false };
    return { ok: true, delegationVerified: true, machineDid: delegation.iss };
  }
  return { ok: true, delegationVerified: false };
}
