import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import { readBrowserUsePermissions } from "@/lib/services/browser-use-permissions";
import { deployAgenticInbox, readAgenticInboxStatus, scaffoldAgenticInbox } from "@/lib/services/cloudflare/agentic-inbox-setup";
import { installPalmierProFromDmg, openPalmierProApp, quitPalmierProApp, readPalmierProInstallableServiceStatus } from "@/lib/services/palmier-pro-installable";
import { hiveEnvPresence } from "@/lib/services/shared-hive-env";

const execFileAsync = promisify(execFile);

export type InstallableServiceId = "n8n" | "browser-use" | "agentic-inbox" | "mcp-email-server" | "openhands" | "aider" | "agent-reach" | "palmier-pro";
export type InstallableServiceAction =
  | "status"
  | "install"
  | "start"
  | "stop"
  | "install-pipx"
  | "install-agent-reach-x"
  | "check-agent-reach-x-auth"
  | "agent-reach-doctor"
  | "test-agent-reach-x-profile"
  | "reset-agent-reach-x";

export type InstallableServiceActionInput = {
  profileUrl?: string;
  maxPosts?: number;
  maxReplies?: number;
};

export const INSTALLABLE_SERVICE_IDS: InstallableServiceId[] = ["n8n", "browser-use", "agentic-inbox", "mcp-email-server", "openhands", "aider", "agent-reach", "palmier-pro"];

export type InstallableServiceStatus = {
  id: InstallableServiceId;
  name: string;
  installed: boolean;
  running: boolean;
  version?: string;
  openUrl?: string;
  detail: string;
  installMethod: "docker" | "uv" | "uv-tool" | "pipx" | "cloudflare-worker" | "dmg";
  requirements: string[];
  sourceUrl: string;
  provenance?: {
    packageName: string;
    packageManager: string;
    installCommand: string;
    updatePolicy: string;
  };
  securityNotes?: string[];
  permissions?: {
    fullAccess: boolean;
    label: string;
    detail: string;
    approvedAt?: string;
  };
  projectDir?: string;
  preflight?: Array<{ key: string; ok: boolean; detail: string; blocking?: boolean }>;
  preflightActions?: Array<{
    action: InstallableServiceAction;
    label: string;
    detail: string;
    disabled?: boolean;
  }>;
  agentReach?: AgentReachSetupState;
};

export type AgentReachChannelStatus = {
  id: string;
  label: string;
  category: "Search" | "Social" | "Video" | "Developer" | "Web" | "Career" | "Market";
  status: "ok" | "warn" | "off" | "unknown";
  authModel: "Public" | "Browser session" | "CLI auth" | "API key" | "Optional";
  activeBackend?: string | null;
  backends: string[];
  summary: string;
  setup: string[];
  testPrompt: string;
  riskNotes: string[];
  networkDestinations: string[];
  automatedActions?: InstallableServiceAction[];
};

export type AgentReachSecurityReceipt = {
  packageName: string;
  packageVersion?: string;
  installSource: string;
  packageHash: string;
  dependencyPolicy: string;
  credentialPolicy: string;
  runtimePolicy: string;
};

export type AgentReachSetupState = {
  channels: AgentReachChannelStatus[];
  doctorCheckedAt?: string;
  dataFlow: string[];
  securityReceipt: AgentReachSecurityReceipt;
};

export type AgentReachXTestPost = {
  id: string;
  text: string;
  url: string;
  createdAtISO?: string;
  metrics?: Record<string, number>;
  replies?: AgentReachXTestPost[];
};

export type AgentReachXProfileTestResult = {
  kind: "agent-reach-x-profile";
  profile: string;
  sourceUrl: string;
  generatedAt: string;
  backend: "twitter-cli";
  posts: AgentReachXTestPost[];
  fetchedReplyThreads: number;
};

