// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";

/// @title HiveBridgeControls — shared safety rails for the HIVE omnichain bridge
/// @notice Composes three controls on top of the stock LayerZero OFT pattern:
///
///  1. RATE LIMITS (LayerZero's audited RateLimiter, unmodified math). Both
///     directions are limited: outbound sends consume the bucket keyed by the
///     destination eid; inbound credits consume a SEPARATE bucket keyed by
///     `srcEid | INBOUND_RATE_LIMIT_FLAG`. The inbound limit is the load-bearing
///     one: it caps the drain rate of the Base lockbox (and the unbacked-mint
///     rate on the twin) even if the DVN set is compromised and messages are
///     forged — the one attack the OFT standard itself cannot stop. An inbound
///     credit that exceeds the window reverts; the LayerZero message stays
///     verified on the endpoint and can be re-executed permissionlessly once
///     capacity decays, so funds are delayed, never lost.
///     NOTE: buckets default to limit 0 — the bridge is CLOSED until the owner
///     calls setRateLimits (the wire script does this). Closed-by-default is
///     deliberate: opening the valve is an explicit, auditable act.
///
///  2. BRIDGE FEE, hard-capped. Fee in bps taken from the bridged amount,
///     default 0 (launch behavior identical to the stock OFT / ClawBank).
///     The owner can never set a fee above MAX_BRIDGE_FEE_BPS (1%) — the cap
///     is a compile-time constant, so "the owner rugs holders with a 100% fee"
///     is structurally impossible. Modeled on LayerZero's Fee.sol, re-written
///     only to add the cap (Fee.sol's setters are not virtual).
///
///  3. PAUSE. `pause()` halts both directions (send and credit) for incident
///     response; inbound messages received while paused stay retriable on the
///     endpoint. A dedicated `pauser` (hot guardian bot) may pause; only the
///     owner (multisig) may unpause or change the pauser. Fail-safe: the
///     guardian can stop the bridge but cannot start, configure, or drain it.
abstract contract HiveBridgeControls is Ownable, Pausable, RateLimiter {
    uint16 public constant MAX_BRIDGE_FEE_BPS = 100; // 1% — immutable ceiling
    uint16 public constant BPS_DENOMINATOR = 10_000;
    /// @dev Real LayerZero eids are far below 2^31, so flagging the top bit
    ///      yields a collision-free key space for inbound buckets.
    uint32 public constant INBOUND_RATE_LIMIT_FLAG = 0x80000000;

    struct BridgeFeeConfig {
        uint16 feeBps;
        bool enabled;
    }

    /// @notice Fee applied to any destination without an explicit override. Starts at 0.
    uint16 public defaultFeeBps;
    /// @notice Per-destination fee override (used only when enabled).
    mapping(uint32 dstEid => BridgeFeeConfig config) public feeOverrides;
    /// @notice Guardian allowed to pause (not unpause). address(0) = owner only.
    address public pauser;

    event DefaultBridgeFeeSet(uint16 feeBps);
    event BridgeFeeOverrideSet(uint32 indexed dstEid, uint16 feeBps, bool enabled);
    event PauserSet(address indexed pauser);
    event BridgeFeesWithdrawn(address indexed to, uint256 amount);

    error FeeBpsExceedsCap(uint16 feeBps, uint16 cap);
    error NotPauserOrOwner();
    error NothingToWithdraw();

    // ----- fee -----

    function setDefaultFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > MAX_BRIDGE_FEE_BPS) revert FeeBpsExceedsCap(_feeBps, MAX_BRIDGE_FEE_BPS);
        defaultFeeBps = _feeBps;
        emit DefaultBridgeFeeSet(_feeBps);
    }

    function setFeeBpsOverride(uint32 _dstEid, uint16 _feeBps, bool _enabled) external onlyOwner {
        if (_feeBps > MAX_BRIDGE_FEE_BPS) revert FeeBpsExceedsCap(_feeBps, MAX_BRIDGE_FEE_BPS);
        feeOverrides[_dstEid] = BridgeFeeConfig(_feeBps, _enabled);
        emit BridgeFeeOverrideSet(_dstEid, _feeBps, _enabled);
    }

    /// @notice Fee charged for bridging `_amount` toward `_dstEid`.
    function getFee(uint32 _dstEid, uint256 _amount) public view returns (uint256) {
        BridgeFeeConfig memory config = feeOverrides[_dstEid];
        uint16 bps = config.enabled ? config.feeBps : defaultFeeBps;
        return bps == 0 ? 0 : (_amount * bps) / BPS_DENOMINATOR;
    }

    // ----- rate limits -----

    /// @notice Set outbound (key = dstEid) and inbound (key = srcEid | flag) buckets.
    function setRateLimits(RateLimitConfig[] calldata _configs) external onlyOwner {
        _setRateLimits(_configs);
    }

    /// @notice Zero the in-flight amount of the given buckets (post-incident reset).
    function resetRateLimits(uint32[] calldata _keys) external onlyOwner {
        _resetRateLimits(_keys);
    }

    /// @notice Key of the inbound bucket for a source eid (for setRateLimits / monitoring).
    function inboundRateLimitKey(uint32 _srcEid) public pure returns (uint32) {
        return _srcEid | INBOUND_RATE_LIMIT_FLAG;
    }

    // ----- pause -----

    function setPauser(address _pauser) external onlyOwner {
        pauser = _pauser;
        emit PauserSet(_pauser);
    }

    function pause() external {
        if (msg.sender != pauser && msg.sender != owner()) revert NotPauserOrOwner();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
