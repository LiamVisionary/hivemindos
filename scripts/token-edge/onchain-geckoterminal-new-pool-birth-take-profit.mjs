#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
} from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE,
  createGeckoTerminalNewPoolBirthEntryRegistrationEvent,
  createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent,
  createGeckoTerminalNewPoolBirthPathRegistrationEvent,
  validatedGeckoTerminalNewPoolBirthEntryRows,
  validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows,
} from "./onchain-geckoterminal-new-pool-activation.mjs";
import {
  validGeckoDexDirectIntegrity,
  validGeckoLiquidityCollapseIntegrity,
} from "./onchain-geckoterminal-trending-monitoring.mjs";
import {
  GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE,
  GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE,
  GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE,
  createGeckoTerminalNewPoolFastPathRegistrationEvent,
  createGeckoTerminalNewPoolFastPathDisagreementRegistrationEvent,
  createGeckoTerminalNewPoolStandardMidPathRegistrationEvent,
  providerDiagnosticRejectionReason,
} from "./onchain-geckoterminal-new-pool-fast-path.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const PATH_CADENCE_MS = 5 * 60_000;

export const GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE = Object.freeze({
  version: "geckoterminal-new-pool-birth-plus-ten-take-profit-v1",
  evidenceBoundary: "2026-08-04T09:27:00.000Z",
  sourceRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  sourcePathRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE.version,
  changedDimension: "exit-only-first-observed-plus-ten-gross-take-profit",
  takeProfitGrossReturnPctInclusive: 10,
  minimumPathMarks: 6,
  maximumPathGapMs: 10 * 60_000,
  terminalLiquidityCollapsePolicy:
    "A validated dual-provider liquidity collapse completes the retained path and scores as total loss unless a prior retained take-profit crossing exists.",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTradedTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  minimumTakeProfitExits: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  derivationStatus: "future-only-prior-policy-transfer-after-diagnostic-newborn-paths",
  derivation: Object.freeze({
    inspectedForecasts: Object.freeze(["TikTok", "Google", "MarsCoin"]),
    changedDimension: "transfer-the-already-frozen-plus-ten-full-exit-to-the-frozen-low-cap-newborn-entry",
    warning: "TikTok crossed +100%, Google suffered a dual-provider liquidity collapse, and MarsCoin was opened before this rule was registered. Those forecasts and every earlier newborn path are excluded. The +10% threshold was copied unchanged from a prior sealed DEX-pulse exit policy.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE,
  version: "geckoterminal-new-pool-birth-plus-ten-prefix-complete-v2",
  evidenceBoundary: "2026-08-04T11:06:20.000Z",
  changedDimension: "exit-only-require-path-completeness-through-observed-take-profit-not-after-exit",
  coveragePolicy: "For an observed +10% take-profit, require complete exact-provider path cadence only from entry through that retained exit. For a hold, require the unchanged complete path through exact outcome; a prior terminal drain remains total loss.",
  derivationStatus: "posthoc-path-validation-correction-future-only",
  derivation: Object.freeze({
    inspectedForecasts: Object.freeze(["TikTok", "Google", "MarsCoin", "WIZARD", "PEPHEAD", "Hthcity"]),
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
    ]),
    warning: "Hthcity exposed the causal-validation issue by recording executable +59% and +67% path quotes before a terminal collapse, while the v1 scorer required later full-hour path coverage even after the hypothetical exit. Hthcity and every inspected path are excluded; this is an unproven future-only correction, not evidence of profit.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE,
  version: "geckoterminal-new-pool-birth-plus-ten-minus-ten-bracket-v3",
  evidenceBoundary: "2026-08-04T11:26:35.000Z",
  changedDimension: "exit-only-add-first-observed-minus-ten-stop-to-causal-plus-ten-full-exit",
  stopLossGrossReturnPctInclusive: -10,
  minimumStopLossExits: 50,
  exitRule: "Exit fully at the first retained executable point at or outside [-10%, +10%]. The first boundary hit is final; otherwise use the exact one-hour outcome.",
  derivationStatus: "future-only-transfer-of-separately-frozen-minus-ten-stop",
  derivation: Object.freeze({
    sourceTakeProfitRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE.version,
    sourceStopRuleVersion: "token-edge-tail-preserving-stop-v1",
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
    ]),
    warning: "PEPHEAD exposed the need to bound losses while Hthcity and WEN exposed the value of taking an observed rise before collapse. The -10% stop is copied unchanged from a separately frozen tail-stop policy. Every inspected newborn, path, and outcome is excluded; this combination is unproven future-only research.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE,
  version: "geckoterminal-standard-cap-new-pool-birth-plus-ten-minus-ten-bracket-v4",
  evidenceBoundary: "2026-08-04T11:52:36.000Z",
  sourceRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version,
  changedDimension: "transfer-frozen-plus-ten-minus-ten-bracket-from-low-cap-to-standard-newborn-entry",
  derivationStatus: "future-only-source-cohort-transfer-after-standard-newborn-collapse",
  derivation: Object.freeze({
    sourceExitRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE.version,
    excludedTokenAddresses: Object.freeze([
      "F1mAAHApto5uNM9KRQLWbzSgeEzm21uwL7rDgnKQGhHb",
      "9gra4e8c1kWvPeEWjfPoCY3TE1Tkaq9JBwUzX9hv4oUE",
    ]),
    warning: "The standard-cap TikTok newborn crossed retained +10%, +15%, and +19% path marks before verified dual-provider collapse; Google also collapsed. Both forecasts, all their paths and outcomes, and every earlier standard newborn are excluded. Thresholds, execution, path, cost, and gate contracts transfer unchanged from the already frozen low-cap bracket.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE,
  version: "geckoterminal-low-cap-new-pool-birth-mixed-path-plus-ten-minus-ten-bracket-v5",
  evidenceBoundary: "2026-08-04T14:45:30.000Z",
  changedDimension: "exit-only-add-preregistered-low-cap-one-minute-exact-points-to-five-minute-path",
  supplementalPathRuleVersion: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE.version,
  derivationStatus: "future-only-reaction-latency-challenger-after-shiro-five-minute-stop-overshoot",
  derivation: Object.freeze({
    sourceExitRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE.version,
    sourceSupplementalPathRuleVersion: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE.version,
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
      "4FzRL2GUrUEvx1CzSDTXFmPkpnG2V9V1aU7oLQUzAVgi",
      "EFSybXm4R8PSUwULtPXDNgGNiNz2fTzuydjndNg1Y8uV",
      "F2HHYsSrQ3wR389JxcLqk9yvTW8JBEizZrDUVq8Q9D6j",
      "Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5",
      "84MbokjpF4T9NhyKmpTbpKjedwuKtYHRP8MNRvb5pump",
    ]),
    warning: "Shiro first crossed the frozen stop at a one-minute -13.565334% quote, then reached -91.194274% at the five-minute mark. KIO had already crossed the take-profit on the five-minute path. KIO, Shiro, all earlier low-cap parents, paths, failures, and outcomes are excluded. This challenger changes only path reaction latency.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_MID_BRACKET_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE,
  version: "geckoterminal-standard-cap-new-pool-birth-mixed-path-plus-ten-minus-ten-bracket-v5",
  evidenceBoundary: "2026-08-04T13:28:05.000Z",
  changedDimension: "exit-only-add-preregistered-standard-mid-bucket-exact-points-to-five-minute-path",
  supplementalPathRuleVersion: GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE.version,
  derivationStatus: "future-only-reaction-latency-challenger-after-standard-five-minute-stop-overshoot",
  derivation: Object.freeze({
    sourceExitRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE.version,
    sourceSupplementalPathRuleVersion: GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE.version,
    excludedTokenAddresses: Object.freeze([
      "F1mAAHApto5uNM9KRQLWbzSgeEzm21uwL7rDgnKQGhHb",
      "9gra4e8c1kWvPeEWjfPoCY3TE1Tkaq9JBwUzX9hv4oUE",
      "FAc8FytXdmxoscfSKU14DLD8sapQmNw8qeX9SsYubLuw",
      "F1cEbdrNT3GDfwhViRVmA4ABkQw8StoSjawLtVXGrkAP",
      "DVAiMKQAZqCrnESBifwXshGgyFpuaMSQdmaaKWNNXgpP",
    ]),
    warning: "WFI first crossed the frozen stop only at a five-minute -49.446089% quote, while BAKI and Koo showed that large moves can occur between scheduled marks. Google, TikTok, BAKI, WFI, Koo, all their paths and outcomes, and every earlier standard newborn are derivation-only and excluded. This challenger changes only path reaction latency; entry, thresholds, full-exit execution, costs, capacity, and gates stay frozen.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_ATTEMPT_COVERED_BRACKET_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE,
  version:
    "geckoterminal-low-cap-new-pool-birth-attempt-covered-plus-ten-minus-ten-bracket-v6",
  evidenceBoundary: "2026-08-04T15:46:30.000Z",
  changedDimension:
    "exit-only-count-valid-preregistered-nonexecutable-provider-disagreements-as-cadence-presence",
  cadenceEvidenceRuleVersion: GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.version,
  cadenceEvidencePolicy:
    "A valid scheduled exact-provider price or liquidity disagreement can prove monitor presence for causal prefix cadence but never supplies a price, return, boundary hit, fill, or fixed-horizon mark. The first later executable exact-provider quote remains the only possible exit.",
  derivationStatus:
    "future-only-execution-availability-challenger-after-kio-monitored-disagreement-gap",
  derivation: Object.freeze({
    sourceExitRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE.version,
    sourceCadenceEvidenceRuleVersion:
      GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.version,
    excludedTokenAddresses: Object.freeze([
      ...GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE.derivation.excludedTokenAddresses,
      "GPX9zjhWhssoGFNpcqvvydgizHqBHFUoGge4yEreC7A4",
    ]),
    warning:
      "KIO ran on schedule but early exact providers disagreed, so the existing bracket rejected its later executable take-profit for a path-start gap. KIO, Shiro, Doom, every current forecast, and all prior diagnostics, paths, failures, and outcomes are excluded. This rule preserves failed execution attempts only as cadence presence and never reconstructs a quote or fill.",
  }),
});

export function createGeckoTerminalNewPoolBirthTakeProfitRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createGeckoTerminalNewPoolBirthPrefixTakeProfitRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createGeckoTerminalNewPoolBirthBracketRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createGeckoTerminalNewPoolBirthStandardBracketRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createGeckoTerminalNewPoolBirthFastBracketRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createGeckoTerminalNewPoolBirthStandardMidBracketRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_MID_BRACKET_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createGeckoTerminalNewPoolBirthAttemptCoveredBracketRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_ATTEMPT_COVERED_BRACKET_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerGeckoTerminalNewPoolBirthTakeProfit(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent,
  ))) throw new Error("Register the frozen low-cap newborn entry parent first.");
  if (!events.some((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolBirthPathRegistrationEvent,
  ))) throw new Error("Register the frozen newborn path policy first.");
  const proposed = createGeckoTerminalNewPoolBirthTakeProfitRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE.evidenceBoundary))) {
    throw new Error("Newborn take-profit registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesTakeProfitRegistration(existing)) {
    throw new Error(`Existing newborn take-profit registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthPrefixTakeProfit(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesTakeProfitRegistration)) {
    throw new Error("Register the frozen newborn take-profit parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthPrefixTakeProfitRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE.evidenceBoundary))) {
    throw new Error("Newborn prefix-complete take-profit registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesPrefixTakeProfitRegistration(existing)) {
    throw new Error(`Existing newborn prefix-complete registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthBracket(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesPrefixTakeProfitRegistration)) {
    throw new Error("Register the frozen newborn prefix take-profit parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthBracketRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE.evidenceBoundary))) {
    throw new Error("Newborn bracket registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBracketRegistration(existing)) {
    throw new Error(`Existing newborn bracket registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthStandardBracket(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBracketRegistration)) {
    throw new Error("Register the frozen low-cap newborn bracket parent first.");
  }
  if (!events.some((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolBirthEntryRegistrationEvent,
  ))) throw new Error("Register the frozen standard newborn entry source first.");
  const proposed = createGeckoTerminalNewPoolBirthStandardBracketRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE.evidenceBoundary))) {
    throw new Error("Standard newborn bracket registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesStandardBracketRegistration(existing)) {
    throw new Error(`Existing standard newborn bracket registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthFastBracket(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBracketRegistration)) {
    throw new Error("Register the frozen low-cap newborn bracket parent first.");
  }
  if (!events.some((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolFastPathRegistrationEvent,
  ))) throw new Error("Register the frozen low-cap one-minute path first.");
  const proposed = createGeckoTerminalNewPoolBirthFastBracketRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE.evidenceBoundary))) {
    throw new Error("Low-cap newborn mixed-path bracket registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFastBracketRegistration(existing)) {
    throw new Error(`Existing low-cap newborn mixed-path bracket registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthStandardMidBracket(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesStandardBracketRegistration)) {
    throw new Error("Register the frozen standard newborn bracket parent first.");
  }
  if (!events.some((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolStandardMidPathRegistrationEvent,
  ))) throw new Error("Register the frozen standard newborn mid-bucket path first.");
  const proposed = createGeckoTerminalNewPoolBirthStandardMidBracketRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_MID_BRACKET_RULE.evidenceBoundary))) {
    throw new Error("Standard newborn mixed-path bracket registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesStandardMidBracketRegistration(existing)) {
    throw new Error(`Existing standard newborn mixed-path bracket registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthAttemptCoveredBracket(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesFastBracketRegistration)) {
    throw new Error("Register the frozen low-cap mixed-path bracket parent first.");
  }
  if (!events.some((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolFastPathDisagreementRegistrationEvent,
  ))) throw new Error("Register the frozen provider-disagreement cadence panel first.");
  const proposed = createGeckoTerminalNewPoolBirthAttemptCoveredBracketRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_ATTEMPT_COVERED_BRACKET_RULE
      .evidenceBoundary))) {
    throw new Error(
      "Attempt-covered newborn bracket registration must be strictly after its evidence boundary.",
    );
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesAttemptCoveredBracketRegistration(existing)) {
    throw new Error(`Existing attempt-covered newborn bracket mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export function buildGeckoTerminalNewPoolBirthTakeProfitScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE,
    registrationMatcher: matchesTakeProfitRegistration,
    coverageReason: birthPathCoverageReason,
    exitSelector: firstTakeProfitExit,
    exitSource: () => "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-take-profit-scorecard",
    note: "This future-only paper challenger changes only the exit of the frozen low-cap newborn entry. It exits fully at the first retained executable +10% gross path point; otherwise it uses the exact one-hour outcome. TikTok, Google, MarsCoin, and all earlier forecasts are excluded, while terminal dual-provider drains remain total losses rather than disappearing through path-completeness selection.",
  });
}

export function buildGeckoTerminalNewPoolBirthPrefixTakeProfitScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE,
    registrationMatcher: matchesPrefixTakeProfitRegistration,
    coverageReason: birthPrefixPathCoverageReason,
    exitSelector: firstTakeProfitExit,
    exitSource: () => "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-prefix-take-profit-scorecard",
    note: "This future-only exit-only sibling preserves the frozen +10% threshold and low-cap newborn entry. When a retained +10% exit exists, it requires complete exact-provider cadence only from entry through that observed exit; a hold still requires the unchanged complete path through the exact one-hour outcome, and a prior terminal drain is -100%. Hthcity and every inspected path are excluded.",
  });
}

export function buildGeckoTerminalNewPoolBirthBracketScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE,
    registrationMatcher: matchesBracketRegistration,
    coverageReason: birthPrefixPathCoverageReason,
    exitSelector: (paths, rule) => paths.find((event) => (
      event.status === "observed"
        && (event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
          || event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive)
    )),
    exitSource: (event, rule) => event.grossReturnFromEntryPct
      <= rule.stopLossGrossReturnPctInclusive
      ? "live-path-stop-loss" : "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-bracket-scorecard",
    note: "This future-only exit-only sibling adds the separately frozen -10% stop to the causal full +10% newborn take-profit. The first retained executable boundary point exits the full paper position. No trigger uses the exact one-hour outcome; later gaps after exit are irrelevant, a hold still needs full path coverage, and a prior drain is -100%. PEPHEAD, Hthcity, WEN, and every inspected path are excluded.",
  });
}

export function buildGeckoTerminalNewPoolBirthStandardBracketScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE,
    registrationMatcher: matchesStandardBracketRegistration,
    sourceRegistrationFactory: createGeckoTerminalNewPoolBirthEntryRegistrationEvent,
    cohortBuilder: validatedGeckoTerminalNewPoolBirthEntryRows,
    providerIntegrityRule: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
    coverageReason: birthPrefixPathCoverageReason,
    exitSelector: (paths, rule) => paths.find((event) => (
      event.status === "observed"
        && (event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
          || event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive)
    )),
    exitSource: (event, rule) => event.grossReturnFromEntryPct
      <= rule.stopLossGrossReturnPctInclusive
      ? "live-path-stop-loss" : "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-standard-bracket-scorecard",
    note: "This future-only source-cohort transfer applies the already frozen +10%/-10% full-exit bracket to the standard-cap newborn v3 entry. Entry screens, exact-provider path integrity, first-hit finality, costs, capacity, exact fallback, terminal-drain accounting, and every gate remain unchanged. Google, TikTok, their paths/outcomes, and every prior standard newborn are excluded.",
  });
}

export function buildGeckoTerminalNewPoolBirthFastBracketScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE,
    registrationMatcher: matchesFastBracketRegistration,
    supplementalPathRegistrationFactory:
      createGeckoTerminalNewPoolFastPathRegistrationEvent,
    supplementalPathRule: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE,
    supplementalObservationMode: "live-point-in-time-one-minute-path",
    supplementalRejectionPrefix: "fast-path",
    coverageReason: birthPrefixPathCoverageReason,
    exitSelector: (paths, rule) => paths.find((event) => (
      event.status === "observed"
        && (event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
          || event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive)
    )),
    exitSource: (event, rule) => event.grossReturnFromEntryPct
      <= rule.stopLossGrossReturnPctInclusive
      ? "live-path-stop-loss" : "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-fast-bracket-scorecard",
    note: "This strictly future low-cap challenger changes only reaction latency by merging the frozen five-minute path with preregistered one-minute exact points before applying the unchanged first-hit +10%/-10% full exit. KIO, Shiro, every prior low-cap parent/path/failure, and all derivation outcomes are excluded.",
  });
}

export function buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_MID_BRACKET_RULE,
    registrationMatcher: matchesStandardMidBracketRegistration,
    sourceRegistrationFactory: createGeckoTerminalNewPoolBirthEntryRegistrationEvent,
    cohortBuilder: validatedGeckoTerminalNewPoolBirthEntryRows,
    providerIntegrityRule: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
    supplementalPathRegistrationFactory:
      createGeckoTerminalNewPoolStandardMidPathRegistrationEvent,
    coverageReason: birthPrefixPathCoverageReason,
    exitSelector: (paths, rule) => paths.find((event) => (
      event.status === "observed"
        && (event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
          || event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive)
    )),
    exitSource: (event, rule) => event.grossReturnFromEntryPct
      <= rule.stopLossGrossReturnPctInclusive
      ? "live-path-stop-loss" : "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-standard-mid-bracket-scorecard",
    note: "This strictly future standard-cap challenger changes only reaction latency by merging the frozen five-minute path with the preregistered minute-three exact path before applying the unchanged first-hit +10%/-10% full exit. Entry, provider integrity, causal prefix coverage, costs, capacity, exact fallback, terminal-drain accounting, evidence gates, and paper-only authority remain unchanged. Google, TikTok, BAKI, WFI, Koo, their paths/outcomes, and every earlier standard newborn are excluded.",
  });
}

export function buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard(events) {
  return buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_ATTEMPT_COVERED_BRACKET_RULE,
    registrationMatcher: matchesAttemptCoveredBracketRegistration,
    supplementalPathRegistrationFactory:
      createGeckoTerminalNewPoolFastPathRegistrationEvent,
    supplementalPathRule: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE,
    supplementalObservationMode: "live-point-in-time-one-minute-path",
    supplementalRejectionPrefix: "fast-path",
    cadenceEvidenceRegistrationFactory:
      createGeckoTerminalNewPoolFastPathDisagreementRegistrationEvent,
    coverageReason: birthAttemptCoveredPrefixPathCoverageReason,
    exitSelector: (paths, rule) => paths.find((event) => (
      event.status === "observed"
        && (event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
          || event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive)
    )),
    exitSource: (event, rule) => event.grossReturnFromEntryPct
      <= rule.stopLossGrossReturnPctInclusive
      ? "live-path-stop-loss" : "live-path-take-profit",
    type: "geckoterminal-new-pool-birth-attempt-covered-bracket-scorecard",
    note: "This strictly future low-cap challenger changes only causal prefix coverage: a valid scheduled exact-provider disagreement can prove that the monitor attempted execution, but it never supplies a quote, return, threshold hit, or fill. The first later executable exact-provider quote remains the only exit. KIO, Shiro, Doom, every current forecast, and all prior attempts and outcomes are excluded.",
  });
}

function buildGeckoTerminalNewPoolBirthTakeProfitScorecardForRule(events, {
  rule,
  registrationMatcher,
  sourceRegistrationFactory =
    createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent,
  cohortBuilder = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows,
  providerIntegrityRule = GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
  supplementalPathRegistrationFactory = null,
  supplementalPathRule = GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE,
  supplementalObservationMode = "live-point-in-time-standard-mid-bucket-path",
  supplementalRejectionPrefix = "standard-mid-path",
  cadenceEvidenceRegistrationFactory = null,
  coverageReason,
  exitSelector,
  exitSource,
  type,
  note,
}) {
  const registration = events.find(registrationMatcher) ?? null;
  const pathRegistration = events.find((event) => matchesExpectedRegistration(
    event,
    createGeckoTerminalNewPoolBirthPathRegistrationEvent,
  )) ?? null;
  const supplementalPathRegistration = supplementalPathRegistrationFactory
    ? events.find((event) => matchesExpectedRegistration(
      event,
      supplementalPathRegistrationFactory,
    )) ?? null
    : null;
  const cadenceEvidenceRegistration = cadenceEvidenceRegistrationFactory
    ? events.find((event) => matchesExpectedRegistration(
      event,
      cadenceEvidenceRegistrationFactory,
    )) ?? null
    : null;
  const sourceRegistration = events.find((event) => matchesExpectedRegistration(
    event,
    sourceRegistrationFactory,
  )) ?? null;
  const cohort = cohortBuilder(events);
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const boundaryAt = Date.parse(rule.evidenceBoundary);
  const candidateForecasts = cohort.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
      && Date.parse(forecast.createdAt) > boundaryAt
      && !(rule.derivation?.excludedTokenAddresses ?? []).includes(forecast.tokenAddress)
  ));
  const candidateIds = new Set(candidateForecasts.map((forecast) => forecast.id));
  const pathsByForecast = new Map();
  const cadenceEvidenceByForecast = new Map();
  for (const event of events) {
    if (cadenceEvidenceRegistration
      && event.type === "geckoterminal-new-pool-provider-diagnostic") {
      if (!cadenceEvidenceByForecast.has(event.forecastId)) {
        cadenceEvidenceByForecast.set(event.forecastId, []);
      }
      cadenceEvidenceByForecast.get(event.forecastId).push(event);
      continue;
    }
    if (event.type !== "geckoterminal-new-pool-path"
      && !(supplementalPathRegistration
        && event.type === "geckoterminal-new-pool-fast-path")) continue;
    if (!pathsByForecast.has(event.forecastId)) pathsByForecast.set(event.forecastId, []);
    pathsByForecast.get(event.forecastId).push(event);
  }
  const pathExclusionCounts = {};
  const observations = [];
  for (const row of cohort.rows) {
    if (!candidateIds.has(row.forecast.id)) continue;
    const validPaths = [];
    for (const event of pathsByForecast.get(row.forecast.id) ?? []) {
      const reason = event.type === "geckoterminal-new-pool-fast-path"
        ? supplementalPathRejectionReason(
          event,
          row.forecast,
          supplementalPathRegistration,
          providerIntegrityRule,
          supplementalPathRule,
          supplementalObservationMode,
          supplementalRejectionPrefix,
        )
        : birthPathRejectionReason(
          event,
          row.forecast,
          pathRegistration,
          providerIntegrityRule,
        );
      if (reason) increment(pathExclusionCounts, reason);
      else validPaths.push(event);
    }
    const validCadenceEvidence = [];
    for (const event of cadenceEvidenceByForecast.get(row.forecast.id) ?? []) {
      const reason = providerDiagnosticRejectionReason({
        diagnostic: event,
        forecast: row.forecast,
        registration: cadenceEvidenceRegistration,
        sourcePathRegistration: supplementalPathRegistration,
      });
      if (reason) increment(pathExclusionCounts, `cadence-${reason}`);
      else if (event.status === "price-disagreement"
        || event.status === "liquidity-disagreement") {
        validCadenceEvidence.push(event);
      }
    }
    validPaths.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    validCadenceEvidence.sort((left, right) => (
      Date.parse(left.observedAt) - Date.parse(right.observedAt)
        || left.id.localeCompare(right.id)
    ));
    const selectedExit = exitSelector(validPaths, rule);
    const coverageRejection = coverageReason(
      validPaths,
      row.forecast,
      rule,
      selectedExit,
      validCadenceEvidence,
    );
    if (coverageRejection) {
      increment(pathExclusionCounts, coverageRejection);
      continue;
    }
    const policyGrossReturnPct = selectedExit?.grossReturnFromEntryPct ?? row.grossReturnPct;
    const policyExitLiquidityUsd = selectedExit?.observedLiquidityUsd
      ?? row.resolution.exitLiquidityUsd;
    const policyBaseReturnPct = selectedExit
      ? capacityReturn(policyGrossReturnPct, row.forecast.entryLiquidityUsd,
        policyExitLiquidityUsd, rule.baseRoundTripCostPct, rule)
      : row.baseCapacityReturnPct;
    const policyStressReturnPct = selectedExit
      ? capacityReturn(policyGrossReturnPct, row.forecast.entryLiquidityUsd,
        policyExitLiquidityUsd, rule.stressRoundTripCostPct, rule)
      : row.stressCapacityReturnPct;
    if (![row.baseCapacityReturnPct, row.stressCapacityReturnPct,
      policyBaseReturnPct, policyStressReturnPct].every(Number.isFinite)) {
      increment(pathExclusionCounts, "unscorable-capacity-return");
      continue;
    }
    observations.push({
      forecastId: row.forecast.id,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      dueAt: row.forecast.dueAt,
      validPathMarks: validPaths.length,
      validCadenceAttempts: validCadenceEvidence.length,
      terminalLiquidityCollapse: validPaths.at(-1)?.status === "liquidity-collapse",
      exitSource: selectedExit
        ? exitSource(selectedExit, rule) : "fixed-one-hour-outcome",
      exitObservedAt: selectedExit?.observedAt ?? row.resolution.observedAt,
      exitGrossReturnPct: policyGrossReturnPct,
      exactOneHourGrossReturnPct: row.grossReturnPct,
      parentBaseReturnPct: row.baseCapacityReturnPct,
      parentStressReturnPct: row.stressCapacityReturnPct,
      policyBaseReturnPct,
      policyStressReturnPct,
      pairedDeltaPct: round6(policyBaseReturnPct - row.baseCapacityReturnPct),
    });
  }
  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const frameRows = frames.map((frame) => ({
    parentBaseReturnPct: mean(frame.map((row) => row.parentBaseReturnPct)),
    parentStressReturnPct: mean(frame.map((row) => row.parentStressReturnPct)),
    policyBaseReturnPct: mean(frame.map((row) => row.policyBaseReturnPct)),
    policyStressReturnPct: mean(frame.map((row) => row.policyStressReturnPct)),
    pairedDeltaPct: mean(frame.map((row) => row.pairedDeltaPct)),
  }));
  const policyReturns = frameRows.map((row) => row.policyBaseReturnPct);
  const stressReturns = frameRows.map((row) => row.policyStressReturnPct);
  const pairedDeltas = frameRows.map((row) => row.pairedDeltaPct);
  const takeProfits = weighted.filter((row) => row.exitSource === "live-path-take-profit");
  const stopLosses = weighted.filter((row) => row.exitSource === "live-path-stop-loss");
  const uniqueTokens = new Set(weighted.map(tokenEdgeAssetKey)).size;
  const evidenceReady = Boolean(
    registration
      && sourceRegistration
      && pathRegistration
      && (!supplementalPathRegistrationFactory || supplementalPathRegistration)
      && (!cadenceEvidenceRegistrationFactory || cadenceEvidenceRegistration)
      && weighted.length >= rule.minimumMaturedForecasts
      && frames.length >= rule.minimumIndependentFrames
      && uniqueTokens >= rule.minimumUniqueTradedTokens
      && frames.length >= rule.minimumIndependentTradedFrames
      && takeProfits.length >= rule.minimumTakeProfitExits
      && stopLosses.length >= (rule.minimumStopLossExits ?? 0)
  );
  const deltaCi95 = frames.length >= 2
    ? bootstrapMeanInterval(pairedDeltas, rule.bootstrapIterations) : [null, null];
  const profitFactorValue = profitFactor(policyReturns);
  const drawdown = maxDrawdownPct(policyReturns);
  const concentration = largestWinningShare(policyReturns);
  const provisionalGate = Boolean(
    evidenceReady
      && mean(policyReturns) > 0
      && mean(stressReturns) > 0
      && deltaCi95[0] > 0
      && profitFactorValue >= rule.minimumProfitFactor
      && drawdown <= rule.maximumDrawdownPct
      && concentration <= rule.maximumLargestWinningFrameShare
  );
  const openIds = new Set(candidateForecasts.map((forecast) => forecast.id));
  for (const row of cohort.rows) openIds.delete(row.forecast.id);
  return {
    type,
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    sourceRegistrationId: sourceRegistration?.id ?? null,
    pathRegistrationId: pathRegistration?.id ?? null,
    supplementalPathRegistrationId: supplementalPathRegistration?.id ?? null,
    cadenceEvidenceRegistrationId: cadenceEvidenceRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: candidateForecasts.length,
    openForecasts: openIds.size,
    eligibleCompletePathObservations: observations.length,
    portfolioWeightedObservations: weighted.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    independentTradedFrames: frames.length,
    uniqueTradedTokens: uniqueTokens,
    takeProfitExits: takeProfits.length,
    stopLossExits: stopLosses.length,
    fixedHorizonExits: weighted.length - takeProfits.length - stopLosses.length,
    sourceCohortRejectionCounts: cohort.rejectionCounts,
    pathExclusionCounts,
    parentFrameMeanNetReturnPct: nullableRound(mean(
      frameRows.map((row) => row.parentBaseReturnPct),
    )),
    stressedParentFrameMeanNetReturnPct: nullableRound(mean(
      frameRows.map((row) => row.parentStressReturnPct),
    )),
    policyFrameMeanNetReturnPct: nullableRound(mean(policyReturns)),
    stressedPolicyFrameMeanNetReturnPct: nullableRound(mean(stressReturns)),
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: deltaCi95.map(nullableRound),
    profitFactor: nullableRound(profitFactorValue),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(concentration),
    evidenceStatus: evidenceReady ? "audit-ready" : "collecting",
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weighted.length),
      independentFrames: Math.max(0, rule.minimumIndependentFrames - frames.length),
      uniqueTradedTokens: Math.max(0, rule.minimumUniqueTradedTokens - uniqueTokens),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - frames.length,
      ),
      takeProfitExits: Math.max(0, rule.minimumTakeProfitExits - takeProfits.length),
      stopLossExits: Math.max(0, (rule.minimumStopLossExits ?? 0) - stopLosses.length),
    },
    provisionalGate,
    observationsDetail: weighted,
    note,
  };
}

function supplementalPathRejectionReason(
  event,
  forecast,
  pathRegistration,
  providerIntegrityRule,
  pathRule,
  observationMode,
  rejectionPrefix,
) {
  if (!pathRegistration) return `missing-${rejectionPrefix}-registration`;
  if (event.fastPathRuleVersion !== pathRule.version
    || event.fastPathRegistrationId !== pathRegistration.id
    || event.fastPathRegisteredAt !== pathRegistration.registeredAt
    || event.sourceRuleVersion !== forecast.ruleVersion
    || event.sourceRegistrationId !== forecast.registrationId
    || event.forecastId !== forecast.id
    || event.discoveryEventId !== forecast.discoveryEventId
    || event.chain !== forecast.chain
    || event.tokenAddress !== forecast.tokenAddress
    || event.symbol !== forecast.symbol
    || event.pairAddress !== forecast.pairAddress
    || event.signalCreatedAt !== forecast.createdAt
    || event.dueAt !== forecast.dueAt
    || event.entryPriceUsd !== forecast.entryPriceUsd
    || event.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || event.observationMode !== observationMode
    || event.researchOnly !== true
    || event.mutationAllowed !== false) return `${rejectionPrefix}-lineage-mismatch`;
  const observedAt = Date.parse(event.observedAt);
  const bucketAt = Date.parse(event.bucketStartedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(bucketAt)
    || observedAt <= Date.parse(pathRegistration.registeredAt)
    || observedAt < Date.parse(forecast.createdAt)
    || observedAt > Date.parse(forecast.dueAt)
    || bucketAt > observedAt
    || observedAt - bucketAt >= 60_000
    || (Number.isInteger(pathRule.requiredUtcMinuteModuloFive)
      && new Date(bucketAt).getUTCMinutes() % 5
        !== pathRule.requiredUtcMinuteModuloFive)) {
    return `invalid-${rejectionPrefix}-timing`;
  }
  if (event.status === "liquidity-collapse") {
    return event.grossReturnFromEntryPct === -100
      && event.observedLiquidityUsd === 0
      && validGeckoLiquidityCollapseIntegrity(
        event.providerPriceIntegrity,
        event.observedPriceUsd,
        event.observedLiquidityUsd,
      ) ? null : `invalid-${rejectionPrefix}-liquidity-collapse`;
  }
  if (event.status !== "observed"
    || !(event.observedPriceUsd > 0)
    || !(event.observedLiquidityUsd > 0)
    || !validGeckoDexDirectIntegrity(
      event.providerPriceIntegrity,
      event.observedPriceUsd,
      event.observedLiquidityUsd,
      providerIntegrityRule,
    )) return `invalid-${rejectionPrefix}-provider-integrity`;
  const expectedReturn = round6(((event.observedPriceUsd / forecast.entryPriceUsd) - 1) * 100);
  return event.grossReturnFromEntryPct === expectedReturn
    ? null : `${rejectionPrefix}-return-mismatch`;
}

function birthPathRejectionReason(event, forecast, pathRegistration, providerIntegrityRule) {
  if (!pathRegistration) return "missing-path-registration";
  if (event.pathRuleVersion !== GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE.version
    || event.pathRegistrationId !== pathRegistration.id
    || event.pathRegisteredAt !== pathRegistration.registeredAt
    || event.sourceRuleVersion !== forecast.ruleVersion
    || event.sourceRegistrationId !== forecast.registrationId
    || event.sourceForecastPreRegistration !== false
    || event.forecastId !== forecast.id
    || event.discoveryEventId !== forecast.discoveryEventId
    || event.chain !== forecast.chain
    || event.tokenAddress !== forecast.tokenAddress
    || event.symbol !== forecast.symbol
    || event.pairAddress !== forecast.pairAddress
    || event.signalCreatedAt !== forecast.createdAt
    || event.dueAt !== forecast.dueAt
    || event.entryPriceUsd !== forecast.entryPriceUsd
    || event.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || event.observationMode !== "live-point-in-time-path"
    || event.researchOnly !== true
    || event.mutationAllowed !== false) return "path-lineage-mismatch";
  const observedAt = Date.parse(event.observedAt);
  const bucketAt = Date.parse(event.bucketStartedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(bucketAt)
    || observedAt <= Date.parse(pathRegistration.registeredAt)
    || observedAt < Date.parse(forecast.createdAt)
    || observedAt > Date.parse(forecast.dueAt) + 5 * 60_000
    || bucketAt > observedAt
    || observedAt - bucketAt >= PATH_CADENCE_MS) return "invalid-path-timing";
  if (event.status === "liquidity-collapse") {
    return event.grossReturnFromEntryPct === -100
      && event.observedLiquidityUsd === 0
      && validGeckoLiquidityCollapseIntegrity(
        event.providerPriceIntegrity,
        event.observedPriceUsd,
        event.observedLiquidityUsd,
      ) ? null : "invalid-path-liquidity-collapse";
  }
  if (event.status !== "observed"
    || !(event.observedPriceUsd > 0)
    || !(event.observedLiquidityUsd > 0)
    || !validGeckoDexDirectIntegrity(
      event.providerPriceIntegrity,
      event.observedPriceUsd,
      event.observedLiquidityUsd,
      providerIntegrityRule,
    )) return "invalid-path-provider-integrity";
  const expectedReturn = round6(((event.observedPriceUsd / forecast.entryPriceUsd) - 1) * 100);
  return event.grossReturnFromEntryPct === expectedReturn ? null : "path-return-mismatch";
}

function firstTakeProfitExit(paths, rule) {
  return paths.find((event) => (
    event.status === "observed"
      && event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
  ));
}

function birthPathCoverageReason(paths, forecast, rule) {
  if (!paths.length) return "missing-path";
  const buckets = paths.map((event) => Date.parse(event.bucketStartedAt));
  if (new Set(buckets).size !== buckets.length) return "duplicate-path-bucket";
  const collapseIndex = paths.findIndex((event) => event.status === "liquidity-collapse");
  if (collapseIndex >= 0 && collapseIndex !== paths.length - 1) {
    return "nonterminal-liquidity-collapse";
  }
  if (Date.parse(paths[0].observedAt) - Date.parse(forecast.createdAt)
    > rule.maximumPathGapMs) return "path-start-gap";
  for (let index = 1; index < buckets.length; index += 1) {
    if (buckets[index] - buckets[index - 1] > rule.maximumPathGapMs) {
      return "path-cadence-gap";
    }
  }
  if (collapseIndex >= 0) return null;
  if (paths.length < rule.minimumPathMarks) return "insufficient-path-marks";
  if (Date.parse(forecast.dueAt) - Date.parse(paths.at(-1).observedAt)
    > rule.maximumPathGapMs) return "path-end-gap";
  return null;
}

function birthPrefixPathCoverageReason(paths, forecast, rule, takeProfit) {
  if (!takeProfit) return birthPathCoverageReason(paths, forecast, rule);
  const takeProfitIndex = paths.indexOf(takeProfit);
  if (takeProfitIndex < 0) return "take-profit-path-missing";
  const prefix = paths.slice(0, takeProfitIndex + 1);
  const buckets = prefix.map((event) => Date.parse(event.bucketStartedAt));
  if (new Set(buckets).size !== buckets.length) return "duplicate-pre-exit-path-bucket";
  if (prefix.some((event) => event.status === "liquidity-collapse")) {
    return "liquidity-collapse-before-take-profit";
  }
  if (Date.parse(prefix[0].observedAt) - Date.parse(forecast.createdAt)
    > rule.maximumPathGapMs) return "pre-exit-path-start-gap";
  for (let index = 1; index < buckets.length; index += 1) {
    if (buckets[index] - buckets[index - 1] > rule.maximumPathGapMs) {
      return "pre-exit-path-cadence-gap";
    }
  }
  return null;
}

function birthAttemptCoveredPrefixPathCoverageReason(
  paths,
  forecast,
  rule,
  selectedExit,
  cadenceEvidence = [],
) {
  if (!selectedExit) return birthPathCoverageReason(paths, forecast, rule);
  const exitAt = Date.parse(selectedExit.observedAt);
  const executableBuckets = new Set(paths.map((event) => event.bucketStartedAt));
  const prefixEvidence = cadenceEvidence.filter((event) => (
    Date.parse(event.observedAt) <= exitAt
      && !executableBuckets.has(event.bucketStartedAt)
  ));
  const coveredPrefix = [...paths, ...prefixEvidence].sort((left, right) => (
    Date.parse(left.observedAt) - Date.parse(right.observedAt)
      || left.id.localeCompare(right.id)
  ));
  return birthPrefixPathCoverageReason(coveredPrefix, forecast, rule, selectedExit);
}

function capacityReturn(grossReturnPct, entryLiquidityUsd, exitLiquidityUsd, cost, rule) {
  return capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd,
    exitLiquidityUsd,
    paperNotionalUsd: rule.paperNotionalUsd,
    roundTripCostPct: cost,
  });
}

function matchesTakeProfitRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthTakeProfitRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesPrefixTakeProfitRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthPrefixTakeProfitRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBracketRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthBracketRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesAttemptCoveredBracketRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthAttemptCoveredBracketRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesStandardBracketRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthStandardBracketRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastBracketRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthFastBracketRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesStandardMidBracketRegistration(event) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthStandardMidBracketRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesExpectedRegistration(event, creator) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = creator(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function bootstrapMeanInterval(values, iterations) {
  if (!values.length) return [null, null];
  let state = 0x9e3779b9;
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      total += values[(state >>> 0) % values.length];
    }
    samples.push(total / values.length);
  }
  samples.sort((left, right) => left - right);
  return [samples[Math.floor(iterations * 0.025)], samples[Math.floor(iterations * 0.975)]];
}

function profitFactor(values) {
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0)
    .reduce((sum, value) => sum + value, 0));
  if (losses === 0) return gains > 0 ? 999 : 0;
  return gains / losses;
}

function maxDrawdownPct(values) {
  let equity = 100;
  let peak = equity;
  let maximum = 0;
  for (const value of values) {
    equity *= 1 + (value / 100);
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? ((peak - equity) / peak) * 100 : 100);
  }
  return maximum;
}

function largestWinningShare(values) {
  const wins = values.filter((value) => value > 0);
  const total = wins.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...wins) / total : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function nullableRound(value) {
  return Number.isFinite(value) ? round6(value) : null;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date.toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "register-prefix", "register-bracket", "register-standard-bracket",
    "register-fast-bracket", "register-standard-mid-bracket",
    "register-attempt-covered-bracket", "score", "score-prefix",
    "score-bracket", "score-fast-bracket", "score-standard-bracket",
    "score-standard-mid-bracket", "score-attempt-covered-bracket"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-geckoterminal-new-pool-birth-take-profit.mjs register|register-prefix|register-bracket|register-fast-bracket|register-standard-bracket|register-standard-mid-bracket|register-attempt-covered-bracket|score|score-prefix|score-bracket|score-fast-bracket|score-standard-bracket|score-standard-mid-bracket|score-attempt-covered-bracket [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthTakeProfit(options), null, 2,
      ));
    } else if (options.command === "register-prefix") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthPrefixTakeProfit(options), null, 2,
      ));
    } else if (options.command === "register-bracket") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthBracket(options), null, 2,
      ));
    } else if (options.command === "register-standard-bracket") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthStandardBracket(options), null, 2,
      ));
    } else if (options.command === "register-fast-bracket") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthFastBracket(options), null, 2,
      ));
    } else if (options.command === "register-standard-mid-bracket") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthStandardMidBracket(options), null, 2,
      ));
    } else if (options.command === "register-attempt-covered-bracket") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthAttemptCoveredBracket(options), null, 2,
      ));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-prefix"
          ? buildGeckoTerminalNewPoolBirthPrefixTakeProfitScorecard(events)
          : (options.command === "score-bracket"
            ? buildGeckoTerminalNewPoolBirthBracketScorecard(events)
            : (options.command === "score-fast-bracket"
              ? buildGeckoTerminalNewPoolBirthFastBracketScorecard(events)
              : (options.command === "score-standard-bracket"
                ? buildGeckoTerminalNewPoolBirthStandardBracketScorecard(events)
                : (options.command === "score-standard-mid-bracket"
                  ? buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard(events)
                  : (options.command === "score-attempt-covered-bracket"
                    ? buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard(events)
                    : buildGeckoTerminalNewPoolBirthTakeProfitScorecard(events)))))),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
