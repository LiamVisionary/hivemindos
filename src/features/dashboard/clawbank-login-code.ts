export function normalizeClawBankLoginCode(value: string): string {
  return value.trim().replace(/\s+/g, "");
}
