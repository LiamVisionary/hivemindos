const CONTEXT_MESSAGE = "HIVEMIND_GET_PAGE_CONTEXT";
const TEXT_LIMITS = Object.freeze({ minimal: 4_000, normal: 12_000, full: 30_000 });

function normalizeWhitespace(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n\n[truncated ${text.length - limit} chars]`;
}

function redact(value = "") {
  return String(value || "")
    .replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[^\s'"`;&]+/gi, "Bearer [REDACTED_BEARER]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g, "[REDACTED_SECRET]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_SECRET]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SECRET]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|password|passwd|secret|private[_-]?key)\b["'`]?\s*[:=]\s*["'`]?([^\s'"`;&]+)/gi, (_match, key) => `${key}=[REDACTED_SECRET]`);
}

function readableText() {
  const root = document.body || document.documentElement;
  if (!root) return "";
  const clone = root.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, svg, canvas, template, iframe").forEach((node) => node.remove());
  const visible = normalizeWhitespace(root.innerText || "");
  return visible || normalizeWhitespace(clone.textContent || "");
}

function pageMetadata() {
  const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "";
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .slice(0, 24)
    .map((node) => ({ level: node.tagName.toLowerCase(), text: normalizeWhitespace(node.textContent).slice(0, 240) }))
    .filter((item) => item.text);
  const interactive = Array.from(document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [role="link"]'))
    .slice(0, 40)
    .map((node) => ({
      kind: node.getAttribute("role") || node.tagName.toLowerCase(),
      text: normalizeWhitespace(node.innerText || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").slice(0, 180),
      href: node.tagName.toLowerCase() === "a" ? String(node.href || "") : "",
    }))
    .filter((item) => item.text || item.href);
  return { description: redact(description), language: document.documentElement?.lang || "", headings, interactive };
}

function collectContext(options = {}) {
  const depth = Object.hasOwn(TEXT_LIMITS, options.depth) ? options.depth : "normal";
  const limit = TEXT_LIMITS[depth];
  return {
    ok: true,
    title: document.title || "",
    url: location.href,
    selectedText: clamp(redact(globalThis.getSelection?.().toString() || ""), Math.min(limit, 8_000)),
    text: clamp(redact(readableText()), limit),
    meta: pageMetadata(),
    capturedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CONTEXT_MESSAGE) return false;
  try {
    sendResponse(collectContext(message.options || {}));
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  return true;
});
