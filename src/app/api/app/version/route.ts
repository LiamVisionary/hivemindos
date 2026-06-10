import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const VERSION_CACHE_MS = 60_000;

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

async function packageVersion() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version?: string };
  return packageJson.version || "0.0.0";
}

function parseSemver(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) as [number, number, number] : null;
}

// Releases are versioned by git tag (see bump-app-version.yml); the checked-in
// package.json version is only a floor. Source checkouts report the nearest
// reachable tag when it is ahead of package.json so the header matches the
// released tag. Packaged builds ship without .git, so the tag lookup fails and
// they fall back to package.json — which the release build stamped from the tag.
function effectiveVersion(pkgVersion: string, tagVersion: string) {
  const pkg = parseSemver(pkgVersion);
  const tag = parseSemver(tagVersion);
  if (!tag) return pkgVersion;
  if (!pkg) return tagVersion;
  const diff = (tag[0] - pkg[0]) || (tag[1] - pkg[1]) || (tag[2] - pkg[2]);
  return diff > 0 ? tagVersion : pkgVersion;
}

async function readVersion(): Promise<AppVersionPayload> {
  const [pkgVersion, tagVersion, commit, branch, dirty, remoteCommit] = await Promise.all([
    packageVersion(),
    safeGit(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]),
    safeGit(["rev-parse", "HEAD"]),
    safeGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    safeGit(["status", "--porcelain"]),
    safeGit(["ls-remote", "origin", "main"]),
  ]);
  const version = effectiveVersion(pkgVersion, tagVersion.replace(/^v/, ""));
  const latestCommit = remoteCommit.split(/\s+/)[0] || commit;

  return {
    ok: true,
    appDir: process.cwd(),
    version,
    latestVersion: version,
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
