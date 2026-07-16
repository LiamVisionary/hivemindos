import { spawn } from "child_process";
import { access } from "fs/promises";
import { join } from "path";

import { collectorSupportsAppBuilderContract } from "@/lib/services/app-builder/collector-recovery";

export const runtime = "nodejs";
export const maxDuration = 360;

type UpdateBody = {
  collectorUrl?: string;
  dnsName?: string;
  name?: string;
  ip?: string;
  appDir?: string;
  updateCommand?: string;
  expectedCommit?: string;
  preferRemoteShell?: boolean;
  simulate?: boolean;
  source?: string;
  requiredCapabilities?: {
    appBuilderContractVersion?: string;
    chat?: boolean;
    envHttpSync?: boolean;
    skillInventory?: boolean;
    skillAutoSync?: boolean;
  };
};

type CollectorHealth = {
  ok?: boolean;
  mode?: string;
  collectorStartedAt?: string;
  collectorStartedAtMs?: number;
  capabilities?: {
    appBuilder?: boolean;
    appBuilderContractVersion?: string;
    chat?: boolean;
    envHttpSync?: boolean;
    skillInventory?: boolean;
    skillAutoSync?: boolean;
    runtimes?: string[];
  };
  version?: {
    commit?: string;
    shortCommit?: string;
    dirty?: boolean;
    latestCommit?: string;
    latestShortCommit?: string;
  };
};

type VerificationOptions = {
  requireCollectorRestart?: boolean;
  previousCollectorStartedAtMs?: number;
  requestedAtMs?: number;
};

type CollectorUpdateReservation = {
  supported: boolean;
  maintenanceReservationToken?: string;
  error?: string;
  status?: number;
};

function collectorBase(collectorUrl?: string) {
  return collectorUrl?.replace(/\/+$/, "") || "";
}

async function fetchCollectorHealth(
  collectorUrl?: string,
): Promise<CollectorHealth | null> {
  const base = collectorBase(collectorUrl);
  if (!base) return null;
  const response = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(6_000),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null) as Promise<CollectorHealth | null>;
}

function hasRequiredCapabilities(
  health: CollectorHealth | null,
  required?: UpdateBody["requiredCapabilities"],
) {
  if (
    required?.appBuilderContractVersion &&
    !collectorSupportsAppBuilderContract(
      health?.capabilities?.appBuilderContractVersion,
      required.appBuilderContractVersion,
    )
  ) return false;
  if (required?.chat && health?.capabilities?.chat !== true) return false;
  if (required?.envHttpSync && health?.capabilities?.envHttpSync !== true)
    return false;
  if (required?.skillInventory && health?.capabilities?.skillInventory !== true)
    return false;
  if (required?.skillAutoSync && health?.capabilities?.skillAutoSync !== true)
    return false;
  return true;
}

function hasExpectedVersion(
  health: CollectorHealth | null,
  expectedCommit?: string,
) {
  const expected = expectedCommit?.trim();
  const commit = health?.version?.commit?.trim();
  const latest = health?.version?.latestCommit?.trim();
  if (commit && latest && commit === latest) return true;
  if (!expected) return true;
  return commit === expected;
}

