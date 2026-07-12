import assert from "node:assert/strict";
import {
  brainNodeActivityWeight,
  brainNodeClusterKey,
  brainNodeStructuralWeight,
  buildBrainSemanticLinks,
} from "../src/features/dashboard/views/brain-graph-semantics.ts";

const node = (id, folder, tags = [], incoming = 0, outgoing = 0, accessCount = 0, modifiedAt) => ({
  id,
  label: id,
  folder,
  tags,
  byteSize: 1,
  incoming,
  outgoing,
  accessCount,
  modifiedAt,
  recentAccesses: [],
});

const generatedAt = Date.parse("2026-07-12T08:00:00.000Z");
const nodes = [
  node("Projects/A.md", "Projects/Alpha", ["launch"], 0, 1, 0),
  node("Projects/B.md", "Projects/Alpha", ["launch"], 1, 0, 12),
  node("Projects/C.md", "Projects/Alpha", ["research"], 0, 0, 0),
  node("Memory/D.md", "Memory/Distillations", ["launch"], 0, 0, 0, "2026-07-11T08:00:00.000Z"),
];
const wikiLinks = [{ source: "Projects/A.md", target: "Projects/B.md" }];
const semantic = buildBrainSemanticLinks(nodes, wikiLinks);

assert.equal(brainNodeClusterKey(nodes[0]), "Projects/Alpha");
assert.equal(brainNodeStructuralWeight(nodes[2]), 0, "unlinked notes stay structurally small");
assert.ok(brainNodeStructuralWeight(nodes[0]) > 0, "wiki degree drives structural size");
assert.ok(brainNodeActivityWeight(nodes[1], generatedAt) > brainNodeActivityWeight(nodes[0], generatedAt), "reads drive activity");
assert.ok(brainNodeActivityWeight(nodes[3], generatedAt) > 0, "recent edits drive activity");
assert.ok(semantic.some((link) => link.kind === "folder"), "same-folder notes receive a typed association");
assert.ok(semantic.some((link) => link.kind === "tag"), "shared tags receive a typed association");
assert.ok(!semantic.some((link) => [link.source, link.target].includes("Projects/A.md") && [link.source, link.target].includes("Projects/B.md")), "semantic links never duplicate wiki-links");

const degree = new Map();
for (const link of semantic) {
  degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
  degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
}
assert.ok([...degree.values()].every((count) => count <= 3), "semantic associations remain bounded per node");

const branchNodes = Array.from({ length: 7 }, (_, index) => node(`Branch/${index}.md`, "Branch/Tree"));
const branchLinks = buildBrainSemanticLinks(branchNodes, []);
const branchPairs = new Set(branchLinks.map((link) => [link.source, link.target].sort().join("|")));
assert.ok(branchPairs.has("Branch/0.md|Branch/1.md"), "folder root connects to its first branch");
assert.ok(branchPairs.has("Branch/0.md|Branch/2.md"), "folder root connects to its second branch");
assert.ok(branchPairs.has("Branch/1.md|Branch/3.md"), "folder associations continue as a bounded tree");
assert.ok(!branchPairs.has("Branch/2.md|Branch/3.md"), "folder associations do not fall back to a sorted chain");

console.log("brain graph semantics tests passed");
