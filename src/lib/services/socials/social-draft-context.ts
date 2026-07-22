import "server-only";

import { lookup } from "node:dns/promises";
import { open, readdir, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { SocialAccount, SocialQueueItem } from "@/lib/services/socials/socials-types";

const MAX_SOUL_CHARS = 36_000;
const MAX_SOUL_FILE_CHARS = 6_000;
const MAX_SOURCE_CHARS = 8_000;
const MAX_ALL_SOURCE_CHARS = 24_000;
const MAX_REMOTE_BYTES = 1_500_000;
const MAX_LOCAL_FILES = 10;
const SOURCE_TIMEOUT_MS = 12_000;
const SOUL_FILES = ["SKILL.md", "SOUL.md", "STYLE.md", "examples/good-outputs.md", "examples/bad-outputs.md", "MEMORY.md"];
const TEXT_FILE_PATTERN = /\.(?:md|mdx|txt|json|jsonl|ya?ml|toml|csv|ts|tsx|js|jsx|py|rs)$/i;
const SENSITIVE_FILE_PATTERN = /(?:^|\/)(?:\.env(?:\.|$)|credentials?|secrets?|private[-_.]?key)/i;

export type SocialDraftContext = {
  text: string;
  contextSourceIds: string[];
  warnings: string[];
};

type ContextDependencies = { fetchImpl?: typeof fetch };

function clamp(value: string, max: number): string {
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n[truncated]` : trimmed;
}

async function readFilePrefix(file: string, maxBytes: number): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return new TextDecoder().decode(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function loadSoul(account: SocialAccount): Promise<string> {
  const soulPath = account.soulPath?.trim();
  const configured = DEFAULT_SHARED_VAULT.vaultPath?.trim();
  if (!soulPath || !configured) return "";
  const vaultRoot = path.resolve(resolveObsidianVaultPath(configured));
  const soulRoot = path.resolve(vaultRoot, soulPath);
  if (!inside(vaultRoot, soulRoot)) throw new Error("The configured social voice resolves outside the shared vault.");
  const sections: string[] = [];
  let remaining = MAX_SOUL_CHARS;
  for (const relative of SOUL_FILES) {
    if (remaining <= 0) break;
    const file = path.resolve(soulRoot, relative);
    if (!inside(soulRoot, file)) continue;
    // Reserve room for every layer, especially MEMORY.md. Letting an early
    // examples file consume the whole budget silently removed engagement
    // targets and learned voice corrections from later drafting stages.
    const content = await readFilePrefix(file, Math.min(remaining, MAX_SOUL_FILE_CHARS)).catch(() => "");
    if (!content.trim()) continue;
    const clipped = clamp(content, remaining);
    sections.push(`## Voice: ${relative}\n${clipped}`);
    remaining -= clipped.length;
  }
  return sections.join("\n\n");
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Only public HTTP(S) context URLs are supported.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local and private network context URLs are not allowed.");
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Local and private network context URLs are not allowed.");
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The context host does not resolve to a public address.");
  }
  return url;
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES) throw new Error("Context page is larger than the 1.5 MB limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REMOTE_BYTES) {
      await reader.cancel();
      throw new Error("Context page is larger than the 1.5 MB limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPublicText(value: string, fetchImpl: typeof fetch): Promise<string> {
  let current = await assertPublicUrl(value);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: { accept: "text/html,text/plain,application/json;q=0.8", "user-agent": "HivemindOS-Social-Drafter/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 4) throw new Error("Context URL redirected too many times.");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Context URL returned HTTP ${response.status}.`);
    const raw = await boundedResponseText(response);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
      const { document } = parseHTML(raw);
      const parsed = await Defuddle(document, current.toString(), { markdown: true, removeImages: true });
      return clamp(String(parsed.content || ""), MAX_SOURCE_CHARS);
    }
    if (contentType.includes("text/") || contentType.includes("json") || !contentType) return clamp(raw, MAX_SOURCE_CHARS);
    throw new Error(`Unsupported context content type: ${contentType || "unknown"}.`);
  }
  throw new Error("Context URL redirected too many times.");
}

