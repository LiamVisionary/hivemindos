import type { SreDiagnosis } from "./types";

export type SyntheticIncidentExpectation = {
  requiredKeywords: string[];
  forbiddenKeywords: string[];
  requiredEvidence: string[];
};

export type SyntheticIncidentEvaluation = {
  passed: boolean;
  score: number;
  requiredKeywordHits: string[];
  missingKeywords: string[];
  forbiddenKeywordHits: string[];
  requiredEvidenceHits: string[];
  missingEvidence: string[];
};

function includesNormalized(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function evaluateSyntheticDiagnosis(
  diagnosis: Pick<SreDiagnosis, "report" | "problem" | "rootCause" | "toolCalls">,
  expectation: SyntheticIncidentExpectation,
): SyntheticIncidentEvaluation {
  const diagnosisText = [diagnosis.problem, diagnosis.rootCause, diagnosis.report].join("\n");
  const evidenceText = JSON.stringify(diagnosis.toolCalls);
  const requiredKeywordHits = expectation.requiredKeywords.filter((keyword) => includesNormalized(diagnosisText, keyword));
  const missingKeywords = expectation.requiredKeywords.filter((keyword) => !includesNormalized(diagnosisText, keyword));
  const forbiddenKeywordHits = expectation.forbiddenKeywords.filter((keyword) => includesNormalized(diagnosisText, keyword));
  const requiredEvidenceHits = expectation.requiredEvidence.filter((evidence) => includesNormalized(evidenceText, evidence));
  const missingEvidence = expectation.requiredEvidence.filter((evidence) => !includesNormalized(evidenceText, evidence));
  const totalPositive = expectation.requiredKeywords.length + expectation.requiredEvidence.length;
  const positiveScore = totalPositive
    ? (requiredKeywordHits.length + requiredEvidenceHits.length) / totalPositive
    : 1;
  const score = Math.max(0, positiveScore - forbiddenKeywordHits.length * 0.25);
  return {
    passed: missingKeywords.length === 0 && missingEvidence.length === 0 && forbiddenKeywordHits.length === 0,
    score,
    requiredKeywordHits,
    missingKeywords,
    forbiddenKeywordHits,
    requiredEvidenceHits,
    missingEvidence,
  };
}
