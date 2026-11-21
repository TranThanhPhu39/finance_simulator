import type {
  ExecutionMode,
  NetworkEnv,
  PaperTradeAction,
  PolicyConfig,
  PortfolioSnapshot,
  PythPriceFeed,
  RebalancePlan,
  RegisteredAgent,
  RunResult,
  ScenarioDefinition
} from '@repo/shared';

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
export const API_BASE_URL = metaEnv?.VITE_SIMULATION_API_URL || '/api/simulation';

export interface EnvironmentInfo {
  env: NetworkEnv;
  executionMode: ExecutionMode;
  chainId: number;
  moduleAddress: string;
  safeAddress: string;
  routerAddress: string;
  vaultAddress: string;
  usdcAddress: string;
  tokenAAddress: string;
  timestamp: number;
}

export interface TreasuryOverview {
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

export interface ModuleCalldataTx {
  to: string;
  data: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }
  return (await res.json()) as T;
}

export const apiClient = {
  getEnvironment(): Promise<EnvironmentInfo> {
    return requestJson<EnvironmentInfo>('/environment');
  },

  getTreasury(): Promise<TreasuryOverview> {
    return requestJson<TreasuryOverview>('/treasury');
  },

  updatePolicy(payload: {
    cap24hUsd?: string;
    maxSlippageBps?: number;
    maxPriceAgeSec?: number;
    paused?: boolean;
  }): Promise<TreasuryOverview> {
    return requestJson<TreasuryOverview>('/treasury/policy', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  resetTreasury(): Promise<TreasuryOverview> {
    return requestJson<TreasuryOverview>('/treasury/reset', {
      method: 'POST'
    });
  },

  toggleKillSwitch(revoked: boolean): Promise<{ overview: TreasuryOverview; transaction: ModuleCalldataTx }> {
    return requestJson<{ overview: TreasuryOverview; transaction: ModuleCalldataTx }>('/treasury/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ revoked })
    });
  },

  grantSession(): Promise<{ overview: TreasuryOverview; transaction: ModuleCalldataTx }> {
    return requestJson<{ overview: TreasuryOverview; transaction: ModuleCalldataTx }>('/treasury/session/grant', {
      method: 'POST'
    });
  },

  previewRebalance(): Promise<{ plan: RebalancePlan; overview: TreasuryOverview }> {
    return requestJson<{ plan: RebalancePlan; overview: TreasuryOverview }>('/rebalance/preview', {
      method: 'POST'
    });
  },

  executeRebalance(): Promise<{ run: RunResult; overview: TreasuryOverview; plan: RebalancePlan }> {
    return requestJson<{ run: RunResult; overview: TreasuryOverview; plan: RebalancePlan }>('/rebalance/execute', {
      method: 'POST'
    });
  },

  listScenarios(): Promise<ScenarioDefinition[]> {
    return requestJson<ScenarioDefinition[]>('/scenarios');
  },

  triggerRun(payload: {
    scenarioId?: string;
    scenarioIds?: string[];
    env?: NetworkEnv;
    executionMode?: ExecutionMode;
  }): Promise<{ run: RunResult; runs: RunResult[] }> {
    return requestJson<{ run: RunResult; runs: RunResult[] }>('/runs', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  listRuns(): Promise<RunResult[]> {
    return requestJson<RunResult[]>('/runs');
  },

  getRun(runId: string): Promise<RunResult> {
    return requestJson<RunResult>(`/runs/${encodeURIComponent(runId)}`);
  },

  getRunExportUrl(runId: string, format: 'json' | 'csv'): string {
    return `${API_BASE_URL}/runs/${encodeURIComponent(runId)}/export?format=${format}`;
  },

  getLaunchpadPrices(): Promise<PythPriceFeed[]> {
    return requestJson<PythPriceFeed[]>('/launchpad/prices');
  },

  listLaunchpadAgents(): Promise<RegisteredAgent[]> {
    return requestJson<RegisteredAgent[]>('/launchpad/agents');
  },

  registerLaunchpadAgent(payload: {
    name: string;
    strategyType: string;
    bondUsdc: string;
  }): Promise<RegisteredAgent> {
    return requestJson<RegisteredAgent>('/launchpad/agents', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  runLaunchpadPaperTrade(payload: {
    agentId: string;
    symbol?: 'AAPL/USD' | 'AVAX/USD' | 'USDC/USD';
    side?: 'BUY' | 'SELL';
    notionalUsd?: string;
    simulateViolation?: boolean;
  }): Promise<{ agent: RegisteredAgent; actions: PaperTradeAction[] }> {
    return requestJson<{ agent: RegisteredAgent; actions: PaperTradeAction[] }>('/launchpad/paper-trade', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  listLaunchpadActions(agentId?: string): Promise<PaperTradeAction[]> {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    return requestJson<PaperTradeAction[]>(`/launchpad/actions${query}`);
  }
};

export function formatUsd8(rawUsd8: string | number | bigint): string {
  try {
    const val = BigInt(rawUsd8);
    const cents = (val + 500000n) / 1000000n;
    const whole = cents / 100n;
    const frac = (cents % 100n < 0n ? -(cents % 100n) : cents % 100n).toString().padStart(2, '0');
    return `$${whole.toLocaleString('en-US')}.${frac}`;
  } catch {
    return '$0.00';
  }
}

export function formatTokenUnits(raw: string, decimals: number, maxFrac = 2): string {
  try {
    const n = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const rem = n % base;
    if (rem === 0n || maxFrac <= 0) return whole.toLocaleString('en-US');
    const remStr = rem.toString().padStart(decimals, '0').slice(0, maxFrac);
    return `${whole.toLocaleString('en-US')}.${remStr}`;
  } catch {
    return '0';
  }
}

export function shortenHex(hex: string, chars = 4): string {
  if (!hex || hex.length < chars * 2 + 4) return hex;
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
}
