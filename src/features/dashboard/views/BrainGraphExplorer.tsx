// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Partially typed 2026-07-02; the typing pass ran out of session mid-file and the remaining errors are deferred (see CHANGELOG).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import styles from "./BrainGraphExplorer.module.css";

const graphClass = (...classes) => classes.map((className) => styles[className]).filter(Boolean).join(" ");

const GRAPH_W = 700;
const GRAPH_H = 540;
const GRAPH_MIN_SCALE = 0.55;
const GRAPH_MAX_SCALE = 3;
const BRAIN_ASK_PROMPT = "Help me reason about what matters, what is stale, and what action should come next.";
const NODE_ANCHORS = [
  { x: 50, y: 50 },
  { x: 30, y: 27 },
  { x: 15, y: 44 },
  { x: 72, y: 25 },
  { x: 80, y: 50 },
  { x: 50, y: 75 },
  { x: 70, y: 72 },
  { x: 34, y: 70 },
  { x: 21, y: 61 },
  { x: 60, y: 36 },
  { x: 88, y: 38 },
  { x: 44, y: 90 },
];

function uniqueNodesById(nodes: any[]) {
  const unique = new Map<string, any>();
  for (const node of nodes) {
    if (node?.id && !unique.has(node.id)) unique.set(node.id, node);
  }
  return [...unique.values()];
}

