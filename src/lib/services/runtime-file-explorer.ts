import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";

const MAX_READ_BYTES = 500_000;
const MAX_WRITE_BYTES = 750_000;
const IGNORED = new Set([".git", "node_modules", ".next", "dist", "build", ".DS_Store"]);

export type RuntimeFileRoot = {
  key: string;
  label: string;
  path: string;
  writable: boolean;
};

export type RuntimeFileEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "dir";
  size?: number;
  updatedAt?: number;
};

export function runtimeFileRoots(input: { agents?: AgentProfile[]; sharedVault?: SharedVaultConfig; cwd?: string }): RuntimeFileRoot[] {
  const roots = new Map<string, RuntimeFileRoot>();
  const add = (key: string, label: string, path?: string, writable = false) => {
    const expanded = expandHome(path || "");
    if (!expanded) return;
    const resolved = resolve(expanded);
    roots.set(key, { key, label, path: resolved, writable });
  };

  add("hivemindos", "HivemindOS project", input.cwd || process.cwd(), false);
  add("hivemindos-state", "HivemindOS state", "~/.hivemindos", true);
  if (input.sharedVault?.enabled) add("shared-vault", "Shared Obsidian brain", input.sharedVault.vaultPath, true);
  for (const agent of input.agents ?? []) {
    if (agent.localDataDir?.trim()) add(`agent-${agent.id}`, `${agent.name} runtime`, agent.localDataDir, true);
  }
  add("hermes", "Hermes home", "~/.hermes", true);
  add("openclaw", "OpenClaw agents", "~/.openclaw/agents", true);
  add("aeon", "Aeon home", "~/.aeon", true);
  return [...roots.values()];
}

export async function listRuntimeFiles(roots: RuntimeFileRoot[], rootKey: string, relativePath = "") {
  const { root, path } = resolveInsideRoot(roots, rootKey, relativePath);
  const pathStats = await stat(path);
  if (!pathStats.isDirectory()) throw new Error("Selected path is not a directory.");
  const entries = await readdir(path, { withFileTypes: true });
  const files: RuntimeFileEntry[] = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const fullPath = join(path, entry.name);
    const info = await stat(fullPath).catch(() => null);
    if (!info) continue;
    files.push({
      name: entry.name,
      path: fullPath,
      relativePath: relative(root.path, fullPath),
      type: entry.isDirectory() ? "dir" : "file",
      size: info.size,
      updatedAt: info.mtimeMs,
    });
  }
  return files.sort((left, right) => {
    if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export async function readRuntimeFile(roots: RuntimeFileRoot[], rootKey: string, relativePath: string) {
  const { root, path } = resolveInsideRoot(roots, rootKey, relativePath);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Selected path is not a file.");
  if (info.size > MAX_READ_BYTES) throw new Error(`File is too large to preview (${Math.round(info.size / 1024)} KB).`);
  return {
    root,
    name: basename(path),
    path,
    relativePath: relative(root.path, path),
    content: await readFile(path, "utf8"),
    size: info.size,
    updatedAt: info.mtimeMs,
  };
}

export async function writeRuntimeFile(roots: RuntimeFileRoot[], rootKey: string, relativePath: string, content: string) {
  const { root, path } = resolveInsideRoot(roots, rootKey, relativePath);
  if (!root.writable) throw new Error("This root is read-only.");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("File content is too large to save from the dashboard.");
  await stat(dirname(path));
  await writeFile(path, content, { mode: 0o600 });
  return readRuntimeFile(roots, rootKey, relativePath);
}

function resolveInsideRoot(roots: RuntimeFileRoot[], rootKey: string, relativePath: string) {
  const root = roots.find((item) => item.key === rootKey);
  if (!root) throw new Error("Unknown file root.");
  const cleanRelative = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const path = resolve(root.path, cleanRelative || ".");
  if (path !== root.path && !path.startsWith(`${root.path}${sep}`)) throw new Error("Path escapes the selected root.");
  return { root, path };
}

function relative(root: string, path: string) {
  return path.slice(root.length).replace(/^\/+/, "");
}

function expandHome(path: string) {
  return path.replace(/^~(?=$|\/)/, homedir()).trim();
}
