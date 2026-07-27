import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, join, resolve } from "path";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { getSharedBrainSkillsCached, syncSharedBrainSkillsToAeon } from "@/lib/services/obsidian/brain-skills";
import { cachedCall, invalidateCachedCall } from "@/lib/services/async-cache";
import { registerAeonEnvSyncRepo } from "@/lib/services/runtime-adapters/aeon-env-sync-registry";
import { AEON_OUTPUT_DIRECTORIES, AEON_MODELS } from "@/lib/services/runtime-adapters/aeon-capabilities";
import { inspectAeonWorkspace } from "@/lib/services/runtime-adapters/aeon-workspace";
import { aeonCli, aeonCliPath, runAeonCli } from "@/lib/services/runtime-adapters/aeon-cli";
import { isValidAeonSkillSlug } from "@/lib/services/runtime-adapters/aeon-identifiers";
import type { AeonCliConfig, AeonCliSkill } from "@/lib/types/aeon-control-plane";
import type {
  RuntimeAdapter,
  RuntimeAnalytics,
  RuntimeMemorySnapshot,
  RuntimeRepoSyncStatus,
  RuntimeRun,
  RuntimeRunLog,
  RuntimeSchedule,
  RuntimeScheduleAction,
  RuntimeSecretStatus,
  RuntimeSkill,
  RuntimeSkillConfigAction,
} from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = "main";
// Short-TTL cache prefixes for the expensive external reads a single dashboard
// refresh fans out to (each spawns the gh CLI or a shell script). Mutating flows
// invalidate the matching prefix so the next read reflects the change.
const RUNS_CACHE_PREFIX = "aeon:runs:";
const GH_SECRETS_CACHE_PREFIX = "aeon:gh-secrets:";
const HIVE_ENV_CACHE_KEY = "aeon:hive-env";
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_AEON_SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "BANKR_LLM_KEY",
  "GH_GLOBAL",
];
const SECRET_LABELS: Record<string, string> = {
  ANTHROPIC_API_KEY: "Claude API",
  CLAUDE_CODE_OAUTH_TOKEN: "Claude Code OAuth",
  BANKR_LLM_KEY: "Bankr LLM gateway",
  GH_GLOBAL: "GitHub automation",
  TELEGRAM_BOT_TOKEN: "Telegram notifications",
  DISCORD_WEBHOOK_URL: "Discord notifications",
  SLACK_WEBHOOK_URL: "Slack notifications",
  RESEND_API_KEY: "Email notifications",
  NEYNAR_API_KEY: "Farcaster distribution",
  OPENAI_API_KEY: "OpenAI-compatible skills",
  OPENROUTER_API_KEY: "OpenRouter skills",
};

