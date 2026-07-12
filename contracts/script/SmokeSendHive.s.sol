// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { HiveOftAddresses } from "./HiveOftAddresses.sol";
import { IOFT, SendParam, MessagingFee, OFTReceipt, OFTLimit, OFTFeeDetail } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Smoke-test send: bridges HIVE from the current chain to its paired
///         remote, quoting first so dust/fees are handled exactly like the
///         bridge page does. Used for the testnet rehearsal round trip and the
///         mainnet ~1 HIVE smoke test.
///
///   HIVE_LOCAL_OAPP=0x<adapter-or-oft> [HIVE_AMOUNT=1000000000000000000] \
///   forge script script/SmokeSendHive.s.sol --rpc-url "$RPC_URL" \
///     --private-key <sender> --broadcast
///
/// Sender must hold the tokens (and approve is handled here for the adapter
/// side). Delivery lands on the remote chain in ~1 minute; track the printed
/// tx on https://testnet.layerzeroscan.com (testnet) or layerzeroscan.com.
contract SmokeSendHive is Script {
    function run() external {
        address oapp = vm.envAddress("HIVE_LOCAL_OAPP");
        uint256 amount = vm.envOr("HIVE_AMOUNT", uint256(1 ether));
        amount -= amount % 1e12; // shared-decimals dust

        uint32 dstEid;
        if (block.chainid == HiveOftAddresses.BASE_CHAIN_ID) dstEid = HiveOftAddresses.ROBINHOOD_EID;
        else if (block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID) dstEid = HiveOftAddresses.BASE_EID;
        else if (block.chainid == HiveOftAddresses.BASE_SEPOLIA_CHAIN_ID) dstEid = HiveOftAddresses.ROBINHOOD_TESTNET_EID;
        else if (block.chainid == HiveOftAddresses.ROBINHOOD_TESTNET_CHAIN_ID) dstEid = HiveOftAddresses.BASE_SEPOLIA_EID;
        else revert("unsupported chain");

        IOFT oft = IOFT(oapp);
        (, , address sender) = vm.readCallers();
        SendParam memory quoteParam =
            SendParam(dstEid, bytes32(uint256(uint160(sender))), amount, 0, "", "", "");
        (, , OFTReceipt memory receipt) = oft.quoteOFT(quoteParam);
        SendParam memory param =
            SendParam(dstEid, bytes32(uint256(uint160(sender))), amount, receipt.amountReceivedLD, "", "", "");
        MessagingFee memory fee = oft.quoteSend(param, false);

        vm.startBroadcast();
        if (oft.approvalRequired()) {
            IERC20(oft.token()).approve(oapp, amount);
        }
        oft.send{ value: fee.nativeFee }(param, fee, sender);
        vm.stopBroadcast();

        console2.log("sent HIVE:", amount);
        console2.log("  from oapp:", oapp);
        console2.log("  to eid:   ", dstEid);
        console2.log("  will receive on remote:", receipt.amountReceivedLD);
        console2.log("  lz native fee (wei):   ", fee.nativeFee);
    }
}
