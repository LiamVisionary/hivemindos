# Wallets, approvals, and trading

> https://hivemindos.app/superagent-api/docs/wallets-trading · Markdown version: https://hivemindos.app/superagent-api/docs/wallets-trading.md

Managed wallets let your app use a wallet address without ever receiving its private key or recovery phrase. Before money moves, HivemindOS checks the wallet policy, a short-lived quote, the API key's permissions and limits, available Agent Credits, and any required approval.

Every money action follows the same pattern: **quote, approve if needed, then submit once.**

Start on a test network. Move to a main network only after you have tested policy, approval separation, retries, event handling, and recovery end to end.

## Before you start

Use separate keys for proposing and approving, so a key that can execute an action cannot also approve it. An approval must come from the account owner or from a key outside the requesting key's family: never the key that asked, a key it created, the key that created it, or a sibling (`403` with `approval_requires_another_principal`). Keep the reviewer key under its own root key:

| Responsibility | Suggested scopes |
|---|---|
| Wallet reader | `wallets:read` |
| Wallet creator | `wallets:create`, `wallets:read` |
| Transfer worker | `wallets:read`, `wallets:transact` |
| Message signer | `wallets:read`, `wallets:sign` |
| Trading worker | `wallets:read`, `trading:read`, `trading:execute` |
| Swap worker | `wallets:read`, `wallets:transact` |
| Own-wallet swap builder | `wallets:read` |
| Reviewer | `approvals:read`, `approvals:write` |
| Policy administrator | `wallets:read`, `approvals:write` |

Add `managed-wallets`, `managed-trading`, or `universal-swaps` to each key's service allowlist as needed.

Supported networks: `base`, `base-sepolia`, `ethereum`, `ethereum-sepolia`, `solana`, and `solana-devnet`. Availability may vary, so check `GET /services` and current pricing before offering a network or paid action.

## Create a managed wallet

```ts
const created = await hive.wallets.create(
  {
    name: "Testnet treasury",
    network: "base-sepolia",
    kind: "agent",
    policy: {
      enabled: true,
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["ETH"],
      allowedRecipients: ["0x1111111111111111111111111111111111111111"],
      allowedContracts: [],
      maxTransactionUsd: 25,
      maxDailyUsd: 100,
      requireApprovalAboveUsd: 5,
    },
  },
  { idempotencyKey: "testnet-treasury-v1" },
);

if (!created.ok) throw new Error(created.error);
console.log(created.wallet.id, created.wallet.address);
```

You get an address and policy back, never a private key or recovery phrase. Read wallets with `wallets.list`, `wallets.get`, and `wallets.balances`.

The policy sets whether actions are enabled; the allowed networks, assets, recipients, and contracts; the maximum per transaction and per day; and the value above which approval is required. Changing a policy needs `approvals:write`, an idempotency key, and the exact wallet id, so treat it as a reviewer's job.

## Send a transfer

**1. Quote.** Amounts are positive integer strings in atomic units. Never use floating-point numbers for asset amounts.

```ts
const quoted = await worker.wallets.quoteTransaction(
  walletId,
  {
    kind: "send",
    network: "base-sepolia",
    asset: "ETH",
    amount: "1000000000000000",
    recipient: "0x1111111111111111111111111111111111111111",
  },
  { idempotencyKey: "invoice-1042-quote" },
);

if (!quoted.ok) throw new Error(quoted.error);
```

The quote has `maximumDebitCredits`, an estimated network fee when available, `expiresAt`, `approvalRequired`, and an `approvalId` when review is needed. Show the reviewer the exact asset action, the fee estimate, and the maximum credit price.

**2. Approve, if required.**

```ts
if (quoted.quote.approvalRequired) {
  const reviewed = await reviewer.approvals.decide(
    quoted.quote.approvalId!,
    "approve",
    { idempotencyKey: "invoice-1042-approval" },
  );
  if (!reviewed.ok) throw new Error(reviewed.error);
}
```

An approval covers only the exact quoted action and expires with the quote. A rejected quote cannot be executed.

**3. Submit once.**

```ts
const submitted = await worker.wallets.submitTransaction(
  walletId,
  {
    quoteId: quoted.quote.id,
    approvalId: quoted.quote.approvalId ?? undefined,
  },
  { idempotencyKey: "invoice-1042-submit" },
);

if (!submitted.ok) throw new Error(submitted.error);
```

The same flow supports `kind: "swap"` with `fromAsset`, `toAsset`, `amount`, and optional `slippageBps`. Quotes are short-lived and single-use; if one expires, get a new quote and have it reviewed again.

## Sign a message

Message signatures always need an approval:

