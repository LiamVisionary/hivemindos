#!/usr/bin/env node
// End-to-end test of the generated Hive Compute worker (worker.mjs): spins up a
// mock gateway WebSocket server plus mock OpenAI-compatible and Ollama backends
// on ephemeral ports, runs the real worker source against them, and asserts the
// protocol, multimodal passthrough, multi-engine routing, guardrail
// enforcement (concurrency, daily cap, schedule), and the local earnings
// summary file. Hermetic: localhost only, ephemeral ports, writes only to a
// temp dir.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { register } from "node:module";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { HIVE_COMPUTE_WORKER_SOURCE, hiveComputeWorkerPackageJson } = await import(
  "../src/lib/services/hive-compute-marketplace/worker-module.ts"
);
const { summarizeHiveComputeEarnings, HIVE_COMPUTE_EARNINGS_SUMMARY_FILENAME } = await import(
  "../src/lib/services/hive-compute-marketplace/earnings.ts"
);

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");

const OVERALL_TIMEOUT_MS = 60_000;
const watchdog = setTimeout(() => {
  console.error("Hive Compute worker test timed out.");
  process.exit(1);
}, OVERALL_TIMEOUT_MS);
watchdog.unref();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- temp worker module dir ----------
const moduleDir = mkdtempSync(join(os.tmpdir(), "hive-compute-worker-test-"));
writeFileSync(join(moduleDir, "worker.mjs"), HIVE_COMPUTE_WORKER_SOURCE);
writeFileSync(join(moduleDir, "package.json"), hiveComputeWorkerPackageJson());
mkdirSync(join(moduleDir, "node_modules"), { recursive: true });
const wsPackageDir = dirname(require.resolve("ws/package.json"));
symlinkSync(wsPackageDir, join(moduleDir, "node_modules", "ws"), process.platform === "win32" ? "junction" : "dir");

// ---------- mock OpenAI-compatible backend ----------
const openAiRequests = [];
let openAiDelayMs = 0;
const openAiServer = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const parsed = body ? JSON.parse(body) : {};
  openAiRequests.push({ url: request.url, body: parsed });
  if (openAiDelayMs) await sleep(openAiDelayMs);
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "world" } }], usage: { prompt_tokens: 12, completion_tokens: 2 } })}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
});
await new Promise((resolve) => openAiServer.listen(0, "127.0.0.1", resolve));
const openAiPort = openAiServer.address().port;

// ---------- mock Ollama backend ----------
const ollamaRequests = [];
const ollamaServer = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const parsed = body ? JSON.parse(body) : {};
  ollamaRequests.push({ url: request.url, body: parsed });
  response.writeHead(200, { "Content-Type": "application/x-ndjson" });
  response.write(`${JSON.stringify({ message: { content: "ok from ollama" }, done: false })}\n`);
  response.write(`${JSON.stringify({ done: true, prompt_eval_count: 5, eval_count: 3 })}\n`);
  response.end();
});
await new Promise((resolve) => ollamaServer.listen(0, "127.0.0.1", resolve));
const ollamaPort = ollamaServer.address().port;

