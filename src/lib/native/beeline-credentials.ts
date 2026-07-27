import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type {
  BeelineLocalCredential,
  BeelineLocalCredentialStoreInput,
} from "@/lib/types/beeline";

export type NativeBeelineCredentialList = {
  backend: "os-keychain";
  available: boolean;
  credentials: BeelineLocalCredential[];
};

async function nativeInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Local credentials are available only inside the HivemindOS desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function listNativeBeelineCredentials(profileId: string) {
  return nativeInvoke<NativeBeelineCredentialList>("beeline_local_credentials_list", { profileId });
}

export function storeNativeBeelineCredential(input: BeelineLocalCredentialStoreInput) {
  return nativeInvoke<BeelineLocalCredential>("beeline_local_credential_store", { input });
}

export function deleteNativeBeelineCredential(profileId: string, credentialId: string) {
  return nativeInvoke<{ deleted: boolean }>("beeline_local_credential_delete", { profileId, credentialId });
}

export function deleteNativeBeelineProfileCredentials(profileId: string) {
  return nativeInvoke<{ deleted: number }>("beeline_local_credentials_delete_profile", { profileId });
}
