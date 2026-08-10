import "server-only";

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";
import { optionalEnv } from "@/lib/config/env";
import { homedir } from "@/lib/home-dir";
import mcpSchema from "./schemas/1.0.0/mcp.schema.json";
import pluginSchema from "./schemas/1.0.0/plugin.schema.json";

export const AGENT_PLUGINS_VERSION = "1.0.0";
export const AGENT_PLUGIN_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGIN_MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const MANIFEST_FIELDS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const SKILL_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
export const AGENT_PLUGIN_RUNTIME_HEADERS = new Set([
  "accept",
  "authorization",
  "content-length",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "proxy-authorization",
]);

const manifestAjv = new Ajv2020({ allErrors: true, strict: false });
const mcpAjv = new Ajv2020({ allErrors: true, strict: false });
const validateManifest = manifestAjv.compile(pluginSchema);
const validateMcpServer = mcpAjv.compile({
  ...(mcpSchema.$defs.server as object),
  $defs: mcpSchema.$defs,
});

type JsonRecord = Record<string, unknown>;

export type AgentPluginDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  component?: "plugin" | "skills" | "skill" | "mcp" | "mcp-server" | "extension";
  componentId?: string;
};

export type AgentPluginManifest = {
  $schema: typeof AGENT_PLUGIN_SCHEMA_ID;
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, unknown>;
};

export type AgentPluginSkill = {
  name: string;
  description: string;
  directoryName: string;
  directoryPath: string;
  skillMdPath: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
};

