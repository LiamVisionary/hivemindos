import type { Company } from "@/lib/types/company";

export type CompanyMembershipRecord = Pick<Company, "id" | "name" | "agentIds">;
export type CompanyMembershipOwner = Pick<Company, "id" | "name">;

export type CompanyMembershipConflict = {
  agentId: string;
  companies: CompanyMembershipOwner[];
};

export class CompanyMembershipConflictError extends Error {
  readonly conflicts: CompanyMembershipConflict[];
  readonly status = 409;

  constructor(conflicts: CompanyMembershipConflict[]) {
    const first = conflicts[0];
    const companyNames = first?.companies.map((company) => `"${company.name}"`).join(", ") || "another company";
    super(
      first
        ? `Agent "${first.agentId}" already belongs to company ${companyNames}. Duplicate the agent to create a separate operational identity before adding it to another company.`
        : "Each operational agent identity can belong to only one company.",
    );
    this.name = "CompanyMembershipConflictError";
    this.conflicts = conflicts;
  }
}

function normalizedAgentIds(agentIds: readonly string[]): string[] {
  return [...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean))];
}

export function companyMembershipOwners(
  companies: readonly CompanyMembershipRecord[],
): Map<string, CompanyMembershipOwner[]> {
  const owners = new Map<string, CompanyMembershipOwner[]>();
  for (const company of companies) {
    for (const agentId of normalizedAgentIds(company.agentIds ?? [])) {
      const current = owners.get(agentId) ?? [];
      current.push({ id: company.id, name: company.name });
      owners.set(agentId, current);
    }
  }
  return owners;
}

export function findDuplicateCompanyMemberships(
  companies: readonly CompanyMembershipRecord[],
): CompanyMembershipConflict[] {
  return [...companyMembershipOwners(companies).entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([agentId, owners]) => ({ agentId, companies: owners }));
}

export function findCompanyMembershipConflicts(
  companies: readonly CompanyMembershipRecord[],
  targetCompanyId: string,
  agentIds: readonly string[],
): CompanyMembershipConflict[] {
  const conflicts: CompanyMembershipConflict[] = [];
  for (const agentId of normalizedAgentIds(agentIds)) {
    const owners = companies
      .filter((company) => company.id !== targetCompanyId && company.agentIds?.includes(agentId))
      .map((company) => ({ id: company.id, name: company.name }));
    if (owners.length) conflicts.push({ agentId, companies: owners });
  }
  return conflicts;
}

export function assertExclusiveCompanyMembership(
  companies: readonly CompanyMembershipRecord[],
  targetCompanyId: string,
  agentIds: readonly string[],
): void {
  const conflicts = findCompanyMembershipConflicts(companies, targetCompanyId, agentIds);
  if (conflicts.length) throw new CompanyMembershipConflictError(conflicts);
}

export function exclusiveCompanyForAgent<T extends CompanyMembershipRecord>(
  companies: readonly T[],
  agentId: string,
): T | null {
  const normalized = agentId.trim();
  if (!normalized) return null;
  const owners = companies.filter((company) => company.agentIds?.includes(normalized));
  if (owners.length > 1) {
    throw new CompanyMembershipConflictError([{
      agentId: normalized,
      companies: owners.map((company) => ({ id: company.id, name: company.name })),
    }]);
  }
  return owners[0] ?? null;
}
