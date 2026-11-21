// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PolicyFixture} from "../fixtures/PolicyFixture.sol";
import {IPolicyModule} from "../../src/interfaces/IPolicyModule.sol";

contract PolicyFuzzTest is PolicyFixture {
    function testFuzz_CapAcrossSplitOrders(uint96 firstRaw, uint96 secondRaw) public {
        uint256 first = bound(firstRaw, 1, 100e6);
        uint256 second = bound(secondRaw, 1, 101e6);
        _swap(first);
        if (first + second <= 100e6) {
            _swap(second);
            assertEq(module.readSpent24hUsd(), (first + second) * 100);
            assertEq(usdc.balanceOf(address(safe)), 1000e6 - first - second);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(IPolicyModule.CapExceeded.selector, first * 100, second * 100, 100 * USD)
            );
            _swap(second);
            assertEq(module.readSpent24hUsd(), first * 100);
            assertEq(usdc.balanceOf(address(safe)), 1000e6 - first);
        }
        assertEq(usdc.allowance(address(safe), address(router)), 0);
    }

    function testFuzz_RecipientCanNeverBeForeign(address recipient, uint96 raw) public {
        vm.assume(recipient != address(safe));
        IPolicyModule.SwapRequest memory r = _request(bound(raw, 1, 100e6));
        r.recipient = recipient;
        uint256 beforeRecipient = token.balanceOf(recipient);
        vm.expectRevert(IPolicyModule.InvalidRecipient.selector);
        vm.prank(agent);
        module.executeSwap(r);
        assertEq(token.balanceOf(recipient), beforeRecipient);
        assertEq(module.readSpent24hUsd(), 0);
    }

    function testFuzz_VaultRoundTripPreservesAssets(uint96 raw) public {
        uint256 amount = bound(raw, 1, 1000e6);
        uint256 shares = _deposit(amount);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), amount, shares, address(safe), block.timestamp + 60);
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(vault.balanceOf(address(safe)), 0);
        assertEq(usdc.allowance(address(safe), address(vault)), 0);
    }

    function testFuzz_ReverseSwapRoundsSpendUp(uint96 raw) public {
        uint256 amount = bound(raw, 1e12, 10e18);
        uint256 output = amount / 1e11;
        uint256 minOut = (output * 99 + 99) / 100;
        IPolicyModule.SwapRequest memory r = IPolicyModule.SwapRequest(
            address(router), address(token), address(usdc), amount, minOut, address(safe), block.timestamp + 60
        );
        vm.prank(agent);
        module.executeSwap(r);
        uint256 expectedUsd = (amount * (10 * USD) + 1e18 - 1) / 1e18;
        assertEq(module.readSpent24hUsd(), expectedUsd);
        assertEq(usdc.balanceOf(address(safe)), 1000e6 + output);
        assertEq(token.allowance(address(safe), address(router)), 0);
    }
}
