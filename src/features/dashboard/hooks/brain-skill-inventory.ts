type BrainSkillProviderLike = {
  skills?: unknown;
};

type BrainSkillInventoryLike = {
  providers?: unknown;
  shared?: unknown;
  totals?: {
    shared?: unknown;
    providerSkills?: unknown;
    importable?: unknown;
  };
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function skillCount(provider: BrainSkillProviderLike) {
  return Array.isArray(provider.skills) ? provider.skills.length : 0;
}

function importableSkillCount(provider: BrainSkillProviderLike) {
  if (!Array.isArray(provider.skills)) return 0;
  return provider.skills.filter((skill) => {
    return typeof skill === "object" && skill !== null && !("imported" in skill && Boolean(skill.imported));
  }).length;
}

export function normalizeBrainSkillInventory(data: BrainSkillInventoryLike) {
  const providers = Array.isArray(data?.providers) ? data.providers as BrainSkillProviderLike[] : [];
  const shared = Array.isArray(data?.shared) ? data.shared : [];
  const totals = data?.totals ?? {};
  const providerSkills = providers.reduce((total, provider) => total + skillCount(provider), 0);
  const importable = providers.reduce((total, provider) => total + importableSkillCount(provider), 0);
  return {
    ...data,
    providers,
    shared,
    totals: {
      ...totals,
      shared: finiteNumber(totals.shared) ? totals.shared : shared.length,
      providerSkills: finiteNumber(totals.providerSkills) ? totals.providerSkills : providerSkills,
      importable: finiteNumber(totals.importable) ? totals.importable : importable,
    },
  };
}
