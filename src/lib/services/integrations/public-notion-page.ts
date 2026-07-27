import "server-only";

import { NotionAPI } from "notion-client";

type NotionRichText = Array<[string, Array<[string, unknown?]>?]>;

type NotionBlock = {
  id?: string;
  type?: string;
  content?: string[];
  properties?: Record<string, NotionRichText | undefined>;
  format?: Record<string, unknown>;
};

type NotionRecordMap = {
  block?: Record<string, unknown>;
  collection_query?: Record<string, Record<string, unknown>>;
};

export type PublicNotionAsset = {
  url: string;
  name: string;
  contentType?: "image";
};

export type PublicNotionPage = {
  title: string;
  markdown: string;
  links: string[];
  assets: PublicNotionAsset[];
};

type LoadPublicNotionPageOptions = {
  loadPage?: (pageId: string, options: { concurrency: number }) => Promise<unknown>;
  wait?: (milliseconds: number) => Promise<void>;
};

const NOTION_HOST_SUFFIXES = ["notion.site", "notion.so", "notion.com"];
const NOTION_PAGE_ID_RE = /([0-9a-f]{32})(?:$|[/?#])/i;

function isNotionHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return NOTION_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function dashedPageId(compactId: string): string {
  return compactId.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  ).toLowerCase();
}

export function notionPageIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!isNotionHost(url.hostname)) return null;
    const match = `${url.pathname}${url.search}${url.hash}`.match(NOTION_PAGE_ID_RE);
    return match ? dashedPageId(match[1]) : null;
  } catch {
    return null;
  }
}

function blockValue(entry: unknown): NotionBlock | null {
  let current = entry;
  while (current && typeof current === "object" && "value" in current) {
    current = (current as { value?: unknown }).value;
  }
  return current && typeof current === "object" ? current as NotionBlock : null;
}

function collectCollectionPageIds(value: unknown, pageIds: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectCollectionPageIds(entry, pageIds);
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "blockIds" && Array.isArray(entry)) {
      for (const id of entry) {
        if (typeof id === "string") uniquePush(pageIds, id);
      }
      continue;
    }
    collectCollectionPageIds(entry, pageIds);
  }
}

function markdownText(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function annotationValue(
  annotations: Array<[string, unknown?]> | undefined,
  annotation: string,
): unknown {
  return annotations?.find(([kind]) => kind === annotation)?.[1];
}

function richTextMarkdown(value: NotionRichText | undefined): string {
  if (!Array.isArray(value)) return "";
  return value.map(([plainText, annotations]) => {
    let text = markdownText(String(plainText || ""));
    if (!text) return "";
    if (annotationValue(annotations, "c") !== undefined || annotations?.some(([kind]) => kind === "c")) {
      text = `\`${String(plainText || "").replace(/`/g, "\\`")}\``;
    }
    if (annotations?.some(([kind]) => kind === "b")) text = `**${text}**`;
    if (annotations?.some(([kind]) => kind === "i")) text = `*${text}*`;
    if (annotations?.some(([kind]) => kind === "s")) text = `~~${text}~~`;
    const link = annotationValue(annotations, "a");
    if (typeof link === "string" && /^https?:\/\//i.test(link)) {
      text = `[${text}](${link})`;
    }
    return text;
  }).join("");
}

function richTextPlain(value: NotionRichText | undefined): string {
  if (!Array.isArray(value)) return "";
  return value.map(([plainText]) => String(plainText || "")).join("").trim();
}

