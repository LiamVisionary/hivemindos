export const VISUAL_ARTIFACT_KINDS = ["plan", "recap"] as const;
export const VISUAL_ARTIFACT_BLOCK_TYPES = [
  "summary",
  "file-tree",
  "diagram",
  "wireframe",
  "diff-summary",
  "risk",
] as const;

export type VisualArtifactKind = (typeof VISUAL_ARTIFACT_KINDS)[number];
export type VisualArtifactBlockType = (typeof VISUAL_ARTIFACT_BLOCK_TYPES)[number];

export type VisualArtifactFileTreeItem = {
  path: string;
  note: string;
};

export type VisualArtifactBlock =
  | { type: "summary"; markdown: string }
  | { type: "file-tree"; items: VisualArtifactFileTreeItem[] }
  | { type: "diagram"; mermaid: string }
  | { type: "wireframe"; markdown: string }
  | { type: "diff-summary"; markdown: string }
  | { type: "risk"; markdown: string };

export type VisualArtifact = {
  id: string;
  kind: VisualArtifactKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  workBoardTaskId?: string;
  queenBeeRunId?: string;
  projectPath?: string;
  blocks: VisualArtifactBlock[];
  redactedLabels?: string[];
};

export type VisualArtifactCreateInput = {
  kind?: unknown;
  title?: unknown;
  workBoardTaskId?: unknown;
  queenBeeRunId?: unknown;
  projectPath?: unknown;
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
