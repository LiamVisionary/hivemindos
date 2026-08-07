import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import policyBundle from "../legal/hivemindos-policies.json" with { type: "json" };

import {
  HIVEMINDOS_TERMS_ACCEPTANCE_KEY,
  HIVEMINDOS_TERMS_SECTIONS,
  HIVEMINDOS_TERMS_VERSION,
  currentTermsAcceptance,
  serializeTermsAcceptance,
} from "../src/features/legal/terms-contract.ts";

const acceptedAt = "2026-07-11T08:00:00.000Z";
const serialized = serializeTermsAcceptance(acceptedAt);
const parsed = currentTermsAcceptance(serialized);

assert.equal(HIVEMINDOS_TERMS_ACCEPTANCE_KEY, "hivemindos.terms.acceptance.v1");
assert.equal(parsed?.version, HIVEMINDOS_TERMS_VERSION);
assert.equal(parsed?.acceptedAt, acceptedAt);
assert.equal(currentTermsAcceptance("not-json"), null);
assert.equal(currentTermsAcceptance(JSON.stringify({ version: "old", acceptedAt })), null);
assert.equal(currentTermsAcceptance(JSON.stringify({ version: HIVEMINDOS_TERMS_VERSION, acceptedAt: "invalid" })), null);

const termsText = HIVEMINDOS_TERMS_SECTIONS
  .flatMap((section) => [section.title, ...section.paragraphs, ...(section.bullets ?? [])])
  .join(" ")
  .toLowerCase();

for (const requiredLanguage of [
  "artificial intelligence",
  "productivity",
  "earnings",
  "mistakes",
  "human review",
  "your discretion",
  "assume the risks",
  "as is",
  "maximum extent permitted by law",
  "financial",
  "medical",
  "legal",
]) {
  assert.ok(termsText.includes(requiredLanguage), `terms must include ${requiredLanguage}`);
}

assert.equal(policyBundle.schemaVersion, 1);
assert.equal(policyBundle.terms.version, HIVEMINDOS_TERMS_VERSION);
assert.equal(policyBundle.terms.sections.length, HIVEMINDOS_TERMS_SECTIONS.length);

const privacyText = policyBundle.privacy.sections
  .flatMap((section) => [section.title, ...section.paragraphs, ...(section.bullets ?? [])])
  .join(" ")
  .toLowerCase();

for (const requiredLanguage of [
  "local-first",
  "entirely on the machines",
  "not sent merely by opening the app",
  "limited automatic technical connections",
  "honey rewards are disabled by default",
  "signed github release endpoint",
  "do not sell personal information",
  "privacy@hivemindos.app",
]) {
  assert.ok(privacyText.includes(requiredLanguage), `privacy policy must include ${requiredLanguage}`);
}

const gateSource = readFileSync("src/features/legal/TermsAcceptanceGate.tsx", "utf8");
const gateStyles = readFileSync("src/features/legal/TermsAcceptanceGate.module.css", "utf8");
const frameSource = readFileSync("src/app/DashboardNativeFrame.tsx", "utf8");
const privacyPageSource = readFileSync("src/app/privacy/page.tsx", "utf8");
const localTelemetrySource = readFileSync("src/lib/services/telemetry/local-telemetry.ts", "utf8");
const honeyConfigSource = readFileSync("src/lib/services/wallet/honey-economy-config.ts", "utf8");
const updaterSource = readFileSync("src/lib/native/use-native-update.ts", "utf8");

assert.match(gateSource, /saveDashboardStateValue\([\s\S]*HIVEMINDOS_TERMS_ACCEPTANCE_KEY/);
assert.match(gateSource, /if \(!saved\)/, "failed acceptance persistence must fail closed");
assert.match(gateSource, /disabled=\{!agreed \|\| saving\}/, "accept action must require an affirmative checkbox");
assert.match(gateSource, /href="\/privacy"/, "acceptance gate must make the privacy policy available before acceptance");
assert.match(gateSource, /Quit without accepting/, "acceptance gate must provide an explicit way to leave without accepting");
assert.match(gateSource, /@tauri-apps\/plugin-process/, "native quit must close the app instead of relying on an explanatory sentence");
assert.match(gateSource, /private, local-first core/i);
assert.match(privacyPageSource, /<PrivacyDocument \/>/);
assert.match(
  localTelemetrySource,
  /process\.env\.NODE_ENV !== "production" \|\| process\.env\.HIVEMINDOS_TELEMETRY === "true"/,
  "detailed production telemetry must remain opt-in",
);
assert.match(honeyConfigSource, /let flagCache = \{ enabled: false,/,
  "the official Honey economy must default off");
assert.match(updaterSource, /RECHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/,
  "the disclosed automatic signed-update interval must stay accurate");
assert.match(
  gateStyles,
  /grid-template-rows:\s*auto auto auto minmax\(0,\s*1fr\) auto/,
  "the agreement must occupy the bounded, scrollable grid row",
);
assert.match(
  gateStyles,
  /\.termsScroll\s*\{[\s\S]*?min-height:\s*0;/,
  "the agreement row must be allowed to shrink inside the viewport",
);
assert.match(
  gateStyles,
  /\.actions button\s*\{[\s\S]*?font-weight:\s*500;/,
  "the acceptance action must use calm medium-weight typography",
);
assert.match(frameSource, /<TermsAcceptanceGate>[\s\S]*<DashboardApp[\s\S]*<NativeFirstRunOnboarding \/>[\s\S]*<\/TermsAcceptanceGate>/);

console.log("Terms acceptance contract is versioned, affirmative, durable, and gates dashboard operations.");
