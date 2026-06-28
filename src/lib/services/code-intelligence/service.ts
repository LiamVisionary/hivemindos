// HivemindOS code-intelligence service.
//
// The product surface (context index, Hive actions, dashboard, MCP) calls THIS,
// never the third-party binary directly. It owns: workspace validation, picking
// the active provider (codebase-memory engine when installed+indexed, else the
// built-in live-scan fallback), stamping provenance meta on every result, and
// the cross-cutting diff-impact enrichment (call-graph fan-out + risk + tests).

import { CodebaseMemoryProvider } from "./codebase-memory-provider";
import { FallbackProvider } from "./fallback-provider";
import { repoRefFor } from "./provider";
import type {
  ArchitectureInput,
  CodeSnippetInput,
  DetectChangesInput,
  IndexRepositoryInput,
  SearchGraphInput,
  TracePathInput,
} from "./provider";
import type {
  ArchitectureResult,
  CodeGraphNode,
  CodeIntelCapability,
  CodeIntelMeta,
  CodeIntelProviderId,
  CodeIntelRepoRef,
  CodeIntelRiskLevel,
  CodeIntelStatus,
  CodeSnippetResult,
  DetectChangesResult,
  IndexRepositoryResult,
  ProviderStatusInfo,
  SearchGraphResult,
  TracePathResult,
  WithMeta,
} from "./types";

const CONFIDENCE: Record<CodeIntelProviderId, number> = { "codebase-memory": 0.9, fallback: 0.4 };
const STATUS_CACHE_TTL_MS = 30_000;
const ENGINE_NOT_INDEXED_HINT =
  "The codebase-memory engine is installed but this repo is not indexed yet — call code_index_repository for full graph intelligence; answering from the live-scan fallback for now.";

type StatusCacheEntry = { info: ProviderStatusInfo; at: number };

export class CodeIntelligenceService {
  private readonly codebaseMemory = new CodebaseMemoryProvider();
  private readonly fallback = new FallbackProvider();
  private readonly statusCache = new Map<string, StatusCacheEntry>();

  /** Resolve + workspace-validate a requested repo path into a canonical ref. */
  resolveRef(repoPathInput?: string): CodeIntelRepoRef {
    return repoRefFor(repoPathInput);
  }

  private async engineStatus(ref: CodeIntelRepoRef): Promise<ProviderStatusInfo> {
    const cached = this.statusCache.get(ref.project);
    if (cached && Date.now() - cached.at < STATUS_CACHE_TTL_MS) return cached.info;
    const info = await this.codebaseMemory.detectStatus(ref).catch(
      (): ProviderStatusInfo => ({ availability: "unhealthy", detail: "status probe threw" }),
    );
    this.statusCache.set(ref.project, { info, at: Date.now() });
    return info;
  }

  private stamp<T>(payload: T, ref: CodeIntelRepoRef, provider: CodeIntelProviderId, confidence = CONFIDENCE[provider]): WithMeta<T> {
    const meta: CodeIntelMeta = {
      project: ref.project,
      repoPath: ref.repoPath,
      provider,
      confidence,
      generatedAt: new Date().toISOString(),
    };
    return { ...payload, meta };
  }

  async status(repoPathInput?: string): Promise<WithMeta<CodeIntelStatus>> {
    const ref = this.resolveRef(repoPathInput);
    const [engine, fallback] = await Promise.all([
      this.engineStatus(ref),
      this.fallback.detectStatus(ref),
    ]);
    const graphReady = engine.availability === "available" && engine.indexed === true;
    const activeProvider: CodeIntelProviderId = graphReady ? "codebase-memory" : "fallback";
    const capabilities: CodeIntelCapability[] = graphReady
      ? ["search-graph", "trace-path", "detect-changes", "get-architecture", "get-code-snippet", "index-repository"]
      : ["search-graph", "get-architecture", "get-code-snippet", "detect-changes"];
    const status: CodeIntelStatus = {
      provider: "codebase-memory",
      activeProvider,
      providers: { "codebase-memory": engine, fallback },
      graphReady,
      capabilities,
    };
    return this.stamp(status, ref, activeProvider, 1);
  }

