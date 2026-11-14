// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PolicyFixture} from "../fixtures/PolicyFixture.sol";
import {IPolicyModule} from "../../src/interfaces/IPolicyModule.sol";
import {MockVault4626} from "@testkit/MockVault4626.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract VaultTest is PolicyFixture {
    function test_ChangedVaultUnderlyingBlocksDepositAndWithdrawal() public {
        _deposit(100e6);
        vm.mockCall(address(vault), abi.encodeCall(IERC4626.asset, ()), abi.encode(address(token)));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.VaultAssetChanged.selector, address(vault)));
        _deposit(10e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 10e6, 10e6, address(safe), block.timestamp + 60);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.VaultAssetChanged.selector, address(vault)));
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(usdc.balanceOf(address(safe)), 900e6);
        assertEq(vault.balanceOf(address(safe)), 100e6);
        assertEq(module.readSpent24hUsd(), 0);
        vm.clearMockedCalls();
    }

    function test_SwapThenDepositAndWithdrawThroughRealSafe() public {
        _swap(50e6);
        uint256 shares = _deposit(100e6);
        assertEq(shares, 100e6);
        assertEq(vault.balanceOf(address(safe)), 100e6);
        assertEq(usdc.balanceOf(address(safe)), 850e6);
        assertEq(usdc.allowance(address(safe), address(vault)), 0);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 40e6, 40e6, address(safe), block.timestamp + 60);
        vm.prank(agent);
        assertEq(module.executeVaultWithdraw(r), 40e6);
        assertEq(usdc.balanceOf(address(safe)), 890e6);
        assertEq(vault.balanceOf(address(safe)), 60e6);
        assertEq(module.readSpent24hUsd(), 50 * USD, "vault actions must not reset or discount swap spend");
    }

    function test_MockYieldWithdrawnOnlyToSafe() public {
        _deposit(100e6);
        vm.warp(block.timestamp + 7 days);
        vault.accrueYield();
        uint256 assets = vault.convertToAssets(vault.balanceOf(address(safe)));
        assertGt(assets, 100e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 100e6, 100e6, address(safe), block.timestamp + 60);
        vm.prank(agent);
        uint256 shares = module.executeVaultWithdraw(r);
        assertLt(shares, 100e6);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_UnknownVaultBlockedWithoutAllowance() public {
        MockVault4626 other = new MockVault4626(usdc, "Other", "OTHER", 0);
        IPolicyModule.DepositRequest memory r =
            IPolicyModule.DepositRequest(address(other), 50e6, 49e6, address(safe), block.timestamp + 60);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.VaultNotWhitelisted.selector, address(other)));
        vm.prank(agent);
        module.executeVaultDeposit(r);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(usdc.allowance(address(safe), address(other)), 0);
        assertEq(other.balanceOf(address(safe)), 0);
    }

    function test_DepositRecipientMustBeSafe() public {
        IPolicyModule.DepositRequest memory r =
            IPolicyModule.DepositRequest(address(vault), 50e6, 49e6, stranger, block.timestamp + 60);
        vm.expectRevert(IPolicyModule.InvalidRecipient.selector);
        vm.prank(agent);
        module.executeVaultDeposit(r);
        assertEq(vault.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
    }

    function test_WithdrawRecipientMustBeSafe() public {
        _deposit(100e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 50e6, 50e6, stranger, block.timestamp + 60);
        vm.expectRevert(IPolicyModule.InvalidRecipient.selector);
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(vault.balanceOf(address(safe)), 100e6);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(address(safe)), 900e6);
    }

    function test_UnderlyingTokenRemovalBlocksBothVaultOperations() public {
        _deposit(100e6);
        _govern(abi.encodeCall(module.setTokenAllowed, (address(usdc), false)));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.TokenNotWhitelisted.selector, address(usdc)));
        _deposit(10e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 10e6, 10e6, address(safe), block.timestamp + 60);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.TokenNotWhitelisted.selector, address(usdc)));
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(vault.balanceOf(address(safe)), 100e6);
    }

    function test_VaultRemovalBlocksNextDeposit() public {
        _govern(abi.encodeCall(module.setVaultAllowed, (address(vault), false)));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.VaultNotWhitelisted.selector, address(vault)));
        _deposit(10e6);
    }

    function test_WeakDepositMinimumBlocked() public {
        IPolicyModule.DepositRequest memory r =
            IPolicyModule.DepositRequest(address(vault), 100e6, 1, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeVaultDeposit(r);
        assertEq(usdc.allowance(address(safe), address(vault)), 0);
    }

    function test_UnboundedShareBurnBlocked() public {
        _deposit(100e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 10e6, type(uint256).max, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(vault.balanceOf(address(safe)), 100e6);
    }

    function test_ActualShareBurnOverUserLimitRollsBack() public {
        _deposit(100e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 10e6, 1, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(vault.balanceOf(address(safe)), 100e6);
        assertEq(usdc.balanceOf(address(safe)), 900e6);
    }

    function test_TooHighDepositMinimumRollsBackVaultAndAllowance() public {
        IPolicyModule.DepositRequest memory r =
            IPolicyModule.DepositRequest(address(vault), 100e6, 101e6, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeVaultDeposit(r);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(vault.balanceOf(address(safe)), 0);
        assertEq(usdc.allowance(address(safe), address(vault)), 0);
    }

    function test_RevokedSessionCannotDepositOrWithdraw() public {
        _deposit(100e6);
        _govern(abi.encodeCall(module.revokeSession, (agent)));
        vm.expectRevert(IPolicyModule.SessionRevoked.selector);
        _deposit(10e6);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(vault), 10e6, 10e6, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SessionRevoked.selector);
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(vault.balanceOf(address(safe)), 100e6);
    }
}
