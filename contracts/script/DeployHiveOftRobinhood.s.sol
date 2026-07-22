// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOFT } from "../src/oft/HiveOFT.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";

/// @notice Step 2 — deploy the Robinhood-side HIVE OFT (mint/burn twin).
///         Supports Robinhood mainnet and Robinhood testnet (rehearsal).
///
/// SIMULATE (safe, default):
///   HIVE_OFT_OWNER=0x<multisig> \
///   forge script script/DeployHiveOftRobinhood.s.sol --rpc-url "$ROBINHOOD_RPC_URL"
///
/// BROADCAST (only when you mean it):
///   HIVE_OFT_OWNER=0x<multisig> \
///   forge script script/DeployHiveOftRobinhood.s.sol --rpc-url "$ROBINHOOD_RPC_URL" \
///     --account <deployer-keystore> --broadcast
///
/// ROBINHOOD_RPC_URL mainnet = https://rpc.mainnet.chain.robinhood.com/
///                   testnet = https://rpc.testnet.chain.robinhood.com/
///
/// Required env:
///   HIVE_OFT_OWNER — the Robinhood chain-local TimelockController. It may have
///                    the same Safe proposer as Base, but it is a distinct
///                    deployed owner contract on this chain.
contract DeployHiveOftRobinhood is Script {
    function run() external returns (address oft) {
        address owner = vm.envAddress("HIVE_OFT_OWNER");
        require(owner != address(0), "HIVE_OFT_OWNER unset");

        address lzEndpoint;
        if (block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID) {
            lzEndpoint = HiveOftAddresses.ROBINHOOD_LZ_ENDPOINT;
        } else if (block.chainid == HiveOftAddresses.ROBINHOOD_TESTNET_CHAIN_ID) {
            lzEndpoint = HiveOftAddresses.ROBINHOOD_TESTNET_LZ_ENDPOINT;
        } else {
            revert("run on Robinhood mainnet (4663) or testnet (46630)");
        }

        vm.startBroadcast();
        HiveOFT deployed = new HiveOFT(lzEndpoint, owner);
        vm.stopBroadcast();

        oft = address(deployed);
        console2.log("HiveOFT:", oft);
        console2.log("  endpoint:", lzEndpoint);
        console2.log("  owner:   ", owner);
        console2.log("NOTE: deploys CLOSED (rate limits 0) - configuration is a separate governed action");
    }
}
