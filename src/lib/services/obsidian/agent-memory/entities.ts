import { appendFile, mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { RECALL_STOP_WORDS } from "@/lib/services/obsidian/agent-memory/query";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { AgentMemoryRecord, RememberAgentMemoryInput } from "./types";

export const AGENT_MEMORY_ENTITY_INDEX_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Entity Index.jsonl`;

const KNOWN_HIVE_ENTITIES = [
  "Agent Memory",
  "Brain Services",
  "Full Vault Search Index",
  "GBrain",
  "GitLawb",
  "HivemindOS",
  "Neo4j",
  "Obsidian",
  "QMD",
  "Queen Bee",
  "Shared Brain Memory",
  "Syntho",
];

const GENERIC_ENTITY_WORDS = new Set([
  "agent", "agents", "brain", "critical", "fixed", "memory", "note", "notes", "service", "services", "shared", "vault", "verified",
]);

function normalizeEntity(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function entityKey(value: string) {
  return normalizeEntity(value).toLowerCase();
}

export function normalizeEntityList(values?: string[]) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeEntity(value);
    const key = entityKey(normalized);
    if (!key || key.length < 2 || key.length > 96 || seen.has(key)) continue;
    if (/^[a-z]+$/.test(key) && GENERIC_ENTITY_WORDS.has(key)) continue;
    // ALL-CAPS stopwords ("AND", "THE", "NOT") are acronym-extractor artifacts,
    // not entities — they made every query containing "and" entity-match.
    if (/^[a-z]+$/.test(key) && RECALL_STOP_WORDS.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output.slice(0, 32);
}

function wikilinkEntities(text: string) {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)]
    .flatMap((match) => [match[1], match[2]].filter((item): item is string => Boolean(item?.trim())));
}

function quotedEntities(text: string) {
  return [
    ...[...text.matchAll(/"([^"\n]{3,80})"/g)].map((match) => match[1]),
    ...[...text.matchAll(/'([^'\n]{3,80})'/g)].map((match) => match[1]),
  ];
}

function acronymEntities(text: string) {
  return [...text.matchAll(/\b[A-Z][A-Z0-9]{2,12}\b/g)].map((match) => match[0]);
}

// Sentence-initial capitalized words are not entity evidence — without this
// filter the extractor emits artifacts like "When Liam" or "Fixed Emerson".
const SENTENCE_STARTER_WORDS = new Set([
  "a", "after", "added", "adding", "also", "always", "and", "any", "as", "at", "before", "both", "but", "confirmed",
  "do", "does", "during", "each", "every", "fix", "fixed", "for", "from", "get", "here", "if", "in", "include",
  "keep", "make", "must", "never", "new", "now", "on", "once", "only", "repaired", "run", "running", "set",
  "should", "since", "so", "some", "that", "the", "then", "there", "these", "this", "those", "to", "treat",
  "updated", "use", "using", "verified", "when", "where", "while", "with", "would",
]);

function stripSentenceStarters(value: string) {
  const words = value.split(/\s+/);
  let start = 0;
  while (start < words.length && SENTENCE_STARTER_WORDS.has(words[start].toLowerCase())) start += 1;
  return words.slice(start).join(" ");
}

function properSequenceEntities(text: string) {
  const matches = [...text.matchAll(/\b[A-Z][a-z0-9]+(?:\s+(?:of|the|and|for|in|on|to|[A-Z][a-z0-9]+)){1,5}\b/g)]
    .map((match) => stripSentenceStarters(match[0].replace(/\s+(?:of|the|and|for|in|on|to)$/i, "")));
  return matches.filter((item) => {
    const parts = item.split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts.some((part, index) => index > 0 && /^[A-Z]/.test(part));
  });
}

function tagEntities(tags?: string[]) {
  return (tags ?? [])
    .map((tag) => tag.replace(/[-_/]+/g, " "))
    .filter((tag) => tag.length > 2);
}

function knownHiveEntities(text: string) {
  const lower = text.toLowerCase();
  return KNOWN_HIVE_ENTITIES.filter((entity) => lower.includes(entity.toLowerCase()));
}

export function extractAgentMemoryEntities(input: Pick<RememberAgentMemoryInput, "title" | "content" | "tags" | "project" | "runtime" | "agentName" | "machineName" | "entities" | "aliases">) {
  const text = [
    input.title,
    input.content,
    input.project,
    input.runtime,
    input.agentName,
    input.machineName,
    input.tags?.join(" "),
  ].filter(Boolean).join("\n");
  return {
    entities: normalizeEntityList([
      ...(input.entities ?? []),
      ...wikilinkEntities(text),
      ...quotedEntities(text),
      ...acronymEntities(text),
      ...properSequenceEntities(text),
      ...knownHiveEntities(text),
      input.project,
      input.runtime,
      input.agentName,
      input.machineName,
    ].filter((item): item is string => Boolean(item))),
    aliases: normalizeEntityList([
      ...(input.aliases ?? []),
      ...tagEntities(input.tags),
    ]),
  };
}

function containsWithBoundaries(haystack: string, needle: string) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

export function entityMatchesForQuery(query: string, record: Pick<AgentMemoryRecord, "entities" | "aliases">) {
  // Boundary-checked in both directions: raw substring containment made short
  // queries ("hi") match every entity containing them ("HivemindOS").
  const lower = query.toLowerCase().trim();
  if (lower.length < 3) return [];
  const matches = [...(record.entities ?? []), ...(record.aliases ?? [])]
    .filter((entity) => {
      const key = entityKey(entity);
      if (!key) return false;
      return containsWithBoundaries(lower, key) || containsWithBoundaries(key, lower);
    });
  return normalizeEntityList(matches);
}

function entityRowsForRecord(record: AgentMemoryRecord, timestamp: string) {
  return [...(record.entities ?? []), ...(record.aliases ?? [])].map((entity) => ({
    timestamp,
    schema: "hivemindos.agent-memory-entity.v1",
    memoryId: record.id,
    memoryType: record.type,
    status: record.status,
    entity,
    entityKey: entityKey(entity),
    notePath: record.notePath,
    project: record.project,
    agentName: record.agentName,
    runtime: record.runtime,
  }));
}

export async function appendAgentMemoryEntityIndex(root: string, record: AgentMemoryRecord) {
  const rows = entityRowsForRecord(record, new Date().toISOString());
  if (!rows.length) return;
  const file = join(root, AGENT_MEMORY_ENTITY_INDEX_PATH);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

// Rebuilds write the entity index fresh (one row per memory+entity, current
// status only) instead of appending duplicate generations forever.
export async function rewriteAgentMemoryEntityIndex(root: string, records: AgentMemoryRecord[]) {
  const timestamp = new Date().toISOString();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const record of records) {
    for (const row of entityRowsForRecord(record, timestamp)) {
      const key = `${row.memoryId}::${row.entityKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(JSON.stringify(row));
    }
  }
  const file = join(root, AGENT_MEMORY_ENTITY_INDEX_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  return { rows: lines.length };
}
