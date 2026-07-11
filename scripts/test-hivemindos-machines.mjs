#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const modal = read("src/features/dashboard/views/MachineInitModal.tsx");
const azureModal = read("src/features/dashboard/views/AzureMarketplaceMachineModal.tsx");
const contract = read("src/lib/services/hivemindos-machines-contract.ts");
const service = read("src/lib/services/hivemindos-machines.ts");
const route = read("src/app/api/hivemindos-machines/azure/route.ts");
const actions = read("src/lib/services/hive-actions/integrations/hivemindos-machines.ts");
const privateRoot = resolve(root, "../hivemind-cloud-services/workers/managed-agent-control-plane");
const privateCatalog = readFileSync(resolve(privateRoot, "src/azure-marketplace.ts"), "utf8");
const privateRoutes = readFileSync(resolve(privateRoot, "src/routes.ts"), "utf8");

assert.match(modal, /HivemindOS Machine/);
assert.match(modal, /Bring your own Hetzner/);
assert.match(modal, /No 114 MB MCP install/);
assert.match(azureModal, /Microsoft bills the user/);
assert.match(azureModal, /Azure infrastructure is one line item/);
assert.match(azureModal, /do not have a universal hard spending cap/);
assert.match(azureModal, /window\.confirm/);
assert.match(azureModal, /AZURE_MARKETPLACE_DEPLOY_CONFIRMATION/);

assert.match(contract, /OFFICIAL_HIVEMINDOS_MACHINES_BASE_URL/);
assert.match(contract, /customer_azure_subscription/);
assert.doesNotMatch(contract, /softwareUsdPerHour:\s*0\./);
assert.match(service, /Microsoft\.MarketplaceOrdering/);
assert.match(service, /method: "PUT"/);
assert.match(service, /plan: \{ name: plan\.marketplacePlanId, publisher: catalog\.publisherId, product: catalog\.offerId \}/);
assert.match(service, /confirmation !== AZURE_MARKETPLACE_DEPLOY_CONFIRMATION/);
assert.match(service, /StandardSSD_LRS/);
assert.match(service, /deleteOption: "Delete"/);
assert.doesNotMatch(service, /input\.softwareUsdPerHour/);
assert.doesNotMatch(service, /input\.publisherId/);
assert.doesNotMatch(service, /input\.marketplacePlanId/);
assert.match(route, /requireAuth/);
assert.match(route, /deployAzureMarketplaceMachine/);
assert.match(actions, /hivemindos_machine_plans/);
assert.match(actions, /deploy_hivemindos_machine/);
assert.match(actions, /sideEffects: \["write", "network", "remote-machine", "payment"\]/);
assert.match(actions, /AZURE_MARKETPLACE_DEPLOY_CONFIRMATION/);

assert.match(privateRoutes, /\/v1\/marketplace\/azure\/catalog/);
assert.match(privateCatalog, /softwareUsdPerHour: 0\.04/);
assert.match(privateCatalog, /softwareUsdPerHour: 0\.08/);
assert.match(privateCatalog, /softwareUsdPerHour: 0\.16/);
assert.match(privateCatalog, /microsoftStoreFeePercent: 3/);
assert.match(privateCatalog, /publisherSharePercentBeforeTax: 97/);
assert.doesNotMatch(privateCatalog, /process\.env/);

console.log("HivemindOS Machines provider, Marketplace billing boundary, and Azure deployment checks passed.");