async function loadLocalFile(file: string): Promise<string> {
  if (SENSITIVE_FILE_PATTERN.test(file) || !TEXT_FILE_PATTERN.test(file)) return "";
  const details = await stat(file);
  if (!details.isFile()) return "";
  return clamp(await readFilePrefix(file, MAX_SOURCE_CHARS), MAX_SOURCE_CHARS);
}

async function loadLocalFolder(folder: string): Promise<string> {
  const entries = await readdir(folder, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && TEXT_FILE_PATTERN.test(entry.name) && !SENSITIVE_FILE_PATTERN.test(entry.name))
    .map(async (entry) => {
      const file = path.join(folder, entry.name);
      return { file, name: entry.name, modified: (await stat(file)).mtimeMs };
    }));
  candidates.sort((left, right) => right.modified - left.modified || left.name.localeCompare(right.name));
  const sections: string[] = [];
  for (const candidate of candidates.slice(0, MAX_LOCAL_FILES)) {
    const content = await loadLocalFile(candidate.file);
    if (content) sections.push(`### ${candidate.name}\n${content}`);
  }
  return clamp(sections.join("\n\n"), MAX_SOURCE_CHARS);
}

async function loadContextSource(account: SocialAccount, source: SocialAccount["contextSources"][number], fetchImpl: typeof fetch): Promise<string> {
  if (source.kind === "local-file") return loadLocalFile(path.resolve(source.ref));
  if (source.kind === "local-folder") return loadLocalFolder(path.resolve(source.ref));
  if (source.kind === "website" || source.kind === "github") return fetchPublicText(source.ref, fetchImpl);
  if (source.kind === "x-account") {
    return `X account reference ${source.ref}. No automatic metered X read was made; use this only as an identity cue and do not invent recent posts.`;
  }
  return "";
}

function recentQueueContext(queue: SocialQueueItem[], accountId: string): string {
  const recent = queue
    .filter((item) => item.accountId === accountId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 20);
  if (!recent.length) return "No prior local drafts or posts are available.";
  return recent.map((item) => `- [${item.state}] ${clamp(item.text, 500)}`).join("\n");
}

/** Build bounded, injection-labeled source material for a tool-less drafting turn. */
export async function buildSocialDraftContext(
  account: SocialAccount,
  queue: SocialQueueItem[],
  dependencies: ContextDependencies = {},
): Promise<SocialDraftContext> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const contextSourceIds: string[] = [];
  const sourceSections: string[] = [];
  let sourceChars = 0;
  for (const source of account.contextSources) {
    if (sourceChars >= MAX_ALL_SOURCE_CHARS) break;
    try {
      const content = clamp(await loadContextSource(account, source, fetchImpl), Math.min(MAX_SOURCE_CHARS, MAX_ALL_SOURCE_CHARS - sourceChars));
      if (!content) {
        warnings.push(`${source.kind} source ${source.ref} had no usable text.`);
        continue;
      }
      contextSourceIds.push(source.id);
      sourceSections.push(`## Context source (${source.kind}): ${source.ref}${source.note ? `\nNote: ${source.note}` : ""}\n${content}`);
      sourceChars += content.length;
    } catch (error) {
      warnings.push(`${source.kind} source ${source.ref}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let soul = "";
  try {
    soul = await loadSoul(account);
  } catch (error) {
    warnings.push(`Posting voice: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    text: [
      soul || "## Voice\nNo soul stack is bound. Use a clear, specific, non-corporate voice.",
      ...sourceSections,
      `## Recent local queue history (avoid repeating these)\n${recentQueueContext(queue, account.id)}`,
      warnings.length ? `## Context collection warnings\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    contextSourceIds,
    warnings,
  };
}
