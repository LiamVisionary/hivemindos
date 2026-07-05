import { memo, useState, type MouseEvent, type ReactNode } from "react";

import chatStyles from "@/app/chat.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";

const chatClass = createStyleClass(chatStyles);
const indentBlockStyle = {
  display: "grid",
  width: "fit-content",
  maxWidth: "min(760px, calc(100% - 1rem))",
  gap: "8px",
  margin: "4px 0 4px 0.65rem",
  borderLeft: "2px solid rgba(94, 234, 212, 0.42)",
  borderRadius: "0 6px 6px 0",
  background: "rgba(20, 184, 166, 0.08)",
  padding: "9px 12px 9px 14px",
  color: "rgba(232, 238, 247, 0.9)",
} as const;
const bulletListStyle = {
  display: "grid",
  gap: "9px",
  margin: "4px 0",
} as const;
const nestedBulletListStyle = {
  ...bulletListStyle,
  margin: "-2px 0 4px 2.45rem",
} as const;
const bulletItemStyle = {
  display: "grid",
  gridTemplateColumns: "0.55rem minmax(0, 1fr)",
  gap: "0.72rem",
  alignItems: "start",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "12px",
  background: "rgba(255, 255, 255, 0.026)",
  padding: "0.62rem 0.72rem",
} as const;
const orderedItemStyle = {
  display: "grid",
  gridTemplateColumns: "1.8rem minmax(0, 1fr)",
  gap: "0.65rem",
  alignItems: "start",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "12px",
  background: "rgba(255, 255, 255, 0.026)",
  padding: "0.62rem 0.72rem",
} as const;
const bulletDotStyle = {
  width: "0.38rem",
  height: "0.38rem",
  borderRadius: "999px",
  background: "rgba(103, 232, 249, 0.96)",
  boxShadow: "0 0 12px rgba(103, 232, 249, 0.9)",
  transform: "translateY(0.52rem)",
} as const;
const orderedIndexStyle = {
  color: "rgba(94, 234, 212, 0.9)",
  fontSize: "0.82em",
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
} as const;
const fieldLabelStyle = {
  color: "rgba(232, 238, 247, 0.98)",
  fontWeight: 800,
  marginRight: "0.22rem",
  whiteSpace: "nowrap",
} as const;
const fieldPattern = /(^|\s)(Suggested comment|Suggested DM|Post context|Related post|Best action|Comment under Wake or related thread|Name|Followers|Bio|Why|Post|Comment|DM|Account|Action|Profile|Handle|Engagement|URL|Link):/g;
const jsonStartPattern = /^\s*[{[]/;
const jsonPropertyPattern = /"[^"\n]+"\s*:/g;
// A line/segment that begins with a markdown link — `[text](url)` — also starts
// with `[`, but it is NOT JSON. Without this guard the JSON heuristics below
// pretty-print it and shatter the link across lines (e.g. a basescan tx receipt
// rendered as `[\n receipt\n](https:\n//…)`).
const markdownLinkLeadPattern = /^\s*\[[^\]]+\]\s*\(/;

function safeMarkdownHref(href: string) {
  const trimmed = href.trim();
  if (/^https?:/i.test(trimmed)) return trimmed.replace(/\s+/g, "");
  if (/^(mailto:|#)/i.test(trimmed)) return trimmed;
  return "#";
}

function handleMarkdownLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.stopPropagation();
  if (!isExternalHttpUrl(href)) return;
  event.preventDefault();
  void openExternalUrl(href, "chrome");
}

function splitTrailingUrlPunctuation(value: string) {
  const match = /^(.*?)([),.;:!?]+)?$/.exec(value);
  return {
    href: match?.[1] ?? value,
    trailing: match?.[2] ?? "",
  };
}

function copyCodeText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function formatJsonBlock(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return "";
  }
}

