import "server-only";

import { openAiOAuthResponsesRequest } from "@/lib/services/openai-oauth";

const CHAT_MODEL = "gpt-5.4";
const IMAGE_MODEL = "gpt-image-2";
const IMAGE_INSTRUCTIONS =
  "Fulfill the image request with the image_generation tool. Return the generated image without additional prose.";

export type OpenAiOAuthMediaRequest = {
  action?: "image-generate";
  prompt?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
};

function boundedString(value: unknown, label: string, maximum: number, required = false) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} is too long.`);
  return normalized;
}

function imageSize(aspectRatio: string) {
  const sizes: Record<string, string> = {
    "9:16": "1024x1536",
    "4:5": "1024x1536",
    "1:1": "1024x1024",
    "16:9": "1536x1024",
  };
  const size = sizes[aspectRatio];
  if (!size) throw new Error("Unsupported OpenAI image aspect ratio.");
  return size;
}

function imageFromOutput(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  return item.type === "image_generation_call" && typeof item.result === "string"
    ? item.result
    : "";
}

export async function openAiOAuthMediaRequest(body: OpenAiOAuthMediaRequest) {
  if (body.action !== "image-generate") throw new Error("Unsupported OpenAI OAuth media action.");
  const prompt = boundedString(body.prompt, "Prompt", 20_000, true);
  const model = boundedString(body.model, "Model", 120) || IMAGE_MODEL;
  const aspectRatio = boundedString(body.aspectRatio, "Aspect ratio", 20) || "1:1";
  const quality = boundedString(body.quality, "Quality", 20) || "medium";
  if (model !== IMAGE_MODEL) throw new Error("OpenAI OAuth image generation currently supports gpt-image-2.");
  if (!new Set(["low", "medium", "high"]).has(quality)) {
    throw new Error("OpenAI OAuth image quality must be low, medium, or high.");
  }

  const response = await openAiOAuthResponsesRequest(
    {
      model: CHAT_MODEL,
      store: false,
      stream: true,
      instructions: IMAGE_INSTRUCTIONS,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      tools: [
        {
          type: "image_generation",
          model,
          size: imageSize(aspectRatio),
          quality,
          output_format: "png",
          background: "opaque",
          partial_images: 1,
        },
      ],
      tool_choice: {
        type: "allowed_tools",
        mode: "required",
        tools: [{ type: "image_generation" }],
      },
    },
    { timeoutMs: 180_000, errorContext: "OpenAI OAuth image generation" },
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageBase64 = "";
  let failure = "";
  const consume = (raw: string) => {
    if (!raw || raw === "[DONE]") return;
    try {
      const event = JSON.parse(raw) as Record<string, unknown>;
      if (event.type === "response.output_item.done") {
        imageBase64 = imageFromOutput(event.item) || imageBase64;
      } else if (
        event.type === "response.image_generation_call.partial_image" &&
        typeof event.partial_image_b64 === "string"
      ) {
        imageBase64 = event.partial_image_b64;
      } else if (event.type === "response.completed") {
        const completed = event.response as Record<string, unknown> | undefined;
        const output = Array.isArray(completed?.output) ? completed.output : [];
        for (const item of output) imageBase64 = imageFromOutput(item) || imageBase64;
      } else if (event.type === "response.failed") {
        const failed = event.response as Record<string, unknown> | undefined;
        const error = failed?.error as Record<string, unknown> | undefined;
        failure = typeof error?.message === "string" ? error.message : "OpenAI image generation failed.";
      }
    } catch {
      /* keep-alives and unknown frames are skipped */
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consume(
          frame
            .split(/\n/)
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n"),
        );
      }
    }
    if (done) break;
  }
  if (!imageBase64) throw new Error(failure || "OpenAI OAuth response contained no generated image.");
  return {
    data: [{ b64_json: imageBase64 }],
    model,
    aspect_ratio: aspectRatio,
    quality,
  };
}