  /** Use the engine when installed+indexed; otherwise the fallback (with hint). */
  private async useEngine(ref: CodeIntelRepoRef): Promise<boolean> {
    const engine = await this.engineStatus(ref);
    return engine.availability === "available" && engine.indexed === true;
  }

  private engineInstalledButUnindexed(info: ProviderStatusInfo): boolean {
    return info.availability === "available" && info.indexed !== true;
  }

  async indexRepository(repoPathInput: string | undefined, opts: Omit<IndexRepositoryInput, keyof CodeIntelRepoRef> = {}): Promise<WithMeta<IndexRepositoryResult>> {
    const ref = this.resolveRef(repoPathInput);
    const engine = await this.engineStatus(ref);
    if (engine.availability !== "available") {
      return this.stamp(
        { status: "noop" as const, detail: "codebase-memory engine is not installed; install it to build a persistent code graph." },
        ref,
        "fallback",
      );
    }
    const result = await this.codebaseMemory.indexRepository({ ...ref, ...opts });
    this.statusCache.delete(ref.project); // force a fresh indexed-state probe next call
    return this.stamp(result, ref, "codebase-memory", 1);
  }

  async searchGraph(repoPathInput: string | undefined, opts: Omit<SearchGraphInput, keyof CodeIntelRepoRef>): Promise<WithMeta<SearchGraphResult>> {
    const ref = this.resolveRef(repoPathInput);
    if (await this.useEngine(ref)) {
      try {
        return this.stamp(await this.codebaseMemory.searchGraph({ ...ref, ...opts }), ref, "codebase-memory", 0.85);
      } catch {
        // fall through to fallback below
      }
    }
    const result = await this.fallback.searchGraph({ ...ref, ...opts });
    return this.stamp(this.maybeUnindexedHint(result, ref), ref, "fallback");
  }

  async tracePath(repoPathInput: string | undefined, opts: Omit<TracePathInput, keyof CodeIntelRepoRef>): Promise<WithMeta<TracePathResult>> {
    const ref = this.resolveRef(repoPathInput);
    if (await this.useEngine(ref)) {
      try {
        return this.stamp(await this.codebaseMemory.tracePath({ ...ref, ...opts }), ref, "codebase-memory");
      } catch {
        // fall through
      }
    }
    return this.stamp(await this.fallback.tracePath({ ...ref, ...opts }), ref, "fallback");
  }

  async getArchitecture(repoPathInput: string | undefined, opts: Omit<ArchitectureInput, keyof CodeIntelRepoRef>): Promise<WithMeta<ArchitectureResult>> {
    const ref = this.resolveRef(repoPathInput);
    if (await this.useEngine(ref)) {
      try {
        return this.stamp(await this.codebaseMemory.getArchitecture({ ...ref, ...opts }), ref, "codebase-memory");
      } catch {
        // fall through
      }
    }
    const result = await this.fallback.getArchitecture({ ...ref, ...opts });
    return this.stamp(this.maybeUnindexedHint(result, ref), ref, "fallback");
  }

  async getCodeSnippet(repoPathInput: string | undefined, opts: Omit<CodeSnippetInput, keyof CodeIntelRepoRef>): Promise<WithMeta<CodeSnippetResult>> {
    const ref = this.resolveRef(repoPathInput);
    if (await this.useEngine(ref) && opts.qualifiedName) {
      try {
        return this.stamp(await this.codebaseMemory.getCodeSnippet({ ...ref, ...opts }), ref, "codebase-memory");
      } catch {
        // fall through
      }
    }
    return this.stamp(await this.fallback.getCodeSnippet({ ...ref, ...opts }), ref, "fallback");
  }

  async detectChanges(repoPathInput: string | undefined, opts: Omit<DetectChangesInput, keyof CodeIntelRepoRef>): Promise<WithMeta<DetectChangesResult>> {
    const ref = this.resolveRef(repoPathInput);
    const onEngine = await this.useEngine(ref);
    let base: DetectChangesResult;
    let provider: CodeIntelProviderId = "fallback";
    if (onEngine) {
      try {
        base = await this.codebaseMemory.detectChanges({ ...ref, ...opts });
        provider = "codebase-memory";
      } catch {
        base = await this.fallback.detectChanges({ ...ref, ...opts });
      }
    } else {
      base = await this.fallback.detectChanges({ ...ref, ...opts });
    }

    // Enrich inbound callers / outbound dependencies via call-graph fan-out
    // (engine only); compute tests + risk uniformly across providers.
    if (provider === "codebase-memory") {
      const enriched = await this.enrichImpact(ref, base);
      base.inboundCallers = enriched.inbound;
      base.outboundDependencies = enriched.outbound;
    }
    base.testsLikelyRelevant = this.collectTests(base);
    const { risk, reasons } = classifyRisk(base);
    base.risk = risk;
    base.riskReasons = reasons;
    return this.stamp(base, ref, provider);
  }

