import { PortfolioSnapshot, PolicyConfig, RebalancePlan, TradeStep } from '@repo/shared';

const DRIFT_THRESHOLD_BPS = 500; // Lệch quá 5% mới tái cân bằng

export function computeRebalancePlan(
  snapshot: PortfolioSnapshot,
  policy: PolicyConfig,
  routerAddress: string,
  usdcAddress: string
): RebalancePlan {
  const planId = `plan_${Date.now()}`;
  const totalUsd = BigInt(snapshot.totalValueUsd);

  if (totalUsd === 0n) {
    return {
      planId,
      snapshotTimestamp: snapshot.timestamp,
      status: 'NO_ACTION',
      isPartial: false,
      steps: [],
      ruleReasoning: 'Tổng giá trị quỹ bằng 0, không thể tái cân bằng.'
    };
  }

  const overweight = snapshot.positions.filter(p => p.currentBps - p.targetBps > DRIFT_THRESHOLD_BPS);
  const underweight = snapshot.positions.filter(p => p.targetBps - p.currentBps > DRIFT_THRESHOLD_BPS);

  if (overweight.length === 0 && underweight.length === 0) {
    return {
      planId,
      snapshotTimestamp: snapshot.timestamp,
      status: 'NO_ACTION',
      isPartial: false,
      steps: [],
      ruleReasoning: 'Tất cả tài sản đều nằm trong biên độ cho phép (±5%). Không cần hành động.'
    };
  }

  let remainingCapUsd = BigInt(policy.remainingCapUsd);
  if (remainingCapUsd === 0n) {
    return {
      planId,
      snapshotTimestamp: snapshot.timestamp,
      status: 'BLOCKED',
      isPartial: false,
      steps: [],
      ruleReasoning: 'Hạn mức giao dịch 24h (Remaining Cap) đã hết (0 USD).'
    };
  }

  const steps: TradeStep[] = [];
  let isPartial = false;
  let stepIndex = 0;

  // Bước 1: Bán/Rút tài sản thừa tỷ trọng về USDC
  for (const pos of overweight) {
    if (remainingCapUsd <= 0n) break;
    if (pos.tokenAddress.toLowerCase() === usdcAddress.toLowerCase() && !pos.isVaultPosition) continue;

    const targetUsd = (totalUsd * BigInt(pos.targetBps)) / 10000n;
    const excessUsd = BigInt(pos.valueUsd) - targetUsd;
    let tradeUsd = excessUsd;

    if (tradeUsd > remainingCapUsd) {
      tradeUsd = remainingCapUsd;
      isPartial = true;
    }

    const priceUsd = BigInt(pos.priceUsd);
    const scale = 10n ** BigInt(pos.decimals);
    const amountIn = (tradeUsd * scale) / priceUsd;
    const minOutUsd = (tradeUsd * BigInt(10000 - policy.maxSlippageBps)) / 10000n;
    const minAmountOut = (minOutUsd * 10n ** 6n) / 100000000n;

    steps.push({
      stepIndex: stepIndex++,
      action: pos.isVaultPosition ? 'VAULT_WITHDRAW' : 'SWAP_EXACT_IN',
      targetContract: pos.isVaultPosition ? pos.vaultAddress! : routerAddress,
      tokenIn: pos.tokenAddress,
      tokenOut: usdcAddress,
      amountIn: amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
      estimatedValueUsd: tradeUsd.toString()
    });

    remainingCapUsd -= tradeUsd;
  }

  // Bước 2: Phân bổ USDC vào tài sản thiếu tỷ trọng
  for (const pos of underweight) {
    if (remainingCapUsd <= 0n) break;
    if (pos.tokenAddress.toLowerCase() === usdcAddress.toLowerCase() && !pos.isVaultPosition) continue;

    const targetUsd = (totalUsd * BigInt(pos.targetBps)) / 10000n;
    const deficitUsd = targetUsd - BigInt(pos.valueUsd);
    let tradeUsd = deficitUsd;

    if (tradeUsd > remainingCapUsd) {
      tradeUsd = remainingCapUsd;
      isPartial = true;
    }

    const amountInUsdc = (tradeUsd * 10n ** 6n) / 100000000n;
    const priceOutUsd = BigInt(pos.priceUsd);
    const scaleOut = 10n ** BigInt(pos.decimals);
    const expectedOut = (tradeUsd * scaleOut) / priceOutUsd;
    const minAmountOut = (expectedOut * BigInt(10000 - policy.maxSlippageBps)) / 10000n;

    steps.push({
      stepIndex: stepIndex++,
      action: pos.isVaultPosition ? 'VAULT_DEPOSIT' : 'SWAP_EXACT_IN',
      targetContract: pos.isVaultPosition ? pos.vaultAddress! : routerAddress,
      tokenIn: usdcAddress,
      tokenOut: pos.tokenAddress,
      amountIn: amountInUsdc.toString(),
      minAmountOut: minAmountOut.toString(),
      estimatedValueUsd: tradeUsd.toString()
    });

    remainingCapUsd -= tradeUsd;
  }

  const ruleReasoning = isPartial
    ? `Phát hiện lệch tỷ trọng > 5%. Đã tạo ${steps.length} lệnh tái cân bằng một phần để tuân thủ hạn mức 24h còn lại.`
    : `Phát hiện lệch tỷ trọng > 5%. Đã tạo ${steps.length} lệnh đưa danh mục về đúng tỷ trọng mục tiêu.`;

  return {
    planId,
    snapshotTimestamp: snapshot.timestamp,
    status: steps.length > 0 ? 'READY' : 'NO_ACTION',
    isPartial,
    steps,
    ruleReasoning
  };
}
