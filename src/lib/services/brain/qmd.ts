import { execFile } from "child_process";
import { constants } from "fs";
import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT, type QmdConfig } from "@/lib/types/agent-runtime";
import { cachedStatus, invalidateStatus } from "./status-cache";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 15_000;
const STATUS_TTL_MS = 15_000;
const LONG_TIMEOUT_MS = 30 * 60_000;
const SERVICE_NOTE = "QMD.md";
const QMD_PACKAGE = "@tobilu/qmd";
const QMD_INSTALL_COMMAND = `npm install -g ${QMD_PACKAGE}`;

export type QmdCommandResult = {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  error?: string;
};

export type QmdStatus = {
  ok: boolean;
  installed: boolean;
  connected: boolean;
  enabled: boolean;
  cliPath: string;
  collectionName: string;
  indexName: string;
  indexPath: string;
  serviceNotePath: string;
  searchMode: QmdConfig["searchMode"];
  mcp: {
    mode: QmdConfig["mcpMode"];
    httpUrl: string;
    command: string;
  };
  version?: string;
  indexExists: boolean;
  indexSizeBytes?: number;
  documents?: number;
  vectors?: number;
  pendingEmbeddings?: number;
  collection?: {
    exists: boolean;
    files?: number;
    updated?: string;
  };
  lastIndex?: string;
  lastEmbed?: string;
  lastQuery?: string;
  commands: QmdCommandResult[];
  error?: string;
};

type QmdInput = {
  vaultPath?: string;
  brainServicesFolder?: string;
  qmd?: Partial<QmdConfig>;
};

type RunOptions = {
  timeoutMs?: number;
  cwd?: string;
  allowFailure?: boolean;
};

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function normalizeQmdConfig(input?: Partial<QmdConfig>): QmdConfig {
  const defaults = DEFAULT_SHARED_VAULT.qmd;
  const defaultLimit = Number(input?.defaultLimit ?? defaults.defaultLimit);
  const candidateLimit = Number(input?.candidateLimit ?? defaults.candidateLimit);
  const minScore = Number(input?.minScore ?? defaults.minScore);
  const maxDocsPerBatch = Number(input?.maxDocsPerBatch ?? defaults.maxDocsPerBatch);
  const maxBatchMb = Number(input?.maxBatchMb ?? defaults.maxBatchMb);
  return {
    ...defaults,
    ...(input ?? {}),
    cliPath: input?.cliPath?.trim() || process.env.QMD_CLI_PATH?.trim() || defaults.cliPath,
    collectionName: input?.collectionName?.trim() || process.env.QMD_COLLECTION_NAME?.trim() || defaults.collectionName,
    indexName: input?.indexName?.trim() || process.env.QMD_INDEX_NAME?.trim() || defaults.indexName,
    httpUrl: input?.httpUrl?.trim() || process.env.QMD_HTTP_URL?.trim() || defaults.httpUrl,
    defaultLimit: Number.isFinite(defaultLimit) ? Math.min(Math.max(Math.trunc(defaultLimit), 1), 50) : defaults.defaultLimit,
    candidateLimit: Number.isFinite(candidateLimit) ? Math.min(Math.max(Math.trunc(candidateLimit), 1), 200) : defaults.candidateLimit,
    minScore: Number.isFinite(minScore) ? Math.min(Math.max(minScore, 0), 1) : defaults.minScore,
    maxDocsPerBatch: Number.isFinite(maxDocsPerBatch) ? Math.min(Math.max(Math.trunc(maxDocsPerBatch), 1), 5_000) : defaults.maxDocsPerBatch,
    maxBatchMb: Number.isFinite(maxBatchMb) ? Math.min(Math.max(Math.trunc(maxBatchMb), 1), 512) : defaults.maxBatchMb,
  };
}

function displayCommand(command: string, args: string[]) {
  return [command, ...args].join(" ");
}

function cliCommand(config: QmdConfig) {
  const cli = config.cliPath || "qmd";
  return cli.includes("/") || cli.startsWith("~") ? resolve(expandHome(cli)) : cli;
}