function prettyPrintJsonish(value: string) {
  const trimmed = trimJsonCandidate(value);
  if (!trimmed) return "";
  let output = "";
  let indent = 0;
  let inString = false;
  let escaped = false;
  const unit = "  ";
  const newline = () => `\n${unit.repeat(Math.max(indent, 0))}`;
  const trimInlineEnd = (current: string) => {
    const lastNewline = Math.max(current.lastIndexOf("\n"), current.lastIndexOf("\r"));
    if (lastNewline >= 0 && /^[ \t]*$/.test(current.slice(lastNewline + 1))) return current;
    return current.replace(/[ \t]+$/, "");
  };

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }
    if (char === "{" || char === "[") {
      output = output.endsWith(": ") ? output : trimInlineEnd(output);
      output += char;
      indent += 1;
      const next = trimmed.slice(index + 1).trimStart()[0];
      if (next && next !== "}" && next !== "]") output += newline();
      continue;
    }
    if (char === "}" || char === "]") {
      indent -= 1;
      output = output.trimEnd();
      output += newline() + char;
      continue;
    }
    if (char === ",") {
      output = trimInlineEnd(output);
      output += `,${newline()}`;
      continue;
    }
    if (char === ":") {
      output = output.trimEnd();
      output += ": ";
      continue;
    }
    if (/\s/.test(char)) {
      if (output && !output.endsWith(" ") && !output.endsWith("\n")) output += " ";
      continue;
    }
    output += char;
  }

  return output.trim();
}

function trimJsonCandidate(value: string) {
  return value.trim().replace(/^[,:\s]+/, "").replace(/;\s*$/, "");
}

function extractBalancedJsonCandidate(value: string) {
  const start = value.search(/[{\[]/);
  if (start < 0) return "";
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  return "";
}

function formatJsonCandidate(value: string) {
  const trimmed = trimJsonCandidate(value);
  if (!trimmed) return "";
  // Never treat a markdown link as a JSON candidate (the `[` start is a false
  // positive); this is what keeps inline links — like tx receipts — intact.
  if (markdownLinkLeadPattern.test(trimmed)) return "";
  const formatted = formatJsonBlock(trimmed);
  if (formatted) return formatted;
  const balanced = extractBalancedJsonCandidate(trimmed);
  if (balanced) {
    const balancedFormatted = formatJsonBlock(balanced);
    if (balancedFormatted) return balancedFormatted;
  }
  if (/^"[^"]+"\s*:/.test(trimmed)) {
    const wrapped = `{${trimmed}}`;
    return formatJsonBlock(wrapped) || prettyPrintJsonish(wrapped);
  }
  if (jsonStartPattern.test(trimmed)) return prettyPrintJsonish(trimmed);
  return "";
}

function extractEmbeddedJson(text: string) {
  const searchStart = Math.max(0, Math.min(
    ...["{", "["]
      .map((token) => {
        const found = text.indexOf(token);
        return found === -1 ? Number.POSITIVE_INFINITY : found;
      }),
  ));
  const candidates = Number.isFinite(searchStart) ? [searchStart] : [];
  for (const match of text.matchAll(jsonPropertyPattern)) {
    candidates.push(match.index ?? 0);
  }
  for (const start of [...new Set(candidates)].sort((a, b) => a - b)) {
    const formatted = formatJsonCandidate(text.slice(start));
    if (!formatted) continue;
    return {
      prefix: text.slice(0, start).trim(),
      formatted,
    };
  }
  return null;
}

function likelyJsonLine(line: string) {
  const trimmed = line.trim();
  return Boolean(trimmed)
    && (
      jsonStartPattern.test(trimmed)
      || /^[}\]],?$/.test(trimmed)
      || /^"[^"]+"\s*:/.test(trimmed)
      || /^"[^"]+"\s*,?$/.test(trimmed)
      || /^(true|false|null|-?\d+(?:\.\d+)?),?$/.test(trimmed)
    );
}

function collectJsonBlock(lines: string[], startIndex: number) {
  const body: string[] = [];
  let index = startIndex;
  while (index < lines.length && (likelyJsonLine(lines[index]) || !lines[index].trim())) {
    body.push(lines[index]);
    index += 1;
  }

  const raw = body.join("\n").trim().replace(/;\s*$/, "");
  const formatted = formatJsonBlock(raw);
  if (formatted) return { formatted, nextIndex: index };
  const jsonish = prettyPrintJsonish(raw);
  if (!jsonish) return null;
  return { formatted: jsonish, nextIndex: index };
}

