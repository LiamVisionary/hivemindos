import { HIVEMINDOS_PRIVACY_POLICY } from "./legal-policy";
import { PolicyDocument } from "./PolicyDocument";

type PrivacyDocumentProps = {
  compact?: boolean;
  showTitle?: boolean;
};

export function PrivacyDocument({ compact = false, showTitle = true }: PrivacyDocumentProps) {
  return <PolicyDocument document={HIVEMINDOS_PRIVACY_POLICY} compact={compact} showTitle={showTitle} />;
}

