#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  buildBeelinePromptContext,
  createBeelineProfile,
  deleteBeelineProfile,
  readBeelineProfiles,
  resolveBeelineProfile,
  updateBeelineProfile,
} = await import("../src/lib/services/beeline/profile-store.ts");
const {
  listChromeProfiles,
  openChromeProfile,
} = await import("../src/lib/services/beeline/chrome-profiles.ts");
const {
  beelineCalendarCreateAction,
  beelineCalendarListAction,
  beelineBrowserUseAction,
  beelineConnectionsAction,
  beelineMcpCallAction,
  beelineMcpReadAction,
  beelineLocalCredentialsAction,
  beelineLocalCredentialUseAction,
  beelineOpenBrowserAction,
  beelineProfilesAction,
} = await import("../src/lib/services/hive-actions/beeline.ts");

const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-beeline-test-"));
const storagePath = join(tempRoot, "beeline", "profiles.json");
const localStatePath = join(tempRoot, "Local State");

await writeFile(localStatePath, JSON.stringify({
  profile: {
    info_cache: {
      "Profile 1": { name: "Mom", user_name: "mom@example.com", is_using_default_name: false },
      Default: { name: "Liam", user_name: "liam@example.com", is_using_default_name: false },
    },
  },
}));

const chromeProfiles = await listChromeProfiles({ localStatePath });
assert.deepEqual(chromeProfiles.map((profile) => [profile.directory, profile.name]), [
  ["Default", "Liam"],
  ["Profile 1", "Mom"],
]);
assert.ok(chromeProfiles.every((profile) => !("userName" in profile)), "Chrome account email must not leave the server");

const created = await createBeelineProfile({
  displayName: "Maria",
  relationship: "parent",
  aliases: ["mom", "mama"],
  capabilities: ["calendar", "healthcare", "browser"],
  password: "must-never-persist",
  accessToken: "must-never-persist",
}, { storagePath });

assert.equal(created.consent.status, "pending");
assert.equal(created.connections.length, 0);
assert.match(created.id, /^beeline_/);

const pendingResolution = await resolveBeelineProfile("Book my mom a doctor's appointment", { storagePath });
assert.equal(pendingResolution.status, "matched");
assert.equal(pendingResolution.profile?.id, created.id);
assert.match(buildBeelinePromptContext(pendingResolution), /Authorization is not confirmed/);
assert.doesNotMatch(buildBeelinePromptContext(pendingResolution), /mom@example\.com|liam@example\.com/);

const updated = await updateBeelineProfile(created.id, {
  consentStatus: "confirmed",
  browserBinding: {
    browserId: "chrome",
    profileDirectory: "Profile 1",
    profileName: "Mom",
    passwordManager: "keepassxc",
    automationMode: "manual-first",
  },
}, { storagePath });

assert.equal(updated.consent.status, "confirmed");
assert.ok(updated.consent.confirmedAt);
assert.equal(updated.browserBinding?.profileDirectory, "Profile 1");

const confirmedResolution = await resolveBeelineProfile("Please help mama with her calendar", { storagePath });
const promptContext = buildBeelinePromptContext(confirmedResolution);
assert.match(promptContext, /Beeline delegated-person context/);
assert.match(promptContext, /beeline_profiles/);
assert.match(promptContext, /beeline_open_browser/);
assert.match(promptContext, /beeline_connections/);
assert.match(promptContext, /beeline_local_credentials/);
assert.match(promptContext, /beeline_local_credential_use/);
assert.match(promptContext, /beeline_calendar_create/);
assert.match(promptContext, /beeline_mcp_call/);
assert.match(promptContext, /Profile 1/);
assert.match(promptContext, /Never request, reveal, export, or place family credentials/);

const opened = [];
const openResult = await openChromeProfile("Profile 1", {
  localStatePath,
  platform: "darwin",
  chrome: { appName: "Google Chrome", detectedPath: "/Applications/Google Chrome.app" },
  execFile: async (command, args) => opened.push([command, args]),
});
assert.equal(openResult.profile.directory, "Profile 1");
assert.deepEqual(opened, [["open", ["-a", "Google Chrome", "--args", "--profile-directory=Profile 1"]]]);

