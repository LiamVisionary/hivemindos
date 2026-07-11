import { appendFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import {
  isSkillSpectorAvailable,
  readSkillSecuritySettings,
  resolveSecurityLlmRouting,
  scanWithSkillSpector,
  type SkillSecurityEngine,
} from "@/lib/services/skills/skillspector";
import type { BrainSkillInventory, BrainSkillSummary } from "@/lib/services/obsidian/brain-skills";
import type {
  SkillAnalyticsEvent,
  SkillAuditFinding,
  SkillAuditResult,
  SkillAuditSeverity,
  SkillAuditStatus,
  SkillCapability,
  SkillCatalogEntry,
  SkillManifest,
  SkillPack,
  SkillRecommendation,
  WorkflowAction,
  WorkflowActionRuntime,
} from "@/lib/types/skill-os";

export const SKILL_MANIFEST_FILE = ".hivemind-skill.json";
export const SKILL_ACTION_APPROVALS_FILE = join(homedir(), ".hivemindos", "skill-action-approvals.json");
export const SKILL_ANALYTICS_FILE = join(homedir(), ".hivemindos", "skill-analytics.jsonl");

const ENV_KEY_RE = /\b[A-Z][A-Z0-9_]{5,}\b/g;
const MAX_AUDIT_FILE_BYTES = 1024 * 1024;
const AUDITABLE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".sh", ".js", ".ts", ".py"]);
const EXECUTABLE_EXTENSIONS = new Set([".sh", ".py", ".js", ".ts", ".mjs", ".cjs", ".exe", ".bin", ".so", ".dll", ".dylib"]);
const PACKAGED_SKILLS_ROOT = join(process.cwd(), "packaged-skills");
const PACKAGED_OPTIONAL_ROOT = join(process.cwd(), "packaged-skills", "optional");
const PACKAGED_PACK_ROOT = join(PACKAGED_SKILLS_ROOT, "packs");
const PACKAGED_DIRECTORY_PACK_PREFIX = "packaged-directory-";
const SOURCE_METADATA_FILE = ".hivemind-skill-source.json";