export type AgentPluginStdioServer = {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type AgentPluginHttpServer = {
  type: "streamable-http" | "sse";
  url: string;
  headers?: Record<string, string>;
};

export type AgentPluginMcpServer = {
  name: string;
  config: AgentPluginStdioServer | AgentPluginHttpServer;
};

export type AgentPluginInspection = {
  specificationVersion: typeof AGENT_PLUGINS_VERSION;
  valid: boolean;
  pluginRoot: string;
  manifest?: AgentPluginManifest;
  skills: AgentPluginSkill[];
  mcpServers: AgentPluginMcpServer[];
  extensionNamespaces: string[];
  diagnostics: AgentPluginDiagnostic[];
};

export type MaterializedStdioServer = {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWithin(root: string, target: string, allowRoot = true) {
  const rel = relative(root, target);
  return (allowRoot && rel === "") || (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
}

function displayPath(root: string, target: string) {
  const rel = relative(root, target);
  return rel && !rel.startsWith("..") ? rel.replaceAll("\\", "/") : target;
}

function ajvMessage(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) return "schema validation failed";
  return errors
    .map((error) => {
      const location = error.instancePath || "/";
      return location + " " + (error.message ?? "is invalid");
    })
    .join("; ");
}

function diagnostic(
  severity: AgentPluginDiagnostic["severity"],
  code: string,
  message: string,
  extra: Omit<AgentPluginDiagnostic, "severity" | "code" | "message"> = {},
): AgentPluginDiagnostic {
  return { severity, code, message, ...extra };
}

async function resolveContainedExisting(root: string, candidate: string) {
  const resolved = await realpath(candidate);
  if (!isWithin(root, resolved)) {
    throw new Error("path resolves outside the plugin root");
  }
  return resolved;
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function validateManifestFile(
  root: string,
  diagnostics: AgentPluginDiagnostic[],
): Promise<AgentPluginManifest | undefined> {
  const manifestCandidate = join(root, "plugin.json");
  if (!(await exists(manifestCandidate))) {
    diagnostics.push(diagnostic("error", "manifest-missing", "plugin.json is required at the plugin root.", {
      component: "plugin",
      path: "plugin.json",
    }));
    return undefined;
  }

  let manifestPath: string;
  try {
    manifestPath = await resolveContainedExisting(root, manifestCandidate);
    if (!(await stat(manifestPath)).isFile()) throw new Error("plugin.json is not a regular file");
  } catch (error) {
    diagnostics.push(diagnostic("error", "manifest-path-invalid", error instanceof Error ? error.message : "plugin.json is invalid.", {
      component: "plugin",
      path: "plugin.json",
    }));
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    diagnostics.push(diagnostic("error", "manifest-json-invalid", error instanceof Error ? error.message : "plugin.json is not valid JSON.", {
      component: "plugin",
      path: "plugin.json",
    }));
    return undefined;
  }
  if (!isRecord(parsed)) {
    diagnostics.push(diagnostic("error", "manifest-object-required", "plugin.json must contain a top-level object.", {
      component: "plugin",
      path: "plugin.json",
    }));
    return undefined;
  }

  const candidate: JsonRecord = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!MANIFEST_FIELDS.has(key)) {
      diagnostics.push(diagnostic("warning", "manifest-field-ignored", "Unknown top-level field '" + key + "' was ignored.", {
        component: "plugin",
        path: "plugin.json",
      }));
      continue;
    }
    if (key !== "extensions") candidate[key] = value;
  }

  let extensions: Record<string, unknown> | undefined;
  if ("extensions" in parsed) {
    if (isRecord(parsed.extensions)) {
      extensions = parsed.extensions;
      const names = Object.keys(extensions);
      if (names.length) {
        diagnostics.push(diagnostic("info", "extensions-ignored", "HivemindOS does not implement these client extension namespaces, so their values were ignored: " + names.join(", ") + ".", {
          component: "extension",
          path: "plugin.json",
        }));
      }
    } else {
      diagnostics.push(diagnostic("warning", "extensions-field-ignored", "The non-object extensions field was ignored.", {
        component: "extension",
        path: "plugin.json",
      }));
    }
  }

  if (!validateManifest(candidate)) {
    diagnostics.push(diagnostic("error", "manifest-schema-invalid", "plugin.json does not satisfy Agent Plugins 1.0.0: " + ajvMessage(validateManifest.errors), {
      component: "plugin",
      path: "plugin.json",
    }));
    return undefined;
  }

  const manifest = candidate as AgentPluginManifest;
  return extensions ? { ...manifest, extensions } : manifest;
}

function parseSkillFrontmatter(markdown: string): { metadata?: JsonRecord; error?: string } {
  const match = markdown.match(/^---(?:\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { error: "SKILL.md must start with closed YAML frontmatter." };
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) {
    return { error: "Invalid YAML frontmatter: " + document.errors.map((item) => item.message).join("; ") };
  }
  const value = document.toJS({ maxAliasCount: 100 });
  if (!isRecord(value)) return { error: "SKILL.md frontmatter must be a YAML mapping." };
  return { metadata: value };
}

function validateSkillMetadata(metadata: JsonRecord, directoryName: string) {
  const errors: string[] = [];
  const unknown = Object.keys(metadata).filter((key) => !SKILL_FIELDS.has(key));
  if (unknown.length) errors.push("unexpected frontmatter fields: " + unknown.sort().join(", "));

  const rawName = metadata.name;
  if (typeof rawName !== "string" || !rawName.trim()) {
    errors.push("name must be a non-empty string");
  } else {
    const name = rawName.trim().normalize("NFKC");
    if (name.length > 64) errors.push("name exceeds 64 characters");
    if (name !== name.toLowerCase()) errors.push("name must be lowercase");
    if (name.startsWith("-") || name.endsWith("-")) errors.push("name cannot start or end with a hyphen");
    if (name.includes("--")) errors.push("name cannot contain consecutive hyphens");
    if (!/^[\p{L}\p{N}-]+$/u.test(name)) errors.push("name may contain only letters, digits, and hyphens");
    if (directoryName.normalize("NFKC") !== name) errors.push("directory name must match skill name '" + name + "'");
  }

  const description = metadata.description;
  if (typeof description !== "string" || !description.trim()) {
    errors.push("description must be a non-empty string");
  } else if (description.length > 1024) {
    errors.push("description exceeds 1024 characters");
  }

  if ("license" in metadata && typeof metadata.license !== "string") {
    errors.push("license must be a string");
  }
  if ("compatibility" in metadata) {
    if (typeof metadata.compatibility !== "string" || !metadata.compatibility) {
      errors.push("compatibility must be a non-empty string");
    } else if (metadata.compatibility.length > 500) {
      errors.push("compatibility exceeds 500 characters");
    }
  }
  if ("allowed-tools" in metadata && typeof metadata["allowed-tools"] !== "string") {
    errors.push("allowed-tools must be a string");
  }
  if ("metadata" in metadata) {
    if (!isRecord(metadata.metadata)) {
      errors.push("metadata must be a string-to-string mapping");
    } else if (Object.values(metadata.metadata).some((value) => typeof value !== "string")) {
      errors.push("metadata values must be strings");
    }
  }
  return errors;
}

async function discoverSkills(
  root: string,
  diagnostics: AgentPluginDiagnostic[],
): Promise<AgentPluginSkill[]> {
  const candidate = join(root, "skills");
  if (!(await exists(candidate))) return [];

  let skillsRoot: string;
  try {
    skillsRoot = await resolveContainedExisting(root, candidate);
    if (!(await stat(skillsRoot)).isDirectory()) throw new Error("skills does not resolve to a directory");
  } catch (error) {
    diagnostics.push(diagnostic("error", "skills-location-invalid", error instanceof Error ? error.message : "skills is invalid.", {
      component: "skills",
      path: "skills",
    }));
    return [];
  }

  const skills: AgentPluginSkill[] = [];
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(skillsRoot, entry.name);
    let skillDir: string;
    try {
      skillDir = await resolveContainedExisting(root, entryPath);
      if (!(await stat(skillDir)).isDirectory()) continue;
    } catch {
      continue;
    }

    const skillCandidate = join(entryPath, "SKILL.md");
    if (!(await exists(skillCandidate))) continue;
    let skillMdPath: string;
    try {
      skillMdPath = await resolveContainedExisting(root, skillCandidate);
      if (!(await stat(skillMdPath)).isFile()) throw new Error("SKILL.md is not a regular file");
    } catch (error) {
      diagnostics.push(diagnostic("error", "skill-path-invalid", error instanceof Error ? error.message : "SKILL.md is invalid.", {
        component: "skill",
        componentId: entry.name,
        path: "skills/" + entry.name + "/SKILL.md",
      }));
      continue;
    }

    let markdown: string;
    try {
      markdown = await readFile(skillMdPath, "utf8");
    } catch (error) {
      diagnostics.push(diagnostic("error", "skill-read-failed", error instanceof Error ? error.message : "Could not read SKILL.md.", {
        component: "skill",
        componentId: entry.name,
        path: displayPath(root, skillMdPath),
      }));
      continue;
    }
    const parsed = parseSkillFrontmatter(markdown);
    if (!parsed.metadata) {
      diagnostics.push(diagnostic("error", "skill-frontmatter-invalid", parsed.error ?? "Invalid skill frontmatter.", {
        component: "skill",
        componentId: entry.name,
        path: displayPath(root, skillMdPath),
      }));
      continue;
    }
    const errors = validateSkillMetadata(parsed.metadata, entry.name);
    if (errors.length) {
      diagnostics.push(diagnostic("error", "skill-spec-invalid", "Skill '" + entry.name + "' is invalid: " + errors.join("; ") + ".", {
        component: "skill",
        componentId: entry.name,
        path: displayPath(root, skillMdPath),
      }));
      continue;
    }
    skills.push({
      name: String(parsed.metadata.name).trim().normalize("NFKC"),
      description: String(parsed.metadata.description).trim(),
      directoryName: entry.name,
      directoryPath: skillDir,
      skillMdPath,
      license: typeof parsed.metadata.license === "string" ? parsed.metadata.license : undefined,
      compatibility: typeof parsed.metadata.compatibility === "string" ? parsed.metadata.compatibility : undefined,
      metadata: isRecord(parsed.metadata.metadata) ? parsed.metadata.metadata as Record<string, string> : undefined,
      allowedTools: typeof parsed.metadata["allowed-tools"] === "string" ? parsed.metadata["allowed-tools"] : undefined,
    });
  }
  return skills;
}

function validateWith(validator: ValidateFunction, value: unknown) {
  return validator(value) ? "" : ajvMessage(validator.errors);
}

function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost") return true;
  const family = isIP(host);
  if (family === 4) return host.split(".")[0] === "127";
  if (family === 6) return host === "::1" || host.toLowerCase() === "0:0:0:0:0:0:0:1";
  return false;
}

