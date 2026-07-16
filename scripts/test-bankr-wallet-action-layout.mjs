#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const viewSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
const walletStyles = readFileSync(join(root, "src/components/wallets-drop-in/wallets.css"), "utf8");

assert.match(viewSource, /className="fw-bankr-actions"/);
assert.match(walletStyles, /\.fw-bankr-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*\}/s);
assert.match(walletStyles, /\.fw-bankr-actions\s*>\s*\.fb-btn\.primary\s*\{[^}]*flex:\s*1 1 150px;[^}]*min-width:\s*150px;[^}]*\}/s);
assert.match(walletStyles, /\.fw-myrow\s*\{[^}]*grid-auto-rows:\s*1fr;[^}]*align-items:\s*stretch;[^}]*\}/s);
assert.equal((viewSource.match(/className="fw-mywallet fw-mywallet-expandable"/g) || []).length, 2);
assert.equal((viewSource.match(/shouldToggleWalletCard\(event\)/g) || []).length, 2);
assert.equal((viewSource.match(/className="fw-wallet-card-caret"/g) || []).length, 2);
assert.equal((viewSource.match(/aria-expanded=\{expanded\}/g) || []).length, 2);
assert.match(viewSource, /WALLET_CARD_TOGGLE_EXCLUSION_SELECTOR\s*=\s*[^;]*\[role='dialog'\][^;]*\.fw-sheet/);
assert.match(walletStyles, /\.fw-wallet-card-caret\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*\}/s);
assert.match(walletStyles, /\.fw-split-wrap\s*\{[^}]*flex:\s*0 0 164px;[^}]*\}/s);
assert.match(viewSource, /\{expanded \? <BBtn variant="ghost" sm data-active=\{sheet === "export" \? "" : undefined\} onClick=\{\(\) => toggleSheet\("export"\)\}><BIcon name="key" size=\{14\} \/> Export keys<\/BBtn> : null\}/);

console.log("My wallets card layout tests passed.");
