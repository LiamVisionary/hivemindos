// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";

/// @notice Set the unpauser on the local OApp — the address that may unpause
///         WITHOUT the owner timelock delay. Intended: the governing Safe.
///         Unpause only restores already-bounded operation (it cannot move
///         funds or change limits/DVNs/fees), so bypassing the 72h timelock
///         here avoids turning a false-alarm pause into a multi-day outage,
///         while every risk-increasing action still rides the timelock owner.
///         Set to address(0) to make unpause owner-only (fully timelocked).
///
///   HIVE_LOCAL_OAPP=0x<local> HIVE_UNPAUSER=0x<safe> \
///   forge script script/SetHiveUnpauser.s.sol --rpc-url "$RPC_URL" \
///     [--account <owner-signer> --broadcast]
contract SetHiveUnpauser is Script {
    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        address unpauser = vm.envAddress("HIVE_UNPAUSER");
        require(localOApp != address(0), "HIVE_LOCAL_OAPP unset");

        vm.startBroadcast();
        HiveBridgeControls(localOApp).setUnpauser(unpauser);
        vm.stopBroadcast();

        console2.log("unpauser (timelock-bypass unpause) set on:", localOApp);
        console2.log("  unpauser:", unpauser);
    }
}
