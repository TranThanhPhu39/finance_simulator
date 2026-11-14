// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PolicyFixture} from "../fixtures/PolicyFixture.sol";
import {
    AdversarialRouter,
    AdversarialVault,
    FalseApproveToken,
    NoReturnApproveToken
} from "../fixtures/AdversarialTargets.sol";
import {IPolicyModule} from "../../src/interfaces/IPolicyModule.sol";

contract AdversarialTest is PolicyFixture {
    function test_LyingRouterCannotHideMissingOutput() public {
        AdversarialRouter bad = new AdversarialRouter();
        _govern(abi.encodeCall(module.setRouterAllowed, (address(bad), true)));
        bad.configure(5000, false, address(0), "");
        IPolicyModule.SwapRequest memory r = _request(50e6);
        r.router = address(bad);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeSwap(r);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(token.balanceOf(address(safe)), 100e18);
        assertEq(module.readSpent24hUsd(), 0);
        assertEq(usdc.allowance(address(safe), address(bad)), 0);
    }

    function test_RouterMustConsumeExactInput() public {
        AdversarialRouter bad = new AdversarialRouter();
        _govern(abi.encodeCall(module.setRouterAllowed, (address(bad), true)));
        bad.configure(10_000, true, address(0), "");
        IPolicyModule.SwapRequest memory r = _request(50e6);
        r.router = address(bad);
        vm.expectRevert(IPolicyModule.UnexpectedBalanceChange.selector);
        vm.prank(agent);
        module.executeSwap(r);
        assertEq(module.readSpent24hUsd(), 0);
    }

    function test_ReentryBlockedEvenIfRouterHasItsOwnSession() public {
        AdversarialRouter bad = new AdversarialRouter();
        _govern(abi.encodeCall(module.setRouterAllowed, (address(bad), true)));
        _govern(abi.encodeCall(module.grantSession, (address(bad), uint64(block.timestamp + 1 days))));
        IPolicyModule.SwapRequest memory r = _request(50e6);
        r.router = address(bad);
        bad.configure(10_000, false, address(module), abi.encodeCall(module.executeSwap, (r)));
        vm.prank(agent);
        module.executeSwap(r);
        assertFalse(bad.reentrySucceeded());
        assertEq(module.readSpent24hUsd(), 50 * USD);
        assertEq(usdc.balanceOf(address(safe)), 950e6);
        assertEq(usdc.allowance(address(safe), address(bad)), 0);
    }

    function test_FalseApproveFailsClosed() public {
        FalseApproveToken bad = new FalseApproveToken();
        _govern(abi.encodeCall(module.setTokenAllowed, (address(bad), true)));
        oracle.setPrice(address(bad), USD);
        bad.mint(address(safe), 100e6);
        IPolicyModule.SwapRequest memory r = _request(50e6);
        r.tokenIn = address(bad);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.TokenOperationFailed.selector, address(bad)));
        vm.prank(agent);
        module.executeSwap(r);
        assertEq(module.readSpent24hUsd(), 0);
        assertEq(bad.balanceOf(address(safe)), 100e6);
    }

    function test_ApproveWithoutReturnDataSupportedAndCleared() public {
        NoReturnApproveToken compatible = new NoReturnApproveToken();
        _govern(abi.encodeCall(module.setTokenAllowed, (address(compatible), true)));
        oracle.setPrice(address(compatible), USD);
        compatible.mint(address(safe), 100e6);
        IPolicyModule.SwapRequest memory r = _request(50e6);
        r.tokenIn = address(compatible);
        vm.prank(agent);
        module.executeSwap(r);
        assertEq(module.readSpent24hUsd(), 50 * USD);
        assertEq(compatible.allowance(address(safe), address(router)), 0);
    }

    function test_VaultRevertRollsBackAssetAndAllowance() public {
        AdversarialVault bad = new AdversarialVault(usdc);
        _govern(abi.encodeCall(module.setVaultAllowed, (address(bad), true)));
        bad.setMode(1);
        IPolicyModule.DepositRequest memory r =
            IPolicyModule.DepositRequest(address(bad), 50e6, 50e6, address(safe), block.timestamp + 60);
        vm.expectPartialRevert(IPolicyModule.ExecutionFailed.selector);
        vm.prank(agent);
        module.executeVaultDeposit(r);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(usdc.allowance(address(safe), address(bad)), 0);
        assertEq(module.readSpent24hUsd(), 0);
    }

    function test_VaultLyingAboutMintedSharesRollsBack() public {
        AdversarialVault bad = new AdversarialVault(usdc);
        _govern(abi.encodeCall(module.setVaultAllowed, (address(bad), true)));
        bad.setMode(2);
        IPolicyModule.DepositRequest memory r =
            IPolicyModule.DepositRequest(address(bad), 50e6, 50e6, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeVaultDeposit(r);
        assertEq(usdc.balanceOf(address(safe)), 1000e6);
        assertEq(bad.balanceOf(address(safe)), 0);
    }

    function test_VaultBurningExcessSharesRollsBackWithdrawal() public {
        AdversarialVault bad = new AdversarialVault(usdc);
        _govern(abi.encodeCall(module.setVaultAllowed, (address(bad), true)));
        IPolicyModule.DepositRequest memory d =
            IPolicyModule.DepositRequest(address(bad), 100e6, 100e6, address(safe), block.timestamp + 60);
        vm.prank(agent);
        module.executeVaultDeposit(d);
        bad.setMode(3);
        IPolicyModule.WithdrawRequest memory r =
            IPolicyModule.WithdrawRequest(address(bad), 10e6, 10e6, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeVaultWithdraw(r);
        assertEq(usdc.balanceOf(address(safe)), 900e6);
        assertEq(bad.balanceOf(address(safe)), 100e6);
    }
}
