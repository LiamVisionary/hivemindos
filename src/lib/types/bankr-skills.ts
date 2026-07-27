export type BankrSkillInstallType = "bankr" | "agent-skill" | "external";

export type BankrSkillCatalogItem = {
  catalogSlug: string;
  displaySlug: string;
  name: string;
  provider: string;
  description: string;
  providerUrl: string;
  sourceUrl: string;
  publicUrl: string;
  logoUrl: string;
  installType: BankrSkillInstallType;
  featured: boolean;
  installCount: number | null;
  installed: boolean;
  installedSlug: string;
};

export type BankrSkillsSnapshot = {
  configured: boolean;
  skills: BankrSkillCatalogItem[];
  installedCount: number;
  installedLimit: number;
  accountError: string;
};