// ---------- mock attested confidential sidecar ----------
const sidecarRequests = [];
const imageServer = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const parsed = body ? JSON.parse(body) : {};
  sidecarRequests.push({ url: request.url, body: parsed });
  response.writeHead(200, { "Content-Type": "application/x-ndjson" });
  response.write(`${JSON.stringify({ type: "progress", progress: { phase: "render", percent: 50 } })}\n`);
  response.end(`${JSON.stringify({
    type: "complete",
    completion: {
      usage: {
        protocol: "hive-compute.workload.v1",
        jobId: parsed.jobId,
        workerId: parsed.workerId,
        kind: "image",
        billingUnit: "image",
        billedUnits: 2,
        outputArtifacts: [1, 2].map((index) => ({
          artifactId: `${parsed.jobId}.${index}`,
          role: "output",
          mimeType: "image/png",
          ciphertextBytes: 8,
          ciphertextSha256: "a".repeat(64),
          encryption: {
            algorithm: "hive-artifact-aes256gcm-v1",
            encryptedKey: "fixture-encrypted-key",
            publicKeySha256: "b".repeat(64),
            chunkSize: 8,
            chunks: 1,
          },
        })),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        attestationEvidenceHash: "c".repeat(64),
        nonce: "fixture-nonce",
      },
      signatureAlgorithm: "ecdsa-p256-sha256",
      signature: "fixture-signature",
    },
  })}\n`);
});
await new Promise((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
const imagePort = imageServer.address().port;
const attestationFile = join(moduleDir, "attestation.bin");
writeFileSync(attestationFile, "fixture-attestation");

// ---------- mock gateway ----------
const received = [];
let workerSocket = null;
const gatewayHttp = createServer((request, response) => {
  response.writeHead(404);
  response.end();
});
const wss = new WebSocketServer({ server: gatewayHttp, path: "/hive-compute/worker/ws" });
wss.on("connection", (socket) => {
  workerSocket = socket;
  socket.on("message", (raw) => {
    try {
      received.push(JSON.parse(raw.toString()));
    } catch {
      // ignore malformed frames
    }
  });
});
await new Promise((resolve) => gatewayHttp.listen(0, "127.0.0.1", resolve));
const gatewayPort = gatewayHttp.address().port;

function sendToWorker(type, payload) {
  assert(workerSocket, "gateway has no connected worker");
  workerSocket.send(JSON.stringify({ type, payload }));
}

async function waitForMessage(predicate, label, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = received.find(predicate);
    if (match) return match;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${label}. Received types: ${received.map((m) => m.type).join(", ")}`);
}

// ---------- spawn the worker ----------
const workerEnv = {
  ...process.env,
  HIVEMINDOS_HIVE_COMPUTE_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
  HIVEMINDOS_HIVE_COMPUTE_WORKER_TOKEN: "test-worker-token",
  HIVE_COMPUTE_LOCAL_ENGINE: "openai",
  HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL: `http://127.0.0.1:${openAiPort}/v1`,
  OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`,
  HIVE_COMPUTE_MODELS: "hive-compute/auto,test-model,ollama-model",
  HIVE_COMPUTE_MODEL_MAP_JSON: JSON.stringify({
    "hive-compute/auto": "test-model",
    "test-model": "test-model",
    "ollama-model": "ollama-model",
    "*": "test-model",
  }),
  HIVE_COMPUTE_MODEL_ENGINES_JSON: JSON.stringify({ "test-model": "openai", "ollama-model": "ollama" }),
  HIVE_COMPUTE_WORKER_MAX_CONCURRENCY: "1",
  HIVE_COMPUTE_WORKER_HOST_WHEN: "always",
  HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY: "0",
  HIVE_COMPUTE_WORKER_YIELD_TO_USER: "0",
  HIVE_COMPUTE_WORKER_DAILY_CAP_USD: "2",
  HIVEMINDOS_HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF: "0",
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL: `http://127.0.0.1:${imagePort}`,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY: "fixture-signing-public-key",
  HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE: "tee-attested",
  HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER: "fixture-tee",
  HIVEMINDOS_HIVE_COMPUTE_TEE_ATTESTATION_FILE: attestationFile,
  HIVEMINDOS_HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY: "fixture-enclave-public-key",
  HIVE_COMPUTE_IMAGE_MODELS: "local-image-model",
  HIVE_COMPUTE_IMAGE_PRICE_USD_MICRO_JSON: JSON.stringify({ "local-image-model": 30_000 }),
};
const worker = spawn(process.execPath, ["worker.mjs"], { cwd: moduleDir, env: workerEnv });
let workerOutput = "";
worker.stdout.on("data", (chunk) => { workerOutput += chunk.toString(); });
worker.stderr.on("data", (chunk) => { workerOutput += chunk.toString(); });

let scheduledWorker = null;
try {
  // 1. Registration advertises modalities, guardrails, and availability.
  const registration = await waitForMessage((m) => m.type === "worker.register", "worker.register");
  assert(Array.isArray(registration.payload.capabilities.modalities), "capabilities must advertise modalities");
  assert(registration.payload.capabilities.modalities.includes("chat"), "chat modality must be advertised");
  const guardrails = registration.payload.capabilities.guardrails;
  assert(guardrails && guardrails.hostWhen === "always", "guardrails must be advertised in capabilities");
  assert(guardrails.dailyCapUsd === 2, "daily cap must be advertised");
  assert(registration.payload.capabilities.modalities.includes("image"), "image modality must be advertised when configured");
  const imageListing = registration.payload.listings.find((listing) => listing.model === "local-image-model");
  assert(imageListing && imageListing.modality === "image" && imageListing.usdMicroPerImage === 30_000, "image listing must carry per-image pricing");
  assert(registration.payload.models.includes("local-image-model"), "image models must be advertised alongside chat models");

  // 2. Vision passthrough on the OpenAI-compatible engine: content-part arrays
  // must reach the local backend untouched (not JSON-stringified).
  openAiDelayMs = 400;
  sendToWorker("job.assign", {
    jobId: "job-1",
    model: "test-model",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "what is in this image?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUFBQQ==" } },
      ],
    }],
  });
  await waitForMessage((m) => m.type === "job.accepted" && m.payload.jobId === "job-1", "job-1 accepted");

  // 3. Concurrency guardrail: with 1 slot busy, a second assignment is refused
  // with a reroutable error, and a heartbeat reports not-accepting.
  sendToWorker("job.assign", { jobId: "job-2", model: "test-model", prompt: "hi" });
  const capacityRefusal = await waitForMessage(
    (m) => m.type === "job.error" && m.payload.jobId === "job-2",
    "job-2 capacity refusal",
  );
  assert(capacityRefusal.payload.refused === true, "capacity refusal must be flagged refused");
  assert(String(capacityRefusal.payload.error).includes("worker-unavailable: at capacity"), `capacity refusal reason, got: ${capacityRefusal.payload.error}`);

  const complete1 = await waitForMessage((m) => m.type === "job.complete" && m.payload.jobId === "job-1", "job-1 complete");
  assert(complete1.payload.text === "Hello world", `job-1 streamed text, got: ${JSON.stringify(complete1.payload.text)}`);
  const openAiJob = openAiRequests.find((entry) => String(entry.url).includes("/chat/completions"));
  assert(openAiJob, "mock OpenAI backend must receive the job");
  assert(Array.isArray(openAiJob.body.messages[0].content), "content parts must pass through as an array");
  assert(
    openAiJob.body.messages[0].content.some((part) => part && part.type === "image_url"),
    "image_url part must reach the local backend",
  );

  // 4. Multi-engine routing + Ollama image conversion: the same worker serves
  // an Ollama-engine model, converting parts to text + base64 images.
  sendToWorker("job.assign", {
    jobId: "job-3",
    model: "ollama-model",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "describe" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUFBQQ==" } },
      ],
    }],
  });
  const accepted3 = await waitForMessage((m) => m.type === "job.accepted" && m.payload.jobId === "job-3", "job-3 accepted");
  assert(accepted3.payload.engine === "ollama", `job-3 must route to the ollama engine, got ${accepted3.payload.engine}`);
  await waitForMessage((m) => m.type === "job.complete" && m.payload.jobId === "job-3", "job-3 complete");
  const ollamaJob = ollamaRequests.find((entry) => String(entry.url).includes("/api/chat"));
  assert(ollamaJob, "mock Ollama backend must receive the job");
  assert(ollamaJob.body.messages[0].content === "describe", "ollama content must flatten to text");
  assert(
    Array.isArray(ollamaJob.body.messages[0].images) && ollamaJob.body.messages[0].images[0] === "QUFBQQ==",
    "ollama images must carry the base64 payload",
  );

  // 4b. Image modality: only ciphertext and grants reach the confidential
  // sidecar; the relay returns progress plus a signed ciphertext manifest.
  sendToWorker("job.assign", {
    jobId: "job-img",
    kind: "image",
    model: "local-image-model",
    encryptedPayload: { algorithm: "rsa-oaep-a256gcm", ciphertext: "opaque" },
    privacy: {
      hardwareTeeRequired: true,
      outputEncryption: { required: true, publicKey: "fixture-renter-key", publicKeySha256: "b".repeat(64) },
    },
    workload: {
      artifactUploads: [{ artifactId: "job-img.1", singleGrant: "grant-1" }, { artifactId: "job-img.2", singleGrant: "grant-2" }],
      inputArtifacts: [],
    },
  });
  const acceptedImg = await waitForMessage((m) => m.type === "job.accepted" && m.payload.jobId === "job-img", "job-img accepted");
  assert(acceptedImg.payload.kind === "image" && acceptedImg.payload.engine === "confidential-sidecar", "image jobs must use the confidential sidecar");
  await waitForMessage((m) => m.type === "job.progress" && m.payload.jobId === "job-img" && m.payload.progress === 50, "job-img progress");
  const completeImg = await waitForMessage((m) => m.type === "job.confidential_complete" && m.payload.jobId === "job-img", "job-img confidential completion");
  assert(completeImg.payload.completion.usage.outputArtifacts.length === 2, "image completion must carry ciphertext manifests");
  assert(!JSON.stringify(completeImg).includes("aW1hZ2U="), "worker frames must never contain plaintext/base64 generated images");
  const sidecarJob = sidecarRequests.find((entry) => String(entry.url).includes("/v1/jobs"));
  assert(sidecarJob && sidecarJob.body.encryptedPayload.ciphertext === "opaque", "sidecar must receive the encrypted payload");
  assert(!("prompt" in sidecarJob.body) && !("options" in sidecarJob.body), "relay must not forward plaintext image parameters");

  // 5. Earnings ledger: gateway earning events persist to the summary file and
  // aggregate through the dashboard-side reader.
  sendToWorker("worker.earning", { jobId: "job-1", usdMicro: 1_500_000 });
  sendToWorker("worker.earning", { jobId: "job-3", usdMicro: 600_000 });
  await sleep(900); // debounce flush is 500ms
  const summaryRaw = JSON.parse(readFileSync(join(moduleDir, HIVE_COMPUTE_EARNINGS_SUMMARY_FILENAME), "utf8"));
  assert(summaryRaw.totalUsdMicro === 2_100_000, `ledger total, got ${summaryRaw.totalUsdMicro}`);
  assert(summaryRaw.totalJobs === 3, `ledger job count (2 chat + 1 image), got ${summaryRaw.totalJobs}`);
  const summary = summarizeHiveComputeEarnings(summaryRaw);
  assert(summary.todayUsdMicro === 2_100_000, `summary today total, got ${summary.todayUsdMicro}`);
  assert(summary.todayJobs === 3, `summary today jobs, got ${summary.todayJobs}`);
  assert(summary.byModel.some((entry) => entry.model === "test-model" && entry.usdMicro === 1_500_000), "per-model attribution");
  assert(summary.byModel.some((entry) => entry.model === "local-image-model" && entry.jobs === 1), "image jobs must appear in the per-model ledger");
  assert(summary.recent.length === 2 && summary.recent[0].jobId === "job-3", "recent events, newest first");

  // 6. Daily cap guardrail: $2.10 earned ≥ $2 cap → new jobs refused.
  sendToWorker("job.assign", { jobId: "job-4", model: "test-model", prompt: "hi" });
  const capRefusal = await waitForMessage((m) => m.type === "job.error" && m.payload.jobId === "job-4", "job-4 cap refusal");
  assert(String(capRefusal.payload.error).includes("daily earnings cap reached"), `cap refusal reason, got: ${capRefusal.payload.error}`);
  await waitForMessage(
    (m) => m.type === "worker.heartbeat" &&
      m.payload.availability &&
      m.payload.availability.accepting === false &&
      String(m.payload.availability.reason).includes("daily earnings cap"),
    "not-accepting heartbeat with the cap reason",
  );

  // 7. Schedule guardrail: a second worker whose window excludes the current
  // local hour refuses jobs as outside the schedule.
  const hour = new Date().getHours();
  const receivedBefore = received.length;
  scheduledWorker = spawn(process.execPath, ["worker.mjs"], {
    cwd: moduleDir,
    env: {
      ...workerEnv,
      HIVE_COMPUTE_WORKER_HOST_WHEN: "sched",
      HIVE_COMPUTE_WORKER_SCHEDULE_JSON: JSON.stringify({ startHour: (hour + 2) % 24, endHour: (hour + 3) % 24 }),
      HIVE_COMPUTE_WORKER_DAILY_CAP_USD: "",
      HIVE_COMPUTE_WORKER_ID: "sched-worker",
    },
  });
  await waitForMessage(
    (m, index) => m.type === "worker.register" && m.payload.workerId === "sched-worker" && received.indexOf(m) >= receivedBefore,
    "scheduled worker registration",
  );
  sendToWorker("job.assign", { jobId: "job-5", model: "test-model", prompt: "hi" });
  const schedRefusal = await waitForMessage((m) => m.type === "job.error" && m.payload.jobId === "job-5", "job-5 schedule refusal");
  assert(String(schedRefusal.payload.error).includes("outside the scheduled hosting window"), `schedule refusal reason, got: ${schedRefusal.payload.error}`);

  console.log("Hive Compute worker end-to-end tests passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("---- worker output ----");
  console.error(workerOutput.slice(-4_000));
  process.exitCode = 1;
} finally {
  worker.kill("SIGTERM");
  scheduledWorker?.kill("SIGTERM");
  wss.close();
  gatewayHttp.close();
  openAiServer.close();
  ollamaServer.close();
  imageServer.close();
  rmSync(moduleDir, { recursive: true, force: true });
}

// Live WebSocket handles would otherwise keep the event loop (and the suite) alive.
process.exit(process.exitCode ?? 0);