  private async enrichImpact(ref: CodeIntelRepoRef, base: DetectChangesResult): Promise<{ inbound: CodeGraphNode[]; outbound: CodeGraphNode[] }> {
    const seedNames = [...new Set(base.affectedSymbols.map((symbol) => symbol.qualifiedName ?? symbol.name))].slice(0, 8);
    const inbound = new Map<string, CodeGraphNode>();
    const outbound = new Map<string, CodeGraphNode>();
    for (const name of seedNames) {
      const trace = await this.codebaseMemory.tracePath({ ...ref, functionName: name, direction: "both", depth: 2 }).catch(() => null);
      if (!trace) continue;
      for (const node of trace.callers) inbound.set(node.id, node);
      for (const node of trace.callees) outbound.set(node.id, node);
    }
    return { inbound: [...inbound.values()].slice(0, 100), outbound: [...outbound.values()].slice(0, 100) };
  }

  private collectTests(base: DetectChangesResult): DetectChangesResult["testsLikelyRelevant"] {
    const tests = new Set<string>(base.testsLikelyRelevant);
    for (const file of base.touchedFiles) {
      const normalized = file.replaceAll("\\", "/");
      if (/\.(test|spec)\./.test(normalized) || /(^|\/)tests?\//.test(normalized) || /scripts\/test-/.test(normalized)) {
        tests.add(file);
      }
    }
    return [...tests];
  }

  private maybeUnindexedHint<T extends { hint?: string }>(result: T, ref: CodeIntelRepoRef): T {
    const cached = this.statusCache.get(ref.project);
    if (cached && this.engineInstalledButUnindexed(cached.info)) {
      return { ...result, hint: [ENGINE_NOT_INDEXED_HINT, result.hint].filter(Boolean).join(" ") };
    }
    return result;
  }
}

const CRITICAL_PATH_RE = /(auth|wallet|payment|credential|secret|signing|private[-_]?key|\/keys?\/|token)/i;
const SHARED_LIB_RE = /^src\/lib\/services\//;

function classifyRisk(base: DetectChangesResult): { risk: CodeIntelRiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  const files = base.touchedFiles.map((file) => file.replaceAll("\\", "/"));
  let level: CodeIntelRiskLevel = "low";
  const bump = (next: CodeIntelRiskLevel, reason: string) => {
    reasons.push(reason);
    if (rank(next) > rank(level)) level = next;
  };

  if (files.some((file) => CRITICAL_PATH_RE.test(file))) bump("critical", "touches an auth / wallet / credential / signing surface");
  if (base.affectedRoutes.length >= 3) bump("high", `${base.affectedRoutes.length} API routes affected`);
  if (base.inboundCallers.length >= 20) bump("high", `${base.inboundCallers.length} inbound callers (wide blast radius)`);
  if (files.length >= 25) bump("high", `${files.length} files changed`);
  if (files.some((file) => SHARED_LIB_RE.test(file)) && base.inboundCallers.length >= 8) bump("high", "changes a shared service with many callers");
  if (base.affectedRoutes.length >= 1) bump("medium", `${base.affectedRoutes.length} API route(s) affected`);
  if (files.some((file) => SHARED_LIB_RE.test(file))) bump("medium", "changes shared src/lib/services code");
  if (files.length >= 8) bump("medium", `${files.length} files changed`);
  if (reasons.length === 0) reasons.push("localized change with no detected API/shared-surface impact");
  return { risk: level, reasons };
}

function rank(level: CodeIntelRiskLevel): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[level];
}

let singleton: CodeIntelligenceService | null = null;

export function codeIntelligenceService(): CodeIntelligenceService {
  if (!singleton) singleton = new CodeIntelligenceService();
  return singleton;
}
