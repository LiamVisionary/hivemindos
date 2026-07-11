export type GitLawbBindMode = "local" | "tailnet" | "public" | "unknown";

export type GitLawbIdentity = {
  did?: string;
  source: "local" | "missing";
  publicOnly: boolean;
  lastCheckedAt: number;
  error?: string;
};

export type GitLawbCliStatus = {
  glPath?: string;
  remoteHelperPath?: string;
  nodeBinaryPath?: string;
  installed: boolean;
  remoteHelperInstalled: boolean;
  version?: string;
  error?: string;
};

export type GitLawbNodeStatus = {
  enabled: boolean;
  healthy: boolean;
  nodeUrl?: string;
  bindMode: GitLawbBindMode;
  repoCount?: number;
  peerCount?: number;
  mcpAvailable?: boolean;
  error?: string;
};

export type GitLawbRepoLink = {
  repoId?: string;
  repoName?: string;
  remoteUrl?: string;
  nodeUrl?: string;
  branch?: string;
  linkedAt: number;
};

export type GitLawbProofStatus = "ready" | "linked" | "verified" | "unavailable" | "failed";

export type GitLawbProof = {
  id: string;
  kind: "issue" | "pull-request" | "commit" | "ref" | "task" | "agent-memory" | "company-governance";
  status: GitLawbProofStatus;
  actorDid?: string;
  repo?: string;
  branch?: string;
  commit?: string;
  ref?: string;
  title?: string;
  verifiedAt?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type AppBuilderProjectReference = {
  backend: "local" | "managed";
  contractVersion: string;
  templateId: "nextjs";
  status: "creating" | "stopped" | "starting" | "running" | "stopping" | "error";
  localProjectId?: string;
  managedAgentId?: string;
  managedProjectId?: string;
  hostingSiteId?: string;
  hostingUrl?: string;
};

export type GitLawbStatus = {
  cli: GitLawbCliStatus;
  identity: GitLawbIdentity;
  node: GitLawbNodeStatus;
  checkedAt: number;
};

export type HivemindProject = {
  id: string;
  name: string;
  localPath?: string;
  vaultNotePath?: string;
  preferredMachineKey?: string;
  appBuilder?: AppBuilderProjectReference;
  gitlawbRepo?: GitLawbRepoLink;
  allowedAgentIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type ProjectRegistry = {
  projects: HivemindProject[];
  updatedAt: number;
};
