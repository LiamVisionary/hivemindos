import { answerFromAgentMemory } from "@/lib/services/obsidian/agent-memory";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";

export async function buildSharedBrainMemoryContext(sharedVault: SharedVaultConfig | null, query: string) {
  if (!sharedVault?.vaultPath?.trim() || !query.trim()) return "";
  try {
    const result = await answerFromAgentMemory({
      vaultPath: sharedVault.vaultPath,
      query,
      limit: 5,
    });
    if (!result.hits.length) return "";
    return [
      "Relevant shared-brain memories:",
      result.answer,
      "",
      "Use these memories and vault notes as durable user/project context. Evolved memories show the latest memory plus prior versions; treat the latest active version as current unless the user corrects it. If they conflict with the current user message, the current user message wins and the conflict should be noted.",
    ].join("\n");
  } catch (error) {
    return [
      "Relevant shared-brain memories:",
      `- Recall unavailable: ${error instanceof Error ? error.message : "unknown error"}.`,
    ].join("\n");
  }
}
