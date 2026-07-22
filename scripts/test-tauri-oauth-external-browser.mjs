#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const integrationsView = readFileSync("src/features/integrations/IntegrationsView.tsx", "utf8");
assert.match(integrationsView, /import \{ openExternalUrl \} from "@\/lib\/native\/open-external-url";/);
assert.match(integrationsView, /MANAGED_X_RETURN_EVENT/);
assert.match(integrationsView, /listen<ManagedXReturnPayload>\(MANAGED_X_RETURN_EVENT/);
assert.match(integrationsView, /setTab\("mcp"\)/);
assert.match(integrationsView, /setManagedXReturnPoll/);
assert.match(integrationsView, /desktop-return-pending/);
assert.match(integrationsView, /HivemindOS will refresh automatically/);
assert.match(integrationsView, /managedXStatusContext/);
assert.match(integrationsView, /managedXStatusUrl\(managedTarget\.creditAccountId, managedTarget\.slug\)/);
assert.match(integrationsView, /await openExternalUrl\(data\.authorizationUrl\)/);
assert.doesNotMatch(integrationsView, /window\.location\.assign\(data\.authorizationUrl\)/);

const integrationsHelpers = readFileSync("src/features/integrations/integrations-view-helpers.ts", "utf8");
assert.match(integrationsHelpers, /managedXReturnUrl/);

const managedXOAuthReturn = readFileSync("src/lib/services/managed-x-oauth-return.ts", "utf8");
assert.match(managedXOAuthReturn, /isTauriDesktopRuntime/);
assert.match(managedXOAuthReturn, /\/api\/integrations\/x-managed\/desktop-return/);
assert.match(managedXOAuthReturn, /x_return_view/);
assert.match(managedXOAuthReturn, /x_return_scheme", "hivemindos-dev"/);
assert.match(managedXOAuthReturn, /view", view/);
assert.match(managedXOAuthReturn, /tab", "mcp"/);

const managedXReturnService = readFileSync("src/lib/services/managed-x-return.ts", "utf8");
assert.match(managedXReturnService, /hivemindos:managed-x-return/);
assert.match(managedXReturnService, /\$\{scheme\}:\/\/\$\{returnView\}\/x-managed/);
assert.match(managedXReturnService, /"hivemindos-dev" \? "hivemindos-dev" : "hivemindos"/);
assert.match(managedXReturnService, /"socials" : "integrations"/);
assert.match(managedXReturnService, /x_credit_account_id/);
assert.match(managedXReturnService, /x_slug/);

const managedXDesktopReturnRoute = readFileSync("src/app/api/integrations/x-managed/desktop-return/route.ts", "utf8");
assert.match(managedXDesktopReturnRoute, /storeManagedXDesktopReturn/);
assert.match(managedXDesktopReturnRoute, /Return received/);
assert.match(managedXDesktopReturnRoute, /managedXDeepLinkFromSearchParams/);
assert.match(managedXDesktopReturnRoute, /window\.location\.replace/);
assert.match(managedXDesktopReturnRoute, /Open HivemindOS/);

const socialsModal = readFileSync("src/components/socials/ConnectAccountModal.tsx", "utf8");
assert.match(socialsModal, /managedXReturnUrl/);
assert.match(socialsModal, /managedXReturnUrl\(managedCreditAccountId, managedCreditSlug, "socials"\)/);
assert.doesNotMatch(socialsModal, /returnUrl: window\.location\.href/);
assert.match(socialsModal, /MANAGED_X_RETURN_EVENT/);
assert.match(socialsModal, /desktop-return-pending/);

const managedXDesktopReturnPendingRoute = readFileSync("src/app/api/integrations/x-managed/desktop-return-pending/route.ts", "utf8");
assert.match(managedXDesktopReturnPendingRoute, /latestManagedXDesktopReturn/);
assert.match(managedXDesktopReturnPendingRoute, /okJson\(\{ returned \}\)/);

const managedXDesktopReturnStore = readFileSync("src/lib/services/managed-x-desktop-return-store.ts", "utf8");
assert.match(managedXDesktopReturnStore, /storeManagedXDesktopReturn/);
assert.match(managedXDesktopReturnStore, /latestManagedXDesktopReturn/);
assert.match(managedXDesktopReturnStore, /RETURN_TTL_MS = 10 \* 60_000/);

const connectionsPanel = readFileSync("src/features/integrations/ConnectionsPanel.tsx", "utf8");
assert.match(connectionsPanel, /import \{ openExternalUrl \} from "@\/lib\/native\/open-external-url";/);
assert.match(connectionsPanel, /google: "\/api\/integrations\/google\/oauth\/start"/);
assert.match(connectionsPanel, /async function startOAuthConnect\(\)/);
assert.match(connectionsPanel, /fetch\(oauthUrl as string,\s*\{\s*method: "POST"/s);
assert.match(connectionsPanel, /await openExternalUrl\(data\.authorizationUrl\)/);
// Google (and the other OAuth-client providers) must route through
// startOAuthConnect → openExternalUrl, never an in-window navigation.
assert.match(connectionsPanel, /const usesOAuthClient = isGoogle \|\| isGoogleCloud \|\| isSlack \|\| isAzure/);
assert.match(connectionsPanel, /usesOAuthClient \? void startOAuthConnect\(\) : window\.location\.assign\(oauthUrl\)/);
assert.doesNotMatch(connectionsPanel, /window\.location\.assign\(OAUTH_START_URL\.google/);

const googleStartRoute = readFileSync("src/app/api/integrations/google/oauth/start/route.ts", "utf8");
assert.match(googleStartRoute, /export async function POST\(request: NextRequest\)/);
assert.match(googleStartRoute, /requireAuth\(request\)/);
assert.match(googleStartRoute, /authorizationUrl: authorizeUrl\.toString\(\)/);
assert.match(googleStartRoute, /NextResponse\.redirect\(authorizeUrl\)/);

const managedXClient = readFileSync("src/lib/services/managed-x-api-client.ts", "utf8");
assert.match(managedXClient, /DEFAULT_MANAGED_X_OAUTH_SCOPES = "tweet\.read users\.read tweet\.write offline\.access"/);
assert.doesNotMatch(managedXClient, /DEFAULT_MANAGED_X_OAUTH_SCOPES = .*dm\\.write/);
assert.doesNotMatch(managedXClient, /DEFAULT_MANAGED_X_OAUTH_SCOPES = .*media\\.write/);

const proxy = readFileSync("src/proxy.ts", "utf8");
const allowlist = proxy.match(/SELF_AUTHENTICATING_API_PREFIXES = \[[\s\S]*?\]/)?.[0] ?? "";
assert.match(allowlist, /"\/api\/integrations\/google\/oauth\/callback"/);
assert.match(allowlist, /"\/api\/integrations\/x-managed\/desktop-return"/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/x-managed\/desktop-return-pending"/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/google\/oauth\/start"/);

const tauriDesktopNavigation = readFileSync("src-tauri/src/desktop_navigation.rs", "utf8");
assert.match(tauriDesktopNavigation, /hivemindos:managed-x-return/);
assert.match(tauriDesktopNavigation, /host == "integrations" && path == "x-managed"/);
assert.match(tauriDesktopNavigation, /host == "socials" && path == "x-managed"/);
assert.match(tauriDesktopNavigation, /"view": return_view/);
assert.match(tauriDesktopNavigation, /"creditAccountId": query_value\(&url, "x_credit_account_id"\)/);

const macInfoPlist = readFileSync("src-tauri/Info.plist", "utf8");
assert.match(macInfoPlist, /<key>CFBundleURLTypes<\/key>/);
assert.match(macInfoPlist, /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>hivemindos<\/string>/);
assert.doesNotMatch(macInfoPlist, /<string>hivemindos-dev<\/string>/);

const tauriConfig = readFileSync("src-tauri/tauri.conf.json", "utf8");
assert.match(tauriConfig, /"schemes": \["hivemindos"\]/);

const tauriDevConfig = readFileSync("src-tauri/tauri.dev.conf.json", "utf8");
assert.match(tauriDevConfig, /"schemes": \["hivemindos-dev"\]/);

const tauriDevLauncher = readFileSync("scripts/tauri-dev-signed.mjs", "utf8");
assert.match(tauriDevLauncher, /tauri\.dev\.conf\.json/);
assert.match(tauriDevLauncher, /'--config', devConfig/);

const devRunner = readFileSync("scripts/dev-codesign-runner.sh", "utf8");
assert.match(devRunner, /LaunchServices\.framework\/Support\/lsregister/);
assert.match(devRunner, /"\$LAUNCH_SERVICES_REGISTER" -f "\$BUNDLE"/);
assert.match(devRunner, /configure_dev_url_scheme/);
assert.match(devRunner, /CFBundleURLSchemes:0 string hivemindos-dev/);

console.log("Tauri OAuth external browser checks passed.");
