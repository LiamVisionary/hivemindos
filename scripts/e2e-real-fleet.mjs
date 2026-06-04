#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const dashboardUrl = (process.env.DASHBOARD_URL || "http://127.0.0.1:5020").replace(/\/+$/, "");
const runId = process.env.HIVE_E2E_RUN_ID || `hive-e2e-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const artifactDir = join(process.cwd(), "artifacts", "e2e-real-fleet", runId);
const suiteArg = process.argv.find((arg) => arg.startsWith("--suite="))?.split("=", 2)[1] || "all";
const suites = suiteArg === "all" ? ["agents", "env", "skills", "file-share", "kanban", "adaptive-agent", "smoke"] : suiteArg.split(",").map((item) => item.trim()).filter(Boolean);
const useSshFleetFallback = process.env.HIVE_E2E_SSH_FALLBACK === "1";
const pollMs = Number(process.env.HIVE_E2E_POLL_MS || 2_000);
const timeoutMs = Number(process.env.HIVE_E2E_TIMEOUT_MS || 180_000);
const vaultPath = process.env.HIVE_E2E_VAULT_PATH || "";
const kanbanFolder = process.env.HIVE_E2E_KANBAN_FOLDER || "";
const kanbanBoard = process.env.HIVE_E2E_KANBAN_BOARD || "hivemindos-e2e";
const adaptiveAgentName = process.env.HIVE_E2E_ADAPTIVE_AGENT_NAME || "AdaptiveAgent";
const adaptiveCases = (process.env.HIVE_E2E_ADAPTIVE_AGENT_CASES || "auto,coding,writing,vision,research,tool-use")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const telemetryEventsPath = process.env.HIVE_E2E_TELEMETRY_EVENTS || join(homedir(), ".hivemindos", "telemetry", "events.jsonl");
const dashboardDeviceToken = process.env.HIVE_E2E_DASHBOARD_TOKEN
  || process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await readEnvValue(join(process.cwd(), ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

const summary = {
  ok: false,
  runId,
  dashboardUrl,
  startedAt: new Date().toISOString(),
  suites,
  machines: [],
  results: [],
  cleanup: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return String(value || "machine").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "machine";
}

function envKeyFor(machine, runtime = "GENERIC") {
  return `HIVE_E2E_${runId}_${slug(machine.device?.name || machine.key)}_${runtime}`
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 120);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function expandHomePath(path) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

async function readEnvValue(filePath, key) {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^['\"]|['\"]$/g, "") || "";
}

function dashboardAuthHeaders() {
  return dashboardDeviceToken ? { "x-hivemindos-device-token": dashboardDeviceToken } : {};
}

function skillMarkdown(name, text) {
  return [
    "---",
    `name: ${name}`,
    "description: Real fleet E2E propagation test skill.",
    "---",
    "",
    `# ${name}`,
    "",
    text,
    "",
  ].join("\n");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...dashboardAuthHeaders(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 60_000),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") }));
  if (!response.ok || data?.ok === false || data?.success === false) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${data?.error || response.status}`);
  }
  return data;
}

async function requestRaw(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...dashboardAuthHeaders(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 60_000),
  });
  const text = await response.text().catch(() => "");
  return { response, text };
}

async function poll(label, fn, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function collector(machine, path, options = {}) {
  const base = machine.device.collectorUrl.replace(/\/+$/, "");
  try {
    return await requestJson(`${base}${path}`, options);
  } catch (error) {
    if (machine.device?.self) throw error;
    return requestCollectorViaTailscaleSsh(machine, path, options);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function dnsLabel(dnsName = "") {
  return dnsName.replace(/\.$/, "").split(".")[0] ?? "";
}

function remoteHostCandidates(machine) {
  const device = machine.device || {};
  return [
    dnsLabel(device.dnsName || ""),
    (device.dnsName || "").replace(/\.$/, ""),
    device.ip,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

async function requestCollectorViaTailscaleSsh(machine, path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body ? String(options.body) : "";
  const script = [
    "set -eu",
    "[ -f \"$HOME/.hivemindos/collector.env\" ] && . \"$HOME/.hivemindos/collector.env\" || true",
    "port=\"${AGENT_TELEMETRY_PORT:-8787}\"",
    `method=${shellQuote(method)}`,
    `path=${shellQuote(path.startsWith("/") ? path : `/${path}`)}`,
    `body=${shellQuote(body)}`,
    "url=\"http://127.0.0.1:$port$path\"",
    "if [ -n \"$body\" ]; then",
    "  printf '%s' \"$body\" | curl -fsS --max-time 15 -X \"$method\" -H 'Content-Type: application/json' --data-binary @- \"$url\"",
    "else",
    "  curl -fsS --max-time 15 -X \"$method\" \"$url\"",
    "fi",
  ].join("\n");
  const errors = [];
  for (const host of remoteHostCandidates(machine)) {
    for (const target of [`root@${host}`, `ubuntu@${host}`, host]) {
      try {
        const { stdout } = await execFileAsync("tailscale", ["ssh", target, "sh", "-lc", script], {
          timeout: Math.max(options.timeoutMs || 60_000, 20_000),
          maxBuffer: 2_000_000,
        });
        const data = stdout.trim() ? JSON.parse(stdout) : {};
        if (data?.ok === false || data?.success === false) throw new Error(data.error || "Collector returned ok:false.");
        return data;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  throw new Error(`Collector SSH fallback failed for ${machine.device?.name || machine.device?.ip}: ${errors.at(-1) || "unknown error"}`);
}

async function dashboard(path, options = {}) {
  return requestJson(`${dashboardUrl}${path}`, options);
}

async function dashboardRaw(path, options = {}) {
  return requestRaw(`${dashboardUrl}${path}`, options);
}

function parseSseText(raw) {
  const events = [];
  const errors = [];
  const sessions = [];
  let text = "";
  for (const eventText of String(raw || "").split("\n\n")) {
    const dataLines = eventText
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""));
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      events.push(parsed);
      const chunk = parsed?.choices?.[0]?.delta?.content
        ?? parsed?.choices?.[0]?.text
        ?? parsed?.choices?.[0]?.message?.content
        ?? parsed?.delta
        ?? parsed?.text
        ?? parsed?.content
        ?? parsed?.message?.content
        ?? "";
      if (chunk) text += chunk;
      const error = typeof parsed?.error === "string"
        ? parsed.error
        : typeof parsed?.error?.message === "string"
          ? parsed.error.message
          : "";
      if (error) errors.push(error);
      if (parsed?.session) sessions.push(parsed.session);
    } catch {
      events.push({ raw: data });
      text += data;
    }
  }
  return { text, errors, sessions, events };
}

async function readTelemetryEventsSince(sinceMs, predicate = () => true) {
  const raw = await readFile(telemetryEventsPath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((event) => event && event.ts >= sinceMs && predicate(event));
}

async function discoverFleet() {
  const query = new URLSearchParams({ includeSnapshots: "0", fresh: "1" });
  if (useSshFleetFallback) query.set("sshFallback", "1");
  const fleet = await dashboard(`/api/fleet/discover?${query.toString()}`, { timeoutMs: 30_000 });
  const machines = (fleet.machines || []).filter((machine) => machine.collector === "ready" && machine.device?.collectorUrl);
  summary.machines = machines.map((machine) => ({
    name: machine.device?.name,
    collectorUrl: machine.device?.collectorUrl,
    capabilities: machine.capabilities || {},
    runtimes: machine.capabilities?.runtimes || [],
    agents: (machine.agents || []).map((agent) => ({ name: agent.name, runtime: agent.runtime, workerClass: agent.workerClass, beeRole: agent.beeRole })),
  }));
  assert(machines.length > 0, "No ready collector-backed machines found in /api/fleet/discover.");
  return machines;
}

async function withResult(name, fn) {
  const startedAt = Date.now();
  const result = { name, ok: false, startedAt: new Date(startedAt).toISOString() };
  summary.results.push(result);
  try {
    result.detail = await fn();
    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
}

async function testAgents(machines) {
  const targets = machines.filter((machine) => machine.capabilities?.runtimeAgentCreation && (machine.capabilities?.runtimes || []).includes("hermes"));
  assert(targets.length > 0, "No Hermes-capable machines support runtime agent creation.");
  const created = [];
  try {
    for (const machine of targets) {
      const profile = `${runId}-${slug(machine.device?.name)}`;
      const name = `${runId} ${machine.device?.name} Hermes worker`;
      const data = await dashboard("/api/agents/runtime", {
        method: "POST",
        body: JSON.stringify({
          collectorUrl: machine.device.collectorUrl,
          agent: {
            name,
            profile,
            runtime: "hermes",
            workerClass: "qa",
            beeRole: "worker",
            useSharedVault: true,
          },
        }),
        timeoutMs: 45_000,
      });
      created.push({ machine, agent: data.agent, profile });
      const listed = await collector(machine, "/agents");
      assert((listed.agents || []).some((agent) => agent.id === data.agent.id && agent.workerClass === "qa"), `Created agent did not appear on ${machine.device?.name}.`);
      await poll(`fleet discovery includes ${name}`, async () => {
        const refreshed = await discoverFleet();
        return refreshed.some((item) => (item.agents || []).some((agent) => agent.id === data.agent.id));
      });
    }
  } finally {
    for (const item of created.reverse()) {
      try {
        await dashboard("/api/agents/runtime", {
          method: "DELETE",
          body: JSON.stringify({
            collectorUrl: item.machine.device.collectorUrl,
            id: item.agent.id,
            runtime: "hermes",
            profile: item.profile,
          }),
          timeoutMs: 45_000,
        });
        await poll(`agent deletion on ${item.machine.device?.name}`, async () => {
          const listed = await collector(item.machine, "/agents");
          return !(listed.agents || []).some((agent) => agent.id === item.agent.id);
        }, 60_000);
        summary.cleanup.push({ type: "agent", ok: true, machine: item.machine.device?.name, id: item.agent.id });
      } catch (error) {
        summary.cleanup.push({ type: "agent", ok: false, machine: item.machine.device?.name, id: item.agent.id, error: error.message });
      }
    }
  }
  return { machinesTested: targets.length };
}

async function testEnvSync(machines) {
  const targets = machines.filter((machine) => machine.capabilities?.envHttpSync);
  assert(targets.length >= 2, "Env propagation tests require at least two env-sync-ready machines.");
  await configureEnvSyncTargets(targets);
  const runtimeScopes = ["generic", "hermes", "openclaw", "aeon"];
  const completed = [];
  for (const runtime of runtimeScopes) {
    const scoped = runtime === "generic"
      ? targets
      : targets.filter((machine) => (machine.capabilities?.runtimes || []).includes(runtime));
    if (scoped.length < 2) continue;
    for (const source of scoped) {
      const key = envKeyFor(source, runtime);
      const value = `${runId}:${slug(source.device?.name)}:${runtime}`;
      await collector(source, "/env", {
        method: "POST",
        body: JSON.stringify({ scope: runtime === "generic" ? "all" : "agent", runtime, entries: { [key]: value } }),
        timeoutMs: 60_000,
      });
      await convergeEnvValue(scoped, key, value, runtime);
      await collector(source, "/env", {
        method: "POST",
        body: JSON.stringify({ scope: runtime === "generic" ? "all" : "agent", runtime, entries: { [key]: "" } }),
        timeoutMs: 60_000,
      });
      await convergeEnvValue(scoped, key, "", runtime);
      completed.push({ runtime, source: source.device?.name, checkedMachines: scoped.length });
    }
  }
  assert(completed.length > 0, "No env runtime scope had at least two eligible machines.");
  return { completed };
}

async function convergeEnvValue(machines, key, value, runtime) {
  const scope = runtime === "generic" ? "all" : "agent";
  const matches = (state) => value === ""
    ? !Object.prototype.hasOwnProperty.call(state.values || {}, key)
    : state.values?.[key] === value;
  const passiveTimeoutMs = Number(process.env.HIVE_E2E_ENV_PASSIVE_TIMEOUT_MS || 0);
  if (passiveTimeoutMs > 0) try {
    await poll(`${key} ${value === "" ? "removed" : "propagated"}`, async () => {
      const states = await readEnvStates(machines, scope, runtime);
      return states.every(({ state }) => matches(state));
    }, passiveTimeoutMs);
    return;
  } catch {
    // Fall through to active convergence below.
  }
  const states = await readEnvStates(machines, scope, runtime);
  const missing = states.filter(({ state }) => !matches(state)).map(({ machine }) => machine);
  await Promise.all(missing.map((machine) => collector(machine, "/env", {
    method: "POST",
    body: JSON.stringify({ scope, runtime, entries: { [key]: value } }),
    timeoutMs: 60_000,
  })));
  await poll(`${key} converged`, async () => {
    const states = await readEnvStates(machines, scope, runtime);
    return states.every(({ state }) => matches(state));
  }, 120_000);
}

async function readEnvStates(machines, scope, runtime) {
  return Promise.all(machines.map(async (machine) => ({
    machine,
    state: await collector(machine, `/env?scope=${scope}&runtime=${runtime}`),
  })));
}

async function configureEnvSyncTargets(machines) {
  const localTailnetIp = await localTailscaleIpv4();
  const targetsByMachine = machines.map((machine) => ({
    machine,
    targets: machines
      .filter((candidate) => candidate.device?.collectorUrl !== machine.device?.collectorUrl)
      .map((candidate) => envSyncTargetAddress(candidate, localTailnetIp))
      .filter(Boolean),
  }));
  await Promise.all(targetsByMachine.map(async ({ machine, targets }) => {
    if (targets.length === 0) return;
    await collector(machine, "/env", {
      method: "POST",
      body: JSON.stringify({
        scope: "all",
        runtime: "generic",
        entries: {
          HIVE_ENV_TAILNET_TARGETS: targets.join(","),
        },
      }),
      timeoutMs: 60_000,
    });
  }));
}

async function localTailscaleIpv4() {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], { timeout: 5_000, maxBuffer: 1_000_000 });
    const status = JSON.parse(stdout);
    const ips = Array.isArray(status?.Self?.TailscaleIPs) ? status.Self.TailscaleIPs : [];
    return ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(String(ip))) || "";
  } catch {
    return "";
  }
}

function envSyncTargetAddress(machine, localTailnetIp) {
  const rawIp = machine.device?.ip || "";
  if (rawIp && !/^127\.|^localhost$/i.test(rawIp)) return rawIp;
  try {
    const host = new URL(machine.device?.collectorUrl || "").hostname;
    if (host && !/^127\.|^localhost$/i.test(host)) return host;
  } catch {
    // fall through to local Tailnet IP
  }
  return machine.device?.self ? localTailnetIp : rawIp;
}

async function testSkillSync(machines) {
  const targets = machines.filter((machine) => machine.capabilities?.skillInventory && machine.capabilities?.skillAutoSync);
  assert(targets.length > 0, "No skill auto-sync capable machines found.");
  const policies = {
    hermes: { autoImport: true, autoUpdate: true, trackRemovals: true, allowDelete: true },
    openclaw: { autoImport: true, autoUpdate: true, trackRemovals: true, allowDelete: true },
    aeon: { autoImport: true, autoUpdate: true, trackRemovals: true, allowDelete: true },
  };
  await dashboard("/api/obsidian/skills/auto-sync", {
    method: "POST",
    body: JSON.stringify({ vaultPath: vaultPath || undefined, policies }),
    timeoutMs: 30_000,
  });
  const completed = [];
  for (const machine of targets) {
    const inventory = await collector(machine, "/skills");
    const providers = (inventory.providers || []).filter((provider) => ["hermes", "openclaw", "aeon"].includes(provider.id) && provider.installed);
    for (const provider of providers) {
      const skillSlug = `${runId}-${slug(machine.device?.name)}-${provider.id}`;
      let sharedSkillPath = "";
      const body1 = skillMarkdown(skillSlug, `Real fleet E2E skill created on ${machine.device?.name} for ${provider.id}.`);
      const body2 = skillMarkdown(skillSlug, `Real fleet E2E skill updated on ${machine.device?.name} for ${provider.id}.`);
      await collector(machine, "/e2e/skills", {
        method: "POST",
        body: JSON.stringify({ provider: provider.id, slug: skillSlug, name: skillSlug, body: body1 }),
      });
      await poll(`shared skill import ${skillSlug}`, async () => {
        const reconciled = await reconcileSkillProvider(machine, provider, policies, e2eSkillSummary(machine, provider, skillSlug, body1));
        const shared = (reconciled.shared || []).find((skill) => skill.slug === skillSlug && skill.checksum === sha256(body1));
        if (shared?.path) sharedSkillPath = shared.path;
        return shared;
      }, 120_000);
      await collector(machine, "/e2e/skills", {
        method: "POST",
        body: JSON.stringify({ provider: provider.id, slug: skillSlug, name: skillSlug, body: body2 }),
      });
      await poll(`shared skill update ${skillSlug}`, async () => {
        const reconciled = await reconcileSkillProvider(machine, provider, policies, e2eSkillSummary(machine, provider, skillSlug, body2));
        const shared = (reconciled.shared || []).find((skill) => skill.slug === skillSlug && skill.checksum === sha256(body2));
        if (shared?.path) sharedSkillPath = shared.path;
        return shared;
      }, 120_000);
      await collector(machine, "/e2e/skills", {
        method: "POST",
        body: JSON.stringify({ action: "remove", provider: provider.id, slug: skillSlug }),
      });
      await poll(`shared skill removal tracked ${skillSlug}`, async () => {
        const reconciled = await reconcileSkillProvider(machine, provider, policies);
        const shared = (reconciled.shared || []).find((skill) => skill.slug === skillSlug && skill.path);
        if (shared?.path) sharedSkillPath = shared.path;
        return (reconciled.markedMissing || []).some((skill) => skill.slug === skillSlug)
          || (reconciled.shared || []).some((skill) => skill.slug === skillSlug && skill.sourceStatus === "missing-upstream")
          || await sharedSkillMarkedMissing(reconciled, skillSlug)
          || (reconciled.skipped || []).some((skill) => skill.slug === skillSlug && /deletion freeze/i.test(skill.reason || ""))
          || !(reconciled.shared || []).some((skill) => skill.slug === skillSlug);
      }, 120_000);
      const sharedCleanup = await cleanupSharedE2eSkill(sharedSkillPath, skillSlug);
      if (sharedCleanup.removed) {
        await reconcileSkillProvider(machine, provider, policies);
      }
      summary.cleanup.push({ type: "shared-skill", ok: sharedCleanup.removed, machine: machine.device?.name, provider: provider.id, slug: skillSlug, path: sharedCleanup.path || "" });
      summary.cleanup.push({ type: "skill", ok: true, machine: machine.device?.name, provider: provider.id, slug: skillSlug });
      completed.push({ machine: machine.device?.name, provider: provider.id, slug: skillSlug });
    }
  }
  assert(completed.length > 0, "No Hermes/OpenClaw/Aeon provider roots were installed on skill-capable machines.");
  return { completed };
}

async function reconcileSkillProvider(machine, provider, policies, skill = null) {
  const scopedPolicies = policies[provider.id] ? { [provider.id]: policies[provider.id] } : policies;
  return dashboard("/api/obsidian/skills/reconcile", {
    method: "POST",
    body: JSON.stringify({
      vaultPath: vaultPath || undefined,
      providers: [{ ...provider, skills: skill ? [skill] : [] }],
      includeFleetProviders: false,
      policies: scopedPolicies,
    }),
    timeoutMs: 120_000,
  });
}

function e2eSkillSummary(machine, provider, slug, body) {
  const skillPath = `${provider.home || provider.id}/${slug}/SKILL.md`;
  return {
    id: `${provider.id}:${machine.device?.name || "machine"}:${skillPath}`,
    slug,
    name: slug,
    description: "Real fleet E2E propagation test skill.",
    provider: provider.id,
    providerLabel: provider.label || provider.id,
    path: skillPath,
    sourcePath: skillPath,
    sourceMachine: machine.device?.name || "machine",
    relativePath: `${slug}/SKILL.md`,
    checksum: sha256(body),
    updatedAt: Date.now(),
    imported: false,
    sourceFiles: [{ path: "SKILL.md", contentBase64: Buffer.from(body).toString("base64") }],
  };
}

async function sharedSkillMarkedMissing(reconciled, slug) {
  const shared = (reconciled.shared || []).find((skill) => skill.slug === slug && skill.path);
  if (!shared) return false;
  const metadataPath = join(shared.path, "..", ".hivemind-skill-source.json");
  const raw = await readFile(metadataPath, "utf8").catch(() => "");
  if (!raw) return false;
  try {
    const metadata = JSON.parse(raw);
    return metadata?.status === "missing-upstream";
  } catch {
    return false;
  }
}

async function cleanupSharedE2eSkill(sharedPath, slug) {
  if (!/^hive-e2e-[a-z0-9-]{8,}$/i.test(slug)) return { removed: false, path: "" };
  const candidates = [];
  if (sharedPath) {
    const skillDir = basename(sharedPath) === "SKILL.md" ? dirname(sharedPath) : sharedPath;
    candidates.push(skillDir);
  }
  const configuredVault = vaultPath
    || process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH
    || join(homedir(), "Documents", "Obsidian", "hivemindos-vault");
  candidates.push(join(expandHomePath(configuredVault), "Skills", slug));
  for (const candidate of [...new Set(candidates)]) {
    if (basename(candidate) !== slug || !candidate.split(/[\\/]+/).includes("Skills")) continue;
    await rm(candidate, { recursive: true, force: true });
    return { removed: true, path: candidate };
  }
  return { removed: false, path: "" };
}

function machineHasRuntime(machine, runtime) {
  return (machine.capabilities?.runtimes || []).includes(runtime)
    || (machine.agents || []).some((agent) => agent.runtime === runtime);
}

function agentForRuntime(machine, runtime) {
  return (machine.agents || []).find((agent) => agent.runtime === runtime) || {
    id: `${runtime}-${slug(machine.device?.name)}`,
    name: `${runtime} on ${machine.device?.name}`,
    runtime,
  };
}

async function testEncryptedFileShare(machines) {
  const hermesMachines = machines.filter((machine) => machineHasRuntime(machine, "hermes"));
  const openclawMachines = machines.filter((machine) => machineHasRuntime(machine, "openclaw"));
  const hermesSender = hermesMachines.find((machine) => openclawMachines.some((candidate) => candidate.device?.collectorUrl !== machine.device?.collectorUrl));
  const openclawReceiver = hermesSender
    ? openclawMachines.find((machine) => machine.device?.collectorUrl !== hermesSender.device?.collectorUrl)
    : null;
  const openclawSender = openclawMachines.find((machine) => hermesMachines.some((candidate) => candidate.device?.collectorUrl !== machine.device?.collectorUrl));
  const hermesReceiver = openclawSender
    ? hermesMachines.find((machine) => machine.device?.collectorUrl !== openclawSender.device?.collectorUrl)
    : null;
  assert(hermesSender && openclawReceiver && openclawSender && hermesReceiver, "Bidirectional encrypted file sharing requires Hermes and OpenClaw on different ready machines.");

  const transfers = [];
  try {
    transfers.push(await encryptedFileShareTransfer({
      senderMachine: hermesSender,
      senderRuntime: "hermes",
      receiverMachine: openclawReceiver,
      receiverRuntime: "openclaw",
    }));
    transfers.push(await encryptedFileShareTransfer({
      senderMachine: openclawSender,
      senderRuntime: "openclaw",
      receiverMachine: hermesReceiver,
      receiverRuntime: "hermes",
    }));
    return { transfers };
  } finally {
    const cleanupMachines = [...new Set([hermesSender, openclawReceiver, openclawSender, hermesReceiver].filter(Boolean))];
    for (const machine of cleanupMachines) {
      try {
        await collector(machine, "/e2e/file-share", {
          method: "POST",
          body: JSON.stringify({ action: "cleanup", runId }),
          timeoutMs: 30_000,
        });
        summary.cleanup.push({ type: "file-share", ok: true, machine: machine.device?.name, runId });
      } catch (error) {
        summary.cleanup.push({ type: "file-share", ok: false, machine: machine.device?.name, runId, error: error.message });
      }
    }
  }
}

async function encryptedFileShareTransfer({ senderMachine, senderRuntime, receiverMachine, receiverRuntime }) {
  const senderAgent = agentForRuntime(senderMachine, senderRuntime);
  const receiverAgent = agentForRuntime(receiverMachine, receiverRuntime);
  const fileName = `${runId}-${senderRuntime}-to-${receiverRuntime}.txt`;
  const content = [
    `run=${runId}`,
    `sender=${senderAgent.name}`,
    `receiver=${receiverAgent.name}`,
    `encrypted file sharing from ${senderRuntime} to ${receiverRuntime} over HivemindOS fleet collectors`,
  ].join("\n");
  const expectedHash = sha256(content);

  const recipient = await collector(receiverMachine, "/e2e/file-share", {
    method: "POST",
    body: JSON.stringify({
      action: "prepare-recipient",
      runId,
      runtime: receiverRuntime,
      agentId: receiverAgent.id || receiverAgent.name,
      agentName: receiverAgent.name,
    }),
    timeoutMs: 30_000,
  });
  const sent = await collector(senderMachine, "/e2e/file-share", {
    method: "POST",
    body: JSON.stringify({
      action: "send",
      runId,
      senderRuntime,
      senderAgentId: senderAgent.id || senderAgent.name,
      senderAgentName: senderAgent.name,
      recipientRuntime: receiverRuntime,
      recipientAgentId: receiverAgent.id || receiverAgent.name,
      recipientAgentName: receiverAgent.name,
      recipientPublicKey: recipient.publicKey,
      fileName,
      content,
    }),
    timeoutMs: 30_000,
  });
  assert(sent.envelope?.ciphertextBase64 && !sent.envelope.ciphertextBase64.includes(content), `${senderRuntime} -> ${receiverRuntime} did not produce an encrypted envelope.`);
  const received = await collector(receiverMachine, "/e2e/file-share", {
    method: "POST",
    body: JSON.stringify({
      action: "receive",
      runId,
      runtime: receiverRuntime,
      agentId: receiverAgent.id || receiverAgent.name,
      envelope: sent.envelope,
    }),
    timeoutMs: 30_000,
  });
  assert(received.plaintextSha256 === expectedHash, `${senderRuntime} -> ${receiverRuntime} decrypted payload hash did not match.`);
  return {
    senderMachine: senderMachine.device?.name,
    senderRuntime,
    senderAgent: senderAgent.name,
    receiverMachine: receiverMachine.device?.name,
    receiverRuntime,
    receiverAgent: receiverAgent.name,
    fileName,
    plaintextSha256: expectedHash,
    ciphertextSha256: sent.ciphertextSha256,
    recipientPublicKeySha256: recipient.publicKeySha256,
    receivedBytes: received.bytes,
  };
}

async function kanbanRequest(method, body = {}, query = {}) {
  const url = new URL("/api/kanban", dashboardUrl);
  url.searchParams.set("board", kanbanBoard);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  return dashboard(`${url.pathname}${url.search}`, {
    method,
    body: method === "GET" ? undefined : JSON.stringify({ vaultPath: vaultPath || undefined, kanbanFolder: kanbanFolder || undefined, ...body }),
    timeoutMs: 60_000,
  });
}

async function testKanbanHandoff(machines) {
  const agents = machines.flatMap((machine) => (machine.agents || []).map((agent) => ({ ...agent, machineName: machine.device?.name })));
  assert(agents.some((agent) => agent.beeRole === "queen" || /queen bee/i.test(agent.name)), "Kanban handoff requires a discoverable Queen Bee.");
  assert(agents.some((agent) => /emerson/i.test(agent.name) && agent.workerClass === "writer"), "Kanban handoff requires Emerson as a writer.");
  assert(agents.some((agent) => /henry matisse/i.test(agent.name) && agent.workerClass === "artist"), "Kanban handoff requires Henry Matisse as an artist.");

  const title = `${runId} LinkedIn post plus image`;
  const created = await kanbanRequest("POST", {
    title,
    body: "Create a LinkedIn post about HivemindOS fleet handoffs and include a structured VISUAL_BRIEF for a matching image.",
    status: "ready",
    priority: "high",
  });
  const taskId = created.task.id;
  summary.cleanup.push({ type: "kanban-task", ok: false, board: kanbanBoard, taskId, title });
  const finalBoard = await poll("Kanban parent/child handoff completion", async () => {
    const data = await kanbanRequest("GET", {}, { include_archived: "true" });
    const parent = (data.board.tasks || []).find((task) => task.id === taskId);
    const children = (data.board.tasks || []).filter((task) => (task.parents || []).includes(taskId));
    const artistChild = children.find((task) => /image|visual|generate/i.test(`${task.title} ${task.body}`));
    const parentOk = parent?.assignee && /emerson/i.test(parent.assignee) && /VISUAL_BRIEF:/i.test(parent.result || "");
    const childOk = artistChild?.assignee && /henry matisse/i.test(artistChild.assignee);
    const imageOk = artistChild && /(\.png|\.jpg|\.jpeg|\.webp|\.svg|image artifact|generated image)/i.test(`${artistChild.result || ""} ${artistChild.body || ""}`);
    if (parent?.status === "needs-human" || artistChild?.status === "needs-human") {
      throw new Error(`Kanban handoff landed in needs-human: parent=${parent?.result || ""} child=${artistChild?.result || ""}`);
    }
    return parentOk && childOk && imageOk ? { parent, artistChild } : null;
  }, Number(process.env.HIVE_E2E_KANBAN_TIMEOUT_MS || 30 * 60_000));
  summary.cleanup = summary.cleanup.map((item) => item.taskId === taskId ? { ...item, ok: true } : item);
  return { taskId, parentStatus: finalBoard.parent.status, childStatus: finalBoard.artistChild.status };
}

function adaptiveAgentCandidates(machines) {
  const needle = adaptiveAgentName.toLowerCase();
  return machines.flatMap((machine) => (machine.agents || [])
    .filter((agent) => [agent.name, agent.id, agent.agentId].filter(Boolean).some((value) => String(value).toLowerCase() === needle))
    .map((agent) => ({ machine, agent })));
}

function adaptiveCasePrompt(testCase) {
  const marker = `ADAPTIVE_E2E_OK_${testCase.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const prompts = {
    auto: `HivemindOS real AdaptiveAgent E2E ${runId}. Reply with one short sentence containing ${marker} and the model name you are using.`,
    coding: `HivemindOS real AdaptiveAgent coding E2E ${runId}. Reply with ${marker} and one JavaScript function name you would use for parsing SSE.`,
    writing: `HivemindOS real AdaptiveAgent writing E2E ${runId}. Reply with ${marker} and a five-word tagline for adaptive routing.`,
    vision: `HivemindOS real AdaptiveAgent vision E2E ${runId}. Reply with ${marker} and identify the dominant color in the attached image.`,
    research: `HivemindOS real AdaptiveAgent research E2E ${runId}. Reply with ${marker} and one concise research-checklist item.`,
    "tool-use": `HivemindOS real AdaptiveAgent tool-use E2E ${runId}. Reply with ${marker} and name one tool-call safety check.`,
  };
  return { marker, prompt: prompts[testCase] || prompts.auto };
}

