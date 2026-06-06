import type { ComponentType } from "react";
import NextImage from "next/image";

import styles from "./MiroSharkSimulationCard.module.css";

type ChatMarkdownComponent = ComponentType<{ text: string; className?: string; headingClassName?: string }>;

type MiroSharkEvent = {
  at?: unknown;
  detail?: unknown;
  label?: unknown;
  runId?: unknown;
  status?: unknown;
};

export type MiroSharkSimulationCardData = {
  amountUsd?: number;
  hideRawContent?: boolean;
  network?: string;
  paid?: boolean;
  paymentLabel?: string;
  reportMarkdown?: string;
  reportUrl?: string;
  runId?: string;
  seed?: string;
  status?: string;
  statusUrl?: string;
  title?: string;
  waitUrl?: string;
};

export type MiroSharkProcessSummary = {
  currentStage: number;
  latest: string;
  subject?: string;
  runId?: string;
  status: string;
};

const MIROSHARK_ICON_SRC = "/icons/miroshark.png";
const RUN_ID_PATTERN = /\b(?:run|sim)_[A-Za-z0-9_-]+\b/;
const URL_PATTERN = /^https?:\/\//i;
const MIROSHARK_HINT_PATTERN = /miroshark|\/api\/miroshark\/x402|x402\.miroshark\.xyz|\b(?:run|sim)_[A-Za-z0-9_-]+\b/i;
const SIM_HINT_PATTERN = /\b(?:simulation|simulate|sim|report|status|x402|usdc|paid|wallet|deep research|prediction market)\b/i;
const STEP_LABELS = ["Payment", "Launch", "Status", "Report"];
const TERMINAL_STATUS_PATTERN = /\b(?:completed|complete|succeeded|success|failed|error|stopped|cancelled|canceled)\b/i;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[-_\s]/g, "");
}

function readableStatus(value?: string) {
  const clean = optionalString(value).replace(/[-_]+/g, " ");
  if (!clean) return "running";
  if (/^ok$/i.test(clean)) return "complete";
  return clean;
}

function isGenericSimulationTitle(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [
    "miroshark simulation",
    "miroshark simulation report",
    "simulation",
    "simulation report",
    "simulation run",
    "report",
  ].includes(normalized);
}

function simulationSubject(card: MiroSharkSimulationCardData) {
  const title = optionalString(card.title);
  if (title && !isGenericSimulationTitle(title)) return title;
  const seed = optionalString(card.seed);
  if (seed && seed.length <= 220 && !URL_PATTERN.test(seed)) return seed;
  return "";
}

function displayTitle(card: MiroSharkSimulationCardData) {
  return simulationSubject(card) || optionalString(card.title) || "Simulation run";
}

function reportMarkdownForDisplay(card: MiroSharkSimulationCardData) {
  const markdown = card.reportMarkdown?.trim() ?? "";
  if (!markdown) return "";
  const subject = simulationSubject(card);
  if (!subject) return markdown;
  return markdown.replace(
    /^#{1,4}\s+(?:miroshark\s+)?simulation\s+report\s*$/im,
    `### ${subject.replace(/\s+/g, " ").trim()}`,
  );
}

function statusTone(value?: string) {
  const status = readableStatus(value).toLowerCase();
  if (/\b(?:fail|error|blocked|stopped|cancelled|canceled)\b/.test(status)) return styles.failed;
  if (/\b(?:complete|completed|success|succeeded|ready)\b/.test(status)) return styles.complete;
  if (/\b(?:queued|waiting|pending|draft|approval)\b/.test(status)) return styles.waiting;
  return styles.running;
}

function eventText(event: MiroSharkEvent) {
  return [
    event.label,
    event.detail,
    event.status,
    event.runId,
  ].map((part) => optionalString(part)).filter(Boolean).join(" ");
}

