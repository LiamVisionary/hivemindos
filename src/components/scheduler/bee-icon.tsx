"use client";
import Image from "next/image";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { BeeAgentRole, BeeWorkerClass } from "@/lib/types/agent-runtime";
import { cn } from "@/lib/utils/cn";

export function BeeIcon({ role = "worker", workerClass = "general", size = 24, dim, className }: {
  role?: BeeAgentRole; workerClass?: BeeWorkerClass; size?: number; dim?: boolean; className?: string;
}) {
  const src = beeRoleIconPath(role, workerClass);
  return <Image src={src} alt="" width={size} height={size} draggable={false}
    className={cn("block object-contain pointer-events-none", className)}
    style={{ filter: dim ? "saturate(0.55) brightness(0.85)" : undefined }}
    unoptimized />;
}
