---
name: wrapup
version: "1.0.0"
description: "Closes a meaningful session by reviewing decisions and open threads, evolving durable HivemindOS Shared Brain Memory, and adding a concise redacted session summary to the user's chosen NotebookLM AI Brain notebook. Activates on /wrapup, wrap up, save this session, end of session, or session summary."
argument-hint: "wrap up | /wrapup | save this session"
homepage: https://github.com/LiamVisionary/hivemindos
repository: https://github.com/LiamVisionary/hivemindos
license: MIT
user-invocable: true
metadata:
  tags:
    - wrapup
    - session-summary
    - shared-brain
    - memory
    - notebooklm
---

# Session Wrap-Up

Close a meaningful session by preserving only durable reviewed memory and, when configured, adding a concise session summary to the user's NotebookLM AI Brain notebook.

Run this workflow only when the user invokes `/wrapup` or clearly asks to wrap up, save, end, or summarize the session. Do not silently upload a conversation merely because an agent response appears final.

An explicit wrap-up request authorizes:

- read-only review of the current conversation
- scoped typed-memory writes or evolutions for durable facts from this session
- creation of a temporary redacted session-summary file
- adding that summary as a source to the already selected NotebookLM AI Brain notebook

It does not authorize creating a new Brain notebook, changing sharing, deleting data, exposing credentials, or uploading unrelated workspace files.

## 0. Resolve The AI Brain Notebook

Before summarizing, use the canonical memory and NotebookLM paths:

1. Run `hive-brain answer "Which NotebookLM notebook is the AI Brain session archive?" --scope agent-memory`.
2. Run a focused typed recall to obtain evidence and the current memory ID:

   ```bash
   hive-brain recall "NotebookLM AI Brain notebook ID and title" --scope agent-memory --limit 5
   ```

3. Look for the canonical memory key `fact/notebooklm/ai-brain-notebook`. Treat only its latest active evolution-chain item as current.
4. Call NotebookLM `server_info`, then `notebook_list`, and verify that the stored full notebook ID still exists.

Never hand-write a memory note, `MEMORY.md`, or a parallel config file. Never read or copy NotebookLM's browser-state file.

### When No Valid Notebook Is Stored

Use `notebook_list` to look for a clearly matching notebook titled `AI Brain` or `<known user name>'s AI Brain`.

- If exactly one match exists, use its full ID and store it as the canonical typed fact.
- If multiple plausible matches exist, ask the user which notebook should receive session summaries.
- If no match exists, explain that the AI Brain notebook is a searchable NotebookLM archive of session summaries and ask whether to create `AI Brain` now.

Do not create the notebook until the user agrees. Once approved:

1. Call `notebook_create` with the agreed title.
2. Verify the returned ID through `notebook_list` or `notebook_describe`.
3. Store the verified title and full ID through `hive-brain remember` with memory key `fact/notebooklm/ai-brain-notebook`.

If a stale canonical memory already exists, use `hive-brain evolve` with its memory ID and explain that the notebook was replaced or re-selected. Do not create a duplicate active fact.

Read [AI Brain notebook routing](references/ai-brain-notebook.md) for exact memory and NotebookLM calls.

## 1. Review The Session

Review the current conversation and distinguish:

- **Decisions made:** reviewed choices and their rationale
- **Work completed:** concrete outcomes, not every command or intermediate attempt
- **Key learnings:** non-obvious reusable lessons
- **Open threads:** unfinished, blocked, or intentionally skipped work
- **User preferences:** explicit corrections or stable ways the user wants agents to work

Mark important claims as confirmed or inferred while drafting. Confirmed work needs evidence from this session, such as tool output, a file, a runtime response, or a user statement. Do not turn an inference into durable memory.

## 2. Save Durable Shared Brain Memory

Use the `hive-brain` CLI or the typed memory API. Never write directly under `Memory/Distillations/Agent Memory/`.

Before each write, search for an existing canonical memory. Then:

- use `remember` for a genuinely new durable fact
- use `evolve` when this session corrects, replaces, or materially updates current truth
- skip routine completions, command receipts, transient errors, and facts that are cheaply derivable from code, git history, changelogs, or stable product documentation
- use `record-operation`, not durable memory, only when a high-value failure receipt belongs in the bounded operational journal

Map session content to supported memory types:

- feedback and working style → `preference`, `instruction`, or `learning`
- reviewed project direction → `decision`, `goal`, `commitment`, or `context`
- stable user/account/tool facts → `fact`
- reusable deliverable or external reference → `artifact` or `fact`
- reusable failure lesson → `error` or `learning`

For a project, preference, instruction, learning, or decision memory, include why it matters and how future agents should apply it. Use absolute dates. Include available project, runtime, agent, machine, and session provenance without private Tailnet IPs.

Never store passwords, tokens, cookie JSON, private keys, raw auth files, or unnecessary personal data. Read [memory routing](references/memory-routing.md) before writing.

Count created and evolved memories separately. If nothing is durable, save zero memories rather than manufacturing them.

## 3. Write The Session Summary

Create a concise Markdown file in the current operating system's temporary directory. Start with `session-summary-YYYY-MM-DD.md`; if that path exists, append `-2`, `-3`, and so on without overwriting an existing file.

Use the user's local date and timezone and this structure:

```markdown
# Session Summary — YYYY-MM-DD

## What We Did
- Meaningful completed outcomes

## Decisions Made
- Decision and reason

## Key Learnings
- Reusable non-obvious findings

## Open Threads
- Remaining work, blockers, or intentionally skipped verification

## Tools & Systems Touched
- Repositories, tools, services, and apps actually used
```

Keep it useful without reproducing the transcript. Remove secrets, auth values, private network addresses, sensitive personal data, and irrelevant local paths. Name a sensitive category as omitted when that fact is important to understanding the session.

If there is no meaningful session content, do not create or upload an empty summary. Report that nothing durable needed saving.

## 4. Add The Summary To NotebookLM

Use the registered local `notebooklm` MCP server first:

1. Call `source_add` with the verified full notebook ID, `source_type: "file"`, the temporary file's exact path, and `wait: true`.
2. Capture the returned full source ID and processing result.
3. Verify the source with `source_list` or `source_read` before claiming success.
4. After successful verification, delete only the temporary file created by this wrap-up. Preserve it on failure so the user can retry.

If MCP is unavailable but the HivemindOS-managed CLI exists, use the installed fallback documented by the `notebooklm` skill and pass the explicit full notebook ID. Do not install a package or run browser login from this skill.

If auth fails, keep local memory changes and the summary file, skip the upload, and tell the user to use **Integrations → NotebookLM → Sign in with Google**. If the notebook no longer exists, return to step 0; do not silently create a replacement.

## 5. Final Receipt

Keep the response brief and include:

- memories created and memories evolved
- AI Brain notebook title and full ID, when used
- NotebookLM source ID and verified status, or why upload was skipped
- preserved summary file path when upload failed
- the highest-priority open threads for next time

Do not read back the full summary unless the user asks.