function richTextLinks(value: NotionRichText | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const links: string[] = [];
  for (const [, annotations] of value) {
    const link = annotationValue(annotations, "a");
    if (typeof link === "string" && /^https?:\/\//i.test(link)) links.push(link);
  }
  return links;
}

function propertySource(block: NotionBlock): string | null {
  const source = richTextPlain(block.properties?.source);
  if (/^https?:\/\//i.test(source)) return source;
  for (const key of ["display_source", "source"] as const) {
    const value = block.format?.[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

function sourcePageUrl(sourceUrl: string, blockId: string): string {
  const url = new URL(sourceUrl);
  const compactId = blockId.replace(/-/g, "");
  return `${url.origin}/${compactId}`;
}

function uniquePush(values: string[], candidate: string): void {
  if (!values.includes(candidate)) values.push(candidate);
}

function compactPageId(value: string): string {
  return value.replace(/-/g, "").toLowerCase();
}

export function notionRecordMapToMarkdown(
  recordMap: NotionRecordMap,
  pageId: string,
  sourceUrl: string,
): PublicNotionPage {
  const entries = recordMap.block || {};
  const blocks = new Map<string, NotionBlock>();
  const blockKeysByCompactId = new Map<string, string>();
  for (const [id, entry] of Object.entries(entries)) {
    const block = blockValue(entry);
    if (block) {
      blocks.set(id, block);
      blockKeysByCompactId.set(compactPageId(id), id);
    }
  }

  const root = blocks.get(pageId) || blocks.get(pageId.replace(/-/g, ""));
  if (!root) throw new Error("Notion page data did not contain the requested root page.");

  const title = richTextPlain(root.properties?.title) || "Untitled Notion page";
  const lines = [`# ${markdownText(title)}`, "", `Source: ${sourceUrl}`, ""];
  const links: string[] = [];
  const assets: PublicNotionAsset[] = [];
  const visited = new Set<string>();

  const blockKey = (id: string): string | null => {
    if (blocks.has(id)) return id;
    return blockKeysByCompactId.get(compactPageId(id)) || null;
  };

  const renderBlock = (id: string, depth: number): void => {
    const resolvedId = blockKey(id);
    if (!resolvedId || visited.has(resolvedId)) return;
    visited.add(resolvedId);
    const block = blocks.get(resolvedId);
    if (!block) return;

    const richTitle = block.properties?.title;
    const plainTitle = richTextPlain(richTitle);
    const formattedTitle = richTextMarkdown(richTitle);
    for (const link of richTextLinks(richTitle)) uniquePush(links, link);

    switch (block.type) {
      case "header":
      case "sub_header":
        if (formattedTitle) lines.push(`${"#".repeat(Math.min(6, depth + 2))} ${formattedTitle}`, "");
        break;
      case "sub_sub_header":
        if (formattedTitle) lines.push(`${"#".repeat(Math.min(6, depth + 3))} ${formattedTitle}`, "");
        break;
      case "bulleted_list":
        if (formattedTitle) lines.push(`${"  ".repeat(Math.max(0, depth - 1))}- ${formattedTitle}`);
        break;
      case "numbered_list":
        if (formattedTitle) lines.push(`${"  ".repeat(Math.max(0, depth - 1))}1. ${formattedTitle}`);
        break;
      case "to_do": {
        const checked = block.properties?.checked?.[0]?.[0] === "Yes";
        if (formattedTitle) lines.push(`- [${checked ? "x" : " "}] ${formattedTitle}`);
        break;
      }
      case "quote":
      case "callout":
        if (formattedTitle) lines.push(...formattedTitle.split("\n").map((line) => `> ${line}`), "");
        break;
      case "code": {
        const language = richTextPlain(block.properties?.language).toLowerCase();
        if (plainTitle) lines.push(`\`\`\`${language}`, plainTitle, "\`\`\`", "");
        break;
      }
      case "divider":
        lines.push("---", "");
        break;
      case "page":
      case "collection_view_page": {
        const childUrl = sourcePageUrl(sourceUrl, block.id || resolvedId);
        if (plainTitle) lines.push(`- [${markdownText(plainTitle)}](${childUrl})`);
        uniquePush(links, childUrl);
        break;
      }
      case "file":
      case "pdf":
      case "image":
      case "video":
      case "audio": {
        const url = propertySource(block);
        if (url) {
          const name = plainTitle || `${block.type || "file"}-${block.id || id}`;
          assets.push({
            url,
            name,
            ...(block.type === "image" ? { contentType: "image" as const } : {}),
          });
          lines.push(
            block.type === "image"
              ? `![${markdownText(name)}](${url})`
              : `[${markdownText(name)}](${url})`,
            "",
          );
        }
        break;
      }
      case "bookmark":
      case "embed": {
        const url = richTextPlain(block.properties?.link) || propertySource(block);
        if (url && /^https?:\/\//i.test(url)) {
          uniquePush(links, url);
          lines.push(`[${markdownText(plainTitle || url)}](${url})`, "");
        }
        break;
      }
      default:
        if (formattedTitle) lines.push(formattedTitle, "");
    }

    for (const childId of block.content || []) renderBlock(childId, depth + 1);
  };

  for (const childId of root.content || []) renderBlock(childId, 0);

  const rootCompactId = compactPageId(pageId);
  const additionalPageIds: string[] = [];
  collectCollectionPageIds(recordMap.collection_query, additionalPageIds);
  for (const [id, block] of blocks) {
    if (block.type === "page" || block.type === "collection_view_page") {
      uniquePush(additionalPageIds, block.id || id);
    }
  }
  const unvisitedPageIds = additionalPageIds.filter((id) => {
    if (compactPageId(id) === rootCompactId) return false;
    const resolvedId = blockKey(id);
    return resolvedId !== null && !visited.has(resolvedId);
  });
  if (unvisitedPageIds.length > 0) {
    lines.push("## Database and child pages", "");
    for (const childId of unvisitedPageIds) renderBlock(childId, 0);
  }

  return {
    title,
    markdown: `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`,
    links,
    assets,
  };
}

let notionApi: NotionAPI | undefined;

function publicNotionApi(): NotionAPI {
  notionApi ??= new NotionAPI({ userTimeZone: "UTC" });
  return notionApi;
}

function notionErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  for (const key of ["status", "statusCode"]) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

function isRetryableNotionError(error: unknown): boolean {
  const status = notionErrorStatus(error);
  if (status === 429 || (status !== null && status >= 500 && status <= 599)) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /\b429\b|too many requests|rate.?limit|econnreset|etimedout|fetch failed|network error/i.test(message);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function loadPublicNotionPage(
  url: string,
  options: LoadPublicNotionPageOptions = {},
): Promise<PublicNotionPage> {
  const pageId = notionPageIdFromUrl(url);
  if (!pageId) throw new Error("The URL is not a supported public Notion page.");
  const loadPage = options.loadPage
    ?? ((requestedPageId: string, requestOptions: { concurrency: number }) => (
      publicNotionApi().getPage(requestedPageId, requestOptions)
    ));
  const waitForRetry = options.wait ?? wait;
  const retryDelays = [1_500, 3_000, 6_000, 12_000, 24_000];

  for (let attempt = 0; ; attempt += 1) {
    try {
      const recordMap = await loadPage(pageId, { concurrency: 1 });
      return notionRecordMapToMarkdown(recordMap as NotionRecordMap, pageId, url);
    } catch (error) {
      const retryDelay = retryDelays[attempt];
      if (retryDelay === undefined || !isRetryableNotionError(error)) throw error;
      await waitForRetry(retryDelay);
    }
  }
}
