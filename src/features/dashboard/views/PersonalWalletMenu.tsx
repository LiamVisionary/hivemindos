"use client";

import type { ElementType } from "react";
import { Check, ChevronRight, Copy, List, RotateCcw } from "lucide-react";
import { createStyleClass } from "@/features/dashboard/style-classes";
import personalStyles from "./PersonalWallets.module.css";

type PersonalWalletMenuWallet = {
  id: string;
  address: string;
  network: string;
};

type PersonalWalletMenuProps = {
  Button: ElementType;
  copiedAddressKey: string;
  label: string;
  networkLabel: (network: string) => string;
  onCopyAddress: (wallet: PersonalWalletMenuWallet) => void;
  onReimport: () => void;
  shortenAddress: (address: string) => string;
  wallets: PersonalWalletMenuWallet[];
};

const personalClass = createStyleClass(personalStyles);

export function PersonalWalletMenu({
  Button,
  copiedAddressKey,
  label,
  networkLabel,
  onCopyAddress,
  onReimport,
  shortenAddress,
  wallets,
}: PersonalWalletMenuProps) {
  return (
    <div className={personalClass("addressMenu")}>
      <Button type="button" variant="ghost" size="icon-sm" className={personalClass("addressListButton")} aria-label={`${label} menu`}>
        <List aria-hidden="true" />
      </Button>
      <div className={personalClass("addressTooltip")} role="menu" aria-label={`${label} wallet menu`}>
        <div className={personalClass("walletMenuFolder")} tabIndex={0} role="menuitem" aria-haspopup="menu">
          <span><strong>Addresses</strong><small>{wallets.length} {wallets.length === 1 ? "chain" : "chains"}</small></span>
          <ChevronRight aria-hidden="true" />
          <div className={personalClass("walletMenuSubpanel")} role="menu" aria-label={`${label} addresses`}>
            {wallets.map((wallet) => {
              const copied = copiedAddressKey === `${wallet.id}:${wallet.address}`;
              return (
                <div key={wallet.id} className={personalClass("walletMenuAddressRow")}>
                  <span>
                    <strong>{networkLabel(wallet.network)}</strong>
                    <small>{shortenAddress(wallet.address)}</small>
                  </span>
                  <Button
                    type="button"
                    variant={copied ? "secondary" : "ghost"}
                    size="icon-xs"
                    className={personalClass("addressCopyButton")}
                    onClick={() => onCopyAddress(wallet)}
                    aria-label={`Copy ${networkLabel(wallet.network)} address`}
                    title={copied ? "Copied" : "Copy address"}
                  >
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
        <div className={personalClass("walletMenuFolder")} tabIndex={0} role="menuitem" aria-haspopup="menu">
          <span><strong>Settings</strong><small>Wallet tools</small></span>
          <ChevronRight aria-hidden="true" />
          <div className={personalClass("walletMenuSubpanel")} role="menu" aria-label={`${label} settings`}>
            <button type="button" className={personalClass("walletMenuAction")} onClick={onReimport}>
              <RotateCcw aria-hidden="true" />
              <span><strong>Reimport</strong><small>Restore local signer access</small></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
