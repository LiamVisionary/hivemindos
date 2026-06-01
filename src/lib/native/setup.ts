import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

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

export async function readNativeSetupStatus(): Promise<NativeSetupStatus | null> {
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

export async function runNativeSetup(input: NativeSetupRunInput): Promise<NativeSetupRunResult | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeSetupRunResult>("native_setup_run", input);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error || "Could not start native setup."),
    };
  }
}
