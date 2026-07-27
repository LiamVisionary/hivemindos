"use client";

import React from "react";

export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mono-cap" style={{ color: "var(--fg-4)" }}>{label}</span>
      {children}
      {hint ? (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.45 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export const FORM_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--panel-2)",
  border: "1px solid var(--line-2)",
  borderRadius: 9,
  padding: "9px 11px",
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 13.5,
  outline: "none",
};

type FormSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange" | "value"
> & {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
};

export function FormSelect({
  value,
  onChange,
  options,
  style,
  onFocus,
  onBlur,
  ...props
}: FormSelectProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <select
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={{
        ...FORM_INPUT_STYLE,
        appearance: "none",
        cursor: props.disabled ? "not-allowed" : "pointer",
        borderColor: focused ? "var(--honey-2)" : "var(--line-2)",
        ...style,
      }}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
