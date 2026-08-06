#!/usr/bin/env node
import { createServer, request as httpRequest } from "node:http";
import { execFile, spawn } from "node:child_process";
import {
  constants as cryptoConstants,
  createDecipheriv,
  createHash,
  createSecretKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, readFileSync, watch } from "node:fs";
import { connect } from "node:net";
import {
  arch,
  cpus,
  freemem,
  homedir,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime as osUptime,
  userInfo,
} from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  acknowledgeTransfer,
  createTransfer,
  listTransfers,
} from "./hive-transfer.mjs";
import { agentDid, signWorkReceipt } from "./agent-identity.mjs";
import { createConfigureSyncthingFolder } from "./syncthing-configure.mjs";
import { createSyncthingRepair } from "./syncthing-repair.mjs";
import {
  portableStateManifest,
  portableStateRuntimes,
  packPortableState,
  importPortableTar,
  backupPortableState,
  restorePortableState,
  listBackups,
  reconcilePortableState,
  unpackTarToDir,
} from "./lib/runtime-portable-state.mjs";
import { createHostedAppsCache } from "./lib/hosted-apps-cache.mjs";
import { APP_BUILDER_CONTRACT_VERSION, runLocalAppBuilderAction } from "./lib/app-builder.mjs";
import { reconcileAppBuilderRuntimesAtBoot } from "./lib/app-builder-boot-reconcile.mjs";
import { createAsyncTtlCache } from "./lib/async-ttl-cache.mjs";
import { createCollectorMaintenance } from "./lib/collector-maintenance.mjs";
import { collectorUpdateCommand } from "./lib/collector-update-command.mjs";
import { readCollectorAppVersion } from "./lib/collector-source-version.mjs";
import { startSelfReloadWatcher } from "./lib/collector-self-reload.mjs";
import { resolveHiveEnvAddCommand } from "./lib/hive-env-add-command.mjs";
import { launchCollectorUpdate } from "./lib/collector-update-launcher.mjs";
import {
  recordCollectorTelemetry,
  safeTelemetryText,
  summarizeHermesDbSessionTimeline,
  summarizeHermesProcessPayload,
} from "./lib/hermes-api-proxy-telemetry.mjs";
import { createHermesCliStreamProtocol } from "./lib/hermes-cli-stream-protocol.mjs";
import {
  hermesApiMessages,
  hermesApiSelectionMatchesAgent,
  hermesApiSessionHeaders,
  hermesSessionIdFromResponse,
} from "./lib/hermes-api-request-routing.mjs";
import { discoverLocalOpenAiServers } from "./lib/local-openai-server-discovery.mjs";
import { createCollectorMessagingChannelBridge } from "./lib/collector-messaging-channels.mjs";
import {
  hermesProfileName,
  readHermesModelSelection,
  setHermesModelAssignment,
} from "./lib/hermes-model-settings.mjs";
import {
  hermesAgentUsesCodex,
  repairHermesCodexAuth,
} from "./lib/hermes-codex-auth-recovery.mjs";
import { resolvePreferredOpenAiAgentSelection } from "./lib/openai-provider-routing.mjs";
import { mapWithConcurrency, processResourceStats } from "./lib/fd-safety.mjs";
import { readCodexRuntimeIntegrationStatus } from "./lib/codex-app-server-models.mjs";
// systemStats also accumulates a short rolling cpu/ram/net history (while /health
// is actively polled) so the dashboard Telemetry sparklines show a real trend.
import { systemStats } from "./lib/system-stats.mjs";
import { tailnetSelfNode, tailnetSelfOwner, tailscaleStatusJson } from "./lib/tailnet-self.mjs";
import {
  createSyncthingApiKeyResolver,
  defaultSyncthingConfigCandidates,
} from "./lib/syncthing-api-key.mjs";
import { isMacosProtectedAppDataPath } from "./lib/macos-privacy-paths.mjs";
import {
  FleetMachinePolicyError,
  claimFleetPolicyMaster,
  effectiveFleetAccess,
  fleetMachinePolicyFailureSummary,
  fleetMachinePolicyHealthSummary,
  fleetMachinePolicyPrompt,
  fleetMachinePolicyPublicView,
  fleetPolicyNeedsIsolatedHermes,
  readFleetMachinePolicy,
  releaseFleetPolicyMaster,
  resolveFleetAccessRequest,
  updateFleetMachinePolicy,
} from "./lib/fleet-machine-policy.mjs";
import { fleetPolicySpawnEnv, prepareFleetSharedEnvChat } from "./lib/fleet-shared-env-access.mjs";
// NOTE: bonjour-service is imported LAZILY inside advertiseHubMdns() (its only use),
// not at top level. A -SkipDeps app-driven collector install (Windows) has no
// node_modules, and a failed top-level import would crash the whole collector at
// startup — so /health never comes up and the setup wizard hangs waiting for it.

// Last-resort process guards. In the 2026-07-03 NYC incident a spawn EBADF
// thrown inside the /health exec path became an unhandled rejection that
// killed the daemon, and every fleet watchdog probe re-triggered it after
// relaunch — a crash loop that lasted hours. This daemon is fleet-critical:
// log the failure loudly (stack included) and keep serving.
process.on("uncaughtException", (error, origin) => {
  console.error(
    `[collector] ${origin || "uncaughtException"} (kept alive):`,
    error?.stack || error,
  );
});
process.on("unhandledRejection", (reason) => {
  console.error(
    "[collector] unhandledRejection (kept alive):",
    reason instanceof Error ? reason.stack : reason,
  );
});

const execFileAsync = promisify(execFile);
const collectorOnly = /^(1|true|yes)$/i.test(
  process.env.HIVE_COLLECTOR_ONLY || "",
);
const port = Number(process.env.AGENT_TELEMETRY_PORT || 8787);
const host = process.env.AGENT_TELEMETRY_HOST || "0.0.0.0";
const collectorSourcePath = fileURLToPath(import.meta.url);
const appDir = resolve(join(collectorSourcePath, "..", ".."));
const hermesHivemindStreamBridge = join(appDir, "scripts", "hermes-hivemind-stream.py");
const collectorStartedAtMs = Date.now();
const collectorStartedAt = new Date(collectorStartedAtMs).toISOString();
const defaultHermesDir = process.env.HERMES_HOME || join(homedir(), ".hermes");
const hermesAgentProjectDir = join(defaultHermesDir, "hermes-agent");
const defaultOpenClawDir =
  process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
const defaultAeonDir =
  process.env.AEON_LOCAL_PATH ||
  process.env.AEON_HOME ||
  join(homedir(), ".aeon");
const maxChars = 1000;
const HERMES_EMPTY_TRANSCRIPT_MESSAGE =
  "Hermes session found. Send a message to resume it.";
const chatTimeoutMs = Number(
  process.env.AGENT_TELEMETRY_CHAT_TIMEOUT_MS || 20 * 60_000,
);
const collectorMaintenance = createCollectorMaintenance({
  reservationTtlMs: Number(
    process.env.AGENT_TELEMETRY_UPDATE_RESERVATION_TTL_MS ||
      Math.max(10 * 60_000, chatTimeoutMs + 2 * 60_000),
  ),
});
const activeCollectorChatRuns = collectorMaintenance.activeChatRuns;
const activeCollectorUpdateReservation = collectorMaintenance.activeUpdateReservation;
const beginCollectorChatRun = collectorMaintenance.beginChatRun;
const collectorMaintenanceState = collectorMaintenance.state;
const releaseCollectorUpdateReservation = collectorMaintenance.releaseUpdate;
const reserveCollectorUpdate = collectorMaintenance.reserveUpdate;
const skillInventoryCache = createAsyncTtlCache({
  ttlMs: Number(process.env.AGENT_TELEMETRY_SKILL_INVENTORY_CACHE_MS || 60_000),
  load: () => scanInstalledSkills(),
});
const sessionDiscoveryTimeoutMs = Number(
  process.env.AGENT_TELEMETRY_SESSION_DISCOVERY_TIMEOUT_MS || 15_000,
);
const hermesApiHost =
  process.env.AGENT_TELEMETRY_HERMES_API_HOST || "127.0.0.1";
const hermesApiPort = Number(
  process.env.AGENT_TELEMETRY_HERMES_API_PORT ||
    process.env.API_SERVER_PORT ||
    8642,
);
const hermesApiBaseUrl = `http://${hermesApiHost}:${hermesApiPort}`;
// The Hermes gateway's api_server (port 8642) requires a Bearer matching its
// API_SERVER_KEY on every request, even on loopback. The gateway authoritatively
// loads that key from ${HERMES_HOME:-~/.hermes}/.env at startup; this collector
// runs under launchd whose plist never sets it, so reading the same file is the
// only way to stay in sync across key rotations and plist regens. Without it the
// gateway 401s every forwarded /chat with "rejected invalid API key".
function readApiServerKeyFromHermesEnv() {
  try {
    const text = readFileSync(join(defaultHermesDir, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*API_SERVER_KEY\s*=\s*(.*)$/);
      if (!match) continue;
      let value = match[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  } catch {
    // No ~/.hermes/.env (e.g. a machine without Hermes) — fall through to "".
  }
  return "";
}
const hermesApiKey =
  process.env.AGENT_TELEMETRY_HERMES_API_KEY ||
  process.env.API_SERVER_KEY ||
  readApiServerKeyFromHermesEnv() ||
  "";
const hermesApiStartTimeoutMs = Number(
  process.env.AGENT_TELEMETRY_HERMES_API_START_TIMEOUT_MS || 15_000,
);
const hermesApiHealthTimeoutMs = Number(
  process.env.AGENT_TELEMETRY_HERMES_API_HEALTH_TIMEOUT_MS || 2_500,
);
const hermesChatMode = (
  process.env.AGENT_TELEMETRY_HERMES_CHAT_MODE || "api"
).toLowerCase();
const lmStudioLocalBase = (
  process.env.LOCAL_OPENAI_BASE_URL || "http://127.0.0.1:1234"
).replace(/\/+$/, "");
const syncthingApiBaseUrl =
  process.env.SYNCTHING_API_URL || "http://127.0.0.1:8384";
const defaultSyncPath = expandHome(
  process.env.HIVEMINDOS_SYNC_PATH ||
    process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH ||
    "~/Documents/Obsidian/hivemindos-vault",
);
const runLogRoot = join(homedir(), ".hivemindos", "runtime-runs");
const machineIdPath = join(homedir(), ".hivemindos", "machine-id");
const runtimeAgentRegistryPath = join(
  homedir(),
  ".hivemindos",
  "runtime-agents.json",
);
const tauriDevServerInfoPath = join(appDir, ".next-tauri", "dev-server.json");
const e2eFileShareRoot = join(homedir(), ".hivemindos", "e2e-file-share");
const skillAutoSyncConfigPath = join(
  homedir(),
  ".hivemindos",
  "skill-auto-sync.json",
);
const projectRegistryPaths = [
  process.env.HIVEMINDOS_PROJECT_REGISTRY_PATH,
  join(defaultSyncPath, "Operations", "Code Projects", "projects.json"),
  join(homedir(), ".hivemindos", "projects.json"),
].filter(Boolean);
const hermesProfilesDir = join(defaultHermesDir, "profiles");
const beeWorkerSoulTemplatesPath = join(
  appDir,
  "src",
  "lib",
  "config",
  "bee-worker-souls.json",
);
const skillProviderRoots = [
  {
    id: "claude",
    label: "Claude",
    home: "~/.claude",
    roots: [
      { path: "~/.claude/skills", maxDepth: 3 },
      { path: "~/.claude/plugins", maxDepth: 8 },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    home: "~/.codex",
    roots: [
      { path: "~/.codex/skills", maxDepth: 4 },
      { path: "~/.codex/plugins/cache", maxDepth: 8 },
    ],
  },
  {
    id: "hermes",
    label: "Hermes",
    home: "~/.hermes",
    roots: [
      { path: "~/.hermes/skills", maxDepth: 4 },
      { path: "~/.hermes/plugins", maxDepth: 8 },
      { path: "~/.hermes/agents", maxDepth: 6 },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    home: "~/.gemini",
    roots: [
      { path: "~/.gemini/skills", maxDepth: 4 },
      { path: "~/.gemini/extensions", maxDepth: 8 },
    ],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    home: "~/.openclaw",
    roots: [
      { path: "~/.openclaw/skills", maxDepth: 4 },
      {
        path: "~/Documents/code/projects/hivemind-os/openclaw-next/skills",
        maxDepth: 4,
      },
    ],
  },
  {
    id: "aeon",
    label: "Aeon",
    home: "~/.aeon",
    roots: [
      { path: "~/.aeon/skills", maxDepth: 4 },
      { path: "~/.aeon/plugins", maxDepth: 8 },
      { path: "~/.aeon/agents", maxDepth: 6 },
      {
        path: process.env.AEON_LOCAL_PATH
          ? `${process.env.AEON_LOCAL_PATH}/skills`
          : "~/.aeon/repo/skills",
        maxDepth: 3,
      },
    ],
  },
];

const allowCollectorAppDataReads =
  process.env.AGENT_TELEMETRY_ALLOW_APP_DATA_READS === "1";
const skippedSkillDirs = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".cache",
  ".archive",
]);
const skillSourceMetadataFile = ".hivemind-skill-source.json";
const sharedBrainMirrorStatus = "shared-brain-mirror";
const recursiveProviderMirrorStatus = "recursive-provider-mirror";
const knownProviderSlugPrefixes = new Set([
  "aeon",
  "claude",
  "codex",
  "hermes",
  "gemini",
  "openclaw",
  "shared",
  "shared-brain",
]);
const maxSkillFiles = Number(
  process.env.AGENT_TELEMETRY_MAX_SKILL_FILES || 160,
);
const maxSkillFileBytes = Number(
  process.env.AGENT_TELEMETRY_MAX_SKILL_FILE_BYTES || 5 * 1024 * 1024,
);
// Skill scans must be bounded: on the 2026-07-03 NYC box a runaway mirror left
// 28k skill dirs, and summarizing every SKILL.md via one big Promise.all pegged
// the process fd table in bursts (libuv opens queue ahead of reads/closes), so
// concurrent child spawns died with EBADF — including /health's git exec.
const skillScanConcurrency = Number(
  process.env.AGENT_TELEMETRY_SKILL_SCAN_CONCURRENCY || 16,
);
const maxSkillScanFiles = Number(
  process.env.AGENT_TELEMETRY_MAX_SKILL_SCAN_FILES || 10_000,
);
const skillScanWarnThreshold = Number(
  process.env.AGENT_TELEMETRY_SKILL_SCAN_WARN_THRESHOLD || 2_000,
);
const skillAutoSyncPollMs = Number(
  process.env.AGENT_TELEMETRY_SKILL_AUTO_SYNC_POLL_MS || 10_000,
);
const skillAutoSyncDebounceMs = Number(
  process.env.AGENT_TELEMETRY_SKILL_AUTO_SYNC_DEBOUNCE_MS || 2_500,
);
const healthCacheMs = Number(
  process.env.AGENT_TELEMETRY_HEALTH_CACHE_MS || 10_000,
);
const appVersionCacheMs = Number(
  process.env.AGENT_TELEMETRY_VERSION_CACHE_MS || 60_000,
);
const installedRuntimesCacheMs = Number(
  process.env.AGENT_TELEMETRY_RUNTIME_PROBE_CACHE_MS || 300_000,
);
// /snapshot is polled independently by the dashboard, the fleet watchdog, and
// peer collectors; each uncached hit re-scans every agent (files + sqlite + a
// ps sweep per agent). A few seconds of staleness is invisible to 30s+ pollers
// but collapses overlapping bursts into one computation.
const snapshotCacheMs = Number(
  process.env.AGENT_TELEMETRY_SNAPSHOT_CACHE_MS || 4_000,
);
const psScanCacheMs = Number(
  process.env.AGENT_TELEMETRY_PS_SCAN_CACHE_MS || 3_500,
);
const hostedAppProbeTimeoutMs = Number(
  process.env.AGENT_TELEMETRY_APP_PROBE_TIMEOUT_MS || 900,
);
const hostedAppScanTimeoutMs = Number(
  process.env.AGENT_TELEMETRY_APP_SCAN_TIMEOUT_MS || 4_000,
);
// 22000 = Syncthing BEP: a TLS-only sync protocol, never an app. Probing it
// makes syncthing journal a TLS-handshake warning pair on every sweep.
const excludedHostedAppPorts = new Set(
  String(
    process.env.AGENT_TELEMETRY_APP_EXCLUDE_PORTS ||
      `${port},22,53,631,5353,5900,22000`,
  )
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0),
);
const knownServiceSignatures = [
  {
    displayName: "MiroShark",
    serviceKind: "miroshark",
    matches: /miroshark/i,
  },
];
let hermesApiProcess = null;
let hermesApiStartPromise = null;
let skillAutoSyncConfig = null;
let skillAutoSyncPoll = null;
let skillAutoSyncDebounce = null;
let skillAutoSyncInFlight = false;
const skillAutoSyncWatchers = new Map();
const skillAutoSyncSignatures = new Map();
let machineIdPromise = null;
let healthPayloadCache = null;
let healthPayloadPromise = null;
let snapshotAllCache = null;
let snapshotAllPromise = null;
let psScanCache = null;
let psScanPromise = null;
let appVersionCache = null;
let appVersionPromise = null;
let installedRuntimesCache = null;
let installedRuntimesPromise = null;
const hostedAppAssetUrls = new Map();
const slashCommandCatalogCache = new Map();
const slashCommandCatalogCacheMs = Number(
  process.env.AGENT_TELEMETRY_SLASH_COMMAND_CACHE_MS || 60_000,
);

const HERMES_SLASH_COMMAND_CATALOG_SCRIPT = String.raw`
import json
from hermes_cli.commands import COMMAND_REGISTRY, _is_gateway_available, _iter_plugin_command_entries, _resolve_config_gates

commands = []
seen = set()
overrides = _resolve_config_gates()

def add(name, description, category, args_hint=None, aliases=None):
    clean = str(name or "").strip().lstrip("/")
    if not clean or clean in seen:
        return
    seen.add(clean)
    commands.append({
        "name": clean,
        "description": str(description or f"Run /{clean}"),
        "category": str(category or "Other"),
        "argsHint": str(args_hint).strip() if args_hint else None,
        "aliases": [str(alias) for alias in (aliases or []) if str(alias).strip()],
    })

for command in COMMAND_REGISTRY:
    if _is_gateway_available(command, overrides):
        add(command.name, command.description, command.category, command.args_hint, command.aliases)

for name, description, args_hint in _iter_plugin_command_entries():
    add(name, description, "Plugins", args_hint)

try:
    from agent.skill_commands import scan_skill_commands
    for slash_name, info in sorted(scan_skill_commands().items()):
        add(slash_name, info.get("description", "Hermes skill"), "Skills")
except Exception:
    pass

print(json.dumps({"commands": commands}))
`;

function expandHome(path) {
  return path?.replace(/^~(?=$|\/)/, homedir());
}

// Demo/capture fixtures (remotion capture-real-ux.mjs) seed agent profiles
// with localDataDir "/capture/<id>" alongside *.capture.invalid telemetry
// hosts. The filesystem root is unwritable, so letting that placeholder
// become HERMES_HOME kills every chat turn inside pathlib mkdir — treat it
// as unset so callers fall back to the runtime's real home dir.
function sanitizeLocalDataDir(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "/capture" || raw.startsWith("/capture/")) return "";
  return raw;
}

function validPort(value) {
  const portNumber = Number(value);
  return Number.isInteger(portNumber) && portNumber > 0 && portNumber <= 65535
    ? portNumber
    : 0;
}

function portFromUrl(value) {
  try {
    const url = new URL(value);
    return validPort(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return 0;
  }
}

async function dashboardPortForMdns() {
  const explicitPort = validPort(process.env.HIVEMINDOS_DASHBOARD_PORT);
  if (explicitPort) return explicitPort;

  const explicitUrlPort = process.env.HIVEMINDOS_DASHBOARD_URL
    ? portFromUrl(process.env.HIVEMINDOS_DASHBOARD_URL)
    : 0;
  if (explicitUrlPort) return explicitUrlPort;

  try {
    const info = JSON.parse(await readFile(tauriDevServerInfoPath, "utf8"));
    return (
      validPort(info?.dashboardPort) ||
      portFromUrl(info?.dashboardUrl) ||
      validPort(info?.proxyPort) ||
      portFromUrl(info?.proxyUrl) ||
      validPort(info?.nextPort) ||
      5020
    );
  } catch {
    return 5020;
  }
}

async function stableMachineId() {
  if (machineIdPromise) return machineIdPromise;
  machineIdPromise = (async () => {
    const existing = (
      await readFile(machineIdPath, "utf8").catch(() => "")
    ).trim();
    if (/^hivemind-machine-[a-f0-9]{32}$/.test(existing)) return existing;
    const generated = `hivemind-machine-${randomBytes(16).toString("hex")}`;
    await mkdir(dirname(machineIdPath), { recursive: true, mode: 0o700 });
    await writeFile(machineIdPath, `${generated}\n`, { mode: 0o600 });
    return generated;
  })();
  return machineIdPromise;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function cleanProcessEnvValue(value) {
  if (typeof value !== "string") return undefined;
  return value.replace(/\0/g, "");
}

function sanitizeProcessEnvEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ENV_KEY_PATTERN.test(key)) continue;
    const cleaned = cleanProcessEnvValue(entry);
    if (cleaned !== undefined) env[key] = cleaned;
  }
  return env;
}

function safeAgentEnv(value) {
  return sanitizeProcessEnvEntries(value);
}

function runtimeProcessEnv(extra = {}, options = {}) {
  const inherited = { ...process.env };
  for (const key of options.excludeKeys ?? []) delete inherited[key];
  const pathParts = [dirname(process.execPath), process.env.PATH].filter(
    Boolean,
  );
  return sanitizeProcessEnvEntries({
    ...inherited,
    PATH: pathParts.join(delimiter),
    ...extra,
  });
}

function hermesSafeFileSearchRoots(hermesHome = defaultHermesDir, fleetPolicy = null) {
  const sharedBrainAllowed = !fleetPolicy?.authority
    || effectiveFleetAccess(fleetPolicy).sharedBrain === "allow";
  const explicit = process.env.HERMES_SAFE_FILE_SEARCH_ROOTS?.trim();
  if (explicit && sharedBrainAllowed) return explicit;
  return [
    sharedBrainAllowed ? defaultSyncPath : "",
    appDir,
    sharedBrainAllowed ? join(homedir(), "Documents") : "",
    sharedBrainAllowed ? join(homedir(), ".hivemindos") : "",
    hermesHome,
  ]
    .map((root) => resolve(expandHome(root)))
    .filter(Boolean)
    .filter((root, index, roots) => roots.indexOf(root) === index)
    .join(delimiter);
}

function hermesPrivacyGuardEnv(hermesHome = defaultHermesDir, fleetPolicy = null) {
  return {
    HERMES_SAFE_FILE_SEARCH_ROOTS: hermesSafeFileSearchRoots(hermesHome, fleetPolicy),
    HERMES_ALLOW_HOME_WIDE_FILE_SEARCH:
      process.env.HERMES_ALLOW_HOME_WIDE_FILE_SEARCH || "0",
    HERMES_ALLOW_MACOS_APP_DATA_SEARCH:
      process.env.HERMES_ALLOW_MACOS_APP_DATA_SEARCH || "0",
  };
}

// The collector captures process.env at startup, so shared credentials added
// later (e.g. VENICE_API_KEY saved from the app) never reach spawned runtime
// children — causing stale/missing-key 401s. Read ~/.hivemindos/.env fresh at
// spawn time so the latest shared creds win over the stale process env.
async function readSharedHiveEnvForSpawn() {
  const raw = await readFile(join(homedir(), ".hivemindos", ".env"), "utf8").catch(() => "");
  const values = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    value = cleanProcessEnvValue(value) ?? "";
    if (value) values[key] = value;
  }
  return values;
}

async function currentFleetMachinePolicy() {
  return readFleetMachinePolicy({ machineId: await stableMachineId().catch(() => "") });
}

function stripHermesCliMetadata(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*session_id:\s*\S+\s*$/.test(line))
    .filter((line) => !isHermesCliNoiseLine(line))
    .map((line) => line.replace(/^\s*session_id:\s*\S+\s*/i, ""))
    .join("\n")
    .trim();
}

function isHermesCliNoiseLine(value) {
  return /tirith security scanner enabled but not available/i.test(
    String(value || ""),
  );
}

function slugify(value) {
  return (
    String(value || "agent")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "agent"
  );
}

function skillSlug(value) {
  return (
    String(value || "skill")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "skill"
  );
}

function normalizedSkillPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function skillDirSlugFromPath(value) {
  const parts = normalizedSkillPath(value).split("/").filter(Boolean);
  if (!parts.length) return "";
  const last = String(parts[parts.length - 1] || "").toLowerCase();
  return skillSlug(last === "skill.md" ? parts[parts.length - 2] : parts[parts.length - 1]);
}

function pathLooksInsideProviderSkillRoot(providerId, value) {
  return normalizedSkillPath(value).includes(`/.${providerId}/skills/`);
}

function slugLooksProviderMirrored(providerId, slug) {
  if (providerId !== "aeon") return false;
  const normalized = skillSlug(slug);
  if (normalized.startsWith(`${providerId}-`)) return true;
  const firstSegment = normalized.split("-").find(Boolean);
  return Boolean(firstSegment && knownProviderSlugPrefixes.has(firstSegment));
}

function providerPathLooksMirrored(providerId, path, slug) {
  if (providerId !== "aeon") return false;
  if (!pathLooksInsideProviderSkillRoot(providerId, path)) return false;
  return (
    slugLooksProviderMirrored(providerId, slug) ||
    slugLooksProviderMirrored(providerId, skillDirSlugFromPath(path))
  );
}

async function readSkillSourceMetadata(skillDir) {
  const raw = await readFile(join(skillDir, skillSourceMetadataFile), "utf8").catch(
    () => "",
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function providerMirrorLoopStatus(providerId, skillPath, metadata = null) {
  const metadataProvider =
    metadata && typeof metadata.provider === "string" ? metadata.provider : "";
  const managedBy =
    metadata && typeof metadata.managedBy === "string" ? metadata.managedBy : "";
  if (metadataProvider === "shared-brain" || managedBy === "hivemindos")
    return sharedBrainMirrorStatus;
  const metadataSourcePath =
    metadata && typeof metadata.sourcePath === "string" ? metadata.sourcePath : "";
  const sourcePath = metadataSourcePath || skillPath;
  if (providerPathLooksMirrored(providerId, sourcePath, skillDirSlugFromPath(skillPath)))
    return recursiveProviderMirrorStatus;
  if (providerPathLooksMirrored(providerId, skillPath, skillDirSlugFromPath(skillPath)))
    return recursiveProviderMirrorStatus;
  return "";
}

function titleFromSlug(slug) {
  return String(slug || "skill")
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseSkillFrontmatter(markdown) {
  const match = String(markdown || "").match(/^---\n([\s\S]*?)\n---/);
  const fields = new Map();
  if (!match) return fields;
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field)
      fields.set(
        field[1].toLowerCase(),
        field[2].replace(/^["']|["']$/g, "").trim(),
      );
  }
  return fields;
}

function firstSkillParagraph(markdown) {
  return (
    String(markdown || "")
      .replace(/^---\n[\s\S]*?\n---/, "")
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith("#")) || ""
  );
}

function skillChecksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function listenerUrlHost(host) {
  const value = String(host || "").trim();
  if (
    !value ||
    value === "*" ||
    value === "0.0.0.0" ||
    value === "::" ||
    value === "[::]"
  )
    return "127.0.0.1";
  if (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "[::1]"
  )
    return "127.0.0.1";
  return value.replace(/^\[|\]$/g, "");
}

function listenerDisplayHost(host) {
  const value = String(host || "").trim();
  if (
    !value ||
    value === "*" ||
    value === "0.0.0.0" ||
    value === "::" ||
    value === "[::]"
  )
    return "all interfaces";
  if (value === "127.0.0.1" || value === "::1" || value === "[::1]")
    return "localhost";
  return value.replace(/^\[|\]$/g, "");
}

function portFromListenName(name) {
  const value = String(name || "").trim();
  const match = value.match(/(?::|\])(\d+)(?:\s|\(|$)/);
  const portValue = Number(match?.[1]);
  return Number.isInteger(portValue) && portValue > 0 && portValue <= 65535
    ? portValue
    : 0;
}

function hostFromListenName(name) {
  const value = String(name || "")
    .trim()
    .replace(/\s+\(LISTEN\).*$/, "");
  const ipv6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return ipv6[1];
  const portValue = portFromListenName(value);
  if (!portValue) return "";
  return value.replace(new RegExp(`:${portValue}$`), "");
}

function parseLsofListeners(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const name = line.match(/\bTCP\s+(.+?)(?:\s+\(LISTEN\))?$/)?.[1] || "";
      const portValue = portFromListenName(name);
      if (!portValue || excludedHostedAppPorts.has(portValue)) return null;
      return {
        process: parts[0] || "unknown",
        pid: parts[1] || "",
        port: portValue,
        host: hostFromListenName(name),
        raw: name,
      };
    })
    .filter(Boolean);
}

function parseSsListeners(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const local = parts[3] || "";
      const portValue = portFromListenName(local);
      if (!portValue || excludedHostedAppPorts.has(portValue)) return null;
      const processMatch = line.match(/users:\(\("([^"]+)","?pid=(\d+)/);
      return {
        process: processMatch?.[1] || "unknown",
        pid: processMatch?.[2] || "",
        port: portValue,
        host: hostFromListenName(local),
        raw: local,
      };
    })
    .filter(Boolean);
}

async function localTcpListeners() {
  const lsof = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
    timeout: hostedAppScanTimeoutMs,
    maxBuffer: 1_000_000,
  })
    .then(({ stdout }) => parseLsofListeners(stdout))
    .catch(() => []);
  if (lsof.length) return lsof;
  return execFileAsync("ss", ["-H", "-ltnp"], {
    timeout: hostedAppScanTimeoutMs,
    maxBuffer: 1_000_000,
  })
    .then(({ stdout }) => parseSsListeners(stdout))
    .catch(() => []);
}

function titleFromHtml(html, fallback) {
  const match = String(html || "").match(
    /<title[^>]*>([\s\S]{1,180}?)<\/title>/i,
  );
  return (
    (match?.[1] || fallback).replace(/\s+/g, " ").trim().slice(0, 96) ||
    fallback
  );
}

function absoluteAppUrl(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return "";
  }
}

function collectorAssetUrl(filePath) {
  const safePath = resolve(filePath);
  const id = sha256Hex(safePath).slice(0, 24);
  hostedAppAssetUrls.set(id, { type: "file", path: safePath });
  return `http://127.0.0.1:${port}/app-assets/${id}`;
}

function collectorRemoteAssetUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  const id = sha256Hex(value).slice(0, 24);
  hostedAppAssetUrls.set(id, { type: "url", url: value });
  return `http://127.0.0.1:${port}/app-assets/${id}`;
}

function contentTypeForPath(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".ico") return "image/x-icon";
  return "image/png";
}

function appProxyUrl(listener, path = "/") {
  const portValue = Number(listener?.port);
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535)
    return "";
  const normalizedPath = String(path || "/").startsWith("/")
    ? String(path || "/")
    : `/${path}`;
  return `http://127.0.0.1:${port}/app-proxy/${portValue}${normalizedPath}`;
}

function appProxyBaseUrl(listener) {
  const portValue = Number(listener?.port);
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535)
    return "";
  return `http://127.0.0.1:${port}/app-proxy/${portValue}`;
}

async function fileExists(filePath) {
  return access(filePath, constants.R_OK)
    .then(() => true)
    .catch(() => false);
}

async function processCwd(pid) {
  const value = String(pid || "").trim();
  if (!/^\d+$/.test(value)) return "";
  const procCwd = await readlink(`/proc/${value}/cwd`).catch(() => "");
  if (procCwd) return procCwd;
  return execFileAsync("lsof", ["-a", "-p", value, "-d", "cwd", "-Fn"], {
    timeout: hostedAppProbeTimeoutMs,
    maxBuffer: 50_000,
  })
    .then(
      ({ stdout }) =>
        String(stdout || "")
          .split(/\r?\n/)
          .find((line) => line.startsWith("n"))
          ?.slice(1) || "",
    )
    .catch(() => "");
}

async function projectSearchRoots(startDir) {
  let current = resolve(startDir || ".");
  const home = homedir();
  if (isMacosProtectedAppDataPath(current)) return [];
  const roots = [];
  for (let depth = 0; depth < 8; depth += 1) {
    if (isMacosProtectedAppDataPath(current)) break;
    roots.push(current);
    const parent = dirname(current);
    if (
      parent === current ||
      (current === home && !process.env.AGENT_TELEMETRY_APP_SCAN_OUTSIDE_HOME)
    )
      break;
    current = parent;
  }
  const withAppJson = [];
  const withPackageJson = [];
  for (const root of roots) {
    if (await fileExists(join(root, "app.json"))) withAppJson.push(root);
    else if (await fileExists(join(root, "package.json")))
      withPackageJson.push(root);
  }
  return [...withAppJson, ...withPackageJson];
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

let beeWorkerSoulTemplatesCache = null;

async function readBeeWorkerSoulTemplates() {
  if (beeWorkerSoulTemplatesCache) return beeWorkerSoulTemplatesCache;
  const parsed = await readJsonFile(beeWorkerSoulTemplatesPath);
  beeWorkerSoulTemplatesCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  return beeWorkerSoulTemplatesCache;
}

function renderBeeSoulTemplateText(template, agentName) {
  const name = String(agentName || "").trim() || "this agent";
  return String(template || "")
    .replaceAll("{{agentName}}", name)
    .trim();
}

async function defaultBeeSoulMarkdown(input) {
  const templates = await readBeeWorkerSoulTemplates();
  const workerClass = knownBeeWorkerClasses.includes(input?.workerClass)
    ? input.workerClass
    : "general";
  const templateKey = input?.beeRole === "queen" ? "queen" : workerClass;
  const lines = Array.isArray(templates[templateKey])
    ? templates[templateKey]
    : templates.general;
  const rendered = renderBeeSoulTemplateText(
    Array.isArray(lines) ? lines.join("\n") : "",
    input?.name,
  );
  return (
    rendered ||
    `# Soul\nYou are ${String(input?.name || "this agent").trim()}, a ${workerClass} worker in HivemindOS.`
  );
}

async function readHermesSoul(profileDir) {
  const raw = await readFile(join(profileDir, "SOUL.md"), "utf8").catch(
    () => "",
  );
  return raw.trim().slice(0, 12_000);
}

async function importHermesAgentSoul(agent) {
  if (agent.runtime !== "hermes" || agent.soulPrompt?.trim()) {
    return agent;
  }
  const profileDir = expandHome(sanitizeLocalDataDir(agent.localDataDir));
  if (!profileDir) return agent;
  const soul = await readHermesSoul(profileDir);
  return soul ? { ...agent, soulPrompt: soul } : agent;
}

async function importHermesAgentSouls(agents) {
  return Promise.all(agents.map((agent) => importHermesAgentSoul(agent)));
}

function configuredExpoIconPaths(appJson) {
  const expo = appJson?.expo || appJson;
  return [
    expo?.icon,
    expo?.ios?.icon,
    expo?.web?.favicon,
    expo?.splash?.image,
    expo?.android?.adaptiveIcon?.foregroundImage,
  ].filter((value) => typeof value === "string" && value.trim());
}

async function iconFromProjectFolder(listener) {
  const cwd = await processCwd(listener.pid);
  for (const root of await projectSearchRoots(cwd)) {
    const appJson = await readJsonFile(join(root, "app.json"));
    const candidates = [
      ...configuredExpoIconPaths(appJson),
      "assets/images/icon.png",
      "assets/images/favicon.png",
      "assets/icons/icon.png",
      "public/icon.png",
      "public/favicon.png",
      "public/favicon.ico",
    ];
    for (const candidate of candidates) {
      const fullPath = resolve(root, candidate);
      if (!fullPath.startsWith(`${root}${sep}`) && fullPath !== root) continue;
      if (await fileExists(fullPath)) return collectorAssetUrl(fullPath);
    }
  }
  return "";
}

function linkTagAttributes(tag) {
  const attrs = {};
  for (const match of String(tag || "").matchAll(
    /\b([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
  )) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

async function isImageUrl(url) {
  if (!url) return false;
  try {
    let response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(hostedAppProbeTimeoutMs),
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        headers: { range: "bytes=0-512" },
        signal: AbortSignal.timeout(hostedAppProbeTimeoutMs),
      });
    }
    const contentType = response.headers.get("content-type") || "";
    // Only headers matter here — drop the body so the probe socket is
    // released immediately instead of dangling until the abort timeout.
    await response.body?.cancel().catch(() => {});
    return (
      response.ok &&
      (contentType.startsWith("image/") ||
        ((contentType === "" || contentType === "application/octet-stream") &&
          /\.(?:ico|png|svg|webp|jpg|jpeg)(?:\?|$)/i.test(url)))
    );
  } catch {
    return false;
  }
}

function iconFromHtml(html, baseUrl) {
  const links = [...String(html || "").matchAll(/<link\b[^>]*>/gi)].map(
    (match) => linkTagAttributes(match[0]),
  );
  const preferred = links.find((attrs) =>
    /\b(?:apple-touch-icon|mask-icon|icon)\b/i.test(attrs.rel || ""),
  );
  const href = preferred?.href;
  return href ? absoluteAppUrl(baseUrl, href) : "";
}

async function iconFromManifest(baseUrl, html) {
  const manifestHref = [...String(html || "").matchAll(/<link\b[^>]*>/gi)]
    .map((match) => linkTagAttributes(match[0]))
    .find((attrs) => /\bmanifest\b/i.test(attrs.rel || ""))?.href;
  if (!manifestHref) return "";
  try {
    const manifestUrl = absoluteAppUrl(baseUrl, manifestHref);
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(hostedAppProbeTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return "";
    }
    const manifest = await response.json();
    const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
    const icon =
      icons.find(
        (item) =>
          typeof item?.src === "string" &&
          /512|192|180|128|64/.test(String(item.sizes || "")),
      ) || icons.find((item) => typeof item?.src === "string");
    return icon?.src ? absoluteAppUrl(manifestUrl, icon.src) : "";
  } catch {
    return "";
  }
}

async function discoverHostedAppIcon(baseUrl, html) {
  const manifestIcon = await iconFromManifest(baseUrl, html);
  if (await isImageUrl(manifestIcon))
    return collectorRemoteAssetUrl(manifestIcon);
  const htmlIcon = iconFromHtml(html, baseUrl);
  if (await isImageUrl(htmlIcon)) return collectorRemoteAssetUrl(htmlIcon);
  const candidates = [
    "/apple-touch-icon.png",
    "/favicon.png",
    "/favicon.ico",
    "/icon.png",
    "/assets/images/favicon.png",
    "/assets/images/icon.png",
  ].map((path) => absoluteAppUrl(baseUrl, path));
  for (const candidate of candidates) {
    if (await isImageUrl(candidate)) return collectorRemoteAssetUrl(candidate);
  }
  return "";
}

async function probeHostedApp(listener, scheme) {
  const url = `${scheme}://${listenerUrlHost(listener.host)}:${listener.port}/`;
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(hostedAppProbeTimeoutMs),
  });
  const contentType = response.headers.get("content-type") || "";
  const server = response.headers.get("server") || "";
  let text = "";
  if (contentType.includes("text/html")) {
    text = await response.text().catch(() => "");
  } else {
    // Non-HTML bodies are never read; cancel so discovery doesn't hold one
    // socket per probed listener until the abort timeout fires.
    await response.body?.cancel().catch(() => {});
  }
  const title = titleFromHtml(text, `${listener.process} on ${listener.port}`);
  const iconUrl =
    (await discoverHostedAppIcon(url, text)) ||
    (await iconFromProjectFolder(listener));
  return {
    ok: true,
    id: sha256Hex(
      `${hostname()}:${listener.port}:${listener.process}:${listener.pid}`,
    ).slice(0, 16),
    name: title,
    description: contentType
      ? `${response.status} ${contentType}`
      : `HTTP ${response.status}`,
    statusCode: response.status,
    contentType,
    iconUrl,
    scheme,
    host: listenerDisplayHost(listener.host),
    port: listener.port,
    path: "/",
    localUrl: url,
    proxyUrl: appProxyUrl(listener),
    process: listener.process,
    pid: listener.pid,
    server,
  };
}

