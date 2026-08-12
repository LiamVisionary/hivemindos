import { isHivemindFastContextCommand } from "@/lib/services/queen-bee/queen-brain";
import { readQueenVoiceBrainContext } from "@/lib/services/queen-bee/voice-brain-reads";
import {
  OPEN_LOCAL_APP_TOOL_NAME,
  openLocalApp,
} from "@/lib/services/queen-bee/local-app-tool";
import {
  coerceXAccountReadToolInput,
  X_ACCOUNT_READ_TOOL_NAME,
} from "@/lib/services/x-account-tool-contract";
import { runXAccountReadTool } from "@/lib/services/x-latest-post";

export type QueenVoiceServerToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** Execute the small server-owned tool set shared by direct voice providers. */
export async function executeQueenVoiceServerTool(input: {
  call: QueenVoiceServerToolCall;
  runCapability: (message: string) => Promise<object>;
}): Promise<string> {
  try {
    const args = JSON.parse(input.call.arguments || "{}") as Record<string, unknown>;
    if (input.call.name === X_ACCOUNT_READ_TOOL_NAME) {
      return runXAccountReadTool(coerceXAccountReadToolInput(args));
    }
    if (input.call.name === OPEN_LOCAL_APP_TOOL_NAME) {
      return openLocalApp(args.appName);
    }
    if (input.call.name === "read_hivemind_context") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) throw new Error("A read-only Brain query is required.");
      return readQueenVoiceBrainContext(query);
    }
    if (input.call.name === "use_hive_capability") {
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) throw new Error("A capability goal is required.");
      return isHivemindFastContextCommand(message)
        ? readQueenVoiceBrainContext(message)
        : JSON.stringify({ ok: true, ...(await input.runCapability(message)) });
    }
    throw new Error(`Unknown Queen voice tool: ${input.call.name}.`);
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Queen capability tool failed.",
    });
  }
}
