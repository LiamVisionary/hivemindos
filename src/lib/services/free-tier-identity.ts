import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { homedir } from "@/lib/home-dir";

// Anonymous per-install identifier sent with free-tier model calls so the
// hosted gateway can meter a daily allowance per device in addition to per
// IP. It is NOT a credential and NOT authoritative: the hosted gateway owns
// the quota; deleting this file just looks like a new device to it, and the
// gateway's per-IP and global caps still bound abuse.
const DEVICE_ID_FILE = () => join(homedir(), ".hivemindos", "device-id");
const DEVICE_ID_RE = /^[a-f0-9]{32}$/;

let cachedDeviceId = "";

export async function freeTierDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const file = DEVICE_ID_FILE();
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (DEVICE_ID_RE.test(existing)) {
      cachedDeviceId = existing;
      return existing;
    }
  } catch {
    // Missing or unreadable: mint a fresh id below.
  }
  const minted = randomBytes(16).toString("hex");
  try {
    await mkdir(join(homedir(), ".hivemindos"), { recursive: true });
    await writeFile(file, `${minted}\n`, "utf8");
  } catch {
    // Persisting failed (read-only fs?): still return the in-memory id so
    // this server process meters consistently for its lifetime.
  }
  cachedDeviceId = minted;
  return minted;
}
