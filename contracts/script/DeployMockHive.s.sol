// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";

/// @dev Rehearsal-only stand-in for HIVE on Base Sepolia: vanilla 18-decimal
///      ERC-20 (mirrors the fork-verified lossless behavior of the real
///      DERC20). Whole supply mints to the deployer.
contract MockHiveToken is ERC20 {
    constructor() ERC20("HIVE (testnet mock)", "HIVE") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

/// @notice Testnet rehearsal step 0 — deploy the mock HIVE on Base Sepolia.
///         Pass the printed address as HIVE_TESTNET_TOKEN to
///         DeployHiveAdapterBase.s.sol.
///
///   forge script script/DeployMockHive.s.sol --rpc-url https://sepolia.base.org \
///     --private-key <throwaway> --broadcast
contract DeployMockHive is Script {
    function run() external returns (address token) {
        require(block.chainid == HiveOftAddresses.BASE_SEPOLIA_CHAIN_ID, "Base Sepolia only (84532)");
        vm.startBroadcast();
        MockHiveToken deployed = new MockHiveToken();
        vm.stopBroadcast();
        token = address(deployed);
        console2.log("MockHiveToken (Base Sepolia):", token);
    }
}
