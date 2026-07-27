// Zero Human Companies — the openable artifacts a needs-human issue references.
// Agents list their outputs in the RESULT PROSE far more often than in the
// structured `deliverables` array (which is frequently empty): a "Deliverables:"
// block of bare URLs (offer pages, booking links) and an "Artifacts:" block of
// file paths (the actual drafts, an approval packet). This derives ONE classified,
// deduped, junk-filtered list from BOTH sources so a card can show "view the
// drafts / offer pages" chips instead of burying them in the raw result blob.
// Pure + React-free so it is hermetically testable.
import { extractResultArtifacts } from "@/features/dashboard/kanban-result-format";
import { bucketDeliverables, type ClassifiedDeliverable } from "./deliverables-model";
import type { Issue, IssueDeliverable } from "./types";

const FENCED_BLOCK = /```[\s\S]*?```/g;
const BARE_URL = /https?:\/\/[^\s"'<>()[\]]+/g;

// Human-readable drafts/reports and their data lead; customer-facing links follow;
// media last. bucketDeliverables sorts links first, which is the wrong priority for
// "what do I open to make this decision" — the drafts matter more than the offer page.
const REVIEW_ORDER: Record<ClassifiedDeliverable["category"], number> = {
  report: 0,
  data: 1,
  link: 2,
  media: 3,
  internal: 9,
};

/**
 * The openable, human-worth-seeing artifacts this issue references — the task's
 * structured deliverables PLUS the links and file paths its result prose lists.
 * Classified + bucketed so junk/internal (command strings, brain-memory notes,
 * fabricated URLs) is dropped, and ordered so the drafts/reports come first.
 */
export function issueReferencedArtifacts(issue: Pick<Issue, "work">): ClassifiedDeliverable[] {
  const work = issue.work;
  if (!work) return [];
  // Strip fenced blocks (loop-receipts JSON, code) so gate-internal evidence paths
  // aren't surfaced as if they were headline deliverables.
  const prose = (work.result ?? "").replace(FENCED_BLOCK, "\n");
  const derived: IssueDeliverable[] = [];
  for (const artifact of extractResultArtifacts(prose).artifacts) {
    derived.push({ id: `art:${artifact.path}`, label: artifact.label, kind: "file", path: artifact.path });
  }
  for (const raw of new Set(prose.match(BARE_URL) ?? [])) {
    const url = raw.replace(/[.,;:!?)]+$/, "");
    derived.push({ id: `url:${url}`, label: url, kind: "link", url });
  }
  const visible = bucketDeliverables([...(work.deliverables ?? []), ...derived]).visible;
  return [...visible].sort((left, right) => REVIEW_ORDER[left.category] - REVIEW_ORDER[right.category]);
}
