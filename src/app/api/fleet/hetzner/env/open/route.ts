import { execFile } from "child_process";
import { chmod } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import { promisify } from "util";
import { ensureSharedHiveEnvPlaceholder } from "@/lib/services/hive-env-write";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function POST() {
  const envPath = join(homedir(), ".hivemindos", ".env");
  try {
    await ensureSharedHiveEnvPlaceholder("HCLOUD_TOKEN");
    await chmod(envPath, 0o600).catch(() => undefined);
    await execFileAsync("open", [envPath], { timeout: 5_000 });
    return Response.json({ ok: true, message: `Opened ${envPath}` });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not open the local HivemindOS env file.",
    }, { status: 500 });
  }
}
