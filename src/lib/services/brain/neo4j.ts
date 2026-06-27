import "server-only";

import { createHash } from "crypto";
import { constants } from "fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, join, relative, sep } from "path";
import neo4j, { type Driver, type Session } from "neo4j-driver";
import { hiveEnvPresence, hiveEnvValue } from "@/lib/services/shared-hive-env";
import { listAgentMemoryRecords } from "@/lib/services/obsidian/agent-memory";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT, type Neo4jBrainConfig } from "@/lib/types/agent-runtime";
import { cachedStatus, invalidateStatus } from "./status-cache";

const STATUS_TTL_MS = 15_000;
const SERVICE_NOTE = "Neo4j.md";
const DERIVED_SOURCE = "hivemindos-derived";
const COMPILED_KNOWLEDGE_FOLDER = "Synthesis/Compiled Knowledge";

export type Neo4jBrainStatus = {
  ok: boolean;
  enabled: boolean;
  connected: boolean;
  serviceNotePath: string;
  database: string;
  config: Pick<Neo4jBrainConfig, "installMode" | "uriEnvKey" | "usernameEnvKey" | "passwordEnvKey" | "databaseEnvKey" | "queryLimit">;
  keyStatus: Record<string, { present: boolean; source: "process" | "shared-hive-env" | "missing" }>;
  counts?: Record<string, number>;
  error?: string;
};

type Neo4jInput = {
  vaultPath?: string;
  brainServicesFolder?: string;
  neo4j?: Partial<Neo4jBrainConfig>;
};

type DerivedNode = {
  key: string;
  name: string;
};

function normalizeNeo4jConfig(input?: Partial<Neo4jBrainConfig>): Neo4jBrainConfig {
  const defaults = DEFAULT_SHARED_VAULT.neo4j;
  const queryLimit = Number(input?.queryLimit ?? defaults.queryLimit);
  return {
    ...defaults,
    ...(input ?? {}),
    uriEnvKey: cleanEnvKey(input?.uriEnvKey || defaults.uriEnvKey),
    usernameEnvKey: cleanEnvKey(input?.usernameEnvKey || defaults.usernameEnvKey),
    passwordEnvKey: cleanEnvKey(input?.passwordEnvKey || defaults.passwordEnvKey),
    databaseEnvKey: cleanEnvKey(input?.databaseEnvKey || defaults.databaseEnvKey),
    database: input?.database?.trim() || "",
    queryLimit: Number.isFinite(queryLimit) ? Math.min(Math.max(Math.trunc(queryLimit), 1), 1_000) : defaults.queryLimit,
  };
}

function cleanEnvKey(value: string) {
  const trimmed = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) throw new Error(`Invalid Neo4j env key: ${value}`);
  return trimmed;
}

function safeVaultFolder(folder?: string, fallback = DEFAULT_SHARED_VAULT.brainServicesFolder) {
  const clean = String(folder || fallback).trim();
  if (!clean || clean.split(/[\\/]+/).includes("..")) throw new Error("Brain services folder must be a relative vault path.");
  return clean.split(/[\\/]+/).filter(Boolean).join(sep);
}

function brainServicesRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder));
}

function toVaultPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function contentHash(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function entityKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function derivedNodes(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const nodes: DerivedNode[] = [];
  for (const value of values) {
    const name = value?.trim();
    if (!name) continue;
    const key = entityKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    nodes.push({ key, name });
  }
  return nodes;
}

async function neo4jEnv(config: Neo4jBrainConfig) {
  const [uri, username, password, databaseFromEnv] = await Promise.all([
    hiveEnvValue(config.uriEnvKey),
    hiveEnvValue(config.usernameEnvKey),
    hiveEnvValue(config.passwordEnvKey),
    hiveEnvValue(config.databaseEnvKey).catch(() => ""),
  ]);
  if (!uri || !username || !password) {
    throw new Error(`Neo4j needs ${config.uriEnvKey}, ${config.usernameEnvKey}, and ${config.passwordEnvKey} in the shared hive env or process env.`);
  }
  return { uri, username, password, database: config.database || databaseFromEnv || "" };
}

async function withNeo4jSession<T>(config: Neo4jBrainConfig, run: (session: Session) => Promise<T>) {
  const env = await neo4jEnv(config);
  const driver: Driver = neo4j.driver(env.uri, neo4j.auth.basic(env.username, env.password), {
    connectionTimeout: 7_500,
    maxConnectionLifetime: 60_000,
  });
  try {
    await driver.verifyConnectivity();
    const session = driver.session(env.database ? { database: env.database } : undefined);
    try {
      return await run(session);
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

async function keyStatus(config: Neo4jBrainConfig) {
  const keys = [config.uriEnvKey, config.usernameEnvKey, config.passwordEnvKey, config.databaseEnvKey];
  const statuses = await hiveEnvPresence(keys);
  return Object.fromEntries(statuses.map((item) => [item.key, { present: item.present, source: item.source }]));
}

export function isReadOnlyCypher(query: string) {
  const cleaned = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .trim();
  if (!cleaned || cleaned.includes(";")) return false;
  if (/\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|LOAD|FOREACH|CALL\s+apoc|CALL\s+dbms\.kill|CALL\s+db\.create|CALL\s+db\.index)\b/i.test(cleaned)) return false;
  return /^(MATCH|RETURN|WITH|UNWIND|CALL\s+db\.(?:labels|relationshipTypes|propertyKeys|schema|indexes|constraints)\b)/i.test(cleaned);
}

function plainValue(value: unknown): unknown {
  if (value && typeof value === "object") {
    const maybeInteger = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof maybeInteger.toNumber === "function" && "low" in maybeInteger && "high" in maybeInteger) return maybeInteger.toNumber();
    if (Array.isArray(value)) return value.map(plainValue);
    if ("properties" in value && value.properties && typeof value.properties === "object") return plainValue(value.properties);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plainValue(item)]));
  }
  return value;
}