function validateRemoteServer(config: AgentPluginHttpServer) {
  const errors: string[] = [];
  let url: URL | undefined;
  try {
    url = new URL(config.url);
  } catch {
    errors.push("url must be an absolute HTTP or HTTPS URL");
  }
  if (url) {
    if (url.protocol !== "http:" && url.protocol !== "https:") errors.push("url must use HTTP or HTTPS");
    if (url.username || url.password) errors.push("url must not contain user information");
    if (url.hash) errors.push("url must not contain a fragment");
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) errors.push("non-loopback endpoints must use HTTPS");
  }

  const seen = new Set<string>();
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    const key = name.toLowerCase();
    if (seen.has(key)) errors.push("duplicate header name with different casing: " + name);
    seen.add(key);
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "invalid HTTP header " + name);
    }
  }
  return errors;
}

async function validateExistingPathContainment(base: string, candidate: string) {
  if (!isWithin(base, candidate)) return false;
  if (!(await exists(base))) return true;
  try {
    const resolvedBase = await realpath(base);
    let probe = candidate;
    while (!(await exists(probe)) && probe !== base) {
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
    return isWithin(resolvedBase, await realpath(probe));
  } catch {
    return false;
  }
}

function portableDataRoot(pluginRoot: string, pluginName: string) {
  const rootHash = createHash("sha256").update(pluginRoot).digest("hex").slice(0, 12);
  const configuredRoot = optionalEnv("HIVEMINDOS_AGENT_PLUGIN_DATA_ROOT");
  const dataRoot = configuredRoot
    ? resolve(configuredRoot)
    : join(homedir(), ".hivemindos", "agent-plugins", "data");
  return join(dataRoot, pluginName + "-" + rootHash);
}

export function agentPluginDataPath(pluginRoot: string, pluginName: string) {
  return portableDataRoot(resolve(pluginRoot), pluginName);
}

export function expandAgentPluginValue(value: string, pluginRoot: string, pluginData: string) {
  return value.replace(/\$\{PLUGIN_(ROOT|DATA)\}/g, (_placeholder, name: "ROOT" | "DATA") => (
    name === "ROOT" ? pluginRoot : pluginData
  ));
}

export function agentPluginHttpHeaders(headers: Record<string, string> | undefined) {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => (
    !AGENT_PLUGIN_RUNTIME_HEADERS.has(name.toLowerCase())
  )));
}

