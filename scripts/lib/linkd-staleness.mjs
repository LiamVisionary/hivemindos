// Shared stale-linkd criterion: a deployed hivemind-linkd binary is stale
// ONLY when the sources `go build ./cmd/hivemind-linkd` consumes actually
// differ between the commit stamped into the binary and the checkout it
// serves. A bare stamp-vs-HEAD mismatch is NOT staleness: every commit that
// doesn't touch linkd legitimately advances the checkout while every healthy
// box keeps its old stamp, so a HEAD-equality check false-alarms fleet-wide
// after any unrelated push (live 2026-07-03: hivemindos-ubuntu-8gb-hel1-2
// alerted "built b535fb9, checkout 09dfaa9" though nothing between them
// touched linkd).
//
// Two consumers must stay in agreement or the fleet either rebuilds Go on
// every update or alerts forever with no path to clear:
// - scripts/fleet-health-watchdog.mjs (stale-build alert)
// - scripts/install-telemetry-collector.sh `linkd_sources_unchanged_since`
//   (rebuild skip — bash reimplementation of the same paths + `git diff
//   --quiet`; test-linkd-staleness.mjs guards the path lists against drift)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Everything the linkd build reads: the package itself (self-contained —
// stdlib + tailscale.com imports only), the module pins, and the build script
// (ldflags/output shape). Keep in sync with install-telemetry-collector.sh.
export const LINKD_SOURCE_PATHS = [
  "cmd/hivemind-linkd",
  "go.mod",
  "go.sum",
  "scripts/build-hivemind-linkd.sh",
];

// Commit stamps arrive from remote /_hivemind/version and /health JSON —
// gate them before they become git argv.
export function isGitCommitish(value) {
  return /^[0-9a-f]{6,40}$/i.test(String(value ?? ""));
}

// true = linkd sources differ between the two commits (rebuild needed),
// false = identical (binary is current regardless of stamp mismatch),
// null = indeterminate (bad/unknown commit, e.g. this clone is behind the
// remote box's checkout) — callers must not treat null as stale.
export async function linkdSourcesChangedBetween(repoRoot, builtCommit, checkoutCommit) {
  if (!isGitCommitish(builtCommit) || !isGitCommitish(checkoutCommit)) return null;
  const git = (args) => execFileAsync("git", ["-C", repoRoot, ...args]);
  try {
    await git(["rev-parse", "--verify", "--quiet", `${builtCommit}^{commit}`]);
    await git(["rev-parse", "--verify", "--quiet", `${checkoutCommit}^{commit}`]);
  } catch {
    return null;
  }
  try {
    await git(["diff", "--quiet", builtCommit, checkoutCommit, "--", ...LINKD_SOURCE_PATHS]);
    return false;
  } catch (error) {
    if (error?.code === 1) return true;
    return null;
  }
}
