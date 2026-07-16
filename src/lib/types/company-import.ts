export type CompanyImportSource = "repo" | "data-room";

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
  source: "repo";
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

export interface CompanyImportedKnowledgeDocument {
  id: string;
  sourceName: string;
  relativePath: string;
  title: string;
  format: string;
  sourceBytes: number;
  sourceSha256: string;
  notePath: string;
  warnings: string[];
}

export interface CompanyImportedKnowledge {
  source: "data-room";
  importedAt: string;
  lastDiscoveredAt: string;
  dataRoomPath: string;
  notesFolder: string;
  documents: CompanyImportedKnowledgeDocument[];
  failedFiles: Array<{ sourceName: string; error: string }>;
  totalSourceBytes: number;
}

export interface CompanyDataRoomPreview {
  source: "data-room";
  dataRoomPath: string;
  suggestedName: string;
  suggestedTicker: string;
  suggestedSector: string;
  suggestedApexGoal: string;
  documents: Array<Omit<CompanyImportedKnowledgeDocument, "notePath">>;
  failedFiles: Array<{ sourceName: string; error: string }>;
  totalSourceBytes: number;
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

export interface CompanyDataRoomImportRequest {
  dataRoomPath: string;
  companyName?: string;
  ticker?: string;
  sector?: string;
  apexGoalTitle?: string;
  companyId?: string;
}
