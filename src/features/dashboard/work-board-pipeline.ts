/* work-board-pipeline.ts — conservative extraction of revenue-pipeline signals
 * from Work Board task text. The board has many dollar amounts, so totals are
 * accepted only when the task explicitly labels them as quoted/open pipeline,
 * approval-blocked pipeline, in-market pipeline, or recognized weekly revenue.
 */

export type WorkBoardPipelineTask = {
  id?: string;
  title?: string;
  body?: string | null;
  result?: string | null;
  status?: string | null;
  updatedAt?: number;
  completedAt?: number;
  loopReceipts?: Array<{ summary?: string | null; evidence?: unknown[] | null }> | null;
};

export type WorkBoardPipelineSummary = {
  quotedOpenUsd?: number;
  recognizedWeeklyRevenueUsd?: number;
  weeklyRevenueTargetUsd?: number;
  approvalBlockedUsd?: number;
  technicalBlockedUsd?: number;
  inMarketUsd?: number;
  sourceTaskId?: string;
  sourceTitle?: string;
  updatedAt?: number;
};

export type WorkBoardPipelineImpact = {
  amountUsd: number;
  label: string;
};

const MONEY = "\\$\\s*([0-9][0-9,]*(?:\\.\\d+)?)";

function toText(task: WorkBoardPipelineTask): string {
  const receiptText = (task.loopReceipts ?? [])
    .flatMap((receipt) => [
      receipt?.summary,
      ...(Array.isArray(receipt?.evidence) ? receipt.evidence.filter((item): item is string => typeof item === "string") : []),
    ])
    .filter(Boolean)
    .join("\n");
  return [task.title, task.body, task.result, receiptText].filter(Boolean).join("\n");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function moneyValue(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function matchMoney(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  return moneyValue(match?.[1]);
}

function matchMoneyGroup(text: string, pattern: RegExp, groupIndex: number): number | undefined {
  const match = text.match(pattern);
  return moneyValue(match?.[groupIndex]);
}

function assignSource(summary: WorkBoardPipelineSummary, task: WorkBoardPipelineTask) {
  if (summary.sourceTaskId) return;
  summary.sourceTaskId = task.id;
  summary.sourceTitle = task.title;
  summary.updatedAt = task.updatedAt ?? task.completedAt;
}

function parsePipelineCandidate(task: WorkBoardPipelineTask): WorkBoardPipelineSummary | null {
  const text = compactText(toText(task));
  if (!text) return null;

  const summary: WorkBoardPipelineSummary = {};
  const openDirect =
    matchMoney(text, new RegExp(`${MONEY}\\s+quoted\\s*/\\s*open\\s+pipeline`, "i")) ??
    matchMoney(text, new RegExp(`${MONEY}\\s+quoted\\s+open\\s+pipeline`, "i"));
  if (openDirect !== undefined) summary.quotedOpenUsd = openDirect;

  const approvalMatch = text.match(new RegExp(`${MONEY}\\s*/\\s*${MONEY}\\s*=\\s*[^$]{0,160}?blocked\\s+by\\s+human\\s+approval`, "i"));
  if (approvalMatch) {
    summary.approvalBlockedUsd = moneyValue(approvalMatch[1]);
    summary.quotedOpenUsd = summary.quotedOpenUsd ?? moneyValue(approvalMatch[2]);
  }

  const technicalMatch = text.match(new RegExp(`${MONEY}\\s*/\\s*${MONEY}\\s*=\\s*[^$]{0,160}?blocked\\s+by\\s+technical\\s+readiness`, "i"));
  if (technicalMatch) {
    summary.technicalBlockedUsd = moneyValue(technicalMatch[1]);
    summary.quotedOpenUsd = summary.quotedOpenUsd ?? moneyValue(technicalMatch[2]);
  }

  const inMarketMatch = text.match(new RegExp(`${MONEY}\\s*/\\s*${MONEY}\\s*=\\s*[^$]{0,160}?(?:already\\s+in-market|waiting\\s+on\\s+prospect\\s+response)`, "i"));
  if (inMarketMatch) {
    summary.inMarketUsd = moneyValue(inMarketMatch[1]);
    summary.quotedOpenUsd = summary.quotedOpenUsd ?? moneyValue(inMarketMatch[2]);
  }

  const recognized =
    matchMoney(text, new RegExp(`${MONEY}\\s+recognized\\s+Weekly\\s+Revenue`, "i")) ??
    matchMoney(text, new RegExp(`recognized\\s+Weekly\\s+Revenue\\s+(?:remains\\s+)?${MONEY}`, "i")) ??
    matchMoney(text, new RegExp(`Weekly\\s+Revenue\\s+remains\\s+${MONEY}\\s*/\\s*${MONEY}`, "i"));
  if (recognized !== undefined) summary.recognizedWeeklyRevenueUsd = recognized;

  const target =
    matchMoneyGroup(text, new RegExp(`Weekly\\s+Revenue\\s+remains\\s+${MONEY}\\s*/\\s*${MONEY}`, "i"), 2) ??
    matchMoney(text, new RegExp(`${MONEY}\\s+weekly\\s+target`, "i")) ??
    matchMoney(text, new RegExp(`${MONEY}\\s*/\\s*week\\s+target`, "i"));
  if (target !== undefined) summary.weeklyRevenueTargetUsd = target;

  const hasPipelineSignal =
    summary.quotedOpenUsd !== undefined ||
    summary.approvalBlockedUsd !== undefined ||
    summary.technicalBlockedUsd !== undefined ||
    summary.inMarketUsd !== undefined;
  return hasPipelineSignal ? summary : null;
}

/**
 * Build the current company pipeline summary from the newest labeled fields.
 * Newer audit tasks can refresh only part of the picture; older audit fields
 * fill gaps, so a new quoted/open audit does not erase a still-useful approval
 * bottleneck split until a newer split exists.
 */
export function extractWorkBoardPipelineSummary(tasks: WorkBoardPipelineTask[]): WorkBoardPipelineSummary | null {
  const candidates = tasks
    .map((task) => ({ task, summary: parsePipelineCandidate(task), stamp: task.updatedAt ?? task.completedAt ?? 0 }))
    .filter((item): item is { task: WorkBoardPipelineTask; summary: WorkBoardPipelineSummary; stamp: number } => Boolean(item.summary))
    .sort((a, b) => b.stamp - a.stamp);

  const merged: WorkBoardPipelineSummary = {};
  for (const { task, summary } of candidates) {
    if (summary.quotedOpenUsd !== undefined && merged.quotedOpenUsd === undefined) {
      merged.quotedOpenUsd = summary.quotedOpenUsd;
      assignSource(merged, task);
    }
    if (summary.recognizedWeeklyRevenueUsd !== undefined && merged.recognizedWeeklyRevenueUsd === undefined) {
      merged.recognizedWeeklyRevenueUsd = summary.recognizedWeeklyRevenueUsd;
      assignSource(merged, task);
    }
    if (summary.weeklyRevenueTargetUsd !== undefined && merged.weeklyRevenueTargetUsd === undefined) {
      merged.weeklyRevenueTargetUsd = summary.weeklyRevenueTargetUsd;
      assignSource(merged, task);
    }
    if (summary.approvalBlockedUsd !== undefined && merged.approvalBlockedUsd === undefined) {
      merged.approvalBlockedUsd = summary.approvalBlockedUsd;
      assignSource(merged, task);
    }
    if (summary.technicalBlockedUsd !== undefined && merged.technicalBlockedUsd === undefined) {
      merged.technicalBlockedUsd = summary.technicalBlockedUsd;
      assignSource(merged, task);
    }
    if (summary.inMarketUsd !== undefined && merged.inMarketUsd === undefined) {
      merged.inMarketUsd = summary.inMarketUsd;
      assignSource(merged, task);
    }
  }

  return merged.quotedOpenUsd !== undefined || merged.approvalBlockedUsd !== undefined ? merged : null;
}

export function extractWorkBoardPipelineImpact(task: WorkBoardPipelineTask): WorkBoardPipelineImpact | null {
  const text = compactText(toText(task));
  if (!text) return null;

  const patterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: new RegExp(`(?:unlock(?:s|ing)?|opens?)\\s+${MONEY}\\s+(?:closest-to-cash\\s+)?pipeline`, "i"), label: "pipeline unlocked by approval" },
    { pattern: new RegExp(`(?:live\\s+follow-up\\s+)?pipeline\\s+ready\\s+for\\s+approval\\s*:\\s*${MONEY}`, "i"), label: "pipeline ready for approval" },
    { pattern: new RegExp(`queued\\s+pipeline\\s+is\\s+${MONEY}`, "i"), label: "queued pipeline" },
    { pattern: new RegExp(`Priority\\s+A\\b[^.]{0,120}?${MONEY}`, "i"), label: "Priority A approval path" },
    { pattern: new RegExp(`${MONEY}\\s+(?:closest-to-cash|approval-held|queued|catalog-priced|send-ready|live\\s+follow-up|draft|quoted)\\s+pipeline`, "i"), label: "quoted pipeline" },
    { pattern: new RegExp(`(?:pipeline\\s+added|top-five\\s+catalog\\s+pipeline|full\\s+researched\\s+batch\\s+remains\\s+a)\\s*:?\\s*${MONEY}`, "i"), label: "quoted pipeline" },
  ];

  for (const { pattern, label } of patterns) {
    const amountUsd = matchMoney(text, pattern);
    if (amountUsd !== undefined && amountUsd > 0) return { amountUsd, label };
  }
  return null;
}

