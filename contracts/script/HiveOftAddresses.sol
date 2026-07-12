// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Verified constants for the omnichain HIVE bridge.
///
/// PROVENANCE — every value below was confirmed on 2026-07-12 against ground
/// truth, after an earlier draft carried WRONG DVN/lib addresses from a
/// misread API summary:
///  - Endpoints/EIDs: read on-chain from ClawBank's LIVE OFT (`endpoint()`,
///    `endpoint.eid()`) and cross-checked against the LayerZero metadata API
///    (metadata.layerzero-api.com) chain entries `base` / `robinhood`.
///  - Send/Receive libraries and DVN addresses: read on-chain from ClawBank's
///    live OApp config (`getSendLibrary`/`getReceiveLibrary`/`getConfig`) and
///    identity-matched via the metadata API dvns registry — LayerZero Labs and
///    Nethermind, required 2-of-2, confirmations 10, both directions, on both
///    chains. This is exactly the stack ClawBank runs in production.
///  - HIVE_TOKEN_BASE: repo constant, confirmed on-chain (name/symbol "HIVE",
///    18 decimals, non-proxy DERC20, fork-verified lossless transfers).
///  - Testnet entries: LayerZero metadata API (`base-sepolia`,
///    `robinhood-testnet`) — for the pre-mainnet rehearsal only.
library HiveOftAddresses {
    // ----- Base (home chain; HIVE already lives here) -----
    uint256 internal constant BASE_CHAIN_ID = 8453;
    uint32 internal constant BASE_EID = 30184;
    address internal constant BASE_LZ_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    address internal constant HIVE_TOKEN_BASE = 0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3;

    // Base ULN libraries + DVNs (live-read from ClawBank's config, identity-matched)
    address internal constant BASE_SEND_ULN302 = 0xB5320B0B3a13cC860893E2Bd79FCd7e13484Dda2;
    address internal constant BASE_RECEIVE_ULN302 = 0xc70AB6f32772f59fBfc23889Caf4Ba3376C84bAf;
    address internal constant BASE_DVN_LAYERZERO_LABS = 0x9e059a54699a285714207b43B055483E78FAac25;
    address internal constant BASE_DVN_NETHERMIND = 0xcd37CA043f8479064e10635020c65FfC005d36f6;
    address internal constant BASE_EXECUTOR = 0x2CCA08ae69E0C44b18a57Ab2A87644234dAebaE4;

    // ----- Robinhood Chain (twin lives here) -----
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;
    uint32 internal constant ROBINHOOD_EID = 30416;
    address internal constant ROBINHOOD_LZ_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;

    // Robinhood ULN libraries + DVNs (live-read from ClawBank's config, identity-matched)
    address internal constant ROBINHOOD_SEND_ULN302 = 0xC39161c743D0307EB9BCc9FEF03eeb9Dc4802de7;
    address internal constant ROBINHOOD_RECEIVE_ULN302 = 0xe1844c5D63a9543023008D332Bd3d2e6f1FE1043;
    address internal constant ROBINHOOD_DVN_LAYERZERO_LABS = 0xd01ae6905d48315f7bE10C7330aeCF8360Ef5b12;
    address internal constant ROBINHOOD_DVN_NETHERMIND = 0x0Ffe02DF012299A370D5dd69298A5826EAcaFdF8;
    address internal constant ROBINHOOD_EXECUTOR = 0x4208D6E27538189bB48E603D6123A94b8Abe0A0b;

    // ULN security parameters (mirror ClawBank exactly)
    uint64 internal constant ULN_CONFIRMATIONS = 10;
    uint32 internal constant CONFIG_TYPE_ULN = 2;

    // ----- Testnet pair (rehearsal only; default DVN config is fine there) -----
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint32 internal constant BASE_SEPOLIA_EID = 40245;
    address internal constant BASE_SEPOLIA_LZ_ENDPOINT = 0x6EDCE65403992e310A62460808c4b910D972f10f;

    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    uint32 internal constant ROBINHOOD_TESTNET_EID = 40451;
    address internal constant ROBINHOOD_TESTNET_LZ_ENDPOINT = 0x3aCAAf60502791D199a5a5F0B173D78229eBFe32;
}
