import type { ContextIndexItem } from "@/lib/services/context-index";
import { listVisualArtifacts } from "@/lib/services/visual-artifacts";
import { workspaceScope } from "@/lib/types/principal";

export async function visualArtifactContextIndexItems(options: {
  vaultPath?: string;
} = {}): Promise<ContextIndexItem[]> {
  const result = await listVisualArtifacts({
    vaultPath: options.vaultPath,
    limit: 80,
  }).catch(() => ({ artifacts: [] }));
  return result.artifacts.map((artifact) => {
    const blockTypes = artifact.blocks.map((block) => block.type);
    return {
      id: `artifact:${artifact.id}`,
      kind: "artifact" as const,
      title: artifact.title,
      summary: `${artifact.kind} artifact with blocks: ${[...new Set(blockTypes)].join(", ") || "none"}.`,
      tags: [...new Set(["artifact", artifact.kind, ...blockTypes])],
      aliases: [...new Set([artifact.id, artifact.title, artifact.kind, ...blockTypes])],
      retrievalText: [
        `Artifact: ${artifact.title}`,
        `Kind: ${artifact.kind}.`,
        `Blocks: ${blockTypes.join(", ")}.`,
        artifact.workBoardTaskId ? `Work Board task: ${artifact.workBoardTaskId}.` : "",
        artifact.queenBeeRunId ? `Queen Bee run: ${artifact.queenBeeRunId}.` : "",
      ].filter(Boolean).join(" "),
      route: `/api/visual-artifacts?id=${encodeURIComponent(artifact.id)}`,
      methods: ["GET"],
      load: {
        type: "api" as const,
        target: `/api/visual-artifacts?id=${encodeURIComponent(artifact.id)}`,
        note: "Load the artifact through the visual artifacts API. Public views redact local paths.",
      },
      updatedAt: Date.parse(artifact.updatedAt) || undefined,
      scope: workspaceScope(["artifacts:read"], ["artifact"]),
      authorization: {
        sideEffects: ["read"],
        risk: "low",
        readOnly: true,
        requiredClaims: ["artifacts:read"],
      },
    };
  });
}
