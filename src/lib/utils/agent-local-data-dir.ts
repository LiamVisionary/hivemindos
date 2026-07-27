// Demo/capture fixtures (remotion capture-real-ux.mjs) seed agent profiles
// with localDataDir "/capture/<id>" alongside the *.capture.invalid telemetry
// hosts handled by agent-telemetry-url.ts. The filesystem root is unwritable,
// so a leaked placeholder that reaches a runtime as its home dir (e.g.
// HERMES_HOME) kills every chat turn inside mkdir. Treat it as unset.
export function isPlaceholderLocalDataDir(value?: string) {
  const trimmed = value?.trim() ?? "";
  return trimmed === "/capture" || trimmed.startsWith("/capture/");
}

export function normalizeAgentLocalDataDir(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || isPlaceholderLocalDataDir(trimmed)) return undefined;
  return trimmed;
}
