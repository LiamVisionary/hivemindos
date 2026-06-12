import { mkdir } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { basename, isAbsolute, join, normalize, resolve, sep } from "path";

export const runtime = "nodejs";

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
  return path === home ? "~" : path.startsWith(`${home}${sep}`) ? `~/${path.slice(home.length + 1)}` : path;
}

function cleanFolderName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "";
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) return "";
  return trimmed;
}

export async function POST(request: Request) {
  let body: { parentPath?: string; name?: string };
  try {
    body = await request.json() as { parentPath?: string; name?: string };
  } catch {
    return Response.json({ error: "Expected { parentPath, name }" }, { status: 400 });
  }

  const parentPath = expandHomePath(body.parentPath ?? "");
  const name = cleanFolderName(body.name ?? "");
  if (!parentPath || !name) {
    return Response.json({ error: "Choose a parent directory and a simple folder name." }, { status: 400 });
  }

  const resolvedParent = isAbsolute(parentPath) ? normalize(parentPath) : resolve(process.cwd(), parentPath);
  const targetPath = normalize(join(resolvedParent, name));
  const parentPrefix = resolvedParent.endsWith(sep) ? resolvedParent : `${resolvedParent}${sep}`;
  if (!targetPath.startsWith(parentPrefix)) {
    return Response.json({ error: "Folder must be created inside the selected location." }, { status: 400 });
  }

  try {
    await mkdir(targetPath, { recursive: false, mode: 0o755 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create folder.";
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    path: displayPath(targetPath),
    label: basename(targetPath),
  });
}
