import { z } from "zod";

import { APP_BUILDER_CONFIRMATIONS } from "@/lib/services/app-builder/contract";
import { defineHiveAction } from "./define";

export const appBuilderAction = defineHiveAction({
  id: "apps.build",
  title: "Build HivemindOS app",
  description:
    "List, create, inspect, edit, install, start, stop, and preview app projects on a selected local/fleet machine, or create and inspect projects on a managed cloud agent.",
  schema: z.object({
    action: z.enum([
      "list",
      "create",
      "get",
      "status",
      "files_tree",
      "files_read",
      "files_write",
      "files_rename",
      "files_delete",
      "install",
      "start",
      "stop",
      "artifact_prepare",
      "test_deploy",
      "hosting_catalog",
      "hosting_list",
      "hosting_get",
      "hosting_publish",
      "hosting_renew",
      "hosting_unpublish",
    ]),
    backend: z.enum(["local", "managed"]).default("local"),
    projectId: z.string().optional(),
    directory: z.string().optional(),
    name: z.string().optional(),
    templateId: z.literal("nextjs").optional(),
    path: z.string().optional(),
    nextPath: z.string().optional(),
    content: z.string().optional(),
    port: z.number().int().min(1024).max(65535).optional(),
    machineKey: z.string().optional(),
    collectorUrl: z.string().url().optional(),
    managedAgentId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    siteId: z.string().optional(),
    slug: z.string().optional(),
    planId: z.string().optional(),
    autoRenew: z.boolean().optional(),
    runtime: z.enum(["static", "dynamic"]).optional(),
    confirmation: z.string().optional(),
  }),
  sideEffects: ["read", "write", "filesystem", "network", "remote-machine"],
  risk: "high",
  tags: ["app-builder", "website", "code", "project", "local", "managed-cloud", "preview", "hosting", "publish", "files"],
  aliases: ["app_builder", "build an app", "create a website", "lovable", "replit", "start app preview", "publish a site", "host a website"],
  confirmation: {
    tokens: [...new Set(Object.values(APP_BUILDER_CONFIRMATIONS))],
    reason:
      "Project creation, dependency installation, file mutation, runtime start/stop, external temporary deployment, paid hosting purchase or renewal, unpublishing, and deletion require explicit confirmation. Read-only actions need no confirmation.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "app_builder" },
  contextIndex: {
    summary: "Build and run local-first or managed HivemindOS app projects through one backend-neutral contract.",
    retrievalText:
      "Use app_builder for Replit/Lovable-style app work. Prefer backend=local for an agent running on a user's machine. test_deploy creates a confirmation-gated 60-minute workers.dev deployment through Cloudflare Temporary Accounts. hosting_publish purchases branded HivemindOS hosting from the server-owned plan catalog using stored hosted credits; hosting_renew and hosting_unpublish manage that entitlement. Managed agents are optional and use the same hosting service after preparing their artifact.",
    route: "/api/app-builder",
    methods: ["GET", "POST"],
  },
});
