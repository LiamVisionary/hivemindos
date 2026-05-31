import { constants } from "fs";
import { access, appendFile, mkdir, readdir, readFile, realpath, stat } from "fs/promises";
import { dirname, join, relative, resolve, sep } from "path";
import type { AeonBrainPolicy } from "./policy";
import { appendPathAllowed, pathAllowed, normalizeVaultRelativePath } from "./policy";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

export type AeonBrainSearchResult = {
  path: string;
  headingPath: string[];
  text: string;
  score: number;
  startLine: number;
  endLine: number;
};

type MarkdownChunk = {
  headingPath: string[];
  text: string;
  startLine: number;
  endLine: number;
};

export type AeonBrainVault = {
  vaultRoot: string;
  search(query: string, policy: AeonBrainPolicy): Promise<AeonBrainSearchResult[]>;
  read(notePath: string, policy: AeonBrainPolicy): Promise<{ path: string; content: string }>;
  list(policy: AeonBrainPolicy): Promise<string[]>;
  bulk(policy: AeonBrainPolicy): Promise<Array<{ path: string; content: string }>>;
  append(notePath: string, content: string, policy: AeonBrainPolicy): Promise<{ path: string; appended: true }>;
};

export async function createAeonBrainVault(vaultPath?: string): Promise<AeonBrainVault> {
  const vaultRoot = resolveObsidianVaultPath(vaultPath, { requireWritable: true });
  const rootStats = await stat(vaultRoot).catch(() => null);
  if (!rootStats?.isDirectory()) throw Object.assign(new Error(`Obsidian vault is not available: ${vaultRoot}`), { status: 400 });
  const canonicalRoot = await realpath(vaultRoot);

  async function absolutePath(notePath: string) {
    const relativePath = normalizeVaultRelativePath(notePath);
    const absolute = resolve(join(vaultRoot, relativePath));
    await assertContained(canonicalRoot, absolute);
    return { relativePath, absolute };
  }

  async function listMarkdown(policy: AeonBrainPolicy) {
    const files = await listMarkdownFiles(canonicalRoot, vaultRoot, vaultRoot);
    return files.filter((file) => pathAllowed(policy, file));
  }

  return {
    vaultRoot,
    async search(query, policy) {
      const cleanQuery = query.trim();
      if (!cleanQuery) throw Object.assign(new Error("Search query is required."), { status: 400 });
      const files = await listMarkdown(policy);
      const results: AeonBrainSearchResult[] = [];
      let emittedChars = 0;

      for (const file of files) {
        const { absolute } = await absolutePath(file);
        const content = await readFile(absolute, "utf8").catch(() => "");
        if (!content.trim()) continue;
        const chunks = chunkMarkdown(content);
        const scored = scoreChunks(cleanQuery, chunks)
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.max(1, Math.min(policy.maxResults, 5)));

        for (const candidate of scored) {
          if (emittedChars >= policy.maxCharsPerRun) break;
          const text = truncate(candidate.chunk.text, policy.maxCharsPerResult);
          emittedChars += text.length;
          results.push({
            path: file,
            headingPath: candidate.chunk.headingPath,
            text,
            score: candidate.score,
            startLine: candidate.chunk.startLine,
            endLine: candidate.chunk.endLine,
          });
        }
      }

      return results.sort((a, b) => b.score - a.score).slice(0, policy.maxResults);
    },
    async read(notePath, policy) {
      const { relativePath, absolute } = await absolutePath(notePath);
      if (!pathAllowed(policy, relativePath)) {
        throw Object.assign(new Error(`AEON brain policy does not allow reading ${relativePath}.`), { status: 403 });
      }
      return { path: relativePath, content: await readFile(absolute, "utf8") };
    },
    async list(policy) {
      return listMarkdown(policy);
    },
    async bulk(policy) {
      const files = await listMarkdown(policy);
      const output: Array<{ path: string; content: string }> = [];
      let emittedChars = 0;
      for (const file of files) {
        if (emittedChars >= policy.maxCharsPerRun) break;
        const { absolute } = await absolutePath(file);
        const content = truncate(await readFile(absolute, "utf8"), Math.max(0, policy.maxCharsPerRun - emittedChars));
        emittedChars += content.length;
        output.push({ path: file, content });
      }
      return output;
    },
    async append(notePath, content, policy) {
      const { relativePath, absolute } = await absolutePath(notePath);
      if (!appendPathAllowed(policy, relativePath)) {
        throw Object.assign(new Error(`AEON brain policy does not allow appending to ${relativePath}.`), { status: 403 });
      }
      await mkdir(dirname(absolute), { recursive: true });
      await appendFile(absolute, content, "utf8");
      return { path: relativePath, appended: true };
    },
  };
}

