export function elevenLabsTranscriptText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}
