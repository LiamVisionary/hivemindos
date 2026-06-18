import { hostname } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";

import { chooseBeeAssignment, inferWorkerClass } from "@/lib/services/orchestration/bee-roles";
import type { AgentProfile, BeeWorkerClass } from "@/lib/types/agent-runtime";
import { canonicalLocalCollectorUrl } from "@/lib/services/local-collector-url";
import { rememberActionAgentMemory } from "@/lib/services/obsidian/agent-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HandoffAction = "plan" | "send-file" | "send-task" | "send-file-task";

type HandoffBody = {
  action?: HandoffAction;
  target?: string;
  machine?: string;
  to?: string;
  files?: string[];
  file?: string;
  task?: string;
  note?: string;
  dryRun?: boolean;
  allowAmbiguous?: boolean;
  sourceAgent?: {
    runtime?: string;
    agentId?: string;
  };
};

type FleetMachine = {
  key?: string;
  collector?: string;
  capabilities?: {
    chat?: boolean;
    fileTransfers?: boolean;
    runtimes?: string[];
    defaultSyncPath?: string;
  };
  device?: {
    name?: string;
    host?: string;
    hostname?: string;
    dnsName?: string;
    os?: string;
    collectorUrl?: string;
    machineId?: string;
    self?: boolean;
  };
  agents?: AgentProfile[];
};

type TransferManifest = {
  id: string;
  payloads?: Array<{ name?: string; mediaType?: string; bytes?: number; path?: string }>;
  to?: { machineId?: string; host?: string; runtime?: string; agentId?: string };
};

const TASK_ACTIONS = new Set<HandoffAction>(["send-task", "send-file-task"]);
const execFileAsync = promisify(execFile);

