import { videoGenerationRequest } from "@/lib/services/chat/task-retrieval-context";
import { signedGeneratedMediaUrl } from "@/lib/services/chat/generated-media-signing";
import {
  generationPromptWithoutAttachmentReferences,
  resolveVideoGenerationFollowUp,
} from "@/lib/services/chat/video-generation-follow-up";
import type { ChatMediaArtifact } from "./media-artifacts";
import { videoInputImagesForArgs } from "./media-tool-routing";

type SessionMessage = NonNullable<Parameters<typeof resolveVideoGenerationFollowUp>[1]>[number];
type SignMediaUrl = (path: string) => Promise<string>;

export type PreparedNativeVideoGenerationRequest = {
  prompt: string;
  inputImages: Array<Pick<ChatMediaArtifact, "path" | "dataUrl" | "mimeType" | "name">>;
  sourceArtifacts: Array<{
    kind: "image";
    url: string;
    label?: string;
    mimeType?: string;
  }>;
  followUp: boolean;
};

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "source-image";
}

async function sourceArtifactsForInputImages(
  inputImages: PreparedNativeVideoGenerationRequest["inputImages"],
  signMediaUrl: SignMediaUrl,
) {
  return Promise.all(inputImages.flatMap((image) => image.path?.trim() ? [image] : []).map(async (image) => ({
    kind: "image" as const,
    url: await signMediaUrl(image.path),
    label: image.name?.trim() || basename(image.path),
    mimeType: image.mimeType?.trim() || undefined,
  })));
}

export async function prepareNativeVideoGenerationRequest(input: {
  userPrompt: string;
  mediaArtifacts?: ChatMediaArtifact[];
  sessionMessages?: SessionMessage[];
  signMediaUrl?: SignMediaUrl;
}): Promise<PreparedNativeVideoGenerationRequest | null> {
  const cleanPrompt = generationPromptWithoutAttachmentReferences(input.userPrompt);
  const currentInputImages = videoInputImagesForArgs({}, input.mediaArtifacts ?? []);
  const followUp = currentInputImages.length
    ? null
    : resolveVideoGenerationFollowUp(input.userPrompt, input.sessionMessages ?? []);
  if (!videoGenerationRequest(cleanPrompt || input.userPrompt) && !followUp) return null;
  const inputImages = followUp?.inputImages ?? currentInputImages;
  return {
    prompt: followUp?.prompt ?? (cleanPrompt || input.userPrompt.trim()),
    inputImages,
    sourceArtifacts: await sourceArtifactsForInputImages(
      inputImages,
      input.signMediaUrl ?? signedGeneratedMediaUrl,
    ),
    followUp: Boolean(followUp),
  };
}
