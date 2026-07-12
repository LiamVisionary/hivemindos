import { basename, dirname, resolve, sep } from "node:path";

function modelOption(value) {
  if (typeof value === "string") return value.trim() ? { id: value.trim() } : null;
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return null;
  return {
    id,
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
  };
}

/** Convert Hermes' official /api/model/options payload into HivemindOS' shared
 * runtime model-selection shape. Providers that explicitly report they are
 * unauthenticated remain setup choices in Hermes, but are not runnable model
 * choices in the mobile agent picker. */
export function hermesModelSelectionFromPayload(payload = {}) {
  const providers = (Array.isArray(payload.providers) ? payload.providers : [])
    .filter((provider) => provider && typeof provider === "object")
    .filter((provider) => provider.authenticated !== false)
    .map((provider) => {
      const models = (Array.isArray(provider.models) ? provider.models : [])
        .map(modelOption)
        .filter(Boolean);
      const slug = typeof provider.slug === "string" ? provider.slug.trim() : "";
      if (!slug) return null;
      return {
        slug,
        name:
          typeof provider.name === "string" && provider.name.trim()
            ? provider.name.trim()
            : slug,
        models,
        totalModels:
          Number(provider.total_models ?? provider.totalModels) || models.length,
        ...(typeof provider.is_current === "boolean"
          ? { isCurrent: provider.is_current }
          : typeof provider.isCurrent === "boolean"
            ? { isCurrent: provider.isCurrent }
            : {}),
      };
    })
    .filter(Boolean);
  return {
    provider: typeof payload.provider === "string" ? payload.provider : "",
    model: typeof payload.model === "string" ? payload.model : "",
    providers,
  };
}

export function hermesProfileName(hermesHome, defaultHermesHome) {
  const home = resolve(String(hermesHome || ""));
  const root = resolve(String(defaultHermesHome || ""));
  if (!home || home === root) return "";
  const parent = dirname(home);
  if (parent === resolve(root, "profiles") || parent.endsWith(`${sep}.hermes${sep}profiles`)) {
    return basename(home);
  }
  return "";
}

function pythonEnv({ hermesHome, projectDir, provider, model }) {
  return {
    ...process.env,
    HERMES_HOME: hermesHome,
    PYTHONPATH: projectDir,
    ...(provider ? { HIVEMINDOS_HERMES_PROVIDER: provider } : {}),
    ...(model ? { HIVEMINDOS_HERMES_MODEL: model } : {}),
  };
}

export async function readHermesModelSelection({
  hermesHome,
  projectDir,
  pythonPath,
  execFileAsync,
}) {
  const script = `
import json
from hermes_cli.inventory import build_models_payload, load_picker_context
payload = build_models_payload(load_picker_context(), max_models=50)
print(json.dumps(payload))
`;
  const { stdout } = await execFileAsync(pythonPath, ["-c", script], {
    cwd: projectDir,
    env: pythonEnv({ hermesHome, projectDir }),
    timeout: 25_000,
    maxBuffer: 5_000_000,
  });
  return hermesModelSelectionFromPayload(JSON.parse(stdout || "{}"));
}

/** Apply the same main-model mutation used by Hermes' official
 * POST /api/model/set implementation, scoped with HERMES_HOME. */
export async function setHermesModelAssignment({
  hermesHome,
  projectDir,
  pythonPath,
  provider,
  model,
  execFileAsync,
}) {
  const script = `
import os
from hermes_cli.config import load_config, save_config
from hermes_cli.web_server import _apply_main_model_assignment, _normalize_main_model_assignment
provider, model = _normalize_main_model_assignment(
    os.environ["HIVEMINDOS_HERMES_PROVIDER"],
    os.environ["HIVEMINDOS_HERMES_MODEL"],
)
cfg = load_config()
cfg["model"] = _apply_main_model_assignment(cfg.get("model", {}), provider, model)
save_config(cfg)
`;
  await execFileAsync(pythonPath, ["-c", script], {
    cwd: projectDir,
    env: pythonEnv({ hermesHome, projectDir, provider, model }),
    timeout: 25_000,
    maxBuffer: 2_000_000,
  });
}

