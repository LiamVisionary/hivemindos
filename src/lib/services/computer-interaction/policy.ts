import { proxyInput, redactSecretText } from "@/lib/services/agent-security-proxy";
import type {
  ComputerInteractionAction,
  ComputerInteractionObservation,
  ComputerInteractionPolicy,
  ComputerInteractionPolicyDecision,
} from "./types";

const NON_MUTATING_ACTIONS = new Set(["observe", "screenshot"]);
const CONSEQUENCE_ACTIONS = new Set([
  "submit",
  "send",
  "upload",
  "download",
  "install",
  "delete",
  "purchase",
  "transfer",
  "eval",
  "hive-action",
]);
const SECRET_PARAM_KEYS = /(?:password|passwd|secret|token|api[_-]?key|credential|authorization|cookie)/i;
const TYPED_PARAM_KEYS = /^(?:text|value|script|task|content|message)$/i;

function stableDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizedUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return value.trim();
    return url.toString();
  } catch {
    return value.trim();
  }
}

function normalizeAllowlist(values?: string[]): string[] {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\./, ""))
    .filter(Boolean);
}

function allowedHost(urlValue: string | undefined, allowedDomains?: string[]) {
  const allowlist = normalizeAllowlist(allowedDomains);
  if (!allowlist.length || urlValue === "about:blank") return true;
  if (!urlValue) return false;
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_PARAM_KEYS.test(key)) return "[REDACTED_SECRET]";
  if (TYPED_PARAM_KEYS.test(key) && typeof value === "string" && value) return "[REDACTED_TYPED_TEXT]";
  if (key === "url") return normalizedUrl(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nestedKey, nested]) => [nestedKey, redactValue(nestedKey, nested)]));
  }
  if (typeof value === "string") return redactSecretText(value).text;
  return value;
}

export function redactComputerInteractionParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, redactValue(key, value)]));
}

export function createComputerInteractionObservation(input: {
  adapter: ComputerInteractionObservation["adapter"];
  sequence: number;
  capturedAt?: number;
  url?: string;
  app?: string;
  title?: string;
  content?: string;
  evidence?: string[];
}): ComputerInteractionObservation {
  const capturedAt = input.capturedAt ?? Date.now();
  const content = String(input.content ?? "");
  const injection = content ? proxyInput(content) : { verdict: "allow" as const, text: "" };
  const injectionSuspected = injection.verdict === "block" && injection.trigger?.startsWith("injection:") === true;
  const redacted = redactSecretText(content).text.replace(/\s+/g, " ").trim();
  const normalized = normalizedUrl(input.url);
  const digest = stableDigest([input.adapter, normalized, input.app, input.title, content].filter(Boolean).join("\n"));
  return {
    id: `obs-${input.adapter}-${input.sequence}-${digest}`,
    adapter: input.adapter,
    sequence: input.sequence,
    capturedAt,
    url: normalized,
    app: input.app?.trim() || undefined,
    title: input.title?.trim() || undefined,
    contentDigest: digest,
    contentPreview: redacted ? redacted.slice(0, 240) : undefined,
    injectionSuspected,
    injectionTrigger: injectionSuspected ? injection.trigger : undefined,
    evidence: (input.evidence ?? []).map((item) => redactSecretText(String(item)).text.slice(0, 500)).filter(Boolean).slice(0, 8),
  };
}

export function computerInteractionActionTier(action: ComputerInteractionAction): ComputerInteractionPolicyDecision["tier"] {
  if (NON_MUTATING_ACTIONS.has(action.kind)) return "observe";
  if (action.consequence || CONSEQUENCE_ACTIONS.has(action.kind)) return "consequence";
  return "interact";
}

export function assessComputerInteractionPolicy(input: {
  action: ComputerInteractionAction;
  observation?: ComputerInteractionObservation;
  expectedObservationId?: string;
  policy?: ComputerInteractionPolicy;
}): ComputerInteractionPolicyDecision {
  const policy = input.policy ?? {};
  const tier = computerInteractionActionTier(input.action);
  if (
    tier !== "observe" &&
    input.expectedObservationId &&
    input.action.observationId !== input.expectedObservationId
  ) {
    return { decision: "block", reasonCode: "stale-observation", reason: "The action was planned from a stale observation and must be replanned from the current screen.", tier };
  }
  if ((policy.pauseOnPromptInjection ?? true) && input.observation?.injectionSuspected) {
    return { decision: "pause", reasonCode: "prompt-injection-suspected", reason: "The current page contains instruction-like content that may be prompt injection. Human review is required before continuing.", tier };
  }
  const currentUrl = input.observation?.url;
  const targetUrl = normalizedUrl(input.action.params.url);
  if (!allowedHost(targetUrl ?? currentUrl, policy.allowedDomains)) {
    return { decision: "block", reasonCode: "domain-not-allowed", reason: "The action targets a domain outside this run's allowlist.", tier };
  }
  const allowedApps = (policy.allowedApps ?? []).map((app) => app.trim().toLowerCase()).filter(Boolean);
  const targetApp = (typeof input.action.params.app === "string" ? input.action.params.app : input.observation?.app)?.trim().toLowerCase();
  if (allowedApps.length && (!targetApp || !allowedApps.includes(targetApp))) {
    return { decision: "block", reasonCode: "app-not-allowed", reason: "The action targets an app outside this run's allowlist.", tier };
  }
  if (tier === "consequence" && (policy.requireConfirmationForConsequences ?? true)) {
    return { decision: "confirm", reasonCode: "consequential-action", reason: "This action can create an external consequence and needs explicit approval immediately before execution.", tier };
  }
  return { decision: "allow", reasonCode: "allowed", reason: "The action is within the run policy.", tier };
}
