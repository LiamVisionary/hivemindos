import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { homedir, hostname } from "node:os";
import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { KanbanMachineTarget } from "@/lib/types/kanban";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AeonDeliverableAction = "list" | "download" | "send";

type AeonDeliverableBody = {
  action?: AeonDeliverableAction;
  agent?: AgentProfile;
  vaultPath?: string;
  path?: string;
  url?: string;
  targetMachine?: KanbanMachineTarget | null;
};

export type AeonDeliverable = {
  id: string;
  title: string;
  kind: "verdict" | "miroshark-run" | "posts" | "json" | "output" | "document" | "file" | "url";
  source: "vault" | "aeon-output" | "remote";
  repository?: string;
  simulationId?: string;
  status?: string;
  path?: string;
  url?: string;
  relativePath?: string;
  size?: number;
  updatedAt: string;
  availableOnMachine: boolean;
  machineName?: string;
  summary?: string;
};

const TRANSFER_DIR = ".hivemindos-transfers";
const PAYLOAD_DIR = "payload";
const DEFAULT_VAULT = "~/Documents/Obsidian/hivemindos-vault";
const MIROSHARK_RUNS_ROOT = join("Projects", "HivemindOS", "MiroShark Simulations", "runs");
const AEON_OUTPUT_DIRS = [".outputs", "outputs", join("dashboard", "outputs")];
const DELIVERABLE_FILENAMES = new Set([
  "aeon-rehearsal.md",
  "aeon-rehearsal.json",
  "run.md",
  "run.json",
  "posts.md",
  "posts.json",
]);

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as AeonDeliverableBody;
    const action: AeonDeliverableAction = body.action === "download" || body.action === "send" ? body.action : "list";
    if (action === "download") return NextResponse.json(await downloadDeliverable(body));
    if (action === "send") return NextResponse.json(await sendDeliverable(body));
    return NextResponse.json({ ok: true, deliverables: await listDeliverables(body) });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "AEON deliverable request failed.",
    }, { status: 400 });
  }
}

async function listDeliverables(body: AeonDeliverableBody) {
  const agent = body.agent;
  const vaultPath = vaultRoot(body.vaultPath);
  const deliverables = [
    ...await vaultMiroSharkDeliverables(vaultPath, agent),
    ...await aeonOutputDeliverables(agent),
  ];
  const byId = new Map<string, AeonDeliverable>();
  for (const deliverable of deliverables) byId.set(deliverable.id, deliverable);
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 80);
}

async function vaultMiroSharkDeliverables(vaultPath: string, agent?: AgentProfile) {
  const root = join(vaultPath, MIROSHARK_RUNS_ROOT);
  const files = await walkFiles(root, 5).catch(() => []);
  const deliverables: AeonDeliverable[] = [];
  for (const file of files) {
    if (!DELIVERABLE_FILENAMES.has(basename(file))) continue;
    const metadata = await readDeliverableMetadata(file);
    if (!matchesAgent(agent, metadata.repository)) continue;
    const info = await stat(file);
    const relativePath = relative(vaultPath, file);
    deliverables.push({
      id: stableId(file),
      title: titleForFile(file, metadata),
      kind: kindForFile(file),
      source: "vault",
      repository: metadata.repository,
      simulationId: metadata.simulationId,
      status: metadata.status,
      path: file,
      relativePath,
      size: info.size,
      updatedAt: info.mtime.toISOString(),
      availableOnMachine: true,
      machineName: "This Mac",
      summary: await previewText(file),
    });
  }
  return deliverables;
}

async function aeonOutputDeliverables(agent?: AgentProfile) {
  const root = aeonRoot(agent);
  if (!root) return [];
  const deliverables: AeonDeliverable[] = [];
  for (const dir of AEON_OUTPUT_DIRS.map((entry) => join(root, entry))) {
    const files = await walkFiles(dir, 3).catch(() => []);
    for (const file of files) {
      const info = await stat(file);
      deliverables.push({
        id: stableId(file),
        title: basename(file),
        kind: kindForFile(file) === "json" ? "json" : "output",
        source: "aeon-output",
        path: file,
        relativePath: relative(root, file),
        size: info.size,
        updatedAt: info.mtime.toISOString(),
        availableOnMachine: true,
        machineName: "This Mac",
        summary: await previewText(file),
      });
    }
  }
  return deliverables;
}

