#!/usr/bin/env node

import {
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  parseEther,
  toHex,
} from "viem";

export const HIVE_MAINNET_DEPLOYMENT = Object.freeze({
  safe: getAddress("0xBeB2245F15ff9F596aB673C26dEc525e7aF44cfB"),
  timelock: getAddress("0x6C41ac629EC899dA4bfBB4C8A5022b3A165fca7e"),
  oapp: getAddress("0xA131dB107711D5DC6743DFF002eACdDCA1f0946d"),
  owner: getAddress("0x08D73e591c2D3f4EB7E243A2212682e376CA913e"),
  timelockDelaySeconds: 259_200n,
  feeBps: 5,
  lzReceiveGas: 160_000n,
  canaryHourlyLimit: parseEther("10"),
  canaryDailyLimit: parseEther("25"),
});

export const HIVE_MAINNET_CHAINS = Object.freeze({
  base: Object.freeze({
    name: "Base",
    chainId: 8453,
    remoteEid: 30_416,
    endpoint: getAddress("0x1a44076050125825900e736c501f859c50fE728c"),
    sendLibrary: getAddress("0xB5320B0B3a13cC860893E2Bd79FCd7e13484Dda2"),
    receiveLibrary: getAddress("0xc70AB6f32772f59fBfc23889Caf4Ba3376C84bAf"),
    sendConfirmations: 30n,
    receiveConfirmations: 1_800n,
    requiredDvns: Object.freeze([
      getAddress("0x9e059a54699a285714207b43B055483E78FAac25"),
      getAddress("0xcd37CA043f8479064e10635020c65FfC005d36f6"),
    ]),
  }),
  robinhood: Object.freeze({
    name: "Robinhood Chain",
    chainId: 4663,
    remoteEid: 30_184,
    endpoint: getAddress("0x6F475642a6e85809B1c36Fa62763669b1b48DD5B"),
    sendLibrary: getAddress("0xC39161c743D0307EB9BCc9FEF03eeb9Dc4802de7"),
    receiveLibrary: getAddress("0xe1844c5D63a9543023008D332Bd3d2e6f1FE1043"),
    sendConfirmations: 1_800n,
    receiveConfirmations: 30n,
    requiredDvns: Object.freeze([
      getAddress("0x0Ffe02DF012299A370D5dd69298A5826EAcaFdF8"),
      getAddress("0xd01ae6905d48315f7bE10C7330aeCF8360Ef5b12"),
    ]),
  }),
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const CONFIG_TYPE_ULN = 2;
const MSG_TYPE_SEND = 1;
const OUTBOUND_LONG_FLAG = 0x40000000;
const INBOUND_FLAG = 0x80000000;

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
  "function executeBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt)",
]);

const SAFE_ABI = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes signatures) returns (bool success)",
]);

const ULN_CONFIG_PARAMETERS = parseAbiParameters(
  "(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)",
);

const TIMELOCK_OPERATION_PARAMETERS = parseAbiParameters(
  "address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt",
);

function requireKnownChain(chainKey) {
  const chain = HIVE_MAINNET_CHAINS[chainKey];
  if (!chain) {
    throw new Error(`Unknown chain '${chainKey}'. Use 'base' or 'robinhood'.`);
  }
  return chain;
}

function makeLzReceiveOptions(gas) {
  return concatHex([
    toHex(3, { size: 2 }),
    toHex(1, { size: 1 }),
    toHex(17, { size: 2 }),
    toHex(1, { size: 1 }),
    toHex(gas, { size: 16 }),
  ]);
}

function encodeUlnConfig(confirmations, requiredDvns) {
  return encodeAbiParameters(ULN_CONFIG_PARAMETERS, [
    {
      confirmations,
      requiredDVNCount: 2,
      optionalDVNCount: 0,
      optionalDVNThreshold: 0,
      requiredDVNs: [...requiredDvns],
      optionalDVNs: [],
    },
  ]);
}

