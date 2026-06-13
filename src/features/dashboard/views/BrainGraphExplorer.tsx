// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useMemo, useState } from "react";
import { brainGraphLayout } from "@/features/dashboard/dashboard-display-helpers";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import styles from "./BrainGraphExplorer.module.css";

const graphClass = (...classes) => classes.map((className) => styles[className]).filter(Boolean).join(" ");

function uniqueNodesById(nodes: any[]) {
  const unique = new Map<string, any>();
  for (const node of nodes) {
    if (node?.id && !unique.has(node.id)) unique.set(node.id, node);
  }
  return [...unique.values()];
}

export function BrainGraphExplorer(props: any) {
  const {
    Bot,
    BrainCircuit,
    BrainGraphLoader,
    Button,
    Cell,
    Check,
    Download,
    FileText,
    GitBranch,
    Hexagon,
    LoaderCircle,
    Network,
    RefreshCcw,
    Sparkles,
    brainGraph,
    brainGraphEdgePath,
    brainGraphLoading,
    brainGraphStatus,
    brainNodePoints,
    brainPan,
    endBrainPan,
    formatBrainDate,
    inspectBrainNode,
    moveBrainPan,
    refreshBrainGraph,
    selectedAgent,
    selectedBrainNode,
    setActiveView,
    setBrainPan,
    setQuickAddDrafts,
    setQuickAddStatus,
    setSkillBrowserOpen,
    setSkillBrowserView,
    setSkillBrowserWrittenContent,
    setText,
    sharedVault,
    splitBrainLabel,
    startBrainPan,
    vaultClass,
  } = props;
  const [brainGraphFilter, setBrainGraphFilter] = useState("all");
  const [brainGraphQuery, setBrainGraphQuery] = useState("");
  const [brainContextNodeIds, setBrainContextNodeIds] = useState<string[]>([]);
  const graphNow = Date.parse(brainGraph?.generatedAt ?? "") || 0;
  const brainFilterModes = [
    { id: "all", label: "All" },
    { id: "neighborhood", label: "Neighborhood" },
    { id: "recent", label: "Recent" },
    { id: "agent", label: "Agent-touched" },
    { id: "unresolved", label: "Unresolved" },
    { id: "orphans", label: "Orphans" },
    { id: "stale", label: "Stale hubs" },
  ];
  const brainNodesById = useMemo(() => new Map((brainGraph?.nodes ?? []).map((node) => [node.id, node])), [brainGraph]);
  const selectedOutgoingNodes = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return [];
    const nodes = brainGraph.links
      .filter((link) => link.source === selectedBrainNode.id)
      .map((link) => brainNodesById.get(link.target))
      .filter(Boolean);
    return uniqueNodesById(nodes).slice(0, 8);
  }, [brainGraph, brainNodesById, selectedBrainNode]);
  const selectedBacklinkNodes = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return [];
    const nodes = brainGraph.links
      .filter((link) => link.target === selectedBrainNode.id)
      .map((link) => brainNodesById.get(link.source))
      .filter(Boolean);
    return uniqueNodesById(nodes).slice(0, 8);
  }, [brainGraph, brainNodesById, selectedBrainNode]);
  const relatedTagNodes = useMemo(() => {
    if (!brainGraph || !selectedBrainNode?.tags?.length) return [];
    const tags = new Set(selectedBrainNode.tags);
    return brainGraph.nodes
      .filter((node) => node.id !== selectedBrainNode.id && node.tags?.some((tag) => tags.has(tag)))
      .slice(0, 6);
  }, [brainGraph, selectedBrainNode]);
  const brainContextNodes = useMemo(() => (
    brainContextNodeIds.map((id) => brainNodesById.get(id)).filter(Boolean)
  ), [brainContextNodeIds, brainNodesById]);
  const visibleBrainNodes = useMemo(() => {
    if (!brainGraph) return [];
    const query = brainGraphQuery.trim().toLowerCase();
    const linkedIds = new Set<string>();
    if (selectedBrainNode) {
      linkedIds.add(selectedBrainNode.id);
      for (const link of brainGraph.links) {
        if (link.source === selectedBrainNode.id) linkedIds.add(link.target);
        if (link.target === selectedBrainNode.id) linkedIds.add(link.source);
      }
    }
    const matchesFilter = (node) => {
      const degree = node.incoming + node.outgoing;
      if (brainGraphFilter === "neighborhood") return linkedIds.has(node.id);
      if (brainGraphFilter === "unresolved") return node.id.startsWith("unresolved:");
      if (brainGraphFilter === "orphans") return !node.id.startsWith("unresolved:") && degree === 0;
      if (brainGraphFilter === "recent") {
        const touched = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
        return Number.isFinite(touched) && touched >= graphNow - 14 * 24 * 60 * 60 * 1000;
      }
      if (brainGraphFilter === "agent") return node.accessCount > 0;
      if (brainGraphFilter === "stale") {
        const lastSeen = Date.parse(node.lastAccessedAt ?? node.modifiedAt ?? "");
        return degree >= 3 && (!Number.isFinite(lastSeen) || lastSeen < graphNow - 30 * 24 * 60 * 60 * 1000);
      }
      return true;
    };
    const matchesQuery = (node) => {
      if (!query) return true;
      return [node.label, node.folder, node.id, node.preview, ...(node.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    };
    const filtered = brainGraph.nodes.filter((node) => matchesFilter(node) && matchesQuery(node));
    return (filtered.length ? filtered : brainGraph.nodes.filter(matchesQuery)).slice(0, 96);
  }, [brainGraph, brainGraphFilter, brainGraphQuery, graphNow, selectedBrainNode]);
  const brainLayout = useMemo(
    () => brainGraphLayout(visibleBrainNodes),
    [visibleBrainNodes],
  );
  const selectedBrainTargetIds = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return new Set<string>();
    const targetIds = new Set<string>();
    for (const link of brainGraph.links) {
      if (link.source === selectedBrainNode.id && brainLayout.positions.has(link.target)) targetIds.add(link.target);
      if (link.target === selectedBrainNode.id && brainLayout.positions.has(link.source)) targetIds.add(link.source);
    }
    return targetIds;
  }, [brainGraph, brainLayout.positions, selectedBrainNode]);
  const noteContextLine = (node) => `- ${node.id}${node.preview ? `: ${node.preview}` : ""}`;
  const brainContextPrompt = (nodes) => [
    "Use these Shared Brain notes as context:",
    ...nodes.map(noteContextLine),
    "",
    "Help me reason about what matters, what is stale, and what action should come next.",
  ].join("\n");
  const seedBrainChat = (nodes) => {
    const usableNodes = nodes.filter((node) => !node.id.startsWith("unresolved:"));
    if (!usableNodes.length) return;
    setText(brainContextPrompt(usableNodes));
    setActiveView("chat");
  };
  const toggleBrainContextNode = (node) => {
    if (node.id.startsWith("unresolved:")) return;
    setBrainContextNodeIds((current) => (
      current.includes(node.id)
        ? current.filter((id) => id !== node.id)
        : [...current, node.id].slice(-8)
    ));
  };
  const createBrainTask = (node) => {
    const title = `Review shared brain note: ${node.label}\n\nSource: ${node.id}${node.preview ? `\n\nContext: ${node.preview}` : ""}`;
    setQuickAddDrafts((current) => ({ ...current, ready: title }));
    setQuickAddStatus("ready");
    setActiveView("kanban");
  };
  const skillSlug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "shared-brain-skill";
  const convertNoteToSkill = (node) => {
    const slug = skillSlug(node.label);
    setSkillBrowserWrittenContent(`---\nname: ${slug}\ndescription: ${node.preview || `Use when work should follow the ${node.label} shared brain note.`}\n---\n\n# ${node.label}\n\nSource note: [[${node.id.replace(/\.md$/i, "")}]]\n\n${node.preview || "Summarize the workflow, trigger conditions, steps, and verification criteria here."}\n`);
    setSkillBrowserView("write");
    setSkillBrowserOpen(true);
  };
  const createMissingBrainNote = async (node) => {
    const response = await fetch("/api/obsidian/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-missing",
        vaultPath: sharedVault.vaultPath,
        target: node.id,
        sourceNotePath: selectedBacklinkNodes[0]?.id,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data?.ok) {
      setBrainGraphQuery(node.label);
      return;
    }
    setBrainGraphQuery(data.note?.title ?? node.label);
    void refreshBrainGraph(true);
  };
  const panBrainGraphWithWheel = (event) => {
    event.preventDefault();
    setBrainPan((current) => ({
      x: current.x + event.deltaX,
      y: current.y + event.deltaY,
    }));
  };

  return (
    <>
      <div className={graphClass("toolbar")}>
        <div className={graphClass("search")}>
          <Network aria-hidden="true" />
          <input
            type="search"
            value={brainGraphQuery}
            onChange={(event) => setBrainGraphQuery(event.target.value)}
            placeholder="Search notes, folders, tags, previews"
            aria-label="Search shared brain graph"
          />
        </div>
        <div className={graphClass("filters")} aria-label="Graph filters">
          {brainFilterModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={graphClass(brainGraphFilter === mode.id && "isActive")}
              onClick={() => setBrainGraphFilter(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <span className={graphClass("visibleCount")}>{visibleBrainNodes.length} shown</span>
      </div>
      <div className={vaultClass("brainWorkspace")}>
        <section className={vaultClass("brainGraphPanel")} aria-label="Shared brain graph">
          <div className={vaultClass("brainGraphCanvas")} onWheel={panBrainGraphWithWheel}>
            <button
              type="button"
              className={vaultClass("brainGraphRefreshButton")}
              aria-label={brainGraphLoading ? "Refreshing brain graph" : "Refresh brain graph"}
              title={brainGraphLoading ? "Refreshing brain graph" : "Refresh brain graph"}
              onClick={() => refreshBrainGraph(true)}
              disabled={brainGraphLoading}
            >
              {brainGraphLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
            </button>
            {visibleBrainNodes.length ? (
              <>
                <svg
                  viewBox={`${brainPan.x} ${brainPan.y} ${brainLayout.width} ${brainLayout.height}`}
                  role="img"
                  aria-label="Hive shaped Obsidian graph"
                  onPointerDown={startBrainPan}
                  onPointerMove={moveBrainPan}
                  onPointerUp={endBrainPan}
                  onPointerCancel={endBrainPan}
                  className={vaultClass("draggable", brainGraphLoading && "dimmed")}
                >
                  <defs>
                    <filter id="brainNodeGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {visibleBrainNodes.map((node) => {
                    const position = brainLayout.positions.get(node.id);
                    if (!position) return null;
                    const selected = selectedBrainNode?.id === node.id;
                    const target = !selected && selectedBrainTargetIds.has(node.id);
                    const unresolved = node.id.startsWith("unresolved:");
                    const recentAt = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
                    const recent = Number.isFinite(recentAt) && recentAt > graphNow - 14 * 24 * 60 * 60 * 1000;
                    const staleHub = node.incoming + node.outgoing >= 3 && !node.accessCount && !recent;
                    const labelLines = splitBrainLabel(node.label);
                    return (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        data-brain-node-id={node.id}
                        aria-label={selected ? `Open ${node.label} in Obsidian` : `Inspect ${node.label}`}
                        className={`${vaultClass("brainNode", selected && "selected", target && "target", unresolved && "unresolved")} ${graphClass(
                          brainContextNodeIds.includes(node.id) && "nodeContext",
                          recent && "nodeRecent",
                          node.accessCount && "nodeAgentTouched",
                          staleHub && "nodeStaleHub",
                        )}`}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") void inspectBrainNode(node);
                        }}
                      >
                        <polygon
                          points={brainNodePoints(position.x, position.y, brainLayout.radius)}
                          filter={selected ? "url(#brainNodeGlow)" : undefined}
                        />
                        <text x={position.x} y={position.y - (labelLines.length > 1 ? 11 : 4)} textAnchor="middle">
                          {labelLines.map((line, index) => (
                            <tspan key={`${line}-${index}`} x={position.x} dy={index === 0 ? 0 : 15}>{line}</tspan>
                          ))}
                        </text>
                        <text x={position.x} y={position.y + 31} textAnchor="middle" className={vaultClass("brainNodeMeta")}>
                          {node.accessCount ? `${node.accessCount} reads` : `${node.incoming + node.outgoing} links`}
                        </text>
                      </g>
                    );
                  })}
                  {brainGraph?.links
                    .filter((link) => (
                      selectedBrainNode
                      && (link.source === selectedBrainNode.id || link.target === selectedBrainNode.id)
                      && brainLayout.positions.has(link.source)
                      && brainLayout.positions.has(link.target)
                    ))
                    .filter((link, index, links) => {
                      const selectedId = selectedBrainNode!.id;
                      const otherId = link.source === selectedId ? link.target : link.source;
                      return links.findIndex((candidate) => (
                        (candidate.source === selectedId ? candidate.target : candidate.source) === otherId
                      )) === index;
                    })
                    .slice(0, 24)
                    .map((link, index) => {
                      const selectedId = selectedBrainNode!.id;
                      const otherId = link.source === selectedId ? link.target : link.source;
                      const source = brainLayout.coordsByNode.get(selectedId)!;
                      const target = brainLayout.coordsByNode.get(otherId)!;
                      return (
                        <path
                          key={`${selectedId}-${otherId}-${index}`}
                          data-brain-route={`${selectedId}->${otherId}`}
                          d={brainGraphEdgePath(source, target, brainLayout.positionsByCoord, brainLayout.radius)}
                          className={vaultClass("brainEdgeActive")}
                        />
                      );
                    })}
                </svg>
                {brainGraphLoading ? <BrainGraphLoader compact /> : null}
              </>
            ) : brainGraphLoading ? (
              <BrainGraphLoader />
            ) : (
              <div className={vaultClass("brainEmpty")}>
                <Hexagon aria-hidden="true" />
                <strong>No graph loaded</strong>
                <span>{brainGraphStatus || "Refresh the graph after the vault path is reachable."}</span>
              </div>
            )}
          </div>
        </section>

        <aside className={vaultClass("brainInspector")}>
          <div className={vaultClass("brainInspectorHeader")}>
            <span><BrainCircuit aria-hidden="true" /> Note inspector</span>
            <small>{selectedAgent?.name ?? "Dashboard"} is the active accessor</small>
          </div>
          {selectedBrainNode ? (
            <>
              <h3>{selectedBrainNode.label}</h3>
              <p>{selectedBrainNode.folder}</p>
              {selectedBrainNode.preview ? (
                <ChatMarkdown
                  text={selectedBrainNode.preview}
                  className={graphClass("preview", "previewMarkdown")}
                  headingClassName={graphClass("previewHeading")}
                />
              ) : null}
              <dl>
                <div><dt>Incoming</dt><dd>{selectedBrainNode.incoming}</dd></div>
                <div><dt>Outgoing</dt><dd>{selectedBrainNode.outgoing}</dd></div>
                <div><dt>Accesses</dt><dd>{selectedBrainNode.accessCount}</dd></div>
                <div><dt>Last seen</dt><dd>{formatBrainDate(selectedBrainNode.lastAccessedAt)}</dd></div>
                <div><dt>Modified</dt><dd>{formatBrainDate(selectedBrainNode.modifiedAt)}</dd></div>
                <div><dt>Lines</dt><dd>{selectedBrainNode.lineCount ?? "—"}</dd></div>
              </dl>
              {selectedBrainNode.tags.length ? (
                <div className={vaultClass("brainTags")}>
                  {selectedBrainNode.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                </div>
              ) : null}
              <div className={graphClass("actionGrid")}>
                {!selectedBrainNode.id.startsWith("unresolved:") ? (
                  <>
                    <Button type="button" size="sm" onClick={() => seedBrainChat([selectedBrainNode])}><Sparkles aria-hidden="true" />Ask</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => toggleBrainContextNode(selectedBrainNode)}><FileText aria-hidden="true" />{brainContextNodeIds.includes(selectedBrainNode.id) ? "Detach" : "Attach"}</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => createBrainTask(selectedBrainNode)}><Check aria-hidden="true" />Task</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => convertNoteToSkill(selectedBrainNode)}><Download aria-hidden="true" />Skill</Button>
                  </>
                ) : (
                  <Button type="button" size="sm" onClick={() => void createMissingBrainNote(selectedBrainNode)}><FileText aria-hidden="true" />Create Note</Button>
                )}
              </div>
              {brainContextNodes.length ? (
                <div className={graphClass("contextTray")}>
                  <div>
                    <strong>Chat context</strong>
                    <span>{brainContextNodes.length} selected note{brainContextNodes.length === 1 ? "" : "s"}</span>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => seedBrainChat(brainContextNodes)}><Sparkles aria-hidden="true" />Ask selected</Button>
                </div>
              ) : null}
              <div className={graphClass("linkLists")}>
                <BrainLinkList title="Backlinks" icon={GitBranch} nodes={selectedBacklinkNodes} onInspect={inspectBrainNode} empty="No backlinks in the loaded graph." />
                <BrainLinkList title="Outgoing" icon={GitBranch} nodes={selectedOutgoingNodes} onInspect={inspectBrainNode} empty="No outgoing links in the loaded graph." />
                {relatedTagNodes.length ? <BrainLinkList title="Related tags" icon={Cell} nodes={relatedTagNodes} onInspect={inspectBrainNode} /> : null}
              </div>
              <div className={vaultClass("brainAccessList")}>
                <strong>Access history</strong>
                {(selectedBrainNode.recentAccesses.length ? selectedBrainNode.recentAccesses : brainGraph?.recentAccesses.slice(0, 5) ?? []).map((event) => (
                  <article key={event.id}>
                    <Bot aria-hidden="true" />
                    <div>
                      <span>{event.agentName} on {event.machineName}</span>
                      <small>{formatBrainDate(event.accessedAt)} · {event.action} · {event.notePath}</small>
                    </div>
                  </article>
                ))}
                {!selectedBrainNode.recentAccesses.length && !brainGraph?.recentAccesses.length ? <p>No agent access history yet. Click a note to seed the audit trail.</p> : null}
              </div>
            </>
          ) : (
            <div className={vaultClass("brainEmpty", "compact")}>
              <Hexagon aria-hidden="true" />
              <strong>Select a hive cell</strong>
              <span>Agent and machine access history will appear here.</span>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function BrainLinkList({ title, icon: Icon, nodes, onInspect, empty }: any) {
  return (
    <section>
      <strong>{title}</strong>
      {nodes.length ? nodes.map((node) => (
        <button key={node.id} type="button" onClick={() => onInspect(node)}>
          <Icon aria-hidden="true" />
          <span>{node.label}</span>
        </button>
      )) : empty ? <p>{empty}</p> : null}
    </section>
  );
}