function serviceNameFromHealth(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const value =
    payload.service || payload.name || payload.app || payload.application;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function serviceStatusFromHealth(payload) {
  if (!payload || typeof payload !== "object") return "";
  const value = payload.status || payload.state || payload.ok;
  if (typeof value === "boolean") return value ? "ok" : "error";
  return typeof value === "string" ? value.trim() : "";
}

function knownServiceFromHealth(payload, rawText = "") {
  const haystack = `${serviceNameFromHealth(payload, "")} ${rawText}`;
  return (
    knownServiceSignatures.find((signature) =>
      signature.matches.test(haystack),
    ) || null
  );
}

async function probeServiceHealth(listener, scheme) {
  const baseUrl = `${scheme}://${listenerUrlHost(listener.host)}:${listener.port}`;
  const healthPath = "/health";
  const response = await fetch(`${baseUrl}${healthPath}`, {
    method: "GET",
    signal: AbortSignal.timeout(hostedAppProbeTimeoutMs),
  });
  const contentType = response.headers.get("content-type") || "";
  const server = response.headers.get("server") || "";
  const text = await response.text().catch(() => "");
  let payload = null;
  if (contentType.includes("json") || text.trim().startsWith("{")) {
    payload = JSON.parse(text);
  }
  const fallback = `${listener.process} API on ${listener.port}`;
  const name = serviceNameFromHealth(payload, fallback);
  const status = serviceStatusFromHealth(payload);
  const knownService = knownServiceFromHealth(payload, text);
  const serviceKind = knownService?.serviceKind || "api";
  return {
    ok: response.ok,
    id: sha256Hex(
      `${hostname()}:${listener.port}:${listener.process}:${listener.pid}:${serviceKind}`,
    ).slice(0, 16),
    name: knownService?.displayName || titleFromHtml("", name),
    description: status
      ? `API service · ${status}`
      : `API service · HTTP ${response.status}`,
    statusCode: response.status,
    contentType,
    iconUrl: "",
    scheme,
    host: listenerDisplayHost(listener.host),
    port: listener.port,
    path: "/",
    healthPath,
    healthUrl: `${baseUrl}${healthPath}`,
    apiBaseUrl: baseUrl,
    localUrl: baseUrl,
    proxyUrl: appProxyUrl(listener),
    apiProxyUrl: appProxyBaseUrl(listener),
    healthProxyUrl: appProxyUrl(listener, healthPath),
    process: listener.process,
    pid: listener.pid,
    server,
    interactive: false,
    serviceKind,
  };
}

const discoverHostedAppsCached = createHostedAppsCache(() => discoverHostedApps());

async function discoverHostedApps() {
  const listeners = await localTcpListeners();
  const byPort = new Map();
  for (const listener of listeners) {
    const current = byPort.get(listener.port);
    const currentHost = listenerDisplayHost(current?.host);
    const nextHost = listenerDisplayHost(listener.host);
    if (!current || (currentHost !== "localhost" && nextHost === "localhost")) {
      byPort.set(listener.port, listener);
    }
  }
  const apps = [];
  for (const listener of [...byPort.values()].sort(
    (left, right) => left.port - right.port,
  )) {
    const app = await probeHostedApp(listener, "http")
      .then(async (rootApp) => {
        const service = await probeServiceHealth(
          listener,
          rootApp.scheme,
        ).catch(() => null);
        return service
          ? {
              ...rootApp,
              ...service,
              interactive: rootApp.contentType?.includes("text/html"),
            }
          : rootApp;
      })
      .catch(() => probeHostedApp(listener, "https"))
      .catch(() => probeServiceHealth(listener, "http"))
      .catch(() => probeServiceHealth(listener, "https"))
      .catch(() => null);
    if (app) apps.push(app);
  }
  return apps;
}

function yamlScalar(value) {
  return JSON.stringify(String(value || ""));
}

function uniqueAgentId(runtime, name) {
  return `${runtime}-${slugify(name)}-${randomBytes(3).toString("hex")}`;
}

const HIVE_RUNTIME_ID = "hivemind-os";
const LEGACY_OPENAI_COMPATIBLE_RUNTIME_ID = "openai-compatible";
const knownRuntimeIds = ["hermes", "openclaw", "aeon", HIVE_RUNTIME_ID];
const knownBeeWorkerClasses = [
  "general",
  "planner",
  "code",
  "vision",
  "writer",
  "research",
  "artist",
  "ops",
  "qa",
];

function normalizeRuntimeId(runtime, fallback = "hermes") {
  const value = String(runtime || "").trim();
  if (value === LEGACY_OPENAI_COMPATIBLE_RUNTIME_ID) return HIVE_RUNTIME_ID;
  return knownRuntimeIds.includes(value) ? value : fallback;
}

function runtimeAgentKey(agent) {
  const runtime = normalizeRuntimeId(agent?.runtime);
  return `${runtime}:${slugify(agent?.agentId || agent?.profile || agent?.name)}`;
}

async function readRuntimeAgentRegistry() {
  const raw = await readFile(runtimeAgentRegistryPath, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.agents) ? parsed.agents : [];
  } catch {
    return [];
  }
}

async function writeRuntimeAgentRegistry(agents) {
  await mkdir(join(homedir(), ".hivemindos"), { recursive: true, mode: 0o700 });
  await writeFile(
    runtimeAgentRegistryPath,
    `${JSON.stringify({ agents }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function runtimeCapabilitiesFor(runtime) {
  if (runtime === "hermes") {
    return {
      status: true,
      chat: true,
      runs: true,
      memory: true,
      sessionSearch: true,
      backgroundTasks: true,
      xSearch: true,
      imageGeneration: true,
      videoGeneration: true,
      codexRuntime: true,
      kanbanDecompose: true,
      setup: true,
      walletTools: true,
      modelSelection: true,
    };
  }
  if (runtime === "openclaw") {
    return {
      status: true,
      chat: true,
      skills: true,
      schedules: true,
      memory: true,
      sessionSearch: true,
      socialPosting: true,
      videoGeneration: true,
      notifications: true,
      setup: true,
      walletTools: true,
      modelSelection: true,
    };
  }
  if (runtime === "aeon") {
    return {
      status: true,
      skills: true,
      schedules: true,
      runs: true,
      outputs: true,
      memory: true,
      backgroundTasks: true,
      notifications: true,
      setup: true,
    };
  }
  if (runtime === "codex") {
    return {
      status: true,
      runs: true,
      backgroundTasks: true,
      codexRuntime: true,
      modelSelection: true,
    };
  }
  if (runtime === HIVE_RUNTIME_ID) {
    return {
      status: true,
      chat: true,
      modelSelection: true,
    };
  }
  return {};
}

function normalizeRuntimeAgent(entry) {
  const runtime = normalizeRuntimeId(entry?.runtime, HIVE_RUNTIME_ID);
  return {
    ...entry,
    id: String(entry?.id || uniqueAgentId(runtime, entry?.name)),
    name: String(entry?.name || "Agent"),
    runtime,
    gatewayUrl: String(entry?.gatewayUrl || ""),
    agentId: String(entry?.agentId || entry?.profile || entry?.id || ""),
    localDataDir:
      typeof entry?.localDataDir === "string" ? entry.localDataDir : "",
    machineName: hostname(),
    runtimeKind:
      runtime === "openclaw"
        ? "gateway"
        : runtime === "aeon"
          ? "background"
          : "interactive",
    runtimeCapabilities: runtimeCapabilitiesFor(runtime),
    beeRole: ["queen", "worker", "observer", "human"].includes(entry?.beeRole)
      ? entry.beeRole
      : "worker",
    workerClass: knownBeeWorkerClasses.includes(entry?.workerClass)
      ? entry.workerClass
      : "general",
    useSharedVault: entry?.useSharedVault !== false,
  };
}

async function configuredRuntimeAgents() {
  const agents = await readRuntimeAgentRegistry();
  return importHermesAgentSouls(agents.map(normalizeRuntimeAgent));
}

async function detectedOpenClawAgents(coveredAgentIds = new Set()) {
  const configPath = join(defaultOpenClawDir, "openclaw.json");
  const configReadable = await access(configPath, constants.R_OK)
    .then(() => true)
    .catch(() => false);
  if (!configReadable) return [];
  const config = await readOpenClawConfig();
  const configured = Array.isArray(asRecord(config.agents).list)
    ? asRecord(config.agents).list.map(asRecord)
    : [];
  const entries = configured.length ? configured : [{ id: "main" }];
  const defaultModelRef = defaultOpenClawAgentModel(config);
  const hostSlug = hostname()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return entries.flatMap((entry) => {
    const agentId = String(entry.id || "main").trim();
    if (!agentId || coveredAgentIds.has(agentId)) return [];
    const modelRef =
      (typeof entry.model === "string" && entry.model.trim()) ||
      defaultModelRef;
    const parsed = modelRef ? splitOpenClawModelRef(modelRef) : null;
    const agentDir =
      typeof entry.agentDir === "string" && entry.agentDir.trim()
        ? entry.agentDir.trim()
        : agentId === "main"
          ? defaultOpenClawDir
          : join(defaultOpenClawDir, "agents", agentId);
    return [
      normalizeRuntimeAgent({
        id: agentId === "main" ? `openclaw-${hostSlug}` : `openclaw-${agentId}`,
        name:
          (typeof entry.name === "string" && entry.name.trim()) ||
          (agentId === "main" ? "OpenClaw" : agentId),
        runtime: "openclaw",
        gatewayUrl: "ws://127.0.0.1:18789",
        agentId,
        localDataDir: agentDir,
        provider: parsed?.provider,
        model: parsed?.model,
        // Queen is a dashboard-level choice — a detected runtime must never self-declare it.
        beeRole: "worker",
        workerClass: "general",
      }),
    ];
  });
}

// ===========================================================================
// Venice x402 local signing proxy
// ---------------------------------------------------------------------------
// Hermes (and any OpenAI-compatible client) can't generate Venice's per-request
// `X-Sign-In-With-X` wallet signature. This local proxy bridges that: Hermes
// POSTs plain OpenAI-compatible requests to the collector, which signs a fresh
// SIWX header with the agent's local wallet and forwards to Venice. This lets a
// Hermes-runtime agent use Venice x402 WALLET mode (no API key) end to end.
// ===========================================================================
const VENICE_API_BASE = "https://api.venice.ai/api/v1";
const VENICE_SIWX_DOMAIN = "api.venice.ai";
const VENICE_SIWX_STATEMENT = "Sign in to Venice AI";
const VENICE_SIWX_EXPIRY_MS = 5 * 60 * 1000;
const VENICE_SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const WALLET_VAULT_DIR = join(homedir(), ".hivemindos");
const WALLET_VAULT_PATH = join(WALLET_VAULT_DIR, "wallet-vault.json");
const WALLET_VAULT_KEY_PATH = join(WALLET_VAULT_DIR, "wallet-vault.key");

// Mirrors local-wallet-vault.ts: AES-256-GCM, key = sha256(env or keyfile).
async function veniceVaultKey() {
  const envKey = process.env.HIVEMINDOS_WALLET_VAULT_KEY?.trim();
  if (envKey) return createHash("sha256").update(envKey).digest();
  const existing = await readFile(WALLET_VAULT_KEY_PATH, "utf8");
  return createHash("sha256").update(existing.trim()).digest();
}

async function veniceWalletFromVault(vaultId) {
  const raw = await readFile(WALLET_VAULT_PATH, "utf8").catch(() => "");
  const vault = raw ? JSON.parse(raw) : null;
  const record = vault?.records?.[vaultId];
  if (!record) throw new Error(`No local wallet found for "${vaultId}".`);
  const key = await veniceVaultKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createSecretKey(key),
    Buffer.from(record.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  const secret = Buffer.concat([
    decipher.update(Buffer.from(record.encryptedSecret, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return { address: record.address, network: String(record.network || ""), secret };
}

function veniceSiwxMessage({ accountKind, address, uri, chainId, issuedAt, expirationTime, nonce }) {
  return [
    `${VENICE_SIWX_DOMAIN} wants you to sign in with your ${accountKind} account:`,
    address,
    "",
    VENICE_SIWX_STATEMENT,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join("\n");
}

// Builds the base64 X-Sign-In-With-X header for a Base (EVM) or Solana wallet,
// signing the exact resource URL. Mirrors venice.ts buildVeniceSiwxHeader.
async function veniceSiwxHeader(wallet, resourceUrl) {
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expirationTime = new Date(now + VENICE_SIWX_EXPIRY_MS).toISOString();
  const nonce = randomBytes(12).toString("hex").slice(0, 16);
  if (wallet.network.startsWith("eip155:")) {
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(wallet.secret);
    const message = veniceSiwxMessage({ accountKind: "Ethereum", address: account.address, uri: resourceUrl, chainId: 8453, issuedAt, expirationTime, nonce });
    const signature = await account.signMessage({ message });
    return Buffer.from(JSON.stringify({ address: account.address, message, signature, timestamp: now, chainId: 8453 }), "utf8").toString("base64");
  }
  if (wallet.network.startsWith("solana:")) {
    const { base58 } = await import("@scure/base");
    const { createKeyPairSignerFromBytes, createSignableMessage } = await import("@solana/kit");
    const signer = await createKeyPairSignerFromBytes(base58.decode(wallet.secret));
    const message = veniceSiwxMessage({ accountKind: "Solana", address: signer.address, uri: resourceUrl, chainId: VENICE_SOLANA_CAIP2, issuedAt, expirationTime, nonce });
    const [signatures] = await signer.signMessages([createSignableMessage(new TextEncoder().encode(message))]);
    const sigBytes = signatures[signer.address];
    if (!sigBytes) throw new Error("Solana wallet did not return a Sign-In-With-X signature.");
    return Buffer.from(JSON.stringify({ address: signer.address, message, signature: base58.encode(new Uint8Array(sigBytes)), timestamp: now, chainId: VENICE_SOLANA_CAIP2, type: "ed25519" }), "utf8").toString("base64");
  }
  throw new Error(`Venice x402 supports Base and Solana wallets; got "${wallet.network}".`);
}

function isLoopbackRemote(request) {
  const addr = request.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// Handles /venice-x402/<walletVaultId>/<venice-subpath>. Signs and forwards to
// Venice with the wallet's SIWX header, streaming the response back verbatim.
async function handleVeniceX402Proxy(request, response, pathname, search) {
  if (!isLoopbackRemote(request)) {
    jsonResponse(response, 403, { ok: false, error: "Venice x402 proxy is local-only." });
    return;
  }
  const rest = pathname.slice("/venice-x402/".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    jsonResponse(response, 400, { ok: false, error: "Venice x402 proxy path must be /venice-x402/<wallet>/<endpoint>." });
    return;
  }
  const vaultId = decodeURIComponent(rest.slice(0, slash));
  const subPath = rest.slice(slash + 1).replace(/^\/+/, "");
  const targetUrl = `${VENICE_API_BASE}/${subPath}${search || ""}`;
  let wallet;
  try {
    wallet = await veniceWalletFromVault(vaultId);
  } catch (error) {
    jsonResponse(response, 404, { ok: false, error: error instanceof Error ? error.message : "Wallet not found." });
    return;
  }
  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  let signInHeader;
  try {
    signInHeader = await veniceSiwxHeader(wallet, targetUrl);
  } catch (error) {
    jsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Could not sign the Venice request." });
    return;
  }
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "X-Sign-In-With-X": signInHeader,
        ...(request.headers["content-type"] ? { "Content-Type": String(request.headers["content-type"]) } : {}),
        ...(request.headers.accept ? { Accept: String(request.headers.accept) } : {}),
      },
      body,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    jsonResponse(response, 502, { ok: false, error: error instanceof Error ? error.message : "Could not reach Venice." });
    return;
  }
  const headers = { "content-type": upstream.headers.get("content-type") || "application/json" };
  const balance = upstream.headers.get("x-balance-remaining");
  if (balance) headers["x-balance-remaining"] = balance;
  response.writeHead(upstream.status, headers);
  if (upstream.body) {
    for await (const chunk of upstream.body) response.write(chunk);
  } else {
    response.write(Buffer.from(await upstream.arrayBuffer()));
  }
  response.end();
}

// Hermes profiles do NOT inherit provider definitions from the root
// ~/.hermes/config.yaml, so a profile that selects a custom gateway provider
// must define it inline or Hermes rejects it ("Unknown provider"). These are
// the OpenAI-compatible gateway providers HivemindOS offers that Hermes can
// reach with a bearer key. Mirrors MODEL_PROVIDER_GATEWAYS[*].hermes.
const HERMES_GATEWAY_PROVIDERS = {
  venice: { name: "Venice AI", baseUrl: "https://api.venice.ai/api/v1", keyEnv: "VENICE_API_KEY", models: ["llama-3.3-70b"] },
  bankr: { name: "Bankr LLM", baseUrl: "https://llm.bankr.bot/v1", keyEnv: "BANKR_LLM_KEY", models: [] },
  sie: { name: "SIE", baseUrl: "http://127.0.0.1:8080/v1", keyEnv: "", models: [] },
};

function hermesProvidersBlock(provider, model, agentConfig) {
  const gateway = HERMES_GATEWAY_PROVIDERS[provider];
  if (!gateway) return [];
  let baseUrl = gateway.baseUrl;
  let keyEnv = gateway.keyEnv;
  // Venice x402 wallet mode: point Hermes at the local signing proxy (which
  // injects the SIWX header) instead of api.venice.ai, and send no bearer key.
  if (provider === "venice") {
    const config = agentConfig && typeof agentConfig === "object" ? agentConfig : {};
    const venice = config.venice && typeof config.venice === "object" ? config.venice : config;
    const walletVaultId = String(venice.walletVaultId || "").trim();
    if (walletVaultId && venice.authMode !== "api-key") {
      baseUrl = `http://127.0.0.1:${port}/venice-x402/${encodeURIComponent(walletVaultId)}`;
      keyEnv = "";
    }
  }
  if (provider === "sie") {
    const config = agentConfig && typeof agentConfig === "object" ? agentConfig : {};
    const configuredBase = String(config.gatewayUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    if (configuredBase) baseUrl = `${configuredBase}/v1`;
  }
  if (!baseUrl) return [];
  const models = Array.from(new Set([model, ...gateway.models].filter(Boolean)));
  return [
    "providers:",
    `  ${provider}:`,
    `    name: ${yamlScalar(gateway.name)}`,
    `    base_url: ${yamlScalar(baseUrl)}`,
    ...(keyEnv ? [`    key_env: ${yamlScalar(keyEnv)}`] : []),
    `    default_model: ${yamlScalar(model)}`,
    "    models:",
    ...models.map((id) => `      ${yamlScalar(id)}: {}`),
  ];
}

async function createHermesProfileAgent(input) {
  const profile = slugify(input.profile || input.name);
  if (profile === "default" || profile === "hermes")
    throw new Error("Choose a non-reserved Hermes profile name.");
  const profileDir = join(hermesProfilesDir, profile);
  const existingSoul = await readHermesSoul(profileDir);
  const dirs = [
    "memories",
    "sessions",
    "skills",
    "skins",
    "logs",
    "plans",
    "workspace",
    "cron",
    "home",
  ];
  await Promise.all(
    dirs.map((dir) =>
      mkdir(join(profileDir, dir), { recursive: true, mode: 0o700 }),
    ),
  );
  const provider = String(input.provider || "openai-codex").trim();
  const model = String(input.model || "gpt-5.5").trim();
  const suitedForPrompt = String(input.skillProfilePrompt || "").trim();
  const incomingSoul = String(input.soulPrompt || "").trim();
  const soulPrompt =
    existingSoul ||
    (incomingSoul
      ? renderBeeSoulTemplateText(incomingSoul, input.name)
      : await defaultBeeSoulMarkdown(input));
  await writeFile(
    join(profileDir, "config.yaml"),
    [
      "model:",
      `  default: ${yamlScalar(model)}`,
      `  provider: ${yamlScalar(provider)}`,
      provider === "openai-codex"
        ? "  base_url: https://chatgpt.com/backend-api/codex"
        : "",
      // Gateway providers (Venice, Bankr) need an inline definition; profiles
      // don't inherit the root config's providers. Venice wallet mode points
      // at the local x402 signing proxy.
      ...hermesProvidersBlock(provider, model, input),
      "image_gen:",
      "  provider: openai-codex",
      "  model: gpt-image-2-medium",
      "  openai-codex:",
      "    model: gpt-image-2-medium",
      "agent:",
      "  auto_approve: true",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
    { mode: 0o600 },
  );
  if (!existingSoul) {
    await writeFile(join(profileDir, "SOUL.md"), `${soulPrompt.trim()}\n`, {
      mode: 0o600,
    });
  }
  await writeFile(
    join(profileDir, "profile.json"),
    `${JSON.stringify(
      {
        name: profile,
        display_name: input.name,
        description: suitedForPrompt || soulPrompt,
        description_auto: false,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return {
    profile,
    profileDir,
    provider,
    model,
    soulPrompt,
    skillProfilePrompt: suitedForPrompt,
  };
}

async function createRuntimeAgent(input) {
  const runtime = normalizeRuntimeId(input.runtime);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Agent name is required.");
  let runtimeResult = {};
  if (runtime === "hermes") {
    runtimeResult = await createHermesProfileAgent(input);
  }
  const profile = runtimeResult.profile || slugify(name);
  const agents = await readRuntimeAgentRegistry();
  const incomingKey = `${runtime}:${profile}`;
  const existing = agents.find((item) => runtimeAgentKey(item) === incomingKey);
  const agent = normalizeRuntimeAgent({
    ...existing,
    id: existing?.id || uniqueAgentId(runtime, name),
    name,
    runtime,
    gatewayUrl:
      runtime === "openclaw"
        ? String(input.gatewayUrl || "ws://127.0.0.1:18789")
        : runtime === HIVE_RUNTIME_ID
          ? String(
              input.gatewayUrl ||
                process.env.LOCAL_OPENAI_BASE_URL ||
                "http://127.0.0.1:1234",
            )
          : "",
    agentId: profile,
    chatPath:
      runtime === "hermes"
        ? "/chat"
        : runtime === HIVE_RUNTIME_ID
          ? "/v1/chat/completions"
          : "",
    statusPath:
      runtime === "hermes"
        ? "/health"
        : runtime === HIVE_RUNTIME_ID
          ? "/v1/models"
          : "",
    provider:
      input.provider || (runtime === HIVE_RUNTIME_ID ? "lm-studio" : undefined),
    model:
      input.model ||
      (runtime === HIVE_RUNTIME_ID
        ? process.env.LOCAL_OPENAI_MODEL
        : undefined),
    localDataDir:
      runtimeResult.profileDir ||
      (runtime === "hermes" ? join(hermesProfilesDir, profile) : ""),
    beeRole: input.beeRole,
    workerClass: input.workerClass,
    customWorkerClass: input.customWorkerClass,
    customWorkerClasses: input.customWorkerClasses,
    selectedCustomWorkerClassId: input.selectedCustomWorkerClassId,
    soulPrompt: runtimeResult.soulPrompt || input.soulPrompt,
    skillProfilePrompt:
      runtimeResult.skillProfilePrompt || input.skillProfilePrompt,
    preferredSkillSlugs: input.preferredSkillSlugs,
    useSharedVault: input.useSharedVault,
  });
  await writeRuntimeAgentRegistry([
    ...agents.filter(
      (item) => item.id !== agent.id && runtimeAgentKey(item) !== incomingKey,
    ),
    agent,
  ]);
  return agent;
}

async function deleteRuntimeAgent(input) {
  const id = String(input.id || "").trim();
  const runtime = input.runtime ? normalizeRuntimeId(input.runtime) : "";
  const profile = slugify(input.profile || input.agentId || input.name || "");
  if (!id && !profile) throw new Error("Agent id or profile is required.");

  const agents = await readRuntimeAgentRegistry();
  const target = agents.find(
    (agent) =>
      (id && agent.id === id) ||
      (runtime &&
        profile &&
        runtimeAgentKey(agent) === `${runtime}:${profile}`) ||
      (!runtime &&
        profile &&
        slugify(agent.agentId || agent.profile || agent.name) === profile),
  );
  if (!target) return { deleted: false };

  const normalized = normalizeRuntimeAgent(target);
  const managedProfile = slugify(normalized.agentId || normalized.name);
  const canRemoveHermesProfile =
    normalized.runtime === "hermes" &&
    managedProfile &&
    managedProfile !== "default" &&
    managedProfile !== "hermes" &&
    (managedProfile.startsWith("hive-e2e-") ||
      input.allowProfileRemoval === true);

  await writeRuntimeAgentRegistry(
    agents.filter((agent) => agent.id !== target.id),
  );

  let removedProfileDir = false;
  if (canRemoveHermesProfile) {
    const profileDir = resolve(join(hermesProfilesDir, managedProfile));
    const safeRoot = resolve(hermesProfilesDir);
    if (profileDir.startsWith(`${safeRoot}${sep}`)) {
      await rm(profileDir, { recursive: true, force: true });
      removedProfileDir = true;
    }
  }

  return {
    deleted: true,
    agent: normalized,
    removedProfileDir,
  };
}

function jsonResponse(response, status, payload) {
  // Handler catch blocks land here after headers (or a partial body) may have
  // already gone out; a second writeHead throws ERR_HTTP_HEADERS_SENT and
  // killed the whole daemon in the 2026-07-03 NYC incident (env-sync export).
  // Just close out whatever is left of the response instead.
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(payload));
}

function currentUsername() {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER || process.env.LOGNAME || "";
  }
}

function ssePayload(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function hermesApiHeaders(extra = {}) {
  return {
    ...extra,
    ...(hermesApiKey ? { Authorization: `Bearer ${hermesApiKey}` } : {}),
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizeContentPart(part) {
  if (!part || typeof part !== "object") return null;
  if (part.type === "text") {
    const text = typeof part.text === "string" ? part.text.trim() : "";
    return text ? { type: "text", text } : null;
  }
  if (part.type === "image_url" && part.image_url?.url) {
    return {
      type: "image_url",
      image_url: { url: String(part.image_url.url) },
    };
  }
  if (part.type === "file" && part.file?.file_data) {
    return {
      type: "file",
      file: {
        filename: String(part.file.filename || "attachment"),
        file_data: String(part.file.file_data),
      },
    };
  }
  return null;
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(normalizeContentPart).filter(Boolean);
}

function messageHasContent(message) {
  const content = normalizeMessageContent(message?.content);
  return Array.isArray(content) ? content.length > 0 : Boolean(content);
}

function extractUserTextFromMessages(messages) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message?.role === "user" && messageHasContent(message));
  if (!lastUserMessage) return "";
  if (typeof lastUserMessage.content === "string")
    return lastUserMessage.content.trim();
  return lastUserMessage.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ");
}

function attachmentPromptFromMessages(messages) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message?.role === "user" && messageHasContent(message));
  if (!lastUserMessage || !Array.isArray(lastUserMessage.content)) return "";
  const images = lastUserMessage.content.filter(
    (part) => part?.type === "image_url" && part.image_url?.url,
  ).length;
  const files = lastUserMessage.content.filter(
    (part) => part?.type === "file" && part.file?.file_data,
  ).length;
  const pieces = [
    images ? `${images} image${images === 1 ? "" : "s"}` : "",
    files ? `${files} file${files === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return pieces.length
    ? `Please respond to the attached ${pieces.join(" and ")}.`
    : "";
}

function messagesHaveMultimodalContent(messages) {
  return (
    Array.isArray(messages) &&
    messages.some(
      (message) =>
        Array.isArray(message?.content) &&
        message.content.some(
          (part) => part?.type === "image_url" || part?.type === "file",
        ),
    )
  );
}

function compact(value, fallback = "No readable details.") {
  if (typeof value === "string")
    return value.trim().slice(0, maxChars) || fallback;
  if (value && typeof value === "object")
    return JSON.stringify(value).slice(0, maxChars);
  return fallback;
}

function readableChatContent(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^[\[{]/.test(trimmed)) {
      try {
        return readableChatContent(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => readableChatContent(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!value || typeof value !== "object") return "";
  const choices = Array.isArray(value.choices) ? value.choices : [];
  for (const choice of choices) {
    const content =
      readableChatContent(choice?.message) ||
      readableChatContent(choice?.delta) ||
      readableChatContent(choice?.text);
    if (content) return content;
  }
  for (const key of [
    "response",
    "answer",
    "content",
    "text",
    "message",
    "output",
    "result",
    "summary",
  ]) {
    const content = readableChatContent(value[key]);
    if (content) return content;
  }
  return "";
}

function streamingChatContent(value) {
  if (!value || typeof value !== "object")
    return typeof value === "string" ? value : "";
  const record = value;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    const deltaContent = choice?.delta?.content;
    if (typeof deltaContent === "string") return deltaContent;
    const messageContent = choice?.message?.content;
    if (typeof messageContent === "string") return messageContent;
    const text = choice?.text;
    if (typeof text === "string") return text;
  }
  for (const key of [
    "delta",
    "content",
    "text",
    "response",
    "answer",
    "output",
    "result",
    "summary",
  ]) {
    if (typeof record[key] === "string") return record[key];
  }
  return readableChatContent(value);
}

function streamingChatProcessPayload(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  const event =
    record.event && typeof record.event === "object" ? record.event : null;
  const type = String(event?.type ?? record.type ?? "").trim();
  if (type && !/^chat\.(text|done|session)$/i.test(type)) return value;
  if (record.status && typeof record.status === "object") return value;
  if (record.tool_call && typeof record.tool_call === "object") return value;
  if (Array.isArray(record.tool_calls) && record.tool_calls.length)
    return value;
  if (record.reasoning || record.thinking) return value;
  return null;
}

// execFile can THROW synchronously (spawn EBADF/EMFILE when the process runs
// out of file descriptors) instead of rejecting, so a .catch() chained on its
// promise never fires. During the 2026-07-03 NYC incident that throw escaped
// through readAppVersion → /health and killed the daemon. Wrap the whole body
// so ANY failure — sync or async — returns the fallback.
async function execJson(cmd, args, fallback) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: 5000,
      maxBuffer: 1_200_000,
    });
    if (!stdout.trim()) return fallback;
    return JSON.parse(stdout);
  } catch {
    return fallback;
  }
}

async function execText(cmd, args, fallback = "") {
  return execTextAt(appDir, cmd, args, fallback);
}

async function execTextAt(cwd, cmd, args, fallback = "") {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd,
      timeout: 5000,
      maxBuffer: 300_000,
    });
    return stdout.trim();
  } catch {
    return typeof fallback === "string" ? fallback.trim() : fallback;
  }
}

async function readAppVersion() {
  // Handles git and git-free (archive-bootstrapped) checkouts; see
  // scripts/lib/collector-source-version.mjs.
  return readCollectorAppVersion({
    appDir,
    collectorOnly,
    execText,
    readProjectCheckouts,
  });
}

async function readProjectRegistryProjects() {
  for (const file of projectRegistryPaths) {
    const raw = await readFile(expandHome(file), "utf8").catch(() => "");
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects)) return parsed.projects;
    } catch {
      // try next registry path
    }
  }
  return [];
}

async function readProjectCheckouts() {
  const projects = (await readProjectRegistryProjects()).slice(0, 25);
  // Each status runs up to 4 git children at once; a bounded pool keeps the
  // /health version refresh from bursting ~100 spawns (~300 pipe fds) at once.
  const checkouts = await mapWithConcurrency(projects, 6, (project) =>
    projectCheckoutStatus(project),
  );
  return checkouts.filter(Boolean);
}

async function projectCheckoutStatus(project) {
  const localPath = expandHome(String(project?.localPath || "").trim());
  if (!localPath) return null;
  const inside = await execTextAt(localPath, "git", [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (inside !== "true") return null;
  const repo =
    project?.gitlawbRepo && typeof project.gitlawbRepo === "object"
      ? project.gitlawbRepo
      : {};
  const [commit, branch, dirty, remoteUrl] = await Promise.all([
    execTextAt(localPath, "git", ["rev-parse", "HEAD"]),
    execTextAt(localPath, "git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    execTextAt(localPath, "git", ["status", "--porcelain"]),
    execTextAt(localPath, "git", ["config", "--get", "remote.origin.url"]),
  ]);
  const targetBranch = repo.branch || branch || "main";
  const remoteCommit = await execTextAt(localPath, "git", [
    "ls-remote",
    "origin",
    targetBranch,
  ]);
  const latestCommit = remoteCommit.split(/\s+/)[0] || commit;
  return {
    projectId: project.id,
    name: project.name,
    localPath,
    remoteUrl: repo.remoteUrl || remoteUrl,
    gitlawbRepoId: repo.repoId,
    gitlawbRepoName: repo.repoName,
    branch,
    commit,
    shortCommit: commit.slice(0, 7),
    dirty: dirty.length > 0,
    latestCommit,
    latestShortCommit: latestCommit.slice(0, 7),
    updateCommand: `cd ${JSON.stringify(localPath)} && git pull --ff-only`,
  };
}

async function appVersion(options = {}) {
  const now = Date.now();
  if (
    !options.force &&
    appVersionCache &&
    now - appVersionCache.checkedAt < appVersionCacheMs
  ) {
    return appVersionCache.value;
  }
  if (!options.force && appVersionPromise) return appVersionPromise;

  appVersionPromise = readAppVersion()
    .then((value) => {
      appVersionCache = { checkedAt: Date.now(), value };
      return value;
    })
    .finally(() => {
      appVersionPromise = null;
    });
  return appVersionPromise;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function safeFolderId(value) {
  return (
    String(value || "hivemindos-sync")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "hivemindos-sync"
  );
}

const readSyncthingApiKey = createSyncthingApiKeyResolver({
  configCandidates: [
    process.env.SYNCTHING_CONFIG_PATH,
    ...(allowCollectorAppDataReads ? defaultSyncthingConfigCandidates() : []),
  ].filter(Boolean),
});

async function resolveSyncthingBin() {
  if (process.env.SYNCTHING_BIN) return process.env.SYNCTHING_BIN;
  const candidates = [
    join(homedir(), ".local", "bin", "syncthing"),
    "/opt/homebrew/bin/syncthing",
    "/usr/local/bin/syncthing",
    "/usr/bin/syncthing",
  ];
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // try next
    }
  }
  return "syncthing";
}

async function syncthingInstalled() {
  const bin = await resolveSyncthingBin();
  return access(bin, constants.X_OK)
    .then(() => ({ installed: true, bin }))
    .catch(() => ({ installed: false, bin }));
}

async function resolveHiveEnvAdd() {
  // Cross-platform command + base argv (Windows Python-launcher handling lives
  // in the lib module). Callers spread `envSync.args` before their own flags
  // and pass `shell: Boolean(envSync.shell)`.
  return resolveHiveEnvAddCommand({ appDir });
}

function encodeEnvEntries(entries) {
  return (
    Object.entries(entries)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n"
  );
}

function runHiveEnvImport({ entries, scope = "agent", runtime = "generic" }) {
  return new Promise(async (resolveImport, rejectImport) => {
    const envSync = await resolveHiveEnvAdd();
    if (!envSync.ready) {
      rejectImport(
        new Error(
          envSync.error || "hive-env-add is not installed or executable.",
        ),
      );
      return;
    }
    const child = spawn(
      envSync.command,
      [
        ...envSync.args,
        "--import-stdin",
        "--scope",
        scope,
        "--runtime",
        runtime,
        "--no-backup",
        "--no-tailnet-sync",
      ],
      {
        stdio: ["pipe", "ignore", "pipe"],
        // .cmd wrappers (Windows fallback) must run through the shell to be spawnable.
        shell: Boolean(envSync.shell),
        windowsHide: true,
      },
    );
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectImport(new Error("Timed out while importing env variables."));
    }, 60_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectImport(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveImport();
        return;
      }
      rejectImport(
        new Error(
          errorText.trim() || "hive-env-add could not import env variables.",
        ),
      );
    });
    child.stdin.end(encodeEnvEntries(entries));
  });
}

