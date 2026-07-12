// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { HiveBridgeControls } from "./HiveBridgeControls.sol";

/// @title HiveOFT — the omnichain HIVE twin (Robinhood Chain and any future chain)
/// @notice Remote-chain half of the HIVE omnichain bridge (ClawBank's mechanism,
///         hardened). Native mint/burn LayerZero OFT: HIVE is MINTED here only
///         when the Base adapter locks the matching HIVE and LayerZero delivers
///         the message (lzReceive), and BURNED here when a holder bridges out.
///         On top of the stock OFT it adds HiveBridgeControls: bidirectional
///         rate limits, a hard-capped (≤1%) bridge fee defaulting to 0, and
///         pause with a guardian pauser.
/// @dev    There is intentionally NO owner mint function. The only mint path is
///         OFTCore._credit (called from lzReceive); the only burn path is the
///         send-side _debit. Fees never mint: they are tokens the sender was
///         already debited, parked on this contract until withdrawn. This is
///         the invariant that keeps remote supply == HIVE locked in the Base
///         adapter. Do NOT add an owner-callable mint.
/// @dev    18 decimals match HIVE on Base; LayerZero's 6 shared decimals cap
///         representable supply at ~18.4T tokens — HIVE's 100B fits with ~180x
///         headroom (verified against OFTCore's uint64 amountSD encoding).
contract HiveOFT is OFT, HiveBridgeControls {
    /// @param _lzEndpoint the LayerZero EndpointV2 on the local (remote) chain
    /// @param _delegate   owner + LayerZero delegate (MUST be a multisig)
    constructor(
        address _lzEndpoint,
        address _delegate
    ) OFT("HIVE", "HIVE", _lzEndpoint, _delegate) Ownable(_delegate) {}

    /// @dev Stock dust/slippage handling plus the (default-0) bridge fee:
    ///      the remote receives amountSentLD minus fee, re-dusted.
    function _debitView(
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 /*_dstEid*/
    ) internal view override returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        amountSentLD = _removeDust(_amountLD);
        amountReceivedLD = _removeDust(amountSentLD - getFee(amountSentLD));
        if (amountReceivedLD < _minAmountLD) revert SlippageExceeded(amountReceivedLD, _minAmountLD);
    }

    /// @dev Outbound: dual-window rate-limited + pausable. Burns what the
    ///      remote will mint; the fee portion moves to this contract instead
    ///      of being burned, so sender debit == amountSentLD exactly, and
    ///      nothing unbacked exists.
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal override whenNotPaused returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        (amountSentLD, amountReceivedLD) = _debitView(_amountLD, _minAmountLD, _dstEid);
        _consumeOutbound(_dstEid, amountSentLD);
        uint256 fee = amountSentLD - amountReceivedLD;
        if (fee > 0) _transfer(_from, address(this), fee);
        _burn(_from, amountReceivedLD);
    }

    /// @dev Inbound: dual-window rate-limited + pausable. A credit exceeding
    ///      either window reverts; the message stays verified on the endpoint
    ///      and can be re-executed once capacity decays — delayed, never lost.
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 _srcEid
    ) internal override whenNotPaused returns (uint256 amountReceivedLD) {
        _consumeInbound(_srcEid, _amountLD);
        return super._credit(_to, _amountLD, _srcEid);
    }

    /// @notice Withdraw accrued bridge fees (this contract's own balance).
    function withdrawBridgeFees(address _to) external onlyOwner {
        uint256 amount = balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();
        _transfer(address(this), _to, amount);
        emit BridgeFeesWithdrawn(_to, amount);
    }
}
