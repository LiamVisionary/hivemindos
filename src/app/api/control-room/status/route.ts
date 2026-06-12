import { NextRequest } from "next/server";
import { access, readFile, stat } from "fs/promises";
import { constants } from "fs";
import { homedir } from "@/lib/home-dir";
import { resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const REQUIRED_FILES = [
  "README.md",
  "docs/starter-guide.md",
  "docs/security.md",
  "docs/task-bus.md",
  "templates/task-bus/agents.yaml",
  "skills/setup-control-room/assets/bootstrap.sh",
];

function expandHome(path: string): string {
  return path.replace(/^~(?=$|\/)/, homedir());
}

export async function POST(request: NextRequest) {
  let controlRoomPath = "";
  try {
    const body = (await request.json()) as { controlRoomPath?: string };
    controlRoomPath = body.controlRoomPath?.trim() ?? "";
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!controlRoomPath) {
    return Response.json({ ok: false, error: "controlRoomPath is required" }, { status: 400 });
  }

  const resolvedPath = resolve(expandHome(controlRoomPath));
  try {
    const pathStats = await stat(resolvedPath);
    if (!pathStats.isDirectory()) {
      return Response.json({ ok: false, controlRoomPath: resolvedPath, error: "HivemindOS path is not a directory" });
    }
    await access(resolvedPath, constants.R_OK);

    const files = await Promise.all(REQUIRED_FILES.map(async (file) => {
      const path = resolve(resolvedPath, file);
      try {
        await access(path, constants.R_OK);
        return { file, present: true };
      } catch {
        return { file, present: false };
      }
    }));

    const missing = files.filter((file) => !file.present).map((file) => file.file);
    const commit = await execFileAsync("git", ["-C", resolvedPath, "rev-parse", "HEAD"], { timeout: 5_000 })
      .then(({ stdout }) => stdout.trim())
      .catch(() => null);
    const pushRemote = await execFileAsync("git", ["-C", resolvedPath, "remote", "get-url", "--push", "origin"], { timeout: 5_000 })
      .then(({ stdout }) => stdout.trim())
      .catch(() => null);
    const bootstrap = await readFile(resolve(resolvedPath, "skills/setup-control-room/assets/bootstrap.sh"), "utf-8").catch(() => "");
    const liveInstallerWarnings = [
      "deb.nodesource.com",
      "get.docker.com",
      "hermes-agent.nousresearch.com/install.sh",
      "npm install -g",
      "nousresearch/hermes-agent:latest",
    ].filter((needle) => bootstrap.includes(needle));

    return Response.json({
      ok: missing.length === 0,
      controlRoomPath: resolvedPath,
      commit,
      pushRemote,
      files,
      missing,
      liveInstallerWarnings,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      controlRoomPath: resolvedPath,
      error: error instanceof Error ? error.message : "Could not read HivemindOS path",
    });
  }
}
