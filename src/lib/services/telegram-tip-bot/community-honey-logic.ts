export type CommunityMissionCreateInput = {
  title: string;
  description: string;
  rewardHoney: number;
  category: string;
  evidenceType: "github_pr" | "url" | "note";
  githubRepo?: string;
  dueAt?: string;
  requiredApprovals: 1 | 2;
};

const CATEGORIES = new Set([
  "support", "bug", "code", "docs", "test", "skill", "mission",
  "tutorial", "translation", "moderation", "research",
]);

export function isHoneyMissionId(value: string): boolean {
  return /^hm_[a-z0-9]{8}$/i.test(value.trim());
}

export function isHoneySubmissionId(value: string): boolean {
  return /^hs_[a-z0-9]{10}$/i.test(value.trim());
}

export function parseCommunityMissionCreateArgs(args: string): CommunityMissionCreateInput {
  const rest = args.replace(/^create\b/i, "").trim();
  const parts = rest.split("|").map((part) => part.trim()).filter(Boolean);
  const title = parts.shift() ?? "";
  const fields = new Map<string, string>();
  for (const part of parts) {
    const match = part.match(/^(reward|category|evidence|repo|due|approvals|description)\s+(.+)$/i);
    if (!match) throw new Error(`Unknown mission field: ${part}`);
    fields.set(match[1].toLowerCase(), match[2].trim());
  }
  const rewardHoney = Number(fields.get("reward"));
  const category = (fields.get("category") || "mission").toLowerCase();
  const evidenceType = (fields.get("evidence") || "url").toLowerCase();
  const githubRepo = fields.get("repo")?.toLowerCase();
  const approvals = Number(fields.get("approvals") || "1");
  if (!title) throw new Error("Mission title is required.");
  if (!Number.isFinite(rewardHoney) || rewardHoney <= 0) throw new Error("Mission reward must be a positive HONEY amount.");
  if (!CATEGORIES.has(category)) throw new Error(`Unsupported mission category: ${category}`);
  if (!(["github_pr", "url", "note"] as string[]).includes(evidenceType)) {
    throw new Error("Mission evidence must be github_pr, url, or note.");
  }
  if (evidenceType === "github_pr" && !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(githubRepo || "")) {
    throw new Error("GitHub PR missions require: repo owner/repository.");
  }
  if (approvals !== 1 && approvals !== 2) throw new Error("Mission approvals must be 1 or 2.");
  return {
    title,
    description: fields.get("description") || "",
    rewardHoney,
    category,
    evidenceType: evidenceType as CommunityMissionCreateInput["evidenceType"],
    ...(githubRepo ? { githubRepo } : {}),
    ...(fields.get("due") ? { dueAt: fields.get("due") } : {}),
    requiredApprovals: approvals,
  };
}

export function telegramPublicLabel(user: { id: number | string; username?: string; first_name?: string }): string {
  if (user.username) return `@${user.username}`.slice(0, 64);
  const firstName = String(user.first_name || "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return (firstName || `member-${user.id}`).slice(0, 64);
}
