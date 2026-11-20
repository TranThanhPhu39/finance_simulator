import {
  ErrorCode,
  type ActionSource,
  type AssertionResult,
  type BalanceDiff,
  type NetworkEnv,
  type PolicyConfig,
  type PortfolioSnapshot,
  type RunResult,
  type RunStepLog,
  type ScenarioDefinition,
  type TradeStep
} from '@repo/shared';
import { computeRebalancePlan, generateExplanation } from '@repo/agent';

export const DEFAULT_ADDRESSES = {
  safe: '0x1000000000000000000000000000000000000001',
  sessionKey: '0x1000000000000000000000000000000000000002',
  usdc: '0x2000000000000000000000000000000000000001',
  tokenA: '0x2000000000000000000000000000000000000002',
  unauthorizedToken: '0x2000000000000000000000000000000000000099',
  router: '0x3000000000000000000000000000000000000001',
  unauthorizedRouter: '0x3000000000000000000000000000000000000099',
  vault: '0x4000000000000000000000000000000000000001',
  unauthorizedVault: '0x4000000000000000000000000000000000000099',
  foreignRecipient: '0x9999999999999999999999999999999999999999'
} as const;

const BPS = 10000n;
const WINDOW_SEC = 86400;
const MAX_ACTIVE_SWAPS = 256;

const ceilDiv = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;
const lower = (addr: string): string => addr.toLowerCase();

interface SpendEntry {
  timestamp: number;
  valueUsd: bigint;
}

interface TokenMeta {
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: bigint;
  updatedAt: number;
}

export interface SimulatorState {
  now: number;
  policy: PolicyConfig;
  tokens: Record<string, TokenMeta>;
  vaultAssets: Record<string, string>;
  safeBalances: Record<string, bigint>;
  foreignBalances: Record<string, bigint>;
  spendHistory: SpendEntry[];
  routerShouldFail: boolean;
}

export interface SimulatedOperation {
  label: string;
  actionSource: ActionSource;
  step: TradeStep;
  recipient?: string;
}

export function createBasePolicy(env: NetworkEnv = 'local', now = 1800000000): PolicyConfig {
  return {
    accountAddress: DEFAULT_ADDRESSES.safe,
    network: env,
    sessionKey: DEFAULT_ADDRESSES.sessionKey,
    sessionExpiresAt: now + 86400,
    isRevoked: false,
    cap24hUsd: '10000000000', // $100.00 (8 decimals)
    remainingCapUsd: '10000000000',
    maxSlippageBps: 100, // 1%
    maxPriceAgeSec: 3600,
    whitelistedTokens: [DEFAULT_ADDRESSES.usdc, DEFAULT_ADDRESSES.tokenA],
    whitelistedVaults: [DEFAULT_ADDRESSES.vault],
    whitelistedRouters: [DEFAULT_ADDRESSES.router],
    allowedRecipient: DEFAULT_ADDRESSES.safe,
    paused: false,
    capScope: 'SWAP_INPUT_ONLY'
  };
}

export function createBasePortfolioSnapshot(env: NetworkEnv = 'local', now = 1800000000): PortfolioSnapshot {
  return {
    accountAddress: DEFAULT_ADDRESSES.safe,
    network: env,
    blockNumber: 100,
    timestamp: now,
    totalValueUsd: '100000000000', // $1,000.00
    positions: [
      {
        tokenAddress: DEFAULT_ADDRESSES.usdc,
        symbol: 'USDC',
        decimals: 6,
        rawBalance: '600000000', // 600 USDC
        priceUsd: '100000000', // $1.00
        valueUsd: '60000000000', // $600.00
        currentBps: 6000,
        targetBps: 2000,
        isVaultPosition: false
      },
      {
        tokenAddress: DEFAULT_ADDRESSES.tokenA,
        symbol: 'A',
        decimals: 18,
        rawBalance: '40000000000000000000', // 40 A
        priceUsd: '1000000000', // $10.00
        valueUsd: '40000000000', // $400.00
        currentBps: 4000,
        targetBps: 3000,
        isVaultPosition: false
      },
      {
        tokenAddress: DEFAULT_ADDRESSES.usdc,
        vaultAddress: DEFAULT_ADDRESSES.vault,
        symbol: 'vUSDC',
        decimals: 6,
        rawBalance: '0',
        priceUsd: '100000000',
        valueUsd: '0',
        currentBps: 0,
        targetBps: 5000,
        isVaultPosition: true,
        vaultShares: '0',
        vaultConversion: {
          assets: '1000000',
          shares: '1000000'
        }
      }
    ]
  };
}

