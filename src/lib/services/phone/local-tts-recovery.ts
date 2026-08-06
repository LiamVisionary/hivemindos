import {
  LOCAL_TTS_PROVIDER_PREFIX,
  appIdFromLocalTtsProviderId,
  manageLocalTtsModel,
  readLocalTtsLaunchCandidates,
  startLocalTtsService,
  type LocalTtsLaunchCandidate,
} from "@/lib/services/phone/local-tts";
import { persistedAppHint } from "@/lib/services/phone/local-tts-app-cache";
import {
  prewarmLocalTts,
  type LocalTtsPrewarmResult,
} from "@/lib/services/phone/local-tts-health";

export type LocalTtsRecoveryStage =
  | "finding-machine"
  | "starting-server"
  | "loading-model"
  | "verifying"
  | "ready"
  | "failed";

export type LocalTtsRecoveryStatus = {
  status: "loading" | "ready" | "failed";
  stage: LocalTtsRecoveryStage;
  message: string;
  updatedAt: number;
};

export type LocalTtsRecoveryInput = {
  origin: string;
  appId: string;
  machineName?: string;
  model: string;
  voice: string;
};

type ModelActionResult = { ok: boolean; message: string };
type StartServiceResult = { ok: boolean; message: string };

export type LocalTtsRecoveryOperations = {
  loadModel: (input: {
    origin: string;
    appId: string;
    model: string;
  }) => Promise<ModelActionResult>;
  listLaunchCandidates: (origin: string) => Promise<LocalTtsLaunchCandidate[]>;
  startService: (input: { collectorUrl: string }) => Promise<StartServiceResult>;
  prewarm: (input: {
    origin: string;
    voiceProviderId: string;
    voiceModelId: string;
    voiceId: string;
  }) => Promise<LocalTtsPrewarmResult>;
  sleep: (ms: number) => Promise<void>;
};

const DEFAULT_OPERATIONS: LocalTtsRecoveryOperations = {
  loadModel: (input) => manageLocalTtsModel({ ...input, action: "load-model" }),
  listLaunchCandidates: (origin) => readLocalTtsLaunchCandidates(origin, []),
  startService: startLocalTtsService,
  prewarm: prewarmLocalTts,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const RECOVERY_RETRY_DELAY_MS = 1_500;
const RECOVERY_ATTEMPTS = 20;
const RECOVERY_STATUS_TTL_MS = 45_000;

function normalizeMachine(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/[^a-z0-9]+/g, "-");
}

function appHost(appId: string) {
  const match = /^(.+):\d+:.+$/.exec(appId.trim());
  return normalizeMachine(match?.[1]);
}

function targetLaunchCandidate(
  input: LocalTtsRecoveryInput,
  candidates: LocalTtsLaunchCandidate[],
) {
  const usable = candidates.filter((candidate) => candidate.online && candidate.canStart);
  const machineHints = [input.machineName, persistedAppHint(input.appId)?.machineName]
    .map(normalizeMachine)
    .filter(Boolean);
  const hostHint = appHost(input.appId);
  const exact = usable.find((candidate) => {
    const machine = normalizeMachine(candidate.machineName);
    return machineHints.some((hint) => machine === hint || machine.includes(hint) || hint.includes(machine))
      || Boolean(hostHint && (machine.includes(hostHint) || hostHint.includes(machine)));
  });
  if (exact) return exact;
  const modelMatches = usable.filter((candidate) => candidate.modelHints.includes(input.model));
  if (modelMatches.length === 1) return modelMatches[0];
  return usable.length === 1 ? usable[0] : null;
}

function status(
  stage: LocalTtsRecoveryStage,
  message: string,
): LocalTtsRecoveryStatus {
  return {
    status: stage === "ready" ? "ready" : stage === "failed" ? "failed" : "loading",
    stage,
    message,
    updatedAt: Date.now(),
  };
}