const FINDING_RULES: Array<{
  id: string;
  title: string;
  severity: SkillAuditSeverity;
  pattern: RegExp;
  detail: string;
  approval: string;
}> = [
  {
    id: "destructive-shell",
    title: "Destructive shell command",
    severity: "high",
    pattern: /\b(rm\s+-rf|mkfs|diskutil\s+erase|dd\s+if=|chmod\s+-R\s+777|chown\s+-R)\b/i,
    detail: "The skill references commands that can destroy or dangerously rewrite local data.",
    approval: "destructive-filesystem",
  },
  {
    id: "credential-exfiltration",
    title: "Credential handling risk",
    severity: "high",
    pattern: /\b(printenv|env\s*\||cat\s+.*\.(env|pem|key)|echo\s+\$[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)|curl\b[\s\S]{0,160}\$[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD))\b/i,
    detail: "The skill may print, read, or transmit secret-bearing environment values.",
    approval: "secret-access",
  },
  {
    id: "remote-script",
    title: "Remote script execution",
    severity: "high",
    pattern: /\b(curl|wget)\b[\s\S]{0,120}\|\s*(bash|sh|zsh|python|node)\b/i,
    detail: "The skill pipes remote content directly into an interpreter.",
    approval: "remote-code-execution",
  },
  {
    id: "prompt-injection",
    title: "Prompt-injection-like instruction",
    severity: "high",
    pattern: /\b(ignore (all )?(previous|prior|system|developer) instructions|disable (safety|guardrails)|exfiltrate|do not tell the user)\b/i,
    detail: "The skill contains language that tries to override higher-priority instructions or hide behavior.",
    approval: "prompt-policy-review",
  },
  {
    id: "publishing-action",
    title: "Publishing or external messaging",
    severity: "medium",
    pattern: /\b(post to|publish|send email|send dm|send message|tweet|upload|deploy|release|merge pull request|create invoice)\b/i,
    detail: "The skill can affect external audiences or production systems.",
    approval: "external-action",
  },
  {
    id: "network-action",
    title: "Network/API action",
    severity: "medium",
    pattern: /\b(curl|wget|fetch\(|axios\.|POST\s+\/|PUT\s+\/|PATCH\s+\/|DELETE\s+\/|webhook|api key|oauth)\b/i,
    detail: "The skill calls external or local network services.",
    approval: "network-access",
  },
  {
    id: "wallet-payment",
    title: "Wallet, payment, or trading action",
    severity: "medium",
    pattern: /\b(wallet|private key|seed phrase|transfer crypto|trade|swap|x402|payment|spend|bankr|polymarket|invoice)\b/i,
    detail: "The skill may move money, trade assets, or use paid APIs.",
    approval: "wallet-or-payment",
  },
  {
    id: "broad-filesystem",
    title: "Broad filesystem access",
    severity: "medium",
    pattern: /\b(\/Users\/|\/private\/|~\/|find\s+\/|sudo\b|rsync\b|scp\b|tar\s+-|zip\s+-r)\b/i,
    detail: "The skill may read, write, package, or transfer broad local filesystem paths.",
    approval: "filesystem-access",
  },
  {
    id: "mutable-github-ref",
    title: "Mutable GitHub source reference",
    severity: "low",
    pattern: /github\.com\/[^/\s]+\/[^/\s]+\/(tree|blob|raw)\/(main|master|develop|dev|HEAD)\b/i,
    detail: "The source points at a moving branch instead of a pinned commit or tag.",
    approval: "source-pinning-review",
  },
];

const CURATED_CATALOG: SkillCatalogEntry[] = [
  {
    id: "anthropic-skill-creator",
    slug: "skill-creator",
    name: "Skill Creator",
    description: "Create portable skills with clear triggers, structure, and validation.",
    source: "Anthropic official skills",
    sourceType: "curated",
    category: "Skill authoring",
    tags: ["skills", "authoring", "agent-agnostic"],
    githubUrl: "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
    capabilities: ["chat"],
    envKeys: [],
  },
  {
    id: "anthropic-doc-coauthoring",
    slug: "doc-coauthoring",
    name: "Document Coauthoring",
    description: "Turn writing into a structured context-gathering and reader-review workflow.",
    source: "Anthropic official skills",
    sourceType: "curated",
    category: "Writing",
    tags: ["docs", "review", "workflow"],
    githubUrl: "https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring",
    capabilities: ["chat"],
    envKeys: [],
  },
  {
    id: "voltagent-awesome-agent-skills",
    slug: "awesome-agent-skills",
    name: "Awesome Agent Skills",
    description: "A cross-agent catalog source for finding portable skills from official teams and the community.",
    source: "VoltAgent",
    sourceType: "curated",
    category: "Catalog",
    tags: ["catalog", "cross-agent", "discovery"],
    githubUrl: "https://github.com/VoltAgent/awesome-agent-skills",
    capabilities: ["chat"],
    envKeys: [],
  },
  {
    id: "composio-connect",
    slug: "connect-apps",
    name: "Connect Apps",
    description: "Connect agents to external apps through explicit, permissioned workflows.",
    source: "Composio",
    sourceType: "curated",
    category: "Integrations",
    tags: ["apps", "actions", "connectors"],
    githubUrl: "https://github.com/ComposioHQ/awesome-codex-skills/tree/master/connect-apps",
    capabilities: ["http", "mcp"],
    envKeys: [],
  },
  {
    id: "hivemindos-aeon-skill-converter",
    slug: "aeon-skill-converter",
    name: "Aeon Skill Converter",
    description: "Convert a normal shared skill into an Aeon workflow with runtime config, cadence, and readiness checks.",
    source: "HivemindOS shared skill",
    sourceType: "curated",
    category: "Aeon",
    tags: ["aeon", "workflow", "scheduler"],
    capabilities: ["aeon-workflow", "scheduler", "background"],
    envKeys: [],
  },
  {
    id: "hivemindos-hive-pulse",
    slug: "hive-pulse",
    name: "Hive Pulse",
    description: "Run a packed last-30-days signal brief across Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and web sources.",
    source: "HivemindOS packaged Hive skill",
    sourceType: "curated",
    category: "Research",
    tags: ["research", "social-search", "last30days", "reddit", "x", "youtube", "tiktok", "hackernews", "polymarket", "github", "web"],
    githubUrl: "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-pulse",
    capabilities: ["chat", "shell", "http", "filesystem", "analytics"],
    envKeys: [
      "SCRAPECREATORS_API_KEY",
      "XAI_API_KEY",
      "AUTH_TOKEN",
      "CT0",
      "OPENROUTER_API_KEY",
      "BRAVE_API_KEY",
      "PARALLEL_API_KEY",
      "GITHUB_TOKEN",
    ],
  },
];

const BANKR_DIRECTORY_SKILLS: Array<{
  slug: string;
  name: string;
  description: string;
  provider: string;
  workflow: string[];
}> = [
  {
    slug: "bankr-trading-desk",
    name: "Bankr Trading Desk",
    description: "Plan and execute spot trades, perps, DCA orders, and Polymarket bets through Bankr with explicit spend approvals.",
    provider: "Bankr",
    workflow: [
      "Classify the request as spot, perps, DCA, or Polymarket before choosing tools.",
      "Check balances, market context, risk limits, slippage, leverage, and settlement network.",
      "Present the exact order, expected costs, and downside before any transaction or bet.",
      "Execute only after approval, then record transaction ids, fills, and follow-up monitoring.",
    ],
  },
  {
    slug: "uniswap-v4-hook-builder",
    name: "Uniswap V4 Hook Builder",
    description: "Design and implement Uniswap v4 hooks with security checks, tests, and deployment readiness.",
    provider: "Uniswap",
    workflow: [
      "Capture hook intent, pool constraints, privileged roles, fee logic, and invariants.",
      "Scaffold or update the smallest contract surface with reentrancy, access, and accounting checks.",
      "Run focused tests for hook permissions, pool lifecycle, edge cases, and failure paths.",
      "Document audit notes and deployment steps before touching a live network.",
    ],
  },
  {
    slug: "base-contract-deployer",
    name: "Base Contract Deployer",
    description: "Deploy, verify, and record smart contracts on Base with conservative release gates.",
    provider: "Base",
    workflow: [
      "Confirm network, constructor arguments, deployer, funding, and source commit.",
      "Dry-run or simulate where possible before broadcasting.",
      "Deploy only after approval, then verify source and capture explorer links.",
      "Record addresses, tx hashes, ABI location, and rollback or owner-transfer steps.",
    ],
  },
  {
    slug: "ethskills-contract-auditor",
    name: "EthSkills Contract Auditor",
    description: "Run a 500-item smart contract audit workflow and convert findings into prioritized fixes.",
    provider: "EthSkills",
    workflow: [
      "Freeze the audit target, compiler settings, dependencies, and commit hash.",
      "Run the 500-item audit checklist or tool flow without mutating contracts.",
      "Group findings by exploitability, impact, reproducibility, and owner.",
      "Propose minimal patches plus focused tests for every high-risk item.",
    ],
  },
  {
    slug: "opensea-collection-trader",
    name: "OpenSea Collection Trader",
    description: "Query NFT collections, compare listings, and prepare collection trades through OpenSea.",
    provider: "OpenSea",
    workflow: [
      "Resolve the collection, chain, wallet, trait filters, floor, and liquidity assumptions.",
      "Compare listings, offers, royalties, fees, rarity, and recent sale context.",
      "Ask for approval with exact item ids and total cost before buying or listing.",
      "Record order ids, expiration, fees, and portfolio impact after execution.",
    ],
  },
  {
    slug: "zerion-portfolio-reader",
    name: "Zerion Portfolio Reader",
    description: "Read wallet portfolios, DeFi positions, NFTs, and PnL through Zerion.",
    provider: "Zerion",
    workflow: [
      "Confirm wallet addresses, chains, and whether the task is read-only.",
      "Pull balances, positions, debt, rewards, NFTs, and realized or unrealized PnL.",
      "Separate stable balances, volatile exposure, protocol risk, and stale price data.",
      "Summarize opportunities and risks without moving funds unless a separate approved trade follows.",
    ],
  },
  {
    slug: "alchemy-realtime-chain-query",
    name: "Alchemy Realtime Chain Query",
    description: "Query any supported chain in real time with Alchemy for balances, transactions, contracts, and events.",
    provider: "Alchemy",
    workflow: [
      "Identify chain, address, contract, block range, and freshness requirements.",
      "Use indexed endpoints first, then raw RPC only when needed.",
      "Validate returned data shape and distinguish confirmed state from pending mempool data.",
      "Cache or cite block numbers for any decision that depends on chain state.",
    ],
  },
  {
    slug: "helixa-agent-scores",
    name: "Helixa Agent Scores",
    description: "Establish agent scores through Helixa for reputation, quality, and operational routing.",
    provider: "Helixa",
    workflow: [
      "Define scoring purpose, agent identity, eligible signals, and privacy boundaries.",
      "Collect only the metrics needed for the score and avoid secret or personal payloads.",
      "Explain score drivers, confidence, and decay rules before using the score for routing.",
      "Log score changes and revisit thresholds after real outcomes are observed.",
    ],
  },
  {
    slug: "gitlawb-decentralized-git",
    name: "GitLawb Decentralized Git",
    description: "Store repository state with decentralized git while preserving normal local Git hygiene.",
    provider: "GitLawb",
    workflow: [
      "Check branch state, uncommitted changes, ignored files, and secret risks before export.",
      "Package only the intended repository content and preserve commit provenance.",
      "Publish or sync to decentralized git only after approval.",
      "Record content ids, remotes, recovery steps, and any files intentionally excluded.",
    ],
  },
  {
    slug: "moltycash-gig-work",
    name: "Moltycash Gig Work",
    description: "Find and complete real gig work for USDC through Moltycash with scope, payout, and delivery checks.",
    provider: "Moltycash",
    workflow: [
      "Screen gigs for scope, deadline, payout terms, identity requirements, and conflicts.",
      "Estimate effort and acceptance criteria before committing.",
      "Deliver work through the requested channel only after checking privacy and license constraints.",
      "Track submitted proof, payment status, and follow-up obligations.",
    ],
  },
  {
    slug: "codegrid-agent-canvas",
    name: "Codegrid Agent Canvas",
    description: "Coordinate multiple coding agents on one canvas with clear ownership, review, and merge boundaries.",
    provider: "Codegrid",
    workflow: [
      "Break the build into independent lanes with owners, files, risks, and verification gates.",
      "Keep shared contracts visible on the canvas before agents edit overlapping areas.",
      "Review each lane output for conflicts, tests, and security before merging.",
      "Summarize accepted changes and unresolved risks back into the project plan.",
    ],
  },
  {
    slug: "gem-miner-base-game",
    name: "Gem Miner Base Game",
    description: "Stake GEM on Base to play Gem Miner while keeping wallet, approval, and loss limits visible.",
    provider: "Gem Miner",
    workflow: [
      "Confirm wallet, Base network, stake amount, game rules, lockups, and exit conditions.",
      "Check token approval scope and expected transaction costs before staking.",
      "Stake only after approval and capture tx hashes plus current game state.",
      "Track rewards, cooldowns, and unstake windows without increasing exposure automatically.",
    ],
  },
  {
    slug: "nexus-trading-labs-perps",
    name: "Nexus Trading Labs Perps",
    description: "Prepare non-custodial perp trades through Nexus Trading Labs with leverage and liquidation controls.",
    provider: "Nexus Trading Labs",
    workflow: [
      "Confirm market, direction, collateral, leverage, stop, take-profit, and invalidation thesis.",
      "Calculate liquidation distance, fees, funding exposure, and maximum loss.",
      "Require approval for the exact order before any wallet signature.",
      "Monitor fill, margin health, and exit criteria after execution.",
    ],
  },
  {
    slug: "wake-spotter-token-score",
    name: "Wake Spotter Token Score",
    description: "Score tokens from 0 to 100 with Wake Spotter and explain drivers before any trade decision.",
    provider: "Wake Spotter",
    workflow: [
      "Resolve the token contract, chain, liquidity venue, and time horizon.",
      "Fetch the 0 to 100 score plus liquidity, holder, momentum, contract, and social drivers.",
      "Flag stale data, low-liquidity traps, honeypot signals, and concentrated holder risk.",
      "Use the score as input to a separate approved trade workflow, not as automatic permission.",
    ],
  },
];

export const SKILL_PACKS: SkillPack[] = [
  bankrDirectoryPack(),
  skillPack("engineering-review", "Engineering Review", "Review code, tests, CI, and release readiness with agent-neutral discipline.", "Engineering", ["chat", "shell"], [
    ["code-review-loop", "Code Review Loop", "Find behavioral regressions, security risks, and missing tests before merge."],
    ["test-plan-writer", "Test Plan Writer", "Turn a change description into focused unit, integration, and smoke tests."],
    ["ci-failure-triage", "CI Failure Triage", "Inspect failing checks, isolate root cause, and propose the smallest safe fix."],
  ]),
  skillPack("frontend-product", "Frontend Product", "Design, implement, and verify product UI with browser QA.", "Product", ["chat", "browser", "shell"], [
    ["frontend-product-builder", "Frontend Product Builder", "Build polished UI that matches the product domain and existing design system."],
    ["browser-qa-pass", "Browser QA Pass", "Open the running app, capture screenshots, and verify layout, interaction, and responsive behavior."],
    ["web-performance-audit", "Web Performance Audit", "Check loading, rendering, layout shift, and interaction bottlenecks."],
  ]),
  skillPack("research-memory", "Research Memory", "Capture sources, synthesize findings, and preserve durable knowledge.", "Research", ["chat", "filesystem"], [
    ["research-source-capture", "Research Source Capture", "Collect sources with citations, dates, claims, and open questions."],
    ["synthesis-distiller", "Synthesis Distiller", "Convert messy notes into reviewed, reusable synthesis."],
    ["memory-refresh", "Memory Refresh", "Update durable notes and identify stale assumptions."],
  ]),
  skillPack("ops-release", "Ops Release", "Prepare releases, observe systems, and track technical debt.", "Operations", ["chat", "shell", "analytics"], [
    ["release-manager", "Release Manager", "Prepare changelog, verification, rollback notes, and release messaging."],
    ["observability-designer", "Observability Designer", "Define metrics, logs, alerts, dashboards, and failure signals."],
    ["tech-debt-tracker", "Tech Debt Tracker", "Record debt, severity, owner, mitigation, and revisit cadence."],
  ]),
  skillPack("personal-productivity", "Personal Productivity", "Capture loose work, reflect, organize, and turn context into action.", "Productivity", ["chat", "filesystem"], [
    ["capture-to-action", "Capture To Action", "Turn loose notes, transcripts, and pasted ideas into clear next actions."],
    ["reflect-and-improve", "Reflect And Improve", "Review a work session and extract lessons, decisions, and process improvements."],
    ["file-organizer", "File Organizer", "Organize local files conservatively with previews before moving anything."],
  ]),
  skillPack("app-connector-automation", "App/Connector Automation", "Design permissioned app actions through MCP, HTTP, and connector tools.", "Integrations", ["mcp", "http"], [
    ["connector-action-designer", "Connector Action Designer", "Map a user workflow to explicit app actions, approvals, and audit logs."],
    ["mcp-server-planner", "MCP Server Planner", "Design a minimal MCP server contract for a local or remote service."],
    ["api-route-caller", "API Route Caller", "Call documented API routes with typed payloads and clear confirmation boundaries."],
  ]),
  skillPack("aeon-background-workflows", "Aeon Background Workflows", "Convert and operate skills as Aeon scheduled/background work.", "Aeon", ["aeon-workflow", "scheduler", "background"], [
    ["aeon-skill-converter", "Aeon Skill Converter", "Mirror a shared skill into Aeon and configure manual or scheduled runtime duty."],
    ["aeon-readiness-check", "Aeon Readiness Check", "Check config, secrets, cadence, run logs, and safe on-duty state."],
    ["aeon-run-review", "Aeon Run Review", "Review recent Aeon run output and propose skill or cadence improvements."],
  ]),
];

export async function getSkillPacks(): Promise<SkillPack[]> {
  const packagedManifestPacks = await readPackagedManifestPacks();
  const packagedDirectoryPacks = await readPackagedDirectoryPacks().catch(() => []);
  const packs = [...SKILL_PACKS, ...packagedManifestPacks, ...packagedDirectoryPacks];
  const duplicateId = packs.find((pack, index) => packs.findIndex((candidate) => candidate.id === pack.id) !== index)?.id;
  if (duplicateId) throw new Error(`Duplicate skill pack id: ${duplicateId}.`);
  return packs;
}

type PackagedPackManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities?: SkillCapability[];
  audience?: string;
  safety?: string;
  skills: Array<{ path: string }>;
};

