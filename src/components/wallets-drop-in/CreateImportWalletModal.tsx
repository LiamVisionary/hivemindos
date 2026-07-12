"use client";

import React from "react";
import {
  MULTI_CHAIN_WALLET_LABEL,
  PERSONAL_WALLET_CREATE_CHAIN_LABELS,
  PERSONAL_WALLET_IMPORT_CHAIN_LABELS,
  RECOVERY_PHRASE_ACCOUNT_OPTIONS,
} from "@/lib/config/personal-wallet-chains";
import { recoveryPhraseAccountIndexFromWalletId } from "@/lib/utils/personal-wallet-grouping";

type WalletActionInput = {
  wallet?: unknown;
  name?: string;
  chain?: string;
  secret?: string;
  accountIndex?: number;
};

type WalletActions = {
  onCreateWallet?: (input: WalletActionInput) => Promise<unknown>;
  onImportWallet?: (input: WalletActionInput) => Promise<unknown>;
};

type CreateImportWalletModalProps = {
  wallet?: unknown;
  onClose?: () => void;
  actions?: WalletActions;
};

type WalletModalMode = "create" | "import";
type WalletLike = {
  id?: unknown;
  name?: unknown;
  network?: unknown;
  addresses?: unknown;
  source?: unknown;
};

function walletRecord(wallet: unknown): WalletLike {
  return wallet && typeof wallet === "object" ? wallet as WalletLike : {};
}

function firstWalletAddressChain(wallet: WalletLike): string {
  if (!Array.isArray(wallet.addresses)) return "";
  const first = wallet.addresses[0];
  return Array.isArray(first) ? String(first[0] || "") : "";
}

function chainLabelFromWallet(wallet: unknown): string {
  const record = walletRecord(wallet);
  if ((Array.isArray(record.addresses) && record.addresses.length > 1) || String(record.source || "").toLowerCase() === "recovery-phrase") {
    return MULTI_CHAIN_WALLET_LABEL;
  }
  const network = String(record.network || firstWalletAddressChain(record)).toLowerCase();
  if (network.includes("chains")) return MULTI_CHAIN_WALLET_LABEL;
  if (network.includes("solana")) return "Solana";
  if (network.includes("4663")) return "Robinhood Chain";
  if (network.includes("sepolia")) return "Base Sepolia";
  return "Base";
}

function WalletModalIcon({ name, color = "currentColor", size = 16, sw = 1.7 }: { name: string; color?: string; size?: number; sw?: number }) {
  const p: React.SVGProps<SVGSVGElement> = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "check":
      return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case "key":
      return <svg {...p}><circle cx="8" cy="14" r="4" /><path d="M11 11l8-8M16 4l3 3M14 6l2.5 2.5" /></svg>;
    case "refresh":
      return <svg {...p}><path d="M3.5 12a8.5 8.5 0 0 1 2.6-6.1" /><path d="M3 4v4h4" /><path d="M20.5 12a8.5 8.5 0 0 1-2.6 6.1" /><path d="M21 20v-4h-4" /></svg>;
    case "plus":
    default:
      return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
  }
}

