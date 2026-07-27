// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UlnConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import {
    IOAppOptionsType3,
    EnforcedOptionParam
} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";

import { HiveOFT } from "../src/oft/HiveOFT.sol";
import { HiveOFTAdapter } from "../src/oft/HiveOFTAdapter.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { HiveOftDeploymentPolicy } from "./HiveOftDeploymentPolicy.sol";

interface IEndpointDelegateView {
    function delegates(address oapp) external view returns (address);
}

/// @notice Same-day mainnet launch ceremony. A fresh OApp is configured while
///         empty and held by the broadcaster, then permanently sealed to the
///         already-deployed 72-hour timelock before any canary funds move.
/// @dev The temporary broadcaster has no assets to drain: the Base lockbox and
///      Robinhood supply are both required to be zero throughout bootstrap.
contract DeployAndBootstrapHiveMainnet is Script {
    using OptionsBuilder for bytes;

    uint16 private constant MSG_TYPE_SEND = 1;
    uint16 private constant BRIDGE_FEE_BPS = 5;
    uint128 private constant LZ_RECEIVE_GAS = 160_000;
    // Sized above the live routed market's maximum permitted trade at the
    // gateway's 10% impact cutoff. These are public-launch safety brakes, not
    // canary limits, so routed execution is market-limited instead of blocked
    // after the user has already purchased HIVE on Base.
    uint192 private constant PUBLIC_HOURLY_LIMIT = 5_000_000_000 ether;
    uint192 private constant PUBLIC_DAILY_LIMIT = 10_000_000_000 ether;

    function run() external returns (address localOApp) {
        require(
            block.chainid == HiveOftAddresses.BASE_CHAIN_ID
                || block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID,
            "mainnet only"
        );

        address expectedOApp = vm.envAddress("HIVE_EXPECTED_OAPP");
        address remoteOApp = vm.envAddress("HIVE_REMOTE_OAPP");
        address finalOwner = vm.envAddress("HIVE_FINAL_OWNER");
        address guardian = vm.envAddress("HIVE_GUARDIAN");
        address unpauser = vm.envAddress("HIVE_UNPAUSER");
        require(
            expectedOApp != address(0) && remoteOApp != address(0) && finalOwner != address(0)
                && guardian != address(0) && unpauser != address(0),
            "bootstrap address unset"
        );

        uint256 finalDelay = TimelockController(payable(finalOwner)).getMinDelay();
        HiveOftDeploymentPolicy.requireGovernanceDelay(block.chainid, finalDelay);
        (, address broadcaster, ) = vm.readCallers();
        require(broadcaster != address(0) && broadcaster != finalOwner, "invalid temporary owner");

        vm.startBroadcast();
        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) {
            localOApp = address(
                new HiveOFTAdapter(
                    HiveOftAddresses.HIVE_TOKEN_BASE,
                    HiveOftAddresses.BASE_LZ_ENDPOINT,
                    broadcaster
                )
            );
        } else {
            localOApp = address(new HiveOFT(HiveOftAddresses.ROBINHOOD_LZ_ENDPOINT, broadcaster));
        }
        require(localOApp == expectedOApp, "unexpected OApp address");
        _requireEmpty(localOApp);
        _configure(localOApp, remoteOApp, finalOwner, guardian, unpauser);
        vm.stopBroadcast();

        _requireEmpty(localOApp);
        require(Ownable(localOApp).owner() == finalOwner, "OApp not sealed to timelock");
        address endpoint = address(IOAppCore(localOApp).endpoint());
        require(IEndpointDelegateView(endpoint).delegates(localOApp) == finalOwner, "delegate not sealed to timelock");

        console2.log("same-day HIVE OApp deployed and sealed:", localOApp);
        console2.log("  remote peer:", remoteOApp);
        console2.log("  final owner/delegate:", finalOwner);
        console2.log("  governance delay:", finalDelay);
    }

    function _configure(
        address _localOApp,
        address _remoteOApp,
        address _finalOwner,
        address _guardian,
        address _unpauser
    ) private {
        bool onBase = block.chainid == HiveOftAddresses.BASE_CHAIN_ID;
        uint32 remoteEid = HiveOftAddresses.remoteEidForChain(block.chainid);
        address endpointAddress = address(IOAppCore(_localOApp).endpoint());
        address sendLib = onBase ? HiveOftAddresses.BASE_SEND_ULN302 : HiveOftAddresses.ROBINHOOD_SEND_ULN302;
        address receiveLib = onBase ? HiveOftAddresses.BASE_RECEIVE_ULN302 : HiveOftAddresses.ROBINHOOD_RECEIVE_ULN302;
        uint64 sendConfirmations = onBase
            ? HiveOftAddresses.BASE_SOURCE_CONFIRMATIONS
            : HiveOftAddresses.ROBINHOOD_SOURCE_CONFIRMATIONS;
        uint64 receiveConfirmations = onBase
            ? HiveOftAddresses.ROBINHOOD_SOURCE_CONFIRMATIONS
            : HiveOftAddresses.BASE_SOURCE_CONFIRMATIONS;

        IOAppCore(_localOApp).setPeer(remoteEid, bytes32(uint256(uint160(_remoteOApp))));

        EnforcedOptionParam[] memory options = new EnforcedOptionParam[](1);
        options[0] = EnforcedOptionParam({
            eid: remoteEid,
            msgType: MSG_TYPE_SEND,
            options: OptionsBuilder.newOptions().addExecutorLzReceiveOption(LZ_RECEIVE_GAS, 0)
        });
        IOAppOptionsType3(_localOApp).setEnforcedOptions(options);

        HiveBridgeControls controls = HiveBridgeControls(_localOApp);
        controls.setPauser(_guardian);
        controls.setUnpauser(_unpauser);
        controls.setDefaultFeeBps(BRIDGE_FEE_BPS);

        address[] memory requiredDvns = new address[](2);
        if (onBase) {
            requiredDvns[0] = HiveOftAddresses.BASE_DVN_LAYERZERO_LABS;
            requiredDvns[1] = HiveOftAddresses.BASE_DVN_NETHERMIND;
        } else {
            requiredDvns[0] = HiveOftAddresses.ROBINHOOD_DVN_NETHERMIND;
            requiredDvns[1] = HiveOftAddresses.ROBINHOOD_DVN_LAYERZERO_LABS;
        }
        address[] memory optionalDvns = new address[](0);
        IMessageLibManager endpoint = IMessageLibManager(endpointAddress);
        endpoint.setConfig(
            _localOApp,
            sendLib,
            _ulnParams(remoteEid, sendConfirmations, requiredDvns, optionalDvns)
        );
        endpoint.setConfig(
            _localOApp,
            receiveLib,
            _ulnParams(remoteEid, receiveConfirmations, requiredDvns, optionalDvns)
        );

        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](4);
        limits[0] = RateLimiter.RateLimitConfig(
            controls.outboundShortKey(remoteEid), PUBLIC_HOURLY_LIMIT, 1 hours
        );
        limits[1] = RateLimiter.RateLimitConfig(
            controls.outboundLongKey(remoteEid), PUBLIC_DAILY_LIMIT, 1 days
        );
        limits[2] = RateLimiter.RateLimitConfig(
            controls.inboundShortKey(remoteEid), PUBLIC_HOURLY_LIMIT, 1 hours
        );
        limits[3] = RateLimiter.RateLimitConfig(
            controls.inboundLongKey(remoteEid), PUBLIC_DAILY_LIMIT, 1 days
        );
        controls.setRateLimits(limits);

        IOAppCore(_localOApp).setDelegate(_finalOwner);
        Ownable(_localOApp).transferOwnership(_finalOwner);
    }

    function _ulnParams(
        uint32 _remoteEid,
        uint64 _confirmations,
        address[] memory _requiredDvns,
        address[] memory _optionalDvns
    ) private pure returns (SetConfigParam[] memory params) {
        UlnConfig memory config = UlnConfig({
            confirmations: _confirmations,
            requiredDVNCount: 2,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: _requiredDvns,
            optionalDVNs: _optionalDvns
        });
        params = new SetConfigParam[](1);
        params[0] = SetConfigParam({
            eid: _remoteEid,
            configType: HiveOftAddresses.CONFIG_TYPE_ULN,
            config: abi.encode(config)
        });
    }

    function _requireEmpty(address _localOApp) private view {
        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) {
            require(
                IERC20(HiveOftAddresses.HIVE_TOKEN_BASE).balanceOf(_localOApp) == 0,
                "replacement lockbox not empty"
            );
        } else {
            require(IERC20(_localOApp).totalSupply() == 0, "replacement OFT supply not zero");
            require(IERC20(_localOApp).balanceOf(_localOApp) == 0, "replacement OFT fee balance not zero");
        }
    }
}
