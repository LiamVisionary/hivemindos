import { constants } from "fs";
import { accessSync, readdirSync, statSync } from "fs";
import { homedir } from "@/lib/home-dir";
import { basename, join, resolve } from "path";

export const GENERIC_OBSIDIAN_VAULT_PATH = "~/Documents/Obsidian/hivemindos-vault";

const OBSIDIAN_ROOT_CANDIDATES = [
  "~/Documents/Obsidian",
  "~/Library/Mobile Documents/iCloud~md~obsidian/Documents",
];

export function expandHomePath(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function configuredObsidianVaultPath(): string {
  return process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH?.trim() || GENERIC_OBSIDIAN_VAULT_PATH;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

function isAutoDetectHint(path?: string): boolean {
  const value = path?.trim();
  return !value
    || value === GENERIC_OBSIDIAN_VAULT_PATH
    || value.endsWith("/hivemindos-vault")
    || value.endsWith("/HivemindOS Vault");
}

function scoreVaultCandidate(path: string): number {
  let score = 0;
  const name = basename(path).toLowerCase();
  if (name.includes("hivemind") || name.includes("os")) score += 50;
  if (canAccess(join(path, "AGENTS.md"), constants.R_OK)) score += 20;
  if (isDirectory(join(path, ".obsidian"))) score += 10;
  return score;
}

export function discoverObsidianVaultPath(): string | null {
  const envPath = process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH?.trim();
  const directCandidates = [
    envPath,
    GENERIC_OBSIDIAN_VAULT_PATH,
  ]
    .filter((path): path is string => Boolean(path))
    .map((path) => resolve(expandHomePath(path)));

  for (const candidate of directCandidates) {
    if (isDirectory(candidate) && canAccess(candidate, constants.R_OK)) return candidate;
  }

  const discovered = new Set<string>();
  for (const rootCandidate of OBSIDIAN_ROOT_CANDIDATES) {
    const root = resolve(expandHomePath(rootCandidate));
    if (!isDirectory(root)) continue;
    if (isDirectory(join(root, ".obsidian"))) discovered.add(root);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(root, entry.name);
      if (!entry.isDirectory() || !canAccess(fullPath, constants.R_OK)) continue;
      if (isDirectory(join(fullPath, ".obsidian")) || canAccess(join(fullPath, "AGENTS.md"), constants.R_OK)) {
        discovered.add(fullPath);
      }
    }
  }

  return [...discovered]
    .sort((a, b) => scoreVaultCandidate(b) - scoreVaultCandidate(a) || a.localeCompare(b))[0] ?? null;
}

export function resolveObsidianVaultPath(vaultPath?: string, options: { requireWritable?: boolean } = {}): string {
  const requested = vaultPath?.trim();
  const candidate = requested || configuredObsidianVaultPath();
  const resolved = resolve(expandHomePath(candidate));
  const mode = constants.R_OK | (options.requireWritable ? constants.W_OK : 0);

  if (isDirectory(resolved) && canAccess(resolved, mode)) return resolved;

  if (isAutoDetectHint(requested || candidate)) {
    const discovered = discoverObsidianVaultPath();
    if (discovered && canAccess(discovered, mode)) return discovered;
  }

  return resolved;
}
