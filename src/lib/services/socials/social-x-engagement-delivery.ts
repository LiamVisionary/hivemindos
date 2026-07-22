import "server-only";

import { SocialPostError, type SocialPostResult } from "@/lib/services/socials/adapters/types";
import {
  getXDiscoveryStatus,
  runTwitterCli,
  type TwitterCliRun,
} from "@/lib/services/socials/social-x-discovery";
import type { SocialAccount } from "@/lib/services/socials/socials-types";

const X_IDENTITY_PREFLIGHT_ATTEMPTS = 3;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function responseData(value: unknown): Record<string, unknown> | null {
  const record = objectRecord(value);
  return objectRecord(record && Object.hasOwn(record, "data") ? record.data : value);
}

/**
 * Deliver reviewed X engagement through the authenticated Agent Reach browser
 * session. This is the only local rail that can post real replies to arbitrary
 * public posts without degrading them into standalone posts containing URLs.
 */
export async function deliverXEngagement(input: {
  account: SocialAccount;
  text: string;
  replyTo?: string;
  quoteOf?: string;
  runTwitterImpl?: TwitterCliRun;
}): Promise<SocialPostResult> {
  if (Boolean(input.replyTo) === Boolean(input.quoteOf)) {
    throw new SocialPostError("X engagement delivery requires exactly one reply or standalone quote target.");
  }
  const kind = input.replyTo ? "reply" : "quote";
  const targetId = (input.replyTo ?? input.quoteOf ?? "").trim();
  if (!/^\d{1,19}$/.test(targetId)) {
    throw new SocialPostError(`X ${kind} target ids must contain 1-19 digits.`);
  }

  const runTwitterImpl = input.runTwitterImpl ?? runTwitterCli;
  let session = await getXDiscoveryStatus({ force: true, runTwitterImpl });
  for (let attempt = 1; !session.available && attempt < X_IDENTITY_PREFLIGHT_ATTEMPTS; attempt += 1) {
    session = await getXDiscoveryStatus({ force: true, runTwitterImpl });
  }
  if (!session.available || !session.authenticated) {
    throw new SocialPostError(`X ${kind} delivery needs the authenticated Agent Reach X session. ${session.detail}`);
  }
  const connectedHandle = input.account.handle.replace(/^@/, "");
  const sessionHandle = (session.accountHandle ?? "").replace(/^@/, "");
  if (!sessionHandle || sessionHandle.toLowerCase() !== connectedHandle.toLowerCase()) {
    throw new SocialPostError(
      `Agent Reach is authenticated as @${sessionHandle || "unknown"}, but this Socials account is connected as @${connectedHandle}. Re-authenticate Agent Reach with the same X account before publishing.`,
    );
  }

  let raw: unknown;
  try {
    raw = await runTwitterImpl([kind, targetId, input.text, "--json"]);
  } catch (error) {
    throw new SocialPostError(
      `X ${kind} delivery status is unknown: ${error instanceof Error ? error.message : String(error)}`,
      { ambiguous: true },
    );
  }
  const result = responseData(raw);
  const externalId = typeof result?.id === "string" ? result.id.trim() : "";
  const returnedTarget = kind === "reply" ? result?.replyTo : result?.quotedId;
  if (result?.success !== true || result.action !== kind || !/^\d{1,19}$/.test(externalId) || returnedTarget !== targetId) {
    throw new SocialPostError(
      `Agent Reach returned an invalid X ${kind} receipt. Verify the account before retrying.`,
      { ambiguous: true },
    );
  }
  return {
    externalId,
    url: `https://x.com/${connectedHandle}/status/${externalId}`,
  };
}