function indexArgs(config: QmdConfig) {
  return config.indexName && config.indexName !== "index" ? ["--index", config.indexName] : [];
}

function qmdCacheDir() {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return xdg ? join(expandHome(xdg), "qmd") : join(homedir(), ".cache", "qmd");
}

function qmdIndexPath(config: QmdConfig) {
  const name = config.indexName || "index";
  return join(qmdCacheDir(), `${name}.sqlite`);
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

function safeVaultFolder(folder: string, fallback: string) {
  const value = (folder || fallback).trim();
  if (!value) return fallback;
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("QMD service folders must be relative paths inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function brainServicesRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder || DEFAULT_SHARED_VAULT.brainServicesFolder, DEFAULT_SHARED_VAULT.brainServicesFolder));
}

async function runQmdCommand(config: QmdConfig, args: string[], options: RunOptions = {}): Promise<QmdCommandResult> {
  const command = cliCommand(config);
  const fullArgs = [...indexArgs(config), ...args];
  try {
    const result = await execFileAsync(command, fullArgs, {
      cwd: options.cwd ? resolve(expandHome(options.cwd)) : undefined,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 16,
      env: process.env,
    });
    return { command: displayCommand(command, fullArgs), ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
    const failed = {
      command: displayCommand(command, fullArgs),
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      exitCode: typeof err.code === "number" ? err.code : null,
      error: err.message,
    };
    if (options.allowFailure) return failed;
    throw Object.assign(new Error(err.message), { result: failed });
  }
}

async function runShellCommand(command: string, args: string[], options: RunOptions = {}): Promise<QmdCommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 16,
      env: process.env,
    });
    return { command: displayCommand(command, args), ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
    const failed = {
      command: displayCommand(command, args),
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      exitCode: typeof err.code === "number" ? err.code : null,
      error: err.message,
    };
    if (options.allowFailure) return failed;
    throw Object.assign(new Error(err.message), { result: failed });
  }
}

function parseNumber(label: string, text: string) {
  const match = text.match(new RegExp(`${label}:\\s*([0-9][0-9,]*)`, "i"));
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
}

function parseQmdStatus(text: string) {
  return {
    documents: parseNumber("Total", text),
    vectors: parseNumber("Vectors", text),
    pendingEmbeddings: parseNumber("Pending", text),
  };
}

function parseQmdCollection(text: string, collectionName: string) {
  const escaped = collectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = text.match(new RegExp(`(^|\\n)${escaped}\\s+\\(qmd://[^\\n]+\\)[\\s\\S]*?(?=\\n\\S|$)`, "i"))?.[0] ?? "";
  if (!block) return { exists: false };
  return {
    exists: true,
    files: parseNumber("Files", block),
    updated: block.match(/Updated:\s*([^\n]+)/i)?.[1]?.trim(),
  };
}

async function serviceNoteMetadata(path: string) {
  const raw = await readFile(path, "utf8").catch(() => "");
  return {
    lastIndex: raw.match(/lastIndex:\s*"?([^"\n]+)"?/i)?.[1],
    lastEmbed: raw.match(/lastEmbed:\s*"?([^"\n]+)"?/i)?.[1],
    lastQuery: raw.match(/lastQuery:\s*"?([^"\n]+)"?/i)?.[1],
  };
}

