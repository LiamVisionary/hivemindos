import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const FUND_CONFIRMATION = "FUND_BANKR_LLM_CREDITS";
const HIVE_TOKEN_ADDRESS = process.env.HIVE_TOKEN_ADDRESS?.trim()
  || process.env.NEXT_PUBLIC_HIVE_TOKEN_ADDRESS?.trim()
  || "0xa382c83e2a3b79368f372c2eb9b6925ffaf45ba3";

type FundingOption = {
  token: string;
  label: string;
  detail: string;
  balanceLabel?: string;
  balanceUsd?: number;
};

function parseCreditBalance(raw: string) {
  const match = raw.match(/Credit Balance:\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function collectPortfolioTokens(value: unknown, options = new Map<string, FundingOption>()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPortfolioTokens(item, options));
    return options;
  }
  const record = asRecord(value);
  if (!Object.keys(record).length) return options;
  const symbol = firstString(record, ["symbol", "tokenSymbol", "ticker"]);
  const address = firstString(record, ["address", "tokenAddress", "contractAddress", "mint"]);
  const chain = firstString(record, ["chain", "network", "chainName"]);
  const balance = firstNumber(record, ["balance", "amount", "quantity", "tokenBalance"]);
  const balanceUsd = firstNumber(record, ["balanceUsd", "usdValue", "valueUsd", "value", "totalUsd"]);
  const token = address || symbol;
  if (token && (symbol || address) && (balance !== undefined || balanceUsd !== undefined)) {
    const key = `${token}:${chain}`.toLowerCase();
    const label = symbol || "Contract token";
    const balancePart = balance !== undefined ? `${balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol || "tokens"}` : "";
    const usdPart = balanceUsd !== undefined ? `$${balanceUsd.toFixed(2)}` : "";
    options.set(key, {
      token,
      label,
      detail: [chain, address].filter(Boolean).join(" · ") || "Bankr wallet",
      balanceLabel: [balancePart, usdPart].filter(Boolean).join(" · "),
      balanceUsd,
    });
  }
  Object.values(record).forEach((item) => collectPortfolioTokens(item, options));
  return options;
}

function fallbackFundingOptions(): FundingOption[] {
  return [
    { token: "USDC", label: "USDC", detail: "Stablecoin balance across Bankr-supported chains" },
    { token: "USDT", label: "USDT", detail: "Stablecoin balance across Bankr-supported chains" },
    { token: "ETH", label: "ETH", detail: "ETH balance across Bankr-supported chains" },
    { token: HIVE_TOKEN_ADDRESS, label: "HIVE", detail: `Base token ${HIVE_TOKEN_ADDRESS}` },
  ];
}

async function readCredits() {
  const { stdout, stderr } = await execFileAsync("bankr", ["llm", "credits"], { timeout: 20_000, maxBuffer: 500_000 });
  const output = `${stdout}${stderr ? `\n${stderr}` : ""}`;
  return {
    balanceUsd: parseCreditBalance(output),
    raw: output,
  };
}

async function readFundingOptions() {
  const { stdout } = await execFileAsync("bankr", ["wallet", "portfolio", "--json", "--low-value"], {
    timeout: 25_000,
    maxBuffer: 4_000_000,
  }).catch(() => ({ stdout: "" }));
  let parsed: unknown = null;
  try {
    parsed = stdout.trim() ? JSON.parse(stdout) as unknown : null;
  } catch {
    parsed = null;
  }
  const options = parsed ? [...collectPortfolioTokens(parsed).values()] : [];
  const byToken = new Map(fallbackFundingOptions().map((option) => [option.token.toLowerCase(), option]));
  for (const option of options) byToken.set(option.token.toLowerCase(), option);
  return [...byToken.values()].sort((left, right) => (right.balanceUsd ?? -1) - (left.balanceUsd ?? -1));
}

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const [credits, fundingOptions] = await Promise.all([readCredits(), readFundingOptions()]);
    return Response.json({
      ok: true,
      balanceUsd: credits.balanceUsd,
      balanceLabel: credits.balanceUsd === null ? "Unknown" : `$${credits.balanceUsd.toFixed(2)}`,
      fundingOptions,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Bankr LLM credits.",
      fundingOptions: fallbackFundingOptions(),
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { amountUsd?: unknown; token?: unknown; confirmation?: unknown };
  const amountUsd = Number(body.amountUsd);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
  if (confirmation !== FUND_CONFIRMATION) return Response.json({ ok: false, error: `Type ${FUND_CONFIRMATION} to confirm funding.` }, { status: 400 });
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1000) return Response.json({ ok: false, error: "Enter a top-up amount from $1 to $1000." }, { status: 400 });
  if (!token || !/^[A-Za-z0-9._:-]{2,128}$/.test(token)) return Response.json({ ok: false, error: "Choose a token symbol or contract address." }, { status: 400 });
  try {
    const amount = amountUsd.toFixed(2).replace(/\.00$/, "");
    const { stdout, stderr } = await execFileAsync("bankr", ["llm", "credits", "add", amount, "--token", token, "--yes"], {
      timeout: 180_000,
      maxBuffer: 2_000_000,
    });
    const credits = await readCredits().catch(() => ({ balanceUsd: null }));
    return Response.json({
      ok: true,
      balanceUsd: credits.balanceUsd,
      balanceLabel: credits.balanceUsd === null ? "Unknown" : `$${credits.balanceUsd.toFixed(2)}`,
      message: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim().slice(0, 2000) || "Bankr LLM credits funded.",
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not fund Bankr LLM credits.",
    }, { status: 500 });
  }
}
