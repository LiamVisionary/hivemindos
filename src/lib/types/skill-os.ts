export type SkillCapability =
  | "chat"
  | "background"
  | "scheduler"
  | "shell"
  | "browser"
  | "mcp"
  | "http"
  | "filesystem"
  | "wallet"
  | "publishing"
  | "deployment"
  | "analytics"
  | "aeon-workflow";

export type SkillAuditStatus = "trusted" | "review" | "restricted" | "blocked";

export type SkillAuditSeverity = "low" | "medium" | "high";

export type SkillAuditFinding = {
  id: string;
  title: string;
  severity: SkillAuditSeverity;
  detail: string;
  file?: string;
  match?: string;
};

export type SkillAuditResult = {
  status: SkillAuditStatus;
  score: number;
  findings: SkillAuditFinding[];
  requiredApprovals: string[];
  capabilities: SkillCapability[];
  envKeys: string[];
  actionRuntimes: WorkflowActionRuntime[];
  filesAudited: string[];
  recommendedAction: string;
  auditedAt: string;
  sourceRef?: string;
};

export type SkillSourceType = "curated" | "registry" | "github" | "provider" | "shared" | "pack" | "written";

export type SkillManifest = {
  schemaVersion: 1;
  slug: string;
  name: string;
  description: string;
  agentAgnostic: true;
  capabilities: SkillCapability[];
  envKeys: string[];
  source: {
    type: SkillSourceType;
    label: string;
    url?: string;
    repo?: string;
    ref?: string;
    path?: string;
    provenance?: string;
  };
  audit: SkillAuditResult;
  workflowActions: WorkflowAction[];
  normalizedAt: string;
};

export type SkillCatalogEntry = {
  id: string;
  slug: string;
  name: string;
  description: string;
  source: string;
  sourceType: SkillSourceType;
  category?: string;
  tags: string[];
  githubUrl?: string;
  skillMdUrl?: string;
  packagedPath?: string;
  sourceRef?: string;
  capabilities: SkillCapability[];
  envKeys: string[];
  audit?: SkillAuditResult;
  imported?: boolean;
};

export type SkillPack = {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: SkillCapability[];
  audience?: string;
  safety?: string;
  skills: Array<{
    slug: string;
    name: string;
    description: string;
    markdown: string;
  }>;
};

export type SkillRecommendation = {
  id: string;
  skillSlug: string;
  skillName: string;
  reason: string;
  score: number;
  source: string;
  packId?: string;
  capabilities: SkillCapability[];
};

export type WorkflowActionRuntime =
  | "osascript"
  | "http"
  | "shell"
  | "node"
  | "python"
  | "mcp"
  | "tauri-native";

export type WorkflowAction = {
  id: string;
  runtime: WorkflowActionRuntime;
  title?: string;
  description?: string;
  permissions: string[];
  requiresApproval: boolean;
  timeoutMs?: number;
  script?: string;
  command?: string;
  args?: string[];
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
};

export type SkillAnalyticsEvent = {
  id: string;
  skillSlug: string;
  event: "recommended" | "imported" | "audited" | "action-started" | "action-completed" | "action-failed" | "converted" | "improvement-suggested";
  runtime?: string;
  agentId?: string;
  taskSource?: string;
  status?: "success" | "failure" | "blocked" | "review";
  durationMs?: number;
  auditStatus?: SkillAuditStatus;
  note?: string;
  createdAt: string;
};
