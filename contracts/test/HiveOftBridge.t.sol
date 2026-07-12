// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

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

    MockHive private hive;
    HiveOFTAdapter private adapter;
    HiveOFT private oft;

    address private userA = makeAddr("userA");
    address private userB = makeAddr("userB");
    address private treasury = makeAddr("treasury");
    address private guardian = makeAddr("guardian");

    uint256 private constant INITIAL_BALANCE = 1_000_000 ether;
    uint192 private constant GENEROUS_LIMIT = 1e27;
    uint64 private constant WINDOW = 1 days;

    function setUp() public virtual override {
        vm.deal(userA, 1000 ether);
        vm.deal(userB, 1000 ether);

        super.setUp();
        setUpEndpoints(2, LibraryType.UltraLightNode);

        hive = new MockHive();
        adapter = new HiveOFTAdapter(address(hive), address(endpoints[A_EID]), address(this));
        oft = new HiveOFT(address(endpoints[B_EID]), address(this));

        address[] memory oapps = new address[](2);
        oapps[0] = address(adapter);
        oapps[1] = address(oft);
        this.wireOApps(oapps);

        _openValve(adapter, B_EID, GENEROUS_LIMIT, GENEROUS_LIMIT);
        _openValve(oft, A_EID, GENEROUS_LIMIT, GENEROUS_LIMIT);

        hive.mint(userA, INITIAL_BALANCE);
        vm.prank(userA);
        hive.approve(address(adapter), type(uint256).max);
    }

    // ----- helpers -----

    function _openValve(
        HiveBridgeControls _controls,
        uint32 _remoteEid,
        uint192 _outboundLimit,
        uint192 _inboundLimit
    ) internal {
        RateLimiter.RateLimitConfig[] memory configs = new RateLimiter.RateLimitConfig[](2);
        configs[0] = RateLimiter.RateLimitConfig({ dstEid: _remoteEid, limit: _outboundLimit, window: WINDOW });
        configs[1] = RateLimiter.RateLimitConfig({
            dstEid: _controls.inboundRateLimitKey(_remoteEid),
            limit: _inboundLimit,
            window: WINDOW
        });
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
        // A freshly deployed, wired pair with NO rate limits set must refuse flow.
        HiveOFTAdapter adapter2 = new HiveOFTAdapter(address(hive), address(endpoints[A_EID]), address(this));
        HiveOFT oft2 = new HiveOFT(address(endpoints[B_EID]), address(this));
        address[] memory oapps = new address[](2);
        oapps[0] = address(adapter2);
        oapps[1] = address(oft2);
        this.wireOApps(oapps);
        vm.prank(userA);
        hive.approve(address(adapter2), type(uint256).max);

        SendParam memory param = _sendParam(B_EID, userA, 1 ether, 1 ether);
        MessagingFee memory fee = IOFT(address(adapter2)).quoteSend(param, false);
        vm.prank(userA);
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        IOFT(address(adapter2)).send{ value: fee.nativeFee }(param, fee, payable(userA));
    }

    // ----- rate limits -----

    function test_OutboundRateLimitEnforced() public {
        _openValve(adapter, B_EID, 50 ether, GENEROUS_LIMIT);

        SendParam memory param = _sendParam(B_EID, userA, 60 ether, 60 ether);
        MessagingFee memory fee = IOFT(address(adapter)).quoteSend(param, false);
        vm.prank(userA);
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        IOFT(address(adapter)).send{ value: fee.nativeFee }(param, fee, payable(userA));
    }

    function test_OutboundRateLimitDecays() public {
        _openValve(adapter, B_EID, 50 ether, GENEROUS_LIMIT);

        _send(IOFT(address(adapter)), userA, B_EID, userA, 50 ether, 50 ether); // fills the window

        SendParam memory param = _sendParam(B_EID, userA, 50 ether, 50 ether);
        MessagingFee memory fee = IOFT(address(adapter)).quoteSend(param, false);
        vm.prank(userA);
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        IOFT(address(adapter)).send{ value: fee.nativeFee }(param, fee, payable(userA));

        vm.warp(block.timestamp + WINDOW); // full decay
        _send(IOFT(address(adapter)), userA, B_EID, userA, 50 ether, 50 ether);

        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userA), 100 ether, "both sends delivered after decay");
    }

    function test_InboundRateLimitCapsCredit() public {
        // Outbound on the adapter is generous; the OFT's INBOUND bucket is the brake.
        _openValve(oft, A_EID, GENEROUS_LIMIT, 50 ether);

        _send(IOFT(address(adapter)), userA, B_EID, userB, 60 ether, 60 ether);

        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        this.verifyPackets(B_EID, addressToBytes32(address(oft)));

        assertEq(oft.balanceOf(userB), 0, "credit blocked by inbound limit");
        assertEq(oft.totalSupply(), 0, "nothing minted");
    }

    // ----- fees -----

    function test_FeeChargedAndWithdrawable() public {
        adapter.setDefaultFeeBps(100); // 1%

        _send(IOFT(address(adapter)), userA, B_EID, userA, 100 ether, 99 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        assertEq(oft.balanceOf(userA), 99 ether, "remote receives amount minus 1% fee");
        assertEq(hive.balanceOf(address(adapter)), 100 ether, "full amount locked");
        assertEq(adapter.bridgeFeesAccrued(), 1 ether, "fee accrued");
        assertGe(hive.balanceOf(address(adapter)) - adapter.bridgeFeesAccrued(), oft.totalSupply(), "principal still backs supply");

        adapter.withdrawBridgeFees(treasury);
        assertEq(hive.balanceOf(treasury), 1 ether, "fee withdrawn to treasury");
        assertEq(adapter.bridgeFeesAccrued(), 0, "counter cleared");
        assertGe(hive.balanceOf(address(adapter)), oft.totalSupply(), "backing invariant survives withdrawal");

        vm.expectRevert(HiveBridgeControls.NothingToWithdraw.selector);
        adapter.withdrawBridgeFees(treasury);
    }

    function test_OftFeeOnReturnPath() public {
        _send(IOFT(address(adapter)), userA, B_EID, userA, 100 ether, 100 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));

        oft.setDefaultFeeBps(50); // 0.5% on the way back
        _send(IOFT(address(oft)), userA, A_EID, userA, 100 ether, 99.5 ether);
        verifyPackets(A_EID, addressToBytes32(address(adapter)));

        assertEq(hive.balanceOf(userA), INITIAL_BALANCE - 0.5 ether, "released amount minus fee");
        assertEq(oft.balanceOf(address(oft)), 0.5 ether, "fee parked on the OFT");
        assertEq(oft.totalSupply(), 0.5 ether, "fee tokens are the only remote supply left");
        assertGe(hive.balanceOf(address(adapter)), oft.totalSupply(), "backing invariant");

        oft.withdrawBridgeFees(treasury);
        assertEq(oft.balanceOf(treasury), 0.5 ether, "fee withdrawn on the remote side");
    }

    function test_FeeCapEnforced() public {
        vm.expectRevert(abi.encodeWithSelector(HiveBridgeControls.FeeBpsExceedsCap.selector, 101, 100));
        adapter.setDefaultFeeBps(101);

        vm.expectRevert(abi.encodeWithSelector(HiveBridgeControls.FeeBpsExceedsCap.selector, 500, 100));
        oft.setFeeBpsOverride(A_EID, 500, true);
    }

    function test_FeeSlippageProtection() public {
        adapter.setDefaultFeeBps(100); // 1%
        // Asking for min 100 when fee leaves 99 must revert, not silently under-deliver.
        SendParam memory param = _sendParam(B_EID, userA, 100 ether, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(IOFT.SlippageExceeded.selector, 99 ether, 100 ether));
        IOFT(address(adapter)).quoteSend(param, false);
    }

    // ----- pause -----

    function test_PauseAndGuardianRoles() public {
        adapter.setPauser(guardian);

        // random address cannot pause
        vm.prank(userB);
        vm.expectRevert(HiveBridgeControls.NotPauserOrOwner.selector);
        adapter.pause();

        // guardian pauses
        vm.prank(guardian);
        adapter.pause();

        SendParam memory param = _sendParam(B_EID, userA, 1 ether, 1 ether);
        vm.prank(userA);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        IOFT(address(adapter)).send{ value: 1 ether }(param, MessagingFee(1 ether, 0), payable(userA));

        // guardian cannot unpause — owner only
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        adapter.unpause();

        adapter.unpause(); // owner (this test contract)
        _send(IOFT(address(adapter)), userA, B_EID, userA, 1 ether, 1 ether);
        verifyPackets(B_EID, addressToBytes32(address(oft)));
        assertEq(oft.balanceOf(userA), 1 ether, "flow restored after unpause");
    }

    // ----- admin surface -----

    function test_NoOwnerMintOnTwin() public {
        // The only supply paths are lzReceive (mint) and send (burn): the ABI
        // has no mint. This test pins the invariant at the source level — if
        // someone adds a mint function, this file stops compiling their intent
        // away silently. Runtime check: totalSupply only moves via bridging.
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