function coreSecretKeys(config: AeonCliConfig | null) {
  if (!config) return DEFAULT_AEON_SECRET_KEYS;
  if (config.harness === "grok") return ["GROK_CREDENTIALS", "XAI_API_KEY"];
  const claudeAuth = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
  const gatewayKeys: Record<string, string[]> = {
    direct: claudeAuth,
    bankr: ["BANKR_LLM_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    usepod: ["USEPOD_TOKEN"],
    venice: ["VENICE_API_KEY"],
    surplus: ["SURPLUS_API_KEY"],
    grok: ["XAI_API_KEY"],
    auto: [...claudeAuth, "BANKR_LLM_KEY", "OPENROUTER_API_KEY", "USEPOD_TOKEN", "VENICE_API_KEY", "SURPLUS_API_KEY", "XAI_API_KEY"],
  };
  return gatewayKeys[config.gateway] ?? claudeAuth;
}

type AeonSkillConfig = {
  enabled: boolean;
  schedule: string;
  var: string;
  model: string;
  harness: string;
};

type AeonConfig = {
  skills: Record<string, AeonSkillConfig>;
  model: string;
  harness: string;
  gateway: string;
};

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function clean(value?: string) {
  return value?.trim() || "";
}

export function aeonWorkspaceRoot(profile?: AgentProfile) {
  const configured = clean(profile?.aeonLocalPath)
    || clean(profile?.localDataDir)
    || clean(process.env.AEON_LOCAL_PATH)
    || clean(process.env.AEON_HOME);
  return resolve(expandHome(configured || "~/.aeon"));
}

const aeonRoot = aeonWorkspaceRoot;

function aeonRepo(profile?: AgentProfile) {
  return clean(profile?.aeonRepo) || clean(process.env.AEON_REPO) || clean(process.env.GITHUB_REPO);
}

function aeonBranch(profile?: AgentProfile) {
  return clean(profile?.aeonBranch) || clean(process.env.AEON_BRANCH) || DEFAULT_BRANCH;
}

async function readLocalFile(root: string, path: string) {
  if (!root) return "";
  return readFile(join(root, path), "utf8").catch(() => "");
}

async function countLocalSkillFolders(root: string) {
  const entries = await readdir(join(root, "skills"), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).length;
}

function parseInlineFields(raw: string) {
  const fields: Record<string, string | boolean> = {};
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (const char of raw) {
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = "";
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);

  for (const part of parts) {
    const match = part.match(/^\s*([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    fields[match[1]] = value === "true" ? true : value === "false" ? false : value;
  }
  return fields;
}

// Adapted from aaronjmars/aeon dashboard/lib/config.ts and messages.yml:
// preserve Aeon's simple skill config shape while avoiding a dashboard-wide YAML dependency.
export function parseAeonConfig(raw: string): AeonConfig {
  const skills: Record<string, AeonSkillConfig> = {};
  const model = raw.match(/^model:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim() || "claude-sonnet-4-6";
  const harness = raw.match(/^harness:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim() || "claude";
  const gateway = raw.match(/^gateway:\s*(?:\{[^\n]*provider:\s*)?["']?([^,"'}\n#]+)["']?/m)?.[1]?.trim() || "auto";
  let inSkills = false;
  let current = "";
  for (const line of raw.split(/\r?\n/)) {
    if (/^skills:\s*$/.test(line)) {
      inSkills = true;
      continue;
    }
    if (inSkills && /^[A-Za-z0-9_-]+:\s*/.test(line)) {
      inSkills = false;
      current = "";
    }
    if (!inSkills) continue;

    const inline = line.match(/^  ([A-Za-z0-9_-]+):\s*\{(.+?)\}\s*(?:#.*)?$/);
    if (inline) {
      const fields = parseInlineFields(inline[2]);
      skills[inline[1]] = {
        enabled: fields.enabled === true,
        schedule: typeof fields.schedule === "string" ? fields.schedule : "",
        var: typeof fields.var === "string" ? fields.var : "",
        model: typeof fields.model === "string" ? fields.model : "",
        harness: typeof fields.harness === "string" ? fields.harness : "",
      };
      current = "";
      continue;
    }

    const section = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (section) {
      current = section[1];
      skills[current] = { enabled: true, schedule: "", var: "", model: "", harness: "" };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^    ([A-Za-z0-9_-]+):\s*["']?([^"'\n#]*)["']?/);
    if (!field) continue;
    if (field[1] === "enabled") skills[current].enabled = field[2].trim() !== "false";
    if (field[1] === "schedule") skills[current].schedule = field[2].trim();
    if (field[1] === "var") skills[current].var = field[2].trim();
    if (field[1] === "model") skills[current].model = field[2].trim();
    if (field[1] === "harness") skills[current].harness = field[2].trim();
  }
  return { skills, model, harness, gateway };
}

function updateAeonSkillEnabled(raw: string, skill: string, enabled: boolean) {
  return updateAeonSkillField(raw, skill, "enabled", enabled ? "true" : "false");
}

function updateAeonSkillField(raw: string, skill: string, field: "enabled" | "schedule" | "var" | "model" | "harness", value: string) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const serialized = field === "enabled" ? value : JSON.stringify(value);
  const inlineRe = new RegExp(`^(\\s{2}${escaped}:\\s*\\{[^\\n]*${field}:\\s*)(true|false|\"[^\"]*\"|'[^']*'|[^,}\\n]*)([^\\n]*\\})`, "m");
  if (inlineRe.test(raw)) return raw.replace(inlineRe, `$1${serialized}$3`);
  // Skill exists as an inline `{ ... }` object but is missing this field — merge it into the
  // braces. Without this, the regexes below fall through and append a *duplicate* skill key
  // (e.g. a second `morning-brief:`), corrupting aeon.yml. Trailing comments are preserved.
  const inlineObjRe = new RegExp(`^(\\s{2}${escaped}:\\s*\\{)([^\\n}]*?)(\\})([^\\n]*)$`, "m");
  if (inlineObjRe.test(raw)) {
    return raw.replace(inlineObjRe, (_match, open, inner, _close, trailer) => {
      const body = inner.trim().replace(/,\s*$/, "");
      const next = body ? `${body}, ${field}: ${serialized}` : `${field}: ${serialized}`;
      return `${open} ${next} }${trailer}`;
    });
  }
  const blockRe = new RegExp(`^(\\s{2}${escaped}:\\s*\\n(?:(?:\\s{4}[^\\n]*\\n)*?)\\s{4}${field}:\\s*)([^\\n#]*)`, "m");
  if (blockRe.test(raw)) return raw.replace(blockRe, `$1${serialized}`);
  const sectionRe = new RegExp(`^(\\s{2}${escaped}:\\s*\\n)`, "m");
  if (sectionRe.test(raw)) return raw.replace(sectionRe, `$1    ${field}: ${serialized}\n`);
  if (/^skills:\s*$/m.test(raw)) return raw.replace(/^skills:\s*$/m, `skills:\n  ${skill}:\n    enabled: true\n    ${field}: ${serialized}`);
  return `${raw.trimEnd()}\n\nskills:\n  ${skill}:\n    enabled: true\n    ${field}: ${serialized}\n`;
}

async function skillDescription(root: string, slug: string) {
  const content = await readLocalFile(root, join("skills", slug, "SKILL.md"));
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const desc = frontmatter?.[1]?.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  if (desc) return desc;
  return content
    .replace(/^---\n[\s\S]*?\n---/, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/, "").trim())
    .find(Boolean) ?? "";
}

function yamlStringField(raw: string, key: string) {
  const match = raw.match(new RegExp(`^\\s*${key}:\\s*([\"']?)(.*?)\\1\\s*$`, "m"));
  return match?.[2]?.trim() ?? "";
}

async function skillAutomationYaml(root: string, slug: string) {
  const candidates = [
    join("skills", slug, "agents", "openai.yaml"),
    join("skills", slug, "agents", "openai.yml"),
    join("skills", slug, "agents", "aeon.yaml"),
    join("skills", slug, "agents", "aeon.yml"),
  ];
  for (const candidate of candidates) {
    const raw = await readLocalFile(root, candidate);
    if (raw.trim()) return { path: candidate, raw };
  }
  return null;
}

async function automationPromptForSkill(root: string, slug: string, fallback?: string | boolean) {
  const yaml = await skillAutomationYaml(root, slug);
  const yamlPrompt = yaml ? yamlStringField(yaml.raw, "default_prompt") : "";
  const yamlDescription = yaml ? yamlStringField(yaml.raw, "short_description") : "";
  const fallbackText = typeof fallback === "string" ? fallback.trim() : "";
  const description = await skillDescription(root, slug).catch(() => "");
  return {
    yaml,
    prompt: yamlPrompt || yamlDescription || fallbackText || description || `Run ${titleFromSlug(slug)}.`,
  };
}

async function localSkills(root: string, config: AeonConfig): Promise<RuntimeSkill[]> {
  const cliSkills = await aeonCli.skills(root).catch(() => null);
  if (cliSkills) return cliSkills.map(runtimeSkillFromCli);

  const skills: RuntimeSkill[] = [];
  const manifest = await readLocalFile(root, "skills.json");
  if (manifest.trim()) {
    try {
      const parsed = JSON.parse(manifest) as { skills?: Array<{ slug?: string; name?: string; description?: string; category?: string; schedule?: string; var?: string; source?: string; skillMdPath?: string; checksum?: string }> };
      if (Array.isArray(parsed.skills)) {
        skills.push(...parsed.skills.filter((skill) => skill.slug).map((skill) => {
          const slug = String(skill.slug);
          const cfg = config.skills[slug];
          return {
            slug,
            name: skill.name || titleFromSlug(slug),
            description: skill.description || "",
            category: skill.category,
            enabled: cfg?.enabled,
            schedule: cfg?.schedule || skill.schedule,
            var: cfg?.var || skill.var,
            model: cfg?.model,
            source: skill.source || "aeon-skills-json",
            path: skill.skillMdPath,
            checksum: skill.checksum,
          };
        }));
      }
    } catch {
      // Fall through to directory scan.
    }
  }

  const skillRoot = join(root, "skills");
  const entries = await readdir(skillRoot, { withFileTypes: true }).catch(() => []);
  const folderSkills = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const cfg = config.skills[entry.name];
    const yaml = await skillAutomationYaml(root, entry.name);
    return {
      slug: entry.name,
      name: titleFromSlug(entry.name),
      description: await skillDescription(root, entry.name),
      enabled: cfg?.enabled,
      schedule: cfg?.schedule,
      var: cfg?.var,
      model: cfg?.model,
      harness: cfg?.harness,
      source: "aeon-skill-folder",
      automationYaml: yaml?.path,
    };
  }));
  return mergeSkills(folderSkills, skills);
}

async function sharedBrainSkills(profile: AgentProfile, config: AeonConfig, vaultPath?: string): Promise<RuntimeSkill[]> {
  if (profile.useSharedVault === false) return [];
  const inventory = await getSharedBrainSkillsCached(vaultPath).catch(() => null);
  return (inventory?.shared ?? []).map((skill) => {
    const cfg = config.skills[skill.slug];
    const configured = Boolean(cfg);
    return {
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      enabled: configured ? cfg?.enabled : undefined,
      schedule: cfg?.schedule,
      var: cfg?.var,
      model: cfg?.model || config.model,
      harness: cfg?.harness || config.harness,
      source: "shared-brain",
      path: skill.path,
      checksum: skill.checksum,
      providerLabel: skill.providerLabel,
    };
  });
}

function mergeSkills(...groups: RuntimeSkill[][]) {
  const merged = new Map<string, RuntimeSkill>();
  for (const skill of groups.flat()) {
    if (!skill.slug) continue;
    const existing = merged.get(skill.slug);
    if (!existing) {
      merged.set(skill.slug, skill);
      continue;
    }
    merged.set(skill.slug, {
      ...skill,
      ...existing,
      description: existing.description || skill.description,
      enabled: existing.enabled ?? skill.enabled,
      schedule: existing.schedule || skill.schedule,
      var: existing.var || skill.var,
      model: existing.model || skill.model,
      harness: existing.harness || skill.harness,
      tags: existing.tags?.length ? existing.tags : skill.tags,
      requires: existing.requires?.length ? existing.requires : skill.requires,
      mcp: existing.mcp?.length ? existing.mcp : skill.mcp,
      pack: existing.pack || skill.pack,
      packName: existing.packName || skill.packName,
      source: existing.source || skill.source,
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function titleFromSlug(slug: string) {
  return slug.split(/[-_]/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function runtimeSkillFromCli(skill: AeonCliSkill): RuntimeSkill {
  return {
    slug: skill.name,
    name: titleFromSlug(skill.name),
    description: skill.description || "",
    category: skill.category,
    enabled: skill.enabled,
    schedule: skill.schedule,
    var: skill.var,
    model: skill.model,
    harness: skill.harness,
    tags: skill.tags,
    requires: skill.requires,
    mcp: skill.mcp,
    pack: skill.pack,
    packName: skill.packName,
    source: "aeon-cli",
    path: join("skills", skill.name, "SKILL.md"),
  };
}

async function readConfig(profile?: AgentProfile) {
  const root = aeonRoot(profile);
  const raw = await readLocalFile(root, "aeon.yml");
  return { root, raw, config: parseAeonConfig(raw) };
}

function schedulesFromConfig(profile: AgentProfile | undefined, config: AeonConfig): RuntimeSchedule[] {
  return Object.entries(config.skills).map(([slug, skill]) => ({
    id: slug,
    runtime: "aeon",
    agentId: profile?.id,
    name: titleFromSlug(slug),
    schedule: skill.schedule || "workflow_dispatch",
    every: skill.schedule || "manual",
    message: skill.var || `Run Aeon skill ${slug}`,
    enabled: skill.enabled,
    lastStatus: undefined,
    source: "aeon.yml",
    metadata: {
      skill: slug,
      model: skill.model || config.model,
      var: skill.var,
    },
  }));
}

async function gh(args: string[], cwd?: string) {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: cwd || process.cwd(),
    timeout: 20_000,
    maxBuffer: 2_000_000,
  });
  return stdout.trim();
}

async function ghWithInput(args: string[], input: string, cwd?: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn("gh", args, {
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`gh ${args.slice(0, 2).join(" ")} timed out`));
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `gh exited with ${code}`));
    });
    child.stdin.end(input);
  });
}

function parseEnv(raw: string) {
  const values: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.replace(/^export\s+/, "").trim();
    if (!ENV_KEY_RE.test(key)) continue;
    let value = rest.join("=").trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && ["\"", "'"].includes(value[0])) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readEnvSource(path: string) {
  const expanded = resolve(expandHome(path));
  const raw = await readFile(expanded, "utf8").catch(() => "");
  return { path: expanded, values: parseEnv(raw) };
}

async function aeonEnvValues(profile: AgentProfile | undefined) {
  const root = aeonRoot(profile);
  const sources = [
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".env"),
    join(homedir(), ".hivemindos", ".env"),
    join(homedir(), ".aeon", ".env"),
    root ? join(root, ".env") : "",
  ].filter(Boolean);
  const loaded = await Promise.all([...new Set(sources)].map(readEnvSource));
  const values: Record<string, string> = {};
  for (const source of loaded) Object.assign(values, source.values);
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && ENV_KEY_RE.test(key)) values[key] = value;
  }
  return {
    values,
    sources: loaded.filter((source) => Object.keys(source.values).length > 0).map((source) => source.path),
  };
}

