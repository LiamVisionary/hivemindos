import { execFile } from "child_process";
import { constants } from "fs";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT, type GBrainConfig } from "@/lib/types/agent-runtime";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 45_000;
const LONG_TIMEOUT_MS = 10 * 60_000;
const SERVICE_NOTE = "GBrain.md";
const SKILL_SOURCE_FILE = ".hivemind-skill-source.json";
const PROVIDER_KEYS = ["ZEROENTROPY_API_KEY", "OPENAI_API_KEY", "VOYAGE_API_KEY", "ANTHROPIC_API_KEY"] as const;
const STATUS_COMMANDS = {
  missingEmbeddings: "gbrain embed --stale",
  zeroLinks: "gbrain extract links --source db",
  zeroTimeline: "gbrain extract timeline --source db",
  mcpStdio: "gbrain serve",
  mcpHttp: "gbrain serve --http",
};

export type GBrainCommandResult = {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  error?: string;
};

export type GBrainStatus = {
  ok: boolean;
  installed: boolean;
  connected: boolean;
  enabled: boolean;
  cliPath: string;
  installPath: string;
  brainPath: string;
  dataDir: string;
  serviceNotePath: string;
  searchMode: GBrainConfig["searchMode"];
  providerPolicy: GBrainConfig["providerPolicy"];
  mcp: {
    mode: GBrainConfig["mcpMode"];
    httpUrl: string;
    command: string;
  };
  version?: string;
  doctorOk?: boolean;
  doctor?: unknown;
  stats?: Record<string, unknown>;
  statsText?: string;
  features?: {
    brainScore?: number;
    recommendations: Array<{ id: string; title: string; command: string; priority?: number; autoFixable?: boolean }>;
  };
  keyStatus: Record<(typeof PROVIDER_KEYS)[number], boolean>;
  needsKeys: boolean;
  skillpack: {
    location: string;
    exists: boolean;
    count: number;
    resolverPath?: string;
  };
  lastImport?: string;
  lastDream?: string;
  commands: GBrainCommandResult[];
  error?: string;
};

type GBrainInput = {
  vaultPath?: string;
  brainServicesFolder?: string;
  gbrain?: Partial<GBrainConfig>;
};

type RunOptions = {
  timeoutMs?: number;
  cwd?: string;
  allowFailure?: boolean;
};

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function normalizeGBrainConfig(input?: Partial<GBrainConfig>): GBrainConfig {
  return {
    ...DEFAULT_SHARED_VAULT.gbrain,
    ...(input ?? {}),
    cliPath: input?.cliPath?.trim() || process.env.GBRAIN_CLI_PATH?.trim() || DEFAULT_SHARED_VAULT.gbrain.cliPath,
    installPath: input?.installPath?.trim() || process.env.GBRAIN_INSTALL_PATH?.trim() || DEFAULT_SHARED_VAULT.gbrain.installPath,
    brainPath: input?.brainPath?.trim() || process.env.GBRAIN_BRAIN_PATH?.trim() || "",
    dataDir: input?.dataDir?.trim() || process.env.GBRAIN_DATA_DIR?.trim() || DEFAULT_SHARED_VAULT.gbrain.dataDir,
    httpUrl: input?.httpUrl?.trim() || process.env.GBRAIN_HTTP_URL?.trim() || DEFAULT_SHARED_VAULT.gbrain.httpUrl,
    skillpackLocation: input?.skillpackLocation?.trim() || DEFAULT_SHARED_VAULT.gbrain.skillpackLocation,
  };
}

function displayCommand(command: string, args: string[]) {
  return [command, ...args].join(" ");
}

function cliCommand(config: GBrainConfig) {
  const cli = config.cliPath || "gbrain";
  return cli.includes("/") || cli.startsWith("~") ? resolve(expandHome(cli)) : cli;
}

async function runGbrainCommand(config: GBrainConfig, args: string[], options: RunOptions = {}): Promise<GBrainCommandResult> {
  const command = cliCommand(config);
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd ? resolve(expandHome(options.cwd)) : undefined,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, GBRAIN_DATA_DIR: resolve(expandHome(config.dataDir || "~/.gbrain")) },
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

