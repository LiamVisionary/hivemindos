// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";

/// @notice Configuration step — set the remote peer. Safe to run while the
///         bridge is CLOSED (all rate limits zero): peers do not move funds.
///         Run once per side. Opening capacity is a SEPARATE action
///         (SetHiveRateLimits) so "configured" and "open" are never the same
///         event.
///
///   HIVE_LOCAL_OAPP=0x<local> HIVE_REMOTE_OAPP=0x<remote> \
///   forge script script/ConfigureHiveOftPeers.s.sol --rpc-url "$RPC_URL" \
///     [--account <owner-signer> --broadcast]
contract ConfigureHiveOftPeers is Script {
    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        address remoteOApp = vm.envAddress("HIVE_REMOTE_OAPP");
        require(localOApp != address(0) && remoteOApp != address(0), "OApp addr unset");
        uint32 remoteEid = HiveOftAddresses.remoteEidForChain(block.chainid);

        vm.startBroadcast();
        IOAppCore(localOApp).setPeer(remoteEid, bytes32(uint256(uint160(remoteOApp))));
        vm.stopBroadcast();

        console2.log("peer set on:", localOApp);
        console2.log("  remote eid: ", remoteEid);
        console2.log("  remote OApp:", remoteOApp);
        console2.log("bridge remains CLOSED until SetHiveRateLimits runs");
    }
}
