// Secret/tailnet hygiene for memory content flowing into model context or
// telemetry. Mirrors the hive-brain CLI redaction so all layers agree.

const REDACTIONS: Array<[RegExp, string]> = [
  [/\b(sk|pk|rk|ak)-[A-Za-z0-9]{20,}\b/g, "[REDACTED_API_KEY]"],
  [/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/gi, "Bearer [REDACTED]"],
  [/eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g, "[REDACTED_JWT]"],
  [/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]+?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/(password|passwd|secret|api_key|apikey|token)\s*[:=]\s*["']?[A-Za-z0-9!@#$%^&*\-_+]{8,}["']?/gi, "$1=[REDACTED]"],
  [/https?:\/\/100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}(?::\d+)?(?:\/[^\s"'`<>)\]]*)?/g, "[REDACTED_TAILNET_URL]"],
  [/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/g, "[REDACTED_TAILNET_IP]"],
];

export function redactSensitiveText(value: string) {
  let output = String(value ?? "");
  for (const [pattern, replacement] of REDACTIONS) output = output.replace(pattern, replacement);
  return output;
}

// High-confidence secret shapes block a memory write outright; softer shapes
// only warn (prose like "the HIVE token" must not be blocked).
const BLOCKING_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|pk|rk|ak)-[A-Za-z0-9]{20,}\b/, "provider API key"],
  [/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/i, "bearer token"],
  [/eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/, "JWT"],
  [/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, "private key block"],
  [/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/, "raw Tailnet IP"],
];
const WARNING_PATTERNS: Array<[RegExp, string]> = [
  [/(password|passwd|secret|api_key|apikey)\s*[:=]\s*\S{8,}/i, "possible credential assignment"],
];

export function detectSensitiveContent(value: string) {
  const text = String(value ?? "");
  const blockers = BLOCKING_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  const warnings = WARNING_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return { blockers, warnings };
}
