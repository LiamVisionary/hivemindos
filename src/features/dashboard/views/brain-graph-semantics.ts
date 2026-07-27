import type { BrainGraphLink, BrainGraphNode } from "@/features/dashboard/dashboard-types";

export type BrainSemanticLinkKind = "folder" | "tag";

export type BrainSemanticLink = {
  kind: BrainSemanticLinkKind;
  source: string;
  target: string;
};

const MAX_ASSOCIATIONS_PER_NODE = 3;
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function undirectedPairKey(source: string, target: string) {
  return source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
}

function structuralScore(node: BrainGraphNode) {
  return node.incoming + node.outgoing;
}

function stableNodeOrder(a: BrainGraphNode, b: BrainGraphNode) {
  return structuralScore(b) - structuralScore(a) || a.id.localeCompare(b.id);
}

export function brainNodeClusterKey(node: BrainGraphNode) {
  if (node.id.startsWith("unresolved:")) return "Unresolved links";
  const folderParts = node.folder.split("/").map((part) => part.trim()).filter(Boolean);
  if (folderParts.length && node.folder !== "Vault root") return folderParts.slice(0, 2).join("/");
  const primaryTag = [...(node.tags ?? [])].map((tag) => tag.trim().toLowerCase()).filter(Boolean).sort()[0];
  return primaryTag ? `#${primaryTag}` : "Vault root";
}

export function brainNodeStructuralWeight(node: BrainGraphNode) {
  return Math.min(1, Math.log2(1 + structuralScore(node)) / 5);
}

export function brainNodeActivityWeight(node: BrainGraphNode, graphGeneratedAt: number) {
  const accessWeight = Math.min(0.76, Math.log2(1 + Math.max(0, node.accessCount)) / 5);
  const changedAt = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
  const recentWeight = Number.isFinite(changedAt) && changedAt >= graphGeneratedAt - RECENT_WINDOW_MS ? 0.24 : 0;
  return Math.min(1, accessWeight + recentWeight);
}

export function buildBrainSemanticLinks(nodes: BrainGraphNode[], wikiLinks: BrainGraphLink[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const occupiedPairs = new Set(
    wikiLinks
      .filter((link) => byId.has(link.source) && byId.has(link.target))
      .map((link) => undirectedPairKey(link.source, link.target)),
  );
  const associationCount = new Map<string, number>();
  const associations: BrainSemanticLink[] = [];

  const addAssociation = (source: BrainGraphNode, target: BrainGraphNode, kind: BrainSemanticLinkKind) => {
    if (source.id === target.id || source.id.startsWith("unresolved:") || target.id.startsWith("unresolved:")) return;
    if ((associationCount.get(source.id) ?? 0) >= MAX_ASSOCIATIONS_PER_NODE) return;
    if ((associationCount.get(target.id) ?? 0) >= MAX_ASSOCIATIONS_PER_NODE) return;
    const pair = undirectedPairKey(source.id, target.id);
    if (occupiedPairs.has(pair)) return;
    occupiedPairs.add(pair);
    associationCount.set(source.id, (associationCount.get(source.id) ?? 0) + 1);
    associationCount.set(target.id, (associationCount.get(target.id) ?? 0) + 1);
    associations.push({ source: source.id, target: target.id, kind });
  };

  const folderGroups = new Map<string, BrainGraphNode[]>();
  for (const node of nodes) {
    if (node.id.startsWith("unresolved:") || node.folder === "Unresolved links") continue;
    const group = folderGroups.get(node.folder) ?? [];
    group.push(node);
    folderGroups.set(node.folder, group);
  }
  for (const group of [...folderGroups.values()].filter((items) => items.length > 1)) {
    const ordered = [...group].sort(stableNodeOrder);
    for (let index = 1; index < ordered.length; index += 1) {
      // A stable binary tree keeps each folder visibly clustered without the
      // arbitrary snake produced by an alphabetical chain. Its natural
      // maximum degree is three, matching the global association bound.
      const parentIndex = Math.floor((index - 1) / 2);
      addAssociation(ordered[parentIndex], ordered[index], "folder");
    }
  }

  const tagGroups = new Map<string, BrainGraphNode[]>();
  for (const node of nodes) {
    for (const tag of new Set((node.tags ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))) {
      const group = tagGroups.get(tag) ?? [];
      group.push(node);
      tagGroups.set(tag, group);
    }
  }
  const orderedTagGroups = [...tagGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .sort(([tagA, itemsA], [tagB, itemsB]) => itemsB.length - itemsA.length || tagA.localeCompare(tagB));
  for (const [, group] of orderedTagGroups) {
    const ordered = [...group].sort(stableNodeOrder);
    const hub = ordered[0];
    for (let index = 1; index < ordered.length; index += 1) addAssociation(hub, ordered[index], "tag");
  }

  return associations;
}
