import { readFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, relative, resolve } from "path";
import { listArchivedMiroSharkRuns } from "@/lib/services/miroshark/archive";
import {
  buildByokAgentCallInstructions,
  createByokAgentCall,
  createInAppCall,
  readManagedVoiceConfig,
  resolveVoice,
  voiceConfigPayload,
  voiceProvidersFromManagedConfig,
} from "@/lib/services/phone/realtime-voice";
import { toolsForVoiceToolBundle } from "@/lib/services/phone/voice-tool-bundles";
import {
  LOCAL_TTS_RUNTIME,
  discoverLocalTtsCandidates,
  isLocalTtsProviderId,
  resolveLocalTtsCallConfig,
} from "@/lib/services/phone/local-tts";
import { normalizeGeminiLiveModel } from "@/lib/services/phone/cloud-voice-transports";
import { appendVoiceRunEvent, completeVoiceRun, createVoiceRun } from "@/lib/services/phone/voice-runs";

const GATEWAY_PORTS = [5000, 5001, 5002];

export type GatewayCallPayload = {
  scriptId?: string;
  title?: string;
  briefing?: string;
  returnAfterRoomReady?: boolean;
  voiceProviderId?: string;
  voiceRuntime?: string;
  voiceModelId?: string;
  voiceId?: string;
  voiceKeyEnv?: string;
  runtimeAgent?: RuntimeAgentVoiceBridge;
};

export type GatewayCallResult = {
  ok: boolean;
  gateway?: string;
  result?: unknown;
  error?: string;
};

const RECENT_MIROSHARK_RUN_LIMIT = 2;
const MIROSHARK_RUN_SCAN_LIMIT = 12;

export type AgentCallIdentity = {
  id?: string;
  name?: string;
  runtime?: string;
  role?: string;
  task?: string;
  voiceProviderId?: string;
  voiceRuntime?: string;
  voiceModelId?: string;
  voiceId?: string;
  voiceKeyEnv?: string;
  soulPrompt?: string;
  skillProfilePrompt?: string;
  preferredSkillSlugs?: string[];
  aeonRepo?: string;
  aeonRepoName?: string;
  aeonBranch?: string;
  aeonLocalPath?: string;
  aeonMode?: string;
  a2aUrl?: string;
  gatewayUrl?: string;
  token?: string;
  agentId?: string;
  sessionKey?: string;
  chatPath?: string;
  statusPath?: string;
  telemetryUrl?: string;
  runtimeKind?: string;
  runtimeCapabilities?: unknown;
  collectorCapabilities?: unknown;
  localDataDir?: string;
};

export type AgentCallMachine = {
  id?: string;
  name?: string;
};

export type AgentCallInput = {
  agent: AgentCallIdentity;
  machine?: AgentCallMachine;
};

export type RuntimeAgentVoiceBridge = {
  hubUrl: string;
  agent: AgentCallIdentity;
  machine?: AgentCallMachine;
  voiceRunId?: string;
};

export type AgentCallMode = "byok" | "cloud";

async function gatewayBases(): Promise<string[]> {
  const live: string[] = [];
  for (const gatewayPort of GATEWAY_PORTS) {
    const base = `http://127.0.0.1:${gatewayPort}`;
    try {
      const response = await fetch(`${base}/voice/calls/ring-now`, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(1_200),
      });
      if (response.ok) live.push(base);
    } catch {
      // Try the next known Claw gateway port.
    }
  }
  return live.length ? live : GATEWAY_PORTS.map((gatewayPort) => `http://127.0.0.1:${gatewayPort}`);
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function expandHome(value: string) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function safeLocalPath(root: string, relativePath: string) {
  const base = resolve(expandHome(root));
  const target = resolve(base, relativePath);
  const diff = relative(base, target);
  if (!diff || diff.startsWith("..") || isAbsolute(diff)) return null;
  return target;
}

async function readBoundedAeonFile(root: string, relativePath: string, maxChars: number, options?: { sanitize?: boolean }) {
  const path = safeLocalPath(root, relativePath);
  if (!path) return "";
  const raw = await readFile(path, "utf8").catch(() => "");
  return options?.sanitize === false ? raw.trim().slice(0, maxChars) : sanitizeContextText(raw, maxChars);
}

