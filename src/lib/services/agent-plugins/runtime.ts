import "server-only";

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  connectMcpServer,
  disconnectMcpServer,
  type McpServerStatus,
} from "@/lib/services/mcp/client";
import {
  agentPluginDataPath,
  agentPluginHttpHeaders,
  inspectAgentPlugin,
  materializeAgentPluginStdioServer,
  type AgentPluginDiagnostic,
  type AgentPluginInspection,
} from "./loader";
import {
  installAgentPluginSkills,
  type AgentPluginSkillsInstallReport,
} from "./skill-installer";

export type AgentPluginMcpLoadResult = {
  name: string;
  serverId: string;
  transport: "stdio" | "streamable-http";
  status: "connected" | "failed";
  tools?: McpServerStatus["tools"];
  error?: string;
};

export type LoadedAgentPlugin = {
  pluginRoot: string;
  name: string;
  version?: string;
  loadedAt: string;
  pluginDataPath: string;
  skills: AgentPluginSkillsInstallReport["results"];
  mcpServers: AgentPluginMcpLoadResult[];
  diagnostics: AgentPluginDiagnostic[];
};

export type AgentPluginLoadReport = {
  loaded: boolean;
  inspection: AgentPluginInspection;
  plugin?: LoadedAgentPlugin;
};

const loadedPlugins = new Map<string, LoadedAgentPlugin>();

function serverId(pluginRoot: string, pluginName: string, name: string) {
  const rootHash = createHash("sha256").update(pluginRoot).digest("hex").slice(0, 10);
  return "agent-plugin:" + pluginName + ":" + rootHash + ":" + name;
}

async function disconnectLoadedPlugin(plugin: LoadedAgentPlugin) {
  await Promise.all(plugin.mcpServers.map((server) => disconnectMcpServer(server.serverId).catch(() => {})));
}

async function connectPluginServers(
  inspection: AgentPluginInspection,
  pluginDataPath: string,
  diagnostics: AgentPluginDiagnostic[],
): Promise<AgentPluginMcpLoadResult[]> {
  const manifest = inspection.manifest!;
  return Promise.all(inspection.mcpServers.map(async (server): Promise<AgentPluginMcpLoadResult> => {
    const id = serverId(inspection.pluginRoot, manifest.name, server.name);
    try {
      if (server.config.type === "stdio") {
        const materialized = await materializeAgentPluginStdioServer(
          inspection.pluginRoot,
          manifest.name,
          server.config,
        );
        const status = await connectMcpServer({
          id,
          transport: "stdio",
          command: materialized.command,
          args: materialized.args,
          cwd: materialized.cwd,
          inheritEnv: false,
          env: {
            ...materialized.env,
            PLUGIN_ROOT: inspection.pluginRoot,
            PLUGIN_DATA: pluginDataPath,
          },
        });
        return {
          name: server.name,
          serverId: id,
          transport: "stdio",
          status: "connected",
          tools: status.tools,
        };
      }
      const status = await connectMcpServer({
        id,
        transport: "http",
        url: server.config.url,
        headers: agentPluginHttpHeaders(server.config.headers),
        preventRedirects: true,
      });
      return {
        name: server.name,
        serverId: id,
        transport: "streamable-http",
        status: "connected",
        tools: status.tools,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP connection failed.";
      diagnostics.push({
        severity: "warning",
        code: "mcp-server-load-failed",
        message: "MCP server '" + server.name + "' failed to connect: " + message,
        component: "mcp-server",
        componentId: server.name,
        path: "mcp.json",
      });
      return {
        name: server.name,
        serverId: id,
        transport: server.config.type === "stdio" ? "stdio" : "streamable-http",
        status: "failed",
        error: message,
      };
    }
  }));
}

export async function loadAgentPlugin(input: {
  pluginPath: string;
  vaultPath?: string;
  importSkills?: boolean;
  connectMcp?: boolean;
}): Promise<AgentPluginLoadReport> {
  const inspection = await inspectAgentPlugin(input.pluginPath);
  if (!inspection.valid || !inspection.manifest) return { loaded: false, inspection };

  const prior = loadedPlugins.get(inspection.pluginRoot);
  if (prior) await disconnectLoadedPlugin(prior);

  const diagnostics = [...inspection.diagnostics];
  const pluginDataPath = agentPluginDataPath(inspection.pluginRoot, inspection.manifest.name);
  await mkdir(pluginDataPath, { recursive: true });
  const resolvedDataPath = await realpath(pluginDataPath);
  await access(resolvedDataPath, constants.R_OK | constants.W_OK);

  const skillsPromise = input.importSkills === false
    ? Promise.resolve<AgentPluginSkillsInstallReport>({ results: [], diagnostics: [] })
    : installAgentPluginSkills({ inspection, vaultPath: input.vaultPath }).catch((error) => ({
        results: [],
        diagnostics: [{
          severity: "warning" as const,
          code: "plugin-skills-load-failed",
          message: error instanceof Error ? error.message : "Plugin skills could not be installed.",
          component: "skills" as const,
        }],
      }));
  const mcpPromise = input.connectMcp === false
    ? Promise.resolve<AgentPluginMcpLoadResult[]>([])
    : connectPluginServers(inspection, resolvedDataPath, diagnostics);
  const [skills, mcpServers] = await Promise.all([skillsPromise, mcpPromise]);
  diagnostics.push(...skills.diagnostics);

  const plugin: LoadedAgentPlugin = {
    pluginRoot: inspection.pluginRoot,
    name: inspection.manifest.name,
    version: inspection.manifest.version,
    loadedAt: new Date().toISOString(),
    pluginDataPath: resolvedDataPath,
    skills: skills.results,
    mcpServers,
    diagnostics,
  };
  loadedPlugins.set(inspection.pluginRoot, plugin);
  return { loaded: true, inspection: { ...inspection, diagnostics }, plugin };
}

export function listLoadedAgentPlugins() {
  return [...loadedPlugins.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function unloadAgentPlugin(pluginPath: string) {
  let root: string;
  try {
    root = await realpath(resolve(pluginPath));
  } catch {
    return { unloaded: false, pluginRoot: resolve(pluginPath) };
  }
  const plugin = loadedPlugins.get(root);
  if (!plugin) return { unloaded: false, pluginRoot: root };
  await disconnectLoadedPlugin(plugin);
  loadedPlugins.delete(root);
  return {
    unloaded: true,
    pluginRoot: root,
    name: plugin.name,
    preservedPluginDataPath: plugin.pluginDataPath,
  };
}
