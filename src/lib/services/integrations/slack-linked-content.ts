import "server-only";

import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, extname, join } from "node:path";

import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

import { loadPublicNotionPage, notionPageIdFromUrl, type PublicNotionAsset } from "./public-notion-page";
import type { LongRunningProcessProgress } from "@/lib/types/long-running-processes";

export type LinkedContentFileType = "image";

export type LinkedPageResource = {
  kind: "page";
  sourceKind: "notion" | "web";
  url: string;
  title: string;
  markdown: string;
  links: string[];
  assets: PublicNotionAsset[];
};

export type LinkedFileResource = {
  kind: "file";
  url: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
};

export type LinkedContentResource = LinkedPageResource | LinkedFileResource;

export type SlackLinkedContentOptions = {
  maxDepth?: number;
  maxPages?: number;
  maxFiles?: number;
  ignoreFileTypes?: LinkedContentFileType[];
  onProgress?: (progress: LongRunningProcessProgress) => void;
};

export type SlackLinkedContentSummary = {
  linksFound: number;
  itemsDiscovered: number;
  itemsProcessed: number;
  pagesDownloaded: number;
  notionPagesDownloaded: number;
  filesDownloaded: number;
  ignoredFiles: number;
  skippedByLimit: number;
  maxGraphDepth: number;
  complete: boolean;
  failed: string[];
};

type LinkedContentDependencies = {
  loadResource: (url: string) => Promise<LinkedContentResource>;
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
};

type QueueItem = {
  url: string;
  graphDepth: number;
  webDepth: number;
  kindHint?: "page" | "file";
  expectedName?: string;
  hintedContentType?: string;
};

const MAX_REDIRECTS = 6;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES = 5_000;
const DEFAULT_MAX_FILES = 5_000;
const MAX_PAGES = 10_000;
const MAX_FILES = 10_000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const DEEP_DOWNLOAD_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function safeName(value: string, fallback: string): string {
  const clean = value
    .replace(/[\u0000-\u001f/\\:]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return clean || fallback;
}

function normalizeHttpUrl(value: string): string | null {
  const slackTarget = value.split("|")[0];
  const trimmed = slackTarget.replace(/[),.;!?\]}]+$/g, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function urlsFromString(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return matches.map(normalizeHttpUrl).filter((url): url is string => Boolean(url));
}

export function extractSlackMessageLinks(messages: unknown[]): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      for (const url of urlsFromString(value)) {
        if (seen.has(url)) continue;
        seen.add(url);
        links.push(url);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) visit(nested);
    }
  };
  visit(messages);
  return links;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized);
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Only public HTTP(S) URLs are supported.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local and private network URLs are not allowed.");
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Local and private network URLs are not allowed.");
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The linked host does not resolve to a public address.");
  }
  return url;
}

