import "server-only";

import { execFile as execFileCallback } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

import { readCompanies, upsertCompany } from "@/lib/services/companies-store";
import { readProjectRegistry, upsertProject } from "@/lib/services/projects/project-registry";
import type {
  CompanyImportPreview,
  CompanyImportRequest,
  CompanyImportedOperations,
  ImportedGitInfo,
  ImportedSchedule,
  ImportedScript,
  ImportedScriptCategory,
  ImportedService,
  ImportedWorkflow,
} from "@/lib/types/company-import";
import type { Company } from "@/lib/types/company";
import type { HivemindProject } from "@/lib/types/gitlawb";

const execFile = promisify(execFileCallback);

const MAX_FILE_BYTES = 240_000;
const MAX_WALK_FILES = 500;
const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);
const SCRIPT_CATEGORY_PATTERNS: Array<[ImportedScriptCategory, RegExp]> = [
  ["dev", /\b(dev|start|serve|preview)\b/i],
  ["build", /\b(build|compile|bundle|tauri)\b/i],
  ["test", /\b(test|spec|e2e|coverage|lint|typecheck|check)\b/i],
  ["ops", /\b(deploy|sync|cron|schedule|migrate|seed|backup|release)\b/i],
];

type ImportCompanyResult = {
  company: Company;
  project: HivemindProject;
  preview: CompanyImportPreview;
  updatedExisting: boolean;
};

export async function previewCompanyImport(input: Pick<CompanyImportRequest, "repoPath" | "companyName" | "ticker" | "sector" | "apexGoalTitle">): Promise<CompanyImportPreview> {
  const repoPath = await resolveRepoPath(input.repoPath);
  const packageJson = await readPackageJson(repoPath);
  const packageName = stringField(packageJson, "name");
  const repoName = path.basename(repoPath);
  const suggestedName = cleanText(input.companyName) || titleFromSlug(repoName);
  const suggestedTicker = cleanTicker(input.ticker) || tickerForName(suggestedName);
  const suggestedSector = cleanText(input.sector) || sectorFromPackage(packageJson) || "Imported Product";
  const suggestedApexGoal = cleanText(input.apexGoalTitle) || `Keep ${suggestedName}'s existing product operations visible and healthy`;
  const now = new Date().toISOString();

  const git = await discoverGit(repoPath);
  const workflows = await discoverGithubWorkflows(repoPath);
  const schedules = [
    ...schedulesFromWorkflows(workflows),
    ...await discoverSupabaseCrons(repoPath),
    ...await discoverVercelCrons(repoPath),
    ...await discoverCronFiles(repoPath),
  ];
  const render = await discoverRenderServices(repoPath);
  const scripts = discoverPackageScripts(packageJson);

  const importedOperations: CompanyImportedOperations = {
    source: "repo",
    importedAt: now,
    lastDiscoveredAt: now,
    projectPath: repoPath,
    packageName,
    git,
    workflows,
    schedules: [...schedules, ...render.schedules],
    services: render.services,
    scripts,
  };

  return {
    repoPath,
    suggestedName,
    suggestedTicker,
    suggestedSector,
    suggestedApexGoal,
    importedOperations,
  };
}

export async function importCompanyFromRepo(input: CompanyImportRequest): Promise<ImportCompanyResult> {
  const preview = await previewCompanyImport(input);
  const companyName = cleanText(input.companyName) || preview.suggestedName;
  const ticker = cleanTicker(input.ticker) || preview.suggestedTicker;
  const sector = cleanText(input.sector) || preview.suggestedSector;
  const apexGoalTitle = cleanText(input.apexGoalTitle) || preview.suggestedApexGoal;

  const project = await upsertImportedProject({
    name: companyName,
    repoPath: preview.repoPath,
    git: preview.importedOperations.git,
  });
  const existing = await existingImportedCompany(input.companyId, project.project.id, preview.repoPath);

  const company = await upsertCompany({
    id: input.companyId || existing?.id,
    name: companyName,
    ticker,
    sector,
    blurb: `Imported legacy company linked to ${path.basename(preview.repoPath)}.`,
    charter: existing?.charter || `Imported legacy project. Track its repository, automations, scheduled jobs, and operating metrics inside HivemindOS without automatically treating historical or off-platform revenue as HivemindOS revenue share.`,
    status: existing?.status ?? "review",
    projectId: project.project.id,
    apexGoal: {
      title: apexGoalTitle,
      metric: "operational visibility",
      target: "all known production schedules tracked",
      unit: "number",
    },
    importedOperations: {
      ...preview.importedOperations,
      importedAt: existing?.importedOperations?.importedAt ?? preview.importedOperations.importedAt,
    },
  });

  return {
    company,
    project: project.project,
    preview,
    updatedExisting: Boolean(existing),
  };
}

