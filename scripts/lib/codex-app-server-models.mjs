import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const INITIALIZE_REQUEST_ID = 1;
const MODEL_LIST_REQUEST_ID = 2;
const execFileAsync = promisify(execFile);

function normalizeModelList(result) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  const seen = new Set();
  const models = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || row.hidden === true) continue;
    const id = String(row.model || row.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      ...(String(row.displayName || "").trim() ? { name: String(row.displayName).trim() } : {}),
      ...(String(row.description || "").trim() ? { subtitle: String(row.description).trim() } : {}),
      isDefault: row.isDefault === true,
    });
  }

  const defaultModel = models.find((model) => model.isDefault)?.id || models[0]?.id || "";
  return { models, defaultModel };
}

export function buildCodexRuntimeModelSelection({
  configuredModel = "",
  discovery,
  source = discovery ? "Codex app-server" : "Codex profile",
} = {}) {
  const model = String(configuredModel || "").trim();
  const models = (discovery?.models ?? []).map((option) => ({
    id: option.id,
    ...(option.name ? { name: option.name } : {}),
    ...(option.subtitle ? { subtitle: option.subtitle } : {}),
  }));
  if (model && !models.some((option) => option.id === model)) models.unshift({ id: model });
  return {
    provider: "openai-codex",
    model: model || discovery?.defaultModel || models[0]?.id || "",
    providers: [{
      slug: "openai-codex",
      name: "OpenAI Codex",
      models,
      totalModels: models.length,
      isCurrent: true,
      isUserDefined: true,
      source,
    }],
  };
}

export function discoverCodexAppServerModels({
  command = "codex",
  env = process.env,
  timeoutMs = 8_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server", "--stdio"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = createInterface({ input: child.stdout });
    child.stderr.resume();
    let settled = false;

    const finish = (error, discovery) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      output.close();
      child.stdin.destroy();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(discovery);
    };

    const send = (message) => {
      if (!child.stdin.writable) {
        finish(new Error("Codex app-server closed before model discovery completed."));
        return;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timeout = setTimeout(() => {
      finish(new Error("Codex app-server model discovery timed out."));
    }, timeoutMs);

    child.on("error", (error) => finish(error));
    child.on("close", () => {
      finish(new Error("Codex app-server exited before returning its model catalog."));
    });
    output.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message?.id === INITIALIZE_REQUEST_ID) {
        if (message.error) {
          finish(new Error("Codex app-server initialization failed."));
          return;
        }
        send({ method: "initialized" });
        send({
          id: MODEL_LIST_REQUEST_ID,
          method: "model/list",
          params: { includeHidden: false, limit: 100 },
        });
        return;
      }
      if (message?.id === MODEL_LIST_REQUEST_ID) {
        if (message.error) {
          finish(new Error("Codex app-server rejected model discovery."));
          return;
        }
        finish(null, normalizeModelList(message.result));
      }
    });

    send({
      id: INITIALIZE_REQUEST_ID,
      method: "initialize",
      params: {
        clientInfo: { name: "hivemindos", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

export async function readCodexRuntimeIntegrationStatus({
  command,
  env = process.env,
  configuredModel = "",
  capabilities = {},
} = {}) {
  const diagnostics = [];
  const versionResult = command
    ? await execFileAsync(command, ["--version"], {
        timeout: 3_000,
        maxBuffer: 200_000,
        env,
      }).catch(() => null)
    : null;
  const authResult = versionResult
    ? await execFileAsync(command, ["login", "status"], {
        timeout: 5_000,
        maxBuffer: 200_000,
        env,
      }).catch(() => null)
    : null;
  let discovery;
  if (authResult) {
    try {
      discovery = await discoverCodexAppServerModels({ command, env });
    } catch (error) {
      diagnostics.push(
        error instanceof Error
          ? `Codex model discovery failed: ${error.message}`
          : "Codex model discovery failed.",
      );
    }
  }
  const modelSelection = buildCodexRuntimeModelSelection({ configuredModel, discovery });
  const version = String(versionResult?.stdout || versionResult?.stderr || "")
    .trim()
    .split(/\r?\n/)[0];
  const installed = Boolean(versionResult);
  const authenticated = Boolean(authResult);
  const modelCount = modelSelection.providers[0].models.length;
  return {
    ok: installed && authenticated,
    runtime: "codex",
    capabilities,
    detail: !installed
      ? "Codex CLI was not found."
      : authenticated
        ? `Codex is installed and authenticated${version ? `. ${version}` : "."}`
        : "Codex is installed but not authenticated. Log in before starting a managed task.",
    modelSelection,
    integrations: {
      modelSelection: {
        supported: true,
        enabled: modelCount > 0,
        detail: modelCount
          ? `Codex reported ${modelCount} model${modelCount === 1 ? "" : "s"}.`
          : "Codex did not report models.",
      },
    },
    diagnostics,
  };
}
