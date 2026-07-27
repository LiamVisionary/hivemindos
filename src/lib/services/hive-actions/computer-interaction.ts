import { z } from "zod";
import { defineHiveAction } from "./define";

export const computerInteractionAction = defineHiveAction({
  id: "computer.interaction",
  title: "Governed computer interaction",
  description: "Start, inspect, step, pause, resume, approve, or stop a durable computer-interaction run. The runtime prefers semantic and DOM adapters, binds actions to fresh observations, pauses on prompt injection, and requires immediate approval before consequential actions.",
  schema: z.object({
    action: z.enum(["start", "step", "approve", "pause", "resume", "stop", "get"]),
    runId: z.string().optional(),
    goal: z.string().optional(),
    adapters: z.array(z.enum(["hive-action", "bee-pilot", "page-agent", "browser-use", "screenshot"])).optional(),
    policy: z.record(z.string(), z.unknown()).optional(),
    limits: z.record(z.string(), z.unknown()).optional(),
    adapterContext: z.object({ browserSession: z.string().optional() }).strict().optional(),
    interactionAction: z.record(z.string(), z.unknown()).optional(),
    observation: z.record(z.string(), z.unknown()).optional(),
    reportedResult: z.record(z.string(), z.unknown()).optional(),
    approvalId: z.string().optional(),
    reason: z.string().optional(),
    confirmation: z.string().optional(),
  }).strict(),
  sideEffects: ["read", "write", "network"],
  risk: "high",
  tags: ["computer", "browser", "automation", "interaction", "page-agent", "bee-pilot", "safety", "receipts"],
  aliases: ["computer_interaction", "computer use", "browser automation", "operate the dashboard"],
  confirmation: {
    token: "CONFIRM_COMPUTER_INTERACTION",
    reason: "Starting or advancing a computer-interaction run can operate a browser or dashboard. The run adds a second, action-level consequence gate before external submissions, sends, purchases, transfers, deletes, uploads, installs, or code execution.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "computer_interaction" },
  contextIndex: {
    summary: "Governed, observable, resumable browser and dashboard interaction.",
    retrievalText: "Use computer_interaction when the user wants HivemindOS to operate a dashboard, web page, or browser. Prefer Hive Actions and Bee Pilot for semantic tasks, Page Agent for in-dashboard DOM tasks, Browser Use for general browser element control, and screenshots only as a fallback. Start with allowed domains/apps and bounded steps/runtime/cost; use the returned observation id for each step; stop at awaiting-approval and present the exact consequence before calling approve.",
    route: "/api/computer-interaction",
    methods: ["GET", "POST"],
  },
});