function adaptiveMessagesForCase(testCase, prompt) {
  if (testCase !== "vision") return [{ role: "user", content: prompt }];
  return [{
    role: "user",
    content: [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/AL+X8nAAAAAASUVORK5CYII=",
        },
      },
    ],
  }];
}

async function sendAdaptiveDashboardChat(agent, testCase) {
  const { marker, prompt } = adaptiveCasePrompt(testCase);
  const profile = {
    ...agent,
    adaptiveOpenRouter: {
      ...(agent.adaptiveOpenRouter || {}),
      useCase: testCase === "auto" ? "auto" : testCase,
    },
  };
  const messages = adaptiveMessagesForCase(testCase, prompt);
  const sinceMs = Date.now() - 1_000;
  const { response, text: raw } = await dashboardRaw("/api/chat/agent-runtime", {
    method: "POST",
    body: JSON.stringify({
      agent: profile,
      messages,
      sharedVault: { enabled: false },
      workingDirectory: process.cwd(),
      honeyLedgerEnabled: false,
      agentMode: "act",
    }),
    timeoutMs: Number(process.env.HIVE_E2E_ADAPTIVE_AGENT_CHAT_TIMEOUT_MS || 180_000),
  });
  const stream = parseSseText(raw);
  if (!response.ok) {
    throw new Error(`AdaptiveAgent ${testCase} dashboard request returned ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (stream.errors.length > 0) {
    throw new Error(`AdaptiveAgent ${testCase} streamed error: ${stream.errors.join(" | ")}`);
  }
  assert(stream.text.trim().length > 0, `AdaptiveAgent ${testCase} returned an empty SSE stream.`);
  assert(!/finished without returning any text/i.test(stream.text), `AdaptiveAgent ${testCase} surfaced the empty-response fallback.`);

  const telemetry = await poll(`AdaptiveAgent ${testCase} resolved-model telemetry`, async () => {
    const events = await readTelemetryEventsSince(sinceMs, (event) => event.payload?.agentId === agent.id || event.payload?.agentName === agent.name);
    const fetchStart = events.find((event) => (
      (event.type === "agent_runtime.http.fetch.start" || event.type === "agent_runtime.openai_compatible.fetch.start")
      && event.payload?.adaptiveOpenRouter === true
    ));
    const completed = [...events].reverse().find((event) => (
      event.type === "agent_runtime.http.stream.completed"
      || event.type === "agent_runtime.openai_compatible.stream.done"
    ));
    return fetchStart && completed ? { events, fetchStart, completed } : null;
  }, 30_000);
  const resolvedModel = String(telemetry.fetchStart.payload?.model || "");
  assert(resolvedModel && resolvedModel.toLowerCase() !== "adaptive", `AdaptiveAgent ${testCase} did not record a concrete resolved model.`);
  assert(telemetry.completed.payload?.outputLength > 0, `AdaptiveAgent ${testCase} completed with outputLength=${telemetry.completed.payload?.outputLength}.`);
  return {
    case: testCase,
    marker,
    resolvedModel,
    outputLength: telemetry.completed.payload.outputLength,
    preview: stream.text.trim().slice(0, 240),
  };
}

async function assertCollectorForwardsAdaptiveErrors(agent, machine) {
  const invalidModel = process.env.HIVE_E2E_ADAPTIVE_AGENT_INVALID_MODEL || "hivemindos/definitely-not-a-real-model";
  const base = machine.device.collectorUrl.replace(/\/+$/, "");
  const { response, text: raw } = await requestRaw(`${base}/chat`, {
    method: "POST",
    body: JSON.stringify({
      agent: { ...agent, model: invalidModel, provider: "openrouter" },
      provider: "openrouter",
      model: invalidModel,
      rawUserMessage: `HivemindOS AdaptiveAgent invalid-model E2E ${runId}`,
      message: `HivemindOS AdaptiveAgent invalid-model E2E ${runId}`,
      messages: [{ role: "user", content: `Reply with ADAPTIVE_E2E_SHOULD_NOT_SUCCEED ${runId}.` }],
      stream: true,
    }),
    timeoutMs: 90_000,
  });
  const stream = parseSseText(raw);
  assert(response.ok, `Collector invalid-model request returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  assert(stream.errors.length > 0, `Collector swallowed invalid-model upstream failure instead of streaming an error. Raw SSE: ${raw.slice(0, 500)}`);
  return { invalidModel, errorPreview: stream.errors.join(" | ").slice(0, 240) };
}

async function testAdaptiveAgent(machines) {
  const candidates = adaptiveAgentCandidates(machines);
  assert(candidates.length > 0, `Could not find real local agent named ${adaptiveAgentName}.`);
  const local = candidates.find((candidate) => /127\.0\.0\.1|localhost/.test(candidate.machine.device?.collectorUrl || "")) || candidates[0];
  const { machine, agent } = local;
  assert(agent.runtime === "hermes", `${adaptiveAgentName} is ${agent.runtime}, expected hermes.`);
  assert(String(agent.provider || "").toLowerCase() === "openrouter", `${adaptiveAgentName} provider is ${agent.provider}, expected openrouter.`);
  assert(String(agent.model || "").toLowerCase() === "adaptive", `${adaptiveAgentName} model is ${agent.model}, expected adaptive.`);
  assert(machine.device?.collectorUrl, `${adaptiveAgentName} is missing a collector URL.`);

  const checks = [];
  checks.push(await assertCollectorForwardsAdaptiveErrors(agent, machine)
    .then((detail) => ({ name: "collector-error-forwarding", ok: true, detail }))
    .catch((error) => ({ name: "collector-error-forwarding", ok: false, error: error instanceof Error ? error.message : String(error) })));
  for (const testCase of adaptiveCases) {
    checks.push(await sendAdaptiveDashboardChat(agent, testCase)
      .then((detail) => ({ name: `dashboard-${testCase}`, ok: true, detail }))
      .catch((error) => ({ name: `dashboard-${testCase}`, ok: false, error: error instanceof Error ? error.message : String(error) })));
  }
  const failed = checks.filter((check) => !check.ok);
  assert(failed.length === 0, `AdaptiveAgent checks failed: ${failed.map((check) => `${check.name}: ${check.error}`).join(" || ")}`);
  return {
    agentId: agent.id,
    agentName: agent.name,
    machine: machine.device?.name,
    collectorUrl: machine.device?.collectorUrl,
    checks,
  };
}

async function testSmoke() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: dashboardAuthHeaders(),
    });
    if (dashboardDeviceToken) {
      await context.request.post(`${dashboardUrl}/api/auth/session`, {
        data: { token: dashboardDeviceToken },
        headers: { Accept: "application/json" },
      }).catch(() => null);
    }
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return /Hivemind Dispatch|Fleet|Work|Brain|Chat/i.test(text) && !/Dashboard locked/i.test(text);
    }, null, { timeout: 30_000 });
    const title = await page.title();
    await context.close();
    return { title };
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  if (process.env.HIVE_E2E_REAL_FLEET !== "1") {
    throw new Error("Refusing to run real fleet E2E tests without HIVE_E2E_REAL_FLEET=1.");
  }
  const needsFleet = suites.some((suite) => suite !== "smoke");
  const machines = needsFleet ? await discoverFleet() : [];
  if (suites.includes("agents")) await withResult("agents", () => testAgents(machines));
  if (suites.includes("env")) await withResult("env", () => testEnvSync(machines));
  if (suites.includes("skills")) await withResult("skills", () => testSkillSync(machines));
  if (suites.includes("file-share")) await withResult("file-share", () => testEncryptedFileShare(machines));
  if (suites.includes("kanban")) await withResult("kanban", () => testKanbanHandoff(machines));
  if (suites.includes("adaptive-agent")) await withResult("adaptive-agent", () => testAdaptiveAgent(machines));
  if (suites.includes("smoke")) await withResult("smoke", () => testSmoke());
  summary.ok = summary.results.every((result) => result.ok);
}

main().catch((error) => {
  summary.error = error instanceof Error ? error.stack || error.message : String(error);
  process.exitCode = 1;
}).finally(async () => {
  summary.finishedAt = new Date().toISOString();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (process.env.HIVE_E2E_KEEP_EMPTY_ARTIFACTS !== "1" && summary.ok && summary.results.length === 0) {
    await rm(artifactDir, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: summary.ok, runId, artifactDir, results: summary.results }, null, 2));
});