const storedText = await readFile(storagePath, "utf8");
assert.doesNotMatch(storedText, /"(?:password|refresh[_-]?token|access[_-]?token|cookie|client[_-]?secret)"\s*:/i);
assert.equal((await stat(storagePath)).mode & 0o777, 0o600);
assert.equal((await readBeelineProfiles({ storagePath })).profiles.length, 1);

assert.equal(beelineProfilesAction.readOnly, true);
assert.equal(beelineProfilesAction.mcp?.toolName, "beeline_profiles");
assert.equal(beelineOpenBrowserAction.mcp?.toolName, "beeline_open_browser");
assert.equal(beelineOpenBrowserAction.confirmation?.token, "CONFIRM_BEELINE_BROWSER");
assert.equal(beelineBrowserUseAction.confirmation?.token, "CONFIRM_BEELINE_BROWSER_ACTION");
assert.equal(beelineConnectionsAction.mcp?.toolName, "beeline_connections");
assert.equal(beelineCalendarListAction.readOnly, true);
assert.equal(beelineCalendarCreateAction.confirmation?.token, "CONFIRM_BEELINE_CALENDAR");
assert.equal(beelineMcpReadAction.readOnly, true);
assert.equal(beelineMcpCallAction.confirmation?.token, "CONFIRM_BEELINE_MCP_ACTION");
assert.equal(beelineLocalCredentialsAction.readOnly, true);
assert.equal(beelineLocalCredentialsAction.mcp?.toolName, "beeline_local_credentials");
assert.equal(beelineLocalCredentialUseAction.mcp?.toolName, "beeline_local_credential_use");
assert.equal(beelineLocalCredentialUseAction.confirmation, undefined, "Flexible credentials must not impose a global narrow-operation confirmation");

const second = await createBeelineProfile({
  displayName: "Ana",
  relationship: "parent",
  aliases: ["mom"],
  capabilities: ["calendar"],
}, { storagePath });
const ambiguousResolution = await resolveBeelineProfile("Please help my mom", { storagePath });
assert.equal(ambiguousResolution.status, "ambiguous");
assert.match(buildBeelinePromptContext(ambiguousResolution), /Ask the user which person they mean/);
await deleteBeelineProfile(second.id, { storagePath });

await deleteBeelineProfile(created.id, { storagePath });
assert.equal((await readBeelineProfiles({ storagePath })).profiles.length, 0);

