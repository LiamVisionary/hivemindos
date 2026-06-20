import { readFile } from "fs/promises";
import { dirname, join } from "path";
import type { BrainSkillInventory, BrainSkillSummary } from "@/lib/services/obsidian/brain-skills";

const SOURCE_METADATA_FILE = ".hivemind-skill-source.json";
const AUDIT_STATUSES = new Set(["trusted", "review", "restricted", "blocked"]);

type SkillAuditStatus = "trusted" | "review" | "restricted" | "blocked";

type SourceMetadata = {
  auditStatus?: SkillAuditStatus;
  capabilities?: string[];
  envKeys?: string[];
};

type EnrichedBrainSkillSummary = BrainSkillSummary & SourceMetadata;

async function readSourceMetadata(skillPath: string): Promise<SourceMetadata> {
  const raw = await readFile(join(dirname(skillPath), SOURCE_METADATA_FILE), "utf8").catch(() => "");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as {
      auditStatus?: unknown;
      capabilities?: unknown;
      envKeys?: unknown;
    };
    return {
      auditStatus: typeof parsed.auditStatus === "string" && AUDIT_STATUSES.has(parsed.auditStatus)
        ? parsed.auditStatus as SkillAuditStatus
        : undefined,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.map(String).filter(Boolean) : undefined,
      envKeys: Array.isArray(parsed.envKeys) ? parsed.envKeys.map(String).filter(Boolean) : undefined,
    };
  } catch {
    return {};
  }
}

export async function enrichBrainSkillSummaries(skills: BrainSkillSummary[]): Promise<EnrichedBrainSkillSummary[]> {
  return Promise.all(skills.map(async (skill) => ({
    ...skill,
    ...(skill.provider === "shared" ? await readSourceMetadata(skill.path) : {}),
  })));
}

export async function enrichBrainSkillInventory<T extends BrainSkillInventory>(inventory: T): Promise<T> {
  return {
    ...inventory,
    shared: await enrichBrainSkillSummaries(inventory.shared),
  };
}
