import {
  createVisualArtifact,
} from "@/lib/services/visual-artifacts";
import type {
  VisualArtifactBlock,
  VisualArtifactCreateInput,
} from "@/lib/types/visual-artifacts";

type QueenBeeVisualPlanTask = {
  id?: string;
  title?: string;
  body?: string;
  assignee?: string;
  status?: string;
  targetMachine?: { name?: string; key?: string } | null;
};

type QueenBeeVisualPlanRoute = {
  assignee?: string;
  reason?: string;
  targetMachine?: { name?: string; key?: string } | null;
  delegation?: {
    status?: string;
    workerClass?: string;
    reason?: string;
  };
};

type QueenBeeVisualPlanReceipt = {
  summary?: string;
  fingerprint?: string;
  createdAt?: string;
};

export type QueenBeeVisualPlanInput = {
  title?: unknown;
  message?: unknown;
  source?: unknown;
  mode?: unknown;
  fingerprint?: unknown;
  task?: QueenBeeVisualPlanTask | null;
  route?: QueenBeeVisualPlanRoute | null;
  receipt?: QueenBeeVisualPlanReceipt | null;
  vaultPath?: unknown;
};

export type QueenBeePrdVisualPlanInput = {
  title?: unknown;
  source?: unknown;
  decomposition?: {
    title?: string;
    criteria?: string[];
    drafts?: Array<{ title?: string; skills?: string[]; dependsOnDraftIndexes?: number[] }>;
  } | null;
  epic?: { id?: string; title?: string } | null;
  tasks?: Array<{ id?: string; title?: string; created?: boolean }> | null;
  vaultPath?: unknown;
};

export async function createQueenBeeVisualPlan(input: QueenBeeVisualPlanInput) {
  const task = input.task;
  const route = input.route;
  const title = cleanText(input.title) || task?.title || "Queen Bee plan";
  const taskId = cleanText(task?.id);
  const artifactInput: VisualArtifactCreateInput = {
    kind: "plan",
    title: `Queen Bee plan: ${title}`,
    workBoardTaskId: taskId,
    queenBeeRunId: cleanText(input.fingerprint ?? input.receipt?.fingerprint),
    vaultPath: input.vaultPath,
    blocks: queenBeePlanBlocks({
      title,
      message: cleanText(input.message),
      source: cleanText(input.source),
      mode: cleanText(input.mode),
      task,
      route,
      receipt: input.receipt,
    }),
  };
  return createVisualArtifact(artifactInput);
}

export async function createQueenBeePrdVisualPlan(input: QueenBeePrdVisualPlanInput) {
  const title = cleanText(input.title) || input.decomposition?.title || "Queen Bee PRD decomposition";
  const epicId = cleanText(input.epic?.id);
  return createVisualArtifact({
    kind: "plan",
    title: `Queen Bee PRD plan: ${title}`,
    workBoardTaskId: epicId,
    queenBeeRunId: `prd:${slugFor(title)}`,
    vaultPath: input.vaultPath,
    blocks: prdPlanBlocks({
      title,
      source: cleanText(input.source),
      criteria: input.decomposition?.criteria ?? [],
      drafts: input.decomposition?.drafts ?? [],
      epic: input.epic,
      tasks: input.tasks ?? [],
    }),
  });
}

export function visualPlanReceipt(result: Awaited<ReturnType<typeof createVisualArtifact>> | null | undefined) {
  if (!result) return undefined;
  return {
    id: result.artifact.id,
    title: result.artifact.title,
    kind: result.artifact.kind,
    workBoardTaskId: result.artifact.workBoardTaskId,
    queenBeeRunId: result.artifact.queenBeeRunId,
    storage: result.storage.kind,
  };
}

