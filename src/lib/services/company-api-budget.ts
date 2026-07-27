import type { CompanyApiBudget } from "@/lib/types/company";

function projectRef(budget: Pick<CompanyApiBudget, "projectId" | "projectNumber">): string {
  return budget.projectId.trim() || budget.projectNumber.trim();
}

/** Stable identity for one provider/API guardrail in one cloud project. */
export function companyApiBudgetScopeKey(
  budget: Pick<CompanyApiBudget, "provider" | "projectId" | "projectNumber" | "service">,
): string {
  return `${budget.provider}:${projectRef(budget)}:${budget.service.trim()}`;
}

export function sameCompanyApiBudgetScope(
  left: Pick<CompanyApiBudget, "provider" | "projectId" | "projectNumber" | "service">,
  right: Pick<CompanyApiBudget, "provider" | "projectId" | "projectNumber" | "service">,
): boolean {
  return companyApiBudgetScopeKey(left) === companyApiBudgetScopeKey(right);
}

/** Provider resource names are server-owned and must survive a client-authored edit. */
export function preserveCompanyApiBudgetProviderState(
  next: CompanyApiBudget,
  current: CompanyApiBudget | undefined,
): CompanyApiBudget {
  return {
    ...next,
    budgetResourceName: current?.budgetResourceName,
  };
}
