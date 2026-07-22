#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
DEPLOYER="0x0c9ed3fa03490dffba59c2b9c94a12f46efbb22c"
TIMELOCK="0x6C41ac629EC899dA4bfBB4C8A5022b3A165fca7e"
GUARDIAN="0x08D73e591c2D3f4EB7E243A2212682e376CA913e"
SAFE="0xBeB2245F15ff9F596aB673C26dEc525e7aF44cfB"
if [[ -z "${ROBINHOOD_MAINNET_ARCHIVE_RPC_URL:-}" ]]; then
  if [[ "${HIVE_RPC_ENV_LOADED:-}" == "1" ]]; then
    echo "ROBINHOOD_MAINNET_ARCHIVE_RPC_URL is missing from the shared hive env." >&2
    exit 1
  fi
  exec env HIVE_RPC_ENV_LOADED=1 hive-env-run -- "$0" "$@"
fi
ROBINHOOD_RPC="$ROBINHOOD_MAINNET_ARCHIVE_RPC_URL"
case "$ROBINHOOD_RPC" in
  https://robinhood-mainnet.g.alchemy.com/*)
    BASE_RPC="${ROBINHOOD_RPC/robinhood-mainnet/base-mainnet}"
    ;;
  *)
    echo "The shared Robinhood RPC is not the expected Alchemy endpoint; refusing to derive a Base RPC." >&2
    exit 1
    ;;
esac
BASE_NONCE="1"
BASE_FUNDING_NONCE="12"
ROBINHOOD_NONCE="0"
BASE_OAPP="0x9e365A3aA8A6Dc4Be95A6900E1dB8Fadd2f221Ce"
ROBINHOOD_OAPP="0x26c7121e41e779327Adbd5682646dC5deb764539"
ROBINHOOD_MIN_DEPLOY_BALANCE_WEI="2000000000000000"
ROBINHOOD_FUNDING_AMOUNT_WEI="2500000000000000"

cast_read_with_retry() {
  local rpc="$1"
  shift
  local attempt output
  for attempt in 1 2 3 4 5; do
    if output="$(cast "$@" --rpc-url "$rpc" --rpc-timeout 90 2>&1)"; then
      printf '%s\n' "$output"
      return
    fi
    echo "RPC read attempt $attempt failed; retrying." >&2
    sleep 1
  done
  printf '%s\n' "$output" >&2
  return 1
}

require_expected_deployment() {
  local rpc="$1"
  local expected_nonce="$2"
  local expected_address="$3"
  local chain_label="$4"
  local current_code
  current_code="$(cast_read_with_retry "$rpc" code "$expected_address")"
  if [[ "$current_code" != "0x" ]]; then
    echo "$chain_label replacement already exists at $expected_address; skipping broadcast."
    return 1
  fi

  local current_nonce computed_address
  current_nonce="$(cast_read_with_retry "$rpc" nonce "$DEPLOYER")"
  if [[ "$current_nonce" != "$expected_nonce" ]]; then
    echo "$chain_label deployer nonce changed: expected $expected_nonce, got $current_nonce. Aborting before broadcast." >&2
    exit 1
  fi
  computed_address="$(cast compute-address --nonce "$current_nonce" "$DEPLOYER" | awk '{print $3}')"
  local computed_address_lower expected_address_lower
  computed_address_lower="$(printf '%s' "$computed_address" | tr '[:upper:]' '[:lower:]')"
  expected_address_lower="$(printf '%s' "$expected_address" | tr '[:upper:]' '[:lower:]')"
  if [[ "$computed_address_lower" != "$expected_address_lower" ]]; then
    echo "$chain_label predicted address mismatch. Aborting before broadcast." >&2
    exit 1
  fi
  return 0
}

