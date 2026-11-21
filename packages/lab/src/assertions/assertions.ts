import {
  ErrorCode,
  type AssertionResult,
  type BalanceDiff,
  type RunStepLog,
  type ScenarioDefinition
} from '@repo/shared';

export interface AssertionEvalInput {
  scenario: ScenarioDefinition;
  steps: RunStepLog[];
  balanceDiffs: BalanceDiff[];
  spent24hBeforeUsd: string;
  spent24hAfterUsd: string;
  foreignBalanceAfterRaw?: string;
}

export function evaluateScenarioAssertions(input: AssertionEvalInput): AssertionResult[] {
  const { scenario, steps, balanceDiffs, spent24hBeforeUsd, spent24hAfterUsd, foreignBalanceAfterRaw = '0' } = input;
  const assertions: AssertionResult[] = [];

  const lastStep = steps[steps.length - 1];
  const actualErrorCode = lastStep?.errorCode ?? ErrorCode.ERR_RPC_OR_ENV;

  // 1. Expected ErrorCode check
  assertions.push({
    name: `Mã kết quả khớp kỳ vọng (${scenario.expectedErrorCode})`,
    passed: actualErrorCode === scenario.expectedErrorCode,
    expected: scenario.expectedErrorCode,
    actual: actualErrorCode
  });

  const usdcDiff = balanceDiffs.find(b => b.symbol === 'USDC');
  const tokenADiff = balanceDiffs.find(b => b.symbol === 'A');
  const vaultDiff = balanceDiffs.find(b => b.symbol === 'vUSDC');

  if (scenario.id === 'SC-01') {
    // Valid rebalance + vault deposit:
    // Sell 10 A ($100) -> +100 USDC, then deposit 499 USDC into vault
    const tokenADecreased = tokenADiff ? BigInt(tokenADiff.afterRaw) < BigInt(tokenADiff.beforeRaw) : false;
    const vaultIncreased = vaultDiff ? BigInt(vaultDiff.afterRaw) > BigInt(vaultDiff.beforeRaw) : false;

    assertions.push({
      name: 'Số dư Token A thừa tỷ trọng đã được bán bớt',
      passed: tokenADecreased,
      expected: '< ' + (tokenADiff?.beforeRaw ?? '0'),
      actual: tokenADiff?.afterRaw ?? '0'
    });
    assertions.push({
      name: 'Shares Vault sinh lời (vUSDC) của Safe tăng lên',
      passed: vaultIncreased,
      expected: '> 0',
      actual: vaultDiff?.afterRaw ?? '0'
    });
    assertions.push({
      name: 'Bộ đếm Cap 24h chỉ tính đúng phần Swap (100 USD = 10000000000), không tính phần gửi Vault',
      passed: spent24hAfterUsd === '10000000000',
      expected: '10000000000',
      actual: spent24hAfterUsd
    });
    return assertions;
  }

  if (scenario.id === 'SC-03') {
    // Split orders: 60 + 30 + 20 USD -> first 2 OK, 3rd blocked, spent24hAfterUsd == 90 USD
    const firstTwoOk = steps.length === 3 && steps[0].status === 'OK' && steps[1].status === 'OK' && steps[2].status === 'BLOCKED';
    assertions.push({
      name: 'Hai lệnh đầu (60 USD + 30 USD) thành công, lệnh thứ 3 (20 USD) bị chặn',
      passed: firstTwoOk,
      expected: 'OK, OK, BLOCKED',
      actual: steps.map(s => s.status).join(', ')
    });
    assertions.push({
      name: 'Tổng chi tiêu 24h cộng dồn chính xác 90 USD (9000000000)',
      passed: spent24hAfterUsd === '9000000000',
      expected: '9000000000',
      actual: spent24hAfterUsd
    });
    const expectedUsdcAfter = usdcDiff ? (BigInt(usdcDiff.beforeRaw) - 90000000n).toString() : '510000000';
    assertions.push({
      name: 'Số dư USDC chỉ trừ đúng 90 USDC của 2 lệnh hợp lệ',
      passed: usdcDiff?.afterRaw === expectedUsdcAfter,
      expected: expectedUsdcAfter,
      actual: usdcDiff?.afterRaw ?? '0'
    });
    return assertions;
  }

  // All other scenarios (SC-02, SC-04..SC-10) expect full rejection / rollback
  const balancesUnchanged = balanceDiffs.every(b => b.beforeRaw === b.afterRaw);
  assertions.push({
    name: 'Toàn bộ số dư tài sản và shares của Safe được bảo toàn nguyên vẹn',
    passed: balancesUnchanged,
    expected: 'UNCHANGED',
    actual: balancesUnchanged ? 'UNCHANGED' : 'MODIFIED'
  });

  assertions.push({
    name: 'Bộ đếm chi tiêu 24h không bị cộng sai khi lệnh bị từ chối hoặc revert',
    passed: spent24hBeforeUsd === spent24hAfterUsd,
    expected: spent24hBeforeUsd,
    actual: spent24hAfterUsd
  });

  if (scenario.id === 'SC-07') {
    assertions.push({
      name: 'Số dư của ví lạ (foreign recipient) bắt buộc bằng 0',
      passed: foreignBalanceAfterRaw === '0',
      expected: '0',
      actual: foreignBalanceAfterRaw
    });
  }

  return assertions;
}
