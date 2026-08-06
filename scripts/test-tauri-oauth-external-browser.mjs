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
assert.match(managedXOAuthReturn, /x_return_tab/);
assert.match(managedXOAuthReturn, /x_return_scheme", "hivemindos-dev"/);
assert.match(managedXOAuthReturn, /view", view/);
assert.match(managedXOAuthReturn, /tab", integrationsTab/);

const managedXReturnService = readFileSync("src/lib/services/managed-x-return.ts", "utf8");
assert.match(managedXReturnService, /hivemindos:managed-x-return/);
assert.match(managedXReturnService, /\$\{scheme\}:\/\/\$\{returnView\}\/x-managed/);
assert.match(managedXReturnService, /"hivemindos-dev" \? "hivemindos-dev" : "hivemindos"/);
assert.match(managedXReturnService, /"socials" : "integrations"/);
assert.match(managedXReturnService, /x_credit_account_id/);
assert.match(managedXReturnService, /x_slug/);
assert.match(managedXReturnService, /returnTab/);

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
assert.match(connectionsPanel, /async function resolveAuthorizationUrl\(\)/);
assert.match(connectionsPanel, /fetch\(oauthUrl as string,\s*\{\s*method: "POST"/s);
assert.match(connectionsPanel, /await openExternalUrl\(authorizationUrl\)/);
// EVERY provider (client-based and not) must route through the authenticated
// POST-start → ExternalSignInButton/openExternalUrl path — never an in-window
// navigation to the same-origin /oauth/start link, which would 401 at the
// proxy for a session-less external browser.
assert.match(connectionsPanel, /<ExternalSignInButton/);
assert.match(connectionsPanel, /resolveUrl=\{resolveAuthorizationUrl\}/);
assert.doesNotMatch(connectionsPanel, /window\.location\.assign\(oauthUrl\)/);
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
// github/linkedin callbacks render in a cookie-less external browser and are
// authenticated by their signed state — they MUST stay proxy-allowlisted or
// every external sign-in return dies with a 401 at the gate.
assert.match(allowlist, /"\/api\/integrations\/github\/oauth\/callback"/);
assert.match(allowlist, /"\/api\/integrations\/linkedin\/oauth\/callback"/);
assert.match(allowlist, /"\/api\/integrations\/x-managed\/desktop-return"/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/x-managed\/desktop-return-pending"/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/google\/oauth\/start"/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/github\/oauth\/start"/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/linkedin\/oauth\/start"/);

// The loopback callback origin must be bind-aware: canonical 127.0.0.1 when
// IPv4 loopback listens, the [::1] literal when only IPv6 does (the founder's
// ERR_CONNECTION_REFUSED trap), never `localhost` (GitHub/Google give
// port-flexible loopback validation only to IP literals).
const githubOAuthService = readFileSync("src/lib/services/integrations/github-oauth.ts", "utf8");
assert.match(githubOAuthService, /export async function localCallbackOrigin/);
assert.match(githubOAuthService, /probeLoopbackListener\("127\.0\.0\.1", port\)/);
assert.match(githubOAuthService, /probeLoopbackListener\("::1", port\)/);
assert.match(githubOAuthService, /!stacks\.v4 && stacks\.v6 \? "\[::1\]" : "127\.0\.0\.1"/);
// Deep-link return: only ever derived from a VERIFIED signed state.
assert.match(githubOAuthService, /export function integrationsOAuthDeepLink/);
assert.match(githubOAuthService, /returnMode: normalizeOAuthReturnMode\(parsed\.rm\)/);

const githubCallback = readFileSync("src/app/api/integrations/github/oauth/callback/route.ts", "utf8");
assert.match(githubCallback, /integrationsOAuthDeepLink\(verifiedState\.returnMode/);
const linkedinCallback = readFileSync("src/app/api/integrations/linkedin/oauth/callback/route.ts", "utf8");
assert.match(linkedinCallback, /integrationsOAuthDeepLink\(verifiedState\.returnMode/);
const googleCallback = readFileSync("src/app/api/integrations/google/oauth/callback/route.ts", "utf8");
assert.match(googleCallback, /integrationsOAuthDeepLink\(verifiedState\.returnMode/);

// The desktop shell routes the generic OAuth return deep link, and unknown
// deep links are FOREGROUND-ONLY (no navigate — a route reset to the default
// view strands the user; and never dropped).
const desktopNavForOAuth = readFileSync("src-tauri/src/desktop_navigation.rs", "utf8");
assert.match(desktopNavForOAuth, /host == "integrations" && path == "oauth-return"/);
assert.match(desktopNavForOAuth, /Unknown deep link: FOREGROUND-ONLY/);

// The callback page attempts the scheme SAME-TAB (href assignment). Never
// window.open/_blank (stranded about:blank window) and never location.replace
// (replacing the only history entry with an unloadable scheme URL blanks the
// tab after the OS hand-off).
assert.match(githubOAuthService, /window\.location\.href = \$\{JSON\.stringify\(input\.deepLink\)/);
assert.doesNotMatch(githubOAuthService, /window\.location\.replace/);
assert.doesNotMatch(githubOAuthService, /window\.open|target="_blank"/);

// Park-and-take: every desktop OAuth callback parks its outcome so the app can
// route back on focus/boot — the only return path INSTALLED shells support
// (their deep-link matcher drops unknown URLs; the scheme only foregrounds).
assert.match(githubCallback, /parkOAuthReturn\(\{ provider: "github", view, status \}\)/);
assert.match(linkedinCallback, /parkOAuthReturn\(\{ provider: "linkedin"/);
assert.match(googleCallback, /parkOAuthReturn\(\{ provider: "google"/);
const googleCloudCallback = readFileSync("src/app/api/integrations/google-cloud/oauth/callback/route.ts", "utf8");
assert.match(googleCloudCallback, /parkOAuthReturn\(\{ provider: "google-cloud"/);

const oauthReturnPendingRoute = readFileSync("src/app/api/integrations/oauth-return-pending/route.ts", "utf8");
assert.match(oauthReturnPendingRoute, /requireAuth\(request\)/);
assert.match(oauthReturnPendingRoute, /takeLatestOAuthReturn\(\)/);
assert.doesNotMatch(allowlist, /"\/api\/integrations\/oauth-return-pending"/);

// The web side takes the parked return on focus/boot and navigates — this is
// what ships to installed shells through the dev servers, no desktop rebuild.
const navigationController = readFileSync("src/features/dashboard/hooks/use-dashboard-navigation-controller.ts", "utf8");
assert.match(navigationController, /\/api\/integrations\/oauth-return-pending/);
assert.match(navigationController, /window\.addEventListener\("focus", takePendingOAuthReturn\)/);
assert.match(navigationController, /if \(view && isDashboardView\(view\)\) navigateDashboardTarget\(\{ view \}\)/);

const tauriDesktopNavigation = readFileSync("src-tauri/src/desktop_navigation.rs", "utf8");
assert.match(tauriDesktopNavigation, /hivemindos:managed-x-return/);
assert.match(tauriDesktopNavigation, /host == "integrations" && path == "x-managed"/);
assert.match(tauriDesktopNavigation, /host == "socials" && path == "x-managed"/);
assert.match(tauriDesktopNavigation, /"view": return_view/);
assert.match(tauriDesktopNavigation, /"integrationsTab": return_tab/);
assert.match(tauriDesktopNavigation, /"returnTab": return_tab/);
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
