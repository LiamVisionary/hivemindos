import { access, readFile, readdir } from "fs/promises";
import { constants } from "fs";
import { spawn } from "child_process";
import { join, resolve } from "path";
import type {
  AeonCliConfig,
  AeonCliRun,
  AeonCliRunLog,
  AeonCliSecret,
  AeonCliSkill,
  AeonControlPlaneSnapshot,
  AeonDocument,
  AeonMcpCatalogEntry,
  AeonMcpServer,
  AeonPackCatalog,
  AeonSoulSnapshot,
} from "@/lib/types/aeon-control-plane";
import { countTopLevelYamlItems } from "./aeon-capabilities";
import { inspectAeonWorkspace } from "./aeon-workspace";

type RunAeonCliOptions = {
  stdin?: string;
  timeoutMs?: number;
  dryRun?: boolean;
};

async function executable(path: string) {
  return access(path, constants.X_OK).then(() => true).catch(() => false);
}

export async function aeonCliPath(rootInput: string) {
  const root = resolve(rootInput);
  const candidates = [join(root, "apps", "cli", "aeon"), join(root, "aeon")];
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  throw new Error(`AEON v0.1 CLI was not found in ${root}. Update or re-clone aaronjmars/aeon.`);
}

export function parseAeonCliJson<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("AEON CLI returned no JSON.");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // On first launch the CLI bootstrap can print npm installation output before
    // the JSON payload. Parse a complete JSON suffix without trusting log text.
  }
  const starts = [...trimmed.matchAll(/(?:^|\n)([\[{])/g)].map((match) => (match.index ?? 0) + (match[0].startsWith("\n") ? 1 : 0));
  for (const start of starts) {
    try {
      return JSON.parse(trimmed.slice(start)) as T;
    } catch {
      // Keep looking for the payload boundary.
    }
  }
  throw new Error(`AEON CLI returned malformed JSON: ${trimmed.slice(-600)}`);
}

export async function runAeonCli<T>(rootInput: string, args: string[], options: RunAeonCliOptions = {}): Promise<T> {
  const root = resolve(rootInput);
  const cli = await aeonCliPath(root);
  const cliArgs = [...args];
  if (options.dryRun && !cliArgs.includes("--dry-run")) cliArgs.push("--dry-run");
  if (!cliArgs.includes("--json")) cliArgs.push("--json");
  return new Promise<T>((resolvePromise, reject) => {
    const child = spawn(cli, cliArgs, {
      cwd: root,
      env: { ...process.env, AEON_REPO_ROOT: root, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`AEON CLI timed out while running: aeon ${args.join(" ")}`));
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `AEON CLI exited with ${code}`));
        return;
      }
      try {
        resolvePromise(parseAeonCliJson<T>(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(options.stdin ?? "");
  });
}

async function countFiles(path: string) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".")).length;
}

async function countMarkdownFiles(path: string, depth = 0): Promise<number> {
  if (depth > 6) return 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const counts = await Promise.all(entries.map((entry) => {
    if (entry.name.startsWith(".")) return Promise.resolve(0);
    if (entry.isDirectory()) return countMarkdownFiles(join(path, entry.name), depth + 1);
    return Promise.resolve(entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? 1 : 0);
  }));
  return counts.reduce((total, count) => total + count, 0);
}

async function exists(path: string) {
  return access(path).then(() => true).catch(() => false);
}

export async function readAeonControlPlane(rootInput: string): Promise<AeonControlPlaneSnapshot> {
  const root = resolve(rootInput);
  const layout = await inspectAeonWorkspace(root);
  if (layout.generation !== "v0.1") {
    throw new Error(`AEON v0.1 is required for the control plane; ${root} is ${layout.generation === "legacy" ? "a legacy workspace" : "not an AEON workspace"}.`);
  }
  const [config, packs, mcpServers, mcpCatalog, strategy, soul, secrets, skills, rawConfig, chainArtifacts, attestations, healthIssues, healthScores, okfConfig, okfValidator, okfIndex, okfMarkdownFiles] = await Promise.all([
    runAeonCli<AeonCliConfig>(root, ["config", "show"]),
    runAeonCli<AeonPackCatalog>(root, ["packs", "ls"]),
    runAeonCli<Record<string, AeonMcpServer>>(root, ["mcp", "ls"]),
    runAeonCli<AeonMcpCatalogEntry[]>(root, ["mcp", "catalog"]),
    runAeonCli<AeonDocument>(root, ["strategy", "show"]),
    runAeonCli<AeonSoulSnapshot>(root, ["soul", "show"]),
    runAeonCli<AeonCliSecret[]>(root, ["secrets", "ls"]).catch(() => []),
    runAeonCli<AeonCliSkill[]>(root, ["skills", "ls"]),
    readFile(join(root, "aeon.yml"), "utf8"),
    countFiles(join(root, "output", ".chains")),
    countFiles(join(root, "output", ".attest")),
    countFiles(join(root, "memory", "issues")),
    countFiles(join(root, "memory", "skill-health")),
    exists(join(root, "scripts", "okf-config.json")),
    exists(join(root, "scripts", "okf-validate.mjs")),
    readFile(join(root, "memory", "topics", "index.md"), "utf8").catch(() => ""),
    countMarkdownFiles(join(root, "memory", "topics")),
  ]);
  return {
    layout,
    config,
    packs,
    mcpServers,
    mcpCatalog,
    strategy,
    soul,
    secrets,
    chains: { definitions: countTopLevelYamlItems(rawConfig, "chains"), artifacts: chainArtifacts },
    reactive: {
      configured: countTopLevelYamlItems(rawConfig, "reactive") > 0,
      rules: countTopLevelYamlItems(rawConfig, "reactive"),
    },
    provenance: { attestations },
    health: {
      enabled: skills.find((skill) => skill.name === "skill-health")?.enabled === true,
      issues: healthIssues,
      scoreRecords: healthScores,
    },
    okf: {
      configured: okfConfig,
      validatorAvailable: okfValidator,
      indexExists: Boolean(okfIndex),
      version: okfIndex.match(/^okf_version:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim(),
      markdownFiles: okfMarkdownFiles,
    },
  };
}

export const aeonCli = {
  skills: (root: string) => runAeonCli<AeonCliSkill[]>(root, ["skills", "ls"]),
  runs: (root: string, limit = 30) => runAeonCli<AeonCliRun[]>(root, ["runs", "ls", "--limit", String(limit)]),
  runLog: (root: string, id: string) => runAeonCli<AeonCliRunLog>(root, ["runs", "logs", id]),
  secrets: (root: string) => runAeonCli<AeonCliSecret[]>(root, ["secrets", "ls"]),
  enableSkill: (root: string, name: string, enabled: boolean) => runAeonCli<Record<string, unknown>>(root, ["skills", enabled ? "enable" : "disable", name]),
  scheduleSkill: (root: string, name: string, schedule: string) => runAeonCli<Record<string, unknown>>(root, ["skills", "schedule", name, schedule]),
  setSkill: (root: string, name: string, values: { var?: string; model?: string; harness?: string }) => {
    const args = ["skills", "set", name];
    if (values.var !== undefined) args.push("--var", values.var);
    if (values.model !== undefined) args.push("--model", values.model);
    if (values.harness !== undefined) args.push("--harness", values.harness);
    return runAeonCli<Record<string, unknown>>(root, args);
  },
  runSkill: (root: string, name: string, values: { var?: string; model?: string } = {}) => {
    const args = ["skills", "run", name];
    if (values.var) args.push("--var", values.var);
    if (values.model) args.push("--model", values.model);
    return runAeonCli<Record<string, unknown>>(root, args);
  },
};