export async function GET(request: NextRequest) {
  const tools = [
    {
      name: "handoff_file",
      description: "Copy one or more local files into the Hivemind Sync handoff folder for a fuzzy-matched fleet machine.",
      inputSchema: {
        type: "object",
        required: ["target", "files"],
        properties: {
          target: { type: "string", description: "Machine name, hostname, OS, or alias such as ubuntu." },
          files: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
      },
    },
    {
      name: "handoff_file_task",
      description: "Copy files to a machine and ask the best matching agent on that machine to act on them.",
      inputSchema: {
        type: "object",
        required: ["target", "files", "task"],
        properties: {
          target: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          task: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    {
      name: "handoff_task",
      description: "Send a task directly to the best matching agent on a fuzzy-matched fleet machine.",
      inputSchema: {
        type: "object",
        required: ["target", "task"],
        properties: {
          target: { type: "string" },
          task: { type: "string" },
        },
      },
    },
  ];
  return NextResponse.json({
    ok: true,
    protocol: "hivemind-handoff",
    tools,
    usage: {
      cli: "hive-handoff send --to ubuntu ./file.png --task \"edit this image\"",
      slash: "/handoff-task ubuntu summarize the synced project state",
      note: "If the user asks to hand off a file but does not say what to do with it, do a plain file handoff or ask for the missing task before using handoff_file_task.",
    },
    requestUrl: request.nextUrl.pathname,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HandoffBody;
    const normalized = normalizeBody(body);
    if (!normalized.target) {
      return handoffError("A target machine name is required.", 400, { needsUserInput: true });
    }
    if (TASK_ACTIONS.has(normalized.action) && !normalized.task) {
      return handoffError("A task is required for task handoff. Ask the user what the receiving agent should do.", 400, { needsUserInput: true });
    }
    if ((normalized.action === "send-file" || normalized.action === "send-file-task") && normalized.files.length === 0) {
      return handoffError("At least one file path is required for file handoff.", 400, { needsUserInput: true });
    }

    const machines = await discoverFleet(request);
    const resolution = resolveMachine(normalized.target, machines, normalized.allowAmbiguous);
    if ("error" in resolution) {
      return handoffError(resolution.error || "Could not resolve target machine.", resolution.status, {
        needsUserInput: resolution.needsUserInput,
        candidates: resolution.candidates,
      });
    }

    const taskTitle = normalized.task || normalized.note || "HivemindOS handoff";
    const workerClass = inferWorkerClass({ title: taskTitle, body: normalized.task || normalized.note || "", skills: [] });
    const selectedAgent = TASK_ACTIONS.has(normalized.action)
      ? selectTargetAgent(resolution.machine, normalized.task, workerClass)
      : null;
    if (TASK_ACTIONS.has(normalized.action) && !selectedAgent) {
      return handoffError(`No chat-capable agent was available on ${machineName(resolution.machine)}.`, 409, {
        machine: publicMachine(resolution.machine),
        workerClass,
      });
    }

    const transfer = normalized.files.length > 0 && !normalized.dryRun
      ? await createLocalTransfer(normalized, resolution.machine, selectedAgent?.agent)
      : null;

    const remoteTask = selectedAgent && !normalized.dryRun
      ? await sendRemoteTask({
        machine: resolution.machine,
        agent: selectedAgent.agent,
        task: normalized.task,
        workerClass,
        transfer,
        note: normalized.note,
      })
      : null;

    const responsePayload = {
      ok: true,
      dryRun: normalized.dryRun,
      action: normalized.action,
      target: normalized.target,
      machine: publicMachine(resolution.machine),
      match: resolution.match,
      workerClass,
      selectedAgent: selectedAgent ? publicAgent(selectedAgent.agent) : null,
      selectionReason: selectedAgent?.reason,
      transfer: transfer ? {
        id: transfer.id,
        payloads: transfer.payloads ?? [],
        to: transfer.to,
      } : null,
      remoteTask,
      warnings: [
        ...(normalized.files.length > 0 && !resolution.machine.capabilities?.fileTransfers ? [`${machineName(resolution.machine)} has not advertised fileTransfers; Syncthing may still deliver the vault payload, but collector inbox checks may be unavailable.`] : []),
      ],
    };
    if (!normalized.dryRun) {
      await recordHandoffActionMemory({
        action: normalized.action,
        machineName: machineName(resolution.machine),
        selectedAgent: selectedAgent?.agent,
        workerClass,
        transfer,
        remoteTask,
        task: normalized.task,
        note: normalized.note,
      });
    }
    return NextResponse.json(responsePayload);
  } catch (error) {
    return handoffError(error instanceof Error ? error.message : "Handoff failed.", 500);
  }
}

async function recordHandoffActionMemory(input: {
  action: HandoffAction;
  machineName: string;
  selectedAgent?: AgentProfile;
  workerClass: BeeWorkerClass;
  transfer: TransferManifest | null;
  remoteTask: { ok: boolean; host: string; preview: string } | null;
  task: string;
  note: string;
}) {
  const subject = input.task || input.note || "HivemindOS handoff";
  await rememberActionAgentMemory({
    title: `Handoff ${input.action} to ${input.machineName}`,
    content: [
      `HivemindOS completed a ${input.action} handoff to ${input.machineName}.`,
      input.selectedAgent ? `Selected agent: ${input.selectedAgent.name || input.selectedAgent.id || input.selectedAgent.agentId} (${input.selectedAgent.runtime || "runtime unknown"}).` : "",
      `Worker class: ${input.workerClass}.`,
      input.transfer?.id ? `Transfer: ${input.transfer.id}.` : "",
      input.remoteTask?.host ? `Remote task accepted by ${input.remoteTask.host}.` : "",
      `Subject: ${subject.replace(/\s+/g, " ").slice(0, 220)}.`,
    ].filter(Boolean).join("\n"),
    source: "Handoff receipt",
    agentName: "HivemindOS Handoff",
    agentId: "hivemindos-handoff",
    runtime: "hivemindos",
    project: "HivemindOS",
    tags: ["handoff", "receipt"],
    entities: ["Handoff", "HivemindOS", input.machineName],
    actorRole: "agent",
    memoryOrigin: "system-receipt",
  }).catch(() => undefined);
}

function normalizeBody(body: HandoffBody) {
  const files = [...(Array.isArray(body.files) ? body.files : []), body.file].filter((file): file is string => Boolean(file?.trim()));
  const task = String(body.task || "").trim();
  const action = body.action || (files.length && task ? "send-file-task" : files.length ? "send-file" : "send-task");
  return {
    action,
    target: String(body.target || body.machine || body.to || "").trim(),
    files,
    task,
    note: String(body.note || "").trim(),
    dryRun: body.dryRun === true,
    allowAmbiguous: body.allowAmbiguous === true,
    sourceAgent: body.sourceAgent,
  };
}

async function discoverFleet(request: NextRequest): Promise<FleetMachine[]> {
  const url = new URL("/api/fleet/discover", request.nextUrl.origin);
  url.searchParams.set("includeSnapshots", "0");
  url.searchParams.set("fresh", "1");
  const token = request.headers.get("x-hivemindos-device-token");
  const response = await fetch(url, {
    cache: "no-store",
    headers: token ? { "x-hivemindos-device-token": token } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null) as { machines?: FleetMachine[]; error?: string } | null;
  if (!response.ok || !data) throw new Error(data?.error || `Fleet discovery returned HTTP ${response.status}.`);
  return (data.machines ?? []).filter((machine) => machine.collector === "ready" && machine.device?.collectorUrl);
}

function resolveMachine(target: string, machines: FleetMachine[], allowAmbiguous = false) {
  const scored = machines
    .map((machine) => ({ machine, score: machineScore(machine, target) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!scored.length) {
    return {
      error: `No connected HivemindOS machine matched "${target}".`,
      status: 404,
      needsUserInput: true,
      candidates: machines.slice(0, 6).map(publicMachine),
    } as const;
  }
  const top = scored[0];
  const ambiguous = scored.slice(1).filter((entry) => top.score - entry.score <= 4);
  if (ambiguous.length && !allowAmbiguous) {
    return {
      error: `More than one connected machine is a plausible match for "${target}". Ask which one to use.`,
      status: 409,
      needsUserInput: true,
      candidates: [top, ...ambiguous].slice(0, 5).map((entry) => ({ ...publicMachine(entry.machine), score: entry.score })),
    } as const;
  }
  return {
    machine: top.machine,
    match: {
      score: top.score,
      matched: publicMachineAliases(top.machine).slice(0, 8),
    },
  };
}

function machineScore(machine: FleetMachine, target: string) {
  const needle = normalizeSearch(target);
  const aliases = machineAliases(machine).map(normalizeSearch).filter(Boolean);
  let score = 0;
  for (const alias of aliases) {
    if (alias === needle) score = Math.max(score, 100);
    else if (alias.startsWith(needle) || needle.startsWith(alias)) score = Math.max(score, 84);
    else if (alias.includes(needle) || needle.includes(alias)) score = Math.max(score, 72);
    else {
      const overlap = tokenOverlap(alias, needle);
      if (overlap > 0) score = Math.max(score, 40 + overlap * 12);
      const distance = levenshtein(alias.slice(0, 32), needle.slice(0, 32));
      const longest = Math.max(alias.length, needle.length, 1);
      const similarity = 1 - distance / longest;
      if (similarity >= 0.68) score = Math.max(score, Math.round(similarity * 58));
    }
  }
  if (/ubuntu|linux/i.test(target) && /ubuntu|linux/i.test(`${machine.device?.os ?? ""} ${machine.device?.name ?? ""}`)) score += 10;
  if (machine.device?.self) score -= 8;
  return score;
}

function machineAliases(machine: FleetMachine) {
  const collectorHost = (() => {
    try {
      return new URL(machine.device?.collectorUrl || "").hostname;
    } catch {
      return "";
    }
  })();
  const dnsLabel = String(machine.device?.dnsName || "").replace(/\.$/, "").split(".")[0];
  return [
    machine.key,
    machine.device?.name,
    machine.device?.host,
    machine.device?.hostname,
    dnsLabel,
    machine.device?.dnsName,
    machine.device?.machineId,
    collectorHost,
    machine.device?.os,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function publicMachineAliases(machine: FleetMachine) {
  return machineAliases(machine).filter((value) => !isIpAddress(value));
}

function isIpAddress(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^[a-f0-9:]+$/i.test(value) && value.includes(":");
}

function selectTargetAgent(machine: FleetMachine, task: string, workerClass: BeeWorkerClass) {
  const agents = (machine.agents ?? [])
    .filter((agent) => agent.beeRole !== "observer" && agent.beeRole !== "human")
    .filter((agent) => agent.runtime === "hermes" || agent.runtimeCapabilities?.chat || agent.collectorCapabilities?.chat);
  if (!agents.length) return null;
  const taskForAssignment = {
    id: "handoff-task",
    title: task,
    body: task,
    status: "ready",
    priority: "normal",
    skills: [workerClass],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Parameters<typeof chooseBeeAssignment>[0];
  const assignment = chooseBeeAssignment(taskForAssignment, agents, { preferQueen: false });
  const agent = assignment.worker ?? assignment.queen ?? agents[0];
  return agent ? { agent, reason: assignment.reason } : null;
}

async function createLocalTransfer(
  input: ReturnType<typeof normalizeBody>,
  machine: FleetMachine,
  agent?: AgentProfile,
) {
  const args = [
    join(process.cwd(), "scripts", "hive-transfer.mjs"),
    "send",
    "--note",
    input.note || input.task || "HivemindOS handoff",
    "--fromHost",
    hostname(),
    ...(input.sourceAgent?.runtime ? ["--fromRuntime", input.sourceAgent.runtime] : []),
    ...(input.sourceAgent?.agentId ? ["--fromAgent", input.sourceAgent.agentId] : []),
    ...(machine.device?.machineId ? ["--toMachine", machine.device.machineId] : []),
    ...(machine.device?.name ? ["--toHost", machine.device.name] : []),
    ...(agent?.runtime ? ["--toRuntime", agent.runtime] : []),
    ...(agent?.agentId || agent?.id ? ["--toAgent", agent.agentId || agent.id] : []),
    ...input.files,
  ];
  const { stdout } = await execFileAsync(process.execPath, args, { timeout: 60_000, maxBuffer: 2_000_000 });
  const parsed = JSON.parse(stdout) as { ok?: boolean; transfer?: TransferManifest; error?: string };
  if (!parsed.ok || !parsed.transfer) throw new Error(parsed.error || "hive-transfer did not create a transfer.");
  return parsed.transfer;
}

async function sendRemoteTask(input: {
  machine: FleetMachine;
  agent: AgentProfile;
  task: string;
  workerClass: BeeWorkerClass;
  transfer: TransferManifest | null;
  note: string;
}) {
  const collectorUrl = input.machine.device?.collectorUrl?.replace(/\/+$/, "");
  if (!collectorUrl) throw new Error(`${machineName(input.machine)} does not have a collector URL.`);
  const message = remoteTaskMessage(input);
  const payload = {
    agent: input.agent,
    message,
    rawUserMessage: message,
    stream: false,
    context: {
      source: "hivemindos-handoff",
      workerClass: input.workerClass,
      transferId: input.transfer?.id,
    },
  };
  const data = await postCollectorJson(input.machine, "/chat", payload);
  return {
    ok: true,
    host: data?.host || machineName(input.machine),
    preview: String(data?.text || "").replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

async function postCollectorJson(machine: FleetMachine, path: string, payload: Record<string, unknown>) {
  const collectorUrl = await canonicalLocalCollectorUrl({
    telemetryUrl: machine.device?.collectorUrl,
    machineName: machine.device?.self ? "local" : machineName(machine),
  });
  if (!collectorUrl) throw new Error(`${machineName(machine)} does not have a collector URL.`);
  try {
    const response = await fetch(`${collectorUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180_000),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string; host?: string } | null;
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Remote collector returned HTTP ${response.status}.`);
    return data;
  } catch (error) {
    if (machine.device?.self) throw error;
    return postCollectorViaTailscaleSsh(machine, path, payload);
  }
}

async function postCollectorViaTailscaleSsh(machine: FleetMachine, path: string, payload: Record<string, unknown>) {
  const script = [
    "set -eu",
    "[ -f \"$HOME/.hivemindos/collector.env\" ] && . \"$HOME/.hivemindos/collector.env\" || true",
    "port=\"${AGENT_TELEMETRY_PORT:-8787}\"",
    `path=${shellArg(path.startsWith("/") ? path : `/${path}`)}`,
    `body=${shellArg(JSON.stringify(payload))}`,
    "url=\"http://127.0.0.1:$port$path\"",
    "printf '%s' \"$body\" | curl -fsS --max-time 180 -X POST -H 'Content-Type: application/json' --data-binary @- \"$url\"",
  ].join("\n");
  const errors: string[] = [];
  for (const host of remoteHostCandidates(machine)) {
    for (const target of [`root@${host}`, `ubuntu@${host}`, host]) {
      try {
        const { stdout } = await execFileAsync("tailscale", ["ssh", target, "sh", "-lc", script], {
          timeout: 190_000,
          maxBuffer: 2_000_000,
        });
        const data = JSON.parse(stdout) as { ok?: boolean; text?: string; error?: string; host?: string };
        if (data?.ok === false) throw new Error(data.error || "Collector returned ok:false.");
        return data;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  throw new Error(`Collector SSH fallback failed for ${machineName(machine)}: ${errors.at(-1) || "unknown error"}`);
}

function remoteHostCandidates(machine: FleetMachine) {
  const collectorHost = (() => {
    try {
      const host = new URL(machine.device?.collectorUrl || "").hostname;
      return /^127\.|^localhost$/i.test(host) ? "" : host;
    } catch {
      return "";
    }
  })();
  const dnsName = String(machine.device?.dnsName || "").replace(/\.$/, "");
  const dnsLabel = dnsName.split(".")[0] || "";
  return [dnsLabel, dnsName, collectorHost]
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function remoteTaskMessage(input: {
  machine: FleetMachine;
  agent: AgentProfile;
  task: string;
  workerClass: BeeWorkerClass;
  transfer: TransferManifest | null;
  note: string;
}) {
  const transfer = input.transfer;
  if (!transfer) {
    return [
      "HivemindOS task handoff.",
      `Task class: ${input.workerClass}.`,
      "",
      input.task,
    ].join("\n");
  }
  const inboxCommand = [
    "hive-transfer inbox",
    input.machine.device?.machineId ? `--machine ${shellArg(input.machine.device.machineId)}` : "",
    input.agent.runtime ? `--runtime ${shellArg(input.agent.runtime)}` : "",
    (input.agent.agentId || input.agent.id) ? `--agent ${shellArg(input.agent.agentId || input.agent.id)}` : "",
  ].filter(Boolean).join(" ");
  return [
    "HivemindOS file-and-task handoff.",
    `Transfer id: ${transfer.id}`,
    `Task class: ${input.workerClass}.`,
    input.note ? `Sender note: ${input.note}` : "",
    "",
    "For this initial handoff response, acknowledge receipt immediately instead of blocking on sync. Then, as your next work step, wait for the synced payload to appear locally and inspect it with:",
    inboxCommand,
    "",
    "After you have read or copied the payload, acknowledge it with:",
    `hive-transfer ack ${shellArg(transfer.id)} ${input.machine.device?.machineId ? `--machine ${shellArg(input.machine.device.machineId)}` : ""} --runtime ${shellArg(input.agent.runtime)} --agent ${shellArg(input.agent.agentId || input.agent.id)}`.replace(/\s+/g, " ").trim(),
    "",
    "User task:",
    input.task,
  ].filter(Boolean).join("\n");
}

function publicMachine(machine: FleetMachine) {
  return {
    key: machine.key,
    name: machineName(machine),
    os: machine.device?.os,
    self: machine.device?.self === true,
    machineId: machine.device?.machineId,
    capabilities: {
      chat: machine.capabilities?.chat,
      fileTransfers: machine.capabilities?.fileTransfers,
      runtimes: machine.capabilities?.runtimes ?? [],
    },
    agents: (machine.agents ?? []).slice(0, 12).map(publicAgent),
  };
}

function publicAgent(agent: AgentProfile) {
  return {
    id: agent.id,
    agentId: agent.agentId,
    name: agent.name,
    runtime: agent.runtime,
    beeRole: agent.beeRole ?? "worker",
    workerClass: agent.workerClass ?? "general",
  };
}

function machineName(machine: FleetMachine) {
  return machine.device?.name || machine.device?.host || machine.device?.hostname || machine.key || "machine";
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = right.split(/\s+/).filter(Boolean);
  return rightTokens.filter((token) => leftTokens.has(token)).length;
}

function levenshtein(left: string, right: string) {
  const dp = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let index = 1; index <= right.length; index += 1) dp[0][index] = index;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      dp[row][column] = Math.min(
        dp[row - 1][column] + 1,
        dp[row][column - 1] + 1,
        dp[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return dp[left.length][right.length];
}

function shellArg(value: string) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function handoffError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}
