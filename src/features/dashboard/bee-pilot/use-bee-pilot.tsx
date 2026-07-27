"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import type { KanbanStatus } from "@/lib/types/kanban";
import { KANBAN_STATUSES } from "@/lib/types/kanban";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import type { MachineGroup } from "@/features/dashboard/dashboard-types";
import { isMobileMachineOs } from "@/features/fleet/fleet-identity";
import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import { dashboardRouteForView, isDashboardView } from "@/features/dashboard/dashboard-navigation";
import type { DashboardScreenContext } from "@/features/dashboard/screen-context";
import {
  localBeePilotPlan,
  planOpensModal,
  resolveProviderSlug,
  resolveRuntimeId,
  type BeePilotPlan,
  type BeePilotStep,
} from "@/features/dashboard/bee-pilot/bee-pilot-actions";

export type RunVoiceCommandOptions = { onModalOpen?: () => void; screenContext?: DashboardScreenContext };
import { BeeFlightController } from "@/features/dashboard/bee-pilot/bee-flight";
import { revealKanbanTaskWithBee } from "@/features/dashboard/bee-pilot/reveal-kanban-task";
import { beeClick, beeType, findRenderedElement, scrollElementIntoView, wait, waitForElement } from "@/features/dashboard/bee-pilot/dom-actions";

export type BeePilotDeps = {
  activeView: string;
  agents: AgentProfile[];
  machineGroups: MachineGroup[];
  kanbanTasks: Array<{ id: string; title?: string }>;
  sharedVault?: { enabled?: boolean; vaultPath?: string; kanbanFolder?: string; brainServicesFolder?: string };
  navigate: (target: DashboardRouteTarget) => void;
  openAgentCreationModal: (machine: MachineGroup, runtime?: AgentRuntime, name?: string) => void;
  openAgentSettings: (agentId: string) => void;
  setQuickAddStatus: (column: KanbanStatus | "") => void;
  setQuickAddDraft: (column: KanbanStatus, text: string) => void;
  setKanbanSearch: (query: string) => void;
  openWalletForAgent: (agentId: string) => void;
  setSchedulerDraftOpen: (open: boolean) => void;
  openSkillBrowser: () => void;
  setChatText: (text: string) => void;
  /** Opens a task's conversation modal by id; returns false when unknown. */
  openKanbanTaskConversation?: (taskId: string) => boolean;
  screenContext?: DashboardScreenContext;
};