async function upsertImportedProject(input: { name: string; repoPath: string; git?: ImportedGitInfo }) {
  const registry = await readProjectRegistry().catch(() => null);
  const existing = registry?.projects.find((project) => samePath(project.localPath, input.repoPath));
  return upsertProject({
    id: existing?.id,
    name: existing?.name || input.name,
    localPath: input.repoPath,
    gitlawbRepo: input.git?.remoteUrl || input.git?.repoName || input.git?.branch
      ? {
          repoName: input.git.repoName,
          remoteUrl: input.git.remoteUrl,
          branch: input.git.branch,
          linkedAt: Date.now(),
        }
      : existing?.gitlawbRepo,
    allowedAgentIds: existing?.allowedAgentIds ?? [],
  });
}

async function existingImportedCompany(companyId: string | undefined, projectId: string, repoPath: string) {
  const companies = await readCompanies();
  if (companyId) return companies.find((company) => company.id === companyId);
  return companies.find((company) => company.projectId === projectId || samePath(company.importedOperations?.projectPath, repoPath));
}

async function resolveRepoPath(inputPath: string): Promise<string> {
  const raw = cleanText(inputPath);
  if (!raw) throw new Error("Choose a project folder to import.");
  const resolved = path.resolve(raw.replace(/^~(?=\/|$)/, process.env.HOME || ""));
  const stats = await fs.stat(resolved).catch(() => null);
  if (!stats?.isDirectory()) throw new Error("Project folder does not exist.");
  return resolved;
}

async function discoverGit(repoPath: string): Promise<ImportedGitInfo | undefined> {
  const [remoteUrl, branch, commit] = await Promise.all([
    git(repoPath, ["remote", "get-url", "origin"]),
    git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(repoPath, ["rev-parse", "--short", "HEAD"]),
  ]);
  const gitInfo: ImportedGitInfo = {
    remoteUrl: cleanText(remoteUrl),
    repoName: repoNameFromRemote(remoteUrl) || path.basename(repoPath),
    branch: cleanText(branch),
    commit: cleanText(commit),
  };
  return gitInfo.remoteUrl || gitInfo.branch || gitInfo.commit ? gitInfo : undefined;
}

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const result = await execFile("git", ["-C", repoPath, ...args], { timeout: 2_000, maxBuffer: 64_000 });
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

async function discoverGithubWorkflows(repoPath: string): Promise<ImportedWorkflow[]> {
  const dir = path.join(repoPath, ".github", "workflows");
  const files = await listDirectoryFiles(dir, (name) => WORKFLOW_EXTENSIONS.has(path.extname(name).toLowerCase()));
  const workflows: ImportedWorkflow[] = [];
  for (const file of files) {
    const text = await readText(file);
    if (!text) continue;
    const name = firstYamlScalar(text, "name") || titleFromSlug(path.basename(file, path.extname(file)));
    const triggers = workflowTriggers(text);
    const schedules = cronExpressions(text);
    workflows.push({
      id: stableId("gha", relativePath(repoPath, file), name),
      name,
      path: relativePath(repoPath, file),
      triggers: triggers.length ? triggers : ["configured"],
      schedules: schedules.length ? schedules : undefined,
    });
  }
  return workflows.sort((a, b) => a.name.localeCompare(b.name));
}

function schedulesFromWorkflows(workflows: ImportedWorkflow[]): ImportedSchedule[] {
  return workflows.flatMap((workflow) => (workflow.schedules ?? []).map((schedule, index) => ({
    id: stableId("gha-schedule", workflow.path, schedule, String(index)),
    kind: "github-actions",
    name: workflow.name,
    path: workflow.path,
    schedule,
    target: "GitHub Actions",
    detail: workflow.triggers.includes("workflow_dispatch")
      ? "Scheduled workflow; also runnable manually."
      : "Scheduled GitHub Actions workflow.",
  })));
}

