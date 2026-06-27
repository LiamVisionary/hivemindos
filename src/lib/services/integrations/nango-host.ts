import { spawn } from "child_process";
import { constants, existsSync, statSync } from "fs";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join, relative, sep } from "path";
import { checkNangoHealth, listNangoConnections, normalizeNangoHost } from "@/lib/services/integrations/nango-client";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import type { NangoHostConfig, NangoHostSetupResult, NangoIntegrationPayload, NangoProviderKey } from "@/lib/types/integrations";

const CONFIG_PATH = "HivemindOS/Integrations/nango-host.json";
const DEFAULT_ALLOWED_PROVIDERS: NangoProviderKey[] = ["github", "linear", "slack", "notion", "google"];

type Storage = {
  vaultRoot: string;
  file: string;
};

type UpdateNangoHostInput = {
  enabled?: boolean;
  hostMachineId?: string;
  hostMachineName?: string;
  baseUrl?: string;
  mode?: NangoHostConfig["mode"];
  allowedProviders?: NangoProviderKey[];
};

type SetupNangoHostInput = UpdateNangoHostInput & {
  collectorUrl?: string;
  target?: string;
};

export function defaultNangoHostConfig(): NangoHostConfig {
  const baseUrl = process.env.NANGO_BASE_URL || process.env.NANGO_HOST || "http://localhost:3003";
  return {
    version: 1,
    enabled: process.env.HIVE_NANGO_ENABLED === "true" || Boolean(process.env.NANGO_BASE_URL),
    hostMachineId: process.env.HIVE_NANGO_HOST_MACHINE ?? "",
    hostMachineName: process.env.HIVE_NANGO_HOST_MACHINE ?? "",
    baseUrl: normalizeNangoHost(baseUrl),
    mode: baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") ? "local" : "tailnet",
    allowedProviders: DEFAULT_ALLOWED_PROVIDERS,
    updatedAt: new Date().toISOString(),
  };
}

export async function readNangoIntegrationPayload(): Promise<NangoIntegrationPayload> {
  const storage = await resolveStorage();
  const config = await readNangoHostConfig(storage);
  const health = await checkNangoHealth(config.baseUrl);
  let connections: NangoIntegrationPayload["connections"] = [];
  let connectionError: string | undefined;
  try {
    connections = await listNangoConnections({
      baseUrl: config.baseUrl,
      secretKey: process.env.NANGO_SECRET_KEY,
    });
  } catch (error) {
    connectionError = error instanceof Error ? error.message : "Could not list Nango connections.";
  }

  return {
    ok: true,
    config,
    storagePath: relative(storage.vaultRoot, storage.file).split(sep).join("/"),
    env: {
      enabled: process.env.HIVE_NANGO_ENABLED === "true",
      baseUrl: process.env.NANGO_BASE_URL ?? "",
      hostMachineId: process.env.HIVE_NANGO_HOST_MACHINE ?? "",
      secretConfigured: Boolean(process.env.NANGO_SECRET_KEY?.trim()),
    },
    health,
    connections,
    connectionError,
    setupCommands: setupCommands(config),
  };
}

export async function updateNangoHostConfig(input: UpdateNangoHostInput): Promise<NangoIntegrationPayload> {
  const storage = await resolveStorage();
  const current = await readNangoHostConfig(storage);
  const next: NangoHostConfig = {
    ...current,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    hostMachineId: input.hostMachineId?.trim() ?? current.hostMachineId,
    hostMachineName: input.hostMachineName?.trim() ?? current.hostMachineName,
    baseUrl: normalizeNangoHost(input.baseUrl ?? current.baseUrl),
    mode: input.mode === "local" || input.mode === "cloud" || input.mode === "tailnet" ? input.mode : current.mode,
    allowedProviders: normalizeProviders(input.allowedProviders) ?? current.allowedProviders,
    updatedAt: new Date().toISOString(),
  };
  await writeConfig(storage.file, next);
  return readNangoIntegrationPayload();
}

export async function setupNangoHost(input: SetupNangoHostInput = {}): Promise<NangoHostSetupResult> {
  const storage = await resolveStorage();
  const config = normalizeConfig({ ...(await readNangoHostConfig(storage)), ...input });
  await writeConfig(storage.file, config);
  if (input.collectorUrl?.trim() && config.mode !== "local") {
    const result = await setupNangoHostViaCollector(input.collectorUrl, config);
    if (result.ok && result.baseUrl !== config.baseUrl) {
      await writeConfig(storage.file, {
        ...config,
        baseUrl: result.baseUrl,
        updatedAt: new Date().toISOString(),
      });
    }
    return result;
  }
  const target = setupTarget(config, input.target);
  const script = nangoSetupScript(config);
  const result = await runSetupTarget(target, script, config.mode === "local");
  const health = await waitForNangoHealth(config.baseUrl);
  return {
    ok: health.ok,
    method: result.method,
    target: result.target,
    baseUrl: config.baseUrl,
    stdout: sanitizeSetupOutput(result.stdout),
    stderr: sanitizeSetupOutput(result.stderr),
    health,
    command: script,
  };
}

