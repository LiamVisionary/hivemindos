// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Phase A — deploy the governance timelock for one chain. Run once
///         per chain BEFORE deploying the bridge contracts, then pass the
///         printed timelock address as HIVE_OFT_OWNER to the deploy scripts
///         (it becomes both owner and LayerZero delegate).
///
/// Roles:
///   - Safe (HIVE_SAFE)            → PROPOSER + CANCELLER
///   - guardian (HIVE_GUARDIAN)    → CANCELLER only (kill malicious queues)
///   - anyone                      → EXECUTOR after the delay (open execution)
///   - deployer                    → temporary admin, RENOUNCED in this script
///
/// Delay: HIVE_TIMELOCK_DELAY seconds (default 72h). This gates every
/// risk-increasing action including unpause — a false-alarm pause therefore
/// costs a full delay to reopen. Choose consciously at the ceremony; the
/// tradeoff is documented in the runbook.
///
///   HIVE_SAFE=0x<safe> [HIVE_GUARDIAN=0x<hot>] [HIVE_TIMELOCK_DELAY=259200] \
///   forge script script/DeployHiveGovernance.s.sol --rpc-url "$RPC_URL" \
///     [--account <deployer> --broadcast]
contract DeployHiveGovernance is Script {
    function run() external returns (address timelock) {
        address safe = vm.envAddress("HIVE_SAFE");
        require(safe != address(0), "HIVE_SAFE unset");
        address guardian = vm.envOr("HIVE_GUARDIAN", address(0));
        uint256 delay = vm.envOr("HIVE_TIMELOCK_DELAY", uint256(72 hours));
        (, address deployer, ) = vm.readCallers();

        address[] memory proposers = new address[](1);
        proposers[0] = safe; // proposer (and canceller, granted by constructor)
        address[] memory executors = new address[](1);
        executors[0] = address(0); // open execution after delay

        vm.startBroadcast();
        TimelockController tl = new TimelockController(delay, proposers, executors, deployer);
        if (guardian != address(0)) {
            tl.grantRole(tl.CANCELLER_ROLE(), guardian);
        }
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), deployer); // timelock self-administers from here
        vm.stopBroadcast();

        timelock = address(tl);
        console2.log("TimelockController:", timelock);
        console2.log("  chain:      ", block.chainid);
        console2.log("  delay (s):  ", delay);
        console2.log("  proposer:   ", safe);
        console2.log("  canceller+: ", guardian);
        console2.log("USE THIS ADDRESS AS HIVE_OFT_OWNER FOR THE BRIDGE DEPLOYS");
    }
}