async function discoverSupabaseCrons(repoPath: string): Promise<ImportedSchedule[]> {
  const root = path.join(repoPath, "supabase", "migrations");
  const files = await walkFiles(root, (file) => file.endsWith(".sql"));
  const schedules: ImportedSchedule[] = [];
  for (const file of files) {
    const text = await readText(file);
    if (!text || !/cron\.schedule/i.test(text)) continue;
    const calls = text.match(/cron\.schedule\s*\([\s\S]*?\)\s*;/gi) ?? [];
    calls.forEach((call, index) => {
      const strings = sqlStrings(call);
      const name = strings[0] || titleFromSlug(path.basename(file, ".sql"));
      const schedule = strings[1];
      schedules.push({
        id: stableId("supabase-cron", relativePath(repoPath, file), name, schedule ?? String(index)),
        kind: "supabase-cron",
        name,
        path: relativePath(repoPath, file),
        schedule,
        target: "Supabase pg_cron",
        detail: compactSnippet(call),
      });
    });
  }
  return schedules.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverRenderServices(repoPath: string): Promise<{ services: ImportedService[]; schedules: ImportedSchedule[] }> {
  const file = path.join(repoPath, "render.yaml");
  const text = await readText(file);
  if (!text) return { services: [], schedules: [] };
  const entries: Array<{ type?: string; name?: string; schedule?: string }> = [];
  let current: { type?: string; name?: string; schedule?: string } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const typeMatch = line.match(/^\s*-\s*type:\s*(.+?)\s*$/);
    if (typeMatch) {
      if (current) entries.push(current);
      current = { type: stripQuotes(typeMatch[1]) };
      continue;
    }
    if (!current) continue;
    const nameMatch = line.match(/^\s*name:\s*(.+?)\s*$/);
    const scheduleMatch = line.match(/^\s*schedule:\s*(.+?)\s*$/);
    if (nameMatch) current.name = stripQuotes(nameMatch[1]);
    if (scheduleMatch) current.schedule = stripQuotes(scheduleMatch[1]);
  }
  if (current) entries.push(current);

  const services = entries.map((entry, index) => ({
    id: stableId("render-service", entry.name ?? String(index), entry.type ?? ""),
    kind: "render" as const,
    name: entry.name || `Render service ${index + 1}`,
    path: "render.yaml",
    serviceType: entry.type,
    schedule: entry.schedule,
    detail: entry.type ? `Render ${entry.type}` : "Render service",
  }));
  const schedules = services
    .filter((service) => service.serviceType === "cron" || service.schedule)
    .map((service) => ({
      id: stableId("render-cron", service.name, service.schedule ?? ""),
      kind: "render-cron" as const,
      name: service.name,
      path: service.path,
      schedule: service.schedule,
      target: "Render",
      detail: service.detail,
    }));
  return { services, schedules };
}

async function discoverVercelCrons(repoPath: string): Promise<ImportedSchedule[]> {
  const file = path.join(repoPath, "vercel.json");
  const parsed = await readJson(file);
  const crons = Array.isArray(parsed?.crons) ? parsed.crons : [];
  return crons.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const pathValue = stringField(record, "path") || `cron-${index + 1}`;
    return {
      id: stableId("vercel-cron", pathValue, stringField(record, "schedule") ?? String(index)),
      kind: "vercel-cron" as const,
      name: pathValue,
      path: "vercel.json",
      schedule: stringField(record, "schedule"),
      target: "Vercel",
      detail: "Vercel cron",
    };
  });
}

async function discoverCronFiles(repoPath: string): Promise<ImportedSchedule[]> {
  const files = await walkFiles(repoPath, (file) => {
    const rel = relativePath(repoPath, file);
    if (rel.startsWith(".git/") || rel.includes("/node_modules/")) return false;
    return /(^|\/)(crontab|cron)[^/]*$/i.test(path.basename(file));
  });
  return files.map((file) => ({
    id: stableId("cron-file", relativePath(repoPath, file)),
    kind: "cron-file" as const,
    name: titleFromSlug(path.basename(file)),
    path: relativePath(repoPath, file),
    target: "Cron file",
    detail: "Cron-like file detected in the repository.",
  }));
}

