// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { OFTAdapter } from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { HiveBridgeControls } from "./HiveBridgeControls.sol";

/// @title HiveOFTAdapter — Base-side lockbox for omnichain HIVE
/// @notice Home-chain half of the HIVE omnichain bridge (ClawBank's mechanism,
///         hardened). Wraps the EXISTING HIVE ERC-20 on Base; never mints it.
///         Bridge-out LOCKS HIVE here and the remote twin mints; bridge-in
///         RELEASES from this balance. Every remote HIVE is backed 1:1 by HIVE
///         locked here. Adds HiveBridgeControls: bidirectional rate limits
///         (the inbound one caps lockbox drain even under DVN compromise), a
///         hard-capped (≤0.25%) bridge fee defaulting to 0, and pause.
/// @dev    Deploy EXACTLY ONE adapter across the entire mesh. A second lockbox
///         for the same underlying token would let the same locked HIVE back
///         two independent mints — the classic double-spend break. New chains
///         mean new peers on THIS adapter, never a new adapter.
/// @dev    HIVE (DERC20) was fork-verified lossless on transfer/transferFrom
///         (no fee-on-transfer, no rebasing), which the lockbox math requires.
/// @dev    Fee accounting: fees stay inside the lockbox and are tracked in
///         `bridgeFeesAccrued`; withdrawal is capped to that counter, so the
///         owner can NEVER touch locked principal and locked ≥ minted holds.
contract HiveOFTAdapter is OFTAdapter, HiveBridgeControls {
    using SafeERC20 for IERC20;

    /// @notice Fee tokens accrued in the lockbox, withdrawable by the owner.
    uint256 public bridgeFeesAccrued;

    /// @param _hiveToken  the existing HIVE ERC-20 on Base
    /// @param _lzEndpoint the LayerZero EndpointV2 on Base
    /// @param _delegate   owner + LayerZero delegate (MUST be a multisig)
    constructor(
        address _hiveToken,
        address _lzEndpoint,
        address _delegate
    ) OFTAdapter(_hiveToken, _lzEndpoint, _delegate) Ownable(_delegate) {}

    /// @dev Stock dust/slippage handling plus the (default-0) bridge fee.
    function _debitView(
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 /*_dstEid*/
    ) internal view override returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        amountSentLD = _removeDust(_amountLD);
        amountReceivedLD = _removeDust(amountSentLD - getFee(amountSentLD));
        if (amountReceivedLD < _minAmountLD) revert SlippageExceeded(amountReceivedLD, _minAmountLD);
    }

    /// @dev Outbound: dual-window rate-limited + pausable. Locks the full
    ///      amountSentLD; the remote mints amountReceivedLD; the difference is
    ///      fee surplus tracked in bridgeFeesAccrued.
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal override whenNotPaused returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        (amountSentLD, amountReceivedLD) = _debitView(_amountLD, _minAmountLD, _dstEid);
        _consumeOutbound(_dstEid, amountSentLD);
        uint256 fee = amountSentLD - amountReceivedLD;
        if (fee > 0) bridgeFeesAccrued += fee;
        innerToken.safeTransferFrom(_from, address(this), amountSentLD);
    }

    /// @dev Inbound: dual-window rate-limited + pausable — THE brake on
    ///      lockbox drain. A credit exceeding either window reverts; the
    ///      message stays verified on the endpoint and can be re-executed
    ///      once capacity decays.
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 _srcEid
    ) internal override whenNotPaused returns (uint256 amountReceivedLD) {
        _consumeInbound(_srcEid, _amountLD);
        return super._credit(_to, _amountLD, _srcEid);
    }

    /// @notice Withdraw accrued bridge fees. Hard-capped to bridgeFeesAccrued —
    ///         locked principal is unreachable by construction.
    function withdrawBridgeFees(address _to) external onlyOwner {
        uint256 amount = bridgeFeesAccrued;
        if (amount == 0) revert NothingToWithdraw();
        bridgeFeesAccrued = 0;
        innerToken.safeTransfer(_to, amount);
        emit BridgeFeesWithdrawn(_to, amount);
    }
}
