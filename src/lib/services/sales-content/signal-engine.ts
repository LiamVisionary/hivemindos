import { untrustedInlineBlock } from "@/lib/services/security/untrusted-context";
import type { Company } from "@/lib/types/company";
import type {
  SalesContentAction,
  SalesContentDerivedInputs,
  SalesContentEvent,
  SalesContentEventKind,
  SalesContentMailThread,
  SalesContentSignal,
  SalesContentSignalKind,
  SalesContentSourceId,
} from "@/lib/services/sales-content/types";

const OBJECTION_RE = /\b(expensive|price|pricing|budget|cost|too much|can't afford|cannot afford|discount|cheaper|quote)\b/i;

function iso(input?: Date): string {
  return (input ?? new Date()).toISOString();
}

function stableEventId(parts: readonly string[]): string {
  return parts
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function textOfThread(thread: SalesContentMailThread): string {
  return [thread.subject, thread.preview, thread.body].filter(Boolean).join("\n");
}

function threadLeadLabel(thread: SalesContentMailThread): string {
  return thread.correspondents?.find((entry) => entry.trim())?.trim() || thread.subject || thread.threadId || thread.id;
}

function eventFromThread(companyId: string, thread: SalesContentMailThread, now: Date): SalesContentEvent {
  const sent = thread.sentAt ? new Date(thread.sentAt) : undefined;
  const updated = thread.updatedAt ? new Date(thread.updatedAt) : now;
  const sourceId = thread.provider as SalesContentSourceId;
  const base = {
    companyId,
    sourceId,
    occurredAt: Number.isFinite(sent?.getTime()) ? sent!.toISOString() : Number.isFinite(updated.getTime()) ? updated.toISOString() : iso(now),
    confidence: thread.provider === "maps-agency-outbox" ? 0.95 : 0.82,
    entity: { type: "thread" as const, id: thread.threadId || thread.id, label: threadLeadLabel(thread) },
    evidence: [
      `${thread.providerLabel}: ${thread.subject || "Untitled thread"}`,
      `${thread.direction} thread`,
      ...(thread.labels ?? []).slice(0, 3).map((label) => `label: ${label}`),
    ],
    payload: {
      threadId: thread.threadId,
      provider: thread.provider,
      subject: thread.subject,
      direction: thread.direction,
      links: thread.links?.map((link) => link.url).filter(Boolean).slice(0, 8),
    },
  };

  if (thread.direction === "queued") {
    return {
      ...base,
      id: stableEventId([companyId, "mail-thread-queued", thread.provider, thread.threadId || thread.id]),
      kind: "mail.thread_queued",
      title: "Queued outreach waiting on a blocker",
      summary: thread.preview || "A sales/content touch is queued but not delivered yet.",
    };
  }

  if (thread.direction === "inbound" || thread.direction === "mixed") {
    return {
      ...base,
      id: stableEventId([companyId, "mail-reply", thread.provider, thread.threadId || thread.id]),
      kind: "mail.reply_received",
      title: "Reply received",
      summary: thread.preview || thread.subject || "A lead replied to the company.",
      confidence: 0.88,
    };
  }

  return {
    ...base,
    id: stableEventId([companyId, "mail-sent", thread.provider, thread.threadId || thread.id]),
    kind: "mail.thread_sent",
    title: "Outreach sent",
    summary: thread.preview || thread.subject || "The company sent an outreach touch.",
  };
}

function companySignals(company: Company, now: Date): SalesContentEvent[] {
  const events: SalesContentEvent[] = [];
  const products = company.products?.items ?? [];
  const companyEvidence = [
    company.apexGoal?.title ? `apex: ${company.apexGoal.title}` : "",
    company.products ? `${products.length} catalog item(s)` : "no product catalog",
  ].filter(Boolean);

  if (products.length > 0) {
    events.push({
      id: stableEventId([company.id, "company-product-catalog-ready"]),
      companyId: company.id,
      sourceId: "company-profile",
      kind: "company.product_catalog_ready",
      occurredAt: company.products?.updatedAt || company.updatedAt || iso(now),
      title: "Product catalog ready",
      summary: products.map((item) => `${item.name} $${item.amountUsd.toLocaleString("en-US")}`).join("; "),
      confidence: 1,
      entity: { type: "company", id: company.id, label: company.name },
      evidence: companyEvidence,
      payload: { productCount: products.length },
    });
  } else {
    const salesy = /\b(sales|revenue|outreach|agency|lead|leads|customer|deal|pipeline|book|booking|client|marketing)\b/i.test(
      [company.name, company.sector, company.blurb, company.charter, company.apexGoal?.title, company.apexGoal?.metric].filter(Boolean).join(" "),
    );
    if (salesy) {
      events.push({
        id: stableEventId([company.id, "company-product-catalog-missing"]),
        companyId: company.id,
        sourceId: "company-profile",
        kind: "company.product_catalog_missing",
        occurredAt: company.updatedAt || iso(now),
        title: "Sales company has no product catalog",
        summary: "The crew can sell more coherently once offers, prices, and approval rules are explicit.",
        confidence: 0.76,
        entity: { type: "company", id: company.id, label: company.name },
        evidence: companyEvidence,
      });
    }
  }

  return events;
}

export function deriveSalesContentEvents(company: Company, input: SalesContentDerivedInputs = {}): SalesContentEvent[] {
  const now = input.now ?? new Date();
  const events: SalesContentEvent[] = [...companySignals(company, now)];

  for (const thread of input.mail?.threads ?? []) {
    events.push(eventFromThread(company.id, thread, now));
    if (OBJECTION_RE.test(textOfThread(thread))) {
      events.push({
        id: stableEventId([company.id, "conversation-objection", thread.provider, thread.threadId || thread.id]),
        companyId: company.id,
        sourceId: thread.provider as SalesContentSourceId,
        kind: "conversation.objection",
        occurredAt: new Date(thread.updatedAt || thread.sentAt || now).toISOString(),
        title: "Pricing or budget objection detected",
        summary: thread.preview || thread.subject || "A thread mentions price, budget, quote, or discount language.",
        confidence: 0.72,
        entity: { type: "thread", id: thread.threadId || thread.id, label: threadLeadLabel(thread) },
        evidence: [`subject: ${thread.subject || "untitled"}`, "matched pricing/budget language"],
        payload: { threadId: thread.threadId, provider: thread.provider },
      });
    }
  }

  if (input.analytics?.state === "live") {
    const summary = input.analytics.summary;
    if ((summary.conversions ?? 0) > 0 || (summary.revenueUsd ?? 0) > 0) {
      events.push({
        id: stableEventId([company.id, "analytics-conversion", input.analytics.provider, String(summary.rangeDays)]),
        companyId: company.id,
        sourceId: input.analytics.provider,
        kind: "analytics.conversion",
        occurredAt: iso(now),
        title: "Conversion signal",
        summary: `${summary.conversions ?? 0} conversion(s)${summary.revenueDisplay ? `, ${summary.revenueDisplay}` : ""} in ${summary.rangeDays} day(s).`,
        confidence: 0.86,
        entity: { type: "source", id: input.analytics.provider, label: input.analytics.providerLabel },
        evidence: [`provider: ${input.analytics.providerLabel}`, `range: ${summary.rangeDays} days`],
        payload: { conversions: summary.conversions, revenueUsd: summary.revenueUsd, rangeDays: summary.rangeDays },
      });
    }
    for (const source of (summary.topSources ?? []).slice(0, 3)) {
      if (source.count <= 0) continue;
      events.push({
        id: stableEventId([company.id, "analytics-source", input.analytics.provider, source.name]),
        companyId: company.id,
        sourceId: input.analytics.provider,
        kind: "analytics.traffic_signal",
        occurredAt: iso(now),
        title: "Traffic source is working",
        summary: `${source.name} drove ${source.count.toLocaleString("en-US")} visit(s).`,
        confidence: 0.68,
        entity: { type: "source", id: source.name, label: source.name },
        evidence: [`provider: ${input.analytics.providerLabel}`, `${source.count} visit(s)`],
      });
    }
  } else if (input.analytics?.state === "unconfigured") {
    events.push({
      id: stableEventId([company.id, "analytics-unconfigured"]),
      companyId: company.id,
      sourceId: "hivemind-funnel",
      kind: "analytics.unconfigured",
      occurredAt: iso(now),
      title: "Analytics source not selected",
      summary: "The machine can still read company metrics, but no external conversion source is selected.",
      confidence: 0.8,
      entity: { type: "company", id: company.id, label: company.name },
      evidence: ["analytics state: unconfigured"],
    });
  }

  return dedupeEvents(events);
}

export function dedupeEvents(events: readonly SalesContentEvent[]): SalesContentEvent[] {
  const byId = new Map<string, SalesContentEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (!existing || event.occurredAt > existing.occurredAt) byId.set(event.id, event);
  }
  return [...byId.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function signalId(companyId: string, kind: SalesContentSignalKind, key: string): string {
  return stableEventId([companyId, "signal", kind, key]);
}

function eventScore(event: SalesContentEvent): number {
  const base: Record<SalesContentEventKind, number> = {
    "company.product_catalog_ready": 35,
    "company.product_catalog_missing": 62,
    "mail.thread_sent": 52,
    "mail.thread_queued": 74,
    "mail.reply_received": 82,
    "analytics.conversion": 76,
    "analytics.traffic_signal": 58,
    "analytics.unconfigured": 42,
    "crm.deal_stalled": 86,
    "conversation.objection": 84,
    "creative.asset_ready": 56,
    "social.topic_signal": 58,
    "work.deliverable_ready": 60,
  };
  return clampScore((base[event.kind] ?? 40) * event.confidence);
}

export function scoreSalesContentSignals(company: Company, events: readonly SalesContentEvent[]): SalesContentSignal[] {
  const signals: SalesContentSignal[] = [];

  const byKind = new Map<SalesContentEventKind, SalesContentEvent[]>();
  for (const event of events) {
    const list = byKind.get(event.kind) ?? [];
    list.push(event);
    byKind.set(event.kind, list);
  }

  for (const event of byKind.get("mail.reply_received") ?? []) {
    signals.push({
      id: signalId(company.id, "respond-to-reply", event.entity.id ?? event.id),
      companyId: company.id,
      kind: "respond-to-reply",
      title: "Reply needs a sales response",
      summary: event.summary,
      score: eventScore(event),
      confidence: event.confidence,
      sourceEventIds: [event.id],
      evidence: event.evidence,
      suggestedRole: "Growth",
      approvalRequired: true,
    });
  }

  const queued = byKind.get("mail.thread_queued") ?? [];
  if (queued.length) {
    signals.push({
      id: signalId(company.id, "unblock-queued-outreach", "queued-outreach"),
      companyId: company.id,
      kind: "unblock-queued-outreach",
      title: "Queued outreach is blocked",
      summary: `${queued.length} outreach thread${queued.length === 1 ? "" : "s"} queued instead of sent.`,
      score: clampScore(70 + queued.length * 4),
      confidence: Math.max(...queued.map((event) => event.confidence)),
      sourceEventIds: queued.slice(0, 8).map((event) => event.id),
      evidence: queued.slice(0, 4).flatMap((event) => event.evidence.slice(0, 2)),
      suggestedRole: "Growth",
      approvalRequired: true,
    });
  }

  const objections = byKind.get("conversation.objection") ?? [];
  if (objections.length) {
    signals.push({
      id: signalId(company.id, "review-pricing-evidence", "pricing-objections"),
      companyId: company.id,
      kind: "review-pricing-evidence",
      title: "Pricing evidence should be reviewed",
      summary: `${objections.length} thread${objections.length === 1 ? "" : "s"} mention price, budget, quotes, or discounts.`,
      score: clampScore(72 + objections.length * 5),
      confidence: Math.max(...objections.map((event) => event.confidence)),
      sourceEventIds: objections.slice(0, 8).map((event) => event.id),
      evidence: objections.slice(0, 4).flatMap((event) => event.evidence.slice(0, 2)),
      suggestedRole: "Product",
      approvalRequired: false,
    });
  }

  const catalogMissing = byKind.get("company.product_catalog_missing") ?? [];
  if (catalogMissing.length) {
    const event = catalogMissing[0];
    signals.push({
      id: signalId(company.id, "wire-source", "missing-catalog"),
      companyId: company.id,
      kind: "wire-source",
      title: "Offer catalog needs a source of truth",
      summary: event.summary,
      score: eventScore(event),
      confidence: event.confidence,
      sourceEventIds: [event.id],
      evidence: event.evidence,
      suggestedRole: "Product",
      approvalRequired: false,
    });
  }

  const conversions = byKind.get("analytics.conversion") ?? [];
  const sent = byKind.get("mail.thread_sent") ?? [];
  if (conversions.length && sent.length) {
    signals.push({
      id: signalId(company.id, "produce-case-study", "sent-plus-conversion"),
      companyId: company.id,
      kind: "produce-case-study",
      title: "Turn working outreach into proof",
      summary: "Outreach and conversion signals both exist, so the crew can package proof for follow-up and ads.",
      score: clampScore(74 + conversions.length * 3),
      confidence: Math.min(0.9, Math.max(...conversions.map((event) => event.confidence))),
      sourceEventIds: [...conversions.slice(0, 4), ...sent.slice(0, 4)].map((event) => event.id),
      evidence: [...conversions, ...sent].slice(0, 4).flatMap((event) => event.evidence.slice(0, 2)),
      suggestedRole: "Growth",
      approvalRequired: false,
    });
  }

  const trafficSignals = byKind.get("analytics.traffic_signal") ?? [];
  if (trafficSignals.length) {
    signals.push({
      id: signalId(company.id, "produce-ad-creative", "traffic-source"),
      companyId: company.id,
      kind: "produce-ad-creative",
      title: "Produce creative for the working channel",
      summary: trafficSignals[0].summary,
      score: clampScore(58 + trafficSignals.length * 4),
      confidence: Math.max(...trafficSignals.map((event) => event.confidence)),
      sourceEventIds: trafficSignals.slice(0, 4).map((event) => event.id),
      evidence: trafficSignals.slice(0, 4).flatMap((event) => event.evidence.slice(0, 2)),
      suggestedRole: "Designer",
      approvalRequired: false,
    });
  }

  return signals.sort((left, right) => right.score - left.score || right.confidence - left.confidence);
}

function priorityFor(score: number): SalesContentAction["priority"] {
  if (score >= 76) return "high";
  if (score >= 55) return "medium";
  return "low";
}

export function planSalesContentActions(company: Company, signals: readonly SalesContentSignal[]): SalesContentAction[] {
  return signals.slice(0, 8).map((signal): SalesContentAction => {
    const base = {
      id: stableEventId([company.id, "action", signal.kind, signal.id]),
      companyId: company.id,
      role: signal.suggestedRole,
      priority: priorityFor(signal.score),
      sourceSignalIds: [signal.id],
      approvalRequired: signal.approvalRequired,
    };
    // signal.summary can be prospect-controlled (an inbound reply's preview/subject)
    // or other external content, so it is fenced as untrusted source data before it
    // reaches a worker prompt — it must never be able to steer the agent's actions.
    const untrustedSummary = untrustedInlineBlock("external sales/content content", signal.summary);
    if (signal.kind === "respond-to-reply") {
      return {
        ...base,
        kind: "draft-reply",
        title: "Draft reply for hot thread",
        body: "Read the reply, draft a concrete response, and park it for approval before sending.",
        skills: ["company-goal", "sales", "outreach"],
        workBoardPrompt: `Draft a response for this sales/content reply. Use the company's products and approval policy. Do not send it; end with ACTION NEEDED and include the draft.\n\nSignal:\n${untrustedSummary}`,
      };
    }
    if (signal.kind === "unblock-queued-outreach") {
      return {
        ...base,
        kind: "draft-follow-up",
        title: "Unblock queued outreach",
        body: "Find why queued touches did not send, fix the draft/package if needed, and request approval or credentials.",
        skills: ["company-goal", "outreach", "ops"],
        workBoardPrompt: `Inspect queued outreach and unblock it. If credentials or approval are missing, end with ACTION NEEDED and exact NEEDS lines.\n\nSignal:\n${untrustedSummary}`,
      };
    }
    if (signal.kind === "review-pricing-evidence") {
      return {
        ...base,
        kind: "pricing-review",
        title: "Review pricing evidence",
        body: "Separate true price objections from broken links, weak pitches, or bad targeting. Raise a pricing proposal only with concrete evidence.",
        skills: ["company-goal", "sales", "product"],
        workBoardPrompt: `Review pricing evidence for this company. If price is truly blocking conversion, end with PRICING PROPOSAL and WHY. Do not change prices yourself.\n\nSignal:\n${untrustedSummary}`,
      };
    }
    if (signal.kind === "produce-case-study") {
      return {
        ...base,
        kind: "case-study",
        title: "Package proof from working outreach",
        body: "Turn sent outreach and conversion evidence into a reusable proof asset for follow-ups, landing pages, and ads.",
        skills: ["company-goal", "content", "sales"],
        workBoardPrompt: `Create a concise proof asset from the working outreach/conversion signals. Record customer-facing URLs under Deliverables when applicable.\n\nSignal:\n${untrustedSummary}`,
      };
    }
    if (signal.kind === "produce-ad-creative") {
      return {
        ...base,
        kind: "creative-brief",
        title: "Generate channel-specific ad creative",
        body: "Use the working traffic source to brief hooks, visuals, and variants for the next creative batch.",
        skills: ["company-goal", "creative", "growth"],
        workBoardPrompt: `Produce a creative brief and first ad variant for the channel behind this signal. Keep assets tied to the company's offer and proof.\n\nSignal:\n${untrustedSummary}`,
      };
    }
    if (signal.kind === "publish-social-post") {
      return {
        ...base,
        kind: "social-draft",
        title: "Draft social post",
        body: "Draft a post from the signal and park write actions behind approval.",
        skills: ["company-goal", "content", "social"],
        workBoardPrompt: `Draft a social post from this signal. Do not publish it; end with ACTION NEEDED and include the draft.\n\nSignal:\n${untrustedSummary}`,
      };
    }
    return {
      ...base,
      kind: "source-setup",
      title: "Wire missing source",
      body: "Add or configure the missing source so the sales/content loop has a trustworthy signal.",
      skills: ["company-goal", "ops", "integrations"],
      workBoardPrompt: `Wire the missing sales/content source or produce the exact setup request. Do not paste or expose secret values.\n\nSignal:\n${untrustedSummary}`,
    };
  });
}

export function buildSalesContentDispatchContext(input: {
  signals: readonly SalesContentSignal[];
  actions: readonly SalesContentAction[];
  gaps?: readonly string[];
}): string {
  const lines: string[] = [];
  const signals = input.signals.slice(0, 5);
  const actions = input.actions.slice(0, 5);
  if (signals.length) {
    lines.push("Sales/content machine signals:");
    for (const signal of signals) {
      // signal.summary can be prospect/external content → fence it as untrusted.
      lines.push(`- ${signal.title} [score ${signal.score}]:`);
      lines.push(untrustedInlineBlock("external sales/content content", signal.summary));
    }
  }
  if (actions.length) {
    lines.push("Recommended next sales/content actions:");
    for (const action of actions) {
      lines.push(`- ${action.title} (${action.role}, ${action.priority}): ${action.body}`);
    }
  }
  const gaps = (input.gaps ?? []).slice(0, 3);
  if (gaps.length) {
    lines.push("Known sales/content source gaps:");
    for (const gap of gaps) lines.push(`- ${gap}`);
  }
  return lines.join("\n");
}
