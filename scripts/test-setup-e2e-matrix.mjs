// On-demand runner for the cross-platform setup E2E matrix
// (.github/workflows/setup-e2e-matrix.yml). The matrix needs real
// ubuntu/macos/windows machines, so it lives in GitHub Actions; this script
// dispatches it via `gh`, finds the run it started, and watches it to a
// pass/fail exit code so it behaves like any other local test harness.
//
// Usage:
//   pnpm test:e2e:setup-matrix              # dispatch on main and watch
//   node scripts/test-setup-e2e-matrix.mjs --ref my-branch
//   node scripts/test-setup-e2e-matrix.mjs --no-watch   # dispatch, print URL, exit
//
// Expect ~50-90 minutes total: the Windows production build job alone runs
// 45+ minutes on the 2-core runner (its timeout is 90).
import { execFileSync, spawnSync } from "node:child_process";

const WORKFLOW = "setup-e2e-matrix.yml";

const args = process.argv.slice(2);
const refIndex = args.indexOf("--ref");
const ref = refIndex !== -1 ? args[refIndex + 1] : "main";
const watch = !args.includes("--no-watch");

if (refIndex !== -1 && !ref) {
  console.error("--ref requires a branch name");
  process.exit(1);
}

function gh(ghArgs) {
  return execFileSync("gh", ghArgs, { encoding: "utf8" });
}

try {
  gh(["auth", "status"]);
} catch {
  console.error("gh is not installed or not authenticated. Run `gh auth login` first.");
  process.exit(1);
}

const dispatchedAt = new Date();
console.log(`Dispatching ${WORKFLOW} on ${ref}...`);
gh(["workflow", "run", WORKFLOW, "--ref", ref]);

// `gh workflow run` returns before the run is queued; poll for the run this
// dispatch created (workflow_dispatch on our ref, created at/after dispatch).
let run = null;
for (let attempt = 0; attempt < 15 && !run; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const runs = JSON.parse(
    gh([
      "run", "list",
      "--workflow", WORKFLOW,
      "--branch", ref,
      "--event", "workflow_dispatch",
      "--limit", "5",
      "--json", "databaseId,createdAt,url,status",
    ]),
  );
  run = runs.find((candidate) => new Date(candidate.createdAt) >= new Date(dispatchedAt.getTime() - 60_000));
}

if (!run) {
  console.error("Dispatched, but could not find the new run after 60s. Check `gh run list` manually.");
  process.exit(1);
}

console.log(`Run started: ${run.url}`);

if (!watch) {
  console.log("--no-watch set; not waiting for completion.");
  process.exit(0);
}

console.log("Watching (the Windows build job can take 45-90 minutes)...");
const watched = spawnSync(
  "gh",
  ["run", "watch", String(run.databaseId), "--exit-status", "--interval", "30"],
  { stdio: "inherit" },
);

if (watched.status === 0) {
  console.log("✓ Setup E2E matrix passed on all platforms.");
} else {
  console.error(`✗ Setup E2E matrix failed. Inspect: ${run.url}`);
}
process.exit(watched.status ?? 1);