```ts
const quoted = await signer.wallets.quoteSignature(
  walletId,
  { message: "Sign in to Example at 2026-08-24T12:00:00Z" },
  { idempotencyKey: "example-sign-in-quote-001" },
);

if (!quoted.ok) throw new Error(quoted.error);

await reviewer.approvals.decide(
  quoted.approval.id,
  "approve",
  { idempotencyKey: "example-sign-in-approve-001" },
);

const signed = await signer.wallets.sign(
  walletId,
  { quoteId: quoted.quote.id, approvalId: quoted.approval.id },
  { idempotencyKey: "example-sign-in-execute-001" },
);
```

Show the reviewer the complete message. Never ask anyone to approve a signing payload they cannot fully read.

## Place a spot trade

Managed trading supports market spot orders. Markets use `BASE_ASSET/QUOTE_ASSET`, such as `ETH/USDC`.

```ts
const quoted = await trader.trading.quote(
  {
    walletId,
    market: "ETH/USDC",
    side: "buy",
    amount: "10000000",
    amountType: "quote",
    orderType: "market",
    slippageBps: 100,
  },
  { idempotencyKey: "rebalance-eth-usdc-quote-001" },
);

if (!quoted.ok) throw new Error(quoted.error);

if (quoted.quote.approvalRequired) {
  await reviewer.approvals.decide(
    quoted.quote.approvalId!,
    "approve",
    { idempotencyKey: "rebalance-eth-usdc-approve-001" },
  );
}

const order = await trader.trading.createOrder(
  {
    quoteId: quoted.quote.id,
    approvalId: quoted.quote.approvalId ?? undefined,
  },
  { idempotencyKey: "rebalance-eth-usdc-submit-001" },
);
```

Read positions with `trading.positions(walletId)`. A submitted order may still be processing, so rely on its status and signed events rather than treating acceptance as a fill.

Copy-trading is a separate managed service. A spot order here never becomes a limit, recurring, leveraged, or copy-trading order.

## Universal swaps

Universal swaps turn any token into any other, on one chain or across chains. Add `universal-swaps` to the key's service allowlist. Two ways to use it:

- **From a HivemindOS wallet**: quote, approve if the wallet's policy asks, then execute. HivemindOS signs and sends.
- **From your own wallet**: get a checked, unsigned route and sign it yourself. HivemindOS never holds the key.

| Method and path | Scope | What it does |
|---|---|---|
| `GET /v1/swaps/tokens` | `wallets:read` | Chains you can swap on and the official token contract each symbol means. Optional `chainId` query. |
| `POST /v1/swaps/quote` | `wallets:transact` | Quote a swap from a HivemindOS wallet. Needs an `Idempotency-Key`. |
| `POST /v1/swaps` | `wallets:transact` | Execute an approved quote. Needs an `Idempotency-Key`. |
| `GET /v1/swaps` | `wallets:read` | List swaps. |
| `GET /v1/swaps/{swapId}` | `wallets:read` | Read one swap, with cross-chain fill status. |
| `POST /v1/swaps/prepare` | `wallets:read` | Build an unsigned route for your own wallet. No credits. |
| `GET /v1/swaps/routes/{routeId}` | `wallets:read` | Follow a route your own wallet sent until it fills. |

`GET /v1/swaps/tokens` lists every chain with `canSwapFrom` and `canSwapTo`. `canSwapFrom` refers to HivemindOS wallets, which can start a swap on Base, Ethereum, and Solana; your own wallet can start on any listed chain. A symbol such as `usdc` resolves only to the official contract for that chain. Any other token works when you pass its contract or mint address, and the response flags it as unverified.

**Costs:** an executed swap from a HivemindOS wallet charges 20 Agent Credits, and only when it runs. A 0.45% platform fee is inside the route's price. The quote's `maximumDebitCredits` is the authoritative charge. Routes for your own wallet charge no credits.

A key made from an Agent Credit token cannot hold `wallets:transact`, so it cannot quote or execute swaps from HivemindOS wallets. It can use `POST /v1/swaps/prepare` and `GET /v1/swaps/routes/{routeId}` with `wallets:read`.

### Say what to swap

Name the tokens as `chain:symbol`, such as `base:usdc` or `solana:sol`, or as a contract or mint address. Then give one amount:

| Field | Meaning |
|---|---|
| `amount` | Decimal amount of `from` to spend, such as `"50"`. |
| `amountAtomic` | The same, in the token's smallest unit. |
| `amountOut` | Decimal amount of `to` to receive exactly, such as `"0.8"`. |
| `amountOutAtomic` | The same, in the token's smallest unit. |

Give an amount to spend or an amount to receive, not both. With `amountOut`, the route prices what it costs to receive at least that amount, and `tradeType` comes back as `EXACT_OUTPUT`. Otherwise it is `EXACT_INPUT`.

