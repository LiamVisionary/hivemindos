export const WALLET_SECRET_EXPORT_CONFIRMATION = "EXPORT_WALLET_SECRET";

export type WalletSecretExportEntry = {
  agentId: string;
  address: string;
  network: string;
  kind: "private-key" | "recovery-phrase";
  secret: string;
  /** 0-based HD account index, when the exported secret was derived from a
   *  recovery phrase. The UI labels this "Account {accountIndex + 1}". */
  accountIndex?: number;
  /** Full BIP44 derivation path for `address`, e.g. m/44'/60'/0'/0/5. */
  derivationPath?: string;
  /** Warning shown when the secret is a shared recovery phrase whose account
   *  index for `address` could not be determined — importing it lands on
   *  Account 1, which may not be this wallet. */
  derivationNote?: string;
};

export function classifyWalletSecret(secret: string): WalletSecretExportEntry["kind"] {
  const normalized = secret.trim();
  if (!normalized.startsWith("0x") && normalized.split(/\s+/).length >= 12) return "recovery-phrase";
  return "private-key";
}

export function dedupeWalletExportEntries(entries: WalletSecretExportEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.secret}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function walletSecretExportLabel(entries: WalletSecretExportEntry[]) {
  const kinds = new Set(entries.map((entry) => entry.kind));
  if (kinds.size > 1) return "wallet secret";
  return kinds.has("recovery-phrase") ? "recovery phrase" : "private key";
}

export function renderWalletSecretExport(label: string, entries: WalletSecretExportEntry[]) {
  const lines = [
    "HivemindOS wallet secret export",
    `Wallet: ${label}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "Keep this file offline. Anyone with these secrets can spend from the exported wallets.",
    "",
  ];
  entries.forEach((entry, index) => {
    lines.push(
      `## Wallet ${index + 1}`,
      `Agent id: ${entry.agentId}`,
      `Network: ${entry.network}`,
      `Address: ${entry.address}`,
      `Secret type: ${entry.kind === "recovery-phrase" ? "Recovery phrase" : "Private key"}`,
    );
    if (typeof entry.accountIndex === "number" && entry.derivationPath) {
      lines.push(
        entry.kind === "private-key"
          ? `Derived from recovery phrase — Account ${entry.accountIndex + 1} (${entry.derivationPath}). This private key controls only ${entry.address}. Import it as a private key to land on exactly this address.`
          : `Derivation: Account ${entry.accountIndex + 1} (${entry.derivationPath}). After importing the phrase, select this account — the address must match ${entry.address}.`,
      );
    }
    if (entry.derivationNote) lines.push(`Warning: ${entry.derivationNote}`);
    lines.push(
      "Secret:",
      entry.secret,
      "",
    );
  });
  return `${lines.join("\n")}\n`;
}

export function slugifyWalletExportLabel(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || "hivemindos";
}
