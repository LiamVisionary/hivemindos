// Hermetic suite for src/lib/services/obsidian/scheduled-runs.ts — the
// shared-vault schedule mirrors under Operations/Automations/. Directories
// are keyed by the STABLE machine id (~/.hivemindos/machine-id,
// hivemind-machine-<32 hex>) when the snapshot carries one, falling back to
// the legacy machine-name key otherwise. Keying by name forked the tree on
// every hostname rename (the NYC MacBook produced three directories across
// its 2026-07 hostname churn), so this suite guards the id keying, the
// name-key fallback, and the lazy adoption of legacy name-keyed directories.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  listScheduledSchedules,
  readPastScheduledRuns,
  recordScheduledRun,
  upsertScheduledSchedule,
} = await import("../src/lib/services/obsidian/scheduled-runs.ts");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-scheduled-runs-"));
const root = join(vaultPath, "Operations", "Automations");
const MACHINE_ID = `hivemind-machine-${"a1".repeat(16)}`;
const MACHINE_NAME = "hivemindos-liams-macbook-pro-nyc";

function snapshot(overrides = {}) {
  return {
    id: "sched-1",
    name: "Watch Job",
    agentId: "agent-1",
    agentName: "Hermes",
    machineName: MACHINE_NAME,
    machineId: MACHINE_ID,
    runtime: "hermes",
    enabled: true,
    every: "15m",
    mode: "prompt",
    prompt: "Check the thing.",
    skills: [],
    paths: [],
    steps: [],
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

async function runRecord(schedule, runId, startedAt) {
  return recordScheduledRun({
    vaultPath,
    record: {
      schedule,
      runId,
      agentName: "Hermes",
      machineName: schedule.machineName,
      status: "ok",
      startedAt,
      completedAt: startedAt + 1000,
      prompt: "Check the thing.",
      output: `output for ${runId}`,
    },
  });
}

// 1. A snapshot with a stable machine id keys its directory by the id, and
// the human-readable name lives in the frontmatter/body instead of the path.
{
  const result = await upsertScheduledSchedule({ vaultPath, schedule: snapshot() });
  assert.equal(result.folder, join("Operations", "Automations", MACHINE_ID, "Watch-Job"));
  const content = await readFile(join(vaultPath, result.path), "utf8");
  assert.match(content, new RegExp(`^machineId: "${MACHINE_ID}"$`, "m"));
  assert.match(content, new RegExp(`^machineName: "${MACHINE_NAME}"$`, "m"));
  assert.match(content, new RegExp(`- Device: ${MACHINE_NAME}`));
  assert.match(content, new RegExp(`- Machine ID: \`${MACHINE_ID}\``));
  const schedules = await listScheduledSchedules({ vaultPath });
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].machineId, MACHINE_ID, "machineId round-trips through Config JSON");
  assert.equal(schedules[0].machineName, MACHINE_NAME);
}

// 2. Snapshots without a machine id keep the legacy name key, and malformed
// ids are rejected rather than minting junk directories.
{
  const plain = await upsertScheduledSchedule({
    vaultPath,
    schedule: snapshot({ id: "sched-2", name: "Dashboard Job", machineName: "dashboard", machineId: undefined }),
  });
  assert.equal(plain.folder, join("Operations", "Automations", "dashboard", "Dashboard-Job"));
  const malformed = await upsertScheduledSchedule({
    vaultPath,
    schedule: snapshot({ id: "sched-3", name: "Bad Id Job", machineName: "somebox", machineId: "hivemind-machine-nothex" }),
  });
  assert.equal(malformed.folder, join("Operations", "Automations", "somebox", "Bad-Id-Job"));
  // Uppercase ids normalize instead of forking a case-variant directory.
  const upper = await upsertScheduledSchedule({
    vaultPath,
    schedule: snapshot({ id: "sched-4", name: "Upper Job", machineId: MACHINE_ID.toUpperCase() }),
  });
  assert.equal(upper.folder, join("Operations", "Automations", MACHINE_ID, "Upper-Job"));
}

// 3. Adoption: a legacy name-keyed directory (schedule + run history) is
// renamed to the machine-id key the first time the id is known, run
// numbering continues, and past runs stay readable.
{
  const legacySchedule = snapshot({ id: "sched-5", name: "Legacy Job", machineId: undefined });
  await upsertScheduledSchedule({ vaultPath, schedule: legacySchedule });
  await runRecord(legacySchedule, "run-a", 1_760_000_100_000);
  const legacyDir = join(root, MACHINE_NAME, "Legacy-Job");
  assert.ok(existsSync(legacyDir), "legacy name-keyed dir exists before adoption");

  const keyed = snapshot({ id: "sched-5", name: "Legacy Job" });
  const result = await upsertScheduledSchedule({ vaultPath, schedule: keyed });
  assert.equal(result.folder, join("Operations", "Automations", MACHINE_ID, "Legacy-Job"));
  assert.ok(!existsSync(legacyDir), "legacy schedule dir was adopted");
  assert.ok(!existsSync(join(root, MACHINE_NAME)), "empty legacy device dir was removed");
  const names = await readdir(join(root, MACHINE_ID, "Legacy-Job"));
  assert.ok(names.some((name) => name.startsWith("run0001-")), "run history moved with the schedule");

  const runs = await readPastScheduledRuns({ vaultPath, schedule: keyed });
  assert.equal(runs.length, 1);
  assert.match(runs[0].content, /output for run-a/);
  const next = await runRecord(keyed, "run-b", 1_760_000_200_000);
  assert.equal(next.runNumber, 2, "run numbering continues after adoption");
}

// 4. Adoption when both directories exist: non-colliding run files move, the
// superseded legacy schedule.md is dropped, colliding run files are left
// behind untouched, and a non-empty legacy dir is not deleted.
{
  const keyed = snapshot({ id: "sched-6", name: "Merge Job" });
  await upsertScheduledSchedule({ vaultPath, schedule: keyed });
  const dir = join(root, MACHINE_ID, "Merge-Job");
  await writeFile(join(dir, "run0001-hermes-x.md"), "id-side run");
  const legacyDir = join(root, MACHINE_NAME, "Merge-Job");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "schedule.md"), "stale legacy snapshot");
  await writeFile(join(legacyDir, "run0001-hermes-x.md"), "colliding legacy run");
  await writeFile(join(legacyDir, "run0002-hermes-y.md"), "movable legacy run");

  await upsertScheduledSchedule({ vaultPath, schedule: keyed });
  const moved = await readdir(dir);
  assert.ok(moved.includes("run0002-hermes-y.md"), "non-colliding legacy run moved");
  assert.equal(await readFile(join(dir, "run0001-hermes-x.md"), "utf8"), "id-side run", "colliding run in the id-keyed dir was not overwritten");
  assert.ok(existsSync(join(legacyDir, "run0001-hermes-x.md")), "colliding legacy run left behind");
  assert.ok(!existsSync(join(legacyDir, "schedule.md")), "superseded legacy schedule.md removed");
  assert.ok(existsSync(legacyDir), "non-empty legacy dir is preserved");
  const schedules = await listScheduledSchedules({ vaultPath });
  assert.equal(schedules.filter((item) => item.id === "sched-6").length, 1, "no duplicate schedule listing after merge");
}

await rm(vaultPath, { recursive: true, force: true });
console.log("scheduled-runs machine-key suite passed");
