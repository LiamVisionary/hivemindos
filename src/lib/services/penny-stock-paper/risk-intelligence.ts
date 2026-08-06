import type {
  PennyStockCorporateAction,
  PennyStockFilingMarker,
  PennyStockFilingSummary,
  PennyStockRiskUpdateSignal,
  PennyStockSecEvidence,
  PennyStockSecRiskFlag,
} from "./types";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const SEC_COMPANY_FACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts";
const SEC_ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data";
const ALPACA_CORPORATE_ACTIONS_URL =
  "https://data.alpaca.markets/v1/corporate-actions";
const SEC_HEADERS = {
  accept: "application/json",
  "user-agent": "HivemindOS research-only paper simulator support@hivemindos.app",
};
const MONITORED_FILING_FORMS = new Set([
  "10-K",
  "10-Q",
  "20-F",
  "40-F",
  "8-K",
  "6-K",
  "S-1",
  "S-3",
  "S-3/A",
  "424B3",
  "424B5",
  "DEF 14A",
  "PRE 14A",
]);

type FetchLike = typeof fetch;

type SubmissionRow = {
  form: string;
  filedAt: string;
  accessionNumber: string;
  primaryDocument: string;
};

export async function fetchPennyRiskIntelligence(input: {
  symbols: string[];
  asOf: Date;
  alpacaHeaders: Record<string, string>;
  fetchFn?: FetchLike;
}): Promise<{
  filings: Record<string, PennyStockFilingSummary>;
  corporateActions: Record<string, PennyStockCorporateAction[]>;
}> {
  const fetchFn = input.fetchFn ?? fetch;
  const [filings, corporateActions] = await Promise.all([
    fetchSecRiskSummaries(input.symbols, input.asOf, fetchFn),
    fetchCorporateActions({
      symbols: input.symbols,
      asOf: input.asOf,
      headers: input.alpacaHeaders,
      fetchFn,
    }),
  ]);
  for (const symbol of input.symbols) {
    const reverseSplits = (corporateActions[symbol] ?? [])
      .filter((action) => action.type === "reverse_split");
    if (reverseSplits.length) {
      const summary = filings[symbol] ?? emptyFilingSummary();
      summary.vetoReasons.push(
        `Alpaca corporate-actions data reports ${reverseSplits.length} reverse split(s) in the lookback.`,
      );
      filings[symbol] = summary;
    }
  }
  return { filings, corporateActions };
}

