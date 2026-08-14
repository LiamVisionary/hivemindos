import { CAPABILITY_APPROVAL_CONTINUATION_MARKER } from "@/lib/types/capability-approval";

export type ApprovedRuntimeCapability = {
  id: string;
  intent: string;
  locator?: string;
  executionReceiptRequired: boolean;
};

const EXECUTION_RECEIPT_INTENTS = new Set([
  "audio-generation",
  "deployment",
  "image-generation",
  "media-download",
  "payments",
  "transcription",
  "video-generation",
]);

function cleanCapabilityField(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * Extract the runtime contract from HivemindOS's own approved-plan prompt.
 * The collector receives this structured form so it never has to infer a
 * selected capability from prose or provider names.
 */
export function approvedRuntimeCapabilities(message: string): ApprovedRuntimeCapability[] {
  if (!message.includes(CAPABILITY_APPROVAL_CONTINUATION_MARKER)) return [];

  const capabilities: ApprovedRuntimeCapability[] = [];
  let intent = "capability";
  let current: ApprovedRuntimeCapability | null = null;

  for (const line of message.split(/\r?\n/)) {
    const intentMatch = line.match(/^\s*Capability intent:\s*(.+?)\s*$/i);
    if (intentMatch) {
      intent = cleanCapabilityField(intentMatch[1], 100) || "capability";
      continue;
    }
    const idMatch = line.match(/^\s*Capability id:\s*(.+?)\s*$/i);
    if (idMatch) {
      const id = cleanCapabilityField(idMatch[1], 240);
      if (!id) {
        current = null;
        continue;
      }
      current = {
        id,
        intent,
        executionReceiptRequired: false,
      };
      capabilities.push(current);
      continue;
    }
    const locatorMatch = line.match(/^\s*Capability locator:\s*(.+?)\s*$/i);
    if (locatorMatch && current) {
      current.locator = cleanCapabilityField(locatorMatch[1], 1_000) || undefined;
      continue;
    }
    const receiptMatch = line.match(/^\s*Capability execution receipt:\s*(required|not-required)\s*$/i);
    if (receiptMatch && current) {
      current.executionReceiptRequired = receiptMatch[1].toLowerCase() === "required"
        && EXECUTION_RECEIPT_INTENTS.has(current.intent);
    }
  }

  return [...new Map(capabilities.map((capability) => [capability.id, capability])).values()];
}

export function capabilityExecutionReceiptRequired(intent: string) {
  return EXECUTION_RECEIPT_INTENTS.has(intent);
}