export async function writeQmdServiceNote(input: QmdInput & { event?: "connect" | "install" | "index" | "embed" | "query"; summary?: string }) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const config = normalizeQmdConfig(input.qmd);
  const root = brainServicesRoot(vault, input.brainServicesFolder);
  await mkdir(root, { recursive: true });
  const notePath = join(root, SERVICE_NOTE);
  const previous = await serviceNoteMetadata(notePath);
  const now = new Date().toISOString();
  const lastIndex = input.event === "index" || input.event === "install" ? now : previous.lastIndex;
  const lastEmbed = input.event === "embed" || (input.event === "install" && config.autoEmbed) ? now : previous.lastEmbed;
  const lastQuery = input.event === "query" ? now : previous.lastQuery;
  const frontmatter = [
    "---",
    "type: brain-service",
    "service: qmd",
    `enabled: ${config.enabled}`,
    `installMode: ${config.installMode}`,
    `searchMode: ${config.searchMode}`,
    `mcpMode: ${config.mcpMode}`,
    `collectionName: ${JSON.stringify(config.collectionName)}`,
    `indexName: ${JSON.stringify(config.indexName)}`,
    lastIndex ? `lastIndex: ${JSON.stringify(lastIndex)}` : "",
    lastEmbed ? `lastEmbed: ${JSON.stringify(lastEmbed)}` : "",
    lastQuery ? `lastQuery: ${JSON.stringify(lastQuery)}` : "",
    `updatedAt: ${JSON.stringify(now)}`,
    "---",
  ].filter(Boolean).join("\n");
  const body = [
    frontmatter,
    "",
    "# QMD",
    "",
    "Optional HivemindOS brain service for local markdown search across the shared vault. QMD provides BM25 keyword search, vector search, and hybrid retrieval over a local SQLite index.",
    "",
    "## Managed Paths",
    "",
    `- Vault: \`${vault}\``,
    `- CLI: \`${config.cliPath || "qmd"}\``,
    `- Collection: \`${config.collectionName}\``,
    `- Index: \`${qmdIndexPath(config)}\``,
    `- MCP: \`${config.mcpMode === "http" ? "qmd mcp --http" : config.mcpMode === "stdio" ? "qmd mcp" : "disabled"}\``,
    "",
    "## Default Commands",
    "",
    `- Install: \`${QMD_INSTALL_COMMAND}\``,
    `- Add collection: \`qmd collection add "${vault}" --name ${config.collectionName}\``,
    "- Refresh index: `qmd update`",
    `- Refresh embeddings: \`qmd embed -c ${config.collectionName} --max-docs-per-batch ${config.maxDocsPerBatch} --max-batch-mb ${config.maxBatchMb}\``,
    `- Query: \`qmd ${config.searchMode === "bm25" ? "search" : config.searchMode === "vector" ? "vsearch" : "query"} "<query>" --format json -c ${config.collectionName}\``,
    "",
    input.summary ? "## Latest Dashboard Event" : "",
    input.summary ? `- ${now}: ${input.summary}` : "",
    "",
    "No provider secrets are stored in this note. QMD's SQLite index and local models live outside the vault.",
    "",
  ].filter((line) => line !== "").join("\n");
  await writeFile(notePath, `${body.trim()}\n`, "utf8");
  return { path: relative(vault, notePath), absolutePath: notePath };
}

export function getQmdStatus(input: QmdInput = {}): Promise<QmdStatus> {
  return cachedStatus(`qmd:${JSON.stringify(input)}`, STATUS_TTL_MS, () => loadQmdStatus(input));
}

