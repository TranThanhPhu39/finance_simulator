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

export interface TradeStep {
  stepIndex: number;
  action: TradeActionType;
  targetContract: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  estimatedValueUsd: string;
}

export interface RebalancePlan {
  planId: string;
  snapshotTimestamp: number;
  status: 'NO_ACTION' | 'READY' | 'BLOCKED';
  isPartial: boolean;
  steps: TradeStep[];
  ruleReasoning: string;
  llmExplanation?: string;
}
