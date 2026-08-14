import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APPROVAL_MARKER = "[HIVEMINDOS_CAPABILITY_PLAN_APPROVED]";

function clean(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function normalizedApprovedCapabilities(value, prompt) {
  if (!Array.isArray(value) || !String(prompt || "").includes(APPROVAL_MARKER)) return [];
  const promptCapabilityIds = new Set(String(prompt).split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*Capability id:\s*(.+?)\s*$/i);
    return match ? [clean(match[1], 240)] : [];
  }));
  const capabilities = [];
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = clean(item.id, 240);
    if (!id || seen.has(id) || !promptCapabilityIds.has(id)) continue;
    seen.add(id);
    capabilities.push({ id, intent: clean(item.intent || "capability", 100) || "capability", locator: clean(item.locator, 1_000), executionReceiptRequired: item.executionReceiptRequired === true });
  }
  return capabilities;
}

function runtimeSkillSlug(capabilityId) {
  if (/^(?:connected-app|app-endpoint):/i.test(capabilityId)) return "hive-remote-capability-use";
  if (!capabilityId.startsWith("skill:shared:")) return "";
  const slug = capabilityId.slice("skill:shared:".length);
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(slug) ? slug : "";
}

async function projectExactSharedSkill(sourceRoot, targetRoot, slug, agent, projectionScript) {
  const { stdout } = await execFileAsync(process.execPath, [projectionScript, "--source", sourceRoot, "--target", targetRoot, "--agent", agent, "--slug", slug], { timeout: 30_000, maxBuffer: 1_000_000, windowsHide: true });
  const [synced, unchanged] = String(stdout || "").trim().split("\t").map((entry) => Number(entry));
  return Number.isFinite(synced) && Number.isFinite(unchanged) && synced + unchanged > 0;
}

export async function materializeApprovedHermesCapabilities({ approvedCapabilities, defaultSyncPath, hermesHome, projectionScript, prompt, sharedVaultPath = "" }) {
  const capabilities = normalizedApprovedCapabilities(approvedCapabilities, prompt);
  const results = [];
  const requiredReceiptIds = [];
  const sourceRoots = [...new Set([defaultSyncPath, sharedVaultPath].filter(Boolean).map((vaultPath) => join(vaultPath, "Skills")))];
  const overlayRoot = join(hermesHome, ".hivemindos", "capabilities");
  const nativeSkillRoot = join(hermesHome, "skills");
  for (const capability of capabilities) {
    const slug = runtimeSkillSlug(capability.id);
    if (!slug) {
      if (capability.executionReceiptRequired) results.push({ ...capability, status: "failed", error: "No runtime materializer is registered for this selected capability type." });
      continue;
    }
    const sourceRoot = sourceRoots.find((root) => existsSync(join(root, slug, "SKILL.md"))) || "";
    if (!sourceRoot) {
      results.push({ ...capability, status: "failed", error: "The selected skill is not present in this machine's synchronized shared vault." });
      continue;
    }
    try {
      const ready = await projectExactSharedSkill(sourceRoot, overlayRoot, slug, "hermes-runtime-overlay", projectionScript);
      if (!ready) throw new Error("The managed runtime overlay did not contain the selected skill after synchronization.");
      await projectExactSharedSkill(sourceRoot, nativeSkillRoot, slug, "hermes", projectionScript).catch(() => false);
      results.push({ ...capability, status: "ready", runtimeLocator: join(overlayRoot, slug, "SKILL.md"), runtimeSkillSlug: slug });
      if (capability.executionReceiptRequired) requiredReceiptIds.push(capability.id);
    } catch (error) {
      results.push({ ...capability, status: "failed", error: clean(error instanceof Error ? error.message : "Runtime capability provisioning failed.", 500) });
    }
  }
  return { results, requiredReceiptIds };
}

export function capabilityRuntimeContext(results) {
  if (!results.length) return "";
  const lines = ["", "", "[HIVEMINDOS_RUNTIME_CAPABILITIES]", "HivemindOS resolved the approved capability plan against this exact runtime before launch:"];
  for (const result of results) {
    if (result.status === "ready") {
      lines.push(`- ${result.id}: provisioned through runtime workflow ${result.runtimeSkillSlug} at ${result.runtimeLocator}`);
      if (result.executionReceiptRequired) lines.push(`  The first real invocation must be a terminal command prefixed with HIVEMINDOS_CAPABILITY_ID='${result.id}'. Do not use or prepare a fallback before that invocation completes or returns concrete failure evidence.`);
    } else lines.push(`- ${result.id}: provisioning failed before launch (${result.error}). This is concrete capability failure evidence; use the best viable fallback and report the failure plainly.`);
  }
  lines.push("[/HIVEMINDOS_RUNTIME_CAPABILITIES]");
  return lines.join("\n");
}

export function createCapabilityReceiptTracker(requiredReceiptIds) {
  const receipts = new Map();
  return {
    observe(event) {
      if (/^capability\.(?:started|completed|failed)$/.test(String(event?.type || "")) && typeof event?.id === "string") receipts.set(event.id, String(event.type).slice("capability.".length));
    },
    missing() {
      return requiredReceiptIds.filter((id) => !["completed", "failed"].includes(receipts.get(id)));
    },
  };
}

export async function createHermesCapabilityRun(options) {
  const materialization = await materializeApprovedHermesCapabilities(options);
  const tracker = createCapabilityReceiptTracker(materialization.requiredReceiptIds);
  return {
    ...materialization,
    context: capabilityRuntimeContext(materialization.results),
    requiresScopedCli: materialization.results.length > 0,
    spawnEnv: { HIVEMINDOS_APPROVED_CAPABILITY_IDS: JSON.stringify(materialization.requiredReceiptIds) },
    provisioningEvents: materialization.results.map((result) => ({
      type: result.status === "ready" ? "capability.ready" : "capability.provisioning_failed",
      id: result.id,
      name: result.id,
      status: result.status,
      ...(result.status === "failed" ? { message: result.error } : {}),
    })),
    observeProcessEvent: tracker.observe,
    executionError() {
      const missing = tracker.missing();
      return missing.length ? `HivemindOS rejected this result because Hermes did not execute the approved capability before finishing: ${missing.join(", ")}.` : "";
    },
  };
}