export type InstallableServiceActionResult = {
  service: InstallableServiceStatus;
  result?: AgentReachXProfileTestResult;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type CommandSpec = {
  command: string;
  argsPrefix?: string[];
  displayName: string;
};

const BROWSER_USE_SECURITY_NOTES = [
  "Installed from PyPI with uv; HivemindOS does not run the upstream curl-to-shell installer.",
  "Normal install validates with doctor and never runs browser-use setup or browser-use install silently.",
  "HivemindOS launches Browser Use with anonymized telemetry disabled.",
  "Full permissions can unlock Browser Use cloud tasks, real-profile/CDP launch options, uploads, and JavaScript eval after a slide-to-unlock warning.",
];

const MCP_EMAIL_SERVER_SECURITY_NOTES = [
  "Mailbox credentials give agents direct access to private email. Use a dedicated agent mailbox or app password whenever possible.",
  "HivemindOS only installs the local stdio MCP bridge; it does not read mailbox credentials, probe inboxes, or keep the bridge running in the background.",
  "Omitting MCP_EMAIL_SERVER_SMTP_HOST keeps the bridge in read-only IMAP mode, so outbound email tools stay hidden.",
  "Enable attachment downloads only for trusted workflows; email attachments can contain sensitive or unsafe files.",
];

const N8N_CONTAINER = "hivemindos-n8n";
const N8N_VOLUME = "hivemindos_n8n_data";
const N8N_IMAGE = "docker.n8n.io/n8nio/n8n";
const N8N_OPEN_URL = "http://127.0.0.1:5678";
const MCP_EMAIL_SERVER_SOURCE_URL = "https://github.com/ai-zerolab/mcp-email-server";
const MCP_EMAIL_SERVER_REQUIRED_ENV_KEYS = [
  "MCP_EMAIL_SERVER_EMAIL_ADDRESS",
  "MCP_EMAIL_SERVER_PASSWORD",
  "MCP_EMAIL_SERVER_IMAP_HOST",
] as const;
const MCP_EMAIL_SERVER_OPTIONAL_ENV_KEYS = [
  "MCP_EMAIL_SERVER_ACCOUNT_NAME",
  "MCP_EMAIL_SERVER_FULL_NAME",
  "MCP_EMAIL_SERVER_USER_NAME",
  "MCP_EMAIL_SERVER_IMAP_PORT",
  "MCP_EMAIL_SERVER_SMTP_HOST",
  "MCP_EMAIL_SERVER_SMTP_PORT",
] as const;
const AGENT_REACH_COMMIT = "cf13a38432b59256bb83e3fa2c2510cf607ab5c4";
const AGENT_REACH_PACKAGE_SHA256 = "b96da4b09b0960cfccbfa2d07bf2af343abcb92998c193ffdeb58c41f40bfb2c";
const AGENT_REACH_PACKAGE_URL = `https://github.com/LiamVisionary/Agent-Reach/archive/${AGENT_REACH_COMMIT}.zip#sha256=${AGENT_REACH_PACKAGE_SHA256}`;
const AGENT_REACH_SOURCE_URL = "https://github.com/LiamVisionary/Agent-Reach";
const AGENT_REACH_DEPENDENCY_CONSTRAINTS = [
  "PyYAML==6.0.3",
  "Pygments==2.20.0",
  "certifi==2026.5.20",
  "charset-normalizer==3.4.7",
  "feedparser==6.0.12",
  "idna==3.18",
  "loguru==0.7.3",
  "markdown-it-py==4.2.0",
  "mdurl==0.1.2",
  "python-dotenv==1.2.2",
  "requests==2.34.2",
  "rich==15.0.0",
  "sgmllib3k==1.0.0",
  "urllib3==2.7.0",
  "yt-dlp==2026.6.9",
].join("\n");
const AGENT_REACH_INSTALL_COMMAND = `pipx install --backend pip --pip-args "-c <reviewed constraints>" ${AGENT_REACH_PACKAGE_URL}`;
const TWITTER_CLI_VERSION = "0.8.5";
const TWITTER_CLI_WHEEL_SHA256 = "b2e77204eae7159e10e199e3bf5296a691469457929cdf90a070cc5172f39317";
const TWITTER_CLI_PACKAGE_URL = `https://files.pythonhosted.org/packages/5e/6e/d2bf8c2732c1fd5b05a87659fbf1451e8925d876cb354756e0e2d760b982/twitter_cli-${TWITTER_CLI_VERSION}-py3-none-any.whl#sha256=${TWITTER_CLI_WHEEL_SHA256}`;
const TWITTER_CLI_DEPENDENCY_CONSTRAINTS = [
  "beautifulsoup4==4.15.0",
  "browser-cookie3==0.20.1",
  "certifi==2026.5.20",
  "cffi==2.0.0",
  "click==8.4.1",
  "curl_cffi==0.15.0",
  "lz4==4.4.5",
  "markdown-it-py==4.2.0",
  "mdurl==0.1.2",
  "pycparser==3.0",
  "pycryptodomex==3.23.0",
  "Pygments==2.20.0",
  "PyYAML==6.0.3",
  "rich==15.0.0",
  "soupsieve==2.8.4",
  "typing_extensions==4.15.0",
  "xclienttransaction==1.0.2",
].join("\n");

const AGENT_REACH_SECURITY_NOTES = [
  `Installed from LiamVisionary/Agent-Reach at reviewed commit ${AGENT_REACH_COMMIT.slice(0, 12)} with a pinned source-archive hash.`,
  "Dependencies are constrained to the container-audited resolution that passed pip-audit with zero known vulnerabilities.",
  "HivemindOS registers the Agent Reach skill only; it does not run Agent Reach doctor checks or channel probes during install.",
  `Optional X searching installs twitter-cli ${TWITTER_CLI_VERSION} from a pinned wheel hash with reviewed dependency constraints.`,
  "Browser cookie import requires explicit platform scope plus an opt-in flag, so credential-bearing cookies stay under user control.",
];

type AgentReachChannelCatalogEntry = Omit<AgentReachChannelStatus, "status" | "activeBackend" | "summary"> & {
  defaultSummary: string;
};

const AGENT_REACH_CHANNELS: AgentReachChannelCatalogEntry[] = [
  {
    id: "github",
    label: "GitHub",
    category: "Developer",
    authModel: "CLI auth",
    backends: ["gh CLI"],
    defaultSummary: "Repository, issue, PR, release, and code search through the GitHub CLI.",
    setup: ["Install GitHub CLI.", "Run gh auth login for private or authenticated access.", "Use public search without adding repository secrets."],
    testPrompt: "Search repositories or inspect this GitHub URL.",
    riskNotes: ["Authenticated GitHub calls can see private repositories available to the logged-in gh account."],
    networkDestinations: ["github.com", "api.github.com"],
  },
  {
    id: "twitter",
    label: "X / Twitter",
    category: "Social",
    authModel: "Browser session",
    backends: ["twitter-cli", "OpenCLI", "bird CLI"],
    defaultSummary: "Timeline, search, tweet, thread, and reply reading through twitter-cli when enabled.",
    setup: ["Install the audited twitter-cli backend.", "Choose browser-cookie auth or TWITTER_AUTH_TOKEN plus TWITTER_CT0.", "Run Check X auth before giving agents X tasks."],
    testPrompt: "Fetch the latest posts for this account URL.",
    riskNotes: ["Browser-cookie auth can prompt for Chrome Safe Storage in macOS Keychain.", "Write commands exist upstream, but the HivemindOS setup test only runs read commands."],
    networkDestinations: ["x.com", "api.x.com", "twitter.com", "github.com/fa0311/twitter-openapi for query IDs"],
    automatedActions: ["install-agent-reach-x", "check-agent-reach-x-auth", "test-agent-reach-x-profile", "reset-agent-reach-x"],
  },
  {
    id: "youtube",
    label: "YouTube",
    category: "Video",
    authModel: "Public",
    backends: ["yt-dlp"],
    defaultSummary: "Video metadata, captions, and transcript extraction when yt-dlp is present.",
    setup: ["Install yt-dlp when YouTube caption tasks are needed.", "Use transcript extraction before downloading media when possible."],
    testPrompt: "Get transcript metadata for this YouTube URL.",
    riskNotes: ["Comment scraping is web-derived and may be incomplete.", "Avoid downloading media unless the user explicitly asks."],
    networkDestinations: ["youtube.com", "googlevideo.com"],
  },
  {
    id: "reddit",
    label: "Reddit",
    category: "Social",
    authModel: "Browser session",
    backends: ["OpenCLI", "rdt-cli"],
    defaultSummary: "Reddit search and thread reading require a logged-in backend.",
    setup: ["Use OpenCLI with an approved browser session, or install rdt-cli and run rdt login.", "Avoid recommending new Reddit official API apps for ordinary users."],
    testPrompt: "Fetch this Reddit thread URL and comments.",
    riskNotes: ["Reddit has no reliable zero-config anonymous path.", "Authenticated browsing may expose account-visible communities."],
    networkDestinations: ["reddit.com", "oauth.reddit.com when configured"],
  },
  {
    id: "bilibili",
    label: "Bilibili",
    category: "Video",
    authModel: "Optional",
    backends: ["bili-cli", "OpenCLI", "Bilibili search API"],
    defaultSummary: "Bilibili search and video metadata; full flows use bili-cli/OpenCLI.",
    setup: ["Use public search for discovery.", "Install bili-cli or use OpenCLI for deeper video/subtitle workflows."],
    testPrompt: "Search Bilibili for this topic.",
    riskNotes: ["Bilibili can rate-limit or block some automated clients.", "Do not route Bilibili through yt-dlp; Agent Reach docs mark it unreliable."],
    networkDestinations: ["bilibili.com", "api.bilibili.com"],
  },
  {
    id: "xiaohongshu",
    label: "Xiaohongshu",
    category: "Social",
    authModel: "Browser session",
    backends: ["OpenCLI", "xiaohongshu-mcp", "xhs-cli"],
    defaultSummary: "Xiaohongshu notes/search through a logged-in browser or dedicated MCP backend.",
    setup: ["Use OpenCLI with an approved logged-in browser session, or configure xiaohongshu-mcp.", "Run Agent Reach doctor before choosing commands."],
    testPrompt: "Search Xiaohongshu for this topic.",
    riskNotes: ["Requires logged-in session for useful results.", "Browser automation may expose account-visible content."],
    networkDestinations: ["xiaohongshu.com"],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    category: "Career",
    authModel: "Optional",
    backends: ["linkedin-scraper-mcp", "Jina Reader"],
    defaultSummary: "Public LinkedIn pages may be readable; full workflows require a scraper MCP.",
    setup: ["Use public page reading for basic content.", "Install linkedin-scraper-mcp only when full LinkedIn workflows are needed."],
    testPrompt: "Read this LinkedIn public profile or company URL.",
    riskNotes: ["Logged-in LinkedIn automation is sensitive and should stay opt-in.", "Some pages may block unauthenticated access."],
    networkDestinations: ["linkedin.com"],
  },
  {
    id: "xiaoyuzhou",
    label: "Xiaoyuzhou",
    category: "Video",
    authModel: "API key",
    backends: ["groq-whisper", "ffmpeg"],
    defaultSummary: "Podcast transcription through Agent Reach transcription tools.",
    setup: ["Install Agent Reach audio helpers when needed.", "Configure a Groq or OpenAI transcription key by key name, not in project files."],
    testPrompt: "Transcribe this Xiaoyuzhou episode URL.",
    riskNotes: ["Audio transcription can send media-derived content to the configured ASR provider."],
    networkDestinations: ["xiaoyuzhoufm.com", "api.groq.com or OpenAI when configured"],
  },
  {
    id: "v2ex",
    label: "V2EX",
    category: "Social",
    authModel: "Public",
    backends: ["V2EX API"],
    defaultSummary: "Public hot topics, nodes, topic details, replies, and members.",
    setup: ["No login required for public endpoints.", "Use the built-in V2EX API route for hot topics and thread reads."],
    testPrompt: "Fetch V2EX hot topics or this topic URL.",
    riskNotes: ["Public endpoint only; do not expect account-private data."],
    networkDestinations: ["v2ex.com"],
  },
  {
    id: "xueqiu",
    label: "Xueqiu",
    category: "Market",
    authModel: "Browser session",
    backends: ["Xueqiu API"],
    defaultSummary: "Stock quotes and community content when a valid Xueqiu browser session is configured.",
    setup: ["Log into Xueqiu in the approved browser.", "Run agent-reach configure --from-browser chrome before account-dependent queries."],
    testPrompt: "Read this Xueqiu stock or discussion URL.",
    riskNotes: ["Market data availability depends on local session and region.", "Do not treat scraped content as financial advice."],
    networkDestinations: ["xueqiu.com"],
  },
  {
    id: "rss",
    label: "RSS / Atom",
    category: "Web",
    authModel: "Public",
    backends: ["feedparser"],
    defaultSummary: "RSS and Atom feed reading with local feedparser.",
    setup: ["No login required for public feeds.", "Use RSS URLs when a site provides them."],
    testPrompt: "Read this RSS feed URL.",
    riskNotes: ["Feed content is public but can still include personal data from the publisher."],
    networkDestinations: ["User-provided feed host"],
  },
  {
    id: "exa_search",
    label: "Exa Search",
    category: "Search",
    authModel: "API key",
    backends: ["Exa via mcporter"],
    defaultSummary: "Semantic web search when Exa MCP is configured.",
    setup: ["Install mcporter.", "Add Exa MCP with an Exa key through shared env or the MCP provider setup."],
    testPrompt: "Search the web for this topic with Exa.",
    riskNotes: ["Search queries are sent to Exa and may reveal research intent."],
    networkDestinations: ["mcp.exa.ai"],
  },
  {
    id: "web",
    label: "Web pages",
    category: "Web",
    authModel: "Public",
    backends: ["Jina Reader"],
    defaultSummary: "General web URL to markdown/text reading through Jina Reader.",
    setup: ["No install required for public pages.", "Use direct URLs for deterministic page reads."],
    testPrompt: "Read this web URL.",
    riskNotes: ["Public pages are fetched through Jina Reader, so the target URL is sent to Jina."],
    networkDestinations: ["r.jina.ai", "Target website"],
  },
];

const AGENT_REACH_DATA_FLOW = [
  "HivemindOS setup card chooses an explicit Agent Reach action.",
  "Agent Reach and optional backends are local CLI tools installed with pinned provenance where HivemindOS manages them.",
  "Credential-bearing checks run only after the user clicks a credential action such as Check X auth.",
  "Agents call the active backend for the selected channel; network destinations depend on that channel and are shown in the matrix.",
];

function agentReachSecurityReceipt(version?: string): AgentReachSecurityReceipt {
  return {
    packageName: "agent-reach",
    packageVersion: version,
    installSource: `${AGENT_REACH_SOURCE_URL}/archive/${AGENT_REACH_COMMIT}.zip`,
    packageHash: `sha256:${AGENT_REACH_PACKAGE_SHA256}`,
    dependencyPolicy: "Agent Reach and the managed X backend use reviewed constraints; update only after a fresh security review.",
    credentialPolicy: "Background status avoids credential probes. Browser-cookie or token checks require explicit user action.",
    runtimePolicy: "Agent Reach is a CLI capability layer, not a daemon; HivemindOS does not leave an Agent Reach listener running.",
  };
}

function serviceStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "n8n",
    name: "n8n",
    installed: false,
    running: false,
    openUrl: N8N_OPEN_URL,
    detail: "n8n is not installed.",
    installMethod: "docker",
    requirements: ["Docker Desktop or Docker Engine"],
    sourceUrl: "https://github.com/n8n-io/n8n",
    ...partial,
  };
}

function browserUseStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "browser-use",
    name: "Browser Use",
    installed: false,
    running: false,
    detail: "Browser Use CLI is not installed.",
    installMethod: "uv",
    requirements: ["Python 3.11+", "uv", "Browser Use doctor passes before starting sessions"],
    sourceUrl: "https://github.com/browser-use/browser-use",
    provenance: {
      packageName: "browser-use[cli]",
      packageManager: "uv tool",
      installCommand: "uv tool install browser-use[cli]",
      updatePolicy: "Latest compatible PyPI release at install time; not pinned by HivemindOS.",
    },
    securityNotes: BROWSER_USE_SECURITY_NOTES,
    ...partial,
  };
}

function agenticInboxStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "agentic-inbox",
    name: "Agentic Inbox",
    installed: false,
    running: false,
    detail: "Agentic Inbox Worker has not been scaffolded.",
    installMethod: "cloudflare-worker",
    requirements: ["Cloudflare account", "Wrangler", "Email Routing", "Email Sending"],
    sourceUrl: "https://github.com/cloudflare/agentic-inbox",
    ...partial,
  };
}

function mcpEmailServerStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "mcp-email-server",
    name: "MCP Email Server",
    installed: false,
    running: false,
    detail: "MCP Email Server is not installed.",
    installMethod: "uv-tool",
    requirements: ["uv", "IMAP mailbox env keys", "Optional SMTP env keys for sending"],
    sourceUrl: MCP_EMAIL_SERVER_SOURCE_URL,
    provenance: {
      packageName: "mcp-email-server",
      packageManager: "uv tool",
      installCommand: "uv tool install mcp-email-server",
      updatePolicy: "Latest compatible PyPI release at install time; configure a pinned uvx version for stricter provenance.",
    },
    securityNotes: MCP_EMAIL_SERVER_SECURITY_NOTES,
    ...partial,
  };
}

