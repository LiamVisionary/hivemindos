#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  addressTokenKey,
  isTokenAddressInput,
  sameToken,
  shortToken,
} = await import("../src/components/trade/address-token.ts");

const pickerSource = readFileSync(new URL("../src/components/trade/AddressTokenPicker.tsx", import.meta.url), "utf8");
const ticketSource = readFileSync(new URL("../src/components/trade/CryptoTicket.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../src/app/api/trading/token/route.ts", import.meta.url), "utf8");
const metadataSource = readFileSync(new URL("../src/lib/services/trading/token-metadata.ts", import.meta.url), "utf8");

test("address completion recognizes EVM contracts and Solana mints", () => {
  assert.equal(isTokenAddressInput("0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3", "eip155:8453"), true);
  assert.equal(isTokenAddressInput("0xA382", "eip155:8453"), false);
  assert.equal(isTokenAddressInput("So11111111111111111111111111111111111111112", "solana:mainnet"), true);
  assert.equal(isTokenAddressInput("not-a-mint", "solana:mainnet"), false);
});

test("address helpers compare EVM tokens case-insensitively and keep Solana keys exact", () => {
  assert.equal(sameToken("0xAbC", "0xaBc"), true);
  assert.equal(shortToken("0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3"), "0xA382…5bA3");
  assert.equal(addressTokenKey("eip155:8453", "0xAbC"), "eip155:8453:0xabc");
  assert.equal(addressTokenKey("solana:mainnet", "AbC"), "solana:mainnet:AbC");
});

test("completed addresses auto-resolve into the shared coin+ticker view with a reset control", () => {
  assert.match(pickerSource, /window\.setTimeout\(async \(\) =>/);
  assert.match(pickerSource, /resolveAddressToken\(\{ network, address: nextAddress \}\)/);
  assert.match(pickerSource, /<Coin sym=\{token\.symbol\} size=\{24\} logoUrl=\{token\.iconUrl\}/);
  assert.match(pickerSource, /Use a different \$\{label\.toLowerCase\(\)\} token address/);
  assert.match(ticketSource, /<AddressTokenPicker label="Pay"/);
  assert.match(ticketSource, /<AddressTokenPicker label="Receive"/);
});

test("token discovery is authenticated and validates metadata server-side", () => {
  assert.match(routeSource, /requireAuth\(request\)/);
  assert.match(routeSource, /resolveTradeTokenMetadata\(network, address\)/);
  assert.match(metadataSource, /readErc20Decimals\(network, address\)/);
  assert.match(metadataSource, /getMint\(connection, new PublicKey\(address\)\)/);
  assert.match(metadataSource, /api\.dexscreener\.com\/token-pairs\/v1/);
});
