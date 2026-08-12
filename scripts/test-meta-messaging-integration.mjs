#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");

const [
  manifests,
  connections,
  modalStyles,
  metaService,
  metaOauth,
  companyRoute,
  companyStore,
  companyTypes,
  companyPanel,
  cockpit,
  orchestration,
  projectInstructions,
] = await Promise.all([
  read("src/lib/services/integrations/connector-manifests.ts"),
  read("src/features/integrations/ConnectionsPanel.tsx"),
  read("src/features/integrations/integrations-redesign.css"),
  read("src/lib/services/integrations/meta-messaging.ts"),
  read("src/lib/services/integrations/meta-messaging-oauth.ts"),
  read("src/app/api/companies/route.ts"),
  read("src/lib/services/companies-store.ts"),
  read("src/lib/types/company.ts"),
  read("src/features/dashboard/views/zero-human-companies/CompanyConnectionsPanel.tsx"),
  read("src/features/dashboard/views/zero-human-companies/Cockpit.tsx"),
  read("src/lib/services/companies-orchestration.ts"),
  read("AGENTS.md"),
]);

assert.match(manifests, /key: "meta-messaging"/, "Meta Messaging is a first-class Integrations provider");
assert.match(manifests, /Message sync and replies are not implemented yet/, "the provider states its current setup-only boundary");
assert.doesNotMatch(manifests, /read-meta-inbox|send-meta-reply/, "the capability index does not advertise unimplemented Meta operations");
assert.match(connections, /"meta-messaging": "\/api\/integrations\/meta-messaging\/oauth\/start"/, "the Integrations modal can start hosted Meta OAuth");
assert.match(connections, /Manual Page-token setup/, "self-hosted builds retain a usable but collapsed Page-token setup path");
assert.match(connections, /export function ConnectionSetupModal/, "provider setup is a reusable component rather than an Integrations-only screen");
assert.match(connections, /createPortal[\s\S]*className="fr-root fm-overlay"/, "provider setup is portaled to a theme-scoped viewport overlay");
assert.match(connections, /does not yet sync or send its messages/, "the global setup does not overstate Meta's current usefulness");
assert.match(modalStyles, /\.fm-overlay \{ position: fixed;[\s\S]*\.fm-modal \{[\s\S]*100dvh[\s\S]*\.fm-mbody \{[\s\S]*overflow-y: auto/, "the modal is viewport-bound with internal scrolling");
assert.match(metaService, /saveMetaMessagingManualConnection/, "manual connections are validated through the Meta service");
assert.match(metaService, /saveSharedAgentEnvValues\(values\)/, "tokens and the reusable account directory stay in shared env storage");
assert.match(metaOauth, /\/meta\/start[\s\S]*\/meta\/result/, "the client uses an exact-match hosted rendezvous instead of shipping a Meta secret");

assert.match(companyRoute, /action === "set-integration-binding"/, "the company API exposes an authoritative binding mutation");
assert.match(companyRoute, /metaMessagingConnectionStatuses[\s\S]*entry\.id === connectionId/, "company binding IDs must resolve to a live connected Meta account");
assert.match(companyStore, /setCompanyIntegrationBinding[\s\S]*connectionId/, "the company store persists a named connection reference");
assert.doesNotMatch(companyTypes.match(/export interface CompanyIntegrationBinding[\s\S]*?\n}/)?.[0] ?? "", /token|secret/i, "company definitions never copy provider credentials");

assert.match(cockpit, /key: "connections", label: "Connections"/, "every Zero Human Company has a Connections tab");
assert.match(companyPanel, /does not add a working outreach channel yet/, "the company UI states that Meta is not a working outreach channel");
assert.match(companyPanel, /action: "set-integration-binding"/, "the picker saves through the company API rather than browser-only state");
assert.match(companyPanel, /<ConnectionSetupModal/, "the company view mounts the canonical Meta setup flow in place");
assert.doesNotMatch(companyPanel, /return here|main Integrations screen|href=.*integrations/i, "company setup never sends the user to another view");
assert.match(orchestration, /use these exact connection ids, never another company's account/, "dispatched company agents receive the selected account boundary");
assert.match(orchestration, /Meta Messaging is setup-only in this build/, "company agents cannot reinterpret saved Meta credentials as an implemented channel");
assert.match(projectInstructions, /Never tell a user to leave the current view and navigate elsewhere to complete setup/, "the project contract requires in-context setup");
assert.match(projectInstructions, /Setup logic must have one source of truth/, "the project contract requires reusable canonical setup components");

console.log("Meta Messaging integration contract passed.");