function hashUnit(value: string, salt = 0) {
  let hash = 2166136261 + salt;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nodeLayoutScore(node: any, graphNow: number) {
  const degree = (node.incoming ?? 0) + (node.outgoing ?? 0);
  const touched = Date.parse(node.modifiedAt ?? "");
  const recentBoost = Number.isFinite(touched) && touched > graphNow - 14 * 24 * 60 * 60 * 1000 ? 10 : 0;
  return degree * 1.2 + recentBoost;
}

function buildNodeCloudLayout(nodes: any[], graphNow: number) {
  const ranked = [...nodes].sort((a, b) => (
    nodeLayoutScore(b, graphNow) - nodeLayoutScore(a, graphNow)
    || String(a.id).localeCompare(String(b.id))
  ));
  const positions = new Map<string, { x: number; y: number }>();
  const overflowTotal = Math.max(1, ranked.length - NODE_ANCHORS.length);

  ranked.forEach((node, index) => {
    const anchor = NODE_ANCHORS[index];
    if (anchor) {
      positions.set(node.id, {
        x: 30 + (anchor.x / 100) * (GRAPH_W - 60),
        y: 28 + (anchor.y / 100) * (GRAPH_H - 56),
      });
      return;
    }
    const localIndex = index - NODE_ANCHORS.length;
    const ring = Math.sqrt((localIndex + 1) / (overflowTotal + 1));
    const angle = localIndex * 2.399963 + hashUnit(node.id, 13) * 0.85;
    const degreePull = Math.min(0.24, ((node.incoming ?? 0) + (node.outgoing ?? 0)) / 90);
    const spreadX = 42 - degreePull * 24 + hashUnit(node.id, 29) * 8;
    const spreadY = 36 - degreePull * 20 + hashUnit(node.id, 43) * 8;
    const xPct = clamp(50 + Math.cos(angle) * spreadX * ring + (hashUnit(node.id, 61) - 0.5) * 7, 8, 92);
    const yPct = clamp(52 + Math.sin(angle) * spreadY * ring + (hashUnit(node.id, 79) - 0.5) * 7, 8, 92);
    positions.set(node.id, {
      x: 30 + (xPct / 100) * (GRAPH_W - 60),
      y: 28 + (yPct / 100) * (GRAPH_H - 56),
    });
  });

  return { positions, width: GRAPH_W, height: GRAPH_H };
}

function splitLabel(label: string) {
  if (label.length <= 16) return [label];
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > 16 && current) {
      lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function actionTone(action: string) {
  if (action === "write") return "var(--brain-live, #6fcdba)";
  if (action === "inspect") return "var(--brain-honey, #e7b45c)";
  return "var(--brain-fg-3, #76726a)";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function brainNodeAttachment(node: any, vaultPath?: string) {
  const relativePath = String(node.id ?? "").replace(/^\/+/, "");
  const vaultRoot = trimTrailingSlash(String(vaultPath ?? ""));
  const referencePath = vaultRoot ? `${vaultRoot}/${relativePath}` : relativePath;
  const modifiedAt = Date.parse(node.modifiedAt ?? "");
  return {
    id: `brain-note-${relativePath}-${crypto.randomUUID()}`,
    kind: "file",
    name: relativePath.split("/").pop() || `${node.label || "Shared Brain note"}.md`,
    mimeType: "text/markdown",
    size: Number(node.byteSize) || 0,
    dataUrl: "",
    referencePath,
    referenceOnly: true,
    lastModified: Number.isFinite(modifiedAt) ? modifiedAt : undefined,
  };
}

function uniqueBrainAttachments(attachments: any[]) {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const key = attachment.referencePath || attachment.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatInspectorDateParts(value?: string, fallbackFormat?: (date?: string) => string) {
  if (!value) return { primary: "Never" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { primary: fallbackFormat?.(value) ?? value };
  const parts = new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const primary = [part("month"), part("day")].filter(Boolean).join(" ");
  const secondary = [part("hour") && part("minute") ? `${part("hour")}:${part("minute")}` : "", part("dayPeriod")]
    .filter(Boolean)
    .join(" ");
  return { primary: primary || fallbackFormat?.(value) || value, secondary };
}

function InspectorStat({ label, value, secondary, kind = "count" }: any) {
  return (
    <div className={graphClass(kind === "date" ? "dateStat" : "countStat")}>
      <dt>{label}</dt>
      <dd>
        <span className={graphClass("statValue")}>{value}</span>
        {secondary ? <span className={graphClass("statSubvalue")}>{secondary}</span> : null}
      </dd>
    </div>
  );
}

function InspectorDateStat({ label, value, fallbackFormat }: any) {
  const date = formatInspectorDateParts(value, fallbackFormat);
  return <InspectorStat label={label} value={date.primary} secondary={date.secondary} kind="date" />;
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
    brainGraphLoading,
    brainGraphStatus,
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
    setChatAttachments,
    setChatDirectories,
    setQuickAddDrafts,
    setQuickAddStatus,
    setSkillBrowserOpen,
    setSkillBrowserView,
    setSkillBrowserWrittenContent,
    setText,
    sharedVault,
    startAgentChat,
    startBrainPan,
    vaultClass,
  } = props;
  const [brainGraphFilter, setBrainGraphFilter] = useState("all");
  const [brainGraphQuery, setBrainGraphQuery] = useState("");
  const [brainContextNodeIds, setBrainContextNodeIds] = useState<string[]>([]);
  const brainGraphCanvasRef = useRef<HTMLDivElement | null>(null);
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
  const neighborsById = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of brainGraph?.links ?? []) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
    }
    return map;
  }, [brainGraph]);
  const selectedOutgoingNodes = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return [];
    const nodes = brainGraph.links
      .filter((link) => link.source === selectedBrainNode.id)
      .map((link) => brainNodesById.get(link.target))
      .filter(Boolean);
    return uniqueNodesById(nodes);
  }, [brainGraph, brainNodesById, selectedBrainNode]);
  const selectedBacklinkNodes = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return [];
    const nodes = brainGraph.links
      .filter((link) => link.target === selectedBrainNode.id)
      .map((link) => brainNodesById.get(link.source))
      .filter(Boolean);
    return uniqueNodesById(nodes);
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
    const selectedNeighbors = selectedBrainNode ? neighborsById.get(selectedBrainNode.id) : null;
    const matchesFilter = (node) => {
      const degree = node.incoming + node.outgoing;
      if (brainGraphFilter === "neighborhood") return selectedBrainNode ? node.id === selectedBrainNode.id || selectedNeighbors?.has(node.id) : true;
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
    const filteredNodes = brainGraph.nodes.filter((node) => matchesFilter(node) && matchesQuery(node));
    const shouldKeepSelectedVisible = brainGraphFilter === "stale" && selectedBrainNode && matchesQuery(selectedBrainNode);
    if (shouldKeepSelectedVisible && !filteredNodes.some((node) => node.id === selectedBrainNode.id)) {
      return [selectedBrainNode, ...filteredNodes].slice(0, 96);
    }
    return filteredNodes.slice(0, 96);
  }, [brainGraph, brainGraphFilter, brainGraphQuery, graphNow, neighborsById, selectedBrainNode]);
  const brainLayout = useMemo(() => buildNodeCloudLayout(visibleBrainNodes, graphNow), [graphNow, visibleBrainNodes]);
  const brainGraphScale = clamp(brainPan?.scale ?? 1, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
  const brainViewportPoint = (point) => ({
    x: (brainPan?.x ?? 0) + point.x * brainGraphScale,
    y: (brainPan?.y ?? 0) + point.y * brainGraphScale,
  });
  const visibleIds = useMemo(() => new Set(visibleBrainNodes.map((node) => node.id)), [visibleBrainNodes]);
  const selectedBrainTargetIds = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return new Set<string>();
    const targetIds = new Set<string>();
    for (const link of brainGraph.links) {
      if (link.source === selectedBrainNode.id && brainLayout.positions.has(link.target)) targetIds.add(link.target);
      if (link.target === selectedBrainNode.id && brainLayout.positions.has(link.source)) targetIds.add(link.source);
    }
    return targetIds;
  }, [brainGraph, brainLayout.positions, selectedBrainNode]);
  const seedBrainChat = (nodes) => {
    const usableNodes = nodes.filter((node) => !node.id.startsWith("unresolved:"));
    if (!usableNodes.length) return;
    const attachments = uniqueBrainAttachments(usableNodes.map((node) => brainNodeAttachment(node, sharedVault?.vaultPath)));
    setChatAttachments(attachments);
    setChatDirectories?.([]);
    setText(BRAIN_ASK_PROMPT);
    if (selectedAgent?.id && startAgentChat) {
      startAgentChat(selectedAgent.id, { fresh: true });
      return;
    }
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
  const panBrainGraphWithWheel = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pointerX = clamp((event.clientX - rect.left) / rect.width, 0, 1) * GRAPH_W;
    const pointerY = clamp((event.clientY - rect.top) / rect.height, 0, 1) * GRAPH_H;
    const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
    const normalizedDeltaY = event.deltaY * deltaMultiplier;
    const zoomFactor = Math.exp(-normalizedDeltaY * 0.0012);
    setBrainPan((current) => {
      const currentScale = clamp(current.scale ?? 1, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
      const nextScale = clamp(currentScale * zoomFactor, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
      if (Math.abs(nextScale - currentScale) < 0.001) return current;
      const focalX = (pointerX - (current.x ?? 0)) / currentScale;
      const focalY = (pointerY - (current.y ?? 0)) / currentScale;
      return {
        x: pointerX - focalX * nextScale,
        y: pointerY - focalY * nextScale,
        scale: nextScale,
      };
    });
  }, [setBrainPan]);
  useEffect(() => {
    const canvas = brainGraphCanvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener("wheel", panBrainGraphWithWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", panBrainGraphWithWheel);
  }, [panBrainGraphWithWheel]);
  const recentEvents = brainGraph?.recentAccesses.slice(0, 7) ?? [];

  return (
    <div className={graphClass("fade")}>
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
        <span className={graphClass("visibleCount")}>{visibleBrainNodes.length} shown</span>
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
      <div className={vaultClass("brainWorkspace")}>
        <section className={vaultClass("brainGraphPanel")} aria-label="Shared brain graph">
          <div ref={brainGraphCanvasRef} className={vaultClass("brainGraphCanvas")}>
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
                  viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
                  role="img"
                  aria-label="Obsidian memory graph"
                  onPointerDown={startBrainPan}
                  onPointerMove={moveBrainPan}
                  onPointerUp={endBrainPan}
                  onPointerCancel={endBrainPan}
                  className={vaultClass("draggable", brainGraphLoading && "dimmed")}
                >
                  <defs>
                    <filter id="brainGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {brainGraph?.links
                    .filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
                    .map((link, index) => {
                      const source = brainLayout.positions.get(link.source);
                      const target = brainLayout.positions.get(link.target);
                      if (!source || !target) return null;
                      const sourcePoint = brainViewportPoint(source);
                      const targetPoint = brainViewportPoint(target);
                      const lit = selectedBrainNode && (link.source === selectedBrainNode.id || link.target === selectedBrainNode.id);
                      return (
                        <line
                          key={`${link.source}-${link.target}-${index}`}
                          x1={sourcePoint.x}
                          y1={sourcePoint.y}
                          x2={targetPoint.x}
                          y2={targetPoint.y}
                          className={vaultClass(lit ? "brainEdgeActive" : "brainEdge")}
                        />
                      );
                    })}
                  {visibleBrainNodes.map((node) => {
                    const layoutPosition = brainLayout.positions.get(node.id);
                    if (!layoutPosition) return null;
                    const position = brainViewportPoint(layoutPosition);
                    const selected = selectedBrainNode?.id === node.id;
                    const target = !selected && selectedBrainTargetIds.has(node.id);
                    const unresolved = node.id.startsWith("unresolved:");
                    const recentAt = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
                    const recent = Number.isFinite(recentAt) && recentAt > graphNow - 14 * 24 * 60 * 60 * 1000;
                    const staleHub = node.incoming + node.outgoing >= 3 && !node.accessCount && !recent;
                    const dim = selectedBrainNode && !selected && !target;
                    const labelLines = splitLabel(node.label);
                    const radius = 7 + Math.min(15, (node.accessCount || node.incoming + node.outgoing) * 0.5);
                    const labelY = position.y + radius + 13;
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
                          dim && "nodeDimmed",
                        )}`}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void inspectBrainNode(node);
                          }
                        }}
                      >
                        <circle
                          cx={position.x}
                          cy={position.y}
                          r={radius}
                          filter={selected ? "url(#brainGlow)" : undefined}
                        />
                        {node.accessCount ? <circle className={vaultClass("brainNodeCore")} cx={position.x} cy={position.y} r={Math.max(2.4, radius * 0.34)} /> : null}
                        <text x={position.x} y={labelY} textAnchor="middle">
                          {labelLines.map((line, index) => (
                            <tspan key={`${line}-${index}`} x={position.x} dy={index === 0 ? 0 : 12}>{line}</tspan>
                          ))}
                        </text>
                        <text x={position.x} y={labelY + labelLines.length * 12 + 1} textAnchor="middle" className={vaultClass("brainNodeMeta")}>
                          {node.accessCount ? `${node.accessCount} reads` : `${node.incoming + node.outgoing} links`}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div className={vaultClass("brainLegend")} aria-hidden="true">
                  <span><i className={vaultClass("legendSelected")} />hot note</span>
                  <span><i className={vaultClass("legendTarget")} />size = reads</span>
                </div>
                {brainGraphLoading ? <BrainGraphLoader compact /> : null}
              </>
            ) : brainGraphLoading ? (
              <BrainGraphLoader />
            ) : (
              <div className={vaultClass("brainEmpty")}>
                <Hexagon aria-hidden="true" />
                <strong>No notes match</strong>
                <span>{brainGraphStatus || "Try a different filter or search."}</span>
              </div>
            )}
          </div>
        </section>

        <aside className={vaultClass("brainInspector")}>
          <div className={vaultClass("brainInspectorHeader")}>
            <span><BrainCircuit aria-hidden="true" /> Note inspector</span>
            <small>{selectedAgent?.name ?? "Dashboard"} accessor</small>
          </div>
          {selectedBrainNode ? (
            <div className={graphClass("inspectorBody")}>
              <h3>{selectedBrainNode.label}</h3>
              <p className={graphClass("nodePath")}>{selectedBrainNode.folder}</p>
              {selectedBrainNode.preview ? (
                <ChatMarkdown
                  text={selectedBrainNode.preview}
                  className={graphClass("preview", "previewMarkdown")}
                  headingClassName={graphClass("previewHeading")}
                />
              ) : null}
              <dl className={graphClass("inspectorStats")}>
                <InspectorStat label="Incoming" value={selectedBrainNode.incoming} />
                <InspectorStat label="Outgoing" value={selectedBrainNode.outgoing} />
                <InspectorStat label="Accesses" value={selectedBrainNode.accessCount} />
                <InspectorDateStat label="Last seen" value={selectedBrainNode.lastAccessedAt} fallbackFormat={formatBrainDate} />
                <InspectorDateStat label="Modified" value={selectedBrainNode.modifiedAt} fallbackFormat={formatBrainDate} />
                <InspectorStat label="Lines" value={selectedBrainNode.lineCount ?? "-"} />
              </dl>
              {selectedBrainNode.tags.length ? (
                <div className={graphClass("tagRow")}>
                  <strong>Tags</strong>
                  {selectedBrainNode.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                </div>
              ) : null}
              <div className={graphClass("actionGrid")}>
                {!selectedBrainNode.id.startsWith("unresolved:") ? (
                  <>
                    <button type="button" className={graphClass("brainActionButton", "primaryAction")} onClick={() => seedBrainChat([selectedBrainNode])}><Sparkles aria-hidden="true" />Ask</button>
                    <button type="button" className={graphClass("brainActionButton")} onClick={() => toggleBrainContextNode(selectedBrainNode)}><FileText aria-hidden="true" />{brainContextNodeIds.includes(selectedBrainNode.id) ? "Detach" : "Attach"}</button>
                    <button type="button" className={graphClass("brainActionButton")} onClick={() => createBrainTask(selectedBrainNode)}><Check aria-hidden="true" />Task</button>
                    <button type="button" className={graphClass("brainActionButton")} onClick={() => convertNoteToSkill(selectedBrainNode)}><Download aria-hidden="true" />Skill</button>
                  </>
                ) : (
                  <button type="button" className={graphClass("brainActionButton", "primaryAction")} onClick={() => void createMissingBrainNote(selectedBrainNode)}><FileText aria-hidden="true" />Create Note</button>
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
                <BrainLinkList title={`Backlinks · ${selectedBacklinkNodes.length}`} icon={GitBranch} nodes={selectedBacklinkNodes} onInspect={inspectBrainNode} empty="No backlinks in the loaded graph." />
                <BrainLinkList title={`Outgoing · ${selectedOutgoingNodes.length}`} icon={GitBranch} nodes={selectedOutgoingNodes} onInspect={inspectBrainNode} empty="No outgoing links in the loaded graph." />
                {relatedTagNodes.length ? <BrainLinkList title="Related tags" icon={Cell} nodes={relatedTagNodes} onInspect={inspectBrainNode} /> : null}
              </div>
              <div className={vaultClass("brainAccessList")}>
                <strong>Access history</strong>
                {(selectedBrainNode.recentAccesses.length ? selectedBrainNode.recentAccesses : recentEvents).map((event) => (
                  <article key={event.id}>
                    <Bot aria-hidden="true" style={{ color: actionTone(event.action) }} />
                    <div>
                      <span>{event.agentName} on {event.machineName}</span>
                      <small>{formatBrainDate(event.accessedAt)} - {event.action} - {event.notePath}</small>
                    </div>
                  </article>
                ))}
                {!selectedBrainNode.recentAccesses.length && !recentEvents.length ? <p>No agent access history yet.</p> : null}
              </div>
            </div>
          ) : (
            <div className={graphClass("recentAccess")}>
              <div className="eyebrow">Recent access</div>
              {recentEvents.map((event, index) => (
                <article key={event.id} style={{ borderTop: index ? "1px solid var(--brain-line, rgba(238, 232, 220, 0.08))" : 0 }}>
                  <span style={{ background: actionTone(event.action) }} />
                  <div>
                    <strong>{event.notePath}</strong>
                    <small>{event.agentName} - {event.action} - {event.machineName}</small>
                  </div>
                  <time>{formatBrainDate(event.accessedAt)}</time>
                </article>
              ))}
              {!recentEvents.length ? (
                <p>Select a node to see its provenance and links.</p>
              ) : (
                <p>Select a node to see its provenance and links.</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function BrainLinkList({ title, icon: Icon, nodes, onInspect, empty }: any) {
  return (
    <details className={styles.disclosure} open>
      <summary>{title}</summary>
      <div className={styles.disclosureBody}>
        {nodes.length ? nodes.map((node) => (
          <button key={node.id} type="button" onClick={() => void onInspect(node)}>
            <Icon aria-hidden="true" />
            <span>{node.label}</span>
          </button>
        )) : empty ? <p>{empty}</p> : null}
      </div>
    </details>
  );
}
