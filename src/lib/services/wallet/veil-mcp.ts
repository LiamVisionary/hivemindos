import "server-only";

import { spawn } from "node:child_process";
import { resolveVeilMcpPath, veilEnvValue } from "@/lib/services/wallet/veil-cli";

type PendingMcpCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type McpToolTextResult = {
  content?: Array<{ type?: string; text?: string }>;
};

export async function callVeilMcpTool<T>(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 240_000,
): Promise<T> {
  const mcpPath = await resolveVeilMcpPath();
  if (!mcpPath) throw new Error("VEIL_MCP_MISSING");

  const child = spawn(mcpPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: await veilMcpEnv(),
  });
  const pending = new Map<number, PendingMcpCall>();
  let nextId = 1;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const cleanup = () => {
    child.kill("SIGTERM");
  };

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Veil MCP tool ${name}.`));
    }, timeoutMs);

    const fail = (error: Error) => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    };

    const send = (method: string, params: Record<string, unknown>) => {
      const id = nextId;
      nextId += 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return new Promise<unknown>((callResolve, callReject) => {
        pending.set(id, { resolve: callResolve, reject: callReject });
      });
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        const message = parseJsonRecord(line);
        if (!message) continue;
        const id = Number(message.id);
        const call = pending.get(id);
        if (!call) continue;
        pending.delete(id);
        if (message.error) {
          call.reject(new Error(redactSecrets(JSON.stringify(message.error))));
        } else {
          call.resolve(message.result);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      if (!/listening on stdio/i.test(stderrBuffer)) return;
      stderrBuffer = "";
      void (async () => {
        await send("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "hivemindos", version: "0.1.0" },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
        const result = await send("tools/call", { name, arguments: args }) as McpToolTextResult;
        clearTimeout(timer);
        cleanup();
        resolve(parseMcpToolResult<T>(result));
      })().catch(fail);
    });

    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0 || code === null) return;
      if (pending.size === 0) return;
      fail(new Error(redactSecrets(stderrBuffer.trim() || `Veil MCP exited with code ${code}.`)));
    });
  });
}

async function veilMcpEnv(): Promise<NodeJS.ProcessEnv> {
  const veilKey = await veilEnvValue("VEIL_KEY");
  const depositKey = await veilEnvValue("DEPOSIT_KEY");
  const rpcUrl = await veilEnvValue("RPC_URL");
  return sanitizeProcessEnv({
    ...process.env,
    VEIL_KEY: veilKey || process.env.VEIL_KEY,
    DEPOSIT_KEY: depositKey || process.env.DEPOSIT_KEY,
    RPC_URL: rpcUrl || process.env.RPC_URL || "https://base-rpc.publicnode.com",
  });
}

function parseMcpToolResult<T>(result: McpToolTextResult): T {
  const text = result.content?.map((item) => item.text).filter(Boolean).join("\n") ?? "";
  if (!text.trim()) return result as T;
  return JSON.parse(text) as T;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function sanitizeProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    sanitized[key] = value.replace(/\0/g, "");
  }
  return sanitized as NodeJS.ProcessEnv;
}

function redactSecrets(value: string) {
  return value.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}
