import type { KnownAgentRuntime } from "@/lib/types/agent-runtime";

// Shared, browser-safe catalog describing how each agent runtime is installed
// and authenticated, so the in-app "Set up runtime" wizard
// (RuntimeInstallSetup.tsx) and the server-side installers
// (runtime-adapters/cli-runtimes.ts for the local machine, the collector's
// /runtimes/<id>/integrations handler for remote machines) all agree on the
// exact package names, commands, and credential env vars.
//
// IMPORTANT: this file must stay free of node-only imports — it is bundled into
// the client. The standalone collector (scripts/agent-telemetry-collector.mjs)
// cannot import this TS module, so it keeps a minimal mirror; keep the package
// names in sync between the two.

export type RuntimeInstallKind = "npm" | "uv" | "curl" | "external";

export type RuntimeAuthOption = {
  // Env var the credential is stored under (in the shared hive env).
  env: string;
  // Human label for the field.
  label: string;
  placeholder?: string;
  // Where to get it / how to produce it.
  help?: string;
  // A subscription/OAuth token the user pastes after running a CLI command,
  // rather than a provider API key.
  pasteFromCommand?: string;
};

export type RuntimeInstallSpec = {
  runtime: KnownAgentRuntime;
  label: string;
  // One-line description shown at the top of the setup view.
  blurb: string;
  // Whether the app can drive a real install on the user's machine. When false,
  // the setup view degrades to a copyable command + "I've done it, re-check".
  inAppInstall: boolean;
  installKind: RuntimeInstallKind;
  // npm global package (installKind "npm").
  npmPackage?: string;
  // uv tool package (installKind "uv").
  uvPackage?: string;
  uvPythonPin?: string;
  // curl|bash installer URL (installKind "curl"), unix only.
  curlInstallUrl?: string;
  // Human-readable install command preview per platform (shown in the UI and
  // used for the copyable degrade path).
  installPreview: { unix: string; windows: string };
  // Command that proves the binary resolves after install (display only).
  verifyCommand?: string;
  // Credential options the user can provide. Empty => no key needed.
  auth: RuntimeAuthOption[];
  // Browser-OAuth fallback when there is no headless key path.
  oauth?: { command: string; note: string };
  // Platforms where the in-app install can't run (degrade to manual there).
  unsupportedPlatforms?: Array<"windows" | "darwin" | "linux">;
  // Extra guidance shown in the setup view.
  notes?: string;
};

const ANTHROPIC_HELP = "Pay-as-you-go key from console.anthropic.com (starts with sk-ant-).";

