export const AEON_OFFICIAL_REPOSITORY = "https://github.com/aaronjmars/aeon.git";

export const AEON_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-fable-5",
  "claude-haiku-4-5-20251001",
  "grok-composer-2.5-fast",
  "grok-build",
] as const;

export const AEON_HARNESSES = ["claude", "grok"] as const;

export const AEON_GATEWAYS = [
  "auto",
  "direct",
  "bankr",
  "openrouter",
  "usepod",
  "venice",
  "surplus",
  "grok",
] as const;

export const AEON_CURRENT_OUTPUT_DIRECTORIES = [
  "output/.chains",
  "output/articles",
  "output/images",
  "output/.attest",
  "apps/dashboard/outputs",
] as const;

export const AEON_LEGACY_OUTPUT_DIRECTORIES = [
  ".outputs",
  "outputs",
  "dashboard/outputs",
] as const;

export const AEON_OUTPUT_DIRECTORIES = [
  ...AEON_CURRENT_OUTPUT_DIRECTORIES,
  ...AEON_LEGACY_OUTPUT_DIRECTORIES,
] as const;

export const AEON_CAPABILITY_MATRIX = {
  cli: { current: true, legacy: false },
  packs: { current: true, legacy: false },
  mcp: { current: true, legacy: "partial" },
  strategy: { current: true, legacy: false },
  soul: { current: true, legacy: false },
  gateway: { current: true, legacy: false },
  harness: { current: true, legacy: false },
  chains: { current: true, legacy: false },
  reactive: { current: true, legacy: false },
  provenance: { current: true, legacy: false },
  a2a: { current: false, legacy: true },
} as const;

export function countTopLevelYamlItems(raw: string, key: string) {
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === `${key}:`);
  if (headerIndex < 0) return 0;
  let count = 0;
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) break;
    if (/^  [A-Za-z0-9_-]+:\s*/.test(line)) count += 1;
    if (/^  -\s+/.test(line)) count += 1;
  }
  return count;
}
