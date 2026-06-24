import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "@/lib/services/wallet/base-chain";

export const B20_FACTORY_ADDRESS = "0xB20f000000000000000000000000000000000000" as const;
export const B20_ISSUER_NETWORK = "eip155:84532";
export const B20_ISSUER_CHAIN_ID = 84532;
export const B20_ISSUER_CHAIN_NAME = "Base Sepolia";
export const B20_ISSUER_CONFIRMATION = "B20_CREATE";
export const B20_ISSUER_PROOF_PREFIX = "B20_ISSUER_PROOF:";

const DEFAULT_RPC_URL = "https://sepolia.base.org";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const UINT128_MAX = (1n << 128n) - 1n;
const ROLE_CONSTANTS = {
  MINT_ROLE: keccak256(toBytes("MINT_ROLE")),
  PAUSE_ROLE: keccak256(toBytes("PAUSE_ROLE")),
  UNPAUSE_ROLE: keccak256(toBytes("UNPAUSE_ROLE")),
  METADATA_ROLE: keccak256(toBytes("METADATA_ROLE")),
} as const;

const B20_FACTORY_ABI = parseAbi([
  "function createB20(uint8 variant, bytes32 salt, bytes params, bytes[] initCalls) payable returns (address)",
  "function getB20Address(uint8 variant, address sender, bytes32 salt) view returns (address)",
  "function isB20(address token) view returns (bool)",
  "function isB20Initialized(address token) view returns (bool)",
]);

const B20_TOKEN_ABI = parseAbi([
  "function updateSupplyCap(uint256 newSupplyCap)",
  "function grantRole(bytes32 role, address account)",
  "function mint(address to, uint256 amount)",
]);

export type B20IssuerVariant = "asset" | "stablecoin";

export type B20IssuerConversationMessage = {
  role: string;
  content: string;
};

export type B20IssuerDetails = {
  variant: B20IssuerVariant;
  name: string;
  symbol: string;
  decimals: number;
  currency?: string;
  initialSupply: string;
  supplyCap: string;
  admin: Address;
  minter: Address;
  metadataAdmin: Address;
  pauser: Address;
  unpauser: Address;
  recipient: Address;
  salt?: Hex;
};

export type B20IssuerDraft = B20IssuerDetails & {
  version: 1;
  agentId: string;
  network: typeof B20_ISSUER_NETWORK;
  chainId: typeof B20_ISSUER_CHAIN_ID;
  chainName: typeof B20_ISSUER_CHAIN_NAME;
  rpcUrl: string;
  deployer: Address;
  factory: typeof B20_FACTORY_ADDRESS;
  variantId: 0 | 1;
  salt: Hex;
  params: Hex;
  initCalls: Hex[];
  initCallLabels: string[];
  initialSupplyRaw: string;
  supplyCapRaw: string;
  predictedAddress: Address;
  paramsHash: Hex;
  initCallsHash: Hex;
  calldataHash: Hex;
  deployerBalanceEth?: string;
  gasEstimate?: string;
  alreadyInitialized?: boolean;
  createdAt: string;
};

export type B20IssuerCollectResult =
  | { ok: true; details: B20IssuerDetails }
  | { ok: false; missing: string[]; partial: Partial<B20IssuerDetails>; message: string };

export type B20IssuerExecuteResult = {
  ok: boolean;
  tokenAddress: Address;
  transactionHash?: Hex;
  explorerUrl?: string;
  initialized?: boolean;
  error?: string;
};

type LiveDraftOptions = {
  agentId: string;
  deployer: string;
  rpcUrl?: string;
  now?: Date;
};

export function hasB20IssuerIntent(text: string) {
  if (!/\bb-?20\b/i.test(text)) return false;
  return /\b(make|create|deploy|issue|launch|mint|set\s+up|spin\s+up)\b/i.test(text)
    || /\btoken|coin|stablecoin|asset\b/i.test(text);
}

