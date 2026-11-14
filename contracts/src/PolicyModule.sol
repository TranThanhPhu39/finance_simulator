// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Enum} from "@safe/common/Enum.sol";
import {IPolicyModule} from "./interfaces/IPolicyModule.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {ISupportedRouter} from "./interfaces/ISupportedRouter.sol";
import {RollingSpend} from "./libraries/RollingSpend.sol";

interface ISafeModuleAccount {
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external returns (bool success, bytes memory returnData);
}

/// @notice One Safe, one immutable price source, typed operations only. Governance is performed BY the Safe.
/// @dev Demo policy, not audited. Whitelisted routers/vaults/oracle and Safe owners remain trusted.
contract PolicyModule is IPolicyModule, ReentrancyGuard {
    using RollingSpend for RollingSpend.History;

    uint256 public constant BPS = 10_000;
    uint256 public constant WINDOW = 24 hours;
    uint256 public constant MAX_ACTIVE_SWAPS = 256;
    address public immutable safe;
    IPriceSource public immutable priceSource;
    bool public paused;

    Policy private policy;
    mapping(address => Session) private sessions;
    mapping(address => bool) public allowedTokens;
    mapping(address => uint8) public tokenDecimals;
    mapping(address => bool) public allowedRouters;
    mapping(address => address) public vaultAssets;
    RollingSpend.History private history;

    constructor(address safe_, address priceSource_, Policy memory initialPolicy) {
        if (safe_.code.length == 0 || priceSource_.code.length == 0) revert InvalidConfiguration();
        safe = safe_;
        priceSource = IPriceSource(priceSource_);
        _setPolicy(initialPolicy);
    }

    modifier onlySafe() {
        if (msg.sender != safe) revert OnlySafe();
        _;
    }

    modifier authorized() {
        if (paused) revert Paused();
        Session memory session = sessions[msg.sender];
        if (session.revoked) revert SessionRevoked();
        if (session.expiresAt == 0) revert UnauthorizedSession();
        if (block.timestamp >= session.expiresAt) revert SessionExpired();
        _;
    }

    function setPolicy(Policy calldata nextPolicy) external onlySafe nonReentrant {
        _setPolicy(nextPolicy);
    }

    function grantSession(address key, uint64 expiresAt) external onlySafe nonReentrant {
        if (key == address(0) || key == safe || key == address(this) || expiresAt <= block.timestamp) {
            revert InvalidConfiguration();
        }
        sessions[key] = Session(expiresAt, false);
        emit SessionGranted(key, expiresAt);
    }

    function revokeSession(address key) external onlySafe nonReentrant {
        sessions[key].revoked = true;
        emit SessionRevokedEvent(key);
    }

    function setPaused(bool value) external onlySafe nonReentrant {
        paused = value;
        emit PauseChanged(value);
    }

    function setTokenAllowed(address token, bool allowed) external onlySafe nonReentrant {
        if (allowed) {
            if (token.code.length == 0 || token == safe || token == address(this)) revert InvalidConfiguration();
            uint8 decimals = IERC20Metadata(token).decimals();
            if (decimals > 18) revert InvalidConfiguration();
            tokenDecimals[token] = decimals;
        }
        allowedTokens[token] = allowed;
        emit TokenPermissionChanged(token, allowed);
    }

    function setRouterAllowed(address router, bool allowed) external onlySafe nonReentrant {
        if (allowed && (router.code.length == 0 || router == safe || router == address(this))) {
            revert InvalidConfiguration();
        }
        allowedRouters[router] = allowed;
        emit RouterPermissionChanged(router, allowed);
    }

    function setVaultAllowed(address vault, bool allowed) external onlySafe nonReentrant {
        address asset;
        if (allowed) {
            if (vault.code.length == 0 || vault == safe || vault == address(this)) revert InvalidConfiguration();
            asset = IERC4626(vault).asset();
            _checkToken(asset);
        }
        vaultAssets[vault] = asset;
        emit VaultPermissionChanged(vault, asset, allowed);
    }

    function readPolicy() external view returns (Policy memory) {
        return policy;
    }

    function readSession(address key) external view returns (Session memory) {
        return sessions[key];
    }

    function readSpent24hUsd() public view returns (uint256) {
        return history.spent();
    }

    function readRemainingCap() external view returns (uint256) {
        uint256 used = readSpent24hUsd();
        return used >= policy.cap24hUsd ? 0 : policy.cap24hUsd - used;
    }

    function executeSwap(SwapRequest calldata r) external nonReentrant authorized returns (uint256 amountOut) {
        _checkRequest(r.recipient, r.deadline, r.amountIn);
        _checkToken(r.tokenIn);
        _checkToken(r.tokenOut);
        if (r.tokenIn == r.tokenOut) revert InvalidAmount();
        if (!allowedRouters[r.router]) revert RouterNotWhitelisted(r.router);

        uint192 valueUsd = _validateSwapValue(r);
        if (!history.record(valueUsd)) revert SpendHistoryFull();
        uint256 beforeIn = IERC20(r.tokenIn).balanceOf(safe);
        uint256 beforeOut = IERC20(r.tokenOut).balanceOf(safe);
        _approve(r.tokenIn, r.router, r.amountIn);
        _call(
            r.router,
            abi.encodeCall(ISupportedRouter.exactInputSingle, (r.tokenIn, r.tokenOut, r.amountIn, r.minAmountOut, safe))
        );
        _approve(r.tokenIn, r.router, 0);
        uint256 afterIn = IERC20(r.tokenIn).balanceOf(safe);
        uint256 afterOut = IERC20(r.tokenOut).balanceOf(safe);
        if (afterIn > beforeIn || beforeIn - afterIn != r.amountIn || afterOut < beforeOut) {
            revert UnexpectedBalanceChange();
        }
        amountOut = afterOut - beforeOut;
        if (amountOut < r.minAmountOut) revert SlippageExceeded();
        emit SwapExecuted(msg.sender, r.tokenIn, r.tokenOut, r.amountIn, amountOut, valueUsd);
    }

    function executeVaultDeposit(DepositRequest calldata r) external nonReentrant authorized returns (uint256 shares) {
        _checkRequest(r.recipient, r.deadline, r.assets);
        address asset = _vaultAsset(r.vault);
        uint256 referenceShares = IERC4626(r.vault).convertToShares(r.assets);
        uint256 required = Math.mulDiv(referenceShares, BPS - policy.maxSlippageBps, BPS, Math.Rounding.Ceil);
        if (required == 0 || r.minShares < required) revert SlippageExceeded();
        uint256 beforeAssets = IERC20(asset).balanceOf(safe);
        uint256 beforeShares = IERC20(r.vault).balanceOf(safe);
        _approve(asset, r.vault, r.assets);
        _call(r.vault, abi.encodeCall(IERC4626.deposit, (r.assets, safe)));
        _approve(asset, r.vault, 0);
        uint256 afterAssets = IERC20(asset).balanceOf(safe);
        uint256 afterShares = IERC20(r.vault).balanceOf(safe);
        if (afterAssets > beforeAssets || beforeAssets - afterAssets != r.assets || afterShares < beforeShares) {
            revert UnexpectedBalanceChange();
        }
        shares = afterShares - beforeShares;
        if (shares < r.minShares) revert SlippageExceeded();
        emit VaultDeposited(msg.sender, r.vault, r.assets, shares);
    }

    /// @notice Withdraw EXACT assets, with an upper bound on shares burned. Owner/receiver are always the Safe.
    function executeVaultWithdraw(WithdrawRequest calldata r)
        external
        nonReentrant
        authorized
        returns (uint256 shares)
    {
        _checkRequest(r.recipient, r.deadline, r.assets);
        address asset = _vaultAsset(r.vault);
        // convertToShares rounds down; allow at most one base share for rounding, then the policy tolerance.
        uint256 referenceShares = IERC4626(r.vault).convertToShares(r.assets);
        uint256 permitted = Math.mulDiv(referenceShares + 1, BPS + policy.maxSlippageBps, BPS, Math.Rounding.Ceil);
        if (r.maxShares == 0 || r.maxShares > permitted) revert SlippageExceeded();
        uint256 beforeAssets = IERC20(asset).balanceOf(safe);
        uint256 beforeShares = IERC20(r.vault).balanceOf(safe);
        _call(r.vault, abi.encodeCall(IERC4626.withdraw, (r.assets, safe, safe)));
        uint256 afterAssets = IERC20(asset).balanceOf(safe);
        uint256 afterShares = IERC20(r.vault).balanceOf(safe);
        if (afterAssets < beforeAssets || afterAssets - beforeAssets != r.assets || afterShares >= beforeShares) {
            revert UnexpectedBalanceChange();
        }
        shares = beforeShares - afterShares;
        if (shares > r.maxShares) revert SlippageExceeded();
        emit VaultWithdrawn(msg.sender, r.vault, r.assets, shares);
    }

    function _setPolicy(Policy memory nextPolicy) private {
        if (nextPolicy.maxPriceAgeSec == 0 || nextPolicy.maxSlippageBps > 1_000) revert InvalidConfiguration();
        policy = nextPolicy;
        emit PolicyUpdated(nextPolicy.cap24hUsd, nextPolicy.maxPriceAgeSec, nextPolicy.maxSlippageBps);
    }

    function _validateSwapValue(SwapRequest calldata r) private view returns (uint192) {
        uint256 priceIn = _price(r.tokenIn);
        uint256 priceOut = _price(r.tokenOut);
        uint256 valueUsd = Math.mulDiv(r.amountIn, priceIn, 10 ** tokenDecimals[r.tokenIn], Math.Rounding.Ceil);
        uint256 used = history.spent();
        if (valueUsd > policy.cap24hUsd || used > policy.cap24hUsd - valueUsd) {
            revert CapExceeded(used, valueUsd, policy.cap24hUsd);
        }
        // Debit rounds UP. Minimum output derives from the floor value, then rounds UP at the slippage boundary.
        uint256 floorValueUsd = Math.mulDiv(r.amountIn, priceIn, 10 ** tokenDecimals[r.tokenIn]);
        if (floorValueUsd == 0) revert InvalidAmount();
        uint256 expectedOut = Math.mulDiv(floorValueUsd, 10 ** tokenDecimals[r.tokenOut], priceOut);
        uint256 requiredOut = Math.mulDiv(expectedOut, BPS - policy.maxSlippageBps, BPS, Math.Rounding.Ceil);
        if (requiredOut == 0 || r.minAmountOut < requiredOut) revert SlippageExceeded();
        // Safe because the check above bounds valueUsd by the uint192 cap.
        return uint192(valueUsd);
    }

    function _checkToken(address token) private view {
        if (!allowedTokens[token]) revert TokenNotWhitelisted(token);
    }

    function _checkRequest(address recipient, uint256 deadline, uint256 amount) private view {
        if (recipient != safe) revert InvalidRecipient();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amount == 0) revert InvalidAmount();
    }

    function _vaultAsset(address vault) private view returns (address asset) {
        asset = vaultAssets[vault];
        if (asset == address(0)) revert VaultNotWhitelisted(vault);
        if (IERC4626(vault).asset() != asset) revert VaultAssetChanged(vault);
        _checkToken(asset);
    }

    function _price(address token) private view returns (uint256 value) {
        uint256 updatedAt;
        try priceSource.getPrice(token) returns (uint256 price, uint256 timestamp) {
            value = price;
            updatedAt = timestamp;
        } catch {
            revert InvalidPrice(token);
        }
        if (value == 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidPrice(token);
        if (block.timestamp - updatedAt > policy.maxPriceAgeSec) revert StalePrice(token);
    }

    function _approve(address token, address spender, uint256 amount) private {
        // Always zero first. No public arbitrary approve, transfer, target, selector, value or delegatecall.
        _tokenCall(token, abi.encodeCall(IERC20.approve, (spender, 0)));
        if (amount != 0) _tokenCall(token, abi.encodeCall(IERC20.approve, (spender, amount)));
        if (IERC20(token).allowance(safe, spender) != amount) revert TokenOperationFailed(token);
    }

    function _tokenCall(address token, bytes memory data) private {
        bytes memory result = _call(token, data);
        if (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool)))) {
            revert TokenOperationFailed(token);
        }
    }

    function _call(address target, bytes memory data) private returns (bytes memory result) {
        bool success;
        (success, result) =
            ISafeModuleAccount(safe).execTransactionFromModuleReturnData(target, 0, data, Enum.Operation.Call);
        if (!success) revert ExecutionFailed(target, result);
    }
}