async function validateStdioServer(
  root: string,
  pluginName: string,
  config: AgentPluginStdioServer,
) {
  const errors: string[] = [];
  const command = config.command;
  if (command.includes("\0")) errors.push("command must not contain a null byte");
  if (command.startsWith("./")) {
    const commandPath = resolve(root, command.slice(2));
    if (!(await validateExistingPathContainment(root, commandPath))) {
      errors.push("command escapes the plugin root");
    }
  } else if (command.includes("/") || command.includes("\\") || command.startsWith(".")) {
    errors.push("command must be a bare executable name or begin with ./");
  }

  const envKeys = Object.keys(config.env ?? {});
  if (envKeys.some((key) => {
    const comparable = process.platform === "win32" ? key.toUpperCase() : key;
    return comparable === "PLUGIN_ROOT" || comparable === "PLUGIN_DATA";
  })) {
    errors.push("env must not override PLUGIN_ROOT or PLUGIN_DATA");
  }

  if (config.cwd !== undefined) {
    const pluginData = portableDataRoot(root, pluginName);
    const value = config.cwd;
    let base: string | undefined;
    let resolvedCwd: string | undefined;
    if (value.startsWith("./")) {
      base = root;
      resolvedCwd = resolve(root, value.slice(2));
    } else if (value === "\${PLUGIN_ROOT}" || value.startsWith("\${PLUGIN_ROOT}/")) {
      base = root;
      resolvedCwd = resolve(expandAgentPluginValue(value, root, pluginData));
    } else if (value === "\${PLUGIN_DATA}" || value.startsWith("\${PLUGIN_DATA}/")) {
      base = pluginData;
      resolvedCwd = resolve(expandAgentPluginValue(value, root, pluginData));
    } else {
      errors.push("cwd must begin with ./, \${PLUGIN_ROOT}, or \${PLUGIN_DATA}");
    }
    if (base && resolvedCwd && !(await validateExistingPathContainment(base, resolvedCwd))) {
      errors.push("cwd escapes its permitted root");
    }
  }
  return errors;
}

