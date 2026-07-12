// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";

/// @title HiveBridgeControls — shared safety rails for the HIVE omnichain bridge
/// @notice Composes three controls on top of the stock LayerZero OFT pattern:
///
///  1. DUAL-WINDOW RATE LIMITS (LayerZero's audited RateLimiter, unmodified
///     math). Every direction is bounded by TWO nested buckets — a short
///     window (intended: 1 hour) that slows an attacker immediately, and a
///     long window (intended: 24 hours) that caps total daily loss. Every
///     debit consumes both outbound buckets; every credit consumes both
///     inbound buckets. The INBOUND limits are the load-bearing ones: they cap
///     the lockbox-drain / unbacked-mint rate even if the DVN set is
///     compromised and messages are forged — the one attack the OFT standard
///     itself cannot stop. A blocked inbound credit stays verified on the
///     endpoint and can be re-executed permissionlessly once capacity decays:
///     delayed, never lost.
///     Bucket keys pack a direction/window flag into the top bits of the eid
///     (real LayerZero eids are far below 2^30; helpers revert if not).
///     Buckets default to limit 0 — the bridge deploys CLOSED and stays closed
///     until the owner explicitly sets limits (a separate, unmistakable
///     activation step).
///
///  2. BRIDGE FEE, hard-capped at 25 bps. Default 0 (launch behavior identical
///     to the stock OFT / ClawBank). The cap is a compile-time constant, so
///     "the owner rugs holders with a high fee" is structurally impossible,
///     and a low cap keeps cross-chain arbitrage friction small so price
///     parity stays tight. One flat fee per contract; per-destination
///     overrides were deliberately removed (each chain's contract already has
///     its own fee — overrides add surface without launch value).
///
///  3. PAUSE. `pause()` halts both directions for incident response; inbound
///     messages received while paused stay retriable on the endpoint. A
///     dedicated `pauser` (hot guardian) may pause; only the owner may unpause
///     or change the pauser. Fail-safe: the guardian can stop the bridge but
///     cannot start, configure, or drain it. Intended owner is a
///     TimelockController proposed to by a Safe, so every risk-increasing
///     action (unpause, limits, fees, peers, DVNs) is publicly queued and
///     delayed, while pause stays immediate.
abstract contract HiveBridgeControls is Ownable, Pausable, RateLimiter {
    uint16 public constant MAX_BRIDGE_FEE_BPS = 25; // 0.25% — immutable ceiling
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @dev Key-space flags. Real eids must stay below OUTBOUND_LONG_FLAG.
    uint32 public constant OUTBOUND_LONG_FLAG = 0x40000000;
    uint32 public constant INBOUND_FLAG = 0x80000000;

    /// @notice Flat fee applied to every bridge transfer from this side. Starts at 0.
    uint16 public defaultFeeBps;
    /// @notice Guardian allowed to pause (not unpause). address(0) = owner only.
    address public pauser;
    /// @notice Address allowed to unpause WITHOUT the owner timelock delay.
    ///         Intended: the governing Safe. Rationale — unpause only restores
    ///         already-configured, already-rate-limited operation; it cannot
    ///         move funds, mint, or change limits/DVNs/fees. Routing it through
    ///         the 72h timelock (as every risk-INCREASING action is) would turn
    ///         a false-alarm pause into a multi-day forced outage, which is its
    ///         own harm. The Safe's own multisig quorum is the control here.
    ///         address(0) = owner-only unpause (rides the timelock).
    address public unpauser;

    event DefaultBridgeFeeSet(uint16 feeBps);
    event PauserSet(address indexed pauser);
    event UnpauserSet(address indexed unpauser);
    event BridgeFeesWithdrawn(address indexed to, uint256 amount);

    error FeeBpsExceedsCap(uint16 feeBps, uint16 cap);
    error NotPauserOrOwner();
    error NotUnpauserOrOwner();
    error NothingToWithdraw();
    error EidOverflowsKeySpace(uint32 eid);

    // ----- fee -----

    function setDefaultFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > MAX_BRIDGE_FEE_BPS) revert FeeBpsExceedsCap(_feeBps, MAX_BRIDGE_FEE_BPS);
        defaultFeeBps = _feeBps;
        emit DefaultBridgeFeeSet(_feeBps);
    }

    /// @notice Fee charged for bridging `_amount` out of this chain.
    function getFee(uint256 _amount) public view returns (uint256) {
        uint16 bps = defaultFeeBps;
        return bps == 0 ? 0 : (_amount * bps) / BPS_DENOMINATOR;
    }

    // ----- rate-limit keys (short = raw eid) -----

    function outboundShortKey(uint32 _eid) public pure returns (uint32) {
        _checkEid(_eid);
        return _eid;
    }

    function outboundLongKey(uint32 _eid) public pure returns (uint32) {
        _checkEid(_eid);
        return _eid | OUTBOUND_LONG_FLAG;
    }

    function inboundShortKey(uint32 _eid) public pure returns (uint32) {
        _checkEid(_eid);
        return _eid | INBOUND_FLAG;
    }

    function inboundLongKey(uint32 _eid) public pure returns (uint32) {
        _checkEid(_eid);
        return _eid | INBOUND_FLAG | OUTBOUND_LONG_FLAG;
    }

    function _checkEid(uint32 _eid) private pure {
        if (_eid >= OUTBOUND_LONG_FLAG) revert EidOverflowsKeySpace(_eid);
    }

    /// @dev Every send must fit BOTH outbound windows.
    function _consumeOutbound(uint32 _dstEid, uint256 _amount) internal {
        _outflow(outboundShortKey(_dstEid), _amount);
        _outflow(outboundLongKey(_dstEid), _amount);
    }

    /// @dev Every credit must fit BOTH inbound windows.
    function _consumeInbound(uint32 _srcEid, uint256 _amount) internal {
        _outflow(inboundShortKey(_srcEid), _amount);
        _outflow(inboundLongKey(_srcEid), _amount);
    }

    // ----- rate-limit admin -----

    /// @notice Set bucket limits/windows. Keys come from the *Key helpers.
    ///         This is THE bridge-opening action: deployments start at 0.
    function setRateLimits(RateLimitConfig[] calldata _configs) external onlyOwner {
        _setRateLimits(_configs);
    }

    /// @notice Zero the in-flight amount of the given buckets. Post-incident
    ///         tool only — never reset capacity during an active incident.
    function resetRateLimits(uint32[] calldata _keys) external onlyOwner {
        _resetRateLimits(_keys);
    }

    // ----- pause -----

    function setPauser(address _pauser) external onlyOwner {
        pauser = _pauser;
        emit PauserSet(_pauser);
    }

    function setUnpauser(address _unpauser) external onlyOwner {
        unpauser = _unpauser;
        emit UnpauserSet(_unpauser);
    }

    function pause() external {
        if (msg.sender != pauser && msg.sender != owner()) revert NotPauserOrOwner();
        _pause();
    }

    /// @dev Owner (timelock) OR the designated unpauser (Safe) may unpause.
    ///      See the `unpauser` docs for why unpause deliberately bypasses the
    ///      timelock while all risk-increasing config does not.
    function unpause() external {
        if (msg.sender != unpauser && msg.sender != owner()) revert NotUnpauserOrOwner();
        _unpause();
    }
}
