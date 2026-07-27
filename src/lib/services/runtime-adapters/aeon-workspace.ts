import { access, readdir, rename, rm } from "fs/promises";
import { constants } from "fs";
import { join, resolve } from "path";
import type { AeonWorkspaceLayout } from "@/lib/types/aeon-control-plane";
import { AEON_OUTPUT_DIRECTORIES } from "./aeon-capabilities";

async function exists(path: string) {
  return access(path, constants.R_OK).then(() => true).catch(() => false);
}

async function pathExists(path: string) {
  return access(path).then(() => true).catch(() => false);
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

function legacyBackupStamp(now: Date) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function availableLegacyBackupRoot(root: string, now: Date) {
  const base = `${root}.legacy-backup-${legacyBackupStamp(now)}`;
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error("Could not reserve a backup path for the legacy AEON workspace.");
}

export async function replaceLegacyAeonWorkspace(
  rootInput: string,
  installV01: (root: string) => Promise<void>,
  now = new Date(),
) {
  const root = resolve(rootInput);
  const currentLayout = await inspectAeonWorkspace(root);
  if (currentLayout.generation === "v0.1") {
    return { root, backupRoot: "", changed: false };
  }
  if (currentLayout.generation !== "legacy") {
    throw new Error("Only a detected legacy AEON workspace can be replaced automatically.");
  }

  const backupRoot = await availableLegacyBackupRoot(root, now);
  await rename(root, backupRoot);
  try {
    await installV01(root);
    const installedLayout = await inspectAeonWorkspace(root);
    if (installedLayout.generation !== "v0.1") {
      throw new Error("The installed workspace did not pass the AEON v0.1 layout check.");
    }
    return { root, backupRoot, changed: true };
  } catch (error) {
    const installMessage = error instanceof Error ? error.message : "Unknown installation error.";
    try {
      await rm(root, { recursive: true, force: true });
      await rename(backupRoot, root);
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error.";
      throw new Error(`AEON v0.1 installation failed (${installMessage}) and the automatic restore failed (${rollbackMessage}). The legacy backup remains at ${backupRoot}.`);
    }
    throw new Error(`AEON v0.1 installation failed and the legacy workspace was restored: ${installMessage}`);
  }
}
