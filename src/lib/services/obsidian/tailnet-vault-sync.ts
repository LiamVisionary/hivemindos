import { spawn } from "child_process";
import { createHash } from "crypto";
import { constants } from "fs";
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, dirname, extname, join, relative, resolve, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

const DEFAULT_EXCLUDES = [
  ".git/",
  ".obsidian/workspace*",
  ".obsidian/cache/",
  ".obsidian/plugins/*/data.json",
  ".trash/",
  ".DS_Store",
  "*.tmp",
  "*.swp",
  "*.log",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.sqlite",
  "*.sqlite3",
  "*.db",
];

export type TailnetVaultSyncDirection = "bidirectional" | "push" | "pull";

export type TailnetVaultSyncInput = {
  vaultPath?: string;
  remoteHost?: string;
  remotePath?: string;
  direction?: TailnetVaultSyncDirection;
  dryRun?: boolean;
};

export type TailnetVaultSyncResult = {
  ok: boolean;
  dryRun: boolean;
  direction: TailnetVaultSyncDirection;
  localPath: string;
  remoteHost: string;
  remotePath: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  conflicts: string[];
  changedFiles: string[];
};

type SyncState = {
  version: 1;
  files: Record<string, string>;
};

function assertRemoteHost(value: string) {
  if (!/^[A-Za-z0-9._@-]{1,253}$/.test(value)) {
    throw new Error("Remote machine must be a Tailscale SSH host, MagicDNS name, or user@host.");
  }
}

function assertRemotePath(value: string) {
  if (!value.trim() || /[\0\r\n]/.test(value)) throw new Error("Remote vault path is required.");
  if (!value.startsWith("/") && !value.startsWith("~/")) {
    throw new Error("Remote vault path must be absolute or start with ~/.");
  }
}