async function hiveSharedEnvValues() {
  return cachedCall(HIVE_ENV_CACHE_KEY, 15_000, async () => {
    try {
      const { stdout } = await execFileAsync(join(process.cwd(), "scripts", "hive-env-add"), [
        "--export-json",
        "--scope",
        "agent",
        "--runtime",
        "generic",
      ], {
        timeout: 12_000,
        maxBuffer: 1_000_000,
      });
      const parsed = JSON.parse(stdout) as { values?: Record<string, string> };
      return parsed.values && typeof parsed.values === "object" ? parsed.values : {};
    } catch {
      return {};
    }
  });
}

function envKeysFromText(text: string) {
  const matches = text.match(/\b[A-Z][A-Z0-9_]{5,}\b/g) ?? [];
  return [...new Set(matches.filter((key) => /_(API_KEY|TOKEN|SECRET|WEBHOOK_URL|KEY|URL)$/.test(key) || SECRET_LABELS[key]))];
}

async function requiredSecretKeys(profile: AgentProfile, context: { vaultPath?: string }) {
  const { config } = await readConfig(profile);
  const root = aeonRoot(profile);
  const [cliSkills, cliSecrets] = await Promise.all([
    aeonCli.skills(root).catch(() => null),
    aeonCli.secrets(root).catch(() => null),
  ]);
  if (cliSkills && cliSecrets) {
    const usedBy = new Map<string, Set<string>>();
    for (const skill of cliSkills) {
      for (const requirement of skill.requires) {
        const users = usedBy.get(requirement.key) ?? new Set<string>();
        users.add(titleFromSlug(skill.name));
        usedBy.set(requirement.key, users);
      }
    }
    return cliSecrets.map((secret) => ({
      key: secret.name,
      label: secret.description || SECRET_LABELS[secret.name] || secret.name,
      usedIn: [...(usedBy.get(secret.name) ?? [])].sort(),
      isSet: secret.isSet,
      group: secret.group,
      either: secret.either,
    }));
  }
  const skills = await Promise.all([
    root ? localSkills(root, config).catch(() => []) : Promise.resolve([]),
    sharedBrainSkills(profile, config, context.vaultPath).catch(() => []),
  ]).then((groups) => mergeSkills(...groups));
  const usedBy = new Map<string, Set<string>>();
  for (const key of [...DEFAULT_AEON_SECRET_KEYS, ...Object.keys(SECRET_LABELS)]) {
    usedBy.set(key, new Set());
  }
  for (const skill of skills) {
    const haystack = [skill.name, skill.slug, skill.description, skill.var, skill.model, skill.category].filter(Boolean).join("\n");
    for (const key of envKeysFromText(haystack)) {
      if (!usedBy.has(key)) usedBy.set(key, new Set());
      usedBy.get(key)?.add(skill.name || skill.slug);
    }
  }
  return [...usedBy.entries()]
    .filter(([key, users]) => DEFAULT_AEON_SECRET_KEYS.includes(key) || users.size > 0 || SECRET_LABELS[key])
    .map(([key, users]) => ({
      key,
      label: SECRET_LABELS[key] || key.replace(/_/g, " ").toLowerCase(),
      usedIn: [...users].sort(),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

async function syncEnvToGitHubSecrets(
  profile: AgentProfile,
  keys: string[] | undefined,
  options: { allSharedEnv?: boolean } = {},
) {
  const repo = aeonRepo(profile);
  if (!repo) throw new Error("Configure Aeon Repo before syncing env to GitHub secrets.");
  await registerAeonEnvSyncRepo(repo, "aeon-env-sync").catch(() => undefined);
  const [localEnv, sharedValues] = await Promise.all([
    aeonEnvValues(profile),
    hiveSharedEnvValues(),
  ]);
  const values = { ...sharedValues, ...localEnv.values };
  // "Sync all" pushes every key in the shared brain's shared env section. Without it,
  // sync is limited to the explicitly requested keys (or the core default allowlist).
  const root = aeonRoot(profile);
  const [enabledRequirements, cliConfig] = await Promise.all([
    aeonCli.skills(root).then((skills) => skills
      .filter((skill) => skill.enabled)
      .flatMap((skill) => skill.requires.filter((requirement) => !requirement.optional).map((requirement) => requirement.key)))
      .catch(() => []),
    runAeonCli<AeonCliConfig>(root, ["config", "show"]).catch(() => null),
  ]);
  const fallbackKeys = options.allSharedEnv
    ? Object.keys(sharedValues)
    : [...coreSecretKeys(cliConfig), ...enabledRequirements];
  const selectedKeys = [...new Set((keys?.length ? keys : fallbackKeys)
    .map((key) => key.trim())
    .filter(Boolean))];
  const sources = [
    ...localEnv.sources,
    ...(Object.keys(sharedValues).length ? ["hive-env-add shared agent env"] : []),
  ];
  const synced: Array<{ key: string }> = [];
  const skipped: Array<{ key: string; reason: string }> = [];

  // Validate first, then write the remaining secrets concurrently (bounded) — one
  // `gh secret set` process per key is slow when run serially over the full shared env.
  const writable = selectedKeys.filter((key) => {
    if (!ENV_KEY_RE.test(key)) {
      skipped.push({ key, reason: "Invalid env key." });
      return false;
    }
    if (!values[key]) {
      skipped.push({ key, reason: "No value found in HivemindOS, generic agent, Aeon, repo, or process env stores." });
      return false;
    }
    if (key.includes("\0") || values[key].includes("\0")) {
      skipped.push({ key: key.replaceAll("\0", ""), reason: "Value contains NUL bytes and cannot be exposed as a runtime environment variable." });
      return false;
    }
    return true;
  });
  const commandRoot = root || undefined;
  const SECRET_WRITE_CONCURRENCY = 8;
  for (let offset = 0; offset < writable.length; offset += SECRET_WRITE_CONCURRENCY) {
    await Promise.all(writable.slice(offset, offset + SECRET_WRITE_CONCURRENCY).map(async (key) => {
      try {
        await ghWithInput(["secret", "set", key, "-R", repo], values[key], commandRoot);
        synced.push({ key });
      } catch (error) {
        skipped.push({ key, reason: error instanceof Error ? error.message : "GitHub secret sync failed." });
      }
    }));
  }

  // We just wrote secrets — drop the cached name list so the count below (and the
  // next dashboard refresh) reflects what we pushed instead of a pre-sync snapshot.
  invalidateCachedCall(`${GH_SECRETS_CACHE_PREFIX}${repo}`);
  const githubSecretCount = (await listGitHubSecretNames(profile)).size;
  return { repo, githubSecretCount, synced, skipped, sources };
}

async function listGitHubSecretNames(profile: AgentProfile) {
  const repo = aeonRepo(profile);
  if (!repo) return new Set<string>();
  const output = await cachedCall(`${GH_SECRETS_CACHE_PREFIX}${repo}`, 15_000,
    () => gh(["secret", "list", "-R", repo, "--json", "name", "-q", ".[].name"], aeonRoot(profile) || undefined),
  ).catch(() => "");
  return new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function repoArgs(profile?: AgentProfile) {
  const repo = aeonRepo(profile);
  return repo ? ["-R", repo] : [];
}

export type AeonSkillDispatchResult = {
  dispatched: true;
  skill: string;
  source: "aeon-cli" | "github-actions";
  result?: unknown;
};

export async function dispatchAeonSkill(
  profile: AgentProfile | undefined,
  skill: string,
  overrides: { var?: string; model?: string } = {},
): Promise<AeonSkillDispatchResult> {
  if (!isValidAeonSkillSlug(skill)) throw new Error(`Invalid AEON skill: ${skill}.`);
  const { config } = await readConfig(profile);
  const skillConfig = config.skills[skill];
  const root = aeonRoot(profile);
  if (await aeonCliPath(root).then(() => true).catch(() => false)) {
    const result = await aeonCli.runSkill(root, skill, {
      var: overrides.var !== undefined ? overrides.var : skillConfig?.var,
      model: overrides.model !== undefined ? overrides.model : skillConfig?.model,
    });
    invalidateCachedCall(RUNS_CACHE_PREFIX);
    return { dispatched: true, skill, result, source: "aeon-cli" };
  }
  const args = ["workflow", "run", "aeon.yml", ...repoArgs(profile), "--ref", aeonBranch(profile), "-f", `skill=${skill}`];
  const skillVar = overrides.var !== undefined ? overrides.var : skillConfig?.var;
  const model = overrides.model !== undefined ? overrides.model : skillConfig?.model;
  if (skillVar) args.push("-f", `var=${skillVar}`);
  if (model) args.push("-f", `model=${model}`);
  await gh(args, aeonRoot(profile) || undefined);
  // A new run was just queued — drop the cached run list so the refresh that
  // follows a dispatch surfaces it instead of an 8s-stale snapshot.
  invalidateCachedCall(RUNS_CACHE_PREFIX);
  return { dispatched: true, skill, source: "github-actions" };
}

async function setSkillEnabled(profile: AgentProfile | undefined, skill: string, enabled: boolean) {
  const root = aeonRoot(profile);
  if (!root) return { ok: false, error: "Configure an Aeon local path before editing aeon.yml." };
  if (await aeonCliPath(root).then(() => true).catch(() => false)) {
    return { ok: true, result: await aeonCli.enableSkill(root, skill, enabled) };
  }
  const path = join(root, "aeon.yml");
  const raw = await readFile(path, "utf8").catch(() => "");
  const updated = updateAeonSkillEnabled(raw, skill, enabled);
  // `updated === raw` means the skill is already in the requested enabled state — a no-op,
  // not a failure. (updateAeonSkillField adds the skill when it's genuinely missing, so an
  // unchanged file can only mean "already set".) Returning an error here surfaced as a 502
  // when arming a freshly-created skill, whose row is born `enabled: true`.
  if (updated !== raw) await writeFile(path, updated, "utf8");
  return { ok: true, result: { skill, enabled } };
}

async function setSkillConfig(profile: AgentProfile, skill: string, action: RuntimeSkillConfigAction, value: string | boolean) {
  if (action === "enable" || action === "disable") return setSkillEnabled(profile, skill, action === "enable");
  const root = aeonRoot(profile);
  if (!root) return { ok: false, error: "Configure an Aeon local path before editing aeon.yml." };
  if (await aeonCliPath(root).then(() => true).catch(() => false)) {
    if (action === "automate") {
      const { yaml, prompt } = await automationPromptForSkill(root, skill, value);
      const schedule = await aeonCli.scheduleSkill(root, skill, "manual");
      const settings = await aeonCli.setSkill(root, skill, { var: prompt, model: "" });
      const enabled = await aeonCli.enableSkill(root, skill, false);
      return { ok: true, result: { skill, schedule, settings, enabled, automationYaml: yaml?.path } };
    }
    if (action === "schedule") return { ok: true, result: await aeonCli.scheduleSkill(root, skill, String(value ?? "")) };
    if (action === "var" || action === "model" || action === "harness") {
      return { ok: true, result: await aeonCli.setSkill(root, skill, { [action]: String(value ?? "") }) };
    }
  }
  if (action === "automate") {
    const path = join(root, "aeon.yml");
    const raw = await readFile(path, "utf8").catch(() => "skills:\n");
    const { yaml, prompt } = await automationPromptForSkill(root, skill, value);
    let updated = updateAeonSkillField(raw, skill, "schedule", "manual");
    updated = updateAeonSkillField(updated, skill, "var", prompt);
    updated = updateAeonSkillField(updated, skill, "model", "");
    updated = updateAeonSkillField(updated, skill, "enabled", "false");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, updated, "utf8");
    return {
      ok: true,
      result: {
        skill,
        enabled: false,
        schedule: "manual",
        var: prompt,
        model: "",
        automationYaml: yaml?.path,
      },
    };
  }
  const field = action === "schedule" || action === "var" || action === "model" || action === "harness" ? action : null;
  if (!field) return { ok: false, error: `Unsupported Aeon skill config action: ${action}` };
  const path = join(root, "aeon.yml");
  const raw = await readFile(path, "utf8").catch(() => "skills:\n");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, updateAeonSkillField(raw, skill, field, String(value ?? "")), "utf8");
  return { ok: true, result: { skill, [field]: String(value ?? "") } };
}

function runStatus(status?: string, conclusion?: string | null): RuntimeRun["status"] {
  if (status === "queued" || status === "requested" || status === "waiting") return "queued";
  if (status === "in_progress") return "active";
  if (status === "completed") return conclusion === "success" ? "completed" : "failed";
  return "unknown";
}

export async function listAeonRuns(
  profile: AgentProfile,
  options: { strict?: boolean } = {},
): Promise<RuntimeRun[]> {
  const root = aeonRoot(profile);
  const cliRuns = await aeonCli.runs(root, 30).catch(() => null);
  if (cliRuns) return cliRuns.map((run): RuntimeRun => ({
    id: String(run.id),
    runtime: "aeon",
    name: String(run.workflow || run.title || "Aeon run"),
    status: runStatus(run.status, run.conclusion),
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    url: run.url,
  }));

  let output: string;
  try {
    output = await cachedCall(`${RUNS_CACHE_PREFIX}${aeonRepo(profile)}:${root}`, 8_000, () => gh([
      "run",
      "list",
      ...repoArgs(profile),
      "--workflow",
      "aeon.yml",
      "--json",
      "databaseId,displayTitle,status,conclusion,createdAt,updatedAt,url",
      "--limit",
      "30",
    ], root || undefined));
  } catch (error) {
    if (options.strict) {
      throw new Error(
        `Could not inspect AEON workspace run activity: ${error instanceof Error ? error.message : "run lookup failed"}`,
      );
    }
    return [];
  }
  const parsed = JSON.parse(output || "[]") as Array<Record<string, unknown>>;
  return parsed.map((run): RuntimeRun => ({
    id: String(run.databaseId),
    runtime: "aeon",
    name: String(run.displayTitle || "Aeon run"),
    status: runStatus(String(run.status || ""), typeof run.conclusion === "string" ? run.conclusion : null),
    conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    createdAt: typeof run.createdAt === "string" ? run.createdAt : undefined,
    updatedAt: typeof run.updatedAt === "string" ? run.updatedAt : undefined,
    url: typeof run.url === "string" ? run.url : undefined,
  }));
}

function cleanLog(value: string) {
  return value
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/gm, "")
    .trim();
}

async function getRunLog(profile: AgentProfile, runId: string): Promise<RuntimeRunLog> {
  if (!/^\d+$/.test(runId)) throw new Error("Invalid Aeon run id.");
  const root = aeonRoot(profile);
  if (await aeonCliPath(root).then(() => true).catch(() => false)) {
    const run = await aeonCli.runLog(root, runId);
    return {
      id: String(run.id),
      summary: [run.title, `${run.status || "unknown"}${run.conclusion ? ` · ${run.conclusion}` : ""}`, run.summary]
        .filter(Boolean)
        .join("\n"),
      logs: cleanLog(run.logs || ""),
      url: run.url,
    };
  }
  const repo = repoArgs(profile);
  const view = await gh(["run", "view", runId, ...repo, "--json", "displayTitle,status,conclusion,url,jobs"], aeonRoot(profile) || undefined).catch(() => "{}");
  const metadata = JSON.parse(view || "{}") as { displayTitle?: string; status?: string; conclusion?: string | null; url?: string; jobs?: Array<{ name?: string; steps?: Array<{ name?: string; conclusion?: string; status?: string }> }> };
  const logs = await gh(["run", "view", runId, ...repo, "--log"], aeonRoot(profile) || undefined).catch(() => "");
  const failedSteps = (metadata.jobs ?? []).flatMap((job) => (job.steps ?? [])
    .filter((step) => step.conclusion === "failure")
    .map((step) => `${job.name || "job"} / ${step.name || "step"}`));
  const summary = [
    metadata.displayTitle || `Aeon run ${runId}`,
    `${metadata.status || "unknown"}${metadata.conclusion ? ` · ${metadata.conclusion}` : ""}`,
    failedSteps.length ? `Failed: ${failedSteps.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  return { id: runId, summary, logs: cleanLog(logs), url: metadata.url };
}

function skillSlugFromRunName(name: string, skills: RuntimeSkill[]) {
  const normalized = name.toLowerCase();
  return skills.find((skill) => normalized.includes(skill.slug.toLowerCase()) || normalized.includes(skill.name.toLowerCase()))?.slug || "unknown";
}

async function getAnalytics(profile: AgentProfile, context: { vaultPath?: string }): Promise<RuntimeAnalytics> {
  const [runs, skills] = await Promise.all([
    aeonAdapter.listRuns?.(profile, context as never) ?? Promise.resolve([]),
    aeonAdapter.listSkills?.(profile, context as never) ?? Promise.resolve([]),
  ]);
  const skillBySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  const metrics = new Map<string, { total: number; success: number; failure: number; active: number; lastRun?: string; lastConclusion?: string | null }>();
  for (const run of runs) {
    const slug = skillSlugFromRunName(run.name, skills);
    const current = metrics.get(slug) ?? { total: 0, success: 0, failure: 0, active: 0 };
    current.total += 1;
    if (run.status === "completed") current.success += 1;
    if (run.status === "failed") current.failure += 1;
    if (run.status === "active" || run.status === "queued") current.active += 1;
    if (!current.lastRun || String(run.createdAt || "") > current.lastRun) {
      current.lastRun = run.createdAt;
      current.lastConclusion = run.conclusion;
    }
    metrics.set(slug, current);
  }
  const success = runs.filter((run) => run.status === "completed").length;
  const failure = runs.filter((run) => run.status === "failed").length;
  const active = runs.filter((run) => run.status === "active" || run.status === "queued").length;
  const skillMetrics = [...metrics.entries()].map(([slug, item]) => ({
    slug,
    name: skillBySlug.get(slug)?.name || titleFromSlug(slug),
    ...item,
    successRate: item.total ? Math.round((item.success / item.total) * 100) : 0,
  })).sort((left, right) => right.total - left.total);
  const insights: RuntimeAnalytics["insights"] = [];
  for (const item of skillMetrics) {
    if (item.total >= 2 && item.successRate < 50) insights.push({ type: "warning", message: `${item.name} is below 50% success across ${item.total} recent runs.` });
  }
  const idleEnabled = skills.filter((skill) => skill.enabled && !metrics.has(skill.slug));
  if (idleEnabled.length) insights.push({ type: "info", message: `${idleEnabled.length} enabled skill${idleEnabled.length === 1 ? "" : "s"} have no recent GitHub Actions evidence.` });
  if (runs.length && failure === 0) insights.push({ type: "success", message: "No failed AEON runs in the recent window." });
  return {
    summary: {
      totalRuns: runs.length,
      success,
      failure,
      active,
      successRate: runs.length ? Math.round((success / runs.length) * 100) : 0,
      uniqueSkills: skillMetrics.filter((item) => item.slug !== "unknown").length,
    },
    skills: skillMetrics,
    insights,
  };
}

async function listMemoryFiles(root: string, subdir: string) {
  const dir = join(root, "memory", subdir);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return Promise.all(entries.filter((entry) => entry.isFile() && /\.(md|txt|json)$/i.test(entry.name)).map(async (entry) => {
    const path = join(dir, entry.name);
    const raw = await readFile(path, "utf8").catch(() => "");
    const stats = await stat(path).catch(() => null);
    return {
      slug: entry.name.replace(/\.(md|txt|json)$/i, ""),
      title: raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || titleFromSlug(entry.name.replace(/\.(md|txt|json)$/i, "")),
      excerpt: raw.replace(/^#\s+.+$/m, "").trim().slice(0, 600),
      path: path.replace(root, "").replace(/^\//, ""),
      updatedAt: stats?.mtime.toISOString(),
    };
  }));
}

async function getMemory(profile: AgentProfile): Promise<RuntimeMemorySnapshot> {
  const root = aeonRoot(profile);
  if (!root) return { root: "", topics: [], logs: [], issues: [] };
  const [index, topics, logs, issues] = await Promise.all([
    readLocalFile(root, join("memory", "MEMORY.md")),
    listMemoryFiles(root, "topics"),
    listMemoryFiles(root, "logs"),
    listMemoryFiles(root, "issues"),
  ]);
  return { root, index, topics, logs, issues };
}

async function getSecretStatus(profile: AgentProfile, context: { vaultPath?: string; fastSecretStatus?: boolean }): Promise<RuntimeSecretStatus> {
  if (context.fastSecretStatus) return getFastSecretStatus(profile);
  const [required, ghSecrets, sharedValues, localValues] = await Promise.all([
    requiredSecretKeys(profile, context),
    listGitHubSecretNames(profile),
    hiveSharedEnvValues(),
    aeonEnvValues(profile),
  ]);
  return {
    repo: aeonRepo(profile),
    githubSecretCount: ghSecrets.size,
    keys: required.map((item) => ({
      ...item,
      isSet: ("isSet" in item && item.isSet === true) || ghSecrets.has(item.key),
      availableInSharedEnv: Boolean(sharedValues[item.key]),
      availableLocally: Boolean(localValues.values[item.key]),
      guidance: `Add ${item.key} to shared env or the AEON GitHub repo secrets.`,
    })),
  };
}

async function getFastSecretStatus(profile: AgentProfile): Promise<RuntimeSecretStatus> {
  const [sharedValues, localValues] = await Promise.all([
    hiveSharedEnvValues(),
    aeonEnvValues(profile),
  ]);
  const keys = [...new Set([...DEFAULT_AEON_SECRET_KEYS, ...Object.keys(SECRET_LABELS)])].sort();
  return {
    repo: aeonRepo(profile),
    keys: keys.map((key) => ({
      key,
      label: SECRET_LABELS[key] || key.replace(/_/g, " ").toLowerCase(),
      isSet: false,
      availableInSharedEnv: Boolean(sharedValues[key]),
      availableLocally: Boolean(localValues.values[key]),
      usedIn: [],
      guidance: `Add ${key} to shared env or the AEON GitHub repo secrets.`,
    })),
  };
}

async function repoSyncStatus(profile: AgentProfile): Promise<RuntimeRepoSyncStatus> {
  const root = aeonRoot(profile);
  const repo = aeonRepo(profile);
  const branch = aeonBranch(profile);
  if (!root) return { root: "", repo, branch, hasChanges: false, changedFiles: [], behind: 0, ahead: 0 };
  const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: root, timeout: 12_000, maxBuffer: 1_000_000 }).then(({ stdout }) => stdout).catch(() => "");
  const changedFiles = status.split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean);
  const aheadBehind = await execFileAsync("git", ["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`], { cwd: root, timeout: 12_000, maxBuffer: 1_000_000 })
    .then(({ stdout }) => stdout.trim().split(/\s+/).map((value) => Number(value) || 0))
    .catch(() => [0, 0]);
  const lastMessage = await execFileAsync("git", ["log", "-1", "--pretty=%s"], { cwd: root, timeout: 12_000, maxBuffer: 200_000 }).then(({ stdout }) => stdout.trim()).catch(() => "");
  return {
    root,
    repo,
    branch,
    hasChanges: changedFiles.length > 0,
    changedFiles,
    behind: aheadBehind[0] ?? 0,
    ahead: aheadBehind[1] ?? 0,
    lastMessage,
  };
}

async function pullAeonBranch(root: string, branch: string) {
  await execFileAsync("git", ["fetch", "--quiet", "origin", branch], { cwd: root, timeout: 60_000, maxBuffer: 1_000_000 });
  await execFileAsync("git", ["pull", "--ff-only", "origin", branch], { cwd: root, timeout: 90_000, maxBuffer: 2_000_000 });
}

async function pushAeonBranch(root: string, branch: string) {
  try {
    await execFileAsync("git", ["push", "-u", "origin", branch], { cwd: root, timeout: 90_000, maxBuffer: 2_000_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/fetch first|non-fast-forward|failed to push some refs|rejected/i.test(message)) throw error;
    await pullAeonBranch(root, branch);
    await execFileAsync("git", ["push", "-u", "origin", branch], { cwd: root, timeout: 90_000, maxBuffer: 2_000_000 });
  }
}

async function hasStagedChanges(root: string) {
  const result = await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd: root, timeout: 12_000, maxBuffer: 200_000 })
    .then(() => 0)
    .catch((error: { code?: number } | unknown) => (typeof error === "object" && error && "code" in error ? Number(error.code) : 1));
  return result === 1;
}

