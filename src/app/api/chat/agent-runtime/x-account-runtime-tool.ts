import {
  coerceXAccountReadToolInput,
  X_ACCOUNT_READ_CHAT_TOOL,
  X_ACCOUNT_READ_TOOL_NAME,
} from "@/lib/services/x-account-tool-contract";
import {
  runXAccountReadTool,
  xAccountReadSessionPresent,
} from "@/lib/services/x-latest-post";

export const X_ACCOUNT_RUNTIME_TOOL_NAME = X_ACCOUNT_READ_TOOL_NAME;
export const X_ACCOUNT_RUNTIME_TOOL_DEFINITION = X_ACCOUNT_READ_CHAT_TOOL;
export const xAccountRuntimeToolAvailable = xAccountReadSessionPresent;

export async function runXAccountRuntimeTool(rawArguments: string) {
  try {
    const parsed = JSON.parse(rawArguments || "{}") as unknown;
    const result = await runXAccountReadTool(coerceXAccountReadToolInput(parsed));
    return {
      toolResultContent: JSON.stringify({ ok: true, result }),
      fallbackText: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "X account read failed.";
    return {
      toolResultContent: JSON.stringify({ ok: false, error: message }),
      fallbackText: `I couldn't read the connected X account: ${message}`,
    };
  }
}
