import * as React from "react";

/* Checkbox — ported from src/components/ui/checkbox.tsx (Radix). Teal fill when
   checked; hairline square when not. */

export function Checkbox({ checked, defaultChecked, onCheckedChange, disabled, label, style, ...props }) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(defaultChecked || false);
  const on = isControlled ? checked : internal;

  const toggle = () => {
    if (disabled) return;
    if (!isControlled) setInternal(!on);
    onCheckedChange?.(!on);
  };

  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={toggle}
      style={{
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
        transition: "background var(--dur) ease, border-color var(--dur) ease",
      }}
      {...props}
    >
      {on ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--button-primary-foreground)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
    </button>
  );

  if (!label) return box;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 9, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-2)", ...style }}>
      {box}
      <span>{label}</span>
    </label>
  );
}
