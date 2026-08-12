import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { hostname } from "os";
import { dirname, join } from "path";
import { normalizeMachineName } from "@/features/fleet/fleet-identity";
import type {
  KanbanBoard,
  KanbanBoardMeta,
  KanbanComment,
  KanbanEvent,
  KanbanLink,
  KanbanTask,
  KanbanTaskRun,
} from "@/lib/types/kanban";

// Merge-friendly shard storage for Work Board kanban boards.
//
// Problem: the board used to live only in a single hot kanban.json that many
// machines rewrite wholesale. Syncthing replicates at file granularity and
// cannot merge JSON, so concurrent cross-machine mutations forked the board
// into kanban.sync-conflict-*.json files that nothing ever read — the losing
// side's task completions silently vanished.
//
// Layout (next to kanban.json, per board directory):
//   shards/tasks/<taskId>.json    one file per task (or a {tombstone} marker)
//   shards/logs/<machineKey>.jsonl  append-only {k,v} records: event/comment/run/link/unlink
//   shards/stamps/<machineKey>.json per-machine freshness stamp
//   shards/meta.json              board meta (name/description/icon), LWW
//
// Every file has a single writing machine (task files use last-writer-wins by
// task.updatedAt), so Syncthing merges the directory cleanly. kanban.json is
// kept as a materialized snapshot on every change: legacy readers (packaged
// Rust bridge, external scripts, not-yet-updated fleet machines) keep working,
// and anything that still WRITES kanban.json directly — old-store machines,
// agent sessions editing the file, and Syncthing conflict copies of the
// snapshot — is lifted back into the shards on the next read, then conflict
// files are deleted. Rollback: the snapshot stays authoritative for old code,
// so reverting to the legacy store just works; the shards directory goes inert.
//
// Known, accepted semantics:
// - Tombstones always win: a task deleted through the new store never
//   resurrects from a stale snapshot or conflict copy.
// - Hard-deletes performed by an OLD store (task missing from an external
//   snapshot) do NOT propagate — a truncated or forked snapshot must never be
//   able to tombstone live tasks. Old-style deletes on stale machines reappear
//   until that machine updates; deletes are rare and archive is preferred.
// - Same-millisecond divergent edits of one task keep the incumbent side
//   (strictly-newer updatedAt wins); the next real edit converges the board.
// Kill switch: HIVEMINDOS_KANBAN_SHARDS=0 reverts to single-file behavior.

const MAX_PERSISTED_EVENTS = 500;
const MAX_PERSISTED_RUNS = 200;
const MAX_PERSISTED_COMMENTS = 1000;
const OWN_LOG_COMPACT_LINES = 4000;

type ShardPaths = {
  file: string;
  dir: string;
  shardsDir: string;
  tasksDir: string;
  logsDir: string;
  stampsDir: string;
  metaFile: string;
};

type LogRecord =
  | { k: "event"; v: KanbanEvent }
  | { k: "comment"; v: KanbanComment }
  | { k: "run"; v: KanbanTaskRun }
  | { k: "link"; v: KanbanLink }
  | { k: "unlink"; v: KanbanLink & { deletedAt: number } };

type ShardState = {
  slug: string;
  meta: KanbanBoardMeta;
  tasks: Map<string, KanbanTask>;
  taskJson: Map<string, string>;
  tombstones: Map<string, number>;
  events: Map<string, KanbanEvent>;
  comments: Map<string, KanbanComment>;
  runs: Map<string, KanbanTaskRun>;
  runJson: Map<string, string>;
  links: Map<string, KanbanLink>;
  unlinks: Map<string, number>;
  ownLogLines: number;
  snapshotSig: string;
  stampsSig: string;
};

const shardStates = new Map<string, ShardState>();

export function kanbanShardsEnabled(): boolean {
  const flag = process.env.HIVEMINDOS_KANBAN_SHARDS?.trim().toLowerCase();
  return flag !== "0" && flag !== "false";
}

export function kanbanShardMachineKey(): string {
  const override = process.env.HIVEMINDOS_KANBAN_MACHINE_KEY?.trim();
  const key = normalizeMachineName(override) || normalizeMachineName(hostname());
  return key || "machine";
}

