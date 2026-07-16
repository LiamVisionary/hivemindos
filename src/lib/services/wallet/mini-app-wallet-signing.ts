const OFFICIAL_DOMAIN = "hivemindos.app";
const OFFICIAL_ORIGIN = `https://${OFFICIAL_DOMAIN}`;
const MAX_SIGN_IN_MESSAGE_LENGTH = 12_000;

export type MiniAppWalletSigningKind = "local" | "bankr";

export type MiniAppWalletSigningInput = {
  walletId: string;
  kind: MiniAppWalletSigningKind;
  address: string;
  message: string;
};

export function validateMiniAppSignInMessage(messageInput: string, expectedAddressInput: string): void {
  const message = messageInput.trim();
  const expectedAddress = expectedAddressInput.trim().toLowerCase();
  if (!message || message.length > MAX_SIGN_IN_MESSAGE_LENGTH) throw new Error("The wallet sign-in message is invalid.");
  if (!/^0x[a-f0-9]{40}$/.test(expectedAddress)) throw new Error("The selected wallet address is invalid.");

  const lines = message.split(/\r?\n/);
  if (lines[0] !== `${OFFICIAL_DOMAIN} wants you to sign in with your Ethereum account:`) {
    throw new Error("Only official HivemindOS wallet sign-in messages can be signed here.");
  }
  if (String(lines[1] || "").trim().toLowerCase() !== expectedAddress) {
    throw new Error("The sign-in message does not match the selected wallet.");
  }
  const uriLine = lines.find((line) => line.startsWith("URI: "))?.slice(5).trim() ?? "";
  try {
    if (new URL(uriLine).origin !== OFFICIAL_ORIGIN) throw new Error("origin");
  } catch {
    throw new Error("Only official HivemindOS wallet sign-in messages can be signed here.");
  }
  if (!lines.includes("Version: 1") || !lines.includes("Chain ID: 8453")) {
    throw new Error("The HivemindOS wallet sign-in message has an unsupported version or network.");
  }
  if (!lines.some((line) => /^Nonce: [A-Za-z0-9_-]{4,256}$/.test(line))) {
    throw new Error("The HivemindOS wallet sign-in message is missing its nonce.");
  }
}

export async function signMiniAppWalletMessage(input: MiniAppWalletSigningInput): Promise<{ address: string; signature: string }> {
  const walletId = input.walletId.trim();
  const address = input.address.trim().toLowerCase();
  if (!walletId || walletId.length > 240) throw new Error("A selected wallet is required.");
  validateMiniAppSignInMessage(input.message, address);

  if (input.kind === "bankr") {
    const { signBankrPersonalMessage } = await import("../bankr-actions");
    const signed = await signBankrPersonalMessage(input.message, address);
    return { address: signed.signer.toLowerCase(), signature: signed.signature };
  }

  const [{ getWalletSecret }, { resolveEvmSigningAccount }] = await Promise.all([
    import("./local-wallet-vault"),
    import("./chain-wallet"),
  ]);
  const stored = await getWalletSecret(walletId);
  if (!stored) throw new Error("The selected wallet has no signing key in the encrypted local vault.");
  if (!stored.info.network.startsWith("eip155:")) throw new Error("Wallet linking requires an EVM wallet.");
  if (stored.info.address.trim().toLowerCase() !== address) throw new Error("The selected wallet does not match its encrypted vault record.");
  const account = resolveEvmSigningAccount(stored.secret, address);
  return { address, signature: await account.signMessage({ message: input.message }) };
}
