/**
 * A Company groups agents into an accountable business unit: a shared charter, a
 * collective budget rollup, and a single kill switch (`frozen`) that halts spend
 * across all member agents. The company owns its member list (`agentIds`), so an
 * agent's company is resolved by reverse lookup — membership lives in exactly one
 * place and is managed from the company itself.
 */
export interface Company {
  id: string;
  name: string;
  /** Member agent ids. Source of truth for company membership. */
  agentIds: string[];
  /** Founder-set direction; the "humans at the edges" charter. */
  charter?: string;
  /** Rolling 24h collective USD spend cap across member agents. 0/undefined = unlimited. */
  dailyBudgetUsd?: number;
  /** Rolling 30d collective USD spend cap across member agents. 0/undefined = unlimited. */
  monthlyBudgetUsd?: number;
  /** Lifetime collective USD spend cap. 0/undefined = unlimited. */
  totalBudgetUsd?: number;
  /** Kill switch: when true, every member agent's spend is blocked. */
  frozen: boolean;
  createdAt: string;
  createdAtMs: number;
  updatedAt: string;
}

export interface CompanySpendRollup {
  companyId: string;
  memberCount: number;
  dailySpentUsd: number;
  monthlySpentUsd: number;
  totalSpentUsd: number;
  dailyRemainingUsd: number | null;
  monthlyRemainingUsd: number | null;
  totalRemainingUsd: number | null;
}