function makeOperation({ chain, kind, targets, values, payloads, salt }) {
  const operationId = keccak256(
    encodeAbiParameters(TIMELOCK_OPERATION_PARAMETERS, [
      targets,
      values,
      payloads,
      ZERO_BYTES32,
      salt,
    ]),
  );
  const scheduleCalldata = encodeFunctionData({
    abi: TIMELOCK_ABI,
    functionName: "scheduleBatch",
    args: [
      targets,
      values,
      payloads,
      ZERO_BYTES32,
      salt,
      HIVE_MAINNET_DEPLOYMENT.timelockDelaySeconds,
    ],
  });
  const executeCalldata = encodeFunctionData({
    abi: TIMELOCK_ABI,
    functionName: "executeBatch",
    args: [targets, values, payloads, ZERO_BYTES32, salt],
  });

  return {
    kind,
    chain,
    targets,
    values,
    payloads,
    predecessor: ZERO_BYTES32,
    salt,
    operationId,
    delaySeconds: HIVE_MAINNET_DEPLOYMENT.timelockDelaySeconds,
    scheduleCalldata,
    executeCalldata,
  };
}

export function buildConfigurationOperation(chainKey) {
  const chain = requireKnownChain(chainKey);
  const deployment = HIVE_MAINNET_DEPLOYMENT;
  const lzReceiveOptions = makeLzReceiveOptions(deployment.lzReceiveGas);
  const peer = pad(deployment.oapp, { size: 32 });
  const sendUlnConfig = encodeUlnConfig(chain.sendConfirmations, chain.requiredDvns);
  const receiveUlnConfig = encodeUlnConfig(chain.receiveConfirmations, chain.requiredDvns);

  const targets = [
    deployment.oapp,
    deployment.oapp,
    deployment.oapp,
    deployment.oapp,
    deployment.oapp,
    chain.endpoint,
    chain.endpoint,
  ];
  const values = targets.map(() => 0n);
  const payloads = [
    encodeFunctionData({
      abi: OAPP_ABI,
      functionName: "setPeer",
      args: [chain.remoteEid, peer],
    }),
    encodeFunctionData({
      abi: OAPP_ABI,
      functionName: "setEnforcedOptions",
      args: [[{ eid: chain.remoteEid, msgType: MSG_TYPE_SEND, options: lzReceiveOptions }]],
    }),
    encodeFunctionData({
      abi: OAPP_ABI,
      functionName: "setPauser",
      args: [deployment.owner],
    }),
    encodeFunctionData({
      abi: OAPP_ABI,
      functionName: "setUnpauser",
      args: [deployment.safe],
    }),
    encodeFunctionData({
      abi: OAPP_ABI,
      functionName: "setDefaultFeeBps",
      args: [deployment.feeBps],
    }),
    encodeFunctionData({
      abi: ENDPOINT_ABI,
      functionName: "setConfig",
      args: [
        deployment.oapp,
        chain.sendLibrary,
        [{ eid: chain.remoteEid, configType: CONFIG_TYPE_ULN, config: sendUlnConfig }],
      ],
    }),
    encodeFunctionData({
      abi: ENDPOINT_ABI,
      functionName: "setConfig",
      args: [
        deployment.oapp,
        chain.receiveLibrary,
        [{ eid: chain.remoteEid, configType: CONFIG_TYPE_ULN, config: receiveUlnConfig }],
      ],
    }),
  ];
  const salt = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string domain,uint256 chainId,address oapp,address remoteOapp,address guardian,address unpauser,uint128 lzReceiveGas,uint16 feeBps,uint64 sendConfirmations,uint64 receiveConfirmations,address[] requiredDvns",
      ),
      [
        "HIVE_OFT_MAINNET_CONFIG_V1",
        BigInt(chain.chainId),
        deployment.oapp,
        deployment.oapp,
        deployment.owner,
        deployment.safe,
        deployment.lzReceiveGas,
        deployment.feeBps,
        chain.sendConfirmations,
        chain.receiveConfirmations,
        [...chain.requiredDvns],
      ],
    ),
  );

  return makeOperation({ chain, kind: "configuration", targets, values, payloads, salt });
}

