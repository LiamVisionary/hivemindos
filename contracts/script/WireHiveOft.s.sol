// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import { IOAppOptionsType3, EnforcedOptionParam } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";

/// @notice Step 3 — wire the local OApp to its remote peer AND open the valve:
///         setPeer + enforced execution options + initial rate limits. Run ONCE
///         PER SIDE (Base and Robinhood; also supports the testnet pair).
///         Bridging cannot succeed until BOTH sides are wired.
///
/// The contracts deploy CLOSED (rate-limit buckets default to 0), so setting
/// rate limits here is what actually enables flow — an explicit, auditable act.
///
/// DVN / message-library security is a separate step: run SetDvnConfigHive
/// BEFORE this on mainnet (testnet rehearsal may skip it and use defaults).
///
/// SIMULATE (safe, default):
///   HIVE_LOCAL_OAPP=0x<local> HIVE_REMOTE_OAPP=0x<remote> \
///   forge script script/WireHiveOft.s.sol --rpc-url "$RPC_URL"
///
/// BROADCAST:  add  --account <owner-signer> --broadcast
///   (the signer must be the owner/delegate set at deploy time)
///
/// Optional env (defaults chosen for HIVE's 100B supply):
///   HIVE_LZRECEIVE_GAS    gas enforced for lzReceive on the destination
///                         (default 120000 — covers credit + rate limit + pause)
///   HIVE_OUTBOUND_LIMIT   outbound bucket, wei units (default 1B HIVE / window)
///   HIVE_INBOUND_LIMIT    inbound bucket, wei units (default 1B HIVE / window)
///   HIVE_RATE_WINDOW      window seconds for both buckets (default 86400 = 1 day)
contract WireHiveOft is Script {
    using OptionsBuilder for bytes;

    uint16 internal constant MSG_TYPE_SEND = 1;

    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        address remoteOApp = vm.envAddress("HIVE_REMOTE_OAPP");
        require(localOApp != address(0) && remoteOApp != address(0), "OApp addr unset");

        uint32 remoteEid;
        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) {
            remoteEid = HiveOftAddresses.ROBINHOOD_EID;
        } else if (block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID) {
            remoteEid = HiveOftAddresses.BASE_EID;
        } else if (block.chainid == HiveOftAddresses.BASE_SEPOLIA_CHAIN_ID) {
            remoteEid = HiveOftAddresses.ROBINHOOD_TESTNET_EID;
        } else if (block.chainid == HiveOftAddresses.ROBINHOOD_TESTNET_CHAIN_ID) {
            remoteEid = HiveOftAddresses.BASE_SEPOLIA_EID;
        } else {
            revert("run on Base/Robinhood mainnet or their testnet pair");
        }

        uint128 lzReceiveGas = uint128(vm.envOr("HIVE_LZRECEIVE_GAS", uint256(120000)));
        uint192 outboundLimit = uint192(vm.envOr("HIVE_OUTBOUND_LIMIT", uint256(1_000_000_000 ether)));
        uint192 inboundLimit = uint192(vm.envOr("HIVE_INBOUND_LIMIT", uint256(1_000_000_000 ether)));
        uint64 window = uint64(vm.envOr("HIVE_RATE_WINDOW", uint256(86400)));

        bytes memory enforced = OptionsBuilder.newOptions().addExecutorLzReceiveOption(lzReceiveGas, 0);
        EnforcedOptionParam[] memory optionParams = new EnforcedOptionParam[](1);
        optionParams[0] = EnforcedOptionParam({ eid: remoteEid, msgType: MSG_TYPE_SEND, options: enforced });

        HiveBridgeControls controls = HiveBridgeControls(localOApp);
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](2);
        limits[0] = RateLimiter.RateLimitConfig({ dstEid: remoteEid, limit: outboundLimit, window: window });
        limits[1] = RateLimiter.RateLimitConfig({
            dstEid: controls.inboundRateLimitKey(remoteEid),
            limit: inboundLimit,
            window: window
        });

        vm.startBroadcast();
        IOAppCore(localOApp).setPeer(remoteEid, bytes32(uint256(uint160(remoteOApp))));
        IOAppOptionsType3(localOApp).setEnforcedOptions(optionParams);
        controls.setRateLimits(limits);
        vm.stopBroadcast();

        console2.log("wired local OApp:", localOApp);
        console2.log("  -> remote eid:  ", remoteEid);
        console2.log("  -> remote OApp: ", remoteOApp);
        console2.log("  lzReceive gas:  ", lzReceiveGas);
        console2.log("  outbound limit: ", outboundLimit);
        console2.log("  inbound limit:  ", inboundLimit);
        console2.log("  window (s):     ", window);
    }
}