export function createSimulatorState(env: NetworkEnv = 'local', now = 1800000000): SimulatorState {
  const policy = createBasePolicy(env, now);
  return {
    now,
    policy,
    tokens: {
      [lower(DEFAULT_ADDRESSES.usdc)]: {
        address: DEFAULT_ADDRESSES.usdc,
        symbol: 'USDC',
        decimals: 6,
        priceUsd: 100000000n,
        updatedAt: now
      },
      [lower(DEFAULT_ADDRESSES.tokenA)]: {
        address: DEFAULT_ADDRESSES.tokenA,
        symbol: 'A',
        decimals: 18,
        priceUsd: 1000000000n,
        updatedAt: now
      },
      [lower(DEFAULT_ADDRESSES.unauthorizedToken)]: {
        address: DEFAULT_ADDRESSES.unauthorizedToken,
        symbol: 'ROGUE',
        decimals: 18,
        priceUsd: 100000000n,
        updatedAt: now
      }
    },
    vaultAssets: {
      [lower(DEFAULT_ADDRESSES.vault)]: DEFAULT_ADDRESSES.usdc
    },
    safeBalances: {
      [lower(DEFAULT_ADDRESSES.usdc)]: 600000000n,
      [lower(DEFAULT_ADDRESSES.tokenA)]: 40000000000000000000n,
      [lower(DEFAULT_ADDRESSES.vault)]: 0n
    },
    foreignBalances: {
      [lower(DEFAULT_ADDRESSES.usdc)]: 0n,
      [lower(DEFAULT_ADDRESSES.tokenA)]: 0n
    },
    spendHistory: [],
    routerShouldFail: false
  };
}

export function computeRollingSpentUsd(state: SimulatorState): bigint {
  let total = 0n;
  for (const entry of state.spendHistory) {
    if (entry.timestamp + WINDOW_SEC > state.now) {
      total += entry.valueUsd;
    }
  }
  return total;
}

function pruneSpendHistory(state: SimulatorState): void {
  state.spendHistory = state.spendHistory.filter(e => e.timestamp + WINDOW_SEC > state.now);
}

/**
 * Exact BigInt simulation of PolicyModule.sol rules.
 * Never invents a fake txHash; reverted operations roll back state completely.
 */
