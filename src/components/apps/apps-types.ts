import type { ReactNode } from "react";

export type FoundryTheme = "dark" | "light";
export type FoundryAppState = "running" | "stopped" | "error" | "updating";
export type FoundryReach = "operator" | "agents" | "tailnet";

export type FoundryApiRoute = {
  method: string;
  path: string;
  url: string;
  category: string;
  summary?: string;
  source?: "openapi" | "hivemind";
};

export type FoundryRunningTask = {
  id: string;
  title: string;
  status: string;
  startedAt?: string;
  updatedAt?: string;
  progressPercent?: number;
  currentRound?: number;
  totalRounds?: number;
  detail?: string;
  potentiallyStuck?: boolean;
  stuckReason?: string;
  canCancel?: boolean;
  canKill?: boolean;
  source?: string;
};

export type InstallableServiceAction =
  | "status"
  | "install"
  | "start"
  | "stop"
  | "install-pipx"
  | "install-agent-reach-x"
  | "check-agent-reach-x-auth"
  | "agent-reach-doctor"
  | "test-agent-reach-x-profile"
  | "reset-agent-reach-x";

export type FoundryServicePreflight = {
  key: string;
  ok: boolean;
  detail: string;
  /** Readiness hints (domain, Email Routing, R2) set `blocking: false` so they
   *  inform without gating the Deploy button. Omitted/true means it blocks. */
  blocking?: boolean;
};

export type FoundryServiceAction = {
  action: InstallableServiceAction;
  label: string;
  detail: string;
  disabled?: boolean;
};

export type FoundryPermissionState = {
  fullAccess: boolean;
  label: string;
  detail: string;
  approvedAt?: string;
};

export type FoundryServiceActionInput = {
  profileUrl?: string;
  maxPosts?: number;
  maxReplies?: number;
};

export type FoundryServiceActionResult = {
  ok?: boolean;
  error?: string;
  service?: {
    id: string;
    name: string;
    installed: boolean;
    running: boolean;
    version?: string;
    openUrl?: string;
    detail: string;
  };
  result?: unknown;
};

export type FoundryHost = {
  id: string;
  label: string;
  kind: string;
  place?: string;
  disabled?: boolean;
  detail?: string;
};

export type FoundryHostedApp = {
  id: string;
  name: string;
  mono: string;
  iconUrl?: string;
  accent: string;
  category: string;
  machine: string;
  machineHost?: string;
  port: number;
  version: string;
  state: FoundryAppState;
  updateTo?: string;
  priority?: boolean;
  desc: string;
  reach: FoundryReach;
  agents?: number;
  cpu?: number;
  ram?: number;
  uptime?: string;
  deployed?: string;
  source: string;
  alert?: string;
  logs: Array<[string, string]>;
  openUrl: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  interactive?: boolean;
  serviceKind?: string;
  local?: boolean;
  apiRoutes?: FoundryApiRoute[];
  apiRoutesSource?: "openapi" | "hivemind";
  runningTasks?: FoundryRunningTask[];
  installableServiceId?: string;
  serviceAction?: InstallableServiceAction;
  serviceActionLabel?: string;
  serviceActionDisabled?: boolean;
};

export type FoundryCatalogApp = {
  id: string;
  name: string;
  mono: string;
  accent: string;
  category: string;
  installed?: string;
  featured?: boolean;
  desc: string;
  req: string;
  source: string;
  sourceUrl: string;
  badges: string[];
  handles: string[];
  installableServiceId?: string;
  serviceInstalled?: boolean;
  serviceRunning?: boolean;
  serviceVersion?: string;
  serviceDetail?: string;
  serviceOpenUrl?: string;
  provenance?: {
    packageName: string;
    packageManager: string;
    installCommand: string;
    updatePolicy: string;
  };
  primaryAction?: InstallableServiceAction;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
  preflight?: FoundryServicePreflight[];
  preflightActions?: FoundryServiceAction[];
  securityNotes?: string[];
  permissions?: FoundryPermissionState;
  extra?: ReactNode;
};

export type FoundrySummary = {
  total: number;
  running: number;
  machines: number;
  updates: number;
  attention: number;
};

export type FoundryInstallJob = {
  id: string;
  app: FoundryCatalogApp;
  host: FoundryHost;
  action: InstallableServiceAction;
  actionLabel: string;
};