export function hasB20IssuerConversationContext(messages: B20IssuerConversationMessage[]) {
  const recent = messages.slice(-8);
  return recent.some((message) => {
    const text = message.content;
    return hasB20IssuerIntent(text)
      || /\bB20 issuer setup\b/i.test(text)
      || /\bB20 issuer proof ready\b/i.test(text)
      || text.includes(B20_ISSUER_PROOF_PREFIX);
  });
}

export function collectB20IssuerDetails(input: {
  messages: B20IssuerConversationMessage[];
  deployerAddress?: string;
}): B20IssuerCollectResult {
  const deployer = normalizeAddress(input.deployerAddress);
  const text = input.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const partial = parseB20IssuerDetails(text);
  const defaultAddress = deployer ?? ZERO_ADDRESS;
  const details: Partial<B20IssuerDetails> = {
    variant: partial.variant ?? "asset",
    name: partial.name,
    symbol: partial.symbol,
    decimals: partial.decimals ?? (partial.variant === "stablecoin" ? 6 : 18),
    currency: partial.currency ?? (partial.variant === "stablecoin" ? "USD" : undefined),
    initialSupply: partial.initialSupply,
    supplyCap: partial.supplyCap ?? partial.initialSupply,
    admin: partial.admin ?? defaultAddress,
    minter: partial.minter ?? partial.admin ?? defaultAddress,
    metadataAdmin: partial.metadataAdmin ?? partial.admin ?? defaultAddress,
    pauser: partial.pauser ?? partial.admin ?? defaultAddress,
    unpauser: partial.unpauser ?? partial.admin ?? defaultAddress,
    recipient: partial.recipient ?? partial.admin ?? defaultAddress,
    salt: partial.salt,
  };

  const missing: string[] = [];
  if (!deployer) missing.push("an EVM deployer wallet for this agent");
  if (!details.name) missing.push("token name");
  if (!details.symbol) missing.push("token symbol");
  if (!details.initialSupply) missing.push("initial supply");
  if (details.variant === "stablecoin" && !details.currency) missing.push("stablecoin currency code");
  if (!isNonZeroAddress(details.admin)) missing.push("admin wallet");
  if (!isNonZeroAddress(details.recipient)) missing.push("initial mint recipient");

  if (missing.length) {
    return {
      ok: false,
      missing,
      partial: details,
      message: b20IssuerMissingInfoMessage(missing, details),
    };
  }

  try {
    const normalized = normalizeB20IssuerDetails(details as B20IssuerDetails);
    return { ok: true, details: normalized };
  } catch (error) {
    return {
      ok: false,
      missing: [error instanceof Error ? error.message : "valid token details"],
      partial: details,
      message: b20IssuerMissingInfoMessage([error instanceof Error ? error.message : "valid token details"], details),
    };
  }
}

