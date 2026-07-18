import "server-only";

import { listAgentMemoryGenerations, recallAgentMemory } from "@/lib/services/obsidian/agent-memory/core";
import type { RecallAgentMemoryInput } from "@/lib/services/obsidian/agent-memory/types";

export async function compareAgentMemoryGenerations(input: RecallAgentMemoryInput & {
  fromGenerationId: string;
  toGenerationId?: string;
}) {
  if (!input.fromGenerationId?.trim()) throw new Error("fromGenerationId is required for memory replay comparison.");
  const toGenerationId = input.toGenerationId?.trim()
    || (await listAgentMemoryGenerations({ vaultPath: input.vaultPath })).currentGenerationId;
  if (!toGenerationId) throw new Error("No current Agent Memory generation is available for comparison.");
  const [before, after] = await Promise.all([
    recallAgentMemory({ ...input, generationId: input.fromGenerationId, trackUsage: false, scope: "agent-memory" }),
    recallAgentMemory({ ...input, generationId: toGenerationId, trackUsage: false, scope: "agent-memory" }),
  ]);
  const beforeRank = new Map(before.hits.map((hit, index) => [hit.id, index + 1]));
  const afterRank = new Map(after.hits.map((hit, index) => [hit.id, index + 1]));
  const ids = new Set([...beforeRank.keys(), ...afterRank.keys()]);
  const changes = [...ids].map((id) => {
    const beforeHit = before.hits.find((hit) => hit.id === id);
    const afterHit = after.hits.find((hit) => hit.id === id);
    return {
      id,
      title: afterHit?.title ?? beforeHit?.title ?? id,
      beforeRank: beforeRank.get(id),
      afterRank: afterRank.get(id),
      beforeScore: beforeHit?.score,
      afterScore: afterHit?.score,
      change: !beforeHit ? "added" : !afterHit ? "removed" : beforeRank.get(id) === afterRank.get(id) ? "unchanged" : "rank-changed",
    };
  });
  return {
    vaultPath: before.vaultPath,
    query: before.query,
    fromGenerationId: input.fromGenerationId,
    toGenerationId,
    before,
    after,
    changes,
  };
}
