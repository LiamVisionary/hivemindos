import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Reads the optional packaged-agents catalog (packaged-agents/optional/**/AGENT.md). Each entry
// becomes an installable agent subclass: the in-app browser lists these, and installing one adds
// a CustomWorkerClassProfile to the user's selectable agents. Mirrors the packaged-skills catalog.

const OPTIONAL_ROOT = join(process.cwd(), "packaged-agents", "optional");

export interface PackagedAgentCatalogEntry {
  slug: string;
  label: string;
  summary: string;
  domain?: string;
  source: string;
  sourceUrl?: string;
  repository?: string;
  license?: string;
  /** Full system-prompt soul; present only on a single-agent (detail) read. */
  soulPrompt?: string;
}

interface ParsedAgent {
  fields: Record<string, unknown>;
  soul: string;
}

function parseAgentMarkdown(markdown: string): ParsedAgent {
  const m = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const fields: Record<string, unknown> = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const f = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!f) continue;
      const raw = f[2];
      try {
        fields[f[1]] = raw.startsWith('"') || raw.startsWith("[") ? JSON.parse(raw) : raw;
      } catch {
        fields[f[1]] = raw;
      }
    }
  }
  const body = m ? markdown.slice(m[0].length) : markdown;
  const soulMatch = body.match(/^##\s+Soul\s*\n\n?([\s\S]*)$/);
  return { fields, soul: (soulMatch ? soulMatch[1] : body).trim() };
}

async function findAgentFiles(root: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 5) return out;
  for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const p = join(root, e.name);
    if (e.isFile() && e.name === "AGENT.md") out.push(p);
    else if (e.isDirectory() && e.name !== ".git" && e.name !== "node_modules") await findAgentFiles(p, depth + 1, out);
  }
  return out;
}

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(dir, ".hivemind-agent-source.json"), "utf8").catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function entryFromFile(file: string, includeSoul: boolean): Promise<PackagedAgentCatalogEntry | null> {
  const markdown = await readFile(file, "utf8").catch(() => "");
  if (!markdown.trim()) return null;
  const { fields, soul } = parseAgentMarkdown(markdown);
  const dir = dirname(file);
  const meta = await readManifest(dir);
  const slug = String(fields.id ?? meta.slug ?? basename(dir));
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    slug,
    label: str(fields.label) || str(meta.label) || slug,
    summary: str(fields.summary) || str(meta.description) || "Optional packaged agent.",
    domain: str(fields.domain) || str(meta.domain),
    source: str(meta.sourceLabel) || "packaged",
    sourceUrl: str(meta.sourceUrl),
    repository: str(meta.repository),
    license: str(meta.license),
    ...(includeSoul ? { soulPrompt: soul } : {}),
  };
}

let cache: PackagedAgentCatalogEntry[] | null = null;

export async function listPackagedAgents(query?: string): Promise<PackagedAgentCatalogEntry[]> {
  if (!cache) {
    if (!existsSync(OPTIONAL_ROOT)) {
      cache = [];
    } else {
      const files = await findAgentFiles(OPTIONAL_ROOT);
      const entries = await Promise.all(files.map((f) => entryFromFile(f, false)));
      cache = entries
        .filter((e): e is PackagedAgentCatalogEntry => Boolean(e))
        .sort((a, b) => (a.domain ?? "").localeCompare(b.domain ?? "") || a.label.localeCompare(b.label));
    }
  }
  const q = query?.trim().toLowerCase();
  if (!q) return cache;
  return cache.filter((e) => [e.label, e.slug, e.summary, e.domain, e.source].join(" ").toLowerCase().includes(q));
}

export async function getPackagedAgent(slug: string): Promise<PackagedAgentCatalogEntry | null> {
  const safe = slug.replace(/[^a-z0-9-]/gi, "");
  if (!safe) return null;
  for (const file of await findAgentFiles(OPTIONAL_ROOT)) {
    const entry = await entryFromFile(file, true);
    if (entry?.slug === safe) return entry;
  }
  return null;
}

export function invalidatePackagedAgentCache() {
  cache = null;
}
