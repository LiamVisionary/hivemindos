// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import {
    IOAppOptionsType3,
    EnforcedOptionParam
} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";

import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { HiveOftDeploymentPolicy } from "./HiveOftDeploymentPolicy.sol";

interface IEndpointDelegateView {
    function delegates(address oapp) external view returns (address);
}

/// @notice One-session testnet ceremony executed through the actual owning
///         TimelockController. This script is structurally testnet-only and
///         requires a zero-delay rehearsal timelock. Mainnet configuration
///         remains deliberately split into reviewable delayed operations.
contract ConfigureHiveOftTestnet is Script {
    using OptionsBuilder for bytes;

    uint16 private constant MSG_TYPE_SEND = 1;
    uint192 private constant DEFAULT_HOURLY_LIMIT = 10_000_000 ether;
    uint192 private constant DEFAULT_DAILY_LIMIT = 100_000_000 ether;

    function run() external {
        HiveOftDeploymentPolicy.requireTestnetChain(block.chainid);

        address localOApp = vm.envAddress("HIVE_LOCAL_OAPP");
        address remoteOApp = vm.envAddress("HIVE_REMOTE_OAPP");
        address timelockAddress = vm.envAddress("HIVE_TIMELOCK");
        address guardian = vm.envAddress("HIVE_GUARDIAN");
        address unpauser = vm.envAddress("HIVE_UNPAUSER");
        require(
            localOApp != address(0) && remoteOApp != address(0) && timelockAddress != address(0)
                && guardian != address(0) && unpauser != address(0),
            "testnet config address unset"
        );

        TimelockController timelock = TimelockController(payable(timelockAddress));
        require(timelock.getMinDelay() == 0, "testnet ceremony requires zero-delay timelock");
        require(Ownable(localOApp).owner() == timelockAddress, "timelock does not own OApp");
        address endpoint = address(IOAppCore(localOApp).endpoint());
        require(IEndpointDelegateView(endpoint).delegates(localOApp) == timelockAddress, "timelock is not delegate");

        (, address broadcaster, ) = vm.readCallers();
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), broadcaster), "broadcaster is not proposer");
        require(
            timelock.hasRole(timelock.EXECUTOR_ROLE(), address(0))
                || timelock.hasRole(timelock.EXECUTOR_ROLE(), broadcaster),
            "broadcaster cannot execute"
        );

        uint32 remoteEid = HiveOftAddresses.remoteEidForChain(block.chainid);
        uint128 lzReceiveGas = uint128(vm.envOr("HIVE_LZRECEIVE_GAS", uint256(160_000)));
        uint192 hourlyLimit = uint192(vm.envOr("HIVE_TESTNET_HOURLY_LIMIT", uint256(DEFAULT_HOURLY_LIMIT)));
        uint192 dailyLimit = uint192(vm.envOr("HIVE_TESTNET_DAILY_LIMIT", uint256(DEFAULT_DAILY_LIMIT)));
        require(hourlyLimit > 0 && dailyLimit >= hourlyLimit, "invalid testnet limits");

        EnforcedOptionParam[] memory options = new EnforcedOptionParam[](1);
        options[0] = EnforcedOptionParam({
            eid: remoteEid,
            msgType: MSG_TYPE_SEND,
            options: OptionsBuilder.newOptions().addExecutorLzReceiveOption(lzReceiveGas, 0)
        });

        HiveBridgeControls controls = HiveBridgeControls(localOApp);
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](4);
        limits[0] = RateLimiter.RateLimitConfig(controls.outboundShortKey(remoteEid), hourlyLimit, 1 hours);
        limits[1] = RateLimiter.RateLimitConfig(controls.outboundLongKey(remoteEid), dailyLimit, 1 days);
        limits[2] = RateLimiter.RateLimitConfig(controls.inboundShortKey(remoteEid), hourlyLimit, 1 hours);
        limits[3] = RateLimiter.RateLimitConfig(controls.inboundLongKey(remoteEid), dailyLimit, 1 days);

        address[] memory targets = new address[](6);
        uint256[] memory values = new uint256[](6);
        bytes[] memory payloads = new bytes[](6);
        targets[0] = localOApp;
        payloads[0] = abi.encodeCall(
            IOAppCore.setPeer,
            (remoteEid, bytes32(uint256(uint160(remoteOApp))))
        );
        targets[1] = localOApp;
        payloads[1] = abi.encodeCall(IOAppOptionsType3.setEnforcedOptions, (options));
        targets[2] = localOApp;
        payloads[2] = abi.encodeCall(HiveBridgeControls.setRateLimits, (limits));
        targets[3] = localOApp;
        payloads[3] = abi.encodeCall(HiveBridgeControls.setPauser, (guardian));
        targets[4] = localOApp;
        payloads[4] = abi.encodeCall(HiveBridgeControls.setUnpauser, (unpauser));
        targets[5] = localOApp;
        payloads[5] = abi.encodeCall(
            HiveBridgeControls.setDefaultFeeBps,
            (HiveOftDeploymentPolicy.TESTNET_BRIDGE_FEE_BPS)
        );

        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256(
            abi.encode(
                "HIVE_OFT_TESTNET_CONFIG_V1",
                block.chainid,
                localOApp,
                remoteOApp,
                guardian,
                unpauser,
                lzReceiveGas,
                hourlyLimit,
                dailyLimit
            )
        );

        vm.startBroadcast();
        timelock.scheduleBatch(targets, values, payloads, predecessor, salt, 0);
        timelock.executeBatch(targets, values, payloads, predecessor, salt);
        vm.stopBroadcast();

        console2.log("testnet OApp configured through timelock:", localOApp);
        console2.log("  chain id:", block.chainid);
        console2.log("  remote eid:", remoteEid);
        console2.log("  remote OApp:", remoteOApp);
        console2.log("  fee bps:", HiveOftDeploymentPolicy.TESTNET_BRIDGE_FEE_BPS);
        console2.log("  hourly limit:", hourlyLimit);
        console2.log("  daily limit:", dailyLimit);
        console2.logBytes32(salt);
    }
}