export function buildCanaryActivationOperation(chainKey) {
  const chain = requireKnownChain(chainKey);
  const deployment = HIVE_MAINNET_DEPLOYMENT;
  const remoteEid = chain.remoteEid;
  const configs = [
    { dstEid: remoteEid, limit: deployment.canaryHourlyLimit, window: 3_600n },
    {
      dstEid: remoteEid + OUTBOUND_LONG_FLAG,
      limit: deployment.canaryDailyLimit,
      window: 86_400n,
    },
    {
      dstEid: remoteEid + INBOUND_FLAG,
      limit: deployment.canaryHourlyLimit,
      window: 3_600n,
    },
    {
      dstEid: remoteEid + OUTBOUND_LONG_FLAG + INBOUND_FLAG,
      limit: deployment.canaryDailyLimit,
      window: 86_400n,
    },
  ];
  const targets = [deployment.oapp];
  const values = [0n];
  const payloads = [
    encodeFunctionData({
      abi: OAPP_ABI,
      functionName: "setRateLimits",
      args: [configs],
    }),
  ];
  const salt = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string domain,uint256 chainId,address oapp,uint192 hourlyLimit,uint192 dailyLimit",
      ),
      [
        "HIVE_OFT_MAINNET_CANARY_LIMITS_V1",
        BigInt(chain.chainId),
        deployment.oapp,
        deployment.canaryHourlyLimit,
        deployment.canaryDailyLimit,
      ],
    ),
  );

  return makeOperation({ chain, kind: "canary-activation", targets, values, payloads, salt });
}

export function makePrevalidatedSafeSignature(owner = HIVE_MAINNET_DEPLOYMENT.owner) {
  return concatHex([pad(owner, { size: 32 }), toHex(0, { size: 32 }), toHex(1, { size: 1 })]);
}

export function buildSafeSubmission(operation) {
  const deployment = HIVE_MAINNET_DEPLOYMENT;
  const safeExecCalldata = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      deployment.timelock,
      0n,
      operation.scheduleCalldata,
      0,
      0n,
      0n,
      0n,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      makePrevalidatedSafeSignature(),
    ],
  });

  return {
    chainId: operation.chain.chainId,
    chainName: operation.chain.name,
    kind: operation.kind,
    from: deployment.owner,
    to: deployment.safe,
    value: 0n,
    data: safeExecCalldata,
    safeCall: {
      to: deployment.timelock,
      value: 0n,
      data: operation.scheduleCalldata,
      operation: 0,
    },
    operationId: operation.operationId,
    timelockDelaySeconds: operation.delaySeconds,
    execute: {
      to: deployment.timelock,
      value: 0n,
      data: operation.executeCalldata,
    },
  };
}

export function buildGovernancePackage(chainKey) {
  const configuration = buildConfigurationOperation(chainKey);
  const activation = buildCanaryActivationOperation(chainKey);
  return {
    schema: "hivemindos.hive-mainnet-governance.v1",
    generatedFrom: "scripts/hive-mainnet-governance.mjs",
    chain: {
      key: chainKey,
      id: configuration.chain.chainId,
      name: configuration.chain.name,
    },
    deployment: HIVE_MAINNET_DEPLOYMENT,
    requiredOwner: HIVE_MAINNET_DEPLOYMENT.owner,
    transactions: [buildSafeSubmission(configuration), buildSafeSubmission(activation)],
    notes: [
      "Submit configuration first; it leaves all rate limits at zero.",
      "Submit canary activation second; it opens only 10 HIVE/hour and 25 HIVE/day per direction.",
      "Each Safe transaction schedules a separate 72-hour TimelockController operation.",
      "The outer transaction must be sent by the current 1-of-1 Safe owner on the matching chain.",
      "After the delay, execute the configuration operation before the activation operation.",
    ],
  };
}

export function decodeUlnConfig(config) {
  return decodeAbiParameters(ULN_CONFIG_PARAMETERS, config)[0];
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function readChainArgument(argv) {
  const chainFlag = argv.indexOf("--chain");
  if (chainFlag === -1 || !argv[chainFlag + 1]) return null;
  return argv[chainFlag + 1];
}

function main() {
  const selectedChain = readChainArgument(process.argv.slice(2));
  const output = selectedChain
    ? buildGovernancePackage(selectedChain)
    : {
        base: buildGovernancePackage("base"),
        robinhood: buildGovernancePackage("robinhood"),
      };
  process.stdout.write(`${JSON.stringify(output, jsonReplacer, 2)}\n`);
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";
if (import.meta.url === invokedPath) main();
