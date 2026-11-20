import { keccak256, toHex } from 'viem';
import type {
  AgentLifecycleStatus,
  AgentMetrics,
  PaperTradeAction,
  PolicyConfig,
  RegisteredAgent
} from '@repo/shared';

export interface RegisterAgentInput {
  agentId?: string;
  erc8004Id?: string;
  name: string;
  strategyType: string;
  bondUsdc: string;
  createdAt?: number;
}

export interface PaperTradeInput {
  symbol: string;
  side: 'BUY' | 'SELL';
  notionalUsd: string;
  priceUsd: string;
  returnBps?: number;
  timestamp?: number;
  forceViolationReason?: string;
}

export interface AcceleratedPaperSessionResult {
  agent: RegisteredAgent;
  actions: PaperTradeAction[];
  graduated: boolean;
  slashed: boolean;
}

export function computeProofOfActionHash(action: {
  agentId: string;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  notionalUsd: string;
  priceUsd: string;
  compliant: boolean;
}): `0x${string}` {
  const canonical = [
    action.agentId,
    String(action.timestamp),
    action.symbol.toUpperCase(),
    action.side,
    action.notionalUsd,
    action.priceUsd,
    action.compliant ? 'COMPLIANT' : 'VIOLATION'
  ].join('|');
  return keccak256(toHex(canonical));
}

export class PaperTradingEngine {
  private agents = new Map<string, RegisteredAgent>();
  private actionsByAgent = new Map<string, PaperTradeAction[]>();
  private returnsByAgent = new Map<string, number[]>();
  private virtualClockSec: number;

  constructor(initialClockSec = 1800000000) {
    this.virtualClockSec = initialClockSec;
  }

  public advanceClock(seconds: number): number {
    if (seconds > 0) {
      this.virtualClockSec += Math.floor(seconds);
    }
    return this.virtualClockSec;
  }

  public getClock(): number {
    return this.virtualClockSec;
  }

  public registerAgent(input: RegisterAgentInput): RegisteredAgent {
    const createdAt = input.createdAt ?? this.virtualClockSec;
    const agentId = input.agentId ?? `agent_${createdAt}_${Math.random().toString(36).slice(2, 7)}`;
    const erc8004Id =
      input.erc8004Id ?? `erc8004:avax:43113:0x${keccak256(toHex(agentId)).slice(26)}`;

    if (BigInt(input.bondUsdc) <= 0n) {
      throw new Error('Agent bondUsdc must be positive to register.');
    }

    const agent: RegisteredAgent = {
      agentId,
      erc8004Id,
      name: input.name,
      strategyType: input.strategyType,
      bondUsdc: input.bondUsdc,
      status: 'INCUBATING',
      createdAt,
      metrics: {
        sharpeRatio: 0,
        maxDrawdownBps: 0,
        complianceRateBps: 10000,
        totalReturnBps: 0,
        paperTradesCount: 0
      }
    };

    this.agents.set(agentId, agent);
    this.actionsByAgent.set(agentId, []);
    this.returnsByAgent.set(agentId, []);
    return structuredClone(agent);
  }

  public getAgent(agentId: string): RegisteredAgent | undefined {
    const found = this.agents.get(agentId);
    return found ? structuredClone(found) : undefined;
  }

  public listAgents(): RegisteredAgent[] {
    return Array.from(this.agents.values()).map(a => structuredClone(a));
  }

  public listAgentActions(agentId: string): PaperTradeAction[] {
    return (this.actionsByAgent.get(agentId) ?? []).map(a => structuredClone(a));
  }

