import { z } from "zod";
import { defineHiveAction } from "./define";

export const skillAutoresearchAction = defineHiveAction({
  id: "skills.autoresearch",
  title: "Skill autoresearch",
  description:
    "Inspect the app-wide skill-improvement policy, scan repeated skill failures, or propose a review-gated optimizer run. HivemindOS uses its native Work Board loop by default and selects Evo only when the separate runtime is installed and a repository benchmark is available.",
  schema: z.object({
    action: z.enum(["status", "scan", "propose"]).default("status"),
    skillSlug: z.string().optional(),
    targetPath: z.string().optional(),
    symptom: z.string().optional(),
    repoRoot: z.string().optional(),
    benchmarkCommand: z.string().optional(),
    backendPreference: z.enum(["auto", "hivemind-native", "evo"]).optional(),
    companyIds: z.array(z.string()).optional(),
    enqueue: z.boolean().optional(),
    vaultPath: z.string().optional(),
  }),
  sideEffects: ["read", "write", "filesystem"],
  risk: "medium",
  tags: ["skill", "autoresearch", "optimizer", "evo", "work-board", "company", "self-improvement"],
  aliases: ["skill autoresearch", "improve this skill", "evolve skill", "auto research my skill", "skill self improvement"],
  contextIndex: {
    summary: "Review-gated, app-wide skill improvement with an optional Evo backend.",
    retrievalText:
      "Use skills.autoresearch or /api/skills/autoresearch to inspect skill-improvement readiness, scan repeated Work Board/scheduler/Company failures, or propose an isolated four-variant optimizer task. Automatic detection only creates Brain Review proposals. Applying an approved skill-evolution proposal launches a Work Board task; the winning diff still requires human approval before installation. Evo is optional and needs an installed CLI plus a git repository and benchmark; otherwise HivemindOS native agents run the same loop.",
    route: "/api/skills/autoresearch",
    methods: ["GET", "POST"],
  },
});
