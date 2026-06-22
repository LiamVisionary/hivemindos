#!/usr/bin/env node
// Money-safety unit test for the plain-USDC-send intent parser. A misparse here
// = funds to the wrong address, so we assert it only produces a draft when the
// recipient + amount are unambiguous, never captures the recipient as the
// source, and cleanly refuses private/Veil and x402 (URL) phrasing.
//
// Run: node --experimental-strip-types scripts/test-wallet-send-intent.mjs
import {
  parseSendRequest,
  parseSendDraft,
  buildSendDraftMessage,
  parseSwapRequest,
  parseSwapDraft,
  buildSwapDraftMessage,
  hasLocalSwapIntent,
} from "../src/lib/services/chat/wallet-action-intents.ts";

const RECIP = "0x7F31E05AF18459CEBDda02228E00B53aa6B381dd";
const SRC = "0xC42e0144fBfe7e16F240fF8A74d04A125d147bE9";
const failures = [];
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const isNull = (v, msg) => { if (v !== null) failures.push(`${msg}: expected null, got ${JSON.stringify(v)}`); };
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

// --- valid sends ---
const a = parseSendRequest(`send $1 to ${RECIP} from my wallet ${SRC}`);
eq(a?.recipient, RECIP, "explicit from-address recipient");
eq(a?.amountUsd, 1, "explicit from-address amount");
eq(a?.source.address?.toLowerCase(), SRC.toLowerCase(), "explicit from-address source");

const b = parseSendRequest(`send 5 usdc to ${RECIP} from my personal wallet`);
eq(b?.amountUsd, 5, "usdc-worded amount");
ok(b?.source.personal === true && !b?.source.address, "personal-wallet hint, no address");

const c = parseSendRequest(`send $2.50 to ${RECIP}`);
eq(c?.amountUsd, 2.5, "no-source amount");
ok(!c?.source.address && !c?.source.personal, "no source hint -> empty (fallback)");

const d = parseSendRequest(`send $1 from ${SRC} to ${RECIP}`);
eq(d?.recipient, RECIP, "from-before-to recipient");
eq(d?.source.address?.toLowerCase(), SRC.toLowerCase(), "from-before-to source not confused with recipient");

const e = parseSendRequest(`send 3 dollars to ${RECIP} from my base wallet`);
ok(e?.source.personal === true && e?.source.chain === "base", "base-chain personal hint");

// --- refusals (must NOT produce a draft) ---
isNull(parseSendRequest(`send $1 to bob`), "no 0x recipient");
isNull(parseSendRequest(`send $1 from my wallet ${SRC}`), "no explicit to-recipient");
isNull(parseSendRequest(`pay https://api.example.com/paid for ${RECIP}`), "URL -> x402 not send");
isNull(parseSendRequest(`privately send $1 to ${RECIP}`), "private -> Veil not plain send");
isNull(parseSendRequest(`send 0.01 eth to ${RECIP}`), "non-USDC asset, no $ -> refuse");
isNull(parseSendRequest(`what's my balance`), "unrelated text");
isNull(parseSendRequest(`send to ${RECIP}`), "no amount");

// --- draft round-trip (preview <-> execute parse) ---
const draftMsg = buildSendDraftMessage({
  source: { agentId: "user:x", address: SRC, network: "eip155:8453", isPersonal: true, label: "your personal wallet" },
  recipient: RECIP,
  amountUsd: 1,
});
const parsed = parseSendDraft(draftMsg);
eq(parsed?.sourceAddress?.toLowerCase(), SRC.toLowerCase(), "draft round-trip source");
eq(parsed?.recipient?.toLowerCase(), RECIP.toLowerCase(), "draft round-trip recipient");
eq(parsed?.amountUsd, 1, "draft round-trip amount");
ok(/Base/.test(draftMsg) && /USDC/.test(draftMsg) && /SEND_USDC/.test(draftMsg), "draft shows chain/asset/confirm token");

// --- swap parsing ---
const s1 = parseSwapRequest(`swap 5 USDC to ETH from my wallet ${SRC}`);
eq(s1?.sellToken, "USDC", "swap sell token");
eq(s1?.buyToken, "ETH", "swap buy token");
eq(s1?.amountHuman, 5, "swap amount in sell units");
eq(s1?.family, "evm", "swap family evm (ETH)");
ok(hasLocalSwapIntent(`swap 5 USDC to ETH from my wallet ${SRC}`, s1.source), "local swap intent (from-address)");

const s2 = parseSwapRequest(`swap $10 usdc for SOL from my personal wallet`);
eq(s2?.family, "solana", "swap family solana (SOL)");
eq(s2?.amountHuman, 10, "swap $-stable amount");

const s3 = parseSwapRequest(`swap 0.002 ETH to USDC from my wallet`);
eq(s3?.sellToken, "ETH", "swap non-stable sell");
eq(s3?.amountHuman, 0.002, "swap fractional token amount");

isNull(parseSwapRequest(`swap $5 ETH to USDC`), "ambiguous $-of-nonstable -> refuse");
isNull(parseSwapRequest(`swap 5 FOO to BAR`), "unknown symbols -> refuse");
isNull(parseSwapRequest(`privately swap 5 USDC to ETH`), "private swap -> not local DEX");
ok(hasLocalSwapIntent("swap 5 USDC to ETH on the dex", parseSwapRequest("swap 5 USDC to ETH on the dex")?.source ?? {}), "dex keyword -> local");
ok(!hasLocalSwapIntent("swap 5 USDC to ETH", parseSwapRequest("swap 5 USDC to ETH")?.source ?? {}), "generic swap -> NOT local (Bankr)");

const swapDraft = buildSwapDraftMessage({
  source: { agentId: "user:x", address: SRC, network: "eip155:8453", isPersonal: true, label: "your personal wallet" },
  sellToken: "USDC", buyToken: "ETH", amountHuman: 2, quoteLine: "You get ≈ 0.0006 ETH", maxUsd: 10,
});
const sp = parseSwapDraft(swapDraft);
eq(sp?.sourceAddress?.toLowerCase(), SRC.toLowerCase(), "swap draft round-trip source");
eq(sp?.sellToken, "USDC", "swap draft round-trip sell");
eq(sp?.buyToken, "ETH", "swap draft round-trip buy");
eq(sp?.amountHuman, 2, "swap draft round-trip amount");
ok(/CONFIRM_SWAP/.test(swapDraft) && /0x/.test(swapDraft), "swap draft shows confirm token + chain rail");

if (failures.length) {
  console.error(`FAIL (${failures.length}):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS: wallet send-intent parser (all cases)");
