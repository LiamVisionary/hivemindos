import type { LoopSpec } from "@/lib/types/loops";

export type PennyStockBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PennyStockQuote = {
  timestamp: string;
  bidPriceUsd: number;
  askPriceUsd: number;
  bidSize: number;
  askSize: number;
};

export type PennyStockUniverseRow = {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
  sector: string;
  industry: string;
  priceUsd: number;
  marketCapUsd: number;
  currentVolume: number;
};

export type PennyStockSecRiskFlag =
  | "atm-or-shelf"
  | "convertible-or-warrant"
  | "going-concern"
  | "reverse-split"
  | "listing-compliance"
  | "rapid-share-growth"
  | "short-cash-runway"
  | "operating-loss";

export type PennyStockSecEvidence = {
  flag: PennyStockSecRiskFlag;
  severity: "info" | "warning" | "veto";
  eventStatus?: "confirmed" | "planned" | "conditional" | "boilerplate" | "unclear";
  classificationReason?: string;
  form: string;
  filedAt: string;
  accessionNumber: string;
  sourceUrl: string;
  evidence: string;
};

export type PennyStockFilingSummary = {
  cik: string | null;
  latestPeriodicForm: string | null;
  latestPeriodicFiledAt: string | null;
  latestEventForm: string | null;
  latestEventFiledAt: string | null;
  sharesOutstandingLatest: number | null;
  sharesOutstandingPrior: number | null;
  sharesOutstandingGrowthPct: number | null;
  cashUsd: number | null;
  annualizedOperatingCashBurnUsd: number | null;
  estimatedCashRunwayMonths: number | null;
  riskEvidence: PennyStockSecEvidence[];
  vetoReasons: string[];
  reviewReasons: string[];
  coverage: "complete" | "partial" | "missing";
};

export type PennyStockCorporateAction = {
  type: string;
  processDate: string;
  source: string;
};

export type PennyStockFilingMarker = {
  form: string;
  filedAt: string;
  accessionNumber: string;
  sourceUrl: string;
};

export type PennyStockRiskUpdateSignal = {
  cik: string | null;
  filingMarkers: PennyStockFilingMarker[];
  corporateActions: PennyStockCorporateAction[];
  secCoverage: "available" | "missing";
  corporateActionCoverage: "available" | "missing";
};

export type PennyStockMethodEvidence = {
  observations: number;
  limitTouches: number;
  limitTouchRatePct: number;
  limitTouchWilsonLowPct: number;
  bouncesAfterTouch: number;
  bounceRatePct: number;
  bounceWilsonLowPct: number;
};

export type PennyStockExecutionEvidence = {
  quoteObservations: number;
  quoteStartAt: string | null;
  quoteEndAt: string | null;
  medianSpreadBps: number | null;
  p90SpreadBps: number | null;
  medianBidSize: number | null;
  medianAskSize: number | null;
  estimatedFillRatioPct: number;
  displayedSizeParticipationPct?: number;
  queuePriorityKnown?: false;
  source: "alpaca-sip-quotes" | "daily-bar-fallback";
};

export type PennyStockConservativeEv = {
  touchProbabilityLowPct: number;
  bounceProbabilityLowPct: number;
  roundTripFrictionPct: number;
  expectedValueLowPctPerOrder: number;
  positive: boolean;
};

export type PennyStockResearchRow = PennyStockUniverseRow & {
  rank: number;
  score: number;
  bars90: number;
  averageDailyVolume90: number;
  medianDailyVolume90: number;
  averageDailyDollarVolume90: number;
  volumeTrend20VsPriorPct: number;
  volatility90Pct: number;
  maxDrawdown90Pct: number;
  return90Pct: number;
  zeroVolumeDays90: number;
  methodEvidence: PennyStockMethodEvidence;
  executionEvidence: PennyStockExecutionEvidence;
  conservativeEv: PennyStockConservativeEv;
  filings: PennyStockFilingSummary;
  corporateActions: PennyStockCorporateAction[];
  vetoed: boolean;
  vetoReasons: string[];
  reviewRequired: boolean;
  reviewReasons: string[];
  evidence: string[];
  risks: string[];
};

export type PennyPaperStrategy = {
  entryDiscountPct: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldDays: number;
  orderExpiryDays: number;
};