export async function fetchPennyRiskUpdateSignals(input: {
  symbols: string[];
  asOf: Date;
  alpacaHeaders: Record<string, string>;
  fetchFn?: FetchLike;
}): Promise<Record<string, PennyStockRiskUpdateSignal>> {
  const symbols = [...new Set(input.symbols.map(safeSymbol).filter(Boolean))];
  if (!symbols.length || symbols.length > 20) {
    throw new Error("Risk-update monitoring needs between one and twenty symbols.");
  }
  const fetchFn = input.fetchFn ?? fetch;
  const [cikBySymbol, corporateActionResult] = await Promise.all([
    fetchCikBySymbol(fetchFn),
    fetchCorporateActionsWithCoverage({
      symbols,
      asOf: input.asOf,
      headers: input.alpacaHeaders,
      fetchFn,
    }),
  ]);
  const asOfDate = input.asOf.toISOString().slice(0, 10);
  const earliest = new Date(input.asOf.getTime() - 730 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const entries = await mapWithConcurrency(symbols, 3, async (symbol) => {
    const cik = cikBySymbol.get(symbol) ?? null;
    const submission = cik
      ? await safeFetchJson(`${SEC_SUBMISSIONS_BASE}/CIK${cik}.json`, SEC_HEADERS, fetchFn)
      : null;
    const filingMarkers = isRecord(submission)
      ? submissionRows(submission)
        .filter((row) =>
          MONITORED_FILING_FORMS.has(row.form)
          && row.filedAt >= earliest
          && row.filedAt <= asOfDate
        )
        .sort((left, right) =>
          right.filedAt.localeCompare(left.filedAt)
          || left.form.localeCompare(right.form)
        )
        .slice(0, 50)
        .map((row) => filingMarker(cik!, row))
      : [];
    return [symbol, {
      cik,
      filingMarkers,
      corporateActions: corporateActionResult.actions[symbol] ?? [],
      secCoverage: isRecord(submission) ? "available" : "missing",
      corporateActionCoverage: corporateActionResult.available ? "available" : "missing",
    } satisfies PennyStockRiskUpdateSignal] as const;
  });
  return Object.fromEntries(entries);
}

export function pennyFilingMarkerKey(marker: PennyStockFilingMarker) {
  return `${marker.form}|${marker.filedAt}|${marker.accessionNumber}`;
}

export function pennyCorporateActionKey(action: PennyStockCorporateAction) {
  return `${action.type}|${action.processDate}`;
}

export function emptyFilingSummary(): PennyStockFilingSummary {
  return {
    cik: null,
    latestPeriodicForm: null,
    latestPeriodicFiledAt: null,
    latestEventForm: null,
    latestEventFiledAt: null,
    sharesOutstandingLatest: null,
    sharesOutstandingPrior: null,
    sharesOutstandingGrowthPct: null,
    cashUsd: null,
    annualizedOperatingCashBurnUsd: null,
    estimatedCashRunwayMonths: null,
    riskEvidence: [],
    vetoReasons: [],
    reviewReasons: [],
    coverage: "missing",
  };
}

async function fetchSecRiskSummaries(
  symbols: string[],
  asOf: Date,
  fetchFn: FetchLike,
): Promise<Record<string, PennyStockFilingSummary>> {
  const cikBySymbol = await fetchCikBySymbol(fetchFn);
  if (!cikBySymbol.size) {
    return Object.fromEntries(symbols.map((symbol) => [symbol, emptyFilingSummary()]));
  }
  const entries = await mapWithConcurrency(symbols, 2, async (symbol) => {
    const cik = cikBySymbol.get(symbol);
    if (!cik) return [symbol, emptyFilingSummary()] as const;
    const [submission, companyFacts] = await Promise.all([
      safeFetchJson(`${SEC_SUBMISSIONS_BASE}/CIK${cik}.json`, SEC_HEADERS, fetchFn),
      safeFetchJson(`${SEC_COMPANY_FACTS_BASE}/CIK${cik}.json`, SEC_HEADERS, fetchFn),
    ]);
    if (!isRecord(submission)) {
      return [symbol, { ...emptyFilingSummary(), cik }] as const;
    }
    const summary = filingSummaryFromSubmission(cik, submission);
    applyCompanyFacts(summary, companyFacts, asOf);
    const documents = recentRiskDocuments(submission, asOf).slice(0, 5);
    const evidenceRows = await mapWithConcurrency(documents, 1, async (row) =>
      fetchAndClassifyFiling(cik, row, fetchFn)
    );
    summary.riskEvidence = evidenceRows.flat();
    applyVetoRules(summary);
    summary.coverage = isRecord(companyFacts) && documents.length
      ? "complete"
      : "partial";
    return [symbol, summary] as const;
  });
  return Object.fromEntries(entries);
}

async function fetchCikBySymbol(fetchFn: FetchLike) {
  const mappingResponse = await safeFetchJson(SEC_TICKERS_URL, SEC_HEADERS, fetchFn);
  const cikBySymbol = new Map<string, string>();
  if (!isRecord(mappingResponse)) return cikBySymbol;
  for (const value of Object.values(mappingResponse)) {
    if (!isRecord(value)) continue;
    const ticker = safeSymbol(String(value.ticker ?? ""));
    const cik = String(value.cik_str ?? "").replace(/\D/g, "").padStart(10, "0");
    if (ticker && /^\d{10}$/.test(cik)) cikBySymbol.set(ticker, cik);
  }
  return cikBySymbol;
}

function filingSummaryFromSubmission(
  cik: string,
  submission: Record<string, unknown>,
): PennyStockFilingSummary {
  const rows = submissionRows(submission);
  const periodic = rows.find((row) =>
    ["10-K", "10-Q", "20-F", "40-F"].includes(row.form)
  );
  const event = rows.find((row) => ["8-K", "6-K"].includes(row.form));
  return {
    ...emptyFilingSummary(),
    cik,
    latestPeriodicForm: periodic?.form ?? null,
    latestPeriodicFiledAt: periodic?.filedAt ?? null,
    latestEventForm: event?.form ?? null,
    latestEventFiledAt: event?.filedAt ?? null,
  };
}

function recentRiskDocuments(
  submission: Record<string, unknown>,
  asOf: Date,
): SubmissionRow[] {
  const earliest = new Date(asOf.getTime() - 550 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const priority = new Map([
    ["S-3", 0],
    ["S-3/A", 0],
    ["424B5", 0],
    ["424B3", 0],
    ["8-K", 1],
    ["6-K", 1],
    ["10-Q", 2],
    ["10-K", 2],
    ["20-F", 2],
    ["DEF 14A", 3],
    ["PRE 14A", 3],
  ]);
  return submissionRows(submission)
    .filter((row) =>
      row.filedAt >= earliest
      && row.filedAt <= asOf.toISOString().slice(0, 10)
      && priority.has(row.form)
      && row.primaryDocument
    )
    .sort((left, right) =>
      (priority.get(left.form) ?? 9) - (priority.get(right.form) ?? 9)
      || right.filedAt.localeCompare(left.filedAt)
    );
}

function submissionRows(submission: Record<string, unknown>): SubmissionRow[] {
  const recent = isRecord(submission.filings) && isRecord(submission.filings.recent)
    ? submission.filings.recent
    : {};
  const forms = Array.isArray(recent.form) ? recent.form.map(String) : [];
  const dates = Array.isArray(recent.filingDate) ? recent.filingDate.map(String) : [];
  const accessions = Array.isArray(recent.accessionNumber)
    ? recent.accessionNumber.map(String)
    : [];
  const documents = Array.isArray(recent.primaryDocument)
    ? recent.primaryDocument.map(String)
    : [];
  return forms.map((form, index) => ({
    form,
    filedAt: dates[index] ?? "",
    accessionNumber: accessions[index] ?? "",
    primaryDocument: documents[index] ?? "",
  }));
}

function filingMarker(cik: string, row: SubmissionRow): PennyStockFilingMarker {
  const cikPath = String(Number(cik));
  const accessionPath = row.accessionNumber.replace(/\D/g, "");
  const sourceUrl = cikPath && accessionPath && safeDocumentName(row.primaryDocument)
    ? `${SEC_ARCHIVES_BASE}/${cikPath}/${accessionPath}/${row.primaryDocument}`
    : `${SEC_SUBMISSIONS_BASE}/CIK${cik}.json`;
  return {
    form: row.form,
    filedAt: row.filedAt,
    accessionNumber: row.accessionNumber,
    sourceUrl,
  };
}

async function fetchAndClassifyFiling(
  cik: string,
  row: SubmissionRow,
  fetchFn: FetchLike,
): Promise<PennyStockSecEvidence[]> {
  const cikPath = String(Number(cik));
  const accessionPath = row.accessionNumber.replace(/\D/g, "");
  if (!cikPath || !accessionPath || !safeDocumentName(row.primaryDocument)) return [];
  const sourceUrl = `${SEC_ARCHIVES_BASE}/${cikPath}/${accessionPath}/${row.primaryDocument}`;
  const response = await fetchFn(sourceUrl, {
    headers: { ...SEC_HEADERS, accept: "text/html, text/plain" },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  if (!response?.ok) return [];
  const raw = await response.text().catch(() => "");
  const text = stripMarkup(raw.slice(0, 8_000_000));
  const classifiers: Array<{
    flag: PennyStockSecRiskFlag;
    pattern: RegExp;
  }> = [
    {
      flag: "going-concern",
      pattern: /\bsubstantial doubt\b.{0,240}\bgoing concern\b|\bgoing concern\b.{0,240}\bsubstantial doubt\b/i,
    },
    {
      flag: "reverse-split",
      pattern: /\breverse (?:stock )?split\b/i,
    },
    {
      flag: "listing-compliance",
      pattern: /\bminimum bid price\b|\blisting compliance\b|\bdelisting (?:notice|determination)\b/i,
    },
    {
      flag: "atm-or-shelf",
      pattern: /\bat-the-market\b|\bsales agreement\b|\bshelf registration\b|\bprospectus supplement\b/i,
    },
    {
      flag: "convertible-or-warrant",
      pattern: /\bconvertible (?:note|debt|preferred)\b|\bwarrants?\b/i,
    },
    {
      flag: "operating-loss",
      pattern: /\boperating loss\b|\bnet loss\b/i,
    },
  ];
  const evidence: PennyStockSecEvidence[] = [];
  for (const classifier of classifiers) {
    const match = classifier.pattern.exec(text);
    if (!match) continue;
    const classification = classifyPennySecRiskText({
      flag: classifier.flag,
      text,
      matchIndex: match.index,
    });
    evidence.push({
      flag: classifier.flag,
      severity: classification.severity,
      eventStatus: classification.eventStatus,
      classificationReason: classification.reason,
      form: row.form,
      filedAt: row.filedAt,
      accessionNumber: row.accessionNumber,
      sourceUrl,
      evidence: excerpt(text, match.index),
    });
  }
  return evidence;
}

export function classifyPennySecRiskText(input: {
  flag: PennyStockSecRiskFlag;
  text: string;
  matchIndex?: number;
}): {
  severity: PennyStockSecEvidence["severity"];
  eventStatus: NonNullable<PennyStockSecEvidence["eventStatus"]>;
  reason: string;
} {
  const text = input.text.replace(/\s+/g, " ").trim();
  const matchIndex = input.matchIndex ?? Math.max(0, text.search(flagPattern(input.flag)));
  const context = text.slice(Math.max(0, matchIndex - 320), matchIndex + 520).toLowerCase();
  if (input.flag === "going-concern") {
    return {
      severity: "veto",
      eventStatus: "confirmed",
      reason: "The filing directly states substantial doubt about continuing as a going concern.",
    };
  }
  if (input.flag === "reverse-split") {
    if (
      /(?:effected|completed|implemented|consummated|became effective|was effective|following|after)\b.{0,100}\breverse (?:stock )?split\b|\breverse (?:stock )?split\b.{0,100}\b(?:effected|completed|implemented|consummated|became effective|was effective)\b/i.test(context)
    ) {
      return {
        severity: "veto",
        eventStatus: "confirmed",
        reason: "Nearby filing language describes an implemented or effective reverse split.",
      };
    }
    if (
      /\b(?:board|stockholders?|shareholders?)\b.{0,120}\b(?:approved|authorized)\b.{0,120}\breverse (?:stock )?split\b|\breverse (?:stock )?split\b.{0,120}\b(?:approved|authorized|plans? to|intends? to|will effect)\b/i.test(context)
    ) {
      return {
        severity: "warning",
        eventStatus: "planned",
        reason: "Nearby filing language describes an approved, authorized, or planned reverse split that still needs bounded review.",
      };
    }
    if (
      /\b(?:may|might|could)\b.{0,80}\b(?:effect|implement|undertake)?\b.{0,80}\breverse (?:stock )?split\b|\breverse (?:stock )?split\b.{0,100}\b(?:if necessary|if required|may be effected|could be effected)\b/i.test(context)
    ) {
      return {
        severity: "warning",
        eventStatus: "conditional",
        reason: "Nearby filing language makes the reverse split contingent or hypothetical rather than completed.",
      };
    }
    if (
      /\b(?:adjust|adjusted|adjustment|anti-dilution|proportionately|merger agreement|conversion price|exercise price|in the event of|upon any)\b.{0,180}\breverse (?:stock )?split\b|\breverse (?:stock )?split\b.{0,180}\b(?:adjust|adjusted|adjustment|anti-dilution|proportionately|conversion price|exercise price)\b/i.test(context)
    ) {
      return {
        severity: "info",
        eventStatus: "boilerplate",
        reason: "The phrase appears in an adjustment or contractual clause, not as evidence that a split occurred or is planned.",
      };
    }
    return {
      severity: "warning",
      eventStatus: "unclear",
      reason: "A reverse-split phrase was found without enough nearby context to classify it as completed, planned, or boilerplate.",
    };
  }
  if (input.flag === "listing-compliance") {
    const confirmed = /\b(?:received|issued|provided)\b.{0,120}\b(?:delisting notice|notice of noncompliance|staff determination)\b|\bdelisting (?:notice|determination)\b/i.test(context);
    return confirmed
      ? {
        severity: "veto",
        eventStatus: "confirmed",
        reason: "The filing reports a received delisting notice or determination.",
      }
      : {
        severity: "warning",
        eventStatus: "unclear",
        reason: "Listing-compliance language was found without a confirmed delisting notice or determination.",
      };
  }
  return {
    severity: "warning",
    eventStatus: "confirmed",
    reason: "The filing directly contains the screened financing or operating-risk phrase.",
  };
}

function flagPattern(flag: PennyStockSecRiskFlag): RegExp {
  if (flag === "reverse-split") return /\breverse (?:stock )?split\b/i;
  if (flag === "going-concern") return /\bgoing concern\b/i;
  if (flag === "listing-compliance") return /\blisting compliance\b|\bdelisting\b/i;
  if (flag === "atm-or-shelf") return /\bat-the-market\b|\bshelf registration\b/i;
  if (flag === "convertible-or-warrant") return /\bconvertible\b|\bwarrants?\b/i;
  if (flag === "operating-loss") return /\boperating loss\b|\bnet loss\b/i;
  return /$^/;
}

function applyCompanyFacts(
  summary: PennyStockFilingSummary,
  raw: unknown,
  asOf: Date,
) {
  if (!isRecord(raw) || !isRecord(raw.facts)) return;
  const dei = isRecord(raw.facts.dei) ? raw.facts.dei : {};
  const gaap = isRecord(raw.facts["us-gaap"]) ? raw.facts["us-gaap"] : {};
  const shares = factRows(dei, "EntityCommonStockSharesOutstanding", "shares", asOf)
    .sort((left, right) => right.end.localeCompare(left.end));
  const latestShares = shares[0];
  const priorShares = shares.find((row) =>
    daysBetween(row.end, latestShares?.end ?? "") >= 180
  );
  summary.sharesOutstandingLatest = latestShares?.value ?? null;
  summary.sharesOutstandingPrior = priorShares?.value ?? null;
  summary.sharesOutstandingGrowthPct =
    latestShares && priorShares && priorShares.value > 0
      ? round(((latestShares.value - priorShares.value) / priorShares.value) * 100, 4)
      : null;
  const cash = firstAvailableFact(gaap, [
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndCashEquivalentsAtCarryingValue",
  ], "USD", asOf);
  const operatingCash = firstAvailableFact(gaap, [
    "NetCashProvidedByUsedInOperatingActivities",
  ], "USD", asOf, true);
  summary.cashUsd = cash?.value ?? null;
  if (operatingCash && operatingCash.value < 0) {
    const durationDays = Math.max(30, daysBetween(operatingCash.start, operatingCash.end));
    summary.annualizedOperatingCashBurnUsd = round(
      Math.abs(operatingCash.value) * 365 / durationDays,
      2,
    );
    summary.estimatedCashRunwayMonths = summary.cashUsd != null
      && summary.annualizedOperatingCashBurnUsd > 0
      ? round(summary.cashUsd / summary.annualizedOperatingCashBurnUsd * 12, 2)
      : null;
  }
}

function applyVetoRules(summary: PennyStockFilingSummary) {
  for (const evidence of summary.riskEvidence) {
    if (evidence.flag === "going-concern" && evidence.eventStatus === "confirmed") {
      summary.vetoReasons.push(`Recent ${evidence.form} contains going-concern language.`);
    }
    if (evidence.flag === "reverse-split" && evidence.eventStatus === "confirmed") {
      summary.vetoReasons.push(`Recent ${evidence.form} reports an implemented reverse split.`);
    } else if (
      evidence.flag === "reverse-split"
      && ["planned", "conditional", "unclear"].includes(evidence.eventStatus ?? "unclear")
    ) {
      summary.reviewReasons.push(
        `Recent ${evidence.form} has ${evidence.eventStatus ?? "unclear"} reverse-split evidence requiring issuer review.`,
      );
    }
    if (
      evidence.flag === "listing-compliance"
      && evidence.eventStatus === "confirmed"
    ) {
      summary.vetoReasons.push(`Recent ${evidence.form} reports a delisting notice or determination.`);
    } else if (
      evidence.flag === "listing-compliance"
      && evidence.eventStatus !== "boilerplate"
    ) {
      summary.reviewReasons.push(
        `Recent ${evidence.form} contains unresolved listing-compliance evidence.`,
      );
    }
  }
  if ((summary.sharesOutstandingGrowthPct ?? 0) >= 100) {
    summary.vetoReasons.push(
      `Reported shares outstanding increased ${summary.sharesOutstandingGrowthPct?.toFixed(1)}%.`,
    );
    summary.riskEvidence.push(factEvidence(summary, "rapid-share-growth", "veto"));
  } else if ((summary.sharesOutstandingGrowthPct ?? 0) >= 50) {
    summary.riskEvidence.push(factEvidence(summary, "rapid-share-growth", "warning"));
  }
  if (
    summary.estimatedCashRunwayMonths != null
    && summary.estimatedCashRunwayMonths < 6
  ) {
    summary.vetoReasons.push(
      `Estimated cash runway is ${summary.estimatedCashRunwayMonths.toFixed(1)} months.`,
    );
    summary.riskEvidence.push(factEvidence(summary, "short-cash-runway", "veto"));
  }
  summary.vetoReasons = [...new Set(summary.vetoReasons)];
  summary.reviewReasons = [...new Set(summary.reviewReasons)];
}

function factEvidence(
  summary: PennyStockFilingSummary,
  flag: PennyStockSecRiskFlag,
  severity: PennyStockSecEvidence["severity"],
): PennyStockSecEvidence {
  const evidence = flag === "rapid-share-growth"
    ? `Companyfacts shares-outstanding growth: ${summary.sharesOutstandingGrowthPct?.toFixed(1)}%.`
    : `Companyfacts estimated cash runway: ${summary.estimatedCashRunwayMonths?.toFixed(1)} months.`;
  return {
    flag,
    severity,
    eventStatus: "confirmed",
    classificationReason: "Structured Companyfacts threshold.",
    form: summary.latestPeriodicForm ?? "companyfacts",
    filedAt: summary.latestPeriodicFiledAt ?? "",
    accessionNumber: "",
    sourceUrl: summary.cik
      ? `${SEC_COMPANY_FACTS_BASE}/CIK${summary.cik}.json`
      : SEC_COMPANY_FACTS_BASE,
    evidence,
  };
}

async function fetchCorporateActions(input: {
  symbols: string[];
  asOf: Date;
  headers: Record<string, string>;
  fetchFn: FetchLike;
}): Promise<Record<string, PennyStockCorporateAction[]>> {
  return (await fetchCorporateActionsWithCoverage(input)).actions;
}

async function fetchCorporateActionsWithCoverage(input: {
  symbols: string[];
  asOf: Date;
  headers: Record<string, string>;
  fetchFn: FetchLike;
}): Promise<{
  actions: Record<string, PennyStockCorporateAction[]>;
  available: boolean;
}> {
  const output: Record<string, PennyStockCorporateAction[]> = Object.fromEntries(
    input.symbols.map((symbol) => [symbol, [] as PennyStockCorporateAction[]]),
  );
  if (!input.symbols.length) return { actions: output, available: true };
  const url = new URL(ALPACA_CORPORATE_ACTIONS_URL);
  url.searchParams.set("symbols", input.symbols.join(","));
  url.searchParams.set(
    "types",
    "reverse_split,forward_split,unit_split,stock_merger,cash_merger,stock_and_cash_merger,redemption,worthless_removal,name_change,reorganization",
  );
  url.searchParams.set(
    "start",
    new Date(input.asOf.getTime() - 730 * 86_400_000).toISOString().slice(0, 10),
  );
  url.searchParams.set("end", input.asOf.toISOString().slice(0, 10));
  url.searchParams.set("limit", "1000");
  const body = await safeFetchJson(url.toString(), input.headers, input.fetchFn);
  if (!isRecord(body)) return { actions: output, available: false };
  for (const [key, value] of Object.entries(body)) {
    if (!Array.isArray(value)) continue;
    const type = singularActionType(key);
    for (const raw of value) {
      if (!isRecord(raw)) continue;
      const symbol = safeSymbol(String(
        raw.symbol ?? raw.old_symbol ?? raw.initiating_symbol ?? "",
      ));
      if (!symbol || !output[symbol]) continue;
      output[symbol].push({
        type,
        processDate: String(raw.process_date ?? raw.ex_date ?? raw.payable_date ?? ""),
        source: ALPACA_CORPORATE_ACTIONS_URL,
      });
    }
  }
  return { actions: output, available: true };
}

function factRows(
  taxonomy: Record<string, unknown>,
  concept: string,
  unit: string,
  asOf: Date,
) {
  const raw = isRecord(taxonomy[concept]) && isRecord(taxonomy[concept].units)
    ? taxonomy[concept].units
    : {};
  const rows = Array.isArray(raw[unit]) ? raw[unit] : [];
  const asOfDate = asOf.toISOString().slice(0, 10);
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const filed = String(row.filed ?? "");
    const end = String(row.end ?? "");
    const value = Number(row.val);
    if (!Number.isFinite(value) || filed > asOfDate || end > asOfDate) return [];
    return [{
      value,
      filed,
      start: String(row.start ?? end),
      end,
      form: String(row.form ?? ""),
    }];
  });
}

function firstAvailableFact(
  taxonomy: Record<string, unknown>,
  concepts: string[],
  unit: string,
  asOf: Date,
  preferDuration = false,
) {
  for (const concept of concepts) {
    const rows = factRows(taxonomy, concept, unit, asOf)
      .filter((row) => !preferDuration || row.start !== row.end)
      .sort((left, right) =>
        right.filed.localeCompare(left.filed) || right.end.localeCompare(left.end)
      );
    if (rows[0]) return rows[0];
  }
  return null;
}

async function safeFetchJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: FetchLike,
): Promise<unknown> {
  const response = await fetchFn(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

function stripMarkup(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value: string, index: number) {
  const start = Math.max(0, index - 70);
  return value.slice(start, Math.min(value.length, index + 210)).trim();
}

function safeDocumentName(value: string) {
  return /^[A-Za-z0-9_.-]{1,255}$/.test(value) && !value.includes("..");
}

function singularActionType(value: string) {
  const mapping: Record<string, string> = {
    reverse_splits: "reverse_split",
    forward_splits: "forward_split",
    unit_splits: "unit_split",
    stock_mergers: "stock_merger",
    cash_mergers: "cash_merger",
    stock_and_cash_mergers: "stock_and_cash_merger",
    worthless_removals: "worthless_removal",
    name_changes: "name_change",
    reorganizations: "reorganization",
    redemptions: "redemption",
  };
  return mapping[value] ?? value.replace(/s$/, "");
}

function daysBetween(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.abs(rightTime - leftTime) / 86_400_000
    : 0;
}

async function mapWithConcurrency<T, U>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await task(values[index]);
      }
    }),
  );
  return results;
}

function safeSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z][A-Z.]{0,9}$/.test(symbol) ? symbol : "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