function runHiveEnvE2eSync({ key, value, scope = "all", runtime = "generic" }) {
  return new Promise(async (resolveSync, rejectSync) => {
    if (!/^HIVE_E2E_[A-Z0-9_]+$/.test(key)) {
      rejectSync(new Error("E2E env sync only accepts HIVE_E2E_* keys."));
      return;
    }
    const envSync = await resolveHiveEnvAdd();
    if (!envSync.ready) {
      rejectSync(
        new Error(
          envSync.error || "hive-env-add is not installed or executable.",
        ),
      );
      return;
    }
    // The shell fallback joins argv into one unescaped cmd.exe line, so a
    // caller-supplied value must not be able to break out of the assignment.
    if (envSync.shell && !/^[A-Za-z0-9._:@/+-]*$/.test(value)) {
      rejectSync(
        new Error(
          "E2E env value contains characters that cannot be passed safely through the Windows shell fallback.",
        ),
      );
      return;
    }
    const child = spawn(
      envSync.command,
      [
        ...envSync.args,
        `${key}=${value}`,
        "--scope",
        scope,
        "--runtime",
        runtime,
        "--no-backup",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        shell: Boolean(envSync.shell),
        windowsHide: true,
      },
    );
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectSync(new Error("Timed out while running hive-env-add."));
    }, 90_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectSync(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveSync(output.trim());
        return;
      }
      rejectSync(new Error(output.trim() || "hive-env-add failed."));
    });
  });
}

const envSyncMaintenanceIntervalMs = Number(
  process.env.AGENT_TELEMETRY_ENV_SYNC_INTERVAL_MS || 10 * 60_000,
);
const envSyncMaintenanceEnabled =
  !/^(1|true|yes)$/i.test(process.env.AGENT_TELEMETRY_ENV_SYNC_DISABLED || "") &&
  Number.isFinite(envSyncMaintenanceIntervalMs) &&
  envSyncMaintenanceIntervalMs > 0;
let envSyncMaintenanceRunning = false;
let envSyncMaintenanceStatus = {
  enabled: envSyncMaintenanceEnabled,
  intervalMs: envSyncMaintenanceIntervalMs,
  lastRunAt: null,
  lastReason: null,
  lastSummary: null,
  lastError: null,
};

async function runEnvSyncMaintenance(reason) {
  if (envSyncMaintenanceRunning) return envSyncMaintenanceStatus;
  envSyncMaintenanceRunning = true;
  try {
    const envSync = await resolveHiveEnvAdd();
    if (!envSync.ready) {
      throw new Error(
        envSync.error || "hive-env-add is not installed or executable.",
      );
    }
    const { stdout } = await execFileAsync(
      envSync.command,
      [...envSync.args, "--sync-maintenance"],
      {
        timeout: 240_000,
        maxBuffer: 1_000_000,
        shell: Boolean(envSync.shell),
        windowsHide: true,
      },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    let summary;
    try {
      summary = JSON.parse(lines[lines.length - 1] || "{}");
    } catch {
      summary = { raw: stdout.trim().slice(0, 2000) };
    }
    envSyncMaintenanceStatus = {
      ...envSyncMaintenanceStatus,
      lastRunAt: new Date().toISOString(),
      lastReason: reason,
      lastSummary: summary,
      lastError: null,
    };
    const retried = summary?.retry?.retriedKeys?.length || 0;
    const pulled = summary?.pull?.pulled?.length || 0;
    if (retried || pulled) {
      console.log(
        `env sync maintenance (${reason}): retried ${retried} queued key(s), pulled ${pulled} key(s) from peers`,
      );
    }
  } catch (error) {
    envSyncMaintenanceStatus = {
      ...envSyncMaintenanceStatus,
      lastRunAt: new Date().toISOString(),
      lastReason: reason,
      lastError: error instanceof Error ? error.message : String(error),
    };
    console.warn(
      `env sync maintenance (${reason}) failed:`,
      envSyncMaintenanceStatus.lastError,
    );
  } finally {
    envSyncMaintenanceRunning = false;
  }
  return envSyncMaintenanceStatus;
}

function startEnvSyncMaintenance() {
  if (!envSyncMaintenanceEnabled) return;
  setTimeout(() => {
    void runEnvSyncMaintenance("startup");
  }, 45_000);
  setInterval(() => {
    void runEnvSyncMaintenance("interval");
  }, envSyncMaintenanceIntervalMs);
}

// ---------------------------------------------------------------------------
// Adaptive-model reliability gossip.
//
// The HivemindOS app grades OpenRouter free models per machine in
// ~/.hivemindos/openrouter-model-reliability.json (successes, capacity
// cooldowns, quality fails). The fleet shares one OpenRouter API key, so a
// rate limit observed on one machine applies everywhere — collectors gossip
// the store over the tailnet and merge newest-wins per model id. Payload is
// model ids and counters only: no secrets, and no tailnet IPs are persisted.
const reliabilityStoreFile = join(
  homedir(),
  ".hivemindos",
  "openrouter-model-reliability.json",
);
const reliabilitySyncIntervalMs = Number(
  process.env.AGENT_TELEMETRY_RELIABILITY_SYNC_INTERVAL_MS || 10 * 60_000,
);
const reliabilitySyncEnabled =
  Number.isFinite(reliabilitySyncIntervalMs) && reliabilitySyncIntervalMs > 0;
const reliabilityPeerTimeoutMs = 4_000;
// Fleet collectors all listen on the same port; the override exists so tests
// can run two instances side by side on one machine.
const reliabilityPeerPort = Number(
  process.env.AGENT_TELEMETRY_RELIABILITY_PEER_PORT || 0,
);
let reliabilitySyncRunning = false;
let reliabilitySyncStatus = {
  enabled: reliabilitySyncEnabled,
  intervalMs: reliabilitySyncIntervalMs,
  lastRunAt: null,
  lastReason: null,
  lastSummary: null,
  lastError: null,
};

async function readReliabilityStoreFile() {
  const raw = await readFile(reliabilityStoreFile, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.models === "object" && parsed.models) {
      return parsed;
    }
  } catch {
    /* corrupt store — treat as absent, the app rewrites it */
  }
  return null;
}

function reliabilityRecordFreshness(record) {
  if (!record || typeof record !== "object") return 0;
  return Math.max(
    Number(record.lastSuccessAt) || 0,
    Number(record.lastFailureAt) || 0,
  );
}

async function tailnetPeerHosts() {
  // Shared multi-candidate CLI resolution: a bare "tailscale" is not on PATH
  // for LaunchAgent/scheduled-task collectors (macOS GUI app, sparse PATH).
  const status = await tailscaleStatusJson();
  const peers = Object.values(status?.Peer ?? {});
  const hosts = [];
  for (const peer of peers) {
    if (peer?.Online === false) continue;
    const dnsName = String(peer?.DNSName || "").replace(/\.$/, "");
    const ip = Array.isArray(peer?.TailscaleIPs) ? peer.TailscaleIPs[0] : "";
    const host = dnsName || ip;
    if (host) hosts.push(host);
  }
  return hosts;
}

// The tailnet owner (LoginName) of THIS node, used to gate cross-machine runtime
// state transfers to the node owner's own fleet. Mirrors the trust model of
// hivemind-linkd shell.go requireTailnetSelfUser. Lives in lib/tailnet-self.mjs
// so it resolves the tailscale CLI from its known install locations — a bare
// "tailscale" is ENOENT under the sparse PATH of a LaunchAgent/scheduled-task
// collector, which made this gate fail closed for every linkd-stamped request
// (surfaced in the dashboard as remote task-permission approvals erroring out).
async function selfTailnetOwner() {
  return tailnetSelfOwner();
}

// Gate for cross-machine runtime-state transfers (the first authenticated
// mutation endpoints on this collector). Trust model:
//   - A request carrying x-hivemind-link-user / x-tailscale-user came through a
//     hivemind-linkd / tailscale-serve front, which DELETES any inbound copy and
//     re-stamps the value from a verified WhoIs — so the header is unforgeable.
//     Allow only when it matches THIS node's own tailnet owner (same-user fleet).
//   - A request with NO such header from loopback is the local app/script on
//     this machine — trusted (same user, same box).
//   - A request with NO such header from a non-loopback address is a raw tailnet
//     dial that bypassed the identity front (e.g. collector bound 0.0.0.0 with no
//     linkd). FAIL CLOSED — we cannot attribute it.
async function requireLinkOwner(request) {
  const user = String(
    request.headers["x-hivemind-link-user"] || request.headers["x-tailscale-user"] || "",
  ).trim();
  if (user) {
    const self = await selfTailnetOwner();
    if (!self) {
      return { ok: false, status: 503, error: "Runtime-state transfer unavailable: this node's tailnet owner is unknown." };
    }
    if (user.toLowerCase() !== self.toLowerCase()) {
      return { ok: false, status: 403, error: "Runtime-state transfer is limited to this node's owner." };
    }
    return { ok: true, user, via: "linkd" };
  }
  if (isLoopbackRemote(request)) {
    return { ok: true, user: "local", via: "loopback" };
  }
  return {
    ok: false,
    status: 403,
    error: "Runtime-state transfer requires a hivemind-linkd-fronted tailnet identity.",
  };
}

async function fleetPolicyCaller(request) {
  const auth = await requireLinkOwner(request);
  if (!auth.ok) return auth;
  if (auth.via === "loopback") {
    const machineId = await stableMachineId().catch(() => "");
    if (!machineId) return { ok: false, status: 503, error: "This hub's stable machine identity is unavailable." };
    return { ok: true, caller: { id: `machine:${machineId}`, label: hostname() } };
  }
  const node = String(
    request.headers["x-hivemind-link-node"] || request.headers["x-tailscale-node"] || "",
  ).replace(/[\r\n\0]/g, " ").trim().toLowerCase();
  if (!node) {
    return { ok: false, status: 403, error: "Machine policy changes require an attributed Hivemind Link node." };
  }
  return { ok: true, caller: { id: `tailnet-node:${node}`, label: node } };
}

async function runReliabilitySync(reason) {
  if (reliabilitySyncRunning) return reliabilitySyncStatus;
  reliabilitySyncRunning = true;
  try {
    const [local, selfMachineId, hosts] = await Promise.all([
      readReliabilityStoreFile(),
      stableMachineId().catch(() => ""),
      tailnetPeerHosts(),
    ]);
    const merged = { ...(local?.models ?? {}) };
    const seenMachineIds = new Set(selfMachineId ? [selfMachineId] : []);
    let peersConsulted = 0;
    let recordsAdopted = 0;
    for (const host of hosts) {
      let payload = null;
      try {
        const peerResponse = await fetch(
          `http://${host}:${reliabilityPeerPort || port}/reliability/openrouter`,
          { signal: AbortSignal.timeout(reliabilityPeerTimeoutMs) },
        );
        if (!peerResponse.ok) {
          await peerResponse.body?.cancel().catch(() => {});
          continue;
        }
        payload = await peerResponse.json();
      } catch {
        continue;
      }
      if (!payload?.ok || !payload.models || typeof payload.models !== "object")
        continue;
      // Every machine has two tailnet nodes (system + hivemind-linkd) that
      // reach the same collector — dedupe by machineId, and skip ourselves.
      if (payload.machineId) {
        if (seenMachineIds.has(payload.machineId)) continue;
        seenMachineIds.add(payload.machineId);
      }
      peersConsulted += 1;
      for (const [modelId, record] of Object.entries(payload.models)) {
        if (
          reliabilityRecordFreshness(record) >
          reliabilityRecordFreshness(merged[modelId])
        ) {
          merged[modelId] = record;
          recordsAdopted += 1;
        }
      }
    }
    if (recordsAdopted > 0) {
      const next = {
        updatedAt: new Date().toISOString(),
        models: merged,
      };
      // Atomic write: the app re-reads this file on a short TTL and must
      // never observe a partial JSON document.
      const tmpPath = `${reliabilityStoreFile}.${process.pid}.tmp`;
      await mkdir(dirname(reliabilityStoreFile), { recursive: true });
      await writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
      await rename(tmpPath, reliabilityStoreFile);
      console.log(
        `reliability sync (${reason}): adopted ${recordsAdopted} fresher model record(s) from ${peersConsulted} peer(s)`,
      );
    }
    reliabilitySyncStatus = {
      ...reliabilitySyncStatus,
      lastRunAt: new Date().toISOString(),
      lastReason: reason,
      lastSummary: { peersConsulted, recordsAdopted, peerHosts: hosts.length },
      lastError: null,
    };
  } catch (error) {
    reliabilitySyncStatus = {
      ...reliabilitySyncStatus,
      lastRunAt: new Date().toISOString(),
      lastReason: reason,
      lastError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    reliabilitySyncRunning = false;
  }
  return reliabilitySyncStatus;
}

function startReliabilitySync() {
  if (!reliabilitySyncEnabled) return;
  setTimeout(() => {
    void runReliabilitySync("startup");
  }, 60_000);
  setInterval(() => {
    void runReliabilitySync("interval");
  }, reliabilitySyncIntervalMs);
}

// ---------------------------------------------------------------------------
// Runtime-state sync (Mechanism C) — off by default. Pull-only: each machine
// pulls every same-owner peer's portable runtime state and reconciles it into
// its OWN runtime dirs (backup-first, 3-way merge, conflict-copies). No machine
// writes another's disk; every transport is linkd-owner-gated (requireLinkOwner
// on the peer's export endpoint). Mirrors runReliabilitySync's loop/gossip shape.
// ---------------------------------------------------------------------------
const runtimeStateSyncConfigPath = join(homedir(), ".hivemindos", "runtime-state-sync.json");
const runtimeStateSyncIntervalMs = Number(
  process.env.AGENT_TELEMETRY_RUNTIME_SYNC_INTERVAL_MS || 10 * 60_000,
);
const runtimeStatePeerPort = Number(process.env.AGENT_TELEMETRY_RUNTIME_SYNC_PEER_PORT || 0);
let runtimeStateSyncConfig = null;
let runtimeStateSyncRunning = false;
let runtimeStateSyncTimer = null;
let runtimeStateSyncStatus = {
  enabled: false,
  intervalMs: runtimeStateSyncIntervalMs,
  lastRunAt: null,
  lastReason: null,
  lastSummary: null,
  lastError: null,
};

function isRuntimeStateSyncEnabled() {
  return runtimeStateSyncConfig?.enabled === true;
}

function syncableRuntimes(config = runtimeStateSyncConfig) {
  const all = portableStateRuntimes();
  const wanted = Array.isArray(config?.runtimes) && config.runtimes.length ? config.runtimes : all;
  return all.filter((r) => wanted.includes(r));
}

async function readRuntimeStateSyncConfig() {
  const raw = await readFile(runtimeStateSyncConfigPath, "utf-8").catch(() => "");
  if (!raw.trim()) return { enabled: false, runtimes: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled === true,
      runtimes: Array.isArray(parsed.runtimes) ? parsed.runtimes.map(String) : [],
    };
  } catch {
    return { enabled: false, runtimes: [] };
  }
}

