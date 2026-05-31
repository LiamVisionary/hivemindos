const MICRO = 1_000_000;
const SWAP_FEE_BPS = 120;
const CREATOR_SHARE_BPS = 5700;
const HONEY_POOL_SHARE_BPS = 500;
const POOL_SHARE_OF_VOLUME = (SWAP_FEE_BPS / 10_000) * (CREATOR_SHARE_BPS / 10_000) * (HONEY_POOL_SHARE_BPS / 10_000);

function poolUsdForVolume(volumeUsd) {
  return volumeUsd * POOL_SHARE_OF_VOLUME;
}

function poolHiveForVolume(volumeUsd, hiveUsd) {
  return poolUsdForVolume(volumeUsd) / hiveUsd;
}

function emitHoney({ poolHive, hivePerMillionTokens, usageEvents }) {
  let emittedMicro = 0;
  const poolMicro = Math.round(poolHive * MICRO);
  for (const tokens of usageEvents) {
    const target = Math.floor((tokens * hivePerMillionTokens * MICRO) / 1_000_000);
    const remaining = Math.max(0, poolMicro - emittedMicro);
    emittedMicro += Math.min(target, remaining);
    if (emittedMicro > poolMicro) {
      throw new Error(`emitted ${emittedMicro} exceeded pool ${poolMicro}`);
    }
  }
  return emittedMicro / MICRO;
}

function randomUsageEvents(count, maxTokens) {
  return Array.from({ length: count }, () => 1 + Math.floor(Math.random() * maxTokens));
}

const deterministic = [
  { name: "Aeon-like, 5x volume multiple", volumeUsd: 48_150_000, hiveUsd: 0.01, events: [18_420, 80_000, 1_250_000], rate: 1 },
  { name: "Tiny launch, expensive HIVE", volumeUsd: 100_000, hiveUsd: 0.25, events: [100_000, 500_000, 3_000_000], rate: 1 },
  { name: "Over-demand clips at pool", volumeUsd: 10_000, hiveUsd: 0.01, events: [100_000_000, 100_000_000], rate: 10 },
];

for (const scenario of deterministic) {
  const poolUsd = poolUsdForVolume(scenario.volumeUsd);
  const poolHive = poolHiveForVolume(scenario.volumeUsd, scenario.hiveUsd);
  const emittedHive = emitHoney({ poolHive, hivePerMillionTokens: scenario.rate, usageEvents: scenario.events });
  console.log(`${scenario.name}: pool=$${poolUsd.toFixed(2)} (${poolHive.toFixed(6)} HIVE), emitted=${emittedHive.toFixed(6)} HIVE`);
}

for (let index = 0; index < 10_000; index += 1) {
  const volumeUsd = 1_000 + Math.random() * 100_000_000;
  const hiveUsd = 0.001 + Math.random() * 0.999;
  const rate = 0.0001 + Math.random() * 100;
  const poolHive = poolHiveForVolume(volumeUsd, hiveUsd);
  const events = randomUsageEvents(1 + Math.floor(Math.random() * 200), 10_000_000);
  const emittedHive = emitHoney({ poolHive, hivePerMillionTokens: rate, usageEvents: events });
  if (emittedHive - poolHive > 0.000001) {
    throw new Error(`simulation failed: emitted ${emittedHive} > pool ${poolHive}`);
  }
}

console.log(`ok: 10,000 randomized simulations kept emitted Honey <= cumulative HIVE reward pool`);
console.log(`pool formula: ${SWAP_FEE_BPS / 100}% swap fee * ${CREATOR_SHARE_BPS / 100}% creator share * ${HONEY_POOL_SHARE_BPS / 100}% Honey allocation = ${(POOL_SHARE_OF_VOLUME * 100).toFixed(4)}% of volume`);