You can also describe the swap in plain words in `request` and leave the fields out:

- `"swap 50 USDC on Base to SOL"`
- `"i need 0.8 sol"`
- `"swap usdc to 0.8sol"`
- `"move 20 usdc from solana to base"`

- A short, exact sentence like the first one is read directly.
- Anything looser is read the way Ask Scout on the hivemindos.app Trade desk reads it. That uses managed decisions and is billed like any other decision call. A key without `services.invoke.managed-models.decisions.create` gets HTTP 403; use `from`, `to` and an amount instead.
- When the words name no chain, funds start on `defaultChain` (a chain slug, default `base`).
- When they name nothing to pay with, a HivemindOS wallet pays from what it holds, dollars first.

Every quote and route returns `interpretation`: the swap as HivemindOS read it. Show it to the person before anything is spent.

Other optional fields: `slippageBps` (0 to 10,000; the router sets it when omitted), `fromWalletId`, `toWalletId`, `recipient`, and `provisionMissingWallets` (create a receiving HivemindOS wallet on the destination chain if the account has none there; needs `wallets:create`).

### Swap from a HivemindOS wallet

```ts
const quoted = await worker.swaps.quote(
  { from: "base:usdc", to: "solana:sol", amountOut: "0.8" },
  { idempotencyKey: "treasury-sol-quote-001" },
);
if (!quoted.ok) throw new Error(quoted.error);

const { quote } = quoted;
// Show this before approving: what was understood, what it costs, what arrives.
console.log(quote.interpretation, quote.tradeType);
console.log(`Pay ${quote.from.amount} ${quote.from.symbol} on ${quote.from.chainName}, receive ${quote.to.amount} ${quote.to.symbol} on ${quote.to.chainName}`);

if (quote.approvalRequired) {
  await reviewer.approvals.decide(quote.approvalId!, "approve", { idempotencyKey: "treasury-sol-approve-001" });
}

const executed = await worker.swaps.execute(
  { quoteId: quote.id, approvalId: quote.approvalId ?? undefined },
  { idempotencyKey: "treasury-sol-execute-001" },
);
if (!executed.ok) throw new Error(executed.error);

const swap = await worker.swaps.get(executed.swap.id);
```

Or with curl:

```bash
curl https://api.hivemindos.app/v1/swaps/quote \
  -H "Authorization: Bearer $HIVEMINDOS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: treasury-sol-quote-001" \
  -d '{"request":"i need 0.8 sol"}'

curl https://api.hivemindos.app/v1/swaps \
  -H "Authorization: Bearer $HIVEMINDOS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: treasury-sol-execute-001" \
  -d '{"quoteId":"swap_quote_...","approvalId":"approval_..."}'
```

The quote includes the `from` and `to` amounts, `minimumOutputAmount`, the price impact, estimated dollar values and network fee, the route's `steps`, `warnings`, `maximumDebitCredits`, `expiresAt`, `approvalRequired`, and `approvalId`. It lasts five minutes. A quote may also create a receiving wallet and report it as `walletProvisioned`.

Executing fetches a fresh route and checks it against what was approved. It refuses a route that would deliver less than `minimumOutputAmount`, and for an exact receive amount it refuses a cost above the approved one plus slippage (1% when you set none). A refused execution spends nothing; get a new quote.

A same-chain swap is done when its transaction lands (`status: "broadcast"`). A cross-chain swap starts as `filling`. Read it with `GET /v1/swaps/{swapId}` until it becomes `filled`, `refunded`, or `failed`; the read includes `routeStatus` and, once filled, `destinationTransactionHash`. Once the source transaction confirms, a cross-chain fill cannot be cancelled.

### Swap from your own wallet

`POST /v1/swaps/prepare` returns a route for a wallet HivemindOS does not hold, for you to sign and send. Nothing is stored or spent and no credits are charged; the 0.45% platform fee is inside the route (`feeBps: 45`).

| Field | Meaning |
|---|---|
| `sender` | Required. The address on the source chain that signs and pays. |
| `recipient` | Required when the swap arrives on the other kind of chain (EVM and Solana). Otherwise it defaults to `sender`. |
| `from`, `to`, amount fields, `request`, `slippageBps`, `defaultChain` | As above. |

This route does not read your balance, so it refuses "all" or a share of a balance: name an amount to spend or receive. It can start on any chain the router serves.

The response:

