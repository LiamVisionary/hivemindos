#!/usr/bin/env node
// Fleet-routed STT: a machine with no local recognizer and no OpenAI key
// (Linux desktop, headless boxes) transcribes recorder-path turns against a
// peer-hosted OpenAI-compatible whisper server named by WHISPER_BASE_URL /
// LOCAL_WHISPER_BASE_URL in the shared hive env (which replicates
// fleet-wide). This suite proves the chain keylessly against a mock server
// and pins the load-bearing seams so they can't regress silently.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const checks = [];
function check(name, run) {
  checks.push([name, run]);
}

// --- live keyless transcription against a mock fleet whisper server ---
check("keyless transcription reaches the WHISPER_BASE_URL server", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
    });
    request.on("end", () => {
      requests.push({
        url: request.url,
        method: request.method,
        contentType: request.headers["content-type"] || "",
        hasAuth: Boolean(request.headers.authorization),
        bytes: size,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ text: "  fleet transcribed hello  " }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  process.env.WHISPER_BASE_URL = `http://127.0.0.1:${port}`;
  try {
    const { transcribeAudioWithWhisper } = await import(
      "../src/lib/services/phone/transcription.ts"
    );
    const audio = new Blob([new Uint8Array(2_048)], { type: "audio/webm" });
    const transcript = await transcribeAudioWithWhisper(
      audio,
      AbortSignal.timeout(10_000),
    );
    assert.equal(transcript, "fleet transcribed hello");
    assert.equal(requests.length, 1);
    const [hit] = requests;
    assert.equal(hit.method, "POST");
    assert.equal(hit.url, "/v1/audio/transcriptions");
    assert.match(hit.contentType, /multipart\/form-data/);
    assert.ok(hit.bytes > 2_048, "audio bytes reached the fleet server");
    // The mock accepted the request with no auth demanded — an OpenAI key is
    // only required when the base URL IS api.openai.com.
  } finally {
    delete process.env.WHISPER_BASE_URL;
    server.close();
  }
});

// --- static seams: the chain that makes the fleet rail reachable ---
const transcription = readFileSync(
  "src/lib/services/phone/transcription.ts",
  "utf8",
);
const voiceRoute = readFileSync("src/app/api/queen-bee/voice/route.ts", "utf8");

check("base-url resolution honors the shared-hive-env fleet keys", () => {
  assert.match(transcription, /hiveEnvValue\("WHISPER_BASE_URL"\)/);
  assert.match(transcription, /hiveEnvValue\("LOCAL_WHISPER_BASE_URL"\)/);
  // The OpenAI key requirement is scoped to the OpenAI base URL only.
  assert.match(
    transcription,
    /const isOpenAi = \/\^https:\\\/\\\/api\\\.openai\\\.com\$\/i\.test\(baseUrl\)/,
  );
  assert.match(transcription, /if \(isOpenAi && !apiKey\) throw/);
});

check("the recorder-path voice-turn route has no OpenAI-key gate", () => {
  const start = voiceRoute.indexOf("async function runVoiceTurn");
  assert.notEqual(start, -1, "runVoiceTurn exists");
  const body = voiceRoute.slice(start, voiceRoute.indexOf("\n}", start));
  assert.match(body, /transcribeAudioWithWhisper\(audio, signal\)/);
  assert.doesNotMatch(
    body,
    /transcriptionApiKey/,
    "runVoiceTurn must not demand an OpenAI key — non-OpenAI fleet servers are keyless",
  );
});

let failed = 0;
for (const [name, run] of checks) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(error);
  }
}
if (failed) {
  console.error(`fleet STT fallback: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`fleet STT fallback: ${checks.length} checks passed.`);
