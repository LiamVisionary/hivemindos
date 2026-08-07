import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes, randomUUID, scrypt as scryptCallback } from "crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { createBrainReviewProposal } from "@/lib/services/brain-review-queue";
import { listAgentMemoryRecords } from "@/lib/services/obsidian/agent-memory/core";
import { detectSensitiveContent } from "@/lib/services/obsidian/agent-memory/redact";
import type { AgentMemoryRecord } from "@/lib/services/obsidian/agent-memory/types";
import { buildCompiledKnowledgeGraph } from "@/lib/services/obsidian/compiled-knowledge";
import { contentAddressForText } from "@/lib/services/obsidian/content-address";

export const BRAIN_CAPSULE_SCHEMA = "hivemindos.brain-capsule.v1" as const;
export const BRAIN_CAPSULE_ENVELOPE_SCHEMA = "hivemindos.brain-capsule-envelope.v1" as const;
export const BRAIN_CAPSULES_FOLDER = join(homedir(), ".hivemindos", "brain", "capsules");

const MAX_CAPSULE_BYTES = 64 * 1024 * 1024;
const MAX_IMPORT_PROPOSALS = 250;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const scrypt = promisify(scryptCallback);

type CapsuleMemory = Omit<AgentMemoryRecord, "searchScore" | "searchScoreNormalized" | "searchCollection" | "usage"> & {
  contentHash: string;
};

type CapsuleKnowledgeNode = {
  domain: string;
  slug: string;
  path: string;
  type: "entity" | "concept" | "summary";
  title: string;
  tags: string[];
  body: string;
  contentHash: string;
  outgoing: string[];
  backlinks: string[];
};

type CapsuleSearchRow = {
  id: string;
  kind: "memory" | "knowledge";
  title: string;
  contentHash: string;
  terms: Record<string, number>;
};

type CapsulePayload = {
  memories: CapsuleMemory[];
  knowledge: CapsuleKnowledgeNode[];
  searchIndex: CapsuleSearchRow[];
};

export type BrainCapsuleManifest = {
  capsuleId: string;
  createdAt: string;
  expiresAt?: string;
  project?: string;
  memoryIds?: string[];
  compiledDomains: string[];
  includeSuperseded: boolean;
  readOnlyDefault: true;
  importPolicy: "brain-review-only";
  counts: { memories: number; knowledge: number; searchRows: number };
  payloadSha256: string;
  sourceHashesSha256: string;
};

type PlainCapsule = {
  schema: typeof BRAIN_CAPSULE_SCHEMA;
  encrypted: false;
  manifest: BrainCapsuleManifest;
  payload: CapsulePayload;
};

type EncryptedCapsule = {
  schema: typeof BRAIN_CAPSULE_ENVELOPE_SCHEMA;
  encrypted: true;
  capsuleId: string;
  createdAt: string;
  expiresAt?: string;
  kdf: { name: "scrypt"; salt: string; keyBytes: 32 };
  cipher: { name: "aes-256-gcm"; iv: string; authTag: string };
  ciphertext: string;
};

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function safeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "brain";
}

function capsuleTerms(value: string) {
  const counts: Record<string, number> = {};
  const terms = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const term of terms.filter((item) => item.length >= (/[^\x00-\x7f]/.test(item) ? 2 : 3))) {
    counts[term] = Math.min(255, (counts[term] ?? 0) + 1);
  }
  return counts;
}

function searchRows(payload: Omit<CapsulePayload, "searchIndex">): CapsuleSearchRow[] {
  return [
    ...payload.memories.map((memory) => ({
      id: memory.id,
      kind: "memory" as const,
      title: memory.title,
      contentHash: memory.contentHash,
      terms: capsuleTerms(`${memory.title}\n${memory.type}\n${memory.tags.join(" ")}\n${memory.content}`),
    })),
    ...payload.knowledge.map((node) => ({
      id: `${node.domain}:${node.type}:${node.slug}`,
      kind: "knowledge" as const,
      title: node.title,
      contentHash: node.contentHash,
      terms: capsuleTerms(`${node.title}\n${node.type}\n${node.tags.join(" ")}\n${node.body}`),
    })),
  ];
}

function normalizedMemory(record: AgentMemoryRecord): CapsuleMemory {
  const portable = { ...record };
  delete portable.searchScore;
  delete portable.searchScoreNormalized;
  delete portable.searchCollection;
  delete portable.usage;
  return { ...portable, contentHash: record.contentHash ?? contentAddressForText(record.content) };
}

