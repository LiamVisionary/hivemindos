"use client";

import React from "react";

type WalletActionInput = {
  wallet?: unknown;
  name?: string;
  chain?: string;
  secret?: string;
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
  name?: unknown;
  network?: unknown;
  addresses?: unknown;
};

const SUPPORTED_CHAINS = ["Base", "Solana", "Base Sepolia"];

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
  const network = String(record.network || firstWalletAddressChain(record)).toLowerCase();
  if (network.includes("solana")) return "Solana";
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
  const [chain, setChain] = React.useState(chainLabelFromWallet(wallet));
  const [secret, setSecret] = React.useState("");
  const [state, setState] = React.useState("idle");
  const isCreate = mode === "create" && !reimport;

  const save = async () => {
    setState("checking");
    try {
      if (isCreate) {
        if (!actions?.onCreateWallet) throw new Error("Wallet creation is not available in this build.");
        await actions.onCreateWallet({ name });
      } else {
        if (!actions?.onImportWallet) throw new Error("Wallet import is not available in this build.");
        await actions.onImportWallet({ wallet, name, chain, secret });
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

  const title = reimport ? walletName || "Reimport wallet" : isCreate ? "Create multi-chain wallet" : "Import wallet";
  const help = reimport
    ? "Re-derive this wallet's addresses from its seed or key. Balances and holdings refresh on import."
    : isCreate
      ? "Generate fresh Base and Solana wallets from one recovery phrase. HivemindOS stores the secrets in the encrypted wallet vault."
      : "Import an existing wallet by seed phrase or private key. Recovery phrases create supported Base and Solana wallets; private keys use the selected chain.";
  const busy = state === "checking";
  const saved = state === "saved";
  const blocked = busy || (!isCreate && !secret.trim());
  const buttonText = busy
    ? isCreate ? "Creating wallet..." : "Deriving addresses..."
    : saved ? isCreate ? "Created" : "Imported"
      : reimport ? "Reimport" : isCreate ? "Create multi-chain wallet" : "Import wallet";

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
        {!reimport ? <label className="fb-label">Wallet name<input className="fb-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ops Treasury" /></label> : null}
        {isCreate ? (
          <div className="fw-term"><strong>Networks</strong><code>Base mainnet + Solana mainnet</code></div>
        ) : (
          <label className="fb-label">Private-key chain
            <select className="fb-select" value={chain} onChange={(event) => setChain(event.target.value)}>
              {SUPPORTED_CHAINS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        )}
        {!isCreate ? (
          <label className="fb-label">Seed phrase or private key
            <input className="fb-field fb-mono fw-secret" type="password" value={secret} onChange={(event) => { setSecret(event.target.value); if (saved) setState("idle"); }} placeholder="Enter the wallet secret" />
          </label>
        ) : null}
        <button type="button" className="fw-save" data-state={state} disabled={blocked} onClick={save}>
          {saved ? <WalletModalIcon name="check" size={15} color="#06231d" /> : null}
          {buttonText}
        </button>
        {state !== "idle" && !busy && !saved ? <p className="fw-sheet-help" style={{ color: "var(--danger)" }}>{state}</p> : null}
        <div className="fw-term"><strong>Keys never leave this device</strong><code>Encrypted local wallet vault and backup flow</code></div>
      </section>
    </div>
  );
}
