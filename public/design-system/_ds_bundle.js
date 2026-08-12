/* @ds-bundle: {"format":4,"namespace":"HivemindOSDesignSystem_65eabf","components":[{"name":"HexCell","sourcePath":"components/brand/HexCell.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"CardHeader","sourcePath":"components/core/Card.jsx"},{"name":"CardTitle","sourcePath":"components/core/Card.jsx"},{"name":"CardDescription","sourcePath":"components/core/Card.jsx"},{"name":"CardContent","sourcePath":"components/core/Card.jsx"},{"name":"CardFooter","sourcePath":"components/core/Card.jsx"},{"name":"Checkbox","sourcePath":"components/core/Checkbox.jsx"},{"name":"CopyableCodeLine","sourcePath":"components/core/CopyableCodeLine.jsx"},{"name":"Segmented","sourcePath":"components/core/Segmented.jsx"},{"name":"StatusDot","sourcePath":"components/core/StatusDot.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Skeleton.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"}],"sourceHashes":{"components/brand/HexCell.jsx":"b2b8d96279a3","components/core/Badge.jsx":"5ace6387e0ac","components/core/Button.jsx":"77c6ac3786c8","components/core/Card.jsx":"2bafaa710548","components/core/Checkbox.jsx":"f536262c447d","components/core/CopyableCodeLine.jsx":"a1454883ab25","components/core/Segmented.jsx":"4616b5ccec3a","components/core/StatusDot.jsx":"6a3c06f3f6e6","components/feedback/ProgressBar.jsx":"8e5259888f64","components/feedback/Skeleton.jsx":"f0eeb4b93cac","components/feedback/Spinner.jsx":"0c5b7679f778","components/feedback/Tooltip.jsx":"284403edb684","ui_kits/dashboard/ChatScreen.jsx":"96dd8456d57f","ui_kits/dashboard/FleetScreen.jsx":"5d47a6c7d3ac","ui_kits/dashboard/WalletsScreen.jsx":"ffa1d1addaf5","ui_kits/dashboard/app.jsx":"039446d1a29d","ui_kits/dashboard/shell.jsx":"78cc6baf5f81"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.HivemindOSDesignSystem_65eabf = window.HivemindOSDesignSystem_65eabf || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/HexCell.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* HexCell — the signature honeycomb cell shape. A pointy-top hexagon tile that
   holds an icon/glyph/agent portrait, with tone-driven border + optional pulse.
   This is the brand's core spatial motif (machines, agents, the Queen).
   Intentional addition: distills the fleet-hive HiveStage cell into a reusable
   primitive (see readme "Intentional additions"). */

