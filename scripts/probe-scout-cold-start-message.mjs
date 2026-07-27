#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_GATEWAY_URL = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/free-models/swarm-sovereign-scout-12b/chat/completions";
const DEFAULT_MODEL = "hivemindos/swarm-sovereign-scout";
const DEFAULT_DEVICE_TOKEN_ENV = "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN";

const args = parseArgs(process.argv.slice(2));
const iterations = positiveInteger(args.iterations, 1);
const intervalMs = positiveInteger(args["interval-ms"], 10_000);
const timeoutMs = positiveInteger(args["timeout-ms"], 8_000);
const gatewayUrl = String(args["gateway-url"] || DEFAULT_GATEWAY_URL);
const appUrl = args["app-url"] ? String(args["app-url"]) : "";
const requireMetadata = Boolean(args["require-metadata"]);
const requireColdMessage = Boolean(args["require-cold-message"]);
const jsonOutput = Boolean(args.json);

const probes = [
  { label: "gateway", url: gatewayUrl, auth: false },
];
if (appUrl) {
  const url = new URL("/api/hivemindos/models/chat/completions", appUrl);
  url.searchParams.set("model", String(args.model || DEFAULT_MODEL));
  probes.push({
    label: "local-app",
    url: url.toString(),
    auth: true,
  });
}

const samples = [];

for (let i = 1; i <= iterations; i += 1) {
  for (const probe of probes) {
    const sample = await fetchStatus(probe, i);
    samples.push(sample);
    writeSample(sample);
  }
  if (i < iterations) await sleep(intervalMs);
}

const coldSamples = samples.filter((sample) => sample.uiEvent === "Agent cold start");
const warmSamples = samples.filter((sample) => sample.state === "warm" && sample.loader === "thinking");
const missingMetadata = samples.filter((sample) => sample.ok && !sample.metadataPresent);
const failures = [];
if (requireMetadata && missingMetadata.length) {
  failures.push(`${missingMetadata.length} successful status sample(s) did not include Scout container metadata`);
}
if (requireColdMessage && coldSamples.length === 0) {
  failures.push("no cold sample produced the Agent cold-start event");
}

const summary = {
  samples: samples.length,
  coldMessages: coldSamples.length,
  warmThinking: warmSamples.length,
  missingMetadata: missingMetadata.length,
  failures,
};

if (jsonOutput) {
  console.log(JSON.stringify({ samples, summary }, null, 2));
} else {
  const verdict = failures.length ? "failed" : "passed";
  console.log(`summary verdict=${verdict} samples=${summary.samples} coldMessages=${summary.coldMessages} warmThinking=${summary.warmThinking} missingMetadata=${summary.missingMetadata}`);
  for (const failure of failures) console.error(`failure: ${failure}`);
}

if (failures.length) process.exit(1);

async function fetchStatus(probe, iteration) {
  const startedAt = Date.now();
  const headers = { Accept: "application/json" };
  if (probe.auth) {
    const envName = String(args["device-token-env"] || DEFAULT_DEVICE_TOKEN_ENV);
    const token = process.env[envName]?.trim() || "";
    if (token) headers["x-hivemindos-device-token"] = token;
  }
  try {
    const response = await fetch(probe.url, {
      method: "GET",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const payload = parseJson(text);
    const status = scoutContainerStatus(payload, response.headers);
    const uiState = scoutUiState(status);
    return {
      iteration,
      source: probe.label,
      checkedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      httpStatus: response.status,
      ok: response.ok,
      state: status.state,
      metadataPresent: status.metadataPresent,
      warmWindowSeconds: status.warmWindowSeconds,
      lastSuccessAt: status.lastSuccessAt,
      stateSource: status.stateSource,
      uiEvent: uiState.uiEvent,
      loader: uiState.loader,
      error: response.ok ? "" : errorFromPayload(payload, text),
    };
  } catch (error) {
    return {
      iteration,
      source: probe.label,
      checkedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      httpStatus: 0,
      ok: false,
      state: "error",
      metadataPresent: false,
      warmWindowSeconds: "",
      lastSuccessAt: "",
      stateSource: "",
      uiEvent: "",
      loader: "thinking",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function scoutUiState(status) {
  const shouldWake = status.state === "cold" || status.state === "metadata-missing";
  return {
    uiEvent: shouldWake ? "Agent cold start" : "",
    loader: shouldWake ? "Starting your free agent session" : "thinking",
  };
}

function scoutContainerStatus(payload, headers) {
  const modalContainer = payload?.model?.modalContainer;
  const headerState = clean(headers.get("x-hivemindos-free-model-container-state")).toLowerCase();
  const bodyState = clean(modalContainer?.state).toLowerCase();
  const bodyWarm = typeof modalContainer?.warm === "boolean" ? modalContainer.warm : undefined;
  const stateSource = clean(modalContainer?.source) || clean(headers.get("x-hivemindos-free-model-state-source"));
  const warmWindowSeconds = clean(modalContainer?.warmWindowSeconds) || clean(headers.get("x-hivemindos-free-model-warm-window-seconds"));
  const lastSuccessAt = clean(modalContainer?.lastSuccessAt) || clean(headers.get("x-hivemindos-free-model-last-success-at"));
  const metadataPresent = bodyWarm !== undefined || ["cold", "warm"].includes(bodyState) || ["cold", "warm"].includes(headerState);
  if (bodyWarm === false || bodyState === "cold" || headerState === "cold") {
    return { state: "cold", metadataPresent, warmWindowSeconds, lastSuccessAt, stateSource };
  }
  if (bodyWarm === true || bodyState === "warm" || headerState === "warm") {
    return { state: "warm", metadataPresent, warmWindowSeconds, lastSuccessAt, stateSource };
  }
  return { state: "metadata-missing", metadataPresent: false, warmWindowSeconds, lastSuccessAt, stateSource };
}

function writeSample(sample) {
  if (jsonOutput) return;
  const parts = [
    `[${sample.checkedAt}]`,
    `${sample.source}#${sample.iteration}`,
    `http=${sample.httpStatus}`,
    `state=${sample.state}`,
    `metadata=${sample.metadataPresent ? "yes" : "no"}`,
    `loader="${sample.loader}..."`,
    sample.uiEvent ? `event="${sample.uiEvent}"` : "event=none",
    sample.warmWindowSeconds ? `warmWindow=${sample.warmWindowSeconds}s` : "",
    sample.lastSuccessAt ? `lastSuccessAt=${sample.lastSuccessAt}` : "",
    sample.stateSource ? `source=${sample.stateSource}` : "",
    `elapsed=${sample.elapsedMs}ms`,
    sample.error ? `error=${JSON.stringify(sample.error)}` : "",
  ].filter(Boolean);
  console.log(parts.join(" "));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const [rawName, inlineValue] = token.slice(2).split("=", 2);
    const next = argv[i + 1];
    if (inlineValue !== undefined) {
      parsed[rawName] = inlineValue || true;
    } else if (!next || next.startsWith("--")) {
      parsed[rawName] = true;
    } else {
      parsed[rawName] = next;
      i += 1;
    }
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFromPayload(payload, text) {
  const message = clean(payload?.error || payload?.message);
  if (message) return message;
  return text.slice(0, 240);
}
