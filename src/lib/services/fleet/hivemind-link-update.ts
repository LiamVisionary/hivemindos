import { randomUUID } from "node:crypto";

import {
  shellBaseFromCollectorUrl,
  shellSessionUrl,
} from "@/app/api/fleet/shell/shell-target";

const SHELL_REQUEST_TIMEOUT_MS = 10_000;
const SHELL_POLL_INTERVAL_MS = 500;

type UpdateScriptOptions = {
  collectorUrl?: string;
  script: string;
  timeoutMs: number;
};

type UpdateScriptDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sessionId?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
};

type ShellHistory = {
  ok?: boolean;
  error?: string;
  busy?: boolean;
  shellActive?: boolean;
  lines?: string[] | null;
};

export class HivemindLinkUpdateError extends Error {
  readonly commandAccepted: boolean;
  readonly completionUnknown: boolean;

  constructor(
    message: string,
    commandAccepted: boolean,
    completionUnknown = false,
  ) {
    super(message);
    this.name = "HivemindLinkUpdateError";
    this.commandAccepted = commandAccepted;
    this.completionUnknown = completionUnknown;
  }
}

function linkUpdateError(
  error: unknown,
  commandAccepted: boolean,
  completionUnknown = false,
) {
  if (error instanceof HivemindLinkUpdateError) return error;
  return new HivemindLinkUpdateError(
    error instanceof Error ? error.message : String(error),
    commandAccepted,
    completionUnknown,
  );
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function updateCommand(script: string, session: string) {
  const encodedScript = Buffer.from(script, "utf8").toString("base64");
  const quotedScript = shellSingleQuote(encodedScript);
  const completionMarker = `__HIVE_UPDATE_DONE_${session}__:`;
  return {
    command: [
      'hive_update_script=$(mktemp "${TMPDIR:-/tmp}/hivemind-update.XXXXXX")',
      [
        `if printf '%s' ${quotedScript} | base64 --decode > \"$hive_update_script\" 2>/dev/null`,
        `|| printf '%s' ${quotedScript} | base64 -D > \"$hive_update_script\" 2>/dev/null; then`,
        'bash "$hive_update_script";',
        "hive_update_exit=$?;",
        "else",
        "printf 'Could not decode the HivemindOS update script.\\n' >&2;",
        "hive_update_exit=127;",
        "fi",
      ].join(" "),
      'rm -f "$hive_update_script"',
      `printf '\\n${completionMarker}%s\\n' \"$hive_update_exit\"`,
    ].join("; "),
    completionMarker,
    encodedScript,
  };
}

async function responsePayload(response: Response): Promise<ShellHistory> {
  return response.json().catch(() => ({})) as Promise<ShellHistory>;
}

function visibleOutput(lines: string[], encodedScript: string, completionMarker: string) {
  return lines.filter(
    (line) =>
      !line.includes(encodedScript) &&
      !line.trim().startsWith(completionMarker),
  );
}

export async function runHivemindLinkUpdateScript(
  options: UpdateScriptOptions,
  dependencies: UpdateScriptDependencies = {},
) {
  const base = shellBaseFromCollectorUrl(options.collectorUrl);
  if (!base) throw new Error("Hivemind Link shell is unavailable for this machine.");

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const session = (dependencies.sessionId?.() ?? randomUUID()).replaceAll("-", "_");
  const { command, completionMarker, encodedScript } = updateCommand(
    options.script,
    session,
  );

  const startResponse = await fetchImpl(shellSessionUrl(base, session, "command"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
    cache: "no-store",
    signal: AbortSignal.timeout(SHELL_REQUEST_TIMEOUT_MS),
  });
  const startPayload = await responsePayload(startResponse);
  if (!startResponse.ok || startPayload.ok === false) {
    throw new HivemindLinkUpdateError(
      startPayload.error ||
        `Hivemind Link shell rejected the update with HTTP ${startResponse.status}.`,
      false,
    );
  }

  const deadline = now() + options.timeoutMs;
  let lastLines: string[] = [];
  while (now() < deadline) {
    const historyResponse = await fetchImpl(shellSessionUrl(base, session), {
      cache: "no-store",
      signal: AbortSignal.timeout(SHELL_REQUEST_TIMEOUT_MS),
    }).catch((error) => {
      throw linkUpdateError(error, true, true);
    });
    const history = await responsePayload(historyResponse);
    if (!historyResponse.ok || history.ok === false) {
      throw new HivemindLinkUpdateError(
        history.error ||
          `Hivemind Link shell history failed with HTTP ${historyResponse.status}.`,
        true,
        true,
      );
    }
    const historyLines = Array.isArray(history.lines)
      ? history.lines.map(String)
      : [];
    if (
      history.shellActive === false &&
      history.busy === false &&
      history.lines == null
    ) {
      return {
        disconnected: true,
        exitCode: null,
        stdout: visibleOutput(lastLines, encodedScript, completionMarker)
          .join("\n")
          .trim(),
      };
    }
    lastLines = historyLines;
    const completionLine = lastLines.find((line) => {
      const markerIndex = line.indexOf(completionMarker);
      if (markerIndex < 0) return false;
      return /^\d+$/.test(line.slice(markerIndex + completionMarker.length).trim());
    });
    if (completionLine) {
      const markerIndex = completionLine.indexOf(completionMarker);
      const exitCode = Number(
        completionLine.slice(markerIndex + completionMarker.length).trim(),
      );
      const outputLines = visibleOutput(
        lastLines,
        encodedScript,
        completionMarker,
      );
      const stdout = outputLines.join("\n").trim();
      if (exitCode !== 0) {
        const detail = outputLines.slice(-80).join("\n").trim();
        throw new HivemindLinkUpdateError(
          `Hivemind Link update exited with code ${exitCode}${detail ? `:\n${detail}` : ""}`,
          true,
        );
      }
      return { disconnected: false, exitCode, stdout };
    }
    await sleep(SHELL_POLL_INTERVAL_MS);
  }

  const detail = visibleOutput(lastLines, encodedScript, completionMarker)
    .slice(-40)
    .join("\n")
    .trim();
  throw new HivemindLinkUpdateError(
    `Hivemind Link update did not finish within ${Math.ceil(options.timeoutMs / 1_000)} seconds${detail ? `:\n${detail}` : ""}`,
    true,
    true,
  );
}