function cliToolStatus(id: Extract<InstallableServiceId, "openhands" | "aider">, partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id,
    name: id === "openhands" ? "OpenHands" : "Aider",
    installed: false,
    running: false,
    detail: `${id === "openhands" ? "OpenHands" : "Aider"} CLI is not installed.`,
    installMethod: "uv-tool",
    requirements: ["uv", id === "openhands" ? "Python 3.12+" : "Python 3.9+"],
    sourceUrl: id === "openhands" ? "https://github.com/OpenHands/OpenHands" : "https://github.com/Aider-AI/aider",
    ...partial,
  };
}

function agentReachStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "agent-reach",
    name: "Agent Reach",
    installed: false,
    running: false,
    detail: "Agent Reach CLI is not installed.",
    installMethod: "pipx",
    requirements: ["Python 3.10+", "pipx", "Network access for agent research tools"],
    sourceUrl: AGENT_REACH_SOURCE_URL,
    provenance: {
      packageName: "agent-reach",
      packageManager: "pipx",
      installCommand: AGENT_REACH_INSTALL_COMMAND,
      updatePolicy: `Pinned to reviewed fork commit ${AGENT_REACH_COMMIT}; update only after a fresh security review.`,
    },
    securityNotes: AGENT_REACH_SECURITY_NOTES,
    ...partial,
  };
}

async function run(command: string, args: string[], timeout = 20_000, env?: Record<string, string>): Promise<CommandResult> {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 500_000,
    env: env ? { ...process.env, ...env } : process.env,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        stdout: maybe.stdout ?? "",
        stderr: maybe.stderr ?? maybe.message ?? "",
      };
    },
  );
  return result;
}

async function dockerAvailable() {
  return (await run("docker", ["--version"], 5_000)).ok && (await run("docker", ["info"], 8_000)).ok;
}

async function uvAvailable() {
  return (await run("uv", ["--version"], 5_000)).ok;
}

function pipxCommandSpecs(): CommandSpec[] {
  const explicit = process.env.PIPX_BIN?.trim();
  const specs: CommandSpec[] = [];
  if (explicit) specs.push({ command: explicit, displayName: explicit });
  for (const candidate of [
    join(homedir(), ".local", "bin", "pipx"),
    "/opt/homebrew/bin/pipx",
    "/usr/local/bin/pipx",
  ]) {
    if (existsSync(candidate)) specs.push({ command: candidate, displayName: candidate });
  }
  specs.push({ command: "pipx", displayName: "pipx" });
  specs.push({ command: "python3", argsPrefix: ["-m", "pipx"], displayName: "python3 -m pipx" });
  return specs;
}

async function runPipx(args: string[], timeout = 20_000) {
  const errors: string[] = [];
  for (const spec of pipxCommandSpecs()) {
    const prefix = spec.argsPrefix ?? [];
    const probe = await run(spec.command, [...prefix, "--version"], 5_000);
    if (!probe.ok) {
      errors.push(`${spec.displayName}: ${probe.stderr || probe.stdout || "not available"}`);
      continue;
    }
    return run(spec.command, [...prefix, ...args], timeout);
  }
  return {
    ok: false,
    stdout: "",
    stderr: `pipx is not available. Tried ${errors.map((entry) => entry.split(":")[0]).join(", ")}.`,
  };
}

async function pipxAvailable() {
  return (await runPipx(["--version"], 5_000)).ok;
}

async function brewAvailable() {
  return (await run("brew", ["--version"], 5_000)).ok;
}

async function installPipxForHivemindOS() {
  if (await pipxAvailable()) {
    return { ok: true, stdout: "pipx is already available.", stderr: "" };
  }

  const attempts: string[] = [];
  if (process.platform === "darwin" && await brewAvailable()) {
    const brewInstall = await run("brew", ["install", "pipx"], 300_000);
    if (brewInstall.ok && await pipxAvailable()) return brewInstall;
    attempts.push(`brew install pipx: ${brewInstall.stderr || brewInstall.stdout || "pipx was still unavailable after install"}`);
  }

  const userInstall = await run("python3", ["-m", "pip", "install", "--user", "pipx"], 300_000);
  if (userInstall.ok && await pipxAvailable()) return userInstall;
  attempts.push(`python3 -m pip install --user pipx: ${userInstall.stderr || userInstall.stdout || "pipx was still unavailable after install"}`);

  return {
    ok: false,
    stdout: "",
    stderr: attempts.join("\n") || "Could not install pipx with Homebrew or python3.",
  };
}

async function uvToolInstalled(id: Extract<InstallableServiceId, "openhands" | "aider">) {
  return uvToolPackageInstalled(
    id === "openhands" ? "openhands" : "aider-chat",
    id === "openhands" ? "openhands" : "aider",
  );
}

async function uvToolPackageInstalled(packageName: string, binaryName: string) {
  const result = await run("uv", ["tool", "list"], 10_000);
  if (!result.ok) return false;
  const output = `${result.stdout}\n${result.stderr}`;
  return output.split(/\r?\n/).some((line) => line.startsWith(`${packageName} v`) || line.trim() === `- ${binaryName}`);
}

async function uvToolVersion(packageName: string) {
  const result = await run("uv", ["tool", "list"], 10_000);
  if (!result.ok) return undefined;
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = `${result.stdout}\n${result.stderr}`.match(new RegExp(`^${escaped} v([^\\s]+)`, "m"));
  return match?.[1];
}

function browserUseEnv() {
  return {
    ANONYMIZED_TELEMETRY: "False",
    BROWSER_USE_ANONYMIZED_TELEMETRY: "False",
  };
}

