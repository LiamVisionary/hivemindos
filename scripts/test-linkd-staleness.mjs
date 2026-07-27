#!/usr/bin/env node
// Guards the shared stale-linkd criterion (scripts/lib/linkd-staleness.mjs):
// a linkd binary is stale ONLY when linkd sources actually changed between
// its stamped commit and the checkout. The watchdog's stale alert and the
// installer's rebuild-skip both key off this; when they disagreed
// (2026-07-03), every unrelated push made hivemindos-ubuntu-8gb-hel1-2 alert
// "built b535fb9, checkout 09dfaa9" daily with no rebuild that could clear it.
// Hermetic: builds a throwaway git repo under a tmp dir, no network.

import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

import {
  LINKD_SOURCE_PATHS,
  isGitCommitish,
  linkdSourcesChangedBetween,
} from "./lib/linkd-staleness.mjs";

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

const repo = await mkdtemp(join(tmpdir(), "linkd-staleness-"));
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
const git = (...args) => execFileAsync("git", ["-C", repo, ...args], { env: gitEnv });

async function commitAll(message) {
  await git("add", "-A");
  await git("commit", "-q", "-m", message);
  return (await git("rev-parse", "--short", "HEAD")).stdout.trim();
}

try {
  await git("init", "-q");

  await mkdir(join(repo, "cmd/hivemind-linkd"), { recursive: true });
  await mkdir(join(repo, "scripts"), { recursive: true });
  await writeFile(join(repo, "cmd/hivemind-linkd/main.go"), "package main\n");
  await writeFile(join(repo, "go.mod"), "module hivemind\n");
  await writeFile(join(repo, "go.sum"), "\n");
  await writeFile(join(repo, "scripts/build-hivemind-linkd.sh"), "#!/bin/sh\n");
  await writeFile(join(repo, "scripts/fleet-health-watchdog.mjs"), "// v1\n");
  const built = await commitAll("linkd sources land");

  // The Ubuntu case: commits that touch NO linkd source advance the checkout
  // while the binary legitimately keeps its stamp — NOT stale.
  await writeFile(join(repo, "scripts/fleet-health-watchdog.mjs"), "// v2\n");
  const unrelated = await commitAll("unrelated watchdog change");
  assert.equal(await linkdSourcesChangedBetween(repo, built, unrelated), false,
    "unrelated commit must not read as stale");
  assert.equal(await linkdSourcesChangedBetween(repo, built, built), false,
    "identical commits are never stale");

  // A real linkd change IS stale, from either earlier stamp.
  await writeFile(join(repo, "cmd/hivemind-linkd/main.go"), "package main // changed\n");
  const goChange = await commitAll("linkd go change");
  assert.equal(await linkdSourcesChangedBetween(repo, built, goChange), true,
    "go source change must read as stale");
  assert.equal(await linkdSourcesChangedBetween(repo, unrelated, goChange), true,
    "go source change must read as stale from the unrelated stamp too");

  // Dependency pins count as sources — a go.sum bump changes the binary.
  await writeFile(join(repo, "go.sum"), "pinned\n");
  const sumChange = await commitAll("dep bump");
  assert.equal(await linkdSourcesChangedBetween(repo, goChange, sumChange), true,
    "go.sum change must read as stale");

  // A change + revert leaves identical trees — not stale even though
  // commits touched linkd in between (tree diff, not commit-list scan).
  await writeFile(join(repo, "go.sum"), "\n");
  const reverted = await commitAll("revert dep bump");
  assert.equal(await linkdSourcesChangedBetween(repo, goChange, reverted), false,
    "change+revert must not read as stale");

  // Indeterminate inputs must never read as stale: unknown commit (a clone
  // that is behind), pre-stamp "unknown", empties, and anything that is not
  // a bare hex commitish (stamps arrive from remote JSON and become argv).
  assert.equal(await linkdSourcesChangedBetween(repo, "deadbeefcafe", goChange), null);
  assert.equal(await linkdSourcesChangedBetween(repo, "unknown", goChange), null);
  assert.equal(await linkdSourcesChangedBetween(repo, "", goChange), null);
  assert.equal(await linkdSourcesChangedBetween(repo, "--upload-pack=/tmp/x", goChange), null);
  assert.equal(isGitCommitish(built), true);
  assert.equal(isGitCommitish("HEAD"), false);

  // Drift guard: the installer's bash reimplementation must diff the same
  // paths, or the skip and the alert disagree again (rebuild treadmill or a
  // daily alert that can never clear).
  const installer = await readFile(join(SCRIPTS_DIR, "install-telemetry-collector.sh"), "utf8");
  assert.match(installer, /linkd_sources_unchanged_since/,
    "installer lost its source-diff rebuild skip");
  for (const path of LINKD_SOURCE_PATHS) {
    assert.ok(installer.includes(path),
      `installer's linkd rebuild-skip no longer diffs "${path}" (keep in sync with lib/linkd-staleness.mjs)`);
  }

  console.log("linkd staleness criterion: all assertions passed");
} finally {
  await rm(repo, { recursive: true, force: true });
}
