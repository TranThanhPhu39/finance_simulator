import React, { useEffect, useState } from 'react';
import {
  Rocket,
  RefreshCw,
  Award,
  Flame,
  Clock,
  PlusCircle,
  Play,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Hash
} from 'lucide-react';
import type { PaperTradeAction, PythPriceFeed, RegisteredAgent } from '@repo/shared';
import { apiClient, formatTokenUnits, formatUsd8, shortenHex } from '../api/simulator-client';

export const LaunchpadPage: React.FC = () => {
  const [prices, setPrices] = useState<PythPriceFeed[]>([]);
  const [agents, setAgents] = useState<RegisteredAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [actions, setActions] = useState<PaperTradeAction[]>([]);
  const [nameInput, setNameInput] = useState<string>('Avalanche RWA Carry Bot');
  const [strategyInput, setStrategyInput] = useState<string>('ERC4626_CARRY_REBALANCE');
  const [bondUsdcInput, setBondUsdcInput] = useState<string>('300');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = async (targetAgentId?: string) => {
    const [feeds, agentList] = await Promise.all([
      apiClient.getLaunchpadPrices(),
      apiClient.listLaunchpadAgents()
    ]);
    setPrices(feeds);
    setAgents(agentList);
    const activeId = targetAgentId ?? selectedAgentId ?? agentList[0]?.agentId ?? null;
    setSelectedAgentId(activeId);
    const acts = await apiClient.listLaunchpadActions(activeId ?? undefined);
    setActions(acts);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectAgent = async (agentId: string) => {
    setSelectedAgentId(agentId);
    const acts = await apiClient.listLaunchpadActions(agentId);
    setActions(acts);
  };

  const handleRefreshPrices = async () => {
    setBusy('prices');
    try {
      const feeds = await apiClient.getLaunchpadPrices();
      setPrices(feeds);
    } finally {
      setBusy(null);
    }
  };

  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('register');
    setNotice(null);
    try {
      const rawBond6 = BigInt(Math.max(10, Math.round(Number(bondUsdcInput))) * 1_000_000).toString();
      const created = await apiClient.registerLaunchpadAgent({
        name: nameInput.trim() || 'Quant Agent',
        strategyType: strategyInput,
        bondUsdc: rawBond6
      });
      await loadData(created.agentId);
      setNotice(`Đã đăng ký Agent mới: ${created.name} (${created.erc8004Id}) ở trạng thái INCUBATING.`);
    } catch (err) {
      setNotice(`Lỗi đăng ký Agent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const handlePaperTrade = async (agentId: string, simulateViolation: boolean) => {
    setBusy(`${agentId}_${simulateViolation ? 'slash' : 'trade'}`);
    setNotice(null);
    try {
      const res = await apiClient.runLaunchpadPaperTrade({
        agentId,
        simulateViolation
      });
      await loadData(agentId);
      setNotice(
        simulateViolation
          ? `SLASHED: Agent ${res.agent.name} đã vi phạm PolicyModule! Toàn bộ USDC Bond bị cắt phạt về 0.`
          : `Đã thực thi phiên Paper Trading (Accelerated Clock) cho ${res.agent.name}. Trạng thái: ${res.agent.status} (Sharpe: ${res.agent.metrics.sharpeRatio}).`
      );
    } catch (err) {
      setNotice(`Lỗi Paper Trade: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const activeAgent = agents.find(a => a.agentId === selectedAgentId) ?? agents[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Pyth Network Live Price Ticker Bar */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-purple-500/20 px-2.5 py-1 text-xs font-bold text-purple-300 border border-purple-500/30">
              PYTH NETWORK HERMES
            </span>
            <span className="text-xs text-slate-400">
              Nguồn giá thời gian thực dùng cho định giá Paper Trading & Proof-of-Action
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {prices.map(feed => (
              <div
                key={feed.symbol}
                className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs"
              >
                <span className="font-bold text-white">{feed.symbol}</span>
                <span className="font-mono font-semibold text-emerald-400">{formatUsd8(feed.priceUsd)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                    feed.source === 'pyth-hermes'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {feed.source}
                </span>
              </div>
            ))}
            <button
              onClick={handleRefreshPrices}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === 'prices' ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="underline">
            Đóng
          </button>
        </div>
      )}

      {/* Grid: Register Agent Form + Leaderboard */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Register New ERC-8004 Agent */}
        <form
          onSubmit={handleRegisterAgent}
          className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg space-y-4 lg:col-span-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <PlusCircle className="h-5 w-5 text-[#E84142]" />
            <div>
              <h2 className="text-base font-bold text-white">Đăng Ký AI Agent Mới (ERC-8004)</h2>
              <p className="text-[11px] text-slate-400">
                Thế chấp USDC Bond để vào vườn ươm Paper Trading có kiểm chứng.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Tên Agent</label>
            <input
              type="text"
              required
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-[#E84142] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Chiến lược (Strategy Type)</label>
            <select
              value={strategyInput}
              onChange={e => setStrategyInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-[#E84142] focus:outline-none"
            >
              <option value="ERC4626_CARRY_REBALANCE">ERC4626_CARRY_REBALANCE</option>
              <option value="MEAN_REVERSION_500BPS">MEAN_REVERSION_500BPS</option>
              <option value="AVAX_DELTA_NEUTRAL">AVAX_DELTA_NEUTRAL</option>
              <option value="PYTH_EQUITY_HEDGED">PYTH_EQUITY_HEDGED</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Khoản thế chấp (USDC Bond)</label>
            <input
              type="number"
              min="50"
              step="50"
              value={bondUsdcInput}
              onChange={e => setBondUsdcInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-[#E84142] focus:outline-none"
            />
          </div>

          <div className="rounded-lg bg-slate-900/80 p-3 text-[11px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-200">Tiêu chuẩn Tốt nghiệp (GRADUATED):</div>
            <div>• Compliance Rate = 100% (Không vi phạm PolicyModule)</div>
            <div>• Sharpe Ratio ≥ 1.50 & Max Drawdown ≤ 10.0%</div>
            <div>• Vi phạm bất kỳ quy tắc nào → SLASHED (Mất 100% Bond)</div>
          </div>

          <button
            type="submit"
            disabled={busy !== null}
            className="w-full rounded-lg bg-[#E84142] px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-red-600 disabled:opacity-50"
          >
            <Rocket className="mr-1.5 inline h-4 w-4" />
            Đăng Ký & Cấp Mã ERC-8004
          </button>
        </form>

        {/* Leaderboard Table */}
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-white">
                Bảng Xếp Hạng StockAgent Launchpad (Topic 16 Leaderboard)
              </h2>
              <p className="text-xs text-slate-400">
                Bấm vào một Agent để xem lịch sử mã băm Proof-of-Action (<code className="text-slate-300">keccak256</code>) bên dưới.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 uppercase text-slate-400">
                <tr>
                  <th className="px-2.5 pb-2.5">Agent / ERC-8004 ID</th>
                  <th className="px-2.5 pb-2.5">Trạng thái</th>
                  <th className="px-2.5 pb-2.5 whitespace-nowrap">Bond (USDC)</th>
                  <th className="px-3 pb-2.5 whitespace-nowrap">Sharpe</th>
                  <th className="px-3 pb-2.5 whitespace-nowrap">Max DD</th>
                  <th className="px-2.5 pb-2.5 whitespace-nowrap">Compliance</th>
                  <th className="px-2.5 pb-2.5 text-right whitespace-nowrap">Thao tác kiểm định</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {agents.map(ag => {
                  const isSelected = activeAgent?.agentId === ag.agentId;
                  return (
                    <tr
                      key={ag.agentId}
                      onClick={() => handleSelectAgent(ag.agentId)}
                      className={`cursor-pointer transition ${
                        isSelected ? 'bg-slate-900/90' : 'hover:bg-slate-900/40'
                      }`}
                    >
                      <td className="px-2.5 py-3.5">
                        <div className="font-bold text-white">{ag.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {ag.strategyType} • {shortenHex(ag.erc8004Id, 8)}
                        </div>
                      </td>
                      <td className="px-2.5 py-3.5 whitespace-nowrap">
                        {ag.status === 'GRADUATED' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/40">
                            <Award className="h-3 w-3" /> GRADUATED
                          </span>
                        ) : ag.status === 'SLASHED' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11px] font-bold text-red-300 border border-red-500/40">
                            <Flame className="h-3 w-3" /> SLASHED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 border border-amber-500/40">
                            <Clock className="h-3 w-3" /> INCUBATING
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-3.5 font-mono font-semibold text-white whitespace-nowrap">
                        ${formatTokenUnits(ag.bondUsdc, 6)}
                      </td>
                      <td className="px-3 py-3.5 font-mono font-bold text-emerald-400 whitespace-nowrap">
                        {ag.metrics.sharpeRatio.toFixed(2)}
                      </td>
                      <td className="px-3 py-3.5 font-mono text-slate-300 whitespace-nowrap">
                        {(ag.metrics.maxDrawdownBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-2.5 py-3.5 font-mono whitespace-nowrap">
                        <span
                          className={
                            ag.metrics.complianceRateBps === 10000
                              ? 'font-bold text-emerald-400'
                              : 'font-bold text-red-400'
                          }
                        >
                          {(ag.metrics.complianceRateBps / 100).toFixed(0)}% ({ag.metrics.paperTradesCount} lệnh)
                        </span>
                      </td>
                      <td className="px-2.5 py-3.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handlePaperTrade(ag.agentId, false)}
                            disabled={busy !== null || ag.status === 'SLASHED'}
                            title="Chạy phiên Paper Trade hợp lệ (Accelerated Clock)"
                            className="inline-flex items-center gap-1 rounded bg-emerald-600/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 whitespace-nowrap hover:bg-emerald-600/30 disabled:opacity-40"
                          >
                            <Play className="h-3 w-3 shrink-0" />
                            <span>Paper Trade</span>
                          </button>
                          <button
                            onClick={() => handlePaperTrade(ag.agentId, true)}
                            disabled={busy !== null || ag.status === 'SLASHED'}
                            title="Giả lập vi phạm PolicyModule -> Cắt phạt Bond (Slash)"
                            className="inline-flex items-center gap-1 rounded bg-red-600/20 border border-red-500/40 px-2.5 py-1 text-[11px] font-semibold text-red-300 whitespace-nowrap hover:bg-red-600/30 disabled:opacity-40"
                          >
                            <ShieldAlert className="h-3 w-3 shrink-0" />
                            <span>Slash</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Proof-of-Action Audit Log */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-6 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-[#E84142]" />
            <div>
              <h2 className="text-base font-bold text-white">
                Nhật Ký Kiểm Toán Proof-of-Action (keccak256 Hash Log)
              </h2>
              <p className="text-xs text-slate-400">
                Đang hiển thị lịch sử lệnh của Agent:{' '}
                <strong className="text-white">{activeAgent?.name ?? 'Tất cả'}</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 uppercase text-slate-400">
              <tr>
                <th className="pb-2.5">Action ID / Timestamp</th>
                <th className="pb-2.5">Cặp & Chiều</th>
                <th className="pb-2.5">Notional / Giá</th>
                <th className="pb-2.5">PROOF-OF-ACTION HASH (KECCAK256)</th>
                <th className="pb-2.5">Tuân thủ Policy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {actions.map(act => (
                <tr key={act.actionId} className="hover:bg-slate-900/40">
                  <td className="py-3 font-mono text-slate-300">
                    <div>{act.actionId}</div>
                    <div className="text-[10px] text-slate-500">T={act.timestamp}</div>
                  </td>
                  <td className="py-3">
                    <span
                      className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        act.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {act.side}
                    </span>
                    <span className="font-bold text-white">{act.symbol}</span>
                  </td>
                  <td className="py-3 font-mono">
                    <div className="text-white">{formatUsd8(act.notionalUsd)}</div>
                    <div className="text-[10px] text-slate-400">@ {formatUsd8(act.priceUsd)}</div>
                  </td>
                  <td className="py-3 font-mono text-[11px] text-purple-300">
                    <code title={act.proofHash}>{shortenHex(act.proofHash, 10)}</code>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5">
                      {act.compliant ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> COMPLIANT
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 font-bold text-red-300">
                          <XCircle className="h-3.5 w-3.5" /> VIOLATION (SLASHED)
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">{act.reason}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