export function invalidateKanbanShardCache(file: string) {
  shardStates.delete(file);
}

function shardPathsFor(file: string): ShardPaths {
  const dir = dirname(file);
  const shardsDir = join(dir, "shards");
  return {
    file,
    dir,
    shardsDir,
    tasksDir: join(shardsDir, "tasks"),
    logsDir: join(shardsDir, "logs"),
    stampsDir: join(shardsDir, "stamps"),
    metaFile: join(shardsDir, "meta.json"),
  };
}

/** Read a board through the shard engine. Returns null when the engine is
 * disabled or the board has neither shards nor a snapshot (caller falls back
 * to its legacy create/read paths). Lifts external snapshot edits and
 * Syncthing conflict copies into the shards, then rematerializes kanban.json
 * so legacy readers always see the merged view. */
export async function readBoardViaShards(
  file: string,
  slug: string,
): Promise<KanbanBoard | null> {
  if (!kanbanShardsEnabled()) return null;
  const paths = shardPathsFor(file);
  const hasShards = existsSync(paths.tasksDir);
  const hasSnapshot = existsSync(paths.file);
  if (!hasShards && !hasSnapshot) return null;
  if (!hasShards) {
    const state = await migrateSnapshotToShards(paths, slug);
    shardStates.set(file, state);
    return structuredClone(buildCanonicalBoard(state));
  }
  const sig = await currentSig(paths);
  const cached = shardStates.get(file);
  if (
    cached &&
    sig.conflicts.length === 0 &&
    sig.snapshotSig === cached.snapshotSig &&
    sig.stampsSig === cached.stampsSig
  ) {
    return structuredClone(buildCanonicalBoard(cached));
  }
  let state = await foldShards(paths, slug);
  let lifted = false;
  for (const conflict of sig.conflicts) {
    lifted = (await liftSnapshotFile(paths, state, conflict, true)) || lifted;
  }
  const snapshotChanged = sig.snapshotSig !== (cached?.snapshotSig ?? "");
  if (hasSnapshot && snapshotChanged) {
    lifted = (await liftSnapshotFile(paths, state, paths.file, false)) || lifted;
  }
  if (lifted) state = await foldShards(paths, slug);
  await materializeSnapshot(paths, state);
  shardStates.set(file, state);
  return structuredClone(buildCanonicalBoard(state));
}

/** Persist a mutated board through the shard engine. Returns false when the
 * engine is disabled (caller falls back to the legacy whole-file write). Only
 * changed task files are rewritten; new events/comments/runs/links append to
 * this machine's log; removed tasks become tombstones. */