async function readPackagedManifestPacks(): Promise<SkillPack[]> {
  const entries = await readdir(PACKAGED_PACK_ROOT, { withFileTypes: true }).catch(() => []);
  const packs: SkillPack[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await readFile(join(PACKAGED_PACK_ROOT, entry.name), "utf8");
    const manifest = JSON.parse(raw) as Partial<PackagedPackManifest>;
    if (manifest.schemaVersion !== 1 || !manifest.id?.trim() || !manifest.name?.trim() || !Array.isArray(manifest.skills)) {
      throw new Error(`Invalid packaged skill pack manifest: ${entry.name}.`);
    }
    const skills = await Promise.all(manifest.skills.map(async (item) => {
      const relativePath = String(item?.path ?? "").replace(/^[/\\]+/, "");
      const sourceDir = resolve(PACKAGED_SKILLS_ROOT, relativePath);
      assertPackagedSkillPath(sourceDir, manifest.id!);
      const markdown = await readFile(join(sourceDir, "SKILL.md"), "utf8").catch(() => "");
      if (!markdown.trim()) throw new Error(`Pack ${manifest.id} references a missing SKILL.md at ${relativePath}.`);
      const metadata = await readPackageSourceMetadata(sourceDir);
      const slug = safeId(String(metadata.hiveSlug ?? metadata.upstreamSlug ?? basename(sourceDir)));
      return {
        slug,
        name: frontmatterField(markdown, "name") || slugToName(slug),
        description: frontmatterField(markdown, "description") || firstSentence(markdown) || "Packaged skill.",
        markdown: "",
        packagedPath: relative(process.cwd(), sourceDir),
        capabilities: inferCapabilities(markdown),
      };
    }));
    const duplicateSlug = skills.find((skill, index) => skills.findIndex((candidate) => candidate.slug === skill.slug) !== index)?.slug;
    if (duplicateSlug) throw new Error(`Pack ${manifest.id} contains duplicate skill slug ${duplicateSlug}.`);
    packs.push({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description?.trim() || `Install the ${manifest.name} packaged skill set.`,
      category: manifest.category?.trim() || "Pack",
      capabilities: manifest.capabilities?.length ? manifest.capabilities : unionCapabilities(skills),
      audience: manifest.audience?.trim(),
      safety: manifest.safety?.trim(),
      skills: skills.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        markdown: skill.markdown,
        packagedPath: skill.packagedPath,
      })),
    });
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