function collectorStartedAtMs(health: CollectorHealth | null) {
  if (
    typeof health?.collectorStartedAtMs === "number" &&
    Number.isFinite(health.collectorStartedAtMs)
  ) {
    return health.collectorStartedAtMs;
  }
  const parsed = Date.parse(health?.collectorStartedAt ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hasPostUpdateCollector(
  health: CollectorHealth | null,
  options?: VerificationOptions,
) {
  if (!options?.requireCollectorRestart) return true;
  const startedAt = collectorStartedAtMs(health);
  if (!startedAt) return false;
  if (
    options.previousCollectorStartedAtMs &&
    startedAt <= options.previousCollectorStartedAtMs
  )
    return false;
  if (options.requestedAtMs && startedAt < options.requestedAtMs - 2_000)
    return false;
  return true;
}

function updateNeededBefore(body: UpdateBody, health: CollectorHealth | null) {
  return Boolean(
    health?.version?.dirty ||
    !hasExpectedVersion(health, body.expectedCommit) ||
    !hasRequiredCapabilities(health, body.requiredCapabilities),
  );
}

function hasVerificationTarget(body: UpdateBody) {
  return Boolean(
    body.expectedCommit?.trim() ||
    body.requiredCapabilities?.appBuilderContractVersion?.trim() ||
    body.requiredCapabilities?.chat ||
    body.requiredCapabilities?.envHttpSync ||
    body.requiredCapabilities?.skillInventory ||
    body.requiredCapabilities?.skillAutoSync,
  );
}

async function updateBodyWithTarget(body: UpdateBody): Promise<UpdateBody> {
  const health = await fetchCollectorHealth(body.collectorUrl);
  const commit = health?.version?.commit?.trim();
  const latestCommit = health?.version?.latestCommit?.trim();
  const expectedCommit =
    body.expectedCommit?.trim() ||
    (commit && latestCommit && commit !== latestCommit
      ? latestCommit
      : undefined);
  const preferRemoteShell = Boolean(
    body.preferRemoteShell ||
    (health?.version?.dirty && expectedCommit && commit !== expectedCommit),
  );
  if (expectedCommit || preferRemoteShell) {
    return { ...body, expectedCommit, preferRemoteShell };
  }
  if (body.expectedCommit?.trim()) return body;
  if (commit && latestCommit && commit !== latestCommit) {
    return { ...body, expectedCommit: latestCommit };
  }
  return body;
}

function verificationError(
  body: UpdateBody,
  health: CollectorHealth | null,
  options?: VerificationOptions,
) {
  if (!hasPostUpdateCollector(health, options)) {
    return "The update started, but the agent bridge has not restarted into the updated collector yet. It may still be installing dependencies or rebuilding.";
  }
  if (
    body.expectedCommit?.trim() &&
    health?.version?.commit !== body.expectedCommit.trim()
  ) {
    const current =
      health?.version?.shortCommit ||
      health?.version?.commit?.slice(0, 7) ||
      "unknown";
    const expected =
      health?.version?.latestShortCommit ||
      body.expectedCommit.trim().slice(0, 7);
    return `The update started, but this agent bridge still reports ${current} instead of ${expected}. It may still be building, or the remote update failed.`;
  }
  if (
    body.requiredCapabilities?.appBuilderContractVersion &&
    !collectorSupportsAppBuilderContract(
      health?.capabilities?.appBuilderContractVersion,
      body.requiredCapabilities.appBuilderContractVersion,
    )
  ) {
    const current = health?.capabilities?.appBuilderContractVersion || "unreported";
    return `The update command finished, but the agent bridge still reports App Builder ${current} instead of ${body.requiredCapabilities.appBuilderContractVersion} or newer.`;
  }
  if (body.requiredCapabilities?.chat && health?.capabilities?.chat !== true)
    return "The update command finished, but the agent bridge still does not report the Hermes chat bridge.";
  if (
    body.requiredCapabilities?.envHttpSync &&
    health?.capabilities?.envHttpSync !== true
  )
    return "The update command finished, but the agent bridge still does not report the shared-env sync endpoint.";
  if (
    body.requiredCapabilities?.skillInventory &&
    health?.capabilities?.skillInventory !== true
  )
    return "The update command finished, but the agent bridge still does not report the skill inventory endpoint.";
  if (
    body.requiredCapabilities?.skillAutoSync &&
    health?.capabilities?.skillAutoSync !== true
  )
    return "The update command finished, but the agent bridge still does not report skill auto-sync.";
  if (!body.expectedCommit?.trim())
    return "The update request did not include or expose a target commit to verify.";
  return "The update command finished, but agent bridge verification did not pass.";
}

async function waitForCollectorVerification(
  body: UpdateBody,
  options?: VerificationOptions,
) {
  const delays = [
    1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 45_000, 60_000, 60_000, 60_000,
  ];
  let health = await fetchCollectorHealth(body.collectorUrl);
  if (!hasVerificationTarget(body)) return { verified: false, health };
  if (
    hasVerificationTarget(body) &&
    hasPostUpdateCollector(health, options) &&
    hasRequiredCapabilities(health, body.requiredCapabilities) &&
    hasExpectedVersion(health, body.expectedCommit)
  ) {
    return { verified: true, health };
  }
  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    health = await fetchCollectorHealth(body.collectorUrl);
    if (
      hasVerificationTarget(body) &&
      hasPostUpdateCollector(health, options) &&
      hasRequiredCapabilities(health, body.requiredCapabilities) &&
      hasExpectedVersion(health, body.expectedCommit)
    ) {
      return { verified: true, health };
    }
  }
  return { verified: false, health };
}

async function reserveCollectorUpdate(
  collectorUrl?: string,
): Promise<CollectorUpdateReservation> {
  const base = collectorBase(collectorUrl);
  if (!base) return { supported: false };
  const response = await fetch(`${base}/maintenance/reserve-update`, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  }).catch(() => null);
  if (!response) {
    return {
      supported: true,
      status: 503,
      error: "Could not confirm that the agent bridge is idle, so maintenance was not started.",
    };
  }
  if (response.status === 404 || response.status === 405) {
    return { supported: false };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    return {
      supported: true,
      status: response.status,
      error: payload?.error ?? `agent bridge maintenance reservation returned HTTP ${response.status}`,
    };
  }
  const maintenanceReservationToken =
    typeof payload?.reservationToken === "string"
      ? payload.reservationToken.trim()
      : "";
  if (!maintenanceReservationToken) {
    return {
      supported: true,
      status: 502,
      error: "The agent bridge accepted maintenance but did not return a reservation token.",
    };
  }
  return { supported: true, maintenanceReservationToken };
}

