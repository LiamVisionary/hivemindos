#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";

const APP_BASE = process.env.HIVEMINDOS_HARNESS_APP_BASE || "http://127.0.0.1:5022";
const PORT = Number(process.env.HIVEMINDOS_VAD_STT_HARNESS_PORT || 5099);
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const REALTIME_TRANSCRIBE_MODEL = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-realtime-whisper";
const HARNESS_OPENAI_FALLBACK_MODEL = process.env.HIVEMINDOS_HARNESS_OPENAI_MODEL || "gpt-4o-mini";
const HARNESS_TTS_MODEL = process.env.HIVEMINDOS_HARNESS_TTS_MODEL || "";
const HARNESS_TTS_VOICE = process.env.HIVEMINDOS_HARNESS_TTS_VOICE || "";
const HARNESS_TTS_BASE = process.env.HIVEMINDOS_HARNESS_TTS_BASE || "";
const PLAYER_SOURCE_PATH = "src/lib/audio/realtime-pcm-stream-player.ts";
let openRouterInventoryCache = null;
const HARNESS_OPENROUTER_MODEL_PRIORITY = [
  "openai/gpt-4.1-mini",
  "qwen/qwen3-coder:free",
  "openai/gpt-oss-20b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "moonshotai/kimi-k2.6:free",
];

const envFiles = [
  ".env.local",
  join(homedir(), ".hivemindos", ".env"),
  join(homedir(), ".hivemindos", "voice.env"),
  join(homedir(), ".hivemindos", "claw", "voice.env"),
];