function assertPackagedSkillPath(sourceDir: string, label: string) {
  const relativePath = relative(PACKAGED_SKILLS_ROOT, sourceDir);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Packaged skill ${label} is outside the packaged-skills folder.`);
  }
}

async function readPackagedDirectoryPacks(): Promise<SkillPack[]> {
  const entries = await readdir(PACKAGED_OPTIONAL_ROOT, { withFileTypes: true }).catch(() => []);
  const packs: SkillPack[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const groupRoot = join(PACKAGED_OPTIONAL_ROOT, entry.name);
    const skillPaths = await findPackagedSkillFiles(groupRoot, 4);
    if (!skillPaths.length) continue;
    const skills = (await Promise.all(skillPaths.map(packagedCatalogEntry)))
      .filter((skill): skill is SkillCatalogEntry => Boolean(skill));
    if (!skills.length) continue;
    const groupName = titleCase(entry.name);
    packs.push({
      id: `${PACKAGED_DIRECTORY_PACK_PREFIX}${safeId(entry.name)}`,
      name: `${groupName} Optional Skills Directory`,
      description: `Install all ${skills.length} optional ${entry.name} skills into the shared brain in one pass.`,
      category: "Pack",
      capabilities: unionCapabilities(skills),
      audience: "Agents that need the whole optional directory available from the shared brain.",
      safety: "Installs local packaged skill files only. Upstream installer commands are not run.",
      skills: skills.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        markdown: "",
        packagedPath: skill.packagedPath,
      })),
    });
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

function bankrDirectoryPack(): SkillPack {
  return {
    id: "bankr-web3-directory",
    name: "Bankr Web3 Skills Directory",
    description: "A permissioned Web3 operator shelf for trading, contract work, chain data, NFT collections, agent scoring, decentralized git, and USDC gig work.",
    category: "Web3",
    capabilities: ["chat", "wallet", "http", "mcp", "deployment", "analytics", "filesystem", "shell"],
    audience: "Agents that handle crypto, smart contracts, market ops, or paid Web3 workflows.",
    safety: "Requires explicit approval before trades, bets, staking, deployments, signatures, publishing, or paid work commitments.",
    skills: BANKR_DIRECTORY_SKILLS.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      markdown: web3DirectorySkillMarkdown(skill),
    })),
  };
}

function skillPack(id: string, name: string, description: string, category: string, capabilities: SkillCapability[], skills: Array<[string, string, string]>): SkillPack {
  return {
    id,
    name,
    description,
    category,
    capabilities,
    skills: skills.map(([slug, skillName, skillDescription]) => ({
      slug,
      name: skillName,
      description: skillDescription,
      markdown: portableSkillMarkdown(skillName, skillDescription, capabilities, `Installed from HivemindOS skill pack: ${name}.`),
    })),
  };
}

function web3DirectorySkillMarkdown(skill: (typeof BANKR_DIRECTORY_SKILLS)[number]) {
  return [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    skill.description,
    "",
    "## Provider",
    "",
    `- Primary provider: ${skill.provider}.`,
    "- Treat provider-specific names as source context. Use equivalent active tools when this skill runs through another compatible agent runtime.",
    "",
    "## Safety Contract",
    "",
    "- Default to read-only discovery until the user approves a specific action.",
    "- Ask for explicit approval before trades, bets, staking, token approvals, wallet signatures, deployments, publishing, paid gigs, or any external mutation.",
    "- Show exact network, contract, address, order, value, fees, leverage, expiry, and downside before approval when money or production state is involved.",
    "- Never expose secrets, seed phrases, API tokens, private wallet material, or personal identity data in logs, notes, or messages.",
    "",
    "## Workflow",
    "",
    skill.workflow.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "",
    "## Verification",
    "",
    "- Record transaction ids, explorer links, order ids, score timestamps, block numbers, or provider result ids where available.",
    "- Separate verified facts from model judgment, market thesis, or provider confidence.",
    "- Capture follow-up monitoring when a position, bet, deployment, listing, or gig remains open.",
    "",
    "<!-- Installed from HivemindOS skill pack: Bankr Web3 Skills Directory. -->",
  ].join("\n");
}

function portableSkillMarkdown(name: string, description: string, capabilities: SkillCapability[], note: string) {
  return [
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${name}`,
    "",
    description,
    "",
    "## Portability",
    "",
    "- This skill is agent-agnostic. Use the active agent's equivalent tools and permissions.",
    `- Capabilities: ${capabilities.join(", ") || "chat"}.`,
    `- ${note}`,
    "",
    "## Workflow",
    "",
    "1. Gather the task goal, context, constraints, and available tools.",
    "2. Identify whether the work is read-only, mutating, external-facing, paid, or scheduled.",
    "3. Ask for approval before mutations, publishing, spending, deployments, or unattended background work.",
    "4. Execute the smallest reliable workflow and capture verification evidence.",
    "5. Report the result, remaining risks, and any reusable improvement to this skill.",
  ].join("\n");
}

export function normalizeAgentAgnosticSkill(markdown: string, sourceLabel = "Imported skill") {
  const trimmed = markdown.trim();
  const note = [
    "> HivemindOS portability note: this skill is treated as agent-agnostic.",
    "> Runtime-specific names in the source describe provenance or adapter context; use equivalent HivemindOS capabilities when another agent runs it.",
  ].join("\n");
  if (trimmed.includes("HivemindOS portability note")) return `${trimmed}\n`;
  const withNote = trimmed.replace(/^(---\s*\n[\s\S]*?\n---\s*\n)?/, (frontmatter) => `${frontmatter || ""}${note}\n\n`);
  return `${withNote}\n\n<!-- Imported by HivemindOS from ${sourceLabel.replace(/-->/g, "")}. -->\n`;
}