async function releaseCollectorUpdateReservation(
  collectorUrl: string | undefined,
  maintenanceReservationToken: string | undefined,
) {
  const base = collectorBase(collectorUrl);
  if (!base || !maintenanceReservationToken) return;
  await fetch(`${base}/maintenance/reserve-update`, {
    method: "DELETE",
    headers: {
      "x-hivemind-maintenance-reservation": maintenanceReservationToken,
    },
    signal: AbortSignal.timeout(4_000),
    cache: "no-store",
  }).catch(() => null);
}

async function startCollectorUpdate(
  collectorUrl?: string,
  maintenanceReservationToken?: string,
) {
  const base = collectorBase(collectorUrl);
  if (!base) throw new Error("No agent bridge URL was provided.");
  const response = await fetch(`${base}/update`, {
    method: "POST",
    headers: maintenanceReservationToken
      ? { "x-hivemind-maintenance-reservation": maintenanceReservationToken }
      : undefined,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      payload?.error ?? `agent bridge update returned HTTP ${response.status}`,
    );
  }
  return payload ?? { ok: true, accepted: true };
}

async function tryCollectorUpdate(
  body: UpdateBody,
  maintenanceReservationToken?: string,
) {
  const result = await startCollectorUpdate(
    body.collectorUrl,
    maintenanceReservationToken,
  );
  return { ok: true, accepted: true, method: "collector", result };
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function installScriptForCheckout(collectorOnly = false) {
  if (collectorOnly) {
    // Agent-bridge machines skip the workspace install; the installer fetches the
    // collector's single npm dependency itself via ensure-collector-deps.sh.
    return [
      'if [ -f "$HOME/.hivemindos/collector.env" ]; then . "$HOME/.hivemindos/collector.env"; fi',
      "HIVE_COLLECTOR_ONLY=true ./scripts/install-telemetry-collector.sh",
    ].join("\n");
  }
  return [
    "if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then corepack enable; corepack prepare pnpm@latest --activate; fi",
    "pnpm install --frozen-lockfile",
    'if [ -f "$HOME/.hivemindos/collector.env" ]; then . "$HOME/.hivemindos/collector.env"; fi',
    "./scripts/install-telemetry-collector.sh",
  ].join("\n");
}

function changelogPreservingPullScript() {
  return [
    "if [ -f scripts/pull-with-changelog-preserve.mjs ]; then",
    "  node scripts/pull-with-changelog-preserve.mjs",
    "else",
    "  node <<'HIVE_CHANGELOG_PULL'",
    "const { execFileSync } = require('child_process');",
    "const { existsSync, readFileSync, writeFileSync } = require('fs');",
    "const file = 'CHANGELOG.md';",
    "function git(args, stdio) { return execFileSync('git', args, { encoding: 'utf8', stdio: stdio || ['ignore', 'pipe', 'pipe'] }); }",
    "function sections(markdown) {",
    "  const lines = String(markdown || '').split(/\\r?\\n/);",
    "  const out = [];",
    "  for (let start = lines.findIndex((line) => line.startsWith('## ')); start >= 0 && start < lines.length;) {",
    "    let end = start + 1;",
    "    while (end < lines.length && !lines[end].startsWith('## ')) end += 1;",
    "    const text = lines.slice(start, end).join('\\n').trim();",
    "    if (text) out.push({ heading: lines[start].trim(), text });",
    "    start = end < lines.length ? end : -1;",
    "  }",
    "  return out;",
    "}",
    "const dirty = git(['status', '--porcelain', '--untracked-files=no']).split(/\\r?\\n/).filter(Boolean).map((line) => line.slice(3).replace(/^\"|\"$/g, ''));",
    "if (!dirty.length || dirty.some((path) => path !== file) || !existsSync(file)) { git(['pull', '--ff-only'], 'inherit'); process.exit(0); }",
    "const base = git(['show', `HEAD:${file}`]);",
    "const local = readFileSync(file, 'utf8');",
    "const baseTexts = new Set(sections(base).map((section) => section.text));",
    "const localOnly = sections(local).filter((section) => !baseTexts.has(section.text));",
    "if (!localOnly.length) { git(['pull', '--ff-only'], 'inherit'); process.exit(0); }",
    "git(['checkout', '--', file], 'inherit');",
    "try { git(['pull', '--ff-only'], 'inherit'); } catch (error) { writeFileSync(file, local, 'utf8'); throw error; }",
    "const pulled = readFileSync(file, 'utf8');",
    "const pulledSections = sections(pulled);",
    "const pulledTexts = new Set(pulledSections.map((section) => section.text));",
    "const pulledHeadings = new Set(pulledSections.map((section) => section.heading));",
    "const missing = localOnly.filter((section) => !pulledTexts.has(section.text) && !pulledHeadings.has(section.heading));",
    "if (missing.length) {",
    "  const match = pulled.match(/^## /m);",
    "  const index = match ? match.index : pulled.length;",
    "  const next = pulled.slice(0, index).replace(/\\s*$/, '\\n\\n') + missing.map((section) => section.text).join('\\n\\n') + '\\n\\n' + pulled.slice(index).replace(/^\\s*/, '');",
    "  writeFileSync(file, next, 'utf8');",
    "  console.log(`Preserved ${missing.length} local CHANGELOG.md section${missing.length === 1 ? '' : 's'} after pulling latest changes.`);",
    "}",
    "HIVE_CHANGELOG_PULL",
    "fi",
  ].join("\n");
}

function remoteUpdateScript(collectorOnly = false) {
  return [
    "repo_url=$(git remote get-url origin)",
    "branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)",
    "if ! (",
    changelogPreservingPullScript(),
    "); then",
    "  status=$(git status --porcelain)",
    '  if [ -z "$status" ]; then',
    "    echo 'git pull failed on a clean checkout; not recloning.' >&2",
    "    exit 1",
    "  fi",
    "  current_dir=$(pwd)",
    '  parent_dir=$(dirname "$current_dir")',
    '  base_name=$(basename "$current_dir")',
    '  backup_dir="$parent_dir/$base_name.backup.$(date -u +%Y%m%dT%H%M%SZ)"',
    '  temp_dir="$parent_dir/$base_name.tmp.$(date -u +%Y%m%dT%H%M%SZ)"',
    '  echo "Checkout is dirty; preserving it at $backup_dir and recloning $repo_url#$branch"',
    '  cd "$parent_dir"',
    '  mv "$current_dir" "$backup_dir"',
    '  git clone --branch "$branch" "$repo_url" "$temp_dir"',
    "  for env_file in .env.local .env; do",
    '    if [ -f "$backup_dir/$env_file" ]; then',
    '      cp "$backup_dir/$env_file" "$temp_dir/$env_file"',
    '      chmod 600 "$temp_dir/$env_file" 2>/dev/null || true',
    "    fi",
    "  done",
    '  mv "$temp_dir" "$current_dir"',
    '  cd "$current_dir"',
    "fi",
    installScriptForCheckout(collectorOnly),
  ].join("\n");
}

function localUpdateScript(collectorOnly = false) {
  return [
    changelogPreservingPullScript(),
    installScriptForCheckout(collectorOnly),
  ].join("\n");
}

function localUpdateRehearsalScript(appDir?: string) {
  const script = [
    "set -euo pipefail",
    appDir?.trim() ? `cd ${shellSingleQuote(appDir.trim())}` : "",
    "echo 'HivemindOS update rehearsal started.'",
    "git rev-parse --is-inside-work-tree >/dev/null",
    'echo "current=$(git rev-parse --short HEAD)"',
    'echo "branch=$(git rev-parse --abbrev-ref HEAD)"',
    "echo 'working-tree-status:'",
    "git status --short --untracked-files=no || true",
    "if command -v pnpm >/dev/null 2>&1; then echo \"pnpm=$(pnpm --version)\"; else echo 'pnpm=missing'; fi",
    "test -f scripts/install-telemetry-collector.sh",
    "echo 'HivemindOS update rehearsal completed.'",
  ].filter(Boolean);
  return script.join("\n");
}

function fallbackScript(
  appDir?: string,
  allowReclone = false,
  collectorOnly = false,
) {
  if (appDir?.trim()) {
    return [
      "set -euo pipefail",
      `cd ${shellSingleQuote(appDir.trim())}`,
      allowReclone
        ? remoteUpdateScript(collectorOnly)
        : localUpdateScript(collectorOnly),
    ].join("\n");
  }
  const candidates = [
    '"$HOME/hivemindos"',
    '"$HOME/openclaw-next"',
    "/root/hivemindos",
    "/opt/hivemindos",
  ];
  return [
    "set -euo pipefail",
    "for d in " + candidates.join(" ") + "; do",
    '  if [ -d "$d/.git" ]; then',
    '    cd "$d"',
    "    break",
    "  fi",
    "done",
    "[ -d .git ] || { echo 'Could not find hivemindos checkout'; exit 2; }",
    allowReclone
      ? remoteUpdateScript(collectorOnly)
      : localUpdateScript(collectorOnly),
  ].join("\n");
}

function runProcess(
  command: string,
  args: string[],
  stdin: string | null,
  timeoutMs: number,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = [stderr.trim(), stdout.trim()]
        .filter(Boolean)
        .join("\n\n");
      reject(
        new Error(
          `${command} exited with code ${code}${detail ? `:\n${detail}` : ""}`,
        ),
      );
    });

    child.stdin.end(stdin ?? "");
  });
}

function isUnknownHostKeyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /No .* host key is known|Host key verification failed|StrictHostKeyChecking/i.test(
    message,
  );
}

function combineOutput(...parts: Array<string | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n");
}

function commandReachedRemote(error: string) {
  return /git pull|pnpm install|install-telemetry-collector|setup\.sh|exited with code/i.test(
    error,
  );
}

async function runTailscaleSsh(target: string, script: string) {
  try {
    return await runProcess(
      "tailscale",
      ["ssh", target, "bash", "-s"],
      script,
      45_000,
    );
  } catch (error) {
    if (!isUnknownHostKeyError(error)) throw error;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n\nTailscale SSH is not enabled or trusted for this machine.`,
    );
  }
}

function plainSshTargets(target: string) {
  if (target.includes("@")) return [target];
  const host = target.replace(/^[^@]+@/, "");
  return [target, `ubuntu@${host}`, `root@${host}`];
}

async function runPlainSsh(target: string, script: string) {
  const errors: string[] = [];
  for (const sshTarget of plainSshTargets(target)) {
    try {
      return await runProcess(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=8",
          "-o",
          "StrictHostKeyChecking=accept-new",
          sshTarget,
          "bash",
          "-s",
        ],
        script,
        20_000,
      );
    } catch (error) {
      errors.push(
        `${sshTarget}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(errors.join("\n\n"));
}

async function runRemoteShell(target: string, script: string) {
  let tailscaleError = "";
  try {
    return await runTailscaleSsh(target, script);
  } catch (error) {
    tailscaleError = error instanceof Error ? error.message : String(error);
  }

  try {
    const result = await runPlainSsh(target, script);
    return {
      ...result,
      stderr: combineOutput(
        `Tailscale SSH failed, plain SSH succeeded. Original Tailscale error:\n${tailscaleError}`,
        result.stderr,
      ),
    };
  } catch (error) {
    const plainSshError =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      combineOutput(
        `Tailscale SSH failed:\n${tailscaleError}`,
        `Plain SSH failed:\n${plainSshError}`,
      ),
    );
  }
}

