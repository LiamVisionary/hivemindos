import { createHash } from "node:crypto";
import type { IncidentBundle, IncidentInvestigationInput } from "./types";

const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 4_000;
const MAX_ARRAY_LENGTH = 24;
const MAX_OBJECT_KEYS = 48;
const MAX_DEPTH = 5;
const SECRET_KEY_PATTERN = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|pk|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g,
  /\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
];
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAC_HOME_PATTERN = /\/Users\/[^/\s]+/g;
const WINDOWS_HOME_PATTERN = /[A-Za-z]:\\Users\\[^\\\s]+/g;

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function redactText(value: string, protectedValues: string[] = []) {
  let output = value;
  for (const protectedValue of protectedValues.filter(Boolean).sort((left, right) => right.length - left.length)) {
    output = output.split(protectedValue).join("[TARGET]");
  }
  for (const pattern of SECRET_TEXT_PATTERNS) output = output.replace(pattern, REDACTED);
  output = output
    .replace(IPV4_PATTERN, "[IP]")
    .replace(MAC_HOME_PATTERN, "~")
    .replace(WINDOWS_HOME_PATTERN, "~");
  return output.length > MAX_STRING_LENGTH ? `${output.slice(0, MAX_STRING_LENGTH)}…` : output;
}

export function sanitizeIncidentValue(value: unknown, protectedValues: string[] = [], depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return redactText(value, protectedValues);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeIncidentValue(item, protectedValues, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : sanitizeIncidentValue(item, protectedValues, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function createIncidentBundle(
  input: IncidentInvestigationInput,
  options: { now?: () => number } = {},
): IncidentBundle {
  const now = options.now ?? Date.now;
  const targetIdentifier = input.target?.key || input.target?.name || "";
  const protectedValues = [input.target?.key || "", input.target?.name || ""];
  return {
    version: 1,
    capturedAt: new Date(now()).toISOString(),
    summary: redactText(input.summary, protectedValues),
    ...(input.description ? { description: redactText(input.description, protectedValues) } : {}),
    severity: input.severity ?? "warning",
    source: input.source ?? "api",
    ...(targetIdentifier
      ? { target: { ref: `target-${shortHash(targetIdentifier)}`, ...(input.target?.kind ? { kind: redactText(input.target.kind) } : {}) } }
      : {}),
    symptoms: (input.symptoms ?? []).slice(0, MAX_ARRAY_LENGTH).map((symptom) => redactText(symptom, protectedValues)),
    evidence: sanitizeIncidentValue(input.evidence ?? {}, protectedValues) as Record<string, unknown>,
    remediationAttempts: (input.remediationAttempts ?? []).slice(0, MAX_ARRAY_LENGTH).map((attempt) => ({
      action: redactText(attempt.action, protectedValues),
      outcome: redactText(attempt.outcome, protectedValues),
      ...(attempt.at ? { at: redactText(attempt.at) } : {}),
    })),
    ...(input.correlationId ? { correlationId: redactText(input.correlationId, protectedValues) } : {}),
    privacy: { redacted: true, identifiersHashed: true, bounded: true },
  };
}