export async function auditSkillInput(input: {
  slug?: string;
  markdown?: string;
  files?: Array<{ path: string; content: string }>;
  sourceRef?: string;
  /** Override the configured detection engine for this audit. */
  engine?: SkillSecurityEngine;
  /** Override the configured LLM-semantic-pass toggle for this audit. */
  llm?: boolean;
}): Promise<SkillAuditResult> {
  const files = input.files?.length
    ? input.files
    : [{ path: input.slug ? `${input.slug}/SKILL.md` : "SKILL.md", content: input.markdown ?? "" }];
  const findings: SkillAuditFinding[] = [];
  const approvals = new Set<string>();
  const envKeys = new Set<string>();
  const capabilities = new Set<SkillCapability>(["chat"]);
  const actionRuntimes = new Set<WorkflowActionRuntime>();
  const filesAudited: string[] = [];

  for (const file of files) {
    const content = file.content ?? "";
    filesAudited.push(file.path);
    for (const key of content.match(ENV_KEY_RE) ?? []) {
      if (!["README", "SKILL", "JSON", "YAML", "HTTP", "HTTPS", "POST", "DELETE"].includes(key)) envKeys.add(key);
    }
    inferCapabilities(content).forEach((capability) => capabilities.add(capability));
    parseWorkflowActions(content).forEach((action) => {
      actionRuntimes.add(action.runtime);
      action.permissions.forEach((permission) => approvals.add(permission));
      capabilities.add(runtimeCapability(action.runtime));
    });
    for (const rule of FINDING_RULES) {
      const match = content.match(rule.pattern);
      if (!match) continue;
      findings.push({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        detail: rule.detail,
        file: file.path,
        match: match[0].slice(0, 160),
      });
      approvals.add(rule.approval);
    }
    if (EXECUTABLE_EXTENSIONS.has(extension(file.path))) {
      findings.push({
        id: "helper-executable",
        title: "Executable helper file",
        severity: "medium",
        detail: "The skill includes a helper file that can execute code and should be reviewed before use.",
        file: file.path,
      });
      approvals.add("executable-helper");
      capabilities.add("shell");
    }
  }

  if (input.sourceRef && /\b(main|master|develop|HEAD)\b/i.test(input.sourceRef)) {
    findings.push({
      id: "mutable-source-ref",
      title: "Mutable source reference",
      severity: "low",
      detail: "The source reference appears to use a moving branch. Pin a commit or tag for reproducible imports.",
      match: input.sourceRef,
    });
    approvals.add("source-pinning-review");
  }

  // Delegate to the SkillSpector sidecar for deeper detection (AST, YARA, CVE
  // lookups, optional LLM pass). The regex findings above remain the fallback,
  // and we fold the scanner's findings into the same list so status/score and
  // the dashboard contract are unchanged. Engine resolution:
  //   regex        -> skip the scanner entirely
  //   skillspector -> require the scanner (throw if unavailable)
  //   auto         -> use the scanner when available, else regex-only
  const settings = await readSkillSecuritySettings().catch(() => null);
  const engine = input.engine ?? settings?.engine ?? "auto";
  const useLlm = input.llm ?? settings?.llm ?? false;
  let resultEngine: SkillAuditResult["engine"] = "regex";
  let scannerRecommendation: string | undefined;

  if (engine !== "regex") {
    const required = engine === "skillspector";
    if (required && !(await isSkillSpectorAvailable())) {
      throw new Error(
        "SkillSpector engine is selected but the `skillspector` CLI was not found. Install it (https://github.com/NVIDIA/SkillSpector) or switch the skill-security engine to 'auto'/'regex'.",
      );
    }
    // The LLM semantic pass has no hardcoded provider: it routes through the
    // user's security-subclass agent, or the Queen Bee if none exists. If the
    // toggle is on but no agent/credential resolves, we run static-only rather
    // than invent a provider, and note why on scannerRecommendation.
    let llmEnv: Record<string, string> | null = null;
    if (useLlm) {
      const routing = await resolveSecurityLlmRouting();
      if (routing.ok) {
        llmEnv = routing.env;
      } else {
        scannerRecommendation = `LLM security pass skipped — ${routing.reason}`;
      }
    }
    try {
      const scan = await scanWithSkillSpector({
        files: filesAudited.map((path, index) => ({ path, content: files[index]?.content ?? "" })),
        llmEnv,
      });
      if (scan) {
        const seen = new Set(findings.map((finding) => `${finding.id}:${finding.file ?? ""}`));
        for (const finding of scan.findings) {
          const key = `${finding.id}:${finding.file ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push(finding);
          if (finding.severity !== "low") approvals.add("security-review");
        }
        scannerRecommendation = scan.riskRecommendation ?? scannerRecommendation;
        resultEngine = scan.usedLlm ? "skillspector+llm" : "skillspector";
      }
    } catch (error) {
      if (required) throw error;
      // auto: a scanner crash must not block an import that regex would have passed.
    }
  }

  const status = auditStatus(findings);
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + severityCost(finding.severity), 0));
  return {
    status,
    score,
    findings,
    requiredApprovals: [...approvals].sort(),
    capabilities: [...capabilities].sort(),
    envKeys: [...envKeys].sort(),
    actionRuntimes: [...actionRuntimes].sort(),
    filesAudited,
    recommendedAction: recommendedAction(status),
    auditedAt: new Date().toISOString(),
    sourceRef: input.sourceRef,
    engine: resultEngine,
    scannerRecommendation,
  };
}

export async function auditSkillDirectory(input: { slug: string; dir: string; sourceRef?: string }) {
  const files: Array<{ path: string; content: string }> = [];
  await collectAuditFiles(input.dir, input.dir, files);
  return auditSkillInput({ slug: input.slug, files, sourceRef: input.sourceRef });
}

async function collectAuditFiles(root: string, dir: string, files: Array<{ path: string; content: string }>) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectAuditFiles(root, path, files);
      continue;
    }
    const st = await stat(path).catch(() => null);
    if (!st || st.size > MAX_AUDIT_FILE_BYTES) continue;
    if (!AUDITABLE_EXTENSIONS.has(extension(path)) && !EXECUTABLE_EXTENSIONS.has(extension(path))) continue;
    const content = await readFile(path, "utf8").catch(() => "");
    files.push({ path: path.slice(root.length + 1), content });
  }
}

export function createSkillManifest(input: {
  slug: string;
  name: string;
  description: string;
  sourceType: SkillManifest["source"]["type"];
  sourceLabel: string;
  sourceUrl?: string;
  sourceRepo?: string;
  sourceRef?: string;
  sourcePath?: string;
  audit: SkillAuditResult;
  markdown: string;
}): SkillManifest {
  return {
    schemaVersion: 1,
    slug: input.slug,
    name: input.name,
    description: input.description,
    agentAgnostic: true,
    capabilities: input.audit.capabilities,
    envKeys: input.audit.envKeys,
    source: {
      type: input.sourceType,
      label: input.sourceLabel,
      url: input.sourceUrl,
      repo: input.sourceRepo,
      ref: input.sourceRef,
      path: input.sourcePath,
      provenance: "Runtime-specific wording is preserved as source context. HivemindOS treats this skill as portable across compatible agent capabilities.",
    },
    audit: input.audit,
    workflowActions: parseWorkflowActions(input.markdown),
    normalizedAt: new Date().toISOString(),
  };
}

export function parseWorkflowActions(markdown: string): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  const blockRe = /```hivemindos-(?:scheduler-)?action\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(markdown))) {
    try {
      const parsed = JSON.parse(match[1].trim()) as Partial<WorkflowAction>;
      if (!parsed || typeof parsed !== "object" || !parsed.runtime) continue;
      const runtime = parsed.runtime;
      if (!["osascript", "http", "shell", "node", "python", "mcp", "tauri-native"].includes(runtime)) continue;
      actions.push({
        id: safeId(parsed.id || `${runtime}-${actions.length + 1}`),
        runtime,
        title: parsed.title,
        description: parsed.description,
        permissions: Array.isArray(parsed.permissions) ? parsed.permissions.map(String).filter(Boolean) : defaultPermissions(runtime),
        requiresApproval: parsed.requiresApproval !== false || runtime !== "osascript",
        timeoutMs: parsed.timeoutMs,
        script: parsed.script,
        command: parsed.command,
        args: Array.isArray(parsed.args) ? parsed.args.map(String) : undefined,
        url: parsed.url,
        method: parsed.method,
        headers: isRecord(parsed.headers) ? stringRecord(parsed.headers) : undefined,
        body: parsed.body,
      });
    } catch {
      // Malformed action blocks are handled by the auditor as normal text.
    }
  }
  return actions;
}

export async function getSkillCatalog(input: { query?: string; includeRegistry?: boolean; inventory?: BrainSkillInventory | null } = {}) {
  const imported = new Set((input.inventory?.shared ?? []).map((skill) => skill.slug));
  const entries = [...CURATED_CATALOG, ...await readPackagedOptionalCatalog().catch(() => [])];
  if (input.includeRegistry !== false) {
    entries.push(...await fetchSoloRegistryCatalog().catch(() => []));
  }
  const query = input.query?.trim().toLowerCase();
  return entries
    .map((entry) => ({ ...entry, imported: imported.has(entry.slug) || entry.imported }))
    .filter((entry) => !query || [entry.name, entry.slug, entry.description, entry.source, entry.category ?? "", ...entry.tags].join(" ").toLowerCase().includes(query));
}

async function readPackagedOptionalCatalog(): Promise<SkillCatalogEntry[]> {
  const skillPaths = await findPackagedSkillFiles(PACKAGED_OPTIONAL_ROOT, 5);
  const entries = await Promise.all(skillPaths.map(packagedCatalogEntry));
  return entries
    .filter((entry): entry is SkillCatalogEntry => Boolean(entry))
    .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
}

async function findPackagedSkillFiles(root: string, maxDepth: number) {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(path);
        continue;
      }
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
      await walk(path, depth + 1);
    }
  }

  await walk(root, 0);
  return found;
}