function parseJsonOutput(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function safeVaultFolder(folder: string, fallback: string) {
  const value = (folder || fallback).trim();
  if (!value) return fallback;
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("GBrain folders must be relative paths inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function brainServicesRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder || DEFAULT_SHARED_VAULT.brainServicesFolder, DEFAULT_SHARED_VAULT.brainServicesFolder));
}

function skillpackRoot(vaultPath: string, config: GBrainConfig) {
  return join(vaultPath, safeVaultFolder(config.skillpackLocation, DEFAULT_SHARED_VAULT.gbrain.skillpackLocation));
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function countMarkdownFiles(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return 0;
    const path = join(root, entry.name);
    if (entry.isDirectory()) return countMarkdownFiles(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? 1 : 0;
  }));
  return nested.reduce((sum, count) => sum + count, 0);
}

function keyStatus() {
  return Object.fromEntries(PROVIDER_KEYS.map((key) => [key, Boolean(process.env[key]?.trim())])) as GBrainStatus["keyStatus"];
}

function parseFeatureRecommendations(payload: unknown): GBrainStatus["features"] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const recommendations = Array.isArray(record.recommendations) ? record.recommendations : [];
  return {
    brainScore: typeof record.brain_score === "number" ? record.brain_score : undefined,
    recommendations: recommendations
      .map((item) => {
        const rec = item as Record<string, unknown>;
        return {
          id: String(rec.id ?? ""),
          title: String(rec.title ?? ""),
          command: String(rec.command ?? ""),
          priority: typeof rec.priority === "number" ? rec.priority : undefined,
          autoFixable: Boolean(rec.auto_fixable),
        };
      })
      .filter((item) => item.id && item.title),
  };
}

function parseStats(payload: unknown, text: string): Record<string, unknown> | undefined {
  if (payload && typeof payload === "object") return payload as Record<string, unknown>;
  const stats: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9 _-]+)\s*[:=]\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    if (!match) continue;
    stats[match[1].trim().toLowerCase().replace(/\s+/g, "_")] = Number(match[2].replace(/,/g, ""));
  }
  return Object.keys(stats).length ? stats : undefined;
}

async function serviceNoteMetadata(path: string) {
  const raw = await readFile(path, "utf8").catch(() => "");
  return {
    lastImport: raw.match(/lastImport:\s*"?([^"\n]+)"?/i)?.[1],
    lastDream: raw.match(/lastDream:\s*"?([^"\n]+)"?/i)?.[1],
  };
}

export async function writeGbrainServiceNote(input: GBrainInput & { event?: "connect" | "install" | "import" | "embed" | "dream" | "query"; summary?: string }) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const config = normalizeGBrainConfig(input.gbrain);
  const root = brainServicesRoot(vault, input.brainServicesFolder);
  await mkdir(root, { recursive: true });
  const notePath = join(root, SERVICE_NOTE);
  const previous = await serviceNoteMetadata(notePath);
  const now = new Date().toISOString();
  const lastImport = input.event === "import" ? now : previous.lastImport;
  const lastDream = input.event === "dream" ? now : previous.lastDream;
  const frontmatter = [
    "---",
    "type: brain-service",
    "service: gbrain",
    `enabled: ${config.enabled}`,
    `installMode: ${config.installMode}`,
    `searchMode: ${config.searchMode}`,
    `providerPolicy: ${config.providerPolicy}`,
    `mcpMode: ${config.mcpMode}`,
    lastImport ? `lastImport: ${JSON.stringify(lastImport)}` : "",
    lastDream ? `lastDream: ${JSON.stringify(lastDream)}` : "",
    `updatedAt: ${JSON.stringify(now)}`,
    "---",
  ].filter(Boolean).join("\n");
  const body = [
    frontmatter,
    "",
    "# GBrain",
    "",
    "Optional HivemindOS brain service for retrieval, graph traversal, MCP access, and synthesized answers over the shared vault.",
    "",
    "## Managed Paths",
    "",
    `- Vault: \`${vault}\``,
    `- CLI: \`${config.cliPath || "gbrain"}\``,
    `- Data dir: \`${config.dataDir}\``,
    `- Skillpack: \`${config.skillpackLocation}\``,
    `- MCP: \`${config.mcpMode === "http" ? STATUS_COMMANDS.mcpHttp : config.mcpMode === "stdio" ? STATUS_COMMANDS.mcpStdio : "disabled"}\``,
    "",
    "## Default Commands",
    "",
    `- Import vault: \`gbrain import "${vault}" --no-embed\``,
    `- Embed stale chunks: \`${STATUS_COMMANDS.missingEmbeddings}\``,
    `- Build graph: \`${STATUS_COMMANDS.zeroLinks}\` and \`${STATUS_COMMANDS.zeroTimeline}\``,
    `- Dream cycle: \`gbrain dream\``,
    "",
    input.summary ? "## Latest Dashboard Event" : "",
    input.summary ? `- ${now}: ${input.summary}` : "",
    "",
    "No provider secrets are stored in this note.",
    "",
  ].filter((line) => line !== "").join("\n");
  await writeFile(notePath, `${body.trim()}\n`, "utf8");
  return { path: relative(vault, notePath), absolutePath: notePath };
}

