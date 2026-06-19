import { spawn } from "node:child_process";
import { once } from "node:events";

const MCP_PROTOCOL_VERSION = "2025-11-25";

export class McpClient {
  constructor({ name, accountName, env }) {
    this.name = name;
    this.accountName = accountName;
    this.env = env;
    this.nextId = 1;
    this.pending = new Map();
    this.stdout = "";
    this.stderr = "";
    this.child = null;
  }

  async start() {
    const binary = process.env.MCP_EMAIL_SERVER_BINARY || "mcp-email-server";
    this.child = spawn(binary, ["stdio"], {
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("exit", (code, signal) => {
      this.rejectAll(new Error(`${this.name} MCP server exited with code ${code ?? "null"} signal ${signal ?? "null"}`));
    });

    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "hivemindos-mcp-email-e2e",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized", {});
  }

  onStdout(chunk) {
    this.stdout += chunk.toString("utf8");
    let newlineIndex = this.stdout.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdout.slice(0, newlineIndex).trim();
      this.stdout = this.stdout.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(line);
      }
      newlineIndex = this.stdout.indexOf("\n");
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.rejectAll(new Error(`${this.name} emitted non-JSON stdout: ${line}\n${error.message}`));
      return;
    }
    if (!Object.hasOwn(message, "id")) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${pending.method} failed: ${JSON.stringify(message.error)}\n${this.stderr}`));
      return;
    }
    pending.resolve(message.result);
  }

  request(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} timed out waiting for ${method}\n${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async listTools() {
    const result = await this.request("tools/list");
    return result.tools.map((tool) => tool.name).sort();
  }

  async callTool(name, args = {}, timeoutMs = 20000) {
    const result = await this.request(
      "tools/call",
      {
        name,
        arguments: args,
      },
      timeoutMs,
    );
    if (result.isError) {
      throw new Error(`${this.name} tool ${name} failed: ${toolResultText(result)}\n${this.stderr}`);
    }
    return decodeToolResult(result);
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async close() {
    if (!this.child || this.child.killed) {
      return;
    }
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    await Promise.race([
      once(this.child, "exit").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (!this.child.killed) {
      this.child.kill("SIGKILL");
    }
  }
}

function decodeToolResult(result) {
  if (result.structuredContent !== undefined) {
    if (
      result.structuredContent &&
      typeof result.structuredContent === "object" &&
      Object.keys(result.structuredContent).length === 1 &&
      Object.hasOwn(result.structuredContent, "result")
    ) {
      return result.structuredContent.result;
    }
    return result.structuredContent;
  }
  const text = toolResultText(result);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toolResultText(result) {
  return (result.content || [])
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      return JSON.stringify(part);
    })
    .join("\n");
}
