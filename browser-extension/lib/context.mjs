export const BROWSER_CONTEXT_PROTOCOL = "hivemind.browser.context.v1";

const RESTRICTED_SCHEMES = new Set([
  "about:", "blob:", "chrome:", "chrome-extension:", "data:", "devtools:", "edge:", "file:", "view-source:",
]);
const SENSITIVE_URL_PATTERNS = [
  /bank/i,
  /coinbase|binance|kraken|crypto\.com|wallet/i,
  /1password|bitwarden|lastpass|dashlane|keepersecurity/i,
  /\/password|\/billing|\/checkout|\/payments?/i,
  /\/medical|healthcare|patient|mychart/i,
  /\/tax|irs\.gov|ssa\.gov/i,
];

function decoded(value = "") {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch {
    return String(value);
  }
}

export function isRestrictedUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (RESTRICTED_SCHEMES.has(parsed.protocol)) return true;
    const haystack = [parsed.hostname, parsed.pathname, parsed.search, parsed.hash]
      .flatMap((part) => [part, decoded(part)])
      .join(" ");
    return SENSITIVE_URL_PATTERNS.some((pattern) => pattern.test(haystack));
  } catch {
    return true;
  }
}

export function privacySafeTab(tab = {}) {
  if (isRestrictedUrl(tab.url || tab.pendingUrl || "")) {
    return { title: "(restricted tab)", url: "(omitted by privacy guard)", active: Boolean(tab.active), pinned: Boolean(tab.pinned) };
  }
  return {
    title: tab.title || "(untitled)",
    url: tab.url || tab.pendingUrl || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
  };
}

function metadataText(meta = {}) {
  const parts = [];
  if (meta.description) parts.push(`Description: ${meta.description}`);
  if (meta.language) parts.push(`Language: ${meta.language}`);
  if (Array.isArray(meta.headings) && meta.headings.length) {
    parts.push(`Headings:\n${meta.headings.slice(0, 20).map((item) => `- ${item.level}: ${item.text}`).join("\n")}`);
  }
  if (Array.isArray(meta.interactive) && meta.interactive.length) {
    parts.push(`Visible actions and links:\n${meta.interactive.slice(0, 30).map((item) => `- ${item.kind}: ${item.text || item.href}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

export function buildBrowserContextText({ activeTab, tabs = [], pageContext = {}, mode = "page", maxTabs = 12 } = {}) {
  if (mode === "chat") return "";
  const safeActive = privacySafeTab(activeTab);
  if (safeActive.url === "(omitted by privacy guard)") return "";
  const selectedText = String(pageContext.selectedText || "").trim();
  const pageText = mode === "selection" && selectedText ? selectedText : String(pageContext.text || "").trim();
  const tabList = tabs
    .slice(0, maxTabs)
    .map(privacySafeTab)
    .map((tab, index) => `${index + 1}. ${tab.active ? "[active] " : ""}${tab.pinned ? "[pinned] " : ""}${tab.title}\n   ${tab.url}`)
    .join("\n");
  return [
    `Protocol: ${BROWSER_CONTEXT_PROTOCOL}`,
    `Active page: ${safeActive.title}\nURL: ${safeActive.url}`,
    selectedText ? `Selected text:\n${selectedText}` : "",
    pageText ? `${mode === "selection" ? "Selection" : "Readable page text"}:\n${pageText}` : "",
    metadataText(pageContext.meta),
    tabList ? `Open tabs:\n${tabList}` : "",
  ].filter(Boolean).join("\n\n");
}

export function browserContextReceipt({ activeTab, pageContext = {}, mode = "page", contextText = "" } = {}) {
  const safeActive = privacySafeTab(activeTab);
  return {
    title: safeActive.title,
    mode,
    chars: contextText.length,
    selectionChars: String(pageContext.selectedText || "").length,
    restricted: safeActive.url === "(omitted by privacy guard)",
  };
}
