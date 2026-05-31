import type { AeonBrainVisibility } from "./policy";

export type GitHubRepositoryIdentity = {
  repository: string;
  visibility: AeonBrainVisibility;
  private: boolean;
  verifiedAt: string;
};

type GitHubRepoResponse = {
  full_name?: string;
  private?: boolean;
  visibility?: string;
};

const visibilityCache = new Map<string, { expiresAt: number; value: GitHubRepositoryIdentity }>();

export function normalizeGitHubRepository(value: string) {
  const trimmed = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw Object.assign(new Error("GitHub repository must be owner/name."), { status: 400 });
  return `${match[1]}/${match[2]}`;
}

export async function verifyGitHubRepositoryVisibility(repository: string): Promise<GitHubRepositoryIdentity> {
  const repo = normalizeGitHubRepository(repository);
  const cacheKey = repo.toLowerCase();
  const cached = visibilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const token = githubToken();
  const response = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hivemindos-aeon-brain",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return cache(repo, {
      repository: repo,
      visibility: "unknown",
      private: false,
      verifiedAt: new Date().toISOString(),
    });
  }

  const payload = await response.json().catch(() => null) as GitHubRepoResponse | null;
  const visibility = normalizeVisibility(payload?.visibility, payload?.private);
  return cache(repo, {
    repository: payload?.full_name ?? repo,
    visibility,
    private: visibility === "private",
    verifiedAt: new Date().toISOString(),
  });
}

function normalizeVisibility(visibility?: string, privateFlag?: boolean): AeonBrainVisibility {
  const normalized = visibility?.toLowerCase();
  if (normalized === "public" || normalized === "private" || normalized === "internal") return normalized;
  if (privateFlag === true) return "private";
  if (privateFlag === false) return "public";
  return "unknown";
}

function cache(repo: string, value: GitHubRepositoryIdentity) {
  const ttl = Number(process.env.HIVE_AEON_BRAIN_VISIBILITY_CACHE_TTL_MS ?? 60_000);
  visibilityCache.set(repo.toLowerCase(), { expiresAt: Date.now() + Math.max(0, ttl), value });
  return value;
}

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim()
    || process.env.GH_TOKEN?.trim()
    || process.env.GH_GLOBAL?.trim()
    || "";
}