export type BeePilotPhase = "idle" | "thinking" | "flying" | "done" | "error";

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dataBeeSelector(value: string): string {
  return `[data-bee="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function findAgent(agents: AgentProfile[], query: string | undefined): AgentProfile | null {
  if (!query) return null;
  const needle = normalizeName(query);
  if (!needle) return null;
  return (
    agents.find((agent) => normalizeName(agent.name ?? "") === needle)
    ?? agents.find((agent) => normalizeName(agent.name ?? "").includes(needle))
    ?? agents.find((agent) => needle.includes(normalizeName(agent.name ?? "")) && (agent.name ?? "").length > 2)
    ?? null
  );
}

const PHONE_MACHINE_WORDS = /(phone|iphone|ipad|tablet|mobile|android)/;
const REMOTE_MACHINE_WORDS = /(remote|other|laptop|computer|desktop|device|machine|server|vps)/;

/**
 * Machine selection rules: an explicit machine name wins; "phone"-words pick a
 * mobile device; "remote"-words pick the non-mobile remote with the fewest
 * agents; everything else (including plain "create an agent") lands on this
 * machine. Mobile devices are never a fallback - only an explicit ask.
 */
function findMachine(
  machines: MachineGroup[],
  agents: AgentProfile[],
  query: string | undefined,
): MachineGroup | null {
  const pool = machines.filter((machine) => machine.online);
  const candidates = pool.length ? pool : machines;
  const isMobile = (machine: MachineGroup) => isMobileMachineOs(machine.os);
  const needle = normalizeName(query ?? "");
  if (needle) {
    const named = candidates.find((machine) => {
      const name = normalizeName(machine.name);
      return name === needle || name.includes(needle) || (name.length > 3 && needle.includes(name));
    });
    if (named) return named;
    if (PHONE_MACHINE_WORDS.test(needle)) {
      return candidates.find(isMobile) ?? null;
    }
    if (REMOTE_MACHINE_WORDS.test(needle)) {
      const agentCount = (machine: MachineGroup) =>
        agents.filter((agent) => normalizeName(agent.machineName ?? "") === normalizeName(machine.name)).length;
      const remotes = candidates
        .filter((machine) => !machine.self && !isMobile(machine))
        .sort((a, b) => agentCount(a) - agentCount(b));
      if (remotes[0]) return remotes[0];
    }
  }
  return (
    candidates.find((machine) => machine.self && !isMobile(machine))
    ?? candidates.find((machine) => !isMobile(machine))
    ?? candidates[0]
    ?? null
  );
}

function kanbanColumnFor(value: string | undefined): KanbanStatus {
  const needle = (value ?? "").toLowerCase().trim();
  return (KANBAN_STATUSES as string[]).includes(needle) ? (needle as KanbanStatus) : "ideas";
}

async function flyToScreenCenter(bee: BeeFlightController): Promise<void> {
  await bee.flyTo(window.innerWidth / 2, window.innerHeight * 0.32);
}

/** Fuzzy-match a model hint ("gpt-4o", "70b") against the visible model pills. */
function findModelPill(hint: string): HTMLElement | null {
  const want = normalizeName(hint);
  if (!want) return null;
  const pills = Array.from(document.querySelectorAll<HTMLElement>('[data-bee="agent-model"]'));
  const scored = pills.map((pill) => {
    const id = normalizeName(pill.getAttribute("data-bee-model") ?? "");
    const text = normalizeName(pill.textContent ?? "");
    let score = 0;
    if (id === want) score = 100;
    else if (id.includes(want) || want.includes(id)) score = 60 + Math.min(want.length, id.length);
    else if (text.includes(want)) score = 40;
    return { pill, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.pill ?? null;
}

/**
 * Bee Pilot: the Queen Bee command popup's execution engine. Resolves a typed
 * command into a step plan (deterministic parser first, queen-bee LLM turn as
 * fallback) and performs each step against the live dashboard, flying the
 * honey bee cursor to every element it presses.
 */
export function useBeePilot(deps: BeePilotDeps) {
  const bee = useMemo(() => new BeeFlightController(), []);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<BeePilotPhase>("idle");
  const [status, setStatus] = useState("");
  const runIdRef = useRef(0);

  // Deep-link landing shared by "open task" flows (notifications, palette,
  // voice): fly to the task's card — scrolling the board to its column and the
  // column to the card — then open its conversation.
  const revealKanbanTask = useCallback(async (taskId: string): Promise<boolean> => {
    return revealKanbanTaskWithBee({
      bee,
      taskId,
      openConversation: () => depsRef.current.openKanbanTaskConversation?.(taskId) ?? false,
    });
  }, [bee]);

  const navigateWithBee = useCallback(async (target: DashboardRouteTarget) => {
    const current = depsRef.current;
    if (current.activeView === target.view) {
      // Already on the right screen: apply sub-targets without a pointless flight.
      current.navigate(target);
      await wait(150);
      return;
    }
    const tab = findRenderedElement(`[data-bee-nav="${target.view}"]`);
    if (tab) {
      await beeClick(bee, tab);
    } else {
      await flyToScreenCenter(bee);
    }
    current.navigate(target);
    await wait(420);
  }, [bee]);

  const runStep = useCallback(async (step: BeePilotStep): Promise<string | null> => {
    const current = depsRef.current;
    const params = step.params ?? {};
    switch (step.action) {
      case "navigate": {
        const view = isDashboardView(params.view ?? "") ? params.view : null;
        if (!view) return "I don't know that screen.";
        setStatus(`Opening ${dashboardRouteForView(view as DashboardRouteTarget["view"]).label}...`);
        await navigateWithBee({ view: view as DashboardRouteTarget["view"] });
        return null;
      }
      case "open-agent-create": {
        setStatus("Opening the new agent setup...");
        await navigateWithBee({ view: "agents" });
        const machine = findMachine(current.machineGroups, current.agents, params.machine);
        if (!machine) {
          return params.machine && PHONE_MACHINE_WORDS.test(normalizeName(params.machine))
            ? "No phone is connected to the hive right now."
            : "No machine is connected yet, so an agent can't be created.";
        }
        setStatus(`Adding an agent on ${machine.name}...`);
        // The add-agent affordance lives in the hive view; switch the fleet
        // stage there first when another view mode (graph/map/list) is active.
        const hiveToggle = await waitForElement('[data-bee="fleet-view-hive"]', 4_000);
        if (hiveToggle?.getAttribute("aria-pressed") === "false") {
          await beeClick(bee, hiveToggle);
          await wait(350);
        }
        const addButton = await waitForElement(dataBeeSelector(`fleet-hive-add-${machine.name}`), 4_000);
        const wantsName = Boolean(params.name);
        if (addButton && !wantsName) {
          // The real fleet add-cell opens the modal itself, so the click lands
          // first; runtime/provider are then picked by clicking modal tiles.
          await beeClick(bee, addButton);
        } else {
          // A custom name needs the handler to seed the draft; bounce on the
          // cell first so the modal never appears before the bee's click.
          if (addButton) {
            await scrollElementIntoView(addButton);
            await bee.flyToElement(addButton);
          } else {
            await flyToScreenCenter(bee);
          }
          await bee.bounce();
          // Pass no runtime so the modal opens on the most-recent runtime; the
          // requested runtime is then selected by clicking its tile below.
          current.openAgentCreationModal(machine, undefined, params.name ?? "");
        }
        // Pick the runtime tile when asked and it isn't already selected.
        const runtimeId = resolveRuntimeId(params.runtime);
        if (runtimeId) {
          const tile = await waitForElement(dataBeeSelector(`agent-runtime-${runtimeId}`), 5_000);
          if (tile && tile.getAttribute("aria-pressed") !== "true") {
            setStatus(`Selecting the ${runtimeId} runtime...`);
            await beeClick(bee, tile);
            await wait(300);
          }
        }
        // Pick the provider tile when asked (waits for the provider panel/models).
        const providerSlug = resolveProviderSlug(params.provider);
        if (providerSlug) {
          const tile = await waitForElement(dataBeeSelector(`agent-provider-${providerSlug}`), 6_000);
          if (!tile) {
            return `Opened the agent setup, but ${providerSlug} isn't an available provider on ${machine.name}.`;
          }
          if (tile.getAttribute("aria-pressed") !== "true") {
            setStatus(`Selecting ${providerSlug}...`);
            await beeClick(bee, tile);
          }
        }
        // Pick a specific model when asked. The model list only renders once a
        // configured provider is selected; providers that still need setup
        // (e.g. an unconfigured UsePod/Venice) show their setup panel instead
        // and expose no model pills. In that case leave the provider selected
        // and skip the model quietly - there is nothing to pick yet.
        if (params.model) {
          const modelListReady = await waitForElement('[data-bee="agent-model"]', 4_000);
          if (modelListReady) {
            const pill = findModelPill(params.model);
            if (pill) {
              if (pill.getAttribute("aria-selected") !== "true") {
                setStatus(`Selecting the ${params.model} model...`);
                await beeClick(bee, pill);
              }
            } else {
              return `Set up the agent, but I couldn't find a "${params.model}" model for that provider.`;
            }
          } else if (providerSlug) {
            return `Selected ${providerSlug} - finish setting it up to choose the ${params.model} model.`;
          }
        }
        return null;
      }
      case "open-agent-settings": {
        const agent = findAgent(current.agents, params.agent);
        if (!agent) return `I couldn't find an agent matching "${params.agent ?? ""}".`;
        setStatus(`Opening settings for ${agent.name}...`);
        await flyToScreenCenter(bee);
        await bee.bounce();
        current.openAgentSettings(agent.id);
        return null;
      }
      case "chat-with-agent": {
        const agent = findAgent(current.agents, params.agent);
        if (!agent) return `I couldn't find an agent matching "${params.agent ?? ""}".`;
        setStatus(`Opening a chat with ${agent.name}...`);
        await navigateWithBee({ view: "chat", agentId: agent.id });
        if (params.message) {
          const composers = Array.from(document.querySelectorAll<HTMLElement>("[data-bee-composer]"));
          const composer = composers[composers.length - 1] ?? null;
          setStatus(`Typing a message to ${agent.name}...`);
          await beeType(bee, composer, params.message, current.setChatText);
          if (params.send === "true") {
            const send = await waitForElement('[data-bee-send][aria-label="Send"]', 2_000);
            if (send) {
              if (!(await confirmUserAction(`Bee Pilot is ready to send this message to ${agent.name}.\n\nAllow this one action?`))) {
                return "The message is drafted, but it was not sent.";
              }
              setStatus(`Sending the message to ${agent.name}...`);
              await beeClick(bee, send);
            }
          }
        }
        return null;
      }
      case "create-wallet":
      case "open-wallet": {
        const agent = findAgent(current.agents, params.agent);
        if (step.action === "create-wallet" && !agent) {
          return `I couldn't find an agent matching "${params.agent ?? ""}".`;
        }
        setStatus(agent ? `Opening wallets for ${agent.name}...` : "Opening your wallets...");
        await navigateWithBee({ view: "wallet" });
        if (!agent) return null;
        const walletCardSelector = dataBeeSelector(`wallet-agent-${agent.id}`);
        const card = await waitForElement(`${walletCardSelector}[data-bee-wallet-action="open"], ${walletCardSelector}`, 6_000);
        if (!card) return `${agent.name} has no wallet card on the wallets screen yet.`;
        setStatus(`Opening ${agent.name}'s wallet card...`);
        if (card.getAttribute("data-bee-wallet-action") === "open") {
          await beeClick(bee, card);
        } else {
          await scrollElementIntoView(card);
          await bee.flyToElement(card);
          if (step.action === "open-wallet") await bee.bounce();
        }
        if (step.action === "open-wallet") {
          current.openWalletForAgent(agent.id);
          return null;
        }
        await wait(380);
        const confirm = await waitForElement(dataBeeSelector(`wallet-create-${agent.id}`), 2_000);
        if (!confirm) return `${agent.name} already has a wallet, so I opened it instead.`;
        if (!(await confirmUserAction(`Bee Pilot is ready to create a wallet for ${agent.name}.\n\nAllow this one action?`))) {
          return "The wallet card is open, but no wallet was created.";
        }
        setStatus(`Confirming ${agent.name}'s new wallet...`);
        await beeClick(bee, confirm);
        return null;
      }
      case "add-kanban-task": {
        const text = params.text?.trim();
        if (!text) return "There was no task text to add.";
        const column = kanbanColumnFor(params.column);
        setStatus("Opening the work board...");
        await navigateWithBee({ view: "kanban" });
        let form = document.querySelector<HTMLElement>(`[data-bee="kanban-quick-add-${column}"]`);
        if (!form) {
          const addButton = await waitForElement(`[data-bee="kanban-add-${column}"]`, 6_000);
          if (addButton) {
            setStatus("Opening the quick-add input...");
            await beeClick(bee, addButton);
          } else {
            current.setQuickAddStatus(column);
          }
          form = await waitForElement(`[data-bee="kanban-quick-add-${column}"]`, 4_000);
        }
        if (!form) return "The kanban quick-add input didn't open.";
        const field = form.querySelector<HTMLElement>("[data-bee-composer]");
        setStatus("Typing the task...");
        await beeType(bee, field, text, (value) => current.setQuickAddDraft(column, value));
        const send = form.querySelector<HTMLElement>("[data-bee-send]");
        if (!send) return "I typed the task but couldn't find the add button.";
        setStatus("Adding the task...");
        await beeClick(bee, send);
        return null;
      }
      case "search-kanban": {
        setStatus(`Searching the board for "${params.query ?? ""}"...`);
        await navigateWithBee({ view: "kanban" });
        current.setKanbanSearch(params.query ?? "");
        return null;
      }
      case "open-kanban-task": {
        const needle = normalizeName(params.task ?? "");
        const task = current.kanbanTasks.find((item) => normalizeName(item.title ?? "").includes(needle));
        if (!task) return `I couldn't find a task matching "${params.task ?? ""}".`;
        setStatus(`Opening "${task.title ?? task.id}"...`);
        await navigateWithBee({ view: "kanban", taskId: task.id });
        await revealKanbanTask(task.id);
        return null;
      }
      case "create-schedule": {
        setStatus("Opening a new schedule...");
        await navigateWithBee({ view: "scheduler" });
        await flyToScreenCenter(bee);
        await bee.bounce();
        current.setSchedulerDraftOpen(true);
        return null;
      }
      case "open-skill-browser": {
        setStatus("Opening the skill browser...");
        await flyToScreenCenter(bee);
        await bee.bounce();
        current.openSkillBrowser();
        return null;
      }
      case "queen-task": {
        const message = params.message?.trim() || params.title?.trim();
        if (!message) return "There was no work request to delegate.";
        if (!(await confirmUserAction(`Bee Pilot is ready to delegate “${params.title || message}” to the hive.\n\nAllow this one action?`))) {
          return "The work request was not delegated.";
        }
        setStatus("Delegating to the hive...");
        await flyToScreenCenter(bee);
        await bee.bounce();
        const vault = current.sharedVault?.enabled ? current.sharedVault : undefined;
        const response = await fetch("/api/queen-bee", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            taskTitle: params.title || undefined,
            source: "bee-pilot",
            mode: "act",
            vaultPath: vault?.vaultPath,
            kanbanFolder: vault?.kanbanFolder,
            brainServicesFolder: vault?.brainServicesFolder,
          }),
        });
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          receipt?: { summary?: string };
        } | null;
        if (!data?.ok) return data?.error ?? "The hive didn't accept the request.";
        return data.receipt?.summary ?? null;
      }
      default:
        return "That action isn't supported yet.";
    }
  }, [bee, navigateWithBee, revealKanbanTask]);

  const resolvePlan = useCallback(async (
    command: string,
    screenContextOverride?: DashboardScreenContext,
  ): Promise<BeePilotPlan> => {
    const current = depsRef.current;
    const context = {
      agentNames: current.agents.map((agent) => agent.name ?? "").filter(Boolean),
      machineNames: current.machineGroups.map((machine) => machine.name).filter(Boolean),
      kanbanColumns: [...KANBAN_STATUSES],
      activeView: current.activeView,
      screenContext: screenContextOverride ?? current.screenContext,
    };
    const local = localBeePilotPlan(command, context);
    if (local) return local;
    const response = await fetch("/api/queen-bee/pilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command,
        context,
        vaultPath: current.sharedVault?.enabled ? current.sharedVault.vaultPath : undefined,
      }),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; plan?: BeePilotPlan } | null;
    if (!data?.ok || !data.plan) throw new Error(data?.error ?? "Queen Bee couldn't read that command.");
    return data.plan;
  }, []);

  // After a run settles, hide the bee and let the status reset to idle unless a
  // newer run has taken over.
  const scheduleCleanup = useCallback((runId: number, hideBee: boolean) => {
    if (hideBee) window.setTimeout(() => bee.hide(), 700);
    window.setTimeout(() => {
      if (runIdRef.current === runId) setPhase((value) => (value === "flying" || value === "thinking" ? value : "idle"));
    }, 5_000);
  }, [bee]);

  // Fly the bee through a resolved plan's steps. Shared by the typed palette
  // and the voice path; returns the final spoken-ready note.
  const executePlan = useCallback(async (
    plan: BeePilotPlan,
    origin: { x: number; y: number } | undefined,
    runId: number,
  ): Promise<string> => {
    setPhase("flying");
    setStatus(plan.reply);
    bee.showAt(origin?.x ?? window.innerWidth / 2, origin?.y ?? Math.min(220, window.innerHeight * 0.25));
    try {
      let note: string | null = null;
      for (const step of plan.steps) {
        if (runIdRef.current !== runId) return note ?? plan.reply;
        note = await runStep(step);
        if (note) break;
        await wait(180);
      }
      if (runIdRef.current !== runId) return note ?? plan.reply;
      const finalNote = note ?? plan.reply;
      setStatus(finalNote);
      setPhase("done");
      return finalNote;
    } catch (error) {
      const message = error instanceof Error ? error.message : "That command didn't work.";
      if (runIdRef.current === runId) {
        setStatus(message);
        setPhase("error");
      }
      return message;
    } finally {
      if (runIdRef.current === runId) scheduleCleanup(runId, true);
    }
  }, [bee, runStep, scheduleCleanup]);

  const runCommand = useCallback(async (command: string, origin?: { x: number; y: number }) => {
    const trimmed = command.trim();
    if (!trimmed || phase === "thinking" || phase === "flying") return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    // Keep the command palette open and show a thinking state inside it while
    // Queen Bee resolves the plan; only close it once automation begins.
    setPhase("thinking");
    setStatus("");
    let plan: BeePilotPlan;
    try {
      plan = await resolvePlan(trimmed);
    } catch (error) {
      if (runIdRef.current !== runId) return;
      setStatus(error instanceof Error ? error.message : "That command didn't work.");
      setPhase("error");
      scheduleCleanup(runId, false);
      return;
    }
    if (runIdRef.current !== runId) return;
    if (!plan.steps.length) {
      // Nothing to drive: keep the palette open and answer inline.
      setStatus(plan.reply);
      setPhase("error");
      scheduleCleanup(runId, false);
      return;
    }
    // Plan ready: close the palette and begin the automation.
    setInput("");
    setOpen(false);
    await executePlan(plan, origin, runId);
  }, [phase, resolvePlan, executePlan, scheduleCleanup]);

  /**
   * Voice entry point: resolves the plan, returns the spoken-ready reply right
   * away (so Queen Bee can confirm), and flies the automation in the
   * background. The palette is never opened.
   */
  const runVoiceCommand = useCallback(async (command: string, opts?: RunVoiceCommandOptions): Promise<string> => {
    const trimmed = command.trim();
    if (!trimmed) return "I didn't catch an on-screen command.";
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setOpen(false);
    setPhase("thinking");
    setStatus("");
    let plan: BeePilotPlan;
    try {
      plan = await resolvePlan(trimmed, opts?.screenContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : "I couldn't read that on-screen command.";
      if (runIdRef.current === runId) {
        setStatus(message);
        setPhase("error");
        scheduleCleanup(runId, false);
      }
      return message;
    }
    if (runIdRef.current !== runId) return "";
    if (!plan.steps.length) {
      setStatus(plan.reply);
      setPhase("error");
      scheduleCleanup(runId, false);
      return plan.reply;
    }
    // Only step out of the way when this plan actually opens a modal; plain
    // navigation keeps the chat history visible.
    if (planOpensModal(plan)) opts?.onModalOpen?.();
    // Speak the confirmation now; let the bee fly the UI in the background.
    void executePlan(plan, undefined, runId);
    return plan.reply;
  }, [resolvePlan, executePlan, scheduleCleanup]);

  const dismissStatus = useCallback(() => {
    setPhase("idle");
    setStatus("");
  }, []);

  return { bee, open, setOpen, input, setInput, phase, status, runCommand, runVoiceCommand, dismissStatus, revealKanbanTask };
}
