export type CompanyAeonProfileOption = {
  id: string;
  name: string;
  workspace?: string;
  machineName?: string;
};

export type CompanyAeonSkillOption = {
  slug: string;
  name: string;
  description?: string;
  enabled?: boolean;
  pack?: string;
};

export type CompanyAeonOptionsPayload = {
  profiles: CompanyAeonProfileOption[];
  skills?: CompanyAeonSkillOption[];
};