function sanitizeContextText(raw: string, maxChars: number) {
  return raw
    .split(/\r?\n/)
    .filter((line) => !/(api[_-]?key|token|secret|password|authorization|bearer|private key)/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function frontmatterValue(content: string, key: string) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return match?.[1]?.replace(/^["']|["']$/g, "").trim();
}

function normalizeRepo(value?: string) {
  return String(value || "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function normalizeName(value?: string) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function aeonRepositoryMatches(agent: AgentCallIdentity, repository: string) {
  const deliverableRepo = normalizeRepo(repository);
  const agentRepo = normalizeRepo(agent.aeonRepo);
  if (agentRepo && (agentRepo === deliverableRepo || agentRepo.endsWith(`/${deliverableRepo.split("/").pop()}`))) return true;
  const agentName = normalizeName(agent.aeonRepoName || agent.name);
  const repoName = normalizeName(deliverableRepo.split("/").pop() || deliverableRepo);
  return Boolean(agentName && repoName && (agentName === repoName || agentName.includes(repoName)));
}

function hasAeonRepositoryIdentity(agent: AgentCallIdentity) {
  return Boolean(clean(agent.aeonRepo) || clean(agent.aeonRepoName));
}

function archiveChildPath(archivePath: string, folder: string, file: string) {
  const archive = resolve(archivePath);
  const target = resolve(archive, folder, file);
  const diff = relative(archive, target);
  if (!diff || diff.startsWith("..") || isAbsolute(diff)) return null;
  return target;
}

function sectionText(markdown: string, heading: string) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^## ${escapedHeading}\\s*\\n+([\\s\\S]*?)(?=\\n## |$)`, "m"));
  return sanitizeContextText(match?.[1] ?? "", 500);
}

function unescapeMarkdownCell(value: string) {
  return value.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, " ").trim();
}

function openingLineForBriefing(briefing: string) {
  const match = briefing.match(/\[greeting\]\s*Start the call with exactly:\s*["“](.+?)["”]/i);
  return match?.[1]?.trim() || "Hello Liam, this is your HivemindOS coding agent.";
}

function extractMiroSharkPostTexts(postsMarkdown: string) {
  return postsMarkdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|") && !/^\|\s*-+/.test(line) && !/^\|\s*Post\s*\|/i.test(line))
    .map((line) => line.split(/(?<!\\)\|/).map((part) => part.trim()))
    .map((columns) => unescapeMarkdownCell(columns[4] || ""))
    .filter(Boolean)
    .slice(0, 3);
}

async function readRecentMiroSharkContext(agent: AgentCallIdentity) {
  const archive = await listArchivedMiroSharkRuns().catch(() => null);
  if (!archive) return [];
  const recentRuns: string[] = [];
  for (const summary of archive.runs.slice(0, MIROSHARK_RUN_SCAN_LIMIT)) {
    const rehearsalPath = archiveChildPath(archive.archivePath, summary.folder, "aeon-rehearsal.md");
    const postsPath = archiveChildPath(archive.archivePath, summary.folder, "posts.md");
    if (!rehearsalPath || !postsPath) continue;
    const [rehearsal, postsMarkdown] = await Promise.all([
      readFile(rehearsalPath, "utf8").catch(() => ""),
      readFile(postsPath, "utf8").catch(() => ""),
    ]);
    const repository = frontmatterValue(rehearsal, "aeon_repository");
    if (repository && hasAeonRepositoryIdentity(agent) && !aeonRepositoryMatches(agent, repository)) continue;
    const scenario = sectionText(rehearsal, "Scenario") || sanitizeContextText(summary.scenario || "", 500);
    const verdict = sectionText(rehearsal, "Verdict");
    const nextAction = sectionText(rehearsal, "Next Action");
    const postTexts = extractMiroSharkPostTexts(postsMarkdown)
      .map((post, index) => `${index + 1}. ${sanitizeContextText(post, 300)}`)
      .join("\n");
    recentRuns.push([
      `MiroShark run ${summary.simulationId} saved ${summary.savedAt}.`,
      summary.status ? `Status: ${summary.status}.` : "",
      typeof summary.postCount === "number" ? `Visible posts: ${summary.postCount}.` : "",
      scenario ? `Scenario: ${scenario}` : "",
      verdict ? `AEON verdict: ${verdict}` : "",
      nextAction ? `Next action: ${nextAction}` : "",
      postTexts ? `Post excerpts:\n${postTexts}` : "",
      `Archive folder: ${summary.folder}.`,
    ].filter(Boolean).join("\n"));
    if (recentRuns.length >= RECENT_MIROSHARK_RUN_LIMIT) break;
  }
  return recentRuns.length
    ? [
      "Recent MiroShark deliverables from the shared vault. If Liam asks about recent MiroShark runs, use these details and do not say you lack access:\n\n" +
      recentRuns.join("\n\n"),
    ]
    : [];
}

function inlineFields(raw: string) {
  const fields: Record<string, string | boolean> = {};
  for (const part of raw.split(",")) {
    const match = part.match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "").trim();
    fields[match[1]] = value === "true" ? true : value === "false" ? false : value;
  }
  return fields;
}

function summarizeAeonConfig(raw: string) {
  const model = raw.match(/^model:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim();
  const enabledSkills: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const inline = line.match(/^  ([A-Za-z0-9_-]+):\s*\{(.+?)\}/);
    if (!inline) continue;
    const fields = inlineFields(inline[2]);
    if (fields.enabled === true) {
      const parts = [inline[1]];
      if (typeof fields.var === "string" && fields.var) parts.push(`var=${fields.var}`);
      if (typeof fields.schedule === "string" && fields.schedule) parts.push(`schedule=${fields.schedule}`);
      enabledSkills.push(parts.join(" "));
    }
  }
  return [
    model ? `Default model: ${model}.` : "",
    enabledSkills.length ? `Enabled skills: ${enabledSkills.slice(0, 8).join("; ")}${enabledSkills.length > 8 ? `; +${enabledSkills.length - 8} more` : ""}.` : "No enabled scheduled skills found in aeon.yml.",
  ].filter(Boolean).join(" ");
}

function summarizeSkillsJson(raw: string, preferredSlugs: string[]) {
  try {
    const parsed = JSON.parse(raw) as { skills?: Array<{ slug?: string; name?: string; description?: string; category?: string }> };
    if (!Array.isArray(parsed.skills)) return "";
    const preferred = new Set(preferredSlugs);
    const matching = parsed.skills.filter((skill) => skill.slug && (preferred.size === 0 || preferred.has(skill.slug))).slice(0, 8);
    const selected = matching.length ? matching : parsed.skills.slice(0, 8);
    return selected
      .map((skill) => [skill.slug, skill.category, skill.description].filter(Boolean).join(" - "))
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

async function readAeonContext(agent: AgentCallIdentity) {
  const root = clean(agent.aeonLocalPath) || clean(agent.localDataDir);
  if (!root) return [];
  const preferredSkillSlugs = cleanList(agent.preferredSkillSlugs);
  const [claude, memory, aeonConfigRaw, skillsJson, soul, style, mirosharkContext] = await Promise.all([
    readBoundedAeonFile(root, "CLAUDE.md", 900),
    readBoundedAeonFile(root, "memory/MEMORY.md", 900),
    readBoundedAeonFile(root, "aeon.yml", 8_000, { sanitize: false }),
    readBoundedAeonFile(root, "skills.json", 300_000, { sanitize: false }),
    readBoundedAeonFile(root, "soul/SOUL.md", 700),
    readBoundedAeonFile(root, "soul/STYLE.md", 700),
    readRecentMiroSharkContext(agent),
  ]);
  const aeonConfig = summarizeAeonConfig(aeonConfigRaw);
  const skillSummary = summarizeSkillsJson(skillsJson, preferredSkillSlugs);
  return [
    aeonConfig ? `AEON config: ${aeonConfig}` : "",
    skillSummary ? `AEON skill catalog context:\n${skillSummary}` : "",
    claude ? `AEON agent instructions excerpt:\n${claude}` : "",
    memory ? `AEON memory index excerpt:\n${memory}` : "",
    soul ? `AEON soul excerpt:\n${soul}` : "",
    style ? `AEON style excerpt:\n${style}` : "",
    ...mirosharkContext,
  ].filter(Boolean);
}

async function buildAeonCallBriefing(input: AgentCallInput) {
  const agentName = clean(input.agent.name) || "Aeon";
  const machineName = clean(input.machine?.name);
  const task = clean(input.agent.task);
  const repo = clean(input.agent.aeonRepo);
  const repoName = clean(input.agent.aeonRepoName);
  const branch = clean(input.agent.aeonBranch);
  const mode = clean(input.agent.aeonMode);
  const a2aUrl = clean(input.agent.a2aUrl);
  const localPath = clean(input.agent.aeonLocalPath) || clean(input.agent.localDataDir);
  const preferredSkillSlugs = cleanList(input.agent.preferredSkillSlugs);
  const aeonContext = await readAeonContext(input.agent);
  return [
    `[greeting] Start the call with exactly: "I'm Aeon, variation ${agentName}."`,
    "You are AEON, an autonomous background agent, not a generic HivemindOS phone caller.",
    "Answer as this AEON variation. Be concise, aware of your repo, skills, memory, and current work.",
    "AEON context model: identity comes from CLAUDE.md; persistent context comes from memory/MEMORY.md, memory/topics, logs, and issues; available work comes from aeon.yml schedules/chains and skills.json.",
    repo || repoName ? `Repository: ${[repoName, repo].filter(Boolean).join(" / ")}.` : "",
    branch ? `Branch: ${branch}.` : "",
    mode ? `Mode: ${mode}.` : "",
    a2aUrl ? `A2A endpoint: ${a2aUrl}.` : "",
    localPath ? `Local AEON workspace: ${localPath}.` : "",
    machineName ? `Host machine: ${machineName}.` : "",
    preferredSkillSlugs.length ? `Preferred Hivemind skills: ${preferredSkillSlugs.join(", ")}.` : "",
    clean(input.agent.soulPrompt) ? `Hivemind soul:\n${clean(input.agent.soulPrompt)}` : "",
    clean(input.agent.skillProfilePrompt) ? `Suited for: ${clean(input.agent.skillProfilePrompt)}` : "",
    task ? `Current work: ${task}.` : "",
    ...aeonContext,
    "Conversation rule: use this context to answer Liam's questions directly. Do not volunteer a status update, digest plan, or configuration checklist unless Liam asks for status, setup, or next steps.",
  ].filter(Boolean).join("\n\n");
}

export async function buildAgentCallPayload(input: AgentCallInput): Promise<GatewayCallPayload> {
  const agentName = clean(input.agent.name) || "Hivemind Agent";
  const runtime = clean(input.agent.runtime);
  const role = clean(input.agent.role);
  const task = clean(input.agent.task);
  const machineName = clean(input.machine?.name);
  const isAeon = runtime.toLowerCase() === "aeon";
  const context = [
    `You are ${agentName}, calling Liam from HivemindOS.`,
    runtime || role ? `Agent context: ${[runtime, role].filter(Boolean).join(" / ")}.` : "",
    machineName ? `Machine: ${machineName}.` : "",
    task ? `Current work: ${task}.` : "",
    "Start with a concise status update, then ask what Liam wants to do next.",
  ].filter(Boolean).join("\n");

  return {
    title: agentName,
    briefing: isAeon ? await buildAeonCallBriefing(input) : context,
    returnAfterRoomReady: true,
    voiceProviderId: clean(input.agent.voiceProviderId) || undefined,
    voiceRuntime: clean(input.agent.voiceRuntime) || undefined,
    voiceModelId: clean(input.agent.voiceModelId) || undefined,
    voiceId: clean(input.agent.voiceId) || undefined,
    voiceKeyEnv: clean(input.agent.voiceKeyEnv) || undefined,
  };
}

export function buildRuntimeAgentVoiceBridge(input: AgentCallInput, hubUrl: string, voiceRunId?: string): RuntimeAgentVoiceBridge | undefined {
  const cleanHubUrl = clean(hubUrl).replace(/\/+$/, "");
  if (!cleanHubUrl) return undefined;
  return {
    hubUrl: cleanHubUrl,
    agent: input.agent,
    machine: input.machine,
    ...(voiceRunId ? { voiceRunId } : {}),
  };
}

function voiceRunCallPayload(run: Awaited<ReturnType<typeof createVoiceRun>>) {
  return {
    id: run.id,
    status: run.status,
    recipeId: run.recipeId,
    toolBundleId: run.toolBundleId,
  };
}

async function failVoiceRun(id: string | undefined, reason: string) {
  await completeVoiceRun(id, "failed", reason).catch(() => undefined);
}

async function gatewayJson(path: string, init?: RequestInit): Promise<GatewayCallResult> {
  const bases = await gatewayBases();
  if (bases.length === 0) {
    return { ok: false, error: "Gateway not reachable on 127.0.0.1:5000-5002. Start the claw gateway to ring the phone." };
  }
  let lastFailure: GatewayCallResult | null = null;
  const retryableStatuses = new Set([403, 404, 405]);
  try {
    for (const base of bases) {
      try {
        const response = await fetch(`${base}${path}`, {
          ...init,
          headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
          signal: AbortSignal.timeout(15_000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          const message = (result && typeof result === "object" && "error" in result && typeof result.error === "string")
            ? result.error
            : `Gateway returned HTTP ${response.status}.`;
          lastFailure = { ok: false, gateway: base, result, error: message };
          if (retryableStatuses.has(response.status)) continue;
          return lastFailure;
        }
        return { ok: true, gateway: base, result };
      } catch (error) {
        lastFailure = { ok: false, gateway: base, error: error instanceof Error ? error.message : "Gateway request failed." };
      }
    }
    return lastFailure ?? { ok: false, error: "Gateway request failed." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Gateway request failed." };
  }
}

export async function ringGatewayCall(payload: GatewayCallPayload): Promise<GatewayCallResult> {
  return gatewayJson("/voice/calls/ring-now", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function startInternalAgentCall(
  input: AgentCallInput,
  options: { hubUrl?: string; tokenField: "token" | "dashboardToken"; idPrefix: string },
): Promise<GatewayCallResult> {
  const payload = await buildAgentCallPayload(input);
  const managed = readManagedVoiceConfig();
  const voiceProviders = voiceProvidersFromManagedConfig(managed);
  const resolvedVoice = resolveVoice(payload.voiceProviderId, voiceProviders, managed);
  const voiceRun = await createVoiceRun({
    title: payload.title || clean(input.agent.name) || "Cloud agent call",
    mode: "cloud",
    recipeId: "cloud-multi-agent-room",
    toolBundleId: "agent-call-default",
    agent: input.agent,
    machine: input.machine,
    provider: {
      id: "livekit-cloud-room",
      label: "HivemindOS Cloud Agent Calls",
      model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",
      voice: resolvedVoice?.voice,
      transport: "managed-room",
    },
    initialContext: {
      briefing: payload.briefing || "",
      callMode: "cloud",
      tokenField: options.tokenField,
    },
  });
  const runtimeAgent = options.hubUrl ? buildRuntimeAgentVoiceBridge(input, options.hubUrl, voiceRun.id) : undefined;
  const call = await createInAppCall({
    briefing: payload.briefing || "",
    voice: resolvedVoice,
    callId: voiceRun.id,
    runtimeAgent,
  }, managed);
  if (!call.ok) {
    await failVoiceRun(voiceRun.id, call.reason);
    return {
      ok: false,
      error: call.reason === "livekit_disabled"
        ? `HivemindOS Cloud Agent Calls (LiveKit) are off by default so the setup stays local and private. To opt in, set ${call.missing.join(" and ")} in ~/.hivemindos/.env, then rerun pnpm tauri:dev.`
        : call.reason === "voice_transport_not_configured"
          ? `HivemindOS voice is missing ${call.missing.join(", ")}. Add those keys to ~/.hivemindos/.env, ~/.hivemindos/claw/voice.env, or .env.local, then rerun pnpm tauri:dev.`
          : call.reason,
      result: call,
    };
  }
  await appendVoiceRunEvent(voiceRun.id, {
    type: "call.connected",
    speaker: "system",
    text: `Cloud voice room created: ${call.room}.`,
    payload: { room: call.room },
  }).catch(() => undefined);
  const token = options.tokenField === "dashboardToken" ? call.dashboardToken : call.token;
  return {
    ok: true,
    gateway: "hivemindos",
    result: {
      ok: true,
      call: {
        id: call.room || `${options.idPrefix}_${Date.now()}`,
        callerName: payload.title,
        voiceReady: Boolean(call.livekitUrl && token),
        livekitUrl: call.livekitUrl,
        room: call.room,
        [options.tokenField]: token,
        runtimeAgent,
        voiceRun: voiceRunCallPayload(voiceRun),
      },
      voice: call.voice,
    },
  };
}

export async function startAgentDashboardCall(input: AgentCallInput, hubUrl?: string): Promise<GatewayCallResult> {
  return startAgentByokCall(input, hubUrl || "", "dashboard");
}

async function startAgentByokCall(input: AgentCallInput, hubUrl: string, idPrefix: string): Promise<GatewayCallResult> {
  const payload = await buildAgentCallPayload(input);
  const managed = readManagedVoiceConfig();
  const voiceProviders = voiceProvidersFromManagedConfig(managed);
  if (payload.voiceRuntime === LOCAL_TTS_RUNTIME || isLocalTtsProviderId(payload.voiceProviderId)) {
    const localTts = await resolveLocalTtsCallConfig({
      origin: hubUrl,
      voiceProviderId: payload.voiceProviderId,
      voiceModelId: payload.voiceModelId,
      voiceId: payload.voiceId,
      openingLine: openingLineForBriefing(payload.briefing || ""),
    });
    if (!localTts) {
      return {
        ok: false,
        gateway: "hivemindos",
        error: "Local TTS is selected, but no connected TTS app passed validation. Open Calls settings, refresh, and select a validated TTS server.",
        result: { ok: false, reason: "local_tts_not_validated", missing: [] },
      };
    }
    const voiceRun = await createVoiceRun({
      title: payload.title || clean(input.agent.name) || "Local TTS agent call",
      mode: "local-tts",
      recipeId: "agent-runtime-bridge",
      toolBundleId: "agent-call-default",
      agent: input.agent,
      machine: input.machine,
      provider: {
        id: "local-tts",
        label: localTts.appName || "Local TTS Runtime Bridge",
        model: localTts.model,
        voice: localTts.voice,
        transport: "server-tts",
      },
      initialContext: {
        briefing: payload.briefing || "",
        callMode: "local-tts",
        openingLine: localTts.openingLine,
      },
    });
    const runtimeAgent = buildRuntimeAgentVoiceBridge(input, hubUrl, voiceRun.id);
    return {
      ok: true,
      gateway: "hivemindos",
      result: {
        ok: true,
        call: {
          id: `${idPrefix}_local_tts_${Date.now()}`,
          mode: "local-tts",
          callerName: payload.title,
          voiceReady: true,
          localTts,
          runtimeAgent,
          voiceRun: voiceRunCallPayload(voiceRun),
        },
      },
    };
  }
  if (payload.voiceRuntime === "gemini-live") {
    const geminiModel = normalizeGeminiLiveModel(payload.voiceModelId);
    const geminiVoiceRun = await createVoiceRun({
      title: payload.title || clean(input.agent.name) || "Gemini Live agent call",
      mode: "byok",
      recipeId: "agent-runtime-bridge",
      toolBundleId: "agent-call-default",
      agent: input.agent,
      machine: input.machine,
      provider: {
        id: "gemini-live",
        label: "Gemini Live",
        model: geminiModel,
        voice: clean(payload.voiceId) || undefined,
        transport: "direct-ws",
      },
      initialContext: { briefing: payload.briefing || "", callMode: "gemini-live" },
    });
    const geminiRuntimeAgent = buildRuntimeAgentVoiceBridge(input, hubUrl, geminiVoiceRun.id);
    return {
      ok: true,
      gateway: "hivemindos",
      result: {
        ok: true,
        call: {
          id: `${idPrefix}_gemini_${Date.now()}`,
          mode: "gemini-live",
          callerName: payload.title,
          voiceReady: true,
          geminiLive: {
            provider: "gemini-live",
            model: geminiModel,
            voice: clean(payload.voiceId) || undefined,
            keyEnv: clean(payload.voiceKeyEnv) || undefined,
            instructions: buildByokAgentCallInstructions({ briefing: payload.briefing || "", runtimeAgent: geminiRuntimeAgent }),
            tools: toolsForVoiceToolBundle("agent-call-default"),
          },
          runtimeAgent: geminiRuntimeAgent,
          voiceRun: voiceRunCallPayload(geminiVoiceRun),
        },
      },
    };
  }
  const resolvedVoice = resolveVoice(payload.voiceProviderId, voiceProviders, managed);
  const voiceRun = await createVoiceRun({
    title: payload.title || clean(input.agent.name) || "BYOK agent call",
    mode: "byok",
    recipeId: "agent-runtime-bridge",
    toolBundleId: "agent-call-default",
    agent: input.agent,
    machine: input.machine,
    provider: {
      id: "openai-realtime",
      label: "OpenAI Realtime BYOK",
      model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",
      voice: resolvedVoice?.voice,
      transport: "direct-webrtc",
    },
    initialContext: {
      briefing: payload.briefing || "",
      callMode: "byok",
    },
  });
  const runtimeAgent = buildRuntimeAgentVoiceBridge(input, hubUrl, voiceRun.id);
  const call = await createByokAgentCall({
    briefing: payload.briefing || "",
    voice: resolvedVoice,
    runtimeAgent,
    toolBundleId: voiceRun.toolBundleId,
  });
  if (!call.ok) {
    await failVoiceRun(voiceRun.id, call.reason);
    return {
      ok: false,
      gateway: "hivemindos",
      error: call.reason === "openai_realtime_not_configured"
        ? `BYOK Agent Calls need ${call.missing.join(", ")} in HivemindOS. Add it in HivemindOS env, then try again.`
        : call.reason,
      result: call,
    };
  }
  return {
    ok: true,
    gateway: "hivemindos",
    result: {
      ok: true,
      call: {
        id: `${idPrefix}_byok_${Date.now()}`,
        mode: "byok",
        callerName: payload.title,
        voiceReady: true,
        realtime: {
          provider: "openai-realtime",
          model: call.model,
          voice: call.voice,
          clientSecret: call.clientSecret,
          expiresAt: call.expiresAt,
          instructions: call.instructions,
          tools: call.tools,
        },
        runtimeAgent,
        voiceRun: voiceRunCallPayload(voiceRun),
      },
    },
  };
}

export async function startAgentMobileCall(input: AgentCallInput, hubUrl: string, mode: AgentCallMode = "byok"): Promise<GatewayCallResult> {
  if (mode === "cloud") return startInternalAgentCall(input, { hubUrl, tokenField: "token", idPrefix: "mobile" });
  return startAgentByokCall(input, hubUrl, "mobile");
}

export async function readGatewayVoiceConfig(origin?: string): Promise<GatewayCallResult> {
  const payload = voiceConfigPayload();
  const config = payload.config as Record<string, unknown>;
  const localTtsCandidates = origin ? await discoverLocalTtsCandidates(origin).catch(() => []) : [];
  const localVoiceOptions = localTtsCandidates
    .filter((candidate) => candidate.ok)
    .map((candidate) => ({
      id: candidate.id,
      provider: LOCAL_TTS_RUNTIME,
      voice: candidate.voice,
      model: candidate.model,
      appName: candidate.name,
      machineName: candidate.machineName,
      source: "configured",
    }));
  return {
    ok: true,
    gateway: "hivemindos",
    result: {
      ...payload,
      config: {
        ...config,
        voiceOptions: [...(Array.isArray(config.voiceOptions) ? config.voiceOptions : []), ...localVoiceOptions],
        localTtsCandidates,
      },
    },
  };
}

export async function readGatewayVoiceDeviceStatus(): Promise<GatewayCallResult> {
  return {
    ok: true,
    gateway: "hivemindos",
    result: {
      ok: true,
      count: 0,
      device: null,
      apns: { configured: false, missing: ["HivemindOS in-app agent calls do not require the Claw gateway APNs device registry."] },
    },
  };
}

export function ringStoredPrompt(scriptId: string) {
  return ringGatewayCall({ scriptId });
}

export async function ringAgentCall(input: AgentCallInput) {
  return ringGatewayCall(await buildAgentCallPayload(input));
}
