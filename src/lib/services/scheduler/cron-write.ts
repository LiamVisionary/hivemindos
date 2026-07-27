import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { homedir } from "@/lib/home-dir";
import { shellBaseFromCollectorUrl } from "@/app/api/fleet/shell/shell-target";
import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";
import {
  applyCronMutation,
  parseHermesCronDoc,
  serializeHermesCronDoc,
  type CronMutation,
} from "@/lib/services/scheduler/hermes-cron-doc";
import { readRemoteCronDoc, writeRemoteCronDoc } from "@/lib/services/scheduler/remote-cron-shell";

export const CRON_WRITE_SHELL_SESSION = "hivemindos-cron-write";

export type CronWriteResult = {
  ok: boolean;
  changed: number;
  backup: string;
  target: "local" | "remote";
  error?: string;
};

export type CronWriteOptions = {
  collectorUrl?: string;
  homeDir?: string;
  session?: string;
  mutation: CronMutation;
};

function expandLocalHome(homeDir?: string) {
  return resolve((homeDir?.trim() || "~/.hermes").replace(/^~(?=$|\/)/, homedir()));
}

/** Edit this machine's ~/.hermes cron store directly (backup + atomic write). */
async function writeLocal(homeDir: string, mutation: CronMutation): Promise<CronWriteResult> {
  const path = join(homeDir, "cron", "jobs.json");
  const raw = await readFile(path, "utf8").catch(() => "");
  const { doc, changed } = applyCronMutation(parseHermesCronDoc(raw), mutation, new Date().toISOString());
  await mkdir(dirname(path), { recursive: true });
  let backup = "";
  if (raw.trim()) {
    backup = `${path}.bak.${Date.now()}`;
    await copyFile(path, backup).catch(() => { backup = ""; });
  }
  const tmp = `${path}.cronwrite.tmp`;
  await writeFile(tmp, serializeHermesCronDoc(doc));
  await rename(tmp, path);
  return { ok: true, changed, backup, target: "local" };
}

/** Edit a remote machine's cron store over the linkd shell rail. */
async function writeRemote(base: string, session: string, homeDir: string, mutation: CronMutation): Promise<CronWriteResult> {
  const raw = await readRemoteCronDoc(base, session, homeDir);
  const { doc, changed } = applyCronMutation(parseHermesCronDoc(raw), mutation, new Date().toISOString());
  const lines = await writeRemoteCronDoc(base, session, homeDir, serializeHermesCronDoc(doc));
  const marker = lines.find((line) => line.startsWith("CRONWRITE_OK")) ?? "";
  return { ok: true, changed, backup: marker.replace(/^CRONWRITE_OK\s+bak=/, ""), target: "remote" };
}

/**
 * Apply one cron mutation to a machine — local fs when the target resolves to
 * this box, otherwise over the linkd shell. Never throws: transport failures
 * come back as `{ ok: false, error }` so a fan-out can report per-machine.
 */
export async function applyCronWrite(options: CronWriteOptions): Promise<CronWriteResult> {
  const base = shellBaseFromCollectorUrl(options.collectorUrl);
  const isLocal = !options.collectorUrl?.trim() || base === hivemindLinkControlUrl();
  const session = options.session?.trim() || CRON_WRITE_SHELL_SESSION;
  if (!isLocal && !base) {
    return { ok: false, changed: 0, backup: "", target: "remote", error: "could not resolve a shell target" };
  }
  const remoteHome = (options.homeDir?.trim() || "~/.hermes").replace(/\/+$/, "");
  try {
    return isLocal
      ? await writeLocal(expandLocalHome(options.homeDir), options.mutation)
      : await writeRemote(base as string, session, remoteHome, options.mutation);
  } catch (error) {
    return {
      ok: false,
      changed: 0,
      backup: "",
      target: isLocal ? "local" : "remote",
      error: error instanceof Error ? error.message : "cron write failed",
    };
  }
}