const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
const TONES = {
  honey: {
    border: "var(--honey)",
    glow: "var(--honey-soft)"
  },
  live: {
    border: "var(--live)",
    glow: "var(--live-soft)"
  },
  neutral: {
    border: "var(--line-3, rgba(148,163,184,0.28))",
    glow: "transparent"
  },
  danger: {
    border: "var(--danger)",
    glow: "var(--danger-soft)"
  }
};
function HexCell({
  size = 96,
  tone = "neutral",
  selected = false,
  pulse = false,
  children,
  style,
  ...props
}) {
  const t = TONES[tone] || TONES.neutral;
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: "relative",
      width: size,
      height: size * 1.1547,
      // pointy-top hex ratio H = W * 2/√3
      display: "grid",
      placeItems: "center",
      transformOrigin: "50% 50%",
      transform: hover ? "translateY(-6px) scale(1.05)" : selected ? "scale(1.06)" : "scale(1)",
      transition: "transform 0.5s var(--ease-lift, cubic-bezier(0.22,0.61,0.18,1)), filter 0.5s ease",
      filter: hover ? "drop-shadow(0 12px 18px rgba(0,0,0,0.42))" : "none",
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      clipPath: HEX_CLIP,
      background: t.border,
      opacity: selected || hover ? 0.9 : 0.55
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 2,
      clipPath: HEX_CLIP,
      background: "var(--panel)",
      display: "grid",
      placeItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: `radial-gradient(circle, ${t.glow}, transparent 70%)`,
      animation: pulse ? "hm-hex-breathe 4s ease-in-out infinite" : "none"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "grid",
      placeItems: "center",
      width: "62%",
      height: "62%"
    }
  }, children), /*#__PURE__*/React.createElement("style", null, "@keyframes hm-hex-breathe{0%,100%{opacity:0.5}50%{opacity:1}}"));
}
Object.assign(__ds_scope, { HexCell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/HexCell.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Badge — compact status / label pill.
   Ported from src/components/ui/badge.tsx. Human-readable statuses like
   "Running", "Needs funding", "Tailnet-only". */

const VARIANTS = {
  default: {
    background: "var(--honey-soft)",
    color: "var(--honey)",
    border: "1px solid var(--honey-line)"
  },
  secondary: {
    background: "transparent",
    color: "var(--fg-3)",
    border: "1px solid var(--line-2)"
  },
  success: {
    background: "var(--success-soft)",
    color: "var(--success)",
    border: "1px solid color-mix(in srgb, var(--success) 35%, transparent)"
  },
  warning: {
    background: "var(--warning-soft)",
    color: "var(--warning)",
    border: "1px solid var(--honey-line)"
  },
  danger: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    border: "1px solid color-mix(in srgb, var(--danger) 38%, transparent)"
  },
  honey: {
    background: "var(--honey-soft)",
    color: "var(--honey)",
    border: "1px solid var(--honey-line)"
  },
  live: {
    background: "var(--live-soft)",
    color: "var(--live)",
    border: "1px solid color-mix(in srgb, var(--live) 35%, transparent)"
  },
  outline: {
    background: "transparent",
    color: "var(--fg-2)",
    border: "1px solid var(--line-2)"
  }
};
function Badge({
  variant = "default",
  mono = false,
  children,
  style,
  ...props
}) {
  const v = VARIANTS[variant] || VARIANTS.default;
  return /*#__PURE__*/React.createElement("span", _extends({
    "data-slot": "badge",
    style: {
      display: "inline-flex",
      width: "fit-content",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      padding: mono ? "3px 9px" : "3px 10px",
      borderRadius: "var(--radius-pill)",
      fontFamily: mono ? "var(--font-mono)" : "var(--font-body)",
      fontSize: mono ? 10 : 11,
      fontWeight: mono ? 500 : 600,
      letterSpacing: mono ? "0.06em" : 0,
      textTransform: mono ? "uppercase" : "none",
      lineHeight: 1.45,
      whiteSpace: "nowrap",
      ...v,
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Button — HivemindOS primary action control.
   Refined "hive" language (trade-desk.css .fb-btn): pill-shaped, HONEY primary
   with dark text, weight 500 (never bold), warm hairline ghost/outline.
   Variants: default (honey primary), secondary, outline, ghost, danger, link.
   Sizes: xs, sm, default, lg, icon. */

const VARIANTS = {
  default: {
    background: "var(--button-primary)",
    color: "var(--button-primary-foreground)",
    border: "1px solid transparent"
  },
  secondary: {
    background: "var(--button-secondary)",
    color: "var(--button-secondary-foreground)",
    border: "1px solid var(--button-border)"
  },
  outline: {
    background: "transparent",
    color: "var(--fg-2)",
    border: "1px solid var(--line-2)"
  },
  ghost: {
    background: "transparent",
    color: "var(--button-muted-foreground)",
    border: "1px solid transparent"
  },
  danger: {
    background: "var(--button-destructive)",
    color: "#2a0f0c",
    border: "1px solid transparent"
  },
  link: {
    background: "transparent",
    color: "var(--honey)",
    border: "1px solid transparent",
    textDecoration: "underline",
    textUnderlineOffset: "4px"
  }
};
const PILL = "var(--radius-pill)";
const SIZES = {
  xs: {
    height: 26,
    padding: "0 12px",
    fontSize: 12,
    borderRadius: PILL,
    gap: 5
  },
  sm: {
    height: 30,
    padding: "0 12px",
    fontSize: 12,
    borderRadius: PILL,
    gap: 6
  },
  default: {
    height: 36,
    padding: "0 15px",
    fontSize: 12.5,
    borderRadius: PILL,
    gap: 7
  },
  lg: {
    height: 42,
    padding: "0 22px",
    fontSize: 13.5,
    borderRadius: PILL,
    gap: 8
  },
  icon: {
    width: 34,
    height: 34,
    padding: 0,
    borderRadius: 11,
    gap: 0
  }
};
function Button({
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
  return /*#__PURE__*/React.createElement("button", _extends({
    "data-slot": "button",
    "data-variant": variant,
    disabled: disabled || isLoading,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
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
      ...style
    }
  }, props), isLoading ? /*#__PURE__*/React.createElement(Spinner, null) : null, children);
}
function Spinner() {
  return /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    style: {
      animation: "hm-spin 0.8s linear infinite"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9",
    stroke: "currentColor",
    strokeOpacity: "0.25",
    strokeWidth: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 0 0-9-9",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("style", null, "@keyframes hm-spin{to{transform:rotate(360deg)}}"));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Card — the base honeycomb "cell": a hairline-bordered translucent panel over
   the honeycomb backdrop with a deep soft shadow. Ported from
   src/components/ui/card.tsx. One card = one main job.
   Sub-parts: CardHeader, CardTitle, CardDescription, CardContent, CardFooter. */

function Card({
  children,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card",
    style: {
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--line-2)",
      background: "var(--surface)",
      color: "var(--foreground)",
      boxShadow: "var(--shadow-card)",
      fontFamily: "var(--font-body)",
      ...style
    }
  }, props), children);
}
function CardHeader({
  children,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-header",
    style: {
      display: "grid",
      gap: 6,
      padding: "18px 18px 0",
      ...style
    }
  }, props), children);
}
function CardTitle({
  children,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-title",
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 15,
      fontWeight: 700,
      lineHeight: 1.1,
      letterSpacing: "-0.2px",
      ...style
    }
  }, props), children);
}
function CardDescription({
  children,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-description",
    style: {
      fontSize: 13,
      color: "var(--muted)",
      lineHeight: 1.4,
      ...style
    }
  }, props), children);
}
function CardContent({
  children,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-content",
    style: {
      padding: 18,
      ...style
    }
  }, props), children);
}
function CardFooter({
  children,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-footer",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 18px 18px",
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Checkbox — ported from src/components/ui/checkbox.tsx (Radix). Teal fill when
   checked; hairline square when not. */

function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  style,
  ...props
}) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(defaultChecked || false);
  const on = isControlled ? checked : internal;
  const toggle = () => {
    if (disabled) return;
    if (!isControlled) setInternal(!on);
    onCheckedChange?.(!on);
  };
  const box = /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "checkbox",
    "aria-checked": on,
    disabled: disabled,
    onClick: toggle,
    style: {
      display: "inline-grid",
      placeItems: "center",
      width: 17,
      height: 17,
      flex: "0 0 auto",
      padding: 0,
      borderRadius: 5,
      border: on ? "1px solid var(--button-primary)" : "1px solid var(--button-border)",
      background: on ? "var(--button-primary)" : "var(--field)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "background var(--dur) ease, border-color var(--dur) ease"
    }
  }, props), on ? /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--button-primary-foreground)",
    strokeWidth: "3.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })) : null);
  if (!label) return box;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "var(--font-body)",
      fontSize: 13,
      color: "var(--fg-2)",
      ...style
    }
  }, box, /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/core/CopyableCodeLine.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* CopyableCodeLine — mono command/endpoint line with a copy button. Ported from
   src/components/ui/copyable-code-line.tsx. Used for setup commands, tailnet
   ids, env keys. Keep these OUT of primary views (advanced surface only). */

