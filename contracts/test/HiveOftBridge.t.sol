// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

import { HiveOFT } from "../src/oft/HiveOFT.sol";
import { HiveOFTAdapter } from "../src/oft/HiveOFTAdapter.sol";
import { HiveBridgeControls } from "../src/oft/HiveBridgeControls.sol";

/// @dev Stand-in for HIVE on Base: vanilla 18-decimal ERC-20, matching the
///      fork-verified lossless behavior of the real DERC20.
contract MockHive is ERC20 {
    constructor() ERC20("HIVE", "HIVE") {}

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}

/// @notice End-to-end tests of the HIVE omnichain bridge over LayerZero's own
///         test endpoints (full ULN pipeline, canonical TestHelperOz5 rig).
contract HiveOftBridgeTest is TestHelperOz5 {
    using OptionsBuilder for bytes;

    uint32 private constant A_EID = 1; // "Base" side
    uint32 private constant B_EID = 2; // "Robinhood" side
    uint64 private constant SHORT_WINDOW = 1 hours;
    uint64 private constant LONG_WINDOW = 1 days;

    MockHive private hive;
    HiveOFTAdapter private adapter;
    HiveOFT private oft;

    address private userA = makeAddr("userA");
    address private userB = makeAddr("userB");
    address private treasury = makeAddr("treasury");
    address private guardian = makeAddr("guardian");
    address private attacker = makeAddr("attacker");

    uint256 private constant INITIAL_BALANCE = 1_000_000 ether;
    uint192 private constant GENEROUS = 1e27;

    function setUp() public virtual override {
        vm.deal(userA, 1000 ether);
        vm.deal(userB, 1000 ether);
        vm.deal(attacker, 10 ether);

        super.setUp();
        setUpEndpoints(2, LibraryType.UltraLightNode);

        hive = new MockHive();
        adapter = new HiveOFTAdapter(address(hive), address(endpoints[A_EID]), address(this));
        oft = new HiveOFT(address(endpoints[B_EID]), address(this));

        address[] memory oapps = new address[](2);
        oapps[0] = address(adapter);
        oapps[1] = address(oft);
        this.wireOApps(oapps);

        _openValve(adapter, B_EID, GENEROUS, GENEROUS, GENEROUS, GENEROUS);
        _openValve(oft, A_EID, GENEROUS, GENEROUS, GENEROUS, GENEROUS);

        hive.mint(userA, INITIAL_BALANCE);
        vm.prank(userA);
        hive.approve(address(adapter), type(uint256).max);
    }

    // ----- helpers -----

    function _openValve(
        HiveBridgeControls _controls,
        uint32 _remoteEid,
        uint192 _outShort,
        uint192 _outLong,
        uint192 _inShort,
        uint192 _inLong
    ) internal {
        RateLimiter.RateLimitConfig[] memory configs = new RateLimiter.RateLimitConfig[](4);
        configs[0] = RateLimiter.RateLimitConfig(_controls.outboundShortKey(_remoteEid), _outShort, SHORT_WINDOW);
        configs[1] = RateLimiter.RateLimitConfig(_controls.outboundLongKey(_remoteEid), _outLong, LONG_WINDOW);
        configs[2] = RateLimiter.RateLimitConfig(_controls.inboundShortKey(_remoteEid), _inShort, SHORT_WINDOW);
        configs[3] = RateLimiter.RateLimitConfig(_controls.inboundLongKey(_remoteEid), _inLong, LONG_WINDOW);
        _controls.setRateLimits(configs);
    }

    function _sendParam(uint32 _dstEid, address _to, uint256 _amount, uint256 _minAmount)
        internal
        pure
        returns (SendParam memory)
    {
        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(500000, 0);
        return SendParam(_dstEid, bytes32(uint256(uint160(_to))), _amount, _minAmount, options, "", "");
    }

    /// @dev Quote + send on the source OApp as `_from`. Does NOT deliver;
    ///      call verifyPackets to execute on the destination.
    function _send(IOFT _srcOApp, address _from, uint32 _dstEid, address _to, uint256 _amount, uint256 _minAmount)
        internal
    {
        SendParam memory param = _sendParam(_dstEid, _to, _amount, _minAmount);
        MessagingFee memory fee = _srcOApp.quoteSend(param, false);
        vm.prank(_from);
        _srcOApp.send{ value: fee.nativeFee }(param, fee, payable(_from));
    }

    function _expectSendReverts(IOFT _srcOApp, address _from, uint32 _dstEid, uint256 _amount, bytes memory _err)
        internal
    {
        SendParam memory param = _sendParam(_dstEid, _from, _amount, 0);
        MessagingFee memory fee = MessagingFee(1 ether, 0);
        vm.prank(_from);
        vm.expectRevert(_err);
        _srcOApp.send{ value: fee.nativeFee }(param, fee, payable(_from));
    }

    // ----- supply conservation -----

    function test_RoundTripConservesSupply() public {
        _send(IOFT(address(adapter)), userA, B_EID, userA, 100 ether, 100 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        assertEq(oft.balanceOf(userA), 100 ether, "twin minted 1:1");
        assertEq(hive.balanceOf(address(adapter)), 100 ether, "HIVE locked 1:1");
        assertEq(oft.totalSupply(), 100 ether, "remote supply == locked");

        _send(IOFT(address(oft)), userA, A_EID, userA, 40 ether, 40 ether);
        verifyPackets(A_EID, addressToBytes32(address(adapter)));

        assertEq(oft.totalSupply(), 60 ether, "burn on the way out");
        assertEq(hive.balanceOf(address(adapter)), 60 ether, "released from lockbox");
        assertEq(hive.balanceOf(userA), INITIAL_BALANCE - 60 ether, "sender got HIVE back");
        assertGe(hive.balanceOf(address(adapter)), oft.totalSupply(), "backing invariant");
    }

    function test_ClosedByDefault() public {
        HiveOFTAdapter adapter2 = new HiveOFTAdapter(address(hive), address(endpoints[A_EID]), address(this));
        HiveOFT oft2 = new HiveOFT(address(endpoints[B_EID]), address(this));
        address[] memory oapps = new address[](2);
        oapps[0] = address(adapter2);
        oapps[1] = address(oft2);
        this.wireOApps(oapps);
        vm.prank(userA);
        hive.approve(address(adapter2), type(uint256).max);

        _expectSendReverts(
            IOFT(address(adapter2)), userA, B_EID, 1 ether,
            abi.encodeWithSelector(RateLimiter.RateLimitExceeded.selector)
        );
    }

    // ----- dual-window rate limits -----

    function test_OutboundShortWindowBinds() public {
        _openValve(adapter, B_EID, 50 ether, GENEROUS, GENEROUS, GENEROUS);
        _expectSendReverts(
            IOFT(address(adapter)), userA, B_EID, 60 ether,
            abi.encodeWithSelector(RateLimiter.RateLimitExceeded.selector)
        );
    }

    function test_OutboundLongWindowBinds() public {
        // Short window generous — the 24h bucket must still stop the flow.
        _openValve(adapter, B_EID, GENEROUS, 50 ether, GENEROUS, GENEROUS);
        _expectSendReverts(
            IOFT(address(adapter)), userA, B_EID, 60 ether,
            abi.encodeWithSelector(RateLimiter.RateLimitExceeded.selector)
        );
    }

    function test_LongWindowCapsCumulativeShortBursts() public {
        // 50/hour, 80/day: two 50-bursts an hour apart must fail on the day bucket.
        _openValve(adapter, B_EID, 50 ether, 80 ether, GENEROUS, GENEROUS);
        _send(IOFT(address(adapter)), userA, B_EID, userA, 50 ether, 50 ether);
        vm.warp(block.timestamp + SHORT_WINDOW); // short bucket fully decayed
        _expectSendReverts(
            IOFT(address(adapter)), userA, B_EID, 50 ether,
            abi.encodeWithSelector(RateLimiter.RateLimitExceeded.selector)
        );
    }

    function test_OutboundRateLimitDecays() public {
        _openValve(adapter, B_EID, 50 ether, 50 ether, GENEROUS, GENEROUS);
        _send(IOFT(address(adapter)), userA, B_EID, userA, 50 ether, 50 ether);
        _expectSendReverts(
            IOFT(address(adapter)), userA, B_EID, 50 ether,
            abi.encodeWithSelector(RateLimiter.RateLimitExceeded.selector)
        );
        vm.warp(block.timestamp + LONG_WINDOW); // both windows fully decayed
        _send(IOFT(address(adapter)), userA, B_EID, userA, 50 ether, 50 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userA), 100 ether, "both sends delivered after decay");
    }

    function test_InboundRateLimitCapsCredit() public {
        _openValve(oft, A_EID, GENEROUS, GENEROUS, 50 ether, GENEROUS);
        _send(IOFT(address(adapter)), userA, B_EID, userB, 60 ether, 60 ether);
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        this.verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userB), 0, "credit blocked by inbound limit");
        assertEq(oft.totalSupply(), 0, "nothing minted");
    }

    function test_InboundBlockedCreditIsRetryableAfterDecay() public {
        _openValve(oft, A_EID, GENEROUS, GENEROUS, 50 ether, 50 ether);
        _send(IOFT(address(adapter)), userA, B_EID, userB, 30 ether, 30 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userB), 30 ether);

        _send(IOFT(address(adapter)), userA, B_EID, userB, 30 ether, 30 ether);
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        this.verifyPackets(B_EID, addressToBytes32(address(oft))); // 30 > 20 remaining

        vm.warp(block.timestamp + LONG_WINDOW);
        verifyPackets(B_EID, addressToBytes32(address(oft))); // retry succeeds
        assertEq(oft.balanceOf(userB), 60 ether, "delayed credit delivered after decay");
    }

    function test_AdapterInboundLimitCapsLockboxDrain() public {
        // The drain-protection path: releases from the lockbox are capped.
        _send(IOFT(address(adapter)), userA, B_EID, userA, 100 ether, 100 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        _openValve(adapter, B_EID, GENEROUS, GENEROUS, 10 ether, GENEROUS);
        _send(IOFT(address(oft)), userA, A_EID, userA, 60 ether, 60 ether);
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        this.verifyPackets(A_EID, addressToBytes32(address(adapter)));
        assertEq(hive.balanceOf(address(adapter)), 100 ether, "lockbox intact");
    }

    function test_EidKeySpaceGuard() public {
        vm.expectRevert(abi.encodeWithSelector(HiveBridgeControls.EidOverflowsKeySpace.selector, 0x40000000));
        adapter.outboundShortKey(0x40000000);
        // real eids are fine
        assertEq(adapter.inboundLongKey(30416), 30416 | 0x80000000 | 0x40000000);
    }

    // ----- fees -----

    function test_FeeChargedAndWithdrawable() public {
        adapter.setDefaultFeeBps(25); // the maximum: 0.25%

        _send(IOFT(address(adapter)), userA, B_EID, userA, 100 ether, 99.75 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        assertEq(oft.balanceOf(userA), 99.75 ether, "remote receives amount minus 25bps");
        assertEq(hive.balanceOf(address(adapter)), 100 ether, "full amount locked");
        assertEq(adapter.bridgeFeesAccrued(), 0.25 ether, "fee accrued");
        assertGe(
            hive.balanceOf(address(adapter)) - adapter.bridgeFeesAccrued(),
            oft.totalSupply(),
            "principal still backs supply"
        );

        adapter.withdrawBridgeFees(treasury);
        assertEq(hive.balanceOf(treasury), 0.25 ether, "fee withdrawn to treasury");
        assertEq(adapter.bridgeFeesAccrued(), 0, "counter cleared");
        assertGe(hive.balanceOf(address(adapter)), oft.totalSupply(), "backing invariant survives withdrawal");

        vm.expectRevert(HiveBridgeControls.NothingToWithdraw.selector);
        adapter.withdrawBridgeFees(treasury);
    }

    function test_OftFeeOnReturnPath() public {
        _send(IOFT(address(adapter)), userA, B_EID, userA, 100 ether, 100 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        oft.setDefaultFeeBps(20); // 0.2% on the way back
        _send(IOFT(address(oft)), userA, A_EID, userA, 100 ether, 99.8 ether);
        verifyPackets(A_EID, addressToBytes32(address(adapter)));

        assertEq(hive.balanceOf(userA), INITIAL_BALANCE - 0.2 ether, "released amount minus fee");
        assertEq(oft.balanceOf(address(oft)), 0.2 ether, "fee parked on the OFT");
        assertEq(oft.totalSupply(), 0.2 ether, "fee tokens are the only remote supply left");
        assertGe(hive.balanceOf(address(adapter)), oft.totalSupply(), "backing invariant");

        oft.withdrawBridgeFees(treasury);
        assertEq(oft.balanceOf(treasury), 0.2 ether, "fee withdrawn on the remote side");
    }

    function test_FeeCapEnforced() public {
        vm.expectRevert(abi.encodeWithSelector(HiveBridgeControls.FeeBpsExceedsCap.selector, 26, 25));
        adapter.setDefaultFeeBps(26);
        vm.expectRevert(abi.encodeWithSelector(HiveBridgeControls.FeeBpsExceedsCap.selector, 100, 25));
        oft.setDefaultFeeBps(100);
    }

    function test_FeeSlippageProtection() public {
        adapter.setDefaultFeeBps(25);
        SendParam memory param = _sendParam(B_EID, userA, 100 ether, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(IOFT.SlippageExceeded.selector, 99.75 ether, 100 ether));
        IOFT(address(adapter)).quoteSend(param, false);
    }

    function test_FeeDustRoundingExact() public {
        adapter.setDefaultFeeBps(25);
        uint256 dusty = 100 ether + 123456; // sub-1e12 dust gets stripped
        _send(IOFT(address(adapter)), userA, B_EID, userA, dusty, 0);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        uint256 sent = 100 ether; // dust removed
        uint256 received = oft.balanceOf(userA);
        assertEq(received % 1e12, 0, "received is shared-decimal exact");
        assertEq(received, 99.75 ether, "25bps of dust-free amount");
        assertEq(adapter.bridgeFeesAccrued(), sent - received, "fee accounting exact");
    }

    function test_DonationsOnlyAddSurplus() public {
        hive.mint(attacker, 10 ether);
        vm.prank(attacker);
        hive.transfer(address(adapter), 10 ether); // direct donation

        assertEq(hive.balanceOf(address(adapter)), 10 ether);
        vm.expectRevert(HiveBridgeControls.NothingToWithdraw.selector);
        adapter.withdrawBridgeFees(treasury); // donations are NOT withdrawable fees
        assertGe(hive.balanceOf(address(adapter)), oft.totalSupply(), "surplus only strengthens backing");
    }

    // ----- pause + guardian -----

    function test_PauseAndGuardianRoles() public {
        adapter.setPauser(guardian);

        vm.prank(userB);
        vm.expectRevert(HiveBridgeControls.NotPauserOrOwner.selector);
        adapter.pause();

        vm.prank(guardian);
        adapter.pause();

        _expectSendReverts(
            IOFT(address(adapter)), userA, B_EID, 1 ether,
            abi.encodeWithSelector(Pausable.EnforcedPause.selector)
        );

        vm.prank(guardian);
        vm.expectRevert(HiveBridgeControls.NotUnpauserOrOwner.selector);
        adapter.unpause();

        adapter.unpause(); // owner
        _send(IOFT(address(adapter)), userA, B_EID, userA, 1 ether, 1 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userA), 1 ether, "flow restored after unpause");
    }

    function test_SafeUnpauserBypassesTimelock() public {
        // Amendment: a designated unpauser (the Safe) may unpause directly,
        // while the guardian still cannot and config stays owner-gated.
        address safe = makeAddr("safe");
        adapter.setPauser(guardian);
        adapter.setUnpauser(safe);

        vm.prank(guardian);
        adapter.pause();

        // guardian still cannot unpause
        vm.prank(guardian);
        vm.expectRevert(HiveBridgeControls.NotUnpauserOrOwner.selector);
        adapter.unpause();

        // random address cannot unpause
        vm.prank(userB);
        vm.expectRevert(HiveBridgeControls.NotUnpauserOrOwner.selector);
        adapter.unpause();

        // the Safe (unpauser) unpauses directly — no timelock
        vm.prank(safe);
        adapter.unpause();
        assertFalse(adapter.paused(), "Safe unpaused directly");

        // but the Safe cannot touch risk-increasing config
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, safe));
        adapter.setDefaultFeeBps(10);
    }

    function test_PausedCreditIsRetryableAfterUnpause() public {
        _send(IOFT(address(adapter)), userA, B_EID, userB, 5 ether, 5 ether);
        oft.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        this.verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userB), 0, "credit blocked while paused");

        oft.unpause();
        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userB), 5 ether, "message retried after unpause");
    }

    function test_GuardianPowerBounds() public {
        adapter.setPauser(guardian);
        RateLimiter.RateLimitConfig[] memory configs = new RateLimiter.RateLimitConfig[](0);
        uint32[] memory keys = new uint32[](0);
        vm.startPrank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        adapter.setRateLimits(configs);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        adapter.resetRateLimits(keys);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        adapter.setDefaultFeeBps(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        adapter.withdrawBridgeFees(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        adapter.setPauser(guardian);
        vm.stopPrank();
    }

    // ----- governance (timelock owner) -----

    function test_TimelockGovernanceFlow() public {
        address[] memory proposers = new address[](1);
        proposers[0] = address(this); // test acts as the Safe
        address[] memory executors = new address[](1);
        executors[0] = address(0); // open execution after delay
        TimelockController timelock = new TimelockController(3 days, proposers, executors, address(0));

        adapter.setPauser(guardian);
        adapter.transferOwnership(address(timelock));
        assertEq(adapter.owner(), address(timelock));

        // guardian pause still works instantly under timelock ownership
        vm.prank(guardian);
        adapter.pause();

        // with no unpauser set, unpause is owner-only — the old owner can't
        vm.expectRevert(HiveBridgeControls.NotUnpauserOrOwner.selector);
        adapter.unpause();

        // unpause must ride the timelock: queue, wait, execute
        bytes memory call = abi.encodeWithSelector(HiveBridgeControls.unpause.selector);
        timelock.schedule(address(adapter), 0, call, bytes32(0), bytes32(0), 3 days);
        vm.expectRevert(); // not ready yet
        timelock.execute(address(adapter), 0, call, bytes32(0), bytes32(0));

        vm.warp(block.timestamp + 3 days);
        timelock.execute(address(adapter), 0, call, bytes32(0), bytes32(0));
        assertFalse(adapter.paused(), "unpaused through the timelock");
    }

    // ----- adversarial -----

    function test_ForgedLzReceiveRejected() public {
        // An attacker calling lzReceive directly (bypassing the endpoint) must be rejected.
        vm.prank(attacker);
        vm.expectRevert();
        adapter.lzReceive(
            _origin(B_EID, addressToBytes32(address(oft)), 1),
            bytes32(uint256(1)),
            abi.encodePacked(addressToBytes32(attacker), uint64(1_000_000)),
            attacker,
            ""
        );
    }

    function test_UnwiredPeerCannotSend() public {
        HiveOFT oft3 = new HiveOFT(address(endpoints[B_EID]), address(this));
        SendParam memory param = _sendParam(A_EID, userA, 1 ether, 0);
        vm.expectRevert(); // NoPeer
        oft3.quoteSend(param, false);
    }

    function _origin(uint32 _srcEid, bytes32 _sender, uint64 _nonce)
        internal
        pure
        returns (Origin memory)
    {
        return Origin(_srcEid, _sender, _nonce);
    }

    // ----- admin surface -----

    function test_NoOwnerMintOnTwin() public {
        assertEq(oft.totalSupply(), 0);
        _send(IOFT(address(adapter)), userA, B_EID, userA, 5 ether, 5 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.totalSupply(), 5 ether, "supply moves only through the bridge");
    }

    function test_OnlyOwnerControls() public {
        RateLimiter.RateLimitConfig[] memory configs = new RateLimiter.RateLimitConfig[](0);
        vm.startPrank(userB);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userB));
        adapter.setRateLimits(configs);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userB));
        adapter.setDefaultFeeBps(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userB));
        adapter.withdrawBridgeFees(userB);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userB));
        adapter.setPauser(userB);
        vm.stopPrank();
    }
}
