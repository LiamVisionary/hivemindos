// Bigint token-amount helpers for the Telegram tip bot. Amounts are stored
// as raw integer strings (token base units) everywhere; floats never touch
// balances. Kept dependency-free so scripts/test-telegram-tip-bot.mjs can
// import it directly under node --test.

export function parseTokenAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  // Commas are accepted only as proper thousands grouping (1,000 or
  // 12,345.67). A bare "1,5" is ambiguous — in many locales it means 1.5 —
  // so reject it rather than silently reading it as 15.
  if (trimmed.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${trimmed}" is ambiguous. Use 1,000 style commas or a plain number like 1000 or 2.5.`);
  }
  const text = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`"${trimmed}" is not a valid amount. Use a plain number like 10 or 2.5.`);
  }
  const [whole, fraction = ""] = text.split(".");
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
