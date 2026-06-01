import { execFile } from "node:child_process";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";

const execFileAsync = promisify(execFile);

export type MaintenanceCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  repairAction?: string;
};

export type MaintenanceReport = {
  ok: boolean;
  checkedAt: string;
  checks: MaintenanceCheck[];
};

export async function readMaintenanceReport(input: { agents?: AgentProfile[]; sharedVault?: SharedVaultConfig }): Promise<MaintenanceReport> {
  const checks = await Promise.all([
    checkCommand("node", ["--version"], "Node.js", "Install Node.js 20+ and rerun setup.", undefined),
    checkCommand("pnpm", ["--version"], "pnpm", "Run setup to enable Corepack/pnpm.", "repair-pnpm"),
    checkCommand("sqlite3", ["--version"], "sqlite3", "Install sqlite3 so Hermes session and usage stores can be read.", undefined),
    checkHermes(input.agents ?? []),
    checkPath("Shared vault", input.sharedVault?.enabled ? input.sharedVault.vaultPath : "", "Enable or repair the Brain vault path.", "repair-vault"),
    checkPath("HivemindOS state", "~/.hivemindos", "Create local state folder.", "repair-state"),
    checkCommand("git", ["status", "--short"], "Git workspace", "Open this project from a Git checkout.", undefined, process.cwd()),
  ]);
  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

export async function runMaintenanceRepair(action: string, input: { sharedVault?: SharedVaultConfig }) {
  if (action === "diagnostic-dump") {
    return createDiagnosticDump(input);
  }
  if (action === "repair-state") {
    await mkdir(join(homedir(), ".hivemindos"), { recursive: true, mode: 0o700 });
    return { ok: true, message: "Created ~/.hivemindos." };
  }
  if (action === "repair-pnpm") {
    const output = await execFileAsync("corepack", ["prepare", "pnpm@8.6.12", "--activate"], { timeout: 60_000, maxBuffer: 500_000 });
    return { ok: true, message: "Activated pnpm through Corepack.", output: `${output.stdout}${output.stderr}`.trim() };
  }
  if (action === "repair-vault") {
    const vault = expandHome(input.sharedVault?.vaultPath || "");
    if (!vault) return { ok: false, error: "No vault path configured." };
    await mkdir(vault, { recursive: true, mode: 0o700 });
    await writeFile(join(vault, ".hivemindos-healthcheck.md"), `# HivemindOS healthcheck\n\nUpdated: ${new Date().toISOString()}\n`, { flag: "w", mode: 0o600 });
    return { ok: true, message: "Created vault folder and wrote a healthcheck note." };
  }
  if (action === "repair-hermes-background") {
    await mkdir(join(homedir(), ".hivemindos", "runtime-runs"), { recursive: true, mode: 0o700 });
    return { ok: true, message: "Prepared runtime run log folder." };
  }
  return { ok: false, error: `Unknown repair action: ${action}` };
}

async function createDiagnosticDump(input: { sharedVault?: SharedVaultConfig }) {
  const report = await readMaintenanceReport({ sharedVault: input.sharedVault, agents: [] });
  const diagnosticsDir = join(homedir(), ".hivemindos", "diagnostics");
  await mkdir(diagnosticsDir, { recursive: true, mode: 0o700 });
  const file = join(diagnosticsDir, `diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const payload = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    cwd: redactHome(process.cwd()),
    sharedVault: {
      enabled: Boolean(input.sharedVault?.enabled),
      vaultPath: redactHome(input.sharedVault?.vaultPath ?? ""),
      brainServicesFolder: input.sharedVault?.brainServicesFolder,
      kanbanFolder: input.sharedVault?.kanbanFolder,
      scheduledFolder: input.sharedVault?.scheduledFolder,
    },
    report: {
      ...report,
      checks: report.checks.map((check) => ({ ...check, detail: redactHome(check.detail) })),
    },
  };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, message: `Wrote redacted diagnostic dump to ${redactHome(file)}.` };
}

async function checkHermes(agents: AgentProfile[]): Promise<MaintenanceCheck> {
  if (!agents.some((agent) => agent.runtime === "hermes")) {
    return { id: "hermes", label: "Hermes", ok: true, detail: "No Hermes agents configured." };
  }
  const version = await execFileAsync("hermes", ["--version"], { timeout: 5_000, maxBuffer: 200_000 }).catch(() => null);
  if (!version) return { id: "hermes", label: "Hermes", ok: false, detail: "Hermes CLI was not found on PATH.", repairAction: "repair-hermes-background" };
  const dbOk = await access(join(homedir(), ".hermes", "state.db"), constants.R_OK).then(() => true).catch(() => false);
  return {
    id: "hermes",
    label: "Hermes",
    ok: dbOk,
    detail: dbOk ? `Hermes available: ${version.stdout.trim() || "installed"}.` : "Hermes CLI is available, but ~/.hermes/state.db is not readable yet.",
    repairAction: dbOk ? undefined : "repair-hermes-background",
  };
}

async function checkCommand(command: string, args: string[], label: string, failDetail: string, repairAction?: string, cwd?: string): Promise<MaintenanceCheck> {
  const result = await execFileAsync(command, args, { cwd, timeout: 5_000, maxBuffer: 500_000 }).catch(() => null);
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label,
    ok: Boolean(result),
    detail: result ? (result.stdout.trim().split(/\r?\n/)[0] || "Available.") : failDetail,
    repairAction: result ? undefined : repairAction,
  };
}

async function checkPath(label: string, path: string, failDetail: string, repairAction?: string): Promise<MaintenanceCheck> {
  const expanded = expandHome(path);
  if (!expanded) return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, ok: false, detail: failDetail, repairAction };
  const info = await stat(resolve(expanded)).catch(() => null);
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label,
    ok: Boolean(info?.isDirectory()),
    detail: info?.isDirectory() ? `${resolve(expanded)} is readable.` : failDetail,
    repairAction: info?.isDirectory() ? undefined : repairAction,
  };
}

function expandHome(path: string) {
  return path.replace(/^~(?=$|\/)/, homedir()).trim();
}

function redactHome(value: string) {
  return value.replaceAll(homedir(), "~");
}
