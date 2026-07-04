import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { getCompany } from "@/lib/services/companies-store";
import { explainBlockedIssue, type IssueExplainerReceipt } from "@/lib/services/queen-bee/issue-explainer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guard:allow-hive-action-route - read-only issue explainer: turns a blocked
// company task's own result + eval receipts into a plain-language, actionable
// explanation via one tool-less LLM completion. No mutation, no spend, no fleet
// tools, no side effects — POST only because it takes the task context as a body.

function asReceipts(value: unknown): IssueExplainerReceipt[] {
  if (!Array.isArray(value)) return [];
  const receipts: IssueExplainerReceipt[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    receipts.push({
      status: typeof record.status === "string" ? record.status : undefined,
      summary: typeof record.summary === "string" ? record.summary : undefined,
      evidence: Array.isArray(record.evidence)
        ? record.evidence.map((item) => String(item ?? "")).filter(Boolean)
        : [],
    });
  }
  return receipts;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Company id is required." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "A JSON body is required." }, { status: 400 });

  const taskTitle = typeof body.taskTitle === "string" ? body.taskTitle.trim() : "";
  if (!taskTitle) return NextResponse.json({ ok: false, error: "taskTitle is required." }, { status: 400 });

  // The company record is the authoritative source for name + apex goal; the
  // client-sent copies are the fallback when the company store hasn't synced.
  const company = await getCompany(companyId).catch(() => null);
  const apex = company?.apexGoal as { title?: string; metric?: string; target?: string; current?: string } | undefined;
  const metricLine = apex?.metric
    ? `${apex.metric}${apex.target ? ` → target ${apex.target}` : ""}${apex.current ? ` (current ${apex.current})` : ""}`
    : typeof body.metric === "string"
      ? body.metric.trim()
      : "";

  try {
    const explanation = await explainBlockedIssue({
      taskTitle,
      companyName: company?.name || (typeof body.companyName === "string" ? body.companyName.trim() : ""),
      apexGoal: apex?.title || (typeof body.apexGoal === "string" ? body.apexGoal.trim() : ""),
      metric: metricLine,
      result: typeof body.result === "string" ? body.result : "",
      receipts: asReceipts(body.receipts),
    });
    return NextResponse.json({ ok: true, explanation });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to explain this issue." },
      { status: 400 },
    );
  }
}