function assertNoSensitiveContent(title: string, content: string) {
  const sensitive = detectSensitiveContent(content);
  if (sensitive.blockers.length) {
    throw new Error(`Capsule export blocked because "${title}" appears to contain ${sensitive.blockers.join(", ")}. Remove the secret-bearing source or export a narrower scope.`);
  }
}

async function writeAtomic(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function encryptCapsule(capsule: PlainCapsule, passphrase: string): Promise<EncryptedCapsule> {
  if (passphrase.length < 12) throw new Error("Encrypted brain capsules require a passphrase of at least 12 characters.");
  const salt = randomBytes(16).toString("base64");
  const iv = Uint8Array.from(randomBytes(12));
  const key = await scrypt(passphrase, salt, 32) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", createSecretKey(Uint8Array.from(key)), iv);
  const ciphertext = cipher.update(JSON.stringify(capsule), "utf8", "base64") + cipher.final("base64");
  return {
    schema: BRAIN_CAPSULE_ENVELOPE_SCHEMA,
    encrypted: true,
    capsuleId: capsule.manifest.capsuleId,
    createdAt: capsule.manifest.createdAt,
    expiresAt: capsule.manifest.expiresAt,
    kdf: { name: "scrypt", salt, keyBytes: 32 },
    cipher: { name: "aes-256-gcm", iv: Buffer.from(iv).toString("base64"), authTag: cipher.getAuthTag().toString("base64") },
    ciphertext,
  };
}

function validateEncryptedEnvelope(envelope: EncryptedCapsule) {
  const salt = typeof envelope.kdf?.salt === "string" ? Buffer.from(envelope.kdf.salt, "base64") : Buffer.alloc(0);
  const iv = typeof envelope.cipher?.iv === "string" ? Buffer.from(envelope.cipher.iv, "base64") : Buffer.alloc(0);
  const authTag = typeof envelope.cipher?.authTag === "string" ? Buffer.from(envelope.cipher.authTag, "base64") : Buffer.alloc(0);
  if (
    envelope.schema !== BRAIN_CAPSULE_ENVELOPE_SCHEMA
    || envelope.encrypted !== true
    || envelope.kdf?.name !== "scrypt"
    || envelope.kdf.keyBytes !== 32
    || salt.length !== 16
    || envelope.cipher?.name !== "aes-256-gcm"
    || iv.length !== 12
    || authTag.length !== 16
    || typeof envelope.ciphertext !== "string"
    || !envelope.ciphertext
  ) throw new Error("Unsupported or malformed encrypted brain capsule envelope.");
}

async function decryptCapsule(envelope: EncryptedCapsule, passphrase?: string) {
  validateEncryptedEnvelope(envelope);
  if (!passphrase) throw new Error("This brain capsule is encrypted; provide its passphrase.");
  try {
    const key = await scrypt(passphrase, envelope.kdf.salt, envelope.kdf.keyBytes) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", createSecretKey(Uint8Array.from(key)), Uint8Array.from(Buffer.from(envelope.cipher.iv, "base64")));
    decipher.setAuthTag(Uint8Array.from(Buffer.from(envelope.cipher.authTag, "base64")));
    const plaintext = decipher.update(envelope.ciphertext, "base64", "utf8") + decipher.final("utf8");
    return JSON.parse(plaintext) as PlainCapsule;
  } catch {
    throw new Error("Could not decrypt the brain capsule or verify its authentication tag.");
  }
}

function validatePlainCapsule(capsule: PlainCapsule, allowExpired = false) {
  if (
    capsule.schema !== BRAIN_CAPSULE_SCHEMA
    || capsule.encrypted !== false
    || !capsule.manifest
    || !capsule.payload
    || !Array.isArray(capsule.payload.memories)
    || !Array.isArray(capsule.payload.knowledge)
    || !Array.isArray(capsule.payload.searchIndex)
    || capsule.manifest.readOnlyDefault !== true
    || capsule.manifest.importPolicy !== "brain-review-only"
    || typeof capsule.manifest.capsuleId !== "string"
    || !/^capsule-[A-Za-z0-9._-]{8,96}$/.test(capsule.manifest.capsuleId)
    || !Number.isFinite(Date.parse(capsule.manifest.createdAt))
    || (capsule.manifest.project !== undefined && typeof capsule.manifest.project !== "string")
    || (capsule.manifest.memoryIds !== undefined && (!Array.isArray(capsule.manifest.memoryIds) || capsule.manifest.memoryIds.some((id) => typeof id !== "string" || !id)))
    || !Array.isArray(capsule.manifest.compiledDomains)
    || capsule.manifest.compiledDomains.some((domain) => typeof domain !== "string" || !domain)
    || typeof capsule.manifest.includeSuperseded !== "boolean"
    || !SHA256_PATTERN.test(capsule.manifest.payloadSha256)
    || !SHA256_PATTERN.test(capsule.manifest.sourceHashesSha256)
    || !capsule.manifest.counts
    || Object.values(capsule.manifest.counts).some((count) => !Number.isInteger(count) || count < 0)
  ) {
    throw new Error("Unsupported or malformed brain capsule.");
  }
  if (capsule.manifest.expiresAt && !Number.isFinite(Date.parse(capsule.manifest.expiresAt))) throw new Error("Brain capsule expiry is malformed.");
  const payloadRaw = JSON.stringify(capsule.payload);
  if (sha256(payloadRaw) !== capsule.manifest.payloadSha256) throw new Error("Brain capsule payload checksum verification failed.");
  for (const memory of capsule.payload.memories) {
    if (
      !memory?.id
      || typeof memory.id !== "string"
      || typeof memory.title !== "string"
      || !memory.title
      || typeof memory.type !== "string"
      || typeof memory.content !== "string"
      || !Array.isArray(memory.tags)
      || memory.tags.some((tag) => typeof tag !== "string")
      || memory.contentHash !== contentAddressForText(memory.content)
    ) {
      throw new Error("Brain capsule memory content-address verification failed.");
    }
  }
  if (new Set(capsule.payload.memories.map((memory) => memory.id)).size !== capsule.payload.memories.length) {
    throw new Error("Brain capsule contains duplicate memory ids.");
  }
  for (const node of capsule.payload.knowledge) {
    if (
      typeof node?.domain !== "string"
      || !node.domain
      || typeof node.slug !== "string"
      || !node.slug
      || typeof node.title !== "string"
      || typeof node.type !== "string"
      || typeof node.body !== "string"
      || !Array.isArray(node.tags)
      || node.tags.some((tag) => typeof tag !== "string")
      || node.contentHash !== contentAddressForText(node.body)
    ) {
      throw new Error("Brain capsule compiled-knowledge content-address verification failed.");
    }
  }
  if (new Set(capsule.payload.knowledge.map((node) => `${node.domain}:${node.type}:${node.slug}`)).size !== capsule.payload.knowledge.length) {
    throw new Error("Brain capsule contains duplicate compiled-knowledge ids.");
  }
  const expectedSearchIndex = searchRows({ memories: capsule.payload.memories, knowledge: capsule.payload.knowledge });
  if (sha256(JSON.stringify(expectedSearchIndex)) !== sha256(JSON.stringify(capsule.payload.searchIndex))) {
    throw new Error("Brain capsule embedded search index verification failed.");
  }
  if (
    capsule.manifest.counts?.memories !== capsule.payload.memories.length
    || capsule.manifest.counts?.knowledge !== capsule.payload.knowledge.length
    || capsule.manifest.counts?.searchRows !== capsule.payload.searchIndex.length
  ) throw new Error("Brain capsule manifest counts do not match its payload.");
  const sourceHashes = [
    ...capsule.payload.memories.map((record) => `${record.id}:${record.contentHash}`),
    ...capsule.payload.knowledge.map((node) => `${node.domain}:${node.slug}:${node.contentHash}`),
  ].sort();
  if (sha256(JSON.stringify(sourceHashes)) !== capsule.manifest.sourceHashesSha256) throw new Error("Brain capsule provenance checksum verification failed.");
  if (!allowExpired && capsule.manifest.expiresAt && Date.parse(capsule.manifest.expiresAt) <= Date.now()) {
    throw new Error(`Brain capsule expired at ${capsule.manifest.expiresAt}.`);
  }
  return capsule;
}

export async function createBrainCapsule(input: {
  vaultPath?: string;
  project?: string;
  memoryIds?: string[];
  compiledDomains?: string[];
  includeSuperseded?: boolean;
  expiresAt?: string;
  passphrase?: string;
}) {
  const project = input.project?.trim();
  const requestedIds = new Set((input.memoryIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (!project && !requestedIds.size) throw new Error("Capsule export requires an explicit project or memoryIds scope.");
  const expiresAt = input.expiresAt?.trim();
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    throw new Error("Capsule expiresAt must be a valid future timestamp.");
  }
  const { records } = await listAgentMemoryRecords({ vaultPath: input.vaultPath });
  const memories = records
    .filter((record) => (!project || record.project?.toLowerCase() === project.toLowerCase()))
    .filter((record) => (!requestedIds.size || requestedIds.has(record.id)))
    .filter((record) => input.includeSuperseded || record.status === "active")
    .map(normalizedMemory);
  for (const memory of memories) assertNoSensitiveContent(memory.title, `${memory.title}\n${memory.content}`);

  const compiledDomains = [...new Set((input.compiledDomains ?? []).map((domain) => domain.trim()).filter(Boolean))].slice(0, 24);
  const knowledge: CapsuleKnowledgeNode[] = [];
  for (const domain of compiledDomains) {
    const graph = await buildCompiledKnowledgeGraph({ vaultPath: input.vaultPath, domain });
    for (const node of graph.nodes) {
      assertNoSensitiveContent(node.title, `${node.title}\n${node.body}`);
      knowledge.push({
        domain: graph.domain,
        slug: node.slug,
        path: node.path,
        type: node.type,
        title: node.title,
        tags: node.tags,
        body: node.body,
        contentHash: contentAddressForText(node.body),
        outgoing: node.outgoing,
        backlinks: node.backlinks,
      });
    }
  }
  const payloadBase = { memories, knowledge };
  if (!memories.length && !knowledge.length) throw new Error("Capsule scope matched no portable memories or compiled knowledge.");
  const payload: CapsulePayload = { ...payloadBase, searchIndex: searchRows(payloadBase) };
  const createdAt = new Date().toISOString();
  const capsuleId = `capsule-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 12)}`;
  const sourceHashes = [
    ...memories.map((record) => `${record.id}:${record.contentHash}`),
    ...knowledge.map((node) => `${node.domain}:${node.slug}:${node.contentHash}`),
  ].sort();
  const manifest: BrainCapsuleManifest = {
    capsuleId,
    createdAt,
    expiresAt,
    project,
    memoryIds: requestedIds.size ? [...requestedIds] : undefined,
    compiledDomains,
    includeSuperseded: Boolean(input.includeSuperseded),
    readOnlyDefault: true,
    importPolicy: "brain-review-only",
    counts: { memories: memories.length, knowledge: knowledge.length, searchRows: payload.searchIndex.length },
    payloadSha256: sha256(JSON.stringify(payload)),
    sourceHashesSha256: sha256(JSON.stringify(sourceHashes)),
  };
  const capsule: PlainCapsule = { schema: BRAIN_CAPSULE_SCHEMA, encrypted: false, manifest, payload };
  const serialized = input.passphrase ? JSON.stringify(await encryptCapsule(capsule, input.passphrase)) : JSON.stringify(capsule);
  if (Buffer.byteLength(serialized, "utf8") + 1 > MAX_CAPSULE_BYTES) throw new Error("Brain capsule export exceeds the 64 MiB safety limit; export a narrower scope.");
  const filename = `${safeSlug(project || "selected-memories")}-${capsuleId}.${input.passphrase ? "hivebrain.enc" : "hivebrain"}`;
  const capsulePath = join(BRAIN_CAPSULES_FOLDER, filename);
  await writeAtomic(capsulePath, `${serialized}\n`);
  return { capsulePath, encrypted: Boolean(input.passphrase), manifest };
}

export async function openBrainCapsule(input: { capsulePath: string; passphrase?: string; allowExpired?: boolean }) {
  const capsulePath = resolve(input.capsulePath);
  if (!/\.hivebrain(?:\.enc)?$/i.test(capsulePath)) throw new Error("Brain capsule files must end in .hivebrain or .hivebrain.enc.");
  const st = await stat(capsulePath).catch(() => null);
  if (!st?.isFile() || st.size > MAX_CAPSULE_BYTES) throw new Error("Brain capsule is missing or exceeds the 64 MiB safety limit.");
  const raw = await readFile(capsulePath, "utf8");
  let parsed: PlainCapsule | EncryptedCapsule;
  try {
    parsed = JSON.parse(raw) as PlainCapsule | EncryptedCapsule;
  } catch {
    throw new Error("Brain capsule is not valid JSON.");
  }
  const plain = parsed.schema === BRAIN_CAPSULE_ENVELOPE_SCHEMA
    ? await decryptCapsule(parsed as EncryptedCapsule, input.passphrase)
    : parsed as PlainCapsule;
  const capsule = validatePlainCapsule(plain, input.allowExpired);
  if (parsed.schema === BRAIN_CAPSULE_ENVELOPE_SCHEMA) {
    const envelope = parsed as EncryptedCapsule;
    if (
      envelope.capsuleId !== capsule.manifest.capsuleId
      || envelope.createdAt !== capsule.manifest.createdAt
      || envelope.expiresAt !== capsule.manifest.expiresAt
    ) throw new Error("Encrypted brain capsule envelope metadata does not match its authenticated payload.");
  }
  return { capsulePath, encrypted: parsed.schema === BRAIN_CAPSULE_ENVELOPE_SCHEMA, capsule };
}

export async function searchBrainCapsule(input: { capsulePath: string; passphrase?: string; query: string; limit?: number }) {
  const queryTerms = Object.keys(capsuleTerms(input.query));
  if (!queryTerms.length) throw new Error("Capsule search query is required.");
  const opened = await openBrainCapsule(input);
  const numericLimit = Number(input.limit ?? 12);
  const limit = Number.isFinite(numericLimit) ? Math.min(Math.max(Math.trunc(numericLimit), 1), 50) : 12;
  const hits = opened.capsule.payload.searchIndex
    .map((row) => {
      const matched = queryTerms.filter((term) => row.terms[term]);
      const score = matched.reduce((sum, term) => sum + row.terms[term], 0) + (matched.length === queryTerms.length ? 4 : 0);
      return { ...row, matched, score };
    })
    .filter((hit) => hit.matched.length)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
  return { capsulePath: opened.capsulePath, manifest: opened.capsule.manifest, readOnly: true, query: input.query.trim(), hits };
}

export async function previewBrainCapsuleImport(input: { vaultPath?: string; capsulePath: string; passphrase?: string }) {
  const [{ records, vaultPath }, opened] = await Promise.all([
    listAgentMemoryRecords({ vaultPath: input.vaultPath }),
    openBrainCapsule(input),
  ]);
  const seenHashes = new Set(records.map((record) => record.contentHash ?? contentAddressForText(record.content)));
  const uniqueCandidates = opened.capsule.payload.memories
    .filter((memory) => {
      if (seenHashes.has(memory.contentHash)) return false;
      seenHashes.add(memory.contentHash);
      return true;
    });
  const candidates = uniqueCandidates.slice(0, MAX_IMPORT_PROPOSALS);
  return {
    capsulePath: opened.capsulePath,
    targetVaultPath: vaultPath,
    manifest: opened.capsule.manifest,
    reviewRequired: true,
    directImportAllowed: false,
    duplicateCount: opened.capsule.payload.memories.length - uniqueCandidates.length,
    truncatedCount: uniqueCandidates.length - candidates.length,
    candidates,
  };
}

export async function proposeBrainCapsuleImport(input: { vaultPath?: string; capsulePath: string; passphrase?: string }) {
  const preview = await previewBrainCapsuleImport(input);
  const proposals = [];
  for (const memory of preview.candidates) {
    const result = await createBrainReviewProposal({
      kind: "memory",
      title: `Import capsule memory: ${memory.title}`,
      summary: `Review a portable memory from capsule ${preview.manifest.capsuleId}; no memory is written until this proposal is approved and applied.`,
      proposedContent: memory.content,
      targetPath: memory.notePath,
      risk: "medium",
      evidence: [{ sourceType: "manual", sourceId: preview.manifest.capsuleId, excerpt: memory.content.slice(0, 400) }],
      metadata: {
        capsuleId: preview.manifest.capsuleId,
        vaultPath: preview.targetVaultPath,
        originalTitle: memory.title,
        contentHash: memory.contentHash,
        memoryType: memory.type,
        memoryKey: memory.memoryKey,
        confidence: memory.confidence,
        tags: memory.tags,
        entities: memory.entities,
        project: memory.project,
        source: `brain-capsule:${basename(input.capsulePath)}`,
      },
    });
    proposals.push(result.proposal);
  }
  return { ...preview, candidates: undefined, proposals };
}
