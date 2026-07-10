// Portable runtime-state: the authoritative manifest + file operations for
// cloning/syncing the *mergeable subset* of an agent runtime's on-disk state
// (skills, memories, .md files, non-secret config) between machines.
//
// Why this lives here (a plain .mjs in scripts/lib) and not in the TS catalog:
//   - The standalone collector (scripts/agent-telemetry-collector.mjs) cannot
//     import TS, but it is the always-on daemon that does the actual file work
//     (export/import/backup/reconcile). So the heavy logic + the authoritative
//     globs live here and the collector imports them.
//   - The TS catalog (src/lib/services/runtime-install-catalog.ts) only carries
//     a short human-readable `portableStateSummary` for the UI, so there is NO
//     drift-prone duplicate of the globs (unlike COLLECTOR_RUNTIME_INSTALL).
//
// HARD INVARIANTS (enforced here, relied on by every caller):
//   1. Credentials/login state are NEVER packed. `stripSecrets` drops the files
//      entirely; provider API keys travel only via the shared hive env.
//   2. Included config files are redacted (`redactConfig`) before packing, as
//      defense-in-depth against a key embedded in an otherwise-portable config.
//   3. Anything resolving under the Syncthing-replicated brain vault is skipped
//      (never double-sync what Syncthing already owns).
//   4. Extraction is path-escape guarded; imports are backup-first.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

// Credential / login-state files dropped for EVERY runtime, matched against the
// relative path and the basename, at any depth. These never travel.
export const GLOBAL_STRIP_SECRETS = [
  ".env",
  ".env.*",
  "*.env",
  ".credentials.json",
  ".credentials*",
  "auth.json",
  "auth.lock",
  "secrets.json",
  "secrets.json.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.gpg",
  "*.asc",
  "id_rsa",
  "id_rsa.*",
  "id_ed25519",
  "id_ed25519.*",
  "*.meta.json",
];

// Backups, caches, logs, and machine-local junk dropped for every runtime.
const GLOBAL_EXCLUDE = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.DS_Store",
  "**/*.bak",
  "**/*.bak.*",
  "**/*.tmp",
  "**/*.swp",
  "**/*.log",
  "**/*-wal",
  "**/*-shm",
];

