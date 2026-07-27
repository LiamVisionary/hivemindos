---
version: alpha
name: HivemindOS
description: Calm, legible private-swarm controls with restrained hive character.
colors:
  background: "#0C0D11"
  surface: "#14161C"
  foreground: "#F3F0E9"
  muted: "#A7A39A"
  primary: "#E7B45C"
  on-honey: "#1A1305"
  live: "#6FCDBA"
  danger: "#E58E85"
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 2.75rem
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "0em"
  body-md:
    fontFamily: Geist
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  control-label:
    fontFamily: Geist
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0em"
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.0875rem"
rounded:
  control: 9999px
  field: 9px
  card: 14px
spacing:
  control-x: 15px
  control-y: 10px
  card: 20px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-honey}"
    typography: "{typography.control-label}"
    rounded: "{rounded.control}"
    padding: "{spacing.control-y}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-honey}"
    typography: "{typography.control-label}"
    rounded: "{rounded.control}"
    padding: "{spacing.control-y}"
---

## Overview

HivemindOS is a calm local control room for complex agent systems. Visual hierarchy should come from spacing, contrast, scale, and restrained accents—not from shouting through heavy control typography.

This file is the machine-readable agent contract. The fuller rationale and specimens live in `public/design-system/readme.md`, the production primitives live in `src/design-system/ui/`, and the runtime tokens live in `public/design-system/tokens/` plus the app token styles.

## Colors

- Honey identifies the one primary action on a surface.
- Mint communicates live or working state, not generic emphasis.
- Warm graphite surfaces and off-white text keep the control room calm and legible.
- Danger is reserved for destructive, risky, or money-moving actions.

## Typography

- Use Geist for body and control copy, Space Grotesk for display headings, and JetBrains Mono for compact technical labels and metrics.
- Interactive control labels default to weight `500` and must stay within `400–600`.
- Never use `700`, `800`, `900`, `bold`, `extrabold`, or `black` for button or action-control labels.
- Weights `700+` are reserved for genuinely display-oriented headings or large metrics where the stronger mass is intentional.
- Sentence case is the default for controls. Uppercase is limited to tiny mono eyebrows with deliberate tracking.

## Components

- Reuse `Button` from `src/design-system/ui/button.tsx` for primary and supporting actions whenever practical.
- Buttons are pill-shaped, medium weight, and visually prioritized through color and placement.
- Keep one loud action per card or panel; supporting actions should be quieter variants.
- One-off controls must follow the same typography contract as the shared primitive.

## Do's and Don'ts

- Do create emphasis with hierarchy, whitespace, contrast, and a single honey action.
- Do use the shared design-system primitives and tokens before adding local styles.
- Do keep control labels calm and readable at weight `500` by default.
- Don't use heavy display typography on buttons, tabs, segmented controls, or action links.
- Don't add a typography-guard baseline entry for new work; baseline entries represent legacy debt to remove.
