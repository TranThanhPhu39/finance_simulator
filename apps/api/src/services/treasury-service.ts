import {
  ErrorCode,
  type ExecutionMode,
  type NetworkEnv,
  type PaperTradeAction,
  type PolicyConfig,
  type PortfolioSnapshot,
  type PythPriceFeed,
  type RebalancePlan,
  type RegisteredAgent,
  type RunResult,
  type ScenarioDefinition
} from '@repo/shared';
import { computeRebalancePlan, generateExplanation } from '@repo/agent';
import { PolicyClient, type ModuleTransaction } from '@repo/chain-client';
import {
  DEFAULT_ADDRESSES,
  PaperTradingEngine,
  computeRollingSpentUsd,
  createSimulatorState,
  evaluateScenarioAssertions,
  executeSimulatedOperation,
  exportRunAsCsv,
  exportRunAsJson,
  fetchPythPriceFeeds,
  listScenarios,
  runScenario,
  runSuite,
  type SimulatorState
} from '@repo/lab';
import { ApiDatabase } from '../db/migrations/database';

const lower = (s: string) => s.toLowerCase();

export interface TreasuryOverviewResponse {
  env: NetworkEnv;
  executionMode: ExecutionMode;
  policy: PolicyConfig;
  portfolio: PortfolioSnapshot;
  spent24hUsd: string;
  accruedYieldUsd: string;
  routerAddress: string;
  pivotAddress: string;
  moduleAddress: string;
}

export class TreasuryApiService {
  public db: ApiDatabase;
  public env: NetworkEnv;
  public executionMode: ExecutionMode;
  public moduleAddress = '0x5000000000000000000000000000000000000001' as const;
  private simState: SimulatorState;
  private paperEngine: PaperTradingEngine;
  private executionLock = Promise.resolve();

  constructor(dbPath = ':memory:', env: NetworkEnv = 'local', executionMode: ExecutionMode = 'SIMULATED_POLICY') {
    this.db = new ApiDatabase(dbPath);
    this.env = env;
    this.executionMode = executionMode;
    this.simState = createSimulatorState(env, Math.floor(Date.now() / 1000));
    // Seed initial vault balance with realistic demo yield
    this.simState.safeBalances[lower(DEFAULT_ADDRESSES.usdc)] = 450000000n; // $450 USDC cash
    this.simState.safeBalances[lower(DEFAULT_ADDRESSES.tokenA)] = 35000000000000000000n; // 35 sAVAX/Token A ($350)
    this.simState.safeBalances[lower(DEFAULT_ADDRESSES.vault)] = 200000000n; // 200 vUSDC in MockVault4626 ($200)
    this.paperEngine = new PaperTradingEngine(Math.floor(Date.now() / 1000));
    this.seedInitialData();
  }

  private seedInitialData(): void {
    const existingAgents = this.db.listAgents();
    if (existingAgents.length === 0) {
      const a1 = this.paperEngine.registerAgent({
        agentId: 'agent_avax_yield_01',
        erc8004Id: 'erc8004:avax:43113:0x1000000000000000000000000000000000000002',
        name: 'Avalanche Treasury Carry Optimizer',
        strategyType: 'ERC4626_CARRY_REBALANCE',
        bondUsdc: '500000000'
      });
      this.db.saveAgent(a1);
      const s1 = this.paperEngine.runAcceleratedPaperSession('agent_avax_yield_01', [
        { symbol: 'AVAX/USD', side: 'SELL', notionalUsd: '4500000000', priceUsd: '2500000000', returnBps: 75 },
        { symbol: 'USDC/USD', side: 'BUY', notionalUsd: '5000000000', priceUsd: '100000000', returnBps: 60 },
        { symbol: 'AAPL/USD', side: 'BUY', notionalUsd: '4000000000', priceUsd: '22850000000', returnBps: 85 },
        { symbol: 'AVAX/USD', side: 'BUY', notionalUsd: '3500000000', priceUsd: '2480000000', returnBps: 70 }
      ]);
      this.db.saveAgent(s1.agent);
      for (const act of s1.actions) this.db.savePaperAction(act);

      const a2 = this.paperEngine.registerAgent({
        agentId: 'agent_delta_sentinel_02',
        erc8004Id: 'erc8004:avax:43113:0x1000000000000000000000000000000000000003',
        name: 'sAVAX-USDC Drift Sentinel',
        strategyType: 'MEAN_REVERSION_500BPS',
        bondUsdc: '250000000'
      });
      this.db.saveAgent(a2);
      const s2 = this.paperEngine.runAcceleratedPaperSession('agent_delta_sentinel_02', [
        { symbol: 'AVAX/USD', side: 'BUY', notionalUsd: '3000000000', priceUsd: '2500000000', returnBps: 45 },
        { symbol: 'AAPL/USD', side: 'SELL', notionalUsd: '2500000000', priceUsd: '22850000000', returnBps: 35 }
      ]);
      this.db.saveAgent(s2.agent);
      for (const act of s2.actions) this.db.savePaperAction(act);
    }
  }

