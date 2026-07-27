/**
 * Read/write a remote machine's `~/.hermes/cron/jobs.json` over the linkd shell
 * rail (the same `/_hivemind/shell/sessions/<id>` path /api/fleet/shell proxies).
 *
 * The document is read out, mutated in JS via hermes-cron-doc (single-sourced,
 * tested), and written back base64-encoded so no cron JSON ever passes through
 * shell quoting. A timestamped backup is taken first, and the write is atomic
 * (tmp + os.replace on the box). Callers verify via the returned marker line.
 */

const READ_MARKER_BEGIN = "CRONREAD_BEGIN";
const READ_MARKER_END = "CRONREAD_END";
const WRITE_MARKER = "CRONWRITE_OK";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

async function shellCommand(base: string, session: string, command: string): Promise<void> {
  const response = await fetch(`${base}/_hivemind/shell/sessions/${encodeURIComponent(session)}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`shell command HTTP ${response.status}`);
}

async function shellLines(base: string, session: string): Promise<string[]> {
  const response = await fetch(`${base}/_hivemind/shell/sessions/${encodeURIComponent(session)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`shell history HTTP ${response.status}`);
  const data = await response.json().catch(() => null) as { lines?: unknown } | null;
  return Array.isArray(data?.lines) ? data!.lines.map((line) => String(line)) : [];
}

/** Poll the session history until `predicate` finds a line, or time out. */
async function waitForLines(
  base: string,
  session: string,
  predicate: (lines: string[]) => boolean,
  timeoutMs = 12_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let lines: string[] = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    lines = await shellLines(base, session);
    if (predicate(lines)) return lines;
  }
  return lines;
}

/**
 * Shell-safe cron path. A leading `~` becomes `$HOME` so it expands inside the
 * double quotes we wrap it in (a quoted literal `~` would NOT expand); absolute
 * paths pass through. Hermes cron paths never contain spaces or quotes.
 */
function shellCronPath(homeDir: string): string {
  const home = homeDir.startsWith("~") ? `$HOME${homeDir.slice(1)}` : homeDir;
  return `"${home}/cron/jobs.json"`;
}

/** Read and JSON-parse `<home>/cron/jobs.json` on the target machine. */
export async function readRemoteCronDoc(base: string, session: string, homeDir: string): Promise<string> {
  const path = shellCronPath(homeDir);
  // cat between markers so we can slice the payload out of the shell scrollback.
  // `base64 -d` prints the marker without a trailing newline, so echo a newline
  // after it — otherwise the marker and the payload collide on one scrollback
  // line and the slice can't find the marker.
  await shellCommand(
    base,
    session,
    `echo ${b64(READ_MARKER_BEGIN)} | base64 -d; echo; { cat ${path} 2>/dev/null | base64 -w0 2>/dev/null || cat ${path} 2>/dev/null | base64; }; echo; echo ${b64(READ_MARKER_END)} | base64 -d; echo`,
  );
  const lines = await waitForLines(base, session, (ls) => ls.includes(READ_MARKER_END));
  const begin = lines.lastIndexOf(READ_MARKER_BEGIN);
  const end = lines.lastIndexOf(READ_MARKER_END);
  if (begin < 0 || end < 0 || end <= begin) throw new Error("could not read remote jobs.json");
  const payload = lines.slice(begin + 1, end).join("").trim();
  if (!payload) return ""; // file absent/empty → empty doc
  return Buffer.from(payload, "base64").toString("utf8");
}

/**
 * Back up (cp), then atomically write `contents` to `<home>/cron/jobs.json`.
 * Returns the verification lines (the WRITE_MARKER line carries the backup path).
 */
export async function writeRemoteCronDoc(
  base: string,
  session: string,
  homeDir: string,
  contents: string,
): Promise<string[]> {
  const py = [
    "import base64,os,shutil,time,sys",
    `p=os.path.expanduser(${JSON.stringify(`${homeDir}/cron/jobs.json`)})`,
    "os.makedirs(os.path.dirname(p),exist_ok=True)",
    "bak=''",
    "if os.path.exists(p):",
    "    bak=p+'.bak.'+str(int(time.time()))",
    "    shutil.copy(p,bak)",
    `data=base64.b64decode(${JSON.stringify(b64(contents))})`,
    "tmp=p+'.cronwrite.tmp'",
    "open(tmp,'wb').write(data)",
    "os.replace(tmp,p)",
    `print('${WRITE_MARKER}','bak='+bak)`,
  ].join("\n");
  await shellCommand(base, session, `echo ${b64(py)} | base64 -d | python3`);
  const lines = await waitForLines(base, session, (ls) => ls.some((l) => l.startsWith(WRITE_MARKER) || /Traceback|Error/.test(l)));
  if (!lines.some((l) => l.startsWith(WRITE_MARKER))) {
    throw new Error(`remote write not confirmed: ${lines.slice(-4).join(" | ")}`);
  }
  return lines;
}
