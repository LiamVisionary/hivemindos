import { NextRequest, NextResponse } from "next/server";
import { codeIntelligenceService } from "@/lib/services/code-intelligence/service";
import { mergeCrossServiceRoutes } from "@/lib/services/code-intelligence/cross-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single route, action-discriminated (mirrors /api/brain/knowledge). All repo
// paths are workspace-validated inside the service; provider JSON is treated as
// untrusted and normalized before it reaches here.
type CodeIntelAction =
  | "status"
  | "index-repository"
  | "search-graph"
  | "trace-path"
  | "detect-changes"
  | "get-architecture"
  | "get-code-snippet";

const ACTIONS = new Set<CodeIntelAction>([
  "status",
  "index-repository",
  "search-graph",
  "trace-path",
  "detect-changes",
  "get-architecture",
  "get-code-snippet",
]);

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function fetchConnectedApps(request: NextRequest): Promise<unknown> {
  const url = new URL("/api/fleet/apps", request.url);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7_000) }).catch(() => null);
  if (!response?.ok) return undefined;
  const payload = (await response.json().catch(() => null)) as { apps?: unknown } | null;
  return payload?.apps;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = str(body.action) as CodeIntelAction | undefined;
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: `Unknown or missing action. Use one of: ${[...ACTIONS].join(", ")}.` }, { status: 400 });
  }

  const service = codeIntelligenceService();
  const repoPath = str(body.repoPath);

  try {
    switch (action) {
      case "status": {
        const result = await service.status(repoPath);
        return NextResponse.json({ ok: true, ...result });
      }
      case "index-repository": {
        const mode = str(body.mode);
        const result = await service.indexRepository(repoPath, {
          mode: mode === "moderate" || mode === "fast" ? mode : "full",
          persistence: body.persistence === true,
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case "search-graph": {
        const result = await service.searchGraph(repoPath, {
          query: str(body.query),
          namePattern: str(body.namePattern),
          label: str(body.label),
          filePattern: str(body.filePattern),
          limit: num(body.limit),
          offset: num(body.offset),
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case "trace-path": {
        const functionName = str(body.functionName) ?? str(body.qualifiedName);
        if (!functionName) {
          return NextResponse.json({ ok: false, error: "trace-path requires functionName." }, { status: 400 });
        }
        const direction = str(body.direction);
        const result = await service.tracePath(repoPath, {
          functionName,
          direction: direction === "inbound" || direction === "outbound" ? direction : "both",
          depth: num(body.depth),
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case "detect-changes": {
        const scope = str(body.scope);
        const result = await service.detectChanges(repoPath, {
          baseRef: str(body.baseRef),
          since: str(body.since),
          scope: scope === "files" || scope === "impact" ? scope : "symbols",
          depth: num(body.depth),
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case "get-architecture": {
        const result = await service.getArchitecture(repoPath, {
          path: str(body.path),
          aspects: Array.isArray(body.aspects) ? body.aspects.filter((value): value is string => typeof value === "string") : undefined,
        });
        const apps = await fetchConnectedApps(request);
        const routes = mergeCrossServiceRoutes(result.routes, apps);
        return NextResponse.json({ ok: true, ...result, routes });
      }
      case "get-code-snippet": {
        const result = await service.getCodeSnippet(repoPath, {
          qualifiedName: str(body.qualifiedName),
          filePath: str(body.filePath),
          startLine: num(body.startLine),
          endLine: num(body.endLine),
          includeNeighbors: body.includeNeighbors === true,
        });
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Code-intelligence request failed.";
    // Workspace-escape and bad-input errors are caller faults (400); everything
    // else is a 500 the caller can retry or report.
    const status = /outside the allowed|requires|Invalid/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
