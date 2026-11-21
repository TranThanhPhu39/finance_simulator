import type { Address } from 'viem';
import {
  ErrorCode,
  type BalanceDiff,
  type NetworkEnv,
  type RunResult,
  type RunStepLog,
  type ScenarioDefinition,
  type TradeStep
} from '@repo/shared';
import { PolicyClient, decodePolicyErrorDetails, type PolicyUniverse } from '@repo/chain-client';
import { PlanExecutor, computeRebalancePlan, generateExplanation, readPortfolioSnapshot, type PositionConfig } from '@repo/agent';
import { createBasePolicy, DEFAULT_ADDRESSES } from './policy-simulator';
import { evaluateScenarioAssertions } from '../assertions/assertions';

export interface OnchainRunConfig {
  env: NetworkEnv;
  rpcUrl?: string;
  sessionPrivateKey?: `0x${string}`;
  moduleAddress?: Address;
  safeAddress?: Address;
  oracleAddress?: Address;
  routerAddress?: Address;
  usdcAddress?: Address;
  tokenAAddress?: Address;
  vaultAddress?: Address;
  unauthorizedTokenAddress?: Address;
  unauthorizedRouterAddress?: Address;
  unauthorizedVaultAddress?: Address;
  foreignRecipientAddress?: Address;
}

