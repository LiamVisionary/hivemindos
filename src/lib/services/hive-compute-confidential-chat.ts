import {
  decryptHiveComputeOutputEnvelope,
  generateHiveComputeOutputKeyPair,
  type HiveComputeEncryptedOutputEnvelope,
} from "@/lib/services/hive-compute-output-e2ee";

export async function prepareHiveComputeConfidentialChat() {
  const keys = await generateHiveComputeOutputKeyPair();
  return {
    headers: {
      ...keys.headers,
      "X-HivemindOS-Compute-Verified-Only": "true",
      "X-HivemindOS-Compute-Hardware-TEE-Required": "true",
    },
    decryptResponse: (response: Response) => decryptHiveComputeChatResponse(response, keys.privateKey, keys.publicKeySha256),
  };
}

async function decryptHiveComputeChatResponse(response: Response, privateKey: CryptoKey, publicKeySha256: string) {
  if (!response.ok || !response.body) return response;
  const jobId = response.headers.get("x-hivemindos-compute-job-id")?.trim() || "";
  if (!jobId) throw new Error("Hardware-confidential Hive Compute chat returned no bound job id.");
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("text/event-stream")) {
    return new Response(response.body.pipeThrough(confidentialSseTransform(privateKey, publicKeySha256, jobId)), responseInit(response));
  }
  if (!contentType.includes("json")) return response;
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new Error("Encrypted Hive Compute chat returned invalid JSON.");
  const record = payload as Record<string, unknown>;
  const hiveCompute = isRecord(record.hiveCompute) ? record.hiveCompute : {};
  const envelope = normalizeEnvelope(hiveCompute.encryptedOutput);
  if (!envelope) throw new Error("Hardware-confidential Hive Compute chat returned no encrypted output.");
  validateEnvelopeBinding(envelope, publicKeySha256, `hivemindos-hive-compute-output:${jobId}:final:0`);
  const decrypted = await decryptHiveComputeOutputEnvelope(privateKey, envelope);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  if (choices[0] && isRecord(choices[0])) {
    const choice = choices[0];
    const message = isRecord(choice.message) ? choice.message : {};
    choice.message = { ...message, content: decrypted.text };
  }
  return new Response(JSON.stringify(record), responseInit(response));
}

function confidentialSseTransform(privateKey: CryptoKey, publicKeySha256: string, jobId: string) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let nextSequence = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) {
        const decrypted = await decryptSseEvent(event, privateKey, publicKeySha256, jobId, nextSequence);
        nextSequence = decrypted.nextSequence;
        controller.enqueue(encoder.encode(decrypted.event + "\n\n"));
      }
    },
    async flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        const decrypted = await decryptSseEvent(buffer, privateKey, publicKeySha256, jobId, nextSequence);
        controller.enqueue(encoder.encode(decrypted.event));
      }
    },
  });
}

async function decryptSseEvent(
  event: string,
  privateKey: CryptoKey,
  publicKeySha256: string,
  jobId: string,
  initialSequence: number,
) {
  const lines = event.split(/\r?\n/);
  const output: string[] = [];
  let nextSequence = initialSequence;
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      output.push(line);
      continue;
    }
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") {
      output.push(line);
      continue;
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const value of choices) {
      if (!isRecord(value)) continue;
      const delta = isRecord(value.delta) ? value.delta : {};
      const envelope = normalizeEnvelope(delta.encrypted_content);
      if (!envelope) {
        if (typeof delta.content === "string" && delta.content) {
          throw new Error("Hardware-confidential Hive Compute chat exposed plaintext output upstream.");
        }
        continue;
      }
      if (envelope.sequence !== nextSequence) throw new Error("Hive Compute encrypted chat sequence was duplicated or reordered.");
      validateEnvelopeBinding(
        envelope,
        publicKeySha256,
        `hivemindos-hive-compute-output:${jobId}:delta:${nextSequence}`,
      );
      const decrypted = await decryptHiveComputeOutputEnvelope(privateKey, envelope);
      if (decrypted.sequence !== nextSequence) throw new Error("Hive Compute encrypted chat payload sequence did not match its envelope.");
      nextSequence += 1;
      const next: Record<string, unknown> = { ...delta, content: decrypted.text };
      delete next.encrypted_content;
      value.delta = next;
    }
    output.push(`data: ${JSON.stringify(payload)}`);
  }
  return { event: output.join("\n"), nextSequence };
}

function normalizeEnvelope(value: unknown): HiveComputeEncryptedOutputEnvelope | null {
  if (!isRecord(value)) return null;
  if (value.algorithm !== "rsa-oaep-a256gcm") return null;
  for (const key of ["encryptedKey", "nonce", "tag", "ciphertext", "aad", "publicKeySha256"] as const) {
    if (typeof value[key] !== "string" || !value[key]) return null;
  }
  return value as HiveComputeEncryptedOutputEnvelope;
}

function validateEnvelopeBinding(
  envelope: HiveComputeEncryptedOutputEnvelope,
  publicKeySha256: string,
  expectedAad: string,
) {
  if (envelope.publicKeySha256 !== publicKeySha256) throw new Error("Hive Compute encrypted output key binding is invalid.");
  if (envelope.aad !== expectedAad) throw new Error("Hive Compute encrypted output job binding is invalid.");
}

function responseInit(response: Response): ResponseInit {
  return { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