async function setupNangoHostViaCollector(collectorUrl: string, config: NangoHostConfig): Promise<NangoHostSetupResult> {
  const base = collectorUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/integrations/nango/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: config.baseUrl }),
    signal: AbortSignal.timeout(360_000),
    cache: "no-store",
  }).catch((error) => {
    throw new Error(`Remote agent bridge is not reachable: ${error instanceof Error ? error.message : String(error)}`);
  });
  const payload = await response.json().catch(() => null) as (NangoHostSetupResult & { error?: string }) | null;
  if (response.status === 404) {
    throw new Error("That machine is reachable through the HivemindOS agent bridge, but the agent bridge does not have the Nango setup endpoint yet. Run the machine update once from Fleet, then try setup again.");
  }
  if (payload?.ok === false && payload.health?.error && isConnectionRefused(payload.health.error)) {
    const proxyBaseUrl = collectorProxyNangoBaseUrl(base, config.baseUrl);
    const proxyHealth = await checkNangoHealth(proxyBaseUrl);
    if (proxyHealth.ok) {
      return normalizeCollectorSetupResult({
        ...payload,
        ok: true,
        baseUrl: proxyBaseUrl,
        health: proxyHealth,
        stderr: [
          payload.stderr,
          "Nango is running through the HivemindOS app proxy. Direct Tailnet port access is not open on this host.",
        ].filter(Boolean).join("\n\n"),
      }, base);
    }
  }
  if (payload?.ok === false && payload.health) {
    return normalizeCollectorSetupResult(payload, base);
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? setupPayloadError(payload) ?? `Remote agent bridge returned HTTP ${response.status}.`);
  }
  if (!payload) throw new Error("Remote agent bridge returned an empty setup response.");
  return normalizeCollectorSetupResult(payload, base);
}

function normalizeCollectorSetupResult(payload: NangoHostSetupResult, collectorUrl: string): NangoHostSetupResult {
  return {
    ...payload,
    method: "collector-api",
    target: payload.target || new URL(collectorUrl).hostname,
    stdout: payload.stdout || "",
    stderr: payload.stderr || "",
    command: payload.command || "",
  };
}

function setupPayloadError(payload: (Partial<NangoHostSetupResult> & { error?: string }) | null) {
  if (!payload) return undefined;
  if (payload.health?.error) return payload.health.error;
  if (payload.health?.status) return `Nango health check returned HTTP ${payload.health.status}.`;
  const stderr = payload.stderr?.trim();
  if (stderr) return stderr.slice(-1200);
  const stdout = payload.stdout?.trim();
  if (stdout) return stdout.slice(-1200);
  return undefined;
}

function isConnectionRefused(message: string) {
  return /fetch failed|ECONNREFUSED|connection refused|couldn't connect/i.test(message);
}

function collectorProxyNangoBaseUrl(collectorUrl: string, baseUrl: string) {
  const port = new URL(normalizeNangoHost(baseUrl)).port || "3003";
  return normalizeNangoHost(`${collectorUrl.replace(/\/+$/, "")}/app-proxy/${port}`);
}

async function resolveStorage(): Promise<Storage> {
  const vaultRoot = resolveObsidianVaultPath(undefined, { requireWritable: true });
  if (!statSync(vaultRoot).isDirectory()) throw new Error("Vault path is not a directory.");
  await access(vaultRoot, constants.R_OK | constants.W_OK);
  return {
    vaultRoot,
    file: join(vaultRoot, CONFIG_PATH),
  };
}

async function readNangoHostConfig(storage: Storage) {
  if (!existsSync(storage.file)) return defaultNangoHostConfig();
  try {
    return normalizeConfig(JSON.parse(await readFile(storage.file, "utf-8")) as Partial<NangoHostConfig>);
  } catch {
    return defaultNangoHostConfig();
  }
}

function normalizeConfig(input: Partial<NangoHostConfig>): NangoHostConfig {
  const fallback = defaultNangoHostConfig();
  return {
    version: 1,
    enabled: typeof input.enabled === "boolean" ? input.enabled : fallback.enabled,
    hostMachineId: typeof input.hostMachineId === "string" ? input.hostMachineId : fallback.hostMachineId,
    hostMachineName: typeof input.hostMachineName === "string" ? input.hostMachineName : fallback.hostMachineName,
    baseUrl: normalizeNangoHost(input.baseUrl ?? fallback.baseUrl),
    mode: input.mode === "local" || input.mode === "cloud" || input.mode === "tailnet" ? input.mode : fallback.mode,
    allowedProviders: normalizeProviders(input.allowedProviders) ?? fallback.allowedProviders,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : fallback.updatedAt,
  };
}

