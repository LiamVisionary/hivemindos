import { promises as fs } from "node:fs";
import { homedir } from "@/lib/home-dir";
import path from "node:path";

/**
 * Mobile push-notification registry + sender for the HivemindOS phone app.
 * The phone registers its Expo push token (POST /api/phone action=register-push)
 * and the hub fires an Expo push when a spend approval is enqueued, so the user
 * gets a background alert without the app open. Best-effort throughout — a push
 * failure never blocks the approval it was announcing.
 *
 * Tokens live in a local per-machine JSON file (like the spend-approvals store),
 * never in the fleet-synced shared env.
 */

const STORE_PATH =
  process.env.HIVEMINDOS_PUSH_DEVICE_STORE_PATH ||
  path.join(homedir(), ".hivemindos", "push-devices.json");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_DEVICES = 50;

export type PushDevice = { token: string; platform: string; updatedAt: string };
type PushStore = { version: 1; devices: PushDevice[] };

function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

async function readStore(): Promise<PushStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PushStore;
    return { version: 1, devices: Array.isArray(parsed.devices) ? parsed.devices : [] };
  } catch {
    return { version: 1, devices: [] };
  }
}

async function writeStore(store: PushStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}

/** Register (or refresh) one device's Expo push token. Idempotent per token;
 *  keeps the most-recent MAX_DEVICES. Throws on a malformed token. */
export async function registerPushDevice(token: string, platform: string): Promise<void> {
  const trimmed = (token || "").trim();
  if (!isExpoPushToken(trimmed)) {
    throw new Error("A valid Expo push token is required.");
  }
  const store = await readStore();
  const now = new Date().toISOString();
  const existing = store.devices.find((d) => d.token === trimmed);
  if (existing) {
    existing.platform = platform || existing.platform;
    existing.updatedAt = now;
  } else {
    store.devices.push({ token: trimmed, platform: platform || "ios", updatedAt: now });
  }
  store.devices.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  store.devices = store.devices.slice(0, MAX_DEVICES);
  await writeStore(store);
}

/** Drop a token the Expo service reported as unregistered (DeviceNotRegistered). */
async function pruneTokens(tokens: Set<string>): Promise<void> {
  if (tokens.size === 0) return;
  const store = await readStore();
  const next = store.devices.filter((d) => !tokens.has(d.token));
  if (next.length !== store.devices.length) await writeStore({ version: 1, devices: next });
}

export type ApprovalPushInput = {
  id: string;
  agentName?: string;
  kind: string;
  asset: string;
  amountUsd: number;
  target?: string;
  reason?: string;
  summary?: string;
  companyId?: string;
};

/** One-line body for an approval push. Exported for readability/tests. */
export function approvalPushBody(approval: ApprovalPushInput): string {
  const verb =
    approval.kind === "trade"
      ? "Trade"
      : approval.kind.startsWith("x402")
        ? "Payment"
        : approval.kind === "platform-fee"
          ? "Platform fee"
          : "Send";
  const who = approval.agentName || "An agent";
  const amount = `$${approval.amountUsd.toFixed(2)}${approval.asset && approval.asset !== "USDC" ? ` ${approval.asset}` : ""}`;
  if (approval.summary?.trim()) return approval.summary.trim().slice(0, 178);
  const reason = approval.reason ? ` - ${approval.reason}` : "";
  return `${who}: ${verb} ${amount}${reason}`.slice(0, 178);
}

/**
 * Fire a background push for a newly-enqueued spend approval to every
 * registered device. `badge` carries the current pending count so the app
 * icon shows how many decisions are waiting. Never throws.
 */
export async function sendApprovalPush(
  approval: ApprovalPushInput,
  pendingCount: number,
): Promise<void> {
  let devices: PushDevice[];
  try {
    devices = (await readStore()).devices;
  } catch {
    return;
  }
  if (devices.length === 0) return;

  const messages = devices.map((device) => ({
    to: device.token,
    title: "Approval needed",
    body: approvalPushBody(approval),
    sound: "default" as const,
    priority: "high" as const,
    badge: pendingCount > 0 ? pendingCount : undefined,
    data: { kind: "approval", approvalId: approval.id, companyId: approval.companyId },
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      data?: { status?: string; details?: { error?: string } }[];
    };
    // Prune tokens Expo says are gone so the store doesn't grow stale.
    const dead = new Set<string>();
    (payload.data ?? []).forEach((ticket, i) => {
      if (ticket?.details?.error === "DeviceNotRegistered" && messages[i]) {
        dead.add(messages[i].to);
      }
    });
    await pruneTokens(dead);
  } catch {
    // Offline hub or Expo hiccup — the approval is already queued and will
    // still show when the phone next reads /api/wallet/approvals.
  }
}