async function ensureSchema(session: Session) {
  const constraints = [
    "CREATE CONSTRAINT hivemind_memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT hivemind_entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE",
    "CREATE CONSTRAINT hivemind_tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE",
    "CREATE CONSTRAINT hivemind_project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE",
    "CREATE CONSTRAINT hivemind_agent_key IF NOT EXISTS FOR (a:Agent) REQUIRE a.key IS UNIQUE",
    "CREATE CONSTRAINT hivemind_machine_key IF NOT EXISTS FOR (m:Machine) REQUIRE m.key IS UNIQUE",
    "CREATE CONSTRAINT hivemind_runtime_name IF NOT EXISTS FOR (r:Runtime) REQUIRE r.name IS UNIQUE",
    "CREATE CONSTRAINT hivemind_compiled_path IF NOT EXISTS FOR (p:CompiledKnowledgePage) REQUIRE p.path IS UNIQUE",
  ];
  for (const statement of constraints) await session.run(statement);
}

function memoryParams(record: Awaited<ReturnType<typeof listAgentMemoryRecords>>["records"][number]) {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    status: record.status,
    notePath: record.notePath,
    contentHash: contentHash(record.content),
    confidence: record.confidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cognitiveStage: record.cognitiveStage,
    sourceType: record.sourceType,
    actorRole: record.actorRole,
    memoryOrigin: record.memoryOrigin,
    entities: derivedNodes([...(record.entities ?? []), ...(record.aliases ?? [])]),
    tags: derivedNodes(record.tags),
    project: record.project?.trim() || undefined,
    agent: derivedNodes([record.agentName || record.agentId])[0],
    machine: derivedNodes([record.machineName || record.machineId])[0],
    runtime: record.runtime?.trim() || undefined,
    supersedes: record.supersedes ?? [],
  };
}

async function syncMemory(session: Session, record: Awaited<ReturnType<typeof listAgentMemoryRecords>>["records"][number]) {
  const params = { ...memoryParams(record), source: DERIVED_SOURCE };
  await session.run(`
MERGE (m:Memory {id: $id})
SET m.source = $source,
    m.type = $type,
    m.title = $title,
    m.status = $status,
    m.notePath = $notePath,
    m.contentHash = $contentHash,
    m.confidence = $confidence,
    m.createdAt = $createdAt,
    m.updatedAt = $updatedAt,
    m.cognitiveStage = $cognitiveStage,
    m.sourceType = $sourceType,
    m.actorRole = $actorRole,
    m.memoryOrigin = $memoryOrigin
`, params);
  if (params.entities.length) {
    await session.run(`
MATCH (m:Memory {id: $id})
UNWIND $entities AS entity
MERGE (e:Entity {key: entity.key})
SET e.name = entity.name, e.source = coalesce(e.source, $source)
MERGE (m)-[:MENTIONS]->(e)
`, params);
  }
  if (params.tags.length) {
    await session.run(`
MATCH (m:Memory {id: $id})
UNWIND $tags AS tag
MERGE (t:Tag {name: tag.key})
SET t.label = tag.name, t.source = coalesce(t.source, $source)
MERGE (m)-[:HAS_TAG]->(t)
`, params);
  }
  if (params.project) {
    await session.run(`
MATCH (m:Memory {id: $id})
MERGE (p:Project {name: $project})
SET p.source = coalesce(p.source, $source)
MERGE (m)-[:IN_PROJECT]->(p)
`, params);
  }
  if (params.agent) {
    await session.run(`
MATCH (m:Memory {id: $id})
MERGE (a:Agent {key: $agent.key})
SET a.name = $agent.name, a.source = coalesce(a.source, $source)
MERGE (m)-[:BY_AGENT]->(a)
`, params);
  }
  if (params.machine) {
    await session.run(`
MATCH (m:Memory {id: $id})
MERGE (machine:Machine {key: $machine.key})
SET machine.name = $machine.name, machine.source = coalesce(machine.source, $source)
MERGE (m)-[:ON_MACHINE]->(machine)
`, params);
  }
  if (params.runtime) {
    await session.run(`
MATCH (m:Memory {id: $id})
MERGE (r:Runtime {name: $runtime})
SET r.source = coalesce(r.source, $source)
MERGE (m)-[:BY_RUNTIME]->(r)
`, params);
  }
  if (params.supersedes.length) {
    await session.run(`
MATCH (m:Memory {id: $id})
UNWIND $supersedes AS previousId
MERGE (previous:Memory {id: previousId})
SET previous.source = coalesce(previous.source, $source)
MERGE (m)-[:SUPERSEDES]->(previous)
`, params);
  }
}