export async function runLocalTtsRecovery(
  input: LocalTtsRecoveryInput,
  operations: LocalTtsRecoveryOperations = DEFAULT_OPERATIONS,
  onUpdate: (next: LocalTtsRecoveryStatus) => void = () => undefined,
) {
  const update = (stage: LocalTtsRecoveryStage, message: string) => {
    const next = status(stage, message);
    onUpdate(next);
    return next;
  };
  const loadModel = () => operations.loadModel({
    origin: input.origin,
    appId: input.appId,
    model: input.model,
  });

  update("loading-model", `Loading ${input.model || "the selected voice model"}…`);
  let loaded = input.appId ? await loadModel().catch(() => null) : null;
  if (!loaded?.ok) {
    update("finding-machine", "Finding the machine that hosts her voice…");
    const candidates = await operations.listLaunchCandidates(input.origin).catch(() => []);
    const target = targetLaunchCandidate(input, candidates);
    if (!target) {
      return update("failed", "Local voice could not find a single safe machine to start. Replies will stay text-only for now.");
    }
    update("starting-server", `Starting the local voice server on ${target.machineName}…`);
    const started = await operations.startService({ collectorUrl: target.collectorUrl }).catch(() => null);
    if (!started?.ok) {
      return update("failed", started?.message || "Local voice server startup failed. Replies will stay text-only for now.");
    }
    update("loading-model", `Local voice server started. Loading ${input.model || "the selected model"}…`);
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
      loaded = input.appId ? await loadModel().catch(() => null) : null;
      if (loaded?.ok) break;
      await operations.sleep(RECOVERY_RETRY_DELAY_MS);
    }
  }
  if (!loaded?.ok) {
    return update("failed", loaded?.message || "The local voice model did not finish loading. Replies will stay text-only for now.");
  }

  update("verifying", "Voice model loaded. Running a quick readiness check…");
  let warm: LocalTtsPrewarmResult | null = null;
  for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
    warm = await operations.prewarm({
      origin: input.origin,
      voiceProviderId: `${LOCAL_TTS_PROVIDER_PREFIX}${input.appId}`,
      voiceModelId: input.model,
      voiceId: input.voice,
    }).catch(() => null);
    if (warm?.ok) break;
    await operations.sleep(RECOVERY_RETRY_DELAY_MS);
  }
  if (!warm?.ok) {
    return update("failed", warm?.error || "The local voice server started, but its model did not become ready.");
  }
  return update("ready", "Local voice is ready. She’ll speak on the next reply.");
}

const recoveryByVoice = new Map<string, LocalTtsRecoveryStatus>();

function recoveryKey(input: LocalTtsRecoveryInput) {
  return `${input.origin}::${input.model || "default"}::${input.voice || "default"}`;
}

export function readLocalTtsRecoveryStatus(input: LocalTtsRecoveryInput) {
  const key = recoveryKey(input);
  const current = recoveryByVoice.get(key);
  if (!current) return null;
  if (current.status !== "loading" && Date.now() - current.updatedAt > RECOVERY_STATUS_TTL_MS) {
    recoveryByVoice.delete(key);
    return null;
  }
  return current;
}

export function beginLocalTtsRecovery(input: LocalTtsRecoveryInput) {
  const existing = readLocalTtsRecoveryStatus(input);
  if (existing) return existing;
  const key = recoveryKey(input);
  const initial = status("finding-machine", "Local voice server not loaded, loading now…");
  recoveryByVoice.set(key, initial);
  void Promise.resolve().then(() => runLocalTtsRecovery(input, DEFAULT_OPERATIONS, (next) => {
    recoveryByVoice.set(key, next);
  }));
  return initial;
}

export function recoveryInputFromCalls(input: {
  origin: string;
  voiceProviderId?: string;
  voiceModelId?: string;
  voiceId?: string;
}): LocalTtsRecoveryInput {
  const appId = appIdFromLocalTtsProviderId(input.voiceProviderId);
  return {
    origin: input.origin,
    appId,
    machineName: persistedAppHint(appId)?.machineName,
    model: input.voiceModelId?.trim() || "chatterbox-turbo",
    voice: input.voiceId?.trim() || "voice01",
  };
}
