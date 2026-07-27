import { HIVEMINDOS_TERMS_POLICY } from "./legal-policy";
import { PolicyDocument } from "./PolicyDocument";

type TermsDocumentProps = {
  compact?: boolean;
  showTitle?: boolean;
};

export function TermsDocument({ compact = false, showTitle = true }: TermsDocumentProps) {
  return <PolicyDocument document={HIVEMINDOS_TERMS_POLICY} compact={compact} showTitle={showTitle} />;
}
