import { isValidElement, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ChatArtifactOpenControl } from "@/features/dashboard/ChatArtifactOpenControl";
import {
  chatArtifactDisplayName,
  chatArtifactTargetKind,
  parseChatCompletionPresentation,
  type ChatCompletionArtifact,
  type ChatCompletionPresentation,
} from "@/features/dashboard/chat-completion-presentation";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";
import type { DeliverableSourceMachine } from "@/lib/services/deliverable-open-client";

type ChatRouteMarkdownProps = {
  className?: string;
  sourceMachine?: DeliverableSourceMachine;
  text: string;
};

function safeMarkdownHref(value: string) {
  const href = value.trim();
  if (/^https?:/i.test(href)) return href.replace(/\s+/g, "");
  if (/^(mailto:|#)/i.test(href)) return href;
  return "#";
}

function handleExternalLink(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.stopPropagation();
  if (!isExternalHttpUrl(href)) return;
  event.preventDefault();
  void openExternalUrl(href, "chrome");
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeText(node.props.children);
  return "";
}

function CopyButton({ copied, label, onCopy }: { copied: boolean; label: string; onCopy: () => void }) {
  return (
    <button
      type="button"
      className="fr-chat-markdown-copy"
      aria-label={copied ? `${label} copied` : label}
      onClick={onCopy}
    >
      {copied ? (
        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4.5 10.5 3.2 3.2 7.8-8" /></svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="6.5" y="6.5" width="9" height="9" rx="2" /><path d="M4 13.5H3.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V4" /></svg>
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ArtifactRow({ artifact, onCopy, sourceMachine }: {
  artifact: ChatCompletionArtifact;
  onCopy: (value: string) => void;
  sourceMachine?: DeliverableSourceMachine;
}) {
  const filename = chatArtifactDisplayName(artifact.target);
  return (
    <article className="fr-chat-artifact-row">
      <span className="fr-chat-artifact-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20"><path d="M5.5 2.5h5l4 4v11h-9z" /><path d="M10.5 2.5v4h4M7.8 10h4.4M7.8 13h4.4" /></svg>
      </span>
      <div className="fr-chat-artifact-copy">
        <span className="fr-chat-artifact-label">{artifact.label}</span>
        <strong>{filename}</strong>
        <details className="fr-chat-path-disclosure">
          <summary>Show full {artifact.kind === "url" ? "link" : "path"}</summary>
          <code>{artifact.target}</code>
        </details>
      </div>
      <div className="fr-chat-artifact-actions">
        <ChatArtifactOpenControl
          kind={artifact.kind}
          label={filename}
          onCopy={onCopy}
          sourceMachine={sourceMachine}
          target={artifact.target}
        />
      </div>
    </article>
  );
}

function StandalonePath({ target, copiedValue, onCopy }: {
  target: string;
  copiedValue: string;
  onCopy: (value: string) => void;
}) {
  const kind = chatArtifactTargetKind(target);
  if (!kind) return <p>{target}</p>;
  return (
    <div className="fr-chat-standalone-path">
      <code>{target}</code>
      <CopyButton copied={copiedValue === target} label={`Copy ${kind === "url" ? "link" : "path"}`} onCopy={() => onCopy(target)} />
    </div>
  );
}

function CompletionSectionHeading({ count, children }: { count?: number; children: ReactNode }) {
  return (
    <div className="fr-chat-completion-section-heading">
      <h3>{children}</h3>
      {typeof count === "number" ? <span>{count}</span> : null}
    </div>
  );
}

function CompletionPresentation({ completion, copiedValue, onCopy, renderMarkdown, sourceMachine }: {
  completion: ChatCompletionPresentation;
  copiedValue: string;
  onCopy: (value: string) => void;
  renderMarkdown: (value: string) => ReactNode;
  sourceMachine?: DeliverableSourceMachine;
}) {
  return (
    <section className="fr-chat-completion" data-testid="chat-task-completion">
      <header className="fr-chat-completion-header">
        <span className="fr-chat-completion-check" aria-hidden="true">
          <svg viewBox="0 0 20 20"><path d="m4.5 10.5 3.2 3.2 7.8-8" /></svg>
        </span>
        <div>
          <span>Task completed</span>
          <strong>Work Board task <code>{completion.taskId}</code></strong>
        </div>
      </header>

      {completion.artifacts.length ? (
        <section className="fr-chat-completion-section" aria-labelledby={`artifacts-${completion.taskId}`}>
          <CompletionSectionHeading count={completion.artifacts.length}>
            <span id={`artifacts-${completion.taskId}`}>Deliverables</span>
          </CompletionSectionHeading>
          <div className="fr-chat-artifact-list">
            {completion.artifacts.map((artifact, index) => (
              <ArtifactRow
                artifact={artifact}
                key={`${artifact.target}-${index}`}
                onCopy={onCopy}
                sourceMachine={sourceMachine}
              />
            ))}
          </div>
        </section>
      ) : null}

      {completion.remainingMarkdown ? (
        <div className="fr-chat-completion-prose">{renderMarkdown(completion.remainingMarkdown)}</div>
      ) : null}

      {completion.evidence.length ? (
        <section className="fr-chat-completion-section" aria-labelledby={`evidence-${completion.taskId}`}>
          <CompletionSectionHeading count={completion.evidence.length}>
            <span id={`evidence-${completion.taskId}`}>Evidence</span>
          </CompletionSectionHeading>
          <ul className="fr-chat-evidence-list">
            {completion.evidence.map((item, index) => (
              <li key={`${item}-${index}`}>
                <span aria-hidden="true">
                  <svg viewBox="0 0 20 20"><path d="m4.5 10.5 3.2 3.2 7.8-8" /></svg>
                </span>
                <div>{renderMarkdown(item)}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {completion.verification || completion.receipts.length ? (
        <section className="fr-chat-completion-section" aria-labelledby={`verification-${completion.taskId}`}>
          <CompletionSectionHeading>
            <span id={`verification-${completion.taskId}`}>Verification</span>
          </CompletionSectionHeading>
          <div className="fr-chat-verification-list">
            {completion.verification ? (
              <details className="fr-chat-verification-row">
                <summary>
                  <span className="fr-chat-verification-status is-passed" aria-hidden="true" />
                  <strong>{completion.verification.summary}</strong>
                  <span>Show test output</span>
                </summary>
                <div className="fr-chat-verification-detail">
                  {completion.verification.command ? <code>{completion.verification.command}</code> : null}
                  {completion.verification.output ? <pre>{completion.verification.output}</pre> : null}
                </div>
              </details>
            ) : null}
            {completion.receipts.map((receipt, index) => (
              <details className="fr-chat-verification-row" key={`${receipt.summary}-${index}`}>
                <summary>
                  <span className={`fr-chat-verification-status is-${receipt.status}`} aria-hidden="true" />
                  <strong>{receipt.label}</strong>
                  <span>Show receipt</span>
                </summary>
                <div className="fr-chat-receipt-detail">
                  <p>{receipt.summary}</p>
                  {receipt.evidence.length ? (
                    <ul className="fr-chat-receipt-evidence">
                      {receipt.evidence.map((item, evidenceIndex) => <li key={`${item}-${evidenceIndex}`}>{item}</li>)}
                    </ul>
                  ) : <p className="fr-chat-verification-empty">No receipt evidence was attached.</p>}
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <details className="fr-chat-raw-report">
        <summary>Show raw report</summary>
        <div>
          <CopyButton copied={copiedValue === completion.rawText} label="Copy raw report" onCopy={() => onCopy(completion.rawText)} />
          <pre>{completion.rawText}</pre>
        </div>
      </details>
    </section>
  );
}

export function ChatRouteMarkdown({ className, sourceMachine, text }: ChatRouteMarkdownProps) {
  const [copiedValue, setCopiedValue] = useState("");
  const completion = useMemo(() => parseChatCompletionPresentation(text), [text]);

  function copyValue(value: string) {
    void navigator.clipboard?.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue((current) => current === value ? "" : current), 1400);
  }

  const markdownComponents: Components = {
    a({ children, href }) {
      const safeHref = safeMarkdownHref(href ?? "");
      return (
        <a
          href={safeHref}
          onClick={(event) => handleExternalLink(event, safeHref)}
          rel={isExternalHttpUrl(safeHref) ? "noopener noreferrer" : undefined}
          target={isExternalHttpUrl(safeHref) ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    code({ children, className: codeClassName }) {
      const value = reactNodeText(children).replace(/\n$/, "");
      if (codeClassName || value.includes("\n")) return <code className={codeClassName}>{value}</code>;
      return (
        <code
          className="fr-chat-inline-code"
          data-copied={copiedValue === value ? "true" : undefined}
          onClick={() => copyValue(value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            copyValue(value);
          }}
          role="button"
          tabIndex={0}
          title="Copy code"
        >
          {value}
        </code>
      );
    },
    p({ children }) {
      const value = reactNodeText(children).trim();
      return chatArtifactTargetKind(value)
        ? <StandalonePath target={value} copiedValue={copiedValue} onCopy={copyValue} />
        : <p>{children}</p>;
    },
    pre({ children }) {
      const value = reactNodeText(children).replace(/\n$/, "");
      const child = isValidElement<{ className?: string }>(children) ? children : null;
      const language = child?.props.className?.replace(/^language-/, "") || "Code";
      return (
        <div className="fr-chat-code-block">
          <div className="fr-chat-code-toolbar">
            <span>{language}</span>
            <CopyButton copied={copiedValue === value} label="Copy code block" onCopy={() => copyValue(value)} />
          </div>
          <pre>{children}</pre>
        </div>
      );
    },
    table({ children }) {
      return <div className="fr-chat-table-scroll"><table>{children}</table></div>;
    },
  };

  const renderMarkdown = (value: string) => (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={(url) => safeMarkdownHref(url)}
    >
      {value}
    </ReactMarkdown>
  );

  return (
    <div className={`${className ?? "fr-chat-markdown"} fr-chat-rich-markdown`}>
      {completion ? (
        <CompletionPresentation
          completion={completion}
          copiedValue={copiedValue}
          onCopy={copyValue}
          renderMarkdown={renderMarkdown}
          sourceMachine={sourceMachine}
        />
      ) : renderMarkdown(text)}
    </div>
  );
}
