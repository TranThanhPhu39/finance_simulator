// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @dev Deliberately matches the existing testkit router. Real DEXs need an audited adapter.
interface ISupportedRouter {
    function exactInputSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut);
}
