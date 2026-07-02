// Live progress for one Queen Bee voice "converse" turn, so the overlay can
// show what she is doing (thinking, tool calls, fleet scan, delegation) during
// the otherwise-silent seconds while the reply resolves.
//
// The converse POST is a single buffered request; rather than convert it to a
// streaming contract (which every consumer would have to re-parse), the route
// records coarse stages here keyed by a client-generated turn id, and the
// overlay polls `turn-progress` while its phase is "thinking". In-memory only:
// progress is ephemeral UI garnish, and the poller and recorder always live in
// the same server process (the route handles both).

export type QueenVoiceTurnStage = {
  label: string;
  at: number;
  /** Stages are running until the next stage lands or the turn finishes. */
  done: boolean;
};

type TurnProgressEntry = {
  startedAt: number;
  finishedAt: number;
  stages: QueenVoiceTurnStage[];
};

const TURN_TTL_MS = 5 * 60_000;
const MAX_TRACKED_TURNS = 64;
const MAX_STAGES_PER_TURN = 24;
const MAX_LABEL_LENGTH = 120;

const turns = new Map<string, TurnProgressEntry>();

function sweep(now: number) {
  for (const [id, entry] of turns) {
    if (now - entry.startedAt > TURN_TTL_MS) turns.delete(id);
  }
  // Oldest-first eviction if something floods ids anyway.
  while (turns.size > MAX_TRACKED_TURNS) {
    const oldest = turns.keys().next().value;
    if (!oldest) break;
    turns.delete(oldest);
  }
}

export function normalizeVoiceTurnId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9._-]{4,80}$/.test(id) ? id : "";
}

export function beginVoiceTurnProgress(turnId: string, now = Date.now()) {
  if (!turnId) return;
  sweep(now);
  turns.set(turnId, { startedAt: now, finishedAt: 0, stages: [] });
}

/** Record a stage; repeated identical labels collapse into one entry. */
export function markVoiceTurnStage(turnId: string, label: string, now = Date.now()) {
  if (!turnId) return;
  const entry = turns.get(turnId);
  if (!entry || entry.finishedAt) return;
  const text = label.trim().slice(0, MAX_LABEL_LENGTH);
  if (!text) return;
  const last = entry.stages[entry.stages.length - 1];
  if (last?.label === text) return;
  if (last) last.done = true;
  if (entry.stages.length >= MAX_STAGES_PER_TURN) return;
  entry.stages.push({ label: text, at: now, done: false });
}

export function finishVoiceTurnProgress(turnId: string, now = Date.now()) {
  if (!turnId) return;
  const entry = turns.get(turnId);
  if (!entry) return;
  entry.finishedAt = now;
  for (const stage of entry.stages) stage.done = true;
}

export function readVoiceTurnProgress(turnId: string): {
  known: boolean;
  finished: boolean;
  stages: QueenVoiceTurnStage[];
} {
  const entry = turnId ? turns.get(turnId) : undefined;
  if (!entry) return { known: false, finished: false, stages: [] };
  return {
    known: true,
    finished: entry.finishedAt > 0,
    stages: entry.stages.slice(-MAX_STAGES_PER_TURN),
  };
}

export function resetVoiceTurnProgressForTests() {
  turns.clear();
}
