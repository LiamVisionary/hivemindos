// src/components/swarm — the live MiroShark data contract.
// The visual Swarm view was replaced by @/components/simulation (the redesigned
// Simulation UI). This module now only exports the shared run/market/agent types
// that the controller, swarm-transformers, and SwarmPanel still use.
export type {
  SwarmRun, SwarmAgent, SwarmDecision, SwarmSocialPost, SwarmMarket,
  SwarmThreadPost, SwarmEventItem, SwarmTemplate, SwarmTemplateField, RunState, TemplateId,
} from "./swarm-data";
