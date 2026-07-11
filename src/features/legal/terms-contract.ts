import { HIVEMINDOS_TERMS_POLICY, type HivemindOSPolicySection } from "./legal-policy";

export const HIVEMINDOS_TERMS_VERSION = HIVEMINDOS_TERMS_POLICY.version;
export const HIVEMINDOS_TERMS_EFFECTIVE_DATE = HIVEMINDOS_TERMS_POLICY.effectiveDate;
export const HIVEMINDOS_TERMS_SECTIONS: readonly HivemindOSPolicySection[] = HIVEMINDOS_TERMS_POLICY.sections;
export const HIVEMINDOS_TERMS_ACCEPTANCE_KEY = "hivemindos.terms.acceptance.v1";

export type HivemindOSTermsSection = HivemindOSPolicySection;

export type HivemindOSTermsAcceptance = {
  version: string;
  acceptedAt: string;
};

export function serializeTermsAcceptance(acceptedAt = new Date().toISOString()): string {
  return JSON.stringify({ version: HIVEMINDOS_TERMS_VERSION, acceptedAt });
}

export function currentTermsAcceptance(raw: string | null | undefined): HivemindOSTermsAcceptance | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HivemindOSTermsAcceptance>;
    if (parsed.version !== HIVEMINDOS_TERMS_VERSION || typeof parsed.acceptedAt !== "string") return null;
    if (!Number.isFinite(Date.parse(parsed.acceptedAt))) return null;
    return { version: parsed.version, acceptedAt: parsed.acceptedAt };
  } catch {
    return null;
  }
}