async function packagedCatalogEntry(skillPath: string): Promise<SkillCatalogEntry | null> {
  const markdown = await readFile(skillPath, "utf8").catch(() => "");
  if (!markdown.trim()) return null;
  const packageDir = dirname(skillPath);
  const packagedPath = relative(process.cwd(), packageDir);
  const metadata = await readPackageSourceMetadata(packageDir);
  const packageParts = relative(PACKAGED_OPTIONAL_ROOT, packageDir).split(/[\\/]+/).filter(Boolean);
  const packageSlug = safeId(packageParts.join("-"));
  const upstreamSlug = String(metadata.upstreamSlug ?? metadata.upstreamName ?? basename(packageDir));
  const slug = typeof metadata.hiveSlug === "string" && metadata.hiveSlug.trim() ? metadata.hiveSlug : packageSlug;
  const name = frontmatterField(markdown, "name") || slugToName(upstreamSlug || slug);
  const description = frontmatterField(markdown, "description") || firstSentence(markdown) || "Optional packaged skill.";
  const group = packageParts.length > 1 ? packageParts[0] : "Optional";
  const sourceLabel = typeof metadata.sourceLabel === "string" ? metadata.sourceLabel : undefined;
  const sourceUrl = typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : undefined;
  const repository = typeof metadata.repository === "string" ? metadata.repository : undefined;
  return {
    id: `packaged-${slug}`,
    slug,
    name,
    description,
    source: sourceLabel ? `UI Skills: ${sourceLabel}` : "HivemindOS optional packaged skills",
    sourceType: "pack",
    category: titleCase(group),
    tags: ["packaged", "optional", group, ...packageParts.slice(0, -1), upstreamSlug].filter(Boolean),
    githubUrl: repository || sourceUrl,
    packagedPath,
    sourceRef: `packaged:${packagedPath}`,
    capabilities: inferCapabilities(markdown),
    envKeys: [...new Set(markdown.match(ENV_KEY_RE) ?? [])].sort(),
  };
}

