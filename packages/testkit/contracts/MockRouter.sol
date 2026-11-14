// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./MockPriceOracle.sol";
import "./MockERC20.sol";

contract MockRouter {
    MockPriceOracle public oracle;
    bool public shouldFail;

    constructor(address oracle_) {
        oracle = MockPriceOracle(oracle_);
    }

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function exactInputSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut) {
        require(!shouldFail, "Router: Simulated failure");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        (uint256 priceIn, ) = oracle.getPrice(tokenIn);
        (uint256 priceOut, ) = oracle.getPrice(tokenOut);

        uint8 decIn = IERC20Metadata(tokenIn).decimals();
        uint8 decOut = IERC20Metadata(tokenOut).decimals();

        amountOut = (amountIn * priceIn * (10 ** decOut)) / (priceOut * (10 ** decIn));
        require(amountOut >= amountOutMin, "Router: Insufficient output amount");

        MockERC20(tokenOut).mint(recipient, amountOut);
        return amountOut;
    }
}
