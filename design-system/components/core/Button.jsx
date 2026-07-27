import * as React from "react";

/* Button — HivemindOS primary action control.
   Refined "hive" language (trade-desk.css .fb-btn): pill-shaped, HONEY primary
   with dark text, weight 500 (never bold), warm hairline ghost/outline.
   Variants: default (honey primary), secondary, outline, ghost, danger, link.
   Sizes: xs, sm, default, lg, icon. */

const VARIANTS = {
  default: {
    background: "var(--button-primary)",
    color: "var(--button-primary-foreground)",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--button-secondary)",
    color: "var(--button-secondary-foreground)",
    border: "1px solid var(--button-border)",
  },
  outline: {
    background: "transparent",
    color: "var(--fg-2)",
    border: "1px solid var(--line-2)",
  },
  ghost: {
    background: "transparent",
    color: "var(--button-muted-foreground)",
    border: "1px solid transparent",
  },
  danger: {
    background: "var(--button-destructive)",
    color: "#2a0f0c",
    border: "1px solid transparent",
  },
  link: {
    background: "transparent",
    color: "var(--honey)",
    border: "1px solid transparent",
    textDecoration: "underline",
    textUnderlineOffset: "4px",
  },
};

const PILL = "var(--radius-pill)";
const SIZES = {
  xs: { height: 26, padding: "0 12px", fontSize: 12, borderRadius: PILL, gap: 5 },
  sm: { height: 30, padding: "0 12px", fontSize: 12, borderRadius: PILL, gap: 6 },
  default: { height: 36, padding: "0 15px", fontSize: 12.5, borderRadius: PILL, gap: 7 },
  lg: { height: 42, padding: "0 22px", fontSize: 13.5, borderRadius: PILL, gap: 8 },
  icon: { width: 34, height: 34, padding: 0, borderRadius: 11, gap: 0 },
};

export function Button({
  variant = "default",
  size = "default",
  disabled = false,
  isLoading = false,
  children,
  style,
  ...props
}) {
  const v = VARIANTS[variant] || VARIANTS.default;
  const s = SIZES[size] || SIZES.default;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  return (
    <button
      data-slot="button"
      data-variant={variant}
      disabled={disabled || isLoading}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        fontFamily: "var(--font-body)",
        fontWeight: v.fontWeight || 400,
        lineHeight: 1,
        cursor: disabled || isLoading ? "not-allowed" : "pointer",
        opacity: disabled || isLoading ? 0.5 : 1,
        transform: active ? "scale(0.99)" : "scale(1)",
        transition: "background var(--dur) ease, border-color var(--dur) ease, transform var(--dur-fast) ease, filter var(--dur) ease",
        filter: hover && !disabled ? "brightness(1.06)" : "none",
        ...v,
        ...s,
        ...style,
      }}
      {...props}
    >
      {isLoading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: "hm-spin 0.8s linear infinite" }} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <style>{"@keyframes hm-spin{to{transform:rotate(360deg)}}"}</style>
    </svg>
  );
}
