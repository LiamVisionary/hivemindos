# AI Brain Notebook Routing

## Canonical Memory

Search first:

```bash
hive-brain answer "Which NotebookLM notebook is the AI Brain session archive?" --scope agent-memory
hive-brain recall "NotebookLM AI Brain notebook ID and title" --scope agent-memory --limit 5
```

Store a new verified notebook selection:

```bash
hive-brain remember \
  --type fact \
  --title "NotebookLM AI Brain notebook" \
  --content "The NotebookLM session archive is '<title>' with full notebook ID <id>. Verified on <absolute timestamp>. Future wrap-ups should verify this ID with notebook_list before adding a source." \
  --memory-key "fact/notebooklm/ai-brain-notebook" \
  --source "User-approved wrap-up setup" \
  --proof auto
```

When the selected notebook changes, evolve the active memory instead of creating a second active record:

```bash
hive-brain evolve \
  --memory-id <current-memory-id> \
  --content "The NotebookLM session archive is '<new title>' with full notebook ID <new id>. Verified on <absolute timestamp>. Future wrap-ups should verify this ID with notebook_list before adding a source." \
  --reason "The prior AI Brain notebook was deleted, replaced, or the user selected a different archive."
```

Notebook IDs are identifiers, not authentication secrets. Still keep them inside the user's private Shared Brain and normal task receipts rather than public documentation.

## NotebookLM Checks

Prefer MCP:

1. `server_info`
2. `notebook_list`
3. `notebook_describe` for the exact stored ID when more detail is needed

If exactly one matching `AI Brain` notebook exists but no canonical memory exists, verify it and save the fact. If multiple candidates exist, ask the user. If none exists, ask before `notebook_create`.

## Adding A Summary

Use stdio MCP `source_add`:

```json
{
  "notebook": "<full-notebook-id>",
  "source_type": "file",
  "path": "<absolute-temp-summary-path>",
  "title": "Session Summary — YYYY-MM-DD",
  "wait": true
}
```

Verify the returned source ID through `source_list` or `source_read`. A successful upload followed by processing failure is not a completed archive; report the actual processing state.

CLI fallback, only when the HivemindOS-managed binary already exists:

```bash
"$HOME/.hivemindos/integrations/notebooklm/venv/bin/notebooklm" \
  source add "<absolute-temp-summary-path>" \
  --notebook "<full-notebook-id>" \
  --json
```

Do not fall back to `pip install`, a floating package version, a remote MCP tunnel, or auth-file copying.
