import type { Company, CompanyApprovalPolicy, CompanyApprovalPolicyMode, CompanyDirective } from "@/lib/types/company";

const MAX_SUBJECT_LENGTH = 140;

export const COMPANY_APPROVAL_POLICY_MODES: CompanyApprovalPolicyMode[] = ["off", "ask", "never"];

export const DEFAULT_COMPANY_APPROVAL_POLICIES: CompanyApprovalPolicy[] = [
  {
    id: "customer-email-send",
    subject: "sending customer-facing emails",
    mode: "off",
    source: "default",
  },
  {
    id: "customer-website-use",
    subject: "publishing, sending, or handing off a customer-facing website or preview",
    mode: "off",
    source: "default",
  },
];

const PERMISSION_DIRECTIVE_PATTERNS = [
  /\b(?:always\s+)?(?:ask|get|request|require)\s+(?:for\s+)?(?:my|human|operator|the\s+human|the\s+operator|Liam'?s)\s+(?:permission|approval)\s+before\s+(.+)/i,
  /\b(?:always\s+)?(?:ask|request|require)\s+(?:me|the\s+human|the\s+operator|Liam)\s+(?:to\s+approve|for\s+approval)\s+before\s+(.+)/i,
  /\b(?:always\s+)?(?:get|request|require)\s+(?:human|operator|my|Liam'?s)\s+approval\s+before\s+(.+)/i,
];

function stableSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "custom";
}

export function companyApprovalPolicyIdForSubject(subject: string): string {
  return `learned-${stableSlug(subject)}`;
}

function cleanSubject(value: string): string {
  const sentence = value
    .split(/\n+/)[0]
    .split(/\s(?:then|unless|except when|except if)\s/i)[0]
    .trim();
  return sentence
    .replace(/^["'`]+|["'`.!?:;,\s]+$/g, "")
    .replace(/^(?:the\s+crew|agents?|you)\s+/i, "")
    .slice(0, MAX_SUBJECT_LENGTH)
    .trim();
}

export function approvalPolicySubjectFromDirective(text: string): string | null {
  for (const pattern of PERMISSION_DIRECTIVE_PATTERNS) {
    const match = pattern.exec(text);
    const subject = match?.[1] ? cleanSubject(match[1]) : "";
    if (subject) return subject;
  }
  return null;
}

export function learnedApprovalPoliciesFromDirectives(directives: readonly CompanyDirective[] = []): CompanyApprovalPolicy[] {
  const byId = new Map<string, CompanyApprovalPolicy>();
  for (const directive of directives) {
    const subject = approvalPolicySubjectFromDirective(directive.text);
    if (!subject) continue;
    const id = companyApprovalPolicyIdForSubject(subject);
    byId.set(id, {
      id,
      subject,
      mode: "ask",
      source: "learning",
      directiveId: directive.id,
      createdAt: directive.createdAt,
    });
  }
  return [...byId.values()];
}

function normalizeMode(value: unknown): CompanyApprovalPolicyMode {
  return typeof value === "string" && (COMPANY_APPROVAL_POLICY_MODES as string[]).includes(value)
    ? (value as CompanyApprovalPolicyMode)
    : "ask";
}

function normalizePolicy(value: unknown): CompanyApprovalPolicy | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const subject = cleanSubject(typeof raw.subject === "string" ? raw.subject : "");
  if (!subject) return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : companyApprovalPolicyIdForSubject(subject);
  const source = raw.source === "default" || raw.source === "learning" || raw.source === "manual" ? raw.source : "manual";
  return {
    id,
    subject,
    mode: normalizeMode(raw.mode),
    source,
    directiveId: typeof raw.directiveId === "string" && raw.directiveId.trim() ? raw.directiveId.trim() : undefined,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt.trim() : undefined,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt.trim() : undefined,
  };
}

export function normalizeCompanyApprovalPolicies(value: unknown): CompanyApprovalPolicy[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, CompanyApprovalPolicy>();
  for (const entry of value) {
    const policy = normalizePolicy(entry);
    if (!policy) continue;
    byId.set(policy.id, policy);
  }
  return [...byId.values()];
}

export function resolveCompanyApprovalPolicies(
  company: Pick<Company, "approvalPolicies" | "directives">,
): CompanyApprovalPolicy[] {
  const explicit = normalizeCompanyApprovalPolicies(company.approvalPolicies) ?? [];
  const byId = new Map<string, CompanyApprovalPolicy>();
  for (const policy of DEFAULT_COMPANY_APPROVAL_POLICIES) byId.set(policy.id, policy);
  for (const policy of learnedApprovalPoliciesFromDirectives(company.directives)) byId.set(policy.id, policy);
  for (const policy of explicit) {
    const current = byId.get(policy.id);
    byId.set(policy.id, { ...(current ?? {}), ...policy });
  }
  return [...byId.values()];
}

export function activeCompanyApprovalPolicies(
  company: Pick<Company, "approvalPolicies" | "directives">,
): CompanyApprovalPolicy[] {
  return resolveCompanyApprovalPolicies(company).filter((policy) => policy.mode !== "off");
}
