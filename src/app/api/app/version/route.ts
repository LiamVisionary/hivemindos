import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";
import { effectiveAppVersion, isAppSemver } from "@/lib/services/app-version-resolution";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const VERSION_CACHE_MS = 60_000;
const STABLE_RELEASE_MANIFEST_URL = "https://github.com/LiamVisionary/hivemindos/releases/latest/download/latest.json";
const RELEASE_LOOKUP_TIMEOUT_MS = 5_000;

type AppVersionPayload = {
  ok: true;
  appDir: string;
  version: string;
  latestVersion: string;
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
  latestCommit: string;
  latestShortCommit: string;
  updateCommand: string;
};

let cachedVersion: { checkedAt: number; payload: AppVersionPayload } | null = null;
let inFlightVersion: Promise<AppVersionPayload> | null = null;

async function git(args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    timeout: 5_000,
    maxBuffer: 300_000,
  });
  return stdout.trim();
}

async function safeGit(args: string[]) {
  return git(args).catch(() => "");
}

async function gitSucceeds(args: string[]) {
  return git(args).then(() => true).catch(() => false);
}

async function packageVersion() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version?: string };
  return packageJson.version || "0.0.0";
}

async function stableReleaseVersion() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(STABLE_RELEASE_MANIFEST_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const payload = await response.json().catch(() => null) as { version?: unknown } | null;
    const version = typeof payload?.version === "string" ? payload.version.trim().replace(/^v/, "") : "";
    return isAppSemver(version) ? version : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function reachableStableVersion(stableVersion: string, commit: string, remoteTags: string) {
  if (!isAppSemver(stableVersion) || !/^[0-9a-f]{40,64}$/i.test(commit)) return "";
  const tagRef = `refs/tags/v${stableVersion}`;
  const rows = remoteTags.split("\n").map((row) => row.trim().split(/\s+/));
  const peeledCommit = rows.find(([, ref]) => ref === `${tagRef}^{}`)?.[0];
  const directCommit = rows.find(([, ref]) => ref === tagRef)?.[0];
  const tagCommit = peeledCommit || directCommit || "";
  if (!/^[0-9a-f]{40,64}$/i.test(tagCommit)) return "";
  if (tagCommit === commit) return stableVersion;
  return await gitSucceeds(["merge-base", "--is-ancestor", tagCommit, commit]) ? stableVersion : "";
}

async function readVersion(): Promise<AppVersionPayload> {
  const [pkgVersion, tagVersion, commit, branch, dirty, remoteCommit, remoteTags, latestStableVersion] = await Promise.all([
    packageVersion(),
    safeGit(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]),
    safeGit(["rev-parse", "HEAD"]),
    safeGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    safeGit(["status", "--porcelain"]),
    safeGit(["ls-remote", "origin", "main"]),
    safeGit(["ls-remote", "--tags", "origin", "refs/tags/v*"]),
    stableReleaseVersion(),
  ]);
  const reachableStable = await reachableStableVersion(latestStableVersion, commit, remoteTags);
  // Packaged builds ship without .git and therefore use the version stamped
  // into package.json during release. Source builds use the newest of the four
  // synchronized manifest floor, their reachable local tag, and the stable
  // updater release when its tag is contained in this checkout.
  const version = effectiveAppVersion(pkgVersion, tagVersion.replace(/^v/, ""), reachableStable);
  const latestCommit = remoteCommit.split(/\s+/)[0] || commit;

  return {
    ok: true,
    appDir: process.cwd(),
    version,
    latestVersion: effectiveAppVersion(version, latestStableVersion),
    commit,
    shortCommit: commit.slice(0, 7),
    branch,
    dirty: dirty.length > 0,
    latestCommit,
    latestShortCommit: latestCommit.slice(0, 7),
    updateCommand: "git pull && ./setup.sh",
  };
}

export async function GET() {
  const now = Date.now();
  if (cachedVersion && now - cachedVersion.checkedAt < VERSION_CACHE_MS) {
    return Response.json(cachedVersion.payload);
  }

  inFlightVersion ??= readVersion()
    .then((payload) => {
      cachedVersion = { checkedAt: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlightVersion = null;
    });

  return Response.json(await inFlightVersion);
}
