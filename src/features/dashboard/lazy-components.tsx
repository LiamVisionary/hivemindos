"use client";

import dynamic from "next/dynamic";

export const AgentWalletCard = dynamic(() => import("@/components/wallet/AgentWalletCard").then((mod) => mod.AgentWalletCard), { ssr: false });
export const AgentWalletCardCompact = dynamic(() => import("@/components/wallet/AgentWalletCardCompact").then((mod) => mod.AgentWalletCardCompact), { ssr: false });
export const AgentCell = dynamic(() => import("@/components/cells/AgentCell").then((mod) => mod.AgentCell), { ssr: false });
export const AgentTaskList = dynamic(() => import("@/components/cells/AgentTaskList").then((mod) => mod.AgentTaskList), { ssr: false });
export const FleetView = dynamic(() => import("@/components/fleet").then((mod) => mod.FleetView), { ssr: false });
export const MachineCell = dynamic(() => import("@/components/cells/MachineCell").then((mod) => mod.MachineCell), { ssr: false });
export const MemoryCell = dynamic(() => import("@/components/cells/MemoryCell").then((mod) => mod.MemoryCell), { ssr: false });
export const SchedulerView = dynamic(() => import("@/components/scheduler").then((mod) => mod.SchedulerView), { ssr: false });
export const SetupCell = dynamic(() => import("@/components/cells/SetupCell").then((mod) => mod.SetupCell), { ssr: false });
export const SwarmView = dynamic(() => import("@/components/swarm").then((mod) => mod.SwarmView), { ssr: false });
export const TaskModal = dynamic(() => import("@/components/task-modal").then((mod) => mod.TaskModal), { ssr: false });