function parseEnvValue(raw, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)\\s*$`, "m"));
  if (!match) return "";
  let value = match[1].trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.replace(/\s+#.*$/, "").replaceAll("\0", "").trim();
}

function envValue(key, preferredFilePattern) {
  if (process.env[key]?.trim()) return process.env[key].trim();
  const files = preferredFilePattern
    ? [...envFiles].sort((left, right) => Number(preferredFilePattern.test(right)) - Number(preferredFilePattern.test(left)))
    : envFiles;
  for (const path of files) {
    if (!existsSync(path)) continue;
    const value = parseEnvValue(readFileSync(path, "utf8"), key);
    if (value) return value;
  }
  return "";
}

function openAiKey() {
  return envValue("OPENAI_TRANSCRIBE_KEY")
    || envValue("OPENAI_REALTIME_KEY")
    || envValue("OPENAI_API_KEY", /voice\.env$/)
    || envValue("OPENAI_API_KEY");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function defaultAdaptiveAgent() {
  return {
    id: "hermes-adaptiveagent-ec9dbd",
    name: "AdaptiveAgent",
    runtime: "hermes",
    agentId: "adaptiveagent",
    provider: "openrouter",
    model: "adaptive",
    localDataDir: `${homedir()}/.hermes/profiles/adaptiveagent`,
    runtimeKind: "interactive",
  };
}

function textFromSsePayload(raw) {
  if (!raw || raw === "[DONE]") return "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (raw.includes("\"error\"")) throw new Error(raw.slice(0, 500));
    return "";
  }
  const error = clean(typeof parsed.error === "string" ? parsed.error : parsed.error?.message || parsed.event?.error);
  if (error) throw new Error(error);
  const text = (parsed.choices ?? []).map((choice) => choice.delta?.content || choice.message?.content || "").join("")
    || parsed.event?.delta
    || parsed.event?.content
    || parsed.delta
    || parsed.content
    || parsed.text
    || "";
  if (/^\s*(?:we need|we are asked|the user asked|i need to|let's|first,)/i.test(text)) return "";
  return text;
}

function pullSpeakableSegments(text, force = false) {
  const segments = [];
  let rest = text;
  for (;;) {
    const match = /[.!?。！？](?:\s+|$)|\n{2,}/.exec(rest);
    if (!match) break;
    const end = match.index + match[0].length;
    const segment = rest.slice(0, end).trim();
    if (segment) segments.push(segment);
    rest = rest.slice(end).trimStart();
  }
  if (!force && rest.length > 180) {
    const splitAt = rest.lastIndexOf(" ", 160);
    if (splitAt > 80) {
      const segment = rest.slice(0, splitAt).trim();
      if (segment) segments.push(segment);
      rest = rest.slice(splitAt).trimStart();
    }
  }
  if (force && rest.trim()) {
    segments.push(rest.trim());
    rest = "";
  }
  return { rest, segments };
}

function isUnspeakableVoicePreamble(text) {
  return /^\s*(?:we need|we are asked|the user asked|i need to|let's|first,|the scenario says|the instruction says)/i.test(text);
}

function isFreeOpenRouterModel(model) {
  if (model.id?.endsWith(":free")) return true;
  const pricing = model.pricing ?? {};
  return ["prompt", "completion", "request", "image", "web_search", "internal_reasoning"].every((key) => {
    const value = pricing[key];
    if (value === undefined || value === null || value === "") return true;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric === 0;
  });
}

function openRouterModelScore(model, message) {
  const haystack = `${model.id ?? ""} ${model.name ?? ""} ${model.description ?? ""} ${(model.supported_parameters ?? []).join(" ")}`.toLowerCase();
  const text = message.toLowerCase();
  let score = 0;
  if (/\b(code|repo|debug|typescript|javascript|react|api|test)\b/.test(text) && /code|coder|deepseek|qwen|kimi|agent|tools?/.test(haystack)) score += 40;
  if (/\b(research|compare|summari[sz]e|analysis)\b/.test(text) && /research|search|reason|r1|thinking|analysis/.test(haystack)) score += 34;
  if ((model.supported_parameters ?? []).includes("tools")) score += 10;
  if ((model.supported_parameters ?? []).includes("reasoning")) score += 8;
  if (/qwen|deepseek|kimi|llama|mistral|instruct|latest/.test(haystack)) score += 6;
  return score;
}

async function resolveHarnessAgents(agent, message) {
  if (clean(agent?.provider).toLowerCase() !== "openrouter" || clean(agent?.model).toLowerCase() !== "adaptive") return [agent];
  if (HARNESS_TTS_BASE) {
    console.log(`[runtime] skipping OpenRouter adaptive in realtime harness; using OpenAI ${HARNESS_OPENAI_FALLBACK_MODEL}`);
    return [];
  }
  if (!openRouterInventoryCache) {
    const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=all", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => null);
    openRouterInventoryCache = Array.isArray(data?.data) ? data.data : [];
  }
  const candidates = openRouterInventoryCache
    .filter((model) => model?.id && isFreeOpenRouterModel(model))
    .filter((model) => model.architecture?.input_modalities?.includes("text"))
    .sort((left, right) => openRouterModelScore(right, message) - openRouterModelScore(left, message)
      || ((right.supported_parameters ?? []).includes("tools") ? 1 : 0) - ((left.supported_parameters ?? []).includes("tools") ? 1 : 0)
      || (right.context_length ?? 0) - (left.context_length ?? 0)
      || (right.created ?? 0) - (left.created ?? 0));
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const models = [
    ...HARNESS_OPENROUTER_MODEL_PRIORITY.filter((id) => candidateIds.has(id)),
    ...HARNESS_OPENROUTER_MODEL_PRIORITY.filter((id) => !id.endsWith(":free")),
    ...candidates.map((candidate) => candidate.id).filter((id) => id && !HARNESS_OPENROUTER_MODEL_PRIORITY.includes(id)),
  ].slice(0, 6);
  console.log(`[runtime] resolved openrouter/adaptive candidates -> ${models.join(", ")}`);
  return models.map((model) => ({ ...agent, model, adaptiveOpenRouter: true }));
}

async function json(path, init) {
  const response = await fetch(`${APP_BASE}${path}`, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `${path} returned HTTP ${response.status}`);
  return data;
}

async function bootstrap() {
  if (HARNESS_TTS_BASE && HARNESS_TTS_MODEL && HARNESS_TTS_VOICE) {
    return {
      agent: defaultAdaptiveAgent(),
      machine: { id: "harness-this-mac", name: "This Mac" },
      localTts: {
        provider: "local-tts",
        appId: "harness-direct-local-tts",
        appName: "Local TTS",
        model: HARNESS_TTS_MODEL,
        voice: HARNESS_TTS_VOICE,
        sampleRate: 24000,
        channels: 1,
        sampleFormat: "pcm16",
        openingLine: "Hello Liam, this is your HivemindOS coding agent.",
      },
    };
  }
  const fleet = await json("/api/fleet/discover?includeSnapshots=0&fresh=1");
  const voiceConfig = await json("/api/phone?action=voice-config").catch(() => null);
  const targets = [];
  for (const machine of fleet.machines ?? []) {
    for (const agent of Array.isArray(machine.agents) ? machine.agents : []) {
      if (clean(agent?.id) && clean(agent?.runtime)) targets.push({ machine, agent });
    }
  }
  const target = targets.find(({ agent }) => `${agent.id} ${agent.name} ${agent.agentId ?? ""}`.toLowerCase().includes("adaptiveagent")) ?? targets[0];
  const candidates = voiceConfig?.result?.config?.localTtsCandidates ?? [];
  const candidate = candidates.find((item) => item.ok && item.port === 8799)
    ?? candidates.find((item) => item.ok)
    ?? (HARNESS_TTS_MODEL && HARNESS_TTS_VOICE ? candidates.find((item) => item.port === 8799 || /universal/i.test(`${item.name ?? ""} ${item.appName ?? ""}`)) : null)
    ?? (HARNESS_TTS_BASE && HARNESS_TTS_MODEL && HARNESS_TTS_VOICE ? {
      id: "harness-direct-local-tts",
      appId: "harness-direct-local-tts",
      name: "Local TTS",
      model: HARNESS_TTS_MODEL,
      voice: HARNESS_TTS_VOICE,
      sampleRate: 24000,
      channels: 1,
      sampleFormat: "pcm16",
    } : null);
  if (!target) throw new Error("No HivemindOS agent target was discovered.");
  if (!candidate) throw new Error("No validated Local TTS candidate was discovered.");
  if (HARNESS_TTS_BASE && candidate.appId === "harness-direct-local-tts") {
    return {
      agent: target.agent,
      machine: { id: clean(target.machine.id), name: clean(target.machine.name) },
      localTts: {
        provider: "local-tts",
        appId: candidate.appId,
        appName: candidate.name,
        model: HARNESS_TTS_MODEL,
        voice: HARNESS_TTS_VOICE,
        sampleRate: 24000,
        channels: 1,
        sampleFormat: "pcm16",
        openingLine: "Hello Liam, this is your HivemindOS coding agent.",
      },
    };
  }
  const call = await json("/api/phone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "dashboard-agent-call",
      agent: {
        ...target.agent,
        voiceRuntime: "local-tts",
        voiceProviderId: candidate.id,
        voiceModelId: candidate.model,
        voiceId: candidate.voice,
      },
      machine: { id: clean(target.machine.id), name: clean(target.machine.name) },
    }),
  });
  return {
    agent: target.agent,
    machine: { id: clean(target.machine.id), name: clean(target.machine.name) },
    localTts: call.result?.call?.localTts
      ? {
        ...call.result.call.localTts,
        model: HARNESS_TTS_MODEL || call.result.call.localTts.model,
        voice: HARNESS_TTS_VOICE || call.result.call.localTts.voice,
      }
      : null,
  };
}

async function transcribe(audio) {
  const apiKey = openAiKey();
  if (!apiKey) throw new Error("No OpenAI transcription key was found.");
  const started = Date.now();
  console.log(`[stt] start size=${audio.size} type=${audio.type || "unknown"} model=${TRANSCRIBE_MODEL}`);
  const form = new FormData();
  form.set("file", audio, audio.name || "utterance.webm");
  form.set("model", TRANSCRIBE_MODEL);
  form.set("language", "en");
  form.set("response_format", "json");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Whisper returned HTTP ${response.status}`);
  const text = clean(data?.text);
  if (!text) throw new Error("Whisper returned an empty transcript.");
  console.log(`[stt] done elapsed=${Date.now() - started}ms text=${JSON.stringify(text.slice(0, 120))}`);
  return { text, elapsedMs: Date.now() - started };
}

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function bridgeRealtimeStt(client) {
  const apiKey = openAiKey();
  if (!apiKey) {
    sendJson(client, { type: "error", error: "No OpenAI transcription key was found." });
    client.close();
    return;
  }
  const started = Date.now();
  const pendingAudio = [];
  let openaiReady = false;
  let committed = false;
  const upstream = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const closeBoth = () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
  };
  const appendAudio = (data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!buffer.byteLength) return;
    if (!openaiReady) {
      pendingAudio.push(buffer);
      return;
    }
    upstream.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: buffer.toString("base64"),
    }));
  };
  upstream.on("open", () => {
    upstream.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: REALTIME_TRANSCRIBE_MODEL,
              language: "en",
              delay: "minimal",
            },
            turn_detection: null,
          },
        },
      },
    }));
  });
  upstream.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (event.type === "session.updated") {
      openaiReady = true;
      sendJson(client, { type: "ready", model: REALTIME_TRANSCRIBE_MODEL });
      for (const chunk of pendingAudio.splice(0)) appendAudio(chunk);
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      sendJson(client, { type: "delta", delta: clean(event.delta) });
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = clean(event.transcript);
      console.log(`[stt:rt] done elapsed=${Date.now() - started}ms transcript=${JSON.stringify(transcript.slice(0, 120))}`);
      sendJson(client, { type: "final", transcript, elapsedMs: Date.now() - started });
      closeBoth();
      return;
    }
    if (event.type === "error") {
      const message = event.error?.message || "Realtime STT returned an error.";
      console.log(`[stt:rt] error ${message}`);
      sendJson(client, { type: "error", error: message });
      closeBoth();
    }
  });
  upstream.on("error", (error) => {
    sendJson(client, { type: "error", error: error.message });
    closeBoth();
  });
  upstream.on("close", () => {
    if (!committed) sendJson(client, { type: "closed" });
  });
  client.on("message", (data, isBinary) => {
    if (isBinary) {
      appendAudio(data);
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (message.type === "commit" && upstream.readyState === WebSocket.OPEN) {
      committed = true;
      console.log(`[stt:rt] commit elapsed=${Date.now() - started}ms queued=${pendingAudio.length}`);
      upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
    if (message.type === "cancel") closeBoth();
  });
  client.on("close", closeBoth);
  client.on("error", closeBoth);
}

async function* runtimeTextForAgent(agent, message, runtimeSessionId) {
  const response = await fetch(`${APP_BASE}/api/chat/agent-runtime`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent,
      messages: [
        {
          role: "system",
          content: "You are speaking on a live phone call. Reply directly in one or two short spoken sentences. Do not explain your reasoning, quote instructions, mention providers, or include preambles.",
        },
        { role: "user", content: message },
      ],
      runtimeSessionId,
      agentMode: "act",
      latencyMode: "voice",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error(`Runtime returned HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      const chunk = textFromSsePayload(data);
      if (chunk) yield chunk;
    }
  }
}

async function* runtimeText(agent, message, runtimeSessionId) {
  const agents = await resolveHarnessAgents(agent, message);
  let lastError = null;
  for (const [index, candidate] of agents.entries()) {
    try {
      if (index > 0) console.log(`[runtime] retrying with ${candidate.model || candidate.runtime}`);
      const candidateChunks = [];
      for await (const chunk of runtimeTextForAgent(candidate, message, `${runtimeSessionId}_${index}`)) {
        candidateChunks.push(chunk);
      }
      if (candidateChunks.length) {
        for (const chunk of candidateChunks) yield chunk;
        return;
      }
      lastError = new Error(`${candidate.model || candidate.runtime} returned no text.`);
    } catch (error) {
      lastError = error;
      const messageText = error instanceof Error ? error.message : String(error);
      console.log(`[runtime] ${candidate.model || candidate.runtime} failed: ${messageText}`);
      if (/free models are currently rate-limited|out of promo capacity/i.test(messageText)) break;
      if (!/rate-limited|promo capacity|invalid model|returned no text|without returning any text|timeout|aborted|capacity/i.test(messageText)) throw error;
    }
  }
  const apiKey = openAiKey();
  if (!apiKey) throw lastError || new Error("Runtime returned no text.");
  console.log(`[runtime] falling back to OpenAI ${HARNESS_OPENAI_FALLBACK_MODEL}`);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HARNESS_OPENAI_FALLBACK_MODEL,
      messages: [
        {
          role: "system",
          content: "You are speaking on a live phone call. Reply directly in one or two short spoken sentences. Do not explain your reasoning, quote instructions, mention providers, or include preambles.",
        },
        { role: "user", content: message },
      ],
      stream: true,
      max_tokens: 80,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || `OpenAI fallback returned HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      const chunk = textFromSsePayload(data);
      if (chunk) yield chunk;
    }
  }
}

async function ttsStream(localTts, text) {
  if (HARNESS_TTS_BASE) {
    const response = await fetch(`${HARNESS_TTS_BASE.replace(/\/+$/, "")}/v1/audio/speech-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: localTts.model,
        voice: localTts.voice,
        input: text,
        response_format: "pcm",
        sample_rate: localTts.sampleRate || 24000,
        stream_frame_ms: Number(localTts.streamFrameMs || process.env.HIVEMINDOS_HARNESS_TTS_FRAME_MS || 40),
        realtime_pacing: true,
        smooth_join_ms: 8,
        lowpass_hz: 7000,
        language: "English",
        utterance_id: `harness_direct_${Date.now()}`,
      }),
    });
    if (!response.ok || !response.body) throw new Error(`Local TTS returned HTTP ${response.status}`);
    return response;
  }
  const response = await fetch(`${APP_BASE}/api/phone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "local-tts-speech-stream",
      localTts,
      input: text,
      utteranceId: `harness_${Date.now()}`,
    }),
  });
  if (!response.ok || !response.body) throw new Error(`Local TTS returned HTTP ${response.status}`);
  return response;
}

