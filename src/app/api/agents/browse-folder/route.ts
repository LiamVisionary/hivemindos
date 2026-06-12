import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "@/lib/home-dir";
import { join, sep } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expandHomePath(path: string) {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function displayPath(path: string) {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(`${home}${sep}`) ? `~/${path.slice(home.length + 1)}` : path;
}

export async function POST(request: Request) {
  let body: { currentPath?: string; prompt?: string };
  try {
    body = await request.json() as { currentPath?: string; prompt?: string };
  } catch {
    body = {};
  }

  const currentPath = expandHomePath(body.currentPath ?? "");
  const defaultPath = currentPath && existsSync(currentPath) ? currentPath : homedir();
  const prompt = (body.prompt?.trim() || "Choose this agent's runtime folder:").replace(/"/g, '\\"');
  const script = [
    `set defaultPath to POSIX file "${defaultPath.replace(/"/g, '\\"')}"`,
    "try",
    `  set chosen to choose folder with prompt "${prompt}" default location defaultPath`,
    "  POSIX path of chosen",
    "on error",
    "  \"\"",
    "end try",
  ].join("\n");

  return new Promise<Response>((resolve) => {
    execFile("osascript", ["-e", script], (error, stdout) => {
      const chosen = stdout.trim().replace(/\/$/, "");
      if (error || !chosen) {
        resolve(Response.json({ cancelled: true }));
        return;
      }
      resolve(Response.json({ path: displayPath(chosen) }));
    });
  });
}
