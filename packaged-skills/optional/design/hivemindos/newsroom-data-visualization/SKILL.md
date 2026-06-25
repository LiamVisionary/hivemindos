---
name: newsroom-data-visualization
description: Use when a user wants a publication-grade chart, annotated data story, dashboard panel, or report graphic with careful chart choice, sourcing, uncertainty, labels, and responsive rendering.
---

# Newsroom Data Visualization

Turn data into a clear graphic with editorial discipline.

## Contract

Do not make unsupported claims. Show uncertainty, source limitations, and transformations. For current data, verify freshness with current sources before presenting conclusions.

## Inputs

- Dataset, source, question, audience, and desired takeaway.
- Output: chart spec, SVG/HTML, static image, dashboard component, or written analysis.

## Workflow

1. Define the reader question and the comparison that answers it.
2. Inspect data shape, units, missingness, outliers, and time range.
3. Choose the simplest chart type that preserves the truth:
   - line for change over time
   - bar for ranked comparison
   - scatter for relationship
   - map only when geography is the point
   - small multiples when one chart hides variation
4. Annotate the story directly on the graphic.
5. Use restrained color: highlight meaning, not decoration.
6. Include source, date, unit, and caveats.
7. Verify readability, axis honesty, mobile sizing, and color contrast.

## Capability Map

- Data work: use structured parsers and analysis tools rather than ad hoc string handling.
- Frontend charts: use existing charting libraries in the repo when possible.
- Reports: combine with `swiss-grid-editorial-page` for longform layouts.

## Safety

- Do not hide baseline choices or cherry-pick ranges.
- Do not present estimates as measured facts.
- Do not use private datasets in external tools without approval.

## Provenance

This is a HivemindOS-authored clean-room skill inspired by public data-visualization skill ideas. No unlicensed upstream text, JSON, or scripts are copied.