function trimForSignal(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanSubjectCandidate(value: string) {
  const clean = value.replace(/^["'`]+|["'`,.;]+$/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 220 || URL_PATTERN.test(clean)) return "";
  return clean;
}

function subjectFromSignal(value: string) {
  for (const line of value.split(/\r?\n/)) {
    const lineMatch = line.match(/^\s*(?:simulation\s+)?(?:prompt|scenario|question|seed|article)\s*[:=]\s*(.+)$/i)?.[1];
    const cleanLine = lineMatch ? cleanSubjectCandidate(lineMatch) : "";
    if (cleanLine) return cleanLine;
  }
  const inlineMatch = value.match(/\b(?:simulation\s+)?(?:prompt|scenario|question|seed)\s*[:=]\s*(.+?)(?=\s+(?:run[_\s-]?id|status|payment|polling|preparing|starting|miroshark|simulation|running)\b|$)/i)?.[1];
  return inlineMatch ? cleanSubjectCandidate(inlineMatch) : "";
}

function firstRunId(value: string) {
  return value.match(RUN_ID_PATTERN)?.[0] ?? "";
}

function likelyMiroSharkText(text: string) {
  return MIROSHARK_HINT_PATTERN.test(text) && SIM_HINT_PATTERN.test(text);
}

function balancedJsonAt(text: string, start: number) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack[stack.length - 1] !== char) return "";
      stack.pop();
      if (!stack.length) return text.slice(start, index + 1);
    }
  }
  return "";
}

function jsonCandidates(text: string) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  for (const match of text.matchAll(/```(?:json|jsonc|data)?\s*([\s\S]*?)```/gi)) {
    add(match[1] ?? "");
  }
  for (let index = 0; index < text.length && candidates.length < 24; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") continue;
    add(balancedJsonAt(text, index));
  }
  return candidates;
}

function parseJsonCandidates(text: string) {
  return jsonCandidates(text).flatMap((candidate) => {
    try {
      return [{ raw: candidate, value: JSON.parse(candidate) as unknown }];
    } catch {
      return [];
    }
  });
}

