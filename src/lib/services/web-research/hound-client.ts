import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runtimeCommandEnv } from "@/lib/services/runtime-command-env";
import { webResearchInstalled, webResearchPaths } from "./paths";

const REQUIRED_TOOLS = new Set([
  "mcp_smart_search",
  "mcp_smart_fetch",
  "mcp_smart_crawl",
  "mcp_screenshot",
]);

type HoundConnection = {
  client: Client;
  tools: Set<string>;
};

let connection: HoundConnection | undefined;
let connecting: Promise<HoundConnection> | undefined;

function transport() {
  const paths = webResearchPaths();
  const env = Object.fromEntries(
    Object.entries(runtimeCommandEnv({
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: paths.browserDir,
      HIVEMINDOS_WEB_RESEARCH_DATA_DIR: paths.dataDir,
      HOUND_BROWSER_IDLE_TIMEOUT: "120",
      PYTHONDONTWRITEBYTECODE: "1",
    })).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return new StdioClientTransport({
    command: paths.python,
    args: [paths.wrapper],
    env,
  });
}

async function openConnection() {
  if (!webResearchInstalled()) {
    throw new Error("The local web research engine is not installed. Run HivemindOS setup or node scripts/install-web-research.mjs.");
  }
  const client = new Client({ name: "hivemindos-web-research", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport());
  const listed = await client.listTools();
  const tools = new Set((listed.tools ?? []).map((tool) => tool.name));
  const missing = [...REQUIRED_TOOLS].filter((tool) => !tools.has(tool));
  if (missing.length) {
    await client.close().catch(() => undefined);
    throw new Error(`The pinned web research engine is missing required tools: ${missing.join(", ")}`);
  }
  return { client, tools };
}

async function getConnection() {
  if (connection) return connection;
  connecting ??= openConnection();
  try {
    connection = await connecting;
    return connection;
  } finally {
    connecting = undefined;
  }
}

async function resetConnection() {
  const current = connection;
  connection = undefined;
  connecting = undefined;
  await current?.client.close().catch(() => undefined);
}

export async function callHoundTool(
  name: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const current = await getConnection();
      if (!current.tools.has(name)) throw new Error(`Web research tool ${name} is unavailable.`);
      return await current.client.callTool(
        { name, arguments: args },
        undefined,
        { signal: options.signal, timeout: options.timeoutMs ?? 70_000 },
      );
    } catch (error) {
      await resetConnection();
      if (attempt === 1) throw error;
    }
  }
  throw new Error(`Web research tool ${name} failed.`);
}

export async function closeWebResearchConnection() {
  await resetConnection();
}