async function walkCompiledKnowledge(root: string, dir = join(root, COMPILED_KNOWLEDGE_FOLDER), output: string[] = []): Promise<string[]> {
  if (output.length >= 1_000) return output;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= 1_000) break;
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (rel.startsWith("..")) continue;
    if (entry.isDirectory()) await walkCompiledKnowledge(root, path, output);
    else if (entry.isFile() && entry.name.endsWith(".md")) output.push(path);
  }
  return output;
}

async function compiledKnowledgePages(vault: string) {
  const files = await walkCompiledKnowledge(vault);
  const pages = [];
  for (const file of files) {
    const st = await stat(file).catch(() => null);
    if (!st || st.size > 256 * 1024) continue;
    const markdown = await readFile(file, "utf8").catch(() => "");
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(file, ".md");
    const links = [...markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
    pages.push({ path: toVaultPath(vault, file), title, links: derivedNodes(links), hash: contentHash(markdown), updatedAt: new Date(st.mtimeMs).toISOString() });
  }
  return pages;
}

async function syncCompiledKnowledge(session: Session, vault: string) {
  const pages = await compiledKnowledgePages(vault);
  for (const page of pages) {
    await session.run(`
MERGE (p:CompiledKnowledgePage {path: $path})
SET p.source = $source, p.title = $title, p.contentHash = $hash, p.updatedAt = $updatedAt
WITH p
UNWIND $links AS link
MERGE (e:Entity {key: link.key})
SET e.name = link.name, e.source = coalesce(e.source, $source)
MERGE (p)-[:LINKS_TO]->(e)
`, { ...page, source: DERIVED_SOURCE });
  }
  return pages.length;
}

export async function writeNeo4jServiceNote(input: Neo4jInput & { event?: "connect" | "sync" | "query"; summary?: string } = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath || DEFAULT_SHARED_VAULT.vaultPath, { requireWritable: true });
  await access(vault, constants.R_OK | constants.W_OK);
  const config = normalizeNeo4jConfig(input.neo4j);
  const root = brainServicesRoot(vault, input.brainServicesFolder);
  const notePath = join(root, SERVICE_NOTE);
  await mkdir(dirname(notePath), { recursive: true });
  const now = new Date().toISOString();
  const content = [
    "# Neo4j Brain Service",
    "",
    "Optional derived graph service for HivemindOS Shared Brain Memory. Obsidian Agent Memory remains canonical; Neo4j nodes are rebuilt with `MERGE` and marked `source: \"hivemindos-derived\"`.",
    "",
    "## Secrets",
    "",
    `- URI env key: \`${config.uriEnvKey}\``,
    `- Username env key: \`${config.usernameEnvKey}\``,
    `- Password env key: \`${config.passwordEnvKey}\``,
    `- Database env key: \`${config.databaseEnvKey}\``,
    "",
    "No plaintext Neo4j URI, username, password, or private connection string is stored in this note.",
    "",
    "## Last Event",
    "",
    `- Time: ${now}`,
    `- Event: ${input.event ?? "status"}`,
    `- Summary: ${input.summary ?? "Neo4j service note initialized."}`,
    "",
  ].join("\n");
  await writeFile(notePath, content, { encoding: "utf8", mode: 0o600 });
  return relative(vault, notePath).split(sep).join("/");
}

