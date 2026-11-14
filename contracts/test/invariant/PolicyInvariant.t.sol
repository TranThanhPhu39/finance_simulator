// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PolicyFixture} from "../fixtures/PolicyFixture.sol";
import {PolicyModule} from "../../src/PolicyModule.sol";
import {IPolicyModule} from "../../src/interfaces/IPolicyModule.sol";
import {MockPriceOracle} from "@testkit/MockPriceOracle.sol";

contract PolicyHandler is Test {
    PolicyModule public module;
    MockPriceOracle public oracle;
    address public safe;
    address public usdc;
    address public token;
    address public router;
    uint256 public totalInput;
    uint256[] private timestamps;
    uint256[] private values;

    constructor(PolicyModule module_, MockPriceOracle oracle_, address usdc_, address token_, address router_) {
        module = module_;
        oracle = oracle_;
        safe = module_.safe();
        usdc = usdc_;
        token = token_;
        router = router_;
    }

    function swap(uint96 raw) external {
        uint256 amount = bound(raw, 1, 110e6);
        oracle.setPrice(usdc, 1e8);
        oracle.setPrice(token, 10e8);
        IPolicyModule.SwapRequest memory r = IPolicyModule.SwapRequest(
            router, usdc, token, amount, amount * 1e11 * 99 / 100, safe, block.timestamp + 60
        );
        uint256 beforeUsed = module.readSpent24hUsd();
        (bool success,) = address(module).call(abi.encodeCall(module.executeSwap, (r)));
        if (success) {
            totalInput += amount;
            timestamps.push(block.timestamp);
            values.push(amount * 100);
        } else {
            assertEq(module.readSpent24hUsd(), beforeUsed, "failed swap changed cap");
        }
    }

    function tick(uint32 secondsRaw) external {
        vm.warp(block.timestamp + bound(secondsRaw, 0, 2 days));
    }

    function tryEscalate() external {
        (bool success,) =
            address(module).call(abi.encodeCall(module.setPolicy, (IPolicyModule.Policy(type(uint192).max, 3600, 100))));
        assertFalse(success, "session escalated privileges");
    }

    function ghostSpend() external view returns (uint256 result) {
        for (uint256 i; i < timestamps.length; ++i) {
            if (timestamps[i] + 24 hours > block.timestamp) result += values[i];
        }
    }
}

contract PolicyInvariantTest is StdInvariant, PolicyFixture {
    PolicyHandler private handler;

    function setUp() public override {
        super.setUp();
        handler = new PolicyHandler(module, oracle, address(usdc), address(token), address(router));
        _govern(abi.encodeCall(module.grantSession, (address(handler), type(uint64).max)));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.swap.selector;
        selectors[1] = handler.tick.selector;
        selectors[2] = handler.tryEscalate.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariant_SpendMatchesIndependentRollingLedger() public view {
        assertEq(module.readSpent24hUsd(), handler.ghostSpend());
        assertLe(module.readSpent24hUsd(), 100 * USD);
        assertEq(module.readRemainingCap() + module.readSpent24hUsd(), 100 * USD);
    }

    function invariant_AssetsOnlyMoveAsRecordedAndAllowanceIsZero() public view {
        assertEq(usdc.balanceOf(address(safe)) + handler.totalInput(), 1000e6);
        assertEq(token.balanceOf(address(safe)), 100e18 + handler.totalInput() * 1e11);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(token.balanceOf(stranger), 0);
        assertEq(usdc.allowance(address(safe), address(router)), 0);
        assertEq(usdc.allowance(address(safe), address(vault)), 0);
        assertEq(module.readPolicy().cap24hUsd, 100 * USD);
    }
}
