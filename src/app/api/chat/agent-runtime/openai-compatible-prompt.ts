import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  buildHivemindPromptEnvelope,
  prependHivemindSystemMessage,
} from "@/lib/services/chat/hivemind-system-prompt";
import { openAICompatibleMessageCacheControlSupported } from "@/lib/services/chat/inference-cache-hints";
import { buildAdaptiveOpenRouterResolvedModelContext } from "./openai-compat";
import type { AgentMode } from "./runtime-helpers";
import type { IncomingMessage } from "./messages";

export function createOpenAICompatibleModelMessagesBuilder(input: {
  runtimeProfile: AgentProfile;
  modelInputMessages: IncomingMessage[];
  agentMode: AgentMode;
  workingDirectory?: string;
  vaultPromptContext: string;
  sharedBrainMemoryContext: string;
  taskRetrievalContext: string;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  return (candidateProfile: AgentProfile, candidateModel: string) => {
    const promptEnvelope = buildHivemindPromptEnvelope({
      profile: candidateProfile,
      agentMode: input.agentMode,
      workingDirectory: input.workingDirectory,
      vaultContext: input.vaultPromptContext,
      sharedBrainMemoryContext: input.sharedBrainMemoryContext,
      taskRetrievalContext: input.taskRetrievalContext,
      wallet: input.wallet,
      runtimeSessionId: input.runtimeSessionId,
      extraDynamicContext: buildAdaptiveOpenRouterResolvedModelContext(
        input.runtimeProfile,
        candidateModel,
      ),
    });
    return prependHivemindSystemMessage(input.modelInputMessages, promptEnvelope, {
      cacheControl: openAICompatibleMessageCacheControlSupported({
        provider: candidateProfile.provider,
        model: candidateModel,
      }),
    });
  };
}