fund_robinhood_deployer() {
  local robinhood_balance
  robinhood_balance="$(cast_read_with_retry "$ROBINHOOD_RPC" balance "$DEPLOYER")"
  if (( robinhood_balance >= ROBINHOOD_MIN_DEPLOY_BALANCE_WEI )); then
    echo "Robinhood deployer already has sufficient gas; skipping Relay funding."
    return
  fi

  local relay_quote=""
  local quote_attempt
  for quote_attempt in 1 2 3; do
    relay_quote="$(curl -4 --max-time 45 -sS 'https://api.relay.link/quote/v2' \
      -H 'content-type: application/json' \
      --data "{\"user\":\"$DEPLOYER\",\"recipient\":\"$DEPLOYER\",\"refundTo\":\"$DEPLOYER\",\"originChainId\":8453,\"destinationChainId\":4663,\"originCurrency\":\"0x0000000000000000000000000000000000000000\",\"destinationCurrency\":\"0x0000000000000000000000000000000000000000\",\"amount\":\"$ROBINHOOD_FUNDING_AMOUNT_WEI\",\"tradeType\":\"EXACT_INPUT\",\"referrer\":\"hivemindos-hive-bridge\"}")" && break
    relay_quote=""
    echo "Relay funding quote attempt $quote_attempt failed; retrying." >&2
  done
  if [[ -z "$relay_quote" ]]; then
    echo "Relay funding quote failed before any funding transaction was submitted." >&2
    exit 1
  fi

  local deployer_lower quote_sender quote_recipient quote_input transaction_count
  deployer_lower="$(printf '%s' "$DEPLOYER" | tr '[:upper:]' '[:lower:]')"
  quote_sender="$(jq -r '.details.sender // empty | ascii_downcase' <<< "$relay_quote")"
  quote_recipient="$(jq -r '.details.recipient // empty | ascii_downcase' <<< "$relay_quote")"
  quote_input="$(jq -r '.details.currencyIn.amount // empty' <<< "$relay_quote")"
  transaction_count="$(jq '[.steps[]?.items[]? | select(.status != "complete")] | length' <<< "$relay_quote")"
  if [[ "$quote_sender" != "$deployer_lower" || "$quote_recipient" != "$deployer_lower" \
    || "$quote_input" != "$ROBINHOOD_FUNDING_AMOUNT_WEI" || "$transaction_count" != "1" ]]; then
    echo "Relay funding quote failed sender, recipient, amount, or transaction-count validation." >&2
    exit 1
  fi

  local request_id transaction_to transaction_from transaction_chain transaction_value transaction_data
  local transaction_gas transaction_max_fee transaction_priority_fee transaction_nonce
  request_id="$(jq -r '.steps[]? | select(any(.items[]?; .status != "complete")) | .requestId // empty' <<< "$relay_quote")"
  transaction_to="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.to' <<< "$relay_quote")"
  transaction_from="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.from | ascii_downcase' <<< "$relay_quote")"
  transaction_chain="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.chainId' <<< "$relay_quote")"
  transaction_value="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.value' <<< "$relay_quote")"
  transaction_data="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.data' <<< "$relay_quote")"
  transaction_gas="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.gas' <<< "$relay_quote")"
  transaction_max_fee="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.maxFeePerGas' <<< "$relay_quote")"
  transaction_priority_fee="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.maxPriorityFeePerGas' <<< "$relay_quote")"
  if [[ ! "$request_id" =~ ^0x[0-9a-fA-F]{64}$ || ! "$transaction_to" =~ ^0x[0-9a-fA-F]{40}$ \
    || "$transaction_from" != "$deployer_lower" || "$transaction_chain" != "8453" \
    || "$transaction_value" != "$ROBINHOOD_FUNDING_AMOUNT_WEI" || ! "$transaction_data" =~ ^0x[0-9a-fA-F]*$ \
    || ! "$transaction_gas" =~ ^[1-9][0-9]*$ || ! "$transaction_max_fee" =~ ^[1-9][0-9]*$ \
    || ! "$transaction_priority_fee" =~ ^[0-9]+$ ]]; then
    echo "Relay funding transaction failed exact-chain and calldata validation." >&2
    exit 1
  fi

  transaction_gas="$((transaction_gas * 3 / 2))"
  transaction_max_fee="$((transaction_max_fee * 3 / 2))"
  transaction_nonce="$(cast_read_with_retry "$BASE_RPC" nonce "$DEPLOYER")"
  if [[ "$transaction_nonce" != "$BASE_FUNDING_NONCE" ]]; then
    echo "Base deployer nonce is $transaction_nonce, not the expected Relay funding nonce $BASE_FUNDING_NONCE." >&2
    echo "A prior funding transaction may already have been submitted; refusing to submit another." >&2
    echo "Wait for Robinhood funding to arrive or return to Codex for transaction recovery." >&2
    exit 1
  fi

  echo "Funding Robinhood deployment gas from the deployer's Base ETH through Relay."
  cast send "$transaction_to" \
    --data "$transaction_data" \
    --value "$transaction_value" \
    --gas-limit "$transaction_gas" \
    --gas-price "$transaction_max_fee" \
    --priority-gas-price "$transaction_priority_fee" \
    --nonce "$transaction_nonce" \
    --chain 8453 \
    --rpc-url "$BASE_RPC" \
    --rpc-timeout 90 \
    --account hive-deployer

  local status="pending"
  local poll_attempt
  for poll_attempt in $(seq 1 60); do
    robinhood_balance="$(cast_read_with_retry "$ROBINHOOD_RPC" balance "$DEPLOYER")"
    if (( robinhood_balance >= ROBINHOOD_MIN_DEPLOY_BALANCE_WEI )); then
      echo "Robinhood deployment gas arrived through Relay."
      return
    fi
    status="$(curl -4 --max-time 15 -sS "https://api.relay.link/intents/status/v3?requestId=$request_id" \
      | jq -r 'if (.status | type) == "object" then .status.status else .status end // "pending"' 2>/dev/null \
      | tr '[:upper:]' '[:lower:]')"
    if [[ "$status" == "failed" || "$status" == "failure" || "$status" == "refunded" || "$status" == "refund" ]]; then
      echo "Relay funding ended with status $status; Robinhood deployment was not attempted." >&2
      exit 1
    fi
    sleep 5
  done
  echo "Relay funding is still pending. Rerun this script after it settles; completed steps will be skipped." >&2
  exit 1
}

