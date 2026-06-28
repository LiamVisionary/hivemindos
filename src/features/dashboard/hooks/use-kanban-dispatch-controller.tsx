// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useEffect, useRef } from "react";
import {
  parseRuntimeSsePayload,
  responseErrorMessage,
  runtimeErrorMessage,
} from "./runtime-stream-errors";

export function useKanbanDispatchController(props: any) {
  const {
    AbortController,
    KANBAN_COLUMNS,
    KANBAN_DISPATCH_NO_PROGRESS_MS,
    KANBAN_NO_ASSISTANT_QUIET_MS,
    KANBAN_NO_ASSISTANT_STALL_MS,
    KANBAN_SESSION_POLL_FAILURE_LIMIT,
    KANBAN_STALE_AGENT_COOLDOWN_MS,
    KANBAN_TOOL_OUTPUT_STALL_MS,
    addKanbanSystemComment,
    appVersion,
    appendMessage,
    attachmentSizeLabel,
    attachmentSummary,
    chatSetupIssue,
    commentDraft,
    compactDiagnosticPreview,
    createDefaultAgentWallet,
    displayAgents,
    extractKanbanVisualBrief,
    formatDurationShort,
    honeyLedgerEnabled,
    hydrated,
    isHermesAuthFailure,
    isInternalHermesSessionPrelude,
    isKanbanAwaitingAgentUpdate,
    isKanbanStaleWorkingTask,
    isTransientDelegationMessage,
    kanbanBoard,
    kanbanBoardSlug,
    kanbanDispatchCooldownRef,
    kanbanNoAssistantStalledDetail,
    kanbanReadyPickupAttemptRef,
    kanbanReadyPickupInFlightRef,
    kanbanReadyPickupSignature,
    kanbanRuntimeAbortRef,
    kanbanSessionPollFailureRef,
    kanbanSessionPollRef,
    kanbanStaleAge,
    kanbanStaleRequeueAttemptRef,
    kanbanSteerAttachments,
    kanbanSteerDirectories,
    kanbanSteerDraft,
    kanbanSteerTargetStatus,
    kanbanSteeringTaskId,
    kanbanStorageBody,
    kanbanTaskAssigneeAgent,
    kanbanTaskAssignmentForAgent,
    kanbanTaskDispatchPrompt,
    kanbanToolOutputStalledDetail,
    kanbanWorkspaceChangeSummary,
    logClientTelemetry,
    messageContentParts,
    messagesByAgent,
    orchestrateReadyKanbanTask,
    patchKanbanTask,
    raiseHermesAuthAlert,
    readWorkspaceGitSnapshot,
    refreshHoneyLedger,
    refreshKanbanOnce,
    selectedKanbanAgent,
    selectedKanbanTask,
    setCommentDraft,
    setKanbanError,
    setKanbanSteerAttachmentError,
    setKanbanSteerAttachmentMenuOpen,
    setKanbanSteerAttachments,
    setKanbanSteerDirectories,
    setKanbanSteerDraft,
    setKanbanSteeringTaskId,
    setMessagesByAgent,
    sharedVault,
    simpleStableHash,
    summarizeKanbanToolOutput,
    updateTask,
    upsertTask,
    walletsByAgent,
  } = props;
  const kanbanSessionPollInFlightRef = useRef(new Set<string>());
  async function createKanbanArtistHandoffTask(
    parentTask: KanbanTask,
    sourceAgent: AgentProfile,
    result: string,
  ) {
    const visualBrief = extractKanbanVisualBrief(result);
    if (!visualBrief) return null;
    const idempotencyKey = `handoff:visual:${parentTask.id}:${simpleStableHash(visualBrief)}`;
    const response = await fetch(
      `/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          title: `Generate image for: ${parentTask.title}`,
          body: [
            `Source task: ${parentTask.title}`,
            `Source agent: ${sourceAgent.name}`,
            "Create the image or image asset that best fits this handoff brief. Use image-generation/art tools when available. If raster generation is unavailable, create the best concrete visual asset your runtime can produce and report the exact file path.",
            `VISUAL_BRIEF: ${visualBrief}`,
            parentTask.result || result
              ? `Source result:\n${(parentTask.result || result).slice(0, 4000)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          status: "ready",
          priority: parentTask.priority,
          tenant: "",
          assignee: "",
          skills: [
            "image generation",
            "art direction",
            "visual asset",
            "handoff",
          ],
          parents: [parentTask.id],
          idempotencyKey,
        }),
      },
    );
    const data = (await response
      .json()
      .catch(() => null)) as KanbanResponse | null;
    if (!response.ok || !data?.ok || !data.task) {
      const message = data?.error ?? "Could not create artist handoff task.";
      setKanbanError(message);
      await addKanbanSystemComment(
        parentTask.id,
        `Could not create automatic artist handoff: ${message}`,
      );
      return null;
    }
    await addKanbanSystemComment(
      parentTask.id,
      data.created === false
        ? `Artist handoff already exists for ${sourceAgent.name}'s visual brief.`
        : `Created artist handoff task "${data.task.title}" from ${sourceAgent.name}'s visual brief.`,
    );
    return data.task;
  }

  async function requeueStaleKanbanTask(
    task: KanbanTask,
    mode: "auto" | "manual" = "manual",
  ) {
    const staleAgent =
      kanbanTaskAssigneeAgent(task, displayAgents) ??
      displayAgents.find(
        (agent) =>
          agent.id === task.agentSession?.agentId ||
          agent.name === task.agentSession?.agentName,
      );
    if (staleAgent) {
      kanbanDispatchCooldownRef.current.set(
        staleAgent.id,
        Date.now() + KANBAN_STALE_AGENT_COOLDOWN_MS,
      );
    }
    kanbanReadyPickupAttemptRef.current.delete(task.id);
    kanbanReadyPickupAttemptRef.current.delete(
      `working:${kanbanReadyPickupSignature(task, displayAgents)}`,
    );
    kanbanSessionPollRef.current.delete(task.id);
    const staleFor = formatDurationShort(kanbanStaleAge(task));
    await patchKanbanTask(task.id, {
      status: "ready",
      assignee: "",
      tenant: "",
      agentSession: null,
      result: `${mode === "auto" ? "Auto-requeued" : "Requeued"} after ${staleFor} without a worker update. Previous worker: ${task.assignee || task.agentSession?.agentName || "unknown"}.`,
    });
    await addKanbanSystemComment(
      task.id,
      `${mode === "auto" ? "Auto-requeued" : "Requeued"} stale Working task after ${staleFor} without a dashboard-visible worker update.`,
    );
  }

  // Asks the collector on the agent's machine to sign a work receipt (per-agent
  // DID over the workspace git state). Fire-and-forget: a missing receipt never
  // blocks task completion, it just leaves the task without a verified proof.
  function requestWorkReceipt(task: KanbanTask, agent: AgentProfile) {
    void fetch("/api/work-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectorUrl: agent.telemetryUrl,
        agentId: agent.agentId || agent.id,
        agentName: agent.name,
        taskId: task.id,
        taskTitle: task.title,
        board: kanbanBoardSlug,
        repoPath: appVersion?.appDir,
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
        } | null;
        logClientTelemetry("kanban.work_receipt", {
          taskId: task.id,
          agentId: agent.id,
          ok: Boolean(data?.ok),
          error: data?.ok ? undefined : data?.error,
        });
      })
      .catch(() => undefined);
  }

  async function readCurrentKanbanDispatchTask(taskId: string) {
    try {
      const url = new URL(
        `/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`,
        window.location.origin,
      );
      url.searchParams.set("include_archived", "true");
      url.searchParams.set("q", taskId);
      const storage = kanbanStorageBody();
      for (const [key, value] of Object.entries(storage)) {
        if (value !== undefined && value !== null && String(value).trim()) {
          url.searchParams.set(key, String(value));
        }
      }
      const response = await fetch(url.toString(), { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as KanbanResponse | null;
      if (!response.ok || !data?.ok) return null;
      return data.board?.tasks?.find((item: KanbanTask) => item.id === taskId) ?? null;
    } catch {
      return null;
    }
  }

  function kanbanDispatchFailureStillOwnsTask(task: KanbanTask, agent: AgentProfile) {
    if (task.status !== "working") return false;
    if (String(task.claimLock || "").startsWith("queen-bee-autonomous:")) return false;
    const agentKeys = new Set(
      [agent.id, agent.agentId, agent.name].filter(Boolean).map((value) => String(value)),
    );
    return (
      agentKeys.has(String(task.assignee || ""))
      || agentKeys.has(String(task.agentSession?.agentId || ""))
      || agentKeys.has(String(task.agentSession?.agentName || ""))
    );
  }

  async function markKanbanTaskNeedsHumanFromDashboardDispatch(
    task: KanbanTask,
    agent: AgentProfile,
    patch: KanbanTaskPatch,
    reason: string,
  ) {
    const current = await readCurrentKanbanDispatchTask(task.id);
    if (!current || !kanbanDispatchFailureStillOwnsTask(current, agent)) {
      logClientTelemetry("kanban.dispatch.needs_human_skipped_stale_owner", {
        taskId: task.id,
        agentId: agent.id,
        agentName: agent.name,
        reason,
        currentStatus: current?.status ?? null,
        currentAssignee: current?.assignee ?? null,
        currentClaimLock: current?.claimLock ?? null,
      });
      await refreshKanbanOnce().catch(() => undefined);
      return false;
    }
    await patchKanbanTask(task.id, {
      ...patch,
      status: "needs-human",
      agentSession: null,
    });
    return true;
  }

  async function dispatchKanbanTaskToAgent(
    task: KanbanTask,
    agent: AgentProfile,
    assignment: ReturnType<typeof chooseBeeAssignment>,
    options: { leaveKanbanOpen?: boolean } = {},
  ): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
    const prompt = kanbanTaskDispatchPrompt(task, assignment);
    const localTaskId = `kanban-${task.id}-${Date.now()}`;
    let fullText = "";
    let sawAgentSession = false;
    const workspaceBefore = await readWorkspaceGitSnapshot();
    let lastAgentSession: NonNullable<KanbanTask["agentSession"]> | null = null;
    logClientTelemetry("kanban.dispatch.start", {
      taskId: task.id,
      agentId: agent.id,
      agentName: agent.name,
      assignmentMode: assignment.mode,
      workerClass: assignment.workerClass,
      promptLength: prompt.length,
    });
    kanbanRuntimeAbortRef.current.get(task.id)?.abort();
    const controller = new AbortController();
    let noProgressTimedOut = false;
    const noProgressTimer = window.setTimeout(() => {
      if (fullText.trim() || sawAgentSession) return;
      noProgressTimedOut = true;
      controller.abort();
    }, KANBAN_DISPATCH_NO_PROGRESS_MS);
    kanbanRuntimeAbortRef.current.set(task.id, controller);

    upsertTask({
      id: localTaskId,
      agentId: agent.id,
      title: task.title,
      lastMessage: "Delegated from Work board...",
      status: "active",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      source: "kanban",
    });
    appendMessage(agent.id, {
      role: "user",
      content: prompt,
      kanbanTaskId: task.id,
      surface: "kanban",
    });
    appendMessage(agent.id, {
      role: "assistant",
      content: "",
      kanbanTaskId: task.id,
      surface: "kanban",
    });

    try {
      const response = await fetch("/api/chat/agent-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          sharedVault,
          workingDirectory: appVersion?.appDir,
          wallet:
            walletsByAgent[agent.id] ?? createDefaultAgentWallet(agent.id),
          honeyLedgerEnabled,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          await responseErrorMessage(
            response,
            `Request failed with ${response.status}`,
          ),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventText of events) {
          const line = eventText
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          const parsed = parseRuntimeSsePayload(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: unknown;
            honey?: unknown;
            session?: {
              id?: string;
              runtime?: string;
              source?: string;
              startedAt?: number;
              updatedAt?: number;
              messageCount?: number;
            };
          };
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            await refreshHoneyLedger();
            continue;
          }
          if (parsed.session?.id) {
            sawAgentSession = true;
            window.clearTimeout(noProgressTimer);
            lastAgentSession = {
              agentId: agent.id,
              agentName: agent.name,
              runtime: parsed.session.runtime ?? agent.runtime,
              telemetryUrl: agent.telemetryUrl,
              sessionId: parsed.session.id,
              source: parsed.session.source,
              startedAt: parsed.session.startedAt ?? Date.now(),
              updatedAt: parsed.session.updatedAt ?? Date.now(),
              lastMessageCount: parsed.session.messageCount ?? 0,
            };
            logClientTelemetry("kanban.dispatch.session", {
              taskId: task.id,
              agentId: agent.id,
              sessionId: parsed.session.id,
              messageCount: parsed.session.messageCount ?? 0,
            });
            await patchKanbanTask(task.id, {
              agentSession: lastAgentSession,
              result: `${agent.name} accepted the task. Waiting for agent update.`,
            });
            continue;
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (!chunk) continue;
          fullText += chunk;
          window.clearTimeout(noProgressTimer);
          setMessagesByAgent((current) => {
            const existing = current[agent.id] ?? [];
            const next = [...existing];
            const last = next[next.length - 1] ?? {
              role: "assistant" as const,
              content: "",
              kanbanTaskId: task.id,
            };
            if (next.length === 0) next.push(last);
            next[next.length - 1] = {
              ...last,
              content: fullText,
              kanbanTaskId: task.id,
            };
            return { ...current, [agent.id]: next };
          });
          updateTask(localTaskId, { lastMessage: fullText });
        }
      }

      if (!fullText.trim() && sawAgentSession) {
        if (lastAgentSession) {
          const finalSessionResponse = await fetch("/api/chat/agent-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent,
              sessionId: lastAgentSession.sessionId,
            }),
          }).catch(() => null);
          const finalSessionData = (await finalSessionResponse
            ?.json()
            .catch(() => null)) as AgentSessionResponse | null;
          const finalMessages =
            finalSessionData?.session?.messages?.filter(
              (message) =>
                message.content.trim() &&
                !isInternalHermesSessionPrelude(message.content),
            ) ?? [];
          const finalAssistant = [...finalMessages]
            .reverse()
            .find(
              (message) =>
                message.role === "assistant" && message.content.trim(),
            );
          const finalRaw = [...finalMessages]
            .reverse()
            .find((message) => message.content.trim());
          if (finalAssistant) {
            const result = finalAssistant.content.trim();
            logClientTelemetry("kanban.dispatch.completed_from_session", {
              taskId: task.id,
              agentId: agent.id,
              sessionId: lastAgentSession.sessionId,
              resultLength: result.length,
            });
            updateTask(localTaskId, {
              status: "completed",
              lastMessage: result,
              completedAt: Date.now(),
            });
            await createKanbanArtistHandoffTask(task, agent, result);
            requestWorkReceipt(task, agent);
            await patchKanbanTask(task.id, {
              status: "done",
              agentSession: null,
              result,
            });
            await addKanbanSystemComment(
              task.id,
              `${agent.name} completed the delegated work from the Work board.`,
            );
            return { ok: true, message: result };
          }
          if (finalRaw) {
            logClientTelemetry("kanban.dispatch.awaiting_session_assistant", {
              taskId: task.id,
              agentId: agent.id,
              sessionId: lastAgentSession.sessionId,
              latestCount: finalMessages.length,
              latestRole: finalRaw.role,
              latestContentLength: finalRaw.content.length,
              latestToolSummary:
                finalRaw.role === "tool"
                  ? summarizeKanbanToolOutput(finalRaw.content)
                  : "",
            });
          }
        }
        const message = `${agent.name} accepted the delegated work. Waiting for agent update.`;
        logClientTelemetry("kanban.dispatch.awaiting_agent_update", {
          taskId: task.id,
          agentId: agent.id,
          sawAgentSession,
        });
        updateTask(localTaskId, { status: "active", lastMessage: message });
        await patchKanbanTask(task.id, {
          status: "working",
          assignee: agent.name,
          tenant:
            assignment.mode === "queen"
              ? "queen-bee"
              : `${assignment.workerClass}-worker`,
          result: message,
        });
        return { ok: true, message };
      }

      if (!fullText.trim()) {
        const workspaceAfter = await readWorkspaceGitSnapshot();
        const workspaceSummary = kanbanWorkspaceChangeSummary(
          workspaceBefore,
          workspaceAfter,
        );
        if (workspaceSummary) {
          logClientTelemetry("kanban.dispatch.completed_from_workspace", {
            taskId: task.id,
            agentId: agent.id,
            changedFiles: workspaceAfter?.statusLines.length ?? 0,
          });
          updateTask(localTaskId, {
            status: "completed",
            lastMessage: workspaceSummary,
            completedAt: Date.now(),
          });
          requestWorkReceipt(task, agent);
          await patchKanbanTask(task.id, {
            status: "done",
            agentSession: null,
            result: workspaceSummary,
          });
          await addKanbanSystemComment(
            task.id,
            `${agent.name} completed delegated work with workspace changes.`,
          );
          return { ok: true, message: workspaceSummary };
        }
        logClientTelemetry("kanban.dispatch.empty_without_session", {
          taskId: task.id,
          agentId: agent.id,
          sawAgentSession,
        });
        throw new Error(
          `${agent.name} returned no task output and no pollable session. Check the agent runtime/auth before retrying.`,
        );
      }

      const result =
        fullText.trim() || `${agent.name} accepted the delegated work.`;
      logClientTelemetry("kanban.dispatch.completed", {
        taskId: task.id,
        agentId: agent.id,
        resultLength: result.length,
      });
      updateTask(localTaskId, {
        status: "completed",
        lastMessage: result,
        completedAt: Date.now(),
      });
      await createKanbanArtistHandoffTask(task, agent, result);
      requestWorkReceipt(task, agent);
      await patchKanbanTask(task.id, { status: "done", result });
      await addKanbanSystemComment(
        task.id,
        `${agent.name} completed the delegated work from the Work board.`,
      );
      return { ok: true, message: result };
    } catch (error) {
      if (controller.signal.aborted) {
        if (noProgressTimedOut) {
          const workspaceAfter = await readWorkspaceGitSnapshot();
          const workspaceSummary = kanbanWorkspaceChangeSummary(
            workspaceBefore,
            workspaceAfter,
          );
          if (workspaceSummary) {
            logClientTelemetry(
              "kanban.dispatch.no_progress_workspace_completed",
              {
                taskId: task.id,
                agentId: agent.id,
                timeoutMs: KANBAN_DISPATCH_NO_PROGRESS_MS,
                changedFiles: workspaceAfter?.statusLines.length ?? 0,
              },
            );
            updateTask(localTaskId, {
              status: "completed",
              lastMessage: workspaceSummary,
              completedAt: Date.now(),
            });
            requestWorkReceipt(task, agent);
            await patchKanbanTask(task.id, {
              status: "done",
              agentSession: null,
              result: workspaceSummary,
            });
            await addKanbanSystemComment(
              task.id,
              `${agent.name} completed delegated work with workspace changes.`,
            );
            return { ok: true, message: workspaceSummary };
          }
          const message = `${agent.name} accepted the runtime connection, but did not produce output or attach a fresh pollable session within ${Math.round(KANBAN_DISPATCH_NO_PROGRESS_MS / 1000)}s. Requeued for Queen Bee pickup so another worker can retry without human intervention.`;
          logClientTelemetry("kanban.dispatch.no_progress_timeout", {
            taskId: task.id,
            agentId: agent.id,
            timeoutMs: KANBAN_DISPATCH_NO_PROGRESS_MS,
          });
          kanbanDispatchCooldownRef.current.set(
            agent.id,
            Date.now() + 10 * 60 * 1000,
          );
          updateTask(localTaskId, {
            status: "failed",
            lastMessage: message,
            completedAt: Date.now(),
          });
          await patchKanbanTask(task.id, {
            status: "ready",
            assignee: "",
            tenant: "",
            agentSession: null,
            result: message,
          });
          await addKanbanSystemComment(task.id, message);
          return { ok: true, message };
        }
        updateTask(localTaskId, {
          status: "completed",
          lastMessage: "Interrupted by a newer task instruction.",
          completedAt: Date.now(),
        });
        return {
          ok: true,
          message: "Interrupted by a newer task instruction.",
        };
      }
      const message =
        error instanceof Error ? error.message : "Unknown runtime error";
      kanbanDispatchCooldownRef.current.set(
        agent.id,
        Date.now() + 10 * 60 * 1000,
      );
      const transientDelegation = isTransientDelegationMessage(message);
      logClientTelemetry("kanban.dispatch.error", {
        taskId: task.id,
        agentId: agent.id,
        transientDelegation,
        message,
      });
      if (isHermesAuthFailure(message)) {
        await raiseHermesAuthAlert(agent, task, message).catch(() => undefined);
      }
      setMessagesByAgent((current) => {
        const existing = current[agent.id] ?? [];
        const next = [...existing];
        const last = next[next.length - 1] ?? {
          role: "assistant" as const,
          content: "",
          kanbanTaskId: task.id,
        };
        if (next.length === 0) next.push(last);
        next[next.length - 1] = {
          ...last,
          content: transientDelegation
            ? `Waiting for update: ${message}`
            : `Error: ${message}`,
          kanbanTaskId: task.id,
        };
        return { ...current, [agent.id]: next };
      });
      updateTask(localTaskId, {
        status: transientDelegation ? "active" : "failed",
        lastMessage: message,
        ...(transientDelegation ? {} : { completedAt: Date.now() }),
      });
      if (transientDelegation) {
        if (!isKanbanAwaitingAgentUpdate(task)) {
          const waitingMessage = `${agent.name} accepted the runtime connection and may still be working. Waiting for telemetry or agent output after the dashboard timeout.`;
          await patchKanbanTask(task.id, {
            status: "working",
            assignee: agent.name,
            tenant:
              assignment.mode === "queen"
                ? "queen-bee"
                : `${assignment.workerClass}-worker`,
            result: waitingMessage,
          });
        }
        return { ok: true, message };
      }
      if (options.leaveKanbanOpen) {
        return { ok: false, message };
      }
      const result = task.targetMachine?.key
        ? `Delegation failed for ${agent.name} on ${task.targetMachine.name}: ${message}`
        : `Delegation failed for ${agent.name}: ${message}`;
      const marked = await markKanbanTaskNeedsHumanFromDashboardDispatch(
        task,
        agent,
        { result },
        "dispatch-error",
      );
      if (marked) {
        await addKanbanSystemComment(task.id, result);
      }
      return { ok: false, message };
    } finally {
      window.clearTimeout(noProgressTimer);
      if (kanbanRuntimeAbortRef.current.get(task.id) === controller) {
        kanbanRuntimeAbortRef.current.delete(task.id);
      }
    }
  }

  useEffect(() => {
    if (!hydrated || !kanbanBoard) return;
    const timer = window.setTimeout(() => {
      const readyTasks = kanbanBoard.tasks.filter(
        (task) => task.status === "ready",
      );
      for (const task of readyTasks) {
        if (kanbanReadyPickupInFlightRef.current.has(task.id)) continue;
        const signature = kanbanReadyPickupSignature(task, displayAgents);
        if (kanbanReadyPickupAttemptRef.current.get(task.id) === signature)
          continue;
        kanbanReadyPickupAttemptRef.current.set(task.id, signature);
        kanbanReadyPickupInFlightRef.current.add(task.id);
        void orchestrateReadyKanbanTask(task).finally(() => {
          kanbanReadyPickupInFlightRef.current.delete(task.id);
        });
      }

      const retryableWorkingTasks = kanbanBoard.tasks.filter(
        (task) =>
          task.status === "working" &&
          task.assignee?.trim() &&
          !isKanbanAwaitingAgentUpdate(task),
      );
      for (const task of retryableWorkingTasks) {
        if (kanbanReadyPickupInFlightRef.current.has(task.id)) continue;
        const assignee = kanbanTaskAssigneeAgent(task, displayAgents);
        if (!assignee) continue;
        const signature = `working:${kanbanReadyPickupSignature(task, displayAgents)}`;
        if (kanbanReadyPickupAttemptRef.current.get(task.id) === signature)
          continue;
        kanbanReadyPickupAttemptRef.current.set(task.id, signature);
        kanbanReadyPickupInFlightRef.current.add(task.id);
        void dispatchKanbanTaskToAgent(
          task,
          assignee,
          kanbanTaskAssignmentForAgent(task, assignee),
        ).finally(() => {
          kanbanReadyPickupInFlightRef.current.delete(task.id);
        });
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // `orchestrateReadyKanbanTask` intentionally stays out of this dependency list:
    // the pickup signature gates retries, while the function itself changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgents, hydrated, kanbanBoard]);

  async function addKanbanComment(event: FormEvent) {
    event.preventDefault();
    if (!selectedKanbanTask || !commentDraft.trim()) return;
    const response = await fetch(
      `/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          action: "comment",
          taskId: selectedKanbanTask.id,
          body: commentDraft,
          author: "dashboard",
        }),
      },
    );
    const data = (await response
      .json()
      .catch(() => null)) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not add comment.");
      return;
    }
    setCommentDraft("");
    await refreshKanbanOnce().catch((error) =>
      setKanbanError(
        error instanceof Error ? error.message : "Kanban refresh failed.",
      ),
    );
  }

  async function refreshKanbanAgentSession(task: KanbanTask) {
    const session = task.agentSession;
    if (!session?.sessionId) return;
    const inFlightKey = `${task.id}:${session.sessionId}`;
    if (kanbanSessionPollInFlightRef.current.has(inFlightKey)) return;
    kanbanSessionPollInFlightRef.current.add(inFlightKey);
    try {
      const agent = displayAgents.find(
        (item) =>
          item.id === session.agentId ||
          item.name === session.agentName ||
          item.telemetryUrl === session.telemetryUrl,
      );
      if (!agent?.telemetryUrl) {
        logClientTelemetry("kanban.session.poll.skipped", {
          taskId: task.id,
          sessionId: session.sessionId,
          reason: "missing agent telemetry URL",
        });
        return;
      }
      logClientTelemetry("kanban.session.poll.start", {
        taskId: task.id,
        agentId: agent.id,
        sessionId: session.sessionId,
        lastMessageCount: session.lastMessageCount ?? 0,
      });
      const response = await fetch("/api/chat/agent-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, sessionId: session.sessionId }),
      }).catch(() => null);
      const data = (await response
        ?.json()
        .catch(() => null)) as AgentSessionResponse | null;
      if (!response?.ok || !data?.ok || !data.session?.messages) {
        const failureKey = `${task.id}:${session.sessionId}`;
        const failureCount =
          (kanbanSessionPollFailureRef.current.get(failureKey) ?? 0) + 1;
        kanbanSessionPollFailureRef.current.set(failureKey, failureCount);
        const errorMessage =
          data?.error ??
          (response ? `HTTP ${response.status}` : "request failed");
        logClientTelemetry("kanban.session.poll.failed", {
          taskId: task.id,
          agentId: agent.id,
          sessionId: session.sessionId,
          failureCount,
          error: errorMessage,
        });
        if (
          task.status === "working" &&
          failureCount >= KANBAN_SESSION_POLL_FAILURE_LIMIT
        ) {
          const message = `${agent.name} accepted the task, but the dashboard could not refresh the agent session after ${failureCount} attempts. Last poll error: ${errorMessage}. Check the agent runtime session or move the card back to Ready for Queen to retry.`;
          logClientTelemetry("kanban.session.poll_failure_stalled", {
            taskId: task.id,
            agentId: agent.id,
            sessionId: session.sessionId,
            failureCount,
            error: errorMessage,
          });
          const marked = await markKanbanTaskNeedsHumanFromDashboardDispatch(
            task,
            agent,
            { result: message },
            "session-poll-failed",
          );
          if (marked) await addKanbanSystemComment(task.id, message);
        }
        return;
      }
      kanbanSessionPollFailureRef.current.delete(
        `${task.id}:${session.sessionId}`,
      );

      const rawMessages = data.session.messages.filter(
        (message) =>
          message.content.trim() &&
          !isInternalHermesSessionPrelude(message.content),
      );
      const messages = rawMessages
        .filter(
          (message) =>
            message.role === "user" ||
            message.role === "assistant" ||
            message.role === "tool",
        )
        .map(
          (message): ChatMessage => ({
            role: message.role === "user" ? "user" : "assistant",
            content:
              message.role === "tool"
                ? [
                    "Tool output:",
                    summarizeKanbanToolOutput(message.content) ||
                      compactDiagnosticPreview(message.content, 800),
                  ]
                    .filter(Boolean)
                    .join("\n")
                : message.content,
            createdAt:
              message.createdAt ?? data.session?.updatedAt ?? Date.now(),
            kanbanTaskId: task.id,
            sourceSessionId: session.sessionId,
            sourceIndex: message.index,
          }),
        );

      if (messages.length > 0) {
        setMessagesByAgent((current) => {
          const existing = current[agent.id] ?? [];
          const seen = new Set(
            existing
              .map((message) =>
                message.sourceSessionId && message.sourceIndex !== undefined
                  ? `${message.sourceSessionId}:${message.sourceIndex}`
                  : "",
              )
              .filter(Boolean),
          );
          const additions = messages.filter(
            (message) =>
              !seen.has(`${message.sourceSessionId}:${message.sourceIndex}`),
          );
          if (additions.length === 0) return current;
          return { ...current, [agent.id]: [...existing, ...additions] };
        });
      }

      const latestAssistant = [...rawMessages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            message.content.trim() &&
            !isInternalHermesSessionPrelude(message.content),
        );
      const latestRaw = [...rawMessages]
        .reverse()
        .find((message) => message.content.trim());
      const now = Date.now();
      const sessionUpdatedAt =
        data.session.updatedAt ?? latestRaw?.createdAt ?? now;
      const latestCount = data.session.messageCount ?? rawMessages.length;
      const sessionAgeMs = now - (session.startedAt ?? task.updatedAt);
      const sessionQuietMs = now - sessionUpdatedAt;
      const toolOutputStalled =
        task.status === "working" &&
        latestRaw?.role === "tool" &&
        sessionQuietMs >= KANBAN_TOOL_OUTPUT_STALL_MS;
      const noAssistantStalled =
        task.status === "working" &&
        latestCount > 1 &&
        !latestAssistant &&
        latestRaw?.role !== "tool" &&
        sessionAgeMs >= KANBAN_NO_ASSISTANT_STALL_MS &&
        sessionQuietMs >= KANBAN_NO_ASSISTANT_QUIET_MS;
      if (toolOutputStalled) {
        const message = kanbanToolOutputStalledDetail(
          agent.name,
          latestRaw?.content ?? "",
        );
        logClientTelemetry("kanban.session.tool_output_stalled", {
          taskId: task.id,
          agentId: agent.id,
          sessionId: session.sessionId,
          latestCount,
          latestRole: latestRaw?.role ?? null,
          toolOutputLength: latestRaw?.content.length ?? 0,
        });
        setMessagesByAgent((current) => ({
          ...current,
          [agent.id]: [
            ...(current[agent.id] ?? []),
            {
              role: "assistant",
              content: `Needs human: ${message}`,
              createdAt: now,
              kanbanTaskId: task.id,
              sourceSessionId: session.sessionId,
              sourceIndex: latestRaw?.index,
            },
          ],
        }));
        const marked = await markKanbanTaskNeedsHumanFromDashboardDispatch(
          task,
          agent,
          { result: message },
          "tool-output-stalled",
        );
        if (marked) await addKanbanSystemComment(task.id, message);
        return;
      }
      if (noAssistantStalled) {
        const message = kanbanNoAssistantStalledDetail(
          agent.name,
          latestCount,
          latestRaw?.role ?? null,
          latestRaw?.content ?? "",
        );
        const latestToolSummary =
          latestRaw?.role === "tool"
            ? summarizeKanbanToolOutput(latestRaw.content)
            : "";
        logClientTelemetry("kanban.session.no_assistant_stalled", {
          taskId: task.id,
          agentId: agent.id,
          sessionId: session.sessionId,
          latestCount,
          latestRole: latestRaw?.role ?? null,
          latestContentLength: latestRaw?.content.length ?? 0,
          latestToolSummary,
          startedAt: session.startedAt ?? null,
          sessionUpdatedAt,
          sessionAgeMs,
          sessionQuietMs,
        });
        setMessagesByAgent((current) => ({
          ...current,
          [agent.id]: [
            ...(current[agent.id] ?? []),
            {
              role: "assistant",
              content: `Needs human: ${message}`,
              createdAt: now,
              kanbanTaskId: task.id,
              sourceSessionId: session.sessionId,
              sourceIndex: latestRaw?.index,
            },
          ],
        }));
        const marked = await markKanbanTaskNeedsHumanFromDashboardDispatch(
          task,
          agent,
          { result: message },
          "no-assistant-stalled",
        );
        if (marked) await addKanbanSystemComment(task.id, message);
        return;
      }
      if (latestCount !== task.agentSession?.lastMessageCount) {
        logClientTelemetry("kanban.session.poll.updated", {
          taskId: task.id,
          agentId: agent.id,
          sessionId: session.sessionId,
          previousCount: task.agentSession?.lastMessageCount ?? 0,
          latestCount,
          latestAssistantLength: latestAssistant?.content.length ?? 0,
        });
        await patchKanbanTask(task.id, {
          agentSession: {
            ...session,
            updatedAt: sessionUpdatedAt,
            lastMessageCount: latestCount,
          },
          ...(latestAssistant
            ? { result: latestAssistant.content.slice(0, 4000) }
            : latestRaw?.role === "tool"
              ? {
                  result:
                    `${agent.name} is still working.\n\n${summarizeKanbanToolOutput(latestRaw.content)}`.slice(
                      0,
                      4000,
                    ),
                }
              : {}),
        });
      }
    } finally {
      kanbanSessionPollInFlightRef.current.delete(inFlightKey);
    }
  }

  useEffect(() => {
    if (
      !hydrated ||
      selectedKanbanTask?.status !== "working" ||
      !selectedKanbanTask.agentSession?.sessionId
    )
      return;
    const lastPoll =
      kanbanSessionPollRef.current.get(selectedKanbanTask.id) ?? 0;
    const now = Date.now();
    if (now - lastPoll < 4_000) return;
    kanbanSessionPollRef.current.set(selectedKanbanTask.id, now);
    void refreshKanbanAgentSession(selectedKanbanTask);
    // `refreshKanbanAgentSession` intentionally stays out of this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgents, hydrated, selectedKanbanTask]);

  useEffect(() => {
    if (!hydrated || !kanbanBoard) return;
    const pollable = kanbanBoard.tasks.filter(
      (task) => task.status === "working" && task.agentSession?.sessionId,
    );
    if (pollable.length === 0) return;
    const poll = () => {
      // Pause while the OS window is hidden/minimized — nobody is watching the
      // board, and each pollable task forks a sqlite3 subprocess via
      // /api/chat/agent-session. Resumes on visibilitychange (below). Matches the
      // app-wide useVisibilityAwarePolling pattern. NOTE: intentionally NOT scoped
      // by activeView — this poll also detects stalled sessions (-> needs-human)
      // and syncs agent messages, which must keep working when the user is off the
      // board (e.g. dispatched a task, then switched to chat).
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      pollable.forEach((task) => {
        const lastPoll = kanbanSessionPollRef.current.get(task.id) ?? 0;
        if (Date.now() - lastPoll < 4_000) return;
        kanbanSessionPollRef.current.set(task.id, Date.now());
        void refreshKanbanAgentSession(task);
      });
    };
    poll();
    const timer = window.setInterval(poll, 6_000);
    const handleVisibility = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgents, hydrated, kanbanBoard]);

  useEffect(() => {
    if (!hydrated || !kanbanBoard) return;
    const now = Date.now();
    const staleTasks = kanbanBoard.tasks.filter((task) =>
      isKanbanStaleWorkingTask(task, now),
    );
    for (const task of staleTasks) {
      const signature = `${task.id}:${task.agentSession?.sessionId ?? ""}:${task.agentSession?.lastMessageCount ?? ""}:${task.updatedAt}`;
      if (kanbanStaleRequeueAttemptRef.current.has(signature)) continue;
      kanbanStaleRequeueAttemptRef.current.add(signature);
      void requeueStaleKanbanTask(task, "auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgents, hydrated, kanbanBoard]);

  async function steerSelectedKanbanTask(event: FormEvent) {
    event.preventDefault();
    const prompt = kanbanSteerDraft.trim();
    const outgoingAttachments = kanbanSteerAttachments;
    const outgoingDirectories = kanbanSteerDirectories;
    const outgoingLabel =
      prompt ||
      attachmentSummary(outgoingAttachments) ||
      (outgoingDirectories.length
        ? `Linked ${outgoingDirectories.length} director${outgoingDirectories.length === 1 ? "y" : "ies"}`
        : "");
    if (
      !selectedKanbanTask ||
      !selectedKanbanAgent ||
      !outgoingLabel ||
      kanbanSteeringTaskId
    )
      return;
    const setupIssue = chatSetupIssue(selectedKanbanAgent);
    if (setupIssue) {
      await addKanbanSystemComment(
        selectedKanbanTask.id,
        `Could not steer ${selectedKanbanAgent.name}: ${setupIssue}`,
      );
      return;
    }

    const localTaskId = `kanban-steer-${selectedKanbanTask.id}-${Date.now()}`;
    const targetColumn = KANBAN_COLUMNS.find(
      (column) => column.id === kanbanSteerTargetStatus,
    );
    const directorySummary = outgoingDirectories.length
      ? `Linked directories:\n${outgoingDirectories.map((directory) => `- ${directory.name}`).join("\n")}`
      : "";
    const attachmentTextSummary = outgoingAttachments.length
      ? `Attachments:\n${outgoingAttachments.map((attachment) => `- ${attachment.kind}: ${attachment.name} (${attachment.mimeType || "unknown"}, ${attachmentSizeLabel(attachment.size)})`).join("\n")}`
      : "";
    const steerPrompt = [
      `Steering note for Kanban task "${selectedKanbanTask.title}":`,
      prompt || outgoingLabel,
      attachmentTextSummary,
      directorySummary,
      targetColumn
        ? `After considering this message, keep or move the card to: ${targetColumn.title}.`
        : "",
      selectedKanbanTask.result
        ? `Current task notes:\n${selectedKanbanTask.result}`
        : "",
      kanbanSteerTargetStatus === "ideas"
        ? "Planning mode: reply with guidance or a concise response, but do not continue execution unless asked later."
        : "Use this guidance for the active work. Reply with a concise update, blocker, or result.",
    ]
      .filter(Boolean)
      .join("\n\n");

    setKanbanSteerDraft("");
    setKanbanSteerAttachments([]);
    setKanbanSteerDirectories([]);
    setKanbanSteerAttachmentError("");
    setKanbanSteerAttachmentMenuOpen(false);
    setKanbanSteeringTaskId(selectedKanbanTask.id);
    upsertTask({
      id: localTaskId,
      agentId: selectedKanbanAgent.id,
      title: `Steer: ${selectedKanbanTask.title}`,
      lastMessage: outgoingLabel,
      status: "active",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      source: "kanban",
    });
    appendMessage(selectedKanbanAgent.id, {
      role: "user",
      content: outgoingLabel,
      attachments: outgoingAttachments,
      kanbanTaskId: selectedKanbanTask.id,
      surface: "kanban",
    });
    appendMessage(selectedKanbanAgent.id, {
      role: "assistant",
      content: "",
      kanbanTaskId: selectedKanbanTask.id,
      surface: "kanban",
    });

    try {
      if (selectedKanbanTask.status !== kanbanSteerTargetStatus) {
        await patchKanbanTask(selectedKanbanTask.id, {
          status: kanbanSteerTargetStatus,
        });
      }
      const contextMessages = (messagesByAgent[selectedKanbanAgent.id] ?? [])
        .filter(
          (message) =>
            message.role !== "system" &&
            (message.content.trim() || message.attachments?.length),
        )
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: messageContentParts(
            message.content,
            message.attachments ?? [],
          ),
        }));
      const response = await fetch("/api/chat/agent-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedKanbanAgent,
          sharedVault,
          workingDirectory: appVersion?.appDir,
          wallet:
            walletsByAgent[selectedKanbanAgent.id] ??
            createDefaultAgentWallet(selectedKanbanAgent.id),
          honeyLedgerEnabled,
          messages: [
            ...contextMessages,
            {
              role: "user",
              content: messageContentParts(steerPrompt, outgoingAttachments),
            },
          ],
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(
          await responseErrorMessage(
            response,
            `Request failed with ${response.status}`,
          ),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventText of events) {
          const line = eventText
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          const parsed = parseRuntimeSsePayload(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: unknown;
            honey?: unknown;
            session?: {
              id?: string;
              runtime?: string;
              source?: string;
              startedAt?: number;
              updatedAt?: number;
              messageCount?: number;
            };
          };
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            await refreshHoneyLedger();
            continue;
          }
          if (parsed.session?.id) {
            await patchKanbanTask(selectedKanbanTask.id, {
              agentSession: {
                agentId: selectedKanbanAgent.id,
                agentName: selectedKanbanAgent.name,
                runtime: parsed.session.runtime ?? selectedKanbanAgent.runtime,
                telemetryUrl: selectedKanbanAgent.telemetryUrl,
                sessionId: parsed.session.id,
                source: parsed.session.source,
                startedAt: parsed.session.startedAt ?? Date.now(),
                updatedAt: parsed.session.updatedAt ?? Date.now(),
                lastMessageCount: parsed.session.messageCount ?? 0,
              },
            });
            continue;
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (!chunk) continue;
          fullText += chunk;
          setMessagesByAgent((current) => {
            const existing = current[selectedKanbanAgent.id] ?? [];
            const next = [...existing];
            const last = next[next.length - 1] ?? {
              role: "assistant" as const,
              content: "",
              createdAt: Date.now(),
              kanbanTaskId: selectedKanbanTask.id,
            };
            if (next.length === 0) next.push(last);
            next[next.length - 1] = {
              ...last,
              content: fullText,
              createdAt: last.createdAt ?? Date.now(),
              kanbanTaskId: selectedKanbanTask.id,
            };
            return { ...current, [selectedKanbanAgent.id]: next };
          });
          updateTask(localTaskId, { lastMessage: fullText });
        }
      }
      const result =
        fullText.trim() ||
        `${selectedKanbanAgent.name} received the steering note.`;
      updateTask(localTaskId, {
        status: "completed",
        lastMessage: result,
        completedAt: Date.now(),
      });
      await addKanbanSystemComment(
        selectedKanbanTask.id,
        `Steered ${selectedKanbanAgent.name}: ${outgoingLabel}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown runtime error";
      setMessagesByAgent((current) => {
        const existing = current[selectedKanbanAgent.id] ?? [];
        const next = [...existing];
        const last = next[next.length - 1] ?? {
          role: "assistant" as const,
          content: "",
          createdAt: Date.now(),
          kanbanTaskId: selectedKanbanTask.id,
        };
        if (next.length === 0) next.push(last);
        next[next.length - 1] = {
          ...last,
          content: `Error: ${message}`,
          createdAt: last.createdAt ?? Date.now(),
          kanbanTaskId: selectedKanbanTask.id,
        };
        return { ...current, [selectedKanbanAgent.id]: next };
      });
      updateTask(localTaskId, {
        status: "failed",
        lastMessage: message,
        completedAt: Date.now(),
      });
      await addKanbanSystemComment(
        selectedKanbanTask.id,
        `Steer failed for ${selectedKanbanAgent.name}: ${message}`,
      );
    } finally {
      setKanbanSteeringTaskId("");
    }
  }

  return {
    createKanbanArtistHandoffTask,
    requeueStaleKanbanTask,
    dispatchKanbanTaskToAgent,
    addKanbanComment,
    refreshKanbanAgentSession,
    steerSelectedKanbanTask,
  };
}