function CopyableCodeLine({
  code,
  label,
  style,
  ...props
}) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(code);
    } catch (e) {/* noop */}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "grid",
      gap: 6,
      ...style
    }
  }, props), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--fg-3)"
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "8px 8px 8px 12px",
      borderRadius: "var(--radius-xs)",
      border: "1px solid var(--line)",
      background: "var(--field)"
    }
  }, /*#__PURE__*/React.createElement("code", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12.5,
      color: "var(--fg-2)",
      overflowX: "auto",
      whiteSpace: "nowrap"
    }
  }, code), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: copy,
    "aria-label": "Copy",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      flex: "0 0 auto",
      padding: "5px 9px",
      borderRadius: 6,
      border: "1px solid var(--button-border)",
      background: copied ? "var(--button-accent)" : "transparent",
      color: copied ? "var(--accent-strong)" : "var(--muted)",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      fontWeight: 600,
      cursor: "pointer",
      transition: "all var(--dur) ease"
    }
  }, copied ? /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })) : /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "9",
    y: "9",
    width: "11",
    height: "11",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 15V5a2 2 0 0 1 2-2h10"
  })), copied ? "Copied" : "Copy")));
}
Object.assign(__ds_scope, { CopyableCodeLine });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/CopyableCodeLine.jsx", error: String((e && e.message) || e) }); }

// components/core/Segmented.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Segmented — a pill segmented control. The hive's view/mode switcher
   (walletSegmented, tk-side, fleet ViewModeToggle). Options sit in a pill
   track; active options use the mobile app's tonal pressed surface. */

function Segmented({
  options,
  value,
  defaultValue,
  onChange,
  variant = "subtle",
  size = "default",
  style,
  ...props
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? (options[0] && (options[0].value ?? options[0])));
  const current = controlled ? value : internal;
  const pick = v => {
    if (!controlled) setInternal(v);
    onChange?.(v);
  };
  const pad = size === "sm" ? "5px 12px" : "7px 16px";
  const fs = size === "sm" ? 12 : 12.5;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "group",
    style: {
      display: "inline-flex",
      gap: 3,
      padding: 4,
      borderRadius: "var(--radius-pill)",
      border: "1px solid var(--line-2)",
      background: "color-mix(in srgb, var(--panel) 70%, transparent)",
      ...style
    }
  }, props), options.map(opt => {
    const val = opt.value ?? opt;
    const label = opt.label ?? opt;
    const tone = opt.tone; // optional per-option active tone (e.g. "sell")
    const active = current === val;
    const activeBg = variant === "solid" ? tone === "sell" ? "var(--danger)" : "var(--honey-fill)" : "var(--honey-soft)";
    const activeColor = variant === "solid" ? tone === "sell" ? "#2a0f0c" : "var(--on-honey)" : "var(--honey)";
    return /*#__PURE__*/React.createElement("button", {
      key: String(val),
      type: "button",
      "aria-pressed": active,
      "data-active": active ? "" : undefined,
      onClick: () => pick(val),
      style: {
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
        transition: "background var(--dur) ease, color var(--dur) ease"
      }
    }, label);
  }));
}
Object.assign(__ds_scope, { Segmented });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Segmented.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusDot.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* StatusDot — the fr-dot signal from fleet-hive.css. A tiny colored dot that
   optionally pulses to communicate live activity. State drives the color. */

const TONES = {
  live: "var(--live)",
  working: "var(--live)",
  ready: "var(--muted)",
  healthy: "var(--success)",
  scheduled: "var(--honey)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  offline: "var(--fg-4)"
};
function StatusDot({
  tone = "live",
  pulse,
  label,
  style,
  ...props
}) {
  const color = TONES[tone] || TONES.live;
  const doPulse = pulse ?? (tone === "live" || tone === "working");
  const dot = /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-block",
      width: 8,
      height: 8,
      borderRadius: "9999px",
      background: color,
      color,
      flex: "0 0 auto",
      boxShadow: doPulse ? "0 0 0 0 currentColor" : "none",
      animation: doPulse ? "hm-pulse 2.4s ease-in-out infinite" : "none"
    }
  });
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      color: "var(--fg-2)",
      fontSize: 12,
      fontFamily: "var(--font-body)",
      ...style
    }
  }, props), dot, label ? /*#__PURE__*/React.createElement("span", null, label) : null, /*#__PURE__*/React.createElement("style", null, "@keyframes hm-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 50%,transparent)}50%{box-shadow:0 0 0 5px color-mix(in srgb,currentColor 0%,transparent)}}"));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* ProgressBar — loading bars & metric meters. Determinate (value 0–100),
   indeterminate (sweeping), or a thin 3px "meter" (the fr-meter used for
   CPU/RAM/survival). Rounded track, tone-driven fill. */

const TONES = {
  honey: "var(--honey)",
  live: "var(--live)",
  danger: "var(--danger)",
  neutral: "var(--fg-3)"
};
function ProgressBar({
  value = 0,
  indeterminate = false,
  tone = "honey",
  thickness = 8,
  label,
  style,
  ...props
}) {
  const fill = TONES[tone] || TONES.honey;
  const pct = Math.max(0, Math.min(100, value));
  const isMeter = thickness <= 4;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "grid",
      gap: label ? 6 : 0,
      ...style
    }
  }, props), label ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--fg-3)"
    }
  }, /*#__PURE__*/React.createElement("span", null, label), !indeterminate ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--fg-2)"
    }
  }, pct, "%") : null) : null, /*#__PURE__*/React.createElement("div", {
    role: "progressbar",
    "aria-valuenow": indeterminate ? undefined : pct,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    style: {
      position: "relative",
      height: thickness,
      borderRadius: 9999,
      background: "var(--line-2)",
      overflow: "hidden"
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: "40%",
      borderRadius: 9999,
      background: fill,
      animation: "hm-prog-sweep 1.3s var(--ease-out) infinite"
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      height: "100%",
      width: `${pct}%`,
      borderRadius: 9999,
      background: fill,
      transition: "width 0.5s cubic-bezier(.2,.7,.3,1)"
    }
  }), /*#__PURE__*/React.createElement("style", null, "@keyframes hm-prog-sweep{0%{left:-40%}100%{left:100%}}")));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Skeleton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Skeleton — shimmer placeholder shown on first load and view switches.
   Ported from trade/skeletons.tsx (.sk): panel-2 block with a sweeping
   highlight. Respects prefers-reduced-motion. Compose several to mimic the
   real layout while data loads. */

