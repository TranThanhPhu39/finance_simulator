// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

interface IPriceSource {
    /// @return price USD per whole token, scaled by 1e8.
    /// @return updatedAt Unix timestamp of the observation.
    function getPrice(address token) external view returns (uint256 price, uint256 updatedAt);
}
