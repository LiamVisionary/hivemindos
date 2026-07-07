export type CompanyImportSource = "repo";

export type ImportedScheduleKind =
  | "github-actions"
  | "supabase-cron"
  | "render-cron"
  | "vercel-cron"
  | "package-script"
  | "cron-file"
  | "other";

export type ImportedServiceKind = "render" | "vercel" | "netlify" | "cloudflare" | "other";

export type ImportedScriptCategory = "dev" | "build" | "test" | "ops" | "other";

export interface ImportedGitInfo {
  remoteUrl?: string;
  repoName?: string;
  branch?: string;
  commit?: string;
}

export interface ImportedWorkflow {
  id: string;
  name: string;
  path: string;
  triggers: string[];
  schedules?: string[];
}

export interface ImportedSchedule {
  id: string;
  kind: ImportedScheduleKind;
  name: string;
  path: string;
  schedule?: string;
  command?: string;
  target?: string;
  detail?: string;
}

export interface ImportedService {
  id: string;
  kind: ImportedServiceKind;
  name: string;
  path: string;
  serviceType?: string;
  schedule?: string;
  detail?: string;
}

export interface ImportedScript {
  id: string;
  name: string;
  command: string;
  path: string;
  category: ImportedScriptCategory;
}

export interface CompanyImportedOperations {
  source: CompanyImportSource;
  importedAt: string;
  lastDiscoveredAt: string;
  projectPath?: string;
  packageName?: string;
  git?: ImportedGitInfo;
  workflows: ImportedWorkflow[];
  schedules: ImportedSchedule[];
  services: ImportedService[];
  scripts: ImportedScript[];
}

export interface CompanyImportPreview {
  repoPath: string;
  suggestedName: string;
  suggestedTicker: string;
  suggestedSector: string;
  suggestedApexGoal: string;
  importedOperations: CompanyImportedOperations;
}

export interface CompanyImportRequest {
  repoPath: string;
  companyName?: string;
  ticker?: string;
  sector?: string;
  apexGoalTitle?: string;
  companyId?: string;
}
