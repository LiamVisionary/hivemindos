"use client";

import {
  getToolOrDynamicToolName,
  isReasoningUIPart,
  isTextUIPart,
  isToolOrDynamicToolUIPart,
  type UIMessage,
} from "ai";

import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { JsonRenderSurface, extractJsonRenderPayload } from "@/components/json-render/JsonRenderSurface";

function ToolBlock({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolOrDynamicToolUIPart(part)) {
    return null;
  }
  const p = part as {
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  const name = getToolOrDynamicToolName(part);
  const inputJsonRender = extractJsonRenderPayload(p.input);
  const outputJsonRender = extractJsonRenderPayload(p.output);

  return (
    <div className="my-2 rounded-lg border border-zinc-300 bg-zinc-100/80 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800/80">
      <div className="font-medium text-zinc-700 dark:text-zinc-200">
        {name}{" "}
        <span className="font-normal text-zinc-500">
          ({p.state.replace(/-/g, " ")})
        </span>
      </div>
      {p.state === "input-available" || p.state === "input-streaming" ? (
        inputJsonRender ? (
          <JsonRenderSurface value={p.input} />
        ) : (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
            {JSON.stringify(p.input, null, 2)}
          </pre>
        )
      ) : null}
      {p.state === "output-available" && p.output != null ? (
        outputJsonRender ? (
          <JsonRenderSurface value={p.output} />
        ) : (
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
            {typeof p.output === "string"
              ? p.output
              : JSON.stringify(p.output, null, 2)}
          </pre>
        )
      ) : null}
      {p.state === "output-error" && p.errorText ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {p.errorText}
        </p>
      ) : null}
    </div>
  );
}

export function ChatMessageRow({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      <div
        className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
          isUser
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
          {message.role}
        </div>
        <div className="space-y-1">
          {message.parts.map((part, i) => {
            if (isTextUIPart(part)) {
              return (
                <ChatMarkdown key={i} text={part.text} />
              );
            }
            if (isReasoningUIPart(part)) {
              return (
                <details
                  key={i}
                  className="rounded border border-zinc-200 bg-white/50 text-xs dark:border-zinc-600 dark:bg-zinc-900/50"
                >
                  <summary className="cursor-pointer px-2 py-1 font-medium">
                    Reasoning
                  </summary>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-2 pb-2 text-zinc-600 dark:text-zinc-400">
                    {part.text}
                  </pre>
                </details>
              );
            }
            if (part.type === "source-url") {
              return (
                <div key={i} className="text-xs">
                  <a
                    href={part.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {part.title ?? part.url}
                  </a>
                </div>
              );
            }
            if (part.type === "source-document") {
              return (
                <div
                  key={i}
                  className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
                >
                  Source: {part.title}
                </div>
              );
            }
            return <ToolBlock key={i} part={part} />;
          })}
        </div>
      </div>
    </div>
  );
}
