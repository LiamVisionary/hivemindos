# B20 Issuer Reference

## Official Sources

- Base B20 spec: `https://docs.base.org/base-chain/specs/upgrades/beryl/b20`
- Base B20 launch guide: `https://docs.base.org/get-started/launch-b20-token`
- Base std source: `https://github.com/base/base-std`

## Network Defaults

- Base Sepolia chain id: `84532`
- Base Sepolia RPC: `https://sepolia.base.org`
- B20 factory precompile: `0xB20f000000000000000000000000000000000000`
- Policy registry precompile: `0x8453000000000000000000000000000000000002`
- Activation registry precompile: `0x8453000000000000000000000000000000000001`

Use Base Sepolia for tests while mainnet activation is uncertain. Verify current mainnet activation from official Base docs before any mainnet deployment flow.

## Factory Interface

The factory exposes:

```solidity
function createB20(uint8 variant, bytes32 salt, bytes params, bytes[] initCalls)
  external
  payable
  returns (address token);

function getB20Address(uint8 variant, address sender, bytes32 salt)
  external
  view
  returns (address);

function isB20(address token) external view returns (bool);
function isB20Initialized(address token) external view returns (bool);
```

Variant ids:

- `0`: Asset
- `1`: Stablecoin

## Params Encoding

Both create-param blobs use canonical ABI tuple encoding with `version: 1`.

Asset:

```solidity
struct B20AssetCreateParams {
  uint8 version;
  string name;
  string symbol;
  address initialAdmin;
  uint8 decimals;
}
```

Asset decimals must be in the inclusive range `6` through `18`.

Stablecoin:

```solidity
struct B20StablecoinCreateParams {
  uint8 version;
  string name;
  string symbol;
  address initialAdmin;
  string currency;
}
```

Stablecoins use fixed 6 decimals. Currency codes must be uppercase ASCII letters.

## Role Constants

The role constants are:

```text
DEFAULT_ADMIN_ROLE = bytes32(0)
MINT_ROLE = keccak256("MINT_ROLE")
BURN_ROLE = keccak256("BURN_ROLE")
BURN_BLOCKED_ROLE = keccak256("BURN_BLOCKED_ROLE")
PAUSE_ROLE = keccak256("PAUSE_ROLE")
UNPAUSE_ROLE = keccak256("UNPAUSE_ROLE")
METADATA_ROLE = keccak256("METADATA_ROLE")
OPERATOR_ROLE = keccak256("OPERATOR_ROLE")
```

The HivemindOS issuer proof defaults to a conservative role bundle:

- `initialAdmin`: this agent wallet unless overridden.
- `MINT_ROLE`: minter wallet, defaulting to the admin.
- `PAUSE_ROLE`: pauser wallet, defaulting to the admin.
- `UNPAUSE_ROLE`: unpauser wallet, defaulting to the admin.
- `METADATA_ROLE`: metadata admin wallet, defaulting to the admin.

## Bootstrap Init Calls

During `createB20`, the factory dispatches `initCalls` on the new token after identity is sealed. Factory-originated init calls bypass token role gates and transfer-side policy gates during the bootstrap window. This bypass does not skip mint-receiver policy, pause checks, or supply invariants.

Default HivemindOS sequence:

1. `updateSupplyCap(supplyCapRaw)`
2. `grantRole(MINT_ROLE, minter)`
3. `grantRole(PAUSE_ROLE, pauser)`
4. `grantRole(UNPAUSE_ROLE, unpauser)`
5. `grantRole(METADATA_ROLE, metadataAdmin)`
6. `mint(recipient, initialSupplyRaw)`

If a restrictive `MINT_RECEIVER_POLICY` is added in a future variant of this skill, ensure mint recipients are authorized before minting.

## Proof Card Checklist

A valid proof card includes:

- Network and chain id.
- Variant and token identity.
- Initial mint recipient, initial supply, supply cap, decimals/currency.
- Deployer, admin, minter, pauser, unpauser, metadata admin.
- Factory address and predicted token address.
- Salt.
- Params hash.
- Init calls hash.
- Create calldata hash.
- Deployer Sepolia ETH balance and gas-estimate status.
- Confirmation instruction.

Do not execute when the predicted address is already initialized or when the deployer lacks gas.
