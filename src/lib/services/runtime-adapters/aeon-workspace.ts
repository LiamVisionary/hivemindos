import { access, readdir } from "fs/promises";
import { constants } from "fs";
import { join, resolve } from "path";
import type { AeonWorkspaceLayout } from "@/lib/types/aeon-control-plane";
import { AEON_OUTPUT_DIRECTORIES } from "./aeon-capabilities";

async function exists(path: string) {
  return access(path, constants.R_OK).then(() => true).catch(() => false);
}

async function executable(path: string) {
  return access(path, constants.X_OK).then(() => true).catch(() => false);
}

async function existingDirectories(root: string, paths: readonly string[]) {
  const checks = await Promise.all(paths.map(async (path) => ({
    path,
    exists: await readdir(join(root, path), { withFileTypes: true }).then(() => true).catch(() => false),
  })));
  return checks.filter((entry) => entry.exists).map((entry) => entry.path);
}

export async function inspectAeonWorkspace(rootInput: string): Promise<AeonWorkspaceLayout> {
  const root = resolve(rootInput);
  const [hasConfig, cliCandidates, hasCatalog, hasLegacyManifest, outputDirectories] = await Promise.all([
    exists(join(root, "aeon.yml")),
    Promise.all([executable(join(root, "apps", "cli", "aeon")), executable(join(root, "aeon"))]),
    exists(join(root, "catalog", "skills.json")),
    exists(join(root, "skills.json")),
    existingDirectories(root, AEON_OUTPUT_DIRECTORIES),
  ]);
  const hasCli = cliCandidates.some(Boolean);
  const generation = hasConfig && hasCli && hasCatalog
    ? "v0.1"
    : hasConfig || hasLegacyManifest
      ? "legacy"
      : "invalid";
  return { root, generation, hasConfig, hasCli, hasCatalog, hasLegacyManifest, outputDirectories };
}