export type PennyPaperSimulationAssumptions = {
  startingCashUsd: number;
  notionalUsdPerSymbol: number;
  executionCostBpsPerSide: number;
  adverseSelectionBps: number;
  maximumQuoteParticipationPct: number;
  dailyVolumeParticipationPct: number;
  gapPenaltyPct: number;
  maxPortfolioDrawdownPct: number;
  dailyLossLimitPct: number;
  maxConcurrentPositions: number;
  costStressMultiplier: number;
};

export type PennyPaperTrade = {
  symbol: string;
  side: "buy" | "sell";
  date: string;
  priceUsd: number;
  quantity: number;
  requestedQuantity: number;
  fillRatioPct: number;
  notionalUsd: number;
  executionCostUsd: number;
  reason:
    | "limit-fill"
    | "take-profit"
    | "stop-loss"
    | "max-hold"
    | "portfolio-kill-switch"
    | "daily-loss-limit";
  executionModel: "sip-quote" | "daily-bar-pessimistic";
  pnlUsd?: number;
};

export type PennyPaperSimulationResult = {
  strategy: PennyPaperStrategy;
  assumptions: PennyPaperSimulationAssumptions;
  startDate: string;
  endDate: string;
  startingCashUsd: number;
  endingEquityUsd: number;
  totalPnlUsd: number;
  returnPct: number;
  maxDrawdownPct: number;
  fills: number;
  partialFills: number;
  closedTrades: number;
  winningTrades: number;
  winRatePct: number;
  expiredOrders: number;
  liquidityRejectedFills: number;
  gapOrHaltPenalties: number;
  portfolioKillSwitchTriggered: boolean;
  dailyLossLimitTriggers: number;
  executionCostsUsd: number;
  dailyReturnsPct: number[];
  dailyPositions: number[];
  trades: PennyPaperTrade[];
};

export type PennyPaperSelectorWeights = {
  liquidity: number;
  marketCap: number;
  consistency: number;
  conservativeEv: number;
  volumeTrend: number;
  drawdownSafety: number;
  volatilityFitness: number;
  executionQuality: number;
  secRiskPenalty: number;
};

export type PennyPaperSelection = {
  schemaVersion: 2;
  runId: string;
  reviewedAt: string;
  reviewedBy: string;
  selectedSymbols: string[];
  heldCash: boolean;
  rationale: string;
  symbolRationales: Record<string, string>;
  rejectedSymbols: Record<string, string>;
  researchArtifactHash: string;
  selectorPolicyVersion: number;
  portfolioControls: {
    maximumNames: 3;
    requirePositiveConservativeEv: true;
    blockVetoedCandidates: true;
    blockUnresolvedIssuerRisk: true;
    diversifySectorsWhenPossible: true;
  };
  researchOnly: true;
  liveTradingEnabled: false;
};

export type PennyPaperWalkForwardWindow = {
  id: string;
  regime: "lower-volatility" | "higher-volatility";
  startDate: string;
  endDate: string;
  baseline: PennyPaperSimulationResult;
  treatment: PennyPaperSimulationResult;
  returnDeltaPct: number;
};

export type PennyPaperStatisticalEvidence = {
  deflatedSharpe: {
    observedSharpe: number;
    nullMaxSharpe: number;
    probability: number;
  };
  pbo: {
    coverage: "complete" | "missing";
    segments: number;
    combinations: number;
    probability: number;
    reason?: string;
  };
  placebo: {
    iterations: number;
    pValue: number;
    candidateMeanPct: number;
    placeboCi95Pct: [number, number];
  };
  fdr: {
    familySize: number;
    candidatePValue: number;
    candidateQValue: number;
  };
  benchmarks: {
    cashPnlUsd: number;
    baselinePnlUsd: number;
    simplePnlUsd: number;
    randomMedianPnlUsd: number;
    treatmentPnlUsd: number;
  };
  parameterNeighborhood: {
    variants: number;
    positiveVariants: number;
    medianPnlUsd: number;
  };
  costStress: Array<{
    multiplier: 1 | 2 | 3;
    pnlUsd: number;
    maxDrawdownPct: number;
  }>;
  regimePnlUsd: Record<"lower-volatility" | "higher-volatility", number>;
};

