// src/components/fleet/bee-icon.tsx
"use client";

import Image from "next/image";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { BeeWorkerClass } from "@/lib/types/agent-runtime";
import { cn } from "@/lib/utils/cn";

type BeeRole = "queen" | "worker";
const FLEET_QUEEN_BEE_ICON_SCALE = 1.5;

interface BeeIconProps {
  role?: BeeRole;
  workerClass?: BeeWorkerClass;
  size?: number;
  dim?: boolean;
  className?: string;
}

/**
 * Renders one of the repo's bee role icons from /public/icons.
 * `dim` desaturates the icon for idle/inactive cells.
 */
export function BeeIcon({ role = "worker", workerClass = "general", size = 24, dim = false, className }: BeeIconProps) {
  const src = beeRoleIconPath(role, workerClass);
  const displaySize = role === "queen" ? Math.round(size * FLEET_QUEEN_BEE_ICON_SCALE) : size;
  return (
    <Image
      src={src}
      alt=""
      width={displaySize}
      height={displaySize}
      draggable={false}
      className={cn("block object-contain pointer-events-none", className)}
      style={{
        filter: dim ? "saturate(0.55) brightness(0.85)" : undefined,
      }}
      unoptimized
    />
  );
}
