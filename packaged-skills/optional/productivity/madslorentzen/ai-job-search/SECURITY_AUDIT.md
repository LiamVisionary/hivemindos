# Security audit

## Verdict

Conditionally approved for optional HivemindOS packaging at commit `fab1e78fa293d0255d739162a4f8f82db4144876`. The package is local-first and draft-only by default. Portal clients perform explicit read-only network requests when invoked; Gmail is read-only; Notion mutations and every employer-facing action require user approval.

## Review performed

- Reviewed the complete repository file inventory, MIT license, upstream threat model, runtime permissions, workflow specifications, portal source/tests, Python helpers, TeX templates, and all six package manifests.
- Ran the Hive candidate audit against the whole repository and again against selected workflow/source paths.
- Result: no high-severity findings.
- One medium remote-shell-installer finding was in upstream setup documentation. That file is excluded and the HivemindOS skill explicitly forbids piping downloaded content into a shell.
- One medium dynamic-evaluation finding was a false positive on the Markdown heading `Work Area / Function`; the referenced file contains no dynamic evaluation.

## Executable surface

- LinkedIn and FreeHire clients have zero runtime dependencies and use Bun's fetch/runtime APIs.
- The four Danish portal clients declare `@bunli/core`, `@bunli/utils`, `node-html-parser` where needed, and `zod`. None declares package lifecycle scripts.
- Upstream does not ship dependency lockfiles for the portal clients. HivemindOS therefore does not auto-install dependencies; installation must happen in an isolated workspace copy after approval, with lifecycle scripts disabled where supported.
- Python helpers use the standard library. `verify_pdf.py` invokes only explicit `pdfinfo` and `pdftotext` binaries against the selected local PDF. Salary scripts read user-supplied local data.
- Portal tests mock network access except for separately documented live smoke tests. HivemindOS verification does not run live portal crawls by default.

## Data and network boundaries

- Job postings and stored gap text are untrusted data, never instructions.
- Portal clients access public listing/detail endpoints only when the user runs a search. Search volume is bounded and rate limits are respected.
- LinkedIn access is personal-use-only. The workflow never fetches LinkedIn people-search result pages.
- Candidate files, trackers, generated documents, salary data, Gmail state, and archives remain in the user-chosen private workspace.
- Gmail messages are read for classification only; every proposed local state change is source-cited and approval-gated.
- Notion receives pipeline metadata and document filenames only. Profile and document contents never sync.
- Applications, messages, follow-ups, and remote database changes are never sent automatically.

## Remaining operator checks

- Review the terms and robots policy of every portal before adding a new adapter.
- Review current dependency resolution before installing the four dependency-bearing portal clients because upstream provides no lockfiles.
- Verify TeX and Poppler executables from trusted local installations before compiling private documents.
- Visually inspect final PDFs and the extracted ATS text before manually submitting them.