async function repoSyncAction(profile: AgentProfile, action: "pull" | "push") {
  const root = aeonRoot(profile);
  if (!root) return { ok: false, error: "Configure an Aeon local path before syncing the repo." };
  const branch = aeonBranch(profile);
  if (action === "pull") {
    await pullAeonBranch(root, branch);
    return { ok: true, status: await repoSyncStatus(profile), message: "Pulled AEON repo." };
  }
  if (await aeonCliPath(root).then(() => true).catch(() => false)) {
    await runAeonCli<Record<string, unknown>>(root, ["sync"]);
    return { ok: true, status: await repoSyncStatus(profile), message: "Saved and pushed the AEON repo through the AEON CLI." };
  }
  await execFileAsync("git", ["config", "user.name", "aeonframework"], { cwd: root, timeout: 12_000, maxBuffer: 200_000 }).catch(() => undefined);
  await execFileAsync("git", ["config", "user.email", "aeonframework@proton.me"], { cwd: root, timeout: 12_000, maxBuffer: 200_000 }).catch(() => undefined);
  await pullAeonBranch(root, branch);
  await execFileAsync("git", ["add", "-A"], { cwd: root, timeout: 30_000, maxBuffer: 2_000_000 });
  if (await hasStagedChanges(root)) {
    await execFileAsync("git", ["commit", "-m", "Update AEON dashboard configuration"], { cwd: root, timeout: 60_000, maxBuffer: 2_000_000 });
  }
  await pushAeonBranch(root, branch);
  return { ok: true, status: await repoSyncStatus(profile), message: "Pushed AEON repo." };
}