export async function writeBoardViaShards(
  file: string,
  board: KanbanBoard,
): Promise<boolean> {
  if (!kanbanShardsEnabled()) return false;
  const paths = shardPathsFor(file);
  await ensureShardDirs(paths);
  let state = shardStates.get(file);
  if (!state) {
    state = existsSync(paths.tasksDir) && (await hasAnyTaskShard(paths))
      ? await foldShards(paths, board.meta.slug)
      : existsSync(paths.file)
        ? await migrateSnapshotToShards(paths, board.meta.slug)
        : emptyShardState(board.meta.slug);
  }
  const now = Date.now();
  const records: LogRecord[] = [];

  const liveIds = new Set<string>();
  for (const task of board.tasks) {
    if (!task?.id) continue;
    liveIds.add(task.id);
    const json = JSON.stringify(task, null, 2) + "\n";
    if (state.taskJson.get(task.id) === json) continue;
    await writeAtomic(taskShardPath(paths, task.id), json);
    state.taskJson.set(task.id, json);
    state.tasks.set(task.id, task);
    state.tombstones.delete(task.id);
  }
  for (const id of [...state.tasks.keys()]) {
    if (liveIds.has(id)) continue;
    await writeTombstone(paths, state, id, now);
  }

  // board.events/runs are stored newest-first; append chronologically.
  for (const event of [...board.events].reverse()) {
    if (event?.id && !state.events.has(event.id)) {
      state.events.set(event.id, event);
      records.push({ k: "event", v: event });
    }
  }
  for (const comment of board.comments) {
    if (comment?.id && !state.comments.has(comment.id)) {
      state.comments.set(comment.id, comment);
      records.push({ k: "comment", v: comment });
    }
  }
  for (const run of [...board.runs].reverse()) {
    if (!run?.id) continue;
    const json = JSON.stringify(run);
    if (state.runJson.get(run.id) === json) continue;
    state.runJson.set(run.id, json);
    state.runs.set(run.id, run);
    records.push({ k: "run", v: run });
  }
  const requestedLinkKeys = new Set(board.links.map(linkKey));
  for (const [key, link] of [...state.links]) {
    if (requestedLinkKeys.has(key)) continue;
    const deletedAt = Date.now();
    state.links.delete(key);
    state.unlinks.set(key, deletedAt);
    records.push({ k: "unlink", v: { ...link, deletedAt } });
  }
  for (const link of board.links) {
    const key = linkKey(link);
    if (!state.links.has(key)) {
      state.links.set(key, link);
      if ((link.createdAt ?? 0) > (state.unlinks.get(key) ?? 0)) state.unlinks.delete(key);
      records.push({ k: "link", v: link });
    }
  }

  const meta = board.meta;
  if (
    meta.name !== state.meta.name ||
    meta.description !== state.meta.description ||
    meta.icon !== state.meta.icon ||
    !existsSync(paths.metaFile)
  ) {
    state.meta = { ...meta };
    await writeAtomic(paths.metaFile, JSON.stringify(state.meta, null, 2) + "\n");
  } else {
    state.meta = { ...state.meta, updatedAt: meta.updatedAt };
  }

  if (records.length) await appendOwnLog(paths, state, records);
  await compactOwnLogIfNeeded(paths, state);
  await materializeSnapshot(paths, state);
  shardStates.set(file, state);
  return true;
}

function emptyShardState(slug: string): ShardState {
  const now = Date.now();
  return {
    slug,
    meta: { slug, name: slug === "default" ? "Default" : slug, createdAt: now, updatedAt: now },
    tasks: new Map(),
    taskJson: new Map(),
    tombstones: new Map(),
    events: new Map(),
    comments: new Map(),
    runs: new Map(),
    runJson: new Map(),
    links: new Map(),
    unlinks: new Map(),
    ownLogLines: 0,
    snapshotSig: "",
    stampsSig: "",
  };
}

