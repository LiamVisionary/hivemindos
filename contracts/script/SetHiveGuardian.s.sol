// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";

/// @notice Set the pause guardian on the local OApp. The guardian can ONLY
///         pause (and, if granted CANCELLER_ROLE on the timelock, cancel
///         queued actions) — it cannot unpause, configure, or drain.
///
///   HIVE_LOCAL_OAPP=0x<local> HIVE_GUARDIAN=0x<hot-guardian> \
///   forge script script/SetHiveGuardian.s.sol --rpc-url "$RPC_URL" \
///     [--account <owner-signer> --broadcast]
contract SetHiveGuardian is Script {
    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        address guardian = vm.envAddress("HIVE_GUARDIAN");
        require(localOApp != address(0) && guardian != address(0), "addr unset");

        vm.startBroadcast();
        HiveBridgeControls(localOApp).setPauser(guardian);
        vm.stopBroadcast();

        console2.log("guardian (pause-only) set on:", localOApp);
        console2.log("  guardian:", guardian);
    }
}
