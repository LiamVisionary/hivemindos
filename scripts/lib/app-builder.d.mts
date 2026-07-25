export type LocalAppProject = {
  protocol: "hivemindos.app-builder/v1";
  contractVersion: string;
  id: string;
  backend: "local";
  name: string;
  templateId: "nextjs" | "static";
  directory: string;
  status: "stopped" | "running" | "error";
  dependenciesReady: boolean;
  previewUrl: string | null;
  pid: number | null;
  port: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaticHostingArtifact = {
  protocol: "hivemindos.static-artifact/v1";
  projectId: string;
  digest: string;
  fileCount: number;
  totalBytes: number;
  files: Array<{ path: string; size: number; sha256: string; contentBase64: string }>;
};

export type LocalAppSourceExport = {
  fileName: string;
  contentType: "application/gzip";
  bytes: number;
  sha256: string;
  contentBase64: string;
  sourceFileCount: number;
  sourceBytes: number;
};

export type LocalHostingManifest = {
  project_id: string;
  d1?: string[];
  r2?: string[];
};

export const APP_BUILDER_CONFIRMATIONS: Readonly<Record<string, string>>;
export function loadAppBuilderContract(): Promise<Record<string, unknown>>;
export function createLocalAppProject(input: Record<string, unknown>): Promise<{ created: boolean; project: LocalAppProject }>;
export function adoptLocalAppProject(input: Record<string, unknown>): Promise<{ adopted: boolean; project: LocalAppProject }>;
export function getLocalAppProject(input: Record<string, unknown>): Promise<LocalAppProject>;
export function readLocalHostingManifest(directory: string): Promise<LocalHostingManifest | null>;
export function writeLocalHostingManifest(directory: string, input: {
  projectId: string;
  bindings?: { d1?: string[]; r2?: string[] };
}): Promise<LocalHostingManifest>;
export function readLocalAppSourceCommit(directory: string): Promise<string | null>;
export function listLocalAppFiles(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function readLocalAppFile(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function writeLocalAppFile(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function renameLocalAppFile(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function deleteLocalAppFile(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function installLocalAppDependencies(input: Record<string, unknown>): Promise<{ project: LocalAppProject; output: string }>;
export function startLocalAppProject(input: Record<string, unknown>): Promise<{ project: LocalAppProject }>;
export function stopLocalAppProject(input: Record<string, unknown>): Promise<{ project: LocalAppProject }>;
export function prepareStaticHostingArtifact(directory: string): Promise<StaticHostingArtifact>;
export function prepareDynamicHostingArtifact(directory: string): Promise<{ protocol: "hivemindos.dynamic-worker/v1"; projectId: string; code: string; bytes: number; sha256: string }>;
export function exportLocalAppProject(input: Record<string, unknown>): Promise<LocalAppSourceExport>;
export function cloudflareTemporaryDeploySpec(directory: string, name?: string): Promise<{ command: string; args: string[]; cwd: string; shell: false }>;
export function deployCloudflareTemporaryApp(input: Record<string, unknown>): Promise<{ deploymentUrl: string; claimUrl: string; expiresInSeconds: 3600 }>;
export function runLocalAppBuilderAction(input: Record<string, unknown>): Promise<Record<string, unknown>>;