const root = resolve(import.meta.dirname, "..");
const actionRoute = await readFile(join(root, "src/app/api/beeline/actions/route.ts"), "utf8");
const profileRoute = await readFile(join(root, "src/app/api/beeline/profiles/route.ts"), "utf8");
const profileDetailRoute = await readFile(join(root, "src/app/api/beeline/profiles/[id]/route.ts"), "utf8");
const brokerRoute = await readFile(join(root, "src/app/api/beeline/broker/route.ts"), "utf8");
const localCredentialRoute = await readFile(join(root, "src/app/api/beeline/local-credentials/route.ts"), "utf8");
const localCredentialBroker = await readFile(join(root, "src/lib/services/beeline/local-credential-broker.ts"), "utf8");
const localCredentialPanel = await readFile(join(root, "src/features/beeline/BeelineLocalCredentialsPanel.tsx"), "utf8");
const brokerClient = await readFile(join(root, "src/lib/services/beeline/broker-client.ts"), "utf8");
const connectionPanel = await readFile(join(root, "src/features/beeline/BeelineConnectionsPanel.tsx"), "utf8");
const beelineView = await readFile(join(root, "src/features/beeline/BeelineView.tsx"), "utf8");
const beelineStyles = await readFile(join(root, "src/features/beeline/beeline.module.css"), "utf8");
const dashboardApp = await readFile(join(root, "src/features/dashboard/DashboardApp.tsx"), "utf8");
const browserUseRunner = await readFile(join(root, "src/lib/services/browser-use-runner.ts"), "utf8");
const hivemindMcp = await readFile(join(root, "scripts/hivemind-mcp"), "utf8");
const chatRoute = await readFile(join(root, "src/app/api/chat/agent-runtime/route.ts"), "utf8");
assert.match(actionRoute, /verifyAuth\(request\)/);
assert.match(actionRoute, /CONFIRM_BEELINE_BROWSER/);
assert.match(actionRoute, /CONFIRM_BEELINE_BROWSER_ACTION/);
assert.match(actionRoute, /runBrowserUse/);
assert.match(actionRoute, /automationMode !== "trusted-agent"/);
assert.match(profileRoute, /verifyAuth\(request\)/);
assert.match(brokerRoute, /verifyAuth\(request\)/);
assert.match(brokerRoute, /profile\.consent\.status !== "confirmed"/);
assert.match(brokerRoute, /CONFIRM_BEELINE_CALENDAR/);
assert.match(brokerRoute, /CONFIRM_BEELINE_MCP_ACTION/);
assert.match(brokerRoute, /resolveBeelineBrokerCredential/);
assert.match(brokerRoute, /Write actions require an idempotencyKey/);
assert.match(localCredentialRoute, /verifyAuth\(request\)/);
assert.match(localCredentialRoute, /executeLocalBeelineCredential/);
assert.match(localCredentialBroker, /--beeline-credential-broker/);
assert.match(localCredentialBroker, /child\.stdin\.end/);
assert.doesNotMatch(localCredentialBroker, /execFile|shell:\s*true/);
assert.match(localCredentialPanel, /agentUseMode: restricted \? "restricted" : "flexible"/);
assert.match(localCredentialPanel, /type="password"/);
assert.ok(
  profileDetailRoute.indexOf("revokeHostedConnections(id)") < profileDetailRoute.indexOf("deleteBeelineProfile(id)"),
  "Profile deletion must revoke hosted connections before removing the local card",
);
assert.match(brokerClient, /https:\/\/hivemindos-beeline-broker\.hivemindos\.workers\.dev/);
assert.match(brokerClient, /must point to public HivemindOS-controlled infrastructure/);
assert.match(connectionPanel, /type="password"/);
assert.match(connectionPanel, /never token values/);
assert.match(connectionPanel, /if \(payload\.status\)/, "The route must preserve a broker status payload when the hosted service is offline");
assert.match(brokerRoute, /\{ status, credentialConfigured: true, connections: \[\] \}/, "Broker failures must preserve enough read-only state for an honest offline UI");
assert.match(connectionPanel, /onConnectionsChange\(profile\.id, next\.connections\)/, "Capability tiles must receive real hosted connection state");
assert.match(localCredentialPanel, /onCredentialsChange\(profile\.id, next\)/, "Account progress must receive real native credential state");
assert.match(beelineView, /data-testid="beeline-route"/);
assert.match(beelineView, /The people you look after/);
assert.match(beelineView, /BeelineConnectionsPanel/);
assert.match(beelineView, /BeelineLocalCredentialsPanel/);
assert.match(beelineView, /apiJson\("\/api\/beeline\/actions"/);
assert.match(beelineView, /CONFIRM_BEELINE_BROWSER/);
assert.match(beelineView, /<div className=\{styles\.stepBody\} hidden=\{!open\}>/, "Collapsed setup steps must stay mounted so summary state stays live");
assert.match(beelineStyles, /clip-path: polygon\(50% 0%, 100% 25%/, "Family cards must keep the supplied hexagonal visual language");
assert.match(dashboardApp, /<BeelineView agentName=\{queenName\} \/>/, "Beeline copy must use the configured Queen name");
assert.doesNotMatch(beelineView, /const AGENT\s*=|Maria.+Google|Sunrise Care portal/, "The production route must not ship prototype people or account fixtures");
assert.match(browserUseRunner, /REDACTED_TYPED_TEXT/);
for (const toolName of [
  "beeline_profiles",
  "beeline_open_browser",
  "beeline_browser_use",
  "beeline_local_credentials",
  "beeline_local_credential_use",
  "beeline_connections",
  "beeline_calendar_list",
  "beeline_calendar_create",
  "beeline_mcp_read",
  "beeline_mcp_call",
]) assert.match(hivemindMcp, new RegExp(`name === "${toolName}"`));
assert.match(hivemindMcp, /beeline_calendar_create requires confirmation CONFIRM_BEELINE_CALENDAR/);
assert.match(hivemindMcp, /beeline_mcp_call requires confirmation CONFIRM_BEELINE_MCP_ACTION/);
assert.match(chatRoute, /buildBeelineContextForPrompt\(userPrompt\)/);
assert.match(chatRoute, /extraDynamicContext: beelineProfileContext/);

console.log("Beeline profile contract checks passed");
