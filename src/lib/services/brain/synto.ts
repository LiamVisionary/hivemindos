import { execFile } from "child_process";
import { constants } from "fs";
import { access, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";
import {
  SYNTO_CLOUD_API_KEY_ENV,
  SYNTO_CLOUD_MODEL_ID,
  SYNTO_CLOUD_PROVIDER,
  SYNTO_CLOUD_PROVIDER_URL,
  SYNTO_LOCAL_PROVIDER_NAME,
  SYNTO_LOCAL_PROVIDER_URL,
} from "@/lib/config/synto-model-tiers";
import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT, type SyntoConfig } from "@/lib/types/agent-runtime";
import { cachedStatus, invalidateStatus } from "./status-cache";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 45_000;
// Read-only status probe — a check that needs longer than this is
// effectively down, and the phone gives the whole status route only 30s.
const STATUS_TIMEOUT_MS = 15_000;
const STATUS_TTL_MS = 15_000;
const LONG_TIMEOUT_MS = 10 * 60_000;
const SERVICE_NOTE = "Syntho.md";
const LEGACY_SERVICE_NOTE = "Synto.md";
const CONFIG_FILE = "synto.toml";
const STATE_DB = ".synto/state.db";

const SYNTO_COMMANDS = {
  init: "synto init <synthesis-folder> --existing --non-interactive",
  run: "synto run --vault <synthesis-folder>",
  review: "synto review --vault <synthesis-folder>",
  maintainDryRun: "synto maintain --dry-run --vault <synthesis-folder>",
  maintainFix: "synto maintain --fix --vault <synthesis-folder>",
  compare: "synto compare --vault <synthesis-folder> --heavy-model <model>",
  evalJson: "synto eval --json --vault <synthesis-folder>",
  doctorBacklog: "synto doctor --backlog --vault <synthesis-folder>",
  packExport: "synto pack export --target agents --out <synthesis-folder>/pack --vault <synthesis-folder>",
  mcpStdio: "synto serve --vault <synthesis-folder>",
};

export type SyntoCommandResult = {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  error?: string;
};

export type SyntoStatus = {
  ok: boolean;
  installed: boolean;
  initialized: boolean;
  enabled: boolean;
  cliPath: string;
  serviceNotePath: string;
  synthesisRoot: string;
  configPath: string;
  stateDbPath: string;
  mcp: {
    mode: SyntoConfig["mcpMode"];
    command: string;
    tools: string[];
    sourceAccessMode: SyntoConfig["sourceAccessMode"];
  };
  counts: {
    raw: number;
    drafts: number;
    articles: number;
    sources: number;
    queries: number;
    synthesis: number;
    packFiles: number;
  };
  pack: {
    path: string;
    exists: boolean;
    indexExists: boolean;
    manifestExists: boolean;
  };
  version?: string;
  statusText?: string;
  modelRoute: {
    route: SyntoConfig["modelRoute"];
    provider: string;
    providerUrl: string;
    model: string;
    credentialEnv?: string;
  };
  commands: SyntoCommandResult[];
  error?: string;
};

type SyntoInput = {
  vaultPath?: string;
  synthesisFolder?: string;
  brainServicesFolder?: string;
  synto?: Partial<SyntoConfig>;
};

type RunOptions = {
  timeoutMs?: number;
  cwd?: string;
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
};

type SyntoAction = "connect" | "install" | "init" | "run" | "maintain" | "compare" | "eval" | "doctor" | "pack" | "query";

