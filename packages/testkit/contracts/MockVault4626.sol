// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "./MockERC20.sol";

contract MockVault4626 is ERC4626 {
    uint256 public apyBps; // VD: 500 = 5% APY
    uint256 public lastAccrualTimestamp;

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 apyBps_
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        apyBps = apyBps_;
        lastAccrualTimestamp = block.timestamp;
    }

    function accrueYield() public {
        uint256 elapsed = block.timestamp - lastAccrualTimestamp;
        if (elapsed > 0 && totalAssets() > 0) {
            uint256 yieldAmount = (totalAssets() * apyBps * elapsed) / (10000 * 365 days);
            if (yieldAmount > 0) {
                MockERC20(asset()).mint(address(this), yieldAmount);
            }
            lastAccrualTimestamp = block.timestamp;
        }
    }

    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        accrueYield();
        return super.deposit(assets, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
        accrueYield();
        return super.withdraw(assets, receiver, owner);
    }
}
