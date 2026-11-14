// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "@testkit/MockERC20.sol";
import {MockVault4626} from "@testkit/MockVault4626.sol";

contract AdversarialRouter {
    uint256 public outputBps = 10_000;
    bool public skipInput;
    address public callbackTarget;
    bytes public callbackData;
    bool public reentrySucceeded;

    function configure(uint256 outputBps_, bool skipInput_, address callbackTarget_, bytes memory callbackData_)
        external
    {
        outputBps = outputBps_;
        skipInput = skipInput_;
        callbackTarget = callbackTarget_;
        callbackData = callbackData_;
    }

    function exactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint256, address recipient)
        external
        returns (uint256)
    {
        if (!skipInput) IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        if (callbackTarget != address(0)) (reentrySucceeded,) = callbackTarget.call(callbackData);
        uint256 actual = amountIn * 1e11 * outputBps / 10_000;
        MockERC20(tokenOut).mint(recipient, actual);
        return type(uint256).max; // Lie about output; module must use the actual Safe balance delta.
    }
}

contract AdversarialVault is MockVault4626 {
    uint8 public mode;
    constructor(IERC20 asset_) MockVault4626(asset_, "Adversarial", "EVIL", 0) {}

    function setMode(uint8 mode_) external {
        mode = mode_;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        require(mode != 1, "Vault: Simulated failure");
        shares = super.deposit(assets, receiver);
        if (mode == 2) _burn(receiver, shares / 2);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        require(mode != 1, "Vault: Simulated failure");
        shares = super.withdraw(assets, receiver, owner);
        if (mode == 3) _burn(owner, shares);
    }
}

contract FalseApproveToken is MockERC20 {
    constructor() MockERC20("False approve", "FALSE", 6) {}

    function approve(address, uint256) public pure override returns (bool) {
        return false;
    }
}

contract NoReturnApproveToken is MockERC20 {
    constructor() MockERC20("No return approve", "NORETURN", 6) {}

    function approve(address spender, uint256 value) public override returns (bool) {
        super.approve(spender, value);
        assembly { return(0, 0) }
    }
}
