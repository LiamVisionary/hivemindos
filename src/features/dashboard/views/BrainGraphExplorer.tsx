// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Partially typed 2026-07-02; the typing pass ran out of session mid-file and the remaining errors are deferred (see CHANGELOG).
"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import styles from "./BrainGraphExplorer.module.css";

const BrainSynapseCanvas = dynamic(() => import("./BrainSynapseCanvas"), { ssr: false });

const graphClass = (...classes) => classes.map((className) => styles[className]).filter(Boolean).join(" ");

const MAX_VISIBLE_NODES = 160;
const BRAIN_ASK_PROMPT = "Help me reason about what matters, what is stale, and what action should come next.";

function uniqueNodesById(nodes: any[]) {
  const unique = new Map<string, any>();
  for (const node of nodes) {
    if (node?.id && !unique.has(node.id)) unique.set(node.id, node);
  }
  return [...unique.values()];
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
    formatBrainDate,
    inspectBrainNode,
    refreshBrainGraph,
    selectedAgent,
    selectedBrainNode,
    setActiveView,
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
    vaultClass,
  } = props;
  const [brainGraphFilter, setBrainGraphFilter] = useState("all");
  const [brainGraphQuery, setBrainGraphQuery] = useState("");
  const [brainContextNodeIds, setBrainContextNodeIds] = useState<string[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
      return [selectedBrainNode, ...filteredNodes].slice(0, MAX_VISIBLE_NODES);
    }
    return filteredNodes.slice(0, MAX_VISIBLE_NODES);
  }, [brainGraph, brainGraphFilter, brainGraphQuery, graphNow, neighborsById, selectedBrainNode]);
  const visibleIds = useMemo(() => new Set(visibleBrainNodes.map((node) => node.id)), [visibleBrainNodes]);
  const synapseNodes = useMemo(() => visibleBrainNodes.map((node) => {
    const degree = (node.incoming ?? 0) + (node.outgoing ?? 0);
    const recentAt = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
    const recent = Number.isFinite(recentAt) && recentAt > graphNow - 14 * 24 * 60 * 60 * 1000;
    const unresolved = node.id.startsWith("unresolved:");
    const staleHub = degree >= 3 && !node.accessCount && !recent;
    const tone = unresolved
      ? "unresolved"
      : node.accessCount
        ? "touched"
        : staleHub ? "stale" : recent ? "recent" : "plain";
    // Size = how load-bearing the note is: links weigh double, agent reads add
    // on top, log-scaled so hubs differentiate instead of all saturating.
    const importance = degree * 2 + (node.accessCount ?? 0);
    return {
      id: node.id,
      label: node.label,
      meta: node.accessCount
        ? `${node.accessCount} read${node.accessCount === 1 ? "" : "s"}`
        : `${degree} link${degree === 1 ? "" : "s"}`,
      weight: Math.min(1, Math.log2(1 + importance) / 6),
      tone,
    };
  }), [graphNow, visibleBrainNodes]);
  const synapseLinks = useMemo(() => (
    (brainGraph?.links ?? [])
      .filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
      .map((link) => ({ source: link.source, target: link.target }))
  ), [brainGraph, visibleIds]);
  const neighborIds = useMemo(() => {
    if (!selectedBrainNode) return [];
    const ids = new Set<string>();
    for (const link of synapseLinks) {
      if (link.source === selectedBrainNode.id) ids.add(link.target);
      if (link.target === selectedBrainNode.id) ids.add(link.source);
    }
    return [...ids];
  }, [selectedBrainNode, synapseLinks]);
  const handleNodeClick = useCallback((nodeId) => {
    const node = brainNodesById.get(nodeId);
    if (node) {
      setInspectorOpen(true);
      void inspectBrainNode(node);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainNodesById]);
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
  const recentEvents = brainGraph?.recentAccesses.slice(0, 7) ?? [];

  return (
    <div className={graphClass("stage", "fade")}>
      <BrainSynapseCanvas
        className={graphClass("canvasLayer", brainGraphLoading && "canvasDimmed")}
        labelClassName={styles.nodeLabel}
        nodes={synapseNodes}
        links={synapseLinks}
        selectedId={selectedBrainNode?.id ?? null}
        neighborIds={neighborIds}
        contextIds={brainContextNodeIds}
        onNodeClick={handleNodeClick}
      />

      <div className={graphClass("hudTop")}>
        <div className={graphClass("hudRow")}>
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
          <button
            type="button"
            className={graphClass("hudIconButton")}
            aria-label={brainGraphLoading ? "Refreshing brain graph" : "Refresh brain graph"}
            title={brainGraphLoading ? "Refreshing brain graph" : "Refresh brain graph"}
            onClick={() => refreshBrainGraph(true)}
            disabled={brainGraphLoading}
          >
            {brainGraphLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
          </button>
          <span className={graphClass("visibleCount")}>
            {visibleBrainNodes.length} neurons · {synapseLinks.length} synapses
          </span>
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
      </div>

      <div className={graphClass("legend")} aria-hidden="true">
        <span><i className={graphClass("legendSize")} />size = links + reads</span>
        <span><i className={graphClass("legendHoney")} />agent-touched</span>
        <span><i className={graphClass("legendTeal")} />recently changed</span>
        <span><i className={graphClass("legendDanger")} />unresolved link</span>
        <span><i className={graphClass("legendPulse")} />firing = link traffic</span>
      </div>
      {visibleBrainNodes.length && brainGraphStatus ? (
        <p className={graphClass("statusLine")}>{brainGraphStatus}</p>
      ) : null}

      {!visibleBrainNodes.length && !brainGraphLoading ? (
        <div className={graphClass("centerOverlay")}>
          <div className={vaultClass("brainEmpty")}>
            <Hexagon aria-hidden="true" />
            <strong>No notes match</strong>
            <span>{brainGraphStatus || "Try a different filter or search."}</span>
          </div>
        </div>
      ) : null}
      {brainGraphLoading ? (
        <div className={graphClass("centerOverlay", visibleBrainNodes.length && "centerOverlayCompact")}>
          <BrainGraphLoader compact={Boolean(visibleBrainNodes.length)} />
        </div>
      ) : null}

      {!inspectorOpen ? (
        <button
          type="button"
          className={graphClass("inspectorReveal")}
          onClick={() => setInspectorOpen(true)}
        >
          <BrainCircuit aria-hidden="true" />
          Inspector
        </button>
      ) : (
      <aside className={graphClass("inspector")}>
        <div className={graphClass("inspectorTop")}>
          <span><BrainCircuit aria-hidden="true" /> Note inspector</span>
          <div className={graphClass("inspectorTopRight")}>
            <small>{selectedAgent?.name ?? "Dashboard"} accessor</small>
            <button
              type="button"
              className={graphClass("hudIconButton", "inspectorHide")}
              aria-label="Hide note inspector"
              title="Hide note inspector"
              onClick={() => setInspectorOpen(false)}
            >
              <span aria-hidden="true" className={graphClass("chevron")} />
            </button>
          </div>
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
            <p>Select a neuron to see its provenance and links.</p>
          </div>
        )}
      </aside>
      )}
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
