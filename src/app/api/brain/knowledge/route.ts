import { NextRequest } from "next/server";
import { resolveSharedContributionPolicy } from "@/lib/services/brain/shared-contribution-contract";
import {
  buildCompiledKnowledgeGraph,
  compileKnowledgeToWiki,
  dismissCompiledKnowledgeIssue,
  fixCompiledKnowledgeIssue,
  getCompiledKnowledgeBacklinks,
  getCompiledKnowledgeGraphOverview,
  getCompiledKnowledgeNode,
  getCompiledKnowledgeStatus,
  searchCompiledKnowledge,
  scanCompiledKnowledgeHealth,
  type CompileKnowledgeInput,
  type KnowledgePageKind,
} from "@/lib/services/obsidian/compiled-knowledge";

export const runtime = "nodejs";

type KnowledgeRequest = CompileKnowledgeInput & {
  action?: string;
  slug?: string;
  issueId?: string;
  reason?: string;
  includeFullGraph?: boolean;
  readonly?: boolean;
  query?: string;
  limit?: number;
  types?: KnowledgePageKind[];
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const domain = params.get("domain") || undefined;
    const vaultPath = params.get("vaultPath") || undefined;
    const action = params.get("action") || "status";
    if (action === "graph-overview") return Response.json({ ok: true, overview: await getCompiledKnowledgeGraphOverview({ vaultPath, domain }) });
    if (action === "search") {
      const query = params.get("q") || params.get("query") || "";
      if (!query.trim()) return Response.json({ ok: false, error: "Missing search query." }, { status: 400 });
      return Response.json({ ok: true, search: await searchCompiledKnowledge({ vaultPath, domain, query, limit: Number(params.get("limit") || 12) }) });
    }
    if (action === "scan-health") return Response.json({ ok: true, health: await scanCompiledKnowledgeHealth({ vaultPath, domain }) });
    return Response.json({ ok: true, status: await getCompiledKnowledgeStatus({ vaultPath, domain }) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Knowledge request failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as KnowledgeRequest;
    const action = body.action || "compile";
    if (action === "compile") {
      return Response.json({ ok: true, result: await compileKnowledgeToWiki(body) });
    }
    if (action === "status") {
      return Response.json({ ok: true, status: await getCompiledKnowledgeStatus(body) });
    }
    if (action === "graph-overview") {
      return Response.json({ ok: true, overview: await getCompiledKnowledgeGraphOverview(body) });
    }
    if (action === "graph") {
      return Response.json({ ok: true, graph: await buildCompiledKnowledgeGraph(body) });
    }
    if (action === "get-node") {
      if (!body.slug?.trim()) return Response.json({ ok: false, error: "Missing node slug." }, { status: 400 });
      return Response.json({ ok: true, ...(await getCompiledKnowledgeNode({ ...body, slug: body.slug })) });
    }
    if (action === "get-backlinks") {
      if (!body.slug?.trim()) return Response.json({ ok: false, error: "Missing node slug." }, { status: 400 });
      return Response.json({ ok: true, ...(await getCompiledKnowledgeBacklinks({ ...body, slug: body.slug })) });
    }
    if (action === "search") {
      if (!body.query?.trim()) return Response.json({ ok: false, error: "Missing search query." }, { status: 400 });
      return Response.json({ ok: true, search: await searchCompiledKnowledge({ ...body, query: body.query }) });
    }
    if (action === "scan-health") {
      return Response.json({ ok: true, health: await scanCompiledKnowledgeHealth(body) });
    }
    if (action === "fix-health") {
      if (!body.issueId?.trim()) return Response.json({ ok: false, error: "Missing issue id." }, { status: 400 });
      return Response.json({ ok: true, result: await fixCompiledKnowledgeIssue({ ...body, issueId: body.issueId }) });
    }
    if (action === "dismiss-health") {
      if (!body.issueId?.trim()) return Response.json({ ok: false, error: "Missing issue id." }, { status: 400 });
      return Response.json({ ok: true, result: await dismissCompiledKnowledgeIssue({ ...body, issueId: body.issueId, reason: body.reason }) });
    }
    if (action === "shared-contract") {
      return Response.json({ ok: true, policy: resolveSharedContributionPolicy(body) });
    }
    return Response.json({ ok: false, error: "Unsupported knowledge action." }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Knowledge request failed." }, { status: 400 });
  }
}