function Skeleton({
  w = "100%",
  h = 12,
  r = 6,
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: "relative",
      overflow: "hidden",
      display: "block",
      flex: "0 0 auto",
      width: w,
      height: h,
      borderRadius: r,
      background: "var(--panel-2, #181b22)",
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("span", {
    style: {
      content: '""',
      position: "absolute",
      inset: 0,
      transform: "translateX(-100%)",
      background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--fg) 7%, transparent), transparent)",
      animation: "hm-sk-shimmer 1.25s infinite"
    }
  }), /*#__PURE__*/React.createElement("style", null, "@keyframes hm-sk-shimmer{100%{transform:translateX(100%)}}@media (prefers-reduced-motion:reduce){[data-slot='skeleton'] span{animation:none}}"));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Spinner — the loading state glyph. A ring that spins (matches the Button
   isLoading spinner and the trade tk-spin pending indicator). */

function Spinner({
  size = 18,
  thickness = 2.4,
  tone = "honey",
  label,
  style,
  ...props
}) {
  const color = tone === "honey" ? "var(--honey)" : tone === "live" ? "var(--live)" : "currentColor";
  const ring = /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    style: {
      animation: "hm-spin 0.7s linear infinite",
      flex: "0 0 auto"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9",
    stroke: "currentColor",
    strokeOpacity: "0.18",
    strokeWidth: thickness
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 0 0-9-9",
    stroke: color,
    strokeWidth: thickness,
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("style", null, "@keyframes hm-spin{to{transform:rotate(360deg)}}"));
  if (!label) return ring;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      color: "var(--fg-2)",
      fontFamily: "var(--font-body)",
      fontSize: 13,
      ...style
    }
  }, props), ring, /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Tooltip — a hover/focus popover. Ported from src/components/ui/tooltip.tsx:
   popover surface, hairline border, small text, arrow, ~120ms delay.
   Pair a plain-English meaning with any technical label. */

