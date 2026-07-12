// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";

/// @notice ⚠ THE BRIDGE-OPENING ACTION. Sets the four rate-limit buckets
///         (outbound/inbound × hourly/daily) on the local OApp. Contracts
///         deploy with all buckets at 0 (closed); executing this with nonzero
///         values is what actually enables flow. Under timelock governance
///         this rides the delay — queue it consciously.
///
/// There are NO default limits. Derive values from the loss budget, not from
/// total supply (runbook §6): hourly ≤ 1–2% of locked principal, daily ≤ 5%,
/// with an absolute dollar cap if that is the real tolerance. Increases only
/// after the runbook's evidence gates.
///
///   HIVE_LOCAL_OAPP=0x<local> \
///   HIVE_OUT_HOURLY=<wei> HIVE_OUT_DAILY=<wei> \
///   HIVE_IN_HOURLY=<wei>  HIVE_IN_DAILY=<wei> \
///   forge script script/SetHiveRateLimits.s.sol --rpc-url "$RPC_URL" \
///     [--account <owner-signer> --broadcast]
contract SetHiveRateLimits is Script {
    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        require(localOApp != address(0), "HIVE_LOCAL_OAPP unset");
        uint32 remoteEid = HiveOftAddresses.remoteEidForChain(block.chainid);

        // required — no convenience defaults for a risk-opening action
        uint192 outHourly = uint192(vm.envUint("HIVE_OUT_HOURLY"));
        uint192 outDaily = uint192(vm.envUint("HIVE_OUT_DAILY"));
        uint192 inHourly = uint192(vm.envUint("HIVE_IN_HOURLY"));
        uint192 inDaily = uint192(vm.envUint("HIVE_IN_DAILY"));
        require(outDaily >= outHourly && inDaily >= inHourly, "daily must be >= hourly");

        HiveBridgeControls controls = HiveBridgeControls(localOApp);
        RateLimiter.RateLimitConfig[] memory configs = new RateLimiter.RateLimitConfig[](4);
        configs[0] = RateLimiter.RateLimitConfig(controls.outboundShortKey(remoteEid), outHourly, 1 hours);
        configs[1] = RateLimiter.RateLimitConfig(controls.outboundLongKey(remoteEid), outDaily, 1 days);
        configs[2] = RateLimiter.RateLimitConfig(controls.inboundShortKey(remoteEid), inHourly, 1 hours);
        configs[3] = RateLimiter.RateLimitConfig(controls.inboundLongKey(remoteEid), inDaily, 1 days);

        vm.startBroadcast();
        controls.setRateLimits(configs);
        vm.stopBroadcast();

        console2.log("!!! BRIDGE CAPACITY CHANGED on:", localOApp);
        console2.log("  remote eid:      ", remoteEid);
        console2.log("  outbound hourly: ", outHourly);
        console2.log("  outbound daily:  ", outDaily);
        console2.log("  inbound hourly:  ", inHourly);
        console2.log("  inbound daily:   ", inDaily);
        console2.log("  (zero everywhere = bridge closed)");
    }
}