async function fetchPublicResource(
  value: string,
): Promise<{ response: Response; url: string }> {
  let current = (await assertPublicUrl(value)).toString();
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,application/pdf,application/octet-stream;q=0.8,*/*;q=0.5",
        "user-agent": DEEP_DOWNLOAD_USER_AGENT,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status < 300 || response.status >= 400) return { response, url: current };
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect ${response.status} did not include a destination.`);
    if (redirectCount === MAX_REDIRECTS) throw new Error("Too many redirects.");
    current = (await assertPublicUrl(new URL(location, current).toString())).toString();
  }
  throw new Error("Too many redirects.");
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Resource exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Resource exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`);
  }
  return bytes;
}

function markdownTargets(markdown: string): { links: string[]; assets: PublicNotionAsset[] } {
  const links: string[] = [];
  const assets: PublicNotionAsset[] = [];
  const seenLinks = new Set<string>();
  const seenAssets = new Set<string>();
  const targetPattern = /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(targetPattern)) {
    const url = normalizeHttpUrl(match[3]);
    if (!url) continue;
    if (match[1] === "!") {
      if (!seenAssets.has(url)) {
        seenAssets.add(url);
        assets.push({ url, name: match[2] || basename(new URL(url).pathname) || "image", contentType: "image" });
      }
    } else if (!seenLinks.has(url)) {
      seenLinks.add(url);
      links.push(url);
    }
  }
  return { links, assets };
}

function contentDispositionName(value: string | null): string | null {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8.replace(/^"|"$/g, ""));
    } catch {
      return utf8;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || null;
}

async function loadPublicLinkedResource(value: string): Promise<LinkedContentResource> {
  const initialUrl = (await assertPublicUrl(value)).toString();
  if (notionPageIdFromUrl(initialUrl)) {
    const page = await loadPublicNotionPage(initialUrl);
    return { kind: "page", sourceKind: "notion", url: initialUrl, ...page };
  }

  const { response, url } = await fetchPublicResource(initialUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (notionPageIdFromUrl(url)) {
    const page = await loadPublicNotionPage(url);
    return { kind: "page", sourceKind: "notion", url, ...page };
  }

  const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    const html = new TextDecoder().decode(await boundedBytes(response, MAX_PAGE_BYTES));
    const { document } = parseHTML(html);
    const parsed = await Defuddle(document, url, { markdown: true, removeImages: false });
    const title = String(parsed.title || new URL(url).hostname).trim();
    const content = String(parsed.content || "").trim();
    const targets = markdownTargets(content);
    return {
      kind: "page",
      sourceKind: "web",
      url,
      title,
      markdown: `# ${title}\n\nSource: ${url}\n\n${content}\n`,
      ...targets,
    };
  }

  const urlName = basename(new URL(url).pathname) || "download";
  return {
    kind: "file",
    url,
    name: contentDispositionName(response.headers.get("content-disposition")) || urlName,
    contentType,
    bytes: await boundedBytes(response, MAX_FILE_BYTES),
  };
}

function isIgnoredImage(contentType: string | undefined, ignoredTypes: ReadonlySet<LinkedContentFileType>): boolean {
  if (!ignoredTypes.has("image")) return false;
  const normalized = contentType?.toLowerCase() || "";
  return normalized === "image" || normalized.startsWith("image/");
}

function uniqueOutputName(value: string, fallback: string, usedNames: Set<string>): string {
  const safe = safeName(value, fallback);
  const extension = extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let candidate = safe;
  let duplicate = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${duplicate}${extension}`;
    duplicate += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

const DEFAULT_DEPENDENCIES: LinkedContentDependencies = {
  loadResource: loadPublicLinkedResource,
  mkdir,
  writeFile,
};

function publishLinkedContentProgress(
  options: SlackLinkedContentOptions,
  progress: LongRunningProcessProgress,
): void {
  try {
    options.onProgress?.(progress);
  } catch {
    // A progress consumer must never be able to abort the bounded crawler.
  }
}

function resourceIdentity(value: string): string {
  const notionPageId = notionPageIdFromUrl(value);
  return notionPageId ? `notion:${notionPageId}` : `url:${normalizeHttpUrl(value) || value}`;
}

export async function downloadSlackLinkedContent(
  messages: unknown[],
  saveDir: string,
  options: SlackLinkedContentOptions = {},
  dependencies: LinkedContentDependencies = DEFAULT_DEPENDENCIES,
): Promise<SlackLinkedContentSummary> {
  const roots = extractSlackMessageLinks(messages);
  const maxDepth = Math.max(0, Math.min(10, options.maxDepth ?? DEFAULT_MAX_DEPTH));
  const maxPages = Math.max(1, Math.min(MAX_PAGES, options.maxPages ?? DEFAULT_MAX_PAGES));
  const maxFiles = Math.max(1, Math.min(MAX_FILES, options.maxFiles ?? DEFAULT_MAX_FILES));
  const ignoredTypes = new Set(options.ignoreFileTypes || []);
  const queue: QueueItem[] = roots.map((url) => ({ url, graphDepth: 0, webDepth: 0 }));
  const queued = new Set(roots);
  const visited = new Set<string>();
  const processedResources = new Set<string>();
  const pageNames = new Set<string>();
  const fileNames = new Set<string>();
  const failed: string[] = [];
  let pagesDownloaded = 0;
  let notionPagesDownloaded = 0;
  let filesDownloaded = 0;
  let ignoredFiles = 0;
  let skippedByLimit = 0;
  let maxGraphDepth = 0;

  const pagesDir = join(saveDir, "linked-pages");
  const filesDir = join(saveDir, "linked-files");

  publishLinkedContentProgress(options, {
    stage: "linked-content",
    label: "Extracting linked pages and files",
    completed: 0,
    total: queue.length,
    detail: roots.length
      ? `Found ${roots.length} link${roots.length === 1 ? "" : "s"} in Slack messages`
      : "No public links found in Slack messages",
  });

  while (queue.length) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    maxGraphDepth = Math.max(maxGraphDepth, item.graphDepth);

    const requestedIdentity = resourceIdentity(item.url);
    if (processedResources.has(requestedIdentity)) {
      publishLinkedContentProgress(options, {
        stage: "linked-content",
        label: "Extracting linked pages and files",
        completed: visited.size,
        total: visited.size + queue.length,
        detail: "Skipped a duplicate linked resource",
      });
      continue;
    }

    let progressDetail = `Opening ${item.url}`;
    publishLinkedContentProgress(options, {
      stage: "linked-content",
      label: "Extracting linked pages and files",
      completed: Math.max(0, visited.size - 1),
      total: visited.size + queue.length,
      detail: progressDetail,
    });

    if (isIgnoredImage(item.hintedContentType, ignoredTypes)) {
      ignoredFiles += 1;
      publishLinkedContentProgress(options, {
        stage: "linked-content",
        label: "Extracting linked pages and files",
        completed: visited.size,
        total: visited.size + queue.length,
        detail: "Skipped an ignored image",
      });
      continue;
    }
    if (item.kindHint === "page" && pagesDownloaded >= maxPages) {
      skippedByLimit += 1;
      publishLinkedContentProgress(options, {
        stage: "linked-content",
        label: "Extracting linked pages and files",
        completed: visited.size,
        total: visited.size + queue.length,
        detail: "Skipped a page at the safety limit",
      });
      continue;
    }
    if (item.kindHint === "file" && filesDownloaded >= maxFiles) {
      skippedByLimit += 1;
      publishLinkedContentProgress(options, {
        stage: "linked-content",
        label: "Extracting linked pages and files",
        completed: visited.size,
        total: visited.size + queue.length,
        detail: "Skipped a file at the safety limit",
      });
      continue;
    }

    try {
      const resource = await dependencies.loadResource(item.url);
      const resolvedIdentity = resourceIdentity(resource.url);
      if (processedResources.has(resolvedIdentity)) {
        processedResources.add(requestedIdentity);
        publishLinkedContentProgress(options, {
          stage: "linked-content",
          label: "Extracting linked pages and files",
          completed: visited.size,
          total: visited.size + queue.length,
          detail: "Skipped a duplicate linked resource",
        });
        continue;
      }
      processedResources.add(requestedIdentity);
      processedResources.add(resolvedIdentity);

      if (resource.kind === "page") {
        if (pagesDownloaded >= maxPages) {
          skippedByLimit += 1;
          continue;
        }
        await dependencies.mkdir(pagesDir, { recursive: true });
        const pageName = uniqueOutputName(`${resource.title}.md`, "linked-page.md", pageNames);
        await dependencies.writeFile(join(pagesDir, pageName), resource.markdown, "utf8");
        pagesDownloaded += 1;
        if (resource.sourceKind === "notion") notionPagesDownloaded += 1;
        progressDetail = `Saved ${pageName}`;

        for (const asset of resource.assets) {
          const normalized = normalizeHttpUrl(asset.url);
          if (!normalized || queued.has(normalized) || visited.has(normalized)) continue;
          queued.add(normalized);
          queue.push({
            url: normalized,
            graphDepth: item.graphDepth + 1,
            webDepth: item.webDepth,
            kindHint: "file",
            expectedName: asset.name,
            hintedContentType: asset.contentType,
          });
        }
        for (const link of resource.links) {
          const normalized = normalizeHttpUrl(link);
          if (!normalized || queued.has(normalized) || visited.has(normalized)) continue;
          const linkedNotionPage = notionPageIdFromUrl(normalized) !== null;
          if (resource.sourceKind === "web" && item.webDepth >= maxDepth && !linkedNotionPage) continue;
          queued.add(normalized);
          queue.push({
            url: normalized,
            graphDepth: item.graphDepth + 1,
            webDepth: resource.sourceKind === "web" && !linkedNotionPage ? item.webDepth + 1 : 0,
            kindHint: "page",
          });
        }
        publishLinkedContentProgress(options, {
          stage: "linked-content",
          label: "Extracting linked pages and files",
          completed: visited.size,
          total: visited.size + queue.length,
          detail: progressDetail,
        });
        continue;
      }

      if (isIgnoredImage(resource.contentType, ignoredTypes)) {
        ignoredFiles += 1;
        publishLinkedContentProgress(options, {
          stage: "linked-content",
          label: "Extracting linked pages and files",
          completed: visited.size,
          total: visited.size + queue.length,
          detail: `Skipped image ${resource.name}`,
        });
        continue;
      }
      if (filesDownloaded >= maxFiles) {
        skippedByLimit += 1;
        publishLinkedContentProgress(options, {
          stage: "linked-content",
          label: "Extracting linked pages and files",
          completed: visited.size,
          total: visited.size + queue.length,
          detail: "Skipped a file at the safety limit",
        });
        continue;
      }
      await dependencies.mkdir(filesDir, { recursive: true });
      let fileName = resource.name || item.expectedName || basename(new URL(resource.url).pathname) || "download";
      if (!extname(fileName) && item.expectedName && extname(item.expectedName)) fileName += extname(item.expectedName);
      fileName = uniqueOutputName(fileName, "download", fileNames);
      await dependencies.writeFile(join(filesDir, fileName), resource.bytes);
      filesDownloaded += 1;
      publishLinkedContentProgress(options, {
        stage: "linked-content",
        label: "Extracting linked pages and files",
        completed: visited.size,
        total: visited.size + queue.length,
        detail: `Downloaded ${fileName}`,
      });
    } catch (error) {
      failed.push(`${item.url}: ${error instanceof Error ? error.message : "download failed"}`);
      publishLinkedContentProgress(options, {
        stage: "linked-content",
        label: "Extracting linked pages and files",
        completed: visited.size,
        total: visited.size + queue.length,
        detail: `Could not extract ${item.url}`,
      });
    }
  }

  return {
    linksFound: roots.length,
    itemsDiscovered: queued.size,
    itemsProcessed: visited.size,
    pagesDownloaded,
    notionPagesDownloaded,
    filesDownloaded,
    ignoredFiles,
    skippedByLimit,
    maxGraphDepth,
    complete: skippedByLimit === 0 && failed.length === 0,
    failed,
  };
}