export function executeSimulatedOperation(
  state: SimulatorState,
  op: SimulatedOperation
): { status: 'OK' | 'BLOCKED' | 'FAILED'; errorCode: ErrorCode; detail: string } {
  const { policy } = state;
  const step = op.step;
  const recipient = op.recipient ?? policy.allowedRecipient;

  // 1. Modifier authorized()
  if (policy.paused) {
    return { status: 'BLOCKED', errorCode: ErrorCode.ERR_PAUSED, detail: 'PolicyModule đang ở trạng thái tạm dừng (Paused).' };
  }
  if (policy.isRevoked) {
    return { status: 'BLOCKED', errorCode: ErrorCode.ERR_SESSION_REVOKED, detail: 'Session key đã bị Safe owner thu hồi (SessionRevoked).' };
  }
  if (!policy.sessionKey || policy.sessionExpiresAt === 0) {
    return { status: 'BLOCKED', errorCode: ErrorCode.ERR_UNAUTHORIZED_SESSION, detail: 'Session key chưa được cấp quyền (UnauthorizedSession).' };
  }
  if (state.now >= policy.sessionExpiresAt) {
    return { status: 'BLOCKED', errorCode: ErrorCode.ERR_SESSION_EXPIRED, detail: 'Session key đã hết hạn (SessionExpired).' };
  }

  // 2. _checkRequest(recipient, deadline, amount)
  if (lower(recipient) !== lower(policy.accountAddress)) {
    return {
      status: 'BLOCKED',
      errorCode: ErrorCode.ERR_INVALID_RECIPIENT,
      detail: `PolicyModule từ chối recipient ngoài Safe (${recipient} != ${policy.accountAddress}): InvalidRecipient.`
    };
  }
  if (state.now > step.deadline) {
    return { status: 'BLOCKED', errorCode: ErrorCode.ERR_DEADLINE_EXPIRED, detail: 'Lệnh đã quá thời hạn deadline (DeadlineExpired).' };
  }

  const isTokenWhitelisted = (tokenAddr: string): boolean =>
    policy.whitelistedTokens.some(t => lower(t) === lower(tokenAddr));

  const validateTokenPrice = (tokenAddr: string): { ok: true; meta: TokenMeta } | { ok: false; code: ErrorCode; detail: string } => {
    const meta = state.tokens[lower(tokenAddr)];
    if (!meta || meta.priceUsd <= 0n || meta.updatedAt <= 0 || meta.updatedAt > state.now) {
      return { ok: false, code: ErrorCode.ERR_INVALID_PRICE, detail: `Giá Oracle không hợp lệ cho token ${tokenAddr} (InvalidPrice).` };
    }
    if (state.now - meta.updatedAt > policy.maxPriceAgeSec) {
      return {
        ok: false,
        code: ErrorCode.ERR_STALE_PRICE,
        detail: `Giá Oracle của ${meta.symbol} quá hạn (${state.now - meta.updatedAt}s > ${policy.maxPriceAgeSec}s): StalePrice.`
      };
    }
    return { ok: true, meta };
  };

  if (step.action === 'SWAP_EXACT_IN') {
    const amountIn = BigInt(step.amountIn);
    const minAmountOut = BigInt(step.minAmountOut);
    if (amountIn <= 0n) {
      return { status: 'BLOCKED', errorCode: ErrorCode.ERR_INVALID_AMOUNT, detail: 'Khối lượng swap bằng 0 (InvalidAmount).' };
    }
    if (!isTokenWhitelisted(step.tokenIn)) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_TOKEN,
        detail: `Token đầu vào ${step.tokenIn} không nằm trong whitelist (TokenNotWhitelisted).`
      };
    }
    if (!isTokenWhitelisted(step.tokenOut)) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_TOKEN,
        detail: `Token đầu ra ${step.tokenOut} không nằm trong whitelist (TokenNotWhitelisted).`
      };
    }
    if (lower(step.tokenIn) === lower(step.tokenOut)) {
      return { status: 'BLOCKED', errorCode: ErrorCode.ERR_INVALID_AMOUNT, detail: 'tokenIn trùng tokenOut (InvalidAmount).' };
    }
    const routerWhitelisted = policy.whitelistedRouters.some(r => lower(r) === lower(step.targetContract));
    if (!routerWhitelisted) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_ROUTER,
        detail: `Router ${step.targetContract} không nằm trong whitelist (RouterNotWhitelisted).`
      };
    }

    // _validateSwapValue
    const priceInRes = validateTokenPrice(step.tokenIn);
    if (!priceInRes.ok) return { status: 'BLOCKED', errorCode: priceInRes.code, detail: priceInRes.detail };
    const priceOutRes = validateTokenPrice(step.tokenOut);
    if (!priceOutRes.ok) return { status: 'BLOCKED', errorCode: priceOutRes.code, detail: priceOutRes.detail };

    const metaIn = priceInRes.meta;
    const metaOut = priceOutRes.meta;
    const scaleIn = 10n ** BigInt(metaIn.decimals);
    const scaleOut = 10n ** BigInt(metaOut.decimals);

    const valueUsd = ceilDiv(amountIn * metaIn.priceUsd, scaleIn);
    const used = computeRollingSpentUsd(state);
    const cap = BigInt(policy.cap24hUsd);

    if (valueUsd > cap || used + valueUsd > cap) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_CAP_EXCEEDED,
        detail: `Vượt hạn mức 24h: CapExceeded(used=${used.toString()}, requested=${valueUsd.toString()}, cap=${cap.toString()}).`
      };
    }

    const floorValueUsd = (amountIn * metaIn.priceUsd) / scaleIn;
    if (floorValueUsd === 0n) {
      return { status: 'BLOCKED', errorCode: ErrorCode.ERR_INVALID_AMOUNT, detail: 'Giá trị quy đổi USD quá nhỏ (InvalidAmount).' };
    }
    const expectedOut = (floorValueUsd * scaleOut) / metaOut.priceUsd;
    const requiredOut = ceilDiv(expectedOut * BigInt(10000 - policy.maxSlippageBps), BPS);
    if (requiredOut === 0n || minAmountOut < requiredOut) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_SLIPPAGE_TOO_HIGH,
        detail: `minAmountOut thấp hơn mức bảo vệ slippage của PolicyModule (${minAmountOut} < ${requiredOut}): SlippageExceeded.`
      };
    }

    pruneSpendHistory(state);
    if (state.spendHistory.length >= MAX_ACTIVE_SWAPS) {
      return { status: 'BLOCKED', errorCode: ErrorCode.ERR_HISTORY_FULL, detail: 'Bộ đệm lịch sử 256 lệnh swap đã đầy (SpendHistoryFull).' };
    }

    // Router execution check (if router reverts, transaction rolls back entirely)
    if (state.routerShouldFail) {
      return {
        status: 'FAILED',
        errorCode: ErrorCode.ERR_ROUTER_FAILED,
        detail: 'MockRouter revert "Router: Simulated failure" -> PolicyModule rollback toàn bộ số dư, allowance và hạn mức 24h.'
      };
    }

    const currentIn = state.safeBalances[lower(step.tokenIn)] ?? 0n;
    if (currentIn < amountIn) {
      return {
        status: 'FAILED',
        errorCode: ErrorCode.ERR_EXECUTION_FAILED,
        detail: 'Số dư trong Safe không đủ để thực hiện swap (ExecutionFailed).'
      };
    }

    const amountOut = (amountIn * metaIn.priceUsd * scaleOut) / (metaOut.priceUsd * scaleIn);
    if (amountOut < minAmountOut) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_SLIPPAGE_TOO_HIGH,
        detail: 'Đầu ra từ Router thấp hơn minAmountOut (SlippageExceeded).'
      };
    }

    // Commit state changes
    state.safeBalances[lower(step.tokenIn)] = currentIn - amountIn;
    state.safeBalances[lower(step.tokenOut)] = (state.safeBalances[lower(step.tokenOut)] ?? 0n) + amountOut;
    state.spendHistory.push({ timestamp: state.now, valueUsd });
    const newUsed = computeRollingSpentUsd(state);
    state.policy.remainingCapUsd = (cap > newUsed ? cap - newUsed : 0n).toString();

    return {
      status: 'OK',
      errorCode: ErrorCode.OK,
      detail: `Đã swap ${amountIn.toString()} ${metaIn.symbol} -> ${amountOut.toString()} ${metaOut.symbol} (tiêu thụ ${(Number(valueUsd) / 1e8).toFixed(2)} USD cap).`
    };
  }

  if (step.action === 'VAULT_DEPOSIT') {
    const assets = BigInt(step.assets);
    const minShares = BigInt(step.minShares);
    if (assets <= 0n) {
      return { status: 'BLOCKED', errorCode: ErrorCode.ERR_INVALID_AMOUNT, detail: 'Số lượng nạp vault bằng 0 (InvalidAmount).' };
    }
    const vaultAllowed = policy.whitelistedVaults.some(v => lower(v) === lower(step.targetContract));
    const configuredAsset = state.vaultAssets[lower(step.targetContract)];
    if (!vaultAllowed || !configuredAsset) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_VAULT,
        detail: `Vault ${step.targetContract} không nằm trong whitelist (VaultNotWhitelisted).`
      };
    }
    if (!isTokenWhitelisted(configuredAsset)) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_TOKEN,
        detail: `Tài sản cơ sở của Vault không nằm trong whitelist (TokenNotWhitelisted).`
      };
    }
    const referenceShares = assets; // 1:1 conversion at snapshot
    const requiredShares = ceilDiv(referenceShares * BigInt(10000 - policy.maxSlippageBps), BPS);
    if (requiredShares === 0n || minShares < requiredShares) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_SLIPPAGE_TOO_HIGH,
        detail: `minShares không đạt chuẩn slippage (SlippageExceeded).`
      };
    }
    const currentAssetBal = state.safeBalances[lower(configuredAsset)] ?? 0n;
    if (currentAssetBal < assets) {
      return { status: 'FAILED', errorCode: ErrorCode.ERR_EXECUTION_FAILED, detail: 'Số dư underlying không đủ để gửi vào Vault.' };
    }

    state.safeBalances[lower(configuredAsset)] = currentAssetBal - assets;
    state.safeBalances[lower(step.targetContract)] = (state.safeBalances[lower(step.targetContract)] ?? 0n) + referenceShares;

    return {
      status: 'OK',
      errorCode: ErrorCode.OK,
      detail: `Đã gửi ${assets.toString()} raw units vào Vault ${step.targetContract}, nhận ${referenceShares.toString()} shares về Safe (không tính vào swap cap 24h).`
    };
  }

  if (step.action === 'VAULT_WITHDRAW') {
    const assets = BigInt(step.assets);
    const maxShares = BigInt(step.maxShares);
    if (assets <= 0n) {
      return { status: 'BLOCKED', errorCode: ErrorCode.ERR_INVALID_AMOUNT, detail: 'Số lượng rút vault bằng 0 (InvalidAmount).' };
    }
    const vaultAllowed = policy.whitelistedVaults.some(v => lower(v) === lower(step.targetContract));
    const configuredAsset = state.vaultAssets[lower(step.targetContract)];
    if (!vaultAllowed || !configuredAsset) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_VAULT,
        detail: `Vault ${step.targetContract} không nằm trong whitelist (VaultNotWhitelisted).`
      };
    }
    if (!isTokenWhitelisted(configuredAsset)) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_UNAUTHORIZED_TOKEN,
        detail: `Tài sản cơ sở của Vault không nằm trong whitelist (TokenNotWhitelisted).`
      };
    }
    const referenceShares = assets;
    const permittedShares = ceilDiv((referenceShares + 1n) * BigInt(10000 + policy.maxSlippageBps), BPS);
    if (maxShares === 0n || maxShares > permittedShares) {
      return {
        status: 'BLOCKED',
        errorCode: ErrorCode.ERR_SLIPPAGE_TOO_HIGH,
        detail: 'maxShares vượt giới hạn cho phép (SlippageExceeded).'
      };
    }
    const currentShares = state.safeBalances[lower(step.targetContract)] ?? 0n;
    if (currentShares < referenceShares) {
      return { status: 'FAILED', errorCode: ErrorCode.ERR_EXECUTION_FAILED, detail: 'Shares trong Vault không đủ để rút.' };
    }

    state.safeBalances[lower(step.targetContract)] = currentShares - referenceShares;
    state.safeBalances[lower(configuredAsset)] = (state.safeBalances[lower(configuredAsset)] ?? 0n) + assets;

    return {
      status: 'OK',
      errorCode: ErrorCode.OK,
      detail: `Đã rút ${assets.toString()} raw units từ Vault ${step.targetContract} về Safe.`
    };
  }

  return { status: 'FAILED', errorCode: ErrorCode.ERR_EXECUTION_FAILED, detail: 'Loại lệnh không được hỗ trợ.' };
}

