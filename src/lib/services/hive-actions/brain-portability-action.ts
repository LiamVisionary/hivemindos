import { z } from "zod";
import { defineHiveAction } from "@/lib/services/hive-actions/define";

export const sharedBrainPortabilityAction = defineHiveAction({
  id: "brain.portability",
  title: "Shared Brain generations and capsules",
  description:
    "List or replay immutable memory generations, compare historical recall, and export, verify, search, or propose review-gated imports from portable brain capsules.",
  schema: z.object({
    action: z.enum([
      "list-generations",
      "compare-generations",
      "export-capsule",
      "open-capsule",
      "search-capsule",
      "preview-capsule-import",
      "propose-capsule-import",
    ]),
    vaultPath: z.string().optional(),
    query: z.string().optional(),
    generationId: z.string().optional(),
    fromGenerationId: z.string().optional(),
    toGenerationId: z.string().optional(),
    project: z.string().optional(),
    memoryIds: z.array(z.string()).optional(),
    compiledDomains: z.array(z.string()).optional(),
    includeSuperseded: z.boolean().optional(),
    expiresAt: z.string().optional(),
    capsulePath: z.string().optional(),
    passphraseEnv: z.string().optional(),
    limit: z.number().optional(),
  }),
  sideEffects: ["read", "write", "filesystem"],
  risk: "medium",
  tags: ["brain", "memory", "capsule", "portable", "replay", "generation", "backup"],
  aliases: ["brain capsule", "memory export", "memory replay", "historical recall", "portable brain"],
  contextIndex: {
    summary: "Verified immutable memory history and scoped portable Shared Brain capsules.",
    retrievalText:
      "Use /api/brain/memory actions list-generations or compare-generations to inspect historical Agent Memory recall. Use export-capsule only with an explicit project or memory-id scope; passphraseEnv names a server environment variable without exposing its value. Capsule open/search is read-only. Imports never write memory directly: preview-capsule-import reports candidates and propose-capsule-import creates Brain Review proposals that still require approval and apply.",
    route: "/api/brain/memory",
    methods: ["GET", "POST"],
  },
});