export HIVE_FINAL_OWNER="$TIMELOCK"
export HIVE_GUARDIAN="$GUARDIAN"
export HIVE_UNPAUSER="$SAFE"

cd "$CONTRACTS_DIR"

if require_expected_deployment "$BASE_RPC" "$BASE_NONCE" "$BASE_OAPP" "Base"; then
  BASE_GAS_PRICE="$(cast_read_with_retry "$BASE_RPC" gas-price)"
  BASE_GAS_PRICE="$((BASE_GAS_PRICE * 2))"
  export HIVE_EXPECTED_OAPP="$BASE_OAPP"
  export HIVE_REMOTE_OAPP="$ROBINHOOD_OAPP"
  forge script script/DeployAndBootstrapHiveMainnet.s.sol:DeployAndBootstrapHiveMainnet \
    --root . \
    --rpc-url "$BASE_RPC" \
    --rpc-timeout 90 \
    --fork-retries 5 \
    --fork-retry-backoff 1000 \
    --gas-price "$BASE_GAS_PRICE" \
    --priority-gas-price 0 \
    --sender "$DEPLOYER" \
    --account hive-deployer \
    --broadcast \
    -vv
fi

fund_robinhood_deployer

if require_expected_deployment "$ROBINHOOD_RPC" "$ROBINHOOD_NONCE" "$ROBINHOOD_OAPP" "Robinhood"; then
  ROBINHOOD_GAS_PRICE="$(cast_read_with_retry "$ROBINHOOD_RPC" gas-price)"
  ROBINHOOD_GAS_PRICE="$((ROBINHOOD_GAS_PRICE * 12 / 10))"
  export HIVE_EXPECTED_OAPP="$ROBINHOOD_OAPP"
  export HIVE_REMOTE_OAPP="$BASE_OAPP"
  forge script script/DeployAndBootstrapHiveMainnet.s.sol:DeployAndBootstrapHiveMainnet \
    --root . \
    --rpc-url "$ROBINHOOD_RPC" \
    --rpc-timeout 90 \
    --fork-retries 5 \
    --fork-retry-backoff 1000 \
    --gas-price "$ROBINHOOD_GAS_PRICE" \
    --priority-gas-price 0 \
    --sender "$DEPLOYER" \
    --account hive-deployer \
    --gas-estimate-multiplier 300 \
    --broadcast \
    -vv
fi

echo "Replacement broadcasts complete. Return to Codex for live verification, canary, old-pair pause, and site cutover."