function html() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Local TTS VAD/STT Harness</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #07111f; color: #f8fafc; min-height: 100vh; display: grid; place-items: center; }
    main { width: min(760px, calc(100vw - 32px)); display: grid; gap: 16px; }
    button { border: 1px solid rgba(94,234,212,.55); border-radius: 8px; background: rgba(20,184,166,.18); color: #f8fafc; padding: 12px 14px; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: .45; cursor: wait; }
    pre, .panel { border: 1px solid rgba(148,163,184,.25); border-radius: 8px; background: rgba(15,23,42,.78); padding: 14px; white-space: pre-wrap; }
    .meter { height: 16px; border-radius: 999px; background: #0f172a; overflow: hidden; border: 1px solid rgba(148,163,184,.22); }
    .bar { height: 100%; width: 0%; background: linear-gradient(90deg,#2dd4bf,#facc15); }
  </style>
</head>
<body>
  <main>
    <h1>Local TTS VAD/STT Harness</h1>
    <button id="start">Start Call</button>
    <button id="playersmoke" type="button">Player Smoke</button>
    <button id="wavtest" type="button">WAV 24k</button>
    <button id="wav40test" type="button">WAV 40ms</button>
    <button id="wav48test" type="button">WAV 48k</button>
    <button id="wavlowtest" type="button">WAV 48k Low-pass</button>
    <button id="wavalice" type="button">WAV Alice</button>
    <button id="wavvibe" type="button">WAV VibeVoice</button>
    <button id="wavsine" type="button">WAV Sine Control</button>
    <div class="meter"><div id="bar" class="bar"></div></div>
    <div id="status" class="panel">Idle</div>
    <small>player: shared AudioWorklet PCM stream</small>
    <pre id="log"></pre>
  </main>
  <script type="module">
    import { playRealtimePcmStream } from "/realtime-pcm-stream-player.js";

    const startButton = document.getElementById('start');
    const playerSmokeButton = document.getElementById('playersmoke');
    const wavTestButton = document.getElementById('wavtest');
    const wav40TestButton = document.getElementById('wav40test');
    const wav48TestButton = document.getElementById('wav48test');
    const wavLowTestButton = document.getElementById('wavlowtest');
    const wavAliceButton = document.getElementById('wavalice');
    const wavVibeButton = document.getElementById('wavvibe');
    const wavSineButton = document.getElementById('wavsine');
    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');
    const bar = document.getElementById('bar');
    let cfg, stream, ctx, analyser, source, processor, silentGain, raf = 0, noise = 0.012, speechAt = 0, lastSpeechAt = 0, busy = false, listening = false, sttSocket = null, activeCommit = null;
    let callActive = false, listenLoopRunning = false, currentTurnAbort = null;
    let cachedAck = null;
    const log = (line) => { logEl.textContent += line + '\\n'; };
    async function bootstrap() {
      statusEl.textContent = 'Discovering AdaptiveAgent + Local TTS...';
      const r = await fetch('/api/bootstrap');
      cfg = await r.json();
      if (!r.ok) throw new Error(cfg.error || 'Bootstrap failed');
      log('Agent: ' + (cfg.agent.name || cfg.agent.id));
      log('TTS: ' + cfg.localTts.appName + ' / ' + cfg.localTts.model + ' / ' + cfg.localTts.voice);
    }
    function stopVad() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try { if (processor) processor.disconnect(); } catch {}
      try { if (source) source.disconnect(); } catch {}
      try { if (analyser) analyser.disconnect(); } catch {}
      try { if (silentGain) silentGain.disconnect(); } catch {}
      processor = null;
      source = null;
      analyser = null;
      silentGain = null;
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      bar.style.width = '0%';
    }
    function closeSttSocket() {
      const socket = sttSocket;
      sttSocket = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try { socket.close(); } catch {}
      }
    }
    function stopCall() {
      callActive = false;
      listening = false;
      activeCommit = null;
      currentTurnAbort?.abort();
      currentTurnAbort = null;
      stopVad();
      closeSttSocket();
      startButton.disabled = false;
      startButton.textContent = 'Start Call';
      statusEl.textContent = 'Call stopped.';
    }
    function resampleToPcm16(input, inputRate, outputRate) {
      const ratio = inputRate / outputRate;
      const length = Math.floor(input.length / ratio);
      const pcm = new Int16Array(length);
      for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] || 0));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return pcm;
    }
    async function prepareAck() {
      if (cachedAck || !cfg?.localTts) return;
      try {
        const r = await fetch('/api/ack', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: cfg, input: 'Got it.' }),
        });
        if (!r.ok) throw new Error(await r.text());
        cachedAck = {
          bytes: await r.arrayBuffer(),
          headers: {
            'content-type': r.headers.get('content-type') || 'audio/pcm',
            'x-audio-sample-rate': r.headers.get('x-audio-sample-rate') || '24000',
            'x-audio-channels': r.headers.get('x-audio-channels') || '1',
            'x-audio-sample-format': r.headers.get('x-audio-sample-format') || 'pcm16',
          },
        };
        log('Cached first-response audio: ' + Math.round(cachedAck.bytes.byteLength / 1024) + ' KB');
      } catch (error) {
        log('Ack cache skipped: ' + (error.message || error));
      }
    }
    function playAck() {
      if (!cachedAck) return;
      const response = new Response(cachedAck.bytes.slice(0), { headers: cachedAck.headers });
      void playPcm(response, Date.now()).catch((error) => log('Ack playback error: ' + (error.message || error)));
    }
    function waitForTranscript() {
      return new Promise((resolve, reject) => {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        sttSocket = new WebSocket(protocol + '//' + location.host + '/api/stt-stream');
        sttSocket.binaryType = 'arraybuffer';
        let partial = '';
        let endedAt = 0;
        let committed = false;
        let transcriptQuietTimer = 0;
        const finishListening = () => {
          listening = false;
          activeCommit = null;
          startButton.textContent = callActive ? 'Ending turn...' : 'Start Call';
        };
        const commitTranscript = (reason) => {
          if (committed) return;
          committed = true;
          if (transcriptQuietTimer) window.clearTimeout(transcriptQuietTimer);
          endedAt = Date.now();
          stopVad();
          statusEl.textContent = reason === 'manual' ? 'Sending transcript...' : 'Speech ended. Finalizing transcript...';
          if (sttSocket && sttSocket.readyState === WebSocket.OPEN) sttSocket.send(JSON.stringify({ type: 'commit' }));
        };
        activeCommit = commitTranscript;
        sttSocket.onopen = () => { statusEl.textContent = 'Opening streaming STT...'; };
        sttSocket.onmessage = (event) => {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === 'ready') {
            statusEl.textContent = 'Streaming STT ready. Speak now.';
            listening = true;
            startButton.disabled = false;
            startButton.textContent = 'Stop / Send';
            startPcmCapture(() => sttSocket && sttSocket.readyState === WebSocket.OPEN, (pcm) => sttSocket.send(pcm.buffer), () => {
              commitTranscript('vad');
            });
          }
          if (message.type === 'delta' && message.delta) {
            partial += message.delta;
            statusEl.textContent = 'Hearing: ' + partial;
            if (!committed) {
              if (transcriptQuietTimer) window.clearTimeout(transcriptQuietTimer);
              transcriptQuietTimer = window.setTimeout(() => commitTranscript('transcript_silence'), 1300);
            }
          }
          if (message.type === 'final') {
            finishListening();
            if (transcriptQuietTimer) window.clearTimeout(transcriptQuietTimer);
            const transcript = (message.transcript || partial).trim();
            if (!transcript) reject(new Error('Realtime STT returned an empty transcript.'));
            else resolve({ transcript, endedAt: endedAt || Date.now(), sttElapsedMs: message.elapsedMs || 0 });
          }
          if (message.type === 'error') {
            finishListening();
            reject(new Error(message.error || 'Realtime STT failed.'));
          }
        };
        sttSocket.onerror = () => {
          finishListening();
          reject(new Error('Realtime STT websocket failed.'));
        };
        sttSocket.onclose = () => {
          if (committed) return;
          finishListening();
          reject(new Error(callActive ? 'Realtime STT websocket closed before a transcript.' : 'Call stopped.'));
        };
      });
    }
    function startPcmCapture(canSend, sendPcm, onSpeechEnd) {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(4096, 1, 1);
      silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      source.connect(analyser);
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);
      let speechEnded = false;
      processor.onaudioprocess = (event) => {
        if (!canSend() || speechEnded) return;
        const pcm = resampleToPcm16(event.inputBuffer.getChannelData(0), ctx.sampleRate, 24000);
        if (pcm.byteLength) sendPcm(pcm);
      };
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) { const n = (s - 128) / 128; sum += n*n; }
        const rms = Math.sqrt(sum / samples.length);
        if (rms < Math.max(0.018, noise * 3.0)) noise = noise * .96 + rms * .04;
        const threshold = Math.max(0.018, noise * 3.0);
        const speaking = rms >= threshold;
        const now = performance.now();
        bar.style.width = Math.min(100, Math.round((rms / threshold) * 70)) + '%';
        if (speaking) { if (!speechAt) speechAt = now; lastSpeechAt = now; statusEl.textContent = 'Speech detected...'; }
        const utteranceMs = speechAt ? now - speechAt : 0;
        const silenceMs = lastSpeechAt ? now - lastSpeechAt : 0;
        if ((speechAt && utteranceMs > 250 && silenceMs > 550) || utteranceMs > 15000) {
          speechEnded = true;
          stopVad();
          onSpeechEnd();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    async function sendTextTurn(transcript, endedAt) {
      busy = true;
      startButton.disabled = true;
      statusEl.textContent = 'AdaptiveAgent is preparing the reply...';
      const started = Date.now();
      currentTurnAbort = new AbortController();
      const r = await fetch('/api/text-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: cfg, message: transcript }),
        signal: currentTurnAbort.signal,
      });
      log('You: ' + transcript);
      statusEl.textContent = 'Playing streamed reply...';
      if (!r.ok) throw new Error(await r.text());
      const timing = await playPcm(r, started, currentTurnAbort.signal);
      log('First audio after transcript: ' + timing.firstAudioMs + 'ms');
      log('First audio after speech end: ' + (endedAt && timing.firstAudioAt ? timing.firstAudioAt - endedAt : timing.firstAudioMs) + 'ms');
      currentTurnAbort = null;
      busy = false;
      startButton.disabled = false;
      startButton.textContent = callActive ? 'Stop / Send' : 'Start Call';
      statusEl.textContent = callActive ? 'Listening again...' : 'Ready.';
    }
    async function playerSmoke() {
      playerSmokeButton.disabled = true;
      statusEl.textContent = 'Running shared player smoke...';
      try {
        const started = Date.now();
        log('Player smoke: fetching paced PCM stream...');
        const response = await fetch('/api/player-smoke-stream?ts=' + started);
        if (!response.ok) throw new Error(await response.text());
        log('Player smoke: playing through shared AudioWorklet player...');
        const timing = await playPcm(response, started);
        log('Player smoke first audio: ' + timing.firstAudioMs + 'ms');
        log('Player smoke underruns: ' + timing.underruns + ' / ' + timing.underrunMs + 'ms');
        statusEl.textContent = 'Player smoke complete.';
      } catch (error) {
        statusEl.textContent = error.message || String(error);
        log('Player smoke error: ' + (error.message || error));
      } finally {
        playerSmokeButton.disabled = false;
      }
    }
    async function playPcm(response, started, signal) {
      return await playRealtimePcmStream(response, {
        startedAt: started,
        channels: Number(response.headers.get('x-audio-channels')) || 1,
        sampleRate: Number(response.headers.get('x-audio-sample-rate')) || 24000,
        startBufferMs: 520,
        maxBufferMs: 2000,
        signal,
        onFirstByte: (elapsedMs) => log('First PCM byte: ' + Math.round(elapsedMs) + 'ms'),
        onUnderrun: (event) => log('PCM underrun #' + event.underruns + ' buffered=' + event.bufferedMs + 'ms'),
      });
    }
    async function listenOnce() {
      if (!cfg) await bootstrap();
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      startButton.disabled = true;
      speechAt = 0; lastSpeechAt = 0; noise = 0.012;
      const stt = await waitForTranscript();
      log('STT finalized: ' + stt.sttElapsedMs + 'ms');
      await sendTextTurn(stt.transcript, stt.endedAt);
    }
    async function runCallLoop() {
      if (listenLoopRunning) return;
      listenLoopRunning = true;
      callActive = true;
      startButton.disabled = true;
      startButton.textContent = 'Starting...';
      try {
        while (callActive) await listenOnce();
      } catch (error) {
        if (callActive) {
          statusEl.textContent = error.message || String(error);
          log('ERROR: ' + (error.message || error));
        }
      } finally {
        listenLoopRunning = false;
        busy = false;
        listening = false;
        activeCommit = null;
        currentTurnAbort = null;
        stopVad();
        closeSttSocket();
        startButton.disabled = false;
        startButton.textContent = callActive ? 'Start Call' : 'Start Call';
        if (!callActive) statusEl.textContent = 'Call stopped.';
        callActive = false;
      }
    }
    startButton.onclick = () => {
      if (listening && activeCommit) {
        activeCommit('manual');
        return;
      }
      if (callActive || busy) {
        stopCall();
        return;
      }
      void runCallLoop();
    };
    playerSmokeButton.onclick = () => { void playerSmoke(); };
    async function playDiagnostic(path, button) {
      button.disabled = true;
      statusEl.textContent = 'Rendering WAV diagnostic ' + path + '...';
      try {
        const audio = new Audio(path + '&ts=' + Date.now());
        audio.oncanplaythrough = () => { statusEl.textContent = 'Playing WAV diagnostic...'; };
        audio.onended = () => { statusEl.textContent = 'Ready.'; button.disabled = false; };
        audio.onerror = () => { statusEl.textContent = 'WAV diagnostic failed.'; button.disabled = false; };
        await audio.play();
      } catch (error) {
        statusEl.textContent = error.message || String(error);
        button.disabled = false;
      }
    }
    wavTestButton.onclick = () => playDiagnostic('/api/wav-test?mode=24k', wavTestButton);
    wav40TestButton.onclick = () => playDiagnostic('/api/wav-test?mode=24k&frame=40', wav40TestButton);
    wav48TestButton.onclick = () => playDiagnostic('/api/wav-test?mode=48k', wav48TestButton);
    wavLowTestButton.onclick = () => playDiagnostic('/api/wav-test?mode=lowpass', wavLowTestButton);
    wavAliceButton.onclick = () => playDiagnostic('/api/wav-test?mode=48k&voice=Alice.wav', wavAliceButton);
    wavVibeButton.onclick = () => playDiagnostic('/api/wav-test?mode=48k&model=vibevoice-coreml-0.5b&voice=liam-default', wavVibeButton);
    wavSineButton.onclick = () => playDiagnostic('/api/sine-test', wavSineButton);
  </script>
