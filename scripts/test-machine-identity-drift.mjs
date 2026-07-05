#!/usr/bin/env node
// Hermetic: a company's homeMachineKey gate must survive macOS Bonjour `.local`
// name drift. The SAME Mac re-announces as `Name-<digits>.local` with a rotating
// numeric suffix after reboots/DHCP churn; the old exact-normalized compare then
// read it as a different machine and stranded every vault company homed on the
// old name (WEBS, 2026-07-04: pinned to `Liams-MacBook-Pro-20942.local`, box now
// `…-21403.local` — autonomy driver silently dispatched nothing for 25h+).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  sameMachineIdentity,
  machineIdentityStem,
  normalizeMachineName,
  machineExactIdentity,
  tailnetSelfIdentityCandidates,
} = await import("../src/features/fleet/fleet-identity.ts");

// ── the exact drift that stranded WEBS: same Mac, rotated .local suffix ──────
assert.equal(
  sameMachineIdentity("Liams-MacBook-Pro-20942.local", "Liams-MacBook-Pro-21403.local"),
  true,
  "rotated `.local` numeric suffix on the same Mac still matches",
);
assert.equal(
  sameMachineIdentity("Liams-MacBook-Pro-20942.local", "Liams-MacBook-Pro.local"),
  true,
  "suffixed and bare `.local` forms of the same Mac match",
);

// ── exact / normalized equality still holds (unchanged behaviour) ───────────
assert.equal(sameMachineIdentity("hel1-2", "hel1-2"), true);
assert.equal(sameMachineIdentity("Liams-MacBook-Pro-21403.local", "liamsmacbookpro21403local"), true, "normalization is punctuation/case-insensitive");

// ── genuinely different machines must NOT collapse ──────────────────────────
assert.equal(sameMachineIdentity("hel1-2", "hel1-3"), false, "distinct non-.local Linux boxes stay distinct (no blanket digit strip)");
assert.equal(sameMachineIdentity("Liams-MacBook-Pro-20942.local", "Liams-Mac-mini-1.local"), false, "different base names never merge");
assert.equal(sameMachineIdentity("nyc-mac.local", "hel1-2"), false);

// ── stem is stable across drift; leaves non-.local hosts intact ─────────────
assert.equal(machineIdentityStem("Liams-MacBook-Pro-20942.local"), "liamsmacbookpro");
assert.equal(machineIdentityStem("Liams-MacBook-Pro-21403.local"), "liamsmacbookpro");
assert.equal(machineIdentityStem("Liams-MacBook-Pro.local"), "liamsmacbookpro");
assert.equal(machineIdentityStem("hel1-2"), "hel12", "no `.local` → not stem-stripped");
assert.equal(machineIdentityStem("hel1-3"), "hel13");

// ── empty / nullish inputs never spuriously match ───────────────────────────
assert.equal(sameMachineIdentity("", "Liams-MacBook-Pro-21403.local"), false);
assert.equal(sameMachineIdentity(null, null), false, "two unset keys are not 'the same machine'");
assert.equal(sameMachineIdentity(undefined, ""), false);
assert.equal(normalizeMachineName(undefined), "");

// ── tailnetSelf candidates fold a rename-orphaned system node ────────────────
// NYC 2026-07-03: macOS mDNS-conflict rename rotated the linkd tsnet node to
// `hivemindos-liamsmbp481146-lan` while the system node kept its sticky
// `liams-macbook-pro-1` MagicDNS name. The collector self-reports the system
// node; its candidates must hit the ghost device's exact identity so
// discovery folds the pair back into one machine.
// Real /health value from the NYC box: tailscaled's HostName is the macOS
// ComputerName, which BOTH MacBooks share — identity must come from dnsName
// only, or NYC's collector would claim This Mac's system node too.
const nycTailnetSelf = {
  name: "Liam’s MacBook Pro",
  dnsName: "liams-macbook-pro-1.tail629894.ts.net",
};
const ghostIdentity = machineExactIdentity(
  "Liam's MacBook Pro",
  "liams-macbook-pro-1.tail629894.ts.net",
);
assert.ok(ghostIdentity, "ghost system node has a non-empty exact identity");
assert.ok(
  tailnetSelfIdentityCandidates(nycTailnetSelf).includes(ghostIdentity),
  "self-reported system node claims the ghost device's identity",
);
// The renamed collector device itself is NOT claimed via tailnetSelf — its
// own deviceIdentityKey covers it; candidates must not invent extra keys.
assert.ok(
  !tailnetSelfIdentityCandidates(nycTailnetSelf).includes(
    machineExactIdentity("x", "hivemindos-liamsmbp481146-lan.tail629894.ts.net"),
  ),
  "candidates stay scoped to the self-declared system node",
);
// The OTHER MacBook shares the ComputerName; its system node's identity must
// NEVER be claimed — candidates come from the unique dnsName only.
assert.ok(
  !tailnetSelfIdentityCandidates(nycTailnetSelf).includes(
    machineExactIdentity("Liam's MacBook Pro", "liams-macbook-pro.tail629894.ts.net"),
  ),
  "the OTHER MacBook sharing the ComputerName stays distinct",
);
assert.deepEqual(
  tailnetSelfIdentityCandidates({ name: "Liam’s MacBook Pro" }),
  [],
  "a name-only tailnetSelf (no dnsName) claims nothing",
);
assert.deepEqual(tailnetSelfIdentityCandidates(null), []);
assert.deepEqual(tailnetSelfIdentityCandidates(undefined), []);
assert.deepEqual(tailnetSelfIdentityCandidates({}), []);

console.log("machine-identity-drift: all assertions passed");
