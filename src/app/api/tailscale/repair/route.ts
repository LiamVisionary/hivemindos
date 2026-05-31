import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type RepairStep = {
  label: string;
  ok: boolean;
  detail?: string;
};

async function runStep(label: string, command: string, args: string[], timeout = 8_000): Promise<RepairStep> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 200_000 });
    return {
      label,
      ok: true,
      detail: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n"),
    };
  } catch (error) {
    return {
      label,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function userLaunchAgentTarget(label: string) {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return uid === undefined ? label : `gui/${uid}/${label}`;
}

async function restartLocalTailnet() {
  const steps: RepairStep[] = [];
  steps.push(await runStep(
    "Restart Hivemind Link",
    "launchctl",
    ["kickstart", "-k", userLaunchAgentTarget("com.hivemindos.linkd.agent")],
    10_000,
  ));
  steps.push(await runStep(
    "Quit Tailscale",
    "osascript",
    ["-e", 'quit app "Tailscale"'],
    8_000,
  ));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  steps.push(await runStep(
    "Open Tailscale",
    "open",
    ["-a", "Tailscale"],
    8_000,
  ));

  const openedTailscale = steps.some((step) => step.label === "Open Tailscale" && step.ok);
  return {
    ok: openedTailscale,
    message: openedTailscale
      ? "Restarted Hivemind Link and relaunched Tailscale. Give peers a few seconds to reconnect, then refresh Fleet."
      : "HivemindOS tried the automatic repair, but macOS did not relaunch Tailscale.",
    steps,
  };
}

export async function POST(request: Request) {
  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Repair action is required." }, { status: 400 });
  }

  if (body.action !== "restart-local-tailnet") {
    return Response.json({ ok: false, error: "Unsupported repair action." }, { status: 400 });
  }
  if (process.platform !== "darwin") {
    return Response.json({ ok: false, error: "This automatic repair is only available on macOS." }, { status: 400 });
  }

  const result = await restartLocalTailnet();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
