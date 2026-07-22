#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
DEPLOYER="0x0c9ed3fa03490dffba59c2b9c94a12f46efbb22c"
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
BASE_HIVE="0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3"
BASE_ADAPTER="0x9e365A3aA8A6Dc4Be95A6900E1dB8Fadd2f221Ce"
ROBINHOOD_OFT="0x26c7121e41e779327Adbd5682646dC5deb764539"
CANARY_BUY_WEI="50000000000000"
BASE_SWAP_NONCE="13"
CANARY_SEND_WEI="1000000000000000000"
REMOTE_RECEIVE_WEI="999500000000000000"
FINAL_BASE_LOCKED_WEI="1000000000000000"
FINAL_BASE_FEE_WEI="500000000000000"
FINAL_REMOTE_SUPPLY_WEI="500000000000000"

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

cast_uint() {
  local rpc="$1"
  shift
  cast_read_with_retry "$rpc" "$@" | awk 'NR == 1 { print $1 }'
}

decimal_ge() {
  local left right
  left="$(printf '%s' "$1" | sed 's/^0*//')"
  right="$(printf '%s' "$2" | sed 's/^0*//')"
  [[ -n "$left" ]] || left="0"
  [[ -n "$right" ]] || right="0"
  if (( ${#left} != ${#right} )); then
    (( ${#left} > ${#right} ))
    return
  fi
  [[ "$left" == "$right" || "$left" > "$right" ]]
}

base_hive_balance() {
  cast_uint "$BASE_RPC" call "$BASE_HIVE" 'balanceOf(address)(uint256)' "$DEPLOYER"
}

base_locked() {
  cast_uint "$BASE_RPC" call "$BASE_HIVE" 'balanceOf(address)(uint256)' "$BASE_ADAPTER"
}

base_fees() {
  cast_uint "$BASE_RPC" call "$BASE_ADAPTER" 'bridgeFeesAccrued()(uint256)'
}

remote_wallet_balance() {
  cast_uint "$ROBINHOOD_RPC" call "$ROBINHOOD_OFT" 'balanceOf(address)(uint256)' "$DEPLOYER"
}

remote_supply() {
  cast_uint "$ROBINHOOD_RPC" call "$ROBINHOOD_OFT" 'totalSupply()(uint256)'
}

remote_fee_balance() {
  cast_uint "$ROBINHOOD_RPC" call "$ROBINHOOD_OFT" 'balanceOf(address)(uint256)' "$ROBINHOOD_OFT"
}

buy_canary_hive() {
  local hive_balance
  hive_balance="$(base_hive_balance)"
  if decimal_ge "$hive_balance" "$CANARY_SEND_WEI"; then
    echo "Canary wallet already holds Base HIVE; skipping purchase."
    return
  fi

  local relay_quote=""
  local quote_attempt
  for quote_attempt in 1 2 3; do
    relay_quote="$(curl -4 --max-time 45 -sS 'https://api.relay.link/quote/v2' \
      -H 'content-type: application/json' \
      --data "{\"user\":\"$DEPLOYER\",\"recipient\":\"$DEPLOYER\",\"refundTo\":\"$DEPLOYER\",\"originChainId\":8453,\"destinationChainId\":8453,\"originCurrency\":\"0x0000000000000000000000000000000000000000\",\"destinationCurrency\":\"$BASE_HIVE\",\"amount\":\"$CANARY_BUY_WEI\",\"tradeType\":\"EXACT_INPUT\"}")" && break
    relay_quote=""
    echo "Relay canary quote attempt $quote_attempt failed; retrying." >&2
  done
  if [[ -z "$relay_quote" ]]; then
    echo "Relay canary quote failed before any transaction was submitted." >&2
    exit 1
  fi

  local deployer_lower quote_sender quote_recipient quote_input quote_output transaction_count
  deployer_lower="$(printf '%s' "$DEPLOYER" | tr '[:upper:]' '[:lower:]')"
  quote_sender="$(jq -r '.details.sender // empty | ascii_downcase' <<< "$relay_quote")"
  quote_recipient="$(jq -r '.details.recipient // empty | ascii_downcase' <<< "$relay_quote")"
  quote_input="$(jq -r '.details.currencyIn.amount // empty' <<< "$relay_quote")"
  quote_output="$(jq -r '.details.currencyOut.amount // empty' <<< "$relay_quote")"
  transaction_count="$(jq '[.steps[]?.items[]? | select(.status != "complete")] | length' <<< "$relay_quote")"
  if [[ "$quote_sender" != "$deployer_lower" || "$quote_recipient" != "$deployer_lower" \
    || "$quote_input" != "$CANARY_BUY_WEI" || ! "$quote_output" =~ ^[1-9][0-9]*$ \
    || "$transaction_count" != "1" ]] || ! decimal_ge "$quote_output" "$CANARY_SEND_WEI"; then
    echo "Relay canary quote failed sender, recipient, amount, output, or transaction-count validation." >&2
    exit 1
  fi

  local transaction_to transaction_from transaction_chain transaction_value transaction_data
  local transaction_gas transaction_max_fee transaction_priority_fee transaction_nonce
  transaction_to="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.to' <<< "$relay_quote")"
  transaction_from="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.from | ascii_downcase' <<< "$relay_quote")"
  transaction_chain="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.chainId' <<< "$relay_quote")"
  transaction_value="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.value' <<< "$relay_quote")"
  transaction_data="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.data' <<< "$relay_quote")"
  transaction_gas="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.gas' <<< "$relay_quote")"
  transaction_max_fee="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.maxFeePerGas' <<< "$relay_quote")"
  transaction_priority_fee="$(jq -r '.steps[]?.items[]? | select(.status != "complete") | .data.maxPriorityFeePerGas' <<< "$relay_quote")"
  if [[ ! "$transaction_to" =~ ^0x[0-9a-fA-F]{40}$ || "$transaction_from" != "$deployer_lower" \
    || "$transaction_chain" != "8453" || "$transaction_value" != "$CANARY_BUY_WEI" \
    || ! "$transaction_data" =~ ^0x[0-9a-fA-F]*$ || ! "$transaction_gas" =~ ^[1-9][0-9]*$ \
    || ! "$transaction_max_fee" =~ ^[1-9][0-9]*$ || ! "$transaction_priority_fee" =~ ^[0-9]+$ ]]; then
    echo "Relay canary transaction failed exact-chain and calldata validation." >&2
    exit 1
  fi

  transaction_nonce="$(cast_read_with_retry "$BASE_RPC" nonce "$DEPLOYER")"
  if [[ "$transaction_nonce" != "$BASE_SWAP_NONCE" ]]; then
    echo "Base deployer nonce is $transaction_nonce, not expected canary-buy nonce $BASE_SWAP_NONCE; refusing to submit another buy." >&2
    exit 1
  fi
  transaction_gas="$((transaction_gas * 3 / 2))"
  transaction_max_fee="$((transaction_max_fee * 3 / 2))"

  echo "Buying canary HIVE with 0.00005 ETH of leftover Base deployment gas."
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

  local poll_attempt
  for poll_attempt in $(seq 1 30); do
    hive_balance="$(base_hive_balance)"
    if decimal_ge "$hive_balance" "$CANARY_SEND_WEI"; then
      echo "Canary HIVE purchase confirmed."
      return
    fi
    sleep 2
  done
  echo "Canary buy was submitted but HIVE is not visible yet. Return to Codex before rerunning." >&2
  exit 1
}

run_base_send() {
  local gas_price
  gas_price="$(cast_read_with_retry "$BASE_RPC" gas-price)"
  gas_price="$((gas_price * 2))"
  echo "Sending exactly 1 HIVE from Base to Robinhood."
  HIVE_LOCAL_OAPP="$BASE_ADAPTER" HIVE_AMOUNT="$CANARY_SEND_WEI" \
    forge script script/SmokeSendHive.s.sol:SmokeSendHive \
      --root . \
      --rpc-url "$BASE_RPC" \
      --rpc-timeout 90 \
      --fork-retries 5 \
      --fork-retry-backoff 1000 \
      --gas-price "$gas_price" \
      --priority-gas-price 0 \
      --sender "$DEPLOYER" \
      --account hive-deployer \
      --broadcast \
      -vv
}

run_robinhood_return() {
  local gas_price
  gas_price="$(cast_read_with_retry "$ROBINHOOD_RPC" gas-price)"
  gas_price="$((gas_price * 12 / 10))"
  echo "Returning the received HIVE from Robinhood to Base."
  HIVE_LOCAL_OAPP="$ROBINHOOD_OFT" HIVE_AMOUNT="$REMOTE_RECEIVE_WEI" \
    forge script script/SmokeSendHive.s.sol:SmokeSendHive \
      --root . \
      --rpc-url "$ROBINHOOD_RPC" \
      --rpc-timeout 90 \
      --fork-retries 5 \
      --fork-retry-backoff 1000 \
      --gas-price "$gas_price" \
      --priority-gas-price 0 \
      --sender "$DEPLOYER" \
      --account hive-deployer \
      --gas-estimate-multiplier 300 \
      --broadcast \
      -vv
}

wait_for_remote_delivery() {
  local poll_attempt wallet_balance supply
  for poll_attempt in $(seq 1 180); do
    wallet_balance="$(remote_wallet_balance)"
    supply="$(remote_supply)"
    if [[ "$wallet_balance" == "$REMOTE_RECEIVE_WEI" && "$supply" == "$REMOTE_RECEIVE_WEI" ]]; then
      echo "Base to Robinhood delivery confirmed."
      return
    fi
    if (( poll_attempt % 12 == 0 )); then
      echo "Still waiting for Base to Robinhood delivery."
    fi
    sleep 5
  done
  echo "Base send is still pending. Do not resubmit it; return to Codex for recovery." >&2
  exit 1
}

wait_for_final_reconciliation() {
  local poll_attempt locked fees wallet_balance supply fee_balance
  for poll_attempt in $(seq 1 180); do
    locked="$(base_locked)"
    fees="$(base_fees)"
    wallet_balance="$(remote_wallet_balance)"
    supply="$(remote_supply)"
    fee_balance="$(remote_fee_balance)"
    if [[ "$locked" == "$FINAL_BASE_LOCKED_WEI" && "$fees" == "$FINAL_BASE_FEE_WEI" \
      && "$wallet_balance" == "0" && "$supply" == "$FINAL_REMOTE_SUPPLY_WEI" \
      && "$fee_balance" == "$FINAL_REMOTE_SUPPLY_WEI" ]]; then
      echo "CANARY COMPLETE: Base net backing exactly equals Robinhood supply."
      return
    fi
    if (( poll_attempt % 12 == 0 )); then
      echo "Still waiting for Robinhood to Base delivery."
    fi
    sleep 5
  done
  echo "Return send is still pending. Do not resubmit it; return to Codex for recovery." >&2
  exit 1
}

cd "$CONTRACTS_DIR"
buy_canary_hive

locked="$(base_locked)"
fees="$(base_fees)"
wallet_balance="$(remote_wallet_balance)"
supply="$(remote_supply)"
fee_balance="$(remote_fee_balance)"

if [[ "$locked" == "$FINAL_BASE_LOCKED_WEI" && "$fees" == "$FINAL_BASE_FEE_WEI" \
  && "$wallet_balance" == "0" && "$supply" == "$FINAL_REMOTE_SUPPLY_WEI" \
  && "$fee_balance" == "$FINAL_REMOTE_SUPPLY_WEI" ]]; then
  echo "CANARY ALREADY COMPLETE: exact backing reconciliation confirmed."
  exit 0
fi

if [[ "$locked" == "0" && "$fees" == "0" && "$wallet_balance" == "0" && "$supply" == "0" ]]; then
  run_base_send
  wait_for_remote_delivery
elif [[ "$locked" == "$CANARY_SEND_WEI" && "$fees" == "$FINAL_BASE_FEE_WEI" \
  && "$wallet_balance" == "0" && "$supply" == "0" ]]; then
  echo "Base send was already submitted; waiting without resubmitting."
  wait_for_remote_delivery
elif [[ "$locked" == "$CANARY_SEND_WEI" && "$fees" == "$FINAL_BASE_FEE_WEI" \
  && "$wallet_balance" == "$REMOTE_RECEIVE_WEI" && "$supply" == "$REMOTE_RECEIVE_WEI" ]]; then
  echo "Base to Robinhood leg was already delivered."
elif [[ "$locked" == "$CANARY_SEND_WEI" && "$fees" == "$FINAL_BASE_FEE_WEI" \
  && "$wallet_balance" == "0" && "$supply" == "$FINAL_REMOTE_SUPPLY_WEI" \
  && "$fee_balance" == "$FINAL_REMOTE_SUPPLY_WEI" ]]; then
  echo "Robinhood return was already submitted; waiting without resubmitting."
  wait_for_final_reconciliation
  exit 0
else
  echo "Unexpected canary state; refusing to submit a transaction." >&2
  printf 'base_locked=%s base_fees=%s remote_wallet=%s remote_supply=%s remote_fee=%s\n' \
    "$locked" "$fees" "$wallet_balance" "$supply" "$fee_balance" >&2
  exit 1
fi

wallet_balance="$(remote_wallet_balance)"
supply="$(remote_supply)"
if [[ "$wallet_balance" == "$REMOTE_RECEIVE_WEI" && "$supply" == "$REMOTE_RECEIVE_WEI" ]]; then
  run_robinhood_return
elif [[ "$wallet_balance" == "0" && "$supply" == "$FINAL_REMOTE_SUPPLY_WEI" ]]; then
  echo "Robinhood return was already submitted; waiting without resubmitting."
else
  echo "Unexpected Robinhood return state; refusing to submit a transaction." >&2
  exit 1
fi

wait_for_final_reconciliation