export function buildB20IssuerPayload(details: B20IssuerDetails, deployer: string, now = new Date()) {
  const normalized = normalizeB20IssuerDetails(details);
  const deployerAddress = requireAddress(deployer, "deployer");
  const decimals = normalized.variant === "stablecoin" ? 6 : normalized.decimals;
  const initialSupplyRaw = parseUnits(normalized.initialSupply, decimals);
  const supplyCapRaw = parseUnits(normalized.supplyCap, decimals);
  if (initialSupplyRaw <= 0n) throw new Error("Initial supply must be greater than zero.");
  if (supplyCapRaw < initialSupplyRaw) throw new Error("Supply cap must be greater than or equal to the initial supply.");
  if (supplyCapRaw > UINT128_MAX) throw new Error("Supply cap exceeds the B20 uint128 maximum.");

  const salt = normalized.salt ?? defaultSalt(normalized, deployerAddress, now);
  const variantId: 0 | 1 = normalized.variant === "stablecoin" ? 1 : 0;
  const params = normalized.variant === "stablecoin"
    ? encodeAbiParameters([
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "initialAdmin", type: "address" },
          { name: "currency", type: "string" },
        ],
      },
    ], [{
      version: 1,
      name: normalized.name,
      symbol: normalized.symbol,
      initialAdmin: normalized.admin,
      currency: normalized.currency ?? "USD",
    }])
    : encodeAbiParameters([
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "initialAdmin", type: "address" },
          { name: "decimals", type: "uint8" },
        ],
      },
    ], [{
      version: 1,
      name: normalized.name,
      symbol: normalized.symbol,
      initialAdmin: normalized.admin,
      decimals: normalized.decimals,
    }]);

  const initCalls: Hex[] = [
    encodeFunctionData({ abi: B20_TOKEN_ABI, functionName: "updateSupplyCap", args: [supplyCapRaw] }),
    encodeFunctionData({ abi: B20_TOKEN_ABI, functionName: "grantRole", args: [ROLE_CONSTANTS.MINT_ROLE, normalized.minter] }),
    encodeFunctionData({ abi: B20_TOKEN_ABI, functionName: "grantRole", args: [ROLE_CONSTANTS.PAUSE_ROLE, normalized.pauser] }),
    encodeFunctionData({ abi: B20_TOKEN_ABI, functionName: "grantRole", args: [ROLE_CONSTANTS.UNPAUSE_ROLE, normalized.unpauser] }),
    encodeFunctionData({ abi: B20_TOKEN_ABI, functionName: "grantRole", args: [ROLE_CONSTANTS.METADATA_ROLE, normalized.metadataAdmin] }),
    encodeFunctionData({ abi: B20_TOKEN_ABI, functionName: "mint", args: [normalized.recipient, initialSupplyRaw] }),
  ];
  const initCallLabels = [
    `set supply cap to ${normalized.supplyCap} ${normalized.symbol}`,
    `grant MINT_ROLE to ${shortAddress(normalized.minter)}`,
    `grant PAUSE_ROLE to ${shortAddress(normalized.pauser)}`,
    `grant UNPAUSE_ROLE to ${shortAddress(normalized.unpauser)}`,
    `grant METADATA_ROLE to ${shortAddress(normalized.metadataAdmin)}`,
    `mint ${normalized.initialSupply} ${normalized.symbol} to ${shortAddress(normalized.recipient)}`,
  ];
  const calldata = encodeFunctionData({
    abi: B20_FACTORY_ABI,
    functionName: "createB20",
    args: [variantId, salt, params, initCalls],
  });

  return {
    normalized,
    deployerAddress,
    variantId,
    salt,
    params,
    initCalls,
    initCallLabels,
    initialSupplyRaw,
    supplyCapRaw,
    calldata,
    paramsHash: keccak256(params),
    initCallsHash: keccak256(encodeAbiParameters([{ type: "bytes[]" }], [initCalls])),
    calldataHash: keccak256(calldata),
  };
}

export async function prepareB20IssuerProofFromMessages(input: {
  messages: B20IssuerConversationMessage[];
  agentId: string;
  deployerAddress?: string;
  rpcUrl?: string;
  now?: Date;
}) {
  const collected = collectB20IssuerDetails({
    messages: input.messages,
    deployerAddress: input.deployerAddress,
  });
  if (!collected.ok) return { ok: false as const, message: collected.message, missing: collected.missing, partial: collected.partial };
  const draft = await buildLiveB20IssuerDraft(collected.details, {
    agentId: input.agentId,
    deployer: input.deployerAddress ?? "",
    rpcUrl: input.rpcUrl,
    now: input.now,
  });
  return { ok: true as const, draft, message: buildB20IssuerDraftMessage(draft) };
}

