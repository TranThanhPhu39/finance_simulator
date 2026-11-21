// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

interface IPolicyModule {
    struct Policy {
        uint192 cap24hUsd;
        uint32 maxPriceAgeSec;
        uint16 maxSlippageBps;
    }

    struct Session {
        uint64 expiresAt;
        bool revoked;
    }

    struct SwapRequest {
        address router;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
    }

    struct DepositRequest {
        address vault;
        uint256 assets;
        uint256 minShares;
        address recipient;
        uint256 deadline;
    }

    struct WithdrawRequest {
        address vault;
        uint256 assets;
        uint256 maxShares;
        address recipient;
        uint256 deadline;
    }

    error OnlySafe();
    error InvalidConfiguration();
    error UnauthorizedSession();
    error SessionExpired();
    error SessionRevoked();
    error Paused();
    error TokenNotWhitelisted(address token);
    error RouterNotWhitelisted(address router);
    error VaultNotWhitelisted(address vault);
    error VaultAssetChanged(address vault);
    error InvalidRecipient();
    error InvalidAmount();
    error DeadlineExpired();
    error InvalidPrice(address token);
    error StalePrice(address token);
    error CapExceeded(uint256 used, uint256 requested, uint256 cap);
    error SpendHistoryFull();
    error SlippageExceeded();
    error ExecutionFailed(address target, bytes reason);
    error TokenOperationFailed(address token);
    error UnexpectedBalanceChange();

    event PolicyUpdated(uint192 cap24hUsd, uint32 maxPriceAgeSec, uint16 maxSlippageBps);
    event SessionGranted(address indexed key, uint64 expiresAt);
    event SessionRevokedEvent(address indexed key);
    event PauseChanged(bool paused);
    event TokenPermissionChanged(address indexed token, bool allowed);
    event RouterPermissionChanged(address indexed router, bool allowed);
    event VaultPermissionChanged(address indexed vault, address indexed asset, bool allowed);
    event SwapExecuted(
        address indexed session,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 valueUsd
    );
    event VaultDeposited(address indexed session, address indexed vault, uint256 assets, uint256 shares);
    event VaultWithdrawn(address indexed session, address indexed vault, uint256 assets, uint256 shares);

    function readPolicy() external view returns (Policy memory);
    function readSession(address key) external view returns (Session memory);
    function readSpent24hUsd() external view returns (uint256);
    function readRemainingCap() external view returns (uint256);
    function executeSwap(SwapRequest calldata request) external returns (uint256 amountOut);
    function executeVaultDeposit(DepositRequest calldata request) external returns (uint256 shares);
    function executeVaultWithdraw(WithdrawRequest calldata request) external returns (uint256 shares);
}
