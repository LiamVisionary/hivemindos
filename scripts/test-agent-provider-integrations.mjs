import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTERNAL_AGENT_PROVIDERS } from "../src/lib/services/external-agent-providers.ts";
import { searchHiveMcpCatalog } from "../src/lib/services/mcp/catalog.ts";
import { AGENTIC_INBOX_BLUEPRINT } from "../src/lib/services/cloudflare/agentic-inbox-blueprint.ts";

const providerIds = new Set(EXTERNAL_AGENT_PROVIDERS.map((provider) => provider.id));
for (const id of [
  "browser-use",
  "awesome-mcp-servers",
  "cloudflare-agentic-inbox",
  "openhands",
  "aider",
  "n8n",
  "queen-bee-prd-decomposition",
]) {
  assert.ok(providerIds.has(id), `missing provider ${id}`);
}

const browserMcp = searchHiveMcpCatalog("browser forms", 5);
assert.equal(browserMcp[0]?.id, "browser-use");
assert.ok(browserMcp[0]?.credentialKeys.includes("BROWSER_USE_API_KEY"));

const githubMcp = searchHiveMcpCatalog("github pull request", 5);
assert.equal(githubMcp[0]?.id, "github");
assert.ok(githubMcp[0]?.sideEffects.includes("write"));

assert.equal(AGENTIC_INBOX_BLUEPRINT.id, "cloudflare-agentic-inbox");
assert.ok(AGENTIC_INBOX_BLUEPRINT.bindings.some((binding) => binding.kind.includes("R2")));
assert.ok(AGENTIC_INBOX_BLUEPRINT.safetyNotes.some((note) => /auto-send/i.test(note)));

