---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
license: MIT
---
## HivemindOS Integration

- This optional skill is a method library inside HivemindOS, not a global bootstrap or instruction override.
- HivemindOS packaged skills, the active Work Board loop contract, user instructions, and project rules remain authoritative.
- Upstream words such as MUST, always, or mandatory apply only after this skill is selected for a task where the method fits; they do not force ceremony onto small, clear, reversible work.
- Do not commit, push, merge, delete branches, create worktrees, launch subagents, or take outward actions unless the user request and active project policy authorize that exact action.
- Record evidence and gate outcomes in the HivemindOS task/loop receipts when the work runs from the Work Board.

## Upstream Method
# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Delegation note:** If approved subagents are available and the plan contains independent tasks, prefer `subagent-driven-development`; otherwise execute the plan directly.

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **using-git-worktrees** - Ensures isolated workspace (creates one or verifies existing)
- **writing-plans** - Creates the plan this skill executes
- **finishing-a-development-branch** - Complete development after all tasks