async function ensureShardDirs(paths: ShardPaths) {
  for (const dir of [paths.shardsDir, paths.tasksDir, paths.logsDir, paths.stampsDir]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

async function hasAnyTaskShard(paths: ShardPaths) {
  try {
    return (await readdir(paths.tasksDir)).some((name) => name.endsWith(".json"));
  } catch {
    return false;
  }
}

function taskShardPath(paths: ShardPaths, id: string) {
  return join(paths.tasksDir, `${safeFileName(id)}.json`);
}

function safeFileName(id: string) {
  const cleaned = id.replace(/[^A-Za-z0-9_-]+/g, "-");
  if (cleaned === id) return id;
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) hash = ((hash << 5) + hash + id.charCodeAt(i)) >>> 0;
  return `${cleaned}-${hash.toString(36)}`;
}

function linkKey(link: KanbanLink) {
  return `${link.parentId} ${link.childId}`;
}

async function writeAtomic(path: string, data: string) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

async function writeTombstone(paths: ShardPaths, state: ShardState, id: string, deletedAt: number) {
  const marker = { tombstone: true as const, id, deletedAt };
  await writeAtomic(taskShardPath(paths, id), JSON.stringify(marker, null, 2) + "\n");
  state.tasks.delete(id);
  state.taskJson.delete(id);
  state.tombstones.set(id, deletedAt);
}

async function appendOwnLog(paths: ShardPaths, state: ShardState, records: LogRecord[]) {
  const logPath = join(paths.logsDir, `${kanbanShardMachineKey()}.jsonl`);
  const lines = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await appendFile(logPath, lines, { mode: 0o600 });
  state.ownLogLines += records.length;
  await bumpStamp(paths);
}

async function bumpStamp(paths: ShardPaths) {
  const stampPath = join(paths.stampsDir, `${kanbanShardMachineKey()}.json`);
  await writeAtomic(stampPath, JSON.stringify({ writtenAt: Date.now() }) + "\n");
}

async function compactOwnLogIfNeeded(paths: ShardPaths, state: ShardState) {
  if (state.ownLogLines <= OWN_LOG_COMPACT_LINES) return;
  const canonical = buildCanonicalBoard(state);
  const keepEventIds = new Set(canonical.events.map((event) => event.id));
  const keepCommentIds = new Set(canonical.comments.map((comment) => comment.id));
  const keepRunIds = new Set(canonical.runs.map((run) => run.id));
  const keepLinkKeys = new Set(canonical.links.map(linkKey));
  const logPath = join(paths.logsDir, `${kanbanShardMachineKey()}.jsonl`);
  const records = await readLogRecords(logPath);
  const kept = records.filter((record) => {
    if (record.k === "event") return keepEventIds.has(record.v.id);
    if (record.k === "comment") return keepCommentIds.has(record.v.id);
    if (record.k === "run") return keepRunIds.has(record.v.id);
    if (record.k === "unlink") {
      return state.unlinks.get(linkKey(record.v)) === record.v.deletedAt;
    }
    return keepLinkKeys.has(linkKey(record.v));
  });
  await writeAtomic(logPath, kept.map((record) => JSON.stringify(record)).join("\n") + (kept.length ? "\n" : ""));
  state.ownLogLines = kept.length;
}

async function readLogRecords(path: string): Promise<LogRecord[]> {
  let raw = "";
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const records: LogRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LogRecord;
      if (parsed && typeof parsed === "object" && parsed.v && typeof parsed.v === "object") {
        records.push(parsed);
      }
    } catch {
      // Torn or corrupt line (crashed writer, sync artifact): skip it.
    }
  }
  return records;
}

async function currentSig(paths: ShardPaths) {
  const conflicts: string[] = [];
  try {
    for (const name of await readdir(paths.dir)) {
      if (
        name.startsWith("kanban") &&
        name.includes(".sync-conflict-") &&
        name.endsWith(".json")
      ) {
        conflicts.push(join(paths.dir, name));
      }
    }
  } catch {
    // Board directory vanished (board archived mid-read); treat as empty.
  }
  conflicts.sort();
  return {
    snapshotSig: await statSig(paths.file),
    stampsSig: await stampsSig(paths),
    conflicts,
  };
}

async function statSig(path: string) {
  try {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "";
  }
}

async function stampsSig(paths: ShardPaths) {
  const parts: string[] = [];
  try {
    for (const name of (await readdir(paths.stampsDir)).sort()) {
      if (name.includes(".sync-conflict-")) {
        // Stamps are ephemeral freshness hints; a conflict copy is junk.
        await unlink(join(paths.stampsDir, name)).catch(() => undefined);
        continue;
      }
      parts.push(`${name}=${await statSig(join(paths.stampsDir, name))}`);
    }
  } catch {
    return "";
  }
  return parts.join("|");
}

