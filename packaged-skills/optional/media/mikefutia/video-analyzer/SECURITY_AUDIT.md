# Security Audit: mikefutia/claude-vision

Verdict: Conditionally approved for optional HivemindOS packaging at commit `0665eb3f782f92cd50179e61ac66e6c504cd754e`, using the pinned `google-genai==1.64.0` dependency and explicit approval before each Google Gemini upload.

## Scope

- Repository: `https://github.com/mikefutia/claude-vision`
- Commit: `0665eb3f782f92cd50179e61ac66e6c504cd754e`
- Source archive SHA-256: `eba0e7725f035c52fa401e0cdd83229249241949c572d0e8ded4b56f5f46e2fb`
- Upstream files reviewed: `.gitignore`, `README.md`, `SKILL.md`, and `scripts/analyze_video.py`
- Upstream history reviewed: both commits present at audit time
- License evidence: the README declares MIT, but the repository has no standalone license file and GitHub reports no detected license

## Threat Model

The helper receives a user-selected local video path, reads the complete file, reads one named Gemini credential from the process environment, and sends the video plus prompt to Google's Gemini API. Files up to 18 MB are sent inline. Larger videos use the Gemini Files API, where Google documents automatic deletion after 48 hours; the HivemindOS adaptation also requests deletion immediately after analysis.

The package does not need unrelated application profiles, cookies, keychains, SSH files, cloud CLI credentials, financial credentials, arbitrary `.env` files, persistent services, shell-profile edits, or broad directory scanning.

## Source Findings

- The Python helper uses `pathlib` to validate and read only the supplied video path.
- Network behavior is limited to the official `google-genai` client: inline generation, Files API upload/status/delete for larger files, and model generation.
- No subprocess, shell execution, dynamic evaluation, usage-reporting SDK, updater, persistence, listener, or lifecycle hook is present.
- The upstream README recommended global pip installation, `--break-system-packages`, shell-profile edits, and printing a credential-bearing environment variable during troubleshooting. The packaged copy removes those instructions.
- The upstream large-file path left uploads for Google's automatic 48-hour expiry. The packaged helper requests deletion in a `finally` block and reports cleanup failure without printing secret values.

## Dependency Review

- Direct dependency: `google-genai==1.64.0` (Apache-2.0 wheel).
- Audited wheel SHA-256: `78a4d2deeb33b15ad78eaa419f6f431755e7f0e03771254f8000d70f717e940b`.
- A clean Python 3.12 virtual environment resolved 33 packages and passed `pip check`.
- `pip-audit` found no known vulnerabilities in the resolved runtime dependencies. It did flag the audit environment's bootstrap `pip==25.0.1`, so installation guidance requires upgrading pip before installing the SDK.
- Bandit reported no findings in the upstream Python source.

## HivemindOS Hardening

- The skill remains optional and is never auto-installed or auto-run.
- A `--confirm-upload` flag is mandatory at the script boundary and may be supplied only after the user approves the specific external upload.
- Credential lookup is restricted to `GEMINI_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`, and `GOOGLE_API_KEY`; values are never printed.
- HivemindOS shared-env execution is documented instead of shell-profile mutation.
- The stable `gemini-3-flash` model replaces the upstream preview default.
- Large Files API uploads are deleted after analysis when possible; cleanup failures warn that Google's documented 48-hour retention may still apply.
- Dependency installation is a separate approval-gated action in an isolated virtual environment; global installs and `--break-system-packages` are forbidden.

## Residual Risk

A run sends the complete selected video and prompt to Google, where provider terms, billing, regional availability, and data-handling policy apply. Immediate Files API deletion is best-effort, inline request handling is provider-controlled, and model output can still be wrong despite the anti-hallucination prompt. No live video was uploaded during this audit; network behavior was verified by source tracing and mocked client tests. Re-audit before changing the upstream commit, SDK version, model default, credential set, or upload/cleanup behavior.
