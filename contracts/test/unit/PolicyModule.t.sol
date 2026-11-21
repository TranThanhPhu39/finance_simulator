// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PolicyFixture} from "../fixtures/PolicyFixture.sol";
import {IPolicyModule} from "../../src/interfaces/IPolicyModule.sol";
import {MockERC20} from "@testkit/MockERC20.sol";
import {Enum} from "@safe/common/Enum.sol";

contract PolicyModuleTest is PolicyFixture {
    function test_DisabledModuleCannotExecuteAndRollsBackSpend() public {
        _ownerExec(address(safe), abi.encodeCall(safe.disableModule, (address(1), address(module))));
        vm.expectRevert(bytes("GS104"));
        _swap(10e6);
        _assertUntouched();
        assertEq(usdc.allowance(address(safe), address(router)), 0);
    }

    function test_ZeroCapStopsSwapButKeepsVaultActionsAvailable() public {
        _govern(abi.encodeCall(module.setPolicy, (IPolicyModule.Policy(0, 3600, 100))));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.CapExceeded.selector, 0, USD, 0));
        _swap(1e6);
        _deposit(10e6);
        assertEq(module.readRemainingCap(), 0);
        assertEq(module.readSpent24hUsd(), 0);
        assertEq(vault.balanceOf(address(safe)), 10e6);
    }

    function test_RingWrapPreservesUnexpiredEntriesAcrossMultiplePrunes() public {
        uint256 start = block.timestamp;
        for (uint256 i; i < 128; ++i) {
            _swap(1);
        }
        vm.warp(start + 1 hours);
        _refreshPrices();
        for (uint256 i; i < 128; ++i) {
            _swap(2);
        }
        assertEq(module.readSpent24hUsd(), 38400);
        vm.warp(start + 24 hours);
        _refreshPrices();
        assertEq(module.readSpent24hUsd(), 25600);
        for (uint256 i; i < 128; ++i) {
            _swap(3);
        }
        assertEq(module.readSpent24hUsd(), 64000);
        vm.warp(start + 25 hours);
        _refreshPrices();
        assertEq(module.readSpent24hUsd(), 38400);
        _swap(4);
        assertEq(module.readSpent24hUsd(), 38800);
        assertEq(usdc.balanceOf(address(safe)), 1000e6 - 772);
    }

    function test_SwapChangesActualBalancesAndClearsAllowance() public {
        assertEq(_swap(60e6), 6e18);
        assertEq(usdc.balanceOf(address(safe)), 940e6);
        assertEq(token.balanceOf(address(safe)), 106e18);
        assertEq(usdc.allowance(address(safe), address(router)), 0);
        assertEq(module.readSpent24hUsd(), 60 * USD);
        assertEq(module.readRemainingCap(), 40 * USD);
    }

    function test_ExactCapAllowed() public {
        _swap(100e6);
        assertEq(module.readRemainingCap(), 0);
    }

    function test_OverCapRollsBackBalancesAndCounter() public {
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.CapExceeded.selector, 0, 101 * USD, 100 * USD));
        _swap(101e6);
        _assertUntouched();
    }

    function test_SplitOrdersCannotBypassCap() public {
        _swap(60e6);
        _swap(30e6);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.CapExceeded.selector, 90 * USD, 20 * USD, 100 * USD));
        _swap(20e6);
        assertEq(module.readSpent24hUsd(), 90 * USD);
        assertEq(usdc.balanceOf(address(safe)), 910e6);
        assertEq(token.balanceOf(address(safe)), 109e18);
    }

    function test_RollingWindowExpiresAtExactBoundaryNotMidnight() public {
        uint256 start = block.timestamp;
        _swap(60e6);
        vm.warp(start + 1 hours);
        _refreshPrices();
        _swap(30e6);
        vm.warp(start + 24 hours - 1);
        assertEq(module.readSpent24hUsd(), 90 * USD);
        vm.warp(start + 24 hours);
        assertEq(module.readSpent24hUsd(), 30 * USD);
        _refreshPrices();
        _swap(70e6);
        assertEq(module.readSpent24hUsd(), 100 * USD);
        vm.warp(start + 25 hours);
        assertEq(module.readSpent24hUsd(), 70 * USD);
    }

    function test_NewSessionCannotResetAccountSpend() public {
        _swap(90e6);
        address second = address(0x222);
        _govern(abi.encodeCall(module.revokeSession, (agent)));
        _govern(abi.encodeCall(module.grantSession, (second, uint64(block.timestamp + 1 days))));
        IPolicyModule.SwapRequest memory request = _request(20e6);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.CapExceeded.selector, 90 * USD, 20 * USD, 100 * USD));
        vm.prank(second);
        module.executeSwap(request);
    }

    function test_ChangingPolicyDoesNotEraseSpend() public {
        _swap(90e6);
        _govern(abi.encodeCall(module.setPolicy, (IPolicyModule.Policy(50 * uint192(USD), 3600, 100))));
        assertEq(module.readRemainingCap(), 0);
        assertEq(module.readSpent24hUsd(), 90 * USD);
        _govern(abi.encodeCall(module.setPolicy, (IPolicyModule.Policy(100 * uint192(USD), 3600, 100))));
        assertEq(module.readRemainingCap(), 10 * USD);
    }

    function test_RevokeAndRegrantDoesNotEraseSpend() public {
        _swap(90e6);
        _govern(abi.encodeCall(module.revokeSession, (agent)));
        _govern(abi.encodeCall(module.grantSession, (agent, uint64(block.timestamp + 1 days))));
        assertEq(module.readSpent24hUsd(), 90 * USD);
        _swap(10e6);
        assertEq(module.readRemainingCap(), 0);
    }

    function test_RevokeStopsNextTransaction() public {
        _govern(abi.encodeCall(module.revokeSession, (agent)));
        vm.expectRevert(IPolicyModule.SessionRevoked.selector);
        _swap(10e6);
        assertTrue(module.readSession(agent).revoked);
        _assertUntouched();
    }

    function test_SessionExpiresAtExactTimestamp() public {
        vm.warp(module.readSession(agent).expiresAt);
        vm.expectRevert(IPolicyModule.SessionExpired.selector);
        _swap(10e6);
        _assertUntouched();
    }

    function test_UnknownCallerBlocked() public {
        IPolicyModule.SwapRequest memory request = _request(10e6);
        vm.expectRevert(IPolicyModule.UnauthorizedSession.selector);
        vm.prank(stranger);
        module.executeSwap(request);
        _assertUntouched();
    }

    function test_OwnerEOACannotBypassSafeGovernance() public {
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        vm.prank(owner);
        module.grantSession(stranger, uint64(block.timestamp + 1 days));
    }

    function test_AgentCannotGrantRevokeOrChangePolicy() public {
        vm.startPrank(agent);
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.grantSession(stranger, uint64(block.timestamp + 1 days));
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.revokeSession(agent);
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.setPolicy(IPolicyModule.Policy(type(uint192).max, 3600, 100));
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.setTokenAllowed(stranger, true);
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.setRouterAllowed(stranger, true);
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.setVaultAllowed(stranger, true);
        vm.expectRevert(IPolicyModule.OnlySafe.selector);
        module.setPaused(false);
        vm.stopPrank();
    }

    function test_KillSwitchStopsAllAgentOperations() public {
        _govern(abi.encodeCall(module.setPaused, (true)));
        vm.expectRevert(IPolicyModule.Paused.selector);
        _swap(1e6);
        vm.expectRevert(IPolicyModule.Paused.selector);
        _deposit(1e6);
        IPolicyModule.WithdrawRequest memory request =
            IPolicyModule.WithdrawRequest(address(vault), 1e6, 1e6, address(safe), block.timestamp + 60);
        vm.expectRevert(IPolicyModule.Paused.selector);
        vm.prank(agent);
        module.executeVaultWithdraw(request);
        _govern(abi.encodeCall(module.setPaused, (false)));
        _swap(1e6);
    }

    function test_ForeignRecipientCannotReceiveTokens() public {
        IPolicyModule.SwapRequest memory request = _request(50e6);
        request.recipient = stranger;
        vm.expectRevert(IPolicyModule.InvalidRecipient.selector);
        vm.prank(agent);
        module.executeSwap(request);
        assertEq(token.balanceOf(stranger), 0);
        _assertUntouched();
    }

    function test_TokenInNotWhitelisted() public {
        _govern(abi.encodeCall(module.setTokenAllowed, (address(usdc), false)));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.TokenNotWhitelisted.selector, address(usdc)));
        _swap(10e6);
        _assertUntouched();
    }

    function test_TokenOutNotWhitelisted() public {
        _govern(abi.encodeCall(module.setTokenAllowed, (address(token), false)));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.TokenNotWhitelisted.selector, address(token)));
        _swap(10e6);
    }

    function test_RouterNotWhitelisted() public {
        _govern(abi.encodeCall(module.setRouterAllowed, (address(router), false)));
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.RouterNotWhitelisted.selector, address(router)));
        _swap(10e6);
        assertEq(usdc.allowance(address(safe), address(router)), 0);
    }

    function test_DeadlineExpired() public {
        IPolicyModule.SwapRequest memory request = _request(10e6);
        request.deadline = block.timestamp - 1;
        vm.expectRevert(IPolicyModule.DeadlineExpired.selector);
        vm.prank(agent);
        module.executeSwap(request);
    }

    function test_ZeroAmountRejected() public {
        vm.expectRevert(IPolicyModule.InvalidAmount.selector);
        _swap(0);
    }

    function test_SameTokenRejected() public {
        IPolicyModule.SwapRequest memory request = _request(10e6);
        request.tokenOut = address(usdc);
        vm.expectRevert(IPolicyModule.InvalidAmount.selector);
        vm.prank(agent);
        module.executeSwap(request);
    }

    function test_StalePriceRejected() public {
        oracle.setPriceWithTimestamp(address(usdc), USD, block.timestamp - 3601);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.StalePrice.selector, address(usdc)));
        _swap(10e6);
        _assertUntouched();
    }

    function test_MaxPriceAgeBoundaryAllowed() public {
        oracle.setPriceWithTimestamp(address(usdc), USD, block.timestamp - 3600);
        _swap(10e6);
    }

    function test_FuturePriceRejected() public {
        oracle.setPriceWithTimestamp(address(token), 10 * USD, block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.InvalidPrice.selector, address(token)));
        _swap(10e6);
    }

    function test_MissingOrZeroPriceRejected() public {
        oracle.setPrice(address(token), 0);
        vm.expectRevert(abi.encodeWithSelector(IPolicyModule.InvalidPrice.selector, address(token)));
        _swap(10e6);
    }

    function test_WeakMinOutRejectedBeforeApproval() public {
        IPolicyModule.SwapRequest memory request = _request(10e6);
        request.minAmountOut--;
        vm.expectRevert(IPolicyModule.SlippageExceeded.selector);
        vm.prank(agent);
        module.executeSwap(request);
        assertEq(usdc.allowance(address(safe), address(router)), 0);
        _assertUntouched();
    }

    function test_RouterRevertRollsBackSpendAndAllowance() public {
        router.setShouldFail(true);
        vm.expectPartialRevert(IPolicyModule.ExecutionFailed.selector);
        _swap(50e6);
        _assertUntouched();
        assertEq(usdc.allowance(address(safe), address(router)), 0);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_InsufficientBalanceRollsBackCap() public {
        _govern(abi.encodeCall(module.setPolicy, (IPolicyModule.Policy(2000 * uint192(USD), 3600, 100))));
        vm.expectPartialRevert(IPolicyModule.ExecutionFailed.selector);
        _swap(1001e6);
        _assertUntouched();
        assertEq(usdc.allowance(address(safe), address(router)), 0);
    }

    function test_NoArbitraryCallOrApproveEntryPoint() public {
        vm.startPrank(agent);
        (bool callSuccess,) = address(module)
            .call(
                abi.encodeWithSignature(
                    "execute(address,bytes)",
                    address(usdc),
                    abi.encodeWithSignature("transfer(address,uint256)", stranger, 50e6)
                )
            );
        (bool approveSuccess,) = address(module)
            .call(
                abi.encodeWithSignature("approve(address,address,uint256)", address(usdc), stranger, type(uint256).max)
            );
        vm.stopPrank();
        assertFalse(callSuccess);
        assertFalse(approveSuccess);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.allowance(address(safe), stranger), 0);
    }

    function test_SessionCannotCallSafeModuleExecutionDirectly() public {
        vm.expectRevert(bytes("GS104"));
        vm.prank(agent);
        safe.execTransactionFromModule(
            address(usdc), 0, abi.encodeWithSignature("transfer(address,uint256)", stranger, 50e6), _callOperation()
        );
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_HistoryFailsClosedAndRecoversAfterExpiry() public {
        for (uint256 i; i < 256; ++i) {
            _swap(1);
        }
        uint256 beforeBalance = usdc.balanceOf(address(safe));
        vm.expectRevert(IPolicyModule.SpendHistoryFull.selector);
        _swap(1);
        assertEq(usdc.balanceOf(address(safe)), beforeBalance);
        assertEq(module.readSpent24hUsd(), 25600);
        vm.warp(block.timestamp + 24 hours);
        _refreshPrices();
        _swap(1e6);
        assertEq(module.readSpent24hUsd(), USD);
    }

    function test_HighDecimalsTokenRejected() public {
        MockERC20 bad = new MockERC20("Bad", "BAD", 19);
        vm.expectRevert(IPolicyModule.InvalidConfiguration.selector);
        vm.prank(address(safe));
        module.setTokenAllowed(address(bad), true);
    }

    function test_InvalidPolicyAndSessionRejected() public {
        vm.startPrank(address(safe));
        vm.expectRevert(IPolicyModule.InvalidConfiguration.selector);
        module.setPolicy(IPolicyModule.Policy(1, 0, 100));
        vm.expectRevert(IPolicyModule.InvalidConfiguration.selector);
        module.setPolicy(IPolicyModule.Policy(1, 3600, 1001));
        vm.expectRevert(IPolicyModule.InvalidConfiguration.selector);
        module.grantSession(address(0), uint64(block.timestamp + 1));
        vm.expectRevert(IPolicyModule.InvalidConfiguration.selector);
        module.grantSession(agent, uint64(block.timestamp));
        vm.stopPrank();
    }

    function _callOperation() private pure returns (Enum.Operation) {
        return Enum.Operation.Call;
    }

    function _assertUntouched() private view {
        assertEq(usdc.balanceOf(address(safe)), 1_000e6);
        assertEq(token.balanceOf(address(safe)), 100e18);
        assertEq(module.readSpent24hUsd(), 0);
    }
}
