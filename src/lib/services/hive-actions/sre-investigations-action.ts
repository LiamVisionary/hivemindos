import { z } from "zod";
import { defineHiveAction } from "./define";

export const sreInvestigationsAction = defineHiveAction({
  id: "ops.investigate-incident",
  title: "Investigate an operational incident",
  description:
    "Capture a redacted incident bundle and request a bounded, read-only root-cause investigation from the configured local SRE provider. Returned remediation steps are recommendations only and never execute automatically.",
  schema: z.object({
    action: z.enum(["status", "list", "get", "investigate", "retry"]).optional(),
    incidentId: z.string().optional(),
    limit: z.number().int().min(1).max(250).optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    severity: z.enum(["info", "warning", "critical"]).optional(),
    source: z.enum(["fleet-watchdog", "manual", "api", "synthetic"]).optional(),
    target: z.object({ key: z.string().optional(), name: z.string().optional(), kind: z.string().optional() }).optional(),
    symptoms: z.array(z.string()).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    remediationAttempts: z.array(z.object({ action: z.string(), outcome: z.string(), at: z.string().optional() })).optional(),
    correlationId: z.string().optional(),
    enqueue: z.boolean().optional(),
  }),
  sideEffects: ["write", "filesystem", "network"],
  risk: "medium",
  tags: ["sre", "incident", "root-cause", "operations", "watchdog", "opensre", "mcp"],
  aliases: ["investigate_incident", "incident RCA", "root cause analysis", "SRE investigation"],
  mcp: { expose: true, compact: true, toolName: "investigate_incident" },
  contextIndex: {
    summary: "Capture, inspect, or retry a bounded operational root-cause investigation.",
    retrievalText:
      "Use investigate_incident for operational root-cause analysis after a service, fleet target, collector, runtime, or automation remains unhealthy. HivemindOS stores a redacted bounded incident bundle and can send it to the pinned loopback OpenSRE sidecar. OpenSRE has no remediation authority: every returned step is a recommendation and any consequential follow-up must pass normal HivemindOS approval and policy gates.",
    route: "/api/ops/investigations",
    methods: ["GET", "POST"],
  },
});
