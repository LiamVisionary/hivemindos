import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const FLEET_ACCESS_CAPABILITIES = [
  "sharedBrain",
  "sharedEnv",
  "chatHistory",
  "connectedApps",
  "messagingChannels",
  "fileTransfers",
];

export const FLEET_ACCESS_DECISIONS = ["allow", "ask", "deny"];

const ACCESS_CAPABILITY_LABELS = {
  sharedBrain: "Shared Brain and synced vault",
  sharedEnv: "shared environment variables",
  chatHistory: "fleet chat history",
  connectedApps: "apps and services on other machines",
  messagingChannels: "messaging channels",
  fileTransfers: "HiveDrop and fleet file transfers",
};

const DEFAULT_ACCESS = {
  sharedBrain: "ask",
  sharedEnv: "allow",
  chatHistory: "ask",
  connectedApps: "ask",
  messagingChannels: "ask",
  fileTransfers: "ask",
};

const LEGACY_DEFAULT_ACCESS = {
  sharedBrain: "ask",
  sharedEnv: "ask",
  chatHistory: "ask",
  connectedApps: "ask",
  messagingChannels: "ask",
  fileTransfers: "ask",
};

const DEFAULT_PERFORMANCE = {
  enabled: true,
  ignore: false,
  maxCpuPct: 85,
  maxRamPct: 90,
  maxDiskPct: 95,
};

const policyMutationQueues = new Map();

export class FleetMachinePolicyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "FleetMachinePolicyError";
    this.status = status;
  }
}

function cleanText(value, max = 180) {
  return String(value || "").replace(/[\r\n\0]/g, " ").trim().slice(0, max);
}

function cleanCaller(caller) {
  const id = cleanText(caller?.id, 220).toLowerCase();
  if (!id) throw new FleetMachinePolicyError("A verified hub identity is required.", 403);
  return { id, label: cleanText(caller?.label, 180) || id };
}

function accessDecision(value, fallback = "ask") {
  const decision = cleanText(value, 12).toLowerCase();
  return FLEET_ACCESS_DECISIONS.includes(decision) ? decision : fallback;
}

function threshold(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.round(number)));
}

function normalizeAccess(value, fallback = DEFAULT_ACCESS) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    FLEET_ACCESS_CAPABILITIES.map((capability) => [
      capability,
      accessDecision(record[capability], fallback[capability]),
    ]),
  );
}

function isUntouchedLegacyDefaultPolicy(record, authority, updatedAt, temporaryGrants) {
  if (Number(record.version || 1) !== 1 || !authority) return false;
  if (!authority.claimedAt || updatedAt !== authority.claimedAt) return false;
  if (Object.keys(temporaryGrants).length) return false;
  const legacyAccess = normalizeAccess(record.access, LEGACY_DEFAULT_ACCESS);
  return FLEET_ACCESS_CAPABILITIES.every(
    (capability) => legacyAccess[capability] === LEGACY_DEFAULT_ACCESS[capability],
  );
}

function normalizePerformance(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: record.enabled === undefined ? DEFAULT_PERFORMANCE.enabled : record.enabled === true,
    ignore: record.ignore === true,
    maxCpuPct: threshold(record.maxCpuPct, DEFAULT_PERFORMANCE.maxCpuPct),
    maxRamPct: threshold(record.maxRamPct, DEFAULT_PERFORMANCE.maxRamPct),
    maxDiskPct: threshold(record.maxDiskPct, DEFAULT_PERFORMANCE.maxDiskPct),
  };
}

function normalizeAuthority(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const masterHubId = cleanText(value.masterHubId, 220).toLowerCase();
  if (!masterHubId) return null;
  return {
    masterHubId,
    masterHubLabel: cleanText(value.masterHubLabel, 180) || masterHubId,
    claimedAt: cleanText(value.claimedAt, 60) || new Date(0).toISOString(),
  };
}

function normalizeTemporaryGrants(value, now = Date.now()) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const grants = {};
  for (const capability of FLEET_ACCESS_CAPABILITIES) {
    const grant = record[capability];
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) continue;
    const expiresAt = Number(grant.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
    grants[capability] = {
      expiresAt,
      grantedAt: Number(grant.grantedAt || now),
      grantedBy: cleanText(grant.grantedBy, 220),
    };
  }
  return grants;
}

export function defaultFleetMachinePolicy({ machineId = "", now = Date.now() } = {}) {
  return {
    version: 1,
    machineId: cleanText(machineId, 220),
    authority: null,
    access: { ...DEFAULT_ACCESS },
    performance: { ...DEFAULT_PERFORMANCE },
    temporaryGrants: {},
    updatedAt: new Date(now).toISOString(),
  };
}

