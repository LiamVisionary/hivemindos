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
  loopContractForPrompt,
  parseLoopSelfReport,
  runLoopGates,
  type LoopGateCommandResult,
  type LoopGateCommandRunner,
  type LoopGateJudge,
  type LoopJudgeVerdict,
  type LoopSelfReportEntry,
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
