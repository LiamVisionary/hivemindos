export type HiveComputeEncryptedOutputEnvelope = {
  algorithm: "rsa-oaep-a256gcm";
  encryptedKey: string;
  nonce: string;
  tag: string;
  ciphertext: string;
  aad: string;
  publicKeySha256: string;
  sequence?: number;
};

export type HiveComputeOutputKeyPair = {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyPem: string;
  publicKeyBase64: string;
  publicKeySha256: string;
  headers: Record<string, string>;
};

export type HiveComputeDecryptedOutputPayload = {
  type?: "delta" | "final";
  text: string;
  sequence?: number;
};

const OUTPUT_ALGORITHM = "rsa-oaep-a256gcm";

export async function generateHiveComputeOutputKeyPair(): Promise<HiveComputeOutputKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const publicKeyBase64 = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)));
  const publicKeyPem = publicKeyPemFromBase64(publicKeyBase64);
  const publicKeySha256 = await sha256Hex(publicKeyPem);
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyPem,
    publicKeyBase64,
    publicKeySha256,
    headers: {
      "X-HivemindOS-Compute-Output-Encryption": "required",
      "X-HivemindOS-Compute-Output-Public-Key": publicKeyBase64,
    },
  };
}

export async function decryptHiveComputeOutputEnvelope(
  privateKey: CryptoKey,
  envelope: HiveComputeEncryptedOutputEnvelope,
): Promise<HiveComputeDecryptedOutputPayload> {
  if (envelope.algorithm !== OUTPUT_ALGORITHM) {
    throw new Error(`Unsupported Hive Compute output encryption algorithm: ${envelope.algorithm}`);
  }
  const payloadKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToBytes(envelope.encryptedKey),
  );
  const aesKey = await crypto.subtle.importKey("raw", payloadKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const ciphertext = concatBytes(base64ToBytes(envelope.ciphertext), base64ToBytes(envelope.tag));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.nonce),
      additionalData: new TextEncoder().encode(envelope.aad),
      tagLength: 128,
    },
    aesKey,
    ciphertext,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as HiveComputeDecryptedOutputPayload;
  if (typeof parsed.text !== "string") throw new Error("Hive Compute encrypted output did not contain text.");
  return parsed;
}

export function publicKeyPemFromBase64(publicKeyBase64: string) {
  const compact = publicKeyBase64.replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${compact.match(/.{1,64}/g)?.join("\n") || compact}\n-----END PUBLIC KEY-----`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const next = new Uint8Array(left.length + right.length);
  next.set(left, 0);
  next.set(right, left.length);
  return next;
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