async function listMarkdownFiles(canonicalRoot: string, vaultRoot: string, currentDir: string): Promise<string[]> {
  await assertContained(canonicalRoot, currentDir);
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(canonicalRoot, vaultRoot, fullPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    await assertContained(canonicalRoot, fullPath);
    files.push(normalizeVaultRelativePath(relative(vaultRoot, fullPath)));
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function assertContained(canonicalRoot: string, absolutePath: string) {
  const parent = await nearestExistingPath(absolutePath);
  const canonical = await realpath(parent);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${sep}`)) {
    throw Object.assign(new Error("Refusing to access a path outside the Obsidian vault."), { status: 403 });
  }
}

async function nearestExistingPath(absolutePath: string): Promise<string> {
  let current = absolutePath;
  while (true) {
    try {
      await access(current, constants.F_OK);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

function chunkMarkdown(markdown: string): MarkdownChunk[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: MarkdownChunk[] = [];
  const headings: string[] = [];
  let body: string[] = [];
  let startLine = 1;

  const flush = (endLine: number) => {
    const text = body.join("\n").trim();
    if (text) {
      chunks.push({ headingPath: headings.filter(Boolean), text: headingPrefix(headings) + text, startLine, endLine });
    }
    body = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush(index);
      headings.length = heading[1].length - 1;
      headings[heading[1].length - 1] = heading[2].trim();
      startLine = index + 1;
      continue;
    }
    body.push(line);
  }
  flush(lines.length);

  return chunks.length ? chunks : [{ headingPath: [], text: markdown.trim(), startLine: 1, endLine: lines.length }];
}

function headingPrefix(headings: string[]) {
  const visible = headings.filter(Boolean);
  return visible.length ? `${visible.join(" / ")}\n` : "";
}

function scoreChunks(query: string, chunks: MarkdownChunk[]) {
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];
  const chunkTokens = chunks.map((chunk) => tokenize(chunk.text));
  const docFreq = new Map<string, number>();
  for (const tokens of chunkTokens) {
    for (const token of new Set(tokens)) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }

  const raw = chunks.map((chunk, index) => {
    const tokens = chunkTokens[index] ?? [];
    const tfidf = queryTerms.reduce((sum, term) => {
      const frequency = tokens.filter((token) => token === term).length / Math.max(1, tokens.length);
      const idf = Math.log(chunks.length / Math.max(1, docFreq.get(term) ?? 0));
      return sum + frequency * idf;
    }, 0);
    const proximity = proximityScore(tokens, queryTerms);
    return { chunk, rawScore: (tfidf * 0.7) + (proximity * 0.3) };
  });

  const max = Math.max(0, ...raw.map((item) => item.rawScore));
  return raw.map((item) => ({ chunk: item.chunk, score: max > 0 ? item.rawScore / max : 0 }));
}

function proximityScore(tokens: string[], queryTerms: string[]) {
  if (queryTerms.length < 2) return tokens.includes(queryTerms[0] ?? "") ? 1 : 0;
  const positions = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    positions.set(token, [...(positions.get(token) ?? []), index]);
  });

  let totalDistance = 0;
  for (let index = 0; index < queryTerms.length - 1; index += 1) {
    const left = positions.get(queryTerms[index] ?? "");
    const right = positions.get(queryTerms[index + 1] ?? "");
    if (!left || !right) return 0;
    totalDistance += Math.min(...left.flatMap((leftIndex) => right.map((rightIndex) => Math.abs(leftIndex - rightIndex))));
  }

  return 1 / Math.max(1, totalDistance / Math.max(1, queryTerms.length - 1));
}

function tokenize(text: string) {
  return text.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean);
}

function truncate(text: string, maxChars: number) {
  if (maxChars <= 0) return "";
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}