async function loadQmdStatus(input: QmdInput = {}): Promise<QmdStatus> {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeQmdConfig(input.qmd);
  const serviceNotePath = join(brainServicesRoot(vault, input.brainServicesFolder), SERVICE_NOTE);
  const indexPath = qmdIndexPath(config);
  const commands: QmdCommandResult[] = [];
  const [version, indexExists, indexSize, metadata] = await Promise.all([
    runQmdCommand(config, ["--help"], { allowFailure: true, timeoutMs: 8_000 }),
    exists(indexPath),
    fileSize(indexPath),
    serviceNoteMetadata(serviceNotePath),
  ]);
  commands.push(version);
  const status: QmdStatus = {
    ok: false,
    installed: false,
    connected: false,
    enabled: config.enabled,
    cliPath: config.cliPath,
    collectionName: config.collectionName,
    indexName: config.indexName,
    indexPath,
    serviceNotePath: relative(vault, serviceNotePath),
    searchMode: config.searchMode,
    mcp: {
      mode: config.mcpMode,
      httpUrl: config.httpUrl,
      command: config.mcpMode === "http" ? "qmd mcp --http" : config.mcpMode === "stdio" ? "qmd mcp" : "disabled",
    },
    indexExists,
    indexSizeBytes: indexSize,
    collection: { exists: false },
    lastIndex: metadata.lastIndex,
    lastEmbed: metadata.lastEmbed,
    lastQuery: metadata.lastQuery,
    commands,
  };

  if (!version.ok) {
    return {
      ...status,
      error: version.error || version.stderr || "QMD CLI was not found. Install it from Brain Services or connect an existing qmd binary.",
    };
  }

  status.installed = true;
  status.connected = true;
  status.version = (version.stdout.match(/qmd\s+.+/i)?.[0] ?? "qmd").trim();

  const [qmdStatus, collections] = await Promise.all([
    runQmdCommand(config, ["status"], { allowFailure: true, timeoutMs: STATUS_TIMEOUT_MS }),
    runQmdCommand(config, ["collection", "list"], { allowFailure: true, timeoutMs: STATUS_TIMEOUT_MS }),
  ]);
  commands.push(qmdStatus, collections);
  const parsed = parseQmdStatus(`${qmdStatus.stdout}\n${qmdStatus.stderr}`);
  status.documents = parsed.documents;
  status.vectors = parsed.vectors;
  status.pendingEmbeddings = parsed.pendingEmbeddings;
  status.collection = parseQmdCollection(`${collections.stdout}\n${collections.stderr}`, config.collectionName);
  status.ok = Boolean(status.installed && status.indexExists && status.collection.exists);
  if (!status.ok) {
    status.error = !status.indexExists
      ? "QMD is installed, but the index has not been created yet."
      : !status.collection.exists
        ? `QMD is installed, but collection '${config.collectionName}' has not been added yet.`
        : qmdStatus.error || collections.error || "QMD responded, but setup is incomplete.";
  }
  return status;
}

async function ensureNpm() {
  const npm = await runShellCommand("npm", ["--version"], { allowFailure: true, timeoutMs: 8_000 });
  if (!npm.ok) throw new Error("npm is required to install QMD. Install Node/npm first, then retry from Brain Services.");
  return npm;
}

