import { tailnetAutoCleanupEnabled } from "@/lib/services/fleet/tailnet-cleanup";
import { spawnHiveEnvAdd } from "@/lib/services/hive-env-command";

export const runtime = "nodejs";

function saveAutoCleanupSetting(enabled: boolean) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnHiveEnvAdd(["--import-stdin"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving the tailnet cleanup setting."));
    }, 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `hive-env-add exited with status ${code ?? "unknown"} while saving the tailnet cleanup setting.`));
    });
    child.stdin.end(`HIVE_TAILNET_AUTO_CLEANUP=${enabled ? "1" : "0"}\n`);
  });
}

export async function GET() {
  return Response.json({ ok: true, autoCleanupEnabled: await tailnetAutoCleanupEnabled() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { autoCleanup?: boolean };
  if (typeof body.autoCleanup !== "boolean") {
    return Response.json({ ok: false, error: "Pass { autoCleanup: true | false }." }, { status: 400 });
  }
  try {
    await saveAutoCleanupSetting(body.autoCleanup);
    return Response.json({ ok: true, autoCleanupEnabled: body.autoCleanup });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