  public recordPaperTrade(
    agentId: string,
    trade: PaperTradeInput,
    policy?: Pick<PolicyConfig, 'cap24hUsd' | 'isRevoked' | 'paused'>
  ): { action: PaperTradeAction; agent: RegisteredAgent } {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} is not registered.`);
    }

    const timestamp = trade.timestamp ?? this.virtualClockSec;
    this.virtualClockSec = Math.max(this.virtualClockSec, timestamp);

    const notional = BigInt(trade.notionalUsd);
    const cap = policy ? BigInt(policy.cap24hUsd) : 10000000000n; // default $100 cap (8 decimals)

    let compliant = true;
    let reason = `Lệnh ${trade.side} ${trade.symbol} (${(Number(notional) / 1e8).toFixed(2)} USD) tuân thủ đầy đủ PolicyModule.`;

    if (trade.forceViolationReason) {
      compliant = false;
      reason = trade.forceViolationReason;
    } else if (policy?.paused) {
      compliant = false;
      reason = 'Vi phạm Policy: Thực thi khi PolicyModule đang Paused.';
    } else if (policy?.isRevoked) {
      compliant = false;
      reason = 'Vi phạm Policy: Session Key đã bị thu hồi (SessionRevoked).';
    } else if (notional <= 0n) {
      compliant = false;
      reason = 'Vi phạm Policy: Khối lượng giao dịch không hợp lệ (InvalidAmount).';
    } else if (notional > cap) {
      compliant = false;
      reason = `Vi phạm Policy: Giá trị lệnh ${(Number(notional) / 1e8).toFixed(2)} USD vượt hạn mức 24h (${(Number(cap) / 1e8).toFixed(2)} USD).`;
    }

    const proofHash = computeProofOfActionHash({
      agentId,
      timestamp,
      symbol: trade.symbol,
      side: trade.side,
      notionalUsd: trade.notionalUsd,
      priceUsd: trade.priceUsd,
      compliant
    });

    const actions = this.actionsByAgent.get(agentId) ?? [];
    const action: PaperTradeAction = {
      actionId: `act_${agentId}_${actions.length + 1}`,
      agentId,
      timestamp,
      symbol: trade.symbol,
      side: trade.side,
      notionalUsd: trade.notionalUsd,
      priceUsd: trade.priceUsd,
      proofHash,
      compliant,
      reason
    };
    actions.push(action);
    this.actionsByAgent.set(agentId, actions);

    const returns = this.returnsByAgent.get(agentId) ?? [];
    const stepReturnBps = trade.returnBps ?? (compliant ? 45 : -250);
    returns.push(stepReturnBps);
    this.returnsByAgent.set(agentId, returns);

    agent.metrics = this.computeMetrics(actions, returns);
    agent.status = this.evaluateLifecycleStatus(agent, actions);
    if (agent.status === 'SLASHED') {
      agent.bondUsdc = '0';
    }

    return {
      action: structuredClone(action),
      agent: structuredClone(agent)
    };
  }

  public runAcceleratedPaperSession(
    agentId: string,
    trades: PaperTradeInput[],
    stepIntervalSec = 3600,
    policy?: Pick<PolicyConfig, 'cap24hUsd' | 'isRevoked' | 'paused'>
  ): AcceleratedPaperSessionResult {
    const executed: PaperTradeAction[] = [];
    for (const t of trades) {
      this.advanceClock(stepIntervalSec);
      const { action } = this.recordPaperTrade(
        agentId,
        { ...t, timestamp: t.timestamp ?? this.virtualClockSec },
        policy
      );
      executed.push(action);
    }
    const updated = this.getAgent(agentId)!;
    return {
      agent: updated,
      actions: executed,
      graduated: updated.status === 'GRADUATED',
      slashed: updated.status === 'SLASHED'
    };
  }

  private computeMetrics(actions: PaperTradeAction[], returnsBps: number[]): AgentMetrics {
    const count = actions.length;
    if (count === 0) {
      return {
        sharpeRatio: 0,
        maxDrawdownBps: 0,
        complianceRateBps: 10000,
        totalReturnBps: 0,
        paperTradesCount: 0
      };
    }

    const compliantCount = actions.filter(a => a.compliant).length;
    const complianceRateBps = Math.round((compliantCount * 10000) / count);
    const totalReturnBps = returnsBps.reduce((sum, r) => sum + r, 0);

    // Compute equity curve & Max Drawdown in bps
    let equityBps = 10000;
    let peakBps = 10000;
    let maxDrawdownBps = 0;
    for (const r of returnsBps) {
      equityBps += r;
      if (equityBps > peakBps) {
        peakBps = equityBps;
      }
      const ddBps = peakBps > 0 ? Math.round(((peakBps - equityBps) * 10000) / peakBps) : 0;
      if (ddBps > maxDrawdownBps) {
        maxDrawdownBps = ddBps;
      }
    }

    // Compute annualized/normalized Sharpe Ratio
    const mean = totalReturnBps / count;
    const variance =
      returnsBps.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(1, count - 1);
    const stdDev = Math.sqrt(variance);
    let sharpeRatio = 0;
    if (mean > 0) {
      sharpeRatio = stdDev === 0 ? 2.5 : Number(((mean / stdDev) * Math.sqrt(count)).toFixed(2));
    } else if (mean < 0 && stdDev > 0) {
      sharpeRatio = Number(((mean / stdDev) * Math.sqrt(count)).toFixed(2));
    }

    return {
      sharpeRatio,
      maxDrawdownBps,
      complianceRateBps,
      totalReturnBps,
      paperTradesCount: count
    };
  }

  private evaluateLifecycleStatus(
    agent: RegisteredAgent,
    actions: PaperTradeAction[]
  ): AgentLifecycleStatus {
    if (agent.status === 'SLASHED') return 'SLASHED';
    const hasViolation = actions.some(a => !a.compliant);
    if (hasViolation || agent.metrics.complianceRateBps < 10000) {
      return 'SLASHED';
    }
    if (
      agent.metrics.paperTradesCount >= 3 &&
      agent.metrics.complianceRateBps === 10000 &&
      agent.metrics.sharpeRatio >= 1.5 &&
      agent.metrics.maxDrawdownBps <= 1000 // <= 10%
    ) {
      return 'GRADUATED';
    }
    return 'INCUBATING';
  }
}
