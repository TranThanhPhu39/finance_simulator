import type {
  ActionSource,
  NetworkEnv,
  PolicyConfig,
  PortfolioSnapshot,
  RebalancePlan,
} from "./types";

export type Verdict = "PASS" | "FAIL" | "ERROR" | "UNSUPPORTED";
export type OnchainRunStatus = "QUEUED" | "RUNNING" | "COMPLETED";
export interface OnchainAssertionResult {
  id: string;
  label: string;
  expected: string;
  observed: string;
  passed: boolean;
}
export interface ChainEvidence {
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  balances: Record<string, string>;
  allowances: Record<string, string>;
  spent24hUsd: string;
  paused: boolean;
  session: { expiresAt: string; revoked: boolean };
  policy: { cap24hUsd: string; maxPriceAgeSec: number; maxSlippageBps: number };
}
export interface TransactionEvidence {
  label: string;
  stage: "SETUP" | "TEST";
  source: ActionSource | "OWNER_SETUP";
  from: string;
  to: string;
  data: string;
  hash?: string;
  blockNumber?: number;
  receiptStatus?: "success" | "reverted";
  gasUsed?: string;
  observedError?: string;
  expectedError?: string;
  revertData?: string;
}
export interface OnchainScenarioDefinition {
  id: string;
  version: string;
  title: string;
  description: string;
  category:
    | "Normal"
    | "Cap"
    | "Whitelist"
    | "Session"
    | "Price"
    | "Execution"
    | "Vault";
  source: ActionSource;
  environments: NetworkEnv[];
  expectation: string;
}
export interface RunStep {
  id: string;
  label: string;
  timestamp: string;
}
export interface OnchainRunResult {
  id: string;
  kind: "SCENARIO" | "REBALANCE";
  scenarioId?: string;
  scenarioVersion?: string;
  environment: NetworkEnv;
  chainId: number;
  simulatedYield: boolean;
  status: OnchainRunStatus;
  verdict?: Verdict;
  reason?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  source: ActionSource;
  steps: RunStep[];
  assertions: OnchainAssertionResult[];
  transactions: TransactionEvidence[];
  before?: ChainEvidence;
  after?: ChainEvidence;
  policy?: PolicyConfig;
  plan?: RebalancePlan;
  addresses?: Record<string, string>;
  cleanup?: { restored: boolean; error?: string };
  version: string;
  checkpoint?: { snapshotId: string };
  uncertainSubmission?: boolean;
  targets?: number[];
}
export interface EnvironmentInfo {
  environment: NetworkEnv;
  chainId: number;
  ready: boolean;
  reason?: string;
  simulatedYield: boolean;
  addresses: Record<string, string>;
  owner?: string;
  session?: string;
  rpcUrl?: string;
  capabilities: {
    scenarios: boolean;
    reset: boolean;
    rebalance: boolean;
    ownerWallet: boolean;
  };
}
export interface TreasuryView {
  environment: EnvironmentInfo;
  portfolio: PortfolioSnapshot;
  policy: PolicyConfig;
  targets: number[];
  vaultYield?: {
    available: boolean;
    assetsRaw?: string;
    valueUsd?: string;
    reason?: string;
  };
}
