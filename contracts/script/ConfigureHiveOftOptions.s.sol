// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { IOAppOptionsType3, EnforcedOptionParam } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";

/// @notice Configuration step — set enforced execution options (destination
///         lzReceive gas). Safe while the bridge is CLOSED. Run once per side;
///         re-run to tune gas after profiling real deliveries on testnet.
///
///   HIVE_LOCAL_OAPP=0x<local> [HIVE_LZRECEIVE_GAS=120000] \
///   forge script script/ConfigureHiveOftOptions.s.sol --rpc-url "$RPC_URL" \
///     [--account <owner-signer> --broadcast]
contract ConfigureHiveOftOptions is Script {
    using OptionsBuilder for bytes;

    uint16 internal constant MSG_TYPE_SEND = 1;

    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        require(localOApp != address(0), "HIVE_LOCAL_OAPP unset");
        uint32 remoteEid = HiveOftAddresses.remoteEidForChain(block.chainid);
        // Default covers credit + dual-window rate limit + pause check; final
        // value comes from live testnet gas profiling (see runbook).
        uint128 lzReceiveGas = uint128(vm.envOr("HIVE_LZRECEIVE_GAS", uint256(120000)));

        bytes memory enforced = OptionsBuilder.newOptions().addExecutorLzReceiveOption(lzReceiveGas, 0);
        EnforcedOptionParam[] memory params = new EnforcedOptionParam[](1);
        params[0] = EnforcedOptionParam({ eid: remoteEid, msgType: MSG_TYPE_SEND, options: enforced });

        vm.startBroadcast();
        IOAppOptionsType3(localOApp).setEnforcedOptions(params);
        vm.stopBroadcast();

        console2.log("enforced options set on:", localOApp);
        console2.log("  remote eid:   ", remoteEid);
        console2.log("  lzReceive gas:", lzReceiveGas);
    }
}