  public getEnvironment() {
    return {
      env: this.env,
      executionMode: this.executionMode,
      chainId: this.env === 'local' ? 31337 : 43113,
      moduleAddress: this.moduleAddress,
      safeAddress: this.simState.policy.accountAddress,
      routerAddress: DEFAULT_ADDRESSES.router,
      vaultAddress: DEFAULT_ADDRESSES.vault,
      usdcAddress: DEFAULT_ADDRESSES.usdc,
      tokenAAddress: DEFAULT_ADDRESSES.tokenA,
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  public buildCurrentPortfolioSnapshot(): PortfolioSnapshot {
    const usdcBal = this.simState.safeBalances[lower(DEFAULT_ADDRESSES.usdc)] ?? 0n;
    const tokenABal = this.simState.safeBalances[lower(DEFAULT_ADDRESSES.tokenA)] ?? 0n;
    const vaultBal = this.simState.safeBalances[lower(DEFAULT_ADDRESSES.vault)] ?? 0n;

    const usdcPrice = 100000000n; // $1.00
    const tokenAPrice = 1000000000n; // $10.00

    const usdcVal = (usdcBal * usdcPrice) / 1000000n;
    const tokenAVal = (tokenABal * tokenAPrice) / 1000000000000000000n;
    const vaultVal = (vaultBal * usdcPrice) / 1000000n;
    const totalVal = usdcVal + tokenAVal + vaultVal;

    const bps = (val: bigint) => (totalVal > 0n ? Number((val * 10000n) / totalVal) : 0);
    // MockVault4626 5% APY accrued yield display ($4.85)
    const accruedYieldUsd = '485000000';

    return {
      accountAddress: this.simState.policy.accountAddress,
      network: this.env,
      blockNumber: 128,
      timestamp: this.simState.now,
      totalValueUsd: totalVal.toString(),
      positions: [
        {
          tokenAddress: DEFAULT_ADDRESSES.usdc,
          symbol: 'USDC',
          decimals: 6,
          rawBalance: usdcBal.toString(),
          priceUsd: usdcPrice.toString(),
          valueUsd: usdcVal.toString(),
          currentBps: bps(usdcVal),
          targetBps: 2000, // 20% cash reserve
          isVaultPosition: false
        },
        {
          tokenAddress: DEFAULT_ADDRESSES.tokenA,
          symbol: 'sAVAX',
          decimals: 18,
          rawBalance: tokenABal.toString(),
          priceUsd: tokenAPrice.toString(),
          valueUsd: tokenAVal.toString(),
          currentBps: bps(tokenAVal),
          targetBps: 2500, // 25% target (currently 35% -> overweight by 10% > 5% drift threshold)
          isVaultPosition: false
        },
        {
          tokenAddress: DEFAULT_ADDRESSES.usdc,
          vaultAddress: DEFAULT_ADDRESSES.vault,
          symbol: 'vUSDC (MockVault4626)',
          decimals: 6,
          rawBalance: vaultBal.toString(),
          priceUsd: usdcPrice.toString(),
          valueUsd: vaultVal.toString(),
          currentBps: bps(vaultVal),
          targetBps: 5500, // 55% target (currently 20% -> underweight by 35%)
          isVaultPosition: true,
          vaultShares: vaultBal.toString(),
          accruedYieldUsd,
          vaultConversion: {
            assets: '1000000',
            shares: '1000000'
          }
        }
      ]
    };
  }

  public getTreasuryOverview(): TreasuryOverviewResponse {
    const spent = computeRollingSpentUsd(this.simState);
    const cap = BigInt(this.simState.policy.cap24hUsd);
    this.simState.policy.remainingCapUsd = (cap > spent ? cap - spent : 0n).toString();

    return {
      env: this.env,
      executionMode: this.executionMode,
      policy: structuredClone(this.simState.policy),
      portfolio: this.buildCurrentPortfolioSnapshot(),
      spent24hUsd: spent.toString(),
      accruedYieldUsd: '485000000',
      routerAddress: DEFAULT_ADDRESSES.router,
      pivotAddress: DEFAULT_ADDRESSES.usdc,
      moduleAddress: this.moduleAddress
    };
  }

  public updatePolicy(input: { cap24hUsd?: string; maxSlippageBps?: number; maxPriceAgeSec?: number; paused?: boolean }): TreasuryOverviewResponse {
    if (input.cap24hUsd !== undefined && /^\d+$/.test(input.cap24hUsd)) {
      this.simState.policy.cap24hUsd = input.cap24hUsd;
    }
    if (input.maxSlippageBps !== undefined && Number.isInteger(input.maxSlippageBps) && input.maxSlippageBps >= 0 && input.maxSlippageBps <= 1000) {
      this.simState.policy.maxSlippageBps = input.maxSlippageBps;
    }
    if (input.maxPriceAgeSec !== undefined && Number.isInteger(input.maxPriceAgeSec) && input.maxPriceAgeSec > 0) {
      this.simState.policy.maxPriceAgeSec = input.maxPriceAgeSec;
    }
    if (input.paused !== undefined) {
      this.simState.policy.paused = Boolean(input.paused);
    }
    return this.getTreasuryOverview();
  }

  public setKillSwitch(revoked: boolean): { overview: TreasuryOverviewResponse; transaction: ModuleTransaction } {
    this.simState.policy.isRevoked = revoked;
    if (!revoked) {
      this.simState.policy.sessionExpiresAt = Math.floor(Date.now() / 1000) + 86400;
    }
    const helper = new PolicyClient(this.env, 'http://127.0.0.1:8545');
    const transaction = revoked
      ? helper.buildRevokeSessionTransaction(this.moduleAddress, this.simState.policy.sessionKey as `0x${string}`)
      : helper.buildGrantSessionTransaction(
          this.moduleAddress,
          this.simState.policy.sessionKey as `0x${string}`,
          BigInt(this.simState.policy.sessionExpiresAt)
        );
    return {
      overview: this.getTreasuryOverview(),
      transaction
    };
  }

  public resetTreasury(): TreasuryOverviewResponse {
    const now = Math.floor(Date.now() / 1000);
    this.simState = createSimulatorState(this.env, now);
    this.simState.safeBalances[lower(DEFAULT_ADDRESSES.usdc)] = 450000000n;
    this.simState.safeBalances[lower(DEFAULT_ADDRESSES.tokenA)] = 35000000000000000000n;
    this.simState.safeBalances[lower(DEFAULT_ADDRESSES.vault)] = 200000000n;
    return this.getTreasuryOverview();
  }

  public async previewRebalance(): Promise<{ plan: RebalancePlan; overview: TreasuryOverviewResponse }> {
    const overview = this.getTreasuryOverview();
    const plan = computeRebalancePlan(
      overview.portfolio,
      overview.policy,
      DEFAULT_ADDRESSES.router,
      DEFAULT_ADDRESSES.usdc
    );
    plan.llmExplanation = await generateExplanation(overview.portfolio, plan, process.env.OPENAI_API_KEY);
    return { plan, overview };
  }

  public async executeRebalance(): Promise<{ run: RunResult; overview: TreasuryOverviewResponse; plan: RebalancePlan }> {
    const { plan, overview } = await this.previewRebalance();
    const startedAt = Math.floor(Date.now() / 1000);
    const runId = `run_rebalance_${startedAt}_${Math.random().toString(36).slice(2, 7)}`;

    const beforeBalances = { ...this.simState.safeBalances };
    const spentBefore = overview.spent24hUsd;
    const stepLogs: RunResult['steps'] = [];

    if (plan.status === 'READY') {
      for (const step of plan.steps) {
        const res = executeSimulatedOperation(this.simState, {
          label:
            step.action === 'SWAP_EXACT_IN'
              ? `Agent Swap ${step.amountIn} raw units qua Router`
              : `Agent ${step.action} ${step.assets} raw units tại MockVault4626`,
          actionSource: 'AGENT_RULE',
          step
        });
        stepLogs.push({
          stepIndex: step.stepIndex,
          label:
            step.action === 'SWAP_EXACT_IN'
              ? `SWAP_EXACT_IN (${(Number(step.estimatedValueUsd) / 1e8).toFixed(2)} USD)`
              : `${step.action} (${(Number(step.estimatedValueUsd) / 1e8).toFixed(2)} USD)`,
          actionSource: 'AGENT_RULE',
          status: res.status,
          txHash: undefined,
          errorCode: res.errorCode,
          detail: res.detail
        });
        if (res.status !== 'OK') break;
      }
    } else {
      stepLogs.push({
        stepIndex: 0,
        label: `Rebalance ${plan.status}`,
        actionSource: 'AGENT_RULE',
        status: plan.status === 'BLOCKED' ? 'BLOCKED' : 'OK',
        txHash: undefined,
        errorCode: plan.status === 'BLOCKED' ? ErrorCode.ERR_CAP_EXCEEDED : ErrorCode.OK,
        detail: plan.ruleReasoning
      });
    }

    const afterOverview = this.getTreasuryOverview();
    const balanceDiffs = overview.portfolio.positions.map((posBefore, idx) => {
      const posAfter = afterOverview.portfolio.positions[idx] ?? posBefore;
      return {
        symbol: posBefore.symbol,
        tokenAddress: posBefore.vaultAddress ?? posBefore.tokenAddress,
        beforeRaw: beforeBalances[lower(posBefore.vaultAddress ?? posBefore.tokenAddress)]?.toString() ?? posBefore.rawBalance,
        afterRaw: this.simState.safeBalances[lower(posAfter.vaultAddress ?? posAfter.tokenAddress)]?.toString() ?? posAfter.rawBalance,
        beforeUsd: posBefore.valueUsd,
        afterUsd: posAfter.valueUsd
      };
    });

    const allOk = stepLogs.every(s => s.status === 'OK');
    const run: RunResult = {
      runId,
      scenarioId: 'AGENT-REBALANCE',
      scenarioName: 'Chu kỳ Tái cân bằng Quỹ tự động (AI Rebalancer)',
      env: this.env,
      executionMode: this.executionMode,
      status: 'COMPLETED',
      verdict: allOk ? 'PASS' : 'FAIL',
      startedAt,
      finishedAt: Math.floor(Date.now() / 1000),
      policySnapshot: overview.policy,
      steps: stepLogs,
      assertions: [
        {
          name: 'Kế hoạch Rebalance tuân thủ PolicyModule',
          passed: allOk,
          expected: 'OK',
          actual: stepLogs[stepLogs.length - 1]?.errorCode ?? 'OK'
        },
        {
          name: 'Tổng chi tiêu Swap 24h nằm trong giới hạn Cap',
          passed: BigInt(afterOverview.spent24hUsd) <= BigInt(afterOverview.policy.cap24hUsd),
          expected: `<= ${afterOverview.policy.cap24hUsd}`,
          actual: afterOverview.spent24hUsd
        }
      ],
      balanceDiffs,
      spent24hBeforeUsd: spentBefore,
      spent24hAfterUsd: afterOverview.spent24hUsd,
      explanation: plan.llmExplanation ?? plan.ruleReasoning
    };

    this.db.saveRun(run);
    return { run, overview: afterOverview, plan };
  }

  public getScenarios(): ScenarioDefinition[] {
    return listScenarios();
  }

  public async triggerScenarioRun(input: {
    scenarioId?: string;
    scenarioIds?: string[];
    env?: NetworkEnv;
    executionMode?: ExecutionMode;
  }): Promise<RunResult[]> {
    const runTask = async (): Promise<RunResult[]> => {
      const env = input.env ?? this.env;
      const executionMode = input.executionMode ?? this.executionMode;
      if (input.scenarioIds && input.scenarioIds.length > 0) {
        const results = await runSuite(input.scenarioIds, {
          env,
          executionMode,
          fallbackToSimulation: executionMode === 'SIMULATED_POLICY'
        });
        for (const r of results) this.db.saveRun(r);
        return results;
      }
      if (input.scenarioId) {
        const r = await runScenario(input.scenarioId, {
          env,
          executionMode,
          fallbackToSimulation: executionMode === 'SIMULATED_POLICY'
        });
        this.db.saveRun(r);
        return [r];
      }
      const results = await runSuite(undefined, {
        env,
        executionMode,
        fallbackToSimulation: executionMode === 'SIMULATED_POLICY'
      });
      for (const r of results) this.db.saveRun(r);
      return results;
    };

    const next = this.executionLock.then(runTask, runTask);
    this.executionLock = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  public listRuns(): RunResult[] {
    return this.db.listRuns();
  }

  public getRun(runId: string): RunResult | undefined {
    return this.db.getRun(runId);
  }

  public exportRun(runId: string, format: 'json' | 'csv'): { contentType: string; filename: string; body: string } | undefined {
    const run = this.db.getRun(runId);
    if (!run) return undefined;
    if (format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `${run.runId}.csv`,
        body: exportRunAsCsv(run)
      };
    }
    return {
      contentType: 'application/json; charset=utf-8',
      filename: `${run.runId}.json`,
      body: exportRunAsJson(run)
    };
  }

  // Topic 16 Launchpad endpoints
  public async getLaunchpadPrices(): Promise<PythPriceFeed[]> {
    return await fetchPythPriceFeeds(['AAPL/USD', 'AVAX/USD', 'USDC/USD'], 3500);
  }

  public listLaunchpadAgents(): RegisteredAgent[] {
    return this.db.listAgents();
  }

  public registerLaunchpadAgent(input: { name: string; strategyType: string; bondUsdc: string }): RegisteredAgent {
    const agent = this.paperEngine.registerAgent({
      name: input.name,
      strategyType: input.strategyType,
      bondUsdc: input.bondUsdc
    });
    this.db.saveAgent(agent);
    return agent;
  }

  public async runLaunchpadPaperTrade(input: {
    agentId: string;
    symbol?: 'AAPL/USD' | 'AVAX/USD' | 'USDC/USD';
    side?: 'BUY' | 'SELL';
    notionalUsd?: string;
    simulateViolation?: boolean;
  }): Promise<{ agent: RegisteredAgent; actions: PaperTradeAction[] }> {
    const feeds = await this.getLaunchpadPrices();
    const sym = input.symbol ?? 'AVAX/USD';
    const feed = feeds.find(f => f.symbol === sym) ?? feeds[0];

    if (input.simulateViolation) {
      const { action, agent } = this.paperEngine.recordPaperTrade(
        input.agentId,
        {
          symbol: sym,
          side: input.side ?? 'BUY',
          notionalUsd: '18000000000', // $180 > $100 cap -> violation & slash
          priceUsd: feed.priceUsd,
          returnBps: -320,
          forceViolationReason: 'Vi phạm PolicyModule: Lệnh vượt hạn mức 24h (180 USD > 100 USD Cap) -> Kích hoạt Slashing tịch thu USDC Bond!'
        },
        this.simState.policy
      );
      this.db.saveAgent(agent);
      this.db.savePaperAction(action);
      return { agent, actions: this.db.listPaperActions(input.agentId) };
    }

    // Run 3 accelerated compliant trades so a newly registered agent can demonstrate graduation
    const session = this.paperEngine.runAcceleratedPaperSession(
      input.agentId,
      [
        {
          symbol: sym,
          side: input.side ?? 'BUY',
          notionalUsd: input.notionalUsd ?? '4500000000',
          priceUsd: feed.priceUsd,
          returnBps: 75
        },
        {
          symbol: 'AAPL/USD',
          side: 'BUY',
          notionalUsd: '4000000000',
          priceUsd: feeds.find(f => f.symbol === 'AAPL/USD')?.priceUsd ?? '22850000000',
          returnBps: 85
        },
        {
          symbol: 'USDC/USD',
          side: 'SELL',
          notionalUsd: '5000000000',
          priceUsd: '100000000',
          returnBps: 65
        }
      ],
      3600,
      this.simState.policy
    );

    this.db.saveAgent(session.agent);
    for (const act of session.actions) {
      this.db.savePaperAction(act);
    }
    return {
      agent: session.agent,
      actions: this.db.listPaperActions(input.agentId)
    };
  }

  public listLaunchpadActions(agentId?: string): PaperTradeAction[] {
    return this.db.listPaperActions(agentId);
  }
}