async function skillpackSummary(vault: string, config: GBrainConfig) {
  const root = skillpackRoot(vault, config);
  const existsRoot = await exists(root);
  const entries = existsRoot ? await readdir(root, { withFileTypes: true }).catch(() => []) : [];
  const count = entries.filter((entry) => entry.isDirectory()).length;
  const resolver = join(root, "RESOLVER.md");
  return {
    location: relative(vault, root),
    exists: existsRoot,
    count,
    resolverPath: await exists(resolver) ? relative(vault, resolver) : undefined,
  };
}

export async function getGbrainStatus(input: GBrainInput = {}): Promise<GBrainStatus> {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeGBrainConfig(input.gbrain);
  const serviceNotePath = join(brainServicesRoot(vault, input.brainServicesFolder), SERVICE_NOTE);
  const keys = keyStatus();
  const commands: GBrainCommandResult[] = [];
  const status: GBrainStatus = {
    ok: false,
    installed: false,
    connected: false,
    enabled: config.enabled,
    cliPath: config.cliPath,
    installPath: config.installPath,
    brainPath: config.brainPath,
    dataDir: config.dataDir,
    serviceNotePath: relative(vault, serviceNotePath),
    searchMode: config.searchMode,
    providerPolicy: config.providerPolicy,
    mcp: {
      mode: config.mcpMode,
      httpUrl: config.httpUrl,
      command: config.mcpMode === "http" ? STATUS_COMMANDS.mcpHttp : config.mcpMode === "stdio" ? STATUS_COMMANDS.mcpStdio : "disabled",
    },
    keyStatus: keys,
    needsKeys: !keys.ZEROENTROPY_API_KEY && !keys.OPENAI_API_KEY && !keys.VOYAGE_API_KEY,
    skillpack: await skillpackSummary(vault, config),
    commands,
  };

  const version = await runGbrainCommand(config, ["--version"], { allowFailure: true, timeoutMs: 8_000 });
  commands.push(version);
  if (!version.ok) {
    return {
      ...status,
      error: version.error || version.stderr || "GBrain CLI was not found. Install or connect it from the dashboard.",
    };
  }

  status.installed = true;
  status.connected = true;
  status.version = version.stdout.trim() || version.stderr.trim();

  const doctor = await runGbrainCommand(config, ["doctor", "--json"], { allowFailure: true });
  commands.push(doctor);
  status.doctorOk = doctor.ok;
  status.doctor = parseJsonOutput(doctor.stdout) ?? parseJsonOutput(doctor.stderr);

  const stats = await runGbrainCommand(config, ["stats", "--json"], { allowFailure: true });
  commands.push(stats);
  const statsPayload = parseJsonOutput(stats.stdout) ?? parseJsonOutput(stats.stderr);
  status.stats = parseStats(statsPayload, `${stats.stdout}\n${stats.stderr}`);
  status.statsText = stats.stdout.trim() || stats.stderr.trim();

  const features = await runGbrainCommand(config, ["features", "--json"], { allowFailure: true });
  commands.push(features);
  const featurePayload = parseJsonOutput(features.stdout) ?? parseJsonOutput(features.stderr);
  status.features = parseFeatureRecommendations(featurePayload);

  const metadata = await serviceNoteMetadata(serviceNotePath);
  status.lastImport = metadata.lastImport;
  status.lastDream = metadata.lastDream;
  status.ok = Boolean(status.installed && (status.doctorOk || status.stats || status.features));
  if (!status.ok) status.error = doctor.error || doctor.stderr || "GBrain responded, but doctor/status checks did not pass yet.";
  return status;
}

