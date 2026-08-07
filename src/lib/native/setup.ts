import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export const NATIVE_SETUP_DEMO_ENABLED = true;
export const NATIVE_SETUP_RERUN_EVENT = "hivemindos:rerun-setup";

export type NativeSetupCheck = {
  id: string;
  label: string;
  installed: boolean;
  detail: string;
  install_command?: string | null;
  optional: boolean;
};

export type NativeDetectedAgentRuntime = {
  id: string;
  label: string;
  installed: boolean;
  detail: string;
};

export type NativeSetupStatus = {
  ok?: boolean;
  checked_at?: string;
  auto_runs_setup_script?: boolean;
  setup_script_available?: boolean;
  setup_script_path?: string | null;
  platform?: string;
  checks?: NativeSetupCheck[];
  detected_agents?: NativeDetectedAgentRuntime[];
  error?: string;
};

export type NativeSetupRunInput = {
  installMode: string;
  skillAgents: string[];
  memoryAgents: string[];
  importSkills: boolean;
  importMemory: boolean;
  startDashboard: boolean;
  installCollector: boolean;
  buildDashboard: boolean;
  installDeps: boolean;
  force: boolean;
};

export type NativeSetupRunResult = {
  ok?: boolean;
  command?: string;
  command_path?: string;
  mode?: string;
  error?: string;
};

export function createNativeSetupDemoStatus(): NativeSetupStatus {
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    auto_runs_setup_script: false,
    setup_script_available: true,
    setup_script_path: "./setup.sh",
    platform: "demo",
    checks: [
      {
        id: "demo-app",
        label: "HivemindOS app",
        installed: true,
        detail: "Demo preview only. No setup files or services will be changed.",
        optional: false,
      },
    ],
    detected_agents: [
      { id: "codex", label: "Codex", installed: true, detail: "Detected for demo preview" },
      { id: "claude", label: "Claude", installed: true, detail: "Detected for demo preview" },
      { id: "hermes", label: "Hermes", installed: true, detail: "Detected for demo preview" },
      { id: "gemini", label: "Gemini", installed: true, detail: "Detected for demo preview" },
      { id: "openclaw", label: "OpenClaw", installed: true, detail: "Detected for demo preview" },
      { id: "aeon", label: "Aeon", installed: true, detail: "Detected for demo preview" },
    ],
  };
}

type NativeSetupOptions = {
  demoMode?: boolean;
};

export async function readNativeSetupStatus(options?: NativeSetupOptions): Promise<NativeSetupStatus | null> {
  if (options?.demoMode) return createNativeSetupDemoStatus();
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeSetupStatus>("native_setup_status");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error || "Could not read native setup status."),
    };
  }
}

export async function runNativeSetup(input: NativeSetupRunInput, options?: NativeSetupOptions): Promise<NativeSetupRunResult | null> {
  if (options?.demoMode) {
    return {
      ok: true,
      mode: input.installMode,
      command: "demo",
      command_path: "demo",
    };
  }
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeSetupRunResult>("native_setup_run", { request: input });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error || "Could not start native setup."),
    };
  }
}

/**
 * This machine's system-Tailscale IPv4 — the exact address the desktop app's
 * phone bridge binds. The pairing QR must use this rather than the dashboard's
 * device list, whose "self" can be a different (hivemind-linkd embedded-tsnet)
 * node with no bridge on the dashboard port. Returns null off-desktop or when
 * Tailscale is down (the caller then falls back to the device list).
 */
export async function nativePairingHost(): Promise<string | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("native_pairing_host")) ?? null;
  } catch {
    return null;
  }
}

/**
 * The dashboard device token, straight from the native app (packaged: the token
 * the native server was started with; dev: read from the checkout .env.local).
 * The pairing QR embeds this so a paired phone authenticates to the hub's /api
 * gate — and this native path works even when the dashboard webview has no
 * session (its data comes via native commands, so a bare /api fetch 401s).
 * Returns null off-desktop or if the command has no token.
 */
export async function nativeDashboardToken(): Promise<string | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("native_dashboard_unlock_token")) ?? null;
  } catch {
    return null;
  }
}