// Per-runtime portable state. `home` is the runtime's data dir (machine-local).
// include/exclude/stripSecrets are POSIX globs ("**" any depth, "*" one segment)
// relative to `home`; stripSecrets also matches by basename at any depth.
// redactConfig files are included but stripped of secret-looking values first.
export const RUNTIME_PORTABLE_STATE = {
  "claude-code": {
    home: "~/.claude",
    include: [
      "skills/**",
      "plugins/**",
      "agents/**",
      "commands/**",
      "memory/**",
      "*.md",
      "settings.json",
      "keybindings.json",
    ],
    exclude: [
      "projects/**",
      "file-history/**",
      "shell-snapshots/**",
      "cache/**",
      "telemetry/**",
      "ide/**",
      "backups/**",
      "history.jsonl",
      "plugins/**/node_modules/**",
    ],
    stripSecrets: ["mcp-needs-auth-cache.json", ".claude.json"],
    redactConfig: ["settings.json"],
  },
  codex: {
    home: "~/.codex",
    include: ["skills/**", "AGENTS.md", "*.md", "config.toml"],
    exclude: [
      "sessions/**",
      "archived_sessions/**",
      "generated_images/**",
      "computer-use/**",
      "plugins/cache/**",
      "*.sqlite",
      "*.sqlite-*",
      "logs_*.sqlite*",
      "vendor_imports/**",
    ],
    stripSecrets: [".codex-global-state.json", "chrome-native-hosts*.json"],
    redactConfig: ["config.toml"],
    memoryNote:
      "Codex memories live in a hot SQLite (memories_*.sqlite) that cannot be copied live without risking a torn page; they are excluded. Markdown AGENTS.md/skills do transport.",
  },
  hermes: {
    home: "~/.hermes",
    include: ["config.yaml", "skills/**", "cron/**", "agents/**", "profiles/**", "*.md"],
    exclude: [
      "hermes-agent/**",
      "state.db",
      "state.db-*",
      "state-snapshots/**",
      "logs/**",
      "sessions/**",
      "lsp/**",
      "bin/**",
      "cache/**",
      "kanban.db",
      "models_dev_cache.json",
      "profiles/**/state.db*",
      "profiles/**/sessions/**",
      "profiles/**/logs/**",
      "profiles/**/hermes-agent/**",
    ],
    stripSecrets: [],
    redactConfig: ["config.yaml", "profiles/**/config.yaml"],
  },
  openclaw: {
    home: "~/.openclaw",
    include: ["openclaw.json", "skills/**", "*.md"],
    exclude: ["agents/*/sessions/**", "agents/*/logs/**"],
    stripSecrets: ["secrets.json", ".mcp.json"],
    redactConfig: ["openclaw.json"],
  },
  aeon: {
    home: "~/.aeon",
    // The AEON checkout is Git-synced on its own rail; this captures only
    // portable v0.1 configuration/identity and excludes generated artifacts.
    include: ["aeon.yml", "catalog/**", "skills/**", "memory/**", "soul/**", "STRATEGY.md", "CLAUDE.md"],
    exclude: [".git/**", "node_modules/**", "output/**", "apps/dashboard/outputs/**", "logs/**"],
    stripSecrets: [".mcp.json"],
    redactConfig: ["aeon.yml"],
  },
  gemini: {
    home: "~/.gemini",
    include: ["skills/**", "extensions/**", "*.md", "settings.json"],
    exclude: ["tmp/**", "cache/**"],
    stripSecrets: ["oauth_creds.json", "access_tokens.json"],
    redactConfig: ["settings.json"],
  },
  opencode: {
    home: "~/.opencode",
    include: ["skills/**", "*.md", "config.json", "opencode.json"],
    exclude: ["node_modules/**", "bin/**", "package.json", "package-lock.json", ".gitignore"],
    stripSecrets: [],
    redactConfig: ["config.json", "opencode.json"],
  },
  openhands: {
    home: "~/.openhands",
    include: ["profiles/**", "*.md", "settings.json", "config.toml"],
    exclude: [
      "cache/**",
      "conversations/**",
      "profiles/**/conversations/**",
      "profiles/**/sessions/**",
      "profiles/**/logs/**",
    ],
    stripSecrets: [],
    redactConfig: ["settings.json", "config.toml", "profiles/**/settings.json"],
  },
  aider: {
    home: "~/.aider",
    include: ["*.md"],
    exclude: ["caches/**", "analytics.json", "installs.json"],
    stripSecrets: [],
    redactConfig: [],
    memoryNote:
      "Aider keeps its config at ~/.aider.conf.yml (home root) and only caches/analytics under ~/.aider; little portable state lives here.",
  },
};

export function portableStateRuntimes() {
  return Object.keys(RUNTIME_PORTABLE_STATE);
}

export function portableStateManifest(runtime) {
  return RUNTIME_PORTABLE_STATE[runtime] || null;
}

// ---------------------------------------------------------------------------
// Glob matching (minimal, no deps)
// ---------------------------------------------------------------------------

function globToRegExp(glob) {
  // Translate a POSIX-ish glob to a RegExp. "**" = any chars incl "/", "*" =
  // any chars except "/", "?" = one non-"/" char. Everything else literal.
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**" or "**/"
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

const globCache = new Map();
function matchesGlob(relPath, glob) {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(relPath);
}

function matchesAny(relPath, globs) {
  return globs.some((g) => matchesGlob(relPath, g));
}

function matchesSecret(relPath, stripGlobs) {
  const base = relPath.split("/").pop() || relPath;
  return stripGlobs.some((g) => matchesGlob(relPath, g) || matchesGlob(base, g));
}

export function expandHome(path) {
  return String(path || "").replace(/^~(?=$|\/)/, homedir());
}

// True if `relPath` (under `home`) is part of the runtime's portable subset.
export function isPortablePath(relPath, manifest) {
  const rel = relPath.split(sep).join("/");
  const strip = [...GLOBAL_STRIP_SECRETS, ...(manifest.stripSecrets || [])];
  if (matchesSecret(rel, strip)) return false;
  if (matchesAny(rel, [...GLOBAL_EXCLUDE, ...(manifest.exclude || [])])) return false;
  return matchesAny(rel, manifest.include || []);
}

export function isRedactConfig(relPath, manifest) {
  const rel = relPath.split(sep).join("/");
  return matchesAny(rel, manifest.redactConfig || []);
}

// ---------------------------------------------------------------------------
// Walk + hash
// ---------------------------------------------------------------------------

async function walkDir(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(abs, onFile);
    } else if (entry.isFile()) {
      await onFile(abs);
    }
  }
}