async function readPackageSourceMetadata(packageDir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(packageDir, ".hivemind-skill-source.json"), "utf8").catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function frontmatterField(markdown: string, field: string) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter) return "";
  const match = frontmatter[1].match(new RegExp(`^${field}:\\s*(.+)$`, "im"));
  return match?.[1]?.replace(/^["']|["']$/g, "").trim() ?? "";
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugToName(value: string) {
  return titleCase(value || "skill");
}

function unionCapabilities(skills: Array<{ capabilities?: SkillCapability[] }>): SkillCapability[] {
  return [...new Set(skills.flatMap((skill) => skill.capabilities ?? ["chat" as const]))].sort();
}

async function fetchSoloRegistryCatalog(): Promise<SkillCatalogEntry[]> {
  const response = await fetch("https://raw.githubusercontent.com/Sachin1801/skills-registry/main/registry.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null) as { skills?: Array<Record<string, unknown>> } | null;
  return (data?.skills ?? []).map((skill) => {
    const slug = String(skill.id ?? skill.name ?? "skill");
    const tags = Array.isArray(skill.tags) ? skill.tags.map(String) : [];
    const categories = Array.isArray(skill.categories) ? skill.categories.map(String) : [];
    return {
      id: `solo-${slug}`,
      slug,
      name: String(skill.name ?? slug),
      description: String(skill.description ?? ""),
      source: "Solo Skills Registry",
      sourceType: "registry" as const,
      category: categories[0],
      tags: [...categories, ...tags],
      githubUrl: `https://github.com/Sachin1801/skills-registry/tree/main/skills/${encodeURIComponent(slug)}`,
      skillMdUrl: `https://raw.githubusercontent.com/Sachin1801/skills-registry/main/skills/${encodeURIComponent(slug)}/AGENTS.md`,
      sourceRef: "Sachin1801/skills-registry@main",
      capabilities: inferCapabilities(`${skill.description ?? ""} ${tags.join(" ")} ${categories.join(" ")}`),
      envKeys: [],
    };
  });
}

export function recommendSkills(input: {
  query: string;
  skills: Array<Pick<BrainSkillSummary, "slug" | "name" | "description" | "providerLabel"> & { capabilities?: SkillCapability[] }>;
  packs?: SkillPack[];
  limit?: number;
}): SkillRecommendation[] {
  const query = input.query.trim().toLowerCase();
  const words = new Set(query.split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  const scored: SkillRecommendation[] = [];
  for (const skill of input.skills) {
    const text = `${skill.slug} ${skill.name} ${skill.description} ${skill.providerLabel ?? ""}`.toLowerCase();
    let score = 0;
    for (const word of words) if (text.includes(word)) score += 8;
    for (const capability of inferCapabilities(query)) if (text.includes(capability)) score += 6;
    if (/frontend|ui|design|browser|visual/.test(query) && /frontend|ui|design|browser|visual/.test(text)) score += 18;
    if (/review|bug|test|ci|pull request|pr\b/.test(query) && /review|test|debug|ci|github/.test(text)) score += 18;
    if (/research|source|synthesis|notes|memory/.test(query) && /research|source|synthesis|notes|memory|obsidian/.test(text)) score += 16;
    if (/schedule|background|aeon|automation|cadence/.test(query) && /schedule|background|aeon|automation|cadence/.test(text)) score += 18;
    if (score <= 0) continue;
    scored.push({
      id: `skill-${skill.slug}`,
      skillSlug: skill.slug,
      skillName: skill.name,
      reason: recommendationReason(query, skill.name),
      score,
      source: skill.providerLabel ?? "Shared brain",
      capabilities: skill.capabilities ?? inferCapabilities(text),
    });
  }

  for (const pack of input.packs ?? SKILL_PACKS) {
    const text = `${pack.id} ${pack.name} ${pack.description} ${pack.category} ${pack.capabilities.join(" ")}`.toLowerCase();
    let score = 0;
    for (const word of words) if (text.includes(word)) score += 5;
    if (score <= 0) continue;
    scored.push({
      id: `pack-${pack.id}`,
      skillSlug: pack.skills[0]?.slug ?? pack.id,
      skillName: pack.name,
      reason: `Install the ${pack.name} pack to cover this workflow with a reusable bundle.`,
      score,
      source: "Skill pack",
      packId: pack.id,
      capabilities: pack.capabilities,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, input.limit ?? 8);
}

export function createSkillDraft(input: {
  title?: string;
  sourceKind?: string;
  content: string;
}) {
  const title = input.title?.trim() || titleFromContent(input.content) || "New Portable Skill";
  const description = firstSentence(input.content) || `Use when ${title.toLowerCase()} is needed.`;
  const envKeys = [...new Set(input.content.match(ENV_KEY_RE) ?? [])].sort();
  const capabilities = inferCapabilities(input.content);
  const steps = input.content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length > 12)
    .slice(0, 8);
  return [
    "---",
    `name: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${title}`,
    "",
    description,
    "",
    "## When To Use",
    "",
    `Use this agent-agnostic skill when the task matches: ${description}`,
    "",
    "## Capabilities",
    "",
    `- ${capabilities.join("\n- ") || "chat"}`,
    "",
    "## Required Environment",
    "",
    envKeys.length ? envKeys.map((key) => `- ${key}`).join("\n") : "- None detected.",
    "",
    "## Workflow",
    "",
    (steps.length ? steps : [
      "Clarify the goal, constraints, and success criteria.",
      "Gather relevant files, notes, services, or runtime context.",
      "Execute the smallest safe workflow that satisfies the task.",
      "Verify the result and record any follow-up improvements.",
    ]).map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "",
    "## Safety",
    "",
    "- Ask for approval before mutation, spending, publishing, deployment, or unattended scheduling.",
    "- Never write secret values into skill files, logs, notes, or manifests.",
    "",
    `<!-- Drafted by HivemindOS skill converter from ${input.sourceKind || "user-provided context"}. Review before installing. -->`,
  ].join("\n");
}

export async function installSkillPack(input: { packId: string; vaultPath?: string }) {
  if (input.packId.startsWith(PACKAGED_DIRECTORY_PACK_PREFIX)) {
    return installPackagedDirectorySkillPack(input);
  }
  const packagedManifestPack = (await readPackagedManifestPacks()).find((candidate) => candidate.id === input.packId);
  if (packagedManifestPack) {
    return installPackagedSkillPack(input, packagedManifestPack);
  }
  const pack = SKILL_PACKS.find((candidate) => candidate.id === input.packId);
  if (!pack) throw new Error("Unknown skill pack.");
  const vaultPath = resolveObsidianVaultPath(input.vaultPath);
  const skillsFolder = join(vaultPath, "Skills");
  const installed: string[] = [];
  const skipped: string[] = [];
  await mkdir(skillsFolder, { recursive: true });
  for (const skill of pack.skills) {
    const dir = join(skillsFolder, skill.slug);
    const skillPath = join(dir, "SKILL.md");
    const existing = await readFile(skillPath, "utf8").catch(() => "");
    if (existing.trim()) {
      skipped.push(skill.slug);
      continue;
    }
    const audit = await auditSkillInput({ slug: skill.slug, markdown: skill.markdown, sourceRef: `pack:${pack.id}` });
    await mkdir(dir, { recursive: true });
    await writeFile(skillPath, `${skill.markdown.trim()}\n`, "utf8");
    const manifest = createSkillManifest({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      sourceType: "pack",
      sourceLabel: pack.name,
      sourceRef: `pack:${pack.id}`,
      audit,
      markdown: skill.markdown,
    });
    await writeFile(join(dir, SKILL_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    installed.push(skill.slug);
  }
  return { pack, installed, updated: [] as string[], skipped };
}

async function installPackagedDirectorySkillPack(input: { packId: string; vaultPath?: string }) {
  const group = input.packId.slice(PACKAGED_DIRECTORY_PACK_PREFIX.length);
  const sourceRoot = resolve(PACKAGED_OPTIONAL_ROOT, group);
  if (sourceRoot !== PACKAGED_OPTIONAL_ROOT && !sourceRoot.startsWith(`${PACKAGED_OPTIONAL_ROOT}/`)) {
    throw new Error("Packaged directory is outside the optional skills folder.");
  }
  const skillPaths = await findPackagedSkillFiles(sourceRoot, 4);
  const skills = (await Promise.all(skillPaths.map(packagedCatalogEntry)))
    .filter((skill): skill is SkillCatalogEntry => Boolean(skill));
  if (!skills.length) throw new Error("No packaged skills were found in that optional directory.");

  const pack = (await readPackagedDirectoryPacks()).find((candidate) => candidate.id === input.packId) ?? {
    id: input.packId,
    name: `${titleCase(group)} Optional Skills Directory`,
    description: `Install all optional ${group} skills into the shared brain in one pass.`,
    category: "Pack",
    capabilities: unionCapabilities(skills),
    skills: skills.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      markdown: "",
      packagedPath: skill.packagedPath,
    })),
  };
  return installPackagedSkillPack(input, pack);
}

async function installPackagedSkillPack(input: { packId: string; vaultPath?: string }, pack: SkillPack) {
  const vaultPath = resolveObsidianVaultPath(input.vaultPath);
  const skillsFolder = join(vaultPath, "Skills");
  const installed: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  await mkdir(skillsFolder, { recursive: true });

  for (const skill of pack.skills) {
    if (!skill.packagedPath) continue;
    const slug = safeId(skill.slug || skill.name);
    const sourceDir = resolve(process.cwd(), skill.packagedPath);
    assertPackagedSkillPath(sourceDir, slug);
    const dir = join(skillsFolder, slug);
    const skillPath = join(dir, "SKILL.md");
    const existing = await readFile(skillPath, "utf8").catch(() => "");
    const sourceMetadata = await readPackageSourceMetadata(sourceDir);
    const rawMarkdown = await readFile(join(sourceDir, "SKILL.md"), "utf8").catch(() => "");
    if (!rawMarkdown.trim()) throw new Error(`Packaged skill ${slug} is missing SKILL.md.`);
    const sourceLabel = String(sourceMetadata.sourceLabel ?? pack.name);
    const markdown = normalizeAgentAgnosticSkill(rawMarkdown, sourceLabel);
    const existingMetadata = await readPackageSourceMetadata(dir);
    const managedExisting = existing.trim() ? isManagedPackagedSkill(existing, existingMetadata) : false;
    if (existing.trim() && !managedExisting) {
      skipped.push(slug);
      continue;
    }
    if (existing.trim() === markdown.trim() && existingMetadata.sourcePath === skill.packagedPath) {
      skipped.push(slug);
      continue;
    }

    const stageDir = join(skillsFolder, `.installing-${slug}-${Date.now().toString(36)}`);
    await rm(stageDir, { recursive: true, force: true });
    try {
      await cp(sourceDir, stageDir, {
        recursive: true,
        force: true,
        filter: (path) => !path.split(/[\\/]/).some((part) => [".git", "node_modules", ".next", "dist", "build", ".cache", ".archive"].includes(part)),
      });
      const stagedSkillPath = join(stageDir, "SKILL.md");
      await writeFile(stagedSkillPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
      const audit = await auditSkillDirectory({
        slug,
        dir: stageDir,
        sourceRef: String(sourceMetadata.commit ?? `pack:${pack.id}`),
      });
      if (audit.status === "blocked") {
        throw new Error(`Skill audit blocked ${slug}: ${audit.findings.map((finding) => finding.title).join(", ")}`);
      }
      await writeFile(join(stageDir, SKILL_MANIFEST_FILE), `${JSON.stringify(createSkillManifest({
        slug,
        name: skill.name,
        description: skill.description,
        sourceType: "pack",
        sourceLabel,
        sourceUrl: typeof sourceMetadata.sourceUrl === "string" ? sourceMetadata.sourceUrl : undefined,
        sourceRef: typeof sourceMetadata.commit === "string" ? sourceMetadata.commit : `pack:${pack.id}`,
        sourcePath: skill.packagedPath,
        audit,
        markdown,
      }), null, 2)}\n`, "utf8");
      await writeFile(join(stageDir, SOURCE_METADATA_FILE), `${JSON.stringify({
        ...sourceMetadata,
        provider: /(^|[\\/])auto-install([\\/]|$)/.test(skill.packagedPath) ? "packaged-auto-install" : "packaged-optional",
        providerLabel: sourceLabel,
        sourcePath: skill.packagedPath,
        agentAgnostic: true,
        auditStatus: audit.status,
        capabilities: audit.capabilities,
        envKeys: audit.envKeys,
        installedFromPack: pack.id,
        installedAt: new Date().toISOString(),
      }, null, 2)}\n`, "utf8");
      const archiveDir = existing.trim() ? await archiveManagedSkill(dir, skillsFolder, slug) : undefined;
      await rm(dir, { recursive: true, force: true });
      try {
        await rename(stageDir, dir);
      } catch (error) {
        if (archiveDir) await cp(archiveDir, dir, { recursive: true, force: true });
        throw error;
      }
      if (existing.trim()) updated.push(slug);
      else installed.push(slug);
    } finally {
      await rm(stageDir, { recursive: true, force: true });
    }
  }

  return { pack, installed, updated, skipped };
}

function isManagedPackagedSkill(markdown: string, metadata: Record<string, unknown>) {
  const provider = String(metadata.provider ?? "").toLowerCase();
  if (["packaged-auto-install", "packaged-optional", "shared-brain"].includes(provider)) return true;
  return provider === "hermes" && /adapted from obra\/superpowers/i.test(markdown);
}

async function archiveManagedSkill(dir: string, skillsFolder: string, slug: string) {
  const archiveRoot = join(skillsFolder, ".archive");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = join(archiveRoot, `${slug}-${timestamp}`);
  await mkdir(archiveRoot, { recursive: true });
  await cp(dir, archiveDir, { recursive: true, force: false });
  return archiveDir;
}

export async function appendSkillAnalyticsEvent(event: Omit<SkillAnalyticsEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }) {
  const record: SkillAnalyticsEvent = {
    ...event,
    id: event.id ?? createHash("sha256").update(`${event.skillSlug}:${event.event}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16),
    createdAt: event.createdAt ?? new Date().toISOString(),
  };
  await mkdir(dirname(SKILL_ANALYTICS_FILE), { recursive: true });
  await appendFile(SKILL_ANALYTICS_FILE, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readSkillAnalytics(limit = 200) {
  const raw = await readFile(SKILL_ANALYTICS_FILE, "utf8").catch(() => "");
  return raw.split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line) as SkillAnalyticsEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is SkillAnalyticsEvent => Boolean(event));
}

export async function approveWorkflowAction(input: { skillSlug: string; actionId: string; auditStatus?: SkillAuditStatus; permissions?: string[] }) {
  const approvals = await readActionApprovals();
  const key = actionApprovalKey(input.skillSlug, input.actionId);
  approvals[key] = {
    skillSlug: input.skillSlug,
    actionId: input.actionId,
    auditStatus: input.auditStatus ?? "review",
    permissions: input.permissions ?? [],
    approvedAt: new Date().toISOString(),
  };
  await mkdir(dirname(SKILL_ACTION_APPROVALS_FILE), { recursive: true });
  await writeFile(SKILL_ACTION_APPROVALS_FILE, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
  return approvals[key];
}

export async function hasWorkflowActionApproval(skillSlug: string, actionId: string) {
  const approvals = await readActionApprovals();
  return Boolean(approvals[actionApprovalKey(skillSlug, actionId)]);
}

async function readActionApprovals(): Promise<Record<string, { skillSlug: string; actionId: string; auditStatus: SkillAuditStatus; permissions: string[]; approvedAt: string }>> {
  const raw = await readFile(SKILL_ACTION_APPROVALS_FILE, "utf8").catch(() => "{}");
  try {
    const parsed = JSON.parse(raw) as Record<string, { skillSlug: string; actionId: string; auditStatus: SkillAuditStatus; permissions: string[]; approvedAt: string }>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function actionApprovalKey(skillSlug: string, actionId: string) {
  return `${safeId(skillSlug)}:${safeId(actionId)}`;
}

function inferCapabilities(text: string): SkillCapability[] {
  const lower = text.toLowerCase();
  const capabilities = new Set<SkillCapability>(["chat"]);
  if (/\b(aeon|background|daemon|unattended|autopilot)\b/.test(lower)) capabilities.add("background");
  if (/\b(schedule|cron|cadence|recurring|nightly|daily)\b/.test(lower)) capabilities.add("scheduler");
  if (/\b(shell|bash|zsh|terminal|command|cli|pnpm|npm|git |gh |python|node)\b/.test(lower)) capabilities.add("shell");
  if (/\b(browser|playwright|chrome|screenshot|web app|localhost)\b/.test(lower)) capabilities.add("browser");
  if (/\b(mcp|model context protocol|tool server)\b/.test(lower)) capabilities.add("mcp");
  if (/\b(http|api|webhook|curl|fetch|rest|graphql)\b/.test(lower)) capabilities.add("http");
  if (/\b(file|folder|directory|path|filesystem|readfile|writefile)\b/.test(lower)) capabilities.add("filesystem");
  if (/\b(wallet|payment|spend|trade|bankr|x402|crypto|invoice)\b/.test(lower)) capabilities.add("wallet");
  if (/\b(publish|post|tweet|email|slack|notion|discord|telegram|upload)\b/.test(lower)) capabilities.add("publishing");
  if (/\b(deploy|release|production|vercel|cloudflare|worker|docker)\b/.test(lower)) capabilities.add("deployment");
  if (/\b(analytics|metrics|telemetry|dashboard|observability|slo)\b/.test(lower)) capabilities.add("analytics");
  if (/\b(aeon\.yml|aeon workflow|aeon skill)\b/.test(lower)) capabilities.add("aeon-workflow");
  return [...capabilities].sort();
}

function runtimeCapability(runtime: WorkflowActionRuntime): SkillCapability {
  if (runtime === "http") return "http";
  if (runtime === "mcp") return "mcp";
  if (runtime === "tauri-native") return "filesystem";
  return "shell";
}

function defaultPermissions(runtime: WorkflowActionRuntime) {
  if (runtime === "http") return ["network-access"];
  if (runtime === "mcp") return ["mcp-tool-call"];
  if (runtime === "tauri-native") return ["native-action"];
  return ["local-command"];
}

function auditStatus(findings: SkillAuditFinding[]): SkillAuditStatus {
  if (findings.some((finding) => finding.severity === "high")) return "blocked";
  if (findings.some((finding) => finding.severity === "medium")) return "restricted";
  if (findings.length) return "review";
  return "trusted";
}

function severityCost(severity: SkillAuditSeverity) {
  if (severity === "high") return 45;
  if (severity === "medium") return 20;
  return 6;
}

function recommendedAction(status: SkillAuditStatus) {
  if (status === "blocked") return "Do not import or run this skill until a human rewrites or approves the risky sections.";
  if (status === "restricted") return "Import only as reviewed instructions. Require explicit approval before actions, scheduling, or external calls.";
  if (status === "review") return "Import is allowed, but pin source references and review findings before enabling actions.";
  return "Safe for read-only import. Continue to require approval for any future mutating action.";
}

function recommendationReason(query: string, skillName: string) {
  if (/frontend|ui|browser|visual/.test(query)) return `${skillName} matches the UI/build/verification shape of this task.`;
  if (/review|bug|test|ci|pr\b/.test(query)) return `${skillName} helps inspect risk, tests, or code quality.`;
  if (/schedule|background|aeon|automation/.test(query)) return `${skillName} can help turn this into repeatable background work.`;
  return `${skillName} overlaps with the task language and available shared-skill context.`;
}

function firstSentence(value: string) {
  return value.replace(/\s+/g, " ").match(/(.{24,220}?[.!?])\s/)?.[1]?.trim() ?? "";
}

function titleFromContent(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line.length > 4 && line.length < 80);
}

function extension(path: string) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function safeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "action";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));
}

export function sourceRefFromGitHubUrl(githubUrl: string) {
  try {
    const url = new URL(githubUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : url.pathname;
    const treeIndex = parts.findIndex((part) => part === "tree" || part === "blob");
    const ref = treeIndex >= 0 ? parts[treeIndex + 1] : "";
    return `${repo}${ref ? `@${ref}` : ""}`;
  } catch {
    return githubUrl;
  }
}

export function skillManifestPath(vaultPath: string, slug: string) {
  return resolve(resolveObsidianVaultPath(vaultPath), "Skills", slug, SKILL_MANIFEST_FILE);
}
