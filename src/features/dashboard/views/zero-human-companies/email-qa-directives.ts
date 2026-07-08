export type EmailQaDirectiveLike = {
  deliverableRef?: string | null;
  text?: string | null;
  createdAt?: string | null;
};

export type EmailQaFindingLike = {
  category?: string;
  categoryLabel: string;
  summary?: string;
  suggestion?: string;
  threadUpdatedAt?: number;
};

const EMAIL_QA_DIRECTIVE_PREFIXES = ["Email QA \u2014 ", "Email QA - "];
const CANONICAL_EMAIL_QA_DIRECTIVE_PREFIX = EMAIL_QA_DIRECTIVE_PREFIXES[0];
const TRACKING_PIXEL_KEY = "tracking-pixel";
const SOFT_CTA_STRATEGY_KEY = "soft-cta-strategy";

const LABEL_ALIASES: Record<string, readonly string[]> = {
  "visible tracking-pixel line": [TRACKING_PIXEL_KEY],
  "tracking-pixel": [TRACKING_PIXEL_KEY],
  "tracking pixel": [TRACKING_PIXEL_KEY],
  "off-strategy": [SOFT_CTA_STRATEGY_KEY],
  "off-strategy content": [SOFT_CTA_STRATEGY_KEY],
  strategy: [SOFT_CTA_STRATEGY_KEY],
  "call-to-action": [SOFT_CTA_STRATEGY_KEY],
  cta: [SOFT_CTA_STRATEGY_KEY],
  tone: [SOFT_CTA_STRATEGY_KEY],
};

const TRACKING_PIXEL_RE = /\b(?:tracking[-\s]*pixels?|open[-\s]*pixels?)\b|open\.gif|\/t\/open\b/i;
const SOFT_CTA_STRATEGY_RE = /\b(?:off[-\s]?strategy|soft(?:er)?\s+(?:cta|call[-\s]to[-\s]action)|call[-\s]to[-\s]action|cta|high-cost services|gentle engagement|building relationships|initial outreach|explore (?:the )?(?:preview|options))\b/i;

export function emailQaIssueLabelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function emailQaDeliverableRef(label: string): string {
  return `${CANONICAL_EMAIL_QA_DIRECTIVE_PREFIX}${label.trim()}`;
}

function labelFromEmailQaDirectiveRef(ref: string): string | null {
  const trimmed = ref.trim();
  for (const prefix of EMAIL_QA_DIRECTIVE_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}

function addIssueKeys(keys: Set<string>, value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return;
  const direct = emailQaIssueLabelKey(raw);
  keys.add(direct);
  if (direct.startsWith("ai:")) keys.add(direct.slice("ai:".length));
  for (const alias of LABEL_ALIASES[direct] ?? []) keys.add(alias);
  if (TRACKING_PIXEL_RE.test(raw)) keys.add(TRACKING_PIXEL_KEY);
  if (SOFT_CTA_STRATEGY_RE.test(raw)) keys.add(SOFT_CTA_STRATEGY_KEY);
}

function emailQaIssueMatchKeys(input: {
  category?: string | null;
  categoryLabel?: string | null;
  summary?: string | null;
  suggestion?: string | null;
  text?: string | null;
}): Set<string> {
  const keys = new Set<string>();
  addIssueKeys(keys, input.category);
  addIssueKeys(keys, input.categoryLabel);
  addIssueKeys(keys, input.summary);
  addIssueKeys(keys, input.suggestion);
  addIssueKeys(keys, input.text);
  return keys;
}

function emailQaDirectiveMatchKeys(directive: EmailQaDirectiveLike): Set<string> {
  const label = labelFromEmailQaDirectiveRef(directive.deliverableRef ?? "");
  return emailQaIssueMatchKeys({ categoryLabel: label, text: directive.text });
}

export function emailQaHandledIssueLabels(directives: readonly EmailQaDirectiveLike[] = []): Set<string> {
  const handled = new Set<string>();
  for (const directive of directives) {
    const label = labelFromEmailQaDirectiveRef(directive.deliverableRef ?? "");
    if (label) handled.add(emailQaIssueLabelKey(label));
  }
  return handled;
}

export function emailQaHandledIssueCutoffs(directives: readonly EmailQaDirectiveLike[] = []): Map<string, number> {
  const cutoffs = new Map<string, number>();
  for (const directive of directives) {
    const keys = emailQaDirectiveMatchKeys(directive);
    if (keys.size === 0) continue;
    const parsed = directive.createdAt ? Date.parse(directive.createdAt) : Number.POSITIVE_INFINITY;
    const cutoff = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    for (const key of keys) cutoffs.set(key, Math.max(cutoffs.get(key) ?? 0, cutoff));
  }
  return cutoffs;
}

export function isEmailQaIssueHandled(label: string, directives: readonly EmailQaDirectiveLike[] = []): boolean {
  const cutoffs = emailQaHandledIssueCutoffs(directives);
  for (const key of emailQaIssueMatchKeys({ categoryLabel: label })) {
    if (cutoffs.has(key)) return true;
  }
  return false;
}

export function isEmailQaFindingHandled(finding: EmailQaFindingLike, directives: readonly EmailQaDirectiveLike[] = []): boolean {
  const cutoffs = emailQaHandledIssueCutoffs(directives);
  let cutoff: number | undefined;
  for (const key of emailQaIssueMatchKeys(finding)) {
    const matched = cutoffs.get(key);
    if (matched !== undefined) cutoff = Math.max(cutoff ?? 0, matched);
  }
  if (cutoff === undefined) return false;
  return typeof finding.threadUpdatedAt !== "number" || finding.threadUpdatedAt <= cutoff;
}
