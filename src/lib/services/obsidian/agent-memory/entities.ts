import { appendFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
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
  "agent", "agents", "brain", "memory", "note", "notes", "service", "services", "shared", "vault",
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

function properSequenceEntities(text: string) {
  const matches = [...text.matchAll(/\b[A-Z][a-z0-9]+(?:\s+(?:of|the|and|for|in|on|to|[A-Z][a-z0-9]+)){1,5}\b/g)]
    .map((match) => match[0].replace(/\s+(?:of|the|and|for|in|on|to)$/i, ""));
  return matches.filter((item) => item.split(/\s+/).some((part, index) => index > 0 && /^[A-Z]/.test(part)));
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

export function entityMatchesForQuery(query: string, record: Pick<AgentMemoryRecord, "entities" | "aliases">) {
  const lower = query.toLowerCase();
  const matches = [...(record.entities ?? []), ...(record.aliases ?? [])]
    .filter((entity) => lower.includes(entityKey(entity)) || entityKey(entity).includes(lower.trim()));
  return normalizeEntityList(matches);
}

export async function appendAgentMemoryEntityIndex(root: string, record: AgentMemoryRecord) {
  const rows = [...(record.entities ?? []), ...(record.aliases ?? [])].map((entity) => ({
    timestamp: new Date().toISOString(),
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
  if (!rows.length) return;
  const file = join(root, AGENT_MEMORY_ENTITY_INDEX_PATH);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}
