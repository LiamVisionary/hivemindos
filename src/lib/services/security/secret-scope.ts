/**
 * Per-agent secret scoping and value redaction.
 *
 * The shared hive env is fleet-wide readable by design — that is what makes a
 * key set once usable everywhere. The cost is that every agent can resolve every
 * credential, so an agent that only needs a search key can also read a wallet
 * key. This module narrows what a given agent resolves, and masks any secret
 * value that reaches text we persist.
 *
 * Deliberately free of `server-only` and of fs: it is pure string/record work so
 * both server services and hermetic suites can use it directly.
 */

/**
 * Key-name patterns that name a credential capable of moving money, taking over
 * an account, or signing on the operator's behalf. Deny-by-default: an agent
 * resolves one of these only when the operator lists it explicitly, because the
 * blast radius of getting it wrong is not recoverable by rotating a search key.
 */
const SENSITIVE_KEY_PATTERNS = [
  /PRIVATE_KEY/i,
  /MNEMONIC/i,
  /SEED_PHRASE/i,
  /WALLET/i,
  /SIGNING/i,
  /_SECRET$/i,
  /SECRET_KEY/i,
  /PASSWORD/i,
  /^AWS_/i,
  /STRIPE/i,
  /BANKR/i,
  /CLAWBANK/i,
];

export function isSensitiveSecretKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export type AgentSecretScope = {
  /** Keys this agent may resolve, in addition to the non-sensitive default set. */
  allowKeys?: readonly string[];
  /** Keys this agent may never resolve, even if they would otherwise be allowed. */
  denyKeys?: readonly string[];
  /** When false, non-sensitive keys are NOT granted by default (read-only agents). */
  allowNonSensitiveByDefault?: boolean;
};

/**
 * Narrow a shared-env snapshot to what one agent may resolve.
 *
 * Order matters: deny always wins, then an explicit allow, then the
 * non-sensitive default. A sensitive key is never granted by the default rung —
 * only by being named.
 */
export function scopeSharedEnvForAgent(
  values: Readonly<Record<string, string>>,
  scope: AgentSecretScope = {},
): Record<string, string> {
  const allow = new Set((scope.allowKeys ?? []).map((key) => key.trim()).filter(Boolean));
  const deny = new Set((scope.denyKeys ?? []).map((key) => key.trim()).filter(Boolean));
  const allowNonSensitive = scope.allowNonSensitiveByDefault !== false;
  const scoped: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (deny.has(key)) continue;
    if (allow.has(key)) {
      scoped[key] = value;
      continue;
    }
    if (!allowNonSensitive) continue;
    if (isSensitiveSecretKey(key)) continue;
    scoped[key] = value;
  }
  return scoped;
}

/** Values shorter than this are too common to mask without wrecking the text. */
const MIN_REDACTABLE_LENGTH = 8;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mask known secret values wherever they appear in text.
 *
 * Keyed on VALUES rather than key names, because the leak we care about is a
 * resolved credential landing in a run log, an error message, or a captured
 * decision — by which point the variable name is long gone.
 *
 * Longest-first so a value that contains a shorter value does not get partially
 * masked into something still recoverable. Values under MIN_REDACTABLE_LENGTH
 * are skipped: masking every occurrence of a 3-character value would shred
 * ordinary prose without protecting anything.
 */
export function redactSecretValues(
  text: string,
  values: Readonly<Record<string, string>> | readonly string[],
): string {
  if (!text) return text;
  const secrets = (Array.isArray(values) ? values : Object.values(values as Record<string, string>))
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length >= MIN_REDACTABLE_LENGTH);
  if (!secrets.length) return text;
  const unique = [...new Set(secrets)].sort((a, b) => b.length - a.length);
  let redacted = text;
  for (const secret of unique) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), "g"), "[redacted]");
  }
  return redacted;
}

/** Redacts every string in a shallow record — for structured context blobs. */
export function redactRecord<T extends Record<string, unknown>>(
  record: T,
  values: Readonly<Record<string, string>> | readonly string[],
): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = typeof value === "string" ? redactSecretValues(value, values) : value;
  }
  return output as T;
}