async function ensureBun() {
  try {
    const result = await execFileAsync("bun", ["--version"], { timeout: 8_000 });
    return result.stdout.trim() || result.stderr.trim();
  } catch {
    throw new Error("Bun is required before installing GBrain. Install Bun first, then retry from the dashboard.");
  }
}

export async function installGbrain(input: GBrainInput = {}) {
  const config = normalizeGBrainConfig({ ...input.gbrain, enabled: true, installMode: "local" });
  const commands: GBrainCommandResult[] = [];
  await ensureBun();
  const version = await runGbrainCommand(config, ["--version"], { allowFailure: true, timeoutMs: 8_000 });
  commands.push(version);
  if (!version.ok) {
    const install: GBrainCommandResult = await execFileAsync("bun", ["install", "-g", "github:garrytan/gbrain"], {
      timeout: LONG_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
    }).then((result): GBrainCommandResult => ({
      command: "bun install -g github:garrytan/gbrain",
      ok: true,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    })).catch((error): GBrainCommandResult => {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
      return {
        command: "bun install -g github:garrytan/gbrain",
        ok: false,
        stdout: String(err.stdout ?? ""),
        stderr: String(err.stderr ?? ""),
        exitCode: typeof err.code === "number" ? err.code : null,
        error: err.message,
      };
    });
    commands.push(install);
    if (!install.ok) throw new Error(install.error || install.stderr || "GBrain install failed.");
  }

  for (const args of [
    ["init"],
    ["config", "set", "search.mode", config.searchMode],
    ["doctor", "--json"],
  ]) {
    commands.push(await runGbrainCommand(config, args, { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS }));
  }

  const importResult = await importVaultToGbrain({ ...input, gbrain: config });
  commands.push(...importResult.commands);
  await scaffoldGbrainSkillpack({ ...input, gbrain: config });
  await writeGbrainServiceNote({ ...input, gbrain: config, event: "install", summary: "Installed or verified local GBrain and imported the shared vault." });
  return { status: await getGbrainStatus({ ...input, gbrain: config }), commands };
}

export async function connectGbrain(input: GBrainInput = {}) {
  const config = normalizeGBrainConfig({ ...input.gbrain, enabled: true });
  const version = await runGbrainCommand(config, ["--version"], { allowFailure: true, timeoutMs: 8_000 });
  if (!version.ok) throw new Error(version.error || "Could not run the configured GBrain CLI.");
  await writeGbrainServiceNote({ ...input, gbrain: config, event: "connect", summary: "Connected an existing GBrain CLI to HivemindOS." });
  return { status: await getGbrainStatus({ ...input, gbrain: config }), commands: [version] };
}

export async function importVaultToGbrain(input: GBrainInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeGBrainConfig(input.gbrain);
  const commands: GBrainCommandResult[] = [];
  const noteCount = await countMarkdownFiles(vault);
  commands.push(await runGbrainCommand(config, ["import", vault, "--no-embed"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS }));
  commands.push(await runGbrainCommand(config, ["embed", "--stale"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS }));
  if (noteCount > 0) {
    commands.push(await runGbrainCommand(config, ["extract", "links", "--source", "db"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS }));
    commands.push(await runGbrainCommand(config, ["extract", "timeline", "--source", "db"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS }));
  }
  await writeGbrainServiceNote({ ...input, gbrain: config, event: "import", summary: `Imported ${noteCount} markdown note${noteCount === 1 ? "" : "s"} into GBrain.` });
  return { status: await getGbrainStatus(input), commands };
}

