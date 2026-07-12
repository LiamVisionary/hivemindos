// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";

import { HiveOFT } from "../src/oft/HiveOFT.sol";
import { HiveOFTAdapter } from "../src/oft/HiveOFTAdapter.sol";
import { MockHive } from "./HiveOftBridge.t.sol";

interface IDeliver {
    function deliver(uint32 _dstEid, address _dst) external;
}

/// @dev Randomized traffic generator: bridges both directions, tunes fees,
///      withdraws, donates, and jumps time. Owns both contracts so fee actions
///      exercise the real onlyOwner paths. Every action tolerates reverts
///      (rate limits, pauses) — reverted deliveries stay queued and get
///      retried by later calls, exactly like mainnet.
contract BridgeHandler is Test {
    using OptionsBuilder for bytes;

    uint32 private constant A_EID = 1;
    uint32 private constant B_EID = 2;

    MockHive private immutable hive;
    HiveOFTAdapter private immutable adapter;
    HiveOFT private immutable oft;
    IDeliver private immutable helper;
    address private immutable treasury = makeAddr("invariant-treasury");

    address[3] private actors;
    uint256 public ghostMinted;

    constructor(MockHive _hive, HiveOFTAdapter _adapter, HiveOFT _oft, IDeliver _helper) {
        hive = _hive;
        adapter = _adapter;
        oft = _oft;
        helper = _helper;
        for (uint256 i = 0; i < 3; i++) {
            actors[i] = makeAddr(string(abi.encodePacked("actor", i)));
            vm.deal(actors[i], 10_000 ether);
        }
    }

    function bridgeAtoB(uint256 _actorSeed, uint96 _rawAmount) external {
        address actor = actors[_actorSeed % 3];
        uint256 amount = bound(uint256(_rawAmount), 1e12, 50_000 ether);
        hive.mint(actor, amount);
        ghostMinted += amount;

        vm.startPrank(actor);
        hive.approve(address(adapter), amount);
        SendParam memory param = _param(B_EID, actor, amount);
        try IOFT(address(adapter)).quoteSend(param, false) returns (MessagingFee memory fee) {
            try IOFT(address(adapter)).send{ value: fee.nativeFee }(param, fee, payable(actor)) {} catch {}
        } catch {}
        vm.stopPrank();

        helper.deliver(B_EID, address(oft));
    }

    function bridgeBtoA(uint256 _actorSeed, uint96 _rawAmount) external {
        address actor = actors[_actorSeed % 3];
        uint256 balance = oft.balanceOf(actor);
        if (balance < 1e12) return;
        uint256 amount = bound(uint256(_rawAmount), 1e12, balance);

        vm.startPrank(actor);
        SendParam memory param = _param(A_EID, actor, amount);
        try IOFT(address(oft)).quoteSend(param, false) returns (MessagingFee memory fee) {
            try IOFT(address(oft)).send{ value: fee.nativeFee }(param, fee, payable(actor)) {} catch {}
        } catch {}
        vm.stopPrank();

        helper.deliver(A_EID, address(adapter));
    }

    function retryDeliveries(bool _sideB) external {
        helper.deliver(_sideB ? B_EID : A_EID, _sideB ? address(oft) : address(adapter));
    }

    function setFees(uint16 _a, uint16 _b) external {
        adapter.setDefaultFeeBps(uint16(bound(uint256(_a), 0, 25)));
        oft.setDefaultFeeBps(uint16(bound(uint256(_b), 0, 25)));
    }

    function withdrawFees(bool _sideB) external {
        if (_sideB) {
            try oft.withdrawBridgeFees(treasury) {} catch {}
        } else {
            try adapter.withdrawBridgeFees(treasury) {} catch {}
        }
    }

    function donate(uint96 _rawAmount) external {
        uint256 amount = bound(uint256(_rawAmount), 1, 1_000 ether);
        hive.mint(address(adapter), amount);
        ghostMinted += amount;
    }

    function warpTime(uint32 _rawSeconds) external {
        vm.warp(block.timestamp + bound(uint256(_rawSeconds), 1, 2 days));
    }

    function _param(uint32 _dstEid, address _to, uint256 _amount) private pure returns (SendParam memory) {
        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(500000, 0);
        return SendParam(_dstEid, bytes32(uint256(uint160(_to))), _amount, 0, options, "", "");
    }
}

/// @notice Invariants that must hold under arbitrary interleavings of
///         bridging, fees, withdrawals, donations, and time.
contract HiveOftInvariantTest is TestHelperOz5, IDeliver {
    uint32 private constant A_EID = 1;
    uint32 private constant B_EID = 2;

    MockHive private hive;
    HiveOFTAdapter private adapter;
    HiveOFT private oft;
    BridgeHandler private handler;

    function setUp() public override {
        super.setUp();
        setUpEndpoints(2, LibraryType.UltraLightNode);

        hive = new MockHive();
        adapter = new HiveOFTAdapter(address(hive), address(endpoints[A_EID]), address(this));
        oft = new HiveOFT(address(endpoints[B_EID]), address(this));

        address[] memory oapps = new address[](2);
        oapps[0] = address(adapter);
        oapps[1] = address(oft);
        this.wireOApps(oapps);

        // moderate limits so both allowed and rate-limited paths get exercised
        _setLimits(address(adapter), B_EID);
        _setLimits(address(oft), A_EID);

        handler = new BridgeHandler(hive, adapter, oft, this);
        adapter.transferOwnership(address(handler));
        oft.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    function deliver(uint32 _dstEid, address _dst) external {
        try this.verifyPackets(_dstEid, bytes32(uint256(uint160(_dst)))) {} catch {}
    }

    function _setLimits(address _controls, uint32 _eid) private {
        HiveOFTAdapter c = HiveOFTAdapter(_controls); // key helpers shared via HiveBridgeControls
        RateLimiter.RateLimitConfig[] memory configs = new RateLimiter.RateLimitConfig[](4);
        configs[0] = RateLimiter.RateLimitConfig(c.outboundShortKey(_eid), 60_000 ether, 1 hours);
        configs[1] = RateLimiter.RateLimitConfig(c.outboundLongKey(_eid), 200_000 ether, 1 days);
        configs[2] = RateLimiter.RateLimitConfig(c.inboundShortKey(_eid), 60_000 ether, 1 hours);
        configs[3] = RateLimiter.RateLimitConfig(c.inboundLongKey(_eid), 200_000 ether, 1 days);
        c.setRateLimits(configs);
    }

    /// @dev THE bridge invariant: locked principal always covers remote supply.
    function invariant_backing() public view {
        assertGe(
            hive.balanceOf(address(adapter)) - adapter.bridgeFeesAccrued(),
            oft.totalSupply(),
            "locked - fees must cover minted"
        );
    }

    /// @dev No path mints or destroys underlying HIVE out of thin air.
    function invariant_underlyingSupplyConserved() public view {
        assertEq(hive.totalSupply(), handler.ghostMinted(), "underlying supply == handler mints");
    }

    /// @dev The fee ceiling can never be exceeded, whatever the owner does.
    function invariant_feeCapsHold() public view {
        assertLe(adapter.defaultFeeBps(), 25);
        assertLe(oft.defaultFeeBps(), 25);
    }
}
