"use client";

import React from "react";
import { BIcon } from "./icons";
import { Coin } from "./primitives";
import { resolveAddressToken } from "./rails";
import { addressTokenKey, isTokenAddressInput } from "./address-token";
import type { TradeTokenMetadata } from "@/features/dashboard/views/trade/trade-api";

type LookupState =
  | { key: string; status: "resolving" }
  | { key: string; status: "resolved"; token: TradeTokenMetadata }
  | { key: string; status: "error"; error: string };

export type AddressTokenSelection = {
  address: string;
  token: TradeTokenMetadata | null;
};

export function useAddressTokenLookup(network: string) {
  const [address, setAddress] = React.useState("");
  const [lookup, setLookup] = React.useState<LookupState | null>(null);
  const sequence = React.useRef(0);
  const timer = React.useRef<number | null>(null);

  const cancelPending = React.useCallback(() => {
    sequence.current += 1;
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const scheduleLookup = React.useCallback((nextAddress: string) => {
    cancelPending();
    setLookup(null);
    if (!isTokenAddressInput(nextAddress, network)) return;

    const requestId = sequence.current;
    const key = addressTokenKey(network, nextAddress);
    timer.current = window.setTimeout(async () => {
      timer.current = null;
      setLookup({ key, status: "resolving" });
      const response = await resolveAddressToken({ network, address: nextAddress });
      if (requestId !== sequence.current) return;
      if (response.ok && response.token) {
        setLookup({ key, status: "resolved", token: response.token });
        return;
      }
      setLookup({ key, status: "error", error: response.error || "This token could not be resolved on the selected chain." });
    }, 250);
  }, [cancelPending, network]);

  const change = React.useCallback((value: string) => {
    const nextAddress = value.trim();
    setAddress(nextAddress);
    scheduleLookup(nextAddress);
  }, [scheduleLookup]);

  const reset = React.useCallback(() => {
    cancelPending();
    setAddress("");
    setLookup(null);
  }, [cancelPending]);

  const restore = React.useCallback((selection: AddressTokenSelection) => {
    cancelPending();
    setAddress(selection.address);
    if (selection.token) {
      setLookup({ key: addressTokenKey(network, selection.address), status: "resolved", token: selection.token });
      return;
    }
    setLookup(null);
    if (selection.address) scheduleLookup(selection.address);
  }, [cancelPending, network, scheduleLookup]);

  React.useEffect(() => cancelPending, [cancelPending]);

  const key = addressTokenKey(network, address);
  const token = lookup?.key === key && lookup.status === "resolved" ? lookup.token : null;
  const resolving = lookup?.key === key && lookup.status === "resolving";
  const error = lookup?.key === key && lookup.status === "error" ? lookup.error : null;

  return {
    address,
    token,
    resolving,
    error,
    selection: { address, token } satisfies AddressTokenSelection,
    change,
    reset,
    restore,
  };
}

export function AddressTokenPicker({
  label,
  network,
  address,
  token,
  resolving,
  error,
  onChange,
  onClear,
}: {
  label: "Pay" | "Receive";
  network: string;
  address: string;
  token: TradeTokenMetadata | null;
  resolving: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  if (token) {
    return (
      <span className="tk-assetbtn tk-addrtoken" title={`${token.name} · ${token.address}`}>
        <Coin sym={token.symbol} size={24} logoUrl={token.iconUrl} />
        <span className="sym">{token.symbol}</span>
        <button type="button" className="tk-addrtoken-x" onClick={onClear} aria-label={`Use a different ${label.toLowerCase()} token address`}>×</button>
      </span>
    );
  }

  return (
    <span className="tk-addrshell">
      <span className="tk-addrinput">
        <input
          className="tk-addr"
          value={address}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => onChange(event.target.value)}
          placeholder={network.startsWith("solana") ? "Token mint address" : "0x token address"}
          aria-label={`${label} token contract address`}
          aria-busy={resolving}
          aria-invalid={Boolean(error)}
        />
        {resolving ? <span className="tk-addrspin" role="status" aria-label="Resolving token"><BIcon name="spinner" size={14} spin /></span> : null}
      </span>
      {error ? <span className="tk-addrerror" role="alert">{error}</span> : null}
    </span>
  );
}
