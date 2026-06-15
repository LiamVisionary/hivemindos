// Bigint token-amount helpers for the Telegram tip bot. Amounts are stored
// as raw integer strings (token base units) everywhere; floats never touch
// balances. Kept dependency-free so scripts/test-telegram-tip-bot.mjs can
// import it directly under node --test.

export function parseTokenAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  // k/m shorthand: 5k = 5,000 and 1.5m = 1,500,000 (case-insensitive).
  const suffix = trimmed.match(/[km]$/i)?.[0]?.toLowerCase();
  const body = suffix ? trimmed.slice(0, -1) : trimmed;
  // Commas are accepted only as proper thousands grouping (1,000 or
  // 12,345.67). A bare "1,5" is ambiguous — in many locales it means 1.5 —
  // so reject it rather than silently reading it as 15.
  if (body.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) {
    throw new Error(`"${trimmed}" is ambiguous. Use 1,000 style commas or a plain number like 1000 or 2.5.`);
  }
  const text = body.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`"${trimmed}" is not a valid amount. Use a number like 10, 2.5, 5k, or 1.5m.`);
  }
  // Apply the suffix by shifting the decimal point in string space — exact,
  // no float math near money.
  const shift = suffix === "k" ? 3 : suffix === "m" ? 6 : 0;
  let [whole, fraction = ""] = text.split(".");
  whole += fraction.slice(0, shift).padEnd(shift, "0");
  fraction = fraction.slice(shift);
  if (fraction.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals}).`);
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) throw new Error("Amount must be greater than zero.");
  return raw;
}

export function formatTokenAmount(raw: bigint | string, decimals: number): string {
  let value = typeof raw === "string" ? BigInt(raw) : raw;
  const negative = value < 0n;
  if (negative) value = -value;
  const divisor = 10n ** BigInt(decimals);
  const whole = (value / divisor).toString();
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatCompactTokenAmount(raw: bigint | string, decimals: number): string {
  let value = typeof raw === "string" ? BigInt(raw) : raw;
  const negative = value < 0n;
  if (negative) value = -value;
  const token = 10n ** BigInt(decimals);
  const tiers = [
    { threshold: 1_000_000_000n, suffix: "b" },
    { threshold: 1_000_000n, suffix: "m" },
    { threshold: 1_000n, suffix: "k" },
  ];
  const wholeTokens = value / token;
  const tier = tiers.find((candidate) => wholeTokens >= candidate.threshold);
  if (!tier) return `${negative ? "-" : ""}${formatTokenAmount(value, decimals)}`;

  const divisor = token * tier.threshold;
  const whole = value / divisor;
  const tenth = ((value % divisor) * 10n) / divisor;
  const decimal = tenth > 0n ? `.${tenth}` : "";
  return `${negative ? "-" : ""}${whole}${decimal}${tier.suffix}`;
}