function Tooltip({
  content,
  side = "top",
  children,
  delay = 120,
  style,
  ...props
}) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);
  const show = () => {
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const pos = {
    top: {
      bottom: "calc(100% + 8px)",
      left: "50%",
      transform: "translateX(-50%)"
    },
    bottom: {
      top: "calc(100% + 8px)",
      left: "50%",
      transform: "translateX(-50%)"
    },
    left: {
      right: "calc(100% + 8px)",
      top: "50%",
      transform: "translateY(-50%)"
    },
    right: {
      left: "calc(100% + 8px)",
      top: "50%",
      transform: "translateY(-50%)"
    }
  }[side];
  const arrow = {
    top: {
      top: "100%",
      left: "50%",
      marginLeft: -4,
      borderColor: "var(--panel-hi) transparent transparent transparent"
    },
    bottom: {
      bottom: "100%",
      left: "50%",
      marginLeft: -4,
      borderColor: "transparent transparent var(--panel-hi) transparent"
    },
    left: {
      left: "100%",
      top: "50%",
      marginTop: -4,
      borderColor: "transparent transparent transparent var(--panel-hi)"
    },
    right: {
      right: "100%",
      top: "50%",
      marginTop: -4,
      borderColor: "transparent var(--panel-hi) transparent transparent"
    }
  }[side];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: "relative",
      display: "inline-flex",
      ...style
    },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide
  }, props), children, open ? /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
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
      ...pos
    }
  }, content, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      width: 0,
      height: 0,
      borderStyle: "solid",
      borderWidth: 4,
      ...arrow
    }
  }), /*#__PURE__*/React.createElement("style", null, "@keyframes hm-tip-in{from{opacity:0;transform:scale(.96) " + (pos.transform || "") + "}to{opacity:1}}")) : null);
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/ChatScreen.jsx
try { (() => {
/* ChatScreen — talk to an agent. Left rail of recent chats, a message thread,
   and a composer. Cosmetic recreation of the app's chat workspace. */

const HMc = window.HivemindOSDesignSystem_65eabf;
const {
  useState: useStateC,
  useRef: useRefC,
  useEffect: useEffectC
} = React;
const RECENT = [{
  id: "1",
  title: "Swarm bridge refactor",
  agent: "Hermes-α",
  since: "2m",
  active: true
}, {
  id: "2",
  title: "Research brief · x402",
  agent: "Hermes-research",
  since: "18m"
}, {
  id: "3",
  title: "Nightly index rebuild",
  agent: "Aeon-night",
  since: "5h"
}, {
  id: "4",
  title: "X channel re-login",
  agent: "OpenClaw-x",
  since: "1h"
}];
const SEED = [{
  who: "you",
  text: "Where are we on the swarm agent bridge?"
}, {
  who: "agent",
  text: "Coder finished streaming over Tailscale SSH. Reviewer flagged one risk: the reconnect path retries without backoff. I've queued a fix and paused the deploy until you approve."
}, {
  who: "agent",
  kind: "attribution",
  steps: [["Planner", "created the task"], ["Coder", "made changes to bridge.ts"], ["Reviewer", "flagged 1 risk"]]
}, {
  who: "you",
  text: "Approve the fix, keep the deploy paused."
}];
function ChatScreen() {
  const [msgs, setMsgs] = useStateC(SEED);
  const [draft, setDraft] = useStateC("");
  const endRef = useRefC(null);
  useEffectC(() => {
    endRef.current && endRef.current.scrollIntoView && null;
  }, [msgs]);
  const send = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setMsgs(m => [...m, {
      who: "you",
      text
    }]);
    setDraft("");
    setTimeout(() => {
      setMsgs(m => [...m, {
        who: "agent",
        text: "On it — I'll dispatch that to the crew and report back with attribution when each step completes."
      }]);
    }, 700);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "chat-workspace"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "chat-rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chat-rail-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rail-eyebrow"
  }, "Recent chats"), /*#__PURE__*/React.createElement(HMc.Button, {
    size: "xs",
    variant: "outline"
  }, "New")), RECENT.map(c => /*#__PURE__*/React.createElement("button", {
    key: c.id,
    className: "chat-rail-item",
    "data-active": c.active ? "" : undefined
  }, /*#__PURE__*/React.createElement("div", {
    className: "rail-item-title"
  }, c.title), /*#__PURE__*/React.createElement("div", {
    className: "rail-item-meta"
  }, c.agent, " \xB7 ", c.since)))), /*#__PURE__*/React.createElement("section", {
    className: "chat-main"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chat-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chat-head-l"
  }, /*#__PURE__*/React.createElement(HMc.HexCell, {
    tone: "live",
    pulse: true,
    size: 40
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/bees/worker-bee-code.png",
    alt: "",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "contain"
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "chat-head-name"
  }, "Hermes-\u03B1"), /*#__PURE__*/React.createElement("div", {
    className: "chat-head-sub"
  }, "Lead \xB7 atlas \xB7 Hermes runtime"))), /*#__PURE__*/React.createElement("div", {
    className: "chat-head-r"
  }, /*#__PURE__*/React.createElement(HMc.Badge, {
    variant: "success"
  }, "Working"), /*#__PURE__*/React.createElement(HMc.Button, {
    size: "sm",
    variant: "outline"
  }, "Call"))), /*#__PURE__*/React.createElement("div", {
    className: "chat-thread"
  }, msgs.map((m, i) => {
    if (m.kind === "attribution") {
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "attribution"
      }, m.steps.map(([who, did], j) => /*#__PURE__*/React.createElement("div", {
        key: j,
        className: "attribution-row"
      }, /*#__PURE__*/React.createElement("span", {
        className: "attribution-who"
      }, who), /*#__PURE__*/React.createElement("span", {
        className: "attribution-did"
      }, did))));
    }
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: `bubble bubble-${m.who}`
    }, m.text);
  }), /*#__PURE__*/React.createElement("div", {
    ref: endRef
  })), /*#__PURE__*/React.createElement("div", {
    className: "chat-composer"
  }, /*#__PURE__*/React.createElement("input", {
    value: draft,
    onChange: e => setDraft(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") send();
    },
    placeholder: "Message Hermes-\u03B1\u2026"
  }), /*#__PURE__*/React.createElement(HMc.Button, {
    onClick: send
  }, "Send"))));
}
window.ChatScreen = ChatScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/ChatScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/FleetScreen.jsx
try { (() => {
/* FleetScreen — the default Fleet Hive view. The Queen orchestrator at the
   heart, machines ringed as honeycomb cards, each agent a hex petal.
   Machines first, agents second (per UI_RULES). */

const HM = window.HivemindOSDesignSystem_65eabf;
const MACHINES = [{
  id: "atlas",
  name: "atlas",
  role: "Primary",
  os: "macOS 15.3 · M3 Max",
  loc: "Studio · Brooklyn",
  cpu: 38,
  ram: 62,
  ver: "v0.18.2",
  verState: "current",
  agents: [{
    name: "Hermes-α",
    role: "Lead",
    tone: "live",
    bee: "worker-bee-code",
    task: "Refactoring the swarm agent bridge over Tailscale SSH",
    since: "2m",
    badge: ["success", "Working"]
  }, {
    name: "OpenClaw-eng",
    role: "Engineer",
    tone: "neutral",
    bee: "worker-bee-ops",
    task: "Idle · waiting for next handoff from Hermes-α",
    since: "11m",
    badge: ["secondary", "Ready"]
  }, {
    name: "Aeon-night",
    role: "Background",
    tone: "neutral",
    bee: "worker-bee-planner",
    task: "Nightly skill index rebuild · 02:00 UTC",
    since: "5h",
    badge: ["honey", "Scheduled"]
  }]
}, {
  id: "nimbus",
  name: "nimbus",
  role: "Workhorse",
  os: "Ubuntu 24.04 · 32c/128G",
  loc: "us-east-2 · Hetzner",
  cpu: 71,
  ram: 48,
  ver: "v0.18.2",
  verState: "current",
  agents: [{
    name: "MiroShark-sim",
    role: "Simulator",
    tone: "live",
    bee: "worker-bee-research",
    task: "Running market-making sim · epoch 8410 / 12000",
    since: "23m",
    badge: ["success", "Working"]
  }, {
    name: "Hermes-research",
    role: "Research",
    tone: "live",
    bee: "worker-bee-writer",
    task: "Synthesizing the research dump into an Obsidian brief",
    since: "1m",
    badge: ["warning", "Low compute"]
  }, {
    name: "OpenClaw-x",
    role: "Channels",
    tone: "danger",
    bee: "worker-bee-security",
    task: "Auth handshake failed against X channel — needs re-login",
    since: "1h",
    badge: ["danger", "Failed"]
  }]
}, {
  id: "lattice",
  name: "lattice",
  role: "Roaming",
  os: "macOS 15.3 · M2",
  loc: "Café · Lisbon",
  cpu: 12,
  ram: 28,
  ver: "v0.18.0",
  verState: "stale",
  agents: [{
    name: "Hermes-mobile",
    role: "Inbox",
    tone: "neutral",
    bee: "worker-bee-qa",
    task: "Idle · brain sync paused while on hotspot",
    since: "8m",
    badge: ["secondary", "Ready"]
  }, {
    name: "Gemini-notes",
    role: "Notes",
    tone: "neutral",
    bee: "worker-bee-general",
    task: "Needs API key · hive-env-add GOOGLE_API_KEY",
    since: "—",
    badge: ["warning", "Needs setup"]
  }]
}];
function AgentRow({
  a,
  onChat
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "agent-row"
  }, /*#__PURE__*/React.createElement(HM.HexCell, {
    tone: a.tone,
    pulse: a.tone === "live",
    size: 46
  }, /*#__PURE__*/React.createElement("img", {
    src: `../../assets/bees/${a.bee}.png`,
    alt: "",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "contain"
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "agent-main"
  }, /*#__PURE__*/React.createElement("div", {
    className: "agent-head"
  }, /*#__PURE__*/React.createElement("strong", null, a.name), /*#__PURE__*/React.createElement(HM.Badge, {
    variant: a.badge[0]
  }, a.badge[1])), /*#__PURE__*/React.createElement("div", {
    className: "agent-task"
  }, a.task)), /*#__PURE__*/React.createElement("div", {
    className: "agent-side"
  }, /*#__PURE__*/React.createElement("span", {
    className: "agent-since"
  }, a.since), /*#__PURE__*/React.createElement(HM.Button, {
    size: "xs",
    variant: "ghost",
    onClick: onChat
  }, "Chat")));
}
function MachineCard({
  m,
  onChat
}) {
  const working = m.agents.filter(a => a.tone === "live").length;
  return /*#__PURE__*/React.createElement(HM.Card, {
    className: "machine-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "machine-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "machine-title"
  }, /*#__PURE__*/React.createElement("span", {
    className: "machine-name"
  }, m.name), /*#__PURE__*/React.createElement(HM.Badge, {
    variant: "outline"
  }, m.role), m.verState === "stale" ? /*#__PURE__*/React.createElement(HM.Badge, {
    variant: "warning"
  }, "Update ready") : null), /*#__PURE__*/React.createElement("div", {
    className: "machine-os"
  }, m.os, " \xB7 ", m.loc)), /*#__PURE__*/React.createElement("div", {
    className: "machine-metrics"
  }, /*#__PURE__*/React.createElement("span", null, "CPU ", m.cpu, "%"), /*#__PURE__*/React.createElement("span", null, "RAM ", m.ram, "%"))), /*#__PURE__*/React.createElement("div", {
    className: "machine-agents"
  }, m.agents.map(a => /*#__PURE__*/React.createElement(AgentRow, {
    key: a.name,
    a: a,
    onChat: onChat
  }))), /*#__PURE__*/React.createElement("div", {
    className: "machine-foot"
  }, /*#__PURE__*/React.createElement(HM.StatusDot, {
    tone: "working",
    label: `${m.agents.length} agents · ${working} working`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(HM.Button, {
    size: "sm",
    variant: "outline"
  }, "Shell"), /*#__PURE__*/React.createElement(HM.Button, {
    size: "sm"
  }, "Open details"))));
}
function QueenBanner() {
  return /*#__PURE__*/React.createElement("div", {
    className: "queen-banner"
  }, /*#__PURE__*/React.createElement(HM.HexCell, {
    tone: "honey",
    pulse: true,
    size: 104
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/bees/queen-bee.png",
    alt: "Queen",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "contain"
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "queen-copy"
  }, /*#__PURE__*/React.createElement("div", {
    className: "queen-eyebrow"
  }, "Queen orchestrator"), /*#__PURE__*/React.createElement("div", {
    className: "queen-title"
  }, "The hive is coordinated"), /*#__PURE__*/React.createElement("p", {
    className: "queen-lede"
  }, "3 machines online \xB7 8 agents \xB7 4 working. Planner created 2 tasks, Coder is shipping the swarm bridge, Reviewer flagged 1 risk on nimbus.")), /*#__PURE__*/React.createElement("div", {
    className: "queen-actions"
  }, /*#__PURE__*/React.createElement(HM.Button, null, "Ask the Queen"), /*#__PURE__*/React.createElement(HM.Button, {
    variant: "outline"
  }, "Add machine")));
}
function FleetScreen({
  onChat
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "screen-scroll"
  }, /*#__PURE__*/React.createElement(window.TopBar, {
    eyebrow: "Private swarm command",
    title: "Fleet"
  }, /*#__PURE__*/React.createElement(window.HealthChip, {
    dot: "healthy",
    label: "Fleet healthy"
  }), /*#__PURE__*/React.createElement(window.HealthChip, {
    dot: "live",
    label: "Tailnet online"
  }), /*#__PURE__*/React.createElement(window.HealthChip, {
    dot: "scheduled",
    label: "Wallets OK"
  })), /*#__PURE__*/React.createElement(QueenBanner, null), /*#__PURE__*/React.createElement("div", {
    className: "machine-grid"
  }, MACHINES.map(m => /*#__PURE__*/React.createElement(MachineCard, {
    key: m.id,
    m: m,
    onChat: onChat
  }))));
}
window.FleetScreen = FleetScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/FleetScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/WalletsScreen.jsx
try { (() => {
/* WalletsScreen — "can agents safely spend?" Calm, money-safe surface.
   Read-only status separated from money-moving actions (per UI_RULES). */

const HMw = window.HivemindOSDesignSystem_65eabf;
const WALLETS = [{
  agent: "Hermes-α",
  machine: "atlas",
  balance: "0.42 ETH",
  state: ["success", "Healthy"],
  survival: "~28 days at current burn",
  chain: "Base",
  spend: true
}, {
  agent: "Hermes-research",
  machine: "nimbus",
  balance: "0.12 ETH",
  state: ["warning", "Low compute"],
  survival: "3 days left",
  chain: "Base",
  spend: true
}, {
  agent: "OpenClaw-x",
  machine: "nimbus",
  balance: "0.00 ETH",
  state: ["danger", "Needs funding"],
  survival: "Stopped — out of funds",
  chain: "Base",
  spend: false
}, {
  agent: "Codex-skill",
  machine: "nimbus",
  balance: "0.04 ETH",
  state: ["success", "Healthy"],
  survival: "~9 days at current burn",
  chain: "Solana",
  spend: true
}];
function WalletCard({
  w
}) {
  return /*#__PURE__*/React.createElement(HMw.Card, {
    className: "wallet-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wallet-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "wallet-agent"
  }, w.agent), /*#__PURE__*/React.createElement("div", {
    className: "wallet-machine"
  }, "on ", w.machine, " \xB7 ", w.chain)), /*#__PURE__*/React.createElement(HMw.Badge, {
    variant: w.state[0]
  }, w.state[1])), /*#__PURE__*/React.createElement("div", {
    className: "wallet-balance"
  }, w.balance), /*#__PURE__*/React.createElement("div", {
    className: "wallet-survival"
  }, /*#__PURE__*/React.createElement(HMw.StatusDot, {
    tone: w.state[0] === "danger" ? "danger" : w.state[0] === "warning" ? "warning" : "healthy",
    pulse: false
  }), /*#__PURE__*/React.createElement("span", null, w.survival)), /*#__PURE__*/React.createElement("div", {
    className: "wallet-foot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "wallet-spend"
  }, w.spend ? "Can spend on approved tools" : "Spending paused"), w.state[0] === "danger" ? /*#__PURE__*/React.createElement(HMw.Button, {
    size: "sm"
  }, "Add funds") : /*#__PURE__*/React.createElement(HMw.Button, {
    size: "sm",
    variant: "outline"
  }, "Manage")));
}
function WalletsScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "screen-scroll"
  }, /*#__PURE__*/React.createElement(window.TopBar, {
    eyebrow: "Money, made calm",
    title: "Wallets"
  }, /*#__PURE__*/React.createElement(window.HealthChip, {
    dot: "warning",
    label: "1 needs funding"
  }), /*#__PURE__*/React.createElement(window.HealthChip, {
    dot: "healthy",
    label: "3 healthy"
  })), /*#__PURE__*/React.createElement(HMw.Card, {
    className: "wallet-summary"
  }, /*#__PURE__*/React.createElement("div", {
    className: "summary-cell"
  }, /*#__PURE__*/React.createElement("span", {
    className: "summary-num"
  }, "4"), /*#__PURE__*/React.createElement("span", {
    className: "summary-lab"
  }, "Agent wallets")), /*#__PURE__*/React.createElement("div", {
    className: "summary-cell"
  }, /*#__PURE__*/React.createElement("span", {
    className: "summary-num",
    style: {
      color: "var(--success)"
    }
  }, "3"), /*#__PURE__*/React.createElement("span", {
    className: "summary-lab"
  }, "Can spend safely")), /*#__PURE__*/React.createElement("div", {
    className: "summary-cell"
  }, /*#__PURE__*/React.createElement("span", {
    className: "summary-num",
    style: {
      color: "var(--warning)"
    }
  }, "1"), /*#__PURE__*/React.createElement("span", {
    className: "summary-lab"
  }, "Close to stopping")), /*#__PURE__*/React.createElement("div", {
    className: "summary-cell"
  }, /*#__PURE__*/React.createElement("span", {
    className: "summary-num",
    style: {
      color: "var(--danger)"
    }
  }, "1"), /*#__PURE__*/React.createElement("span", {
    className: "summary-lab"
  }, "Needs funding now")), /*#__PURE__*/React.createElement("div", {
    className: "summary-note"
  }, "Money-moving actions require explicit confirmation. Private keys and payment rails stay in advanced setup.")), /*#__PURE__*/React.createElement("div", {
    className: "wallet-grid"
  }, WALLETS.map(w => /*#__PURE__*/React.createElement(WalletCard, {
    key: w.agent,
    w: w
  }))));
}
window.WalletsScreen = WalletsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/WalletsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/app.jsx
try { (() => {
/* app.jsx — DashboardApp shell: nav rail + active view. */

const {
  useState: useStateApp
} = React;
function EmptyView({
  title,
  eyebrow,
  headline,
  body,
  cta
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "screen-scroll"
  }, /*#__PURE__*/React.createElement(window.TopBar, {
    eyebrow: eyebrow,
    title: title
  }), /*#__PURE__*/React.createElement("div", {
    className: "empty-state"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/brand/honey-hive-icon.png",
    alt: "",
    className: "empty-icon"
  }), /*#__PURE__*/React.createElement("div", {
    className: "empty-headline"
  }, headline), /*#__PURE__*/React.createElement("p", {
    className: "empty-body"
  }, body), /*#__PURE__*/React.createElement(window.HMDS.Button, null, cta)));
}
function DashboardApp() {
  const [view, setView] = useStateApp("fleet");
  const [theme, setTheme] = useStateApp("dark");
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next === "light" ? "hive-light" : "");
  };
  let screen;
  if (view === "fleet") screen = /*#__PURE__*/React.createElement(window.FleetScreen, {
    onChat: () => setView("chat")
  });else if (view === "chat") screen = /*#__PURE__*/React.createElement(window.ChatScreen, null);else if (view === "wallets") screen = /*#__PURE__*/React.createElement(window.WalletsScreen, null);else if (view === "swarm") screen = /*#__PURE__*/React.createElement(EmptyView, {
    eyebrow: "Coordination with attribution",
    title: "Swarm",
    headline: "No active swarm pass",
    body: "Launch a multi-agent pass with /swarm in chat. You'll see the objective, who's assigned, the current phase, and what needs approval.",
    cta: "Start a swarm"
  });else if (view === "brain") screen = /*#__PURE__*/React.createElement(EmptyView, {
    eyebrow: "Shared memory",
    title: "Shared Brain",
    headline: "No shared brain connected yet",
    body: "Connect an Obsidian vault to give agents a common place for memory, handoffs, and shared project context.",
    cta: "Connect a vault"
  });else if (view === "security") screen = /*#__PURE__*/React.createElement(EmptyView, {
    eyebrow: "Trust made visible",
    title: "Security",
    headline: "Your fleet is private by default",
    body: "Everything runs on your Tailnet with read-only collectors and no public ports. Secrets are stored locally and never exposed in overview UI.",
    cta: "Review trust posture"
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "app-shell"
  }, /*#__PURE__*/React.createElement(window.NavRail, {
    active: view,
    onNavigate: setView,
    theme: theme,
    onToggleTheme: toggleTheme
  }), /*#__PURE__*/React.createElement("main", {
    className: "app-main"
  }, screen));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(DashboardApp, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/shell.jsx
try { (() => {
/* Dashboard shell — left nav rail + top bar + shared bits, ported cosmetically
   from AppNavShelf.tsx / globals.css. Exports to window for the other screens. */

const {
  useState
} = React;
const HMDS = window.HivemindOSDesignSystem_65eabf;
const NAV = [{
  id: "fleet",
  label: "Fleet"
}, {
  id: "chat",
  label: "Chat"
}, {
  id: "swarm",
  label: "Swarm"
}, {
  id: "brain",
  label: "Brain"
}, {
  id: "wallets",
  label: "Wallets"
}, {
  id: "security",
  label: "Security"
}];
function NavIcon({
  id
}) {
  const p = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };
  switch (id) {
    case "fleet":
      return /*#__PURE__*/React.createElement("svg", p, /*#__PURE__*/React.createElement("polygon", {
        points: "12 2 20 7 20 17 12 22 4 17 4 7"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "2.4"
      }));
    case "chat":
      return /*#__PURE__*/React.createElement("svg", p, /*#__PURE__*/React.createElement("path", {
        d: "M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z"
      }));
    case "swarm":
      return /*#__PURE__*/React.createElement("svg", p, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "2"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "5",
        cy: "6.5",
        r: "1.6"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "19",
        cy: "6.5",
        r: "1.6"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "5.5",
        cy: "18",
        r: "1.6"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "18.5",
        cy: "18",
        r: "1.6"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M10.4 10.7 6.3 7.6M13.6 10.7l3.9-3M10.6 13.4 6.7 16.6M13.4 13.4l3.6 3"
      }));
    case "brain":
      return /*#__PURE__*/React.createElement("svg", p, /*#__PURE__*/React.createElement("path", {
        d: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.5A3 3 0 0 0 9 18V4z"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.5A3 3 0 0 1 15 18V4z"
      }));
    case "wallets":
      return /*#__PURE__*/React.createElement("svg", p, /*#__PURE__*/React.createElement("rect", {
        x: "3",
        y: "6",
        width: "18",
        height: "13",
        rx: "2.2"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M3 9.5h18"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "16.5",
        cy: "13.5",
        r: "1.1",
        fill: "currentColor",
        stroke: "none"
      }));
    case "security":
      return /*#__PURE__*/React.createElement("svg", p, /*#__PURE__*/React.createElement("path", {
        d: "M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z"
      }), /*#__PURE__*/React.createElement("path", {
        d: "m9.5 12 1.8 1.8L15 10"
      }));
    default:
      return null;
  }
}
function NavRail({
  active,
  onNavigate,
  theme,
  onToggleTheme
}) {
  const [open, setOpen] = useState(false);
  return /*#__PURE__*/React.createElement("nav", {
    className: "nav-rail",
    "data-open": open ? "" : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false)
  }, /*#__PURE__*/React.createElement("button", {
    className: "nav-brand",
    onClick: () => onNavigate("fleet"),
    title: "HivemindOS \xB7 Fleet"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/icon-512.png",
    alt: "HivemindOS"
  }), /*#__PURE__*/React.createElement("span", {
    className: "nav-label"
  }, "HivemindOS")), /*#__PURE__*/React.createElement("div", {
    className: "nav-group"
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: "nav-item",
    "data-active": active === n.id ? "" : undefined,
    onClick: () => onNavigate(n.id),
    title: n.label
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-ico"
  }, /*#__PURE__*/React.createElement(NavIcon, {
    id: n.id
  })), /*#__PURE__*/React.createElement("span", {
    className: "nav-label"
  }, n.label)))), /*#__PURE__*/React.createElement("div", {
    className: "nav-foot"
  }, /*#__PURE__*/React.createElement("button", {
    className: "nav-item",
    onClick: onToggleTheme,
    title: "Toggle theme"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-ico"
  }, theme === "light" ? /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"
  })) : /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "4.2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"
  }))), /*#__PURE__*/React.createElement("span", {
    className: "nav-label"
  }, theme === "light" ? "Dark mode" : "Light mode")), /*#__PURE__*/React.createElement("div", {
    className: "nav-ver"
  }, "v0.18.2")));
}
function TopBar({
  title,
  eyebrow,
  children
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "topbar-eyebrow"
  }, eyebrow), /*#__PURE__*/React.createElement("h1", {
    className: "topbar-title"
  }, title)), /*#__PURE__*/React.createElement("div", {
    className: "topbar-right"
  }, children));
}

// Health chip used in top bars
function HealthChip({
  dot,
  label
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "health-chip"
  }, /*#__PURE__*/React.createElement(HMDS.StatusDot, {
    tone: dot
  }), /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(window, {
  NavRail,
  TopBar,
  HealthChip,
  HMDS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/shell.jsx", error: String((e && e.message) || e) }); }

__ds_ns.HexCell = __ds_scope.HexCell;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.CopyableCodeLine = __ds_scope.CopyableCodeLine;

__ds_ns.Segmented = __ds_scope.Segmented;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