export function normalizeFleetMachinePolicy(value, { machineId = "", now = Date.now() } = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const authority = normalizeAuthority(record.authority);
  const temporaryGrants = normalizeTemporaryGrants(record.temporaryGrants, now);
  const updatedAt = cleanText(record.updatedAt, 60) || new Date(now).toISOString();
  const migrateLegacySharedEnvDefault = isUntouchedLegacyDefaultPolicy(
    record,
    authority,
    updatedAt,
    temporaryGrants,
  );
  const access = normalizeAccess(record.access);
  if (migrateLegacySharedEnvDefault) access.sharedEnv = DEFAULT_ACCESS.sharedEnv;
  return {
    version: 1,
    machineId: cleanText(record.machineId || machineId, 220),
    authority,
    access,
    performance: normalizePerformance(record.performance),
    temporaryGrants,
    updatedAt,
  };
}

export function defaultFleetMachinePolicyPath() {
  return join(homedir(), ".hivemindos", "fleet-machine-policy.json");
}

export async function readFleetMachinePolicy({ filePath = defaultFleetMachinePolicyPath(), machineId = "", now = Date.now() } = {}) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeFleetMachinePolicy(JSON.parse(raw), { machineId, now });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return defaultFleetMachinePolicy({ machineId, now });
    }
    throw new FleetMachinePolicyError("The collector machine-policy file is unreadable or invalid.", 500);
  }
}

export async function writeFleetMachinePolicy(policy, { filePath = defaultFleetMachinePolicyPath(), machineId = "", now = Date.now() } = {}) {
  const normalized = normalizeFleetMachinePolicy({ ...policy, updatedAt: new Date(now).toISOString() }, { machineId, now });
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
  return normalized;
}

async function withFleetPolicyMutation(filePath, mutate) {
  const resolvedPath = filePath || defaultFleetMachinePolicyPath();
  const previous = policyMutationQueues.get(resolvedPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => mutate(resolvedPath));
  policyMutationQueues.set(resolvedPath, current);
  try {
    return await current;
  } finally {
    if (policyMutationQueues.get(resolvedPath) === current) policyMutationQueues.delete(resolvedPath);
  }
}

export function fleetPolicyCanManage(policy, caller) {
  const current = normalizeFleetMachinePolicy(policy);
  const identity = cleanCaller(caller);
  return !current.authority || current.authority.masterHubId === identity.id;
}

function requireMaster(policy, caller) {
  const identity = cleanCaller(caller);
  if (!policy.authority) {
    throw new FleetMachinePolicyError("Claim this machine from the Authority tab before changing its policy.", 409);
  }
  if (policy.authority.masterHubId !== identity.id) {
    throw new FleetMachinePolicyError(
      `Only master hub ${policy.authority.masterHubLabel} can change this machine's policy.`,
      403,
    );
  }
  return identity;
}

export async function claimFleetPolicyMaster({ caller, filePath, machineId = "", now = Date.now() }) {
  return withFleetPolicyMutation(filePath, async (resolvedPath) => {
    const identity = cleanCaller(caller);
    const current = await readFleetMachinePolicy({ filePath: resolvedPath, machineId, now });
    if (current.authority && current.authority.masterHubId !== identity.id) {
      throw new FleetMachinePolicyError(
        `This machine is already controlled by master hub ${current.authority.masterHubLabel}.`,
        403,
      );
    }
    return writeFleetMachinePolicy({
      ...current,
      authority: current.authority || {
        masterHubId: identity.id,
        masterHubLabel: identity.label,
        claimedAt: new Date(now).toISOString(),
      },
    }, { filePath: resolvedPath, machineId, now });
  });
}

export async function updateFleetMachinePolicy({ caller, access, performance, filePath, machineId = "", now = Date.now() }) {
  return withFleetPolicyMutation(filePath, async (resolvedPath) => {
    const current = await readFleetMachinePolicy({ filePath: resolvedPath, machineId, now });
    requireMaster(current, caller);
    return writeFleetMachinePolicy({
      ...current,
      access: access === undefined ? current.access : normalizeAccess(access),
      performance: performance === undefined ? current.performance : normalizePerformance(performance),
    }, { filePath: resolvedPath, machineId, now });
  });
}

export async function releaseFleetPolicyMaster({ caller, filePath, machineId = "", now = Date.now() }) {
  return withFleetPolicyMutation(filePath, async (resolvedPath) => {
    const current = await readFleetMachinePolicy({ filePath: resolvedPath, machineId, now });
    requireMaster(current, caller);
    return writeFleetMachinePolicy({ ...current, authority: null, temporaryGrants: {} }, { filePath: resolvedPath, machineId, now });
  });
}

