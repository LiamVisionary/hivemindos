// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HiveStakeVault
/// @notice Non-custodial HIVE stake-to-unlock vault for community tiers.
/// @dev No rewards, slashing, admin principal movement, or treasury custody.
contract HiveStakeVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ABSOLUTE_MAX_COOLDOWN = 30 days;

    struct PendingUnstake {
        uint256 amount;
        uint64 availableAt;
    }

    error ZeroAddress();
    error ZeroAmount();
    error CooldownTooLong(uint256 requested, uint256 max);
    error InsufficientStake(uint256 requested, uint256 available);
    error PendingUnstakeExists(uint256 amount, uint64 availableAt);
    error NoPendingUnstake();
    error UnstakeCooldownActive(uint64 availableAt);
    error CannotRescueHive();

    IERC20 public immutable hive;
    uint256 public immutable maxCooldown;
    uint256 public cooldown;
    uint256 public totalStaked;

    mapping(address account => uint256 amount) public stakedBalanceOf;
    mapping(address account => PendingUnstake pending) private pendingUnstakes;

    event Staked(address indexed account, uint256 amount);
    event UnstakeRequested(address indexed account, uint256 amount, uint64 availableAt);
    event Unstaked(address indexed account, uint256 amount);
    event CooldownChanged(uint256 oldCooldown, uint256 newCooldown);
    event NonHiveTokenRescued(address indexed token, address indexed to, uint256 amount);

    constructor(IERC20 hiveToken, address initialOwner, uint256 initialCooldown, uint256 maxCooldown_)
        Ownable(initialOwner)
    {
        if (address(hiveToken) == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (maxCooldown_ > ABSOLUTE_MAX_COOLDOWN) revert CooldownTooLong(maxCooldown_, ABSOLUTE_MAX_COOLDOWN);
        if (initialCooldown > maxCooldown_) revert CooldownTooLong(initialCooldown, maxCooldown_);

        hive = hiveToken;
        cooldown = initialCooldown;
        maxCooldown = maxCooldown_;
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        stakedBalanceOf[msg.sender] += amount;
        totalStaked += amount;

        hive.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        PendingUnstake memory existing = pendingUnstakes[msg.sender];
        if (existing.amount != 0) revert PendingUnstakeExists(existing.amount, existing.availableAt);

        uint256 activeStake = stakedBalanceOf[msg.sender];
        if (activeStake < amount) revert InsufficientStake(amount, activeStake);

        // The cast is safe: Unix timestamps plus a 30-day max cooldown fit in uint64 for centuries.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 availableAt = uint64(block.timestamp + cooldown);
        stakedBalanceOf[msg.sender] = activeStake - amount;
        totalStaked -= amount;
        pendingUnstakes[msg.sender] = PendingUnstake({amount: amount, availableAt: availableAt});

        emit UnstakeRequested(msg.sender, amount, availableAt);
    }

    function withdrawUnstaked() external nonReentrant {
        PendingUnstake memory pending = pendingUnstakes[msg.sender];
        if (pending.amount == 0) revert NoPendingUnstake();
        // Timestamp drift is acceptable for a multi-day unstake cooldown; no randomness or auction logic depends on it.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < pending.availableAt) revert UnstakeCooldownActive(pending.availableAt);

        delete pendingUnstakes[msg.sender];
        hive.safeTransfer(msg.sender, pending.amount);

        emit Unstaked(msg.sender, pending.amount);
    }

    function pendingUnstakeOf(address account) external view returns (uint256) {
        return pendingUnstakes[account].amount;
    }

    function unstakeAvailableAt(address account) external view returns (uint256) {
        return pendingUnstakes[account].availableAt;
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        if (newCooldown > maxCooldown) revert CooldownTooLong(newCooldown, maxCooldown);

        uint256 oldCooldown = cooldown;
        cooldown = newCooldown;
        emit CooldownChanged(oldCooldown, newCooldown);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue non-HIVE ERC-20 tokens accidentally sent to this vault.
    /// @dev The HIVE principal token is explicitly excluded.
    function rescueNonHiveToken(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (address(token) == address(0) || to == address(0)) revert ZeroAddress();
        if (address(token) == address(hive)) revert CannotRescueHive();

        token.safeTransfer(to, amount);
        emit NonHiveTokenRescued(address(token), to, amount);
    }
}
