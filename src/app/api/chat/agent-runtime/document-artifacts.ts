import {
  documentCapabilityFor,
  formatDocumentIngestionContext,
  ingestDocumentFile,
  type DocumentIngestionResult,
  type IngestDocumentFileInput,
} from "@/lib/services/document-ingestion";

import type { IncomingMessage } from "./messages";
import type { ChatMediaArtifact } from "./media-artifacts";

const MAX_CHAT_DOCUMENTS = 8;
const MAX_CHAT_DOCUMENT_CHARS = 30_000;
const MAX_CHAT_DOCUMENT_CONTEXT_CHARS = 60_000;

type ChatDocumentFailure = {
  sourceName: string;
  message: string;
};

type ChatDocumentIngestion = {
  converted: DocumentIngestionResult[];
  failures: ChatDocumentFailure[];
  context: string;
};

type ChatDocumentIngestionOptions = {
  ingestFile?: (input: IngestDocumentFileInput) => Promise<DocumentIngestionResult>;
};

function documentArtifacts(artifacts: ChatMediaArtifact[]) {
  return artifacts
    .filter((artifact) => Boolean(documentCapabilityFor(artifact.name) ?? documentCapabilityFor(artifact.path)))
    .slice(0, MAX_CHAT_DOCUMENTS);
}

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Document conversion failed.";
}

export async function ingestChatDocumentArtifacts(
  artifacts: ChatMediaArtifact[],
  options: ChatDocumentIngestionOptions = {},
): Promise<ChatDocumentIngestion> {
  const ingestFile = options.ingestFile ?? ingestDocumentFile;
  const outcomes = await Promise.all(documentArtifacts(artifacts).map(async (artifact) => {
    try {
      return {
        result: await ingestFile({
          filePath: artifact.path,
          sourceName: artifact.name,
          maxOutputChars: MAX_CHAT_DOCUMENT_CHARS,
        }),
      };
    } catch (error) {
      return {
        failure: {
          sourceName: artifact.name,
          message: failureMessage(error),
        },
      };
    }
  }));
  const converted = outcomes.flatMap((outcome) => outcome.result ? [outcome.result] : []);
  const failures = outcomes.flatMap((outcome) => outcome.failure ? [outcome.failure] : []);
  const documentContext = formatDocumentIngestionContext(converted, {
    maxChars: MAX_CHAT_DOCUMENT_CONTEXT_CHARS,
  });
  const failureContext = failures.length
    ? [
        "Document extraction warnings:",
        ...failures.map((failure) => `- ${failure.sourceName}: ${failure.message}`),
      ].join("\n")
    : "";
  return {
    converted,
    failures,
    context: [documentContext, failureContext].filter(Boolean).join("\n\n").slice(0, MAX_CHAT_DOCUMENT_CONTEXT_CHARS),
  };
}

export function messagesWithDocumentIngestionContext(
  messages: IncomingMessage[],
  context: string,
): IncomingMessage[] {
  const normalizedContext = context.trim();
  if (!normalizedContext) return messages;
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return messages;
  return messages.map((message, index) => {
    if (index !== latestUserIndex) return message;
    if (typeof message.content === "string") {
      return { ...message, content: [message.content, normalizedContext].filter(Boolean).join("\n\n") };
    }
    return {
      ...message,
      content: [...message.content, { type: "text", text: normalizedContext }],
    };
  });
}