async function tryTailscaleSsh(body: UpdateBody, collectorOnly = false) {
  const target = body.dnsName || body.name || body.ip;
  if (!target) throw new Error("No Tailscale target was provided.");
  const script = fallbackScript(body.appDir, true, collectorOnly);
  const { stdout, stderr } = await runRemoteShell(target, script);
  return {
    ok: true,
    accepted: true,
    method: "remote-shell",
    target,
    stdout,
    stderr,
    command: script,
  };
}

async function tryDetachedTailscaleSsh(
  body: UpdateBody,
  collectorOnly = false,
) {
  const target = body.dnsName || body.name || body.ip;
  if (!target) throw new Error("No Tailscale target was provided.");
  const updateSteps = collectorOnly
    ? [
        changelogPreservingPullScript(),
        '  if [ -f "$HOME/.hivemindos/collector.env" ]; then . "$HOME/.hivemindos/collector.env"; fi',
        "  HIVE_COLLECTOR_ONLY=true ./scripts/install-telemetry-collector.sh",
      ]
    : [
        changelogPreservingPullScript(),
        "  if command -v corepack >/dev/null 2>&1; then corepack prepare pnpm@8.6.12 --activate; hash -r 2>/dev/null || true; fi",
        '  CI=true NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-deprecation" pnpm install --frozen-lockfile',
        "  pnpm build",
        "  ./setup.sh",
        '  if [ -f "$HOME/.hivemindos/collector.env" ]; then . "$HOME/.hivemindos/collector.env"; fi',
        "  ./scripts/install-telemetry-collector.sh",
      ];
  const updateScript = [
    "set -euo pipefail",
    body.appDir?.trim()
      ? `cd ${shellSingleQuote(body.appDir.trim())}`
      : 'for d in "$HOME/hivemindos" "$HOME/openclaw-next" /root/hivemindos /opt/hivemindos; do if [ -d "$d/.git" ]; then cd "$d"; break; fi; done',
    "[ -d .git ] || { echo 'Could not find hivemindos checkout'; exit 2; }",
    "mkdir -p .next",
    "{",
    '  echo "--- update $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"',
    ...updateSteps,
    "} >> .next/agent-update.log 2>&1 &",
    "echo 'Detached HivemindOS update started.'",
  ].join("\n");
  const { stdout, stderr } = await runRemoteShell(target, updateScript);
  return {
    ok: true,
    accepted: true,
    method: "remote-shell-detached",
    target,
    stdout,
    stderr,
    command: updateScript,
  };
}

