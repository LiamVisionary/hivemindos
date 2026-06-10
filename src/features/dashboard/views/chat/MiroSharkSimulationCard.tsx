"use client";

import { useState, type ComponentType } from "react";
import NextImage from "next/image";

import { PolyMarketModal } from "./poly-market-modal";
import styles from "./MiroSharkSimulationCard.module.css";
import {
  extractMiroSharkSimulationCard,
  getMiroSharkProcessSummary,
  type MiroSharkProcessSummary,
  type MiroSharkSimulationCardData,
} from "./miroshark-card-parser";

export { extractMiroSharkSimulationCard, getMiroSharkProcessSummary };

type ChatMarkdownComponent = ComponentType<{
  text: string;
  className?: string;
  headingClassName?: string;
}>;

const MIROSHARK_ICON_SRC = "/icons/miroshark.png";
const URL_PATTERN = /^https?:\/\//i;
const STEP_LABELS = ["Payment", "Launch", "Status", "Report"];
const TERMINAL_STATUS_PATTERN =
  /\b(?:completed|complete|succeeded|success|failed|error|stopped|cancelled|canceled)\b/i;
const SPACEX_POLYMARKET_URL =
  "https://polymarket.com/event/spacex-ipo-closing-market-cap-above";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readableStatus(value?: string) {
  const clean = optionalString(value).replace(/[-_]+/g, " ");
  if (!clean) return "running";
  if (/^ok$/i.test(clean)) return "complete";
  return clean;
}

function isGenericSimulationTitle(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  return (
    simulationSubject(card) || optionalString(card.title) || "Simulation run"
  );
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
  if (/\b(?:fail|error|blocked|stopped|cancelled|canceled)\b/.test(status))
    return styles.failed;
  if (/\b(?:complete|completed|success|succeeded|ready)\b/.test(status))
    return styles.complete;
  if (/\b(?:queued|waiting|pending|draft|approval)\b/.test(status))
    return styles.waiting;
  return styles.running;
}

function isCompleteStatus(value?: string) {
  return /\b(?:complete|completed|success|succeeded|ready)\b/i.test(
    readableStatus(value),
  );
}

function polymarketUrlFromCard(card: MiroSharkSimulationCardData) {
  const detailUrl = optionalString(card.polymarketDetail?.marketUrl);
  if (detailUrl) return detailUrl;
  const haystack = [
    card.seed,
    card.reportMarkdown,
    card.reportUrl,
    card.statusUrl,
    card.waitUrl,
    card.title,
  ]
    .map((part) => optionalString(part))
    .join("\n");
  if (/spacex-ipo-closing-market-cap-above/i.test(haystack))
    return SPACEX_POLYMARKET_URL;
  return (
    haystack.match(/https:\/\/polymarket\.com\/event\/[A-Za-z0-9_-]+/i)?.[0] ??
    ""
  );
}

