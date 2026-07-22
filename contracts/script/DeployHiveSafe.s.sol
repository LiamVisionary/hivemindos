// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {HiveOftAddresses} from "./HiveOftAddresses.sol";

interface ISafe141 {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

interface ISafeProxyFactory141 {
    function createProxyWithNonce(address singleton, bytes calldata initializer, uint256 saltNonce)
        external
        returns (address payable proxy);
}

/// @notice Deploy the bridge's temporary 1-of-1 Safe through Safe's canonical
///         v1.4.1 factory. Base and Robinhood both host the factory and
///         singleton at the canonical addresses, so identical initializer and
///         salt inputs produce the same Safe address on both chains.
///
/// Required env:
///   HIVE_SAFE_OWNER — sole initial Safe owner. Never pass a private key.
///
/// Optional env:
///   HIVE_SAFE_SALT_NONCE — deterministic nonce override. The default is
///                          bridge-specific and must remain stable.
contract DeployHiveSafe is Script {
    address internal constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    uint256 internal constant DEFAULT_SALT_NONCE =
        uint256(keccak256("HivemindOS HIVE Base Robinhood governance Safe v1"));

    function run() external returns (address safe) {
        require(
            block.chainid == HiveOftAddresses.BASE_CHAIN_ID || block.chainid == HiveOftAddresses.ROBINHOOD_CHAIN_ID,
            "run on Base or Robinhood mainnet"
        );
        address owner = vm.envAddress("HIVE_SAFE_OWNER");
        require(owner != address(0), "HIVE_SAFE_OWNER unset");
        require(SAFE_SINGLETON.code.length > 0, "Safe singleton unavailable");
        require(SAFE_PROXY_FACTORY.code.length > 0, "Safe factory unavailable");

        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory initializer = abi.encodeCall(
            ISafe141.setup, (owners, 1, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        uint256 saltNonce = vm.envOr("HIVE_SAFE_SALT_NONCE", DEFAULT_SALT_NONCE);

        vm.startBroadcast();
        safe = ISafeProxyFactory141(SAFE_PROXY_FACTORY).createProxyWithNonce(SAFE_SINGLETON, initializer, saltNonce);
        vm.stopBroadcast();

        address[] memory configuredOwners = ISafe141(safe).getOwners();
        require(configuredOwners.length == 1 && configuredOwners[0] == owner, "Safe owner mismatch");
        require(ISafe141(safe).getThreshold() == 1, "Safe threshold mismatch");

        console2.log("HIVE governance Safe:", safe);
        console2.log("  chain:", block.chainid);
        console2.log("  owner:", owner);
        console2.log("  threshold: 1 of 1");
        console2.log("USE THIS ADDRESS AS HIVE_SAFE ON BOTH CHAINS");
    }
}
