import * as React from "react";

/* Segmented — a pill segmented control. The hive's view/mode switcher
   (walletSegmented, tk-side, fleet ViewModeToggle). Options sit in a pill
   track; the active one fills. `subtle` (honey-soft tint, for view switches) or
   `solid` (honey fill + dark text, for binary toggles like buy/sell). */

export function Segmented({ options, value, defaultValue, onChange, variant = "subtle", size = "default", style, ...props }) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? (options[0] && (options[0].value ?? options[0])));
  const current = controlled ? value : internal;

  const pick = (v) => {
    if (!controlled) setInternal(v);
    onChange?.(v);
  };

  const pad = size === "sm" ? "5px 12px" : "7px 16px";
  const fs = size === "sm" ? 12 : 12.5;

  return (
    <div
      role="group"
      style={{
        display: "inline-flex",
        gap: 3,
        padding: 4,
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--line-2)",
        background: "color-mix(in srgb, var(--panel) 70%, transparent)",
        ...style,
      }}
      {...props}
    >
      {options.map((opt) => {
        const val = opt.value ?? opt;
        const label = opt.label ?? opt;
        const tone = opt.tone; // optional per-option active tone (e.g. "sell")
        const active = current === val;
        const activeBg = variant === "solid"
          ? (tone === "sell" ? "var(--danger)" : "var(--honey)")
          : "var(--honey-soft)";
        const activeColor = variant === "solid"
          ? (tone === "sell" ? "#2a0f0c" : "var(--on-honey)")
          : "var(--honey)";
        return (
          <button
            key={String(val)}
            type="button"
            aria-pressed={active}
            data-active={active ? "" : undefined}
            onClick={() => pick(val)}
            style={{
              border: 0,
              borderRadius: "var(--radius-pill)",
              padding: pad,
              fontFamily: "var(--font-body)",
              fontSize: fs,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: active ? activeBg : "transparent",
              color: active ? activeColor : "var(--fg-3)",
              transition: "background var(--dur) ease, color var(--dur) ease",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
