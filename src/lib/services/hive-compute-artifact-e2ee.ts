import type { HiveComputeArtifactDescriptor } from "@/lib/services/hive-compute-workloads";

export type HiveComputeArtifactKeyPair = {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyPem: string;
  publicKeySha256: string;
  privateKeyPkcs8: Uint8Array;
};

export type HiveComputeArtifactChunkEnvelope = {
  nonce: string;
  tag: string;
  ciphertext: string;
  aad: string;
  chunkIndex: number;
  final: boolean;
};

export type HiveComputeEncryptedJobPayload = {
  algorithm: "rsa-oaep-a256gcm";
  encryptedKey: string;
  nonce: string;
  tag: string;
  ciphertext: string;
  aad: string;
  publicKeySha256: string;
};

export async function generateHiveComputeArtifactKeyPair(): Promise<HiveComputeArtifactKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicKeyPem = pem("PUBLIC KEY", bytesToBase64(spki));
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyPem,
    publicKeySha256: await sha256Hex(new TextEncoder().encode(publicKeyPem)),
    privateKeyPkcs8,
  };
}

export async function importHiveComputeArtifactPrivateKey(privateKeyPkcs8: Uint8Array) {
  return crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(privateKeyPkcs8),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

export async function decryptHiveComputeArtifactChunk(input: {
  privateKey: CryptoKey;
  jobId: string;
  descriptor: HiveComputeArtifactDescriptor;
  envelope: HiveComputeArtifactChunkEnvelope;
}): Promise<Uint8Array> {
  const { descriptor, envelope } = input;
  if (descriptor.encryption.algorithm !== "hive-artifact-aes256gcm-v1") throw new Error("Unsupported Hive Compute artifact encryption.");
  const expectedAad = hiveComputeArtifactChunkAad(input.jobId, descriptor, envelope.chunkIndex, envelope.final);
  if (envelope.aad !== expectedAad) throw new Error("Hive Compute artifact chunk binding does not match its descriptor.");
  const payloadKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    input.privateKey,
    base64ToBytes(descriptor.encryption.encryptedKey),
  );
  const key = await crypto.subtle.importKey("raw", payloadKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const ciphertext = concatBytes(base64ToBytes(envelope.ciphertext), base64ToBytes(envelope.tag));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.nonce),
      additionalData: new TextEncoder().encode(envelope.aad),
      tagLength: 128,
    },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

export async function encryptHiveComputeJobPayload(input: {
  payload: Record<string, unknown>;
  publicKeyPem: string;
  publicKeySha256: string;
  aad: string;
}): Promise<HiveComputeEncryptedJobPayload> {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToBytes(input.publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const payloadKey = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", payloadKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode(input.aad),
      tagLength: 128,
    },
    aesKey,
    new TextEncoder().encode(JSON.stringify(input.payload)),
  ));
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, payloadKey);
  return {
    algorithm: "rsa-oaep-a256gcm",
    encryptedKey: bytesToBase64(new Uint8Array(encryptedKey)),
    nonce: bytesToBase64(nonce),
    tag: bytesToBase64(sealed.slice(-16)),
    ciphertext: bytesToBase64(sealed.slice(0, -16)),
    aad: input.aad,
    publicKeySha256: input.publicKeySha256,
  };
}

export async function verifyHiveComputeCiphertext(bytes: Uint8Array, descriptor: HiveComputeArtifactDescriptor) {
  const digest = await sha256Hex(bytes);
  if (digest !== descriptor.ciphertextSha256) throw new Error("Hive Compute artifact ciphertext hash does not match its signed descriptor.");
  if (bytes.byteLength !== descriptor.ciphertextBytes) throw new Error("Hive Compute artifact ciphertext size does not match its signed descriptor.");
}

export function hiveComputeArtifactChunkAad(
  jobId: string,
  descriptor: Pick<HiveComputeArtifactDescriptor, "artifactId" | "mimeType">,
  chunkIndex: number,
  final: boolean,
) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new Error("Hive Compute artifact chunk index is invalid.");
  return `hive-artifact-aes256gcm-v1:${jobId}:${descriptor.artifactId}:${descriptor.mimeType}:${chunkIndex}:${final ? 1 : 0}`;
}

function pem(label: string, base64: string) {
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)?.join("\n") || base64}\n-----END ${label}-----`;
}

async function sha256Hex(value: Uint8Array) {
  const copy = Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left);
  bytes.set(right, left.byteLength);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function pemToBytes(value: string) {
  const base64 = value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
  if (!base64) throw new Error("Hive Compute input-encryption public key is invalid.");
  return base64ToBytes(base64);
}
