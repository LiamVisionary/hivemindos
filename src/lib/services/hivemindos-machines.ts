import "server-only";

import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { homedir } from "@/lib/home-dir";
import { mintAzureAccessToken } from "@/lib/services/integrations/azure-oauth";
import {
  AZURE_MARKETPLACE_DEPLOY_CONFIRMATION,
  OFFICIAL_HIVEMINDOS_MACHINES_BASE_URL,
  assertAzureMarketplaceMachineCatalog,
  type AzureMarketplaceMachineCatalog,
  type AzureMarketplaceMachinePlan,
} from "@/lib/services/hivemindos-machines-contract";

const ARM_ORIGIN = "https://management.azure.com";
const SUBSCRIPTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_GROUP = /^[a-z0-9._()-]{1,90}$/i;
const LOCATION = /^[a-z0-9]{2,40}$/;
const MACHINE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DEPLOYMENT_API_VERSION = "2025-04-01";
const RESOURCE_GROUP_API_VERSION = "2021-04-01";
const MARKETPLACE_ORDERING_API_VERSION = "2021-01-01";

type JsonObject = Record<string, unknown>;

export type AzureMarketplaceDeploymentInput = {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  machineName: string;
  planId: AzureMarketplaceMachinePlan["id"];
  confirmation?: string;
  acceptMarketplaceTerms?: boolean;
};

export type AzureMarketplaceDeployment = {
  subscriptionId: string;
  resourceGroup: string;
  deploymentName: string;
  machineName: string;
  provisioningState: string;
  portalUrl: string;
  sshPrivateKeyPath: string;
};

function cleanInput(input: AzureMarketplaceDeploymentInput) {
  const subscriptionId = input.subscriptionId.trim();
  const resourceGroup = input.resourceGroup.trim();
  const location = input.location.trim().toLowerCase();
  const machineName = input.machineName.trim().toLowerCase();
  if (!SUBSCRIPTION_ID.test(subscriptionId)) throw new Error("A valid Azure subscription is required.");
  if (!RESOURCE_GROUP.test(resourceGroup) || resourceGroup.endsWith(".")) throw new Error("Use a valid Azure resource-group name.");
  if (!LOCATION.test(location)) throw new Error("Use a canonical Azure location such as eastus or southeastasia.");
  if (!MACHINE_NAME.test(machineName)) throw new Error("Machine names may contain lowercase letters, numbers, and internal hyphens.");
  return { subscriptionId, resourceGroup, location, machineName };
}

async function jsonResponse(response: Response): Promise<JsonObject> {
  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (response.ok) return payload;
  const upstream = payload.error && typeof payload.error === "object" ? payload.error as JsonObject : payload;
  throw new Error(String(upstream.message || upstream.error || `Azure returned HTTP ${response.status}.`).slice(0, 800));
}