function normalizeProviders(input?: unknown) {
  if (!Array.isArray(input)) return undefined;
  const allowed = new Set(DEFAULT_ALLOWED_PROVIDERS);
  const providers = input.filter((value): value is NangoProviderKey => (
    typeof value === "string" && allowed.has(value as NangoProviderKey)
  ));
  return providers.length ? [...new Set(providers)] : undefined;
}

async function writeConfig(file: string, config: NangoHostConfig) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}

function setupCommands(config: NangoHostConfig) {
  const host = config.hostMachineName || config.hostMachineId || "integration-host";
  return [
    `ssh ${host}`,
    "git clone https://github.com/NangoHQ/nango.git ~/nango",
    "cd ~/nango && cp .env.example .env",
    "cd ~/nango && perl -0pi.bak -e 's/\\x27(?:\\$\\{NANGO_DB_PORT:-\\d+\\}|\\d+):5432\\x27/\\x2715432:5432\\x27/g; s/\\x27[^\\x27]*:6379\\x27/\\x2716379:6379\\x27/g' docker-compose.yaml",
    `printf 'NANGO_SERVER_URL=${config.baseUrl}\\nSERVER_PORT=3003\\n' >> .env`,
    "cd ~/nango && docker compose down --remove-orphans",
    "cd ~/nango && docker compose up -d",
  ];
}

function setupTarget(config: NangoHostConfig, explicitTarget?: string) {
  const explicit = explicitTarget?.trim();
  if (explicit) return explicit;
  if (config.mode === "local") return "local";
  try {
    return new URL(config.baseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return config.hostMachineName || config.hostMachineId;
  }
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nangoSetupScript(config: NangoHostConfig) {
  const baseUrl = normalizeNangoHost(config.baseUrl);
  return [
    "set -euo pipefail",
    "log() { printf '\\n[%s] %s\\n' \"$(date -u +%H:%M:%S)\" \"$*\"; }",
    "run_as_root() { if [ \"$(id -u)\" = \"0\" ]; then \"$@\"; elif command -v sudo >/dev/null 2>&1; then sudo \"$@\"; else echo 'This setup needs root or passwordless sudo to install packages.' >&2; exit 10; fi; }",
    "log 'Checking system packages'",
    "if ! command -v git >/dev/null 2>&1; then",
    "  command -v apt-get >/dev/null 2>&1 || { echo 'git is missing and apt-get is unavailable.' >&2; exit 11; }",
    "  run_as_root apt-get update",
    "  run_as_root apt-get install -y git",
    "fi",
    "if ! command -v docker >/dev/null 2>&1; then",
    "  command -v apt-get >/dev/null 2>&1 || { echo 'docker is missing and apt-get is unavailable.' >&2; exit 12; }",
    "  run_as_root apt-get update",
    "  run_as_root apt-get install -y docker.io docker-compose-plugin",
    "  run_as_root systemctl enable --now docker >/dev/null 2>&1 || true",
    "fi",
    "DOCKER='docker'",
    "if ! docker ps >/dev/null 2>&1; then",
    "  if command -v sudo >/dev/null 2>&1 && sudo docker ps >/dev/null 2>&1; then DOCKER='sudo docker'; else echo 'Docker is installed, but this SSH user cannot run docker.' >&2; exit 13; fi",
    "fi",
    "NANGO_DIR=\"${NANGO_DIR:-$HOME/nango}\"",
    "log \"Preparing Nango checkout at $NANGO_DIR\"",
    "if [ ! -d \"$NANGO_DIR/.git\" ]; then",
    "  rm -rf \"$NANGO_DIR\"",
    "  git clone https://github.com/NangoHQ/nango.git \"$NANGO_DIR\"",
    "else",
    "  # Prior runs edit the tracked docker-compose.yaml in place (perl below), so a plain",
    "  # git pull --ff-only would refuse on the dirty tree. Restore tracked files and clear",
    "  # the .bak first, then fast-forward; if history diverged, reset to the upstream ref.",
    "  git -C \"$NANGO_DIR\" checkout -- docker-compose.yaml >/dev/null 2>&1 || true",
    "  rm -f \"$NANGO_DIR/docker-compose.yaml.bak\"",
    "  if ! git -C \"$NANGO_DIR\" pull --ff-only; then",
    "    log 'Fast-forward not possible; resetting Nango checkout to upstream'",
    "    git -C \"$NANGO_DIR\" reset --hard '@{u}'",
    "  fi",
    "fi",
    "cd \"$NANGO_DIR\"",
    "if [ ! -f .env ]; then cp .env.example .env; fi",
    "if [ -f docker-compose.yaml ]; then",
    "  perl -0pi.bak -e 's/\\x27(?:\\$\\{NANGO_DB_PORT:-\\d+\\}|\\d+):5432\\x27/\\x2715432:5432\\x27/g; s/\\x27[^\\x27]*:6379\\x27/\\x2716379:6379\\x27/g' docker-compose.yaml",
    "fi",
    "set_env() {",
    "  key=\"$1\"",
    "  value=\"$2\"",
    "  if grep -q \"^${key}=\" .env; then",
    "    tmp=\"$(mktemp)\"",
    "    awk -v key=\"$key\" -v value=\"$value\" 'BEGIN{line=key \"=\" value} $0 ~ \"^\" key \"=\" {print line; next} {print}' .env > \"$tmp\"",
    "    cat \"$tmp\" > .env",
    "    rm -f \"$tmp\"",
    "  else",
    "    printf '%s=%s\\n' \"$key\" \"$value\" >> .env",
    "  fi",
    "}",
    "remove_env() {",
    "  key=\"$1\"",
    "  if grep -q \"^${key}=\" .env; then",
    "    tmp=\"$(mktemp)\"",
    "    awk -v key=\"$key\" '$0 !~ \"^\" key \"=\" {print}' .env > \"$tmp\"",
    "    cat \"$tmp\" > .env",
    "    rm -f \"$tmp\"",
    "  fi",
    "}",
    `set_env NANGO_SERVER_URL ${shellSingleQuote(baseUrl)}`,
    `set_env SERVER_PORT ${shellSingleQuote(new URL(baseUrl).port || "3003")}`,
    "remove_env NANGO_DB_PORT",
    "remove_env NANGO_REDIS_PORT",
    "log 'Starting Nango containers'",
    "$DOCKER compose down --remove-orphans >/dev/null 2>&1 || true",
    "$DOCKER compose up -d",
    "log 'Nango setup command finished'",
  ].join("\n");
}

function runProcess(command: string, args: string[], stdin: string | null, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n\n");
      reject(new Error(`${command} exited with code ${code}${detail ? `:\n${detail}` : ""}`));
    });
    child.stdin.end(stdin ?? "");
  });
}

