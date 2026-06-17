"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyableCodeLineProps = {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  codeClassName?: string;
  buttonClassName?: string;
  disabled?: boolean;
};

export function CopyableCodeLine({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
  codeClassName,
  buttonClassName,
  disabled,
}: CopyableCodeLineProps) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  async function copyValue() {
    if (!value || disabled) return;
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-soft)] p-2",
        className,
      )}
    >
      <code
        className={cn(
          "min-w-0 rounded-[5px] bg-[var(--field)] px-2 py-1.5 font-mono text-[11px] font-semibold leading-snug text-[var(--foreground)] [overflow-wrap:anywhere]",
          codeClassName,
        )}
      >
        {value || "Not available"}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="secondary"
        className={cn("h-8 w-8", buttonClassName)}
        aria-label={copied ? copiedLabel : label}
        title={copied ? copiedLabel : label}
        disabled={!value || disabled}
        onClick={() => void copyValue()}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}
