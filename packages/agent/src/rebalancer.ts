import { randomUUID } from 'node:crypto';
import type { AssetPosition, PortfolioSnapshot, PolicyConfig, RebalancePlan, TradeStep } from '@repo/shared';

const BPS = 10000n;
const lower = (a: string) => a.toLowerCase();
const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const scale = (p: AssetPosition) => 10n ** BigInt(p.decimals);
const value = (p: AssetPosition, raw: bigint) => raw * BigInt(p.priceUsd) / scale(p);
const debit = (p: AssetPosition, raw: bigint) => ceil(raw * BigInt(p.priceUsd), scale(p));
const includes = (list: string[], address: string) => list.some(a => lower(a) === lower(address));

/** Deterministic sizing from a block snapshot; routes through one pivot token.
 * Vault movements use underlying units; only actual swap input consumes the projected rolling cap.
 */
export function computeRebalancePlan(snapshot: PortfolioSnapshot, policy: PolicyConfig,
  routerAddress: string, pivotAddress: string): RebalancePlan {
  const planId = `plan_${randomUUID()}`;
  const finish = (status: RebalancePlan['status'], reason: string, steps: TradeStep[] = [], isPartial = false): RebalancePlan =>
    ({ planId, snapshotTimestamp: snapshot.timestamp, status, isPartial, steps, ruleReasoning: reason });
  const total = BigInt(snapshot.totalValueUsd);
  if (total === 0n) return finish('NO_ACTION', 'Danh mục chưa có tài sản.');
  if (lower(snapshot.accountAddress) !== lower(policy.accountAddress) || snapshot.network !== policy.network
    || lower(policy.allowedRecipient) !== lower(snapshot.accountAddress)) return finish('BLOCKED', 'Account/network/recipient không khớp.');
  if (policy.capScope !== 'SWAP_INPUT_ONLY') return finish('BLOCKED', 'Chưa hỗ trợ phạm vi cap này.');
  if (policy.paused || policy.isRevoked || policy.sessionExpiresAt <= snapshot.timestamp) return finish('BLOCKED', 'Session đã bị khóa, thu hồi hoặc hết hạn.');
  if (!Number.isInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 0 || policy.maxSlippageBps > 1000) {
    return finish('BLOCKED', 'Slippage ngoài phạm vi policy.');
  }
  const positions = snapshot.positions;
  if (positions.reduce((sum, p) => sum + p.targetBps, 0) !== 10000) return finish('BLOCKED', 'Tổng tỷ trọng mục tiêu phải bằng 10000 bps.');
  const keys = new Set<string>();
  for (const p of positions) {
    const key = `${lower(p.tokenAddress)}:${lower(p.vaultAddress ?? '')}`;
    if (keys.has(key) || !Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 18
      || !Number.isInteger(p.targetBps) || p.targetBps < 0 || p.targetBps > 10000
      || BigInt(p.rawBalance) < 0n || BigInt(p.priceUsd) <= 0n || value(p, BigInt(p.rawBalance)) !== BigInt(p.valueUsd)) {
      return finish('BLOCKED', 'Snapshot không nhất quán hoặc trùng vị thế.');
    }
    keys.add(key);
  }
  if (positions.reduce((sum, p) => sum + BigInt(p.valueUsd), 0n) !== total) return finish('BLOCKED', 'Tổng giá trị snapshot không khớp.');
  const pivot = positions.find(p => !p.isVaultPosition && lower(p.tokenAddress) === lower(pivotAddress));
  if (!pivot) return finish('BLOCKED', 'Cần vị thế token trung gian trong snapshot.');
  const target = (p: AssetPosition) => total * BigInt(p.targetBps) / BPS;
  const drifted = positions.some(p => {
    const current = BigInt(p.valueUsd) * BPS / total;
    const difference = current - BigInt(p.targetBps);
    return difference > 500n || difference < -500n;
  });
  if (!drifted) return finish('NO_ACTION', 'Danh mục nằm trong ngưỡng lệch 5 điểm phần trăm.');

  let cap = BigInt(policy.remainingCapUsd);
  if (cap < 0n || cap > BigInt(policy.cap24hUsd)) return finish('BLOCKED', 'Hạn mức snapshot không hợp lệ.');
  let cash = BigInt(pivot.rawBalance);
  const reserve = ceil(target(pivot) * scale(pivot), BigInt(pivot.priceUsd));
  const steps: TradeStep[] = [];
  let partial = false;
  const deadline = snapshot.timestamp + 300;
  const base = (targetContract: string, estimatedValueUsd: bigint) =>
    ({ stepIndex: steps.length, targetContract, estimatedValueUsd: estimatedValueUsd.toString(), deadline });
  const requireToken = (p: AssetPosition) => {
    if (!includes(policy.whitelistedTokens, p.tokenAddress)) throw new Error(`Token chưa duyệt: ${p.tokenAddress}`);
  };
  const sharesFor = (p: AssetPosition, assets: bigint) => {
    if (!p.vaultAddress || !includes(policy.whitelistedVaults, p.vaultAddress)
      || !p.vaultConversion || BigInt(p.vaultConversion.assets) <= 0n || BigInt(p.vaultConversion.shares) <= 0n) {
      throw new Error('Thiếu vault whitelist hoặc quote shares tại snapshot block.');
    }
    return assets * BigInt(p.vaultConversion.shares) / BigInt(p.vaultConversion.assets);
  };
  const withdraw = (p: AssetPosition, assets: bigint) => {
    requireToken(p);
    const shares = sharesFor(p, assets);
    const maximum = ceil((shares + 1n) * BigInt(10000 + policy.maxSlippageBps), BPS);
    steps.push({ ...base(p.vaultAddress!, debit(p, assets)), action: 'VAULT_WITHDRAW',
      tokenOut: p.tokenAddress, assets: assets.toString(), maxShares: maximum.toString() });
  };
  const deposit = (p: AssetPosition, assets: bigint) => {
    requireToken(p);
    const minimum = ceil(sharesFor(p, assets) * BigInt(10000 - policy.maxSlippageBps), BPS);
    if (minimum === 0n) throw new Error('Lượng gửi quá nhỏ để nhận shares.');
    steps.push({ ...base(p.vaultAddress!, debit(p, assets)), action: 'VAULT_DEPOSIT',
      tokenIn: p.tokenAddress, assets: assets.toString(), minShares: minimum.toString() });
  };
  const swap = (input: AssetPosition, output: AssetPosition, raw: bigint): bigint => {
    requireToken(input); requireToken(output);
    if (!includes(policy.whitelistedRouters, routerAddress)) throw new Error('Router chưa được duyệt.');
    const cost = debit(input, raw);
    const quote = value(input, raw) * scale(output) / BigInt(output.priceUsd);
    const minimum = ceil(quote * BigInt(10000 - policy.maxSlippageBps), BPS);
    if (minimum === 0n || cost > cap) throw new Error('Swap dust hoặc vượt cap dự kiến.');
    steps.push({ ...base(routerAddress, cost), action: 'SWAP_EXACT_IN', tokenIn: input.tokenAddress,
      tokenOut: output.tokenAddress, amountIn: raw.toString(), minAmountOut: minimum.toString() });
    cap -= cost;
    return minimum;
  };

  try {
    // Sell/redeem excess into pivot. Only guaranteed minOut is available for later steps.
    for (const p of positions) {
      if (p === pivot || BigInt(p.valueUsd) <= target(p)) continue;
      const desired = (BigInt(p.valueUsd) - target(p)) * scale(p) / BigInt(p.priceUsd);
      let raw = min(desired, BigInt(p.rawBalance));
      const isPivotAsset = lower(p.tokenAddress) === lower(pivot.tokenAddress);
      if (!isPivotAsset) raw = min(raw, cap * scale(p) / BigInt(p.priceUsd));
      if (raw < desired) partial = true;
      if (raw === 0n) { partial = true; continue; }
      if (p.isVaultPosition) withdraw(p, raw);
      cash += isPivotAsset ? raw : swap(p, pivot, raw);
    }
    // Preserve pivot's own target cash, then fund deficits. No reuse of the same USDC twice.
    for (const p of positions) {
      if (p === pivot || BigInt(p.valueUsd) >= target(p)) continue;
      const desiredUsd = target(p) - BigInt(p.valueUsd);
      const available = cash > reserve ? cash - reserve : 0n;
      const isPivotAsset = lower(p.tokenAddress) === lower(pivot.tokenAddress);
      if (p.isVaultPosition && isPivotAsset) {
        const desired = desiredUsd * scale(p) / BigInt(p.priceUsd);
        const raw = min(desired, available);
        if (raw < desired) partial = true;
        if (raw > 0n) { deposit(p, raw); cash -= raw; }
        else partial = true;
      } else {
        const budget = min(desiredUsd, value(pivot, available), cap);
        const raw = budget * scale(pivot) / BigInt(pivot.priceUsd);
        if (budget < desiredUsd) partial = true;
        if (raw === 0n) { partial = true; continue; }
        const received = swap(pivot, p, raw);
        cash -= raw;
        if (p.isVaultPosition) deposit(p, received);
      }
    }
  } catch (error) {
    return finish('BLOCKED', error instanceof Error ? error.message : 'Không thể tạo kế hoạch an toàn.');
  }
  return steps.length === 0 ? finish('BLOCKED', 'Có lệch tỷ trọng nhưng không đủ cap, tiền khả dụng hoặc lượng tối thiểu.')
    : finish('READY', `Đã tạo ${steps.length} bước swap/gửi/rút theo giới hạn; cap chỉ tính swap. Xác nhận lại danh mục sau thực thi.`, steps, partial);
}