function plainSshTargets(target: string) {
  if (target.includes("@")) return [target];
  return [target, `ubuntu@${target}`, `root@${target}`];
}

async function runSetupTarget(target: string, script: string, local: boolean) {
  if (local || target === "local") {
    const result = await runProcess("bash", ["-s"], script, 360_000);
    return { ...result, method: "local-shell" as const, target: "this machine" };
  }

  try {
    const result = await runProcess("tailscale", ["ssh", target, "bash", "-s"], script, 360_000);
    return { ...result, method: "tailscale-ssh" as const, target };
  } catch (tailscaleError) {
    const tailscaleMessage = tailscaleError instanceof Error ? tailscaleError.message : String(tailscaleError);
    const errors: string[] = [];
    for (const sshTarget of plainSshTargets(target)) {
      try {
        const result = await runProcess("ssh", [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "StrictHostKeyChecking=accept-new",
          sshTarget,
          "bash",
          "-s",
        ], script, 360_000);
        return {
          ...result,
          method: "plain-ssh" as const,
          target: sshTarget,
          stderr: [`Tailscale SSH failed, plain SSH succeeded. Tailscale error:\n${tailscaleMessage}`, result.stderr.trim()].filter(Boolean).join("\n\n"),
        };
      } catch (error) {
        errors.push(`${sshTarget}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error([
      `Tailscale SSH failed:\n${tailscaleMessage}`,
      `Plain SSH failed:\n${errors.join("\n\n")}`,
    ].join("\n\n"));
  }
}

async function waitForNangoHealth(baseUrl: string) {
  let health = await checkNangoHealth(baseUrl);
  if (health.ok) return health;
  for (const delay of [2_000, 4_000, 8_000, 12_000, 20_000, 30_000]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    health = await checkNangoHealth(baseUrl);
    if (health.ok) return health;
  }
  return health;
}

function sanitizeSetupOutput(output: string) {
  return output
    .replace(/(NANGO_SECRET_KEY=)[^\s]+/g, "$1<redacted>")
    .replace(/(NANGO_ENCRYPTION_KEY=)[^\s]+/g, "$1<redacted>")
    .slice(-20_000);
}
