import "server-only";

import { getSharedBrainSkillsCached } from "@/lib/services/obsidian/brain-skills";

export type ChatSkillAttributionSource = "explicit-prompt" | "runtime-receipt" | "agent-preferred";

export type ChatSkillAttribution = {
  skillSlug: string;
  source: ChatSkillAttributionSource;
};

type InstalledChatSkill = {
  slug: string;
  name?: string;
};

const NON_TARGET_SKILLS = new Set(["evo", "hive-skill-autoresearch"]);

export function attributeChatSkills(input: {
  prompt: string;
  installedSkills: InstalledChatSkill[];
  preferredSkillSlugs?: string[];
  /** Retrieval alone is deliberately not attribution; kept explicit at the boundary. */
  retrievedSkillSlugs?: string[];
}): ChatSkillAttribution[] {
  const installed = new Map(
    input.installedSkills
      .map((skill) => ({ ...skill, slug: cleanSkillSlug(skill.slug) }))
      .filter((skill) => skill.slug && !NON_TARGET_SKILLS.has(skill.slug))
      .map((skill) => [skill.slug, skill]),
  );
  const preferred = new Set(
    (input.preferredSkillSlugs ?? [])
      .map(cleanSkillSlug)
      .filter((slug) => installed.has(slug)),
  );
  const result: ChatSkillAttribution[] = [];
  for (const [skillSlug, skill] of installed) {
    if (promptExplicitlySelectsSkill(input.prompt, skill)) {
      result.push({ skillSlug, source: "explicit-prompt" });
      continue;
    }
    if (preferred.has(skillSlug)) {
      result.push({ skillSlug, source: "agent-preferred" });
    }
  }
  return result.sort((left, right) => left.skillSlug.localeCompare(right.skillSlug));
}

export async function resolveChatSkillAttribution(input: {
  prompt: string;
  preferredSkillSlugs?: string[];
  vaultPath?: string;
}): Promise<ChatSkillAttribution[]> {
  const inventory = await getSharedBrainSkillsCached(input.vaultPath, { summaryMode: "fast" });
  return attributeChatSkills({
    prompt: input.prompt,
    preferredSkillSlugs: input.preferredSkillSlugs,
    installedSkills: inventory.shared,
  });
}

export function attributeRuntimeSkillReceipt(input: {
  label: string;
  detail?: string;
  raw?: unknown;
}): ChatSkillAttribution[] {
  if (!/command|skill|tool/i.test(input.label)) return [];
  const receiptText = [input.label, input.detail, structuredReceiptText(input.raw)].filter(Boolean).join("\n");
  const slugs = new Set<string>();
  const pathPattern = /(?:^|[/\\])(?:Skills|packaged-skills[/\\](?:auto-install|optional))[/\\]([a-z0-9][a-z0-9._-]*)[/\\]SKILL\.md\b/gi;
  for (const match of receiptText.matchAll(pathPattern)) {
    const skillSlug = cleanSkillSlug(match[1] ?? "");
    if (skillSlug && !NON_TARGET_SKILLS.has(skillSlug)) slugs.add(skillSlug);
  }
  return [...slugs]
    .sort()
    .map((skillSlug) => ({ skillSlug, source: "runtime-receipt" }));
}

function promptExplicitlySelectsSkill(prompt: string, skill: InstalledChatSkill) {
  const normalizedPrompt = prompt.toLowerCase();
  const slugPattern = tokenPattern(skill.slug);
  if (slugPattern.test(normalizedPrompt)) return true;
  const name = skill.name?.trim().toLowerCase();
  if (!name || name.length < 4) return false;
  const namePattern = tokenPattern(name);
  return new RegExp(`(?:\\b(?:use|using|run|invoke|with|load)\\s+(?:the\\s+)?${namePattern.source}|${namePattern.source}\\s+skill\\b)`, "i")
    .test(normalizedPrompt);
}

function tokenPattern(value: string) {
  const parts = value.split(/[\s._-]+/).map(escapeRegExp).filter(Boolean);
  return new RegExp(`\\b${parts.join("[\\s._-]+")}\\b`, "i");
}

function cleanSkillSlug(value: string) {
  const cleaned = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]*$/.test(cleaned) ? cleaned : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function structuredReceiptText(value: unknown, depth = 0): string {
  if (!value || typeof value !== "object" || depth > 3) return "";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => structuredReceiptText(item, depth + 1)).filter(Boolean).join("\n");
  const lines: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && /^(?:command|path|args?|skillSlug|skill_slug)$/i.test(key)) {
      lines.push(child.slice(0, 4_000));
    } else if (child && typeof child === "object") {
      lines.push(structuredReceiptText(child, depth + 1));
    }
  }
  return lines.filter(Boolean).join("\n");
}
