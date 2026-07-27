#!/usr/bin/env node
// Add-a-chain-to-an-existing-wallet coverage: deriveWalletForAdditionalChain
// must extend a wallet onto a new chain from a secret the vault already holds
// (recovery phrase → any supported chain, private key → same key family only),
// and the /api/wallet/add-chain route + Wallets UI must stay wired to it.

import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const ROOT = process.cwd();

const {
  deriveWalletForAdditionalChain,
  generateWallet,
  importRecoveryPhraseWallets,
  isRecoveryPhraseSecret,
} = await import("../src/lib/services/wallet/chain-wallet.ts");
const {
  MULTI_CHAIN_WALLET_LABEL,
  PERSONAL_WALLET_ADDABLE_CHAINS,
  PERSONAL_WALLET_CREATE_CHAIN_LABELS,
  PERSONAL_WALLET_IMPORT_CHAIN_LABELS,
  personalWalletNetworkForChainLabel,
} = await import("../src/lib/config/personal-wallet-chains.ts");

// Well-known BIP39 test mnemonic (hardhat default) — never fund it.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_MNEMONIC_EVM_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ── secret classification ──────────────────────────────────────────────────────
assert.equal(isRecoveryPhraseSecret(TEST_MNEMONIC), true, "a valid BIP39 phrase must classify as a recovery phrase");
assert.equal(isRecoveryPhraseSecret(`  ${TEST_MNEMONIC.toUpperCase()}  `), true, "classification must normalize case/whitespace");
assert.equal(isRecoveryPhraseSecret(`0x${"1".repeat(64)}`), false, "an EVM private key must not classify as a recovery phrase");

// ── recovery phrase extends onto any supported chain ───────────────────────────
const phraseWallets = importRecoveryPhraseWallets(TEST_MNEMONIC);
const baseWallet = phraseWallets.find((wallet) => wallet.network === "eip155:8453");
const solanaWallet = phraseWallets.find((wallet) => wallet.network === "solana:mainnet");
assert(baseWallet && solanaWallet, "recovery-phrase import must produce Base and Solana wallets");

const ninthAccountWallets = importRecoveryPhraseWallets(TEST_MNEMONIC, 8);
const ninthAccountBase = ninthAccountWallets.find((wallet) => wallet.network === "eip155:8453");
const ninthAccountSolana = ninthAccountWallets.find((wallet) => wallet.network === "solana:mainnet");
assert.equal(ninthAccountBase?.derivationPath, "m/44'/60'/0'/0/8", "account 9 must use Phantom's bip44Change EVM index 8 path");
assert.equal(ninthAccountSolana?.derivationPath, "m/44'/501'/8'/0'", "account 9 must use Phantom's paired Solana index 8 path");
assert.notEqual(ninthAccountBase?.address, baseWallet.address, "different recovery-phrase accounts must derive different EVM addresses");

const robinhoodFromPhrase = deriveWalletForAdditionalChain("eip155:4663", { network: "eip155:8453", secret: TEST_MNEMONIC });
assert.equal(robinhoodFromPhrase.network, "eip155:4663");
assert.equal(robinhoodFromPhrase.address, baseWallet.address, "Robinhood Chain must share the wallet's EVM address");
assert.equal(robinhoodFromPhrase.address, TEST_MNEMONIC_EVM_ADDRESS, "EVM derivation must use the standard m/44'/60'/0'/0/0 path");
assert.equal(robinhoodFromPhrase.importKind, "recovery-phrase");
assert.equal(robinhoodFromPhrase.secret, TEST_MNEMONIC, "EVM records derived from a phrase keep the phrase as the signing secret");

const solanaFromPhrase = deriveWalletForAdditionalChain("solana:mainnet", { network: "eip155:8453", secret: TEST_MNEMONIC });
assert.equal(solanaFromPhrase.address, solanaWallet.address, "Solana derivation must match the recovery-phrase import path");
assert.equal(solanaFromPhrase.secret, solanaWallet.secret, "Solana records store the derived keypair, not the phrase");

// ── EVM private key extends onto EVM chains only ────────────────────────────────
const evmKeyWallet = generateWallet("eip155:8453");
const robinhoodFromKey = deriveWalletForAdditionalChain("eip155:4663", { network: "eip155:8453", secret: evmKeyWallet.secret });
assert.equal(robinhoodFromKey.address, evmKeyWallet.address, "an EVM private key must reuse its address on Robinhood Chain");
assert.equal(robinhoodFromKey.importKind, "private-key");
assert.throws(
  () => deriveWalletForAdditionalChain("solana:mainnet", { network: "eip155:8453", secret: evmKeyWallet.secret }),
  /recovery phrase/i,
  "an EVM private key must not derive Solana; the error must point at reimporting the phrase",
);

// ── Solana private key extends onto Solana networks only ───────────────────────
const solanaKeyWallet = generateWallet("solana:mainnet");
const devnetFromKey = deriveWalletForAdditionalChain("solana:devnet", { network: "solana:mainnet", secret: solanaKeyWallet.secret });
assert.equal(devnetFromKey.address, solanaKeyWallet.address, "a Solana key must reuse its address on other Solana networks");
assert.throws(
  () => deriveWalletForAdditionalChain("eip155:8453", { network: "solana:mainnet", secret: solanaKeyWallet.secret }),
  /recovery phrase/i,
  "a Solana private key must not derive EVM chains; the error must point at reimporting the phrase",
);

