import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

// Short-lived signed URLs for /api/chat/generated-media. The dashboard
// authenticates that route with its session cookie, but phone clients fetch
// images with native loaders (URLSession / RN Image) that carry neither the
// cookie nor the device token — so the hub mints a per-file HMAC capability
// instead: ?path=…&exp=…&sig=…. The signature is scoped to one absolute path
// and one expiry, so a leaked URL never grants anything beyond that single
// already-generated image, and only until it expires.

const SIGNING_VERSION = "generated-media.v1";
const SECRET_FILE = join(homedir(), ".hivemindos", "generated-media-signing.secret");
const MIN_SECRET_LENGTH = 32;

export const DEFAULT_SIGNED_MEDIA_TTL_MS = 60 * 60 * 1000;

let cachedFileSecret: string | null = null;

/**
 * Prefer the dashboard auth secret so one rotation invalidates everything;
 * fall back to a per-install random secret on disk so signing still works on
 * hubs that haven't configured dashboard auth yet.
 */
async function signingSecret(): Promise<string> {
  const dashboardSecret = process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET?.trim() ?? "";
  if (dashboardSecret.length >= MIN_SECRET_LENGTH) return dashboardSecret;
  if (cachedFileSecret) return cachedFileSecret;
  try {
    const existing = (await readFile(SECRET_FILE, "utf8")).trim();
    if (existing.length >= MIN_SECRET_LENGTH) {
      cachedFileSecret = existing;
      return existing;
    }
  } catch {
    // fall through to mint a fresh secret
  }
  const minted = randomBytes(32).toString("hex");
  await mkdir(dirname(SECRET_FILE), { recursive: true });
  await writeFile(SECRET_FILE, `${minted}\n`, { mode: 0o600 });
  cachedFileSecret = minted;
  return minted;
}

async function signatureFor(path: string, expiresAtMs: number) {
  const secret = await signingSecret();
  return createHmac("sha256", secret)
    .update(`${SIGNING_VERSION}\n${path}\n${expiresAtMs}`)
    .digest("hex");
}

/** Relative signed URL for one generated image file on this hub's disk. */
export async function signedGeneratedMediaUrl(
  path: string,
  ttlMs: number = DEFAULT_SIGNED_MEDIA_TTL_MS,
  now: number = Date.now(),
) {
  const expiresAtMs = now + Math.max(ttlMs, 0);
  const sig = await signatureFor(path, expiresAtMs);
  return `/api/chat/generated-media?path=${encodeURIComponent(path)}&exp=${expiresAtMs}&sig=${sig}`;
}

export async function verifySignedGeneratedMedia(
  path: string,
  exp: string,
  sig: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!path || !/^\d+$/.test(exp) || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expiresAtMs = Number(exp);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return false;
  const expected = await signatureFor(path, expiresAtMs);
  const expectedBytes = new Uint8Array(Buffer.from(expected, "hex"));
  const actualBytes = new Uint8Array(Buffer.from(sig, "hex"));
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
