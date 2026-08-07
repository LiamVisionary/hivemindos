import type { Dispatch, MutableRefObject, PointerEvent, SetStateAction } from "react";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { BrainAccessEvent, BrainGraph, BrainGraphNode } from "@/features/dashboard/dashboard-types";

type BrainPan = { x: number; y: number; scale?: number };

type BrainDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  scale: number;
  unitX: number;
  unitY: number;
  moved: boolean;
  nodeId: string;
};

export type BrainGraphHandlerDeps = {
  brainDragMovedRef: MutableRefObject<boolean>;
  brainDragRef: MutableRefObject<BrainDragState | null>;
  brainGraph: BrainGraph | null;
  brainPan: BrainPan;
  selectedAgent: AgentProfile | null;
  selectedBrainNodeId: string;
  setBrainGraph: Dispatch<SetStateAction<BrainGraph | null>>;
  setBrainGraphStatus: (value: string) => void;
  setBrainPan: Dispatch<SetStateAction<BrainPan>>;
  setSelectedBrainNodeId: (value: string) => void;
  sharedVault: SharedVaultConfig;
};

/**
 * Brain graph inspect + pan/drag pointer handlers for the chat sidebar's vault
 * atlas. Pure handlers: no hook-local state and no React hooks, so they live
 * outside the controller hook.
 */
export function createBrainGraphHandlers(deps: BrainGraphHandlerDeps) {
  const {
    brainDragMovedRef,
    brainDragRef,
    brainGraph,
    brainPan,
    selectedAgent,
    selectedBrainNodeId,
    setBrainGraph,
    setBrainGraphStatus,
    setBrainPan,
    setSelectedBrainNodeId,
    sharedVault,
  } = deps;

  async function inspectBrainNode(node: BrainGraphNode) {
    if (brainDragMovedRef.current) {
      brainDragMovedRef.current = false;
      return;
    }
    if (selectedBrainNodeId === node.id) {
      if (node.id.startsWith("unresolved:")) {
        setBrainGraphStatus("That cell is an unresolved link, so there is no note file to open yet.");
        return;
      }
      const response = await fetch("/api/obsidian/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath: sharedVault.vaultPath, notePath: node.id, newtab: true }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      setBrainGraphStatus(data?.ok ? `Opened ${node.label} in Obsidian.` : data?.error ?? "Could not open note in Obsidian.");
      return;
    }
    setSelectedBrainNodeId(node.id);
    if (node.id.startsWith("unresolved:")) return;
    const response = await fetch("/api/obsidian/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath,
        notePath: node.id,
        agentName: selectedAgent?.name ?? "Dashboard",
        agentId: selectedAgent?.agentId || selectedAgent?.id,
        runtime: selectedAgent?.runtime,
        machineName: selectedAgent?.machineName || "local",
        action: "inspect",
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; event?: BrainAccessEvent; error?: string } | null;
    if (!data?.ok || !data.event) {
      setBrainGraphStatus(data?.error ?? "Could not record access.");
      return;
    }
    setBrainGraph((current) => {
      if (!current) return current;
      return {
        ...current,
        recentAccesses: [data.event!, ...current.recentAccesses].slice(0, 24),
        nodes: current.nodes.map((item) => item.id === node.id
          ? {
            ...item,
            accessCount: item.accessCount + 1,
            lastAccessedAt: data.event!.accessedAt,
            recentAccesses: [data.event!, ...item.recentAccesses].slice(0, 6),
          }
          : item),
      };
    });
    setBrainGraphStatus(`Recorded ${selectedAgent?.name ?? "Dashboard"} inspecting ${node.label}.`);
  }

  function startBrainPan(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    globalThis.getSelection?.()?.removeAllRanges();
    const ElementCtor = globalThis.Element;
    const target = ElementCtor && event.target instanceof ElementCtor
      ? event.target.closest("[data-brain-node-id]") as HTMLElement | null
      : null;
    const rect = event.currentTarget.getBoundingClientRect();
    const viewBox = event.currentTarget.viewBox.baseVal;
    brainDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: brainPan.x,
      panY: brainPan.y,
      scale: brainPan.scale ?? 1,
      unitX: rect.width ? viewBox.width / rect.width : 1,
      unitY: rect.height ? viewBox.height / rect.height : 1,
      moved: false,
      nodeId: target?.dataset.brainNodeId ?? "",
    };
    brainDragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveBrainPan(event: PointerEvent<SVGSVGElement>) {
    const drag = brainDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    brainDragMovedRef.current = true;
    setBrainPan({
      x: drag.panX + dx * (drag.unitX ?? 1),
      y: drag.panY + dy * (drag.unitY ?? 1),
      scale: drag.scale ?? brainPan.scale ?? 1,
    });
  }

  function endBrainPan(event: PointerEvent<SVGSVGElement>) {
    const drag = brainDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      brainDragMovedRef.current = drag.moved;
      brainDragRef.current = null;
      if (!drag.moved && drag.nodeId) {
        const node = brainGraph?.nodes.find((item) => item.id === drag.nodeId);
        if (node) void inspectBrainNode(node);
      }
      if (drag.moved) window.setTimeout(() => {
        brainDragMovedRef.current = false;
      }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return { endBrainPan, inspectBrainNode, moveBrainPan, startBrainPan };
}