function buildScenarioOperations(scenario: ScenarioDefinition, state: SimulatorState): SimulatedOperation[] {
  const deadline = state.now + 300;
  const snapshot = createBasePortfolioSnapshot(state.policy.network, state.now);

  switch (scenario.id) {
    case 'SC-01': {
      const plan = computeRebalancePlan(snapshot, state.policy, DEFAULT_ADDRESSES.router, DEFAULT_ADDRESSES.usdc);
      return plan.steps.map(step => ({
        label: step.action === 'SWAP_EXACT_IN'
          ? 'Bước 1: Bán 10 Token A (100 USD) sang USDC theo kế hoạch của Agent'
          : 'Bước 2: Gửi 499 USDC khả dụng vào Vault ERC-4626',
        actionSource: 'AGENT_RULE',
        step
      }));
    }
    case 'SC-02':
      return [
        {
          label: 'Thử swap 15 Token A (150 USD) vượt hạn mức 24h (100 USD)',
          actionSource: 'HARNESS_MUTATED',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.tokenA,
            tokenOut: DEFAULT_ADDRESSES.usdc,
            amountIn: '15000000000000000000', // 15 Token A = $150
            minAmountOut: '148500000',
            estimatedValueUsd: '15000000000',
            deadline
          }
        }
      ];
    case 'SC-03':
      return [
        {
          label: 'Lệnh 1: Swap 60 USDC -> Token A (60 USD)',
          actionSource: 'DIRECT_SESSION_CALL',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '60000000', // 60 USDC
            minAmountOut: '5940000000000000000', // 5.94 A
            estimatedValueUsd: '6000000000',
            deadline
          }
        },
        {
          label: 'Lệnh 2: Swap 30 USDC -> Token A (30 USD, cộng dồn 90 USD)',
          actionSource: 'DIRECT_SESSION_CALL',
          step: {
            stepIndex: 1,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '30000000', // 30 USDC
            minAmountOut: '2970000000000000000', // 2.97 A
            estimatedValueUsd: '3000000000',
            deadline
          }
        },
        {
          label: 'Lệnh 3: Swap 20 USDC -> Token A (20 USD, cộng dồn 110 USD > 100 USD Cap)',
          actionSource: 'DIRECT_SESSION_CALL',
          step: {
            stepIndex: 2,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '20000000', // 20 USDC
            minAmountOut: '1980000000000000000',
            estimatedValueUsd: '2000000000',
            deadline
          }
        }
      ];
    case 'SC-04':
      return [
        {
          label: 'Thử swap 50 USDC sang token lạ ngoài whitelist (0x2000...0099)',
          actionSource: 'HARNESS_MUTATED',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.unauthorizedToken,
            amountIn: '50000000',
            minAmountOut: '49500000000000000000',
            estimatedValueUsd: '5000000000',
            deadline
          }
        }
      ];
    case 'SC-05':
      return [
        {
          label: 'Thử swap 50 USDC qua Router ngoài whitelist (0x3000...0099)',
          actionSource: 'HARNESS_MUTATED',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.unauthorizedRouter,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '50000000',
            minAmountOut: '4950000000000000000',
            estimatedValueUsd: '5000000000',
            deadline
          }
        }
      ];
    case 'SC-06':
      return [
        {
          label: 'Thử gửi 100 USDC vào Vault ngoài whitelist (0x4000...0099)',
          actionSource: 'HARNESS_MUTATED',
          step: {
            stepIndex: 0,
            action: 'VAULT_DEPOSIT',
            targetContract: DEFAULT_ADDRESSES.unauthorizedVault,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            assets: '100000000',
            minShares: '99000000',
            estimatedValueUsd: '10000000000',
            deadline
          }
        }
      ];
    case 'SC-07':
      return [
        {
          label: 'Thử swap 50 USDC với recipient là ví lạ ngoài Safe (0x9999...9999)',
          actionSource: 'DIRECT_SESSION_CALL',
          recipient: DEFAULT_ADDRESSES.foreignRecipient,
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '50000000',
            minAmountOut: '4950000000000000000',
            estimatedValueUsd: '5000000000',
            deadline
          }
        }
      ];
    case 'SC-08':
      state.policy.isRevoked = true;
      return [
        {
          label: 'Thử gửi lệnh swap 50 USDC sau khi Owner đã thu hồi Session Key',
          actionSource: 'DIRECT_SESSION_CALL',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '50000000',
            minAmountOut: '4950000000000000000',
            estimatedValueUsd: '5000000000',
            deadline
          }
        }
      ];
    case 'SC-09':
      state.tokens[lower(DEFAULT_ADDRESSES.usdc)].updatedAt = state.now - (state.policy.maxPriceAgeSec + 1);
      return [
        {
          label: 'Thử swap 50 USDC khi dữ liệu giá Oracle đã cũ quá 3600 giây',
          actionSource: 'HARNESS_MUTATED',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '50000000',
            minAmountOut: '4950000000000000000',
            estimatedValueUsd: '5000000000',
            deadline
          }
        }
      ];
    case 'SC-10':
      state.routerShouldFail = true;
      return [
        {
          label: 'Thử swap 50 USDC khi Router gặp lỗi revert giữa chừng',
          actionSource: 'HARNESS_MUTATED',
          step: {
            stepIndex: 0,
            action: 'SWAP_EXACT_IN',
            targetContract: DEFAULT_ADDRESSES.router,
            tokenIn: DEFAULT_ADDRESSES.usdc,
            tokenOut: DEFAULT_ADDRESSES.tokenA,
            amountIn: '50000000',
            minAmountOut: '4950000000000000000',
            estimatedValueUsd: '5000000000',
            deadline
          }
        }
      ];
    default:
      return [];
  }
}