function assignLink(card: MiroSharkSimulationCardData, key: string, value: string) {
  if (!URL_PATTERN.test(value)) return;
  const normalized = normalizeKey(key);
  if (normalized.includes("report")) card.reportUrl ||= value;
  else if (normalized.includes("status")) card.statusUrl ||= value;
  else if (normalized.includes("wait")) card.waitUrl ||= value;
  else if (/\/report\//i.test(value)) card.reportUrl ||= value;
  else if (/\/status\//i.test(value)) card.statusUrl ||= value;
}

function assignStringField(card: MiroSharkSimulationCardData, key: string, value: string) {
  const normalized = normalizeKey(key);
  const clean = value.trim();
  if (!clean) return;
  const runId = firstRunId(clean);
  if (runId && (normalized.includes("id") || normalized.includes("run") || normalized.includes("simulation"))) card.runId ||= runId;
  if (runId && !card.runId) card.runId = runId;
  if (normalized.includes("status") || normalized === "state" || normalized.includes("runnerstatus")) card.status ||= clean;
  if (normalized.includes("network")) card.network ||= clean;
  if (normalized.includes("reportmarkdown") || normalized === "markdown") card.reportMarkdown ||= clean;
  if ((normalized === "report" || normalized.endsWith("report")) && clean.includes("\n")) card.reportMarkdown ||= clean;
  if ((normalized === "title" || normalized === "name") && clean.length <= 180) card.title ||= clean;
  if (["prompt", "scenario", "question", "simulationrequirement"].includes(normalized) && clean.length <= 700) card.seed ||= clean;
  if (normalized === "url" && URL_PATTERN.test(clean)) card.seed ||= clean;
  if (normalized.includes("payment") && clean.length <= 120) card.paymentLabel ||= clean;
  assignLink(card, key, clean);
}

function collectCardData(value: unknown, card: MiroSharkSimulationCardData, key = "", depth = 0) {
  if (depth > 9 || value == null) return;
  if (typeof value === "string") {
    assignStringField(card, key, value);
    return;
  }
  if (typeof value === "number") {
    const normalized = normalizeKey(key);
    if (normalized.includes("amountusd")) {
      card.amountUsd ??= value;
      card.paymentLabel ||= `$${value.toFixed(2)} USDC`;
    }
    return;
  }
  if (typeof value === "boolean") {
    const normalized = normalizeKey(key);
    if (normalized === "paid") card.paid ??= value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCardData(item, card, key, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    collectCardData(childValue, card, childKey, depth + 1);
  }
}

function collectTextFallbacks(text: string, card: MiroSharkSimulationCardData) {
  card.runId ||= firstRunId(text);
  const status = text.match(/\b(?:status|runner_status|state)\s*[:=]\s*`?([A-Za-z][A-Za-z0-9_-]*)/i)?.[1];
  if (status) card.status ||= status;
  const payment = text.match(/(?:\$ ?\d+(?:\.\d{1,4})?|\b\d+(?:\.\d{1,4})?\s+USDC\b)/i)?.[0];
  if (payment) card.paymentLabel ||= payment.replace(/\s+/g, " ");
  const scenario = subjectFromSignal(text);
  if (scenario) card.seed ||= scenario;
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (heading && /miroshark|simulation|report/i.test(heading) && !isGenericSimulationTitle(heading)) card.title ||= heading.trim();
}

function shouldHideRawContent(text: string, parsedJson: Array<{ raw: string; value: unknown }>, card: MiroSharkSimulationCardData) {
  if (card.reportMarkdown) return true;
  const jsonBytes = parsedJson.reduce((total, item) => total + item.raw.length, 0);
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  return jsonBytes > 0 && jsonBytes > text.length * 0.48 && prose.length < 260;
}

export function extractMiroSharkSimulationCard(text: string): MiroSharkSimulationCardData | null {
  const trimmed = text.trim();
  if (!trimmed || !likelyMiroSharkText(trimmed)) return null;
  const card: MiroSharkSimulationCardData = {};
  const parsedJson = parseJsonCandidates(trimmed);
  parsedJson.forEach((item) => collectCardData(item.value, card));
  collectTextFallbacks(trimmed, card);
  if (!card.runId && !card.reportMarkdown && !card.status && !card.paymentLabel) return null;
  card.title = displayTitle(card);
  card.status ||= card.reportMarkdown ? "complete" : "running";
  card.hideRawContent = shouldHideRawContent(trimmed, parsedJson, card);
  return card;
}

export function getMiroSharkProcessSummary(events: MiroSharkEvent[] = [], active = false): MiroSharkProcessSummary | null {
  const visible = events.map(eventText).filter(Boolean);
  const combined = visible.join(" ");
  if (!likelyMiroSharkText(combined)) return null;
  const subjectCard: MiroSharkSimulationCardData = {};
  parseJsonCandidates(combined).forEach((item) => collectCardData(item.value, subjectCard));
  visible.forEach((value) => collectTextFallbacks(value, subjectCard));
  const runId = firstRunId(combined);
  const latest = trimForSignal(visible[visible.length - 1] ?? "Preparing MiroShark simulation");
  const lower = combined.toLowerCase();
  const latestStatus = optionalString(events[events.length - 1]?.status);
  const status = TERMINAL_STATUS_PATTERN.test(combined)
    ? readableStatus(combined.match(TERMINAL_STATUS_PATTERN)?.[0])
    : latestStatus && latestStatus !== "active"
      ? latestStatus
      : active
        ? "running"
        : "observed";
  const currentStage = /report/.test(lower)
    ? 3
    : /status|poll|wait/.test(lower)
      ? 2
      : /launch|start|simulation|\/run|run_/.test(lower)
        ? 1
        : 0;
  return { currentStage, latest, runId, status, subject: simulationSubject(subjectCard) };
}

function metric(label: string, value: string) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function stepClass(index: number, currentStage: number, active: boolean) {
  if (index < currentStage) return styles.complete;
  if (index === currentStage) return active ? styles.active : styles.complete;
  return styles.waiting;
}

export function MiroSharkProcessCard({ summary }: { summary: MiroSharkProcessSummary }) {
  const active = !TERMINAL_STATUS_PATTERN.test(summary.status) && !/\bobserved\b/i.test(summary.status);
  return (
    <section className={cx(styles.processCard, active && styles.active)} aria-label="MiroShark simulation progress">
      <div className={styles.processHeader}>
        <span className={styles.iconWrap} aria-hidden="true">
          <NextImage className={styles.icon} src={MIROSHARK_ICON_SRC} alt="" width={34} height={34} />
        </span>
        <span className={styles.titleBlock}>
          <span className={styles.kicker}>MiroShark x402</span>
          <strong>{active ? "Simulation is running" : "Simulation activity"}</strong>
          {summary.subject ? <span className={styles.processSubject}>For {summary.subject}</span> : null}
        </span>
        <span className={cx(styles.statusPill, statusTone(summary.status))}>{readableStatus(summary.status)}</span>
      </div>
      <div className={styles.stepper} aria-label="MiroShark x402 stages">
        {STEP_LABELS.map((label, index) => (
          <span className={cx(styles.step, stepClass(index, summary.currentStage, active))} key={label}>
            <i className={styles.stepDot} aria-hidden="true" />
            <strong>{label}</strong>
          </span>
        ))}
      </div>
      {summary.runId ? <p className={styles.processLatest}>Run {summary.runId}</p> : null}
      <p className={styles.processLatest}>{summary.latest}</p>
    </section>
  );
}

export function MiroSharkSimulationCard({ card, ChatMarkdown }: { card: MiroSharkSimulationCardData; ChatMarkdown?: ChatMarkdownComponent }) {
  const hasReport = Boolean(card.reportMarkdown?.trim());
  const status = readableStatus(card.status);
  const reportOpen = hasReport && (card.reportMarkdown?.length ?? 0) < 1600;
  const reportMarkdown = reportMarkdownForDisplay(card);
  const title = displayTitle(card);
  const subtitle = card.seed && card.seed !== title ? card.seed : "";
  return (
    <section className={cx(styles.card, statusTone(card.status))} aria-label="MiroShark simulation card">
      <header className={styles.header}>
        <span className={styles.iconWrap} aria-hidden="true">
          <NextImage className={styles.icon} src={MIROSHARK_ICON_SRC} alt="" width={34} height={34} />
        </span>
        <span className={styles.titleBlock}>
          <span className={styles.kicker}>MiroShark simulation</span>
          <h3>{title}</h3>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </span>
        <span className={cx(styles.statusPill, statusTone(card.status))}>{status}</span>
      </header>

      <div className={styles.metrics}>
        {metric("Run", card.runId || "pending")}
        {metric("Payment", card.paymentLabel || (card.paid ? "paid" : "x402"))}
        {metric("Network", card.network || "Base USDC")}
      </div>

      <div className={styles.actions}>
        {card.reportUrl ? <a href={card.reportUrl} rel="noopener noreferrer" target="_blank">Open report</a> : null}
        {card.statusUrl ? <a href={card.statusUrl} rel="noopener noreferrer" target="_blank">Check status</a> : null}
        {card.waitUrl ? <a href={card.waitUrl} rel="noopener noreferrer" target="_blank">Watch run</a> : null}
      </div>

      <details className={styles.report} open={reportOpen}>
        <summary>{hasReport ? "Report" : "Report retrieval"}</summary>
        {hasReport ? (
          ChatMarkdown ? (
            <ChatMarkdown text={reportMarkdown} className={styles.reportMarkdown} />
          ) : (
            <pre className={styles.reportMarkdown}>{reportMarkdown}</pre>
          )
        ) : (
          <p className={styles.emptyReport}>The run is embedded here. Ask the agent to poll status and retrieve the report when MiroShark marks it complete.</p>
        )}
      </details>
    </section>
  );
}
