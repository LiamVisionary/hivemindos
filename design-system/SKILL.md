---
name: hivemindos-design
description: Use this skill to generate well-branded interfaces and assets for HivemindOS, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Key files:
- `readme.md` — the design guide: brand voice, visual foundations, iconography, component + UI-kit index.
- `styles.css` — link this one file to pick up all tokens and fonts.
- `tokens/` — colors, typography, spacing, effects.
- `components/` — Button, Badge, StatusDot, Card, Checkbox, CopyableCodeLine, HexCell (each has a `.prompt.md` with usage).
- `ui_kits/dashboard/` — an interactive control-room recreation to copy patterns from.
- `assets/` — logos, bee role portraits, brand glyphs, runtime marks.

Design rules to honor: simple first, depth on demand; plain human copy; keep coordination attributed; one card = one main job; hive structure stays subtle (no bee mascots inside the UI).
