import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/* Spinner — the loading-state ring (honey arc). */

type SpinnerProps = React.ComponentProps<"span"> & {
  size?: number;
  tone?: "honey" | "live" | "current";
  label?: React.ReactNode;
};

function Spinner({ className, size = 18, tone = "honey", label, ...props }: SpinnerProps) {
  const color = tone === "honey" ? "text-[var(--honey)]" : tone === "live" ? "text-[var(--live)]" : "";
  const ring = <LoaderCircle className={cn("animate-spin", color)} style={{ width: size, height: size }} aria-hidden />;
  if (!label) return ring;
  return (
    <span className={cn("inline-flex items-center gap-[9px] text-[13px] text-[var(--fg-2)]", className)} {...props}>
      {ring}
      <span>{label}</span>
    </span>
  );
}

export { Spinner };