export async function resolveFleetAccessRequest({ caller, capability, decision, filePath, machineId = "", now = Date.now() }) {
  return withFleetPolicyMutation(filePath, async (resolvedPath) => {
    const current = await readFleetMachinePolicy({ filePath: resolvedPath, machineId, now });
    const identity = requireMaster(current, caller);
    const normalizedCapability = cleanText(capability, 40);
    if (!FLEET_ACCESS_CAPABILITIES.includes(normalizedCapability)) {
      throw new FleetMachinePolicyError("Unknown fleet access capability.");
    }
    const normalizedDecision = cleanText(decision, 30).toLowerCase();
    const next = { ...current, access: { ...current.access }, temporaryGrants: { ...current.temporaryGrants } };
    if (normalizedDecision === "allow-temporary") {
      next.temporaryGrants[normalizedCapability] = {
        grantedAt: now,
        expiresAt: now + 15 * 60_000,
        grantedBy: identity.id,
      };
    } else if (normalizedDecision === "allow") {
      next.access[normalizedCapability] = "allow";
      delete next.temporaryGrants[normalizedCapability];
    } else if (normalizedDecision === "deny") {
      next.access[normalizedCapability] = "deny";
      delete next.temporaryGrants[normalizedCapability];
    } else {
      throw new FleetMachinePolicyError("Access resolution must be allow-temporary, allow, or deny.");
    }
    return writeFleetMachinePolicy(next, { filePath: resolvedPath, machineId, now });
  });
}

export function effectiveFleetAccess(policy, now = Date.now()) {
  const normalized = normalizeFleetMachinePolicy(policy, { now });
  return Object.fromEntries(FLEET_ACCESS_CAPABILITIES.map((capability) => [
    capability,
    normalized.temporaryGrants[capability]?.expiresAt > now ? "allow" : normalized.access[capability],
  ]));
}

export function fleetMachinePolicyPublicView(policy, caller, now = Date.now()) {
  const normalized = normalizeFleetMachinePolicy(policy, { now });
  return {
    policy: normalized,
    effectiveAccess: effectiveFleetAccess(normalized, now),
    configured: Boolean(normalized.authority),
    canManage: fleetPolicyCanManage(normalized, caller),
    caller: cleanCaller(caller),
  };
}

export function fleetMachinePolicyHealthSummary(policy, now = Date.now()) {
  const normalized = normalizeFleetMachinePolicy(policy, { now });
  return {
    version: 1,
    valid: true,
    configured: Boolean(normalized.authority),
    authority: normalized.authority,
    performance: normalized.performance,
    updatedAt: normalized.updatedAt,
  };
}

export function fleetMachinePolicyFailureSummary() {
  return {
    version: 1,
    valid: false,
    configured: true,
    authority: null,
    performance: { ...DEFAULT_PERFORMANCE, ignore: true },
    updatedAt: new Date(0).toISOString(),
    error: "Machine policy is unavailable; routing is paused until it is repaired.",
  };
}

export function fleetMachinePolicyPrompt(policy, now = Date.now()) {
  const normalized = normalizeFleetMachinePolicy(policy, { now });
  if (!normalized.authority) return "";
  const effective = effectiveFleetAccess(normalized, now);
  const lines = FLEET_ACCESS_CAPABILITIES.map((capability) => {
    const label = ACCESS_CAPABILITY_LABELS[capability];
    const configured = normalized.access[capability];
    const temporary = configured !== "allow" && effective[capability] === "allow";
    return `- ${capability}: ${temporary ? "allow (temporary grant)" : effective[capability]} — ${label}`;
  });
  return [
    "MACHINE ACCESS POLICY (set by this collector's master hub):",
    ...lines,
    "Treat ASK as DENY until the human approves it. Never work around DENY or ASK with shell, direct filesystem access, another app, or another machine.",
    "Merely discovering, listing, or observing connected apps never requires connectedApps approval. Request connectedApps only immediately before a concrete call to an app or service advertised by another fleet collector; first name that app or service and its target machine in one plain sentence.",
    "If the task truly requires one ASK capability, stop before accessing it and end with exactly these three lines (replace <capability> with its key above):",
    "ACTION NEEDED: Approve or deny this machine access before I continue.",
    "FLEET ACCESS REQUEST: <capability>",
    "OPTIONS: Allow 15 min | Always allow | Deny",
    "A hub or configured messaging channel will deliver the decision; retry only after the task resumes.",
  ].join("\n");
}

export function fleetPolicyNeedsIsolatedHermes(policy, now = Date.now()) {
  const normalized = normalizeFleetMachinePolicy(policy, { now });
  if (!normalized.authority) return false;
  return Object.values(effectiveFleetAccess(normalized, now)).some((decision) => decision !== "allow");
}

export function fleetPolicyRuntimeFlags(policy, now = Date.now()) {
  const normalized = normalizeFleetMachinePolicy(policy, { now });
  if (!normalized.authority) return {};
  const access = effectiveFleetAccess(normalized, now);
  return {
    HIVEMINDOS_MACHINE_POLICY_ACTIVE: "1",
    HIVEMINDOS_SHARED_BRAIN_ACCESS: access.sharedBrain,
    HIVEMINDOS_SHARED_ENV_ACCESS: access.sharedEnv,
    HIVEMINDOS_CHAT_HISTORY_ACCESS: access.chatHistory,
    HIVEMINDOS_CONNECTED_APPS_ACCESS: access.connectedApps,
    HIVEMINDOS_MESSAGING_ACCESS: access.messagingChannels,
    HIVEMINDOS_FILE_TRANSFERS_ACCESS: access.fileTransfers,
  };
}
