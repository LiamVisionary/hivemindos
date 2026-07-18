#!/usr/bin/env bash
# set-api-budget.sh — put hard cost guardrails on a Google Cloud API.
# Sets per-day quota caps (the hard backstop) + a monthly billing budget (the
# alert tripwire) for one project/service. READ the SKILL.md first — this makes
# REAL writes to a live billing account and throttles the project's API usage.
#
# Usage:
#   ./set-api-budget.sh \
#     --project PROJECT_ID --project-number 123456789012 \
#     --billing-account 012345-6789AB-CDEF01 \
#     --service places.googleapis.com \
#     --budget-usd 50 \
#     --cap SearchTextRequest=30 --cap GetPlaceRequest=10 --cap GetPhotoMediaRequest=15
#
# Requires: gcloud (authed via `gcloud auth login`). Idempotent-ish: re-running
# updates the quota overrides; budgets are additive, so it lists existing ones first.
set -euo pipefail
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

PROJECT="" PNUM="" BILLING="" SERVICE="" BUDGET="" ; CAPS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2;;
    --project-number) PNUM="$2"; shift 2;;
    --billing-account) BILLING="$2"; shift 2;;
    --service) SERVICE="$2"; shift 2;;
    --budget-usd) BUDGET="$2"; shift 2;;
    --cap) CAPS+=("$2"); shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
for v in PROJECT PNUM BILLING SERVICE BUDGET; do
  [ -n "${!v}" ] || { echo "missing --${v,,}" >&2; exit 2; }
done

echo "== enabling prerequisite APIs on $PROJECT =="
# Note: do NOT set billing/quota_project globally — it breaks service/quota calls.
gcloud services enable serviceusage.googleapis.com billingbudgets.googleapis.com --project="$PROJECT"

echo "== setting per-day quota caps on $SERVICE (consumer projects/$PNUM) =="
for cap in "${CAPS[@]}"; do
  metric="${cap%%=*}"; value="${cap##*=}"
  echo "  -> ${SERVICE}/${metric} = ${value}/day"
  gcloud alpha services quota update \
    --service="$SERVICE" \
    --consumer="projects/${PNUM}" \
    --metric="${SERVICE}/${metric}" \
    --unit='1/d/{project}' \
    --value="$value" --force
done

echo "== creating \$${BUDGET}/mo budget scoped to projects/${PNUM} =="
gcloud billing budgets create \
  --billing-account="$BILLING" \
  --display-name="${SERVICE} \$${BUDGET}-mo cap (${PROJECT})" \
  --budget-amount="${BUDGET}USD" \
  --filter-projects="projects/${PNUM}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend \
  --billing-project="$PROJECT"

echo "== verify quota overrides =="
gcloud alpha services quota list --service="$SERVICE" --consumer="projects/${PNUM}" \
  --flatten="consumerQuotaLimits[].quotaBuckets[]" \
  --format="table(metric, consumerQuotaLimits.quotaBuckets.effectiveLimit, consumerQuotaLimits.quotaBuckets.consumerOverride.overrideValue)" \
  | grep -Ei "$(IFS='|'; echo "${CAPS[*]%%=*}")" || true

echo "== done. Remember: the budget only ALERTS; the quota caps are the hard stop. =="
