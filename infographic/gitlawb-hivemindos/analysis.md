---
title: "HivemindOS + GitLawb Integration"
topic: "technical architecture"
data_type: "system/structure"
complexity: "moderate"
point_count: 8
source_language: "en"
user_language: "en"
---

## Main Topic
This infographic explains how GitLawb fits into HivemindOS as a default-feeling Code Proof capability while preserving HivemindOS as the private brain and task coordination layer.

## Learning Objectives
After viewing this infographic, the viewer should understand:
1. GitLawb CLI + DID is proof-ready by default, while the full node remains lazy/on-demand.
2. HivemindOS stores private memory and project routing; GitLawb stores signed code provenance.
3. The daily UX stays simple across Setup, Work, Fleet, Agents, and Integrations.

## Target Audience
- **Knowledge Level**: Intermediate
- **Context**: Product and architecture planning for HivemindOS Code Proof.
- **Expectations**: A clear, compact explanation of the strongest architecture fusion.

## Content Type Analysis
- **Data Structure**: System components with a staged setup and runtime proof flow.
- **Key Relationships**: HivemindOS Brain ↔ project registry ↔ Work tasks ↔ GitLawb CLI/DID ↔ optional local node.
- **Visual Opportunities**: Exploded system core, directional arrows, private/public boundary, compact status surfaces.

## Key Data Points (Verbatim)
- "GitLawb CLI + DID: enabled by default, non-blocking if install fails."
- "GitLawb node: optional, one-click, local/Tailnet-only by default."
- "Public node/federation: explicit opt-in only."
- "HivemindOS Brain remains private memory/audit."
- "GitLawb provides signed code provenance."
- "No private keys, secret env values, Tailnet IPs, or exact private vault paths should enter proof metadata."

## Layout × Style Signals
- Content type: system/structure -> suggests structural-breakdown
- Tone: technical, product architecture -> suggests technical-schematic
- Audience: builders and operators -> suggests engineering clarity
- Complexity: moderate -> suggests one central system with labeled callouts

## Design Instructions (from user input)
Create an infographic using the baoyu-infographic skill for how GitLawb integrates with HivemindOS.

## Recommended Combinations
1. **structural-breakdown + technical-schematic** (Recommended): Best for an exploded view of the architecture and privacy boundary.
2. **hub-spoke + subway-map**: Good for showing HivemindOS as hub with surface routes.
3. **bento-grid + pop-laboratory**: Good for a dense product overview.