export async function buildLiveB20IssuerDraft(details: B20IssuerDetails, options: LiveDraftOptions): Promise<B20IssuerDraft> {
  const rpcUrl = options.rpcUrl?.trim() || DEFAULT_RPC_URL;
  const payload = buildB20IssuerPayload(details, options.deployer, options.now);
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const predictedAddress = await client.readContract({
    address: B20_FACTORY_ADDRESS,
    abi: B20_FACTORY_ABI,
    functionName: "getB20Address",
    args: [payload.variantId, payload.deployerAddress, payload.salt],
  });
  const [balance, alreadyInitialized, gasEstimate] = await Promise.all([
    client.getBalance({ address: payload.deployerAddress }).catch(() => undefined),
    client.readContract({
      address: B20_FACTORY_ADDRESS,
      abi: B20_FACTORY_ABI,
      functionName: "isB20Initialized",
      args: [predictedAddress],
    }).catch(() => undefined),
    client.estimateContractGas({
      account: payload.deployerAddress,
      address: B20_FACTORY_ADDRESS,
      abi: B20_FACTORY_ABI,
      functionName: "createB20",
      args: [payload.variantId, payload.salt, payload.params, payload.initCalls],
    }).catch(() => undefined),
  ]);

  return {
    ...payload.normalized,
    version: 1,
    agentId: options.agentId,
    network: B20_ISSUER_NETWORK,
    chainId: B20_ISSUER_CHAIN_ID,
    chainName: B20_ISSUER_CHAIN_NAME,
    rpcUrl,
    deployer: payload.deployerAddress,
    factory: B20_FACTORY_ADDRESS,
    variantId: payload.variantId,
    salt: payload.salt,
    params: payload.params,
    initCalls: payload.initCalls,
    initCallLabels: payload.initCallLabels,
    initialSupplyRaw: payload.initialSupplyRaw.toString(),
    supplyCapRaw: payload.supplyCapRaw.toString(),
    predictedAddress,
    paramsHash: payload.paramsHash,
    initCallsHash: payload.initCallsHash,
    calldataHash: payload.calldataHash,
    deployerBalanceEth: balance == null ? undefined : trimDecimal(formatEther(balance), 8),
    gasEstimate: gasEstimate == null ? undefined : gasEstimate.toString(),
    alreadyInitialized,
    createdAt: (options.now ?? new Date()).toISOString(),
  };
}

