import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "path";

const REGISTRY_PATH = join(homedir(), ".hivemindos", "aeon-env-sync-repos.json");

type AeonEnvSyncRegistry = {
  version?: number;
  repos?: Array<{ repo: string; registeredAt?: string; source?: string }>;
};

export function normalizeAeonGitHubRepo(value?: string | null) {
  const cleaned = (value ?? "").trim().replace(/\.git$/i, "");
  const github = cleaned.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)$/i);
  const ownerRepo = cleaned.match(/^([^/\s]+)\/([^/\s.]+)$/);
  const match = github || ownerRepo;
  return match ? `${match[1]}/${match[2]}` : "";
}

async function readRegistry(): Promise<AeonEnvSyncRegistry> {
  const raw = await readFile(REGISTRY_PATH, "utf8").catch(() => "");
  if (!raw.trim()) return { version: 1, repos: [] };
  try {
    const parsed = JSON.parse(raw) as AeonEnvSyncRegistry;
    return {
      version: 1,
      repos: Array.isArray(parsed.repos) ? parsed.repos : [],
    };
  } catch {
    return { version: 1, repos: [] };
  }
}

export async function registerAeonEnvSyncRepo(repo: string, source: string) {
  const normalized = normalizeAeonGitHubRepo(repo);
  if (!normalized) return { registered: false, repo: "" };

  const registry = await readRegistry();
  const repos = new Map((registry.repos ?? [])
    .map((entry) => [normalizeAeonGitHubRepo(entry.repo), entry] as const)
    .filter(([key]) => Boolean(key)));
  repos.set(normalized, {
    repo: normalized,
    registeredAt: new Date().toISOString(),
    source,
  });

  const next: AeonEnvSyncRegistry = {
    version: 1,
    repos: [...repos.values()].sort((left, right) => left.repo.localeCompare(right.repo)),
  };
  await mkdir(join(homedir(), ".hivemindos"), { recursive: true, mode: 0o700 });
  await writeFile(REGISTRY_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return { registered: true, repo: normalized };
}
