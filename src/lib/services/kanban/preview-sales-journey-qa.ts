export const PREVIEW_SALES_JOURNEY_CHECKS = [
  "mobile-responsiveness",
  "accessibility",
  "performance",
  "broken-links",
  "factual-accuracy",
  "lead-form-delivery",
  "proposal-links",
  "payment-flow",
] as const;

export type PreviewSalesJourneyCheckId = typeof PREVIEW_SALES_JOURNEY_CHECKS[number];
export type PreviewSalesJourneyCheckStatus = "pass" | "fail" | "warn" | "skip";

export type PreviewSalesJourneyCheck = {
  id: PreviewSalesJourneyCheckId;
  status: PreviewSalesJourneyCheckStatus;
  reason?: string;
  evidence?: string;
};

export type PreviewSalesJourneyQaResult = {
  status: "pass" | "block";
  checks: PreviewSalesJourneyCheck[];
  failureReasons: string[];
  requiredEvidence: string[];
};

const CHECK_ALIASES: Record<string, PreviewSalesJourneyCheckId> = {
  mobile: "mobile-responsiveness",
  responsive: "mobile-responsiveness",
  responsiveness: "mobile-responsiveness",
  "mobile-responsiveness": "mobile-responsiveness",
  a11y: "accessibility",
  accessibility: "accessibility",
  perf: "performance",
  performance: "performance",
  links: "broken-links",
  "broken-links": "broken-links",
  "broken links": "broken-links",
  facts: "factual-accuracy",
  factual: "factual-accuracy",
  "factual-accuracy": "factual-accuracy",
  "factual accuracy": "factual-accuracy",
  form: "lead-form-delivery",
  "lead-form": "lead-form-delivery",
  "lead-form-delivery": "lead-form-delivery",
  "lead form delivery": "lead-form-delivery",
  proposal: "proposal-links",
  "proposal-links": "proposal-links",
  "proposal links": "proposal-links",
  payment: "payment-flow",
  checkout: "payment-flow",
  "payment-flow": "payment-flow",
  "payment flow": "payment-flow",
};

function normalizeStatus(value: string): PreviewSalesJourneyCheckStatus | null {
  const normalized = value.trim().toLowerCase();
  if (["pass", "passed", "ok", "green"].includes(normalized)) return "pass";
  if (["fail", "failed", "error", "red", "block", "blocked"].includes(normalized)) return "fail";
  if (["warn", "warning", "yellow"].includes(normalized)) return "warn";
  if (["skip", "skipped", "n/a", "na"].includes(normalized)) return "skip";
  return null;
}

function normalizeCheckId(value: string): PreviewSalesJourneyCheckId | null {
  return CHECK_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function evaluatePreviewSalesJourneyQa(
  checks: Array<Partial<PreviewSalesJourneyCheck>>,
): PreviewSalesJourneyQaResult {
  const byId = new Map<PreviewSalesJourneyCheckId, PreviewSalesJourneyCheck>();
  for (const check of checks) {
    if (!check.id || !PREVIEW_SALES_JOURNEY_CHECKS.includes(check.id)) continue;
    byId.set(check.id, {
      id: check.id,
      status: check.status ?? "fail",
      reason: check.reason,
      evidence: check.evidence,
    });
  }

  const normalizedChecks = PREVIEW_SALES_JOURNEY_CHECKS.map((id) => byId.get(id) ?? {
    id,
    status: "fail" as const,
    reason: "missing automated QA result",
  });
  const failureReasons = normalizedChecks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.id}: ${check.reason || check.status}`);

  return {
    status: failureReasons.length ? "block" : "pass",
    checks: normalizedChecks,
    failureReasons,
    requiredEvidence: PREVIEW_SALES_JOURNEY_CHECKS.map((id) => `Preview QA: ${id}=pass`),
  };
}

export function parsePreviewSalesJourneyQaEvidence(text?: string): PreviewSalesJourneyCheck[] {
  if (!text) return [];
  const checks: PreviewSalesJourneyCheck[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/\b(?:preview|sales journey)\s+qa\b/i.test(line)) continue;
    const matches = line.matchAll(/([a-z][a-z\s-]+?)\s*=\s*(pass|passed|ok|green|fail|failed|error|red|block|blocked|warn|warning|yellow|skip|skipped|n\/a|na)\b(?:\s*\(([^)]*)\))?/gi);
    for (const match of matches) {
      const id = normalizeCheckId(match[1] ?? "");
      const status = normalizeStatus(match[2] ?? "");
      if (!id || !status) continue;
      checks.push({ id, status, evidence: match[3]?.trim() });
    }
  }
  return checks;
}

export function previewSalesJourneyQaBlockReason(result?: string): PreviewSalesJourneyQaResult | null {
  const qa = evaluatePreviewSalesJourneyQa(parsePreviewSalesJourneyQaEvidence(result));
  return qa.status === "block" ? qa : null;
}

export function formatPreviewSalesJourneyQaBlock(result: PreviewSalesJourneyQaResult) {
  return [
    "Preview/sales journey QA blocked customer outreach: at least one critical automated check is missing or failed.",
    `Failure reasons: ${result.failureReasons.join("; ")}.`,
    `Required evidence fields: ${result.requiredEvidence.join("; ")}.`,
  ].join("\n");
}
