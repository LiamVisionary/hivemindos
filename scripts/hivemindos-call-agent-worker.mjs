import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerOptions, cli, defineAgent, llm, voice } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { RoomEvent } from "@livekit/rtc-node";
import { z } from "zod";

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME || "hivemindos-call-agent";
const NO_ANSWER_TIMEOUT_MS = 90_000;
const DEFAULT_AGENT_TURN_TIMEOUT_MS = 120_000;
const WORKER_PORT = Number(process.env.LIVEKIT_WORKER_PORT) || 8386;
const ENV_FILES = [
  ".env.local",
  join(homedir(), ".hivemindos", ".env"),
  join(homedir(), ".hivemindos", "voice.env"),
  join(homedir(), ".hivemindos", "claw", "voice.env"),
];

const LANGUAGE_LOCK =
  "CRITICAL: Speak only English (US). Phone audio is often noisy or muffled. Never switch languages on your own, and stay in English for the whole call unless the user explicitly asks you to switch languages.";
const TOOL_PROGRESS_INSTRUCTION =
  " When you need to call a tool, briefly tell Liam what you are checking before the tool call, then speak the result when it returns.";

function parseEnvValue(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\n/g, "\n").trim();
  }
  return value.replace(/\s+#.*$/, "").trim();
}

function loadEnvFiles() {
  for (const path of ENV_FILES) {
    let raw = "";
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
      const separator = normalized.indexOf("=");
      const key = normalized.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
      process.env[key] = parseEnvValue(normalized.slice(separator + 1));
    }
  }
}

function missingWorkerEnv() {
  return [
    process.env.LIVEKIT_URL ? "" : "LIVEKIT_URL",
    process.env.LIVEKIT_API_KEY ? "" : "LIVEKIT_API_KEY",
    process.env.LIVEKIT_API_SECRET ? "" : "LIVEKIT_API_SECRET",
    (process.env.OPENAI_REALTIME_KEY || process.env.OPENAI_API_KEY) ? "" : "OPENAI_REALTIME_KEY or OPENAI_API_KEY",
  ].filter(Boolean);
}

function parseMetadata(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function openingLineForBriefing(briefing) {
  const match = String(briefing || "").match(/\[greeting\]\s*Start the call with exactly:\s*["“](.+?)["”]/i);
  return match?.[1]?.trim() || "Hello Liam, this is your HivemindOS coding agent.";
}

function runtimeSessionIdFor(target) {
  const id = target?.agent?.id || target?.agent?.name || "agent";
  return `voice-${id}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

async function askComputerAgent(target, message) {
  const hubUrl = String(target?.hubUrl || "").replace(/\/+$/, "");
  if (!hubUrl) return "The paired HivemindOS hub URL was not provided for this call.";
  const response = await fetch(`${hubUrl}/api/phone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "agent-voice-turn",
      agent: target.agent,
      machine: target.machine,
      message,
      runtimeSessionId: runtimeSessionIdFor(target),
    }),
    signal: AbortSignal.timeout(DEFAULT_AGENT_TURN_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    return data?.error || `The computer agent returned HTTP ${response.status}.`;
  }
  return data?.text?.trim() || "The computer agent completed the request without a spoken response.";
}

function buildHivemindAgentTools(target) {
  const agentName = target?.agent?.name || "the selected computer agent";
  return {
    ask_computer_agent: llm.tool({
      description:
        `Delegate the user's request to ${agentName} on the paired HivemindOS computer. ` +
        "Use this whenever the user asks that computer agent to inspect, change, run, schedule, or answer from its runtime context.",
      parameters: z.object({
        message: z.string().describe("The exact request to send to the computer-side agent runtime."),
      }),
      execute: async ({ message }) => askComputerAgent(target, message),
    }),
  };
}

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    const meta = parseMetadata(ctx.job.metadata ?? "");

    let caller;
    try {
      caller = await Promise.race([
        ctx.waitForParticipant(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("no_answer")), NO_ANSWER_TIMEOUT_MS)),
      ]);
    } catch {
      ctx.shutdown("caller never joined");
      return;
    }

    const realtimeModel = new openai.realtime.RealtimeModel({
      apiKey: meta.apiKey || process.env.OPENAI_REALTIME_KEY || process.env.OPENAI_API_KEY,
      voice: meta.voice || undefined,
      inputAudioTranscription: {
        model: "gpt-4o-mini-transcribe",
        language: "en",
        prompt: "The user is speaking English. Transcribe English words only.",
      },
      turnDetection: {
        type: "semantic_vad",
        eagerness: "high",
        create_response: true,
        interrupt_response: false,
      },
    });
    const session = new voice.AgentSession({ llm: realtimeModel });
    const runtimeAgent = meta.runtimeAgent && typeof meta.runtimeAgent === "object" ? meta.runtimeAgent : null;
    const tools = runtimeAgent ? buildHivemindAgentTools(runtimeAgent) : undefined;
    const openingLine = openingLineForBriefing(meta.briefing);
    const runtimeAgentNote = runtimeAgent
      ? ` You are connected to ${runtimeAgent.agent?.name || "a HivemindOS computer agent"} on ${runtimeAgent.machine?.name || "the paired computer"}. When Liam asks that computer agent to do or answer something, call ask_computer_agent and speak back the result concisely.`
      : "";

    const agent = new voice.Agent({
      instructions:
        "You are a HivemindOS voice bridge for a computer-side coding agent. " +
        LANGUAGE_LOCK +
        ` On the first assistant turn only, say exactly: "${openingLine}" ` +
        "After that first turn, never reintroduce yourself. Answer the user's latest question directly and concisely." +
        TOOL_PROGRESS_INSTRUCTION +
        runtimeAgentNote +
        "\n\nPRIVATE BRIEFING CONTEXT:\n" +
        (meta.briefing || "No briefing was provided."),
      tools,
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === caller.identity || ctx.room.remoteParticipants.size === 0) {
        void session.close().catch(() => {});
        ctx.shutdown("caller left");
      }
    });

    await session.start({ agent, room: ctx.room });
    const openingSpeech = session.generateReply({
      instructions: `Speak in English only. Start now without waiting for the user. Say exactly: "${openingLine}" Then say one short sentence that you are ready to help.`,
    });
    void openingSpeech.waitForPlayout().catch(() => {});
  },
});

loadEnvFiles();
const missing = missingWorkerEnv();
if (missing.length) {
  console.warn(`[hivemindos-call-agent] Voice worker not started; missing ${missing.join(", ")}. Add them to ~/.hivemindos/.env, ~/.hivemindos/claw/voice.env, or .env.local, then rerun pnpm tauri:dev.`);
  process.exit(0);
}

cli.runApp(new WorkerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: AGENT_NAME,
  port: WORKER_PORT,
}));