function buildBalanceDiffs(
  beforeBalances: Record<string, bigint>,
  afterBalances: Record<string, bigint>,
  state: SimulatorState
): BalanceDiff[] {
  const tracked = [
    { symbol: 'USDC', address: DEFAULT_ADDRESSES.usdc, decimals: 6, priceUsd: state.tokens[lower(DEFAULT_ADDRESSES.usdc)].priceUsd },
    { symbol: 'A', address: DEFAULT_ADDRESSES.tokenA, decimals: 18, priceUsd: state.tokens[lower(DEFAULT_ADDRESSES.tokenA)].priceUsd },
    { symbol: 'vUSDC', address: DEFAULT_ADDRESSES.vault, decimals: 6, priceUsd: state.tokens[lower(DEFAULT_ADDRESSES.usdc)].priceUsd }
  ];

  return tracked.map(item => {
    const beforeRaw = beforeBalances[lower(item.address)] ?? 0n;
    const afterRaw = afterBalances[lower(item.address)] ?? 0n;
    const scale = 10n ** BigInt(item.decimals);
    const beforeUsd = (beforeRaw * item.priceUsd) / scale;
    const afterUsd = (afterRaw * item.priceUsd) / scale;
    return {
      symbol: item.symbol,
      tokenAddress: item.address,
      beforeRaw: beforeRaw.toString(),
      afterRaw: afterRaw.toString(),
      beforeUsd: beforeUsd.toString(),
      afterUsd: afterUsd.toString()
    };
  });
}