function browserUseCommand() {
  const explicit = process.env.BROWSER_USE_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of [
    join(homedir(), ".local", "bin", "browser-use"),
    "/opt/homebrew/bin/browser-use",
    "/usr/local/bin/browser-use",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "browser-use";
}

function cliToolCommand(id: Extract<InstallableServiceId, "openhands" | "aider">) {
  const envName = id === "openhands" ? "OPENHANDS_BIN" : "AIDER_BIN";
  const explicit = process.env[envName]?.trim();
  if (explicit) return explicit;
  const binary = id === "openhands" ? "openhands" : "aider";
  for (const candidate of [
    join(homedir(), ".local", "bin", binary),
    `/opt/homebrew/bin/${binary}`,
    `/usr/local/bin/${binary}`,
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return binary;
}

function agentReachCommand() {
  const explicit = process.env.AGENT_REACH_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of [
    join(homedir(), ".local", "bin", "agent-reach"),
    "/opt/homebrew/bin/agent-reach",
    "/usr/local/bin/agent-reach",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "agent-reach";
}

function mcpEmailServerCommand() {
  const explicit = process.env.MCP_EMAIL_SERVER_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of [
    join(homedir(), ".local", "bin", "mcp-email-server"),
    "/opt/homebrew/bin/mcp-email-server",
    "/usr/local/bin/mcp-email-server",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "mcp-email-server";
}

function twitterCliCommand() {
  const explicit = process.env.TWITTER_CLI_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of [
    join(homedir(), ".local", "bin", "twitter"),
    "/opt/homebrew/bin/twitter",
    "/usr/local/bin/twitter",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "twitter";
}

async function cliToolInstalled(id: Extract<InstallableServiceId, "openhands" | "aider">) {
  return (await uvToolInstalled(id)) || (await run(cliToolCommand(id), ["--version"], 12_000)).ok;
}

async function mcpEmailServerInstalled() {
  return (await uvToolPackageInstalled("mcp-email-server", "mcp-email-server")) || (await run(mcpEmailServerCommand(), ["--help"], 12_000)).ok;
}

async function agentReachVersion() {
  for (const args of [["--version"], ["version"]]) {
    const result = await run(agentReachCommand(), args, 12_000);
    if (!result.ok) continue;
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const firstLine = output.split(/\r?\n/).find(Boolean)?.trim() || output;
    return firstLine.match(/\bv?(\d+(?:\.\d+)+(?:[.-][A-Za-z0-9]+)?)\b/)?.[1] ?? firstLine.replace(/^agent[-\s]+reach\s*/i, "").trim();
  }
  return undefined;
}

async function twitterCliVersion() {
  const result = await run(twitterCliCommand(), ["--version"], 12_000);
  if (!result.ok) return undefined;
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const firstLine = output.split(/\r?\n/).find(Boolean)?.trim() || output;
  return firstLine.match(/\bv?(\d+(?:\.\d+)+(?:[.-][A-Za-z0-9]+)?)\b/)?.[1] ?? firstLine.replace(/^twitter,?\s*version\s*/i, "").trim();
}

async function installAgentReachWithReviewedConstraints() {
  const constraintsDir = await mkdtemp(join(tmpdir(), "hivemindos-agent-reach-"));
  const constraintsPath = join(constraintsDir, "constraints.txt");
  try {
    await writeFile(constraintsPath, `${AGENT_REACH_DEPENDENCY_CONSTRAINTS}\n`, "utf8");
    return await runPipx([
      "install",
      "--force",
      "--backend",
      "pip",
      "--pip-args",
      `--constraint ${constraintsPath}`,
      AGENT_REACH_PACKAGE_URL,
    ], 300_000);
  } finally {
    await rm(constraintsDir, { recursive: true, force: true });
  }
}

async function installTwitterCliForAgentReach() {
  const constraintsDir = await mkdtemp(join(tmpdir(), "hivemindos-agent-reach-x-"));
  const constraintsPath = join(constraintsDir, "constraints.txt");
  try {
    await writeFile(constraintsPath, `${TWITTER_CLI_DEPENDENCY_CONSTRAINTS}\n`, "utf8");
    return await runPipx([
      "install",
      "--force",
      "--backend",
      "pip",
      "--pip-args",
      `--constraint ${constraintsPath}`,
      TWITTER_CLI_PACKAGE_URL,
    ], 300_000);
  } finally {
    await rm(constraintsDir, { recursive: true, force: true });
  }
}

async function checkTwitterCliAuth() {
  const result = await run(twitterCliCommand(), ["status", "--json"], 30_000);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (/"ok"\s*:\s*true/i.test(output) || /authenticated"\s*:\s*true/i.test(output)) {
    return {
      ok: true,
      detail: "X auth check passed. Agent Reach can use twitter-cli for X search, timelines, tweets, and replies.",
    };
  }
  if (/not_authenticated/i.test(output)) {
    return {
      ok: false,
      detail: "twitter-cli is installed, but X auth is missing. Set TWITTER_AUTH_TOKEN and TWITTER_CT0, or explicitly allow browser-cookie auth, then check again.",
    };
  }
  if (/timed out|timeout|Chrome Safe Storage|keychain|safe storage/i.test(output)) {
    return {
      ok: false,
      detail: "twitter-cli could not complete X auth. If you use browser cookies, approve the macOS Keychain prompt for Chrome Safe Storage, or set TWITTER_AUTH_TOKEN and TWITTER_CT0.",
    };
  }
  return {
    ok: false,
    detail: output || "twitter-cli auth check did not confirm an authenticated X session.",
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function doctorChannelSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const status = typeof raw.status === "string" ? raw.status : "unknown";
  const activeBackend = typeof raw.active_backend === "string" || raw.active_backend === null ? raw.active_backend : undefined;
  const message = typeof raw.message === "string" ? raw.message : "";
  const backends = Array.isArray(raw.backends) ? raw.backends.filter((item): item is string => typeof item === "string") : [];
  return { status, activeBackend, message, backends };
}

async function agentReachDoctorChannels() {
  const result = await run(agentReachCommand(), ["doctor", "--json"], 90_000);
  if (!result.ok) return undefined;
  return parseJsonObject(result.stdout) ?? undefined;
}

function normalizeAgentReachStatus(status: string | undefined): AgentReachChannelStatus["status"] {
  if (status === "ok" || status === "warn" || status === "off") return status;
  return "unknown";
}

function buildAgentReachSetupState(version?: string, doctor?: Record<string, unknown>): AgentReachSetupState {
  const channels = AGENT_REACH_CHANNELS.map((channel) => {
    const doctorSummary = doctorChannelSummary(doctor?.[channel.id]);
    const { defaultSummary, ...publicChannel } = channel;
    return {
      ...publicChannel,
      status: normalizeAgentReachStatus(doctorSummary?.status),
      activeBackend: doctorSummary?.activeBackend ?? null,
      backends: doctorSummary?.backends.length ? doctorSummary.backends : channel.backends,
      summary: doctorSummary?.message || defaultSummary,
    };
  });
  return {
    channels,
    doctorCheckedAt: doctor ? new Date().toISOString() : undefined,
    dataFlow: AGENT_REACH_DATA_FLOW,
    securityReceipt: agentReachSecurityReceipt(version),
  };
}

function extractXProfileHandle(input: string | undefined) {
  const raw = input?.trim();
  if (!raw) throw new Error("Enter an X profile URL or handle to test Agent Reach.");
  const directHandle = raw.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (directHandle) return directHandle[1];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid X profile URL or @handle.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") throw new Error("Only x.com or twitter.com profile URLs can be used for this Agent Reach X test.");
  const handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error("The X profile URL does not contain a valid handle.");
  return handle;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function tweetAuthorHandle(tweet: Record<string, unknown>) {
  const author = tweet.author;
  if (!author || typeof author !== "object" || Array.isArray(author)) return "";
  const raw = author as Record<string, unknown>;
  return typeof raw.screenName === "string" ? raw.screenName : typeof raw.screen_name === "string" ? raw.screen_name : "";
}

function normalizeTweetMetrics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metrics: Record<string, number> = {};
  for (const [key, metricValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof metricValue === "number") metrics[key] = metricValue;
  }
  return Object.keys(metrics).length ? metrics : undefined;
}

function normalizeAgentReachTweet(value: unknown): AgentReachXTestPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;
  const handle = tweetAuthorHandle(raw) || "i";
  return {
    id,
    text: typeof raw.text === "string" ? raw.text : "",
    url: `https://x.com/${handle}/status/${id}`,
    createdAtISO: typeof raw.createdAtISO === "string" ? raw.createdAtISO : undefined,
    metrics: normalizeTweetMetrics(raw.metrics),
  };
}

function jsonDataList(payload: Record<string, unknown> | null) {
  const data = payload?.data;
  return Array.isArray(data) ? data : [];
}

async function testAgentReachXProfile(input?: InstallableServiceActionInput): Promise<AgentReachXProfileTestResult> {
  if (!(await twitterCliVersion())) throw new Error("Install the Agent Reach X search backend before testing an X profile.");
  const handle = extractXProfileHandle(input?.profileUrl);
  const maxPosts = boundedInteger(input?.maxPosts, 10, 1, 20);
  const maxReplies = boundedInteger(input?.maxReplies, 25, 0, 50);
  const postsResult = await run(twitterCliCommand(), ["user-posts", handle, "--max", String(maxPosts), "--json"], 120_000);
  if (!postsResult.ok) throw new Error(postsResult.stderr || postsResult.stdout || "Agent Reach X profile fetch failed.");
  const postsPayload = parseJsonObject(postsResult.stdout);
  const posts = jsonDataList(postsPayload).map(normalizeAgentReachTweet).filter((item): item is AgentReachXTestPost => Boolean(item));
  if (!posts.length) throw new Error("Agent Reach X profile fetch returned no posts.");

  let fetchedReplyThreads = 0;
  for (const post of posts) {
    const replyCount = post.metrics?.replies ?? 0;
    if (replyCount <= 0 || maxReplies <= 0) continue;
    const threadResult = await run(twitterCliCommand(), ["tweet", post.id, "--max", String(maxReplies), "--json"], 120_000);
    if (!threadResult.ok) continue;
    const threadPayload = parseJsonObject(threadResult.stdout);
    const replies = jsonDataList(threadPayload)
      .map(normalizeAgentReachTweet)
      .filter((item): item is AgentReachXTestPost => Boolean(item))
      .filter((item) => item.id !== post.id);
    post.replies = replies;
    fetchedReplyThreads += 1;
  }

  return {
    kind: "agent-reach-x-profile",
    profile: handle,
    sourceUrl: `https://x.com/${handle}`,
    generatedAt: new Date().toISOString(),
    backend: "twitter-cli",
    posts,
    fetchedReplyThreads,
  };
}

async function resetAgentReachXBackend() {
  const version = await twitterCliVersion();
  if (!version) return { ok: true, stdout: "", stderr: "" };
  return runPipx(["uninstall", "twitter-cli"], 120_000);
}

async function browserUseAvailable() {
  const command = browserUseCommand();
  return (await run(command, ["doctor"], 10_000, browserUseEnv())).ok || (await run(command, ["--help"], 5_000, browserUseEnv())).ok;
}

async function browserUseDoctor() {
  return run(browserUseCommand(), ["doctor"], 15_000, browserUseEnv());
}

async function browserUseRunning() {
  const result = await run(browserUseCommand(), ["sessions"], 5_000, browserUseEnv());
  const output = `${result.stdout}\n${result.stderr}`;
  if (!result.ok || /no active sessions/i.test(output)) return false;
  return /(?:^|\s)(?:default|work|cloud)\b|active browser|session:\s*\S+/i.test(output);
}

async function n8nContainerState() {
  const result = await run("docker", ["inspect", "-f", "{{.State.Status}}", N8N_CONTAINER], 5_000);
  if (!result.ok) return null;
  return result.stdout.trim() || "unknown";
}

async function n8nHttpReachable() {
  return fetch(N8N_OPEN_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  }).then(
    (response) => response.status < 500,
    () => false,
  );
}

async function readAgentReachInstallableServiceStatus(
  authCheck?: { ok: boolean; detail: string },
  doctor?: Record<string, unknown>,
): Promise<InstallableServiceStatus> {
  const version = await agentReachVersion();
  const installed = Boolean(version);
  const pipxReady = await pipxAvailable();
  const twitterVersion = installed ? await twitterCliVersion() : undefined;
  const twitterReady = Boolean(twitterVersion);
  const preflight: NonNullable<InstallableServiceStatus["preflight"]> = [
    {
      key: "pipx",
      ok: pipxReady,
      detail: pipxReady
        ? "pipx is available for the hardened Agent Reach and optional backend installs."
        : installed
          ? "pipx is missing. Agent Reach is installed, but optional backends such as X search need pipx to install."
          : "pipx is missing; install it first, then HivemindOS can run the reviewed Agent Reach install.",
    },
  ];
  const preflightActions: NonNullable<InstallableServiceStatus["preflightActions"]> = [];

  if (installed) {
    preflight.push({
      key: "x-search-backend",
      ok: twitterReady,
      detail: twitterReady
        ? `X search backend is installed with twitter-cli${twitterVersion ? ` ${twitterVersion}` : ""}.`
        : "X search is optional and not enabled yet. Install the audited twitter-cli backend when you want Agent Reach to search/read X.",
    });
    if (twitterReady) {
      preflight.push({
        key: "x-auth",
        ok: authCheck?.ok ?? false,
        detail: authCheck?.detail ?? "X auth is not checked during background status. Click Check X auth when you are ready to let twitter-cli use TWITTER_AUTH_TOKEN/TWITTER_CT0 or an explicitly approved browser session. On macOS, browser-cookie auth can show a Keychain prompt for Chrome Safe Storage.",
      });
    }
  }

  if (!pipxReady) {
    preflightActions.push({
      action: "install-pipx",
      label: "Install pipx",
      detail: "Install pipx with Homebrew on macOS, or a user-level Python pip install when Homebrew is unavailable.",
    });
  }
  if (installed && pipxReady && !twitterReady) {
    preflightActions.push({
      action: "install-agent-reach-x",
      label: "Enable X search",
      detail: "Install the audited twitter-cli backend used by Agent Reach for X timelines, searches, tweets, and replies. This does not read cookies or authenticate.",
    });
  }
  if (installed && twitterReady) {
    preflightActions.push({
      action: "check-agent-reach-x-auth",
      label: "Check X auth",
      detail: "Run twitter-cli's explicit auth check. This may read TWITTER_AUTH_TOKEN/TWITTER_CT0 or, with approval, local browser cookies. On macOS, Chrome cookie auth can prompt for Chrome Safe Storage in Keychain.",
    });
    preflightActions.push({
      action: "test-agent-reach-x-profile",
      label: "Test X profile",
      detail: "Fetch recent posts and reply threads for a profile URL through Agent Reach's active twitter-cli backend.",
    });
    preflightActions.push({
      action: "reset-agent-reach-x",
      label: "Reset X setup",
      detail: "Uninstall the optional twitter-cli backend managed by HivemindOS. Browser cookies stay in Chrome; Keychain access is managed by macOS.",
    });
  }
  if (installed) {
    preflightActions.push({
      action: "agent-reach-doctor",
      label: "Refresh channels",
      detail: "Run Agent Reach doctor on demand to see which public, browser-session, CLI-auth, and API-key channels are active.",
    });
  }

  const xDetail = installed
    ? twitterReady
      ? authCheck?.ok
        ? "X search is enabled and authenticated through twitter-cli."
        : "X search backend is installed; authenticate with TWITTER_AUTH_TOKEN/TWITTER_CT0 or explicitly approved browser cookies, then check auth."
      : "Optional X search is not enabled yet; click Enable X search to install the audited twitter-cli backend."
    : pipxReady
      ? "Agent Reach is ready to install with pipx from the pinned HivemindOS fork."
      : "pipx is required before HivemindOS can install Agent Reach.";

  return agentReachStatus({
    installed,
    version,
    detail: installed
      ? `Agent Reach CLI${version ? ` ${version}` : ""} is installed from the pinned HivemindOS fork. ${xDetail}`
      : xDetail,
    preflight,
    preflightActions: preflightActions.length ? preflightActions : undefined,
    agentReach: buildAgentReachSetupState(version, doctor),
  });
}

async function readMcpEmailServerInstallableServiceStatus(): Promise<InstallableServiceStatus> {
  const [installed, uvReady, envKeys] = await Promise.all([
    mcpEmailServerInstalled(),
    uvAvailable(),
    hiveEnvPresence([...MCP_EMAIL_SERVER_REQUIRED_ENV_KEYS, ...MCP_EMAIL_SERVER_OPTIONAL_ENV_KEYS]),
  ]);
  const version = installed ? await uvToolVersion("mcp-email-server") : undefined;
  const keyStatus = Object.fromEntries(envKeys.map((item) => [item.key, item]));
  const missingRequired = MCP_EMAIL_SERVER_REQUIRED_ENV_KEYS.filter((key) => !keyStatus[key]?.present);
  const smtpConfigured = Boolean(keyStatus.MCP_EMAIL_SERVER_SMTP_HOST?.present);
  const requiredDetail = missingRequired.length
    ? `Missing required mailbox keys: ${missingRequired.join(", ")}. Add them with hive-env-add or pass them through your MCP client env.`
    : "Required IMAP env keys are present by name only; values are not read or shown.";
  const smtpDetail = smtpConfigured
    ? "SMTP host is present, so send/reply tools can be exposed by the MCP server."
    : "SMTP host is not set; mcp-email-server runs in read-only IMAP mode and hides outbound email tools.";
  const detail = installed
    ? missingRequired.length
      ? `MCP Email Server${version ? ` ${version}` : ""} is installed. ${requiredDetail}`
      : `MCP Email Server${version ? ` ${version}` : ""} is installed and ready for stdio MCP use. ${smtpDetail}`
    : uvReady
      ? "MCP Email Server is ready to install with uv."
      : "uv is required before HivemindOS can install MCP Email Server.";

  return mcpEmailServerStatus({
    installed,
    version,
    detail,
    preflight: [
      {
        key: "uv",
        ok: uvReady,
        detail: uvReady ? "uv is available for installing the PyPI MCP bridge." : "Install uv before installing mcp-email-server.",
      },
      {
        key: "bridge",
        ok: installed,
        detail: installed ? "mcp-email-server is installed as a local stdio MCP bridge." : "Install the bridge before adding it to agent MCP clients.",
      },
      {
        key: "imap-env",
        ok: missingRequired.length === 0,
        detail: requiredDetail,
      },
      {
        key: "smtp-mode",
        ok: true,
        detail: smtpDetail,
      },
    ],
  });
}

export async function readInstallableServiceStatus(id: InstallableServiceId): Promise<InstallableServiceStatus> {
  if (id === "palmier-pro") {
    return readPalmierProInstallableServiceStatus();
  }
  if (id === "agent-reach") {
    return readAgentReachInstallableServiceStatus();
  }
  if (id === "mcp-email-server") {
    return readMcpEmailServerInstallableServiceStatus();
  }
  if (id === "openhands" || id === "aider") {
    const installed = await cliToolInstalled(id);
    const label = id === "openhands" ? "OpenHands" : "Aider";
    return cliToolStatus(id, {
      installed,
      detail: installed
        ? `${label} CLI is installed and ready for runtime run-task actions.`
        : (await uvAvailable())
          ? `${label} is ready to install with uv.`
          : `uv is required before HivemindOS can install ${label}.`,
    });
  }
  if (id === "browser-use") {
    const installed = await browserUseAvailable();
    const version = installed ? await uvToolVersion("browser-use") : undefined;
    const permissions = await readBrowserUsePermissions();
    return browserUseStatus({
      installed,
      version,
      running: installed ? await browserUseRunning() : false,
      permissions: {
        fullAccess: permissions.fullAccess,
        label: permissions.fullAccess ? "Full permissions" : "Limited permissions",
        detail: permissions.fullAccess
          ? "High-agency Browser Use actions are enabled for agents on this machine."
          : "Agents can use bounded local browser actions. Full permissions can be enabled from the provider card.",
        approvedAt: permissions.approvedAt,
      },
      detail: installed
        ? `Browser Use CLI${version ? ` ${version}` : ""} is installed with HivemindOS guardrails.`
        : (await uvAvailable())
          ? "Browser Use is ready to install with uv."
          : "uv is required before HivemindOS can install Browser Use.",
    });
  }
  if (id === "agentic-inbox") {
    const status = await readAgenticInboxStatus();
    return agenticInboxStatus({
      installed: status.installed,
      running: status.running,
      openUrl: status.openUrl,
      detail: status.detail,
      requirements: status.requirements,
      sourceUrl: status.sourceUrl,
      projectDir: status.projectDir,
      preflight: status.preflight,
    });
  }
  if (id !== "n8n") throw new Error("Unknown installable service.");
  if (!(await dockerAvailable())) {
    return serviceStatus({
      detail: "Docker is required before HivemindOS can install n8n as a local service.",
    });
  }
  const state = await n8nContainerState();
  const reachable = await n8nHttpReachable();
  const installed = Boolean(state);
  const running = state === "running" || reachable;
  return serviceStatus({
    installed,
    running,
    detail: installed
      ? running
        ? "n8n is running on localhost:5678."
        : `n8n container is ${state}.`
      : "n8n Docker service is ready to install.",
  });
}

export async function runInstallableServiceAction(
  id: InstallableServiceId,
  action: InstallableServiceAction,
  input?: InstallableServiceActionInput,
): Promise<InstallableServiceStatus | InstallableServiceActionResult> {
  if (id === "palmier-pro") {
    if (action === "status") return readInstallableServiceStatus(id);
    if (action === "install") {
      await installPalmierProFromDmg();
      return readInstallableServiceStatus(id);
    }
    if (action === "start") {
      await openPalmierProApp();
      return readInstallableServiceStatus(id);
    }
    if (action === "stop") {
      await quitPalmierProApp();
      return readInstallableServiceStatus(id);
    }
    throw new Error("Palmier Pro supports install, open, quit, and status actions from HivemindOS.");
  }
  if (
    (
      action === "install-pipx" ||
      action === "install-agent-reach-x" ||
      action === "check-agent-reach-x-auth" ||
      action === "agent-reach-doctor" ||
      action === "test-agent-reach-x-profile" ||
      action === "reset-agent-reach-x"
    ) &&
    id !== "agent-reach"
  ) {
    throw new Error("This preflight action is only available for Agent Reach.");
  }
  if (id === "agent-reach") {
    if (action === "status") return readInstallableServiceStatus(id);
    if (action === "agent-reach-doctor") {
      if (!(await agentReachVersion())) throw new Error("Install Agent Reach before refreshing channel status.");
      return readAgentReachInstallableServiceStatus(undefined, await agentReachDoctorChannels());
    }
    if (action === "install-pipx") {
      const install = await installPipxForHivemindOS();
      if (!install.ok) throw new Error(install.stderr || install.stdout || "pipx install failed.");
      return readInstallableServiceStatus(id);
    }
    if (action === "install-agent-reach-x") {
      if (!(await agentReachVersion())) throw new Error("Install Agent Reach before enabling X search.");
      if (!(await pipxAvailable())) throw new Error("pipx is required to install the Agent Reach X search backend.");
      const install = await installTwitterCliForAgentReach();
      if (!install.ok) throw new Error(install.stderr || install.stdout || "Agent Reach X search backend install failed.");
      return readAgentReachInstallableServiceStatus();
    }
    if (action === "check-agent-reach-x-auth") {
      if (!(await twitterCliVersion())) throw new Error("Install the Agent Reach X search backend before checking X auth.");
      const authCheck = await checkTwitterCliAuth();
      return readAgentReachInstallableServiceStatus(authCheck, await agentReachDoctorChannels());
    }
    if (action === "test-agent-reach-x-profile") {
      const result = await testAgentReachXProfile(input);
      return {
        service: await readAgentReachInstallableServiceStatus(
          { ok: true, detail: `Agent Reach fetched ${result.posts.length} X posts for @${result.profile} through twitter-cli.` },
          await agentReachDoctorChannels(),
        ),
        result,
      };
    }
    if (action === "reset-agent-reach-x") {
      const reset = await resetAgentReachXBackend();
      if (!reset.ok) throw new Error(reset.stderr || reset.stdout || "Agent Reach X backend reset failed.");
      return readAgentReachInstallableServiceStatus();
    }
    if (action === "install") {
      if (!(await pipxAvailable())) throw new Error("pipx is required to install Agent Reach from HivemindOS.");
      const install = await installAgentReachWithReviewedConstraints();
      if (!install.ok) throw new Error(install.stderr || install.stdout || "Agent Reach install failed.");
      const skill = await run(agentReachCommand(), ["skill", "--install"], 60_000);
      if (!skill.ok) throw new Error(skill.stderr || skill.stdout || "Agent Reach skill registration failed.");
      return readInstallableServiceStatus(id);
    }
    throw new Error("Agent Reach is a CLI capability layer; install it here, then agents can use its unrestricted research tools through the runtime.");
  }
  if (id === "openhands" || id === "aider") {
    if (action === "status") return readInstallableServiceStatus(id);
    if (action === "install") {
      if (!(await uvAvailable())) throw new Error(`uv is required to install ${id === "openhands" ? "OpenHands" : "Aider"} from HivemindOS.`);
      const args = id === "openhands"
        ? ["tool", "install", "openhands", "--python", "3.12"]
        : ["tool", "install", "aider-chat"];
      const install = await run("uv", args, 300_000);
      if (!install.ok) throw new Error(install.stderr || install.stdout || `${id === "openhands" ? "OpenHands" : "Aider"} install failed.`);
      return readInstallableServiceStatus(id);
    }
    throw new Error(`${id === "openhands" ? "OpenHands" : "Aider"} is a CLI runtime; install it here, then run tasks through the runtime bridge.`);
  }
  if (id === "browser-use") {
    if (action === "status") return readInstallableServiceStatus(id);
    if (action === "install") {
      if (!(await uvAvailable())) throw new Error("uv is required to install Browser Use from HivemindOS.");
      const install = await run("uv", ["tool", "install", "browser-use[cli]"], 300_000, browserUseEnv());
      if (!install.ok) throw new Error(install.stderr || install.stdout || "Browser Use install failed.");
      await browserUseDoctor();
      return readInstallableServiceStatus(id);
    }
    if (action === "start") {
      if (!(await browserUseAvailable())) throw new Error("Install Browser Use before starting a browser session.");
      const started = await run(browserUseCommand(), ["open", "about:blank"], 60_000, browserUseEnv());
      if (!started.ok) throw new Error(started.stderr || started.stdout || "Browser Use could not start a browser session.");
      return readInstallableServiceStatus(id);
    }
    if (action === "stop") {
      await run(browserUseCommand(), ["close", "--all"], 30_000, browserUseEnv());
      return readInstallableServiceStatus(id);
    }
  }
  if (id === "agentic-inbox") {
    if (action === "status") return readInstallableServiceStatus(id);
    if (action === "install") {
      await scaffoldAgenticInbox();
      return readInstallableServiceStatus(id);
    }
    if (action === "start") {
      await deployAgenticInbox();
      return readInstallableServiceStatus(id);
    }
    if (action === "stop") throw new Error("Agentic Inbox is deployed on Cloudflare; use Wrangler or the Cloudflare dashboard to disable the Worker.");
  }
  if (id === "mcp-email-server") {
    if (action === "status") return readInstallableServiceStatus(id);
    if (action === "install") {
      if (!(await uvAvailable())) throw new Error("uv is required to install MCP Email Server from HivemindOS.");
      const install = await run("uv", ["tool", "install", "mcp-email-server"], 300_000);
      if (!install.ok) throw new Error(install.stderr || install.stdout || "MCP Email Server install failed.");
      return readInstallableServiceStatus(id);
    }
    throw new Error("MCP Email Server is a local stdio MCP bridge. Install it here, then configure an MCP client with mcp-email-server stdio after setting mailbox env keys.");
  }
  if (id !== "n8n") throw new Error("Unknown installable service.");
  if (action === "status") return readInstallableServiceStatus(id);
  if (!(await dockerAvailable())) {
    throw new Error("Docker is required to install or run n8n from HivemindOS.");
  }

  if (action === "stop") {
    await run("docker", ["stop", N8N_CONTAINER], 30_000);
    return readInstallableServiceStatus(id);
  }

  const existing = await n8nContainerState();
  if (existing && action === "start") {
    await run("docker", ["start", N8N_CONTAINER], 30_000);
    return readInstallableServiceStatus(id);
  }

  if (action === "install" || action === "start") {
    await run("docker", ["volume", "create", N8N_VOLUME], 30_000);
    if (existing) {
      await run("docker", ["start", N8N_CONTAINER], 30_000);
    } else {
      const result = await run("docker", [
        "run",
        "-d",
        "--name",
        N8N_CONTAINER,
        "-p",
        "127.0.0.1:5678:5678",
        "-v",
        `${N8N_VOLUME}:/home/node/.n8n`,
        "-e",
        "N8N_HOST=0.0.0.0",
        "-e",
        "N8N_PORT=5678",
        "-e",
        "N8N_PROTOCOL=http",
        "-e",
        "N8N_SECURE_COOKIE=false",
        "-e",
        "WEBHOOK_URL=http://127.0.0.1:5678/",
        N8N_IMAGE,
      ], 120_000);
      if (!result.ok) throw new Error(result.stderr || "Docker could not start n8n.");
    }
    return readInstallableServiceStatus(id);
  }

  return readInstallableServiceStatus(id);
}
