import { bankrLlmAccessStatus, bankrLlmCreditTopUp, execBankrCommand } from "@/lib/services/bankr-llm";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

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
  const { stdout, stderr } = await execBankrCommand(["llm", "credits"], { timeout: 20_000, maxBuffer: 500_000 });
  const output = `${stdout}${stderr ? `\n${stderr}` : ""}`;
  return {
    balanceUsd: parseCreditBalance(output),
    raw: output,
  };
}

async function readFundingOptions() {
  const result = await execBankrCommand(["wallet", "portfolio", "--json", "--low-value"], {
    timeout: 25_000,
    maxBuffer: 4_000_000,
  }).then(({ stdout }) => ({ stdout, error: "" })).catch((error) => ({
    stdout: "",
    error: error instanceof Error ? error.message : "Could not read Bankr wallet portfolio.",
  }));
  let parsed: unknown = null;
  try {
    parsed = result.stdout.trim() ? JSON.parse(result.stdout) as unknown : null;
  } catch {
    parsed = null;
  }
  const options = parsed ? [...collectPortfolioTokens(parsed).values()] : [];
  const byToken = new Map(fallbackFundingOptions().map((option) => [option.token.toLowerCase(), option]));
  for (const option of options) byToken.set(option.token.toLowerCase(), option);
  return {
    options: [...byToken.values()].sort((left, right) => (right.balanceUsd ?? -1) - (left.balanceUsd ?? -1)),
    error: result.error,
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const balanceOnly = new URL(request.url).searchParams.get("mode") === "balance";
  try {
    if (balanceOnly) {
      const [credits, access] = await Promise.all([readCredits(), bankrLlmAccessStatus()]);
      return Response.json({
        ok: true,
        balanceUsd: credits.balanceUsd,
        balanceLabel: credits.balanceUsd === null ? "Unknown" : `$${credits.balanceUsd.toFixed(2)}`,
        clubActive: access.clubActive,
        accessError: access.error,
      });
    }
    const [credits, funding, access] = await Promise.all([readCredits(), readFundingOptions(), bankrLlmAccessStatus()]);
    return Response.json({
      ok: true,
      balanceUsd: credits.balanceUsd,
      balanceLabel: credits.balanceUsd === null ? "Unknown" : `$${credits.balanceUsd.toFixed(2)}`,
      clubActive: access.clubActive,
      accessError: access.error,
      fundingError: funding.error,
      fundingOptions: funding.options,
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
    const funding = await readFundingOptions();
    if (/IP address not allowed/i.test(funding.error)) {
      return Response.json({
        ok: false,
        error: `${funding.error} Bankr credit funding requires the shared Bankr key's IP allowlist to permit this machine. Update the key's allowlist in Bankr, or remove the allowlist for local development.`,
      }, { status: 403 });
    }
    const topUp = await bankrLlmCreditTopUp(amountUsd, token);
    const credits = await readCredits().catch(() => ({ balanceUsd: null }));
    const balanceUsd = topUp.newBalance ?? credits.balanceUsd;
    const message = [
      topUp.creditsGranted !== null ? `Added $${topUp.creditsGranted.toFixed(2)} credits.` : "Bankr LLM credits funded.",
      topUp.newBalance !== null ? `New balance: $${topUp.newBalance.toFixed(2)}.` : "",
      topUp.txHash ? `Transaction: ${topUp.txHash}` : "",
    ].filter(Boolean).join(" ");
    return Response.json({
      ok: true,
      balanceUsd,
      balanceLabel: balanceUsd === null ? "Unknown" : `$${balanceUsd.toFixed(2)}`,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fund Bankr LLM credits.";
    return Response.json({
      ok: false,
      error: /LLM Gateway not enabled/i.test(message)
        ? `${message} HivemindOS used the shared Bankr key for both API and LLM Gateway access when no separate BANKR_API_KEY was configured. Bankr is still rejecting that key for LLM Gateway credit funding.`
        : message,
    }, { status: 500 });
  }
}
