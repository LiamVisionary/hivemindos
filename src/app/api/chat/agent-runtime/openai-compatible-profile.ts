import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  isBankrLlmProfile,
  resolveBankrLlmRuntimeProfile,
} from "@/lib/services/bankr-llm";
import {
  isHivemindosWalletPaidModelProfile,
  resolveHivemindosWalletPaidModelRuntimeConfig,
} from "@/lib/services/hivemindos-wallet-paid-models";
import {
  isHiveComputeProfile,
  resolveHiveComputeRuntimeConfig,
} from "@/lib/services/hive-compute-marketplace";
import { isUsePodProfile, resolveUsePodRuntimeConfig } from "@/lib/services/usepod";
import { isVeniceProfile, resolveVeniceRuntimeConfig } from "@/lib/services/venice";

export class OpenAICompatibleProfileError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requestOriginFromUrl(value?: string) {
  try {
    return new URL(value ?? "").origin;
  } catch {
    return "";
  }
}

export async function resolveOpenAICompatibleProfile(input: {
  profile: AgentProfile;
  wallet?: AgentWalletConfig;
  requestOrigin: string;
}) {
  const { profile, wallet, requestOrigin } = input;
  let runtimeProfile = profile;
  let usePodHeaders: Record<string, string> = {};
  let providerHeaders: Record<string, string> = {};
  const usePodEnabled = isUsePodProfile(profile);
  const walletPaidModelsEnabled = isHivemindosWalletPaidModelProfile(profile);
  const hiveComputeEnabled = isHiveComputeProfile(profile);

  try {
    const usePodConfig = await resolveUsePodRuntimeConfig(profile);
    if (usePodConfig) {
      runtimeProfile = {
        ...profile,
        gatewayUrl: usePodConfig.baseUrl,
        chatPath: usePodConfig.chatPath,
        statusPath: usePodConfig.statusPath,
        token: "",
      };
      usePodHeaders = usePodConfig.headers;
    }
  } catch (error) {
    throw new OpenAICompatibleProfileError(
      error instanceof Error ? error.message : "UsePod setup is incomplete.",
      502,
    );
  }

  if (isVeniceProfile(profile)) {
    try {
      const veniceConfig = await resolveVeniceRuntimeConfig(profile);
      if (veniceConfig) {
        runtimeProfile = {
          ...profile,
          gatewayUrl: veniceConfig.baseUrl,
          chatPath: veniceConfig.chatPath,
          statusPath: veniceConfig.statusPath,
          token: "",
        };
        providerHeaders = veniceConfig.headers;
      }
    } catch (error) {
      throw new OpenAICompatibleProfileError(
        error instanceof Error ? error.message : "Venice setup is incomplete.",
        502,
      );
    }
  }

  if (isBankrLlmProfile(profile)) {
    const resolved = await resolveBankrLlmRuntimeProfile(runtimeProfile);
    if (resolved.error) throw new OpenAICompatibleProfileError(resolved.error, 400);
    runtimeProfile = resolved.profile;
    providerHeaders = resolved.headers;
  }

  if (walletPaidModelsEnabled) {
    try {
      const config = resolveHivemindosWalletPaidModelRuntimeConfig(profile, wallet, requestOrigin);
      runtimeProfile = {
        ...profile,
        gatewayUrl: config.baseUrl,
        chatPath: config.chatPath,
        statusPath: config.statusPath,
        model: config.model,
        token: "",
        telemetryUrl: "",
      };
      providerHeaders = { ...providerHeaders, ...config.headers };
    } catch (error) {
      throw new OpenAICompatibleProfileError(
        error instanceof Error ? error.message : "HivemindOS Models setup is incomplete.",
        400,
      );
    }
  }

  if (hiveComputeEnabled) {
    try {
      const config = resolveHiveComputeRuntimeConfig(profile, requestOrigin);
      runtimeProfile = {
        ...profile,
        gatewayUrl: config.baseUrl,
        chatPath: config.chatPath,
        statusPath: config.statusPath,
        model: config.model,
        token: "",
        telemetryUrl: "",
      };
      providerHeaders = { ...providerHeaders, ...config.headers };
    } catch (error) {
      throw new OpenAICompatibleProfileError(
        error instanceof Error ? error.message : "Hive Compute setup is incomplete.",
        400,
      );
    }
  }

  return {
    runtimeProfile,
    usePodHeaders,
    providerHeaders,
    usePodEnabled,
    walletPaidModelsEnabled,
  };
}