export type PennyPaperEvolutionGates = {
  enoughForwardWindows: boolean;
  minimumFills: boolean;
  positiveAggregatePnl: boolean;
  beatsBaselinePnl: boolean;
  beatsCashAndSimpleBenchmarks: boolean;
  winsMostWindows: boolean;
  positiveBootstrapLowerBound: boolean;
  drawdownNotWorse: boolean;
  positiveAcrossRegimes: boolean;
  deflatedSharpe: boolean;
  pbo: boolean;
  placebo: boolean;
  falseDiscoveryRate: boolean;
  parameterNeighborhood: boolean;
  pessimisticCostStress: boolean;
  newEvidenceAvailable: boolean;
  oneMajorChangeOnly: boolean;
};

export type PennyPaperReflection = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  observedFailure: string;
  causalHypothesis: string;
  proposedChange: string;
  majorChangeCount: 1;
  preTestPrediction: string;
  falsificationCriteria: string[];
  result: string;
  decision: "retain" | "reject";
  failedGates: string[];
  priorAsOf: string | null;
  currentAsOf: string;
  newEvidenceAvailable: boolean;
  researchOnly: true;
};

export type PennyPaperEvolutionResult = {
  schemaVersion: 2;
  runId: string;
  evaluatedAt: string;
  symbols: string[];
  historyBars: number;
  training: {
    startDate: string;
    endDate: string;
    variantsEvaluated: number;
    selectedScore: number;
  };
  baselineStrategy: PennyPaperStrategy;
  proposedStrategy: PennyPaperStrategy;
  majorChange: string;
  baselineAggregatePnlUsd: number;
  treatmentAggregatePnlUsd: number;
  aggregatePnlDeltaUsd: number;
  baselineAggregateReturnPct: number;
  treatmentAggregateReturnPct: number;
  treatmentMaxDrawdownPct: number;
  baselineMaxDrawdownPct: number;
  winningWindows: number;
  pairedDailyReturnCi95Pct: [number, number];
  statisticalEvidence: PennyPaperStatisticalEvidence;
  gates: PennyPaperEvolutionGates;
  decision: "accepted" | "rejected" | "cash";
  policyVersionBefore: number;
  policyVersionAfter: number;
  windows: PennyPaperWalkForwardWindow[];
  loop: LoopSpec;
  researchOnly: true;
  liveTradingEnabled: false;
};

export type PennyPaperPolicy = {
  schemaVersion: 2;
  version: number;
  strategy: PennyPaperStrategy;
  selectorWeights: PennyPaperSelectorWeights;
  selectorPolicyVersion: number;
  acceptedAt: string | null;
  acceptedFromRunId: string | null;
  lastEvidenceAsOf: string | null;
  researchOnly: true;
  liveTradingEnabled: false;
};

export type PennyPaperCandidateOutcome = {
  symbol: string;
  sourceRunId: string;
  sourceAsOf: string;
  sourceRank: number;
  selected: boolean;
  sourceScreenPriceUsd?: number;
  referenceDate?: string;
  referenceCloseUsd?: number;
  observedThrough: string;
  horizons: Record<"1" | "5" | "10" | "20", {
    matured: boolean;
    observedDate?: string | null;
    observedCloseUsd?: number | null;
    closeReturnPct: number | null;
    maximumFavorableExcursionPct: number | null;
    maximumAdverseExcursionPct: number | null;
  }>;
  decisionReviews?: Partial<Record<
    "1" | "5" | "10" | "20",
    PennyPaperDecisionReview
  >>;
};

export type PennyPaperCatalystHypothesis = {
  kind:
    | "sec-filing"
    | "corporate-action"
    | "volume-shock"
    | "overnight-gap"
    | "unexplained-material-move";
  date: string | null;
  description: string;
  evidenceClass: "confirmed-event" | "market-pattern" | "missing";
  sourceUrl: string | null;
};

export type PennyPaperDecisionReview = {
  horizonSessions: 1 | 5 | 10 | 20;
  status: "supported" | "challenged" | "mixed" | "inconclusive";
  assessment: string;
  logicErrorCandidate: boolean;
  sourceDecision: "selected" | "rejected";
  rejectionBasis:
    | "selected"
    | "issuer-veto"
    | "non-positive-conservative-ev"
    | "basket-capacity-or-diversification";
  methodCounterfactual: {
    model: "standing-limit-daily-bar-pessimistic";
    fills: number;
    closedTrades: number;
    returnPct: number;
    maxDrawdownPct: number;
    entryDate: string | null;
    entryPriceUsd: number | null;
    exitDate: string | null;
    exitPriceUsd: number | null;
    exitReason: PennyPaperTrade["reason"] | null;
  };
  entryDistancePanel?: Array<{
    entryDiscountPct: number;
    activePolicy: boolean;
    fills: number;
    returnPct: number;
    maxDrawdownPct: number;
    costStressReturnPct: Record<"1" | "2" | "3", number>;
  }>;
  marketContext: {
    maximumVolumeMultiple: number;
    maximumAbsoluteOvernightGapPct: number;
    materialMove: boolean;
  };
  catalystHypotheses: PennyPaperCatalystHypothesis[];
  causalClaimEstablished: false;
};

