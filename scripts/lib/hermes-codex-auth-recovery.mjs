const RECOVERY_STATUSES = new Set([
  "healthy",
  "repaired",
  "unavailable",
  "unchanged",
]);

export function hermesAgentUsesCodex(agent = {}) {
  return String(agent?.provider || "").trim() === "openai-codex";
}

function recoveryPythonScript() {
  return String.raw`
import json
from hermes_cli.auth import (
    AuthError,
    _codex_access_token_is_expiring,
    _import_codex_cli_tokens,
    _save_codex_tokens,
    resolve_codex_runtime_credentials,
)


def emit(status, **details):
    print(json.dumps({"status": status, **details}, separators=(",", ":")))


def usable(credentials):
    token = credentials.get("api_key") if isinstance(credentials, dict) else None
    return bool(token) and not _codex_access_token_is_expiring(token, 60)


profile_error_code = None
try:
    current = resolve_codex_runtime_credentials()
    if usable(current):
        emit("healthy", source=str(current.get("source") or "profile"))
        raise SystemExit(0)
    profile_error_code = "codex_access_token_expired"
except AuthError as error:
    profile_error_code = str(getattr(error, "code", None) or "codex_auth_error")
    if not getattr(error, "relogin_required", False):
        emit("unchanged", reason=profile_error_code)
        raise SystemExit(0)
except Exception:
    emit("unchanged", reason="profile_check_failed")
    raise SystemExit(0)

imported = _import_codex_cli_tokens()
if not (
    isinstance(imported, dict)
    and str(imported.get("access_token") or "").strip()
    and str(imported.get("refresh_token") or "").strip()
):
    emit(
        "unavailable",
        reason="codex_cli_login_unavailable",
        profileErrorCode=profile_error_code,
    )
    raise SystemExit(0)

_save_codex_tokens(imported)
repaired = resolve_codex_runtime_credentials(refresh_if_expiring=False)
if not usable(repaired):
    emit(
        "unavailable",
        reason="recovered_token_unusable",
        profileErrorCode=profile_error_code,
    )
    raise SystemExit(0)

emit(
    "repaired",
    source="codex-cli",
    profileErrorCode=profile_error_code,
)
`;
}

function parseRecoveryResult(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(lines[index]);
      if (
        payload &&
        typeof payload === "object" &&
        RECOVERY_STATUSES.has(payload.status)
      ) {
        return payload;
      }
    } catch {
      // Hermes may emit informational output before the final JSON status.
    }
  }
  throw new Error("Hermes Codex auth preflight returned no recovery status.");
}

/**
 * Let Hermes refresh its profile-owned Codex grant first. If that grant is
 * missing, expired, or rejected, adopt the still-valid Codex CLI grant through
 * Hermes' own locked auth-store writer. Raw token values never cross stdout.
 */
export async function repairHermesCodexAuth({
  hermesHome,
  projectDir,
  pythonPath,
  execFileAsync,
  env = process.env,
}) {
  const { stdout } = await execFileAsync(
    pythonPath,
    ["-c", recoveryPythonScript()],
    {
      cwd: projectDir,
      env: {
        ...env,
        HERMES_HOME: hermesHome,
        PYTHONPATH: projectDir,
      },
      timeout: 30_000,
      maxBuffer: 1_000_000,
    },
  );
  return parseRecoveryResult(stdout);
}
