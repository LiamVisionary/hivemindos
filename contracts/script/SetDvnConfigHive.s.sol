// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { UlnConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import { SetConfigParam, IMessageLibManager } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/// @notice Step 2.5 (mainnet, BEFORE wiring) — pin the DVN security stack.
///         Sets the ULN config for the HIVE pathway to required 2-of-2
///         [LayerZero Labs, Nethermind] with 10 confirmations, on BOTH the
///         send and receive libraries — mirroring ClawBank's live production
///         config exactly (read on-chain from their OApp on 2026-07-12).
///         Run ONCE PER SIDE (Base, then Robinhood).
///
///         Until this runs, the pathway rides the endpoint's DEFAULT config;
///         after it, the security set is pinned and immune to default drift.
///
/// SIMULATE (safe, default):
///   HIVE_LOCAL_OAPP=0x<local> \
///   forge script script/SetDvnConfigHive.s.sol --rpc-url "$RPC_URL"
///
/// BROADCAST:  add  --account <owner-signer> --broadcast
///   (the signer must be the LayerZero delegate — the owner set at deploy)
contract SetDvnConfigHive is Script {
    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        require(localOApp != address(0), "HIVE_LOCAL_OAPP unset");

        address endpoint;
        address sendLib;
        address receiveLib;
        uint32 remoteEid;
        address[] memory requiredDVNs = new address[](2);

        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) {
            endpoint = HiveOftAddresses.BASE_LZ_ENDPOINT;
            sendLib = HiveOftAddresses.BASE_SEND_ULN302;
            receiveLib = HiveOftAddresses.BASE_RECEIVE_ULN302;
            remoteEid = HiveOftAddresses.ROBINHOOD_EID;
            // required DVNs MUST be ascending: LZ Labs (0x9e05...) < Nethermind (0xcd37...)
            requiredDVNs[0] = HiveOftAddresses.BASE_DVN_LAYERZERO_LABS;
            requiredDVNs[1] = HiveOftAddresses.BASE_DVN_NETHERMIND;
        } else if (block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID) {
            endpoint = HiveOftAddresses.ROBINHOOD_LZ_ENDPOINT;
            sendLib = HiveOftAddresses.ROBINHOOD_SEND_ULN302;
            receiveLib = HiveOftAddresses.ROBINHOOD_RECEIVE_ULN302;
            remoteEid = HiveOftAddresses.BASE_EID;
            // ascending here puts Nethermind (0x0Ffe...) before LZ Labs (0xd01a...)
            requiredDVNs[0] = HiveOftAddresses.ROBINHOOD_DVN_NETHERMIND;
            requiredDVNs[1] = HiveOftAddresses.ROBINHOOD_DVN_LAYERZERO_LABS;
        } else {
            revert("mainnet only: run on Base (8453) or Robinhood (4663)");
        }

        UlnConfig memory uln = UlnConfig({
            confirmations: HiveOftAddresses.ULN_CONFIRMATIONS,
            requiredDVNCount: 2,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: requiredDVNs,
            optionalDVNs: new address[](0)
        });

        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({
            eid: remoteEid,
            configType: HiveOftAddresses.CONFIG_TYPE_ULN,
            config: abi.encode(uln)
        });

        vm.startBroadcast();
        IMessageLibManager(endpoint).setConfig(localOApp, sendLib, params);
        IMessageLibManager(endpoint).setConfig(localOApp, receiveLib, params);
        vm.stopBroadcast();

        console2.log("ULN config pinned for OApp:", localOApp);
        console2.log("  remote eid:   ", remoteEid);
        console2.log("  send lib:     ", sendLib);
        console2.log("  receive lib:  ", receiveLib);
        console2.log("  required DVN 1:", requiredDVNs[0]);
        console2.log("  required DVN 2:", requiredDVNs[1]);
        console2.log("  confirmations: ", HiveOftAddresses.ULN_CONFIRMATIONS);
    }
}