function collectLooseJsonBlock(lines: string[], startIndex: number) {
  const body: string[] = [];
  let index = startIndex;
  while (index < lines.length && (likelyJsonLine(lines[index]) || !lines[index].trim())) {
    body.push(lines[index]);
    index += 1;
  }
  return {
    raw: body.join("\n").trim(),
    nextIndex: Math.max(index, startIndex + 1),
  };
}

function renderDataBlock(value: string, key: string) {
  const formatted = formatJsonCandidate(value) || value;
  return (
    <pre className={chatClass("jsonBlock")} key={key}>
      <code>{formatted}</code>
    </pre>
  );
}

function renderParagraphBlock(text: string, key: string, inlineOptions: { codeCopied?: string; onCopyCode?: (value: string) => void } = {}) {
  const embeddedJson = extractEmbeddedJson(text);
  if (!embeddedJson) return <p key={key}>{renderFieldLine(text, inlineOptions)}</p>;
  return (
    <div className={chatClass("markdownMixedDataBlock")} key={key}>
      {embeddedJson.prefix ? <p>{renderFieldLine(embeddedJson.prefix, inlineOptions)}</p> : null}
      {renderDataBlock(embeddedJson.formatted, `${key}-json`)}
    </div>
  );
}

function splitLeadingDraftBlock(value: string) {
  const trimmed = value.trim();
  const match = /^draft:\s*\n?/i.exec(trimmed);
  if (!match) return null;
  const body = trimmed.slice(match[0].length).trimStart();
  const separator = body.search(/\n\s*\n/);
  if (separator < 0) return { draft: body.trim(), rest: "" };
  return {
    draft: body.slice(0, separator).trim(),
    rest: body.slice(separator).trim(),
  };
}

function renderDraftBlock(text: string, key: string, inlineOptions: { codeCopied?: string; onCopyCode?: (value: string) => void } = {}) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <section className={chatClass("draftMarkdown")} key={key}>
      <strong className={chatClass("draftMarkdownLabel")}>Draft</strong>
      <div className={chatClass("draftMarkdownBody")}>
        {lines.map((line, index) => <p key={`${key}-${index}`}>{renderFieldLine(line, inlineOptions)}</p>)}
      </div>
    </section>
  );
}

function pushTextWithBreaks(parts: ReactNode[], text: string, keyPrefix: string) {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) parts.push(<br key={`${keyPrefix}-br-${index}`} />);
    if (line) parts.push(line);
  });
}


function renderInlineMarkdown(text: string, options: { links?: "anchor" | "text"; codeCopied?: string; onCopyCode?: (value: string) => void } = {}): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\s*\([^)]+\)|(?:https?:\/\/|mailto:)[^\s<]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > cursor) pushTextWithBreaks(parts, text.slice(cursor, index), `${index}-text`);
    if (value.startsWith("`")) {
      const codeValue = value.slice(1, -1);
      parts.push(
        <code
          data-copied={options.codeCopied === codeValue ? "true" : undefined}
          key={`${index}-code`}
          onClick={(event) => {
            event.stopPropagation();
            options.onCopyCode?.(codeValue);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            options.onCopyCode?.(codeValue);
          }}
          role="button"
          tabIndex={0}
          title="Copy code"
        >
          {codeValue}
        </code>,
      );
    } else if (value.startsWith("**")) {
      parts.push(<strong key={`${index}-strong`}>{value.slice(2, -2)}</strong>);
    } else if (value.startsWith("*")) {
      parts.push(<em key={`${index}-em`}>{value.slice(1, -1)}</em>);
    } else if (value.startsWith("[")) {
      const link = /^\[\s*([^\]]*?)\s*\]\s*\(([^)]+)\)$/.exec(value);
      const href = link ? safeMarkdownHref(link[2]) : "#";
      parts.push(link ? options.links === "text" ? link[1] : (
        <a
          href={href}
          key={`${index}-link`}
          onClick={(event) => handleMarkdownLinkClick(event, href)}
          rel={isExternalHttpUrl(href) ? "noopener noreferrer" : undefined}
          target={isExternalHttpUrl(href) ? "_blank" : undefined}
        >
          {link[1]}
        </a>
      ) : value);
    } else {
      const { href, trailing } = splitTrailingUrlPunctuation(value);
      const safeHref = safeMarkdownHref(href);
      parts.push(options.links === "text" ? href : (
        <a
          href={safeHref}
          key={`${index}-link`}
          onClick={(event) => handleMarkdownLinkClick(event, safeHref)}
          rel={isExternalHttpUrl(safeHref) ? "noopener noreferrer" : undefined}
          target={isExternalHttpUrl(safeHref) ? "_blank" : undefined}
        >
          {href}
        </a>
      ));
      if (trailing) parts.push(trailing);
    }
    cursor = index + value.length;
  }
  if (cursor < text.length) pushTextWithBreaks(parts, text.slice(cursor), `${cursor}-text`);
  return parts;
}