// List the portable files for a runtime under `root` (defaults to its home).
// `sharedVaultPath`, when set, drops anything resolving inside the brain vault.
export async function walkPortableState(runtime, options = {}) {
  const manifest = portableStateManifest(runtime);
  if (!manifest) throw new Error(`No portable-state manifest for runtime "${runtime}".`);
  const root = resolve(expandHome(options.root || manifest.home));
  const vault = options.sharedVaultPath ? resolve(expandHome(options.sharedVaultPath)) : "";
  const files = [];
  const exists = await stat(root).then((s) => s.isDirectory()).catch(() => false);
  if (!exists) return { root, files, missing: true };
  await walkDir(root, async (abs) => {
    const rel = relative(root, abs).split(sep).join("/");
    if (!isPortablePath(rel, manifest)) return;
    if (vault && (abs === vault || abs.startsWith(`${vault}${sep}`))) return;
    const info = await stat(abs).catch(() => null);
    files.push({ rel, abs, size: info?.size ?? 0 });
  });
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { root, files, missing: false };
}

async function hashFile(abs) {
  return createHash("sha256").update(await readFile(abs)).digest("hex");
}

export async function portableFileHashes(runtime, options = {}) {
  const { root, files } = await walkPortableState(runtime, options);
  const out = {};
  for (const file of files) out[file.rel] = await hashFile(file.abs);
  return { root, hashes: out };
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const SECRET_KEY_RE = /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|[_-]?secret|password|passwd|authorization|bearer|private[_-]?key|api[_-]?token|webhook[_-]?url|session[_-]?token|cookie)/i;
// High-confidence secret shapes: recognizable provider prefixes, OAuth tokens,
// and structurally-valid JWTs. Used by the AUDIT (scanForSecrets) so it does NOT
// flag git shas, lockfile integrity digests, minified assets, or .pyc bytecode,
// which legitimately appear in skill content and are not secrets.
const SECRET_VALUE_RE = /(sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,})/g;
// Aggressive: high-confidence PLUS generic long hex/base64. Applied ONLY to
// designated config files (redactConfig), where over-redaction is acceptable and
// catching an unknown-format secret matters more than a false positive.
const SECRET_REDACT_RE = new RegExp(
  `${SECRET_VALUE_RE.source}|[A-Fa-f0-9]{40,}|[A-Za-z0-9+/]{44,}={0,2}`,
  "g",
);
export const REDACTED = "__HIVEMIND_REDACTED__";

function redactJsonValue(value, keyHint) {
  if (typeof value === "string") {
    if (keyHint && SECRET_KEY_RE.test(keyHint)) return REDACTED;
    return value.replace(SECRET_REDACT_RE, REDACTED);
  }
  if (Array.isArray(value)) return value.map((v) => redactJsonValue(v, keyHint));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactJsonValue(v, k);
    return out;
  }
  return value;
}