export function isWorkBoardPipelineQuestion(value: string): boolean {
  return /\b(quoted|quote|open\s+pipeline|pipeline|forecast|revenue|weekly\s+target|recognized|close\s+probability|approval\s+bottleneck|sales)\b/i.test(value);
}

export function formatPipelineUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function summarizeWorkBoardPipeline(tasks: WorkBoardPipelineTask[]): string {
  const summary = extractWorkBoardPipelineSummary(tasks);
  if (!summary) {
    return "I don't see a current quoted/open pipeline audit on the Work Board.";
  }
  const parts = [
    `Quoted/open pipeline: ${formatPipelineUsd(summary.quotedOpenUsd)}.`,
    `Recognized weekly revenue: ${formatPipelineUsd(summary.recognizedWeeklyRevenueUsd)}${summary.weeklyRevenueTargetUsd !== undefined ? ` / ${formatPipelineUsd(summary.weeklyRevenueTargetUsd)} target` : ""}.`,
  ];
  if (summary.approvalBlockedUsd !== undefined) parts.push(`Blocked by human approval: ${formatPipelineUsd(summary.approvalBlockedUsd)}.`);
  if (summary.inMarketUsd !== undefined) parts.push(`Already in market/waiting on prospects: ${formatPipelineUsd(summary.inMarketUsd)}.`);
  if (summary.technicalBlockedUsd !== undefined) parts.push(`Blocked by technical readiness: ${formatPipelineUsd(summary.technicalBlockedUsd)}.`);
  parts.push("This is potential pipeline, not booked revenue; it becomes revenue only when a customer pays.");
  return parts.join(" ");
}