export type PennyPaperOutcomeLearning = {
  schemaVersion: 1 | 2;
  evaluatedAt: string;
  outcomes: PennyPaperCandidateOutcome[];
  completeTwentySessionOutcomes: number;
  selectorPolicyVersionBefore: number;
  selectorPolicyVersionAfter: number;
  proposedWeights: PennyPaperSelectorWeights;
  promoted: boolean;
  promotionReason: string;
  learningTarget?: "standing-limit-counterfactual-return";
  catalystReviewSymbols?: string[];
  decisionCalibration?: {
    latestMaturedCandidateReviews: number;
    maturedHorizonReviews: Record<"1" | "5" | "10" | "20", number>;
    supported: number;
    challenged: number;
    mixed: number;
    inconclusive: number;
    logicErrorCandidates: number;
    materialMoverReviews: number;
    catalystEvidenceReviews: number;
    policyMutationAllowed: false;
  };
  labelCoverage?: {
    sourceCandidates: number;
    candidateOutcomes: number;
    sourceCoveragePct: number;
    maturityEligibleCandidates20: number;
    maturedCandidates20: number;
    maturityCoveragePct20: number;
    promotionCoverageGate: boolean;
  };
  entryDistanceLearning?: {
    registeredProspectively: true;
    activeEntryDiscountPct: number;
    maturedPanelObservations20: number;
    variants: Array<{
      entryDiscountPct: number;
      observations: number;
      fills: number;
      trainingObservations: number;
      holdoutObservations: number;
      posteriorFillProbabilityPct: number;
      meanReturnPctPerOrder: number;
      meanReturnPctPerFill: number | null;
      trainingMeanReturnPctPerOrder: number | null;
      holdoutMeanReturnPctPerOrder: number | null;
      worstDrawdownPct: number;
      meanCostStressReturnPct: Record<"1" | "2" | "3", number>;
    }>;
    minimumProspectiveObservations: 100;
    frozenHoldoutObservations: 25;
    promotionEligible: boolean;
    conclusion: string;
    policyMutationAllowed: false;
  };
  researchOnly: true;
};

export type PennyStockResearchArtifact = {
  schemaVersion: 2;
  runId: string;
  researchedAt: string;
  asOf: string;
  universe: {
    minimumPriceUsd: number;
    maximumPriceUsd: number;
    minimumMarketCapUsd: number;
    maximumMarketCapUsd: number;
    minimumCurrentVolume: number;
    eligibleBeforeHistory: number;
    historyCandidates: number;
    snapshotPath: string;
    snapshotHash: string;
    pointInTimeCoverage: "current-snapshot-only" | "multi-snapshot";
  };
  method: {
    description: string;
    baselineStrategy: PennyPaperStrategy;
    selectorWeights: PennyPaperSelectorWeights;
    prospectiveEntryDiscountsPct?: number[];
    prospectiveRegisteredAt?: string;
  };
  candidates: PennyStockResearchRow[];
  dataSources: Array<{
    name: string;
    url: string;
    role: string;
  }>;
  limitations: string[];
  artifactHash: string;
  researchOnly: true;
  liveTradingEnabled: false;
};

export type PennyStockMonitoringEvidence = {
  execution: Record<string, PennyStockExecutionEvidence>;
  riskUpdates: Record<string, PennyStockRiskUpdateSignal>;
  refreshedFilings: Record<string, PennyStockFilingSummary>;
  deepRiskRefreshSymbols: string[];
};

export type PennyStockMonitorCandidate = {
  symbol: string;
  sourceRank: number;
  referencePriceUsd: number;
  priorExecutionEvidence: PennyStockExecutionEvidence;
  currentExecutionEvidence: PennyStockExecutionEvidence;
  p90SpreadChangeBps: number | null;
  fillRatioChangePct: number;
  filingMarkers: PennyStockFilingMarker[];
  newFilingMarkers: PennyStockFilingMarker[];
  corporateActions: PennyStockCorporateAction[];
  newCorporateActions: PennyStockCorporateAction[];
  refreshedFilingSummary: PennyStockFilingSummary | null;
  alerts: string[];
};

