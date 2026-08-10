import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "@/lib/home-dir";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Live in-app MCP client/host. Connects to MCP servers (stdio or streamable-HTTP), lists their
// tools, and calls them, so the dashboard agent can use external MCP tools natively rather than
// only cataloging them. Enabled by default; togglable and persisted under ~/.hivemindos/.

export type McpServerConfig =
  | { id: string; transport: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string; inheritEnv?: boolean }
  | { id: string; transport: "http"; url: string; headers?: Record<string, string>; preventRedirects?: boolean };

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface McpServerStatus {
  id: string;
  transport: "stdio" | "http";
  connectedAt: number;
  tools: McpToolInfo[];
}

interface Connection {
  client: Client;
  config: McpServerConfig;
  tools: McpToolInfo[];
  connectedAt: number;
}

const connections = new Map<string, Connection>();

const STATE_PATH = join(homedir(), ".hivemindos", "mcp-client.json");

function loadEnabled(): boolean {
  try {
    if (!existsSync(STATE_PATH)) return true; // on by default
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return parsed?.enabled !== false;
  } catch {
    return true;
  }
}

let enabled = loadEnabled();

export function isMcpClientEnabled(): boolean {
  return enabled;
}

export async function setMcpClientEnabled(value: boolean): Promise<void> {
  enabled = value;
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, `${JSON.stringify({ enabled }, null, 2)}\n`);
  } catch {
    // best-effort persistence; in-memory state still applies for this process
  }
  if (!value) await disconnectAllMcpServers();
}

function makeTransport(config: McpServerConfig) {
  if (config.transport === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...(config.inheritEnv === false ? {} : getStringEnv()), ...(config.env ?? {}) },
      cwd: config.cwd,
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    fetch: config.preventRedirects
      ? (input, init) => fetch(input, { ...init, redirect: "manual" })
      : undefined,
    requestInit: config.headers || config.preventRedirects
      ? {
          headers: config.headers,
          redirect: config.preventRedirects ? "manual" : undefined,
        }
      : undefined,
  });
}

function getStringEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") out[k] = v;
  return out;
}

export async function connectMcpServer(config: McpServerConfig): Promise<McpServerStatus> {
  if (!enabled) throw new Error("MCP client is disabled");
  if (connections.has(config.id)) await disconnectMcpServer(config.id);
  const client = new Client({ name: "hivemindos", version: "1.0.0" }, { capabilities: {} });
  await client.connect(makeTransport(config));
  const listed = await client.listTools();
  const tools: McpToolInfo[] = (listed.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations as Record<string, unknown> | undefined,
  }));
  const connectedAt = Date.now();
  connections.set(config.id, { client, config, tools, connectedAt });
  return { id: config.id, transport: config.transport, connectedAt, tools };
}

export async function listMcpTools(id: string): Promise<McpToolInfo[]> {
  const conn = connections.get(id);
  if (!conn) throw new Error(`MCP server "${id}" is not connected`);
  const listed = await conn.client.listTools();
  conn.tools = (listed.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations as Record<string, unknown> | undefined,
  }));
  return conn.tools;
}

export async function callMcpTool(id: string, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!enabled) throw new Error("MCP client is disabled");
  const conn = connections.get(id);
  if (!conn) throw new Error(`MCP server "${id}" is not connected`);
  return conn.client.callTool({ name, arguments: args });
}

export async function disconnectMcpServer(id: string): Promise<void> {
  const conn = connections.get(id);
  if (!conn) return;
  connections.delete(id);
  try {
    await conn.client.close();
  } catch {
    // ignore close errors
  }
}

export async function disconnectAllMcpServers(): Promise<void> {
  await Promise.all([...connections.keys()].map((id) => disconnectMcpServer(id)));
}

export function mcpClientStatus(): { enabled: boolean; servers: McpServerStatus[] } {
  return {
    enabled,
    servers: [...connections.values()].map((c) => ({
      id: c.config.id,
      transport: c.config.transport,
      connectedAt: c.connectedAt,
      tools: c.tools,
    })),
  };
}
