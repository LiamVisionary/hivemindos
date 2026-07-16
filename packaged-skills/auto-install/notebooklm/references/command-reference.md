# NotebookLM Command Reference

Prefer the MCP server. The CLI examples are fallbacks for an already installed HivemindOS integration.

## MCP Tools

| Intent | Tool | Notes |
| --- | --- | --- |
| Health/auth | `server_info` | Read-only; do not request account details unless needed. |
| List notebooks | `notebook_list` | Read-only. |
| Create/inspect/rename | `notebook_create`, `notebook_describe`, `notebook_rename` | Use the returned full notebook ID. |
| Delete notebook | `notebook_delete` | Destructive; exact target authorization and `confirm: true` required. |
| List/read sources | `source_list`, `source_read` | Read-only. |
| Add sources | `source_add`, `source_add_drive_file` | Supports URLs, text, and authorized files/Drive items. |
| Wait for ingestion | `source_wait`, `await_upload` | Poll only when waiting was requested. |
| Rename/delete source | `source_rename`, `source_delete` | Delete is destructive and requires confirmation. |
| Ask grounded questions | `chat_ask` | Preserve citations and source IDs in the answer. |
| Configure chat | `chat_configure` | Affects subsequent notebook chat behavior. |
| Save note | `note_save` | Write action. |
| Start/check/import research | `research_start`, `research_status`, `research_import` | Import writes sources into the notebook. |
| Cancel research | `research_cancel` | State-changing; re-check status afterward. |
| List/generate/status | `studio_list`, `studio_generate`, `studio_status` | Artifacts include audio, video, reports, slides, infographics, mind maps, tables, quizzes, and flashcards. |
| Download artifact | `studio_download` | Filesystem write; verify the output path and file. |
| Rename/retry/delete artifact | `studio_rename`, `studio_retry`, `studio_delete` | Delete is destructive and requires confirmation. |
| Inspect/change sharing | `share_status`, `share_set_access`, `share_set_user`, `share_remove_user` | Sharing changes are outward-facing; verify recipient and role. |

## CLI Fallback

Resolve the HivemindOS-managed executable first:

```bash
NOTEBOOKLM="$HOME/.hivemindos/integrations/notebooklm/venv/bin/notebooklm"
test -x "$NOTEBOOKLM"
```

Use `--json` for machine-readable output and full IDs for automation.

| Intent | Command |
| --- | --- |
| Verify live auth | `$NOTEBOOKLM auth check --test --passive --json` |
| List notebooks | `$NOTEBOOKLM list --json` |
| Create notebook | `$NOTEBOOKLM create "Title" --json` |
| Add URL or file | `$NOTEBOOKLM source add <url-or-path> -n <notebook_id> --json` |
| List sources | `$NOTEBOOKLM source list -n <notebook_id> --json` |
| Ask a question | `$NOTEBOOKLM ask "Question" -n <notebook_id> --json` |
| Start deep research | `$NOTEBOOKLM source add-research "Query" -n <notebook_id> --mode deep --no-wait --json` |
| Check research | `$NOTEBOOKLM research status -n <notebook_id> --json` |
| Generate audio | `$NOTEBOOKLM generate audio "Instructions" -n <notebook_id> --json` |
| Generate report | `$NOTEBOOKLM generate report --format briefing-doc -n <notebook_id> --json` |
| List artifacts | `$NOTEBOOKLM artifact list -n <notebook_id> --json` |
| Download audio | `$NOTEBOOKLM download audio <output.mp3> -n <notebook_id>` |

Before using a less common command, inspect its local help rather than guessing flags:

```bash
$NOTEBOOKLM <group> <command> --help
```

Do not invoke `login`, `auth logout`, package installation, or runtime registration from an agent shell. Those are user-visible HivemindOS Integrations actions.