```json
{
  "ok": true,
  "custody": "self",
  "expiresInSeconds": 30,
  "route": {
    "from": { "symbol": "USDC", "chain": "base", "amount": "50", "amountAtomic": "50000000" },
    "to": { "symbol": "SOL", "chain": "solana", "amount": "0.31", "amountAtomic": "310000000" },
    "sender": "0x…",
    "recipient": "So1…",
    "tradeType": "EXACT_INPUT",
    "crossChain": true,
    "minimumOutputAmount": "306900000",
    "priceImpactPercent": 0.62,
    "estimatedInputUsd": 50,
    "estimatedOutputUsd": 49.69,
    "estimatedNetworkFeeUsd": 0.02,
    "estimatedSeconds": 12,
    "feeBps": 45,
    "routeId": "0x…",
    "interpretation": "50 USDC on Base → SOL on Solana",
    "transactions": [
      { "kind": "evm", "chainId": 8453, "step": "approve", "description": "Approve USDC", "to": "0x…", "data": "0x…", "value": "0" },
      { "kind": "evm", "chainId": 8453, "step": "deposit", "description": "Deposit", "to": "0x…", "data": "0x…", "value": "0" }
    ],
    "warnings": []
  }
}
```

The values above are illustrative. Sign and send `transactions` in order, and wait for each to confirm before sending the next. An EVM route is often an approval followed by the swap itself.

HivemindOS checks every transaction before returning it:

- EVM calls only reach contracts the router publishes, or approve or transfer the token you pay with to one of them, for no more than the amount.
- A Solana transaction is signed only by `sender`, calls only the router's published programs and standard Solana programs, sends SOL only to `sender` or a published solver, and never approves a delegate.

Prices hold for about 30 seconds. Sign promptly, or prepare again.

#### EVM wallet

```ts
const prepared = await hive.swaps.prepare({
  from: "base:usdc",
  to: "arbitrum:eth",
  amount: "50",
  sender: account,
});
if (!prepared.ok) throw new Error(prepared.error);

const hex = (value: string) => `0x${BigInt(value).toString(16)}`;
for (const tx of prepared.route.transactions) {
  if (tx.kind !== "evm") continue;
  await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(String(tx.chainId)) }] });
  const hash = await ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: account, to: tx.to, data: tx.data, value: hex(tx.value), ...(tx.gas ? { gas: hex(tx.gas) } : {}) }],
  });
  await waitForReceipt(hash); // your provider's receipt wait
}
```

#### Solana wallet

```ts
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const prepared = await hive.swaps.prepare({
  request: "swap 2 sol to usdc on base",
  sender: wallet.publicKey.toBase58(),
  recipient: "0x1111111111111111111111111111111111111111",
});
if (!prepared.ok) throw new Error(prepared.error);

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
for (const tx of prepared.route.transactions) {
  if (tx.kind !== "svm") continue;
  let transaction: VersionedTransaction;
  if (tx.transaction) {
    transaction = VersionedTransaction.deserialize(Buffer.from(tx.transaction, "base64"));
  } else {
    // Solana couldn't be reached when the route was built: rebuild it with a fresh blockhash.
    const tables = await Promise.all(tx.addressLookupTableAddresses.map(async (address) =>
      (await connection.getAddressLookupTable(new PublicKey(address))).value!));
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const instructions = (tx.instructions as any[]).map((ix) => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map((key: any) => ({ pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable })),
      data: Buffer.from(ix.data, "hex"), // instruction data is hex, not base64
    }));
    transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(tables));
  }
  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, "confirmed");
}
```

#### Follow the fill

A same-chain route is done when its last transaction confirms. For a cross-chain route, poll with the `routeId`:

```bash
curl https://api.hivemindos.app/v1/swaps/routes/$ROUTE_ID \
  -H "Authorization: Bearer $HIVEMINDOS_API_KEY"
# {"ok":true,"routeId":"0x…","status":"success","filled":true,"destinationTransactionHash":"…"}
```

```ts
const fill = await hive.swaps.routeStatus(prepared.route.routeId!);
if (fill.ok && fill.filled) console.log(fill.destinationTransactionHash);
```

## Credits versus wallet assets

- Agent Credits pay for wallet creation, execution, signing, managed trading, and executed swaps from HivemindOS wallets. The server-owned pricing response sets the maximum charge.
- Wallet assets pay the transfer or trade amount and its network fee. The wallet policy sets which asset actions are allowed.
- `creditsPerDay` can add a key-level daily ceiling to wallet creation, transaction execution, signature execution, trading-order execution, and swap execution. See [limits](limits.html#daily-credit-limits).

HTTP 402 means the HivemindOS account balance is too low for the API charge. It says nothing about whether the wallet holds enough assets. Check both balances and show the right next step.

## Related

- [Per-endpoint and daily credit limits](limits.html)
- [Signed events](runs-webhooks.html)
- [Endpoint reference](reference.html#managed-wallets-and-trading)
