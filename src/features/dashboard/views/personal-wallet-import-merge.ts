type ImportMergeWallet = {
  id: string;
  address: string;
  network: string;
  custodyMode: "local" | "watch";
  importedFrom: "generated" | "private-key" | "recovery-phrase" | "browser" | "watch";
  updatedAt: number;
};

function accountKey(wallet: Pick<ImportMergeWallet, "network" | "address">) {
  return `${wallet.network}:${wallet.address.toLowerCase()}`;
}

export function planImportedWalletMerge<T extends ImportMergeWallet>(current: T[], importedRows: T[], now: number) {
  const existingWallets = new Set(current.map(accountKey));
  const freshRows = importedRows.filter((wallet) => !existingWallets.has(accountKey(wallet)));
  const upgradedRows = importedRows.filter((wallet) => existingWallets.has(accountKey(wallet)));
  const wallets = current.map((wallet) => {
    const upgraded = upgradedRows.find((row) => accountKey(row) === accountKey(wallet));
    return upgraded ? { ...wallet, id: upgraded.id, custodyMode: "local" as const, importedFrom: upgraded.importedFrom, updatedAt: now } : wallet;
  });
  return { freshRows, upgradedRows, wallets };
}

export function appendFreshImportedWallets<T extends ImportMergeWallet>(current: T[], freshRows: T[]) {
  const existing = new Set(current.map(accountKey));
  return [...freshRows.filter((wallet) => !existing.has(accountKey(wallet))), ...current];
}