function discoverPackageScripts(packageJson: Record<string, unknown> | null): ImportedScript[] {
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[0].trim()))
    .slice(0, 60)
    .map(([name, command]) => ({
      id: stableId("package-script", name, command),
      name,
      command,
      path: "package.json",
      category: scriptCategory(name, command),
    }));
}

function scriptCategory(name: string, command: string): ImportedScriptCategory {
  const text = `${name} ${command}`;
  return SCRIPT_CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

async function readPackageJson(repoPath: string): Promise<Record<string, unknown> | null> {
  return readJson(path.join(repoPath, "package.json"));
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  const text = await readText(file);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readText(file: string): Promise<string> {
  try {
    const stats = await fs.stat(file);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return "";
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function listDirectoryFiles(dir: string, predicate: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && predicate(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

async function walkFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    if (results.length >= MAX_WALK_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= MAX_WALK_FILES) return;
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === "build") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && predicate(full)) results.push(full);
    }
  }
  await walk(root);
  return results.sort();
}

function workflowTriggers(text: string): string[] {
  const triggers = new Set<string>();
  const checks: Array<[string, RegExp]> = [
    ["push", /(^|\n)\s*push\s*:|\bon\s*:\s*\[[^\]]*\bpush\b/i],
    ["pull_request", /(^|\n)\s*pull_request\s*:|\bon\s*:\s*\[[^\]]*\bpull_request\b/i],
    ["schedule", /(^|\n)\s*schedule\s*:/i],
    ["workflow_dispatch", /(^|\n)\s*workflow_dispatch\s*:|\bon\s*:\s*\[[^\]]*\bworkflow_dispatch\b/i],
    ["release", /(^|\n)\s*release\s*:/i],
  ];
  checks.forEach(([label, pattern]) => {
    if (pattern.test(text)) triggers.add(label);
  });
  const inline = text.match(/^\s*on:\s*([A-Za-z_-][A-Za-z0-9_-]*)\s*$/m)?.[1];
  if (inline) triggers.add(inline);
  return [...triggers];
}

function cronExpressions(text: string): string[] {
  return [...text.matchAll(/cron:\s*["']([^"']+)["']/gi)].map((match) => match[1].trim()).filter(Boolean);
}

function firstYamlScalar(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
  return match ? cleanText(stripQuotes(match[1])) : undefined;
}

function sqlStrings(text: string): string[] {
  return [...text.matchAll(/'((?:''|[^'])*)'/g)].map((match) => match[1].replaceAll("''", "'").trim()).filter(Boolean);
}

function compactSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function repoNameFromRemote(remoteUrl?: string) {
  const clean = cleanText(remoteUrl)?.replace(/\.git$/, "");
  if (!clean) return undefined;
  const ssh = clean.match(/:([^/:]+\/[^/]+)$/)?.[1];
  const pathPart = ssh || clean.split("/").slice(-2).join("/");
  return pathPart || undefined;
}

function sectorFromPackage(packageJson: Record<string, unknown> | null) {
  const dependencies = isRecord(packageJson?.dependencies) ? Object.keys(packageJson.dependencies) : [];
  if (dependencies.some((name) => name.includes("three") || name.includes("vrm") || name.includes("livekit"))) return "AI Companion";
  if (dependencies.some((name) => name.includes("next") || name.includes("react"))) return "Web App";
  return undefined;
}

function tickerForName(name: string) {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const preferred = words.length === 1
    ? words[0].slice(0, 4)
    : words.map((word) => word[0]).join("").slice(0, 4);
  return cleanTicker(preferred) || "CO";
}

function titleFromSlug(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase() === "ai" ? "AI" : part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
    || "Imported Company";
}

function relativePath(root: string, file: string) {
  return path.relative(root, file).split(path.sep).join("/");
}

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  return cleanText(value[key]);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanTicker(value: unknown): string | undefined {
  const ticker = typeof value === "string" ? value.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase() : "";
  return ticker || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function samePath(left?: string, right?: string) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}
