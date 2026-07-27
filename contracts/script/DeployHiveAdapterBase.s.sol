// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOFTAdapter } from "../src/oft/HiveOFTAdapter.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";

/// @notice Step 1 — deploy the Base-side HIVE OFT Adapter (lockbox).
///         Supports Base mainnet (canonical HIVE, hard-wired) and Base Sepolia
///         (rehearsal; requires HIVE_TESTNET_TOKEN, a mock ERC-20 you deploy).
///
/// SIMULATE (no key, no broadcast — safe, default):
///   HIVE_OFT_OWNER=0x<multisig> \
///   forge script script/DeployHiveAdapterBase.s.sol --rpc-url "$BASE_RPC_URL"
///
/// BROADCAST (only when you mean it):
///   HIVE_OFT_OWNER=0x<multisig> \
///   forge script script/DeployHiveAdapterBase.s.sol --rpc-url "$BASE_RPC_URL" \
///     --account <deployer-keystore> --broadcast --verify
///
/// Required env:
///   HIVE_OFT_OWNER — the chain-local TimelockController that will own and act
///                    as the LayerZero delegate. Its proposer should be the
///                    governing Safe; do not use a hot EOA on mainnet.
contract DeployHiveAdapterBase is Script {
    function run() external returns (address adapter) {
        address owner = vm.envAddress("HIVE_OFT_OWNER");
        require(owner != address(0), "HIVE_OFT_OWNER unset");

        address hiveToken;
        address lzEndpoint;
        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) {
            hiveToken = HiveOftAddresses.HIVE_TOKEN_BASE;
            lzEndpoint = HiveOftAddresses.BASE_LZ_ENDPOINT;
        } else if (block.chainid == HiveOftAddresses.BASE_SEPOLIA_CHAIN_ID) {
            hiveToken = vm.envAddress("HIVE_TESTNET_TOKEN");
            require(hiveToken != address(0), "HIVE_TESTNET_TOKEN unset (rehearsal mock)");
            lzEndpoint = HiveOftAddresses.BASE_SEPOLIA_LZ_ENDPOINT;
        } else {
            revert("run on Base mainnet (8453) or Base Sepolia (84532)");
        }

        vm.startBroadcast();
        HiveOFTAdapter deployed = new HiveOFTAdapter(hiveToken, lzEndpoint, owner);
        vm.stopBroadcast();

        adapter = address(deployed);
        console2.log("HiveOFTAdapter:", adapter);
        console2.log("  wraps HIVE:", hiveToken);
        console2.log("  endpoint:  ", lzEndpoint);
        console2.log("  owner:     ", owner);
        console2.log("NOTE: deploys CLOSED (rate limits 0) - configuration is a separate governed action");
    }
}
