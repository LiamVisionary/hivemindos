import { createHash } from "crypto";

export type BlindCompareCandidate = {
  id: string;
  modelLabel: string;
  answer: string;
  latencyMs?: number;
};

export type BlindCompareSlot = {
  slotId: string;
  answer: string;
  latencyMs?: number;
};

export type BlindCompareSession = {
  id: string;
  createdAt: string;
  slots: BlindCompareSlot[];
  reveal: Array<{ slotId: string; candidateId: string; modelLabel: string }>;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function seededOrder(candidates: BlindCompareCandidate[], seed: string) {
  return [...candidates].sort((left, right) => {
    const leftKey = hash(`${seed}:${left.id}:${left.modelLabel}:${left.answer.length}`);
    const rightKey = hash(`${seed}:${right.id}:${right.modelLabel}:${right.answer.length}`);
    return leftKey.localeCompare(rightKey);
  });
}

export function createBlindCompareSession(candidates: BlindCompareCandidate[], options: { seed?: string; now?: Date } = {}): BlindCompareSession {
  const valid = candidates.filter((candidate) => candidate.answer.trim());
  if (valid.length < 2) throw new Error("Blind compare needs at least two non-empty answers.");
  const createdAt = (options.now ?? new Date()).toISOString();
  const seed = options.seed ?? createdAt;
  const ordered = seededOrder(valid, seed);
  const sessionId = hash(`${seed}:${ordered.map((candidate) => candidate.id).join("|")}`);
  return {
    id: `blind-${sessionId}`,
    createdAt,
    slots: ordered.map((candidate, index) => ({
      slotId: `slot-${String.fromCharCode(65 + index)}`,
      answer: candidate.answer,
      latencyMs: candidate.latencyMs,
    })),
    reveal: ordered.map((candidate, index) => ({
      slotId: `slot-${String.fromCharCode(65 + index)}`,
      candidateId: candidate.id,
      modelLabel: candidate.modelLabel,
    })),
  };
}

export function revealBlindCompareVote(session: BlindCompareSession, slotId: string) {
  const selected = session.reveal.find((entry) => entry.slotId === slotId);
  if (!selected) throw new Error(`Unknown blind compare slot: ${slotId}`);
  return {
    sessionId: session.id,
    selectedSlotId: slotId,
    selected,
    reveal: session.reveal,
  };
}