const MCP_TOOLS = [
  "list_articles",
  "read_article",
  "find_concept",
  "search_articles",
  "get_concept",
  "list_sources",
  "trace_lineage",
  "answer_question",
  "search_source_segments",
  "get_source_passages",
  "read_source_segment",
  "list_segments",
];

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function normalizeSyntoConfig(input?: Partial<SyntoConfig>): SyntoConfig {
  const minConfidence = Number(input?.minConfidence ?? DEFAULT_SHARED_VAULT.synto.minConfidence);
  return {
    ...DEFAULT_SHARED_VAULT.synto,
    ...(input ?? {}),
    cliPath: input?.cliPath?.trim() || process.env.SYNTO_CLI_PATH?.trim() || DEFAULT_SHARED_VAULT.synto.cliPath,
    cloudModel: input?.cloudModel?.trim() || SYNTO_CLOUD_MODEL_ID,
    localModelId: input?.localModelId?.trim() || DEFAULT_SHARED_VAULT.synto.localModelId,
    localLoadedModelKey: input?.localLoadedModelKey?.trim() || "",
    compareHeavyModel: input?.compareHeavyModel?.trim() || DEFAULT_SHARED_VAULT.synto.compareHeavyModel,
    minConfidence: Number.isFinite(minConfidence) ? Math.max(0, Math.min(1, minConfidence)) : DEFAULT_SHARED_VAULT.synto.minConfidence,
  };
}

function modelRouteRuntime(config: SyntoConfig) {
  if (config.modelRoute === "cloud-best") {
    return {
      route: config.modelRoute,
      provider: SYNTO_CLOUD_PROVIDER,
      providerUrl: SYNTO_CLOUD_PROVIDER_URL,
      model: config.cloudModel || SYNTO_CLOUD_MODEL_ID,
      credentialEnv: SYNTO_CLOUD_API_KEY_ENV,
    };
  }
  return {
    route: config.modelRoute,
    provider: SYNTO_LOCAL_PROVIDER_NAME,
    providerUrl: SYNTO_LOCAL_PROVIDER_URL,
    model: config.localLoadedModelKey || config.localModelId,
    credentialEnv: undefined,
  };
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function upsertTomlSection(source: string, sectionName: string, lines: string[]) {
  const section = `[${sectionName}]`;
  const replacement = `${section}\n${lines.join("\n")}\n`;
  const start = source.indexOf(section);
  if (start < 0) return `${source.trimEnd()}\n\n${replacement}`;
  const afterHeader = start + section.length;
  const nextHeaderOffset = source.slice(afterHeader).search(/\n\[[^\]]+\]/);
  const end = nextHeaderOffset < 0 ? source.length : afterHeader + nextHeaderOffset + 1;
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

async function applySyntoModelRoute(root: string, config: SyntoConfig) {
  const tomlPath = join(root, CONFIG_FILE);
  if (!(await exists(tomlPath))) return;
  const route = modelRouteRuntime(config);
  let next = await readFile(tomlPath, "utf8");
  next = upsertTomlSection(next, "models", [
    `fast = ${tomlString(route.model)}`,
    `heavy = ${tomlString(route.model)}`,
  ]);
  next = upsertTomlSection(next, "provider", [
    `name = ${tomlString(route.provider)}`,
    `url = ${tomlString(route.providerUrl)}`,
    `timeout = ${route.route === "cloud-best" ? 300 : 600}`,
    "fast_ctx = 16384",
    "heavy_ctx = 32768",
  ]);
  await writeFile(tomlPath, next, "utf8");
}

async function prepareSyntoModelRoute(root: string, config: SyntoConfig, requireReady = true) {
  const route = modelRouteRuntime(config);
  if (requireReady && route.route !== "cloud-best" && !config.localLoadedModelKey) {
    throw new Error("Choose a local Syntho tier, download it, and load the model in LM Studio before running Syntho.");
  }
  const sharedEnv = route.route === "cloud-best" ? await readSharedAgentEnv() : {};
  if (requireReady && route.credentialEnv && !sharedEnvValue(route.credentialEnv, sharedEnv)) {
    throw new Error(`${route.credentialEnv} is not connected. Add OpenRouter in Integrations before running the Best cloud tier.`);
  }
  await applySyntoModelRoute(root, config);
  return { route, env: { ...sharedEnv, ...process.env } };
}

function cliCommand(config: SyntoConfig) {
  const cli = config.cliPath || "synto";
  return cli.includes("/") || cli.startsWith("~") ? resolve(expandHome(cli)) : cli;
}

function displayCommand(command: string, args: string[]) {
  return [command, ...args].join(" ");
}

async function runSyntoCommand(config: SyntoConfig, args: string[], options: RunOptions = {}): Promise<SyntoCommandResult> {
  const command = cliCommand(config);
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd ? resolve(expandHome(options.cwd)) : undefined,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
      env: options.env ?? { ...process.env },
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

function safeVaultFolder(folder: string | undefined, fallback: string) {
  const value = (folder || fallback).trim();
  if (!value) return fallback;
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Syntho folders must be relative paths inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function brainServicesRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder, DEFAULT_SHARED_VAULT.brainServicesFolder));
}

function synthesisRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder, DEFAULT_SHARED_VAULT.synthesisFolder));
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(root: string, predicate: (name: string) => boolean): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const counts = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return 0;
    const path = join(root, entry.name);
    if (entry.isDirectory()) return countFiles(path, predicate);
    return entry.isFile() && predicate(entry.name) ? 1 : 0;
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function serviceNoteMetadata(path: string) {
  const raw = await readFile(path, "utf8").catch(() => "");
  return {
    lastInit: raw.match(/lastInit:\s*"?([^"\n]+)"?/i)?.[1],
    lastRun: raw.match(/lastRun:\s*"?([^"\n]+)"?/i)?.[1],
    lastPack: raw.match(/lastPack:\s*"?([^"\n]+)"?/i)?.[1],
  };
}

async function serviceNoteConfig(path: string): Promise<Partial<SyntoConfig>> {
  const raw = await readFile(path, "utf8").catch(() => "");
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return {};
  const value = (key: keyof SyntoConfig) => frontmatter[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim();
  const minConfidence = Number(value("minConfidence"));
  return {
    ...(value("enabled") ? { enabled: value("enabled") === "true" } : {}),
    ...(value("installMode") ? { installMode: value("installMode") as SyntoConfig["installMode"] } : {}),
    ...(value("mcpMode") ? { mcpMode: value("mcpMode") as SyntoConfig["mcpMode"] } : {}),
    ...(value("sourceAccessMode") ? { sourceAccessMode: value("sourceAccessMode") as SyntoConfig["sourceAccessMode"] } : {}),
    ...(value("modelRoute") ? { modelRoute: value("modelRoute") as SyntoConfig["modelRoute"] } : {}),
    ...(value("cloudProvider") ? { cloudProvider: value("cloudProvider") as SyntoConfig["cloudProvider"] } : {}),
    ...(value("cloudModel") ? { cloudModel: value("cloudModel") ?? "" } : {}),
    ...(value("cloudRequireZdr") ? { cloudRequireZdr: value("cloudRequireZdr") === "true" } : {}),
    ...(value("localProvider") ? { localProvider: value("localProvider") as SyntoConfig["localProvider"] } : {}),
    ...(value("localModelId") ? { localModelId: value("localModelId") ?? "" } : {}),
    ...(value("localLoadedModelKey") ? { localLoadedModelKey: value("localLoadedModelKey") ?? "" } : {}),
    ...(value("compareHeavyModel") ? { compareHeavyModel: value("compareHeavyModel") ?? "" } : {}),
    ...(value("autoApprove") ? { autoApprove: value("autoApprove") === "true" } : {}),
    ...(Number.isFinite(minConfidence) ? { minConfidence } : {}),
  };
}

async function resolveServiceNotePath(root: string) {
  const current = join(root, SERVICE_NOTE);
  if (await exists(current)) return current;
  const legacy = join(root, LEGACY_SERVICE_NOTE);
  return await exists(legacy) ? legacy : current;
}

async function ensureSynthesisFolders(root: string) {
  await Promise.all([
    root,
    join(root, "raw"),
    join(root, "wiki/.drafts"),
    join(root, "wiki/sources"),
    join(root, "wiki/queries"),
    join(root, "wiki/synthesis"),
    join(root, "pack"),
  ].map((path) => mkdir(path, { recursive: true })));
}

async function patchSourceAccessMode(root: string, mode: SyntoConfig["sourceAccessMode"]) {
  const tomlPath = join(root, CONFIG_FILE);
  if (!(await exists(tomlPath))) return;
  const previous = await readFile(tomlPath, "utf8");
  const section = "[mcp.source_access]";
  const line = `mode = "${mode}"`;
  if (!previous.includes(section)) {
    await writeFile(tomlPath, `${previous.trimEnd()}\n\n${section}\n${line}\n`, "utf8");
    return;
  }
  const next = previous.replace(
    /(\[mcp\.source_access\][\s\S]*?)(?=\n\[[^\]]+\]|\s*$)/,
    (match) => match.match(/^\s*mode\s*=/m) ? match.replace(/^\s*mode\s*=.*$/m, line) : `${match.trimEnd()}\n${line}\n`,
  );
  if (next !== previous) await writeFile(tomlPath, next, "utf8");
}

