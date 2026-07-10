export type AeonHarness = "claude" | "grok";

export type AeonGateway =
  | "auto"
  | "direct"
  | "bankr"
  | "openrouter"
  | "usepod"
  | "venice"
  | "surplus"
  | "grok";

export type AeonRequirement = {
  key: string;
  optional?: boolean;
};

export type AeonMcpRequirement = {
  slug: string;
  optional?: boolean;
};

export type AeonCliSkill = {
  name: string;
  description: string;
  tags: string[];
  requires: AeonRequirement[];
  mcp: AeonMcpRequirement[];
  category: string;
  pack: string;
  packName?: string;
  enabled: boolean;
  schedule: string;
  var: string;
  model: string;
  harness: string;
};

export type AeonCliConfig = {
  repo: string;
  model: string;
  harness: string;
  gateway: string;
  jsonrenderEnabled: boolean;
  skillsEnabled: number;
  skillsConfigured: number;
};

export type AeonPack = {
  key: string;
  name: string;
  description: string;
  color?: string;
  category?: string;
  default_enabled?: string[];
  skills?: Array<string | { slug: string; name?: string; description?: string; category?: string; enabled?: boolean }>;
  total?: number;
  enabled?: number;
  repo?: string;
  installedCount?: number;
};

export type AeonPackCatalog = {
  firstParty: AeonPack[];
  community: AeonPack[];
};

export type AeonMcpServer = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  [key: string]: unknown;
};

export type AeonMcpCatalogEntry = {
  slug: string;
  name: string;
  url?: string;
  logo?: string;
  description?: string;
  [key: string]: unknown;
};

export type AeonDocument = {
  exists: boolean;
  content: string;
};

export type AeonSoulSnapshot = {
  soul: AeonDocument;
  style: AeonDocument;
};

export type AeonCliSecret = {
  name: string;
  group: string;
  description: string;
  isSet: boolean;
  either?: string | string[];
};

export type AeonCliRun = {
  id: string | number;
  workflow?: string;
  title?: string;
  status: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  url?: string;
};

export type AeonCliRunLog = {
  id: string | number;
  title?: string;
  status?: string;
  conclusion?: string | null;
  summary?: string;
  logs?: string;
  url?: string;
};

export type AeonWorkspaceGeneration = "v0.1" | "legacy" | "invalid";

export type AeonWorkspaceLayout = {
  root: string;
  generation: AeonWorkspaceGeneration;
  hasConfig: boolean;
  hasCli: boolean;
  hasCatalog: boolean;
  hasLegacyManifest: boolean;
  outputDirectories: string[];
};

export type AeonControlPlaneSnapshot = {
  layout: AeonWorkspaceLayout;
  config: AeonCliConfig;
  packs: AeonPackCatalog;
  mcpServers: Record<string, AeonMcpServer>;
  mcpCatalog: AeonMcpCatalogEntry[];
  strategy: AeonDocument;
  soul: AeonSoulSnapshot;
  secrets: AeonCliSecret[];
  chains: { definitions: number; artifacts: number };
  reactive: { configured: boolean; rules: number };
  provenance: { attestations: number };
  health: { enabled: boolean; issues: number; scoreRecords: number };
  okf: { configured: boolean; validatorAvailable: boolean; indexExists: boolean; version?: string; markdownFiles: number };
};