async function migrateSnapshotToShards(paths: ShardPaths, slug: string): Promise<ShardState> {
  await ensureShardDirs(paths);
  const parsed = await readSnapshotFile(paths.file);
  const state = emptyShardState(slug);
  if (parsed?.meta) state.meta = { ...state.meta, ...parsed.meta, slug };
  const records: LogRecord[] = [];
  for (const task of asArray<KanbanTask>(parsed?.tasks)) {
    if (!task?.id) continue;
    const json = JSON.stringify(task, null, 2) + "\n";
    await writeAtomic(taskShardPath(paths, task.id), json);
    state.tasks.set(task.id, task);
    state.taskJson.set(task.id, json);
  }
  for (const event of asArray<KanbanEvent>(parsed?.events).reverse()) {
    if (!event?.id || state.events.has(event.id)) continue;
    state.events.set(event.id, event);
    records.push({ k: "event", v: event });
  }
  for (const comment of asArray<KanbanComment>(parsed?.comments)) {
    if (!comment?.id || state.comments.has(comment.id)) continue;
    state.comments.set(comment.id, comment);
    records.push({ k: "comment", v: comment });
  }
  for (const run of asArray<KanbanTaskRun>(parsed?.runs).reverse()) {
    if (!run?.id || state.runs.has(run.id)) continue;
    state.runs.set(run.id, run);
    state.runJson.set(run.id, JSON.stringify(run));
    records.push({ k: "run", v: run });
  }
  for (const link of asArray<KanbanLink>(parsed?.links)) {
    if (!link?.parentId || !link?.childId || state.links.has(linkKey(link))) continue;
    state.links.set(linkKey(link), link);
    records.push({ k: "link", v: link });
  }
  await writeAtomic(paths.metaFile, JSON.stringify(state.meta, null, 2) + "\n");
  if (records.length) await appendOwnLog(paths, state, records);
  else await bumpStamp(paths);
  // Keep kanban.json exactly as-is: it is both the legacy-compat snapshot and
  // the rollback artifact for this migration.
  state.snapshotSig = await statSig(paths.file);
  state.stampsSig = await stampsSig(paths);
  return state;
}

