export {
  applyLoopReceipts,
  discoverLoop,
  loopCompletionBlock,
  loopMaxAttempts,
  mergeLoopReceipts,
  normalizeLoopReceipts,
  normalizeLoopSpec,
  recordLoopAntiPatterns,
  recordLoopExperiment,
  withObservation,
  type LoopDiscoveryInput,
  type LoopExperimentInput,
} from "@/lib/services/loops/loop-engine";
export {
  findLoopPattern,
  listLoopPatterns,
  LOOP_PATTERN_REGISTRY,
  type LoopPatternCost,
  type LoopPatternDefinition,
  type LoopPatternRegistry,
  type LoopPatternRisk,
  type LoopReadinessLevel,
} from "@/lib/services/loops/pattern-registry";
export {
  buildLoopReadinessReport,
  renderLoopEngineeringArtifacts,
  type LoopEngineeringArtifacts,
  type LoopReadinessFinding,
  type LoopReadinessReport,
  type LoopReadinessSignal,
  type LoopReadinessTotals,
} from "@/lib/services/loops/loop-readiness";
export {
  LOOP_TEMPLATES,
  buildLoopFromTemplate,
  buildOperatingUnitLearningLoop,
  listLoopTemplates,
  type BuildLoopTemplateInput,
  type LoopTemplateDefinition,
  type LoopTemplateId,
  type OperatingUnitLearningLoopInput,
} from "@/lib/services/loops/loop-templates";
export {
  LOOP_VERIFIER_REGISTRY,
  listLoopVerifiers,
  loopGateFromVerifier,
  type LoopVerifierDefinition,
  type LoopVerifierId,
} from "@/lib/services/loops/verifier-registry";
export {
  computeLoopCapabilityCapital,
  type ComputeLoopCapabilityCapitalInput,
  type LoopMetricAgent,
  type LoopMetricTask,
} from "@/lib/services/loops/loop-metrics";
export {
  detectArtifacts,
  isReservedOrMockUrl,
  loopContractForPrompt,
  parseLoopSelfReport,
  runLoopGates,
  type LoopGateCommandResult,
  type LoopGateCommandRunner,
  type LoopGateJudge,
  type LoopJudgeVerdict,
  type LoopSelfReportEntry,
  type LoopUrlProbeResult,
  type LoopUrlProber,
  type RunLoopGatesInput,
  type RunLoopGatesResult,
} from "@/lib/services/loops/loop-runner";
export {
  defaultLoopControlPolicy,
  loopControlAllowsProgress,
  loopControlKey,
  updateLoopControlPolicy,
  type LoopControlPolicy,
  type LoopControlRegistry,
  type LoopControlStatus,
  type LoopControlTarget,
  type LoopControlTargetKind,
} from "@/lib/services/loops/loop-control";
