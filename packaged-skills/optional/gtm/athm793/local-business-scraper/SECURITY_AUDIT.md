# Security Audit: athm793/local-business-scraper

Verdict: Conditionally approved for optional HivemindOS packaging at commit `60e42d903dc52f43dcc9964f2d1c3d491c15ab5c`, local checkout plus fresh virtualenv install only, and explicit user confirmation before install, Chromium download, or scraping.

## Scope

- Repository: `https://github.com/athm793/local-business-scraper`
- Branch at audit time: `master`
- Commit: `60e42d903dc52f43dcc9964f2d1c3d491c15ab5c`
- Commit date: `2026-06-11 11:44:46 +0530`
- License: MIT
- Local deterministic git archive SHA-256: `71c3a61d4f3a56fcc4ff5f80c2b489de6d4008be0cea215cc60d8b6b7ed774de`

The audit covered source review, dependency resolution, vulnerability scanning, Bandit static analysis, Python compilation, and non-scraping CLI smoke checks. It did not run a live Google Maps scrape, install Playwright's Chromium browser binary, or verify Windows shortcut behavior on Windows.

## Threat Model

The package can receive:

- Local filesystem access to its checkout.
- Network access to Google Maps and PyPI/Playwright downloads.
- Browser automation authority through Playwright.
- Project-local persistent browser profile directories.
- User-supplied search terms and location CSV data.

Credentials at risk if misused include browser cookies, `.env` files, keychains, SSH keys, cloud CLIs, and HivemindOS shared env. The packaged skill forbids mounting or pointing the scraper at those stores.

## Source Findings

Reviewed files:

- `README.md`
- `requirements.txt`
- `scraper.py`
- `pool.py`
- `stealth.py`
- `db.py`
- `csv_writer.py`
- `gui_runner.py`
- `create_shortcut.py`
- `gui_config.py`
- `gui_locations.py`
- `gui_widgets.py`

Important behavior:

- The tool launches Playwright Chromium with persistent project-local profiles under `browser_profile*`.
- It navigates to `https://www.google.com/maps/search/...` and individual Google Maps place URLs.
- It writes local CSV output, SQLite databases, and `scraper_config.json`.
- It includes anti-detection behavior such as webdriver masking, user-agent/viewport rotation, human-like mouse/scroll timing, and CAPTCHA/block cooldown handling.
- It does not read `.env`, SSH, keychain, browser-cookie stores, cloud CLIs, or HivemindOS shared env by default.
- `create_shortcut.py` is Windows-only and invokes PowerShell to create a desktop shortcut. The packaged skill gates it behind explicit user request.

## Supply Chain

Upstream `requirements.txt` contains broad ranges:

```text
playwright>=1.44.0
customtkinter>=5.2.0
```

The audit temp virtualenv resolved:

- `playwright==1.60.0`
- `customtkinter==6.0.0`
- `greenlet==3.5.2`
- `pyee==13.0.1`
- `typing_extensions==4.15.0`
- `darkdetect==0.8.0`

Scanner results:

- `pip check`: no broken requirements.
- `pip-audit`: no known vulnerabilities for the resolved environment.
- `python -m compileall`: passed.
- `python scraper.py --help`: passed after dependency install.
- `python create_shortcut.py` on non-Windows failed before its platform guard because `winreg` is imported at module load time. This reinforces treating the shortcut helper as Windows-only and opt-in.

Docker was unavailable during the audit because the Docker daemon socket was not running, so dynamic install testing used a fresh temporary virtualenv with a blank HOME instead of a container. Re-audit in Docker or a VM before promoting this beyond optional local use.

## Static Analysis

`bandit -r` summary:

- High: 0
- Medium: 1
- Low: 52

Medium finding:

- `db.py` builds an INSERT statement with an f-string. The interpolated identifiers come from the class constant `Database.COLUMNS`, while values are parameterized. This is a review item, not a direct user-controlled SQL injection path in the audited code.

Relevant low findings:

- `create_shortcut.py` imports `subprocess` and invokes `powershell`.
- `gui_runner.py` invokes `explorer` to open the output folder.
- Broad `try/except/pass` handling appears throughout scraper and GUI paths.
- Non-cryptographic `random` is used for human-like timing; this is not security-sensitive randomness.

The HivemindOS wrapper avoids shortcut creation by default and treats the scraper as an interactive local tool, not a service.

## Hardening Applied

The packaged skill:

- Pins the upstream commit.
- Requires explicit user consent before install, Chromium download, and scraping.
- Requires a fresh checkout and virtualenv.
- Forbids using real browser profiles, cookies, keychains, shared env, SSH files, cloud CLIs, wallet data, or personal credential stores.
- Forbids unattended broad scraping, proxy/CAPTCHA additions, and background services.
- Treats outputs as sensitive lead data.
- Documents re-audit triggers.

## Residual Risk

- Google Maps automation may violate site terms or trigger anti-abuse systems.
- The anti-detection layer is intentionally evasive and should remain opt-in.
- The dependency ranges are broad; future installs can resolve newer packages unless constrained.
- Playwright's browser binary download was not audited in this pass.
- Live scraping behavior was not executed during the audit.
- Windows `.lnk` creation was not tested on Windows, and the helper does not fail gracefully on non-Windows.

Re-audit before any auto-install, hosted/cloud execution, scheduled scraping, managed service integration, or dependency/commit update.
