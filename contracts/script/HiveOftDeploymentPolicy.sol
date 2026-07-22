// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { HiveOftAddresses } from "./HiveOftAddresses.sol";

/// @notice Chain-specific deployment safety policy shared by bridge scripts.
/// @dev Mainnet ceremony constraints belong in executable code, not only in a
///      runbook. Testnet deliberately permits a zero-delay timelock so a full
///      rehearsal can complete in one session.
library HiveOftDeploymentPolicy {
    uint256 internal constant MAINNET_MIN_TIMELOCK_DELAY = 72 hours;
    uint16 internal constant TESTNET_BRIDGE_FEE_BPS = 5;

    error MainnetDelayTooShort(uint256 actual, uint256 minimum);
    error NotTestnet(uint256 chainId);
    error UnsupportedChain(uint256 chainId);

    function requireGovernanceDelay(uint256 _chainId, uint256 _delay) internal pure {
        if (isMainnet(_chainId)) {
            if (_delay < MAINNET_MIN_TIMELOCK_DELAY) {
                revert MainnetDelayTooShort(_delay, MAINNET_MIN_TIMELOCK_DELAY);
            }
            return;
        }
        if (isTestnet(_chainId)) return;
        revert UnsupportedChain(_chainId);
    }

    function requireTestnetChain(uint256 _chainId) internal pure {
        if (isTestnet(_chainId)) return;
        if (isMainnet(_chainId)) revert NotTestnet(_chainId);
        revert UnsupportedChain(_chainId);
    }

    function isMainnet(uint256 _chainId) internal pure returns (bool) {
        return _chainId == HiveOftAddresses.BASE_CHAIN_ID
            || _chainId == HiveOftAddresses.ROBINHOOD_CHAIN_ID;
    }

    function isTestnet(uint256 _chainId) internal pure returns (bool) {
        return _chainId == HiveOftAddresses.BASE_SEPOLIA_CHAIN_ID
            || _chainId == HiveOftAddresses.ROBINHOOD_TESTNET_CHAIN_ID;
    }
}
