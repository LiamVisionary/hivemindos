// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { UlnConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import { SetConfigParam, IMessageLibManager } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/// @notice Configuration step (mainnet, BEFORE opening capacity) — pin the DVN
///         security stack with DIRECTIONAL finality. Required 2-of-2
///         [LayerZero Labs, Nethermind] everywhere, but confirmations are per
///         SOURCE chain:
///
///           direction        send side (source)          receive side (dest)
///           Base → Robinhood BASE_SOURCE_CONFIRMATIONS   BASE_SOURCE_CONFIRMATIONS
///           Robinhood → Base ROBINHOOD_SOURCE_CONFS      ROBINHOOD_SOURCE_CONFS
///
///         i.e. on each chain: the SEND library gets the LOCAL chain's source
///         depth, and the RECEIVE library gets the REMOTE chain's source
///         depth. Send and matching receive values are identical by
///         construction here. Run once per side.
///
///   HIVE_LOCAL_OAPP=0x<local> \
///   forge script script/SetDvnConfigHive.s.sol --rpc-url "$RPC_URL" \
///     [--account <owner/delegate-signer> --broadcast]
contract SetDvnConfigHive is Script {
    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        require(localOApp != address(0), "HIVE_LOCAL_OAPP unset");

        address endpoint;
        address sendLib;
        address receiveLib;
        uint32 remoteEid;
        uint64 localSourceConfs;
        uint64 remoteSourceConfs;
        address[] memory requiredDVNs = new address[](2);

        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) {
            endpoint = HiveOftAddresses.BASE_LZ_ENDPOINT;
            sendLib = HiveOftAddresses.BASE_SEND_ULN302;
            receiveLib = HiveOftAddresses.BASE_RECEIVE_ULN302;
            remoteEid = HiveOftAddresses.ROBINHOOD_EID;
            localSourceConfs = HiveOftAddresses.BASE_SOURCE_CONFIRMATIONS;
            remoteSourceConfs = HiveOftAddresses.ROBINHOOD_SOURCE_CONFIRMATIONS;
            // required DVNs MUST be ascending: LZ Labs (0x9e05...) < Nethermind (0xcd37...)
            requiredDVNs[0] = HiveOftAddresses.BASE_DVN_LAYERZERO_LABS;
            requiredDVNs[1] = HiveOftAddresses.BASE_DVN_NETHERMIND;
        } else if (block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID) {
            endpoint = HiveOftAddresses.ROBINHOOD_LZ_ENDPOINT;
            sendLib = HiveOftAddresses.ROBINHOOD_SEND_ULN302;
            receiveLib = HiveOftAddresses.ROBINHOOD_RECEIVE_ULN302;
            remoteEid = HiveOftAddresses.BASE_EID;
            localSourceConfs = HiveOftAddresses.ROBINHOOD_SOURCE_CONFIRMATIONS;
            remoteSourceConfs = HiveOftAddresses.BASE_SOURCE_CONFIRMATIONS;
            // ascending here puts Nethermind (0x0Ffe...) before LZ Labs (0xd01a...)
            requiredDVNs[0] = HiveOftAddresses.ROBINHOOD_DVN_NETHERMIND;
            requiredDVNs[1] = HiveOftAddresses.ROBINHOOD_DVN_LAYERZERO_LABS;
        } else {
            revert("mainnet only: run on Base (8453) or Robinhood (4663)");
        }

        SetConfigParam[] memory sendParams = new SetConfigParam[](1);
        sendParams[0] = SetConfigParam({
            eid: remoteEid,
            configType: HiveOftAddresses.CONFIG_TYPE_ULN,
            config: abi.encode(_uln(localSourceConfs, requiredDVNs))
        });
        SetConfigParam[] memory receiveParams = new SetConfigParam[](1);
        receiveParams[0] = SetConfigParam({
            eid: remoteEid,
            configType: HiveOftAddresses.CONFIG_TYPE_ULN,
            config: abi.encode(_uln(remoteSourceConfs, requiredDVNs))
        });

        vm.startBroadcast();
        IMessageLibManager(endpoint).setConfig(localOApp, sendLib, sendParams);
        IMessageLibManager(endpoint).setConfig(localOApp, receiveLib, receiveParams);
        vm.stopBroadcast();

        console2.log("directional ULN config pinned for OApp:", localOApp);
        console2.log("  remote eid:              ", remoteEid);
        console2.log("  send confs (local src):  ", localSourceConfs);
        console2.log("  recv confs (remote src): ", remoteSourceConfs);
        console2.log("  required DVN 1:", requiredDVNs[0]);
        console2.log("  required DVN 2:", requiredDVNs[1]);
    }

    function _uln(uint64 _confirmations, address[] memory _dvns) private pure returns (UlnConfig memory) {
        return UlnConfig({
            confirmations: _confirmations,
            requiredDVNCount: 2,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: _dvns,
            optionalDVNs: new address[](0)
        });
    }
}