async function ensureQmdCollection(input: QmdInput, config: QmdConfig, vault: string) {
  const commands: QmdCommandResult[] = [];
  const collections = await runQmdCommand(config, ["collection", "list"], { allowFailure: true, timeoutMs: STATUS_TIMEOUT_MS });
  commands.push(collections);
  const collection = parseQmdCollection(`${collections.stdout}\n${collections.stderr}`, config.collectionName);
  if (!collection.exists) {
    commands.push(await runQmdCommand(config, ["collection", "add", vault, "--name", config.collectionName], {
      allowFailure: true,
      timeoutMs: LONG_TIMEOUT_MS,
    }));
  }
  const update = await runQmdCommand(config, ["update"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  commands.push(update);
  if (!update.ok) throw new Error(update.error || update.stderr || "QMD could not update the vault index.");
  await writeQmdServiceNote({ ...input, qmd: config, event: "index", summary: `Indexed the shared vault as QMD collection '${config.collectionName}'.` });
  return commands;
}

export async function installQmd(input: QmdInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeQmdConfig({ ...input.qmd, enabled: true, installMode: "npm-global" });
  const commands: QmdCommandResult[] = [];
  commands.push(await ensureNpm());
  const version = await runQmdCommand(config, ["--help"], { allowFailure: true, timeoutMs: 8_000 });
  commands.push(version);
  if (!version.ok) {
    const install = await runShellCommand("npm", ["install", "-g", QMD_PACKAGE], {
      allowFailure: true,
      timeoutMs: LONG_TIMEOUT_MS,
    });
    commands.push(install);
    if (!install.ok) throw new Error(install.error || install.stderr || "QMD install failed.");
  }

  commands.push(...await ensureQmdCollection(input, config, vault));
  if (config.autoEmbed) {
    const embed = await runQmdCommand(config, ["embed", "-c", config.collectionName, "--max-docs-per-batch", String(config.maxDocsPerBatch), "--max-batch-mb", String(config.maxBatchMb)], {
      allowFailure: true,
      timeoutMs: LONG_TIMEOUT_MS,
    });
    commands.push(embed);
    if (!embed.ok) throw new Error(embed.error || embed.stderr || "QMD embedding refresh failed.");
    await writeQmdServiceNote({ ...input, qmd: config, event: "embed", summary: "Generated or refreshed QMD vectors for the shared vault." });
  }

  await writeQmdServiceNote({ ...input, qmd: config, event: "install", summary: "Installed or verified QMD, indexed the shared vault, and refreshed embeddings when enabled." });
  invalidateStatus("qmd:");
  return { status: await getQmdStatus({ ...input, qmd: config }), commands };
}

export async function connectQmd(input: QmdInput = {}) {
  const config = normalizeQmdConfig({ ...input.qmd, enabled: true, installMode: "existing" });
  const version = await runQmdCommand(config, ["--help"], { allowFailure: true, timeoutMs: 8_000 });
  if (!version.ok) throw new Error(version.error || "Could not run the configured QMD CLI.");
  await writeQmdServiceNote({ ...input, qmd: config, event: "connect", summary: "Connected an existing QMD CLI to HivemindOS." });
  invalidateStatus("qmd:");
  return { status: await getQmdStatus({ ...input, qmd: config }), commands: [version] };
}

export async function indexVaultToQmd(input: QmdInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeQmdConfig(input.qmd);
  const commands = await ensureQmdCollection(input, config, vault);
  invalidateStatus("qmd:");
  return { status: await getQmdStatus(input), commands };
}

export async function embedQmd(input: QmdInput = {}) {
  const config = normalizeQmdConfig(input.qmd);
  const command = await runQmdCommand(config, ["embed", "-c", config.collectionName, "--max-docs-per-batch", String(config.maxDocsPerBatch), "--max-batch-mb", String(config.maxBatchMb)], {
    allowFailure: true,
    timeoutMs: LONG_TIMEOUT_MS,
  });
  if (!command.ok) throw new Error(command.error || command.stderr || "QMD embedding refresh failed.");
  await writeQmdServiceNote({ ...input, qmd: config, event: "embed", summary: "Generated or refreshed QMD vectors for the shared vault." });
  invalidateStatus("qmd:");
  return { status: await getQmdStatus(input), commands: [command] };
}

function qmdQueryArgs(config: QmdConfig, query: string, mode: QmdConfig["searchMode"], limit?: number) {
  const resultLimit = Math.min(Math.max(Math.trunc(Number(limit || config.defaultLimit || 8)), 1), 50);
  const base = ["--format", "json", "--full-path", "-n", String(resultLimit), "-c", config.collectionName];
  if (config.minScore > 0) base.push("--min-score", String(config.minScore));
  if (mode === "bm25") return ["search", query, ...base];
  if (mode === "vector") return ["vsearch", query, ...base];
  const structured = `lex: ${query}\nvec: ${query}`;
  const args = ["query", structured, ...base, "--candidate-limit", String(config.candidateLimit)];
  if (mode === "hybrid") args.push("--no-rerank");
  return args;
}

export async function queryQmd(input: QmdInput & { query?: string; mode?: QmdConfig["searchMode"]; limit?: number }) {
  const config = normalizeQmdConfig(input.qmd);
  const query = input.query?.trim();
  if (!query) throw new Error("Enter a QMD query first.");
  const mode = input.mode || config.searchMode;
  const command = await runQmdCommand(config, qmdQueryArgs(config, query, mode, input.limit), {
    allowFailure: true,
    timeoutMs: LONG_TIMEOUT_MS,
  });
  if (!command.ok) throw new Error(command.error || command.stderr || "QMD query failed.");
  await writeQmdServiceNote({ ...input, qmd: config, event: "query", summary: `Ran \`qmd ${mode}\` from the dashboard.` });
  return {
    output: command.stdout.trim() || command.stderr.trim(),
    commands: [command],
    status: await getQmdStatus(input),
  };
}

export function qmdCommandCatalog() {
  return {
    install: QMD_INSTALL_COMMAND,
    index: "qmd collection add <vault> --name brain && qmd update",
    embed: "qmd embed -c brain",
    bm25: "qmd search <query>",
    vector: "qmd vsearch <query>",
    hybrid: "qmd query $'lex: <query>\\nvec: <query>' --no-rerank",
    rerank: "qmd query $'lex: <query>\\nvec: <query>'",
  };
}