function hasPolymarketRunDetails(card: MiroSharkSimulationCardData) {
  return (
    isCompleteStatus(card.status) &&
    Boolean(polymarketUrlFromCard(card) || card.polymarketDetail)
  );
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

export function MiroSharkProcessCard({
  summary,
}: {
  summary: MiroSharkProcessSummary;
}) {
  const active =
    !TERMINAL_STATUS_PATTERN.test(summary.status) &&
    !/\bobserved\b/i.test(summary.status);
  return (
    <section
      className={cx(styles.processCard, active && styles.active)}
      aria-label="MiroShark simulation progress"
    >
      <div className={styles.processHeader}>
        <span className={styles.iconWrap} aria-hidden="true">
          <NextImage
            className={styles.icon}
            src={MIROSHARK_ICON_SRC}
            alt=""
            width={34}
            height={34}
          />
        </span>
        <span className={styles.titleBlock}>
          <span className={styles.kicker}>MiroShark x402</span>
          <strong>
            {active ? "Simulation is running" : "Simulation activity"}
          </strong>
          {summary.subject ? (
            <span className={styles.processSubject}>For {summary.subject}</span>
          ) : null}
        </span>
        <span className={cx(styles.statusPill, statusTone(summary.status))}>
          {readableStatus(summary.status)}
        </span>
      </div>
      <div className={styles.stepper} aria-label="MiroShark x402 stages">
        {STEP_LABELS.map((label, index) => (
          <span
            className={cx(
              styles.step,
              stepClass(index, summary.currentStage, active),
            )}
            key={label}
          >
            <i className={styles.stepDot} aria-hidden="true" />
            <strong>{label}</strong>
          </span>
        ))}
      </div>
      {summary.runId ? (
        <p className={styles.processLatest}>Run {summary.runId}</p>
      ) : null}
      <p className={styles.processLatest}>{summary.latest}</p>
    </section>
  );
}

export function MiroSharkSimulationCard({
  card,
  ChatMarkdown,
}: {
  card: MiroSharkSimulationCardData;
  ChatMarkdown?: ChatMarkdownComponent;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasReport = Boolean(card.reportMarkdown?.trim());
  const status = readableStatus(card.status);
  const reportOpen = hasReport && (card.reportMarkdown?.length ?? 0) < 1600;
  const reportMarkdown = reportMarkdownForDisplay(card);
  const title = displayTitle(card);
  const subtitle = card.seed && card.seed !== title ? card.seed : "";
  const polymarketUrl = polymarketUrlFromCard(card);
  const showMoreData = hasPolymarketRunDetails(card);
  const openMarket = () => {
    if (!polymarketUrl) return;
    window.open(polymarketUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <>
      <section
        className={cx(styles.card, statusTone(card.status))}
        aria-label="MiroShark simulation card"
      >
        <header className={styles.header}>
          <span className={styles.iconWrap} aria-hidden="true">
            <NextImage
              className={styles.icon}
              src={MIROSHARK_ICON_SRC}
              alt=""
              width={34}
              height={34}
            />
          </span>
          <span className={styles.titleBlock}>
            <span className={styles.kicker}>MiroShark simulation</span>
            <h3>{title}</h3>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </span>
          <span className={cx(styles.statusPill, statusTone(card.status))}>
            {status}
          </span>
        </header>

        <div className={styles.metrics}>
          {metric("Run", card.runId || "pending")}
          {metric(
            "Payment",
            card.paymentLabel || (card.paid ? "paid" : "x402"),
          )}
          {metric("Network", card.network || "Base USDC")}
        </div>

        <div className={styles.actions}>
          {showMoreData ? (
            <button
              aria-haspopup="dialog"
              className={styles.actionButton}
              data-miroshark-more-data
              onClick={() => setDetailsOpen(true)}
              type="button"
            >
              More data
            </button>
          ) : null}
          {card.reportUrl ? (
            <a href={card.reportUrl} rel="noopener noreferrer" target="_blank">
              Open report
            </a>
          ) : null}
          {card.statusUrl ? (
            <a href={card.statusUrl} rel="noopener noreferrer" target="_blank">
              Check status
            </a>
          ) : null}
          {card.waitUrl ? (
            <a href={card.waitUrl} rel="noopener noreferrer" target="_blank">
              Watch run
            </a>
          ) : null}
        </div>

        <details className={styles.report} open={reportOpen}>
          <summary>{hasReport ? "Report" : "Report retrieval"}</summary>
          {hasReport ? (
            ChatMarkdown ? (
              <ChatMarkdown
                text={reportMarkdown}
                className={styles.reportMarkdown}
              />
            ) : (
              <pre className={styles.reportMarkdown}>{reportMarkdown}</pre>
            )
          ) : (
            <p className={styles.emptyReport}>
              The run is embedded here. Ask the agent to poll status and
              retrieve the report when MiroShark marks it complete.
            </p>
          )}
        </details>
      </section>
      {showMoreData ? (
        <PolyMarketModal
          marketUrl={polymarketUrl}
          detail={card.polymarketDetail}
          marketTitle={title}
          onClose={() => setDetailsOpen(false)}
          onOpenMarket={openMarket}
          open={detailsOpen}
          runId={card.runId}
        />
      ) : null}
    </>
  );
}