export const aeonAdapter: RuntimeAdapter = {
  runtime: "aeon",
  label: "Aeon",
  kind: "background",
  capabilities: {
    status: true,
    skills: true,
    schedules: true,
    runs: true,
    outputs: true,
    memory: true,
    notifications: true,
    setup: true,
  },
  defaultProfile: {
    aeonBranch: DEFAULT_BRANCH,
    aeonMode: "github",
  },
  async getStatus(profile) {
    const root = aeonRoot(profile);
    const repo = aeonRepo(profile);
    const [rawConfig, layout, localSkillCount, cliConfig] = await Promise.all([
      readLocalFile(root, "aeon.yml"),
      inspectAeonWorkspace(root),
      root ? countLocalSkillFolders(root) : Promise.resolve(0),
      runAeonCli<AeonCliConfig>(root, ["config", "show"], { timeoutMs: 30_000 }).catch(() => null),
    ]);
    const hasConfig = Boolean(rawConfig.trim());
    const provider = clean(profile.provider) || "anthropic";
    const parsedConfig = parseAeonConfig(rawConfig);
    const model = clean(profile.model) || cliConfig?.model || parsedConfig.model;
    return {
      ok: Boolean(hasConfig || repo),
      runtime: "aeon",
      kind: "background",
      root,
      repo,
      hasConfig,
      generation: layout.generation,
      cliAvailable: layout.hasCli,
      catalogAvailable: layout.hasCatalog,
      localSkillCount,
      harness: cliConfig?.harness || parsedConfig.harness,
      gateway: cliConfig?.gateway || parsedConfig.gateway,
      jsonrenderEnabled: cliConfig?.jsonrenderEnabled ?? false,
      modelSelection: {
        provider,
        model,
        providers: [{
          slug: provider,
          name: provider === "anthropic" ? "Anthropic" : provider,
          models: AEON_MODELS.map((id) => ({ id })),
          totalModels: AEON_MODELS.length,
          isCurrent: true,
          isUserDefined: false,
          source: "aeon.yml",
        }],
      },
    };
  },
  async listSkills(profile, context) {
    const { root, config } = await readConfig(profile);
    const [shared, local] = await Promise.all([
      sharedBrainSkills(profile, config, context.vaultPath),
      root ? localSkills(root, config) : Promise.resolve([]),
    ]);
    const configuredSlugs = new Set(Object.keys(config.skills));
    const runtimeLocal = local.filter((skill) => skill.source !== "shared-brain");
    const configuredShared = shared.filter((skill) => configuredSlugs.has(skill.slug));
    return mergeSkills(configuredShared, runtimeLocal);
  },
  async syncSkills(profile, context) {
    return syncSharedBrainSkillsToAeon({
      vaultPath: context.vaultPath,
      aeonLocalPath: aeonRoot(profile),
    });
  },
  async syncEnv(profile, context) {
    return syncEnvToGitHubSecrets(profile, context.keys, { allSharedEnv: context.allSharedEnv });
  },
  async listSchedules(profile) {
    const { raw, config } = await readConfig(profile);
    if (!raw.trim()) return [];
    return schedulesFromConfig(profile, config);
  },
  async runScheduleAction(profile, action: RuntimeScheduleAction, jobId) {
    try {
      if (action === "run-now") {
        return { ok: true, result: await dispatchAeonSkill(profile, jobId) };
      }
      if (action === "enable") return setSkillEnabled(profile, jobId, true);
      if (action === "disable") return setSkillEnabled(profile, jobId, false);
      return { ok: false, error: `Unsupported Aeon schedule action: ${action}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Aeon schedule action failed." };
    }
  },
  async updateSkillConfig(profile, skill, action, value) {
    try {
      return await setSkillConfig(profile, skill, action, value);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Aeon skill update failed." };
    }
  },
  async listRuns(profile) {
    return listAeonRuns(profile);
  },
  async getRunLog(profile, runId) {
    return getRunLog(profile, runId);
  },
  async getAnalytics(profile, context) {
    return getAnalytics(profile, context);
  },
  async getMemory(profile) {
    return getMemory(profile);
  },
  async getSecretStatus(profile, context) {
    return getSecretStatus(profile, context);
  },
  async getRepoSyncStatus(profile) {
    return repoSyncStatus(profile);
  },
  async runRepoSyncAction(profile, action) {
    try {
      return await repoSyncAction(profile, action);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Aeon repo sync failed." };
    }
  },
  async listOutputs(profile) {
    const root = aeonRoot(profile);
    if (!root) return [];
    const dirs = AEON_OUTPUT_DIRECTORIES.map((path) => join(root, path));
    const groups = await Promise.all(dirs.map(async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      return Promise.all(entries.filter((entry) => entry.isFile() && /\.(md|json|txt)$/i.test(entry.name)).slice(0, 50).map(async (entry) => {
        const file = join(dir, entry.name);
        const stats = await stat(file).catch(() => null);
        return {
          filename: entry.name,
          skill: basename(entry.name).replace(/\.(md|json|txt)$/i, "").replace(/-\d{4}-\d{2}-\d{2}T.*$/, ""),
          source: dirname(file).replace(root, "").replace(/^\//, ""),
          updatedAt: stats?.mtime.toISOString(),
          excerpt: (await readFile(file, "utf8").catch(() => "")).slice(0, 1200),
        };
      }));
    }));
    return groups.flat().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  },
};
