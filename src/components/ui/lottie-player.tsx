"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";

import { cn } from "@/lib/utils/cn";

type LottiePlayerProps = {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  size?: number;
  ariaLabel?: string;
};

function normalizeLottieSource(src: string) {
  if (/^(?:https?:|data:|blob:)/i.test(src)) {
    return src;
  }

  return src
    .split("/")
    .map((part, index) => {
      if (index === 0 || part.length === 0) {
        return part;
      }

      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join("/");
}

export function LottiePlayer({
  src,
  className,
  loop = true,
  autoplay = true,
  size,
  ariaLabel,
}: LottiePlayerProps) {
  const style = size ? { width: size, height: size } : undefined;
  const normalizedSrc = normalizeLottieSource(src);

  return (
    <span
      className={cn("inline-block", className)}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={style}
    >
      <DotLottieReact
        src={normalizedSrc}
        loop={loop}
        autoplay={autoplay}
        style={{ width: "100%", height: "100%" }}
      />
    </span>
  );
}
