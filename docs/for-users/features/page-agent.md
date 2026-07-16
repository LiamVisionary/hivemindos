---
title: "Page Agent"
---

# Page Agent

> **Experimental — developer preview.** Page Agent is opt-in and off by default. It
> is an early feature and its behaviour, scope, and controls may change. Enable it
> only if you're comfortable with a preview.

Page Agent is an in-page agent that operates the HivemindOS dashboard for you from
plain language. You type what you want — *"open the work board and add a task",
"switch to the agents view"* — and it reads the current screen, decides which
control to use, and clicks and types for you.

It is built on the open-source [alibaba/page-agent](https://github.com/alibaba/page-agent)
project (MIT), driven through your own configured model.

## How to try it

Page Agent currently lives in the developer lab; it is not an installable My Apps
card and it does not mount across the normal dashboard. In a development build,
open `/page-agent-lab`. Production builds keep that lab unavailable unless the
operator starts the dashboard with `PAGE_AGENT_LAB=1`.

The lab shows a command bar. Type an instruction and Page Agent drives only that
lab page.

## What it can — and can't — reach

Page Agent works **inside the HivemindOS window only**. It reads and controls the
dashboard you're looking at.

- It **cannot** reach out to a separate Chrome, Safari, or other browser window,
  and it cannot control other desktop apps. Those need a different tool (see the
  browser-automation and computer-use capabilities), not Page Agent.
- It does not take screenshots or use your camera. It reads the page's structure
  as text and acts on it.

## Safety

The dashboard can move money (wallets, trading), so Page Agent is deliberately
constrained:

- **Money is off-limits.** Page Agent is kept away from wallet, trade, and
  transfer controls — moving funds always goes through the normal confirm-first
  wallet flow, never an automated click.
- **No arbitrary code.** The tool that would let it run generated JavaScript is
  disabled and stays disabled.
- **Fresh state before interaction.** Click, type, and selection tools re-read the
  page immediately before acting instead of trusting an old element number.
- **Untrusted pages pause the run.** Instruction-like page content is treated as
  data and suspected prompt injection stops the task for human review.
- **Consequences ask at the moment of action.** Submit, send, publish, purchase,
  transfer, delete, install, upload, and signature-shaped controls require a
  one-action confirmation.
- **Receipts survive reloads.** Governed runs retain redacted observations,
  policy decisions, action results, and post-action verification without storing
  typed text or secrets.
- **You stay in control.** It's opt-in, off by default, step-capped, and can be
  stopped mid-task at any time.

## Limitations

- Preview quality: it can misread an unusual control or take an extra step or two
  and correct itself.
- It needs a model that supports tool calling; if your active agent's model
  can't, Page Agent will tell you rather than guess.
- It operates one screen at a time — it doesn't span multiple windows or tabs.
- The developer lab is not a promise that every dashboard control is ready for
  autonomous operation. For general web browsing, HivemindOS uses the governed
  computer-interaction capability and Browser Use instead.
