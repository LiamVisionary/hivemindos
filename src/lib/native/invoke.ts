import { invoke } from "@tauri-apps/api/core";

export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}
