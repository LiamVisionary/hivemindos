// Minimal stdio MCP server fixture exposing one "echo" tool. Used by test-mcp-client.mjs to
// verify the in-app MCP client end to end. Lives under scripts/lib/ so Node resolves the SDK
// from the repo's node_modules.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo text back",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: `echo: ${req.params.arguments?.text ?? ""}` }],
}));

await server.connect(new StdioServerTransport());
