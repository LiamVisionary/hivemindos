import assert from "node:assert/strict";
import {
  decodeFunctionData,
  getAddress,
  parseAbi,
  parseEther,
} from "viem";

import {
  HIVE_MAINNET_CHAINS,
  HIVE_MAINNET_DEPLOYMENT,
  buildCanaryActivationOperation,
  buildConfigurationOperation,
  buildGovernancePackage,
  buildSafeSubmission,
  decodeUlnConfig,
  makePrevalidatedSafeSignature,
} from "./hive-mainnet-governance.mjs";
import { renderGovernanceQueuePage } from "./hive-mainnet-governance-queue.mjs";

const OAPP_ABI = parseAbi([
  "function setPeer(uint32 eid, bytes32 peer)",
  "function setEnforcedOptions((uint32 eid,uint16 msgType,bytes options)[] params)",
  "function setPauser(address pauser)",
  "function setUnpauser(address unpauser)",
  "function setDefaultFeeBps(uint16 feeBps)",
  "function setRateLimits((uint32 dstEid,uint192 limit,uint64 window)[] configs)",
]);
const ENDPOINT_ABI = parseAbi([
  "function setConfig(address oapp,address lib,(uint32 eid,uint32 configType,bytes config)[] params)",
]);
const TIMELOCK_ABI = parseAbi([
  "function scheduleBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt,uint256 delay)",
]);
const SAFE_ABI = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes signatures) returns (bool success)",
]);