export type PennyStockMonitorArtifact = {
  schemaVersion: 1;
  monitorId: string;
  observedAt: string;
  sourceRunId: string;
  sourceAsOf: string;
  sourceResearchArtifactHash: string;
  previousMonitorId: string | null;
  marketSession: {
    timeZone: "America/New_York";
    localDate: string;
    localTime: string;
    regularHoursWindow: "09:30-16:00";
    withinScheduledRegularHours: boolean;
    calendarLimitation: string;
  };
  candidates: PennyStockMonitorCandidate[];
  newEvidenceAvailable: boolean;
  materialAlerts: string[];
  deepRiskRefreshSymbols: string[];
  policyMutationAllowed: false;
  researchOnly: true;
  liveTradingEnabled: false;
  artifactHash: string;
};

export type PennyPaperWeeklyAudit = {
  schemaVersion: 1;
  auditId: string;
  auditedAt: string;
  window: {
    firstResearchAsOf: string | null;
    lastResearchAsOf: string | null;
    completedRuns: number;
    failedRuns: number;
    awaitingReviewRuns: number;
    distinctUniverseSnapshots: number;
    monitorArtifacts: number;
  };
  decisions: {
    accepted: number;
    rejected: number;
    cash: number;
    selectedCandidateSlots: number;
  };
  evaluationMetrics: {
    meanBaselinePnlUsd: number | null;
    meanTreatmentPnlUsd: number | null;
    worstTreatmentDrawdownPct: number | null;
    gatePassRates: Record<string, {
      passed: number;
      evaluated: number;
      ratePct: number;
    }>;
    positiveCostStressRuns: Record<"1" | "2" | "3", number>;
  };
  maturedOutcomes: {
    horizon1: number;
    horizon5: number;
    horizon10: number;
    horizon20: number;
    selectedHorizon20: number;
    unselectedHorizon20: number;
    selectedMeanCloseReturnPct: number | null;
    unselectedMeanCloseReturnPct: number | null;
    latestDecisionReviews?: number;
    supportedDecisions?: number;
    challengedDecisions?: number;
    mixedDecisions?: number;
    inconclusiveDecisions?: number;
    logicErrorCandidates?: number;
    materialMoverReviews?: number;
    sourceCoveragePct?: number | null;
    maturityCoveragePct20?: number | null;
    outcomeCompletenessGate?: boolean;
  };
  prospectiveEntryLearning: {
    maturedPanelObservations20: number;
    minimumRequired: number;
    promotionEligibleForFullGateStack: boolean;
    variants: Array<{
      entryDiscountPct: number;
      fills: number;
      observations: number;
      meanReturnPctPerOrder: number;
      holdoutMeanReturnPctPerOrder: number | null;
    }>;
  };
  monitoring: {
    artifactsWithNewEvidence: number;
    materialAlerts: number;
    deepRiskRefreshes: number;
    medianObservedP90SpreadBps: number | null;
  };
  policy: {
    strategyVersion: number;
    selectorVersion: number;
  };
  readinessGates: {
    multipleDistinctSnapshots: boolean;
    minimumCompletedRuns: boolean;
    intradayCoverage: boolean;
    selectorSampleSize: boolean;
    frozenSelectorHoldout: boolean;
    outcomeCompleteness: boolean;
    prospectiveEntrySample: boolean;
  };
  conclusion: string;
  policyMutationAllowed: false;
  researchOnly: true;
  liveTradingEnabled: false;
  artifactHash: string;
};

export type PennyPaperRunManifest = {
  schemaVersion: 2;
  runId: string;
  status: "completed" | "failed";
  researchedAt: string;
  completedAt: string;
  selectedSymbols: string[];
  heldCash: boolean;
  policyVersionBefore: number;
  policyVersionAfter: number;
  evolutionDecision: "accepted" | "rejected" | "cash";
  researchPath: string;
  researchReportPath: string;
  selectionPath: string;
  evolutionPath: string;
  reflectionPath: string;
  outcomesPath: string;
  reportPath: string;
  manifestPath: string;
  researchArtifactHash: string;
  researchOnly: true;
  liveTradingEnabled: false;
  failureReason?: string;
};
