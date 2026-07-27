import policyData from "../../../legal/hivemindos-policies.json";

export type HivemindOSPolicySection = {
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
};

export type HivemindOSPolicyDocument = {
  version: string;
  effectiveDate: string;
  title: string;
  eyebrow: string;
  intro: string;
  highlights: readonly string[];
  sections: readonly HivemindOSPolicySection[];
};

export type HivemindOSPolicyBundle = {
  schemaVersion: number;
  source: string;
  publisher: {
    name: string;
    product: string;
    website: string;
    repository: string;
    legalEmail: string;
    privacyEmail: string;
  };
  terms: HivemindOSPolicyDocument;
  privacy: HivemindOSPolicyDocument;
};

export const HIVEMINDOS_POLICIES = policyData as HivemindOSPolicyBundle;
export const HIVEMINDOS_TERMS_POLICY = HIVEMINDOS_POLICIES.terms;
export const HIVEMINDOS_PRIVACY_POLICY = HIVEMINDOS_POLICIES.privacy;

