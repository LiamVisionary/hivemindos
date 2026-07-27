import { z } from "zod";

import { AZURE_MARKETPLACE_DEPLOY_CONFIRMATION } from "@/lib/services/hivemindos-machines-contract";
import { AZURE_REFRESH_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";
import { defineHiveAction } from "../define";

export const hivemindosMachinesCatalogAction = defineHiveAction({
  id: "machines.hivemindos-catalog",
  title: "Read HivemindOS Machines plans",
  description: "Read the official Microsoft Azure Marketplace machine plans, software fees, publisher availability, and billing boundary without deploying anything.",
  schema: z.object({}),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["machine", "azure", "marketplace", "virtual machine", "cloud", "pricing", "microsoft billing"],
  aliases: ["HivemindOS Machines", "Azure machine plans", "Azure Marketplace VMs", "new machine pricing"],
  mcp: { expose: true, compact: true, toolName: "hivemindos_machine_plans" },
  contextIndex: {
    summary: "Official read-only HivemindOS Machines plan and Microsoft billing catalog.",
    retrievalText: "Use hivemindos_machine_plans before recommending or deploying a HivemindOS Machine. It reads server-owned plan fees and publisher status. Azure infrastructure is billed separately to the user's Azure subscription. It never creates a resource or accepts Marketplace terms.",
    route: "/api/hivemindos-machines/azure",
    methods: ["GET"],
  },
});

export const deployHivemindosMachineAction = defineHiveAction({
  id: "machines.hivemindos-deploy",
  title: "Deploy a HivemindOS Machine",
  description: "Accept the official plan terms and deploy a HivemindOS Marketplace VM, disk, network, and public IP into the connected user's Azure subscription.",
  schema: z.object({
    action: z.literal("deploy").default("deploy"),
    subscriptionId: z.string().uuid(),
    resourceGroup: z.string().min(1).max(90),
    location: z.string().min(2).max(40),
    machineName: z.string().min(1).max(64),
    planId: z.enum(["starter", "builder", "swarm"]),
    acceptMarketplaceTerms: z.literal(true),
    confirmation: z.literal(AZURE_MARKETPLACE_DEPLOY_CONFIRMATION),
  }),
  sideEffects: ["write", "network", "remote-machine", "payment"],
  risk: "high",
  tags: ["machine", "azure", "marketplace", "deploy", "virtual machine", "cloud", "microsoft billing"],
  aliases: ["deploy HivemindOS Machine", "create Azure VM", "new Azure machine", "launch cloud machine"],
  requiresConnection: [AZURE_REFRESH_TOKEN_ENV],
  confirmation: {
    token: AZURE_MARKETPLACE_DEPLOY_CONFIRMATION,
    reason: "Deployment accepts Microsoft Marketplace terms and creates billable Azure VM, disk, network, and public-IP resources in the user's subscription.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "deploy_hivemindos_machine" },
  contextIndex: {
    summary: "Confirmation-gated Azure Marketplace deployment into the user's own subscription.",
    retrievalText: `First call hivemindos_machine_plans and show the selected HivemindOS hourly software fee separately from variable Azure infrastructure. Deploy only after explicit confirmation ${AZURE_MARKETPLACE_DEPLOY_CONFIRMATION}. The request accepts Marketplace terms and creates a VM, Standard SSD, VNet, network security group, NIC, and Standard public IPv4 in the user's subscription. Azure pay-as-you-go has no universal hard cap and stopped machines can retain disk/IP charges.`,
    route: "/api/hivemindos-machines/azure",
    methods: ["POST"],
  },
});
