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

## How to turn it on

Page Agent is an **installable app**. Open **My Apps**, find **Page Agent**, and
enable it. It stays off until you do, and you can turn it off again at any time.
It's a per-machine choice — enabling it on This Mac does not enable it elsewhere.

Once enabled, a command bar appears; type an instruction and it drives the screen.

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
- **You stay in control.** It's opt-in, off by default, step-capped, and can be
  stopped mid-task at any time.

## Limitations

- Preview quality: it can misread an unusual control or take an extra step or two
  and correct itself.
- It needs a model that supports tool calling; if your active agent's model
  can't, Page Agent will tell you rather than guess.
- It operates one screen at a time — it doesn't span multiple windows or tabs.