async function tryPreferredRemoteUpdate(
  body: UpdateBody,
  collectorOnly = false,
  maintenanceReservationToken?: string,
) {
  try {
    return await tryDetachedTailscaleSsh(body, collectorOnly);
  } catch {
    if (body.collectorUrl)
      return tryCollectorUpdate(body, maintenanceReservationToken);
    return tryTailscaleSsh(body, collectorOnly);
  }
}

async function isLocalCheckout(appDir?: string) {
  if (!appDir?.trim()) return false;
  try {
    await access(join(appDir.trim(), ".git"));
    await access(join(appDir.trim(), "setup.sh"));
    return true;
  } catch {
    return false;
  }
}

async function tryLocalShell(body: UpdateBody, collectorOnly = false) {
  if (body.simulate) {
    const script = localUpdateRehearsalScript(body.appDir);
    const { stdout, stderr } = await runProcess("bash", ["-s"], script, 45_000);
    return {
      ok: true,
      accepted: true,
      method: "local-shell-rehearsal",
      target: "this machine",
      stdout,
      stderr,
      command: script,
      simulated: true,
    };
  }
  if (body.appDir?.trim()) {
    const status = await runProcess(
      "git",
      ["-C", body.appDir.trim(), "status", "--porcelain"],
      null,
      10_000,
    );
    const dirtyFiles = status.stdout.trim();
    if (dirtyFiles) {
      throw new Error(
        [
          "This Mac has uncommitted local changes, so HivemindOS will not run an automatic git pull over them.",
          "Commit, stash, or discard the local changes, then try Update again.",
          "",
          dirtyFiles.split("\n").slice(0, 24).join("\n"),
        ].join("\n"),
      );
    }
  }
  const script = fallbackScript(body.appDir, false, collectorOnly);
  const { stdout, stderr } = await runProcess("bash", ["-s"], script, 300_000);
  return {
    ok: true,
    accepted: true,
    method: "local-shell",
    target: "this machine",
    stdout,
    stderr,
    command: script,
  };
}

