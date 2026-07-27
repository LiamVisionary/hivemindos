import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

import { homedir } from "@/lib/home-dir";
import { expandHomePath, resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

const VAULT_SEGMENT = "hivemindos-vault";

export type ResolvedDeliverableFile = {
  path: string;
  source: "local" | "synced-vault";
};

type DeliverableCandidate = ResolvedDeliverableFile;

function localCandidates(rawPath: string, vaultRoot: string): DeliverableCandidate[] {
  const candidates: DeliverableCandidate[] = [];
  const normalizedInput = rawPath.replace(/\\/g, "/").trim();
  const parts = normalizedInput.split("/").filter(Boolean);
  const vaultIndex = parts.lastIndexOf(VAULT_SEGMENT);

  if (vaultIndex >= 0 && vaultIndex < parts.length - 1) {
    candidates.push({
      path: join(vaultRoot, ...parts.slice(vaultIndex + 1)),
      source: "synced-vault",
    });
  }
  if (isAbsolute(rawPath)) candidates.push({ path: resolve(rawPath), source: "local" });
  if (rawPath.startsWith("~")) {
    candidates.push({ path: resolve(expandHomePath(rawPath)), source: "local" });
  }

  return candidates.filter((candidate, index, all) => (
    all.findIndex((other) => other.path === candidate.path) === index
  ));
}

function withinRoot(target: string, root: string) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(normalizedRoot);
}

export async function resolveLocalDeliverableFile(rawPath: string): Promise<ResolvedDeliverableFile | null> {
  const vaultPath = resolveObsidianVaultPath();
  const vaultRoot = await realpath(vaultPath).catch(() => vaultPath);
  const homePath = homedir();
  const home = await realpath(homePath).catch(() => homePath);

  for (const candidate of localCandidates(rawPath, vaultRoot)) {
    try {
      await access(candidate.path, constants.R_OK);
      const path = await realpath(candidate.path);
      if (!withinRoot(path, vaultRoot) && !withinRoot(path, home)) continue;
      const info = await stat(path);
      if (info.isFile()) return { path, source: candidate.source };
    } catch {
      // The same artifact can have a foreign path and a synced-vault candidate.
    }
  }
  return null;
}
