import * as React from "react";

/* Tooltip — a hover/focus popover. Ported from src/components/ui/tooltip.tsx:
   popover surface, hairline border, small text, arrow, ~120ms delay.
   Pair a plain-English meaning with any technical label. */

export function Tooltip({ content, side = "top", children, delay = 120, style, ...props }) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);

  const show = () => { timer.current = setTimeout(() => setOpen(true), delay); };
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const pos = {
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  }[side];

  const arrow = {
    top: { top: "100%", left: "50%", marginLeft: -4, borderColor: "var(--panel-hi) transparent transparent transparent" },
    bottom: { bottom: "100%", left: "50%", marginLeft: -4, borderColor: "transparent transparent var(--panel-hi) transparent" },
    left: { left: "100%", top: "50%", marginTop: -4, borderColor: "transparent transparent transparent var(--panel-hi)" },
    right: { right: "100%", top: "50%", marginTop: -4, borderColor: "transparent var(--panel-hi) transparent transparent" },
  }[side];

  return (
    <span
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      {...props}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 50,
            maxWidth: 260,
            padding: "7px 11px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line-2)",
            background: "var(--panel-hi)",
            color: "var(--fg)",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            lineHeight: 1.4,
            boxShadow: "0 16px 40px -18px rgba(0,0,0,0.7)",
            whiteSpace: "normal",
            pointerEvents: "none",
            animation: "hm-tip-in 120ms var(--ease-out) both",
            ...pos,
          }}
        >
          {content}
          <span style={{ position: "absolute", width: 0, height: 0, borderStyle: "solid", borderWidth: 4, ...arrow }} />
          <style>{"@keyframes hm-tip-in{from{opacity:0;transform:scale(.96) " + (pos.transform || "") + "}to{opacity:1}}"}</style>
        </span>
      ) : null}
    </span>
  );
}
