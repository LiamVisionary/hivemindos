import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { readCompanies } from "@/lib/services/companies-store";
import {
  readCompanyEmailThreads,
  readCompanyEmailThreadDetail,
  type CompanyEmailThread,
} from "@/lib/services/agent-mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-company and overall caps so the aggregate stays bounded even with many
// companies (each company's read fans out over live mail providers).
const PER_COMPANY_LIMIT = 60;
const TOTAL_LIMIT = 200;
const PER_AGENT_LIMIT = 60;

/** A thread tagged with the company it belongs to, so a single mobile inbox
 *  can show cross-company mail without N per-company round-trips. */
type AggregatedThread = CompanyEmailThread & { companyId: string; companyName: string };

/**
 * Aggregate inbox — the phone's ONE authenticated feed of every company crew's
 * email threads, merged newest-first. Wraps the same per-company reader the
 * "Emails" cockpit tab uses (readCompanyEmailThreads) so there's one source of
 * truth. Read-only; reply/send live on the sibling draft/send routes.
 *
 * `?threadId=` returns one thread's full body/links/attachments — the provider
 * is encoded in the id, so no company id is needed for detail.
 *
 * `?agentId=` returns one agent's threads/mailboxes only (the chat route's
 * agent-asset popover). Both live inbox readers scope by agent id, and the
 * company-outbox reader no-ops without a company id, so no post-filtering is
 * needed.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const threadId = request.nextUrl.searchParams.get("threadId");
  if (threadId) {
    try {
      const detail = await readCompanyEmailThreadDetail({ threadId });
      return NextResponse.json({ ok: true, ...detail });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Failed to load the email." },
        { status: 400 },
      );
    }
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim();
  if (agentId) {
    try {
      const result = await readCompanyEmailThreads({
        agentIds: [agentId],
        companyId: "",
        totalLimit: PER_AGENT_LIMIT,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Failed to load the agent's mail." },
        { status: 400 },
      );
    }
  }

  try {
    const companies = await readCompanies();
    const perCompany = await Promise.all(
      companies.map(async (company) => {
        try {
          const result = await readCompanyEmailThreads({
            agentIds: company.agentIds ?? [],
            companyId: company.id,
            projectId: company.projectId,
            totalLimit: PER_COMPANY_LIMIT,
          });
          return { company, result };
        } catch {
          // A single company's provider failure must not blank the whole feed.
          return null;
        }
      }),
    );

    // Merge + dedupe by the provider-stable thread id (the same Cloudflare
    // account store can surface under more than one company).
    const byId = new Map<string, AggregatedThread>();
    let anyConnected = false;
    const companySummaries: { id: string; name: string; threadCount: number }[] = [];
    for (const entry of perCompany) {
      if (!entry) continue;
      anyConnected ||= entry.result.configured;
      let count = 0;
      for (const thread of entry.result.threads) {
        if (byId.has(thread.id)) continue;
        byId.set(thread.id, {
          ...thread,
          companyId: entry.company.id,
          companyName: entry.company.name,
        });
        count += 1;
      }
      companySummaries.push({ id: entry.company.id, name: entry.company.name, threadCount: count });
    }

    const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const truncated = merged.length > TOTAL_LIMIT;

    return NextResponse.json({
      ok: true,
      configured: anyConnected,
      threads: merged.slice(0, TOTAL_LIMIT),
      companies: companySummaries,
      truncated,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load the inbox." },
      { status: 400 },
    );
  }
}
