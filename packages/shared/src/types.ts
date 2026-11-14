export type NetworkEnv = 'local' | 'fuji';
export type ActionSource = 'AGENT_RULE' | 'HARNESS_MUTATED' | 'DIRECT_SESSION_CALL';

export enum ErrorCode {
  OK = 'OK',
  ERR_CAP_EXCEEDED = 'ERR_CAP_EXCEEDED',
  ERR_UNAUTHORIZED_TOKEN = 'ERR_UNAUTHORIZED_TOKEN',
  ERR_UNAUTHORIZED_VAULT = 'ERR_UNAUTHORIZED_VAULT',
  ERR_UNAUTHORIZED_ROUTER = 'ERR_UNAUTHORIZED_ROUTER',
  ERR_INVALID_RECIPIENT = 'ERR_INVALID_RECIPIENT',
  ERR_SESSION_EXPIRED = 'ERR_SESSION_EXPIRED',
  ERR_SESSION_REVOKED = 'ERR_SESSION_REVOKED',
  ERR_SLIPPAGE_TOO_HIGH = 'ERR_SLIPPAGE_TOO_HIGH',
  ERR_STALE_PRICE = 'ERR_STALE_PRICE',
  ERR_ROUTER_FAILED = 'ERR_ROUTER_FAILED',
  ERR_UNAUTHORIZED_SESSION = 'ERR_UNAUTHORIZED_SESSION',
  ERR_PAUSED = 'ERR_PAUSED',
  ERR_INVALID_PRICE = 'ERR_INVALID_PRICE',
  ERR_DEADLINE_EXPIRED = 'ERR_DEADLINE_EXPIRED',
  ERR_INVALID_AMOUNT = 'ERR_INVALID_AMOUNT',
  ERR_HISTORY_FULL = 'ERR_HISTORY_FULL',
  ERR_ONLY_SAFE = 'ERR_ONLY_SAFE',
  ERR_INVALID_CONFIG = 'ERR_INVALID_CONFIG',
  ERR_TOKEN_OPERATION = 'ERR_TOKEN_OPERATION',
  ERR_BALANCE_CHANGE = 'ERR_BALANCE_CHANGE',
  ERR_VAULT_ASSET_CHANGED = 'ERR_VAULT_ASSET_CHANGED',
  ERR_EXECUTION_FAILED = 'ERR_EXECUTION_FAILED',
  ERR_MODULE_DISABLED = 'ERR_MODULE_DISABLED',
  ERR_TRANSACTION_REVERTED = 'ERR_TRANSACTION_REVERTED',
  ERR_RPC_OR_ENV = 'ERR_RPC_OR_ENV'
}

export interface PolicyConfig {
  accountAddress: string;
  network: NetworkEnv;
  sessionKey: string;
  sessionExpiresAt: number;
  isRevoked: boolean;
  cap24hUsd: string;        // 8 decimals USD string
  remainingCapUsd: string;  // 8 decimals USD string
  maxSlippageBps: number;   // 100 = 1%
  maxPriceAgeSec: number;
  whitelistedTokens: string[];
  whitelistedVaults: string[];
  whitelistedRouters: string[];
  allowedRecipient: string;
  paused?: boolean;
  capScope: 'SWAP_INPUT_ONLY';
}

export interface AssetPosition {
  tokenAddress: string;
  vaultAddress?: string;
  symbol: string;           // 'USDC' | 'sAVAX' | 'tBOND'
  decimals: number;
  rawBalance: string;       // BigInt string
  priceUsd: string;         // 8 decimals USD string
  valueUsd: string;         // 8 decimals USD string
  currentBps: number;       // 0 - 10000
  targetBps: number;        // 0 - 10000
  isVaultPosition: boolean;
  vaultShares?: string;
  accruedYieldUsd?: string;
  // convertToShares(assets), read at the snapshot block. Quote is indicative;
  // executor rechecks the exact amount before submission and never weakens plan bounds.
  vaultConversion?: { assets: string; shares: string };
}

export interface PortfolioSnapshot {
  accountAddress: string;
  network: NetworkEnv;
  blockNumber: number;
  timestamp: number;
  totalValueUsd: string;    // 8 decimals USD string
  positions: AssetPosition[];
}

export type TradeActionType = 'SWAP_EXACT_IN' | 'VAULT_DEPOSIT' | 'VAULT_WITHDRAW';

interface TradeStepBase {
  stepIndex: number;
  targetContract: string;
  estimatedValueUsd: string;
  deadline: number;
}

export interface SwapStep extends TradeStepBase {
  action: 'SWAP_EXACT_IN';
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
}

export interface VaultDepositStep extends TradeStepBase {
  action: 'VAULT_DEPOSIT';
  tokenIn: string;
  assets: string;       // raw underlying units, never shares
  minShares: string;
}

export interface VaultWithdrawStep extends TradeStepBase {
  action: 'VAULT_WITHDRAW';
  tokenOut: string;     // underlying; withdraw does not implicitly swap to USDC
  assets: string;
  maxShares: string;
}

export type TradeStep = SwapStep | VaultDepositStep | VaultWithdrawStep;

export interface RebalancePlan {
  planId: string;
  snapshotTimestamp: number;
  status: 'NO_ACTION' | 'READY' | 'BLOCKED';
  isPartial: boolean;
  steps: TradeStep[];
  ruleReasoning: string;
  llmExplanation?: string;
}
