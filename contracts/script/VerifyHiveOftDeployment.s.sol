// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { UlnConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import { IMessageLibManager } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface IEndpointViews {
    function delegates(address _oapp) external view returns (address);
    function getConfig(address _oapp, address _lib, uint32 _eid, uint32 _configType) external view returns (bytes memory);
}

interface IEnforcedOptionsView {
    function enforcedOptions(uint32 _eid, uint16 _msgType) external view returns (bytes memory);
}

/// @notice Read-only deployment verifier — run after every configuration step
///         and before opening capacity. Reverts if any check fails, so it can
///         gate CI / ceremony checklists. Mainnet-only checks (libs, DVNs) are
///         skipped on the testnet pair.
///
///   HIVE_LOCAL_OAPP=0x<local> HIVE_REMOTE_OAPP=0x<remote> \
///   HIVE_EXPECTED_OWNER=0x<timelock> \
///   forge script script/VerifyHiveOftDeployment.s.sol --rpc-url "$RPC_URL"
contract VerifyHiveOftDeployment is Script {
    uint256 private failures;

    function run() external {
        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        address remoteOApp = vm.envAddress("HIVE_REMOTE_OAPP");
        address expectedOwner = vm.envAddress("HIVE_EXPECTED_OWNER");
        uint32 remoteEid = HiveOftAddresses.remoteEidForChain(block.chainid);
        bool mainnet = block.chainid == HiveOftAddresses.BASE_CHAIN_ID
            || block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID;

        HiveBridgeControls controls = HiveBridgeControls(localOApp);

        _check("owner is expected (timelock)", Ownable(localOApp).owner() == expectedOwner);
        _check("not paused", !Pausable(localOApp).paused());
        _check("fee is zero at launch", controls.defaultFeeBps() == 0);
        _check(
            "peer matches remote OApp",
            IOAppCore(localOApp).peers(remoteEid) == bytes32(uint256(uint160(remoteOApp)))
        );
        _check(
            "enforced options set for SEND",
            IEnforcedOptionsView(localOApp).enforcedOptions(remoteEid, 1).length > 0
        );

        address endpoint = address(IOAppCore(localOApp).endpoint());
        _check("delegate is expected (timelock)", IEndpointViews(endpoint).delegates(localOApp) == expectedOwner);

        if (mainnet) {
            bool onBase = block.chainid == HiveOftAddresses.BASE_CHAIN_ID;
            address sendLib = onBase ? HiveOftAddresses.BASE_SEND_ULN302 : HiveOftAddresses.ROBINHOOD_SEND_ULN302;
            address receiveLib = onBase ? HiveOftAddresses.BASE_RECEIVE_ULN302 : HiveOftAddresses.ROBINHOOD_RECEIVE_ULN302;
            uint64 localConfs = onBase
                ? HiveOftAddresses.BASE_SOURCE_CONFIRMATIONS
                : HiveOftAddresses.ROBINHOOD_SOURCE_CONFIRMATIONS;
            uint64 remoteConfs = onBase
                ? HiveOftAddresses.ROBINHOOD_SOURCE_CONFIRMATIONS
                : HiveOftAddresses.BASE_SOURCE_CONFIRMATIONS;
            address dvnLow = onBase ? HiveOftAddresses.BASE_DVN_LAYERZERO_LABS : HiveOftAddresses.ROBINHOOD_DVN_NETHERMIND;
            address dvnHigh = onBase ? HiveOftAddresses.BASE_DVN_NETHERMIND : HiveOftAddresses.ROBINHOOD_DVN_LAYERZERO_LABS;

            _check(
                "send library pinned",
                IMessageLibManager(endpoint).getSendLibrary(localOApp, remoteEid) == sendLib
            );
            (address recvLib, ) = IMessageLibManager(endpoint).getReceiveLibrary(localOApp, remoteEid);
            _check("receive library pinned", recvLib == receiveLib);

            _checkUln(endpoint, localOApp, sendLib, remoteEid, localConfs, dvnLow, dvnHigh, "send ULN");
            _checkUln(endpoint, localOApp, receiveLib, remoteEid, remoteConfs, dvnLow, dvnHigh, "receive ULN");
        } else {
            console2.log("  (testnet: lib/DVN pinning checks skipped)");
        }

        _logBuckets(controls, remoteEid);

        if (failures > 0) {
            console2.log("FAILURES:", failures);
            revert("deployment verification FAILED");
        }
        console2.log("ALL CHECKS PASSED for", localOApp);
    }

    function _checkUln(
        address _endpoint,
        address _oapp,
        address _lib,
        uint32 _eid,
        uint64 _confs,
        address _dvnLow,
        address _dvnHigh,
        string memory _label
    ) private {
        UlnConfig memory cfg =
            abi.decode(IEndpointViews(_endpoint).getConfig(_oapp, _lib, _eid, HiveOftAddresses.CONFIG_TYPE_ULN), (UlnConfig));
        bool ok = cfg.confirmations == _confs && cfg.requiredDVNCount == 2 && cfg.optionalDVNCount == 0
            && cfg.requiredDVNs.length == 2 && cfg.requiredDVNs[0] == _dvnLow && cfg.requiredDVNs[1] == _dvnHigh;
        _check(_label, ok);
        if (!ok) {
            console2.log("    got confirmations:", cfg.confirmations);
            if (cfg.requiredDVNs.length == 2) {
                console2.log("    got DVN[0]:", cfg.requiredDVNs[0]);
                console2.log("    got DVN[1]:", cfg.requiredDVNs[1]);
            }
        }
    }

    function _logBuckets(HiveBridgeControls _controls, uint32 _eid) private view {
        (, uint256 outH) = _controls.getAmountCanBeSent(_controls.outboundShortKey(_eid));
        (, uint256 outD) = _controls.getAmountCanBeSent(_controls.outboundLongKey(_eid));
        (, uint256 inH) = _controls.getAmountCanBeSent(_controls.inboundShortKey(_eid));
        (, uint256 inD) = _controls.getAmountCanBeSent(_controls.inboundLongKey(_eid));
        console2.log("  capacity out hourly:", outH);
        console2.log("  capacity out daily: ", outD);
        console2.log("  capacity in hourly: ", inH);
        console2.log("  capacity in daily:  ", inD);
        console2.log("  (all zero = closed, which is correct before activation)");
    }

    function _check(string memory _label, bool _ok) private {
        if (_ok) {
            console2.log("  PASS:", _label);
        } else {
            failures++;
            console2.log("  FAIL:", _label);
        }
    }
}