export async function executeB20IssuerDraft(input: {
  draft: B20IssuerDraft;
  secret: string;
  confirmation: string;
}): Promise<B20IssuerExecuteResult> {
  if (input.confirmation !== B20_ISSUER_CONFIRMATION) {
    throw new Error(`B20 creation requires ${B20_ISSUER_CONFIRMATION} confirmation.`);
  }
  const account = evmAccountFromSecret(input.secret);
  if (account.address.toLowerCase() !== input.draft.deployer.toLowerCase()) {
    throw new Error(`Stored signer ${account.address} does not match draft deployer ${input.draft.deployer}.`);
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(input.draft.rpcUrl || DEFAULT_RPC_URL) });
  const balance = await client.getBalance({ address: account.address });
  if (balance <= 0n) {
    throw new Error(`The deployer wallet ${input.draft.deployer} has 0 Base Sepolia ETH for gas. Fund it with Base Sepolia ETH, then reply confirm again. Faucet options: https://docs.base.org/base-chain/network-information/network-faucets`);
  }
  const initialized = await client.readContract({
    address: B20_FACTORY_ADDRESS,
    abi: B20_FACTORY_ABI,
    functionName: "isB20Initialized",
    args: [input.draft.predictedAddress],
  });
  if (initialized) {
    throw new Error(`A B20 is already initialized at ${input.draft.predictedAddress}. Use a different salt.`);
  }

  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(input.draft.rpcUrl || DEFAULT_RPC_URL) });
  const hash = await wallet.writeContract({
    address: B20_FACTORY_ADDRESS,
    abi: B20_FACTORY_ABI,
    functionName: "createB20",
    args: [input.draft.variantId, input.draft.salt, input.draft.params, input.draft.initCalls],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const postInitialized = await client.readContract({
    address: B20_FACTORY_ADDRESS,
    abi: B20_FACTORY_ABI,
    functionName: "isB20Initialized",
    args: [input.draft.predictedAddress],
  }).catch(() => false);

  return {
    ok: receipt.status === "success" && postInitialized,
    tokenAddress: input.draft.predictedAddress,
    transactionHash: hash,
    explorerUrl: `https://sepolia.basescan.org/tx/${hash}`,
    initialized: postInitialized,
  };
}

export function buildB20IssuerDraftMessage(draft: B20IssuerDraft) {
  const encoded = encodeB20IssuerDraft(draft);
  const balance = draft.deployerBalanceEth == null ? "unknown" : `${draft.deployerBalanceEth} ETH`;
  const gas = draft.gasEstimate ? `${draft.gasEstimate} gas` : "gas estimate unavailable";
  const deployerNeedsGas = draft.deployerBalanceEth != null && Number(draft.deployerBalanceEth) <= 0;
  const initializedWarning = draft.alreadyInitialized
    ? "\n\nThis predicted address is already initialized. Do not confirm this draft; use a different salt."
    : "";
  const gasWarning = deployerNeedsGas
    ? "\n\nThis deployer currently has 0 Base Sepolia ETH. Fund it before confirming, or the create transaction will fail before broadcast."
    : "";
  return [
    "**B20 issuer proof ready**",
    "",
    `Network: **${draft.chainName}** (${draft.chainId})`,
    `Variant: **${draft.variant === "stablecoin" ? "Stablecoin" : "Asset"}**`,
    `Token: **${draft.name}** (\`${draft.symbol}\`)`,
    draft.variant === "stablecoin" ? `Currency: \`${draft.currency}\` with 6 decimals` : `Decimals: \`${draft.decimals}\``,
    `Initial mint: **${draft.initialSupply} ${draft.symbol}** to \`${draft.recipient}\``,
    `Supply cap: **${draft.supplyCap} ${draft.symbol}**`,
    `Deployer: \`${draft.deployer}\``,
    `Admin: \`${draft.admin}\``,
    `Minter: \`${draft.minter}\``,
    `Predicted B20 address: \`${draft.predictedAddress}\``,
    "",
    "Proof:",
    `- Factory: \`${draft.factory}\``,
    `- Salt: \`${draft.salt}\``,
    `- Params hash: \`${draft.paramsHash}\``,
    `- Init calls hash: \`${draft.initCallsHash}\``,
    `- Create calldata hash: \`${draft.calldataHash}\``,
    `- Deployer balance: ${balance}; ${gas}`,
    "",
    "Init calls:",
    ...draft.initCallLabels.map((label) => `- ${label}`),
    "",
    "Mainnet is not used for this draft. This will create the token on Base Sepolia only.",
    initializedWarning,
    gasWarning,
    "",
    "Reply `confirm` to create this B20 token.",
    `${B20_ISSUER_PROOF_PREFIX}${encoded}`,
  ].filter(Boolean).join("\n");
}

export function parseB20IssuerDraftMessage(text: string): B20IssuerDraft | null {
  const match = text.match(new RegExp(`${B20_ISSUER_PROOF_PREFIX}([A-Za-z0-9_-]+)`));
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as B20IssuerDraft;
    if (parsed.version !== 1) return null;
    if (parsed.factory !== B20_FACTORY_ADDRESS) return null;
    if (parsed.network !== B20_ISSUER_NETWORK) return null;
    if (!isAddress(parsed.deployer) || !isAddress(parsed.predictedAddress)) return null;
    return {
      ...parsed,
      deployer: getAddress(parsed.deployer),
      predictedAddress: getAddress(parsed.predictedAddress),
      admin: getAddress(parsed.admin),
      minter: getAddress(parsed.minter),
      metadataAdmin: getAddress(parsed.metadataAdmin),
      pauser: getAddress(parsed.pauser),
      unpauser: getAddress(parsed.unpauser),
      recipient: getAddress(parsed.recipient),
    };
  } catch {
    return null;
  }
}

export function b20IssuerResultMessage(result: B20IssuerExecuteResult) {
  if (!result.ok) return `**B20 creation failed**\n\n${result.error ?? "The transaction did not initialize the token."}`;
  return [
    "**B20 token created**",
    "",
    `Token: \`${result.tokenAddress}\``,
    result.transactionHash ? `Tx: \`${result.transactionHash}\`` : "",
    result.explorerUrl ? `Explorer: ${result.explorerUrl}` : "",
  ].filter(Boolean).join("\n");
}