</body>
</html>`;
}

async function handleAudioTurn(request) {
  const form = await request.formData();
  const cfg = JSON.parse(form.get("config") || "{}");
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new Error("Missing audio blob.");
  console.log(`[turn] audio received size=${audio.size} type=${audio.type || "unknown"}`);
  const started = Date.now();
  const stt = await transcribe(audio);
  console.log(`[turn] runtime start transcript=${JSON.stringify(stt.text.slice(0, 120))}`);
  let pending = "";
  let firstAudioMs = 0;
  const stream = new ReadableStream({
    async start(controller) {
      async function speak(segment) {
        console.log(`[tts] segment=${JSON.stringify(segment.slice(0, 120))}`);
        if (isUnspeakableVoicePreamble(segment)) return;
        const tts = await ttsStream(cfg.localTts, segment);
        const reader = tts.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            if (!firstAudioMs) firstAudioMs = Date.now() - started;
            controller.enqueue(value);
          }
        }
      }
      try {
        for await (const chunk of runtimeText(cfg.agent, stt.text, `harness_${Date.now()}`)) {
          pending += chunk;
          const pulled = pullSpeakableSegments(pending);
          pending = pulled.rest;
          for (const segment of pulled.segments) await speak(segment);
        }
        const pulled = pullSpeakableSegments(pending, true);
        for (const segment of pulled.segments) await speak(segment);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "audio/pcm",
      "cache-control": "no-store",
      "x-audio-sample-rate": String(cfg.localTts?.sampleRate || 24000),
      "x-audio-channels": String(cfg.localTts?.channels || 1),
      "x-audio-sample-format": cfg.localTts?.sampleFormat || "pcm16",
      "x-transcript": encodeURIComponent(stt.text),
      "x-stt-ms": String(stt.elapsedMs),
    },
  });
}

async function handleTextTurn(request) {
  const payload = await request.json();
  const cfg = payload?.config && typeof payload.config === "object" ? payload.config : {};
  const message = clean(payload?.message);
  if (!message) throw new Error("Missing transcript text.");
  const started = Date.now();
  console.log(`[turn:text] runtime start transcript=${JSON.stringify(message.slice(0, 120))}`);
  let pending = "";
  let firstAudioMs = 0;
  const stream = new ReadableStream({
    async start(controller) {
      async function speak(segment) {
        console.log(`[tts] segment=${JSON.stringify(segment.slice(0, 120))}`);
        if (isUnspeakableVoicePreamble(segment)) return;
        const tts = await ttsStream(cfg.localTts, segment);
        const reader = tts.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            if (!firstAudioMs) firstAudioMs = Date.now() - started;
            controller.enqueue(value);
          }
        }
      }
      try {
        for await (const chunk of runtimeText(cfg.agent, message, `harness_${Date.now()}`)) {
          pending += chunk;
          const pulled = pullSpeakableSegments(pending);
          pending = pulled.rest;
          for (const segment of pulled.segments) await speak(segment);
        }
        const pulled = pullSpeakableSegments(pending, true);
        for (const segment of pulled.segments) await speak(segment);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "audio/pcm",
      "cache-control": "no-store",
      "x-audio-sample-rate": String(cfg.localTts?.sampleRate || 24000),
      "x-audio-channels": String(cfg.localTts?.channels || 1),
      "x-audio-sample-format": cfg.localTts?.sampleFormat || "pcm16",
      "x-transcript": encodeURIComponent(message),
    },
  });
}

async function handleAck(request) {
  const payload = await request.json();
  const cfg = payload?.config && typeof payload.config === "object" ? payload.config : {};
  const input = clean(payload?.input) || "Got it.";
  const tts = await ttsStream(cfg.localTts, input);
  const chunks = [];
  const reader = tts.body.getReader();
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, {
    headers: {
      "content-type": "audio/pcm",
      "cache-control": "no-store",
      "x-audio-sample-rate": String(cfg.localTts?.sampleRate || 24000),
      "x-audio-channels": String(cfg.localTts?.channels || 1),
      "x-audio-sample-format": cfg.localTts?.sampleFormat || "pcm16",
    },
  });
}

function wavHeader(dataBytes, sampleRate = 24000, channels = 1) {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i++) header[offset + i] = value.charCodeAt(i);
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

function pcmBytesToInt16(bytes) {
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function int16ToBytes(samples) {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

function resampleMonoLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return new Int16Array(samples);
  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const frac = pos - left;
    const a = samples[left] || 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] || a;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

function lowpassMono(samples, sampleRate, cutoffHz = 8500) {
  const out = new Int16Array(samples.length);
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += alpha * (samples[i] - y);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(y)));
  }
  return out;
}

async function handleWavTest(request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") || "24k";
  const localTts = {
    model: clean(params.get("model")) || HARNESS_TTS_MODEL || "chatterbox-turbo",
    voice: clean(params.get("voice")) || HARNESS_TTS_VOICE || "voice01",
    sampleRate: 24000,
    streamFrameMs: Number(params.get("frame")) || Number(process.env.HIVEMINDOS_HARNESS_TTS_FRAME_MS || 20),
  };
  const text = `This is a clean single request WAV diagnostic using ${localTts.model} and ${localTts.voice}. If you hear crackle here, it is in that source voice or output path.`;
  const tts = await ttsStream(localTts, text);
  const chunks = [];
  const reader = tts.body.getReader();
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const pcmBytes = new Uint8Array(total);
  let rawOffset = 0;
  for (const chunk of chunks) {
    pcmBytes.set(chunk, rawOffset);
    rawOffset += chunk.byteLength;
  }
  let sampleRate = 24000;
  let pcm = pcmBytesToInt16(pcmBytes);
  if (mode === "48k" || mode === "lowpass") {
    pcm = resampleMonoLinear(pcm, 24000, 48000);
    sampleRate = 48000;
  }
  if (mode === "lowpass") pcm = lowpassMono(pcm, sampleRate);
  const payload = int16ToBytes(pcm);
  const bytes = new Uint8Array(44 + payload.byteLength);
  bytes.set(wavHeader(payload.byteLength, sampleRate), 0);
  bytes.set(payload, 44);
  return new Response(bytes, {
    headers: {
      "content-type": "audio/wav",
      "cache-control": "no-store",
      "x-diagnostic-mode": mode,
      "x-audio-sample-rate": String(sampleRate),
    },
  });
}

async function handleSineTest() {
  const sampleRate = 48000;
  const seconds = 4;
  const samples = new Int16Array(sampleRate * seconds);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / 1200, (samples.length - i - 1) / 1200);
    samples[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * 8000 * Math.max(0, envelope));
  }
  const payload = int16ToBytes(samples);
  const bytes = new Uint8Array(44 + payload.byteLength);
  bytes.set(wavHeader(payload.byteLength, sampleRate), 0);
  bytes.set(payload, 44);
  return new Response(bytes, {
    headers: {
      "content-type": "audio/wav",
      "cache-control": "no-store",
      "x-diagnostic-mode": "sine",
      "x-audio-sample-rate": String(sampleRate),
    },
  });
}

function handlePlayerSmokeStream() {
  const sampleRate = 24_000;
  const frameMs = 40;
  const frameSamples = Math.floor(sampleRate * frameMs / 1000);
  const totalSamples = sampleRate * 3;
  let generated = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (generated >= totalSamples) {
        controller.close();
        return;
      }
      const samples = Math.min(frameSamples, totalSamples - generated);
      const bytes = new Uint8Array(samples * 2);
      const view = new DataView(bytes.buffer);
      for (let index = 0; index < samples; index += 1) {
        const envelope = Math.min(1, generated / 960, (totalSamples - generated) / 960);
        const sample = Math.sin(2 * Math.PI * 440 * generated / sampleRate) * 0.22 * Math.max(0, envelope);
        view.setInt16(index * 2, Math.round(sample * 32767), true);
        generated += 1;
      }
      controller.enqueue(bytes);
      await new Promise((resolve) => setTimeout(resolve, frameMs));
    },
  }), {
    headers: {
      "content-type": "audio/pcm",
      "cache-control": "no-store",
      "x-audio-sample-rate": String(sampleRate),
      "x-audio-channels": "1",
      "x-audio-sample-format": "pcm16",
      "x-diagnostic-mode": "player-smoke-stream",
    },
  });
}

async function toWebRequest(req) {
  return new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req),
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
  });
}

async function playerModuleResponse() {
  const ts = await import("typescript");
  const source = readFileSync(join(process.cwd(), PLAYER_SOURCE_PATH), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: PLAYER_SOURCE_PATH,
  });
  return new Response(transpiled.outputText, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const server = createServer(async (req, res) => {
  try {
    const request = await toWebRequest(req);
    const url = new URL(request.url);
    let response;
    if (url.pathname === "/") {
      response = new Response(html(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    } else if (url.pathname === "/realtime-pcm-stream-player.js") {
      response = await playerModuleResponse();
    } else if (url.pathname === "/api/bootstrap") {
      response = Response.json(await bootstrap());
    } else if (url.pathname === "/api/audio-turn" && request.method === "POST") {
      response = await handleAudioTurn(request);
    } else if (url.pathname === "/api/text-turn" && request.method === "POST") {
      response = await handleTextTurn(request);
    } else if (url.pathname === "/api/ack" && request.method === "POST") {
      response = await handleAck(request);
    } else if (url.pathname === "/api/wav-test") {
      response = await handleWavTest(request);
    } else if (url.pathname === "/api/sine-test") {
      response = await handleSineTest();
    } else if (url.pathname === "/api/player-smoke-stream") {
      response = handlePlayerSmokeStream();
    } else {
      response = new Response("Not found", { status: 404 });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    try {
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      } else {
        res.write(await response.text());
      }
    } catch (streamError) {
      console.log(`[server] response stream error ${streamError instanceof Error ? streamError.message : String(streamError)}`);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.stack || error.message : String(error));
  }
});

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (socket) => bridgeRealtimeStt(socket));
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/api/stt-stream") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local TTS VAD/STT harness: http://127.0.0.1:${PORT}`);
  console.log(`Using HivemindOS app base: ${APP_BASE}`);
});