export function CreateImportWalletModal({ wallet, onClose, actions }: CreateImportWalletModalProps) {
  const reimport = Boolean(wallet);
  const record = walletRecord(wallet);
  const walletName = String(record.name || "");
  const [mode, setMode] = React.useState<WalletModalMode>(reimport ? "import" : "create");
  const [name, setName] = React.useState(reimport ? walletName : "");
  const [createChain, setCreateChain] = React.useState(MULTI_CHAIN_WALLET_LABEL);
  const [chain, setChain] = React.useState(reimport ? chainLabelFromWallet(wallet) : MULTI_CHAIN_WALLET_LABEL);
  const [accountIndex, setAccountIndex] = React.useState(() => recoveryPhraseAccountIndexFromWalletId(record.id));
  const [secret, setSecret] = React.useState("");
  const [state, setState] = React.useState("idle");
  const isCreate = mode === "create" && !reimport;

  const save = async () => {
    setState("checking");
    try {
      if (isCreate) {
        if (!actions?.onCreateWallet) throw new Error("Wallet creation is not available in this build.");
        await actions.onCreateWallet({ name, chain: createChain });
      } else {
        if (!actions?.onImportWallet) throw new Error("Wallet import is not available in this build.");
        await actions.onImportWallet({ wallet, name, chain, secret, accountIndex });
      }
      setState("saved");
      setTimeout(() => onClose?.(), 850);
    } catch (error) {
      setState(error instanceof Error ? error.message : isCreate ? "Create failed" : "Import failed");
    }
  };

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = reimport ? walletName || "Reimport wallet" : isCreate ? "Create wallet" : "Import wallet";
  const help = reimport
    ? "Re-derive this wallet's addresses from its seed or key. Balances and holdings refresh on import."
    : isCreate
      ? "Generate a fresh wallet. Multi-chain creates Base, Robinhood Chain, and Solana from one recovery phrase; single-chain creates a local key for the selected network."
      : chain === MULTI_CHAIN_WALLET_LABEL
        ? "Import the matching Phantom account across Base, Robinhood Chain, and Solana from one recovery phrase. Choose the same account number shown in Phantom; raw private keys can only be imported on one compatible chain."
        : "Import an existing wallet by recovery phrase or private key. Recovery phrases are imported across Base, Robinhood Chain, and Solana; the selected chain is used for raw private keys.";
  const busy = state === "checking";
  const saved = state === "saved";
  const blocked = busy || (!isCreate && !secret.trim());
  const buttonText = busy
    ? isCreate ? "Creating wallet..." : "Deriving addresses..."
    : saved ? isCreate ? "Created" : "Imported"
      : reimport ? "Reimport" : isCreate ? (createChain === MULTI_CHAIN_WALLET_LABEL ? "Create multi-chain wallet" : `Create ${createChain} wallet`) : chain === MULTI_CHAIN_WALLET_LABEL ? "Import multi-chain wallet" : "Import wallet";

  return (
    <div className="fw-modal-back" onMouseDown={onClose}>
      <section className="fw-modal" role="dialog" aria-modal="true" aria-label={reimport ? "Reimport wallet" : "Create or import wallet"} onMouseDown={(event) => event.stopPropagation()}>
        <div className="fw-modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="fb-tile" style={{ color: "var(--honey)" }}><WalletModalIcon name={reimport ? "refresh" : isCreate ? "key" : "plus"} size={19} /></span>
            <div>
              <span className="fb-eyebrow">{reimport ? "Reimport wallet" : "Create or import"}</span>
              <h3>{title}</h3>
            </div>
          </div>
          <button type="button" className="fw-x" onClick={onClose} aria-label="Close" style={{ transform: "rotate(45deg)" }}><WalletModalIcon name="plus" size={14} sw={2} /></button>
        </div>
        {!reimport ? (
          <div className="fb-seg sub" aria-label="Wallet setup mode">
            <button type="button" data-active={isCreate ? "" : undefined} onClick={() => { setMode("create"); setState("idle"); }}>
              <WalletModalIcon name="key" size={13} /> Create
            </button>
            <button type="button" data-active={!isCreate ? "" : undefined} onClick={() => { setMode("import"); setState("idle"); }}>
              <WalletModalIcon name="plus" size={13} /> Import
            </button>
          </div>
        ) : null}
        <p className="fw-sheet-help">{help}</p>
        {!reimport ? <label className="fb-label">Wallet name<input className="fb-field" value={name} onChange={(event) => { setName(event.target.value); setState("idle"); }} placeholder="e.g. Ops Treasury" /></label> : null}
        {isCreate ? (
          <label className="fb-label">Network
            <select className="fb-select" value={createChain} onChange={(event) => { setCreateChain(event.target.value); setState("idle"); }}>
              {PERSONAL_WALLET_CREATE_CHAIN_LABELS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="fb-label">Import target
              <select className="fb-select" value={chain} onChange={(event) => { setChain(event.target.value); setState("idle"); }}>
                {PERSONAL_WALLET_IMPORT_CHAIN_LABELS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            {chain === MULTI_CHAIN_WALLET_LABEL ? (
              <label className="fb-label">Recovery-phrase account
                <select className="fb-select" value={accountIndex} onChange={(event) => { setAccountIndex(Number(event.target.value)); setState("idle"); }}>
                  {RECOVERY_PHRASE_ACCOUNT_OPTIONS.map((option) => <option key={option.accountIndex} value={option.accountIndex}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
          </>
        )}
        {!isCreate ? (
          <label className="fb-label">Seed phrase or private key
            <input className="fb-field fb-mono fw-secret" type="password" value={secret} onChange={(event) => { setSecret(event.target.value); setState("idle"); }} placeholder="Enter the wallet secret" />
          </label>
        ) : null}
        <button type="button" className="fw-save" data-state={state} disabled={blocked} onClick={save}>
          {busy ? <span className="fw-loader" aria-hidden="true"><i /><i /><i /></span> : null}
          {saved ? <WalletModalIcon name="check" size={15} color="#06231d" /> : null}
          {buttonText}
        </button>
        {state !== "idle" && !busy && !saved ? <p className="fw-sheet-help" style={{ color: "var(--danger)" }}>{state}</p> : null}
        <div className="fw-term"><strong>Keys never leave this device</strong><code>Encrypted local wallet vault and backup flow</code></div>
      </section>
    </div>
  );
}