export async function writeSyntoServiceNote(input: SyntoInput & { event?: SyntoAction; summary?: string }) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const servicesRoot = brainServicesRoot(vault, input.brainServicesFolder);
  await mkdir(servicesRoot, { recursive: true });
  const notePath = join(servicesRoot, SERVICE_NOTE);
  const previous = await serviceNoteMetadata(await resolveServiceNotePath(servicesRoot));
  const now = new Date().toISOString();
  const lastInit = input.event === "init" ? now : previous.lastInit;
  const lastRun = input.event === "run" ? now : previous.lastRun;
  const lastPack = input.event === "pack" ? now : previous.lastPack;
  const frontmatter = [
    "---",
    "type: brain-service",
    "service: synto",
    `enabled: ${config.enabled}`,
    `installMode: ${config.installMode}`,
    `mcpMode: ${config.mcpMode}`,
    `sourceAccessMode: ${config.sourceAccessMode}`,
    `modelRoute: ${config.modelRoute}`,
    `cloudProvider: ${config.cloudProvider}`,
    `cloudModel: ${config.cloudModel}`,
    `cloudRequireZdr: ${config.cloudRequireZdr}`,
    `localProvider: ${config.localProvider}`,
    `localModelId: ${config.localModelId}`,
    config.localLoadedModelKey ? `localLoadedModelKey: ${JSON.stringify(config.localLoadedModelKey)}` : "",
    `compareHeavyModel: ${config.compareHeavyModel}`,
    `autoApprove: ${config.autoApprove}`,
    `minConfidence: ${config.minConfidence}`,
    lastInit ? `lastInit: ${JSON.stringify(lastInit)}` : "",
    lastRun ? `lastRun: ${JSON.stringify(lastRun)}` : "",
    lastPack ? `lastPack: ${JSON.stringify(lastPack)}` : "",
    `updatedAt: ${JSON.stringify(now)}`,
    "---",
  ].filter(Boolean).join("\n");
  const body = [
    frontmatter,
    "",
    "# Syntho",
    "",
    "Optional HivemindOS compiled-wiki service for the Synthesis layer. Syntho ingests source notes from `raw/`, compiles reviewed wiki drafts, exports agent packs, and can expose the published wiki over MCP.",
    "",
    "## Managed Paths",
    "",
    `- Shared vault: \`${vault}\``,
    `- Syntho vault: \`${root}\``,
    `- CLI: \`${config.cliPath || "synto"}\``,
    `- MCP: \`${config.mcpMode === "stdio" ? SYNTO_COMMANDS.mcpStdio.replace("<synthesis-folder>", root) : "disabled"}\``,
    `- Pack export: \`${SYNTO_COMMANDS.packExport.replaceAll("<synthesis-folder>", root)}\``,
    "",
    "## Default Commands",
    "",
    `- Initialize: \`synto init "${root}" --existing --non-interactive\``,
    `- Run pipeline: \`synto run --vault "${root}"\``,
    `- Review drafts: \`synto review --vault "${root}"\``,
    `- Maintain: \`synto maintain --dry-run --vault "${root}"\``,
    `- Compare models: \`synto compare --vault "${root}" --heavy-model "${config.compareHeavyModel}"\``,
    `- MCP server: \`synto serve --vault "${root}"\``,
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

/** Cached status — see status-cache.ts. Mutating actions invalidate. */
export function getSyntoStatus(input: SyntoInput = {}): Promise<SyntoStatus> {
  return cachedStatus(`synto:${JSON.stringify(input)}`, STATUS_TTL_MS, () => loadSyntoStatus(input));
}

async function loadSyntoStatus(input: SyntoInput = {}): Promise<SyntoStatus> {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const servicesRoot = brainServicesRoot(vault, input.brainServicesFolder);
  const serviceNotePath = await resolveServiceNotePath(servicesRoot);
  const noteConfig = Object.keys(input.synto ?? {}).length === 0 ? await serviceNoteConfig(serviceNotePath) : {};
  const config = normalizeSyntoConfig({ ...noteConfig, ...(input.synto ?? {}) });
  const configPath = join(root, CONFIG_FILE);
  const stateDbPath = join(root, STATE_DB);
  const packRoot = join(root, "pack");
  const commands: SyntoCommandResult[] = [];
  // The version probe and the fs scans are independent — run them together.
  const [version, initialized, packExists, counts, indexExists, manifestExists] = await Promise.all([
    runSyntoCommand(config, ["--version"], { allowFailure: true, timeoutMs: 8_000 }),
    exists(configPath),
    exists(packRoot),
    Promise.all([
      countFiles(join(root, "raw"), (name) => /\.(md|txt)$/i.test(name)),
      countFiles(join(root, "wiki/.drafts"), (name) => /\.md$/i.test(name)),
      countFiles(join(root, "wiki"), (name) => /\.md$/i.test(name)),
      countFiles(join(root, "wiki/sources"), (name) => /\.md$/i.test(name)),
      countFiles(join(root, "wiki/queries"), (name) => /\.md$/i.test(name)),
      countFiles(join(root, "wiki/synthesis"), (name) => /\.md$/i.test(name)),
      countFiles(packRoot, () => true),
    ]).then(([raw, drafts, articles, sources, queries, synthesis, packFiles]) => ({
      raw, drafts, articles, sources, queries, synthesis, packFiles,
    })),
    exists(join(packRoot, "INDEX.json")),
    exists(join(packRoot, "manifest.json")),
  ]);
  commands.push(version);

  const status: SyntoStatus = {
    ok: false,
    installed: version.ok,
    initialized,
    enabled: config.enabled,
    cliPath: config.cliPath,
    serviceNotePath: relative(vault, serviceNotePath),
    synthesisRoot: relative(vault, root),
    configPath: relative(vault, configPath),
    stateDbPath: relative(vault, stateDbPath),
    mcp: {
      mode: config.mcpMode,
      command: config.mcpMode === "stdio" ? `${config.cliPath || "synto"} serve --vault "${root}"` : "disabled",
      tools: MCP_TOOLS,
      sourceAccessMode: config.sourceAccessMode,
    },
    counts,
    pack: {
      path: relative(vault, packRoot),
      exists: packExists,
      indexExists,
      manifestExists,
    },
    modelRoute: modelRouteRuntime(config),
    commands,
  };

  if (!version.ok) {
    status.error = version.error || version.stderr || "Syntho CLI was not found. Install it from the dashboard or connect an existing CLI.";
    return status;
  }

  status.version = version.stdout.trim() || version.stderr.trim();
  if (initialized) {
    const syntoStatus = await runSyntoCommand(config, ["status", "--vault", root], { allowFailure: true, timeoutMs: STATUS_TIMEOUT_MS });
    commands.push(syntoStatus);
    status.statusText = syntoStatus.stdout.trim() || syntoStatus.stderr.trim();
    status.ok = syntoStatus.ok;
    if (!syntoStatus.ok) status.error = syntoStatus.error || syntoStatus.stderr || "Syntho responded, but status failed.";
  } else {
    status.ok = true;
    status.error = "Syntho is installed but the Synthesis folder has not been initialized yet.";
  }
  return status;
}

async function installSyntoCli(config: SyntoConfig): Promise<SyntoCommandResult> {
  if (config.installMode === "pip-user") {
    return execFileAsync("python3", ["-m", "pip", "install", "--user", "synto"], {
      timeout: LONG_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
    }).then((result): SyntoCommandResult => ({
      command: "python3 -m pip install --user synto",
      ok: true,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    })).catch((error): SyntoCommandResult => {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
      return {
        command: "python3 -m pip install --user synto",
        ok: false,
        stdout: String(err.stdout ?? ""),
        stderr: String(err.stderr ?? ""),
        exitCode: typeof err.code === "number" ? err.code : null,
        error: err.message,
      };
    });
  }

  return execFileAsync("uv", ["tool", "install", "synto"], {
    timeout: LONG_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 8,
  }).then((result): SyntoCommandResult => ({
    command: "uv tool install synto",
    ok: true,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  })).catch((error): SyntoCommandResult => {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
    return {
      command: "uv tool install synto",
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      exitCode: typeof err.code === "number" ? err.code : null,
      error: err.message,
    };
  });
}

export async function installSynto(input: SyntoInput = {}) {
  const config = normalizeSyntoConfig({ ...input.synto, enabled: true, installMode: input.synto?.installMode === "pip-user" ? "pip-user" : "uv-tool" });
  const commands: SyntoCommandResult[] = [];
  const version = await runSyntoCommand(config, ["--version"], { allowFailure: true, timeoutMs: 8_000 });
  commands.push(version);
  if (!version.ok) {
    const install = await installSyntoCli(config);
    commands.push(install);
    if (!install.ok) throw new Error(install.error || install.stderr || "Syntho install failed.");
  }
  const initResult = await initializeSynto({ ...input, synto: config });
  commands.push(...initResult.commands);
  await writeSyntoServiceNote({ ...input, synto: config, event: "install", summary: "Installed or verified Syntho and initialized the Synthesis vault." });
  invalidateStatus("synto:");
  return { status: await getSyntoStatus({ ...input, synto: config }), commands };
}

export async function connectSynto(input: SyntoInput = {}) {
  const config = normalizeSyntoConfig({ ...input.synto, enabled: true, installMode: "existing" });
  const version = await runSyntoCommand(config, ["--version"], { allowFailure: true, timeoutMs: 8_000 });
  if (!version.ok) throw new Error(version.error || "Could not run the configured Syntho CLI.");
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  await prepareSyntoModelRoute(synthesisRoot(vault, input.synthesisFolder), config, false);
  await writeSyntoServiceNote({ ...input, synto: config, event: "connect", summary: "Connected an existing Syntho CLI to HivemindOS." });
  invalidateStatus("synto:");
  return { status: await getSyntoStatus({ ...input, synto: config }), commands: [version] };
}

export async function initializeSynto(input: SyntoInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  await ensureSynthesisFolders(root);
  const init = await runSyntoCommand(config, ["init", root, "--existing", "--non-interactive"], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  if (init.ok) {
    await patchSourceAccessMode(root, config.sourceAccessMode);
    await prepareSyntoModelRoute(root, config, false);
  }
  await writeSyntoServiceNote({ ...input, synto: config, event: "init", summary: "Initialized the Syntho Synthesis vault." });
  invalidateStatus("synto:");
  return { status: await getSyntoStatus({ ...input, synto: config }), commands: [init] };
}

export async function runSyntoPipeline(input: SyntoInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const runtime = await prepareSyntoModelRoute(root, config);
  const args = ["run", "--vault", root];
  args.push("--fast-model", runtime.route.model, "--heavy-model", runtime.route.model, "--provider", runtime.route.provider, "--provider-url", runtime.route.providerUrl);
  if (config.autoApprove) {
    args.push("--auto-approve", "--min-confidence", String(config.minConfidence));
  }
  const command = await runSyntoCommand(config, args, { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS, env: runtime.env });
  await writeSyntoServiceNote({ ...input, synto: config, event: "run", summary: "Ran the Syntho ingest and compile pipeline from HivemindOS." });
  invalidateStatus("synto:");
  return { status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export async function maintainSynto(input: SyntoInput & { fix?: boolean } = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const args = ["maintain", "--vault", root, input.fix ? "--fix" : "--dry-run"];
  const command = await runSyntoCommand(config, args, { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  await writeSyntoServiceNote({ ...input, synto: config, event: "maintain", summary: `Ran Syntho maintenance${input.fix ? " with fixes" : " as a dry run"}.` });
  invalidateStatus("synto:");
  return { output: command.stdout.trim() || command.stderr.trim(), status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export async function compareSynto(input: SyntoInput & { heavyModel?: string; fastModel?: string; provider?: string; providerUrl?: string; allowCloudUpload?: boolean; sampleN?: number } = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const runtime = await prepareSyntoModelRoute(root, config);
  const heavyModel = input.heavyModel?.trim() || config.compareHeavyModel.trim();
  const args = ["compare", "--vault", root, "--format", "both"];
  if (heavyModel) args.push("--heavy-model", heavyModel);
  if (input.fastModel?.trim()) args.push("--fast-model", input.fastModel.trim());
  if (input.provider?.trim()) args.push("--provider", input.provider.trim());
  if (input.providerUrl?.trim()) args.push("--provider-url", input.providerUrl.trim());
  if (!input.provider?.trim()) args.push("--provider", runtime.route.provider);
  if (!input.providerUrl?.trim()) args.push("--provider-url", runtime.route.providerUrl);
  if (input.allowCloudUpload) args.push("--allow-cloud-upload");
  if (Number.isFinite(input.sampleN) && input.sampleN && input.sampleN > 0) args.push("--sample-n", String(Math.floor(input.sampleN)));
  const command = await runSyntoCommand(config, args, { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS, env: runtime.env });
  await writeSyntoServiceNote({ ...input, synto: config, event: "compare", summary: `Compared Syntho model output against ${heavyModel || "a challenger model"}.` });
  invalidateStatus("synto:");
  return { output: command.stdout.trim() || command.stderr.trim(), status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export async function evaluateSynto(input: SyntoInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const command = await runSyntoCommand(config, ["eval", "--json", "--vault", root], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  await writeSyntoServiceNote({ ...input, synto: config, event: "eval", summary: "Ran Syntho offline structural evaluation." });
  invalidateStatus("synto:");
  return { output: command.stdout.trim() || command.stderr.trim(), status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export async function doctorSynto(input: SyntoInput & { backlog?: boolean } = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const runtime = await prepareSyntoModelRoute(root, config);
  const args = ["doctor", "--vault", root];
  if (input.backlog !== false) args.push("--backlog");
  const command = await runSyntoCommand(config, args, { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS, env: runtime.env });
  await writeSyntoServiceNote({ ...input, synto: config, event: "doctor", summary: "Ran Syntho doctor diagnostics." });
  invalidateStatus("synto:");
  return { output: command.stdout.trim() || command.stderr.trim(), status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export async function exportSyntoPack(input: SyntoInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const root = synthesisRoot(vault, input.synthesisFolder);
  const out = join(root, "pack");
  await mkdir(out, { recursive: true });
  const command = await runSyntoCommand(config, ["pack", "export", "--target", "agents", "--out", out, "--vault", root], { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS });
  await writeSyntoServiceNote({ ...input, synto: config, event: "pack", summary: "Exported the Syntho agent pack into Synthesis/pack." });
  invalidateStatus("synto:");
  return { output: command.stdout.trim() || command.stderr.trim(), status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export async function querySynto(input: SyntoInput & { query?: string; synthesize?: boolean; save?: boolean }) {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const config = normalizeSyntoConfig(input.synto);
  const query = input.query?.trim();
  if (!query) throw new Error("Enter a Syntho query first.");
  const root = synthesisRoot(vault, input.synthesisFolder);
  const runtime = await prepareSyntoModelRoute(root, config);
  const args = ["query", "--vault", root];
  if (input.save) args.push("--save");
  if (input.synthesize) args.push("--synthesize");
  args.push(query);
  const command = await runSyntoCommand(config, args, { allowFailure: true, timeoutMs: LONG_TIMEOUT_MS, env: runtime.env });
  await writeSyntoServiceNote({ ...input, synto: config, event: "query", summary: "Ran a Syntho routed wiki query from the dashboard." });
  invalidateStatus("synto:");
  return { output: command.stdout.trim() || command.stderr.trim(), status: await getSyntoStatus({ ...input, synto: config }), commands: [command] };
}

export function syntoCommandCatalog() {
  return SYNTO_COMMANDS;
}
