// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {DeployLocal} from "./DeployLocal.s.sol";

/// @notice Testnet-only mock demo. Requires a dedicated funded Fuji test wallet.
/// @dev Same deployment path as local; never claims integration with real yield protocols.
contract DeployFuji is DeployLocal {
    function _expectedChainId() internal pure override returns (uint256) {
        return 43113;
    }

    function _keyVariable() internal pure override returns (string memory) {
        return "FUJI_DEPLOYER_PRIVATE_KEY";
    }
}