export async function POST(request: Request) {
  const parsedBody = (await request.json().catch(() => ({}))) as UpdateBody;
  const body = await updateBodyWithTarget(parsedBody);
  const preUpdateHealth = await fetchCollectorHealth(body.collectorUrl);
  const verificationOptions: VerificationOptions = {
    requireCollectorRestart: updateNeededBefore(body, preUpdateHealth),
    previousCollectorStartedAtMs: collectorStartedAtMs(preUpdateHealth),
    requestedAtMs: Date.now(),
  };
  // A machine that already reports the target commit and capabilities (e.g. it was just
  // updated on-device) needs no update run; dashboards often request one from a stale
  // fleet snapshot right after a manual update.
  if (
    !body.simulate &&
    preUpdateHealth &&
    !updateNeededBefore(body, preUpdateHealth)
  ) {
    return Response.json({
      ok: true,
      accepted: false,
      method: "already-current",
      verified: true,
      health: preUpdateHealth,
    });
  }
  const collectorOnly = preUpdateHealth?.mode === "collector-only";
  const reservation = body.simulate
    ? { supported: false }
    : await reserveCollectorUpdate(body.collectorUrl);
  if (reservation.error) {
    return Response.json(
      { ok: false, error: reservation.error },
      { status: reservation.status === 409 ? 409 : 503 },
    );
  }
  const maintenanceReservationToken = reservation.maintenanceReservationToken;
  try {
    const result = await ((await isLocalCheckout(body.appDir))
      ? tryLocalShell(body, collectorOnly)
      : body.preferRemoteShell
        ? tryPreferredRemoteUpdate(body, collectorOnly, maintenanceReservationToken)
        : body.collectorUrl
          ? tryCollectorUpdate(body, maintenanceReservationToken)
          : tryTailscaleSsh(body, collectorOnly));
    if (body.simulate) {
      return Response.json({
        ...result,
        verified: true,
        health: preUpdateHealth,
      });
    }
    const verification = await waitForCollectorVerification(
      body,
      verificationOptions,
    );
    if (!verification.verified) {
      return Response.json(
        {
          ok: false,
          error: verificationError(
            body,
            verification.health,
            verificationOptions,
          ),
          method: result.method,
          stdout: "stdout" in result ? result.stdout : undefined,
          stderr: "stderr" in result ? result.stderr : undefined,
          health: verification.health,
          fallbackCommand: fallbackScript(body.appDir, false, collectorOnly),
        },
        { status: 502 },
      );
    }
    return Response.json({
      ...result,
      verified: true,
      health: verification.health,
    });
  } catch (error) {
    const rawError = error instanceof Error ? error.message : "Update failed";
    if (commandReachedRemote(rawError)) {
      return Response.json(
        {
          ok: false,
          error: rawError,
          fallbackCommand: fallbackScript(body.appDir, false, collectorOnly),
        },
        { status: 502 },
      );
    }
    return Response.json(
      {
        ok: false,
        error: rawError,
        fallbackCommand: fallbackScript(body.appDir, false, collectorOnly),
      },
      { status: 502 },
    );
  } finally {
    await releaseCollectorUpdateReservation(
      body.collectorUrl,
      maintenanceReservationToken,
    );
  }
}