async function azureRequest(path: string, init: RequestInit = {}): Promise<JsonObject> {
  const token = await mintAzureAccessToken();
  return jsonResponse(await fetch(`${ARM_ORIGIN}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(120_000),
  }));
}

export async function getAzureMarketplaceMachineCatalog(): Promise<AzureMarketplaceMachineCatalog> {
  const response = await fetch(`${OFFICIAL_HIVEMINDOS_MACHINES_BASE_URL}/v1/marketplace/azure/catalog`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) throw new Error(String(payload.error || `HivemindOS Machines returned HTTP ${response.status}.`));
  return assertAzureMarketplaceMachineCatalog(payload.catalog);
}

async function marketplaceTermsAccepted(subscriptionId: string, catalog: AzureMarketplaceMachineCatalog, plan: AzureMarketplaceMachinePlan) {
  const publisher = encodeURIComponent(catalog.publisherId || "");
  const offer = encodeURIComponent(catalog.offerId || "");
  const sku = encodeURIComponent(plan.marketplacePlanId);
  const terms = await azureRequest(`/subscriptions/${subscriptionId}/providers/Microsoft.MarketplaceOrdering/offerTypes/virtualmachine/publishers/${publisher}/offers/${offer}/plans/${sku}/agreements/current?api-version=${MARKETPLACE_ORDERING_API_VERSION}`);
  return Boolean((terms.properties as JsonObject | undefined)?.accepted);
}

async function acceptMarketplaceTerms(subscriptionId: string, catalog: AzureMarketplaceMachineCatalog, plan: AzureMarketplaceMachinePlan) {
  const publisher = encodeURIComponent(catalog.publisherId || "");
  const offer = encodeURIComponent(catalog.offerId || "");
  const sku = encodeURIComponent(plan.marketplacePlanId);
  await azureRequest(`/subscriptions/${subscriptionId}/providers/Microsoft.MarketplaceOrdering/agreements/${publisher}/offers/${offer}/plans/${sku}/sign?api-version=${MARKETPLACE_ORDERING_API_VERSION}`, {
    method: "POST",
  });
}

async function machineSshKey(machineName: string): Promise<{ publicKey: string; privateKeyPath: string }> {
  const keyDirectory = join(homedir(), ".hivemindos", "machines", machineName, "keys");
  const privateKeyPath = join(keyDirectory, machineName);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const rawPublicKey = new Uint8Array(publicKey.subarray(publicKey.length - 32));
  const algorithm = new TextEncoder().encode("ssh-ed25519");
  const blob = new Uint8Array(4 + algorithm.length + 4 + rawPublicKey.length);
  const view = new DataView(blob.buffer);
  view.setUint32(0, algorithm.length);
  blob.set(algorithm, 4);
  view.setUint32(4 + algorithm.length, rawPublicKey.length);
  blob.set(rawPublicKey, 8 + algorithm.length);
  const publicOpenSsh = `ssh-ed25519 ${Buffer.from(blob).toString("base64")} hivemindos-machine`;
  await mkdir(keyDirectory, { recursive: true });
  await writeFile(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 });
  await writeFile(`${privateKeyPath}.pub`, `${publicOpenSsh}\n`, { encoding: "utf8", mode: 0o644 });
  return { publicKey: publicOpenSsh, privateKeyPath };
}

function deploymentTemplate(input: {
  location: string;
  machineName: string;
  catalog: AzureMarketplaceMachineCatalog;
  plan: AzureMarketplaceMachinePlan;
  sshPublicKey: string;
}) {
  const { location, machineName, catalog, plan, sshPublicKey } = input;
  const publicIpName = `${machineName}-ip`;
  const nsgName = `${machineName}-nsg`;
  const vnetName = `${machineName}-vnet`;
  const nicName = `${machineName}-nic`;
  const subnetId = `[resourceId('Microsoft.Network/virtualNetworks/subnets', '${vnetName}', 'default')]`;
  const customData = Buffer.from(`#cloud-config\nwrite_files:\n  - path: /etc/hivemindos-machine.env\n    permissions: '0644'\n    content: |\n      HIVE_MACHINE_NAME=${machineName}\n      HIVE_COLLECTOR_ONLY=true\nruncmd:\n  - [loginctl, enable-linger, hive]\n  - [systemctl, start, user@1000.service]\n  - [runuser, -u, hive, --, env, XDG_RUNTIME_DIR=/run/user/1000, systemctl, --user, restart, agent-telemetry.service]\n`, "utf8").toString("base64");
  return {
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    resources: [
      {
        type: "Microsoft.Network/networkSecurityGroups",
        apiVersion: "2024-05-01",
        name: nsgName,
        location,
        properties: { securityRules: [{ name: "ssh", properties: { protocol: "Tcp", sourcePortRange: "*", destinationPortRange: "22", sourceAddressPrefix: "Internet", destinationAddressPrefix: "*", access: "Allow", priority: 1000, direction: "Inbound" } }] },
      },
      {
        type: "Microsoft.Network/publicIPAddresses",
        apiVersion: "2024-05-01",
        name: publicIpName,
        location,
        sku: { name: "Standard" },
        properties: { publicIPAllocationMethod: "Static" },
      },
      {
        type: "Microsoft.Network/virtualNetworks",
        apiVersion: "2024-05-01",
        name: vnetName,
        location,
        properties: { addressSpace: { addressPrefixes: ["10.42.0.0/16"] }, subnets: [{ name: "default", properties: { addressPrefix: "10.42.0.0/24" } }] },
      },
      {
        type: "Microsoft.Network/networkInterfaces",
        apiVersion: "2024-05-01",
        name: nicName,
        location,
        dependsOn: [`Microsoft.Network/publicIPAddresses/${publicIpName}`, `Microsoft.Network/virtualNetworks/${vnetName}`, `Microsoft.Network/networkSecurityGroups/${nsgName}`],
        properties: { networkSecurityGroup: { id: `[resourceId('Microsoft.Network/networkSecurityGroups', '${nsgName}')]` }, ipConfigurations: [{ name: "primary", properties: { primary: true, privateIPAllocationMethod: "Dynamic", subnet: { id: subnetId }, publicIPAddress: { id: `[resourceId('Microsoft.Network/publicIPAddresses', '${publicIpName}')]` } } }] },
      },
      {
        type: "Microsoft.Compute/virtualMachines",
        apiVersion: "2025-04-01",
        name: machineName,
        location,
        plan: { name: plan.marketplacePlanId, publisher: catalog.publisherId, product: catalog.offerId },
        dependsOn: [`Microsoft.Network/networkInterfaces/${nicName}`],
        tags: { product: "HivemindOS Machines", billing: "Microsoft Marketplace" },
        properties: {
          hardwareProfile: { vmSize: plan.recommendedVmSize },
          storageProfile: { imageReference: { publisher: catalog.publisherId, offer: catalog.offerId, sku: plan.marketplacePlanId, version: catalog.imageVersion }, osDisk: { createOption: "FromImage", deleteOption: "Delete", diskSizeGB: plan.osDiskGb, managedDisk: { storageAccountType: "StandardSSD_LRS" } } },
          osProfile: { computerName: machineName, adminUsername: "hive", customData, linuxConfiguration: { disablePasswordAuthentication: true, provisionVMAgent: true, ssh: { publicKeys: [{ path: "/home/hive/.ssh/authorized_keys", keyData: sshPublicKey }] } } },
          networkProfile: { networkInterfaces: [{ id: `[resourceId('Microsoft.Network/networkInterfaces', '${nicName}')]`, properties: { primary: true } }] },
          diagnosticsProfile: { bootDiagnostics: { enabled: true } },
        },
      },
    ],
    outputs: { publicIpAddress: { type: "string", value: `[reference(resourceId('Microsoft.Network/publicIPAddresses', '${publicIpName}'), '2024-05-01').ipAddress]` } },
  };
}

function deploymentResult(input: { clean: ReturnType<typeof cleanInput>; payload: JsonObject; privateKeyPath: string }): AzureMarketplaceDeployment {
  const properties = input.payload.properties as JsonObject | undefined;
  const deploymentName = `${input.clean.machineName}-hivemindos`;
  return {
    subscriptionId: input.clean.subscriptionId,
    resourceGroup: input.clean.resourceGroup,
    deploymentName,
    machineName: input.clean.machineName,
    provisioningState: String(properties?.provisioningState || "Accepted"),
    portalUrl: `https://portal.azure.com/#resource/subscriptions/${input.clean.subscriptionId}/resourceGroups/${encodeURIComponent(input.clean.resourceGroup)}/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(input.clean.machineName)}/overview`,
    sshPrivateKeyPath: input.privateKeyPath,
  };
}

export async function deployAzureMarketplaceMachine(input: AzureMarketplaceDeploymentInput): Promise<AzureMarketplaceDeployment> {
  if (input.confirmation !== AZURE_MARKETPLACE_DEPLOY_CONFIRMATION) throw new Error(`Cost-incurring deployment requires confirmation ${AZURE_MARKETPLACE_DEPLOY_CONFIRMATION}.`);
  const clean = cleanInput(input);
  const catalog = await getAzureMarketplaceMachineCatalog();
  if (catalog.availability !== "available" || !catalog.publisherId || !catalog.offerId || !catalog.imageVersion) throw new Error("HivemindOS Machines is waiting for Microsoft Marketplace publisher approval and image certification.");
  const plan = catalog.plans.find((candidate) => candidate.id === input.planId);
  if (!plan || !plan.marketplacePlanId) throw new Error("The selected HivemindOS Machines plan is not published.");
  const accepted = await marketplaceTermsAccepted(clean.subscriptionId, catalog, plan);
  if (!accepted) {
    if (!input.acceptMarketplaceTerms) throw new Error("Accept the Microsoft Marketplace terms before deploying this plan.");
    await acceptMarketplaceTerms(clean.subscriptionId, catalog, plan);
  }
  await azureRequest(`/subscriptions/${clean.subscriptionId}/resourcegroups/${encodeURIComponent(clean.resourceGroup)}?api-version=${RESOURCE_GROUP_API_VERSION}`, {
    method: "PUT",
    body: JSON.stringify({ location: clean.location, tags: { product: "HivemindOS Machines" } }),
  });
  const key = await machineSshKey(clean.machineName);
  const deploymentName = `${clean.machineName}-hivemindos`;
  const payload = await azureRequest(`/subscriptions/${clean.subscriptionId}/resourcegroups/${encodeURIComponent(clean.resourceGroup)}/providers/Microsoft.Resources/deployments/${encodeURIComponent(deploymentName)}?api-version=${DEPLOYMENT_API_VERSION}`, {
    method: "PUT",
    body: JSON.stringify({ properties: { mode: "Incremental", template: deploymentTemplate({ location: clean.location, machineName: clean.machineName, catalog, plan, sshPublicKey: key.publicKey }), parameters: {} } }),
  });
  return deploymentResult({ clean, payload, privateKeyPath: key.privateKeyPath });
}

export async function getAzureMarketplaceMachineDeployment(input: Omit<AzureMarketplaceDeploymentInput, "confirmation" | "acceptMarketplaceTerms" | "planId">): Promise<AzureMarketplaceDeployment> {
  const clean = cleanInput({ ...input, planId: "starter" });
  const deploymentName = `${clean.machineName}-hivemindos`;
  const payload = await azureRequest(`/subscriptions/${clean.subscriptionId}/resourcegroups/${encodeURIComponent(clean.resourceGroup)}/providers/Microsoft.Resources/deployments/${encodeURIComponent(deploymentName)}?api-version=${DEPLOYMENT_API_VERSION}`);
  const privateKeyPath = join(homedir(), ".hivemindos", "machines", clean.machineName, "keys", clean.machineName);
  return deploymentResult({ clean, payload, privateKeyPath });
}
