import { execFile } from "child_process";
import { constants } from "fs";
import { access, chmod, mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

async function ensureEnvFile(path: string) {
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  const exists = await access(path, constants.F_OK).then(() => true).catch(() => false);
  if (!exists) {
    await writeFile(path, "HCLOUD_TOKEN=\n", { encoding: "utf-8", mode: 0o600 });
    return;
  }
  const text = await readFile(path, "utf-8").catch(() => "");
  if (!/^HCLOUD_TOKEN=/m.test(text)) {
    await writeFile(path, `${text}${text.endsWith("\n") || !text ? "" : "\n"}HCLOUD_TOKEN=\n`, { encoding: "utf-8" });
  }
  await chmod(path, 0o600).catch(() => undefined);
}

export async function POST() {
  const envPath = join(homedir(), ".hivemindos", ".env");
  try {
    await ensureEnvFile(envPath);
    await execFileAsync("open", [envPath], { timeout: 5_000 });
    return Response.json({ ok: true, message: `Opened ${envPath}` });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not open the local HivemindOS env file.",
    }, { status: 500 });
  }
}