function renderFieldLine(text: string, options: { codeCopied?: string; onCopyCode?: (value: string) => void } = {}) {
  const matches = [...text.matchAll(fieldPattern)];
  if (!matches.length) return renderInlineMarkdown(text, options);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    const prefix = match[1] ?? "";
    const label = match[2] ?? "";
    const labelIndex = index + prefix.length;
    if (labelIndex > cursor) parts.push(...renderInlineMarkdown(text.slice(cursor, labelIndex), options));
    parts.push(
      <strong
        key={`field-${labelIndex}`}
        style={{ ...fieldLabelStyle, marginLeft: parts.length && !prefix.includes("\n") ? "0.45rem" : 0 }}
      >
        {label}:
      </strong>,
    );
    cursor = index + match[0].length;
    if (text[cursor] === " ") cursor += 1;
  }
  if (cursor < text.length) parts.push(...renderInlineMarkdown(text.slice(cursor), options));
  return parts;
}

export function ChatInlineMarkdown({ text }: { text: string }) {
  return <>{renderInlineMarkdown(text.replace(/\s+/g, " "), { links: "text" })}</>;
}

function ChatMarkdownBase({ text, className, headingClassName }: { text: string; className?: string; headingClassName?: string }) {
  const [copiedCode, setCopiedCode] = useState("");
  if (!text.trim()) return null;
  const leadingDraft = splitLeadingDraftBlock(text);
  const displayText = leadingDraft?.rest || text;
  function handleCopyCode(value: string) {
    copyCodeText(value);
    setCopiedCode(value);
    window.setTimeout(() => setCopiedCode((current) => current === value ? "" : current), 1200);
  }
  const inlineOptions = { codeCopied: copiedCode, onCopyCode: handleCopyCode };
  const lines = displayText.trim().split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let previousBlockKind = "";
  if (leadingDraft?.draft) {
    blocks.push(renderDraftBlock(leadingDraft.draft, "draft-leading", inlineOptions));
  }

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      const fenceLanguage = line.trim().slice(3).trim().toLowerCase();
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const codeText = code.join("\n");
      const shouldFormatDataFence = /json|jsonc|data/.test(fenceLanguage)
        || jsonStartPattern.test(codeText)
        || jsonPropertyPattern.test(codeText);
      const formattedDataFence = shouldFormatDataFence ? formatJsonCandidate(codeText) : "";
      blocks.push(formattedDataFence
        ? renderDataBlock(formattedDataFence, `code-json-${index}`)
        : <pre key={`code-${index}`}><code>{codeText}</code></pre>);
      previousBlockKind = formattedDataFence ? "json" : "code";
      continue;
    }
    if (jsonStartPattern.test(line) && !markdownLinkLeadPattern.test(line)) {
      const jsonBlock = collectJsonBlock(lines, index);
      if (jsonBlock) {
        blocks.push(renderDataBlock(jsonBlock.formatted, `json-${index}`));
        index = jsonBlock.nextIndex;
        previousBlockKind = "json";
        continue;
      }
      const looseJsonBlock = collectLooseJsonBlock(lines, index);
      blocks.push(renderDataBlock(looseJsonBlock.raw, `json-raw-${index}`));
      index = looseJsonBlock.nextIndex;
      previousBlockKind = "json";
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<strong className={headingClassName ?? chatClass("markdownHeading")} key={`heading-${index}`}>{renderInlineMarkdown(heading[2], inlineOptions)}</strong>);
      index += 1;
      previousBlockKind = "heading";
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      const nested = previousBlockKind === "ordered" || previousBlockKind === "lettered";
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <div className={chatClass("markdownBulletList")} key={`list-${index}`} role="list" style={nested ? nestedBulletListStyle : bulletListStyle}>
          {items.map((item, itemIndex) => (
            <div className={chatClass("markdownBulletItem")} key={`${index}-${itemIndex}`} role="listitem" style={bulletItemStyle}>
              <span aria-hidden="true" className={chatClass("markdownBulletDot")} style={bulletDotStyle} />
              <span>{renderFieldLine(item, inlineOptions)}</span>
            </div>
          ))}
        </div>,
      );
      previousBlockKind = "bullet";
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: Array<{ marker: string; text: string }> = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        const ordered = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[index]);
        if (ordered) items.push({ marker: `${ordered[1]}.`, text: ordered[2] });
        index += 1;
      }
      blocks.push(
        <div className={chatClass("markdownBulletList")} key={`ordered-${index}`} role="list" style={bulletListStyle}>
          {items.map((item, itemIndex) => (
            <div className={chatClass("markdownBulletItem")} key={`${index}-${itemIndex}`} role="listitem" style={orderedItemStyle}>
              <span aria-hidden="true" style={orderedIndexStyle}>{item.marker}</span>
              <span>{renderFieldLine(item.text, inlineOptions)}</span>
            </div>
          ))}
        </div>,
      );
      previousBlockKind = "ordered";
      continue;
    }
    if (/^\s*[A-Z][.)]\s+/.test(line)) {
      const items: Array<{ marker: string; text: string }> = [];
      while (index < lines.length && /^\s*[A-Z][.)]\s+/.test(lines[index])) {
        const lettered = /^\s*([A-Z])[.)]\s+(.+)$/.exec(lines[index]);
        if (lettered) items.push({ marker: `${lettered[1]}.`, text: lettered[2] });
        index += 1;
      }
      blocks.push(
        <div className={chatClass("markdownBulletList")} key={`lettered-${index}`} role="list" style={bulletListStyle}>
          {items.map((item, itemIndex) => (
            <div className={chatClass("markdownBulletItem")} key={`${index}-${itemIndex}`} role="listitem" style={orderedItemStyle}>
              <span aria-hidden="true" style={orderedIndexStyle}>{item.marker}</span>
              <span>{renderFieldLine(item.text, inlineOptions)}</span>
            </div>
          ))}
        </div>,
      );
      previousBlockKind = "lettered";
      continue;
    }
    if (/^\s{2,}\S/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s{2,}\S/.test(lines[index])) {
        body.push(lines[index].replace(/^\s+/, ""));
        index += 1;
      }
      blocks.push(
        <div className={chatClass("markdownIndentBlock")} key={`indent-${index}`} style={indentBlockStyle}>
          {body.map((item, itemIndex) => <p key={`${index}-${itemIndex}`}>{renderFieldLine(item, inlineOptions)}</p>)}
        </div>,
      );
      previousBlockKind = "indent";
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].trim().startsWith("```")
      && !/^(#{1,3})\s+/.test(lines[index])
      && !/^\s*[-*]\s+/.test(lines[index])
      && !/^\s*\d+[.)]\s+/.test(lines[index])
      && !/^\s*[A-Z][.)]\s+/.test(lines[index])
      && !/^\s{2,}\S/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(renderParagraphBlock(paragraph.join("\n"), `paragraph-${index}`, inlineOptions));
    previousBlockKind = "paragraph";
  }

  return (
    <div className={className ?? chatClass("messageMarkdown")}>
      {blocks}
      {copiedCode ? <span className={chatClass("codeCopiedToast")} aria-live="polite">Copied</span> : null}
    </div>
  );
}

// Memoized so non-streaming bubbles skip re-parsing markdown when an ancestor
// re-renders (e.g. on each streamed token or composer keystroke). text/className
// props are primitive strings, so the default shallow compare is sufficient.
export const ChatMarkdown = memo(ChatMarkdownBase);