async function discoverMcpServers(
  root: string,
  manifest: AgentPluginManifest,
  diagnostics: AgentPluginDiagnostic[],
): Promise<AgentPluginMcpServer[]> {
  const candidate = join(root, "mcp.json");
  if (!(await exists(candidate))) return [];

  let mcpPath: string;
  try {
    mcpPath = await resolveContainedExisting(root, candidate);
    if (!(await stat(mcpPath)).isFile()) throw new Error("mcp.json does not resolve to a regular file");
  } catch (error) {
    diagnostics.push(diagnostic("error", "mcp-location-invalid", error instanceof Error ? error.message : "mcp.json is invalid.", {
      component: "mcp",
      path: "mcp.json",
    }));
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(mcpPath, "utf8"));
  } catch (error) {
    diagnostics.push(diagnostic("error", "mcp-json-invalid", error instanceof Error ? error.message : "mcp.json is not valid JSON.", {
      component: "mcp",
      path: "mcp.json",
    }));
    return [];
  }
  if (!isRecord(parsed)) {
    diagnostics.push(diagnostic("error", "mcp-object-required", "mcp.json must contain a top-level object.", {
      component: "mcp",
      path: "mcp.json",
    }));
    return [];
  }
  const unknown = Object.keys(parsed).filter((key) => key !== "$schema" && key !== "mcpServers");
  if (unknown.length) {
    diagnostics.push(diagnostic("error", "mcp-top-level-invalid", "mcp.json contains unknown top-level fields: " + unknown.join(", ") + ".", {
      component: "mcp",
      path: "mcp.json",
    }));
    return [];
  }
  if (parsed.$schema !== AGENT_PLUGIN_MCP_SCHEMA_ID) {
    diagnostics.push(diagnostic("error", "mcp-schema-unsupported", "mcp.json must target the same supported Agent Plugins 1.0.0 schema as plugin.json.", {
      component: "mcp",
      path: "mcp.json",
    }));
    return [];
  }
  if (!isRecord(parsed.mcpServers)) {
    diagnostics.push(diagnostic("error", "mcp-servers-object-required", "mcpServers must be an object.", {
      component: "mcp",
      path: "mcp.json",
    }));
    return [];
  }

  const servers: AgentPluginMcpServer[] = [];
  for (const [name, value] of Object.entries(parsed.mcpServers)) {
    const schemaError = validateWith(validateMcpServer, value);
    if (schemaError) {
      diagnostics.push(diagnostic("error", "mcp-server-schema-invalid", "MCP server '" + name + "' is invalid: " + schemaError + ".", {
        component: "mcp-server",
        componentId: name,
        path: "mcp.json",
      }));
      continue;
    }
    const config = value as AgentPluginStdioServer | AgentPluginHttpServer;
    const semanticErrors = config.type === "stdio"
      ? await validateStdioServer(root, manifest.name, config)
      : validateRemoteServer(config);
    if (semanticErrors.length) {
      diagnostics.push(diagnostic("error", "mcp-server-semantics-invalid", "MCP server '" + name + "' is invalid: " + semanticErrors.join("; ") + ".", {
        component: "mcp-server",
        componentId: name,
        path: "mcp.json",
      }));
      continue;
    }
    if (config.type === "sse") {
      diagnostics.push(diagnostic("warning", "mcp-transport-unsupported", "MCP server '" + name + "' uses optional legacy SSE, which HivemindOS does not load.", {
        component: "mcp-server",
        componentId: name,
        path: "mcp.json",
      }));
      continue;
    }
    servers.push({ name, config });
  }
  return servers;
}

export async function inspectAgentPlugin(pluginPath: string): Promise<AgentPluginInspection> {
  const diagnostics: AgentPluginDiagnostic[] = [];
  const requested = pluginPath.trim();
  let root = resolve(requested || ".");
  try {
    root = await realpath(root);
    if (!(await stat(root)).isDirectory()) throw new Error("plugin path is not a directory");
  } catch (error) {
    diagnostics.push(diagnostic("error", "plugin-root-invalid", error instanceof Error ? error.message : "Plugin root is invalid.", {
      component: "plugin",
      path: requested || ".",
    }));
    return {
      specificationVersion: AGENT_PLUGINS_VERSION,
      valid: false,
      pluginRoot: root,
      skills: [],
      mcpServers: [],
      extensionNamespaces: [],
      diagnostics,
    };
  }

  const manifest = await validateManifestFile(root, diagnostics);
  if (!manifest) {
    return {
      specificationVersion: AGENT_PLUGINS_VERSION,
      valid: false,
      pluginRoot: root,
      skills: [],
      mcpServers: [],
      extensionNamespaces: [],
      diagnostics,
    };
  }

  const [skills, mcpServers] = await Promise.all([
    discoverSkills(root, diagnostics),
    discoverMcpServers(root, manifest, diagnostics),
  ]);
  return {
    specificationVersion: AGENT_PLUGINS_VERSION,
    valid: true,
    pluginRoot: root,
    manifest,
    skills,
    mcpServers,
    extensionNamespaces: Object.keys(manifest.extensions ?? {}),
    diagnostics,
  };
}

export async function materializeAgentPluginStdioServer(
  pluginRoot: string,
  pluginName: string,
  config: AgentPluginStdioServer,
): Promise<MaterializedStdioServer> {
  const root = await realpath(pluginRoot);
  const data = portableDataRoot(root, pluginName);
  const semanticErrors = await validateStdioServer(root, pluginName, config);
  if (semanticErrors.length) throw new Error(semanticErrors.join("; "));
  const command = config.command.startsWith("./") ? resolve(root, config.command.slice(2)) : config.command;
  const cwd = config.cwd
    ? config.cwd.startsWith("./")
      ? resolve(root, config.cwd.slice(2))
      : resolve(expandAgentPluginValue(config.cwd, root, data))
    : root;
  return {
    type: "stdio",
    command,
    args: (config.args ?? []).map((value) => expandAgentPluginValue(value, root, data)),
    env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [
      key,
      expandAgentPluginValue(value, root, data),
    ])),
    cwd,
  };
}
