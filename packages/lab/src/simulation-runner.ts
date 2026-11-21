import type { ExecutionMode, NetworkEnv, RunResult, ScenarioDefinition } from '@repo/shared';
import { getScenarioById, listScenarios } from './scenarios/simulation-catalog';
import { runSimulatedScenario, createBasePolicy } from './adapters/policy-simulator';
import { runOnchainScenario, type OnchainRunConfig } from './adapters/onchain-adapter';
import { evaluateScenarioAssertions } from './assertions/assertions';

export interface RunScenarioOptions {
  env?: NetworkEnv;
  executionMode?: ExecutionMode;
  fallbackToSimulation?: boolean;
  onchainConfig?: Omit<OnchainRunConfig, 'env'>;
}

export { listScenarios, getScenarioById };

export async function runScenario(
  scenarioId: string,
  options: RunScenarioOptions = {}
): Promise<RunResult> {
  const env: NetworkEnv = options.env ?? 'local';
  const mode: ExecutionMode = options.executionMode ?? 'SIMULATED_POLICY';
  const scenario: ScenarioDefinition | undefined = getScenarioById(scenarioId);

  if (!scenario) {
    const now = Math.floor(Date.now() / 1000);
    return {
      runId: `run_unknown_${now}`,
      scenarioId,
      scenarioName: `Unknown Scenario (${scenarioId})`,
      env,
      executionMode: mode,
      status: 'FAILED',
      verdict: 'ERROR',
      startedAt: now,
      finishedAt: now,
      policySnapshot: createBasePolicy(env, now),
      steps: [],
      assertions: [],
      balanceDiffs: [],
      spent24hBeforeUsd: '0',
      spent24hAfterUsd: '0',
      explanation: `[Hệ thống] Không tìm thấy kịch bản có mã ${scenarioId}.`,
      errorMessage: `Scenario ${scenarioId} not found in catalog.`
    };
  }

  if (mode === 'ONCHAIN_RPC') {
    const onchainResult = await runOnchainScenario(scenario, {
      env,
      ...options.onchainConfig
    });
    if (
      options.fallbackToSimulation &&
      (onchainResult.verdict === 'UNSUPPORTED' || onchainResult.verdict === 'ERROR')
    ) {
      return await runSimulatedScenario(scenario, env, evaluateScenarioAssertions);
    }
    return onchainResult;
  }

  return await runSimulatedScenario(scenario, env, evaluateScenarioAssertions);
}

export async function runSuite(
  scenarioIds?: string[],
  options: RunScenarioOptions = {}
): Promise<RunResult[]> {
  const ids = scenarioIds && scenarioIds.length > 0
    ? scenarioIds
    : listScenarios().map(s => s.id);

  const results: RunResult[] = [];
  for (const id of ids) {
    const result = await runScenario(id, options);
    results.push(result);
  }
  return results;
}