async function writeRuntimeStateSyncConfig(config) {
  await mkdir(dirname(runtimeStateSyncConfigPath), { recursive: true, mode: 0o700 });
  await writeFile(runtimeStateSyncConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

// Pull one peer's export for one runtime and reconcile it locally.
async function reconcileRuntimeFromPeer(runtime, host, selfMachineId, seen) {
  let response;
  try {
    response = await fetch(
      `http://${host}:${runtimeStatePeerPort || port}/runtimes/${runtime}/export-runtime-state`,
      { method: "POST", signal: AbortSignal.timeout(30_000) },
    );
  } catch {
    return null; // peer offline / not reachable
  }
  if (!response.ok) {
    // 403/404/etc — not a same-owner runtime-state collector. Cancel the body
    // so the socket doesn't dangle for the full 30s abort window.
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const peerMachineId = String(response.headers.get("x-hivemind-machine-id") || "").trim();
  if (peerMachineId) {
    if (peerMachineId === selfMachineId || seen.has(peerMachineId)) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    seen.add(peerMachineId);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpTar = join(
    homedir(),
    ".hivemindos",
    "runtime-sync-tmp",
    `${runtime}-${randomBytes(6).toString("hex")}.tar.gz`,
  );
  await mkdir(dirname(tmpTar), { recursive: true, mode: 0o700 });
  await writeFile(tmpTar, buffer);
  const snapDir = join(dirname(tmpTar), `snap-${randomBytes(6).toString("hex")}`);
  try {
    await unpackTarToDir(tmpTar, snapDir);
    const result = await reconcilePortableState(runtime, snapDir, {
      peerKey: peerMachineId || host,
      peerLabel: String(host).split(".")[0] || host,
      sharedVaultPath: defaultSyncPath,
    });
    return result;
  } finally {
    await rm(tmpTar, { force: true });
    await rm(snapDir, { recursive: true, force: true });
  }
}

async function runRuntimeStateSync(reason) {
  if (runtimeStateSyncRunning) return runtimeStateSyncStatus;
  runtimeStateSyncConfig = runtimeStateSyncConfig ?? (await readRuntimeStateSyncConfig());
  if (!isRuntimeStateSyncEnabled()) return runtimeStateSyncStatus;
  runtimeStateSyncRunning = true;
  try {
    const [selfMachineId, hosts] = await Promise.all([
      stableMachineId().catch(() => ""),
      tailnetPeerHosts().catch(() => []),
    ]);
    const runtimes = syncableRuntimes();
    const seen = new Set();
    let adopted = 0;
    let deleted = 0;
    let conflicts = 0;
    let peersConsulted = 0;
    for (const runtime of runtimes) {
      const perRuntimeSeen = new Set(seen);
      for (const host of hosts) {
        const result = await reconcileRuntimeFromPeer(runtime, host, selfMachineId, perRuntimeSeen).catch(
          () => null,
        );
        if (!result) continue;
        peersConsulted += 1;
        adopted += result.adopted.length;
        deleted += result.deleted.length;
        conflicts += result.conflicts.length;
      }
    }
    runtimeStateSyncStatus = {
      ...runtimeStateSyncStatus,
      enabled: true,
      lastRunAt: new Date().toISOString(),
      lastReason: reason,
      lastSummary: { runtimes, peersConsulted, adopted, deleted, conflicts },
      lastError: null,
    };
    if (adopted || deleted || conflicts) {
      console.log(
        `runtime-state sync (${reason}): adopted ${adopted}, deleted ${deleted}, conflicts ${conflicts} across ${runtimes.length} runtime(s)`,
      );
    }
  } catch (error) {
    runtimeStateSyncStatus = {
      ...runtimeStateSyncStatus,
      lastRunAt: new Date().toISOString(),
      lastReason: reason,
      lastError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    runtimeStateSyncRunning = false;
  }
  return runtimeStateSyncStatus;
}

function stopRuntimeStateSync() {
  if (runtimeStateSyncTimer) clearInterval(runtimeStateSyncTimer);
  runtimeStateSyncTimer = null;
}

function startRuntimeStateSync() {
  stopRuntimeStateSync();
  runtimeStateSyncStatus = { ...runtimeStateSyncStatus, enabled: isRuntimeStateSyncEnabled() };
  if (!isRuntimeStateSyncEnabled()) return;
  setTimeout(() => {
    void runRuntimeStateSync("startup");
  }, 60_000);
  runtimeStateSyncTimer = setInterval(() => {
    void runRuntimeStateSync("interval");
  }, runtimeStateSyncIntervalMs);
}

async function configureRuntimeStateSync(input) {
  runtimeStateSyncConfig = {
    enabled: input.enabled === true,
    runtimes: Array.isArray(input.runtimes) ? input.runtimes.map(String) : [],
    updatedAt: new Date().toISOString(),
  };
  await writeRuntimeStateSyncConfig(runtimeStateSyncConfig);
  startRuntimeStateSync();
  return {
    ok: true,
    host: hostname(),
    enabled: isRuntimeStateSyncEnabled(),
    runtimes: syncableRuntimes(runtimeStateSyncConfig),
  };
}

async function initializeRuntimeStateSync() {
  runtimeStateSyncConfig = await readRuntimeStateSyncConfig();
  startRuntimeStateSync();
}

function startSyncthingDetached() {
  const runner = join(appDir, "scripts", "run-syncthing.sh");
  const child = spawn(runner, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      SYNCTHING_GUI_ADDRESS: "127.0.0.1:8384",
    },
  });
  child.unref();
}

async function startSyncthingViaServiceManager() {
  // The installer-managed service must stay the single owner of the Syncthing
  // database: a raw detached spawn races the unit for the DB lock and leaves
  // the loser crash-looping (hel1-2 reached 400k+ restarts). Only fall back
  // to a detached spawn when no service-manager path works.
  if (process.platform === "darwin") {
    await execFileAsync(
      "launchctl",
      ["kickstart", `gui/${process.getuid()}/com.hivemindos.syncthing`],
      { timeout: 10_000 },
    );
    return;
  }
  if (process.platform === "linux") {
    await execFileAsync(
      "systemctl",
      ["--user", "start", "hivemindos-syncthing.service"],
      {
        timeout: 10_000,
        env: {
          ...process.env,
          XDG_RUNTIME_DIR:
            process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`,
        },
      },
    );
    return;
  }
  throw new Error(`no syncthing service manager on ${process.platform}`);
}

async function syncthingFetch(path, options = {}) {
  const apiKey = await readSyncthingApiKey();
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${syncthingApiBaseUrl}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(options.timeoutMs || 8_000),
  });
  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(
      data?.error ||
        data?.raw ||
        `Syncthing API ${path} returned HTTP ${response.status}`,
    );
  }
  return data;
}

async function waitForSyncthing() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const ping = await syncthingFetch("/rest/system/ping", {
        timeoutMs: 2_000,
      });
      if (ping?.ping === "pong") return true;
    } catch {
      if (attempt === 0) {
        try {
          await startSyncthingViaServiceManager();
        } catch {
          try {
            startSyncthingDetached();
          } catch {
            // setup normally owns service startup; keep polling.
          }
        }
      }
      await sleep(1_000);
    }
  }
  return false;
}

async function syncthingStatus() {
  const install = await syncthingInstalled();
  if (!install.installed) {
    return {
      ok: false,
      installed: false,
      running: false,
      error: "Syncthing is not installed. Run setup on this machine.",
    };
  }
  const running = await waitForSyncthing();
  if (!running) {
    return {
      ok: false,
      installed: true,
      running: false,
      error: "Syncthing is installed but its local API is not reachable.",
    };
  }
  const [system, version, connections] = await Promise.all([
    syncthingFetch("/rest/system/status"),
    syncthingFetch("/rest/system/version").catch(() => null),
    syncthingFetch("/rest/system/connections").catch(() => null),
  ]);
  return {
    ok: true,
    installed: true,
    running: true,
    host: hostname(),
    deviceID: system.myID,
    guiAddress: syncthingApiBaseUrl,
    defaultSyncPath,
    version: version?.version,
    connections,
  };
}

function folderMatchesPath(folder, targetPath) {
  if (!targetPath) return false;
  const folderPath = resolve(
    expandHome(String(folder?.path || "").trim()) || "",
  );
  const target = resolve(expandHome(String(targetPath).trim()) || "");
  if (!folderPath || !target) return false;
  return (
    folderPath === target ||
    folderPath.startsWith(`${target}/`) ||
    target.startsWith(`${folderPath}/`)
  );
}

// Reports per-folder completion (% complete + need bytes) and per-paired-device
// completion. `path` narrows to the vault folder if multiple Syncthing folders exist.
async function syncthingFolderStatus(input = {}) {
  const install = await syncthingInstalled();
  if (!install.installed) {
    return {
      ok: false,
      installed: false,
      running: false,
      error: "Syncthing is not installed on this machine.",
    };
  }
  const running = await waitForSyncthing();
  if (!running) {
    return {
      ok: false,
      installed: true,
      running: false,
      error: "Syncthing local API is not reachable.",
    };
  }
  const [config, system] = await Promise.all([
    syncthingFetch("/rest/config"),
    syncthingFetch("/rest/system/status").catch(() => null),
  ]);
  const myID = system?.myID || config?.myID;
  const targetPath = input.path ? expandHome(String(input.path).trim()) : "";
  const requestedFolderId = input.folderId ? safeFolderId(input.folderId) : "";
  const allFolders = Array.isArray(config?.folders) ? config.folders : [];
  const matched = allFolders.filter((folder) => {
    if (requestedFolderId) return folder.id === requestedFolderId;
    if (targetPath) return folderMatchesPath(folder, targetPath);
    return true;
  });
  const folders = matched.length ? matched : allFolders;

  const deviceNames = new Map();
  for (const device of Array.isArray(config?.devices) ? config.devices : []) {
    if (device?.deviceID)
      deviceNames.set(
        device.deviceID,
        device.name || device.deviceID.slice(0, 7),
      );
  }

  const reported = await Promise.all(
    folders.map(async (folder) => {
      const folderId = folder.id;
      const aggregate = await syncthingFetch(
        `/rest/db/completion?folder=${encodeURIComponent(folderId)}`,
      ).catch(() => null);
      const peerIds = (Array.isArray(folder.devices) ? folder.devices : [])
        .map((device) => device.deviceID)
        .filter((deviceID) => deviceID && deviceID !== myID);
      const devices = await Promise.all(
        peerIds.map(async (deviceID) => {
          const completion = await syncthingFetch(
            `/rest/db/completion?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(deviceID)}`,
          ).catch(() => null);
          return {
            deviceID,
            name: deviceNames.get(deviceID) || deviceID.slice(0, 7),
            completion:
              typeof completion?.completion === "number"
                ? completion.completion
                : null,
            remoteState:
              typeof completion?.remoteState === "string"
                ? completion.remoteState
                : null,
            needBytes:
              typeof completion?.needBytes === "number"
                ? completion.needBytes
                : null,
            needItems:
              typeof completion?.needItems === "number"
                ? completion.needItems
                : null,
          };
        }),
      );
      return {
        folderId,
        label: folder.label || folderId,
        path: folder.path,
        paused: Boolean(folder.paused),
        completion:
          typeof aggregate?.completion === "number"
            ? aggregate.completion
            : null,
        needBytes:
          typeof aggregate?.needBytes === "number" ? aggregate.needBytes : null,
        needItems:
          typeof aggregate?.needItems === "number" ? aggregate.needItems : null,
        devices,
      };
    }),
  );

  return {
    ok: true,
    installed: true,
    running: true,
    host: hostname(),
    folders: reported,
  };
}

async function syncthingRescan(input = {}) {
  const install = await syncthingInstalled();
  if (!install.installed) {
    return {
      ok: false,
      installed: false,
      running: false,
      error: "Syncthing is not installed on this machine.",
    };
  }
  const running = await waitForSyncthing();
  if (!running) {
    return {
      ok: false,
      installed: true,
      running: false,
      error: "Syncthing local API is not reachable.",
    };
  }
  let folderId = input.folderId ? safeFolderId(input.folderId) : "";
  if (!folderId && input.path) {
    const config = await syncthingFetch("/rest/config").catch(() => null);
    const folder = (Array.isArray(config?.folders) ? config.folders : []).find(
      (entry) => folderMatchesPath(entry, input.path),
    );
    folderId = folder?.id || "";
  }
  const scanPath = folderId
    ? `/rest/db/scan?folder=${encodeURIComponent(folderId)}`
    : "/rest/db/scan";
  await syncthingFetch(scanPath, { method: "POST", timeoutMs: 15_000 });
  return { ok: true, folderId: folderId || null, rescanned: true };
}

const syncthingRepair = createSyncthingRepair({
  expandHome,
  folderMatchesPath,
  safeFolderId,
  sleep,
  syncthingFetch,
  syncthingFolderStatus,
  syncthingInstalled,
  waitForSyncthing,
});

const configureSyncthingFolder = createConfigureSyncthingFolder({
  expandHome,
  safeFolderId,
  syncthingFetch,
  waitForSyncthing,
});

function safeSyncTestId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) {
    throw new Error(
      "id must be 1-80 characters using letters, numbers, dot, underscore, or dash.",
    );
  }
  return id;
}

function syncTestNotePath(root, id) {
  const base = resolve(expandHome(String(root || "").trim()));
  if (!base || base === resolve("/")) throw new Error("root is required.");
  const testDir = resolve(base, ".hivemindos-sync-test");
  const notePath = resolve(testDir, `${safeSyncTestId(id)}.md`);
  if (!notePath.startsWith(`${testDir}/`))
    throw new Error("Invalid test note path.");
  return { base, testDir, notePath };
}

async function syncthingTestNote(input) {
  const action = String(input.action || "read").trim();
  const { base, testDir, notePath } = syncTestNotePath(input.root, input.id);
  if (action === "write") {
    await mkdir(testDir, { recursive: true, mode: 0o700 });
    const content = String(input.content ?? "");
    await writeFile(notePath, content, "utf8");
    return {
      ok: true,
      host: hostname(),
      action,
      root: base,
      path: notePath,
      bytes: Buffer.byteLength(content),
    };
  }
  if (action === "read") {
    const content = await readFile(notePath, "utf8");
    return {
      ok: true,
      host: hostname(),
      action,
      root: base,
      path: notePath,
      content,
    };
  }
  if (action === "exists") {
    const exists = await access(notePath, constants.F_OK)
      .then(() => true)
      .catch(() => false);
    return {
      ok: true,
      host: hostname(),
      action,
      root: base,
      path: notePath,
      exists,
    };
  }
  if (action === "delete") {
    await rm(notePath, { force: true });
    return {
      ok: true,
      host: hostname(),
      action,
      root: base,
      path: notePath,
      deleted: true,
    };
  }
  throw new Error("action must be write, read, exists, or delete.");
}

async function resolveHermesBin() {
  if (process.env.HERMES_BIN) return process.env.HERMES_BIN;
  const candidates = [
    join(homedir(), ".local", "bin", "hermes"),
    "/usr/local/bin/hermes",
    "/opt/homebrew/bin/hermes",
    "/usr/bin/hermes",
  ];
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // try next
    }
  }
  return "hermes";
}

async function resolveHermesPython() {
  const candidates = [
    process.env.HERMES_PYTHON,
    process.platform === "win32"
      ? join(hermesAgentProjectDir, "venv", "Scripts", "python.exe")
      : join(hermesAgentProjectDir, "venv", "bin", "python"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("Hermes' Python runtime was not found.");
}

async function resolveHermesStreamingLaunch(args) {
  // Explicit HERMES_BIN overrides are commonly test doubles or custom wrappers;
  // preserve them unless their owner also supplies the matching Python runtime.
  if (process.env.HERMES_BIN && !process.env.HERMES_PYTHON) {
    return { command: await resolveHermesBin(), args };
  }
  try {
    return {
      command: await resolveHermesPython(),
      args: [hermesHivemindStreamBridge, ...args],
    };
  } catch {
    return { command: await resolveHermesBin(), args };
  }
}

async function repairHermesCodexAuthBeforeChat(agent, hermesHome) {
  if (!hermesAgentUsesCodex(agent)) return;
  try {
    const result = await repairHermesCodexAuth({
      hermesHome,
      projectDir: hermesAgentProjectDir,
      pythonPath: await resolveHermesPython(),
      execFileAsync,
    });
    if (result.status === "repaired") {
      console.info(
        `[collector] Recovered Hermes Codex auth for ${hermesHome} from the current Codex CLI login.`,
      );
    }
  } catch (error) {
    console.warn(
      `[collector] Hermes Codex auth preflight could not run for ${hermesHome}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function resolveBillingSafeOpenAiAgent(agent, hermesHome, sharedHiveEnv) {
  const fallbackSelection = await readHermesModelConfig(hermesHome);
  const selection = resolvePreferredOpenAiAgentSelection({
    agent,
    processEnv: process.env,
    sharedEnv: sharedHiveEnv,
    fallbackSelection,
  });
  if (selection.redirectedFromApiKey) {
    const agentId = safeTelemetryText(agent.id || agent.agentId || "", 120);
    console.warn(
      `[collector] Blocked API-key billing for ${agentId || "an agent"} because ChatGPT OAuth is configured; routing ${selection.requestedProvider || "openai"}/${selection.requestedModel || "default"} through openai-codex instead.`,
    );
    void recordCollectorTelemetry("openai.oauth_billing_guard.enforced", {
      agentId: agentId || null,
      requestedProvider: safeTelemetryText(selection.requestedProvider, 120),
      requestedModel: safeTelemetryText(selection.requestedModel, 160),
      effectiveProvider: "openai-codex",
      effectiveModel: safeTelemetryText(selection.profile.model || "", 160),
    });
  }
  return selection;
}

async function resolveChatWorkingDirectory(input) {
  const candidate = typeof input === "string" ? expandHome(input.trim()) : "";
  if (!candidate) return appDir;
  try {
    const entry = await stat(candidate);
    return entry.isDirectory() ? candidate : appDir;
  } catch {
    return appDir;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runHermes(args, timeout = 10_000, envExtra = {}) {
  const { stdout, stderr } = await execFileAsync(
    await resolveHermesBin(),
    args,
    {
      timeout,
      maxBuffer: 2_000_000,
      env: { ...process.env, ...envExtra },
    },
  );
  return `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
}

async function runHermesStdout(args, timeout = 10_000, envExtra = {}) {
  const { stdout } = await execFileAsync(await resolveHermesBin(), args, {
    timeout,
    maxBuffer: 2_000_000,
    env: { ...process.env, ...envExtra },
  });
  return stdout.trim();
}

async function hermesSlashCommandCatalog(agent = {}) {
  const hermesHome = expandHome(
    sanitizeLocalDataDir(agent.localDataDir) || defaultHermesDir,
  );
  const cached = slashCommandCatalogCache.get(hermesHome);
  if (cached && Date.now() - cached.at < slashCommandCatalogCacheMs) {
    return cached.commands;
  }
  const { stdout } = await execFileAsync(
    await resolveHermesPython(),
    ["-c", HERMES_SLASH_COMMAND_CATALOG_SCRIPT],
    {
      timeout: 10_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, HERMES_HOME: hermesHome },
    },
  );
  const parsed = JSON.parse(stdout);
  const commands = (Array.isArray(parsed?.commands) ? parsed.commands : [])
    .filter((command) => command && typeof command === "object")
    .map((command) => ({
      name: String(command.name || "").trim().replace(/^\/+/, ""),
      description: String(command.description || "").trim(),
      category: String(command.category || "Other").trim(),
      argsHint:
        typeof command.argsHint === "string" && command.argsHint.trim()
          ? command.argsHint.trim()
          : null,
      aliases: Array.isArray(command.aliases)
        ? command.aliases
            .filter((alias) => typeof alias === "string" && alias.trim())
            .map((alias) => alias.trim())
        : [],
    }))
    .filter((command) => command.name);
  slashCommandCatalogCache.set(hermesHome, { at: Date.now(), commands });
  return commands;
}

async function hermesIntegrationStatus(agent = {}) {
  const hermesHome = expandHome(
    sanitizeLocalDataDir(agent.localDataDir) || defaultHermesDir,
  );
  const diagnostics = [];
  const [version, tools, config, modelSelection, sieStatus] = await Promise.all([
    runHermes(["--version"]).catch((error) => {
      diagnostics.push(
        error instanceof Error ? error.message : "Hermes version check failed.",
      );
      return "";
    }),
    runHermes(["tools", "list"]).catch(() => ""),
    readFile(join(hermesHome, "config.yaml"), "utf8").catch(() => ""),
    resolveHermesPython()
      .then((pythonPath) =>
        readHermesModelSelection({
          hermesHome,
          projectDir: hermesAgentProjectDir,
          pythonPath,
          execFileAsync,
        }),
      )
      .catch((error) => {
        diagnostics.push(
          `Hermes model inventory unavailable: ${error instanceof Error ? error.message : "model discovery failed."}`,
        );
        return undefined;
      }),
    String(agent.provider || "") === "sie"
      ? readSieStatus(agent)
      : Promise.resolve(undefined),
  ]);
  if (sieStatus?.error) diagnostics.push(`SIE model discovery unavailable: ${sieStatus.error}`);
  if (sieStatus?.healthError) diagnostics.push(`SIE health telemetry unavailable: ${sieStatus.healthError}`);
  const effectiveModelSelection = sieStatus
    ? (() => {
        const providers = [...(modelSelection?.providers || [])];
        const models = sieStatus.models.filter((model) => model.chatCompatible).map((model) => ({
          id: model.key,
          name: model.displayName,
          subtitle: model.state === "loaded" ? "Warm" : model.state === "loading" ? "Warming" : model.state === "failed" ? "Failed" : "Lazy",
          group: model.tasks.join(" · "),
          badge: "SIE",
        }));
        const providerEntry = {
          slug: "sie",
          name: "SIE",
          models,
          totalModels: models.length,
          isCurrent: true,
          isUserDefined: true,
          source: `${sieStatus.baseUrl}/v1/models`,
        };
        const existingIndex = providers.findIndex((provider) => provider.slug === "sie");
        if (existingIndex >= 0) providers[existingIndex] = { ...providers[existingIndex], ...providerEntry };
        else providers.push(providerEntry);
        return { provider: "sie", model: String(agent.model || "").trim() || models[0]?.id || "", providers };
      })()
    : modelSelection;
  const toolEnabled = (name) =>
    new RegExp(`✓\\s+enabled\\s+${escapeRegExp(name)}\\b`).test(tools);
  const codexConfigured =
    /provider:\s*openai-codex\b|codex_app_server|codex-runtime/i.test(config);
  const kanbanAuto = /auto_decompose:\s*true/i.test(config);
  const hermesDb = join(hermesHome, "state.db");
  const sessionStoreReadable = await access(hermesDb, constants.R_OK)
    .then(() => true)
    .catch(() => false);
  if (version.trim()) diagnostics.push(version.trim());
  return {
    runtime: "hermes",
    machine: { host: hostname(), collectorUrl: `http://${hostname()}:${port}` },
    capabilities: {
      status: true,
      chat: true,
      runs: true,
      memory: true,
      sessionSearch: true,
      backgroundTasks: true,
      xSearch: true,
      socialPosting: false,
      imageGeneration: true,
      videoGeneration: true,
      codexRuntime: true,
      kanbanDecompose: true,
      setup: true,
      modelSelection: true,
    },
    modelSelection: effectiveModelSelection,
    providerStatus: sieStatus ? { sie: sieStatus } : undefined,
    integrations: {
      modelSelection: {
        supported: true,
        enabled: Boolean(effectiveModelSelection?.providers?.length),
        detail: effectiveModelSelection?.providers?.length
          ? `Hermes reported ${effectiveModelSelection.providers.length} configured provider${effectiveModelSelection.providers.length === 1 ? "" : "s"}.`
          : "Hermes did not report any configured model providers.",
      },
      sessionSearch: {
        supported: true,
        enabled: sessionStoreReadable,
        detail: sessionStoreReadable
          ? "Hermes session store is readable."
          : "Hermes session store was not found.",
      },
      backgroundTasks: {
        supported: true,
        enabled: Boolean(version.trim()),
        detail: version.trim()
          ? "Run Hermes tasks in the background while chat stays available."
          : "Hermes CLI was not found.",
      },
      xSearch: {
        supported: true,
        enabled: toolEnabled("x_search"),
        detail: toolEnabled("x_search")
          ? "x_search is enabled for CLI."
          : "Enable x_search after xAI OAuth or XAI_API_KEY is configured.",
      },
      socialPosting: {
        supported: false,
        enabled: false,
        detail:
          "Hermes exposes X search natively here; posting should remain a skill/plugin action.",
      },
      imageGeneration: {
        supported: true,
        enabled: toolEnabled("image_gen"),
        detail: toolEnabled("image_gen")
          ? "image_generate is enabled for CLI."
          : "Enable image_gen before asking Hermes to create images.",
      },
      ttsGeneration: {
        supported: false,
        enabled: false,
        detail:
          "tts_gen is reserved for future runtime speech-generation support.",
      },
      musicGeneration: {
        supported: false,
        enabled: false,
        detail:
          "music-gen is reserved for future runtime music-generation support.",
      },
      sfxGeneration: {
        supported: false,
        enabled: false,
        detail:
          "sfx_gen is reserved for future runtime sound-effect generation support.",
      },
      model3dGeneration: {
        supported: false,
        enabled: false,
        detail: "3d_gen is reserved for future runtime 3D-generation support.",
      },
      videoGeneration: {
        supported: true,
        enabled: toolEnabled("video_gen"),
        detail: toolEnabled("video_gen")
          ? "video_generate is enabled for CLI."
          : "Enable video_gen before asking Hermes to create videos.",
      },
      codexRuntime: {
        supported: true,
        enabled: codexConfigured,
        detail: codexConfigured
          ? "Codex/OpenAI path is present in Hermes config."
          : "Use Hermes Codex auth/runtime setup before routing coding work through Codex.",
      },
      kanbanDecompose: {
        supported: true,
        enabled: kanbanAuto,
        detail: kanbanAuto
          ? "Hermes auto_decompose is on."
          : "Hermes can decompose Kanban triage tasks manually.",
      },
    },
    diagnostics,
  };
}

const collectorMessagingChannels = createCollectorMessagingChannelBridge({
  defaultHermesDir,
  expandHome,
  getHostname: hostname,
  localAgents,
  runHermesStdout,
  sanitizeLocalDataDir,
});

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function getConfigPath(obj, path) {
  let current = obj;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function splitOpenClawModelRef(value) {
  const text = String(value || "").trim();
  const slash = text.indexOf("/");
  if (slash <= 0 || slash >= text.length - 1) return null;
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

function openClawProviderName(slug) {
  const known = new Map(
    Object.entries({
      openai: "OpenAI",
      "openai-codex": "OpenAI Codex",
      xai: "xAI",
      anthropic: "Anthropic",
      google: "Google",
      openrouter: "OpenRouter",
    }),
  );
  if (known.has(slug)) return known.get(slug);
  return (
    String(slug || "")
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) =>
        part.toLowerCase() === "ai"
          ? "AI"
          : part.slice(0, 1).toUpperCase() + part.slice(1),
      )
      .join(" ") || String(slug || "")
  );
}

function openClawModelOptions(value) {
  if (Array.isArray(value)) {
    return value
      .map((model) =>
        typeof model === "string" ? { id: model } : asRecord(model),
      )
      .map((model) => ({
        id: typeof model.id === "string" ? model.id : "",
        name: typeof model.name === "string" ? model.name : undefined,
      }))
      .filter((model) => model.id);
  }
  return Object.entries(asRecord(value))
    .map(([id, meta]) => ({
      id,
      name:
        typeof asRecord(meta).name === "string"
          ? asRecord(meta).name
          : undefined,
    }))
    .filter((model) => model.id);
}

function defaultOpenClawAgentModel(config) {
  const agents = asRecord(config.agents);
  const list = Array.isArray(agents.list)
    ? agents.list.filter((item) => item && typeof item === "object")
    : [];
  const agent = list.find((item) => item.default === true) || list[0];
  return typeof agent?.model === "string"
    ? agent.model
    : typeof getConfigPath(config, "agents.defaults.model.primary") === "string"
      ? getConfigPath(config, "agents.defaults.model.primary")
      : typeof getConfigPath(config, "agents.defaults.model") === "string"
        ? getConfigPath(config, "agents.defaults.model")
        : "";
}

function openClawConfiguredModelRefs(config) {
  const refs = new Set();
  const add = (value) => {
    if (typeof value === "string" && splitOpenClawModelRef(value))
      refs.add(value);
  };
  add(defaultOpenClawAgentModel(config));
  for (const agent of Array.isArray(asRecord(config.agents).list)
    ? asRecord(config.agents).list
    : []) {
    add(asRecord(agent).model);
  }
  for (const value of Object.keys(
    asRecord(getConfigPath(config, "agents.defaults.models")),
  ))
    add(value);
  return [...refs];
}

function openClawConfiguredProviders(config, extraRefs = []) {
  const providers = new Map();
  for (const [slug, rawProvider] of Object.entries(
    asRecord(getConfigPath(config, "models.providers")),
  )) {
    const provider = asRecord(rawProvider);
    const models = openClawModelOptions(provider.models);
    if (!models.length) continue;
    providers.set(slug, {
      name:
        typeof provider.name === "string"
          ? provider.name
          : openClawProviderName(slug),
      models,
      source: "~/.openclaw/openclaw.json",
      isUserDefined: true,
    });
  }
  for (const ref of [...openClawConfiguredModelRefs(config), ...extraRefs]) {
    const parsed = splitOpenClawModelRef(ref);
    if (!parsed) continue;
    const existing = providers.get(parsed.provider);
    if (existing) {
      if (!existing.models.some((model) => model.id === parsed.model))
        existing.models.unshift({ id: parsed.model });
    } else {
      providers.set(parsed.provider, {
        name: openClawProviderName(parsed.provider),
        models: [{ id: parsed.model }],
        source: "~/.openclaw/openclaw.json",
        isUserDefined: true,
      });
    }
  }
  return providers;
}

async function readOpenClawConfig() {
  const configPath = join(defaultOpenClawDir, "openclaw.json");
  const raw = await readFile(configPath, "utf8").catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw.replace(/\/\/[^\n]*/g, ""));
  } catch {
    return {};
  }
}

async function openClawIntegrationStatus(agent = {}) {
  const config = await readOpenClawConfig();
  const profileProvider = String(agent.provider || "").trim();
  const profileModel = String(agent.model || "").trim();
  const configuredDefault = defaultOpenClawAgentModel(config);
  const profilePair =
    profileProvider && profileModel ? `${profileProvider}/${profileModel}` : "";
  const providers = openClawConfiguredProviders(
    config,
    profilePair ? [profilePair] : [],
  );
  const current = profilePair || configuredDefault;
  const parsed = current ? splitOpenClawModelRef(current) : null;
  const firstProvider = providers.entries().next().value;
  const provider = parsed?.provider || firstProvider?.[0] || profileProvider;
  const model =
    parsed?.model || firstProvider?.[1]?.models?.[0]?.id || profileModel;
  if (provider && model && !providers.has(provider)) {
    providers.set(provider, {
      name: openClawProviderName(provider),
      models: [{ id: model }],
      source:
        providers.size === 0
          ? "current-agent-model"
          : "~/.openclaw/openclaw.json",
      isUserDefined: true,
    });
  } else if (
    provider &&
    model &&
    !providers.get(provider).models.some((item) => item.id === model)
  ) {
    providers.get(provider).models.unshift({ id: model });
  }
  const configReadable = await access(
    join(defaultOpenClawDir, "openclaw.json"),
    constants.R_OK,
  )
    .then(() => true)
    .catch(() => false);
  return {
    runtime: "openclaw",
    machine: { host: hostname(), collectorUrl: `http://${hostname()}:${port}` },
    capabilities: runtimeCapabilitiesFor("openclaw"),
    modelSelection: {
      provider,
      model,
      providers: [...providers.entries()].map(([slug, item]) => ({
        slug,
        name: item.name,
        models: item.models,
        totalModels: item.models.length,
        isCurrent: slug === provider,
        isUserDefined: item.isUserDefined,
        source: item.source,
      })),
    },
    integrations: {
      modelSelection: {
        supported: true,
        enabled: configReadable,
        detail: configReadable
          ? "OpenClaw model config is readable."
          : "OpenClaw config was not found.",
      },
    },
    diagnostics: configReadable ? [] : ["OpenClaw config was not found."],
  };
}

async function codexIntegrationStatus(agent = {}) {
  const command = await resolveCliRuntimeCommand(process.env.CODEX_BIN, "codex");
  return readCodexRuntimeIntegrationStatus({
    command,
    env: runtimeProcessEnv(),
    configuredModel: String(agent.model || "").trim(),
    capabilities: runtimeCapabilitiesFor("codex"),
  });
}

function localOpenAiBase(agent = {}) {
  return (
    String(agent.gatewayUrl || "http://127.0.0.1:1234")
      .trim()
      .replace(/\/+$/, "") || "http://127.0.0.1:1234"
  );
}

function localOpenAiProviderName(agent = {}) {
  const provider = String(agent.provider || "openai-compatible").trim();
  if (provider === "lm-studio") return "Local";
  if (provider === "sie") return "SIE";
  if (provider === "ollama") return "Ollama";
  if (provider === "vllm") return "vLLM";
  if (provider === "llamacpp") return "llama.cpp";
  return "OpenAI-compatible";
}

function localOpenAiHeaders(agent = {}) {
  const token = String(agent.token || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const LOCAL_MODEL_INSTALL_CATALOG = [
  {
    id: "swarm-scout-12b-q4-k-m",
    displayName: "Swarm Scout 12B",
    provider: "huggingface",
    hfRepo: "LiamVisionary/swarm-sovereign-scout-12b-GGUF",
    sourceUrl: "https://huggingface.co/LiamVisionary/swarm-sovereign-scout-12b-GGUF",
    quantization: "Q4_K_M",
    filename: "swarm-sovereign-scout-Q4_K_M.gguf",
    params: "12B",
    sizeGb: 7.4,
    minRamGb: 16,
    description:
      "Coding and agentic local model tuned for terminal workflows, reasoning, and autonomous task loops.",
    roles: ["chat"],
    capabilities: ["text-generation", "tool-use", "coding"],
    tags: ["coding", "agentic", "reasoning", "GGUF"],
    matchKeys: [
      "swarm-scout-12b-q4-k-m",
      "swarm-sovereign-scout-Q4_K_M.gguf",
      "swarm-sovereign-scout-Q4_K_M",
      "LiamVisionary/swarm-sovereign-scout-12b-GGUF",
      "swarm-sovereign-scout-12b-GGUF:Q4_K_M",
    ],
  },
  {
    id: "synto-qwen3-5-9b-q4-k-m",
    displayName: "Syntho Qwen3.5 9B",
    provider: "huggingface",
    hfRepo: "lmstudio-community/Qwen3.5-9B-GGUF",
    sourceUrl: "https://huggingface.co/lmstudio-community/Qwen3.5-9B-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3.5-9B-Q4_K_M.gguf",
    params: "9B",
    sizeGb: 5.6,
    minRamGb: 16,
    contextLength: 262144,
    description:
      "Low-resource Syntho option for lighter machines; fastest local setup, with more review expected.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3.5", "local", "low-resource", "GGUF"],
    matchKeys: [
      "synto-qwen3-5-9b-q4-k-m",
      "Qwen3.5-9B-Q4_K_M.gguf",
      "Qwen3.5-9B-Q4_K_M",
      "lmstudio-community/Qwen3.5-9B-GGUF",
      "Qwen3.5-9B-GGUF:Q4_K_M",
    ],
  },
  {
    id: "synto-qwen3-30b-a3b-q4-k-m",
    displayName: "Syntho Qwen3 30B A3B",
    provider: "huggingface",
    hfRepo: "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    sourceUrl:
      "https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf",
    params: "30B A3B",
    sizeGb: 18.6,
    minRamGb: 32,
    contextLength: 131072,
    description:
      "Recommended local Syntho tier from the temp-vault trial: strong synthesis quality at a practical memory cost.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3", "moe", "recommended", "GGUF"],
    matchKeys: [
      "synto-qwen3-30b-a3b-q4-k-m",
      "Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf",
      "Qwen3-30B-A3B-Instruct-2507-Q4_K_M",
      "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
      "Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M",
      "qwen3:30b",
    ],
  },
  {
    id: "synto-qwen3-6-27b-q4-k-m",
    displayName: "Syntho Qwen3.6 27B",
    provider: "huggingface",
    hfRepo: "lmstudio-community/Qwen3.6-27B-GGUF",
    sourceUrl: "https://huggingface.co/lmstudio-community/Qwen3.6-27B-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3.6-27B-Q4_K_M.gguf",
    params: "27B",
    sizeGb: 16.6,
    minRamGb: 32,
    contextLength: 262144,
    description:
      "Experimental Syntho option; quality is promising only when reasoning/thinking output is disabled.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3.6", "experimental", "GGUF"],
    matchKeys: [
      "synto-qwen3-6-27b-q4-k-m",
      "Qwen3.6-27B-Q4_K_M.gguf",
      "Qwen3.6-27B-Q4_K_M",
      "lmstudio-community/Qwen3.6-27B-GGUF",
      "Qwen3.6-27B-GGUF:Q4_K_M",
      "qwen3.6:27b",
    ],
  },
  {
    id: "synto-qwen3-6-35b-a3b-q4-k-m",
    displayName: "Syntho Qwen3.6 35B A3B",
    provider: "huggingface",
    hfRepo: "lmstudio-community/Qwen3.6-35B-A3B-GGUF",
    sourceUrl:
      "https://huggingface.co/lmstudio-community/Qwen3.6-35B-A3B-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3.6-35B-A3B-Q4_K_M.gguf",
    params: "35B A3B",
    sizeGb: 21.2,
    minRamGb: 32,
    contextLength: 262144,
    description:
      "High-ceiling local Syntho candidate for larger machines; keep review on until it beats the 30B tier in fixtures.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3.6", "moe", "high-ceiling", "GGUF"],
    matchKeys: [
      "synto-qwen3-6-35b-a3b-q4-k-m",
      "Qwen3.6-35B-A3B-Q4_K_M.gguf",
      "Qwen3.6-35B-A3B-Q4_K_M",
      "lmstudio-community/Qwen3.6-35B-A3B-GGUF",
      "Qwen3.6-35B-A3B-GGUF:Q4_K_M",
      "qwen3.6:35b-a3b",
    ],
  },
];

const activeLocalModelDownloadStates = new Set(["queued", "downloading"]);
const localModelDownloadJobs = new Map();

function localModelCatalogEntry(id) {
  return LOCAL_MODEL_INSTALL_CATALOG.find((entry) => entry.id === id);
}

function lmStudioDownloadArgsForCatalogEntry(entry) {
  return ["get", `${entry.sourceUrl}@${entry.quantization}`, "--gguf", "-y"];
}

function cloneLocalModelDownloadJob(job) {
  return { ...job };
}

function patchLocalModelDownloadJob(jobId, patch = {}) {
  const record = localModelDownloadJobs.get(jobId);
  if (!record) return;
  record.job = { ...record.job, ...patch, updatedAt: new Date().toISOString() };
}

function snapshotLocalModelDownloadJobs() {
  return [...localModelDownloadJobs.values()]
    .map((record) => cloneLocalModelDownloadJob(record.job))
    .sort((left, right) =>
      String(right.startedAt || "").localeCompare(String(left.startedAt || "")),
    )
    .slice(0, 12);
}

function activeLocalModelDownload(modelId) {
  return [...localModelDownloadJobs.values()].find(
    (record) =>
      record.job.modelId === modelId &&
      activeLocalModelDownloadStates.has(record.job.state),
  );
}

function parseLocalModelDownloadProgress(message) {
  const match = String(message || "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return undefined;
  const progressPercent = Number(match[1]);
  return Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : undefined;
}

function rememberLocalModelDownloadOutput(jobId, chunk) {
  const record = localModelDownloadJobs.get(jobId);
  if (!record) return;
  const lines = String(chunk || "")
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return;
  record.log.push(...lines);
  if (record.log.length > 20) record.log.splice(0, record.log.length - 20);
  const message = lines.at(-1) || "";
  patchLocalModelDownloadJob(jobId, {
    message,
    progressPercent:
      parseLocalModelDownloadProgress(message) ?? record.job.progressPercent,
  });
}

function latestLocalModelDownloadMessage(record) {
  return record?.log?.at(-1) || record?.job?.message;
}

function localModelHardwareSnapshot() {
  const bytesToGb = (value) => Math.round((value / 1_000_000_000) * 10) / 10;
  const currentPlatform = platform();
  const currentArch = arch();
  return {
    totalRamGb: bytesToGb(totalmem()),
    freeRamGb: bytesToGb(freemem()),
    platform: currentPlatform,
    arch: currentArch,
    appleSilicon: currentPlatform === "darwin" && currentArch === "arm64",
  };
}

function normalizeCatalogMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function lmStudioModelMatchesCatalogEntry(model, entry) {
  const rawHaystack = [
    model.key,
    model.displayName,
    model.paramsString || "",
    model.format || "",
  ]
    .join(" ")
    .toLowerCase();
  const compactHaystack = normalizeCatalogMatch(rawHaystack);
  return entry.matchKeys.some((matchKey) => {
    const rawNeedle = String(matchKey || "").toLowerCase();
    const compactNeedle = normalizeCatalogMatch(matchKey);
    return (
      rawHaystack.includes(rawNeedle) ||
      Boolean(compactNeedle && compactHaystack.includes(compactNeedle))
    );
  });
}

function annotateLocalModelInstallCatalog(models = []) {
  return LOCAL_MODEL_INSTALL_CATALOG.map((entry) => {
    const installed = models.find(
      (model) =>
        model.source !== "openai-server" && !model.remote && lmStudioModelMatchesCatalogEntry(model, entry),
    );
    return {
      ...entry,
      installed: Boolean(installed),
      loaded: Boolean(installed?.loaded),
      installedModelKey: installed?.key,
      loadedInstanceIds: installed?.loadedInstanceIds,
    };
  });
}

function localModelHubStatus(models = []) {
  return {
    catalog: annotateLocalModelInstallCatalog(models),
    downloads: snapshotLocalModelDownloadJobs(),
    hardware: localModelHardwareSnapshot(),
  };
}

function localModelRuntimeEnv() {
  return runtimeProcessEnv({
    PATH: [join(homedir(), ".lmstudio", "bin"), process.env.PATH]
      .filter(Boolean)
      .join(delimiter),
  });
}

async function resolveLmsBin() {
  const candidates = [
    join(homedir(), ".lmstudio", "bin", "lms"),
    "/opt/homebrew/bin/lms",
    "/usr/local/bin/lms",
    "lms",
  ];
  for (const candidate of candidates) {
    if (candidate === "lms") return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return "lms";
}

async function execLocalRuntimeText(command, args = [], timeout = 8_000, env = runtimeProcessEnv()) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout,
    maxBuffer: 4_000_000,
    env,
  });
  return [stdout, stderr]
    .map((chunk) => String(chunk || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function runLmsText(args, timeout = 15_000) {
  return execLocalRuntimeText(await resolveLmsBin(), args, timeout, localModelRuntimeEnv());
}

function compactLocalRuntimeOutput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");
}

function compactLocalRuntimeError(error, fallback) {
  return (error instanceof Error ? compactLocalRuntimeOutput(error.message) : fallback).slice(0, 280) || fallback;
}

function localRuntimeOutputSaysRunning(value) {
  if (/\b(not running|not started|stopped|offline|down)\b/i.test(String(value || ""))) return false;
  return /\b(running|started|listening|ready)\b/i.test(String(value || ""));
}

function lmStudioInstallCommandForPlatform(currentPlatform = platform()) {
  if (currentPlatform === "win32") return "irm https://lmstudio.ai/install.ps1 | iex";
  if (currentPlatform === "darwin" || currentPlatform === "linux") return "curl -fsSL https://lmstudio.ai/install.sh | bash";
  return "";
}

function ollamaInstallCommandForPlatform(currentPlatform = platform()) {
  return currentPlatform === "linux" ? "curl -fsSL https://ollama.com/install.sh | sh" : "";
}

function localOpenAiStatusUrl(agent = {}) {
  const baseUrl = localOpenAiBase(agent);
  const statusPath = String(agent.statusPath || "/v1/models");
  return `${baseUrl}${statusPath.startsWith("/") ? statusPath : `/${statusPath}`}`;
}

function localOpenAiServerPort(agent = {}) {
  try {
    const parsed = new URL(localOpenAiBase(agent));
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "1234";
  }
}

async function probeLocalOpenAiModels(agent = {}, timeoutMs = 4_000) {
  try {
    const payload = await fetchJsonWithTimeout(
      localOpenAiStatusUrl(agent),
      { headers: localOpenAiHeaders(agent) },
      timeoutMs,
    );
    const models = Array.isArray(payload.data)
      ? payload.data.map((model) => String(model?.id || "").trim()).filter(Boolean)
      : [];
    return { ok: true, modelCount: models.length, models };
  } catch (error) {
    return { ok: false, error: compactLocalRuntimeError(error, "OpenAI endpoint is not reachable.") };
  }
}

async function waitForLocalOpenAiModels(agent = {}, timeoutMs = 30_000) {
  const started = Date.now();
  let lastProbe = { ok: false, error: "OpenAI endpoint is not reachable yet." };
  while (Date.now() - started < timeoutMs) {
    lastProbe = await probeLocalOpenAiModels(agent);
    if (lastProbe.ok) return lastProbe;
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
  }
  return lastProbe;
}

async function localRuntimeSetupStatus(agent = {}) {
  const hardware = localModelHardwareSnapshot();
  const lmInstallCommand = lmStudioInstallCommandForPlatform(hardware.platform);
  let lmsPresent = false;
  let lmsVersion = "";
  let lmsError = "";
  try {
    lmsVersion = compactLocalRuntimeOutput(await runLmsText(["--version"], 5_000));
    lmsPresent = true;
  } catch (error) {
    lmsError = compactLocalRuntimeError(error, "LM Studio CLI is not installed.");
  }
  let daemonRunning = false;
  let serverRunning = false;
  if (lmsPresent) {
    try {
      daemonRunning = localRuntimeOutputSaysRunning(await runLmsText(["daemon", "status"], 5_000));
    } catch {
      daemonRunning = false;
    }
    try {
      serverRunning = localRuntimeOutputSaysRunning(await runLmsText(["server", "status"], 5_000));
    } catch {
      serverRunning = false;
    }
  }
  const lmProbe = await probeLocalOpenAiModels(agent);
  const lmStudio = {
    id: "lm-studio",
    label: "LM Studio",
    present: lmsPresent,
    ready: lmProbe.ok,
    running: lmProbe.ok || serverRunning,
    version: lmsVersion || undefined,
    detail: lmProbe.ok
      ? `OpenAI endpoint is ready${typeof lmProbe.modelCount === "number" ? ` with ${lmProbe.modelCount} model${lmProbe.modelCount === 1 ? "" : "s"}` : ""}.`
      : lmsPresent
        ? daemonRunning
          ? "LM Studio is installed and the daemon is running, but the local OpenAI server is stopped."
          : "LM Studio is installed, but the daemon/server are not ready."
        : "LM Studio is not installed yet.",
    error: lmProbe.ok ? undefined : lmsPresent ? lmProbe.error : lmsError,
    installable: Boolean(lmInstallCommand),
    installCommand: lmInstallCommand || undefined,
    manualInstallUrl: "https://lmstudio.ai/download",
  };

  let ollamaPresent = false;
  let ollamaVersion = "";
  let ollamaError = "";
  try {
    ollamaVersion = compactLocalRuntimeOutput(await execLocalRuntimeText("ollama", ["--version"], 5_000));
    ollamaPresent = true;
  } catch (error) {
    ollamaError = compactLocalRuntimeError(error, "Ollama CLI is not installed.");
  }
  let ollamaReady = false;
  try {
    await fetchJsonWithTimeout("http://127.0.0.1:11434/api/tags", {}, 4_000);
    ollamaReady = true;
    ollamaPresent = true;
  } catch (error) {
    if (ollamaPresent) ollamaError = compactLocalRuntimeError(error, "Ollama API is not reachable.");
  }
  const ollamaInstallCommand = ollamaInstallCommandForPlatform(hardware.platform);
  const ollama = {
    id: "ollama",
    label: "Ollama",
    present: ollamaPresent,
    ready: ollamaReady,
    running: ollamaReady,
    version: ollamaVersion || undefined,
    detail: ollamaReady ? "Ollama API is reachable." : ollamaPresent ? "Ollama is installed, but its local API is not reachable." : "Ollama is not installed.",
    error: ollamaReady ? undefined : ollamaError,
    installable: Boolean(ollamaInstallCommand),
    installCommand: ollamaInstallCommand || undefined,
    manualInstallUrl: "https://ollama.com/download",
  };

  let llamaPresent = false;
  let llamaVersion = "";
  let llamaError = "";
  try {
    llamaVersion = compactLocalRuntimeOutput(await execLocalRuntimeText("llama-server", ["--version"], 5_000));
    llamaPresent = true;
  } catch (error) {
    llamaError = compactLocalRuntimeError(error, "llama.cpp server CLI is not installed.");
  }
  const llamaCpp = {
    id: "llama-cpp",
    label: "llama.cpp",
    present: llamaPresent,
    ready: false,
    running: false,
    version: llamaVersion || undefined,
    detail: llamaPresent ? "llama-server is installed; start an OpenAI-compatible server to use it as a custom Local endpoint." : "llama.cpp is not installed.",
    error: llamaPresent ? undefined : llamaError,
    installable: false,
    manualInstallUrl: "https://github.com/ggml-org/llama.cpp",
  };

  return {
    recommendedProvider: "lm-studio",
    recommendedLabel: "LM Studio",
    recommendationReason: "Best fit for this Local provider because HivemindOS can install GGUF models, load/unload them, start the OpenAI-compatible server, and control LM Link through lms.",
    ready: lmStudio.ready,
    installable: Boolean(lmStudio.installable),
    installCommand: lmStudio.installCommand,
    manualInstallUrl: lmStudio.manualInstallUrl,
    serverUrl: localOpenAiBase(agent),
    hardware,
    providers: [lmStudio, ollama, llamaCpp],
    checkedAt: new Date().toISOString(),
  };
}

async function runLmsJson(args, timeout = 15_000) {
  const { stdout } = await execFileAsync(await resolveLmsBin(), args, {
    timeout,
    maxBuffer: 8_000_000,
    env: localModelRuntimeEnv(),
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        typeof data?.error === "string"
          ? data.error
          : data?.error?.message || `${url} returned ${response.status}`;
      throw new Error(error);
    }
    return data || {};
  } finally {
    clearTimeout(timer);
  }
}

const SIE_MODEL_STATES = new Set(["available", "loading", "loaded", "unloading", "failed"]);
const SIE_EMBEDDING_OUTPUTS = new Set(["dense", "sparse", "multivector", "embedding", "embeddings", "vector"]);
const SIE_SCORE_OUTPUTS = new Set(["score", "scores", "rank", "ranking"]);
const SIE_EXTRACT_OUTPUTS = new Set(["entity", "entities", "relation", "relations", "class", "classes", "object", "objects", "bbox", "boxes", "markdown"]);

function normalizeSieModels(payload = {}) {
  const nativeModels = Array.isArray(payload) ? payload : Array.isArray(payload.models) ? payload.models : [];
  const models = nativeModels.map((raw) => {
    const key = String(raw?.name || raw?.id || "").trim();
    if (!key) return null;
    const inputs = Array.isArray(raw.inputs) ? raw.inputs.map(String).filter(Boolean) : [];
    const outputs = Array.isArray(raw.outputs) ? raw.outputs.map(String).filter(Boolean) : [];
    const capabilities = raw.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : undefined;
    const tasks = new Set();
    if (capabilities) tasks.add("chat");
    if (outputs.some((output) => SIE_EMBEDDING_OUTPUTS.has(output.toLowerCase()))) tasks.add("embedding");
    if (outputs.some((output) => SIE_SCORE_OUTPUTS.has(output.toLowerCase()))) tasks.add("rerank");
    if (outputs.some((output) => SIE_EXTRACT_OUTPUTS.has(output.toLowerCase()))) tasks.add("extract");
    if (inputs.some((input) => input.toLowerCase() === "image")) tasks.add("vision");
    if (inputs.some((input) => ["audio", "speech"].includes(input.toLowerCase()))) tasks.add("audio");
    if (!tasks.size && outputs.some((output) => output.toLowerCase() === "text")) tasks.add("text");
    if (!tasks.size) tasks.add("inference");
    const rawState = String(raw.state || "").toLowerCase();
    const state = SIE_MODEL_STATES.has(rawState) ? rawState : raw.loaded ? "loaded" : "available";
    const lastError = typeof raw.last_error === "string"
      ? raw.last_error
      : [raw.last_error?.code, raw.last_error?.message].filter(Boolean).join(" · ");
    const taskList = [...tasks];
    const chatCompatible = taskList.includes("chat");
    const warmKind = chatCompatible ? "chat" : taskList.includes("embedding") ? "embedding" : undefined;
    return {
      key,
      displayName: key,
      type: taskList[0],
      state,
      loaded: state === "loaded" || Boolean(raw.loaded),
      inputs,
      outputs,
      tasks: taskList,
      dims: raw.dims && typeof raw.dims === "object" ? raw.dims : undefined,
      maxContextLength: Number(raw.max_sequence_length || 0) || undefined,
      revision: raw.revision ?? null,
      profiles: Array.isArray(raw.profiles) ? raw.profiles.map(String) : raw.profiles && typeof raw.profiles === "object" ? Object.keys(raw.profiles) : [],
      capabilities: capabilities ? {
        grammar: Array.isArray(capabilities.grammar) ? capabilities.grammar : [],
        tools: Boolean(capabilities.tools),
        loraAdapters: Array.isArray(capabilities.lora_adapters) ? capabilities.lora_adapters : [],
        profileLoraAdapters: capabilities.profile_lora_adapters || {},
        code: Boolean(capabilities.code),
        sql: Boolean(capabilities.sql),
        guard: Boolean(capabilities.guard),
      } : undefined,
      lastError: lastError || undefined,
      canWarm: Boolean(warmKind) && state !== "loading" && state !== "unloading",
      warmKind,
      chatCompatible,
    };
  }).filter(Boolean);
  const known = new Set(models.map((model) => model.key));
  for (const entry of Array.isArray(payload?.data) ? payload.data : []) {
    const key = String(entry?.id || "").trim();
    if (!key || known.has(key)) continue;
    models.push({ key, displayName: key, type: "inference", state: "available", loaded: false, inputs: [], outputs: [], tasks: ["inference"], profiles: [], canWarm: false, chatCompatible: false });
  }
  return models.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function normalizeSieHealth(payload = {}) {
  const workers = (Array.isArray(payload.workers) ? payload.workers : []).map((raw) => ({
    name: String(raw?.name || raw?.url || "").trim(),
    url: String(raw?.url || "").trim() || undefined,
    gpu: String(raw?.gpu || "").trim() || undefined,
    gpuCount: Number(raw?.gpu_count || 0),
    readyGpuSlots: Number(raw?.ready_gpu_slots || 0),
    healthy: raw?.healthy !== false,
    queueDepth: Number(raw?.queue_depth || 0),
    pendingCost: Number(raw?.pending_cost || 0),
    inflightBatches: Number(raw?.inflight_batches || 0),
    loadedModels: Array.isArray(raw?.loaded_models) ? raw.loaded_models.map(String) : [],
    memoryUsedBytes: Number(raw?.memory_used_bytes || 0),
    memoryTotalBytes: Number(raw?.memory_total_bytes || 0),
    bundle: String(raw?.bundle || "").trim() || undefined,
  })).filter((worker) => worker.name);
  const cluster = payload.cluster && typeof payload.cluster === "object" ? payload.cluster : {};
  return {
    workers,
    cluster: {
      status: String(payload.status || "").trim() || undefined,
      type: String(payload.type || "").trim() || undefined,
      workerCount: Number(cluster.worker_count ?? workers.filter((worker) => worker.healthy).length),
      gpuCount: Number(cluster.gpu_count ?? workers.reduce((total, worker) => total + worker.gpuCount, 0)),
      modelsLoaded: Number(cluster.models_loaded ?? new Set(workers.flatMap((worker) => worker.loadedModels)).size),
      totalQps: Number(cluster.total_qps || 0),
      configuredGpuTypes: Array.isArray(payload.configured_gpu_types) ? payload.configured_gpu_types.map(String) : [],
      liveGpuTypes: Array.isArray(payload.live_gpu_types) ? payload.live_gpu_types.map(String) : [],
    },
  };
}

async function readSieStatus(agent = {}) {
  const baseUrl = localOpenAiBase(agent).replace(/\/v1$/, "");
  const [modelsResult, healthResult] = await Promise.allSettled([
    fetchJsonWithTimeout(`${baseUrl}/v1/models`, { headers: localOpenAiHeaders(agent) }),
    fetchJsonWithTimeout(`${baseUrl}/health`, { headers: localOpenAiHeaders(agent) }),
  ]);
  const health = healthResult.status === "fulfilled" ? normalizeSieHealth(healthResult.value) : normalizeSieHealth();
  return {
    baseUrl,
    models: modelsResult.status === "fulfilled" ? normalizeSieModels(modelsResult.value) : [],
    ...health,
    error: modelsResult.status === "rejected" ? modelsResult.reason instanceof Error ? modelsResult.reason.message : "SIE model discovery failed." : undefined,
    healthError: healthResult.status === "rejected" ? healthResult.reason instanceof Error ? healthResult.reason.message : "SIE health telemetry failed." : undefined,
    checkedAt: new Date().toISOString(),
  };
}

function sieWarmRequest(model) {
  if (model?.warmKind === "chat") {
    return { path: "/v1/chat/completions", body: { model: model.key, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 1, temperature: 0 } };
  }
  if (model?.warmKind === "embedding") {
    return { path: "/v1/embeddings", body: { model: model.key, input: "warmup" } };
  }
  return null;
}

function normalizeLmStudioInventory(payload = {}) {
  const models = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const normalized = models
    .map((model) => {
      const key = String(model?.key || model?.modelKey || "").trim();
      if (!key) return null;
      const loadedInstanceIds = Array.isArray(model.loaded_instances)
        ? model.loaded_instances
            .map((instance) => String(instance?.id || "").trim())
            .filter(Boolean)
        : Array.isArray(model.loadedInstanceIds)
          ? model.loadedInstanceIds
              .map((id) => String(id || "").trim())
              .filter(Boolean)
          : [];
      return {
        key,
        displayName: String(model.display_name || model.displayName || key),
        type: String(model.type || "llm"),
        loaded: loadedInstanceIds.length > 0,
        loadedInstanceIds,
        maxContextLength: Number.isFinite(
          Number(model.max_context_length ?? model.maxContextLength),
        )
          ? Number(model.max_context_length ?? model.maxContextLength)
          : undefined,
        paramsString: model.params_string ?? model.paramsString ?? null,
        sizeBytes: Number.isFinite(Number(model.size_bytes ?? model.sizeBytes))
          ? Number(model.size_bytes ?? model.sizeBytes)
          : null,
        format: model.format ?? null,
        remote: Boolean(model.deviceIdentifier),
        source: model.deviceIdentifier ? "lm-link" : "lm-studio",
        sourceLabel: model.deviceIdentifier ? "LM Link" : "LM Studio",
        canLoad: true,
        canUnload: true,
      };
    })
    .filter(Boolean);
  const seen = new Set();
  return normalized.filter((model) => {
    if (seen.has(model.key)) return false;
    seen.add(model.key);
    return true;
  });
}

function markLoadedLmStudioModels(models, loadedModels = []) {
  const loadedRefs = new Set(
    loadedModels.flatMap((model) => {
      if (typeof model === "string") return [model.trim()].filter(Boolean);
      return [
        model?.identifier,
        model?.modelKey,
        model?.key,
        model?.path,
        model?.displayName,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    }),
  );
  return models.map((model) =>
    loadedRefs.has(model.key) || loadedRefs.has(model.displayName)
      ? {
          ...model,
          loaded: true,
          loadedInstanceIds: model.loadedInstanceIds.length
            ? model.loadedInstanceIds
            : [model.key],
        }
      : model,
  );
}

function loadedModelsFromLmLinkStatus(payload) {
  return (Array.isArray(payload?.peers) ? payload.peers : []).flatMap((peer) =>
    Array.isArray(peer?.loadedModels) ? peer.loadedModels : [],
  );
}

async function readLmStudioCliInventory() {
  const [models, loaded, linkStatus] = await Promise.all([
    runLmsJson(["ls", "--json"]),
    runLmsJson(["ps", "--json"]).catch(() => []),
    runLmsJson(["link", "status", "--json"]).catch(() => null),
  ]);
  return markLoadedLmStudioModels(
    normalizeLmStudioInventory(models),
    [
      ...(Array.isArray(loaded) ? loaded : []),
      ...loadedModelsFromLmLinkStatus(linkStatus),
    ],
  );
}

async function startLocalModelDownload(input = {}) {
  const modelId = String(input.modelId || input.model || "").trim();
  const entry = localModelCatalogEntry(modelId);
  if (!entry)
    return { ok: false, error: "Choose a model from the local install catalog." };
  const active = activeLocalModelDownload(entry.id);
  if (active) {
    return {
      ok: true,
      message: `${entry.displayName} is already ${active.job.state}.`,
      job: cloneLocalModelDownloadJob(active.job),
    };
  }
  const now = new Date().toISOString();
  const jobId = `${entry.id}-${Date.now()}`;
  const job = {
    jobId,
    modelId: entry.id,
    displayName: entry.displayName,
    state: "queued",
    message: "Queued in LM Studio",
    startedAt: now,
    updatedAt: now,
  };
  localModelDownloadJobs.set(jobId, { job, log: [] });
  const child = spawn(await resolveLmsBin(), lmStudioDownloadArgsForCatalogEntry(entry), {
    stdio: ["ignore", "pipe", "pipe"],
    env: localModelRuntimeEnv(),
  });
  const record = localModelDownloadJobs.get(jobId);
  if (record) record.child = child;
  patchLocalModelDownloadJob(jobId, {
    state: "downloading",
    message: "Downloading with LM Studio",
  });
  child.stdout?.on("data", (chunk) => rememberLocalModelDownloadOutput(jobId, chunk));
  child.stderr?.on("data", (chunk) => rememberLocalModelDownloadOutput(jobId, chunk));
  child.on("error", (error) => {
    patchLocalModelDownloadJob(jobId, {
      state: "failed",
      error: error instanceof Error ? error.message : "LM Studio download failed.",
      message: "Download failed",
    });
  });
  child.on("close", (code, signal) => {
    const current = localModelDownloadJobs.get(jobId);
    if (current?.job?.state === "cancelled") return;
    if (code === 0) {
      patchLocalModelDownloadJob(jobId, {
        state: "completed",
        progressPercent: 100,
        message: "Download complete",
      });
      return;
    }
    patchLocalModelDownloadJob(jobId, {
      state: "failed",
      error:
        latestLocalModelDownloadMessage(current) ||
        `LM Studio exited with ${code ?? signal ?? "an error"}.`,
      message: "Download failed",
    });
  });
  return {
    ok: true,
    message: `Started downloading ${entry.displayName} in LM Studio.`,
    job: cloneLocalModelDownloadJob(localModelDownloadJobs.get(jobId)?.job || job),
  };
}

async function cancelLocalModelDownload(input = {}) {
  const jobId = String(input.jobId || "").trim();
  const modelId = String(input.modelId || input.model || "").trim();
  const record = jobId
    ? localModelDownloadJobs.get(jobId)
    : [...localModelDownloadJobs.values()].find(
        (candidate) =>
          candidate.job.modelId === modelId &&
          activeLocalModelDownloadStates.has(candidate.job.state),
      );
  if (!record) return { ok: false, error: "No active local model download was found." };
  record.child?.kill("SIGTERM");
  patchLocalModelDownloadJob(record.job.jobId, {
    state: "cancelled",
    message: "Download cancelled",
  });
  return {
    ok: true,
    message: `Cancelled ${record.job.displayName || record.job.modelId}.`,
    job: cloneLocalModelDownloadJob(record.job),
  };
}

async function installLocalModelRuntime() {
  const installCommand = lmStudioInstallCommandForPlatform();
  if (!installCommand) {
    return {
      ok: false,
      error: "This platform does not have an in-app LM Studio installer yet. Use https://lmstudio.ai/download, then refresh Local models.",
    };
  }
  if (platform() === "win32") {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", installCommand], {
      timeout: 900_000,
      maxBuffer: 8_000_000,
      env: runtimeProcessEnv(),
    });
  } else {
    await execFileAsync("bash", ["-lc", installCommand], {
      timeout: 900_000,
      maxBuffer: 8_000_000,
      env: runtimeProcessEnv(),
    });
  }
  return { ok: true, message: "LM Studio installed. Start the Local server before loading a model." };
}

async function startLocalModelRuntime(agent = {}) {
  const setup = await localRuntimeSetupStatus(agent);
  const lmStudio = setup.providers.find((provider) => provider.id === "lm-studio");
  if (!lmStudio?.present) return { ok: false, error: "Install LM Studio before starting the Local server." };
  const lmsBin = await resolveLmsBin();
  await execFileAsync(lmsBin, ["daemon", "up"], {
    timeout: 120_000,
    maxBuffer: 2_000_000,
    env: localModelRuntimeEnv(),
  }).catch(() => undefined);
  let startError = "";
  await execFileAsync(lmsBin, ["server", "start", "--port", localOpenAiServerPort(agent), "--bind", "127.0.0.1"], {
    timeout: 120_000,
    maxBuffer: 2_000_000,
    env: localModelRuntimeEnv(),
  }).catch((error) => {
    startError = compactLocalRuntimeError(error, "LM Studio server start failed.");
  });
  const probe = await waitForLocalOpenAiModels(agent, 30_000);
  if (probe.ok) {
    return {
      ok: true,
      message: `Local server is ready at ${localOpenAiBase(agent)}${typeof probe.modelCount === "number" ? ` with ${probe.modelCount} model${probe.modelCount === 1 ? "" : "s"}` : ""}.`,
    };
  }
  return {
    ok: false,
    error: `LM Studio server did not become ready at ${localOpenAiBase(agent)}. ${probe.error || startError || ""}`.trim(),
  };
}

async function verifyLocalModelLoad(agent = {}, model = "", loadMessage = "Loaded model in LM Studio.") {
  const started = await startLocalModelRuntime(agent);
  if (started.ok === false) return started;
  const probe = await waitForLocalOpenAiModels(agent, 20_000);
  if (!probe.ok) {
    return { ok: false, error: `Loaded ${model}, but the OpenAI endpoint could not be verified. ${probe.error || ""}`.trim() };
  }
  return { ok: true, message: `${loadMessage} ${started.message || "Local server verified."}` };
}

async function smokeTestLocalModel(agent = {}, input = {}) {
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/+$/, "") : "";
  const testAgent = baseUrl
    ? {
        ...agent,
        gatewayUrl: baseUrl,
        chatPath: typeof input.chatPath === "string" && input.chatPath.trim() ? input.chatPath.trim() : "/v1/chat/completions",
        statusPath: typeof input.statusPath === "string" && input.statusPath.trim() ? input.statusPath.trim() : "/v1/models",
      }
    : agent;
  const model = String(input.model || agent.model || "").trim();
  if (!model) return { ok: false, error: "Choose a loaded model before running a smoke test." };
  if (input.startServer !== false) {
    const server = await startLocalModelRuntime(agent);
    if (server.ok === false) return server;
  } else {
    const probe = await probeLocalOpenAiModels(testAgent);
    if (!probe.ok) return { ok: false, error: probe.error || "Local model server is not reachable." };
  }
  const chatPath = String(testAgent.chatPath || "/v1/chat/completions");
  const response = await fetch(`${localOpenAiBase(testAgent)}${chatPath.startsWith("/") ? chatPath : `/${chatPath}`}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...localOpenAiHeaders(testAgent) },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Reply with OK." },
        { role: "user", content: "ping" },
      ],
      max_tokens: 8,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof data?.error === "string" ? data.error : data?.error?.message || `Smoke test returned ${response.status}`;
    return { ok: false, error };
  }
  return { ok: true, message: `${model} answered the Local smoke test.` };
}

async function localOpenAiIntegrationStatus(agent = {}) {
  const provider =
    String(agent.provider || "openai-compatible").trim() || "openai-compatible";
  const providerName = localOpenAiProviderName(agent);
  const baseUrl = localOpenAiBase(agent);
  const diagnostics = [];
  let lmStudioModels = [];
  let sieStatus;
  let localServers = [];
  let openAiModels = [];
  let inventoryError = "";
  let inventorySource = "";
  if (provider === "lm-studio") {
    try {
      lmStudioModels = await readLmStudioCliInventory();
      if (lmStudioModels.length) inventorySource = "lms ls --json";
    } catch (error) {
      inventoryError =
        error instanceof Error
          ? error.message
          : "LM Studio CLI inventory failed.";
      diagnostics.push(
        `${providerName} CLI inventory unavailable: ${inventoryError}`,
      );
    }
    if (!lmStudioModels.length) {
      try {
        lmStudioModels = normalizeLmStudioInventory(
          await fetchJsonWithTimeout(`${baseUrl}/api/v1/models`, {
            headers: localOpenAiHeaders(agent),
          }),
        );
        if (lmStudioModels.length) {
          inventoryError = "";
          inventorySource = `${baseUrl}/api/v1/models`;
        }
      } catch (error) {
        diagnostics.push(
          `LM Studio REST inventory unavailable: ${error instanceof Error ? error.message : "REST model inventory failed."}`,
        );
      }
    }
  } else if (provider === "sie") {
    sieStatus = await readSieStatus(agent);
    if (sieStatus.error) diagnostics.push(`${providerName} model discovery unavailable: ${sieStatus.error}`);
    if (sieStatus.healthError) diagnostics.push(`${providerName} health telemetry unavailable: ${sieStatus.healthError}`);
  }
  if (provider === "lm-studio") {
    try {
      localServers = await discoverLocalOpenAiServers(agent, {
        baseUrlForAgent: localOpenAiBase,
        fetchJsonWithTimeout,
      });
      const known = new Set(lmStudioModels.map((model) => model.key));
      for (const server of localServers) {
        for (const serverModel of server.models || []) {
          const id = String(serverModel.id || "").trim();
          if (!id || known.has(id) || serverModel.type === "embedding") continue;
          known.add(id);
          lmStudioModels.push({
            key: id,
            displayName: serverModel.displayName || id,
            type: serverModel.type || "llm",
            loaded: true,
            loadedInstanceIds: [id],
            paramsString: server.label,
            format: "OpenAI",
            remote: false,
            source: "openai-server",
            sourceLabel: server.label,
            serverId: server.id,
            baseUrl: server.baseUrl,
            chatPath: server.chatPath,
            statusPath: server.statusPath,
            canLoad: false,
            canUnload: false,
          });
        }
      }
    } catch (error) {
      if (!inventoryError)
        diagnostics.push(
          `Local server discovery unavailable: ${error instanceof Error ? error.message : "Server discovery failed."}`,
        );
    }
  }
  if (provider !== "sie" && !lmStudioModels.length) {
    try {
      const statusPath = String(agent.statusPath || "/v1/models");
      const payload = await fetchJsonWithTimeout(
        `${baseUrl}${statusPath.startsWith("/") ? statusPath : `/${statusPath}`}`,
        {
          headers: localOpenAiHeaders(agent),
        },
      );
      openAiModels = Array.isArray(payload.data)
        ? payload.data
            .map((model) => String(model?.id || "").trim())
            .filter(Boolean)
        : [];
    } catch (error) {
      if (!inventoryError)
        diagnostics.push(
          `${providerName} model discovery unavailable: ${error instanceof Error ? error.message : "Model discovery failed."}`,
        );
    }
  }
  const llmModels = lmStudioModels.filter((model) => model.type === "llm");
  const sieChatModels = (sieStatus?.models || []).filter((model) => model.chatCompatible);
  const modelOptions = provider === "sie"
    ? sieChatModels.map((model) => ({
        id: model.key,
        name: model.displayName,
        subtitle: model.state === "loaded" ? "Warm" : model.state === "loading" ? "Warming" : model.state === "failed" ? "Failed" : "Lazy",
        group: model.tasks.join(" · "),
        badge: "SIE",
      }))
    : llmModels.length
    ? llmModels.map((model) => ({
        id: model.key,
        name: model.displayName,
        subtitle: model.source === "openai-server"
          ? "Serving"
          : model.remote ? "Available" : model.loaded ? "Loaded" : "Downloaded",
        group: model.paramsString || undefined,
        badge: model.source === "openai-server"
          ? "Server"
          : model.remote ? "LM Link" : model.loaded ? "Loaded" : undefined,
      }))
    : openAiModels.map((id) => ({ id }));
  const fallbackModel = String(agent.model || "").trim();
  if (
    fallbackModel &&
    !modelOptions.some((model) => model.id === fallbackModel)
  ) {
    modelOptions.unshift({ id: fallbackModel });
  }
  return {
    runtime: HIVE_RUNTIME_ID,
    machine: { host: hostname(), collectorUrl: `http://${hostname()}:${port}` },
    capabilities: runtimeCapabilitiesFor(HIVE_RUNTIME_ID),
    modelSelection: {
      provider,
      model: fallbackModel || modelOptions[0]?.id || "",
      providers: [
        {
          slug: provider,
          name: providerName,
          models: modelOptions,
          totalModels: modelOptions.length,
          isCurrent: true,
          isUserDefined: true,
          source:
            provider === "lm-studio"
              ? inventorySource || `${baseUrl}/api/v1/models`
              : provider === "sie"
                ? `${baseUrl}/v1/models`
              : `${baseUrl}${agent.statusPath || "/v1/models"}`,
        },
      ],
    },
    providerStatus:
      provider === "lm-studio"
        ? {
            lmStudio: {
              baseUrl,
              models: lmStudioModels,
              servers: localServers,
              ...localModelHubStatus(lmStudioModels),
              setup: await localRuntimeSetupStatus(agent).catch(() => undefined),
              error: inventoryError || undefined,
              checkedAt: new Date().toISOString(),
            },
          }
        : provider === "sie" && sieStatus
          ? { sie: sieStatus }
        : undefined,
    integrations: {
      modelSelection: {
        supported: true,
        enabled: modelOptions.length > 0,
        detail: modelOptions.length
          ? `${providerName} reported ${modelOptions.length} model${modelOptions.length === 1 ? "" : "s"}.`
          : `${providerName} did not report models.`,
      },
    },
    diagnostics,
  };
}

async function runLocalOpenAiIntegrationAction(action, input = {}, agent = {}) {
  const provider = String(agent.provider || "");
  if (provider === "sie") {
    if (action !== "warm-model" && action !== "smoke-test-local-model") {
      return { ok: false, error: `Unsupported SIE action: ${action}` };
    }
    const modelKey = String(input.model || "").trim();
    if (!modelKey) return { ok: false, error: "Model is required." };
    const status = await readSieStatus(agent);
    if (status.error) return { ok: false, error: status.error };
    const model = status.models.find((entry) => entry.key === modelKey);
    if (!model) return { ok: false, error: `${modelKey} is not present in the SIE model inventory.` };
    const warmRequest = sieWarmRequest(model);
    if (!warmRequest) {
      return { ok: false, error: `${modelKey} cannot be warmed from this chat surface. Its ${model.tasks.join("/")} task loads on the first task-specific SIE request.` };
    }
    await fetchJsonWithTimeout(`${status.baseUrl}${warmRequest.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...localOpenAiHeaders(agent) },
      body: JSON.stringify(warmRequest.body),
    }, 240_000);
    return {
      ok: true,
      message: action === "smoke-test-local-model"
        ? `${modelKey} answered the SIE smoke test.`
        : `${modelKey} is warm on SIE. SIE will keep or evict it according to GPU demand.`,
    };
  }
  if (provider !== "lm-studio")
    return {
      ok: false,
      error: `${localOpenAiProviderName(agent)} does not expose local model controls here yet.`,
    };
  if (action === "install-local-runtime") return installLocalModelRuntime();
  if (action === "start-local-runtime") return startLocalModelRuntime(agent);
  if (action === "smoke-test-local-model") return smokeTestLocalModel(agent, input);
  if (action === "download-model") return startLocalModelDownload(input);
  if (action === "cancel-download") return cancelLocalModelDownload(input);
  if (action === "load-model") {
    const model = String(input.model || "").trim();
    if (!model) return { ok: false, error: "Model is required." };
    const contextLength = Number(input.contextLength || 0);
    const args = ["load", "--identifier", model, "--yes"];
    if (Number.isFinite(contextLength) && contextLength > 0)
      args.push("--context-length", String(contextLength));
    args.push(model);
    await execFileAsync(await resolveLmsBin(), args, {
      timeout: 180_000,
      maxBuffer: 2_000_000,
      env: localModelRuntimeEnv(),
    });
    return verifyLocalModelLoad(agent, model, `Loaded ${model} in LM Studio.`);
  }
  if (action === "unload-model") {
    const instanceId = String(input.instanceId || input.model || "").trim();
    if (!instanceId)
      return { ok: false, error: "Loaded model instance is required." };
    await execFileAsync(await resolveLmsBin(), ["unload", instanceId], {
      timeout: 60_000,
      maxBuffer: 2_000_000,
      env: localModelRuntimeEnv(),
    });
    return { ok: true, message: `Unloaded ${instanceId} from LM Studio.` };
  }
  return { ok: false, error: `Unsupported Local action: ${action}` };
}

async function runOpenClawIntegrationAction(action, input = {}) {
  if (action !== "set-model")
    return { ok: false, error: `Unsupported OpenClaw action: ${action}` };
  const provider = String(input.provider || "").trim();
  const model = String(input.model || "").trim();
  if (!provider || !model)
    return { ok: false, error: "Provider and model are required." };
  const configPath = join(defaultOpenClawDir, "openclaw.json");
  const config = await readOpenClawConfig();
  const nextConfig = {
    ...config,
    agents: {
      ...asRecord(config.agents),
      defaults: {
        ...asRecord(asRecord(config.agents).defaults),
        model: {
          ...asRecord(asRecord(asRecord(config.agents).defaults).model),
          primary: `${provider}/${model}`,
        },
      },
    },
  };
  await mkdir(defaultOpenClawDir, { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    ok: true,
    message: `OpenClaw default model set to ${provider}/${model}.`,
  };
}

async function runHermesIntegrationAction(action, input = {}, agent = {}) {
  if (action === "set-model") {
    const provider = String(input.provider || "").trim();
    const model = String(input.model || "").trim();
    if (!provider || !model)
      return { ok: false, error: "Provider and model are required." };
    const hermesHome = expandHome(
      sanitizeLocalDataDir(agent.localDataDir) || defaultHermesDir,
    );
    await setHermesModelAssignment({
      hermesHome,
      projectDir: hermesAgentProjectDir,
      pythonPath: await resolveHermesPython(),
      provider,
      model,
      providerConfig: provider === "sie" ? {
        name: "SIE",
        baseUrl: `${localOpenAiBase(agent).replace(/\/v1$/, "")}/v1`,
        keyEnv: "",
      } : undefined,
      execFileAsync,
    });
    const profile = hermesProfileName(hermesHome, defaultHermesDir);
    return {
      ok: true,
      message: profile
        ? `Hermes model set to ${provider}/${model} for profile ${profile}. New sessions use it.`
        : `Hermes default model set to ${provider}/${model}. New sessions use it.`,
    };
  }
  if (action === "enable-tool") {
    const tool = String(input.tool || "");
    if (!["x_search", "video_gen"].includes(tool))
      return { ok: false, error: "Unsupported Hermes tool." };
    await runHermes(["tools", "enable", tool], 20_000);
    return { ok: true, message: `Enabled Hermes ${tool}.` };
  }
  if (action === "disable-tool") {
    const tool = String(input.tool || "");
    if (!["x_search", "video_gen"].includes(tool))
      return { ok: false, error: "Unsupported Hermes tool." };
    await runHermes(["tools", "disable", tool], 20_000);
    return { ok: true, message: `Disabled Hermes ${tool}.` };
  }
  if (action === "xai-login") {
    return {
      ok: false,
      error:
        "xAI OAuth sign-in is handled by the HivemindOS dashboard OAuth flow. Open Agent Settings, choose xAI, then use the OAuth lane.",
    };
  }
  if (action === "hermes-update") {
    const output = await runHermes(["update"], 300_000);
    return {
      ok: true,
      message: "Hermes update completed on this machine.",
      output,
    };
  }
  if (action === "background") {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) return { ok: false, error: "Background prompt is required." };
    const id = `hermes-${Date.now().toString(36)}`;
    const logPath = join(runLogRoot, `${id}.log`);
    await mkdir(runLogRoot, { recursive: true });
    const child = spawn(await resolveHermesBin(), ["-z", prompt], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: runtimeProcessEnv(),
    });
    const write = (chunk) =>
      void writeFile(logPath, chunk.toString(), { flag: "a" }).catch(
        () => undefined,
      );
    child.stdout.on("data", write);
    child.stderr.on("data", write);
    child.unref();
    return {
      ok: true,
      id,
      logPath,
      message: "Started Hermes background task on this machine.",
    };
  }
  if (action === "kanban-decompose") {
    const taskId = String(input.taskId || "").trim();
    const args = ["kanban", "decompose", "--json"];
    if (taskId) args.push(taskId);
    else args.push("--all");
    const output = await runHermes(args, 120_000);
    return { ok: true, output };
  }
  return { ok: false, error: `Unsupported Hermes action: ${action}` };
}

function collectorRunProcess(command, args, stdin, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      rejectRun(new Error(`${command} timed out`));
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
      rejectRun(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      const detail = [stderr.trim(), stdout.trim()]
        .filter(Boolean)
        .join("\n\n");
      rejectRun(
        new Error(
          `${command} exited with code ${code}${detail ? `:\n${detail}` : ""}`,
        ),
      );
    });
    child.stdin.end(stdin || "");
  });
}

// Minimal mirror of src/lib/services/runtime-install-catalog.ts for the
// standalone collector (which cannot import the TS catalog). Keep the package
// names and fixed installer URLs in sync with the catalog. Only runtimes with
// a real in-app installer appear here; aeon is handled by its own flow.
const COLLECTOR_RUNTIME_INSTALL = {
  "claude-code": { kind: "npm", pkg: "@anthropic-ai/claude-code" },
  codex: { kind: "npm", pkg: "@openai/codex" },
  opencode: { kind: "npm", pkg: "opencode-ai" },
  openhands: { kind: "uv", pkg: "openhands", python: "3.12" },
  aider: { kind: "uv", pkg: "aider-chat" },
  evo: { kind: "uv", pkg: "evo-hq-cli" },
  hermes: {
    kind: "script",
    unixUrl: "https://hermes-agent.nousresearch.com/install.sh",
    windowsUrl: "https://hermes-agent.nousresearch.com/install.ps1",
    unixArgs: [],
    windowsArgs: [],
  },
  openclaw: {
    kind: "script",
    unixUrl: "https://openclaw.ai/install.sh",
    windowsUrl: "https://openclaw.ai/install.ps1",
    unixArgs: ["--no-onboard"],
    windowsArgs: ["-NoOnboard"],
  },
};

// Builds the OS-appropriate, server-side install invocation for a fixed runtime
// id. The runtime id is validated against COLLECTOR_RUNTIME_INSTALL before this
// runs and the package name is a hardcoded constant — there is no
// caller-supplied command, so this is not a passthrough-exec surface.
// Windows: deliver the script via -EncodedCommand (base64 UTF-16LE) rather than
// piping to `powershell -Command -`. The stdin form silently no-ops multi-line
// scripts (validated on a real Windows box: exit 0, nothing installed);
// EncodedCommand runs the full script reliably.
function powershellEncoded(script) {
  return {
    command: "powershell",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    stdin: "",
  };
}

async function buildRuntimeInstallInvocation(spec) {
  const isWin = process.platform === "win32";
  if (spec.kind === "script") {
    const rawUrl = isWin ? spec.windowsUrl : spec.unixUrl;
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error("Runtime installers must use HTTPS.");
    const download = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!download.ok) throw new Error(`Installer download failed with HTTP ${download.status}.`);
    const script = await download.text();
    if (!script.trim()) throw new Error("The downloaded runtime installer was empty.");
    if (Buffer.byteLength(script, "utf8") > 4 * 1024 * 1024)
      throw new Error("The runtime installer was unexpectedly large.");
    if (isWin) {
      const scriptBase64 = Buffer.from(script, "utf8").toString("base64");
      const renderedArgs = (spec.windowsArgs || [])
        .map((arg) => {
          if (!/^-[A-Za-z][A-Za-z0-9-]*$/.test(arg))
            throw new Error("Invalid PowerShell installer argument.");
          return arg;
        })
        .join(" ");
      return powershellEncoded([
        "$ErrorActionPreference='Stop'",
        `$installer=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${scriptBase64}'))`,
        `& ([ScriptBlock]::Create($installer))${renderedArgs ? ` ${renderedArgs}` : ""}`,
      ].join("\n"));
    }
    return {
      command: "bash",
      args: ["-s", "--", ...(spec.unixArgs || [])],
      stdin: script,
    };
  }
  if (spec.kind === "npm") {
    if (isWin) {
      return powershellEncoded(`$ErrorActionPreference='Stop'\nnpm install -g ${spec.pkg}\n`);
    }
    return {
      command: "bash",
      args: ["-s"],
      stdin: [
        "set -e",
        'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
        `npm install -g ${shellQuote(spec.pkg)}`,
      ].join("\n"),
    };
  }
  // uv tool — bootstrap uv first if it is missing.
  const pyArgs = spec.python ? ` --python ${spec.python}` : "";
  if (isWin) {
    return powershellEncoded([
      "$ErrorActionPreference='Stop'",
      "if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {",
      "  irm https://astral.sh/uv/install.ps1 | iex",
      '  $env:Path = "$env:USERPROFILE\\.local\\bin;$env:Path"',
      "}",
      "$uvexe = Join-Path $env:USERPROFILE '.local\\bin\\uv.exe'",
      "if (Test-Path $uvexe) { & $uvexe tool install " + spec.pkg + pyArgs + " } else { uv tool install " + spec.pkg + pyArgs + " }",
    ].join("\n"));
  }
  return {
    command: "bash",
    args: ["-s"],
    stdin: [
      "set -e",
      'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
      "if ! command -v uv >/dev/null 2>&1; then",
      "  curl -LsSf https://astral.sh/uv/install.sh | sh",
      '  export PATH="$HOME/.local/bin:$PATH"',
      "fi",
      `uv tool install ${shellQuote(spec.pkg)}${pyArgs}`,
    ].join("\n"),
  };
}

async function collectorOpenClawCommand() {
  const commandName = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
  const candidates = [
    process.env.OPENCLAW_BIN,
    join(homedir(), ".npm-global", "bin", commandName),
    join(homedir(), ".local", "bin", commandName),
    commandName,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate.includes("/") && !candidate.includes("\\")) return candidate;
    if (await access(candidate, constants.X_OK).then(() => true).catch(() => false)) return candidate;
  }
  return commandName;
}

async function configureCollectorOpenClawCodexPluginTrust() {
  const command = await collectorOpenClawCommand();
  await collectorRunProcess(command, ["plugins", "inspect", "codex", "--json"], "", 15_000);
  const current = await collectorRunProcess(command, ["config", "get", "plugins.allow", "--json"], "", 15_000)
    .catch(() => ({ stdout: "[]", stderr: "" }));
  let parsed = [];
  try {
    const value = JSON.parse(current.stdout || "[]");
    if (Array.isArray(value)) parsed = value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
  } catch {}
  const allow = [...new Set([...parsed, "codex"])];
  if (allow.length === parsed.length && allow.every((entry, index) => entry === parsed[index])) return "";
  await collectorRunProcess(command, ["config", "set", "plugins.allow", JSON.stringify(allow), "--strict-json"], "", 20_000);
  await mkdir(join(homedir(), ".hivemindos"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(homedir(), ".hivemindos", "openclaw-codex-plugin-trust.json"),
    `${JSON.stringify({ pluginId: "codex", managedBy: "hivemindos" }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return "OpenClaw Codex plugin explicitly trusted.";
}

async function collectorInstallRuntime(runtimeName) {
  const spec = COLLECTOR_RUNTIME_INSTALL[runtimeName];
  if (!spec) return { ok: false, error: `${runtimeName} cannot be installed by this collector.` };
  try {
    const { command, args, stdin } = await buildRuntimeInstallInvocation(spec);
    // Heavy uv installs (e.g. OpenHands: CPython 3.12 + a large dep tree) can run
    // well past several minutes on a cold cache, so allow up to 15 minutes.
    const result = await collectorRunProcess(command, args, stdin, 900_000);
    const postInstall = runtimeName === "openclaw"
      ? await configureCollectorOpenClawCodexPluginTrust().catch(() => "")
      : "";
    return {
      ok: true,
      message: `${runtimeName} installed.`,
      output: [`${result.stdout}${result.stderr}`.trim(), postInstall].filter(Boolean).join("\n").slice(-1500),
    };
  } catch (error) {
    return {
      ok: false,
      error: (error instanceof Error ? error.message : `${runtimeName} install failed.`).slice(0, 1500),
    };
  }
}

async function collectorSaveRuntimeAuth(env, value) {
  const key = String(env || "").trim();
  const secret = String(value || "").trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return { ok: false, error: "Invalid credential variable name." };
  if (!secret) return { ok: false, error: "A credential value is required." };
  if (/\s/.test(secret)) return { ok: false, error: "The credential must not contain spaces or line breaks." };
  try {
    await runHiveEnvImport({ entries: { [key]: secret }, scope: "agent", runtime: "generic" });
    return { ok: true, message: `Saved ${key} to the shared hive env.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the credential." };
  }
}

function startUpdate(reservationToken) {
  const updateLogDir = join(homedir(), ".hivemindos", "logs");
  const updateLogPath = join(updateLogDir, "agent-update.log");
  const command = collectorUpdateCommand({
    appDir,
    collectorOnly,
    logPath: updateLogPath,
  });
  launchCollectorUpdate({
    command,
    appDir,
    reservationToken,
    releaseReservation: releaseCollectorUpdateReservation,
  });
  return command;
}

async function scanHermesState(agent, hermesDir) {
  const dbPath = join(hermesDir, "state.db");
  try {
    await access(dbPath, constants.R_OK);
  } catch {
    return [];
  }
  const sessions = await execJson(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
    select id, source, started_at, ended_at, end_reason, title, message_count, tool_call_count
    from sessions order by started_at desc limit 12;
  `,
    ],
    [],
  );

  const tasks = await Promise.all(
    sessions.map(async (session) => {
      const messages = await execJson(
        "sqlite3",
        [
          "-json",
          dbPath,
          `
      select role, substr(content,1,8000) as content, tool_name, timestamp
      from messages
      where session_id = '${String(session.id).replaceAll("'", "''")}'
      order by timestamp desc limit 30;
    `,
        ],
        [],
      );
      const readableMessages = messages
        .map((message) => ({
          ...message,
          content: readableChatContent(message.content),
        }))
        .filter((message) => message.content.trim());
      const latestAssistant = readableMessages.find(
        (message) => message.role === "assistant",
      );
      const latestUser = readableMessages.find(
        (message) => message.role === "user",
      );
      const latestTool = readableMessages.find(
        (message) => message.role === "tool",
      );
      const latest = latestAssistant ?? latestTool ?? readableMessages[0];
      const chatMessages = readableMessages
        .filter(
          (message) =>
            (message.role === "user" || message.role === "assistant") &&
            message.content.trim(),
        )
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((message) => ({
          role: message.role,
          content: compact(message.content, ""),
        }));
      if (!chatMessages.length) return null;
      return {
        id: `hermes-state:${session.id}`,
        agentId: agent.id,
        title: compact(
          session.title ||
            latestUser?.content ||
            `Hermes ${session.source} session`,
        ).slice(0, 160),
        lastMessage: compact(latest?.content, HERMES_EMPTY_TRANSCRIPT_MESSAGE),
        status: session.ended_at
          ? /error|fail/i.test(session.end_reason || "")
            ? "failed"
            : "completed"
          : "active",
        source: "hermes-state",
        sourceDetail: session.source || "",
        startedAt: session.started_at * 1000,
        updatedAt: (latest?.timestamp ?? session.started_at) * 1000,
        messages: chatMessages,
      };
    }),
  );
  return tasks.filter(Boolean);
}

async function scanFiles(agent, dataDir) {
  const safeDir = resolve(expandHome(dataDir || ""));
  const dirs = ["tasks", "inbox", "outbox", "cron", "logs", "sessions"];
  const tasks = [];
  for (const dir of dirs) {
    const fullDir = join(safeDir, dir);
    const entries = await readdir(fullDir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries.filter((item) => item.isFile()).slice(0, 20)) {
      if (!/\.(md|txt|json|jsonl|log)$/i.test(entry.name)) continue;
      const filePath = join(fullDir, entry.name);
      const content = await readFile(filePath, "utf-8").catch(() => "");
      if (!content.trim()) continue;
      const stats = await stat(filePath).catch(() => null);
      tasks.push({
        id: `file:${filePath}`,
        agentId: agent.id,
        title:
          content
            .split(/\r?\n/)
            .find((line) => line.trim())
            ?.replace(/^#+\s*/, "")
            .slice(0, 160) || entry.name,
        lastMessage: compact(content.slice(-4000)),
        status: filePath.includes("/outbox/")
          ? "completed"
          : filePath.includes("/tasks/") || filePath.includes("/inbox/")
            ? "active"
            : "unknown",
        source: `file/${dir}`,
        startedAt: stats?.birthtimeMs ?? stats?.mtimeMs ?? Date.now(),
        updatedAt: stats?.mtimeMs ?? Date.now(),
      });
    }
  }
  return tasks;
}

function displayPath(pathValue) {
  const home = homedir();
  if (pathValue === home) return "~";
  return pathValue.startsWith(`${home}${sep}`)
    ? `~/${pathValue.slice(home.length + 1)}`
    : pathValue;
}

async function listDirectories(pathValue = "~") {
  const expanded = resolve(expandHome(pathValue || "~"));
  await access(expanded, constants.R_OK);
  const stats = await stat(expanded);
  if (!stats.isDirectory()) throw new Error("Path is not a directory.");
  const entries = await readdir(expanded, { withFileTypes: true }).catch(
    () => [],
  );
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: displayPath(join(expanded, entry.name)),
      kind: "directory",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    ok: true,
    host: hostname(),
    path: displayPath(expanded),
    parentPath:
      expanded === homedir() || expanded === sep
        ? ""
        : displayPath(resolve(expanded, "..")),
    directories,
  };
}

async function findSkillFiles(rootPath, maxDepth) {
  const root = resolve(expandHome(rootPath));
  await access(root, constants.R_OK).catch(() => null);
  const found = [];
  let truncated = false;

  async function walk(current, depth) {
    if (depth > maxDepth || truncated) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name === "SKILL.md") {
        found.push(join(current, entry.name));
        if (found.length >= maxSkillScanFiles) {
          truncated = true;
          return;
        }
        continue;
      }
      if (!entry.isDirectory() || skippedSkillDirs.has(entry.name)) continue;
      await walk(join(current, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  if (truncated) {
    console.error(
      `[collector] skill scan CAPPED at ${maxSkillScanFiles} SKILL.md files under ${root} — remaining skills are NOT reported. A count this size almost certainly means runaway skill mirrors; run scripts/cleanup-recursive-aeon-skill-mirrors.mjs (dry-run by default, --apply to execute).`,
    );
  } else if (found.length >= skillScanWarnThreshold) {
    console.warn(
      `[collector] skill scan found ${found.length} SKILL.md files under ${root} (warn threshold ${skillScanWarnThreshold}) — check for runaway skill mirrors (scripts/cleanup-recursive-aeon-skill-mirrors.mjs).`,
    );
  }
  return found;
}

async function collectSkillFiles(skillDir) {
  const root = resolve(skillDir);
  const files = [];

  async function walk(current) {
    if (files.length >= maxSkillFiles) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (files.length >= maxSkillFiles) return;
      if (skippedSkillDirs.has(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = await stat(fullPath).catch(() => null);
      if (!stats || stats.size > maxSkillFileBytes) continue;
      const relativePath = relative(root, fullPath).split(sep).join("/");
      if (!relativePath || relativePath.startsWith("..")) continue;
      const content = await readFile(fullPath).catch(() => null);
      if (!content) continue;
      files.push({
        path: relativePath,
        contentBase64: content.toString("base64"),
      });
    }
  }

  await walk(root);
  return files;
}

async function skillSummaryForProvider(provider, skillPath, options = {}) {
  const markdown = await readFile(skillPath, "utf-8").catch(() => "");
  const stats = await stat(skillPath).catch(() => null);
  const slug = skillSlug(basename(dirname(skillPath)));
  const frontmatter = parseSkillFrontmatter(markdown);
  const metadata = await readSkillSourceMetadata(dirname(skillPath));
  const mirrorLoopStatus = providerMirrorLoopStatus(provider.id, skillPath, metadata);
  const summary = {
    id: `${provider.id}:${hostname()}:${skillPath}`,
    slug,
    name: frontmatter.get("name") || titleFromSlug(slug),
    description:
      frontmatter.get("description") || firstSkillParagraph(markdown),
    provider: provider.id,
    providerLabel: provider.label,
    path: skillPath,
    sourcePath: skillPath,
    sourceMachine: hostname(),
    relativePath: relative(resolve(expandHome(provider.home)), skillPath),
    checksum: skillChecksum(markdown),
    updatedAt: stats?.mtimeMs ?? 0,
    imported: Boolean(mirrorLoopStatus),
  };
  if (mirrorLoopStatus) summary.sourceStatus = mirrorLoopStatus;
  if (options.includeSourceFiles) {
    summary.sourceFiles = await collectSkillFiles(dirname(skillPath));
  }
  return summary;
}

async function scanInstalledSkills(options = {}) {
  const providers = await Promise.all(
    skillProviderRoots.map(async (provider) => {
      const skillFiles = [
        ...new Set(
          (
            await Promise.all(
              provider.roots.map((root) =>
                findSkillFiles(root.path, root.maxDepth),
              ),
            )
          ).flat(),
        ),
      ];
      // Bounded pool, NOT Promise.all: each summary opens SKILL.md (+ source
      // metadata), and a pathological skills dir (NYC: 28k mirrors) must never
      // peg the fd table — child spawns in that window die with EBADF.
      const skills = await mapWithConcurrency(
        skillFiles,
        skillScanConcurrency,
        (skillPath) => skillSummaryForProvider(provider, skillPath, options),
      );
      return {
        id: provider.id,
        label: provider.label,
        home: provider.home,
        installed: await access(
          resolve(expandHome(provider.home)),
          constants.R_OK,
        )
          .then(() => true)
          .catch(() => false),
        skills: skills.sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      };
    }),
  );
  return { ok: true, host: hostname(), providers };
}

async function listInstalledSkills(options = {}) {
  if (options.includeSourceFiles) return scanInstalledSkills(options);
  return skillInventoryCache.get({ force: options.force === true });
}

function e2eSkillProvider(providerId) {
  const provider = skillProviderRoots.find((item) => item.id === providerId);
  if (!provider) throw new Error(`Unsupported skill provider: ${providerId}`);
  return provider;
}

async function writeE2eProviderSkill(input) {
  const provider = e2eSkillProvider(String(input.provider || ""));
  const slug = skillSlug(input.slug);
  if (!slug.startsWith("hive-e2e-"))
    throw new Error("E2E skill slugs must start with hive-e2e-.");
  const root = resolve(expandHome(provider.roots[0]?.path || ""));
  const skillDir = resolve(join(root, slug));
  if (!skillDir.startsWith(`${root}${sep}`))
    throw new Error("Unsafe skill path.");
  await mkdir(skillDir, { recursive: true, mode: 0o700 });
  const title = String(input.name || titleFromSlug(slug));
  const description = String(
    input.description || "Real fleet E2E propagation test skill.",
  );
  const body = String(input.body || `# ${title}\n\n${description}\n`);
  const markdown = body.startsWith("---")
    ? body
    : [
        "---",
        `name: ${title}`,
        `description: ${description}`,
        "---",
        "",
        body,
      ].join("\n");
  await writeFile(
    join(skillDir, "SKILL.md"),
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
    { mode: 0o600 },
  );
  return {
    ok: true,
    provider: provider.id,
    slug,
    path: join(skillDir, "SKILL.md"),
  };
}

async function removeE2eProviderSkill(input) {
  const provider = e2eSkillProvider(String(input.provider || ""));
  const slug = skillSlug(input.slug);
  if (!slug.startsWith("hive-e2e-"))
    throw new Error("E2E skill slugs must start with hive-e2e-.");
  const root = resolve(expandHome(provider.roots[0]?.path || ""));
  const skillDir = resolve(join(root, slug));
  if (!skillDir.startsWith(`${root}${sep}`))
    throw new Error("Unsafe skill path.");
  await rm(skillDir, { recursive: true, force: true });
  return { ok: true, provider: provider.id, slug, removed: true };
}

function assertE2eRunId(value) {
  const runId = String(value || "").trim();
  if (!/^hive-e2e-[a-z0-9-]{8,80}$/i.test(runId))
    throw new Error("E2E file sharing requires a hive-e2e-* run id.");
  return runId;
}

function e2eSegment(value, fallback = "item") {
  return (
    String(value || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

function e2eShareDir(runId, runtime, agentId = "") {
  const safeRunId = assertE2eRunId(runId);
  const safeRuntime = e2eSegment(runtime, "runtime");
  const safeAgentId = e2eSegment(agentId || "agent", "agent");
  return resolve(
    join(e2eFileShareRoot, safeRunId, `${safeRuntime}-${safeAgentId}`),
  );
}

function assertInsideE2eShareRoot(path) {
  const root = resolve(e2eFileShareRoot);
  if (path !== root && !path.startsWith(`${root}${sep}`))
    throw new Error("Unsafe E2E file share path.");
}

async function prepareE2eFileShareRecipient(input) {
  const runId = assertE2eRunId(input.runId);
  const runtime = normalizeRuntimeId(
    input.runtime,
    String(input.runtime || "openclaw"),
  );
  const agentId = String(input.agentId || input.agentName || "agent");
  const dir = e2eShareDir(runId, runtime, agentId);
  assertInsideE2eShareRoot(dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const publicKeyPath = join(dir, "recipient-public.pem");
  const privateKeyPath = join(dir, "recipient-private.pem");
  let publicKey = await readFile(publicKeyPath, "utf8").catch(() => "");
  if (!publicKey) {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    publicKey = pair.publicKey;
    await writeFile(publicKeyPath, pair.publicKey, { mode: 0o600 });
    await writeFile(privateKeyPath, pair.privateKey, { mode: 0o600 });
  }
  return {
    ok: true,
    host: hostname(),
    runId,
    runtime,
    agentId,
    publicKey,
    publicKeySha256: sha256Hex(publicKey),
  };
}

async function sendE2eEncryptedFile(input) {
  const runId = assertE2eRunId(input.runId);
  const senderRuntime = normalizeRuntimeId(
    input.senderRuntime,
    String(input.senderRuntime || "hermes"),
  );
  const recipientRuntime = normalizeRuntimeId(
    input.recipientRuntime,
    String(input.recipientRuntime || "openclaw"),
  );
  const senderAgentId = String(
    input.senderAgentId || input.senderAgentName || "sender",
  );
  const fileName = e2eSegment(input.fileName || `${runId}.txt`, `${runId}.txt`);
  const plaintext = String(input.content ?? "");
  if (!plaintext) throw new Error("File content is required.");
  if (!String(input.recipientPublicKey || "").includes("BEGIN PUBLIC KEY"))
    throw new Error("Recipient public key is required.");
  const ciphertext = publicEncrypt(
    {
      key: String(input.recipientPublicKey),
      oaepHash: "sha256",
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(plaintext, "utf8"),
  );
  const envelope = {
    version: 1,
    algorithm: "rsa-oaep-sha256",
    runId,
    fileName,
    sender: {
      host: hostname(),
      runtime: senderRuntime,
      agentId: senderAgentId,
    },
    recipient: {
      runtime: recipientRuntime,
      agentId: String(
        input.recipientAgentId || input.recipientAgentName || "recipient",
      ),
    },
    plaintextSha256: sha256Hex(plaintext),
    ciphertextBase64: ciphertext.toString("base64"),
    createdAt: new Date().toISOString(),
  };
  const dir = e2eShareDir(runId, senderRuntime, senderAgentId);
  assertInsideE2eShareRoot(dir);
  await mkdir(join(dir, "outbox"), { recursive: true, mode: 0o700 });
  const envelopePath = join(dir, "outbox", `${fileName}.encrypted.json`);
  await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    ok: true,
    host: hostname(),
    envelope,
    envelopePath,
    ciphertextSha256: sha256Hex(ciphertext),
  };
}

async function receiveE2eEncryptedFile(input) {
  const envelope =
    input.envelope && typeof input.envelope === "object" ? input.envelope : {};
  const runId = assertE2eRunId(envelope.runId || input.runId);
  const runtime = normalizeRuntimeId(
    input.runtime || envelope.recipient?.runtime,
    String(input.runtime || envelope.recipient?.runtime || "openclaw"),
  );
  const agentId = String(
    input.agentId || envelope.recipient?.agentId || "recipient",
  );
  const dir = e2eShareDir(runId, runtime, agentId);
  assertInsideE2eShareRoot(dir);
  const privateKey = await readFile(
    join(dir, "recipient-private.pem"),
    "utf8",
  ).catch(() => "");
  if (!privateKey)
    throw new Error("Recipient keypair has not been prepared on this machine.");
  const ciphertext = Buffer.from(
    String(envelope.ciphertextBase64 || ""),
    "base64",
  );
  if (!ciphertext.length)
    throw new Error("Encrypted envelope has no ciphertext.");
  const plaintext = privateDecrypt(
    {
      key: privateKey,
      oaepHash: "sha256",
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    },
    ciphertext,
  );
  const plaintextSha256 = sha256Hex(plaintext);
  if (
    envelope.plaintextSha256 &&
    envelope.plaintextSha256 !== plaintextSha256
  ) {
    throw new Error("Decrypted payload hash did not match the envelope.");
  }
  const fileName = e2eSegment(
    envelope.fileName || `${runId}.txt`,
    `${runId}.txt`,
  );
  await mkdir(join(dir, "inbox"), { recursive: true, mode: 0o700 });
  const receivedPath = join(dir, "inbox", fileName);
  await writeFile(receivedPath, plaintext, { mode: 0o600 });
  return {
    ok: true,
    host: hostname(),
    runId,
    runtime,
    agentId,
    receivedPath,
    plaintextSha256,
    bytes: plaintext.length,
    sender: envelope.sender,
  };
}

async function cleanupE2eFileShare(input) {
  const runId = assertE2eRunId(input.runId);
  const dir = resolve(join(e2eFileShareRoot, runId));
  assertInsideE2eShareRoot(dir);
  await rm(dir, { recursive: true, force: true });
  return { ok: true, host: hostname(), runId, removed: true };
}

async function handleE2eFileShare(input) {
  if (input.action === "prepare-recipient")
    return prepareE2eFileShareRecipient(input);
  if (input.action === "send") return sendE2eEncryptedFile(input);
  if (input.action === "receive") return receiveE2eEncryptedFile(input);
  if (input.action === "cleanup") return cleanupE2eFileShare(input);
  throw new Error("Unknown E2E file share action.");
}

function providerSignature(provider) {
  return (provider?.skills ?? [])
    .map(
      (skill) =>
        `${skill.slug}:${skill.checksum}:${Math.trunc(skill.updatedAt || 0)}`,
    )
    .sort()
    .join("|");
}

function enabledSkillAutoSyncProviders(config = skillAutoSyncConfig) {
  const policies =
    config?.policies && typeof config.policies === "object"
      ? config.policies
      : {};
  return skillProviderRoots.filter((provider) => {
    const policy = policies[provider.id];
    return policy?.autoImport || policy?.autoUpdate || policy?.trackRemovals;
  });
}

async function readSkillAutoSyncConfig() {
  const raw = await readFile(skillAutoSyncConfigPath, "utf-8").catch(() => "");
  if (!raw.trim())
    return {
      enabled: false,
      policies: {},
      dashboardUrl:
        process.env.HIVEMINDOS_DASHBOARD_URL || "http://127.0.0.1:5020",
      vaultPath: defaultSyncPath,
    };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled === true,
      policies:
        parsed.policies && typeof parsed.policies === "object"
          ? parsed.policies
          : {},
      dashboardUrl: String(
        parsed.dashboardUrl ||
          process.env.HIVEMINDOS_DASHBOARD_URL ||
          "http://127.0.0.1:5020",
      ),
      vaultPath: String(parsed.vaultPath || defaultSyncPath),
    };
  } catch {
    return {
      enabled: false,
      policies: {},
      dashboardUrl:
        process.env.HIVEMINDOS_DASHBOARD_URL || "http://127.0.0.1:5020",
      vaultPath: defaultSyncPath,
    };
  }
}

async function writeSkillAutoSyncConfig(config) {
  await mkdir(dirname(skillAutoSyncConfigPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    skillAutoSyncConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function configuredProviderInventory(providerIds) {
  const inventory = await listInstalledSkills({ force: true });
  const wanted = new Set(providerIds);
  return {
    ...inventory,
    providers: inventory.providers.filter((provider) =>
      wanted.has(provider.id),
    ),
  };
}

async function triggerSkillAutoSync(reason = "change") {
  if (skillAutoSyncDebounce) clearTimeout(skillAutoSyncDebounce);
  skillAutoSyncDebounce = setTimeout(() => {
    void runSkillAutoSync(reason);
  }, skillAutoSyncDebounceMs);
}

async function runSkillAutoSync(reason = "change") {
  if (skillAutoSyncInFlight) return;
  const config = skillAutoSyncConfig ?? (await readSkillAutoSyncConfig());
  if (!config.enabled) return;
  const providers = enabledSkillAutoSyncProviders(config);
  if (!providers.length) return;
  skillAutoSyncInFlight = true;
  try {
    const inventory = await configuredProviderInventory(
      providers.map((provider) => provider.id),
    );
    let changed = reason === "configure";
    for (const provider of inventory.providers) {
      const signature = providerSignature(provider);
      if (skillAutoSyncSignatures.get(provider.id) !== signature)
        changed = true;
      skillAutoSyncSignatures.set(provider.id, signature);
    }
    if (!changed) return;
    const dashboardUrl = String(
      config.dashboardUrl || "http://127.0.0.1:5020",
    ).replace(/\/+$/, "");
    await fetch(`${dashboardUrl}/api/obsidian/skills/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: config.vaultPath || defaultSyncPath,
        providers: inventory.providers,
        policies: config.policies,
        source: { host: hostname(), reason },
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
  } finally {
    skillAutoSyncInFlight = false;
  }
}

function stopSkillAutoSyncWatchers() {
  for (const watcher of skillAutoSyncWatchers.values()) {
    try {
      watcher.close();
    } catch {}
  }
  skillAutoSyncWatchers.clear();
  if (skillAutoSyncPoll) clearInterval(skillAutoSyncPoll);
  skillAutoSyncPoll = null;
}

function startSkillAutoSyncWatchers() {
  stopSkillAutoSyncWatchers();
  const config = skillAutoSyncConfig;
  if (!config?.enabled) return;
  const providers = enabledSkillAutoSyncProviders(config);
  for (const provider of providers) {
    for (const root of provider.roots) {
      const rootPath = resolve(expandHome(root.path));
      try {
        const watcher = watch(rootPath, { persistent: false }, () => {
          void triggerSkillAutoSync(`watch:${provider.id}`);
        });
        skillAutoSyncWatchers.set(`${provider.id}:${rootPath}`, watcher);
      } catch {}
    }
  }
  skillAutoSyncPoll = setInterval(() => {
    void runSkillAutoSync("poll");
  }, skillAutoSyncPollMs);
  void runSkillAutoSync("configure");
}

async function configureSkillAutoSync(input) {
  const policies =
    input.policies && typeof input.policies === "object" ? input.policies : {};
  const enabled = Object.values(policies).some(
    (policy) =>
      policy?.autoImport || policy?.autoUpdate || policy?.trackRemovals,
  );
  skillAutoSyncConfig = {
    enabled,
    policies,
    vaultPath: String(input.vaultPath || defaultSyncPath),
    dashboardUrl: String(
      input.dashboardUrl ||
        process.env.HIVEMINDOS_DASHBOARD_URL ||
        "http://127.0.0.1:5020",
    ),
    updatedAt: new Date().toISOString(),
  };
  await writeSkillAutoSyncConfig(skillAutoSyncConfig);
  startSkillAutoSyncWatchers();
  return {
    ok: true,
    host: hostname(),
    enabled,
    watchedProviders: enabledSkillAutoSyncProviders(skillAutoSyncConfig).map(
      (provider) => provider.id,
    ),
  };
}

async function initializeSkillAutoSync() {
  skillAutoSyncConfig = await readSkillAutoSyncConfig();
  startSkillAutoSyncWatchers();
}

async function scanRuntimeSchedules(agent, dataDir) {
  const safeDir = resolve(expandHome(dataDir || ""));
  if (agent.runtime === "aeon") {
    const configPath = join(safeDir, "aeon.yml");
    const content = await readFile(configPath, "utf-8").catch(() => "");
    if (!content.trim()) return [];
    const schedules = [];
    for (const line of content.split(/\r?\n/)) {
      const inline = line.match(/^  ([a-zA-Z0-9_-]+):\s*\{(.+)\}/);
      if (!inline) continue;
      const slug = inline[1];
      const fields = inline[2];
      const enabled = /enabled:\s*true/.test(fields);
      const schedule =
        fields.match(/schedule:\s*"([^"]+)"/)?.[1] ??
        fields.match(/schedule:\s*([^,}]+)/)?.[1]?.trim() ??
        "workflow_dispatch";
      const skillVar = fields.match(/var:\s*"([^"]+)"/)?.[1] ?? "";
      schedules.push({
        id: slug,
        runtime: "aeon",
        agentId: agent.id,
        name: slug
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        every: schedule,
        schedule,
        message: skillVar || `Run Aeon skill ${slug}`,
        enabled,
        source: "collector/aeon.yml",
      });
    }
    return schedules;
  }
  const cronDir = join(safeDir, "cron");
  const entries = await readdir(cronDir, { withFileTypes: true }).catch(
    () => [],
  );
  const schedules = [];
  for (const entry of entries.filter((item) => item.isFile()).slice(0, 40)) {
    if (!/\.(md|txt|json|jsonl|yaml|yml)$/i.test(entry.name)) continue;
    const filePath = join(cronDir, entry.name);
    const content = await readFile(filePath, "utf-8").catch(() => "");
    if (!content.trim()) continue;
    const stats = await stat(filePath).catch(() => null);
    let parsed = {};
    if (/\.json$/i.test(entry.name)) {
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {};
      }
    }
    if (Array.isArray(parsed.jobs)) {
      for (const [index, job] of parsed.jobs
        .filter((item) => item && typeof item === "object")
        .entries()) {
        const jobId =
          typeof job.id === "string" && job.id.trim() ? job.id : String(index);
        const every = scheduleTextFromJob(job);
        schedules.push({
          id: `${agent.runtime}:${agent.id}:${entry.name}:${jobId}`,
          runtime: agent.runtime,
          agentId: agent.id,
          name:
            stringFrom(job.name) ||
            stringFrom(job.title) ||
            entry.name.replace(/\.[^.]+$/, ""),
          every,
          schedule: every || undefined,
          message:
            stringFrom(job.message) ||
            stringFrom(job.prompt) ||
            stringFrom(job.task) ||
            content.slice(0, 1200),
          enabled: job.enabled !== false,
          nextRunMs: dateMsFrom(job.next_run_at) ?? dateMsFrom(job.nextRunAt),
          updatedAt: stats?.mtimeMs ?? Date.now(),
          source: `collector/${entry.name}`,
        });
      }
      continue;
    }
    const firstLine = content
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.replace(/^#+\s*/, "")
      .trim();
    const name =
      parsed.name ||
      parsed.title ||
      firstLine ||
      entry.name.replace(/\.[^.]+$/, "");
    const every =
      parsed.every || parsed.interval || scheduleTextFromJob(parsed);
    const message =
      parsed.message || parsed.prompt || parsed.task || content.slice(0, 1200);
    schedules.push({
      id: `${agent.runtime}:${agent.id}:${entry.name}`,
      runtime: agent.runtime,
      agentId: agent.id,
      name,
      every,
      schedule: every || undefined,
      message,
      enabled: parsed.enabled !== false,
      nextRunMs: dateMsFrom(parsed.next_run_at) ?? dateMsFrom(parsed.nextRunAt),
      updatedAt: stats?.mtimeMs ?? Date.now(),
      source: `collector/${entry.name}`,
    });
  }
  return schedules;
}

function stringFrom(value) {
  return typeof value === "string" ? value : "";
}

function scheduleTextFromJob(job) {
  const direct =
    stringFrom(job.every) ||
    stringFrom(job.interval) ||
    stringFrom(job.schedule_display);
  if (direct) return direct;
  const schedule = job.schedule;
  if (typeof schedule === "string") return schedule;
  if (schedule && typeof schedule === "object") {
    return (
      stringFrom(schedule.display) ||
      stringFrom(schedule.value) ||
      stringFrom(schedule.expr) ||
      stringFrom(schedule.run_at)
    );
  }
  return "";
}

function dateMsFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// One ps sweep serves every agent in a snapshot burst — snapshotFor runs per
// agent, and an uncached ps spawn per agent multiplied across pollers was a
// measurable share of collector CPU.
async function scanProcessCommands() {
  if (psScanCache && Date.now() - psScanCache.at < psScanCacheMs) {
    return psScanCache.stdout;
  }
  if (psScanPromise) return psScanPromise;
  psScanPromise = execFileAsync("ps", ["-axo", "command="], {
    timeout: 4000,
    maxBuffer: 800_000,
  })
    .then(({ stdout }) => {
      psScanCache = { stdout, at: Date.now() };
      return stdout;
    })
    .catch(() => "")
    .finally(() => {
      psScanPromise = null;
    });
  return psScanPromise;
}

async function processSeen(agent) {
  const stdout = await scanProcessCommands();
  const needles = [agent.id, agent.agentId, agent.name]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .filter((value) => value.length >= 4 && !["main", "agent"].includes(value));
  return stdout
    .split(/\r?\n/)
    .some(
      (line) =>
        needles.some((needle) => line.toLowerCase().includes(needle)) ||
        (agent.runtime === "hermes" && line.includes("/.hermes/")),
    );
}

// Reads model.default / model.provider / model.base_url from a Hermes
// config.yaml's top-level `model:` block (no YAML dependency). Lets the
// collector report a Hermes agent's real provider/model instead of leaving the
// dashboard to fall back to a default (which surfaced as a wrong "Local"
// provider for codex agents).
async function readHermesModelConfig(configDir) {
  const raw = await readFile(join(configDir, "config.yaml"), "utf8").catch(
    () => "",
  );
  if (!raw) return null;
  let inModelBlock = false;
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (/^model:\s*$/.test(line)) {
      inModelBlock = true;
      continue;
    }
    if (!inModelBlock) continue;
    if (/^\S/.test(line)) break; // dedent — end of the model: block
    const match = line.match(/^\s+(default|provider|base_url):\s*(.+?)\s*$/);
    if (!match) continue;
    const value = match[2]
      .replace(/\s+#.*$/, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!value) continue;
    if (match[1] === "default") out.model = value;
    else if (match[1] === "provider") out.provider = value;
    else out.baseUrl = value;
  }
  return out.model || out.provider ? out : null;
}

// Hermes profiles under ~/.hermes/profiles/* are distinct agents, but the
// runtime-agents registry that normally surfaces them can be missing or wiped.
// Enumerate the profiles not already covered by the registry so each persona
// shows up with its real provider/model. Reserved/internal profiles are skipped.
const RESERVED_HERMES_PROFILE_SLUGS = new Set([
  "default",
  "hermes",
  "runtime-capability-probe",
]);

function isReservedHermesProfileAgent(agent = {}) {
  if (agent.runtime !== "hermes") return false;
  const dataDir = expandHome(sanitizeLocalDataDir(agent.localDataDir));
  const profileSlug = dataDir
    .replace(/[\\/]+$/, "")
    .match(/(?:^|[\\/])profiles[\\/]([^\\/]+)$/)?.[1];
  return RESERVED_HERMES_PROFILE_SLUGS.has(profileSlug);
}

async function detectedHermesProfileAgents(coveredAgentIds) {
  const entries = await readdir(hermesProfilesDir, {
    withFileTypes: true,
  }).catch(() => []);
  const agents = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (RESERVED_HERMES_PROFILE_SLUGS.has(slug)) continue;
    if (coveredAgentIds.has(slug)) continue;
    const profileDir = join(hermesProfilesDir, slug);
    const model = await readHermesModelConfig(profileDir);
    if (!model) continue; // not a configured Hermes profile
    const profileJson = await readJsonFile(join(profileDir, "profile.json"));
    const name =
      (profileJson?.display_name && String(profileJson.display_name)) ||
      (profileJson?.name && String(profileJson.name)) ||
      slug;
    agents.push(
      normalizeRuntimeAgent({
        id: `hermes-${slug}`,
        name,
        runtime: "hermes",
        agentId: slug,
        gatewayUrl: "",
        chatPath: "/chat",
        statusPath: "/health",
        provider: model.provider,
        model: model.model,
        localDataDir: profileDir,
      }),
    );
  }
  return agents;
}

async function localAgents() {
  const agents = [];
  const hermesDb = join(defaultHermesDir, "state.db");
  const hermesAvailable = await access(hermesDb, constants.R_OK)
    .then(() => true)
    .catch(() => false);
  if (hermesAvailable) {
    const rootModel = await readHermesModelConfig(defaultHermesDir);
    agents.push({
      id: `hermes-${hostname()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`,
      name: "Hermes",
      runtime: "hermes",
      gatewayUrl: "",
      agentId: "local-hermes",
      localDataDir: defaultHermesDir,
      machineName: hostname(),
      ...(rootModel?.provider ? { provider: rootModel.provider } : {}),
      ...(rootModel?.model ? { model: rootModel.model } : {}),
    });
  }
  const configuredAgents = await configuredRuntimeAgents();
  agents.push(...configuredAgents);
  if (hermesAvailable) {
    const coveredHermesProfiles = new Set(
      configuredAgents
        .filter((agent) => agent.runtime === "hermes")
        .map((agent) => agent.agentId),
    );
    agents.push(...(await detectedHermesProfileAgents(coveredHermesProfiles)));
  }
  const coveredOpenClawAgentIds = new Set(
    configuredAgents
      .filter((agent) => agent.runtime === "openclaw")
      .map((agent) => agent.agentId),
  );
  agents.push(...(await detectedOpenClawAgents(coveredOpenClawAgentIds)));
  const aeonConfig = join(defaultAeonDir, "aeon.yml");
  const aeonAvailable = await access(aeonConfig, constants.R_OK)
    .then(() => true)
    .catch(() => false);
  if (aeonAvailable) {
    agents.push({
      id: `aeon-${hostname()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`,
      name: "Aeon",
      runtime: "aeon",
      runtimeKind: "background",
      runtimeCapabilities: {
        status: true,
        skills: true,
        schedules: true,
        runs: true,
        outputs: true,
        memory: true,
        notifications: true,
        setup: true,
      },
      gatewayUrl: "",
      aeonLocalPath: defaultAeonDir,
      aeonRepo: process.env.AEON_REPO || "",
      aeonBranch: process.env.AEON_BRANCH || "main",
      aeonMode: process.env.AEON_REPO ? "github" : "local",
      agentId: "local-aeon",
      localDataDir: defaultAeonDir,
      machineName: hostname(),
    });
  }
  return attachAgentDids(await importHermesAgentSouls(agents));
}

// Every agent gets its own did:key identity (GitLawb's per-agent model), even
// for repos that never touch GitLawb — the DID is what signs work receipts.
async function attachAgentDids(agents) {
  const machineId = await stableMachineId().catch(() => "");
  return agents.map((agent) => {
    try {
      const did = agentDid(agent.agentId || agent.id, { machineId });
      return {
        ...agent,
        gitlawb: {
          ...(agent.gitlawb || {}),
          did,
          source: "local",
          publicOnly: true,
        },
      };
    } catch {
      return agent;
    }
  });
}

async function workReceiptRepoState(repoPath) {
  const cwd = expandHome(String(repoPath || "").trim());
  if (!cwd) return null;
  const commit = await execTextAt(cwd, "git", ["rev-parse", "HEAD"]);
  if (!commit) return null;
  const [branch, dirty, remoteUrl] = await Promise.all([
    execTextAt(cwd, "git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    execTextAt(cwd, "git", ["status", "--porcelain"]),
    execTextAt(cwd, "git", ["remote", "get-url", "origin"]),
  ]);
  return {
    path: cwd,
    remoteUrl: remoteUrl || undefined,
    branch: branch || undefined,
    commit,
    dirty: dirty.length > 0,
  };
}

// Receipts land in the shared vault when one exists (so the dashboard sees them
// via Hivemind Sync), with a local fallback otherwise.
async function appendWorkReceipt(receipt) {
  const line = `${JSON.stringify(receipt)}\n`;
  const vaultAvailable = await access(defaultSyncPath, constants.W_OK)
    .then(() => true)
    .catch(() => false);
  if (vaultAvailable) {
    const vaultFile = join(
      defaultSyncPath,
      "Operations",
      "Brain Services",
      "Work Receipts.jsonl",
    );
    const wrote = await mkdir(dirname(vaultFile), { recursive: true })
      .then(() => appendFile(vaultFile, line))
      .then(() => vaultFile)
      .catch(() => "");
    if (wrote) return wrote;
  }
  const localFile = join(homedir(), ".hivemindos", "work-receipts.jsonl");
  await mkdir(dirname(localFile), { recursive: true, mode: 0o700 }).catch(
    () => undefined,
  );
  await appendFile(localFile, line);
  return localFile;
}

async function createWorkReceipt(body) {
  const agentKey = String(body.agentId || body.agentKey || "").trim();
  if (!agentKey) throw new Error("agentId is required for a work receipt.");
  const machineId = await stableMachineId().catch(() => "");
  const repo = body.repoPath ? await workReceiptRepoState(body.repoPath) : null;
  const receipt = signWorkReceipt({
    agentKey,
    agentId: agentKey,
    agentName: typeof body.agentName === "string" ? body.agentName : undefined,
    machineId,
    task: {
      id: typeof body.taskId === "string" ? body.taskId : undefined,
      title: typeof body.taskTitle === "string" ? body.taskTitle : undefined,
      board: typeof body.board === "string" ? body.board : undefined,
    },
    repo: repo || undefined,
  });
  const storedAt = await appendWorkReceipt(receipt);
  return { ...receipt, storedAt };
}

// Host resource telemetry for the /health `system` object lives in a sibling
// module so this legacy file stops growing (CLAUDE.md file-size rule).
// systemStats is imported at the top from ./lib/system-stats.mjs.

// Path candidates use a fast executable check; bare command names fall back
// to a PATH spawn (some CLIs take ~10s cold, hence the generous timeout).
async function binaryInstalled(bin) {
  if (bin.includes(sep) || bin.includes("/")) {
    return access(expandHome(bin), constants.X_OK)
      .then(() => true)
      .catch(() => false);
  }
  const result = await execFileAsync(bin, ["--version"], {
    timeout: 15_000,
    maxBuffer: 200_000,
  }).catch(() => null);
  return Boolean(result);
}

async function anyBinaryInstalled(candidates) {
  for (const bin of candidates.filter(Boolean)) {
    if (await binaryInstalled(bin)) return true;
  }
  return false;
}

function cliRuntimeCandidates(envBin, command) {
  return [
    envBin,
    join(homedir(), ".local", "bin", command),
    join(homedir(), ".npm-global", "bin", command),
    join(homedir(), `.${command}`, "bin", command),
    join(
      homedir(),
      ".nvm",
      "versions",
      "node",
      process.version,
      "bin",
      command,
    ),
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    command,
  ];
}

async function resolveCliRuntimeCommand(envBin, command) {
  for (const candidate of cliRuntimeCandidates(envBin, command).filter(Boolean)) {
    if (await binaryInstalled(candidate)) return candidate;
  }
  return "";
}

async function detectOpenClawInstalled() {
  const runnable = await anyBinaryInstalled([
    process.env.OPENCLAW_BIN,
    "/usr/local/bin/openclaw",
    "/usr/bin/openclaw",
    join(homedir(), ".local", "bin", "openclaw"),
    join(homedir(), ".npm-global", "bin", "openclaw"),
    join(homedir(), ".volta", "bin", "openclaw"),
    "openclaw",
  ]);
  if (runnable) return true;
  return access(join(defaultOpenClawDir, "openclaw.json"), constants.R_OK)
    .then(() => true)
    .catch(() => false);
}

async function detectAeonInstalled() {
  const [hasConfig, hasCatalog, hasCli, hasRootCli] = await Promise.all([
    access(join(defaultAeonDir, "aeon.yml"), constants.R_OK).then(() => true).catch(() => false),
    access(join(defaultAeonDir, "catalog", "skills.json"), constants.R_OK).then(() => true).catch(() => false),
    access(join(defaultAeonDir, "apps", "cli", "aeon"), constants.X_OK).then(() => true).catch(() => false),
    access(join(defaultAeonDir, "aeon"), constants.X_OK).then(() => true).catch(() => false),
  ]);
  return hasConfig && hasCatalog && (hasCli || hasRootCli);
}

// Installed runtime CLIs, independent of whether any agent uses them yet —
// the dashboard gates create-agent runtime cards on this list.
async function installedRuntimes(options = {}) {
  const now = Date.now();
  if (
    installedRuntimesCache &&
    now - installedRuntimesCache.checkedAt < installedRuntimesCacheMs
  ) {
    return installedRuntimesCache.value;
  }
  if (installedRuntimesPromise) {
    // Health is a liveness path, so it must not wait behind cold CLI probes.
    // The collector already reports configured agent runtimes; this inventory
    // fills in additional installed CLIs as soon as the background probe ends.
    if (options.waitForRefresh === false) {
      return installedRuntimesCache ? installedRuntimesCache.value : [];
    }
    return installedRuntimesCache
      ? installedRuntimesCache.value
      : installedRuntimesPromise;
  }
  installedRuntimesPromise = (async () => {
    const checks = await Promise.all([
      resolveHermesBin()
        .then((bin) => binaryInstalled(bin))
        .then((ok) => (ok ? "hermes" : "")),
      detectOpenClawInstalled().then((ok) => (ok ? "openclaw" : "")),
      anyBinaryInstalled(
        cliRuntimeCandidates(process.env.OPENCODE_BIN, "opencode"),
      ).then((ok) => (ok ? "opencode" : "")),
      anyBinaryInstalled(
        cliRuntimeCandidates(process.env.CODEX_BIN, "codex"),
      ).then((ok) => (ok ? "codex" : "")),
      anyBinaryInstalled(
        cliRuntimeCandidates(
          process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN,
          "claude",
        ),
      ).then((ok) => (ok ? "claude-code" : "")),
      detectAeonInstalled().then((ok) => (ok ? "aeon" : "")),
      anyBinaryInstalled(
        cliRuntimeCandidates(process.env.OPENHANDS_BIN, "openhands"),
      ).then((ok) => (ok ? "openhands" : "")),
      anyBinaryInstalled(
        cliRuntimeCandidates(process.env.AIDER_BIN, "aider"),
      ).then((ok) => (ok ? "aider" : "")),
      anyBinaryInstalled(
        cliRuntimeCandidates(process.env.EVO_BIN, "evo"),
      ).then((ok) => (ok ? "evo" : "")),
    ]);
    const value = checks.filter(Boolean);
    installedRuntimesCache = { checkedAt: Date.now(), value };
    return value;
  })().finally(() => {
    installedRuntimesPromise = null;
  });
  if (options.waitForRefresh === false) {
    return installedRuntimesCache ? installedRuntimesCache.value : [];
  }
  return installedRuntimesCache
    ? installedRuntimesCache.value
    : installedRuntimesPromise;
}

async function collectorHealthPayload() {
  const now = Date.now();
  if (
    healthPayloadCache &&
    now - healthPayloadCache.checkedAt < healthCacheMs
  ) {
    return healthPayloadCache.value;
  }
  if (healthPayloadPromise) return healthPayloadPromise;

  healthPayloadPromise = (async () => {
    const [
      syncthing,
      envSync,
      agents,
      machineId,
      version,
      system,
      installed,
      processStats,
      tailnetSelf,
      fleetPolicyState,
    ] = await Promise.all([
      syncthingInstalled(),
      resolveHiveEnvAdd(),
      localAgents(),
      stableMachineId(),
      appVersion(),
      systemStats().catch(() => null),
      installedRuntimes({ waitForRefresh: false }).catch(() => []),
      processResourceStats().catch(() => null),
      tailnetSelfNode().catch(() => null),
      currentFleetMachinePolicy()
        .then((policy) => ({ policy }))
        .catch(() => ({ policy: null })),
    ]);
    const runtimes = [
      ...new Set([...agents.map((agent) => agent.runtime), ...installed]),
    ];
    const value = {
      ok: true,
      host: hostname(),
      machineId,
      tailnetSelf,
      mode: collectorOnly ? "collector-only" : "full",
      collectorStartedAt,
      collectorStartedAtMs,
      version,
      system,
      process: processStats,
      fleetPolicy: fleetPolicyState.policy
        ? fleetMachinePolicyHealthSummary(fleetPolicyState.policy)
        : fleetMachinePolicyFailureSummary(),
      envSync: {
        ready: envSync.ready,
        user: currentUsername(),
        command: [envSync.command, ...envSync.args].join(" "),
        error: envSync.error,
        maintenance: envSyncMaintenanceStatus,
      },
      capabilities: {
        chat: runtimes.includes("hermes"),
        collectorOnly,
        directoryBrowsing: true,
        envHttpSync: true,
        runtimes,
        runtimeIntegrations: true,
        runtimeAgentCreation: true,
        hostedApps: true, appBuilder: true, appBuilderContractVersion: APP_BUILDER_CONTRACT_VERSION,
        skillInventory: true,
        skillAutoSync: true,
        fileTransfers: true,
        workReceipts: true,
        machinePolicy: true,
        remoteShell: process.platform !== "win32", // mirrors linkd's GOOS shell gate; flip when Windows linkd ships shell support
        runtimeState: true,
        runtimeStateRuntimes: portableStateRuntimes(),
        runtimeStateSync: isRuntimeStateSyncEnabled(),
        syncthing: syncthing.installed,
        defaultSyncPath,
      },
    };
    healthPayloadCache = { checkedAt: Date.now(), value };
    return value;
  })().finally(() => {
    healthPayloadPromise = null;
  });
  return healthPayloadPromise;
}

async function sendHermesChat(body, options = {}) {
  if (process.env.AGENT_TELEMETRY_CHAT_DISABLED === "1") {
    return {
      ok: false,
      status: 403,
      error: "Collector chat bridge is disabled on this machine.",
    };
  }

  const message =
    typeof body.message === "string"
      ? body.message
      : Array.isArray(body.messages)
        ? extractUserTextFromMessages(body.messages)
        : "";
  const text =
    (typeof message === "string" ? message.trim() : "") ||
    (Array.isArray(body.messages)
      ? attachmentPromptFromMessages(body.messages)
      : "");
  if (!text) return { ok: false, status: 400, error: "Message is required." };

  const requestedAgent =
    body.agent && typeof body.agent === "object" ? body.agent : {};
  const hermesHome = expandHome(
    sanitizeLocalDataDir(requestedAgent.localDataDir) ||
      sanitizeLocalDataDir(body.localDataDir) ||
      defaultHermesDir,
  );
  const [fleetPolicy, sharedHiveEnv] = await Promise.all([
    currentFleetMachinePolicy(),
    readSharedHiveEnvForSpawn(),
  ]);
  const { agentEnv, sharedEnvBlock } = prepareFleetSharedEnvChat(fleetPolicy, sharedHiveEnv, safeAgentEnv(body.agentEnv), body.context);
  if (sharedEnvBlock) {
    return {
      ...sharedEnvBlock,
      status: 403,
      host: hostname(),
    };
  }
  const openAiSelection = await resolveBillingSafeOpenAiAgent(requestedAgent, hermesHome, sharedHiveEnv);
  const agent = openAiSelection.profile;
  await repairHermesCodexAuthBeforeChat(agent, hermesHome);
  const spawnEnv = fleetPolicySpawnEnv(fleetPolicy, sharedHiveEnv, {
    ...agentEnv,
    ...hermesModelHostEnv(body, agent),
    HERMES_HOME: hermesHome,
    PAGER: "cat",
    ...hermesPrivacyGuardEnv(hermesHome, fleetPolicy),
  });
  const bin = await resolveHermesBin();
  const env = runtimeProcessEnv(spawnEnv.extra, { excludeKeys: spawnEnv.excludedKeys });
  // Tie the hermes CLI lifetime to the HTTP caller: queen-bee delegates abort
  // at 240s while chatTimeoutMs is 20 min, and every abandoned `hermes -z`
  // kept running as a zombie worker burning CPU/memory (the 2026-07-03 hel1-2
  // pile-up amplifier). execFile's AbortSignal support SIGTERMs the child when
  // the /chat response closes early. AGENT_TELEMETRY_CHAT_ABORT_KILL=0
  // restores the old detached behavior.
  const abortSignal =
    process.env.AGENT_TELEMETRY_CHAT_ABORT_KILL === "0"
      ? undefined
      : options.signal;
  const abortedResult = () => ({
    ok: false,
    status: 499,
    error: "Chat canceled: the requesting client disconnected.",
    host: hostname(),
  });
  const runHermes = async (cliArgs) => {
    const { stdout, stderr } = await execFileAsync(bin, cliArgs, {
      timeout: chatTimeoutMs,
      maxBuffer: 3_000_000,
      env,
      ...(abortSignal ? { signal: abortSignal } : {}),
    });
    return (stdout.trim() || stderr.trim());
  };

  // `hermes -z` can exit 0 with NO stdout/stderr (a silent failure) when the agent's
  // model/provider combo is invalid (e.g. an unsupported model id) or a tool loop ends
  // without emitting final text. Treat empty output as a failure to recover from — first
  // retry with the agent's DEFAULT config (no -m/--provider, which is the robust path), and
  // only then report an honest error instead of returning ok:true with empty text.
  const primaryArgs = hermesCliArgs(agent, ["-z", text]);
  const fallbackArgs = ["-z", text];
  const scopedModelRun =
    JSON.stringify(primaryArgs) !== JSON.stringify(fallbackArgs);
  let content = "";
  let primaryError = "";
  try {
    content = await runHermes(primaryArgs);
  } catch (error) {
    if (!abortSignal?.aborted && !scopedModelRun) throw error;
    const maybe = error && typeof error === "object" ? error : {};
    primaryError = String(
      (maybe.stderr || "").trim() ||
        (maybe.stdout || "").trim() ||
        maybe.message ||
        "",
    );
  }
  if (abortSignal?.aborted) return abortedResult();
  // The agent's selected model/provider being unrunnable is a configuration
  // error the user must SEE — answering anyway from the default hermes config
  // silently serves a different (possibly paid) model while the dashboard
  // claims the selected one (the 2026-07-05 Swarm Sovereign Scout → gpt-5.5
  // incident). Config-shaped failures return the real error; only a silent
  // empty run keeps the fallback, and then the swap is declared in the payload.
  const configShapedError =
    /unknown provider|unknown model|unsupported model|no such model|invalid provider|not a valid model/i.test(
      primaryError,
    );
  if (scopedModelRun && configShapedError) {
    return {
      ok: false,
      status: 502,
      error:
        `The agent's selected model (${agent.provider || "?"} / ${agent.model || "?"}) cannot run on this machine's hermes config: ${primaryError}` +
        " Fix the agent's provider/model selection (or this machine's hermes providers) instead of relying on a silent default-model fallback.",
      host: hostname(),
    };
  }
  let modelFallback = null;
  if (!content && scopedModelRun && !openAiSelection.oauthProtected) {
    content = await runHermes(fallbackArgs).catch(() => "");
    if (abortSignal?.aborted) return abortedResult();
    if (content) {
      modelFallback = {
        requestedProvider: agent.provider || "",
        requestedModel: agent.model || "",
        reason: primaryError || "the selected model produced no output",
        note: "Answered by this machine's default hermes model config, NOT the agent's selected model.",
      };
    }
  }
  if (!content) {
    return {
      ok: false,
      status: 502,
      error:
        primaryError ||
        (openAiSelection.oauthProtected
          ? "The OAuth-protected OpenAI run produced no output. HivemindOS blocked the unscoped Hermes fallback because it could use an API-key-billed default provider."
          : "Hermes produced no output (silent failure). Check the agent's model/provider config or simplify the prompt."),
      host: hostname(),
    };
  }
  return {
    ok: true,
    text: content,
    choices: [{ message: { role: "assistant", content } }],
    host: hostname(),
    ...(openAiSelection.redirectedFromApiKey
      ? {
          billingGuard: {
            auth: "oauth", provider: "openai-codex", model: agent.model,
            reason: "ChatGPT OAuth is configured and API-key billing was not explicitly selected.",
          },
        }
      : {}),
    ...(modelFallback
      ? {
          modelFallback,
          warning: `Model fallback: the selected ${modelFallback.requestedProvider}/${modelFallback.requestedModel} failed (${modelFallback.reason}); this reply came from the machine's default hermes model.`,
        }
      : {}),
  };
}

async function hermesApiHealthy() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), hermesApiHealthTimeoutMs);
  try {
    const response = await fetch(`${hermesApiBaseUrl}/health`, {
      headers: hermesApiHeaders(),
      signal: controller.signal,
    });
    // Consume the body: an unread fetch body keeps its socket out of the pool
    // until GC, and this probe runs in a 300ms startup poll loop — a steady
    // fd leak (see the 2026-07-03 NYC EBADF incident).
    await response.body?.cancel().catch(() => {});
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureHermesApiServer(hermesHome) {
  if (await hermesApiHealthy()) return true;
  if (process.env.AGENT_TELEMETRY_START_HERMES_API_SERVER === "0") return false;
  if (hermesApiStartPromise) return hermesApiStartPromise;

  hermesApiStartPromise = (async () => {
    const bin = await resolveHermesBin();
    hermesApiProcess = spawn(bin, ["gateway", "run", "--accept-hooks"], {
      env: runtimeProcessEnv({
        HERMES_HOME: hermesHome,
        API_SERVER_ENABLED: "true",
        API_SERVER_HOST: hermesApiHost,
        API_SERVER_PORT: String(hermesApiPort),
        ...(hermesApiKey ? { API_SERVER_KEY: hermesApiKey } : {}),
        PAGER: "cat",
        ...hermesPrivacyGuardEnv(hermesHome),
      }),
      stdio: ["ignore", "inherit", "inherit"],
    });
    hermesApiProcess.on("exit", () => {
      hermesApiProcess = null;
      hermesApiStartPromise = null;
    });
    hermesApiProcess.on("error", () => {
      hermesApiProcess = null;
      hermesApiStartPromise = null;
    });

    const deadline = Date.now() + hermesApiStartTimeoutMs;
    while (Date.now() < deadline) {
      if (await hermesApiHealthy()) return true;
      await sleep(300);
    }
    return false;
  })();

  return hermesApiStartPromise;
}

// Hermes' built-in lmstudio provider reads LM_BASE_URL at request time, so a
// model hosted on another fleet machine routes there for this run only — no
// config files change anywhere.
function hermesModelHostEnv(body, agent) {
  const baseUrl =
    typeof body.lmStudioBaseUrl === "string" ? body.lmStudioBaseUrl.trim() : "";
  const provider =
    typeof agent.provider === "string" ? agent.provider.trim() : "";
  if (!baseUrl || provider !== "lm-studio") return {};
  return { LM_BASE_URL: baseUrl };
}

function hermesCliArgs(agent, tailArgs) {
  const args = [];
  const model = typeof agent.model === "string" ? agent.model.trim() : "";
  const provider =
    typeof agent.provider === "string" ? agent.provider.trim() : "";
  if (tailArgs[0] === "chat") {
    args.push("chat");
    if (model) args.push("-m", model);
    if (provider) args.push("--provider", provider);
    return [...args, ...tailArgs.slice(1)];
  }
  if (model) args.push("-m", model);
  if (provider) args.push("--provider", provider);
  return [...args, ...tailArgs];
}

function normalizeHermesSessionId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.replace(/^session_/, "").replace(/\.json$/, "");
}

// HivemindOS chat-store session ids (hive-chat-*, hermes-<agent>-<ts>) are not
// Hermes CLI sessions; passing them to `--resume` makes the CLI exit with
// "Session not found". Only resume ids the CLI itself issued.
function isHermesCliSessionId(value) {
  return (
    /^\d{8}_\d{6}_[0-9a-z]+$/i.test(value) || /^api-[0-9a-f]+$/i.test(value)
  );
}

function hermesSessionIdFromFile(name) {
  return normalizeHermesSessionId(name);
}

function readableSessionMessageContent(message) {
  const content = readableChatContent(
    message?.content ?? message?.text ?? message?.message ?? "",
  );
  if (/^---\s*name:\s*kanban-worker\b/i.test(content.trim())) return "";
  return content;
}

async function readHermesApiSession(hermesHome, sessionId) {
  const normalized = normalizeHermesSessionId(sessionId);
  if (!normalized) return null;
  const filePath = join(hermesHome, "sessions", `session_${normalized}.json`);
  try {
    const [raw, fileStats] = await Promise.all([
      readFile(filePath, "utf-8"),
      stat(filePath),
    ]);
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .map((message, index) => ({
            index,
            role:
              message?.role === "user" ||
              message?.role === "assistant" ||
              message?.role === "tool"
                ? message.role
                : "assistant",
            content: readableSessionMessageContent(message),
            createdAt:
              Number(message?.created_at || message?.timestamp || 0) >
              1_000_000_000_000
                ? Number(message?.created_at || message?.timestamp)
                : fileStats.mtimeMs,
          }))
          .filter((message) => message.content.trim())
      : [];
    return {
      sessionId: normalizeHermesSessionId(parsed.session_id || normalized),
      file: filePath,
      startedAt: parsed.session_start
        ? Date.parse(parsed.session_start) || fileStats.birthtimeMs
        : fileStats.birthtimeMs,
      updatedAt: parsed.last_updated
        ? Date.parse(parsed.last_updated) || fileStats.mtimeMs
        : fileStats.mtimeMs,
      messageCount: parsed.message_count ?? messages.length,
      messages,
    };
  } catch {
    return null;
  }
}

function hermesSessionRoots(hermesHome) {
  const roots = [expandHome(hermesHome || defaultHermesDir), defaultHermesDir]
    .filter(Boolean)
    .map((root) => resolve(root));
  return [...new Set(roots)];
}

async function readHermesDbSession(hermesHome, sessionId) {
  const normalized = normalizeHermesSessionId(sessionId);
  if (!normalized) return null;
  const dbPath = join(hermesHome, "state.db");
  try {
    await access(dbPath, constants.R_OK);
  } catch {
    return null;
  }
  const escaped = normalized.replaceAll("'", "''");
  const sessions = await execJson(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
    select id, source, started_at, ended_at, end_reason, title, message_count, tool_call_count
    from sessions
    where id = '${escaped}'
    limit 1;
  `,
    ],
    [],
  );
  const session = sessions[0];
  if (!session) return null;
  const rows = await execJson(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
    select role, content, tool_name, timestamp
    from messages
    where session_id = '${escaped}'
    order by timestamp asc
    limit 200;
  `,
    ],
    [],
  );
  const messages = rows
    .map((message, index) => ({
      index,
      role:
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "tool"
          ? message.role
          : "assistant",
      content: readableSessionMessageContent(message),
      createdAt:
        Number(message.timestamp || 0) > 0
          ? Number(message.timestamp) * 1000
          : 0,
    }))
    .filter((message) => message.content.trim());
  return {
    sessionId: normalized,
    source: session.source || "state.db",
    endedAt:
      Number(session.ended_at || 0) > 0 ? Number(session.ended_at) * 1000 : 0,
    endReason: session.end_reason || "",
    title: session.title || "",
    startedAt:
      Number(session.started_at || 0) > 0
        ? Number(session.started_at) * 1000
        : 0,
    updatedAt:
      messages.at(-1)?.createdAt ||
      (Number(session.started_at || 0) > 0
        ? Number(session.started_at) * 1000
        : 0),
    messageCount: session.message_count ?? messages.length,
    messages,
  };
}

async function listRecentHermesDbSessions(hermesHome, sinceMs = 0) {
  const dbPath = join(hermesHome, "state.db");
  try {
    await access(dbPath, constants.R_OK);
  } catch {
    return [];
  }
  const sinceSeconds = Math.max(0, Math.floor(Number(sinceMs || 0) / 1000));
  const rows = await execJson(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
    select id
    from sessions
    where started_at >= ${sinceSeconds}
    order by started_at desc
    limit 20;
  `,
    ],
    [],
  );
  return (
    await Promise.all(
      rows.map((row) => readHermesDbSession(hermesHome, row.id)),
    )
  ).filter(Boolean);
}

async function listRecentHermesApiSessions(hermesHome, sinceMs = 0) {
  const dir = join(hermesHome, "sessions");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^session_api-.*\.json$/.test(entry.name)) continue;
    const filePath = join(dir, entry.name);
    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats || fileStats.mtimeMs < sinceMs) continue;
    files.push({ name: entry.name, mtimeMs: fileStats.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return (
    await Promise.all(
      files
        .slice(0, 20)
        .map((file) =>
          readHermesApiSession(hermesHome, hermesSessionIdFromFile(file.name)),
        ),
    )
  ).filter(Boolean);
}

async function readRuntimeSession(runtime, options = {}) {
  if (runtime !== "hermes") return null;
  const hermesHome = expandHome(
    sanitizeLocalDataDir(options.localDataDir) || defaultHermesDir,
  );
  // RESERVED profiles (e.g. the fleet-watchdog's runtime-capability-probe) are
  // excluded from the agent roster, but a dashboard may still hold a stale
  // persisted agent pointing at one and poll its sessions. Never serve them, so
  // health-probe turns can't surface in the chat tree via that back door.
  const hermesHomeSlug = hermesHome.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  if (RESERVED_HERMES_PROFILE_SLUGS.has(hermesHomeSlug)) return null;
  const sessionId = options.sessionId || "";
  const sinceMs = Number(options.sinceMs || 0);
  if (sessionId) {
    for (const root of hermesSessionRoots(hermesHome)) {
      const apiSession = await readHermesApiSession(root, sessionId);
      const dbSession = apiSession?.messages?.length
        ? null
        : await readHermesDbSession(root, sessionId);
      const session = dbSession ?? apiSession;
      if (session) return { ...session, runtime: "hermes" };
    }
    return null;
  }
  const sessionGroups = await Promise.all(
    hermesSessionRoots(hermesHome).map(async (root) => [
      ...(await listRecentHermesApiSessions(root, sinceMs)),
      ...(await listRecentHermesDbSessions(root, sinceMs)),
    ]),
  );
  const session =
    sessionGroups
      .flat()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] ?? null;
  return session ? { ...session, runtime: "hermes" } : null;
}

async function findHermesCliSession(hermesHome, sinceMs, text) {
  const needle = text.trim().slice(0, 80);
  const sessions = await listRecentHermesDbSessions(hermesHome, sinceMs);
  const matched = sessions.find(
    (session) =>
      !needle ||
      session.messages.some(
        (message) =>
          message.role === "user" && message.content.includes(needle),
      ),
  );
  return matched ?? sessions.find((session) => !session.endedAt) ?? null;
}

async function waitForHermesCliSession(hermesHome, sinceMs, text) {
  const deadline = Date.now() + sessionDiscoveryTimeoutMs;
  while (Date.now() < deadline) {
    const session = await findHermesCliSession(hermesHome, sinceMs, text);
    if (session) return session;
    await sleep(250);
  }
  return null;
}

async function waitForHermesApiSession(
  hermesHome,
  sinceMs,
  text,
  requestMarker = "",
) {
  const needle = text.trim().slice(0, 80);
  const deadline = Date.now() + sessionDiscoveryTimeoutMs;
  while (Date.now() < deadline) {
    const sessionGroups = await Promise.all(
      hermesSessionRoots(hermesHome).map(async (root) => [
        ...(await listRecentHermesApiSessions(root, sinceMs)),
        ...(await listRecentHermesDbSessions(root, sinceMs)),
      ]),
    );
    const sessions = sessionGroups.flat();
    if (requestMarker) {
      const markerMatched = sessions.find((session) =>
        session.messages.some((message) =>
          message.content.includes(requestMarker),
        ),
      );
      if (markerMatched) return markerMatched;
    }
    const matched = sessions.find(
      (session) =>
        !needle ||
        session.messages.some(
          (message) =>
            message.role === "user" && message.content.includes(needle),
        ),
    );
    if (matched) return matched;
    await sleep(250);
  }
  return null;
}

async function proxyHermesApiChat(body, response, text, hermesHome, fleetPolicy = null) {
  const requestStartedAt = Date.now();
  const requestMarker = `hivemindos-${requestStartedAt.toString(36)}-${randomBytes(4).toString("hex")}`;
  const runtimeSessionId = safeTelemetryText(
    body.runtimeSessionId || body.hermesSessionId || "",
    160,
  );
  const chatStorageKey = safeTelemetryText(
    body.chatStorageKey || body.threadId || "",
    160,
  );
  const agent =
    body.agent && typeof body.agent === "object" && !Array.isArray(body.agent)
      ? body.agent
      : {};
  const hasMultimodal = messagesHaveMultimodalContent(body.messages);
  const telemetryBase = {
    requestMarker,
    runtimeSessionId: runtimeSessionId || null,
    agentId: safeTelemetryText(agent.id || "", 120) || null,
    agentName: safeTelemetryText(agent.name || "", 120) || null,
    runtime: "hermes",
    bridge: "api-server",
    model: safeTelemetryText(agent.model || "hermes-agent", 160),
    provider: safeTelemetryText(agent.provider || "", 120) || null,
    messageLength: text.length,
    bodyMessageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    hasMultimodal,
    usesDefaultHermesHome:
      resolve(hermesHome || defaultHermesDir) === resolve(defaultHermesDir),
  };
  const emitTelemetry = (type, payload = {}) =>
    recordCollectorTelemetry(
      `agent_runtime.hermes_api_proxy.${type}`,
      {
        ...telemetryBase,
        ...payload,
        elapsedMs: Date.now() - requestStartedAt,
      },
      { runId: runtimeSessionId || requestMarker, threadId: chatStorageKey },
    );
  void emitTelemetry("request.start");
  if (!(await ensureHermesApiServer(hermesHome))) {
    await emitTelemetry("server.unavailable");
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), chatTimeoutMs);
  let sessionTimer = null;
  let heartbeatTimer = null;
  let emittedSession = false;
  let sessionLookupInFlight = false;
  let observedHermesSessionId = "";
  let streamCompleted = false;

  const ensureHeaders = () => {
    if (response.headersSent || response.writableEnded) return;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-hermes-stream-source": "api-server",
    });
  };

  async function emitSession() {
    if (emittedSession || sessionLookupInFlight || response.writableEnded)
      return;
    sessionLookupInFlight = true;
    try {
      const session = await waitForHermesApiSession(
        hermesHome,
        requestStartedAt - 2_000,
        text,
      );
      if (!session || emittedSession || response.writableEnded) return;
      emittedSession = true;
      observedHermesSessionId = session.sessionId || observedHermesSessionId;
      void emitTelemetry("session.detected", {
        hermesSessionId: observedHermesSessionId,
        sessionSource: safeTelemetryText(session.source || "hermes", 80),
        sessionMessageCount: session.messages.length,
        sessionStartedOffsetMs: session.startedAt
          ? Math.round(session.startedAt - requestStartedAt)
          : null,
        sessionUpdatedOffsetMs: session.updatedAt
          ? Math.round(session.updatedAt - requestStartedAt)
          : null,
      });
      ensureHeaders();
      response.write(
        ssePayload({
          session: {
            id: session.sessionId,
            runtime: session.runtime || "hermes",
            source: session.source || "hermes",
            startedAt: session.startedAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
          },
        }),
      );
    } finally {
      sessionLookupInFlight = false;
    }
  }

  try {
    response.on("close", () => {
      controller.abort();
      if (!streamCompleted)
        void emitTelemetry("client.closed", {
          hermesSessionId: observedHermesSessionId || null,
        });
    });
    ensureHeaders();
    response.write(": waiting for Hermes API stream\n\n");
    heartbeatTimer = setInterval(() => {
      if (response.writableEnded || response.destroyed) return;
      response.write(": Hermes API stream still working\n\n");
    }, 15_000);
    sessionTimer = setInterval(() => {
      void emitSession().catch(() => undefined);
    }, 1_000);

    const upstreamStartedAt = Date.now();
    void emitTelemetry("model_request.start", {
      endpoint: "/v1/chat/completions",
    });
    const policyPrompt = fleetMachinePolicyPrompt(fleetPolicy);
    const policyAwareBody = policyPrompt
      ? {
          ...body,
          messages: [
            { role: "system", content: policyPrompt },
            ...(Array.isArray(body.messages) && body.messages.length
              ? body.messages
              : [{ role: "user", content: text }]),
          ],
        }
      : body;
    const upstream = await fetch(`${hermesApiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: hermesApiHeaders({
        "Content-Type": "application/json",
        ...hermesApiSessionHeaders(body, { authenticated: Boolean(hermesApiKey) }),
      }),
      body: JSON.stringify({
        model: agent.model || "hermes-agent",
        provider: agent.provider || undefined,
        stream: true,
        messages: hermesApiMessages(policyAwareBody, text, normalizeMessageContent),
      }),
      signal: controller.signal,
    });
    const upstreamHermesSessionId = hermesSessionIdFromResponse(upstream.headers);
    if (upstreamHermesSessionId) {
      observedHermesSessionId = upstreamHermesSessionId;
      if (!emittedSession) {
        emittedSession = true;
        void emitTelemetry("session.detected", {
          hermesSessionId: observedHermesSessionId,
          sessionSource: "api-response-header",
        });
        ensureHeaders();
        response.write(
          ssePayload({
            session: {
              id: observedHermesSessionId,
              runtime: "hermes",
              source: "api-response-header",
            },
          }),
        );
      }
    }
    void emitTelemetry("model_request.response", {
      status: upstream.status,
      ok: upstream.ok,
      responseMs: Date.now() - upstreamStartedAt,
      contentType: safeTelemetryText(
        upstream.headers.get("content-type") || "",
        120,
      ) || null,
    });
    if (!upstream.ok || !upstream.body) {
      const errorText = await upstream.text().catch(() => "");
      await emitTelemetry("model_request.error", {
        status: upstream.status || 502,
        responseMs: Date.now() - upstreamStartedAt,
        errorLength: errorText.length,
      });
      const fallbackMessage = messagesHaveMultimodalContent(body.messages)
        ? "Hermes rejected the attached media."
        : `Hermes API returned ${upstream.status || 502}.`;
      streamCompleted = true;
      response.end(
        ssePayload({ error: errorText || fallbackMessage }) +
          "data: [DONE]\n\n",
      );
      return true;
    }

    await emitSession();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let wroteContent = false;
    let wroteDone = false;
    let upstreamChunkCount = 0;
    let upstreamByteCount = 0;
    let sseEventCount = 0;
    let contentDeltaCount = 0;
    let outputLength = 0;
    let processPayloadCount = 0;
    let processToolCallCount = 0;
    let firstByteElapsedMs = null;
    let firstContentElapsedMs = null;
    let firstProcessElapsedMs = null;
    let doneSignalElapsedMs = null;
    const processToolNames = new Set();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      upstreamChunkCount += 1;
      upstreamByteCount += value?.byteLength ?? value?.length ?? 0;
      if (firstByteElapsedMs === null) {
        firstByteElapsedMs = Date.now() - requestStartedAt;
        void emitTelemetry("model_stream.first_byte", {
          responseMs: Date.now() - upstreamStartedAt,
          upstreamChunkCount,
          upstreamByteCount,
        });
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const eventText of events) {
        sseEventCount += 1;
        const dataLine = eventText
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const raw = dataLine.replace(/^data:\s*/, "");
        if (raw === "[DONE]") {
          doneSignalElapsedMs = Date.now() - requestStartedAt;
          void emitTelemetry("model_stream.done_signal", {
            upstreamChunkCount,
            upstreamByteCount,
            sseEventCount,
          });
          if (hasMultimodal && !wroteContent) {
            ensureHeaders();
            response.write(
              ssePayload({
                error:
                  "Hermes accepted the attached media but returned no text. Check that the active Hermes model supports the attached image/audio type.",
              }),
            );
          }
          wroteDone = true;
          continue;
        }
        try {
          const parsed = JSON.parse(raw);
          const errorMessage =
            typeof parsed?.error === "string"
              ? parsed.error
              : typeof parsed?.error?.message === "string"
                ? parsed.error.message
                : "";
          if (errorMessage.trim()) {
            void emitTelemetry("model_stream.error_event", {
              errorLength: errorMessage.length,
              upstreamChunkCount,
              sseEventCount,
            });
            ensureHeaders();
            response.write(ssePayload({ error: errorMessage }));
            wroteDone = true;
            continue;
          }
          const content = streamingChatContent(parsed);
          const processPayload = streamingChatProcessPayload(parsed);
          const processSummary = summarizeHermesProcessPayload(
            processPayload || parsed,
          );
          if (
            processSummary &&
            (processPayload ||
              processSummary.toolCallCount ||
              processSummary.statusType ||
              processSummary.hasReasoning ||
              processSummary.usage)
          ) {
            processPayloadCount += 1;
            processToolCallCount += processSummary.toolCallCount || 0;
            for (const toolName of processSummary.toolNames || []) {
              processToolNames.add(toolName);
            }
            if (firstProcessElapsedMs === null)
              firstProcessElapsedMs = Date.now() - requestStartedAt;
            void emitTelemetry("process_event", {
              processPayloadCount,
              ...processSummary,
            });
          }
          if (content) {
            wroteContent = true;
            contentDeltaCount += 1;
            outputLength += content.length;
            if (firstContentElapsedMs === null) {
              firstContentElapsedMs = Date.now() - requestStartedAt;
              void emitTelemetry("model_stream.first_content", {
                contentLength: content.length,
                responseMs: Date.now() - upstreamStartedAt,
                upstreamChunkCount,
                sseEventCount,
              });
            }
            ensureHeaders();
            response.write(ssePayload({ choices: [{ delta: { content } }] }));
          } else {
            if (processPayload) {
              ensureHeaders();
              response.write(ssePayload(processPayload));
            }
          }
        } catch {
          // Ignore non-JSON SSE comments or custom tool events for the dashboard chat surface.
        }
      }
    }
    if (hasMultimodal && !wroteContent && !wroteDone) {
      ensureHeaders();
      response.write(
        ssePayload({
          error:
            "Hermes accepted the attached media but returned no text. Check that the active Hermes model supports the attached image/audio type.",
        }),
      );
      wroteDone = true;
    } else if (!hasMultimodal && !wroteContent) {
      ensureHeaders();
      response.write(
        ssePayload({
          error:
            "Hermes API finished without returning any text. Check the active provider, model, and credentials.",
        }),
      );
      wroteDone = true;
    }
    await emitSession();
    if (!wroteContent && !emittedSession && !response.headersSent) {
      await emitTelemetry("model_stream.empty_fallback", {
        upstreamChunkCount,
        upstreamByteCount,
        sseEventCount,
        wroteDone,
      });
      return false;
    }
    ensureHeaders();
    streamCompleted = true;
    response.write("data: [DONE]\n\n");
    if (!response.writableEnded) response.end();
    const sessionTimeline = observedHermesSessionId
      ? await summarizeHermesDbSessionTimeline(
          hermesHome,
          observedHermesSessionId,
          requestStartedAt,
        )
      : null;
    await emitTelemetry("model_stream.completed", {
      hermesSessionId: observedHermesSessionId || null,
      firstByteElapsedMs,
      firstContentElapsedMs,
      firstProcessElapsedMs,
      doneSignalElapsedMs,
      responseMs: Date.now() - upstreamStartedAt,
      upstreamChunkCount,
      upstreamByteCount,
      sseEventCount,
      contentDeltaCount,
      outputLength,
      processPayloadCount,
      processToolCallCount,
      processToolNames: [...processToolNames].slice(0, 30),
      wroteContent,
      wroteDone,
      sessionTimeline,
    });
    return true;
  } catch (error) {
    streamCompleted = true;
    await emitTelemetry("model_stream.failed", {
      hermesSessionId: observedHermesSessionId || null,
      aborted: controller.signal.aborted,
      errorName: safeTelemetryText(error?.name || "", 80) || null,
      errorMessage: safeTelemetryText(error?.message || "", 180) || null,
    });
    if (!response.writableEnded) {
      response.write(
        ssePayload({ error: "Hermes API streaming interrupted." }),
      );
      response.end("data: [DONE]\n\n");
    }
    return true;
  } finally {
    clearTimeout(timer);
    if (sessionTimer) clearInterval(sessionTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

async function streamHermesChat(body, response, options = {}) {
  const releaseCollectorChatRun =
    typeof options.releaseCollectorChatRun === "function"
      ? options.releaseCollectorChatRun
      : () => undefined;
  if (process.env.AGENT_TELEMETRY_CHAT_DISABLED === "1") {
    response.writeHead(403, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.end(
      ssePayload({
        error: "Collector chat bridge is disabled on this machine.",
      }) + "data: [DONE]\n\n",
    );
    releaseCollectorChatRun();
    return;
  }

  const rawMessage =
    typeof body.rawUserMessage === "string" ? body.rawUserMessage.trim() : "";
  const message =
    typeof body.message === "string"
      ? body.message
      : Array.isArray(body.messages)
        ? extractUserTextFromMessages(body.messages)
        : rawMessage;
  const text =
    (typeof message === "string" ? message.trim() : "") ||
    (Array.isArray(body.messages)
      ? attachmentPromptFromMessages(body.messages)
      : "");
  const sessionMatchText = rawMessage || text;
  if (!text) {
    response.writeHead(400, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.end(
      ssePayload({ error: "Message is required." }) + "data: [DONE]\n\n",
    );
    releaseCollectorChatRun();
    return;
  }
  const requestedAgent =
    body.agent && typeof body.agent === "object" ? body.agent : {};
  const hermesHome = expandHome(
    sanitizeLocalDataDir(requestedAgent.localDataDir) ||
      sanitizeLocalDataDir(body.localDataDir) ||
      defaultHermesDir,
  );
  const [fleetPolicy, sharedHiveEnv] = await Promise.all([
    currentFleetMachinePolicy(),
    readSharedHiveEnvForSpawn(),
  ]);
  const { agentEnv, sharedEnvBlock } = prepareFleetSharedEnvChat(fleetPolicy, sharedHiveEnv, safeAgentEnv(body.agentEnv), body.context);
  if (sharedEnvBlock) {
    jsonResponse(response, 403, {
      ...sharedEnvBlock,
      host: hostname(),
    });
    releaseCollectorChatRun();
    return;
  }
  const openAiSelection = await resolveBillingSafeOpenAiAgent(requestedAgent, hermesHome, sharedHiveEnv);
  const agent = openAiSelection.profile;
  await repairHermesCodexAuthBeforeChat(agent, hermesHome);
  // The Hermes gateway API server runs its configured default model and
  // ignores per-request model/provider. An explicit selection does not need a
  // cold CLI process when it already matches that live gateway. Distinct
  // profile homes or genuinely different selections still use the CLI path,
  // which honors HERMES_HOME plus `-m/--provider`.
  const gatewaySelection =
    hermesHome === defaultHermesDir
      ? await readHermesModelConfig(defaultHermesDir)
      : null;
  const agentNeedsScopedCli =
    hermesHome !== defaultHermesDir ||
    !hermesApiSelectionMatchesAgent(agent, gatewaySelection) ||
    fleetPolicyNeedsIsolatedHermes(fleetPolicy);
  if (
    body.forceHermesCli !== true &&
    !agentNeedsScopedCli &&
    hermesChatMode === "api" &&
    (await proxyHermesApiChat({ ...body, agent }, response, text, hermesHome, fleetPolicy))
  ) {
    releaseCollectorChatRun();
    return;
  }

  const runtimeSessionId = normalizeHermesSessionId(
    body.runtimeSessionId || body.hermesSessionId || "",
  );
  const args = hermesCliArgs(agent, [
    "chat",
    "-q",
    text,
    "--accept-hooks",
    "--source",
    "hivemindos",
  ]);
  if (
    runtimeSessionId &&
    body.disableHermesResume !== true &&
    (!fleetPolicy.authority || effectiveFleetAccess(fleetPolicy).chatHistory === "allow") &&
    isHermesCliSessionId(runtimeSessionId)
  )
    args.push("--resume", runtimeSessionId);
  const cwd = await resolveChatWorkingDirectory(body.workingDirectory);
  const requestStartedAt = Date.now();

  // Latest shared creds (provider keys) win only when this machine's master-hub
  // policy allows shared-env access. ASK/DENY strips inherited copies too.
  const spawnEnv = fleetPolicySpawnEnv(fleetPolicy, sharedHiveEnv, {
    ...agentEnv,
    ...hermesModelHostEnv(body, agent),
    HERMES_HOME: hermesHome,
    HERMES_ACCEPT_HOOKS: "1",
    PAGER: "cat",
    ...hermesPrivacyGuardEnv(hermesHome, fleetPolicy),
  });
  const launch = await resolveHermesStreamingLaunch(args);
  const child = spawn(launch.command, launch.args, {
    cwd,
    env: runtimeProcessEnv(spawnEnv.extra, { excludeKeys: spawnEnv.excludedKeys }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let settled = false;
  let emittedSession = false;
  let emittedHermesSessionId = "";
  let sessionLookupInFlight = false;
  let sessionTimer = null;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-hermes-stream-source": "cli-chat",
  });
  const streamProtocol = createHermesCliStreamProtocol({
    onAssistantDelta: (content) => {
      if (!settled && !response.writableEnded && !response.destroyed) {
        response.write(ssePayload({ choices: [{ delta: { content } }] }));
      }
    },
    onAssistantReset: (content) => {
      if (!settled && !response.writableEnded && !response.destroyed) {
        response.write(ssePayload({ type: "assistant.reset", content }));
      }
    },
    onProcessEvent: (event) => {
      if (!settled && !response.writableEnded && !response.destroyed) {
        response.write(ssePayload(event));
      }
    },
  });

  const finish = (payload = null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (sessionTimer) clearInterval(sessionTimer);
    if (!response.writableEnded && !response.destroyed) {
      if (payload) response.write(ssePayload(payload));
      response.end("data: [DONE]\n\n");
    }
  };
  async function emitSession() {
    if (
      emittedSession ||
      sessionLookupInFlight ||
      settled ||
      response.writableEnded ||
      response.destroyed
    )
      return;
    sessionLookupInFlight = true;
    try {
      const session = await waitForHermesCliSession(
        hermesHome,
        requestStartedAt - 2_000,
        sessionMatchText,
      );
      if (
        !session ||
        emittedSession ||
        settled ||
        response.writableEnded ||
        response.destroyed
      )
        return;
      emittedSession = true;
      emittedHermesSessionId = session.sessionId;
      response.write(
        ssePayload({
          session: {
            id: session.sessionId,
            runtime: session.runtime || "hermes",
            source: session.source || "hermes",
            startedAt: session.startedAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
          },
        }),
      );
    } finally {
      sessionLookupInFlight = false;
    }
  }

  sessionTimer = setInterval(() => {
    void emitSession().catch(() => undefined);
  }, 1_000);
  void emitSession().catch(() => undefined);

  const timeout = setTimeout(() => {
    if (emittedSession) {
      child.unref();
      finish();
      return;
    }
    child.kill("SIGTERM");
    finish({
      error: `Hermes chat timed out after ${chatTimeoutMs}ms before a pollable session was created.`,
    });
  }, chatTimeoutMs);

  response.on("close", () => {
    if (settled) return;
    if (emittedSession) {
      settled = true;
      clearTimeout(timeout);
      if (sessionTimer) clearInterval(sessionTimer);
      child.unref();
      return;
    }
    child.kill("SIGTERM");
  });

  child.stdout.on("data", (chunk) => {
    const textChunk = chunk.toString("utf8");
    stdout += textChunk;
    streamProtocol.push(textChunk);
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.on("error", (error) => {
    releaseCollectorChatRun();
    finish({
      error: error instanceof Error ? error.message : "Hermes chat failed",
    });
  });

  child.on("close", (code) => {
    releaseCollectorChatRun();
    if (settled) return;
    streamProtocol.flush();
    void (async () => {
      const content = stripHermesCliMetadata(stdout);
      const errorText = stripHermesCliMetadata(stderr);
      if (code === 0) {
        const completedSession = emittedHermesSessionId
          ? await readHermesDbSession(hermesHome, emittedHermesSessionId).catch(() => null)
          : await findHermesCliSession(hermesHome, requestStartedAt - 2_000, sessionMatchText).catch(() => null);
        const finalAssistantText = [...(completedSession?.messages ?? [])]
          .reverse()
          .find((message) => message.role === "assistant" && message.content.trim())
          ?.content.trim();
        const snapshot = streamProtocol.snapshot();
        const finalContent = finalAssistantText || (!snapshot.sawAssistantDelta ? content || errorText : "");
        streamProtocol.reconcileFinal(finalContent);
        finish();
        return;
      }
      finish({ error: errorText || `Hermes exited with code ${code ?? "unknown"}.` });
    })();
  });
}

async function snapshotFor(agent) {
  const dataDir = expandHome(
    sanitizeLocalDataDir(agent.localDataDir) ||
      (agent.runtime === "hermes" ? defaultHermesDir : ""),
  );
  const [hermesTasks, fileTasks, running] = await Promise.all([
    agent.runtime === "hermes" && dataDir
      ? scanHermesState(agent, dataDir)
      : Promise.resolve([]),
    dataDir ? scanFiles(agent, dataDir) : Promise.resolve([]),
    processSeen(agent),
  ]);
  const tasks = [...hermesTasks, ...fileTasks]
    .sort(
      (a, b) =>
        (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0) ||
        b.updatedAt - a.updatedAt,
    )
    .slice(0, 12);
  return {
    agentId: agent.id,
    ok: running || tasks.length > 0,
    runtimeReachable: true,
    processRunning: running,
    summary:
      tasks[0]?.title ||
      (running
        ? "Process is running; no task title exposed yet."
        : "No local activity found."),
    sources: [
      tasks.some((task) => task.source === "hermes-state")
        ? "Hermes history"
        : "",
      tasks.some((task) => task.source?.startsWith("file/"))
        ? "runtime files"
        : "",
      running ? "local process" : "",
      hostname(),
    ].filter(Boolean),
    tasks,
    checkedAt: Date.now(),
  };
}

// Both readers resolve (with what arrived) on stream error too: without an
// "error" listener a mid-body ECONNRESET is an unhandled stream error — an
// uncaughtException — and the awaiting handler would hang forever.
function readBody(request) {
  return new Promise((resolveBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
    request.on("error", () => resolveBody(body));
  });
}

function readBodyBuffer(request) {
  return new Promise((resolveBody) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", () => resolveBody(Buffer.concat(chunks)));
  });
}

function proxiedAppTarget(pathname, search) {
  const match = pathname.match(/^\/app-proxy\/(\d+)(\/.*)?$/);
  const targetPort = Number(match?.[1]);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)
    return "";
  const targetPath = match?.[2] || "/";
  return `http://127.0.0.1:${targetPort}${targetPath}${search || ""}`;
}

function proxyAppWebSocket(request, socket, head) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const targetUrl = proxiedAppTarget(requestUrl.pathname, requestUrl.search);
  if (!targetUrl) {
    socket.write(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nInvalid app proxy target.",
    );
    socket.destroy();
    return;
  }
  const target = new URL(targetUrl);
  const upstream = connect(Number(target.port), target.hostname);
  const closeBoth = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("connect", () => {
    const requestPath = `${target.pathname}${target.search}`;
    const lines = [
      `${request.method || "GET"} ${requestPath} HTTP/${request.httpVersion || "1.1"}`,
    ];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const key = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (!key || ["host", "origin"].includes(key.toLowerCase())) continue;
      lines.push(`${key}: ${value}`);
    }
    lines.push(`Host: ${target.host}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => {
    if (!socket.destroyed) {
      socket.write(
        "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\nCould not proxy hosted app websocket.",
      );
    }
    closeBoth();
  });
  socket.on("error", closeBoth);
  // A clean client close emits "close" without "error"; without this the
  // upstream socket leaks when the client goes away mid-handshake.
  socket.on("close", closeBoth);
}

async function proxyAppHttp(request, response, targetUrl) {
  const target = new URL(targetUrl);
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (
      !value ||
      [
        "host",
        "connection",
        "content-length",
        "accept-encoding",
        "origin",
      ].includes(key.toLowerCase())
    )
      continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers.host = target.host;
  headers.connection = "close";
  const body = ["GET", "HEAD"].includes(request.method || "GET")
    ? undefined
    : await readBodyBuffer(request);

  await new Promise((resolve, reject) => {
    const upstream = httpRequest(
      target,
      { method: request.method, headers },
      (appResponse) => {
        const responseHeaders = {};
        for (const [key, value] of Object.entries(appResponse.headers)) {
          if (
            ["connection", "content-encoding", "transfer-encoding"].includes(
              key.toLowerCase(),
            )
          )
            continue;
          responseHeaders[key] = Array.isArray(value)
            ? value.join(", ")
            : value;
        }
        responseHeaders["cache-control"] =
          responseHeaders["cache-control"] || "no-store";
        response.writeHead(appResponse.statusCode || 502, responseHeaders);
        const contentLength = Number(
          appResponse.headers["content-length"] || 0,
        );
        let received = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (!response.writableEnded) response.end();
          resolve();
        };
        appResponse.on("data", (chunk) => {
          received += chunk.length;
          response.write(chunk);
          if (contentLength > 0 && received >= contentLength) {
            upstream.destroy();
            finish();
          }
        });
        appResponse.on("end", finish);
        appResponse.on("error", reject);
      },
    );
    upstream.on("error", reject);
    if (body !== undefined) upstream.write(body);
    upstream.end();
  });
}

// A rejection escaping the async request handler used to become a
// process-killing unhandledRejection (2026-07-03 NYC incident — /health was
// one such path). Fail the one request instead; never the daemon.
const telemetryServer = createServer((request, response) => {
  handleCollectorRequest(request, response).catch((error) => {
    console.error(
      `[collector] request failed: ${request.method} ${request.url}`,
      error?.stack || error,
    );
    try {
      jsonResponse(response, 500, {
        ok: false,
        error: "Internal collector error.",
      });
    } catch {
      response.destroy();
    }
  });
});

async function handleCollectorRequest(request, response) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname;
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (pathname === "/ready" && request.method === "GET") {
    jsonResponse(response, 200, {
      ok: true,
      host: hostname(),
      collectorStartedAt,
    });
    return;
  }
  if (pathname === "/health") {
    jsonResponse(response, 200, await collectorHealthPayload());
    return;
  }
  if (pathname === "/fleet-policy") {
    const auth = await fleetPolicyCaller(request);
    if (!auth.ok) {
      jsonResponse(response, auth.status || 403, { ok: false, error: auth.error });
      return;
    }
    try {
      const machineId = await stableMachineId();
      let policy;
      if (request.method === "GET") {
        policy = await readFleetMachinePolicy({ machineId });
      } else if (request.method === "POST") {
        const rawBody = await readBody(request);
        const body = rawBody ? JSON.parse(rawBody) : {};
        if (body.action === "claim-master") {
          policy = await claimFleetPolicyMaster({ caller: auth.caller, machineId });
        } else if (body.action === "update") {
          policy = await updateFleetMachinePolicy({
            caller: auth.caller,
            machineId,
            access: body.access,
            performance: body.performance,
          });
        } else if (body.action === "release-master") {
          policy = await releaseFleetPolicyMaster({ caller: auth.caller, machineId });
        } else if (body.action === "resolve-access") {
          policy = await resolveFleetAccessRequest({
            caller: auth.caller,
            machineId,
            capability: body.capability,
            decision: body.decision,
          });
        } else {
          throw new FleetMachinePolicyError("Unknown machine policy action.");
        }
        healthPayloadCache = null;
      } else {
        jsonResponse(response, 405, { ok: false, error: "Method not allowed." });
        return;
      }
      jsonResponse(response, 200, {
        ok: true,
        host: hostname(),
        machineId,
        ...fleetMachinePolicyPublicView(policy, auth.caller),
      });
    } catch (error) {
      jsonResponse(response, error instanceof FleetMachinePolicyError ? error.status : 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Could not manage machine policy.",
      });
    }
    return;
  }
  if (pathname === "/slash-commands" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const commands = await hermesSlashCommandCatalog(
        body.agent && typeof body.agent === "object" ? body.agent : {},
      );
      jsonResponse(response, 200, {
        runtime: "hermes",
        source: "hermes-command-registry",
        commands,
        totalCommands: commands.length,
      });
    } catch {
      jsonResponse(response, 503, {
        ok: false,
        error: "Hermes command inventory is unavailable.",
      });
    }
    return;
  }
  if (pathname.startsWith("/app-assets/") && request.method === "GET") {
    const id = pathname.split("/").pop() || "";
    const asset = hostedAppAssetUrls.get(id);
    if (!asset) {
      jsonResponse(response, 404, { ok: false, error: "Unknown app asset." });
      return;
    }
    try {
      if (asset.type === "url") {
        const assetResponse = await fetch(asset.url, {
          signal: AbortSignal.timeout(hostedAppProbeTimeoutMs),
        });
        if (!assetResponse.ok)
          throw new Error(`Asset returned ${assetResponse.status}.`);
        const contentType =
          assetResponse.headers.get("content-type") ||
          "application/octet-stream";
        const bytes = Buffer.from(await assetResponse.arrayBuffer());
        response.writeHead(200, {
          "content-type": contentType,
          "cache-control": "private, max-age=300",
        });
        response.end(bytes);
        return;
      }
      const bytes = await readFile(asset.path);
      response.writeHead(200, {
        "content-type": contentTypeForPath(asset.path),
        "cache-control": "private, max-age=300",
      });
      response.end(bytes);
    } catch {
      jsonResponse(response, 404, {
        ok: false,
        error: "App asset is no longer available.",
      });
    }
    return;
  }
  if (pathname.startsWith("/venice-x402/")) {
    await handleVeniceX402Proxy(request, response, pathname, requestUrl.search);
    return;
  }
  if (pathname.startsWith("/lmstudio/")) {
    // Reverse proxy to this machine's LM Studio server so fleet peers can run
    // models hosted here with zero manual LM Studio network setup.
    try {
      await proxyAppHttp(
        request,
        response,
        `${lmStudioLocalBase}${pathname.slice("/lmstudio".length)}${requestUrl.search}`,
      );
    } catch (error) {
      jsonResponse(response, 502, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "LM Studio is not reachable on this machine.",
      });
    }
    return;
  }
  if (pathname.startsWith("/app-proxy/") && request.method) {
    const targetUrl = proxiedAppTarget(pathname, requestUrl.search);
    if (!targetUrl) {
      jsonResponse(response, 400, {
        ok: false,
        error: "Invalid app proxy target.",
      });
      return;
    }
    try {
      await proxyAppHttp(request, response, targetUrl);
    } catch (error) {
      jsonResponse(response, 502, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not proxy hosted app.",
      });
    }
    return;
  }
  if (pathname === "/apps" && request.method === "GET") {
    try {
      const apps = await discoverHostedAppsCached(
        requestUrl.searchParams.get("refresh") === "1",
      );
      jsonResponse(response, 200, {
        ok: true,
        host: hostname(),
        apps,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        host: hostname(),
        apps: [],
        error:
          error instanceof Error
            ? error.message
            : "Could not discover hosted apps.",
      });
    }
    return;
  }
  if (pathname === "/app-builder" && request.method === "POST") {
    const auth = await requireLinkOwner(request);
    if (!auth.ok) {
      jsonResponse(response, auth.status || 403, { ok: false, error: auth.error });
      return;
    }
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      jsonResponse(response, 200, { ok: true, ...(await runLocalAppBuilderAction(body)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not run local app-builder action.";
      jsonResponse(response, /requires CONFIRM_APP_/.test(message) ? 409 : 400, { ok: false, error: message });
    }
    return;
  }
  if (pathname === "/maintenance/readiness" && request.method === "GET") {
    jsonResponse(response, 200, {
      ok: true,
      host: hostname(),
      ...collectorMaintenanceState(),
    });
    return;
  }
  if (pathname === "/maintenance/reserve-update" && request.method === "POST") {
    const maintenanceRequestId = String(
      request.headers["x-hivemind-maintenance-request-id"] || "",
    );
    const reservation = reserveCollectorUpdate(maintenanceRequestId);
    jsonResponse(response, reservation.status, {
      ...reservation,
      host: hostname(),
    });
    return;
  }
  if (pathname === "/maintenance/reserve-update" && request.method === "DELETE") {
    const reservationToken = String(
      request.headers["x-hivemind-maintenance-reservation"] || "",
    );
    const released = releaseCollectorUpdateReservation(reservationToken);
    jsonResponse(response, released ? 200 : 409, {
      ok: released,
      released,
      host: hostname(),
      ...collectorMaintenanceState(),
      ...(released ? {} : { error: "The maintenance reservation was not active." }),
    });
    return;
  }
  if (pathname === "/update" && request.method === "POST") {
    const requestedReservationToken = String(
      request.headers["x-hivemind-maintenance-reservation"] || "",
    );
    const activeReservation = activeCollectorUpdateReservation();
    const reservation = activeReservation
      ? activeReservation.token === requestedReservationToken
        ? { ok: true, reservationToken: activeReservation.token }
        : {
            ok: false,
            status: 409,
            error: "Maintenance is already reserved by another update request.",
          }
      : reserveCollectorUpdate();
    if (!reservation.ok) {
      jsonResponse(response, reservation.status || 409, {
        ...reservation,
        host: hostname(),
      });
      return;
    }
    try {
      const version = await appVersion({ force: true });
      const command = startUpdate(reservation.reservationToken);
      jsonResponse(response, 202, {
        ok: true,
        accepted: true,
        host: hostname(),
        version,
        message:
          "Update started. The collector and dashboard may briefly restart.",
        command,
      });
    } catch (error) {
      releaseCollectorUpdateReservation(reservation.reservationToken);
      jsonResponse(response, 500, {
        ok: false,
        host: hostname(),
        error:
          error instanceof Error
            ? error.message
            : "Could not start agent bridge maintenance.",
      });
    }
    return;
  }
  if (pathname === "/env" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const entries = safeAgentEnv(body.entries || body.updates || {});
      if (!Object.keys(entries).length) {
        jsonResponse(response, 400, {
          ok: false,
          error: "No valid env variables were provided.",
        });
        return;
      }
      // Per-machine secrets must never be SET BY A REMOTE PEER. This /env
      // endpoint exists only for relayed fleet pushes, and hive-env-add's
      // apply path doesn't gate on LOCAL_ONLY_KEYS, so without this a peer's
      // scope-all push overwrites this machine's own dashboard auth
      // token/secret (each hub generates + verifies its own in .env.local) —
      // which silently breaks this machine's phone pairing / API auth (observed
      // 2026-07-05). Mirror the relevant hive-env-add LOCAL_ONLY_KEYS here and
      // drop them from any inbound push.
      const REMOTE_REJECTED_KEYS = new Set([
        "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN",
        "HIVEMINDOS_DASHBOARD_AUTH_SECRET",
      ]);
      const rejected = Object.keys(entries).filter((key) =>
        REMOTE_REJECTED_KEYS.has(key) || key.startsWith("USEPOD_HOST_"),
      );
      for (const key of rejected) delete entries[key];
      if (!Object.keys(entries).length) {
        // Every pushed key was a per-machine secret we won't accept remotely —
        // ack it (so the peer's retry queue clears) but write nothing.
        jsonResponse(response, 200, { ok: true, updated: 0, rejected: rejected.length });
        return;
      }
      await runHiveEnvImport({
        entries,
        scope:
          body.scope === "all" || body.scope === "app" || body.scope === "agent"
            ? body.scope
            : "agent",
        runtime: ["generic", "hermes", "aeon", "openclaw"].includes(
          body.runtime,
        )
          ? body.runtime
          : "generic",
      });
      jsonResponse(response, 200, {
        ok: true,
        updated: Object.keys(entries).length,
        ...(rejected.length ? { rejected: rejected.length } : {}),
      });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not import env variables.",
      });
    }
    return;
  }
  if (pathname === "/reliability/openrouter" && request.method === "GET") {
    const store = await readReliabilityStoreFile();
    jsonResponse(response, 200, {
      ok: true,
      host: hostname(),
      machineId: await stableMachineId().catch(() => ""),
      updatedAt: store?.updatedAt ?? null,
      models: store?.models ?? {},
    });
    return;
  }
  if (pathname === "/reliability/sync" && request.method === "POST") {
    const wasRunning = reliabilitySyncRunning;
    const status = await runReliabilitySync("manual");
    jsonResponse(response, status.lastError && !wasRunning ? 500 : 200, {
      ok: wasRunning || !status.lastError,
      host: hostname(),
      alreadyRunning: wasRunning,
      sync: status,
    });
    return;
  }
  if (pathname === "/env/sync-maintenance" && request.method === "POST") {
    const wasRunning = envSyncMaintenanceRunning;
    const status = await runEnvSyncMaintenance("manual");
    jsonResponse(response, status.lastError && !wasRunning ? 500 : 200, {
      ok: wasRunning || !status.lastError,
      host: hostname(),
      alreadyRunning: wasRunning,
      maintenance: status,
    });
    return;
  }
  if (pathname === "/env" && request.method === "GET") {
    try {
      const envSync = await resolveHiveEnvAdd();
      if (!envSync.ready) {
        jsonResponse(response, 503, {
          ok: false,
          error:
            envSync.error || "hive-env-add is not installed or executable.",
        });
        return;
      }
      const scope = ["all", "app", "agent"].includes(
        requestUrl.searchParams.get("scope") || "",
      )
        ? requestUrl.searchParams.get("scope")
        : "agent";
      const runtime = ["generic", "hermes", "aeon", "openclaw"].includes(
        requestUrl.searchParams.get("runtime") || "",
      )
        ? requestUrl.searchParams.get("runtime")
        : "generic";
      const { stdout } = await execFileAsync(
        envSync.command,
        [...envSync.args, "--export-json", "--scope", scope, "--runtime", runtime],
        {
          timeout: 12_000,
          maxBuffer: 1_000_000,
          shell: Boolean(envSync.shell),
          windowsHide: true,
        },
      );
      const payload = JSON.parse(stdout);
      jsonResponse(response, 200, { ok: true, ...payload });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not read env variables.",
      });
    }
    return;
  }
  if (pathname === "/agents" && request.method === "GET") {
    const agents = await localAgents();
    jsonResponse(response, 200, { ok: true, host: hostname(), agents });
    return;
  }
  if (pathname === "/work-receipts" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const receipt = await createWorkReceipt(body);
      jsonResponse(response, 200, { ok: true, host: hostname(), receipt });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create a signed work receipt.",
      });
    }
    return;
  }
  if (pathname === "/agents" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const agent = await createRuntimeAgent(body);
      jsonResponse(response, 200, { ok: true, host: hostname(), agent });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create runtime agent.",
      });
    }
    return;
  }
  if (pathname === "/agents" && request.method === "DELETE") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await deleteRuntimeAgent(body);
      jsonResponse(response, 200, { ok: true, host: hostname(), ...result });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not delete runtime agent.",
      });
    }
    return;
  }
  if (pathname === "/e2e/env-sync" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const key = String(body.key || "");
      const value = String(body.value ?? "");
      const scope = ["all", "app", "agent"].includes(body.scope)
        ? body.scope
        : "all";
      const runtime = ["generic", "hermes", "aeon", "openclaw"].includes(
        body.runtime,
      )
        ? body.runtime
        : "generic";
      const output = await runHiveEnvE2eSync({ key, value, scope, runtime });
      jsonResponse(response, 200, {
        ok: true,
        host: hostname(),
        key,
        scope,
        runtime,
        output,
      });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not run E2E env sync.",
      });
    }
    return;
  }
  if (pathname === "/e2e/skills" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result =
        body.action === "remove"
          ? await removeE2eProviderSkill(body)
          : await writeE2eProviderSkill(body);
      void triggerSkillAutoSync(`e2e:${body.action || "write"}`).catch(
        () => undefined,
      );
      jsonResponse(response, 200, { host: hostname(), ...result });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not mutate E2E skill.",
      });
    }
    return;
  }
  if (pathname === "/e2e/file-share" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      jsonResponse(response, 200, await handleE2eFileShare(body));
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not run E2E encrypted file sharing.",
      });
    }
    return;
  }
  if (pathname === "/directories" && request.method === "GET") {
    try {
      const result = await listDirectories(
        requestUrl.searchParams.get("path") || "~",
      );
      jsonResponse(response, 200, result);
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not list directories.",
      });
    }
    return;
  }
  if (pathname === "/skills" && request.method === "GET") {
    try {
      const includeSourceFiles =
        requestUrl.searchParams.get("includeSourceFiles") === "true";
      const force = requestUrl.searchParams.get("refresh") === "1";
      jsonResponse(
        response,
        200,
        await listInstalledSkills({ includeSourceFiles, force }),
      );
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not list installed skills.",
      });
    }
    return;
  }
  if (pathname === "/skills/auto-sync" && request.method === "GET") {
    skillAutoSyncConfig =
      skillAutoSyncConfig ?? (await readSkillAutoSyncConfig());
    jsonResponse(response, 200, {
      ok: true,
      host: hostname(),
      ...skillAutoSyncConfig,
      watchedProviders: enabledSkillAutoSyncProviders(skillAutoSyncConfig).map(
        (provider) => provider.id,
      ),
    });
    return;
  }
  if (pathname === "/skills/auto-sync" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      jsonResponse(response, 200, await configureSkillAutoSync(body));
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not configure skill auto-sync.",
      });
    }
    return;
  }
  const runtimeStateMatch = pathname.match(
    /^\/runtimes\/([^/]+)\/(export-runtime-state|import-runtime-state|backup-runtime-state|restore-runtime-state|runtime-state-backups)$/,
  );
  if (runtimeStateMatch) {
    const runtimeName = runtimeStateMatch[1];
    const op = runtimeStateMatch[2];
    const manifest = portableStateManifest(runtimeName);
    if (!manifest) {
      jsonResponse(response, 404, {
        ok: false,
        error: `${runtimeName} has no portable-state manifest.`,
      });
      return;
    }
    const auth = await requireLinkOwner(request);
    if (!auth.ok) {
      jsonResponse(response, auth.status || 403, { ok: false, error: auth.error });
      return;
    }
    try {
      if (op === "export-runtime-state" && request.method === "POST") {
        // Pack the redacted portable subset and stream it back as a gzip tar.
        const pack = await packPortableState(runtimeName, { sharedVaultPath: defaultSyncPath });
        try {
          const buffer = await readFile(pack.tarPath);
          response.writeHead(200, {
            "content-type": "application/gzip",
            "content-length": buffer.length,
            "x-hivemind-runtime": runtimeName,
            "x-hivemind-machine-id": await stableMachineId().catch(() => ""),
            "x-hivemind-file-count": String(pack.fileCount),
            "x-hivemind-redactions": String(pack.redactions),
          });
          response.end(buffer);
        } finally {
          await rm(dirname(pack.tarPath), { recursive: true, force: true });
        }
        return;
      }
      if (op === "import-runtime-state" && request.method === "POST") {
        // Overlay an incoming gzip-tar onto this machine's runtime home,
        // backing up the current subset first. Used by clone-seeding.
        const body = await readBodyBuffer(request);
        if (!body || body.length === 0) {
          jsonResponse(response, 400, { ok: false, error: "A gzip tar body is required." });
          return;
        }
        const tmpPath = join(
          homedir(),
          ".hivemindos",
          "runtime-import-tmp",
          `${runtimeName}-${randomBytes(6).toString("hex")}.tar.gz`,
        );
        await mkdir(dirname(tmpPath), { recursive: true, mode: 0o700 });
        await writeFile(tmpPath, body);
        try {
          const result = await importPortableTar(runtimeName, tmpPath, {
            sharedVaultPath: defaultSyncPath,
          });
          jsonResponse(response, 200, { ...result, host: hostname() });
        } finally {
          await rm(tmpPath, { force: true });
        }
        return;
      }
      if (op === "backup-runtime-state" && request.method === "POST") {
        const result = await backupPortableState(runtimeName, { sharedVaultPath: defaultSyncPath });
        jsonResponse(response, 200, { ok: true, ...result, host: hostname() });
        return;
      }
      if (op === "restore-runtime-state" && request.method === "POST") {
        const rawBody = await readBody(request);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const backups = await listBackups(runtimeName);
        const name = String(body.backup || backups[backups.length - 1] || "");
        if (!name || !backups.includes(name)) {
          jsonResponse(response, 404, { ok: false, error: "No matching runtime-state backup found." });
          return;
        }
        const backupPath = join(homedir(), ".hivemindos", "runtime-backups", runtimeName, name);
        const result = await restorePortableState(runtimeName, backupPath);
        jsonResponse(response, 200, { ...result, backup: name, host: hostname() });
        return;
      }
      if (op === "runtime-state-backups" && request.method === "GET") {
        jsonResponse(response, 200, {
          ok: true,
          host: hostname(),
          runtime: runtimeName,
          backups: await listBackups(runtimeName),
        });
        return;
      }
      jsonResponse(response, 405, { ok: false, error: "Method not allowed." });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Runtime-state operation failed.",
      });
    }
    return;
  }
  if (pathname === "/runtimes/state-sync") {
    const auth = await requireLinkOwner(request);
    if (!auth.ok) {
      jsonResponse(response, auth.status || 403, { ok: false, error: auth.error });
      return;
    }
    runtimeStateSyncConfig = runtimeStateSyncConfig ?? (await readRuntimeStateSyncConfig());
    if (request.method === "GET") {
      jsonResponse(response, 200, {
        ok: true,
        host: hostname(),
        enabled: isRuntimeStateSyncEnabled(),
        runtimes: syncableRuntimes(),
        status: runtimeStateSyncStatus,
      });
      return;
    }
    if (request.method === "POST") {
      try {
        const rawBody = await readBody(request);
        const body = rawBody ? JSON.parse(rawBody) : {};
        jsonResponse(response, 200, await configureRuntimeStateSync(body));
      } catch (error) {
        jsonResponse(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : "Could not configure runtime-state sync.",
        });
      }
      return;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (pathname === "/runtimes/state-sync/run" && request.method === "POST") {
    const auth = await requireLinkOwner(request);
    if (!auth.ok) {
      jsonResponse(response, auth.status || 403, { ok: false, error: auth.error });
      return;
    }
    runtimeStateSyncConfig = runtimeStateSyncConfig ?? (await readRuntimeStateSyncConfig());
    const status = await runRuntimeStateSync("manual");
    jsonResponse(response, 200, { ok: true, host: hostname(), status });
    return;
  }
  const runtimeIntegrationMatch = pathname.match(
    /^\/runtimes\/([^/]+)\/integrations$/,
  );
  if (runtimeIntegrationMatch && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const runtimeName = runtimeIntegrationMatch[1];
      if (
        COLLECTOR_RUNTIME_INSTALL[runtimeName] &&
        body.action === "install-runtime"
      ) {
        jsonResponse(response, 200, await collectorInstallRuntime(runtimeName));
        return;
      }
      if (
        COLLECTOR_RUNTIME_INSTALL[runtimeName] &&
        body.action === "runtime-auth"
      ) {
        jsonResponse(
          response,
          200,
          await collectorSaveRuntimeAuth(body.input?.env, body.input?.value),
        );
        return;
      }
      const localModelProvider = String(body.agent?.provider || "");
      const localModelAction = new Set([
        "load-model",
        "unload-model",
        "download-model",
        "cancel-download",
        "install-local-runtime",
        "start-local-runtime",
        "smoke-test-local-model",
        "warm-model",
      ]).has(String(body.action || ""));
      if (body.action && localModelAction && (localModelProvider === "lm-studio" || localModelProvider === "sie")) {
        jsonResponse(
          response,
          200,
          await runLocalOpenAiIntegrationAction(body.action, body.input || {}, body.agent || {}),
        );
        return;
      }
      if (runtimeName === "openclaw") {
        if (body.action) {
          jsonResponse(
            response,
            200,
            await runOpenClawIntegrationAction(body.action, body.input || {}),
          );
          return;
        }
        jsonResponse(response, 200, {
          ok: true,
          status: await openClawIntegrationStatus(body.agent || {}),
        });
        return;
      }
      if (
        runtimeName === HIVE_RUNTIME_ID ||
        runtimeName === LEGACY_OPENAI_COMPATIBLE_RUNTIME_ID
      ) {
        if (body.action) {
          jsonResponse(
            response,
            200,
            await runLocalOpenAiIntegrationAction(
              body.action,
              body.input || {},
              body.agent || {},
            ),
          );
          return;
        }
        jsonResponse(response, 200, {
          ok: true,
          status: await localOpenAiIntegrationStatus(body.agent || {}),
        });
        return;
      }
      if (runtimeName === "codex" && !body.action) {
        jsonResponse(response, 200, {
          ok: true,
          status: await codexIntegrationStatus(body.agent || {}),
        });
        return;
      }
      if (
        COLLECTOR_RUNTIME_INSTALL[runtimeName] &&
        runtimeName !== "hermes"
      ) {
        const installed = await installedRuntimes().catch(() => []);
        jsonResponse(response, 200, {
          ok: true,
          status: {
            ok: true,
            runtime: runtimeName,
            installed: installed.includes(runtimeName),
            detail: installed.includes(runtimeName)
              ? `${runtimeName} is installed on this machine.`
              : `${runtimeName} is not installed on this machine.`,
          },
        });
        return;
      }
      if (runtimeName !== "hermes") {
        jsonResponse(response, 404, {
          ok: false,
          error: `${runtimeName} integrations are not exposed by this collector yet.`,
        });
        return;
      }
      if (body.action) {
        jsonResponse(
          response,
          200,
          await runHermesIntegrationAction(
            body.action,
            body.input || {},
            body.agent || {},
          ),
        );
        return;
      }
      jsonResponse(response, 200, {
        ok: true,
        status: await hermesIntegrationStatus(body.agent || {}),
      });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Runtime integration check failed.",
      });
    }
    return;
  }
  if (pathname === "/messaging-channels") {
    try {
      if (request.method === "GET") {
        jsonResponse(response, 200, await collectorMessagingChannels.list());
        return;
      }
      if (request.method === "POST") {
        const rawBody = await readBody(request);
        const body = rawBody ? JSON.parse(rawBody) : {};
        if (body.action === "send" || body.action === "test") {
          const result = await collectorMessagingChannels.send(body);
          jsonResponse(response, result.ok ? 200 : 400, result);
          return;
        }
        jsonResponse(
          response,
          200,
          await collectorMessagingChannels.list(body.agent || {}),
        );
        return;
      }
      jsonResponse(response, 405, { ok: false, error: "Method not allowed." });
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Messaging channel bridge failed.",
      });
    }
    return;
  }
  if (pathname === "/schedules") {
    const agents = await localAgents();
    const schedules = (
      await Promise.all(
        agents.map((agent) =>
          scanRuntimeSchedules(agent, sanitizeLocalDataDir(agent.localDataDir)),
        ),
      )
    ).flat();
    jsonResponse(response, 200, { ok: true, host: hostname(), schedules });
    return;
  }
  if (pathname === "/transfers" && request.method === "GET") {
    try {
      const transfers = await listTransfers({
        syncPath: requestUrl.searchParams.get("syncPath") || defaultSyncPath,
        machineId:
          requestUrl.searchParams.get("machineId") || (await stableMachineId()),
        host: requestUrl.searchParams.get("host") || hostname(),
        runtime: requestUrl.searchParams.get("runtime") || "",
        agentId:
          requestUrl.searchParams.get("agentId") ||
          requestUrl.searchParams.get("agent") ||
          "",
        includeAcknowledged:
          requestUrl.searchParams.get("includeAcknowledged") === "true" ||
          requestUrl.searchParams.get("all") === "true",
      });
      jsonResponse(response, 200, {
        ok: true,
        host: hostname(),
        machineId: await stableMachineId(),
        transfers,
      });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not list file transfers.",
      });
    }
    return;
  }
  if (pathname === "/transfers" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const transfer = await createTransfer({
        syncPath: body.syncPath || defaultSyncPath,
        file: body.file,
        files: body.files,
        note: body.note,
        from: {
          machineId: body.from?.machineId || (await stableMachineId()),
          host: body.from?.host || hostname(),
          runtime: body.from?.runtime,
          agentId: body.from?.agentId || body.from?.agent,
        },
        to: {
          machineId: body.to?.machineId,
          host: body.to?.host,
          runtime: body.to?.runtime,
          agentId: body.to?.agentId || body.to?.agent,
        },
      });
      jsonResponse(response, 200, {
        ok: true,
        host: hostname(),
        machineId: await stableMachineId(),
        transfer,
      });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create file transfer.",
      });
    }
    return;
  }
  if (pathname === "/transfers/ack" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await acknowledgeTransfer({
        syncPath: body.syncPath || defaultSyncPath,
        id: body.id,
        machineId: body.machineId || (await stableMachineId()),
        runtime: body.runtime || "",
        agentId: body.agentId || body.agent || "",
      });
      jsonResponse(response, 200, {
        host: hostname(),
        machineId: await stableMachineId(),
        ...result,
      });
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not acknowledge file transfer.",
      });
    }
    return;
  }
  if (pathname === "/syncthing/status") {
    const status = await syncthingStatus();
    jsonResponse(response, status.ok ? 200 : 503, status);
    return;
  }
  if (pathname === "/syncthing/folder-status") {
    try {
      const result = await syncthingFolderStatus({
        path: requestUrl.searchParams.get("path") || undefined,
        folderId: requestUrl.searchParams.get("folderId") || undefined,
      });
      jsonResponse(response, result.ok ? 200 : 503, result);
    } catch (error) {
      jsonResponse(response, 503, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not read Syncthing folder status.",
      });
    }
    return;
  }
  if (pathname === "/syncthing/rescan" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await syncthingRescan(body);
      jsonResponse(response, result.ok ? 200 : 503, result);
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not trigger a Syncthing rescan.",
      });
    }
    return;
  }
  if (pathname === "/syncthing/repair" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await syncthingRepair(body);
      jsonResponse(response, result.ok ? 200 : 503, result);
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not repair Syncthing.",
      });
    }
    return;
  }
  if (pathname === "/syncthing/configure" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await configureSyncthingFolder(body);
      jsonResponse(response, 200, result);
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not configure Syncthing.",
      });
    }
    return;
  }
  if (pathname === "/syncthing/test-note" && request.method === "POST") {
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await syncthingTestNote(body);
      jsonResponse(response, 200, result);
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not access Syncthing test note.",
      });
    }
    return;
  }
  if (
    (pathname === "/runtime-sessions" || pathname === "/sessions") &&
    request.method === "GET"
  ) {
    const sessionId =
      requestUrl.searchParams.get("sessionId") ||
      requestUrl.searchParams.get("id") ||
      "";
    const runtime =
      String(requestUrl.searchParams.get("runtime") || "hermes")
        .trim()
        .toLowerCase() || "hermes";
    const localDataDir = requestUrl.searchParams.get("localDataDir") || "";
    const sinceMs = Number(requestUrl.searchParams.get("sinceMs") || 0);
    const session = await readRuntimeSession(runtime, {
      sessionId,
      localDataDir,
      sinceMs,
    });
    jsonResponse(
      response,
      session ? 200 : 404,
      session
        ? { ok: true, runtime, session }
        : { ok: false, runtime, error: "session not found" },
    );
    return;
  }
  if (pathname === "/chat" && request.method === "POST") {
    const maintenance = collectorMaintenanceState();
    if (maintenance.updateStarting) {
      jsonResponse(response, 503, {
        ok: false,
        error: "This agent bridge is starting maintenance. Retry after it reconnects.",
        ...maintenance,
      });
      return;
    }
    const releaseCollectorChatRun = beginCollectorChatRun();
    try {
      const rawBody = await readBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      if (body.stream === true) {
        await streamHermesChat(body, response, { releaseCollectorChatRun });
        return;
      }
      // "close" with the response still unwritten = the caller disconnected
      // mid-run; kill the spawned hermes CLI (see sendHermesChat).
      const chatAbort = new AbortController();
      response.on("close", () => {
        if (!response.writableEnded) chatAbort.abort();
      });
      const result = await sendHermesChat(body, { signal: chatAbort.signal });
      jsonResponse(response, result.ok ? 200 : result.status || 500, result);
      releaseCollectorChatRun();
    } catch (error) {
      releaseCollectorChatRun();
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Hermes chat failed",
      });
    }
    return;
  }
  if (pathname !== "/snapshot") {
    jsonResponse(response, 404, { ok: false, error: "not found" });
    return;
  }
  const rawBody = request.method === "POST" ? await readBody(request) : "{}";
  const body = rawBody ? JSON.parse(rawBody) : {};
  if (body.agent || body.agents) {
    const agents = (body.agent ? [body.agent] : body.agents).filter(
      (agent) => !isReservedHermesProfileAgent(agent),
    );
    const snapshots = await Promise.all(
      agents.map((agent) => snapshotFor(agent)),
    );
    jsonResponse(response, 200, {
      ok: true,
      snapshot: snapshots[0] ?? null,
      snapshots,
    });
    return;
  }
  // Default all-local-agents snapshot: TTL + in-flight coalescing, because the
  // dashboard, fleet watchdog, and peer collectors each poll this endpoint on
  // their own clocks and every uncached hit re-scans all agents.
  if (
    snapshotAllCache &&
    Date.now() - snapshotAllCache.at < snapshotCacheMs
  ) {
    jsonResponse(response, 200, snapshotAllCache.payload);
    return;
  }
  if (!snapshotAllPromise) {
    snapshotAllPromise = (async () => {
      const agents = await localAgents();
      const snapshots = await Promise.all(
        agents.map((agent) => snapshotFor(agent)),
      );
      const payload = { ok: true, snapshot: snapshots[0], snapshots };
      snapshotAllCache = { payload, at: Date.now() };
      return payload;
    })().finally(() => {
      snapshotAllPromise = null;
    });
  }
  try {
    jsonResponse(response, 200, await snapshotAllPromise);
  } catch (error) {
    jsonResponse(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "snapshot failed",
    });
  }
}

telemetryServer.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname.startsWith("/app-proxy/")) {
    proxyAppWebSocket(request, socket, head);
    return;
  }
  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  socket.destroy();
});

// Advertise the HivemindOS dashboard on the LAN via Bonjour/mDNS so a companion
// phone on the same Wi-Fi can auto-find this machine (no typed address). The TXT
// carries the MagicDNS suffix so the phone can prefer the stable tailnet name
// over the LAN IP. Best-effort; never blocks or crashes the collector.
async function advertiseHubMdns() {
  if (process.env.HIVEMINDOS_MDNS_DISABLE === "1") return;
  try {
    const dashboardPort = await dashboardPortForMdns();
    let magicDnsSuffix = "";
    let magicDnsName = ""; // the full stable tailnet name (Self.DNSName)
    try {
      const st = await tailscaleStatusJson();
      magicDnsSuffix = st?.MagicDNSSuffix || "";
      magicDnsName = (st?.Self?.DNSName || "").replace(/\.$/, "");
    } catch {
      /* tailscale not present / not up — advertise without the suffix */
    }
    const machineId = await stableMachineId().catch(() => "");
    // Lazy-load bonjour-service here (see the top-of-file note): a missing package
    // (no node_modules on a -SkipDeps install) throws into this function's try/catch
    // and just disables mDNS advertising, instead of crashing the collector.
    const bonjourModule = await import("bonjour-service");
    const Bonjour = (bonjourModule.default ?? bonjourModule).Bonjour;
    const bonjour = new Bonjour();
    bonjour.publish({
      name: `HivemindOS ${hostname()}`,
      type: "hivemindos",
      protocol: "tcp",
      port: dashboardPort,
      txt: {
        dashboard_port: String(dashboardPort),
        machine_hostname: hostname(),
        machine_id: machineId,
        magic_dns_suffix: magicDnsSuffix,
        // Full tailnet name (preferred by the phone — stable + correctly cased).
        magic_dns_name: magicDnsName,
      },
    });
    console.log(`advertising _hivemindos._tcp on :${dashboardPort} (mDNS)`);
  } catch (err) {
    console.warn(
      "mDNS advertise failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

// The keep-alive guards above must not mask a failed bind: a collector that
// can't listen should exit so launchd's KeepAlive relaunches it, not linger
// alive-but-deaf. (The port stays pinned — fleet discovery depends on it.)
telemetryServer.on("error", (error) => {
  console.error(
    "[collector] server error (exiting for relaunch):",
    error?.stack || error,
  );
  process.exit(1);
});

telemetryServer.listen(port, host, () => {
  console.log(`agent telemetry collector listening on ${host}:${port}`);
  void initializeSkillAutoSync();
  void advertiseHubMdns();
  void installedRuntimes().catch(() => {});
  void reconcileAppBuilderRuntimesAtBoot({ readProjects: readProjectRegistryProjects, expandHome }).catch(() => {});
  startEnvSyncMaintenance();
  startReliabilitySync();
  void initializeRuntimeStateSync();
  void startSelfReloadWatcher({ selfPath: collectorSourcePath });
});
