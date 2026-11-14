// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPriceOracle {
    struct PriceData {
        uint256 price;      // 8 decimals USD (VD: 100000000 = $1.00)
        uint256 updatedAt;
    }

    mapping(address => PriceData) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = PriceData({
            price: price,
            updatedAt: block.timestamp
        });
    }

    function setPriceWithTimestamp(address token, uint256 price, uint256 timestamp) external {
        prices[token] = PriceData({
            price: price,
            updatedAt: timestamp
        });
    }

    function getPrice(address token) external view returns (uint256 price, uint256 updatedAt) {
        PriceData memory data = prices[token];
        require(data.price > 0, "Price not set");
        return (data.price, data.updatedAt);
    }
}
