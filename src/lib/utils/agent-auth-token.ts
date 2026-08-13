/**
 * Signed per-agent credentials.
 *
 * Deliberately free of any `next/*` import so three very different callers can
 * share one implementation instead of re-deriving the algorithm: the API auth
 * path (`server-auth.ts`, which runs in middleware on every /api request), the
 * MCP registrar CLI that mints a token at registration time, and the hermetic
 * suites. A second copy of the HMAC layout is exactly the kind of drift that
 * ends with a token that verifies in one place and not another.
 *
 * Why a token at all: agents authenticate today with the single machine-wide
 * dashboard device token, and pass `agentId` as an ordinary tool argument. An
 * authority level enforced on a self-declared id is a suggestion, not a
 * boundary. This names the agent and its level in a payload it cannot rewrite.
 */
import { AGENT_AUTHORITY_PRESETS, type AgentAuthorityPreset } from "@/lib/types/principal";

export const AGENT_AUTH_HEADER = "x-hivemindos-agent-token";
export const AGENT_TOKEN_VERSION = "a1";
export const MIN_AGENT_TOKEN_SECRET_LENGTH = 32;

/**
 * Long enough that a token written into a harness config at registration keeps
 * working across a normal working period, short enough that a level the
 * operator lowered cannot linger indefinitely.
 *
 * The token carries its level so the auth path needs no profile read — that
 * path runs in middleware on every /api request, where file I/O is not
 * acceptable. The cost is that lowering an agent's level does not retroactively
 * weaken an already-issued token; re-running the registrar re-mints it, and
 * this TTL is the outer bound if nobody does.
 */
export const AGENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Tolerated forward clock skew. Anything beyond this is treated as forged. */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textBytes(value));
  return bytesToHex(new Uint8Array(signature));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export async function mintAgentAuthToken(
  secret: string,
  agentId: string,
  preset: AgentAuthorityPreset,
  now = Date.now(),
): Promise<string> {
  if (secret.length < MIN_AGENT_TOKEN_SECRET_LENGTH) {
    throw new Error("Dashboard auth secret is not configured.");
  }
  const id = agentId.trim();
  if (!id) throw new Error("Agent id is required.");
  // The payload is dot-delimited, so a dotted id would make the token ambiguous
  // to parse and could let one agent's token be read as another's.
  if (id.includes(".")) throw new Error("Agent id must not contain a dot.");
  if (!(AGENT_AUTHORITY_PRESETS as readonly string[]).includes(preset)) {
    throw new Error(`Unknown authority preset: ${preset}`);
  }
  const payload = [AGENT_TOKEN_VERSION, id, preset, String(now)].join(".");
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyAgentAuthToken(
  secret: string,
  value: string,
  now = Date.now(),
): Promise<{ agentId: string; preset: AgentAuthorityPreset } | null> {
  if (secret.length < MIN_AGENT_TOKEN_SECRET_LENGTH || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== AGENT_TOKEN_VERSION) return null;
  const [version, agentId, preset, issuedAt, signature] = parts;
  if (!agentId || !/^\d+$/.test(issuedAt)) return null;
  if (!(AGENT_AUTHORITY_PRESETS as readonly string[]).includes(preset)) return null;
  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return null;
  // Reject future-dated tokens: otherwise a hand-crafted issuedAt extends a
  // token's life past the TTL.
  if (issuedAtMs > now + CLOCK_SKEW_TOLERANCE_MS) return null;
  if (now - issuedAtMs > AGENT_TOKEN_TTL_MS) return null;
  const expected = await hmacHex(secret, [version, agentId, preset, issuedAt].join("."));
  if (!safeEqual(expected, signature)) return null;
  return { agentId, preset: preset as AgentAuthorityPreset };
}