function parseB20IssuerDetails(text: string): Partial<B20IssuerDetails> {
  const normalized = text.replace(/\r/g, "\n");
  const variant: B20IssuerVariant | undefined = /\bstable\s*coin|stablecoin|currency|fiat\b/i.test(normalized)
    ? "stablecoin"
    : /\basset\b/i.test(normalized) ? "asset" : undefined;
  const addresses = [...normalized.matchAll(/0x[a-fA-F0-9]{40}/g)].map((match) => getAddress(match[0]));
  const labeledAddress = (label: string) => {
    const match = normalized.match(new RegExp(`\\b${label}\\b[^\\n,;:]*[:=]?\\s*(0x[a-fA-F0-9]{40})`, "i"));
    return match ? getAddress(match[1]) : undefined;
  };
  const admin = labeledAddress("admin|owner");
  const minter = labeledAddress("minter");
  const recipient = labeledAddress("recipient|receiver|mint\\s+to");
  const metadataAdmin = labeledAddress("metadata");
  const pauser = labeledAddress("pauser");
  const unpauser = labeledAddress("unpauser");
  return {
    variant,
    name: cleanName(matchValue(normalized, /\b(?:name|called|call it)\b\s*(?:is|:|=)?\s*([A-Za-z][A-Za-z0-9 ._'()-]{1,60})/i)),
    symbol: cleanSymbol(matchValue(normalized, /\b(?:symbol|ticker)\b\s*(?:is|:|=)?\s*\$?([A-Za-z0-9]{2,12})\b/i)
      ?? matchValue(normalized, /\$([A-Z][A-Z0-9]{1,11})\b/)),
    decimals: parseSmallInteger(matchValue(normalized, /\bdecimals?\b\s*(?:is|:|=)?\s*(\d{1,2})\b/i)),
    currency: cleanCurrency(matchValue(normalized, /\bcurrency\b\s*(?:is|:|=)?\s*([A-Za-z]{3,8})\b/i)
      ?? matchValue(normalized, /\b([A-Z]{3})\s+stable\s*coin\b/i)),
    initialSupply: cleanAmount(matchValue(normalized, /\b(?:initial\s+)?supply\b\s*(?:is|:|=)?\s*([0-9][0-9_,]*(?:\.[0-9]+)?)/i)
      ?? matchValue(normalized, /\bmint\b\s*([0-9][0-9_,]*(?:\.[0-9]+)?)/i)
      ?? matchValue(normalized, /\b([0-9][0-9_,]*(?:\.[0-9]+)?)\s+(?:tokens?|supply)\b/i)),
    supplyCap: cleanAmount(matchValue(normalized, /\b(?:supply\s+)?cap\b\s*(?:is|:|=)?\s*([0-9][0-9_,]*(?:\.[0-9]+)?)/i)),
    admin,
    minter,
    metadataAdmin,
    pauser,
    unpauser,
    recipient: recipient ?? (!admin && addresses.length === 1 ? addresses[0] : undefined),
    salt: normalizeHex32(matchValue(normalized, /\bsalt\b\s*(?:is|:|=)?\s*(0x[a-fA-F0-9]{64})/i)),
  };
}

function normalizeB20IssuerDetails(details: B20IssuerDetails): B20IssuerDetails {
  const variant = details.variant === "stablecoin" ? "stablecoin" : "asset";
  const name = cleanName(details.name);
  const symbol = cleanSymbol(details.symbol);
  if (!name) throw new Error("Token name is required.");
  if (!symbol) throw new Error("Token symbol is required.");
  const decimals = variant === "stablecoin" ? 6 : Number(details.decimals);
  if (!Number.isInteger(decimals) || decimals < 6 || decimals > 18) throw new Error("Asset decimals must be between 6 and 18.");
  const currency = variant === "stablecoin" ? cleanCurrency(details.currency) : undefined;
  if (variant === "stablecoin" && !currency) throw new Error("Stablecoin currency must be uppercase ASCII, such as USD.");
  const initialSupply = cleanAmount(details.initialSupply);
  const supplyCap = cleanAmount(details.supplyCap);
  if (!initialSupply) throw new Error("Initial supply is required.");
  if (!supplyCap) throw new Error("Supply cap is required.");
  return {
    variant,
    name,
    symbol,
    decimals,
    currency,
    initialSupply,
    supplyCap,
    admin: requireAddress(details.admin, "admin"),
    minter: requireAddress(details.minter, "minter"),
    metadataAdmin: requireAddress(details.metadataAdmin, "metadata admin"),
    pauser: requireAddress(details.pauser, "pauser"),
    unpauser: requireAddress(details.unpauser, "unpauser"),
    recipient: requireAddress(details.recipient, "recipient"),
    salt: details.salt ? normalizeHex32(details.salt) : undefined,
  };
}

function b20IssuerMissingInfoMessage(missing: string[], partial: Partial<B20IssuerDetails>) {
  return [
    "**B20 issuer setup**",
    "",
    "I can make this on **Base Sepolia**. I still need:",
    ...missing.map((item) => `- ${item}`),
    "",
    "Reply with the missing details in one line, for example:",
    "`name Adaptive Test Token, symbol ADAPT, initial supply 1000`",
    "",
    partial.admin && partial.admin !== ZERO_ADDRESS ? `Using admin wallet \`${partial.admin}\`.` : "If you do not give admin/minter/recipient wallets, I will use this agent's wallet for all three.",
  ].join("\n");
}

function encodeB20IssuerDraft(draft: B20IssuerDraft) {
  return Buffer.from(JSON.stringify(draft), "utf8").toString("base64url");
}

function defaultSalt(details: B20IssuerDetails, deployer: Address, now: Date): Hex {
  return keccak256(toBytes([
    "hivemindos:b20-issuer-proof:v1",
    B20_ISSUER_NETWORK,
    deployer.toLowerCase(),
    details.variant,
    details.name,
    details.symbol,
    details.initialSupply,
    details.supplyCap,
    now.toISOString(),
  ].join("|")));
}

function evmAccountFromSecret(secret: string) {
  const compact = secret.trim();
  const prefixed = compact.startsWith("0x") ? compact : `0x${compact}`;
  if (/^0x[a-fA-F0-9]{64}$/.test(prefixed)) return privateKeyToAccount(prefixed as Hex);
  const mnemonic = compact.toLowerCase().replace(/\s+/g, " ");
  if (validateMnemonic(mnemonic, englishWordlist)) return mnemonicToAccount(mnemonic);
  throw new Error("Stored Base signer must be an EVM private key or recovery phrase.");
}

function matchValue(text: string, regex: RegExp) {
  return text.match(regex)?.[1]?.trim();
}

function cleanName(value?: string) {
  const clean = value?.replace(/\s+/g, " ").replace(/[,.].*$/, "").trim();
  return clean && clean.length <= 64 ? clean : undefined;
}

function cleanSymbol(value?: string) {
  const clean = value?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return clean && clean.length >= 2 ? clean : undefined;
}

function cleanCurrency(value?: string) {
  const clean = value?.toUpperCase().replace(/[^A-Z]/g, "");
  return clean && /^[A-Z]{3,8}$/.test(clean) ? clean : undefined;
}

function cleanAmount(value?: string) {
  const clean = value?.replace(/_/g, "").replace(/,/g, "").trim();
  return clean && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(clean) ? clean : undefined;
}

function parseSmallInteger(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeAddress(value?: string): Address | undefined {
  return value && isAddress(value) ? getAddress(value) : undefined;
}

function requireAddress(value: string | undefined, label: string): Address {
  if (!value || !isAddress(value)) throw new Error(`${label} address must be a valid EVM address.`);
  return getAddress(value);
}

function isNonZeroAddress(value: unknown) {
  return typeof value === "string" && isAddress(value) && getAddress(value) !== ZERO_ADDRESS;
}

function normalizeHex32(value?: string): Hex | undefined {
  if (!value) return undefined;
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value as Hex : undefined;
}

function trimDecimal(value: string, places: number) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, places).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
