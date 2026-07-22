// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";
import { HiveOftDeploymentPolicy } from "../script/HiveOftDeploymentPolicy.sol";

contract DeploymentPolicyHarness {
    function requireGovernanceDelay(uint256 chainId, uint256 delay) external pure {
        HiveOftDeploymentPolicy.requireGovernanceDelay(chainId, delay);
    }

    function requireTestnetChain(uint256 chainId) external pure {
        HiveOftDeploymentPolicy.requireTestnetChain(chainId);
    }
}

contract TimelockedHiveControls is HiveBridgeControls {
    constructor(address owner_) Ownable(owner_) {}
}

contract HiveOftDeploymentPolicyTest is Test {
    uint256 private constant BASE_MAINNET = 8453;
    uint256 private constant ROBINHOOD_MAINNET = 4663;
    uint256 private constant BASE_SEPOLIA = 84532;
    uint256 private constant ROBINHOOD_TESTNET = 46630;

    address private proposer = makeAddr("testnet-proposer");
    DeploymentPolicyHarness private harness;

    function setUp() public {
        harness = new DeploymentPolicyHarness();
    }

    function test_MainnetGovernanceDelayCannotBeShortened() public {
        vm.expectRevert(abi.encodeWithSelector(HiveOftDeploymentPolicy.MainnetDelayTooShort.selector, 0, 72 hours));
        harness.requireGovernanceDelay(BASE_MAINNET, 0);

        vm.expectRevert(abi.encodeWithSelector(HiveOftDeploymentPolicy.MainnetDelayTooShort.selector, 71 hours, 72 hours));
        harness.requireGovernanceDelay(ROBINHOOD_MAINNET, 71 hours);

        harness.requireGovernanceDelay(BASE_MAINNET, 72 hours);
        harness.requireGovernanceDelay(ROBINHOOD_MAINNET, 7 days);
    }

    function test_TestnetAllowsZeroDelayRehearsal() public {
        HiveOftDeploymentPolicy.requireGovernanceDelay(BASE_SEPOLIA, 0);
        HiveOftDeploymentPolicy.requireGovernanceDelay(ROBINHOOD_TESTNET, 0);
    }

    function test_TestnetConfiguratorRejectsMainnetAndUnknownChains() public {
        HiveOftDeploymentPolicy.requireTestnetChain(BASE_SEPOLIA);
        HiveOftDeploymentPolicy.requireTestnetChain(ROBINHOOD_TESTNET);

        vm.expectRevert(abi.encodeWithSelector(HiveOftDeploymentPolicy.NotTestnet.selector, BASE_MAINNET));
        harness.requireTestnetChain(BASE_MAINNET);

        vm.expectRevert(abi.encodeWithSelector(HiveOftDeploymentPolicy.UnsupportedChain.selector, 1));
        harness.requireGovernanceDelay(1, 0);
    }

    function test_ConfigMustExecuteThroughOwningTimelock() public {
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        TimelockController timelock = new TimelockController(0, proposers, executors, address(0));

        TimelockedHiveControls controls = new TimelockedHiveControls(address(timelock));

        vm.prank(proposer);
        vm.expectRevert();
        controls.setDefaultFeeBps(5);

        bytes memory payload = abi.encodeCall(controls.setDefaultFeeBps, (uint16(5)));
        bytes32 salt = keccak256("hive-testnet-fee");
        // TimelockController reserves timestamp 1 as its DONE sentinel. Real
        // chains are far beyond it; move the Foundry default timestamp too.
        vm.warp(100);
        vm.prank(proposer);
        timelock.schedule(address(controls), 0, payload, bytes32(0), salt, 0);
        vm.warp(block.timestamp + 1);
        vm.prank(proposer);
        timelock.execute(address(controls), 0, payload, bytes32(0), salt);

        assertEq(controls.defaultFeeBps(), 5);
        assertEq(controls.owner(), address(timelock));
    }
}
