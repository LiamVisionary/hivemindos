import type { ScopePolicy } from "@/lib/types/principal";

export const VISUAL_ARTIFACT_KINDS = ["plan", "recap", "query-result", "report", "dashboard"] as const;
export const VISUAL_ARTIFACT_BLOCK_TYPES = [
  "summary",
  "file-tree",
  "diagram",
  "wireframe",
  "diff-summary",
  "risk",
  "table",
  "chart",
  "metric",
  "source-receipt",
] as const;

export type VisualArtifactKind = (typeof VISUAL_ARTIFACT_KINDS)[number];
export type VisualArtifactBlockType = (typeof VISUAL_ARTIFACT_BLOCK_TYPES)[number];

export type VisualArtifactFileTreeItem = {
  path: string;
  note: string;
};

export type VisualArtifactTableCell = string | number | boolean | null;

export type VisualArtifactTableRow = Record<string, VisualArtifactTableCell>;

export type VisualArtifactBlock =
  | { type: "summary"; markdown: string }
  | { type: "file-tree"; items: VisualArtifactFileTreeItem[] }
  | { type: "diagram"; mermaid: string }
  | { type: "wireframe"; markdown: string }
  | { type: "diff-summary"; markdown: string }
  | { type: "risk"; markdown: string }
  | { type: "table"; columns: string[]; rows: VisualArtifactTableRow[]; caption?: string }
  | { type: "chart"; spec: Record<string, unknown>; caption?: string }
  | { type: "metric"; label: string; value: string; note?: string }
  | { type: "source-receipt"; markdown: string };

export type VisualArtifact = {
  id: string;
  kind: VisualArtifactKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  workBoardTaskId?: string;
  queenBeeRunId?: string;
  projectPath?: string;
  createdByPrincipalId?: string;
  scope?: ScopePolicy;
  blocks: VisualArtifactBlock[];
  redactedLabels?: string[];
};

export type VisualArtifactCreateInput = {
  kind?: unknown;
  title?: unknown;
  workBoardTaskId?: unknown;
  queenBeeRunId?: unknown;
  projectPath?: unknown;
  createdByPrincipalId?: unknown;
  scope?: unknown;
  blocks?: unknown;
  vaultPath?: unknown;
};

export type VisualArtifactListFilter = {
  kind?: unknown;
  workBoardTaskId?: unknown;
  queenBeeRunId?: unknown;
  limit?: unknown;
  vaultPath?: unknown;
};

export type VisualArtifactStorageLocation = {
  kind: "vault" | "fallback";
  path: string;
};
