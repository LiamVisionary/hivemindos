#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileForVm(relativePath, exposeExpression) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/^import[^;]*;/gm, "")
    .replace(/\bexport\s+/g, "")
    + `\n;globalThis.__testedModule = ${exposeExpression};`;
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const notionContext = vm.createContext({ URL });
vm.runInContext(
  compileForVm(
    "../src/lib/services/integrations/public-notion-page.ts",
    "{ notionPageIdFromUrl, notionRecordMapToMarkdown, loadPublicNotionPage }",
  ),
  notionContext,
  { filename: "public-notion-page.ts" },
);

const { notionPageIdFromUrl, notionRecordMapToMarkdown } = notionContext.__testedModule;
assert.equal(
  notionPageIdFromUrl("https://example.notion.site/Resource-Hub-0123456789abcdef0123456789abcdef?pvs=73"),
  "01234567-89ab-cdef-0123-456789abcdef",
  "public Notion URLs must expose their page id without relying on a browser",
);
assert.equal(notionPageIdFromUrl("https://example.com/0123456789abcdef0123456789abcdef"), null);

const rootPageId = "01234567-89ab-cdef-0123-456789abcdef";
const notionFixture = {
  block: {
    [rootPageId]: {
      value: {
        id: rootPageId,
        type: "page",
        properties: { title: [["Resource Hub"]] },
        content: ["heading", "intro", "bullet", "file", "image", "database"],
      },
    },
    heading: {
      value: {
        id: "heading",
        type: "sub_header",
        properties: { title: [["Notes"]] },
      },
    },
    intro: {
      value: {
        id: "intro",
        type: "text",
        properties: {
          title: [
            ["Read "],
            ["the guide", [["a", "https://child.notion.site/Guide-fedcba9876543210fedcba9876543210"]]],
            [" before starting."],
          ],
        },
      },
    },
    bullet: {
      value: {
        id: "bullet",
        type: "bulleted_list",
        properties: { title: [["Install the plugin", [["b"]]]] },
      },
    },
    file: {
      value: {
        id: "file",
        type: "file",
        properties: {
          title: [["Setup checklist"]],
          source: [["https://cdn.example.com/setup-checklist.pdf"]],
        },
      },
    },
    image: {
      value: {
        id: "image",
        type: "image",
        properties: {
          title: [["Architecture"]],
          source: [["https://cdn.example.com/architecture.png"]],
        },
      },
    },
    database: {
      value: {
        id: "database",
        type: "collection_view",
        view_ids: ["resource-view"],
      },
    },
    "11111111-1111-1111-1111-111111111111": {
      value: {
        value: {
          value: {
            id: "11111111-1111-1111-1111-111111111111",
            type: "page",
            properties: { title: [["Database resource one"]] },
          },
        },
      },
    },
    "22222222-2222-2222-2222-222222222222": {
      value: {
        id: "22222222-2222-2222-2222-222222222222",
        type: "page",
        properties: { title: [["Database resource two"]] },
      },
    },
  },
  collection_query: {
    "resource-collection": {
      "resource-view": {
        blockIds: ["11111111-1111-1111-1111-111111111111"],
        collection_group_results: {
          blockIds: ["22222222-2222-2222-2222-222222222222"],
        },
      },
    },
  },
};