export const RUNTIME_INSTALL_CATALOG: Partial<Record<KnownAgentRuntime, RuntimeInstallSpec>> = {
  "claude-code": {
    runtime: "claude-code",
    label: "Claude Code",
    blurb: "Anthropic's official coding agent CLI (the `claude` command).",
    inAppInstall: true,
    installKind: "npm",
    npmPackage: "@anthropic-ai/claude-code",
    installPreview: {
      unix: "npm install -g @anthropic-ai/claude-code",
      windows: "npm install -g @anthropic-ai/claude-code",
    },
    verifyCommand: "claude --version",
    auth: [
      { env: "ANTHROPIC_API_KEY", label: "Anthropic API key", placeholder: "sk-ant-...", help: ANTHROPIC_HELP },
      {
        env: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Claude subscription token",
        placeholder: "Paste the token from `claude setup-token`",
        help: "Already pay for Claude? Run `claude setup-token` in a terminal, sign in, then paste the token here.",
        pasteFromCommand: "claude setup-token",
      },
    ],
    oauth: { command: "claude", note: "Or run `claude` and use /login to sign in with your Claude subscription in a browser." },
  },
  codex: {
    runtime: "codex",
    label: "Codex",
    blurb: "OpenAI's Codex coding agent CLI (the `codex` command).",
    inAppInstall: true,
    installKind: "npm",
    npmPackage: "@openai/codex",
    installPreview: {
      unix: "npm install -g @openai/codex",
      windows: "npm install -g @openai/codex",
    },
    verifyCommand: "codex --version",
    auth: [
      { env: "OPENAI_API_KEY", label: "OpenAI API key", placeholder: "sk-...", help: "From platform.openai.com/api-keys." },
    ],
    oauth: { command: "codex login", note: "Or run `codex login` to sign in with your ChatGPT/OpenAI account in a browser." },
  },
  opencode: {
    runtime: "opencode",
    label: "OpenCode",
    blurb: "The open-source terminal coding agent (sst/opencode).",
    inAppInstall: true,
    installKind: "npm",
    npmPackage: "opencode-ai",
    installPreview: {
      unix: "npm install -g opencode-ai",
      windows: "npm install -g opencode-ai",
    },
    verifyCommand: "opencode --version",
    auth: [
      { env: "OPENROUTER_API_KEY", label: "OpenRouter API key", placeholder: "sk-or-...", help: "From openrouter.ai/keys (OpenCode's default provider)." },
    ],
  },
  openhands: {
    runtime: "openhands",
    label: "OpenHands",
    blurb: "All-Hands' autonomous software agent, installed as a uv tool.",
    inAppInstall: true,
    installKind: "uv",
    uvPackage: "openhands",
    uvPythonPin: "3.12",
    installPreview: {
      unix: "uv tool install openhands --python 3.12",
      windows: "uv tool install openhands --python 3.12",
    },
    verifyCommand: "openhands --version",
    auth: [
      { env: "LLM_API_KEY", label: "LLM API key", help: "API key for the model provider OpenHands should use." },
    ],
    notes: "Needs the uv package manager (the wizard will install it if missing).",
  },
  aider: {
    runtime: "aider",
    label: "Aider",
    blurb: "Pair-programming coding agent in your terminal, installed as a uv tool.",
    inAppInstall: true,
    installKind: "uv",
    uvPackage: "aider-chat",
    installPreview: {
      unix: "uv tool install aider-chat",
      windows: "uv tool install aider-chat",
    },
    verifyCommand: "aider --version",
    auth: [
      { env: "OPENROUTER_API_KEY", label: "OpenRouter API key", placeholder: "sk-or-...", help: "From openrouter.ai/keys (Aider's default provider)." },
    ],
    notes: "Needs the uv package manager (the wizard will install it if missing).",
  },
  evo: {
    runtime: "evo",
    label: "Evo",
    blurb: "The Evo optimization runtime, installed as a uv tool.",
    inAppInstall: true,
    installKind: "uv",
    uvPackage: "evo-hq-cli",
    installPreview: {
      unix: "uv tool install evo-hq-cli",
      windows: "uv tool install evo-hq-cli",
    },
    verifyCommand: "evo --version",
    // Evo drives another runtime's credentials; it has no key of its own.
    auth: [],
    notes: "Evo runs on top of another installed runtime, so it doesn't need its own API key. Set up a coding runtime (e.g. Claude Code) first.",
  },
  hermes: {
    runtime: "hermes",
    label: "Hermes",
    blurb: "The Nous Research Hermes gateway runtime (the `hermes` command).",
    // Hermes is set up through a Docker-based control-room bootstrap, not a
    // single verified one-liner, so we guide rather than auto-run an installer.
    inAppInstall: false,
    installKind: "external",
    installPreview: {
      unix: "Set up Hermes from its control room (see the Hermes runtime docs), then re-check.",
      windows: "Set up Hermes from its control room (see the Hermes runtime docs), then re-check.",
    },
    verifyCommand: "hermes --version",
    auth: [],
    notes: "Hermes installs via its Docker-based control room (nousresearch/hermes-agent), so HivemindOS can't auto-install it. Follow the Hermes runtime setup, then re-check — after that you can pick providers and models here.",
  },
  openclaw: {
    runtime: "openclaw",
    label: "OpenClaw",
    blurb: "The OpenClaw gateway agent runtime.",
    // Install command isn't confirmed against upstream docs yet, so degrade to a
    // copyable command + re-check rather than running an unverified installer.
    inAppInstall: false,
    installKind: "external",
    installPreview: {
      unix: "See docs.openclaw.ai for the current install command.",
      windows: "See docs.openclaw.ai for the current install command.",
    },
    verifyCommand: "openclaw --version",
    auth: [],
    notes: "OpenClaw is set up through its own onboarding (gateway + at least one model). Follow docs.openclaw.ai, then re-check.",
  },
};

export function runtimeInstallSpec(runtime: string): RuntimeInstallSpec | undefined {
  return RUNTIME_INSTALL_CATALOG[runtime as KnownAgentRuntime];
}

// A runtime card is clickable into the setup view when we have catalog guidance
// for it (either a real in-app install or a copyable-command degrade). Aeon and
// hivemind-os are handled by their own flows and are intentionally absent.
export function runtimeHasInstallSetup(runtime: string): boolean {
  return Boolean(RUNTIME_INSTALL_CATALOG[runtime as KnownAgentRuntime]);
}