export async function embedGbrain(input: GBrainInput = {}) {
  const config = normalizeGBrainConfig(input.gbrain);
  const command = await runGbrainCommand(config, ["embed", "--stale"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  await writeGbrainServiceNote({ ...input, gbrain: config, event: "embed", summary: "Refreshed stale GBrain embeddings." });
  return { status: await getGbrainStatus(input), commands: [command] };
}

export async function dreamGbrain(input: GBrainInput = {}) {
  const config = normalizeGBrainConfig(input.gbrain);
  const command = await runGbrainCommand(config, ["dream"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  await writeGbrainServiceNote({ ...input, gbrain: config, event: "dream", summary: "Ran the GBrain dream cycle from HivemindOS." });
  return { status: await getGbrainStatus(input), commands: [command] };
}

export async function queryGbrain(input: GBrainInput & { query?: string; mode?: "search" | "query" | "think" }) {
  const config = normalizeGBrainConfig(input.gbrain);
  const query = input.query?.trim();
  if (!query) throw new Error("Enter a GBrain query first.");
  const mode = input.mode || "think";
  const command = await runGbrainCommand(config, [mode, query], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  await writeGbrainServiceNote({ ...input, gbrain: config, event: "query", summary: `Ran \`gbrain ${mode}\` from the dashboard.` });
  return {
    output: command.stdout.trim() || command.stderr.trim(),
    commands: [command],
    status: await getGbrainStatus(input),
  };
}

async function copySkillpackSource(sourceRoot: string, destinationRoot: string) {
  await mkdir(destinationRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    await cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (path) => !path.split(/[\\/]+/).some((part) => part === ".git" || part === "node_modules"),
    });
  }
  const skillDirs = await readdir(destinationRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of skillDirs) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(destinationRoot, entry.name);
    if (!(await exists(join(skillDir, "SKILL.md")))) continue;
    const metadataPath = join(skillDir, SKILL_SOURCE_FILE);
    if (await exists(metadataPath)) continue;
    await writeFile(metadataPath, `${JSON.stringify({
      provider: "gbrain",
      providerLabel: "GBrain",
      sourceUrl: "https://github.com/garrytan/gbrain/tree/master/skills",
      importedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
  }
}

export async function scaffoldGbrainSkillpack(input: GBrainInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const config = normalizeGBrainConfig(input.gbrain);
  const destinationRoot = skillpackRoot(vault, config);
  const sourceCandidates = [
    join(resolve(expandHome(config.installPath)), "skills"),
    join(homedir(), "gbrain", "skills"),
  ];
  let sourceRoot = "";
  for (const candidate of sourceCandidates) {
    if ((await stat(candidate).catch(() => null))?.isDirectory()) {
      sourceRoot = candidate;
      break;
    }
  }

  const commands: GBrainCommandResult[] = [];
  if (!sourceRoot) {
    const tempWorkspace = await mkdtemp(join(tmpdir(), "hivemindos-gbrain-skills-"));
    const scaffold = await runGbrainCommand(config, ["skillpack", "scaffold", "--all", "--workspace", tempWorkspace, "--trust"], {
      allowFailure: true,
      timeoutMs: LONG_TIMEOUT_MS,
    });
    commands.push(scaffold);
    sourceRoot = join(tempWorkspace, "skills");
    if (!scaffold.ok || !(await exists(sourceRoot))) {
      await rm(tempWorkspace, { recursive: true, force: true });
      throw new Error(scaffold.error || scaffold.stderr || "Could not scaffold GBrain skillpack.");
    }
    await copySkillpackSource(sourceRoot, destinationRoot);
    await rm(tempWorkspace, { recursive: true, force: true });
  } else {
    await copySkillpackSource(sourceRoot, destinationRoot);
  }

  await writeGbrainServiceNote({ ...input, gbrain: config, event: "connect", summary: `Scaffolded GBrain skillpack into ${relative(vault, destinationRoot)}.` });
  const summary = await skillpackSummary(vault, config);
  return { skillpack: summary, commands };
}

export function gbrainCommandCatalog() {
  return STATUS_COMMANDS;
}