const notionPage = notionRecordMapToMarkdown(
  notionFixture,
  rootPageId,
  "https://example.notion.site/Resource-Hub-0123456789abcdef0123456789abcdef",
);
assert.equal(notionPage.title, "Resource Hub");
assert.match(notionPage.markdown, /^# Resource Hub/m);
assert.match(notionPage.markdown, /^## Notes/m);
assert.match(notionPage.markdown, /Read \[the guide\]\(https:\/\/child\.notion\.site\/Guide-/);
assert.match(notionPage.markdown, /- \*\*Install the plugin\*\*/);
assert.match(notionPage.markdown, /\[Setup checklist\]\(https:\/\/cdn\.example\.com\/setup-checklist\.pdf\)/);
assert.deepEqual(
  Array.from(notionPage.links),
  [
    "https://child.notion.site/Guide-fedcba9876543210fedcba9876543210",
    "https://example.notion.site/11111111111111111111111111111111",
    "https://example.notion.site/22222222222222222222222222222222",
  ],
  "page links and every inline-database row must be separated from downloadable assets",
);
assert.match(notionPage.markdown, /\[Database resource one\]\(https:\/\/example\.notion\.site\/111111/);
assert.match(notionPage.markdown, /\[Database resource two\]\(https:\/\/example\.notion\.site\/222222/);
assert.deepEqual(
  Array.from(notionPage.assets, (asset) => ({ ...asset })),
  [
    { url: "https://cdn.example.com/setup-checklist.pdf", name: "Setup checklist" },
    { url: "https://cdn.example.com/architecture.png", name: "Architecture", contentType: "image" },
  ],
);

let retryAttempts = 0;
const retryWaits = [];
const retriedPage = await notionContext.__testedModule.loadPublicNotionPage(
  "https://example.notion.site/Resource-Hub-0123456789abcdef0123456789abcdef",
  {
    loadPage: async (_pageId, options) => {
      retryAttempts += 1;
      assert.equal(options.concurrency, 1, "deep extraction must keep Notion's internal request concurrency low");
      if (retryAttempts < 3) {
        const error = new Error("Request failed with status code 429");
        error.status = 429;
        throw error;
      }
      return notionFixture;
    },
    wait: async (milliseconds) => { retryWaits.push(milliseconds); },
  },
);
assert.equal(retriedPage.title, "Resource Hub");
assert.equal(retryAttempts, 3);
assert.deepEqual(retryWaits, [1_500, 3_000], "Notion throttling must use exponential backoff before retrying");

let nonRetryableAttempts = 0;
await assert.rejects(
  notionContext.__testedModule.loadPublicNotionPage(
    "https://example.notion.site/Resource-Hub-0123456789abcdef0123456789abcdef",
    {
      loadPage: async () => {
        nonRetryableAttempts += 1;
        const error = new Error("Request failed with status code 404");
        error.status = 404;
        throw error;
      },
      wait: async () => { throw new Error("404 errors must not be retried"); },
    },
  ),
  /404/,
);
assert.equal(nonRetryableAttempts, 1);

const writes = [];
const loadedUrls = [];
const deepContext = vm.createContext({
  URL,
  basename: (value) => value.split("/").at(-1) || "download",
  extname: (value) => value.includes(".") ? `.${value.split(".").at(-1)}` : "",
  join: (...parts) => parts.join("/"),
  mkdir: async () => {},
  writeFile: async (path, contents) => { writes.push({ path, contents }); },
});
vm.runInContext(
  compileForVm(
    "../src/lib/services/integrations/slack-linked-content.ts",
    "{ extractSlackMessageLinks, downloadSlackLinkedContent, loadPublicLinkedResource }",
  ),
  deepContext,
  { filename: "slack-linked-content.ts" },
);

const { extractSlackMessageLinks, downloadSlackLinkedContent } = deepContext.__testedModule;
const [{ Defuddle: RealDefuddle }, { parseHTML: realParseHTML }, { isIP: realIsIP }] = await Promise.all([
  import("defuddle/node"),
  import("linkedom"),
  import("node:net"),
]);
Object.assign(deepContext, {
  AbortSignal,
  Defuddle: RealDefuddle,
  TextDecoder,
  fetch: async () => new Response(
    "<!doctype html><html><head><title>Public Guide</title></head><body><article><h1>Public Guide</h1><p>Read <a href=\"https://docs.example.com/next\">the next note</a>.</p><img src=\"https://cdn.example.com/diagram.png\" alt=\"Diagram\"></article></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  ),
  isIP: realIsIP,
  loadPublicNotionPage: async () => { throw new Error("Notion loader must not run for an ordinary page"); },
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  notionPageIdFromUrl,
  parseHTML: realParseHTML,
});
const genericPage = await deepContext.__testedModule.loadPublicLinkedResource("https://public.example/guide");
assert.equal(genericPage.kind, "page");
assert.equal(genericPage.title, "Public Guide");
assert.match(genericPage.markdown, /Read \[the next note\]\(https:\/\/docs\.example\.com\/next\)/);
assert.deepEqual(Array.from(genericPage.links), ["https://docs.example.com/next"]);
assert.deepEqual(
  Array.from(genericPage.assets, (asset) => ({ ...asset })),
  [{ url: "https://cdn.example.com/diagram.png", name: "Diagram", contentType: "image" }],
  "ordinary public pages must use clean Markdown extraction and expose their images as filterable assets",
);
await assert.rejects(
  deepContext.__testedModule.loadPublicLinkedResource("http://127.0.0.1/private"),
  /private network URLs are not allowed/,
  "message links must never turn the dashboard into a local-network fetch proxy",
);

const slackMessages = [
  {
    text: "Resources: <https://root.notion.site/Root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|open the hub> and https://cdn.example.com/direct.pdf.",
    blocks: [{ elements: [{ url: "https://root.notion.site/Root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }],
  },
];
assert.deepEqual(
  Array.from(extractSlackMessageLinks(slackMessages)),
  [
    "https://root.notion.site/Root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "https://cdn.example.com/direct.pdf",
  ],
  "Slack links must be normalized, de-duplicated, and stripped of Slack labels and punctuation",
);

const resources = new Map([
  ["https://root.notion.site/Root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    kind: "page",
    sourceKind: "notion",
    url: "https://root.notion.site/Root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    title: "Root resources",
    markdown: "# Root resources\n",
    links: ["https://child.notion.site/Child-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    assets: [
      { url: "https://cdn.example.com/root.pdf", name: "Root guide" },
      { url: "https://cdn.example.com/root.png", name: "Root image", contentType: "image" },
    ],
  }],
  ["https://child.notion.site/Child-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
    kind: "page",
    sourceKind: "notion",
    url: "https://child.notion.site/Child-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    title: "Child notes",
    markdown: "# Child notes\n",
    links: ["https://third.notion.site/Too-deep-cccccccccccccccccccccccccccccccc"],
    assets: [{ url: "https://cdn.example.com/child.zip", name: "Child bundle" }],
  }],
  ["https://third.notion.site/Too-deep-cccccccccccccccccccccccccccccccc", {
    kind: "page",
    sourceKind: "notion",
    url: "https://third.notion.site/Too-deep-cccccccccccccccccccccccccccccccc",
    title: "Deep notes",
    markdown: "# Deep notes\n",
    links: [],
    assets: [],
  }],
  ["https://cdn.example.com/direct.pdf", {
    kind: "file",
    url: "https://cdn.example.com/direct.pdf",
    name: "direct.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([1]),
  }],
  ["https://cdn.example.com/root.pdf", {
    kind: "file",
    url: "https://cdn.example.com/root.pdf",
    name: "root.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([2]),
  }],
  ["https://cdn.example.com/root.png", {
    kind: "file",
    url: "https://cdn.example.com/root.png",
    name: "root.png",
    contentType: "image/png",
    bytes: new Uint8Array([3]),
  }],
  ["https://cdn.example.com/child.zip", {
    kind: "file",
    url: "https://cdn.example.com/child.zip",
    name: "child.zip",
    contentType: "application/zip",
    bytes: new Uint8Array([4]),
  }],
]);

const linkedProgress = [];

const deepSummary = await downloadSlackLinkedContent(
  slackMessages,
  "/tmp/slack/assets",
  {
    maxDepth: 1,
    ignoreFileTypes: ["image"],
    onProgress: (progress) => linkedProgress.push(progress),
  },
  {
    loadResource: async (url) => {
      loadedUrls.push(url);
      const resource = resources.get(url);
      if (!resource) throw new Error(`Unexpected URL ${url}`);
      return resource;
    },
    mkdir: deepContext.mkdir,
    writeFile: deepContext.writeFile,
  },
);

assert.equal(deepSummary.linksFound, 2);
assert.equal(deepSummary.pagesDownloaded, 3);
assert.equal(deepSummary.filesDownloaded, 3);
assert.equal(deepSummary.ignoredFiles, 1);
assert.equal(deepSummary.failed.length, 0);
assert.ok(
  loadedUrls.includes("https://third.notion.site/Too-deep-cccccccccccccccccccccccccccccccc"),
  "Notion-to-Notion traversal must continue past the ordinary web-page depth limit",
);
assert.ok(writes.some(({ path }) => path.endsWith("/linked-pages/Root resources.md")));
assert.ok(writes.some(({ path }) => path.endsWith("/linked-pages/Child notes.md")));
assert.ok(writes.some(({ path }) => path.endsWith("/linked-pages/Deep notes.md")));
assert.ok(writes.some(({ path }) => path.endsWith("/linked-files/direct.pdf")));
assert.ok(writes.some(({ path }) => path.endsWith("/linked-files/root.pdf")));
assert.ok(writes.some(({ path }) => path.endsWith("/linked-files/child.zip")));
assert.ok(!writes.some(({ path }) => path.endsWith("/linked-files/root.png")));
assert.equal(linkedProgress[0].stage, "linked-content");
assert.equal(linkedProgress[0].completed, 0);
assert.ok(
  linkedProgress.some((progress) => progress.detail === "Saved Root resources.md"),
  "the crawler must identify the page it just extracted",
);
assert.equal(linkedProgress.at(-1).completed, linkedProgress.at(-1).total);

const limitedLoads = [];
const limitedSummary = await downloadSlackLinkedContent(
  [{ text: "https://root.notion.site/Root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  "/tmp/slack/limited",
  { maxDepth: 2, maxPages: 1, maxFiles: 10, ignoreFileTypes: ["image"] },
  {
    loadResource: async (url) => {
      limitedLoads.push(url);
      const resource = resources.get(url);
      if (!resource) throw new Error(`Unexpected URL ${url}`);
      return resource;
    },
    mkdir: deepContext.mkdir,
    writeFile: deepContext.writeFile,
  },
);
assert.equal(limitedSummary.pagesDownloaded, 1);
assert.equal(limitedSummary.skippedByLimit, 1);
assert.ok(
  !limitedLoads.includes("https://child.notion.site/Child-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  "known page links must not be fetched after the page safety limit is reached",
);

const chainLength = 121;
const chainUrls = Array.from({ length: chainLength }, (_, index) => {
  const pageId = (index + 1).toString(16).padStart(32, "0");
  return `https://chain.notion.site/Page-${pageId}`;
});
const longChainLoads = [];
const longChainSummary = await downloadSlackLinkedContent(
  [{ text: chainUrls[0] }],
  "/tmp/slack/long-chain",
  { ignoreFileTypes: ["image"] },
  {
    loadResource: async (url) => {
      longChainLoads.push(url);
      const index = chainUrls.indexOf(url);
      if (index < 0) throw new Error(`Unexpected URL ${url}`);
      return {
        kind: "page",
        sourceKind: "notion",
        url,
        title: `Chain page ${index + 1}`,
        markdown: `# Chain page ${index + 1}\n`,
        links: index + 1 < chainUrls.length ? [chainUrls[index + 1]] : [],
        assets: [],
      };
    },
    mkdir: deepContext.mkdir,
    writeFile: deepContext.writeFile,
  },
);
assert.equal(longChainLoads.length, chainLength);
assert.equal(longChainSummary.pagesDownloaded, chainLength);
assert.equal(longChainSummary.skippedByLimit, 0);
assert.equal(longChainSummary.complete, true);
assert.equal(longChainSummary.maxGraphDepth, chainLength - 1);

const canonicalNotionUrl = "https://resources.notion.site/Shared-dddddddddddddddddddddddddddddddd";
const shortNotionUrl = "https://go.example.com/shared";
const aliasLoads = [];
const aliasSummary = await downloadSlackLinkedContent(
  [{ text: `${shortNotionUrl} ${canonicalNotionUrl}` }],
  "/tmp/slack/aliases",
  {},
  {
    loadResource: async (url) => {
      aliasLoads.push(url);
      return {
        kind: "page",
        sourceKind: "notion",
        url: canonicalNotionUrl,
        title: "Shared resource",
        markdown: "# Shared resource\n",
        links: [],
        assets: [],
      };
    },
    mkdir: deepContext.mkdir,
    writeFile: deepContext.writeFile,
  },
);
assert.deepEqual(aliasLoads, [shortNotionUrl]);
assert.equal(aliasSummary.pagesDownloaded, 1, "redirect aliases must not consume the page budget twice");
assert.equal(aliasSummary.notionPagesDownloaded, 1);
assert.equal(aliasSummary.complete, true);

const webUrls = [
  "https://web.example.com/root",
  "https://web.example.com/child",
  "https://web.example.com/grandchild",
];
const webLoads = [];
await downloadSlackLinkedContent(
  [{ text: webUrls[0] }],
  "/tmp/slack/web-depth",
  { maxDepth: 1 },
  {
    loadResource: async (url) => {
      webLoads.push(url);
      const index = webUrls.indexOf(url);
      if (index < 0) throw new Error(`Unexpected URL ${url}`);
      return {
        kind: "page",
        sourceKind: "web",
        url,
        title: `Web page ${index + 1}`,
        markdown: `# Web page ${index + 1}\n`,
        links: index + 1 < webUrls.length ? [webUrls[index + 1]] : [],
        assets: [],
      };
    },
    mkdir: deepContext.mkdir,
    writeFile: deepContext.writeFile,
  },
);
assert.deepEqual(
  webLoads,
  webUrls.slice(0, 2),
  "ordinary websites must stay depth-bounded so a Notion archive cannot expand into an unbounded web crawl",
);

const liveNotionUrl = process.env.HIVEMINDOS_TEST_LIVE_NOTION_URL;
if (liveNotionUrl) {
  const { NotionAPI } = await import("notion-client");
  notionContext.NotionAPI = NotionAPI;
  const livePage = await notionContext.__testedModule.loadPublicNotionPage(liveNotionUrl);
  assert.ok(livePage.title.length > 0, "the live public Notion page must expose a title");
  assert.match(livePage.markdown, /^# /, "the live public Notion page must convert to Markdown");
  console.log(JSON.stringify({
    liveNotionTitle: livePage.title,
    liveNotionMarkdownBytes: Buffer.byteLength(livePage.markdown),
    liveNotionLinks: livePage.links.length,
    liveNotionAssets: livePage.assets.length,
  }));

  const liveLinkedUrl = process.env.HIVEMINDOS_TEST_LIVE_LINK_URL;
  if (liveLinkedUrl) {
    const [{ lookup }, { isIP }, { Defuddle }, { parseHTML }] = await Promise.all([
      import("node:dns/promises"),
      import("node:net"),
      import("defuddle/node"),
      import("linkedom"),
    ]);
    Object.assign(deepContext, {
      AbortSignal,
      Defuddle,
      TextDecoder,
      fetch,
      isIP,
      loadPublicNotionPage: notionContext.__testedModule.loadPublicNotionPage,
      lookup,
      notionPageIdFromUrl,
      parseHTML,
    });
    const linkedResource = await deepContext.__testedModule.loadPublicLinkedResource(liveLinkedUrl);
    assert.equal(linkedResource.kind, "page", "the live short link must resolve to a readable page");
    assert.match(linkedResource.url, /notion\.site/, "the live short link must resolve through to Notion");
    console.log(JSON.stringify({
      liveLinkedTitle: linkedResource.title,
      liveLinkedUrl: linkedResource.url,
      liveLinkedLinks: linkedResource.links.length,
      liveLinkedAssets: linkedResource.assets.length,
    }));
  }
}

console.log("slack-deep-download: links + Notion markdown + bounded crawl OK");
