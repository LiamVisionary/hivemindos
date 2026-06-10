export const RUNTIME_ICON_PATHS: Record<string, string> = {
  openclaw: "/icons/runtimes/openclaw.svg?v=20260526-runtime-icons-2",
  hermes: "/icons/runtimes/hermes.svg?v=20260526-runtime-icons-2",
  aeon: "/icons/runtimes/aeon.png?v=20260526-runtime-icons-2",
  "hivemind-os": "/icons/runtimes/openai.svg?v=20260526-runtime-icons-2",
  codex: "/icons/runtimes/openai.svg?v=20260526-runtime-icons-2",
};

export const RUNTIME_ICON_RENDER_MODES: Record<string, "image" | "mask"> = {
  openclaw: "image",
  hermes: "mask",
  aeon: "image",
  "hivemind-os": "mask",
  codex: "mask",
};

export const RUNTIME_ICON_FALLBACKS: Record<string, string> = {
  openclaw: "OC",
  hermes: "H",
  aeon: "A",
  "hivemind-os": "HO",
  opencode: "OP",
  codex: "CX",
  "claude-code": "CC",
};

export function runtimeIconPath(runtime?: string) {
  if (!runtime) return "";
  return RUNTIME_ICON_PATHS[runtime] ?? "";
}

export function runtimeIconRenderMode(runtime?: string) {
  if (!runtime) return "image";
  return RUNTIME_ICON_RENDER_MODES[runtime] ?? "image";
}

export function runtimeIconFallback(runtime?: string, label?: string) {
  if (runtime && RUNTIME_ICON_FALLBACKS[runtime]) return RUNTIME_ICON_FALLBACKS[runtime];
  const cleanLabel = label?.trim() || runtime?.trim() || "?";
  return cleanLabel.slice(0, 2).toUpperCase();
}

export function providerIconPath(provider?: { slug?: string; name?: string } | null) {
  const providerText = `${provider?.slug ?? ""} ${provider?.name ?? ""}`;
  if (/\b(openai|codex)\b/i.test(providerText)) return RUNTIME_ICON_PATHS["hivemind-os"];
  return "";
}

export function providerIconRenderMode(provider?: { slug?: string; name?: string } | null) {
  const providerText = `${provider?.slug ?? ""} ${provider?.name ?? ""}`;
  if (/\b(openai|codex)\b/i.test(providerText)) return RUNTIME_ICON_RENDER_MODES["hivemind-os"];
  return "image";
}