// Redact secret-looking values from a config file's bytes. JSON is parsed and
// walked; everything else is line-redacted (keys named like secrets, and any
// value matching a known secret pattern).
export function redactConfigBytes(relPath, buffer) {
  const text = buffer.toString("utf8");
  const ext = extname(relPath).toLowerCase();
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(text);
      return Buffer.from(`${JSON.stringify(redactJsonValue(parsed, ""), null, 2)}\n`, "utf8");
    } catch {
      /* fall through to line redaction for JSON-with-comments etc. */
    }
  }
  const redacted = text
    .split("\n")
    .map((line) => {
      const kv = line.match(/^(\s*["']?[A-Za-z0-9_.-]+["']?\s*[:=]\s*)(.*)$/);
      if (kv && SECRET_KEY_RE.test(kv[1])) {
        const trailing = kv[2].match(/[,'"]*\s*$/)?.[0] ?? "";
        return `${kv[1]}"${REDACTED}"${trailing}`;
      }
      return line.replace(SECRET_VALUE_RE, REDACTED);
    })
    .join("\n");
  return Buffer.from(redacted, "utf8");
}

// Test/QA helper: returns the secret-looking substrings found in a buffer.
export function scanForSecrets(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  return text.match(SECRET_VALUE_RE) || [];
}

// ---------------------------------------------------------------------------
// Staging + tar
// ---------------------------------------------------------------------------

async function makeTempDir(prefix) {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

// Copy the portable subset into a fresh staging dir, applying redaction. Returns
// the staging dir + the list of staged rel paths + how many files were redacted.
export async function stagePortableState(runtime, options = {}) {
  const manifest = portableStateManifest(runtime);
  const { files, root } = await walkPortableState(runtime, options);
  const staging = await makeTempDir(`hive-rt-stage-${runtime}`);
  let redactions = 0;
  for (const file of files) {
    const dest = join(staging, file.rel);
    await mkdir(dirname(dest), { recursive: true });
    if (isRedactConfig(file.rel, manifest)) {
      const original = await readFile(file.abs);
      const redacted = redactConfigBytes(file.rel, original);
      if (!redacted.equals(original)) redactions += 1;
      await writeFile(dest, redacted, { mode: 0o600 });
    } else {
      await cp(file.abs, dest);
    }
  }
  return { staging, root, files: files.map((f) => f.rel), redactions };
}

function runTar(args, cwd) {
  return new Promise((resolveTar, reject) => {
    const child = spawn("tar", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("tar timed out."));
    }, 180_000);
    child.stderr.on("data", (c) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveTar();
      else reject(new Error(`tar exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Pack a runtime's portable (redacted) state to a tar.gz. Returns the archive
// path + metadata. The archive contains paths relative to the runtime home.
export async function packPortableState(runtime, options = {}) {
  const { staging, files, redactions } = await stagePortableState(runtime, options);
  try {
    const outDir = options.outDir || (await makeTempDir(`hive-rt-pack-${runtime}`));
    await mkdir(outDir, { recursive: true });
    const tarPath = join(outDir, `${runtime}-portable-state.tar.gz`);
    if (files.length === 0) {
      // tar of an empty dir, so import is a well-formed no-op rather than an error.
      await writeFile(join(staging, ".hivemind-empty"), "");
    }
    await runTar(["-czf", tarPath, "-C", staging, "."], undefined);
    const size = (await stat(tarPath)).size;
    return { tarPath, fileCount: files.length, bytes: size, redactions, files };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Safe extract: every member must stay within destDir.
export async function unpackTarToDir(tarPath, destDir) {
  await mkdir(destDir, { recursive: true, mode: 0o700 });
  // bsdtar/GNU tar both honor -C; path traversal is additionally guarded by a
  // post-extract sweep that refuses to surface anything outside destDir.
  await runTar(["-xzf", tarPath, "-C", destDir], undefined);
  const base = resolve(destDir);
  await walkDir(base, async (abs) => {
    const target = resolve(abs);
    if (target !== base && !target.startsWith(`${base}${sep}`)) {
      throw new Error("Archive member escaped the extraction root.");
    }
  });
  return base;
}

// ---------------------------------------------------------------------------
// Backup + restore (atomic, mirrors wallet-vault-backup.ts)
// ---------------------------------------------------------------------------

const BACKUP_KEEP = Number(process.env.HIVEMIND_RUNTIME_BACKUP_KEEP || 5);

export function runtimeBackupDir(runtime) {
  return join(homedir(), ".hivemindos", "runtime-backups", runtime);
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Snapshot the CURRENT portable subset (un-redacted: a faithful local rollback
// point) to ~/.hivemindos/runtime-backups/<rt>/<stamp>.tar.gz, atomically.
export async function backupPortableState(runtime, options = {}) {
  const manifest = portableStateManifest(runtime);
  if (!manifest) throw new Error(`No portable-state manifest for runtime "${runtime}".`);
  const { files, root } = await walkPortableState(runtime, options);
  const dir = runtimeBackupDir(runtime);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const finalPath = join(dir, `${isoStamp()}.tar.gz`);
  const tmpPath = join(dir, `.in-progress-${randomBytes(6).toString("hex")}.tar.gz`);
  if (files.length === 0) {
    // Nothing portable on disk yet — still write an (empty) restore point.
    const empty = await makeTempDir(`hive-rt-empty-${runtime}`);
    try {
      await writeFile(join(empty, ".hivemind-empty"), "");
      await runTar(["-czf", tmpPath, "-C", empty, "."]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  } else {
    const relArgs = files.map((f) => f.rel);
    await runTar(["-czf", tmpPath, "-C", root, ...relArgs]);
  }
  await rename(tmpPath, finalPath);
  await pruneBackups(runtime);
  return { backupPath: finalPath, fileCount: files.length, root };
}

async function pruneBackups(runtime) {
  const dir = runtimeBackupDir(runtime);
  const entries = await readdir(dir).catch(() => []);
  const backups = entries
    .filter((n) => n.endsWith(".tar.gz") && !n.startsWith(".in-progress"))
    .sort();
  while (backups.length > BACKUP_KEEP) {
    const victim = backups.shift();
    await rm(join(dir, victim), { force: true }).catch(() => {});
  }
}

export async function listBackups(runtime) {
  const dir = runtimeBackupDir(runtime);
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((n) => n.endsWith(".tar.gz") && !n.startsWith(".in-progress")).sort();
}

// Restore a runtime's portable subset from a backup tar over its home. Only the
// portable subset is touched; stripSecrets / excluded paths are never written.
export async function restorePortableState(runtime, backupPath, options = {}) {
  const manifest = portableStateManifest(runtime);
  if (!manifest) throw new Error(`No portable-state manifest for runtime "${runtime}".`);
  const home = resolve(expandHome(options.root || manifest.home));
  const staging = await unpackTarToDir(backupPath, await makeTempDir(`hive-rt-restore-${runtime}`));
  try {
    let restored = 0;
    await walkDir(staging, async (abs) => {
      const rel = relative(staging, abs).split(sep).join("/");
      if (rel === ".hivemind-empty") return;
      if (!isPortablePath(rel, manifest)) return; // never restore a secret/excluded path
      const dest = join(home, rel);
      await mkdir(dirname(dest), { recursive: true });
      await cp(abs, dest);
      restored += 1;
    });
    return { ok: true, restored, home };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Import / overlay (incoming-wins) — used for one-shot clone seeding
// ---------------------------------------------------------------------------

// Overlay an unpacked snapshot's portable files onto the local home (incoming
// wins). Backs up the current subset first unless options.backup === false.
// Re-applies the manifest filter so a tampered snapshot can never drop a
// credential/excluded path onto the target.
export async function importPortableSnapshot(runtime, snapshotDir, options = {}) {
  const manifest = portableStateManifest(runtime);
  if (!manifest) throw new Error(`No portable-state manifest for runtime "${runtime}".`);
  const home = resolve(expandHome(options.root || manifest.home));
  let backupPath = null;
  if (options.backup !== false) {
    backupPath = (
      await backupPortableState(runtime, { root: home, sharedVaultPath: options.sharedVaultPath })
    ).backupPath;
  }
  const base = resolve(snapshotDir);
  let applied = 0;
  const skipped = [];
  await walkDir(base, async (abs) => {
    const rel = relative(base, abs).split(sep).join("/");
    if (rel === ".hivemind-empty") return;
    if (!isPortablePath(rel, manifest)) {
      skipped.push(rel);
      return;
    }
    const dest = join(home, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(abs, dest);
    applied += 1;
  });
  return { ok: true, runtime, applied, skipped, backupPath, home };
}

// Unpack a tar.gz and overlay it (incoming-wins) onto the local home.
export async function importPortableTar(runtime, tarPath, options = {}) {
  const tmp = await unpackTarToDir(tarPath, await makeTempDir(`hive-rt-import-${runtime}`));
  try {
    return await importPortableSnapshot(runtime, tmp, options);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3-way reconcile (port of tailnet-vault-sync.ts mergeRemoteSnapshot)
// ---------------------------------------------------------------------------

function syncStatePath(runtime, peerKey) {
  const key = createHash("sha256").update(`${runtime}\n${peerKey}`).digest("hex").slice(0, 24);
  return join(homedir(), ".hivemindos", "runtime-state-sync", `${runtime}-${key}.json`);
}

async function readBaseState(runtime, peerKey) {
  const path = syncStatePath(runtime, peerKey);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && parsed.files && typeof parsed.files === "object" ? parsed.files : {};
  } catch {
    return {};
  }
}

async function writeBaseState(runtime, peerKey, files) {
  const path = syncStatePath(runtime, peerKey);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, files }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

function conflictSidecar(absPath, peerLabel, stamp) {
  const ext = extname(absPath);
  const stem = ext ? absPath.slice(0, -ext.length) : absPath;
  const host = String(peerLabel || "remote").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48) || "remote";
  return `${stem}.sync-conflict-${host}-${stamp}${ext}`;
}

// Reconcile the local runtime home against an unpacked peer snapshot directory.
// 3-way (base/local/remote) so concurrent edits become a `.sync-conflict-*`
// sidecar (never silently dropped) and deletes propagate without resurrecting.
// Backs up the local subset before the first write. Pull-only: never writes the
// peer's disk. Returns a summary; advances the base state on success.
export async function reconcilePortableState(runtime, snapshotDir, options = {}) {
  const manifest = portableStateManifest(runtime);
  if (!manifest) throw new Error(`No portable-state manifest for runtime "${runtime}".`);
  const peerKey = options.peerKey || options.peerLabel || "peer";
  const peerLabel = options.peerLabel || peerKey;
  const dryRun = options.dryRun === true;

  const home = resolve(expandHome(options.root || manifest.home));
  const [base, localRes, remoteRes] = await Promise.all([
    readBaseState(runtime, peerKey),
    portableFileHashes(runtime, { root: home, sharedVaultPath: options.sharedVaultPath }),
    portableFileHashes(runtime, { root: snapshotDir, sharedVaultPath: options.sharedVaultPath }),
  ]);
  const local = localRes.hashes;
  const remote = remoteRes.hashes;
  const allPaths = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);

  const plan = { adopted: [], deleted: [], conflicts: [], kept: [] };
  for (const rel of [...allPaths].sort()) {
    const baseHash = base[rel];
    const localHash = local[rel];
    const remoteHash = remote[rel];
    if (localHash === remoteHash) continue;
    const localChanged = localHash !== baseHash;
    const remoteChanged = remoteHash !== baseHash;
    if (!localChanged && remoteChanged) {
      if (remoteHash) plan.adopted.push(rel);
      else plan.deleted.push(rel);
    } else if (localChanged && !remoteChanged) {
      plan.kept.push(rel);
    } else if (localChanged && remoteChanged) {
      plan.conflicts.push(rel);
    }
  }

  const willWrite = plan.adopted.length + plan.deleted.length + plan.conflicts.length;
  let backupPath = null;
  if (!dryRun && willWrite > 0) {
    backupPath = (await backupPortableState(runtime, { root: home, sharedVaultPath: options.sharedVaultPath })).backupPath;
    const stamp = isoStamp();
    for (const rel of plan.adopted) {
      const dest = join(home, rel);
      await mkdir(dirname(dest), { recursive: true });
      await cp(join(snapshotDir, rel), dest);
    }
    for (const rel of plan.deleted) {
      await rm(join(home, rel), { force: true });
    }
    for (const rel of plan.conflicts) {
      const sidecar = conflictSidecar(join(home, rel), peerLabel, stamp);
      await mkdir(dirname(sidecar), { recursive: true });
      await cp(join(snapshotDir, rel), sidecar);
    }
    // Advance base to the now-current local subset so the next pass is a no-op.
    const after = await portableFileHashes(runtime, { root: home, sharedVaultPath: options.sharedVaultPath });
    await writeBaseState(runtime, peerKey, after.hashes);
  } else if (!dryRun) {
    // No writes, but record convergence (local == remote where they overlap).
    await writeBaseState(runtime, peerKey, local);
  }

  return {
    ok: true,
    runtime,
    peer: peerLabel,
    dryRun,
    adopted: plan.adopted,
    deleted: plan.deleted,
    conflicts: plan.conflicts,
    kept: plan.kept,
    backupPath,
  };
}