async function loadNeo4jStatus(input: Neo4jInput = {}): Promise<Neo4jBrainStatus> {
  const vault = resolveObsidianVaultPath(input.vaultPath || DEFAULT_SHARED_VAULT.vaultPath);
  const config = normalizeNeo4jConfig(input.neo4j);
  const serviceNotePath = join(safeVaultFolder(input.brainServicesFolder), SERVICE_NOTE).split(sep).join("/");
  const keys = await keyStatus(config);
  const envReady = keys[config.uriEnvKey]?.present && keys[config.usernameEnvKey]?.present && keys[config.passwordEnvKey]?.present;
  const status: Neo4jBrainStatus = {
    ok: false,
    enabled: Boolean(config.enabled),
    connected: false,
    serviceNotePath,
    database: config.database,
    config: {
      installMode: config.installMode,
      uriEnvKey: config.uriEnvKey,
      usernameEnvKey: config.usernameEnvKey,
      passwordEnvKey: config.passwordEnvKey,
      databaseEnvKey: config.databaseEnvKey,
      queryLimit: config.queryLimit,
    },
    keyStatus: keys,
    error: envReady ? undefined : `Set ${config.uriEnvKey}, ${config.usernameEnvKey}, and ${config.passwordEnvKey} to connect Neo4j.`,
  };
  if (!envReady) return status;
  try {
    await access(vault, constants.R_OK);
    const counts = await withNeo4jSession(config, async (session) => {
      const result = await session.run(`
MATCH (n)
WHERE n.source = $source
RETURN labels(n)[0] AS label, count(n) AS count
`, { source: DERIVED_SOURCE });
      return Object.fromEntries(result.records.map((record) => [String(record.get("label") || "Node"), Number(plainValue(record.get("count")) || 0)]));
    });
    return { ...status, ok: true, connected: true, counts, error: undefined };
  } catch (error) {
    return { ...status, error: error instanceof Error ? error.message : "Neo4j connection failed." };
  }
}

export function getNeo4jStatus(input: Neo4jInput = {}) {
  return cachedStatus(`neo4j:${JSON.stringify(input)}`, STATUS_TTL_MS, () => loadNeo4jStatus(input));
}

export async function connectNeo4j(input: Neo4jInput = {}) {
  const config = normalizeNeo4jConfig({ ...input.neo4j, enabled: true, installMode: "existing" });
  await withNeo4jSession(config, async (session) => {
    await session.run("RETURN 1 AS ok");
  });
  await writeNeo4jServiceNote({ ...input, neo4j: config, event: "connect", summary: "Connected Neo4j as a derived HivemindOS brain service." });
  invalidateStatus("neo4j:");
  return { status: await getNeo4jStatus({ ...input, neo4j: config }) };
}

export async function syncNeo4jBrain(input: Neo4jInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath || DEFAULT_SHARED_VAULT.vaultPath);
  await access(vault, constants.R_OK);
  const config = normalizeNeo4jConfig(input.neo4j);
  const { records } = await listAgentMemoryRecords({ vaultPath: vault });
  let compiledKnowledgeCount = 0;
  await withNeo4jSession(config, async (session) => {
    await ensureSchema(session);
    for (const record of records) await syncMemory(session, record);
    compiledKnowledgeCount = await syncCompiledKnowledge(session, vault);
  });
  await writeNeo4jServiceNote({
    ...input,
    neo4j: config,
    event: "sync",
    summary: `Synced ${records.length} Agent Memory record${records.length === 1 ? "" : "s"} and ${compiledKnowledgeCount} compiled knowledge page${compiledKnowledgeCount === 1 ? "" : "s"} into Neo4j.`,
  });
  invalidateStatus("neo4j:");
  return {
    status: await getNeo4jStatus(input),
    synced: {
      memories: records.length,
      compiledKnowledgePages: compiledKnowledgeCount,
    },
  };
}

export async function queryNeo4jBrain(input: Neo4jInput & { query?: string }) {
  const query = input.query?.trim() ?? "";
  if (!isReadOnlyCypher(query)) throw new Error("Only read-only Cypher is allowed. Use MATCH/RETURN/WITH or read-only CALL db.* procedures; write clauses are rejected.");
  const config = normalizeNeo4jConfig(input.neo4j);
  const rows = await withNeo4jSession(config, async (session) => {
    const result = await session.run(query, { limit: neo4j.int(config.queryLimit) });
    return result.records.slice(0, config.queryLimit).map((record) => Object.fromEntries(record.keys.map((key) => [String(key), plainValue(record.get(key))])));
  });
  await writeNeo4jServiceNote({ ...input, neo4j: config, event: "query", summary: "Ran a read-only Neo4j graph query from HivemindOS." }).catch(() => undefined);
  return {
    status: await getNeo4jStatus(input),
    rows,
    truncated: rows.length >= config.queryLimit,
  };
}