function queenBeePlanBlocks(input: {
  title: string;
  message?: string;
  source?: string;
  mode?: string;
  task?: QueenBeeVisualPlanTask | null;
  route?: QueenBeeVisualPlanRoute | null;
  receipt?: QueenBeeVisualPlanReceipt | null;
}): VisualArtifactBlock[] {
  const taskId = cleanText(input.task?.id) || "pending";
  const assignee = cleanText(input.route?.assignee ?? input.task?.assignee) || "queen-bee";
  const machine = cleanText(input.route?.targetMachine?.name ?? input.task?.targetMachine?.name) || "shared Work Board";
  const workerClass = cleanText(input.route?.delegation?.workerClass) || "general";
  const summary = [
    `# ${input.title}`,
    "",
    input.receipt?.summary || "Queen Bee queued this request on the shared Work Board.",
    "",
    `- Task: ${taskId}`,
    `- Assignee: ${assignee}`,
    `- Worker class: ${workerClass}`,
    `- Target machine: ${machine}`,
    input.source ? `- Source: ${input.source}` : "",
    input.mode ? `- Mode: ${input.mode}` : "",
    input.message ? `- Request: ${input.message}` : "",
    input.route?.reason ? `- Routing reason: ${input.route.reason}` : "",
  ].filter(Boolean).join("\n");
  return [
    { type: "summary", markdown: summary },
    {
      type: "diagram",
      mermaid: [
        "flowchart LR",
        `  request["${mermaidLabel("User request")}"] --> queen["${mermaidLabel("Queen Bee")}"]`,
        `  queen --> task["${mermaidLabel(`Work Board task ${taskId}`)}"]`,
        `  task --> agent["${mermaidLabel(`${assignee} (${workerClass})`)}"]`,
        `  agent --> machine["${mermaidLabel(machine)}"]`,
      ].join("\n"),
    },
    {
      type: "wireframe",
      markdown: [
        "## Execution surface",
        "",
        `1. Work Board card \`${taskId}\` holds the authoritative task body and status.`,
        `2. Queen Bee routing selected \`${assignee}\` for \`${workerClass}\` work.`,
        `3. The selected machine is \`${machine}\`; if no live worker was available, the task remains queued for Queen Bee review.`,
      ].join("\n"),
    },
    {
      type: "risk",
      markdown: [
        "- This artifact is a local plan/receipt, not an execution permission.",
        "- Any later wallet, payment, deploy, credential, or destructive action still needs its route-specific confirmation and server-side policy checks.",
        "- Workers should attach verification evidence to the Work Board task before marking it done.",
      ].join("\n"),
    },
  ];
}

function prdPlanBlocks(input: {
  title: string;
  source?: string;
  criteria: string[];
  drafts: Array<{ title?: string; skills?: string[]; dependsOnDraftIndexes?: number[] }>;
  epic?: { id?: string; title?: string } | null;
  tasks: Array<{ id?: string; title?: string; created?: boolean }>;
}): VisualArtifactBlock[] {
  const epicId = cleanText(input.epic?.id) || "pending";
  const taskLines = input.tasks.map((task, index) => {
    const draft = input.drafts[index];
    return `- ${task.id || `task-${index + 1}`}: ${task.title || draft?.title || "Untitled"}${task.created === false ? " (existing)" : ""}`;
  });
  return [
    {
      type: "summary",
      markdown: [
        `# ${input.title}`,
        "",
        `Queen Bee decomposed this PRD into ${input.tasks.length} implementation task${input.tasks.length === 1 ? "" : "s"}.`,
        input.source ? `Source: ${input.source}` : "",
        `Epic: ${epicId}`,
        "",
        "Acceptance criteria",
        input.criteria.length ? input.criteria.map((criterion) => `- ${criterion}`).join("\n") : "- Child tasks complete with verification.",
      ].filter(Boolean).join("\n"),
    },
    {
      type: "file-tree",
      items: [
        { path: `Work Board/${epicId}`, note: input.epic?.title || "PRD epic task" },
        ...input.tasks.map((task, index) => ({
          path: `Work Board/${task.id || `task-${index + 1}`}`,
          note: task.title || input.drafts[index]?.title || "Implementation task",
        })),
      ],
    },
    {
      type: "diagram",
      mermaid: prdMermaid(epicId, input.tasks),
    },
    {
      type: "diff-summary",
      markdown: ["## Task set", "", ...taskLines].join("\n"),
    },
    {
      type: "risk",
      markdown: [
        "- PRD decomposition creates Work Board planning state only.",
        "- Child tasks still need scoped implementation, verification, and review before release.",
        "- Any commercial, payment, credential, or hosted-service decision remains server-side or explicitly self-hosted.",
      ].join("\n"),
    },
  ];
}

function prdMermaid(epicId: string, tasks: Array<{ id?: string; title?: string }>) {
  const lines = [
    "flowchart TD",
    `  epic["${mermaidLabel(`PRD epic ${epicId}`)}"]`,
  ];
  tasks.slice(0, 12).forEach((task, index) => {
    const nodeId = `task${index + 1}`;
    lines.push(`  epic --> ${nodeId}["${mermaidLabel(task.title || task.id || `Task ${index + 1}`)}"]`);
    if (index > 0) lines.push(`  task${index} -. depends before .-> ${nodeId}`);
  });
  return lines.join("\n");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 500) : undefined;
}

function mermaidLabel(value: string) {
  return value.replace(/["\\]/g, "").slice(0, 80);
}

function slugFor(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "prd";
}
