import { NextRequest } from "next/server";
import { constants } from "fs";
import { access, realpath, stat, readFile } from "fs/promises";
import { basename, extname, isAbsolute, join, resolve, sep } from "path";

import { requireAuth } from "@/lib/utils/server-auth";
import { homedir } from "@/lib/home-dir";
import { expandHomePath, resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a company deliverable's file bytes for viewing/downloading. Agents on
 * other fleet machines write artifacts into the SHARED Obsidian vault, which
 * Syncthing already replicates to this machine — so a foreign vault path like
 * `/root/Documents/Obsidian/hivemindos-vault/...` (or `~/…` on another OS) is
 * re-homed onto THIS machine's vault root and read locally. That is the
 * "download it first" step, already done by vault sync; this route just resolves
 * the cross-machine path to the local copy. Non-vault local paths are also served
 * when they resolve inside the operator's home directory.
 *
 * Safety: the resolved real path MUST stay inside the local vault root or the
 * home directory — traversal outside is refused. Auth-gated like every dashboard
 * route (the browser's session cookie carries through an <a download> click).
 */

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — generous for CSVs/docs, bounded so a huge file can't wedge the server
const VAULT_SEGMENT = "hivemindos-vault";

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Turn a possibly-foreign deliverable path into candidate LOCAL paths, in
 * priority order: (1) re-home a shared-vault path onto this machine's vault root,
 * (2) the path as-is (a This-Mac deliverable), (3) `~`-expanded.
 */
function localCandidates(rawPath: string, vaultRoot: string): string[] {
  const candidates: string[] = [];
  const normalizedInput = rawPath.replace(/\\/g, "/").trim();

  // (1) Vault re-home: splice everything AFTER the vault folder segment onto the
  // local vault root, so a different machine's home prefix doesn't matter.
  const parts = normalizedInput.split("/").filter(Boolean);
  const vaultIdx = parts.lastIndexOf(VAULT_SEGMENT);
  if (vaultIdx >= 0 && vaultIdx < parts.length - 1) {
    candidates.push(join(vaultRoot, ...parts.slice(vaultIdx + 1)));
  }

  // (2) As-is absolute path (This-Mac deliverables).
  if (isAbsolute(rawPath)) candidates.push(resolve(rawPath));

  // (3) Home-relative.
  if (rawPath.startsWith("~")) candidates.push(resolve(expandHomePath(rawPath)));

  return [...new Set(candidates)];
}

function withinRoot(target: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(normalizedRoot);
}

/** Resolve to a real, readable, in-bounds local file — or null if not available here. */
async function resolveLocalFile(rawPath: string, vaultRoot: string, home: string): Promise<string | null> {
  for (const candidate of localCandidates(rawPath, vaultRoot)) {
    try {
      await access(candidate, constants.R_OK);
      const real = await realpath(candidate);
      // Refuse anything that escapes the vault AND the home dir (no /etc/... reads).
      if (!withinRoot(real, vaultRoot) && !withinRoot(real, home)) continue;
      const info = await stat(real);
      if (info.isFile()) return real;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const rawPath = request.nextUrl.searchParams.get("path")?.trim();
  if (!rawPath) return Response.json({ ok: false, error: "path is required" }, { status: 400 });
  const asDownload = request.nextUrl.searchParams.get("download") === "1";

  const vaultRoot = await realpath(resolveObsidianVaultPath()).catch(() => resolveObsidianVaultPath());
  const home = await realpath(homedir()).catch(() => homedir());

  const localFile = await resolveLocalFile(rawPath, vaultRoot, home);
  if (!localFile) {
    // Not present on this machine (e.g. a non-vault artifact on a remote box that
    // vault-sync doesn't cover). Honest 404 so the UI can show a "not synced" note
    // instead of a silent dead link.
    return Response.json(
      { ok: false, error: "This file isn't available on this machine yet. Vault artifacts sync automatically; non-vault outputs stay on the machine that produced them.", path: rawPath },
      { status: 404 },
    );
  }

  const info = await stat(localFile);
  if (info.size > MAX_FILE_BYTES) {
    return Response.json({ ok: false, error: `File is too large to open here (${Math.round(info.size / 1024 / 1024)} MB > 50 MB cap).`, path: localFile }, { status: 413 });
  }

  const bytes = await readFile(localFile);
  const fileName = basename(localFile);
  const headers = new Headers({
    "content-type": contentTypeFor(localFile),
    "content-length": String(bytes.length),
    "cache-control": "no-store",
    "content-disposition": `${asDownload ? "attachment" : "inline"}; filename="${fileName.replace(/["\\]/g, "_")}"`,
  });
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}
