import {
  BadgeCheck,
  Bot,
  Cloud,
  Code2,
  Cpu,
  Eye,
  Laptop,
  ListTree,
  Monitor,
  Palette,
  PenLine,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { BeeWorkerClass } from "@/lib/types/agent-runtime";
import type { HiveAgent, HiveMachineKind } from "./fleet-hive-types";

const MACHINE_KIND_GLYPH: Record<HiveMachineKind, LucideIcon> = {
  Desktop: Monitor,
  Laptop,
  "Cloud Server": Cloud,
  "Home Server": Server,
  Edge: Cpu,
  Mobile: Smartphone,
};

const WORKER_CLASS_GLYPH: Record<BeeWorkerClass, LucideIcon> = {
  general: Bot,
  planner: ListTree,
  code: Code2,
  vision: Eye,
  writer: PenLine,
  research: Search,
  artist: Palette,
  ops: Wrench,
  qa: BadgeCheck,
  security: ShieldCheck,
};

export function MachineKindGlyph({ kind, size = 30 }: { kind: HiveMachineKind; size?: number }) {
  const Glyph = MACHINE_KIND_GLYPH[kind] ?? Monitor;
  return <Glyph aria-hidden size={size} strokeWidth={1.65} />;
}

export function AgentNodeGlyph({ agent, size = 28 }: { agent: HiveAgent; size?: number }) {
  const hasCustomIdentity = Boolean(agent.source.customWorkerClass || agent.source.selectedCustomWorkerClassId);
  const Glyph = hasCustomIdentity
    ? Sparkles
    : WORKER_CLASS_GLYPH[agent.source.workerClass ?? "general"] ?? Bot;
  return <Glyph aria-hidden size={size} strokeWidth={1.65} />;
}