function escapeRemotePath(path: string) {
  // Adapted from rsyncwrapper's path escaping, but kept argument-array based so
  // local values never pass through a shell.
  return path.replace(/([\\\s"'`$])/g, "\\$1");
}

function ensureTrailingSlash(path: string) {
  return path.endsWith("/") ? path : `${path}/`;
}

function formatCommand(args: string[]) {
  return ["rsync", ...args].map((arg) => (/^[A-Za-z0-9_./:=@,+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ");
}

export async function runTailnetVaultSync(input: TailnetVaultSyncInput): Promise<TailnetVaultSyncResult> {
  const remoteHost = input.remoteHost?.trim() ?? "";
  const remotePath = input.remotePath?.trim() ?? "";
  const direction: TailnetVaultSyncDirection = input.direction === "push" || input.direction === "pull" ? input.direction : "bidirectional";
  const dryRun = input.dryRun !== false;
  assertRemoteHost(remoteHost);
  assertRemotePath(remotePath);

  const localPath = resolveObsidianVaultPath(input.vaultPath, { requireWritable: direction === "pull" });
  const localStats = await stat(localPath);
  if (!localStats.isDirectory()) throw new Error("Local vault path is not a directory.");
  await access(localPath, constants.R_OK | (direction === "pull" ? constants.W_OK : 0));

  const remote = `${remoteHost}:${escapeRemotePath(ensureTrailingSlash(remotePath))}`;
  const local = ensureTrailingSlash(localPath);
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = 0;
  let command = "";
  let conflicts: string[] = [];
  let changedFiles: string[] = [];

  if (direction === "bidirectional") {
    const remoteSnapshot = await makeRemoteSnapshot(remote, dryRun);
    stderr += remoteSnapshot.stderr;
    exitCode = remoteSnapshot.exitCode;
    command = remoteSnapshot.command;
    if (remoteSnapshot.exitCode === 0) {
      const merge = await mergeRemoteSnapshot({
        localPath,
        remotePath: remoteSnapshot.path,
        remoteHost,
        remoteVaultPath: remotePath,
        dryRun,
      });
      conflicts = merge.conflicts;
      changedFiles = merge.changedFiles;
      stdout += merge.summary;
    }
    if (!dryRun && remoteSnapshot.exitCode === 0) {
      const push = await runRsync(local, remote, { dryRun: false, delete: true });
      stdout += `\n${push.stdout}`;
      stderr += push.stderr;
      exitCode = push.exitCode;
      command = `${command}\n${push.command}`;
      if (push.exitCode === 0) await saveSyncState(stateKey(localPath, remoteHost, remotePath), await fileHashes(localPath));
    }
    await rm(remoteSnapshot.path, { recursive: true, force: true });
  } else {
    const source = direction === "push" ? local : remote;
    const destination = direction === "push" ? remote : local;
    const result = await runRsync(source, destination, { dryRun, delete: true });
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = result.exitCode;
    command = result.command;
    if (!dryRun && result.exitCode === 0) await saveSyncState(stateKey(localPath, remoteHost, remotePath), await fileHashes(localPath));
  }

  return {
    ok: exitCode === 0,
    dryRun,
    direction,
    localPath,
    remoteHost,
    remotePath,
    command,
    stdout: stdout || `No ${dryRun ? "dry-run" : "sync"} output for ${basename(localPath)}.`,
    stderr,
    exitCode,
    conflicts,
    changedFiles,
  };
}

async function runRsync(source: string, destination: string, options: { dryRun: boolean; delete: boolean }) {
  const args = [
    "-az",
    "--itemize-changes",
    ...(options.delete ? ["--delete", "--delete-excluded"] : []),
    "--human-readable",
    "--stats",
    "-e",
    "tailscale ssh",
    ...(options.dryRun ? ["--dry-run", "--verbose"] : []),
    ...DEFAULT_EXCLUDES.map((pattern) => `--exclude=${pattern}`),
    source,
    destination,
  ];
  const result = await spawnRsync(args);
  return { ...result, command: formatCommand(args) };
}

async function makeRemoteSnapshot(remote: string, dryRun: boolean) {
  const path = await makeTempDir();
  const result = await runRsync(remote, ensureTrailingSlash(path), { dryRun: false, delete: true });
  if (dryRun) return { ...result, path };
  return { ...result, path };
}

async function makeTempDir() {
  const path = join(tmpdir(), `hivemindos-vault-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

async function mergeRemoteSnapshot(input: {
  localPath: string;
  remotePath: string;
  remoteHost: string;
  remoteVaultPath: string;
  dryRun: boolean;
}) {
  const key = stateKey(input.localPath, input.remoteHost, input.remoteVaultPath);
  const [base, local, remote] = await Promise.all([
    readSyncState(key),
    fileHashes(input.localPath),
    fileHashes(input.remotePath),
  ]);
  const allPaths = new Set([...Object.keys(base.files), ...Object.keys(local), ...Object.keys(remote)]);
  const conflicts: string[] = [];
  const changedFiles: string[] = [];
  const actions: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const relativePath of [...allPaths].sort()) {
    const baseHash = base.files[relativePath];
    const localHash = local[relativePath];
    const remoteHash = remote[relativePath];
    const localChanged = localHash !== baseHash;
    const remoteChanged = remoteHash !== baseHash;
    const localFile = resolve(input.localPath, relativePath);
    const remoteFile = resolve(input.remotePath, relativePath);

    if (localHash === remoteHash) continue;

    if (!localChanged && remoteChanged) {
      actions.push(`remote -> local ${relativePath}`);
      changedFiles.push(relativePath);
      if (!input.dryRun) {
        if (remoteHash) {
          await mkdir(dirname(localFile), { recursive: true });
          await copyFile(remoteFile, localFile);
        } else {
          await rm(localFile, { force: true });
        }
      }
      continue;
    }

    if (localChanged && !remoteChanged) {
      actions.push(`local -> remote ${relativePath}`);
      changedFiles.push(relativePath);
      continue;
    }

    if (localChanged && remoteChanged) {
      const conflictPath = conflictFilePath(localFile, input.remoteHost, stamp);
      conflicts.push(relative(input.localPath, conflictPath).split(sep).join("/"));
      actions.push(`conflict copy ${relativePath}`);
      if (!input.dryRun && remoteHash) {
        await mkdir(dirname(conflictPath), { recursive: true });
        await copyFile(remoteFile, conflictPath);
      }
    }
  }

  return {
    conflicts,
    changedFiles,
    summary: actions.length
      ? actions.join("\n")
      : "Vaults already match the last known sync state.",
  };
}

function conflictFilePath(filePath: string, remoteHost: string, stamp: string) {
  const ext = extname(filePath);
  const stem = ext ? filePath.slice(0, -ext.length) : filePath;
  const host = remoteHost.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48) || "remote";
  return `${stem}.conflict-${host}-${stamp}${ext}`;
}

async function fileHashes(root: string) {
  const output: Record<string, string> = {};
  await walk(root, async (path) => {
    const relativePath = relative(root, path).split(sep).join("/");
    if (shouldSkip(relativePath)) return;
    output[relativePath] = createHash("sha256").update(await readFile(path) as unknown as Uint8Array).digest("hex");
  });
  return output;
}

async function walk(dir: string, visit: (path: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, visit);
    } else if (entry.isFile()) {
      await visit(path);
    }
  }
}

function shouldSkip(relativePath: string) {
  return relativePath.startsWith(".git/")
    || relativePath.startsWith(".trash/")
    || relativePath.startsWith(".obsidian/cache/")
    || /^\.obsidian\/workspace/.test(relativePath)
    || /^\.obsidian\/plugins\/[^/]+\/data\.json$/.test(relativePath)
    || /(^|\/)\.DS_Store$/.test(relativePath)
    || /(^|\/)\.env(\.|$)/.test(relativePath)
    || /\.(tmp|swp|log|pem|key|sqlite|sqlite3|db)$/i.test(relativePath);
}

function stateKey(localPath: string, remoteHost: string, remotePath: string) {
  return createHash("sha256").update(`${localPath}\n${remoteHost}\n${remotePath}`).digest("hex").slice(0, 24);
}

async function readSyncState(key: string): Promise<SyncState> {
  const path = syncStatePath(key);
  try {
    return JSON.parse(await readFile(path, "utf-8")) as SyncState;
  } catch {
    return { version: 1, files: {} };
  }
}

async function saveSyncState(key: string, files: Record<string, string>) {
  const path = syncStatePath(key);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, files }, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}

function syncStatePath(key: string) {
  return join(homedir(), ".hivemindos", "vault-sync", `${key}.json`);
}

function spawnRsync(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn("rsync", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Hivemind Sync repair timed out."));
    }, 180_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout: stdout.slice(-20_000), stderr: stderr.slice(-20_000), exitCode });
    });
  });
}
