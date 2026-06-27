import { constants } from "fs";
import { access, stat } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "@/lib/home-dir";
import { expandHomePath, resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

export type SystemHealthStatus = "ok" | "degraded" | "down" | "disabled";

export type SystemHealthCheck = {
  id: string;
  label: string;
  status: SystemHealthStatus;
  detail: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type SystemHealthReport = {
  ok: boolean;
  status: SystemHealthStatus;
  generatedAt: string;
  checks: SystemHealthCheck[];
};

export type SystemHealthOptions = {
  now?: Date;
  root?: string;
  vaultPath?: string;
};

const STATUS_SEVERITY: Record<SystemHealthStatus, number> = {
  ok: 0,
  disabled: 0,
  degraded: 1,
  down: 2,
};

const MIN_DASHBOARD_AUTH_SECRET_LENGTH = 32;
const MIN_DASHBOARD_DEVICE_TOKEN_LENGTH = 24;

function check(
  id: string,
  label: string,
  status: SystemHealthStatus,
  detail: string,
  meta?: SystemHealthCheck["meta"],
): SystemHealthCheck {
  return { id, label, status, detail, ...(meta ? { meta } : {}) };
}

async function canAccess(path: string, mode = constants.R_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function dashboardAuthCheck(): Promise<SystemHealthCheck> {
  const authSecret = process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET?.trim() ?? "";
  const deviceToken = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN?.trim() ?? "";
  if (authSecret.length < MIN_DASHBOARD_AUTH_SECRET_LENGTH) {
    return check(
      "dashboard-auth",
      "Dashboard auth",
      "down",
      `Set HIVEMINDOS_DASHBOARD_AUTH_SECRET to at least ${MIN_DASHBOARD_AUTH_SECRET_LENGTH} characters.`,
    );
  }
  if (deviceToken.length < MIN_DASHBOARD_DEVICE_TOKEN_LENGTH) {
    return check(
      "dashboard-auth",
      "Dashboard auth",
      "down",
      `Set HIVEMINDOS_DASHBOARD_DEVICE_TOKEN to at least ${MIN_DASHBOARD_DEVICE_TOKEN_LENGTH} characters.`,
    );
  }
  return check("dashboard-auth", "Dashboard auth", "ok", "Dashboard secret and device token are configured.");
}

async function sharedVaultCheck(vaultPath?: string): Promise<SystemHealthCheck> {
  const resolvedVault = resolveObsidianVaultPath(vaultPath);
  const readable = await canAccess(resolvedVault, constants.R_OK);
  if (!readable || !(await isDirectory(resolvedVault))) {
    return check("shared-vault", "Shared brain vault", "down", "Configured shared vault is not readable.", {
      vaultPath: resolvedVault,
    });
  }

  const agentsPath = join(resolvedVault, "AGENTS.md");
  const skillsIndexPath = join(resolvedVault, "Skills", "README.md");
  const memoryIndexPath = join(resolvedVault, "Operations", "Brain Services", "Agent Memory Index.jsonl");
  const fullVaultIndexPath = join(resolvedVault, "Operations", "Brain Services", "Full Vault Search Index.jsonl");
  const hasAgents = await canAccess(agentsPath);
  const hasSkillsIndex = await canAccess(skillsIndexPath);
  const hasMemoryIndex = await canAccess(memoryIndexPath);
  const hasFullVaultIndex = await canAccess(fullVaultIndexPath);
  const missing = [
    !hasAgents ? "AGENTS.md" : "",
    !hasSkillsIndex ? "Skills/README.md" : "",
    !hasMemoryIndex ? "Agent Memory Index" : "",
    !hasFullVaultIndex ? "Full Vault Search Index" : "",
  ].filter(Boolean);

  if (missing.length > 0) {
    return check("shared-vault", "Shared brain vault", "degraded", `Vault is readable but missing ${missing.join(", ")}.`, {
      vaultPath: resolvedVault,
      hasAgents,
      hasSkillsIndex,
      hasMemoryIndex,
      hasFullVaultIndex,
    });
  }

  return check("shared-vault", "Shared brain vault", "ok", "Vault, agent instructions, skills index, and search indexes are readable.", {
    vaultPath: resolvedVault,
    hasAgents,
    hasSkillsIndex,
    hasMemoryIndex,
    hasFullVaultIndex,
  });
}

async function sharedEnvCheck(): Promise<SystemHealthCheck> {
  const envPath = resolve(expandHomePath("~/.hivemindos/.env"));
  const readable = await canAccess(envPath, constants.R_OK);
  if (!readable) {
    return check("shared-env", "Shared hive env", "disabled", "Shared env file is not present or not readable.", {
      path: envPath,
    });
  }
  return check("shared-env", "Shared hive env", "ok", "Shared env file is present. Secret values are intentionally not read.", {
    path: envPath,
  });
}

async function projectWorkspaceCheck(root: string): Promise<SystemHealthCheck> {
  const packagePath = join(root, "package.json");
  const changelogPath = join(root, "CHANGELOG.md");
  const threatModelPath = join(root, "docs", "THREAT_MODEL.md");
  const readable = await Promise.all([packagePath, changelogPath, threatModelPath].map((path) => canAccess(path)));
  if (readable.every(Boolean)) {
    return check("project-workspace", "Project workspace", "ok", "Package metadata, changelog, and threat model are readable.", {
      root,
    });
  }
  return check("project-workspace", "Project workspace", "degraded", "One or more expected project files are missing.", {
    root,
    packageJson: readable[0],
    changelog: readable[1],
    threatModel: readable[2],
  });
}

export function summarizeSystemHealth(checks: SystemHealthCheck[]): SystemHealthStatus {
  const active = checks.filter((item) => item.status !== "disabled");
  if (active.length === 0) return "disabled";
  return active.reduce<SystemHealthStatus>((worst, item) => (
    STATUS_SEVERITY[item.status] > STATUS_SEVERITY[worst] ? item.status : worst
  ), "ok");
}

export async function collectSystemHealth(options: SystemHealthOptions = {}): Promise<SystemHealthReport> {
  const now = options.now ?? new Date();
  const root = options.root ?? process.cwd();
  const checks = await Promise.all([
    dashboardAuthCheck(),
    sharedVaultCheck(options.vaultPath),
    sharedEnvCheck(),
    projectWorkspaceCheck(root),
  ]);
  const status = summarizeSystemHealth(checks);
  return {
    ok: status === "ok",
    status,
    generatedAt: now.toISOString(),
    checks,
  };
}

export function defaultSharedEnvPath() {
  return join(homedir(), ".hivemindos", ".env");
}
