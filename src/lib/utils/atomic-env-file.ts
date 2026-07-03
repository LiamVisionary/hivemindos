import { renameSync, rmSync, writeFileSync } from "fs";

/**
 * Atomic writer for env/secret files this app owns exclusively (e.g.
 * MiroShark's install .env). A truncate-in-place write can interleave with a
 * concurrent reader and tear the file — the 2026-07-03 .env.local
 * device-token corruption class. A same-directory temp file (created 0600,
 * so the secrets are never readable by other users) renamed over the
 * destination makes each write all-or-nothing. Windows refuses the rename
 * while another process holds the destination open, so fall back to a direct
 * write rather than lose the update (same fallback as
 * scripts/dashboard-auth.mjs writeEnvFile).
 *
 * Do NOT use this for the shared hive env (~/.hivemindos/.env) or runtime
 * envs — those have concurrent writers and must go through
 * src/lib/services/hive-env-write.ts, which routes through hive-env-add's
 * cross-process lock and updatedAt meta.
 */
export function writeEnvFileAtomicSync(file: string, text: string): void {
  const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpFile, text, { mode: 0o600 });
  try {
    renameSync(tmpFile, file);
  } catch {
    writeFileSync(file, text, { mode: 0o600 });
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      // the env write already succeeded; a failed temp cleanup must not fail it
    }
  }
}
