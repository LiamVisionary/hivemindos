import { appendRuntimeChatSessionEvent } from "@/lib/services/chat/runtime-session-store";
import { createBrowserUseComputerInteractionAdapter, createReportedComputerInteractionAdapter, createScreenshotComputerInteractionAdapter } from "./browser-use-adapter";
import { createComputerInteractionOrchestrator } from "./orchestrator";
import { createComputerInteractionRunStore } from "./store";

export const computerInteractionRunStore = createComputerInteractionRunStore();

export function createServerComputerInteractionOrchestrator() {
  return createComputerInteractionOrchestrator({
    store: computerInteractionRunStore,
    adapters: [
      createReportedComputerInteractionAdapter("hive-action"),
      createReportedComputerInteractionAdapter("bee-pilot"),
      createReportedComputerInteractionAdapter("page-agent"),
      createBrowserUseComputerInteractionAdapter(),
      createScreenshotComputerInteractionAdapter(),
    ],
    onEvent: async (event, run) => {
      if (!run.runtimeSessionId) return;
      await appendRuntimeChatSessionEvent(
        run.runtimeSessionId,
        event.label,
        event.detail,
        { computerInteraction: event },
      ).catch((error) => {
        console.warn("[computer-interaction] Could not mirror an event into the runtime session:", error instanceof Error ? error.message : "unknown error");
      });
    },
  });
}