for (const chainKey of ["base", "robinhood"]) {
  const chain = HIVE_MAINNET_CHAINS[chainKey];
  const configuration = buildConfigurationOperation(chainKey);
  assert.equal(configuration.targets.length, 7);
  assert.equal(configuration.payloads.length, 7);
  assert.ok(configuration.values.every((value) => value === 0n));

  const peerCall = decodeFunctionData({ abi: OAPP_ABI, data: configuration.payloads[0] });
  assert.equal(peerCall.functionName, "setPeer");
  assert.equal(peerCall.args[0], chain.remoteEid);
  assert.equal(
    peerCall.args[1],
    `0x${"00".repeat(12)}${HIVE_MAINNET_DEPLOYMENT.oapp.slice(2).toLowerCase()}`,
  );

  const optionsCall = decodeFunctionData({ abi: OAPP_ABI, data: configuration.payloads[1] });
  assert.equal(optionsCall.functionName, "setEnforcedOptions");
  assert.deepEqual(optionsCall.args[0][0], {
    eid: chain.remoteEid,
    msgType: 1,
    options: "0x00030100110100000000000000000000000000027100",
  });

  const pauserCall = decodeFunctionData({ abi: OAPP_ABI, data: configuration.payloads[2] });
  assert.equal(pauserCall.args[0], HIVE_MAINNET_DEPLOYMENT.owner);
  const unpauserCall = decodeFunctionData({ abi: OAPP_ABI, data: configuration.payloads[3] });
  assert.equal(unpauserCall.args[0], HIVE_MAINNET_DEPLOYMENT.safe);
  const feeCall = decodeFunctionData({ abi: OAPP_ABI, data: configuration.payloads[4] });
  assert.equal(feeCall.args[0], 5);

  const sendConfigCall = decodeFunctionData({ abi: ENDPOINT_ABI, data: configuration.payloads[5] });
  const receiveConfigCall = decodeFunctionData({ abi: ENDPOINT_ABI, data: configuration.payloads[6] });
  assert.equal(sendConfigCall.args[0], HIVE_MAINNET_DEPLOYMENT.oapp);
  assert.equal(sendConfigCall.args[1], chain.sendLibrary);
  assert.equal(receiveConfigCall.args[1], chain.receiveLibrary);
  assert.equal(sendConfigCall.args[2][0].eid, chain.remoteEid);
  assert.equal(receiveConfigCall.args[2][0].eid, chain.remoteEid);
  assert.equal(sendConfigCall.args[2][0].configType, 2);
  assert.equal(receiveConfigCall.args[2][0].configType, 2);

  const sendUln = decodeUlnConfig(sendConfigCall.args[2][0].config);
  const receiveUln = decodeUlnConfig(receiveConfigCall.args[2][0].config);
  assert.equal(sendUln.confirmations, chain.sendConfirmations);
  assert.equal(receiveUln.confirmations, chain.receiveConfirmations);
  assert.equal(sendUln.requiredDVNCount, 2);
  assert.equal(receiveUln.requiredDVNCount, 2);
  assert.deepEqual(sendUln.requiredDVNs, chain.requiredDvns);
  assert.deepEqual(receiveUln.requiredDVNs, chain.requiredDvns);
  assert.deepEqual(sendUln.optionalDVNs, []);
  assert.deepEqual(receiveUln.optionalDVNs, []);

  const scheduleCall = decodeFunctionData({ abi: TIMELOCK_ABI, data: configuration.scheduleCalldata });
  assert.equal(scheduleCall.functionName, "scheduleBatch");
  assert.deepEqual(scheduleCall.args[0], configuration.targets);
  assert.deepEqual(scheduleCall.args[1], configuration.values);
  assert.deepEqual(
    scheduleCall.args[2].map((payload) => payload.toLowerCase()),
    configuration.payloads.map((payload) => payload.toLowerCase()),
  );
  assert.equal(scheduleCall.args[5], 259_200n);

  const activation = buildCanaryActivationOperation(chainKey);
  assert.notEqual(configuration.operationId, activation.operationId);
  const rateCall = decodeFunctionData({ abi: OAPP_ABI, data: activation.payloads[0] });
  assert.equal(rateCall.functionName, "setRateLimits");
  assert.equal(rateCall.args[0].length, 4);
  assert.deepEqual(
    rateCall.args[0].map((config) => config.limit),
    [parseEther("10"), parseEther("25"), parseEther("10"), parseEther("25")],
  );
  assert.deepEqual(
    rateCall.args[0].map((config) => config.window),
    [3_600n, 86_400n, 3_600n, 86_400n],
  );

  const safeSubmission = buildSafeSubmission(configuration);
  const safeCall = decodeFunctionData({ abi: SAFE_ABI, data: safeSubmission.data });
  assert.equal(safeCall.functionName, "execTransaction");
  assert.equal(safeCall.args[0], HIVE_MAINNET_DEPLOYMENT.timelock);
  assert.equal(safeCall.args[1], 0n);
  assert.equal(safeCall.args[2].toLowerCase(), configuration.scheduleCalldata.toLowerCase());
  assert.equal(safeCall.args[3], 0);
  assert.equal(safeCall.args[9].toLowerCase(), makePrevalidatedSafeSignature().toLowerCase());
  assert.equal(safeSubmission.to, HIVE_MAINNET_DEPLOYMENT.safe);
  assert.equal(safeSubmission.from, HIVE_MAINNET_DEPLOYMENT.owner);

  const governancePackage = buildGovernancePackage(chainKey);
  assert.equal(governancePackage.chain.id, chain.chainId);
  assert.equal(governancePackage.transactions.length, 2);
  assert.equal(getAddress(governancePackage.requiredOwner), HIVE_MAINNET_DEPLOYMENT.owner);
}

assert.throws(() => buildGovernancePackage("ethereum"), /Unknown chain/);
const cancellationPage = renderGovernanceQueuePage();
const cancellationScript = cancellationPage.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
assert.doesNotThrow(() => new Function(cancellationScript));
assert.match(cancellationPage, /id="cancel-base"/);
assert.match(cancellationPage, /id="cancel-robinhood"/);
assert.match(cancellationPage, /data: "0xc4d252f5" \+ transaction\.operationId\.slice\(2\)/);
assert.doesNotMatch(cancellationPage, /id="queue-base"/);
console.log("HIVE mainnet governance payload tests passed (2 chains, config + canary activation)");