const cliRuntimeSource = readFileSync("src/lib/services/runtime-adapters/cli-runtimes.ts", "utf8");
assert.match(cliRuntimeSource, /openhands[\s\S]*"--headless"[\s\S]*"--json"[\s\S]*"--override-with-envs"[\s\S]*"-t"/);
assert.match(cliRuntimeSource, /aider[\s\S]*"--message"[\s\S]*"--no-auto-commits"[\s\S]*"--no-dirty-commits"/);
assert.match(cliRuntimeSource, /action !== "run-task"/);
assert.match(cliRuntimeSource, /\.local", "bin"/);
const cliTaskRunsSource = readFileSync("src/lib/services/runtime-adapters/cli-task-runs.ts", "utf8");
assert.match(cliTaskRunsSource, /PATH: cliRuntimePath\(\)/);
assert.match(cliTaskRunsSource, /LLM_API_KEY[\s\S]*OPENAI_API_KEY/);
assert.match(cliTaskRunsSource, /LLM_MODEL[\s\S]*profile\?\.model/);

const browserUseRoute = readFileSync("src/app/api/browser-use/route.ts", "utf8");
const browserUseRunner = readFileSync("src/lib/services/browser-use-runner.ts", "utf8");
assert.match(browserUseRoute, /runBrowserUse/);
assert.match(browserUseRoute, /set-full-permissions/);
assert.match(browserUseRunner, /"open"[\s\S]*"state"[\s\S]*"click"[\s\S]*"input"/);
assert.match(browserUseRunner, /FULL_PERMISSION_ACTIONS[\s\S]*"cloud-task"[\s\S]*"eval"[\s\S]*"upload"/);
assert.match(browserUseRunner, /ALWAYS_BLOCKED_ACTIONS[\s\S]*"install"[\s\S]*"python"[\s\S]*"setup"[\s\S]*"tunnel"/);
assert.match(browserUseRunner, /readBrowserUsePermissions/);
assert.match(browserUseRunner, /requires Full permissions on the Browser Use provider card/);
assert.match(browserUseRunner, /ANONYMIZED_TELEMETRY: "False"/);
assert.match(browserUseRunner, /Browser Use open only allows http\(s\) URLs and about:blank/);
assert.match(browserUseRunner, /safeScreenshotPath/);
assert.match(browserUseRunner, /"cloud"[\s\S]*"v2"[\s\S]*"POST"[\s\S]*"\/tasks"/);

const installableServices = readFileSync("src/lib/services/installable-services.ts", "utf8");
assert.match(installableServices, /InstallableServiceId = "n8n" \| "browser-use" \| "agentic-inbox" \| "openhands" \| "aider"/);
assert.match(installableServices, /uv"[\s\S]*"tool"[\s\S]*"install"[\s\S]*"browser-use\[cli\]"/);
assert.match(installableServices, /"tool", "install", "openhands", "--python", "3\.12"/);
assert.match(installableServices, /"tool", "install", "aider-chat"/);
assert.match(installableServices, /Browser Use doctor passes before starting sessions/);
assert.match(installableServices, /does not run the upstream curl-to-shell installer/);
assert.match(installableServices, /never runs browser-use setup or browser-use install silently/);
assert.match(installableServices, /Latest compatible PyPI release at install time; not pinned by HivemindOS/);
assert.match(installableServices, /Full permissions can unlock Browser Use cloud tasks/);
assert.match(installableServices, /ANONYMIZED_TELEMETRY: "False"/);
assert.doesNotMatch(installableServices, /browserUseCommand\(\), \["install"\]/);
assert.doesNotMatch(installableServices, /browserUseCommand\(\), \["setup"\]/);
assert.match(installableServices, /N8N_HOST=0\.0\.0\.0/);
assert.match(installableServices, /N8N_SECURE_COOKIE=false/);

const installableServicesRoute = readFileSync("src/app/api/fleet/apps/installable-services/route.ts", "utf8");
assert.match(installableServicesRoute, /INSTALLABLE_SERVICE_IDS/);
assert.match(installableServicesRoute, /services = await Promise\.all/);
assert.match(installableServicesRoute, /value === "openhands"/);
assert.match(installableServicesRoute, /value === "aider"/);

const agenticInboxSetup = readFileSync("src/lib/services/cloudflare/agentic-inbox-setup.ts", "utf8");
const agenticInboxRoute = readFileSync("src/app/api/cloudflare/agentic-inbox/route.ts", "utf8");
assert.match(agenticInboxSetup, /export async function scaffoldAgenticInbox/);
assert.match(agenticInboxSetup, /export async function deployAgenticInbox/);
assert.match(agenticInboxSetup, /async email\(message: ForwardableEmailMessage/);
assert.match(agenticInboxSetup, /"check": "npx wrangler deploy --dry-run"/);
assert.match(agenticInboxRoute, /action === "scaffold"/);
assert.match(agenticInboxRoute, /action === "deploy"/);

const appCatalog = readFileSync("src/features/dashboard/agent-capability-catalog.ts", "utf8");
const myAppsPanel = readFileSync("src/features/dashboard/views/MyAppsPanel.tsx", "utf8");
assert.match(appCatalog, /installableServiceId: "browser-use"/);
assert.match(appCatalog, /installableServiceId: "agentic-inbox"/);
assert.match(appCatalog, /installableServiceId: "openhands"/);
assert.match(appCatalog, /installableServiceId: "aider"/);
assert.match(myAppsPanel, /BrowserUseFullPermissionsModal/);
assert.match(myAppsPanel, /Slide to unlock Browser Use full permissions/);
assert.match(myAppsPanel, /services\?: InstallableServiceStatus\[\]/);
assert.match(myAppsPanel, /Promise\.allSettled/);

const prdSource = readFileSync("src/lib/services/queen-bee/prd-decomposition.ts", "utf8");
assert.match(prdSource, /export function decomposePrdToTaskDrafts/);
assert.match(prdSource, /dependsOnDraftIndexes: index > 0 \? \[index - 1\] : \[\]/);
assert.match(prdSource, /Acceptance criteria/);

const queenBeeRoute = readFileSync("src/app/api/queen-bee/route.ts", "utf8");
assert.match(queenBeeRoute, /body\.action === "decompose-prd"/);
assert.match(queenBeeRoute, /createQueenBeePrdTasks/);

console.log("Agent provider catalog, executable runtime bridges, Browser Use service, Agentic Inbox setup, and Queen Bee PRD decomposition checks passed.");
