import { execFile, type ExecFileOptions } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import { promisify } from "node:util";
import {
  VEIL_CASH_CLI,
  VEIL_CASH_MCP_CLI,
  VEIL_CASH_MCP_MIN_VERSION,
  VEIL_CASH_MCP_PACKAGE,
  VEIL_CASH_SDK_MIN_VERSION,
  VEIL_CASH_SDK_PACKAGE,
} from "@/lib/config/veil-cash";

const execFileAsync = promisify(execFile);
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const DEFAULT_VEIL_RPC_URL = "https://base-rpc.publicnode.com";

export async function resolveVeilCliPath(): Promise<string> {
  const pathCli = await resolveFromPath();
  if (pathCli) return pathCli;
  const npmCli = await resolveFromNpmPrefix();
  return npmCli;
}

export async function installVeilCli() {
  if (await veilCliMeetsMinimumVersion()) return;
  try {
    await execFileAsync("npm", ["install", "-g", `${VEIL_CASH_SDK_PACKAGE}@${VEIL_CASH_SDK_MIN_VERSION}`], {
      timeout: 180_000,
      maxBuffer: 1_000_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "npm install failed.";
    if (/ENOENT/.test(message)) throw new Error("npm is not available on this server, so HivemindOS cannot install the Veil CLI automatically.");
    throw new Error(redactSecrets(message));
  }
  if (await resolveVeilCliPath()) return;
  throw new Error(`Installed ${VEIL_CASH_SDK_PACKAGE}, but ${VEIL_CASH_CLI} is still not available to HivemindOS.`);
}

export async function resolveVeilMcpPath(): Promise<string> {
  const pathMcp = await resolveCommandFromPath(VEIL_CASH_MCP_CLI);
  if (pathMcp) return pathMcp;
  return resolveCommandFromNpmPrefix(VEIL_CASH_MCP_CLI);
}

export async function readVeilMcpVersion() {
  return readGlobalPackageVersion(VEIL_CASH_MCP_PACKAGE);
}

export async function veilMcpMeetsMinimumVersion() {
  const mcpPath = await resolveVeilMcpPath();
  if (!mcpPath) return false;
  const version = await readVeilMcpVersion();
  return compareSemver(version, VEIL_CASH_MCP_MIN_VERSION) >= 0;
}

export async function installVeilMcp() {
  if (await veilMcpMeetsMinimumVersion()) return;
  try {
    await execFileAsync("npm", ["install", "-g", `${VEIL_CASH_MCP_PACKAGE}@${VEIL_CASH_MCP_MIN_VERSION}`], {
      timeout: 240_000,
      maxBuffer: 1_000_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "npm install failed.";
    if (/ENOENT/.test(message)) throw new Error("npm is not available on this server, so HivemindOS cannot install the Veil MCP automatically.");
    throw new Error(redactSecrets(message));
  }
  if (await resolveVeilMcpPath()) return;
  throw new Error(`Installed ${VEIL_CASH_MCP_PACKAGE}, but ${VEIL_CASH_MCP_CLI} is still not available to HivemindOS.`);
}

export async function runVeilCli(args: string[], options: ExecFileOptions = {}) {
  const cliPath = await resolveVeilCliPath();
  if (!cliPath) throw new Error("VEIL_CLI_MISSING");
  const { env: optionEnv, ...restOptions } = options;
  const cwd = restOptions.cwd ?? await resolveVeilCliCwd(cliPath);
  return execFileAsync(cliPath, args, {
    ...restOptions,
    cwd,
    env: sanitizeProcessEnv({
      ...await veilCliEnv(),
      ...optionEnv,
    }),
  });
}

export async function veilEnvValue(key: "VEIL_KEY" | "DEPOSIT_KEY" | "RPC_URL"): Promise<string> {
  const liveValue = process.env[key]?.trim();
  if (liveValue) return liveValue;
  const savedEnv = await readHiveEnv();
  return savedEnv[key]?.trim() ?? "";
}

export function parseVeilCliJson(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  if (!text) throw new Error("Veil CLI returned no output.");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error("Veil CLI returned non-JSON output.");
  }
}

export function redactSecrets(value: string) {
  return value.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}

async function resolveFromPath() {
  return resolveCommandFromPath(VEIL_CASH_CLI);
}

async function resolveCommandFromPath(command: string) {
  try {
    const { stdout } = await execFileAsync("which", [command], { timeout: 5_000, maxBuffer: 100_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function resolveFromNpmPrefix() {
  return resolveCommandFromNpmPrefix(VEIL_CASH_CLI);
}

async function resolveCommandFromNpmPrefix(command: string) {
  try {
    const { stdout } = await execFileAsync("npm", ["prefix", "-g"], { timeout: 10_000, maxBuffer: 100_000 });
    const candidate = join(stdout.trim(), "bin", command);
    await access(candidate);
    return candidate;
  } catch {
    return "";
  }
}

async function veilCliMeetsMinimumVersion() {
  const cliPath = await resolveVeilCliPath();
  if (!cliPath) return false;
  const version = await readVeilCliVersion(cliPath);
  return compareSemver(version, VEIL_CASH_SDK_MIN_VERSION) >= 0;
}

async function readVeilCliVersion(cliPath: string) {
  try {
    const { stdout } = await execFileAsync(cliPath, ["--version"], { timeout: 10_000, maxBuffer: 100_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readGlobalPackageVersion(packageName: string) {
  try {
    const { stdout } = await execFileAsync("npm", ["root", "-g"], { timeout: 10_000, maxBuffer: 100_000 });
    const packagePath = packageName.startsWith("@")
      ? join(stdout.trim(), ...packageName.split("/"), "package.json")
      : join(stdout.trim(), packageName, "package.json");
    const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { version?: string };
    return manifest.version ?? "";
  } catch {
    return "";
  }
}

function compareSemver(actual: string, required: string) {
  const actualParts = parseSemver(actual);
  const requiredParts = parseSemver(required);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > requiredParts[index]) return 1;
    if (actualParts[index] < requiredParts[index]) return -1;
  }
  return 0;
}

function parseSemver(value: string) {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return [
    Number(match?.[1] ?? 0),
    Number(match?.[2] ?? 0),
    Number(match?.[3] ?? 0),
  ] as const;
}

async function resolveVeilCliCwd(cliPath: string) {
  try {
    const root = await findDirectoryWithVeilKeys(dirname(await realpath(cliPath)));
    if (root) return root;
  } catch {
  }
  try {
    const { stdout } = await execFileAsync("npm", ["root", "-g"], { timeout: 10_000, maxBuffer: 100_000 });
    const root = join(stdout.trim(), "@veil-cash", "sdk");
    await access(join(root, "keys", "transaction2.wasm"));
    return root;
  } catch {
    return undefined;
  }
}

async function findDirectoryWithVeilKeys(start: string) {
  let current = start;
  const root = parse(start).root;
  while (current && current !== root) {
    try {
      await access(join(current, "keys", "transaction2.wasm"));
      await access(join(current, "keys", "transaction2.zkey"));
      return current;
    } catch {
      current = dirname(current);
    }
  }
  return "";
}

async function veilCliEnv(): Promise<NodeJS.ProcessEnv> {
  const savedEnv = await readHiveEnv();
  return {
    ...savedEnv,
    ...process.env,
    VEIL_KEY: process.env.VEIL_KEY?.trim() || savedEnv.VEIL_KEY,
    DEPOSIT_KEY: process.env.DEPOSIT_KEY?.trim() || savedEnv.DEPOSIT_KEY,
    RPC_URL: process.env.RPC_URL?.trim() || savedEnv.RPC_URL || DEFAULT_VEIL_RPC_URL,
  };
}

async function readHiveEnv(): Promise<Record<string, string>> {
  const text = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = parseEnvValue(line.slice(separator + 1).trim());
  }
  return env;
}

function parseEnvValue(value: string) {
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function sanitizeProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    sanitized[key] = value.replace(/\0/g, "");
  }
  return sanitized as NodeJS.ProcessEnv;
}
