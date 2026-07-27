import { RECALL_STOP_WORDS } from "./query";
import type { AgentMemoryRecord } from "./types";
import { bm25Tokens } from "../../search/bm25-lite";

export function distinctiveMemoryTokens(record: AgentMemoryRecord) {
  return new Set(bm25Tokens(`${record.title}\n${record.content}`).filter((token) => !RECALL_STOP_WORDS.has(token)));
}

export function tokenSetSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const token of small) {
    if (large.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function sharedTokenCount(left: Set<string>, right: Set<string>) {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const token of small) {
    if (large.has(token)) shared += 1;
  }
  return shared;
}

export function findExplicitCorrectionCandidates(records: AgentMemoryRecord[]) {
  const active = records
    .filter((record) => record.status === "active")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const tokens = new Map(active.map((record) => [record.id, distinctiveMemoryTokens(record)]));
  const correctionPattern = /\b(?:correction to (?:the )?(?:older|previous)\b|(?:corrects?|replaces?|supersedes?) (?:the )?(?:older|previous) (?:memory|note|guidance|record)|(?:older|previous) (?:memory|note|guidance|record) (?:is|was) (?:wrong|outdated|incorrect|no longer (?:true|current|accurate)))\b/i;
  const candidates = [];
  for (const newer of active) {
    if ((newer.supersedes ?? []).length || !correctionPattern.test(`${newer.title}\n${newer.content}`)) continue;
    const newerTokens = tokens.get(newer.id) ?? new Set<string>();
    const newerEntities = new Map((newer.entities ?? []).map((entity) => [entity.toLowerCase(), entity]));
    const matches = active
      .filter((older) => older.id !== newer.id
        && older.type === newer.type
        && Date.parse(older.createdAt) < Date.parse(newer.createdAt)
        && (!newer.project || !older.project || newer.project === older.project)
        && !(newer.supersedes ?? []).includes(older.id))
      .map((older) => {
        const olderTokens = tokens.get(older.id) ?? new Set<string>();
        const similarity = tokenSetSimilarity(newerTokens, olderTokens);
        const sharedTokens = sharedTokenCount(newerTokens, olderTokens);
        const sharedEntities = (older.entities ?? [])
          .filter((entity) => newerEntities.has(entity.toLowerCase()))
          .map((entity) => newerEntities.get(entity.toLowerCase()) ?? entity);
        return { older, similarity, sharedTokens, sharedEntities };
      })
      .filter((match) => match.sharedTokens >= 3
        && (match.similarity >= 0.2 || (match.sharedEntities.length > 0 && match.similarity >= 0.15)))
      .sort((left, right) => right.sharedEntities.length - left.sharedEntities.length
        || right.similarity - left.similarity
        || Date.parse(right.older.createdAt) - Date.parse(left.older.createdAt));
    const best = matches[0];
    if (!best) continue;
    candidates.push({
      newerId: newer.id,
      newerTitle: newer.title,
      olderId: best.older.id,
      olderTitle: best.older.title,
      similarity: Math.round(best.similarity * 100) / 100,
      sharedEntities: best.sharedEntities,
      suggestedAction: "evolve" as const,
      evolveHint: `hive-brain evolve --supersedes ${newer.id},${best.older.id} --title ${JSON.stringify(newer.title)} --content "<reviewed current truth>" --reason "link explicit correction to superseded memory"`,
    });
  }
  return candidates;
}
