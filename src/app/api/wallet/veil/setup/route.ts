import { NextRequest, NextResponse } from "next/server";
import { spawnHiveEnvAdd } from "@/lib/services/hive-env-command";
import { VEIL_CASH_MCP_MIN_VERSION, VEIL_CASH_MCP_PACKAGE, VEIL_CASH_SDK_PACKAGE } from "@/lib/config/veil-cash";
import { installVeilCli, installVeilMcp, parseVeilCliJson, readVeilMcpVersion, redactSecrets, resolveVeilCliPath, resolveVeilMcpPath, runVeilCli, veilEnvValue, veilMcpMeetsMinimumVersion } from "@/lib/services/wallet/veil-cli";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VeilKeypairJson = {
  veilKey?: string;
  veilPrivateKey?: string;
  depositKey?: string;
  derivation?: string;
};

type SetupBody = {
  action?: "generate" | "setup";
  force?: boolean;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ ok: true, status: await readVeilSetupStatus() });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as SetupBody;
    if (body.action !== "generate" && body.action !== "setup") return sendError("Unsupported Veil setup action.");
    if (body.action === "setup") return await setupVeilOperator(body.force);
    if (await veilEnvValue("VEIL_KEY") && !body.force) {
      return sendError("A Veil key is already configured. Remove it from shared env or retry with force.", 409);
    }

    const keypair = await generateVeilKeypair();
    await saveGeneratedKeypair(keypair);

    return NextResponse.json({
      ok: true,
      status: await readVeilSetupStatus(),
      message: "Generated and saved Veil operator keypair.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: setupErrorMessage(error),
      status: await readVeilSetupStatus(),
    }, { status: 400 });
  }
}

async function setupVeilOperator(force?: boolean) {
  const hadCli = Boolean(await resolveVeilCliPath());
  const hadMcp = Boolean(await resolveVeilMcpPath());
  await ensureVeilCliInstalled();

  const hasVeilKey = Boolean(await veilEnvValue("VEIL_KEY"));
  const hasDepositKey = Boolean(await veilEnvValue("DEPOSIT_KEY"));
  if (hasVeilKey && hasDepositKey && !force) {
    return NextResponse.json({
      ok: true,
      status: await readVeilSetupStatus(),
      message: "Veil CLI, Veil MCP, and operator keys are already configured.",
    });
  }
  if ((hasVeilKey || hasDepositKey) && !(hasVeilKey && hasDepositKey) && !force) {
    return sendError("Veil setup is partially configured. Add the missing key through hive-env-add or retry setup with force after confirming replacement.", 409);
  }

  const keypair = await generateVeilKeypair();
  await saveGeneratedKeypair(keypair);

  return NextResponse.json({
    ok: true,
    status: await readVeilSetupStatus(),
    message: hadCli && hadMcp
      ? "Generated a Veil operator keypair and saved it with hive-env-add."
      : "Installed Veil CLI/MCP, generated an operator keypair, and saved it with hive-env-add.",
  });
}

async function readVeilSetupStatus() {
  const cliPath = await resolveVeilCliPath();
  const mcpPath = await resolveVeilMcpPath();
  const mcpVersion = await readVeilMcpVersion();
  const mcpMeetsMinimum = await veilMcpMeetsMinimumVersion();
  const veilKey = await veilEnvValue("VEIL_KEY");
  const depositKey = await veilEnvValue("DEPOSIT_KEY");
  return {
    cliInstalled: Boolean(cliPath),
    cliPath,
    mcpInstalled: Boolean(mcpPath),
    mcpPath,
    mcpVersion,
    mcpMinimumVersion: VEIL_CASH_MCP_MIN_VERSION,
    mcpMeetsMinimum,
    veilKeyConfigured: Boolean(veilKey),
    depositKeyConfigured: Boolean(depositKey),
    mode: "workspace-operator",
  };
}

async function generateVeilKeypair(): Promise<VeilKeypairJson> {
  const { stdout } = await runVeilCli(["init", "--generate", "--json", "--no-save"], {
    timeout: 30_000,
    maxBuffer: 256_000,
  });
  const parsed = parseVeilCliJson(stdout) as VeilKeypairJson;
  return parsed;
}

async function ensureVeilCliInstalled() {
  await installVeilCli();
  await installVeilMcp();
}

async function saveGeneratedKeypair(keypair: VeilKeypairJson) {
  const veilKey = keypair.veilKey || keypair.veilPrivateKey || "";
  const depositKey = keypair.depositKey || "";
  if (!/^0x[a-fA-F0-9]{64}$/.test(veilKey)) throw new Error("Veil CLI returned an invalid VEIL_KEY.");
  if (!/^0x[a-fA-F0-9]{128}$/.test(depositKey)) throw new Error("Veil CLI returned an invalid DEPOSIT_KEY.");

  await saveVeilEnv({ VEIL_KEY: veilKey, DEPOSIT_KEY: depositKey });
  process.env.VEIL_KEY = veilKey;
  process.env.DEPOSIT_KEY = depositKey;
}

function saveVeilEnv(entries: Record<"VEIL_KEY" | "DEPOSIT_KEY", string>) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnHiveEnvAdd([
      "--import-stdin",
      "--scope",
      "agent",
      "--runtime",
      "generic",
    ], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving Veil keys."));
    }, 90_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || "hive-env-add could not save Veil keys."));
    });
    child.stdin.end(Object.entries(entries).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n");
  });
}

function setupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Veil setup failed.";
  if (message === "VEIL_CLI_MISSING" || /ENOENT/.test(message)) return "Veil CLI is not installed. Run Setup Veil to install @veil-cash/sdk and generate the operator key.";
  if (/EACCES|permission denied/i.test(message)) return `Could not install Veil packages globally because npm does not have permission. Install them manually with \`npm install -g ${VEIL_CASH_SDK_PACKAGE} ${VEIL_CASH_MCP_PACKAGE}\`, then run Setup Veil again.`;
  return redactSecrets(message);
}

function sendError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