async function downloadDeliverable(body: AeonDeliverableBody) {
  const target = cleanTarget(body.path || body.url || "");
  if (!target) throw new Error("Deliverable path or URL is required.");
  if (targetIsLocalFile(target)) {
    const path = filePathFromTarget(target);
    await assertFile(path);
    return { ok: true, path, downloaded: false };
  }
  if (!/^https?:\/\//i.test(target)) throw new Error("Only HTTP deliverables can be downloaded to this machine.");
  const response = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  const vaultPath = vaultRoot(body.vaultPath);
  const dir = join(vaultPath, ".hivemindos-downloads", "aeon-deliverables");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const url = new URL(target);
  const name = safeFileName(basename(url.pathname) || `deliverable-${Date.now()}`);
  const destination = join(dir, name);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  return { ok: true, path: destination, downloaded: true };
}

async function sendDeliverable(body: AeonDeliverableBody) {
  const target = cleanTarget(body.path || body.url || "");
  const machine = body.targetMachine;
  if (!machine?.key) throw new Error("Target machine is required.");
  if (!targetIsLocalFile(target)) throw new Error("Only files available on this machine can be sent to another machine.");
  const path = filePathFromTarget(target);
  await assertFile(path);
  const transfer = await createTransfer({
    vaultPath: vaultRoot(body.vaultPath),
    file: path,
    to: {
      machineId: machine.key,
      host: machine.name,
      runtime: "aeon",
      agentId: body.agent?.agentId || body.agent?.id || "",
    },
    note: `AEON deliverable: ${basename(path)}`,
  });
  return { ok: true, transfer };
}

function vaultRoot(value?: string) {
  return resolve(expandHome(value?.trim() || process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH || DEFAULT_VAULT));
}

function aeonRoot(agent?: AgentProfile) {
  const raw = agent?.aeonLocalPath || agent?.localDataDir || "";
  if (!raw.trim() || /^https?:\/\//i.test(raw)) return "";
  return resolve(expandHome(raw));
}

function expandHome(value: string) {
  return value.replace(/^~(?=$|\/)/, homedir());
}

async function walkFiles(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".outputs") continue;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath, depth - 1));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function readDeliverableMetadata(path: string) {
  const content = await readFile(path, "utf8").catch(() => "");
  return {
    repository: frontmatterValue(content, "aeon_repository"),
    simulationId: frontmatterValue(content, "simulation_id") || path.match(/sim_[A-Za-z0-9_-]+/)?.[0],
    status: frontmatterValue(content, "status"),
  };
}

function frontmatterValue(content: string, key: string) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return match?.[1]?.replace(/^["']|["']$/g, "").trim();
}

function matchesAgent(agent: AgentProfile | undefined, repository?: string) {
  if (!repository || !agent) return true;
  const deliverableRepo = normalizeRepo(repository);
  const agentRepo = normalizeRepo(agent.aeonRepo);
  if (agentRepo && (agentRepo === deliverableRepo || agentRepo.endsWith(`/${deliverableRepo.split("/").pop()}`))) return true;
  const agentName = normalizeName(agent.aeonRepoName || agent.name);
  const repoName = normalizeName(deliverableRepo.split("/").pop() || deliverableRepo);
  return Boolean(agentName && repoName && agentName === repoName);
}

function normalizeRepo(value?: string) {
  return String(value || "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function normalizeName(value?: string) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function kindForFile(path: string): AeonDeliverable["kind"] {
  const name = basename(path).toLowerCase();
  if (name === "aeon-rehearsal.md") return "verdict";
  if (name === "run.md") return "miroshark-run";
  if (name === "posts.md") return "posts";
  if (extname(name) === ".json") return "json";
  if (extname(name) === ".md") return "document";
  return "file";
}

function titleForFile(path: string, metadata: { simulationId?: string }) {
  const name = basename(path).toLowerCase();
  const suffix = metadata.simulationId ? ` · ${metadata.simulationId}` : "";
  if (name === "aeon-rehearsal.md") return `AEON verdict${suffix}`;
  if (name === "run.md") return `MiroShark run${suffix}`;
  if (name === "posts.md") return `MiroShark posts${suffix}`;
  return basename(path);
}

async function previewText(path: string) {
  if (![".md", ".txt", ".json"].includes(extname(path).toLowerCase())) return "";
  const content = await readFile(path, "utf8").catch(() => "");
  return content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/[#>*_`[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function cleanTarget(value: string) {
  return String(value || "").trim().replace(/[\0\r\n]/g, "");
}

function targetIsLocalFile(target: string) {
  return target.startsWith("/") || target.startsWith("file://") || target.startsWith("~");
}

function filePathFromTarget(target: string) {
  if (target.startsWith("file://")) return decodeURIComponent(new URL(target).pathname);
  return resolve(expandHome(target));
}

async function assertFile(path: string) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Deliverable is not a file.");
  await access(path, constants.R_OK);
}

function safeFileName(value: string) {
  return basename(value).replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^\.+/, "").trim() || `deliverable-${randomBytes(4).toString("hex")}`;
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  const data = await readFile(path);
  hash.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return hash.digest("hex");
}

async function createTransfer(input: {
  vaultPath: string;
  file: string;
  note: string;
  to: { machineId: string; host?: string; runtime?: string; agentId?: string };
}) {
  const root = join(input.vaultPath, TRANSFER_DIR);
  const id = `hive-transfer-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}`;
  const dir = join(root, id);
  const payloadDir = join(dir, PAYLOAD_DIR);
  assertInside(root, dir);
  await mkdir(payloadDir, { recursive: true, mode: 0o700 });
  const destination = join(payloadDir, safeFileName(input.file));
  assertInside(payloadDir, destination);
  await copyFile(input.file, destination);
  const fileStats = await stat(destination);
  const manifest = {
    id,
    schema: "hivemind.transfer.v1",
    status: "pending",
    createdAt: new Date().toISOString(),
    note: input.note,
    from: { host: hostname(), runtime: "aeon", agentId: "" },
    to: input.to,
    payloads: [{
      name: basename(destination),
      mediaType: mediaTypeFor(destination),
      bytes: fileStats.size,
      sha256: await sha256(destination),
      path: join(TRANSFER_DIR, id, PAYLOAD_DIR, basename(destination)),
    }],
  };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function mediaTypeFor(path: string) {
  const extension = extname(path).toLowerCase();
  if (extension === ".md") return "text/markdown";
  if (extension === ".json") return "application/json";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function assertInside(parent: string, child: string) {
  const base = resolve(parent);
  const target = resolve(child);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error("Transfer path escapes the shared transfer root.");
}