// ── guardrails ──────────────────────────────────────────────────────────────────
assert.throws(() => deriveWalletForAdditionalChain("eip155:1", { network: "eip155:8453", secret: TEST_MNEMONIC }), /Unsupported wallet network/);
assert.throws(() => deriveWalletForAdditionalChain("eip155:4663", { network: "eip155:8453", secret: "  " }), /no stored secret/);

// ── single-sourced UI chain capability matrix ─────────────────────────────────
assert.equal(PERSONAL_WALLET_CREATE_CHAIN_LABELS[0], MULTI_CHAIN_WALLET_LABEL, "create must default to multi-chain");
assert.equal(PERSONAL_WALLET_IMPORT_CHAIN_LABELS[0], MULTI_CHAIN_WALLET_LABEL, "import must expose and default to multi-chain");
assert.deepEqual(PERSONAL_WALLET_ADDABLE_CHAINS.map((chain) => chain.label), ["Base", "Robinhood Chain", "Solana"]);
assert.equal(personalWalletNetworkForChainLabel("Base"), "eip155:8453");
assert.equal(personalWalletNetworkForChainLabel("Robinhood Chain"), "eip155:4663");
assert.equal(personalWalletNetworkForChainLabel("Solana"), "solana:mainnet");
assert.equal(personalWalletNetworkForChainLabel("Base Sepolia"), "eip155:84532");

// ── route + UI wiring stays intact ──────────────────────────────────────────────
function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function contains(source, needle, label) {
  assert(source.includes(needle), label || `Expected source to include ${needle}`);
}

const addChainRoute = read("src/app/api/wallet/add-chain/route.ts");
contains(addChainRoute, "requireAuth(request)", "add-chain route must be auth-gated");
contains(addChainRoute, "deriveWalletForAdditionalChain", "add-chain route must use the canonical derivation helper");
contains(addChainRoute, "RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX", "add-chain route must resolve the wallet group root");
contains(addChainRoute, "storeWalletSecret", "add-chain route must persist the new record to the local vault");
contains(addChainRoute, "writeWalletRecord", "add-chain route must persist the new record to the wallet ledger");
contains(addChainRoute, "refreshWalletVaultBackup", "add-chain route must refresh the encrypted vault backup");
contains(addChainRoute, 'if (network === "eip155:4663") return "USDG"', "add-chain must default Robinhood Chain to USDG");

const walletPanel = read("src/features/dashboard/views/WalletPanel.tsx");
contains(walletPanel, "onAddWalletChain", "WalletPanel must expose the add-chain action");
contains(walletPanel, '"/api/wallet/add-chain"', "WalletPanel add-chain action must call the add-chain route");
contains(walletPanel, 'importTarget: multiChainImport ? "multi-chain" : "single-network"', "WalletPanel must send the selected import target");
contains(walletPanel, "accountIndex", "WalletPanel must send the selected recovery-phrase account index");

const importModal = read("src/components/wallets-drop-in/CreateImportWalletModal.tsx");
contains(importModal, "PERSONAL_WALLET_IMPORT_CHAIN_LABELS", "the import dropdown must use the canonical chain options");
contains(importModal, "Import target", "the import dropdown must describe both recovery-phrase and private-key targets");
contains(importModal, "Import multi-chain wallet", "the primary action must confirm multi-chain import");
contains(importModal, "record.addresses.length > 1", "reimporting a grouped wallet must default back to multi-chain");
contains(importModal, "Recovery-phrase account", "multi-chain import must let the user select the matching Phantom account");

const importRoute = read("src/app/api/wallet/import/route.ts");
contains(importRoute, 'importTarget?: "single-network" | "multi-chain"', "the import route must accept an explicit target");
contains(importRoute, 'body.importTarget === "multi-chain" && body.importKind !== "recovery-phrase"', "the import route must reject raw-key multi-chain requests");
contains(importRoute, "body.accountIndex", "the import route must pass the selected recovery-phrase account index into derivation");

const walletsView = read("src/components/wallets-drop-in/WalletsView.tsx");
contains(walletsView, "PERSONAL_WALLET_ADDABLE_CHAINS", "WalletsView must derive missing chains from the canonical addable set");
contains(walletsView, "Add chain", "the personal wallet card must offer an Add chain affordance");
contains(walletsView, 'onAddWalletChain?: (input: { source: GroupedPersonalWallet; chain: string }) => Promise<unknown>', "WalletDropInActions must type the add-chain action");

const grouping = read("src/lib/utils/personal-wallet-grouping.ts");
contains(grouping, 'robinhood: "/icons/wallet/chains/robinhood.svg', "the Robinhood chain badge must be registered so added chains render a logo on wallet cards");
contains(read("public/icons/wallet/chains/robinhood.svg"), "<svg", "the Robinhood chain badge asset must exist");

console.log("wallet add-chain tests passed");
