import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPEN_LOCAL_APP_TOOL_NAME = "open_local_app";

export const OPEN_LOCAL_APP_CHAT_TOOL = {
  type: "function" as const,
  function: {
    name: OPEN_LOCAL_APP_TOOL_NAME,
    description:
      "Open or bring forward an installed macOS application immediately. Use this specific tool instead of use_hive_capability when the user simply asks to open or launch an app on this Mac.",
    parameters: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          description: "Installed application name, for example Notes, Calendar, or Safari.",
        },
      },
      required: ["appName"],
      additionalProperties: false,
    },
  },
};

export function normalizeLocalAppName(value: unknown) {
  const appName = typeof value === "string" ? value.trim() : "";
  if (!appName) throw new Error("An application name is required.");
  if (appName.length > 80 || /[\\/\0\r\n]/.test(appName)) {
    throw new Error("The application name is invalid.");
  }
  return appName;
}

export async function openLocalApp(value: unknown) {
  const appName = normalizeLocalAppName(value);
  if (process.platform !== "darwin") {
    throw new Error("Direct application opening is available only on macOS.");
  }
  await execFileAsync("/usr/bin/open", ["-a", appName], { timeout: 5_000 });
  return JSON.stringify({
    ok: true,
    appName,
    message: `${appName} is open.`,
  });
}