export async function runOnchainScenario(
  scenario: ScenarioDefinition,
  config: OnchainRunConfig
): Promise<RunResult> {
  const startedAt = Math.floor(Date.now() / 1000);
  const runId = `run_${scenario.id.toLowerCase()}_onchain_${startedAt}_${Math.random().toString(36).slice(2, 7)}`;

  if (!scenario.supportedEnvs.includes(config.env)) {
    return {
      runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      env: config.env,
      executionMode: 'ONCHAIN_RPC',
      status: 'COMPLETED',
      verdict: 'UNSUPPORTED',
      startedAt,
      finishedAt: startedAt,
      policySnapshot: createBasePolicy(config.env, startedAt),
      steps: [],
      assertions: [],
      balanceDiffs: [],
      spent24hBeforeUsd: '0',
      spent24hAfterUsd: '0',
      explanation: `[Hệ thống - ONCHAIN_RPC] Kịch bản ${scenario.id} không hỗ trợ trên môi trường ${config.env}.`
    };
  }

  if (
    !config.rpcUrl ||
    !config.sessionPrivateKey ||
    !config.moduleAddress ||
    !config.safeAddress ||
    !config.oracleAddress ||
    !config.routerAddress ||
    !config.usdcAddress ||
    !config.tokenAAddress ||
    !config.vaultAddress
  ) {
    return {
      runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      env: config.env,
      executionMode: 'ONCHAIN_RPC',
      status: 'COMPLETED',
      verdict: 'UNSUPPORTED',
      startedAt,
      finishedAt: startedAt,
      policySnapshot: createBasePolicy(config.env, startedAt),
      steps: [],
      assertions: [],
      balanceDiffs: [],
      spent24hBeforeUsd: '0',
      spent24hAfterUsd: '0',
      explanation: `[Hệ thống - ONCHAIN_RPC] Chưa cấu hình đủ RPC URL hoặc địa chỉ triển khai contract cho mạng ${config.env}.`,
      errorMessage: 'Missing ONCHAIN_RPC configuration (rpcUrl, sessionPrivateKey, or contract addresses).'
    };
  }

  try {
    const client = new PolicyClient(config.env, config.rpcUrl, config.sessionPrivateKey);
    await client.ensureNetwork();

    const sessionAccount = client.walletClient?.account;
    if (!sessionAccount) {
      throw new Error('Không thể khởi tạo session signer từ sessionPrivateKey.');
    }

    const universe: PolicyUniverse = {
      tokens: [config.usdcAddress, config.tokenAAddress],
      routers: [config.routerAddress],
      vaults: [config.vaultAddress]
    };

    const positionsConfig: PositionConfig[] = [
      { tokenAddress: config.usdcAddress, symbol: 'USDC', targetBps: 2000 },
      { tokenAddress: config.tokenAAddress, symbol: 'A', targetBps: 3000 },
      { tokenAddress: config.usdcAddress, symbol: 'vUSDC', targetBps: 5000, vaultAddress: config.vaultAddress }
    ];

    const policyBefore = await client.readPolicyConfig(config.moduleAddress, sessionAccount.address, universe);
    const snapshotBefore = await readPortfolioSnapshot(
      client,
      config.safeAddress,
      config.oracleAddress,
      positionsConfig,
      policyBefore.maxPriceAgeSec
    );
    const spentBefore = await client.readModule<bigint>(config.moduleAddress, 'readSpent24hUsd');
    const foreignRecipient = config.foreignRecipientAddress ?? (DEFAULT_ADDRESSES.foreignRecipient as Address);

    const stepLogs: RunStepLog[] = [];
    const deadline = snapshotBefore.timestamp + 300;

    if (scenario.id === 'SC-01') {
      const plan = computeRebalancePlan(snapshotBefore, policyBefore, config.routerAddress, config.usdcAddress);
      const executor = new PlanExecutor(client, config.moduleAddress, config.safeAddress);
      const execution = await executor.execute(plan);
      for (const s of execution.steps) {
        stepLogs.push({
          stepIndex: s.stepIndex,
          label: `Bước ${s.stepIndex + 1} (${plan.steps[s.stepIndex]?.action ?? 'STEP'})`,
          actionSource: 'AGENT_RULE',
          status: s.status === 'SUCCESS' ? 'OK' : s.status === 'PREFLIGHT_REJECTED' ? 'BLOCKED' : 'FAILED',
          txHash: s.hash,
          errorCode: s.error?.code ?? ErrorCode.OK,
          detail: s.hash ? `Tx mined tại block ${s.blockNumber ?? 'latest'}` : s.error?.name ?? 'Preflight/Execution result'
        });
      }
    } else {
      const buildStepForScenario = (): { step: TradeStep; recipient: Address; label: string } => {
        switch (scenario.id) {
          case 'SC-02':
            return {
              label: 'Thử swap 15 Token A (150 USD > Cap 100 USD)',
              recipient: config.safeAddress!,
              step: {
                stepIndex: 0,
                action: 'SWAP_EXACT_IN',
                targetContract: config.routerAddress!,
                tokenIn: config.tokenAAddress!,
                tokenOut: config.usdcAddress!,
                amountIn: '15000000000000000000',
                minAmountOut: '148500000',
                estimatedValueUsd: '15000000000',
                deadline
              }
            };
          case 'SC-04':
            return {
              label: 'Thử swap sang token ngoài whitelist',
              recipient: config.safeAddress!,
              step: {
                stepIndex: 0,
                action: 'SWAP_EXACT_IN',
                targetContract: config.routerAddress!,
                tokenIn: config.usdcAddress!,
                tokenOut: config.unauthorizedTokenAddress ?? DEFAULT_ADDRESSES.unauthorizedToken,
                amountIn: '50000000',
                minAmountOut: '49500000000000000000',
                estimatedValueUsd: '5000000000',
                deadline
              }
            };
          case 'SC-05':
            return {
              label: 'Thử swap qua router ngoài whitelist',
              recipient: config.safeAddress!,
              step: {
                stepIndex: 0,
                action: 'SWAP_EXACT_IN',
                targetContract: config.unauthorizedRouterAddress ?? DEFAULT_ADDRESSES.unauthorizedRouter,
                tokenIn: config.usdcAddress!,
                tokenOut: config.tokenAAddress!,
                amountIn: '50000000',
                minAmountOut: '4950000000000000000',
                estimatedValueUsd: '5000000000',
                deadline
              }
            };
          case 'SC-06':
            return {
              label: 'Thử gửi USDC vào vault ngoài whitelist',
              recipient: config.safeAddress!,
              step: {
                stepIndex: 0,
                action: 'VAULT_DEPOSIT',
                targetContract: config.unauthorizedVaultAddress ?? DEFAULT_ADDRESSES.unauthorizedVault,
                tokenIn: config.usdcAddress!,
                assets: '100000000',
                minShares: '99000000',
                estimatedValueUsd: '10000000000',
                deadline
              }
            };
          case 'SC-07':
            return {
              label: 'Thử swap với recipient là ví lạ ngoài Safe',
              recipient: foreignRecipient,
              step: {
                stepIndex: 0,
                action: 'SWAP_EXACT_IN',
                targetContract: config.routerAddress!,
                tokenIn: config.usdcAddress!,
                tokenOut: config.tokenAAddress!,
                amountIn: '50000000',
                minAmountOut: '4950000000000000000',
                estimatedValueUsd: '5000000000',
                deadline
              }
            };
          default:
            return {
              label: `Thực thi bước kiểm thử ${scenario.id}`,
              recipient: config.safeAddress!,
              step: {
                stepIndex: 0,
                action: 'SWAP_EXACT_IN',
                targetContract: config.routerAddress!,
                tokenIn: config.usdcAddress!,
                tokenOut: config.tokenAAddress!,
                amountIn: '50000000',
                minAmountOut: '4950000000000000000',
                estimatedValueUsd: '5000000000',
                deadline
              }
            };
        }
      };

      const { step, recipient, label } = buildStepForScenario();
      const tx = client.buildStepTransaction(config.moduleAddress, step, recipient);
      try {
        await client.simulateTransaction(tx);
        const hash = await client.submitTransaction(tx);
        await client.publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
        stepLogs.push({
          stepIndex: 0,
          label,
          actionSource: scenario.actionSource,
          status: 'OK',
          txHash: hash,
          errorCode: ErrorCode.OK,
          detail: `Giao dịch on-chain hoàn tất: ${hash}`
        });
      } catch (err) {
        const decoded = decodePolicyErrorDetails(err);
        stepLogs.push({
          stepIndex: 0,
          label,
          actionSource: scenario.actionSource,
          status: decoded.code === ErrorCode.ERR_RPC_OR_ENV ? 'FAILED' : 'BLOCKED',
          txHash: undefined,
          errorCode: decoded.code,
          detail: `On-chain preflight/call từ chối với mã ${decoded.code} (${decoded.name ?? 'Revert'})`
        });
      }
    }

    const snapshotAfter = await readPortfolioSnapshot(
      client,
      config.safeAddress,
      config.oracleAddress,
      positionsConfig,
      policyBefore.maxPriceAgeSec
    );
    const spentAfter = await client.readModule<bigint>(config.moduleAddress, 'readSpent24hUsd');
    const foreignBal = await client.readTokenBalance(config.tokenAAddress, foreignRecipient);

    const balanceDiffs: BalanceDiff[] = snapshotBefore.positions.map((posBefore, idx) => {
      const posAfter = snapshotAfter.positions[idx] ?? posBefore;
      return {
        symbol: posBefore.symbol,
        tokenAddress: posBefore.vaultAddress ?? posBefore.tokenAddress,
        beforeRaw: posBefore.isVaultPosition ? (posBefore.vaultShares ?? posBefore.rawBalance) : posBefore.rawBalance,
        afterRaw: posAfter.isVaultPosition ? (posAfter.vaultShares ?? posAfter.rawBalance) : posAfter.rawBalance,
        beforeUsd: posBefore.valueUsd,
        afterUsd: posAfter.valueUsd
      };
    });

    const assertions = evaluateScenarioAssertions({
      scenario,
      steps: stepLogs,
      balanceDiffs,
      spent24hBeforeUsd: spentBefore.toString(),
      spent24hAfterUsd: spentAfter.toString(),
      foreignBalanceAfterRaw: foreignBal.toString()
    });

    const allPassed = assertions.length > 0 && assertions.every(a => a.passed);
    const plan = computeRebalancePlan(snapshotBefore, policyBefore, config.routerAddress, config.usdcAddress);
    const explanation = await generateExplanation(snapshotAfter, plan);

    return {
      runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      env: config.env,
      executionMode: 'ONCHAIN_RPC',
      status: 'COMPLETED',
      verdict: allPassed ? 'PASS' : 'FAIL',
      startedAt,
      finishedAt: Math.floor(Date.now() / 1000),
      policySnapshot: policyBefore,
      steps: stepLogs,
      assertions,
      balanceDiffs,
      spent24hBeforeUsd: spentBefore.toString(),
      spent24hAfterUsd: spentAfter.toString(),
      explanation
    };
  } catch (error) {
    return {
      runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      env: config.env,
      executionMode: 'ONCHAIN_RPC',
      status: 'FAILED',
      verdict: 'ERROR',
      startedAt,
      finishedAt: Math.floor(Date.now() / 1000),
      policySnapshot: createBasePolicy(config.env, startedAt),
      steps: [],
      assertions: [],
      balanceDiffs: [],
      spent24hBeforeUsd: '0',
      spent24hAfterUsd: '0',
      explanation: `[Hệ thống - ONCHAIN_RPC] Lỗi kết nối RPC hoặc đọc trạng thái on-chain: ${error instanceof Error ? error.message : String(error)}`,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}
