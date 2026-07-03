import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";

/**
 * Queen voice brain degradation status: when the configured conversation
 * agent's runtime turn fails and the voice pipeline silently falls back to
 * the OpenAI fallback model, the user must be able to SEE that — otherwise
 * they believe their selected model is answering when it is not (2026-07-03:
 * the proxy auth gate 401'd the internal agent-runtime self-fetch for hours
 * and every turn was served by gpt-4o-mini with zero indication anywhere).
 *
 * This module is node-safe (fs only) — it is imported by voice-turn.ts, which
 * hermetic node suites load directly; the escalation bridge (server-only,
 * messaging deps) is imported lazily inside the failure path.
 */
export type QueenVoiceBrainStatus = {
  degraded: boolean;
  agentId?: string;
  agentName?: string;
  runtime?: string;
  provider?: string;
  model?: string;
  /** The model actually answering while degraded. */
  fallbackModel?: string;
  lastError?: string;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  consecutiveFailures?: number;
};

const STATUS_PATH = path.join(
  homedir(),
  ".hivemindos",
  "cache",
  "queen-voice-brain-status.json",
);

// Re-alert cadence while the degradation persists; the escalation bridge's
// TTL dedupe gates both the vault notification and external channels.
const REALERT_TTL_MS = 6 * 60 * 60 * 1_000;

export async function readQueenVoiceBrainStatus(): Promise<QueenVoiceBrainStatus | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(STATUS_PATH, "utf8"),
    ) as QueenVoiceBrainStatus;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeQueenVoiceBrainStatus(status: QueenVoiceBrainStatus) {
  try {
    await fs.mkdir(path.dirname(STATUS_PATH), { recursive: true });
    await fs.writeFile(STATUS_PATH, JSON.stringify(status, null, 2), "utf8");
  } catch {
    // Status is best-effort telemetry; never break the voice turn.
  }
}

type BrainAgent = {
  id: string;
  name?: string;
  runtime?: string;
  provider?: string;
  model?: string;
};

export async function noteQueenVoiceBrainFailure(input: {
  agent: BrainAgent;
  error: string;
  fallbackModel: string;
  vaultPath?: string | null;
}): Promise<void> {
  const prior = await readQueenVoiceBrainStatus();
  const consecutiveFailures =
    (prior?.degraded && prior.agentId === input.agent.id
      ? prior.consecutiveFailures ?? 0
      : 0) + 1;
  await writeQueenVoiceBrainStatus({
    degraded: true,
    agentId: input.agent.id,
    agentName: input.agent.name,
    runtime: input.agent.runtime,
    provider: input.agent.provider,
    model: input.agent.model,
    fallbackModel: input.fallbackModel,
    lastError: input.error.slice(0, 400),
    lastFailureAt: new Date().toISOString(),
    lastSuccessAt: prior?.lastSuccessAt,
    consecutiveFailures,
  });
  try {
    // Lazy: escalation-notify is server-only and pulls messaging deps that
    // node suites importing voice-turn.ts must never load.
    const { notifyEscalation } = await import(
      "@/lib/services/messaging/escalation-notify"
    );
    const modelLabel =
      [input.agent.provider, input.agent.model].filter(Boolean).join(" / ") ||
      input.agent.runtime ||
      "configured model";
    await notifyEscalation(
      {
        key: `queen-voice-brain:${input.agent.id}`,
        title: "Queen Bee is not using your selected model",
        body: [
          `Voice turns via ${input.agent.name || input.agent.id} (${modelLabel}) are failing: ${input.error.slice(0, 200)}`,
          `Replies are being served by the fallback model (${input.fallbackModel}) instead.`,
          `Failures in a row: ${consecutiveFailures}. Check the agent's provider/model in its settings; the model section there shows this status too.`,
        ].join("\n"),
        severity: "high",
        ttlMs: REALERT_TTL_MS,
        tags: ["queen-voice", "model-access"],
      },
      { vaultPath: input.vaultPath },
    );
  } catch (error) {
    console.warn(
      "[queen-voice] brain degradation alert failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** A successful runtime turn clears the degradation (kept as history fields). */
export async function noteQueenVoiceBrainSuccess(agent: BrainAgent): Promise<void> {
  const prior = await readQueenVoiceBrainStatus();
  if (prior && !prior.degraded && prior.agentId === agent.id) return;
  await writeQueenVoiceBrainStatus({
    degraded: false,
    agentId: agent.id,
    agentName: agent.name,
    runtime: agent.runtime,
    provider: agent.provider,
    model: agent.model,
    lastFailureAt: prior?.lastFailureAt,
    lastError: prior?.lastError,
    lastSuccessAt: new Date().toISOString(),
    consecutiveFailures: 0,
  });
}