async function readSnapshotFile(path: string): Promise<Partial<KanbanBoard> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Partial<KanbanBoard>;
  } catch {
    return null;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function foldShards(paths: ShardPaths, slug: string): Promise<ShardState> {
  const state = emptyShardState(slug);
  const metaParsed = await readSnapshotFile(paths.metaFile);
  if (metaParsed && typeof metaParsed === "object") {
    state.meta = { ...state.meta, ...(metaParsed as Partial<KanbanBoardMeta>), slug };
  }

  let taskFiles: string[] = [];
  try {
    taskFiles = (await readdir(paths.tasksDir)).filter((name) => name.endsWith(".json"));
  } catch {
    taskFiles = [];
  }
  const conflictTaskFiles = taskFiles.filter((name) => name.includes(".sync-conflict-"));
  for (const name of taskFiles) {
    if (name.includes(".sync-conflict-")) continue;
    await foldTaskFile(state, paths, name);
  }
  // Shard-level conflict copies (two machines raced one task file): merge by
  // last-writer-wins on updatedAt, promote a winning copy over the incumbent,
  // then drop the conflict file — it is fully absorbed either way.
  for (const name of conflictTaskFiles) {
    const path = join(paths.tasksDir, name);
    const parsed = await readSnapshotFile(path);
    await applyTaskCandidate(
      state,
      paths,
      parsed as (Partial<KanbanTask> & { tombstone?: boolean; deletedAt?: number }) | null,
    );
    await unlink(path).catch(() => undefined);
  }

  let logFiles: string[] = [];
  try {
    logFiles = (await readdir(paths.logsDir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    logFiles = [];
  }
  const ownLog = `${kanbanShardMachineKey()}.jsonl`;
  const liftRecords: LogRecord[] = [];
  for (const name of logFiles) {
    const records = await readLogRecords(join(paths.logsDir, name));
    if (name === ownLog) state.ownLogLines = records.length;
    const isConflictCopy = name.includes(".sync-conflict-");
    for (const record of records) {
      const fresh = mergeRecord(state, record);
      if (fresh && isConflictCopy) liftRecords.push(record);
    }
    if (isConflictCopy) await unlink(join(paths.logsDir, name)).catch(() => undefined);
  }
  if (liftRecords.length) await appendOwnLog(paths, state, liftRecords);

  state.snapshotSig = await statSig(paths.file);
  state.stampsSig = await stampsSig(paths);
  return state;
}

async function foldTaskFile(state: ShardState, paths: ShardPaths, name: string) {
  const path = join(paths.tasksDir, name);
  let raw = "";
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return;
  }
  let parsed: (Partial<KanbanTask> & { tombstone?: boolean; deletedAt?: number }) | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // Torn file; the writer's rename never landed. Next write heals it.
  }
  if (!parsed?.id) return;
  if (parsed.tombstone) {
    state.tombstones.set(parsed.id, parsed.deletedAt ?? 0);
    state.tasks.delete(parsed.id);
    state.taskJson.delete(parsed.id);
    return;
  }
  if (state.tombstones.has(parsed.id)) return;
  state.tasks.set(parsed.id, parsed as KanbanTask);
  state.taskJson.set(parsed.id, raw);
}

/** Apply a task (or tombstone) from a conflict copy / external snapshot.
 * Returns true when the candidate won and was persisted over the incumbent. */
async function applyTaskCandidate(
  state: ShardState,
  paths: ShardPaths,
  candidate: (Partial<KanbanTask> & { tombstone?: boolean; deletedAt?: number }) | null,
): Promise<boolean> {
  if (!candidate?.id) return false;
  if (candidate.tombstone) return false; // tombstones only ever originate from live shard files
  if (state.tombstones.has(candidate.id)) return false;
  const incumbent = state.tasks.get(candidate.id);
  if (incumbent && (incumbent.updatedAt ?? 0) >= (candidate.updatedAt ?? 0)) return false;
  const task = candidate as KanbanTask;
  const json = JSON.stringify(task, null, 2) + "\n";
  await writeAtomic(taskShardPath(paths, task.id), json);
  state.tasks.set(task.id, task);
  state.taskJson.set(task.id, json);
  return true;
}

/** Merge one log record into the fold. Returns true when it was new. */
function mergeRecord(state: ShardState, record: LogRecord): boolean {
  if (record.k === "event") {
    if (!record.v?.id || state.events.has(record.v.id)) return false;
    state.events.set(record.v.id, record.v);
    return true;
  }
  if (record.k === "comment") {
    if (!record.v?.id || state.comments.has(record.v.id)) return false;
    state.comments.set(record.v.id, record.v);
    return true;
  }
  if (record.k === "run") {
    if (!record.v?.id) return false;
    const incumbent = state.runs.get(record.v.id);
    if (incumbent && !runBeats(record.v, incumbent)) return false;
    state.runs.set(record.v.id, record.v);
    state.runJson.set(record.v.id, JSON.stringify(record.v));
    return true;
  }
  if (record.k === "link") {
    if (!record.v?.parentId || !record.v?.childId) return false;
    const key = linkKey(record.v);
    if ((state.unlinks.get(key) ?? 0) >= (record.v.createdAt ?? 0)) return false;
    const incumbent = state.links.get(key);
    if (incumbent && (incumbent.createdAt ?? 0) >= (record.v.createdAt ?? 0)) return false;
    state.links.set(key, record.v);
    return true;
  }
  if (record.k === "unlink") {
    if (!record.v?.parentId || !record.v?.childId) return false;
    const key = linkKey(record.v);
    const deletedAt = record.v.deletedAt ?? 0;
    if ((state.unlinks.get(key) ?? 0) >= deletedAt) return false;
    state.unlinks.set(key, deletedAt);
    const incumbent = state.links.get(key);
    if (incumbent && (incumbent.createdAt ?? 0) <= deletedAt) state.links.delete(key);
    return true;
  }
  return false;
}

function runBeats(candidate: KanbanTaskRun, incumbent: KanbanTaskRun): boolean {
  const terminal = (run: KanbanTaskRun) => run.status !== "running";
  if (terminal(candidate) !== terminal(incumbent)) return terminal(candidate);
  const progress = (run: KanbanTaskRun) =>
    run.endedAt ?? run.lastHeartbeatAt ?? run.startedAt ?? 0;
  if (progress(candidate) !== progress(incumbent)) {
    return progress(candidate) > progress(incumbent);
  }
  return JSON.stringify(candidate) > JSON.stringify(incumbent);
}

/** Lift an externally-written full-board JSON (old-store write, agent-session
 * edit, or a Syncthing conflict copy) into the shards. Strictly-newer tasks
 * win by updatedAt; unknown events/comments/links and winning runs append to
 * this machine's log. Returns true when anything changed. */
async function liftSnapshotFile(
  paths: ShardPaths,
  state: ShardState,
  file: string,
  removeAfter: boolean,
): Promise<boolean> {
  const parsed = await readSnapshotFile(file);
  if (!parsed) {
    if (removeAfter) await unlink(file).catch(() => undefined);
    return false;
  }
  let changed = false;
  for (const task of asArray<KanbanTask>(parsed.tasks)) {
    changed = (await applyTaskCandidate(state, paths, task)) || changed;
  }
  const records: LogRecord[] = [];
  for (const event of asArray<KanbanEvent>(parsed.events).reverse()) {
    if (event?.id && mergeRecord(state, { k: "event", v: event })) {
      records.push({ k: "event", v: event });
    }
  }
  for (const comment of asArray<KanbanComment>(parsed.comments)) {
    if (comment?.id && mergeRecord(state, { k: "comment", v: comment })) {
      records.push({ k: "comment", v: comment });
    }
  }
  for (const run of asArray<KanbanTaskRun>(parsed.runs).reverse()) {
    if (run?.id && mergeRecord(state, { k: "run", v: run })) {
      records.push({ k: "run", v: run });
    }
  }
  for (const link of asArray<KanbanLink>(parsed.links)) {
    if (link?.parentId && link?.childId && mergeRecord(state, { k: "link", v: link })) {
      records.push({ k: "link", v: link });
    }
  }
  if (records.length) {
    await appendOwnLog(paths, state, records);
    changed = true;
  }
  const meta = parsed.meta as Partial<KanbanBoardMeta> | undefined;
  if (
    meta &&
    (meta.updatedAt ?? 0) > (state.meta.updatedAt ?? 0) &&
    (meta.name !== state.meta.name ||
      meta.description !== state.meta.description ||
      meta.icon !== state.meta.icon)
  ) {
    state.meta = { ...state.meta, ...meta, slug: state.slug };
    await writeAtomic(paths.metaFile, JSON.stringify(state.meta, null, 2) + "\n");
    changed = true;
  }
  if (removeAfter) await unlink(file).catch(() => undefined);
  return changed;
}

/** Deterministic board assembly: identical shard state on any machine yields
 * byte-identical output, so concurrent rematerializations of kanban.json
 * converge instead of ping-ponging new Syncthing conflicts. */
function buildCanonicalBoard(state: ShardState): KanbanBoard {
  const tasks = [...state.tasks.values()].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || compareIds(b.id, a.id),
  );
  const events = [...state.events.values()]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || compareIds(a.id, b.id))
    .slice(0, MAX_PERSISTED_EVENTS);
  const comments = [...state.comments.values()]
    .filter((comment) => !state.tombstones.has(comment.taskId))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || compareIds(a.id, b.id))
    .slice(-MAX_PERSISTED_COMMENTS);
  const runs = [...state.runs.values()]
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || compareIds(a.id, b.id))
    .slice(0, MAX_PERSISTED_RUNS);
  const links = [...state.links.values()]
    .filter(
      (link) =>
        !state.tombstones.has(link.parentId) && !state.tombstones.has(link.childId),
    )
    .sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || compareIds(linkKey(a), linkKey(b)),
    );
  const updatedAt = Math.max(
    state.meta.updatedAt ?? 0,
    tasks[0] ? Math.max(...tasks.map((task) => task.updatedAt ?? 0)) : 0,
    events[0]?.createdAt ?? 0,
  );
  return {
    meta: { ...state.meta, slug: state.slug, updatedAt },
    tasks,
    comments,
    links,
    events,
    runs,
  };
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function materializeSnapshot(paths: ShardPaths, state: ShardState) {
  const board = buildCanonicalBoard(state);
  const data = JSON.stringify(board, null, 2) + "\n";
  let current: string | null = null;
  try {
    current = await readFile(paths.file, "utf-8");
  } catch {
    current = null;
  }
  if (current !== data) {
    await writeAtomic(paths.file, data);
    await bumpStamp(paths);
  }
  state.snapshotSig = await statSig(paths.file);
  state.stampsSig = await stampsSig(paths);
}
