#!/usr/bin/env bash
# Back-compat shim. This installer was renamed to install-mobile-backend.sh —
# the "claw backend" is the HivemindOS Mobile backend (the on-machine service the
# iPhone app talks to). Older callers, docs, or muscle memory may still invoke
# the old name; forward to the new script so nothing breaks.
exec "$(dirname "${BASH_SOURCE[0]}")/install-mobile-backend.sh" "$@"
