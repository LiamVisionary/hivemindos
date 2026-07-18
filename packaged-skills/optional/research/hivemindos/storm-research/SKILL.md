---
name: storm-research
description: Use for non-trivial research, strategic decisions, market/company/topic analysis, briefings, due diligence, or any request that needs more than a single-source answer. Runs a STORM-style multi-perspective workflow with source gathering, expert lenses, contradiction mapping, synthesis, confidence review, and citations. Trigger when the user asks for a research brief, deep research, "look at this from multiple angles", compare evidence, find blind spots, prepare for a decision, or use the Research Bee's STORM mode.
---

# STORM Research

Use this skill when the user needs a grounded research brief rather than a single-pass answer. The goal is not to make the answer longer; it is to make the thinking harder to fool.

## Operating Modes

Choose the smallest mode that fits the request:

- **Quick source check**: verify the main claim, cite the best sources, name uncertainty, and give a concise answer.
- **STORM brief**: run the full multi-perspective pass, contradiction map, synthesis, and peer review.
- **Full research swarm**: split the work into lanes or agents when tools/routing support it, then reconcile the outputs into one brief.

If the user or agent profile names a mode, use that mode. Otherwise use STORM brief for important or ambiguous research.

## Workflow

1. **Frame the question**
   - Restate the decision or topic in one sentence.
   - Identify what would change the user's action or belief.
   - Note time sensitivity and browse/current-source needs.

2. **Gather evidence**
   - Use current sources when facts may have changed.
   - Prefer primary sources, official docs, papers, filings, reputable data, and dated reporting.
   - Track source title, URL or vault path, date, core claim, and limits.

3. **Run expert lenses**
   - Practitioner: what daily operators know that outsiders miss.
   - Academic: what peer-reviewed or systematic evidence says.
   - Skeptic: strongest counterargument and ignored evidence.
   - Incentives: who benefits, pays, profits, or has distorted incentives.
   - Historian: comparable past patterns and how they resolved.

4. **Map contradictions**
   - List specific claims that clash.
   - Identify which side has stronger evidence and why.
   - Name what every lens agrees on.
   - Name the blind spot none of the lenses handled.

5. **Synthesize and peer-review**
   - Rank findings by reliability.
   - Separate sourced facts, inference, and assumptions.
   - Give confidence scores or low/medium/high confidence.
   - Identify the weakest claim and what would verify it.
   - Call out overrepresented perspectives and missing lenses.

## Output Contract

When producing a research brief, use these exact markdown headings so HivemindOS can render the brief as tabs:

```markdown
## Perspectives
## Contradictions
## Synthesis
## Peer Review
## Sources
```

Keep each section proportional to the mode. Quick source checks can be short; full research swarm outputs can be denser.

## Source Discipline

- Cite sources for claims that depend on external facts.
- Include dates for time-sensitive sources.
- Do not smooth over conflicting evidence.
- Label assumptions and inference explicitly.
- If browsing or source access fails, state what could not be verified and continue with the safest available framing.

## Full Research Swarm Pattern

When tools or HivemindOS routing support multiple lanes, split work into:

- source scout: primary/current evidence
- practitioner lens: operational reality
- skeptic lens: counterevidence and failure modes
- incentives lens: money, power, and adoption pressure
- synthesis reviewer: contradiction map and final confidence

If no multi-agent routing is available, simulate these lanes in one pass and clearly label it as a solo synthesis.
