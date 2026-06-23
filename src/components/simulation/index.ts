/* index.ts — barrel export for the Simulation drop-in. */

export { SimulationView } from "./SimulationView";
export type { SimulationViewProps } from "./SimulationView";

// Composed surfaces
export { SimDetail, SimLiveDetail, SimRunDetail, SimArtifact, SimRunHeader, SimStatsRow, SimPanel } from "./detail";
export { PredictionMarketView } from "./PredictionMarket";
export { XThreadView, RedditView, ResearchView, OpsView } from "./outputs";
export { SimRunRow, SimRunCard, SimTemplatesRail } from "./rail";
export { Composer } from "./Composer";
export { Publish } from "./Publish";
export { Intelligence } from "./Intelligence";
export { SlideOver, XEditor, FLbl, FInput, FArea, FPills } from "./SlideOver";

// Theater + atoms
export {
  SimStatus, SimTemplateTag, SimFaction, SimMetric, SimChip, SimTags, SimAgent,
  SimDecisionLog, SimTape, SimHeadlines, SimRunTable, SimControls, SimKnobs,
} from "./theater";
export { Sparkline, SimTrendChart, SimMetricChart, SimProgressBar, SimProgressRing } from "./charts";
export { Badge, Button, Toggle, Dot, Summary, frTone } from "./primitives";
export { Icon, Chevron } from "./icons";

// Data + types (swap for your API)
export * from "./sim-data";

// Live-data wiring (real MiroShark data → the UI)
export { SimDataProvider, useSimData, mockDataset } from "./sim-context";
export type {
  SimDataset, SimStat, SimLaunchPayload, TapeData, RoundRow, ResearchContent, OpsEvent,
} from "./sim-context";
export { buildSimDataset } from "./adapt-miroshark";
export type { MiroSharkSource } from "./adapt-miroshark";