export async function runSimulatedScenario(
  scenario: ScenarioDefinition,
  env: NetworkEnv = 'local',
  buildAssertionsFn: (params: {
    scenario: ScenarioDefinition;
    steps: RunStepLog[];
    balanceDiffs: BalanceDiff[];
    spent24hBeforeUsd: string;
    spent24hAfterUsd: string;
    foreignBalanceAfterRaw: string;
  }) => AssertionResult[]
): Promise<RunResult> {
  const startedAt = Math.floor(Date.now() / 1000);
  const runId = `run_${scenario.id.toLowerCase()}_${startedAt}_${Math.random().toString(36).slice(2, 7)}`;

  if (!scenario.supportedEnvs.includes(env)) {
    const basePolicy = createBasePolicy(env, startedAt);
    return {
      runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      env,
      executionMode: 'SIMULATED_POLICY',
      status: 'COMPLETED',
      verdict: 'UNSUPPORTED',
      startedAt,
      finishedAt: startedAt,
      policySnapshot: basePolicy,
      steps: [],
      assertions: [],
      balanceDiffs: [],
      spent24hBeforeUsd: '0',
      spent24hAfterUsd: '0',
      explanation: `[Hệ thống] Kịch bản ${scenario.id} không hỗ trợ trên môi trường ${env} (cần thao tác kiểm soát timestamp hoặc lỗi giả lập trên local).`
    };
  }

  const state = createSimulatorState(env, 1800000000);
  const beforeBalances = { ...state.safeBalances };
  const spentBefore = computeRollingSpentUsd(state).toString();
  const operations = buildScenarioOperations(scenario, state);
  const policySnapshot: PolicyConfig = JSON.parse(JSON.stringify(state.policy));

  const stepLogs: RunStepLog[] = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const outcome = executeSimulatedOperation(state, op);
    stepLogs.push({
      stepIndex: i,
      label: op.label,
      actionSource: op.actionSource,
      status: outcome.status,
      // Crucial rule: SIMULATED_POLICY never invents a fake txHash
      txHash: undefined,
      errorCode: outcome.errorCode,
      detail: outcome.detail
    });
  }

  const afterBalances = { ...state.safeBalances };
  const spentAfter = computeRollingSpentUsd(state).toString();
  const balanceDiffs = buildBalanceDiffs(beforeBalances, afterBalances, state);
  const foreignAfter = (
    (state.foreignBalances[lower(DEFAULT_ADDRESSES.usdc)] ?? 0n) +
    (state.foreignBalances[lower(DEFAULT_ADDRESSES.tokenA)] ?? 0n)
  ).toString();

  const assertions = buildAssertionsFn({
    scenario,
    steps: stepLogs,
    balanceDiffs,
    spent24hBeforeUsd: spentBefore,
    spent24hAfterUsd: spentAfter,
    foreignBalanceAfterRaw: foreignAfter
  });

  const allPassed = assertions.length > 0 && assertions.every(a => a.passed);
  const snapshot = createBasePortfolioSnapshot(env, state.now);
  const plan = computeRebalancePlan(snapshot, createBasePolicy(env, state.now), DEFAULT_ADDRESSES.router, DEFAULT_ADDRESSES.usdc);
  const baseExplanation = await generateExplanation(snapshot, plan);
  const lastStep = stepLogs[stepLogs.length - 1];
  const explanation =
    scenario.id === 'SC-01'
      ? `${baseExplanation} [Chế độ: SIMULATED_POLICY] Đã thực thi thành công ${stepLogs.length} bước tái cân bằng và gửi Vault.`
      : `[Hệ thống - SIMULATED_POLICY] Kịch bản ${scenario.id} (${scenario.name}): Kết quả bước cuối = ${lastStep?.errorCode ?? 'N/A'} (Kỳ vọng: ${scenario.expectedErrorCode}). Đã kiểm tra ${assertions.length} assertions on-chain invariants: ${allPassed ? 'TẤT CẢ ĐẠT (PASS)' : 'CÓ SAI LỆCH (FAIL)'}.`;

  return {
    runId,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    env,
    executionMode: 'SIMULATED_POLICY',
    status: 'COMPLETED',
    verdict: allPassed ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: Math.floor(Date.now() / 1000),
    policySnapshot,
    steps: stepLogs,
    assertions,
    balanceDiffs,
    spent24hBeforeUsd: spentBefore,
    spent24hAfterUsd: spentAfter,
    explanation
  };
}
