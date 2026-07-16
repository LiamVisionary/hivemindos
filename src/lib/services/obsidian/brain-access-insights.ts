import "server-only";

import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  readAccessEvents,
  resolveVaultPath,
} from "@/lib/services/obsidian/brain-graph";

export type BrainAccessRank = {
  notePath: string;
  accessCount: number;
  lastAccessedAt: string;
  exists: boolean;
};

export type BrainAccessInsights = {
  generatedAt: string;
  totalAccesses: number;
  distinctNotes: number;
  topRecorded?: BrainAccessRank;
  rankedExisting: BrainAccessRank[];
};

export async function readBrainAccessInsights(
  options: { vaultPath?: string } = {},
): Promise<BrainAccessInsights> {
  const root = resolveVaultPath(options.vaultPath);
  const events = await readAccessEvents(root, { limit: null });
  const counts = new Map<string, { accessCount: number; lastAccessedAt: string }>();

  for (const event of events) {
    const current = counts.get(event.notePath);
    counts.set(event.notePath, {
      accessCount: (current?.accessCount ?? 0) + 1,
      lastAccessedAt:
        !current || Date.parse(event.accessedAt) > Date.parse(current.lastAccessedAt)
          ? event.accessedAt
          : current.lastAccessedAt,
    });
  }

  const ranked = await Promise.all(
    [...counts.entries()].map(async ([notePath, count]) => ({
      notePath,
      ...count,
      exists: await noteExists(root, notePath),
    })),
  );
  ranked.sort((a, b) =>
    b.accessCount - a.accessCount
    || Date.parse(b.lastAccessedAt) - Date.parse(a.lastAccessedAt)
    || a.notePath.localeCompare(b.notePath),
  );

  const existing = ranked.filter((item) => item.exists);
  return {
    generatedAt: new Date().toISOString(),
    totalAccesses: events.length,
    distinctNotes: ranked.length,
    topRecorded: ranked[0],
    rankedExisting: existing,
  };
}

export function formatBrainAccessInsightsForAgent(
  insights: BrainAccessInsights,
): string {
  const rows = insights.rankedExisting.slice(0, 12);
  return [
    "Brain note access history (local read-only evidence; the user's request already authorizes this read):",
    `Recorded access events: ${insights.totalAccesses}; distinct recorded note paths: ${insights.distinctNotes}.`,
    rows.length
      ? "Current existing note rankings:"
      : "Current existing note rankings: none of the recorded paths currently exist.",
    ...rows.map(
      (item, index) =>
        `${index + 1}. ${item.notePath} — ${formatAccessCount(item.accessCount)}; last recorded access: ${item.lastAccessedAt}.`,
    ),
    insights.topRecorded
      ? `Highest raw recorded path: ${insights.topRecorded.notePath} — ${formatAccessCount(insights.topRecorded.accessCount)}; exists: ${insights.topRecorded.exists ? "yes" : "no"}.`
      : "Highest raw recorded path: none.",
    "These are access-log observations, not inferred importance. Reason over the evidence and answer the user's question in your own words.",
  ].join("\n");
}

async function noteExists(root: string, notePath: string): Promise<boolean> {
  const absolutePath = resolve(root, notePath.replace(/^\/+/, ""));
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) return false;
  return stat(absolutePath).then((value) => value.isFile()).catch(() => false);
}

function formatAccessCount(count: number): string {
  return `${count} recorded access${count === 1 ? "" : "es"}`;
}
