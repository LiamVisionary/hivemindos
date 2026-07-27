# Wrap-Up Memory Routing

Write only durable reviewed context that will change how a future agent acts.

| Session finding | Memory type | Keep when | Skip when |
| --- | --- | --- | --- |
| User correction or stable working style | `preference`, `instruction`, `learning` | Explicit and reusable | One-off wording or mood |
| Product/project direction | `decision`, `goal`, `commitment`, `context` | Reviewed and still active | Fully recoverable from current code/changelog |
| Stable account/tool selection | `fact` | Needed for future routing; no secret value | Provider token, cookie, or transient status |
| Reusable deliverable/reference | `artifact`, `fact` | Future sessions need the location or identity | Routine build output or disposable temp file |
| Reusable failure lesson | `error`, `learning` | Cause and application are confirmed | Transient failure with no general lesson |

## Write Gate

For each candidate:

1. Search typed memory for the same entity and subject.
2. Identify the current active memory head and any evolution chain.
3. Confirm the candidate from the user statement or session evidence.
4. Ask whether it remains useful when code, git history, and the session summary are unavailable.
5. Use `remember` only if genuinely new; use `evolve` if it updates current truth.

For durable project/feedback context, write a compact body containing:

```text
Current truth: <reviewed fact or decision>
Why: <why future agents need it>
How to apply: <specific future behavior>
Confirmed by: <user statement or artifact from this session>
```

Do not store raw transcripts or duplicate the NotebookLM session summary in typed memory. Typed memory is the compact routing layer; NotebookLM is the longer session archive.

## Operational Receipts

Routine commands, retries, build completion, and transient failures are not durable memory. When a significant run failure belongs in the bounded operational journal, use:

```bash
hive-brain record-operation \
  --title "<operation>" \
  --content "<redacted outcome>" \
  --operation-key "<domain/operation>" \
  --failure-key "<domain/failure>" \
  --outcome failure \
  --task-id "<task-id>"
```

Never put secrets, private keys, browser cookies, raw Tailnet IPs, or sensitive transcript excerpts in either durable memory or operational events.
