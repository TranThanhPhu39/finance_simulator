import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  RotateCcw,
  Sparkles,
  Play,
  Sliders,
  Lock,
  Unlock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import type { RebalancePlan, RunResult } from '@repo/shared';
import { apiClient, formatTokenUnits, formatUsd8, shortenHex, type TreasuryOverview } from '../api/simulator-client';
import { sendOwnerTransactionIfPossible, type WalletState } from '../wallet/simulator-wallet';

interface TreasuryPageProps {
  overview: TreasuryOverview | null;
  wallet: WalletState;
  onRefresh: () => Promise<void>;
  onOpenRunDetail: (runId: string) => void;
}

export const TreasuryPage: React.FC<TreasuryPageProps> = ({
  overview,
  wallet,
  onRefresh,
  onOpenRunDetail
}) => {
  const [capInputUsd, setCapInputUsd] = useState<string>('100');
  const [slippageBpsInput, setSlippageBpsInput] = useState<string>('100');
  const [previewPlan, setPreviewPlan] = useState<RebalancePlan | null>(null);
  const [lastRebalanceRun, setLastRebalanceRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  if (!overview) {
    return (
      <div className="p-8 text-center text-slate-400">
        Đang tải dữ liệu Quỹ & Chính sách từ PolicyModule...
      </div>
    );
  }

  const { policy, portfolio, spent24hUsd, accruedYieldUsd } = overview;
  const capBig = BigInt(policy.cap24hUsd || '10000000000');
  const spentBig = BigInt(spent24hUsd || '0');
  const spentPct = capBig > 0n ? Math.min(100, Number((spentBig * 100n) / capBig)) : 100;

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('policy');
    setBanner(null);
    try {
      const capNum = Math.max(0, Number(capInputUsd));
      const rawCap8 = BigInt(Math.round(capNum * 1e8)).toString();
      const slipNum = Math.min(1000, Math.max(0, Number(slippageBpsInput)));
      await apiClient.updatePolicy({
        cap24hUsd: rawCap8,
        maxSlippageBps: slipNum
      });
      await onRefresh();
      setBanner({ type: 'ok', text: `Đã cập nhật PolicyModule: Cap 24h = $${capNum.toFixed(2)}, Max Slippage = ${slipNum} bps.` });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async () => {
    setBusy('reset');
    setBanner(null);
    try {
      await apiClient.resetTreasury();
      setPreviewPlan(null);
      setLastRebalanceRun(null);
      setCapInputUsd('100');
      setSlippageBpsInput('100');
      await onRefresh();
      setBanner({ type: 'ok', text: 'Đã reset trạng thái mô phỏng Quỹ, bộ đếm 24h và khôi phục Session Key.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKillSwitch = async (revoke: boolean) => {
    setBusy('killswitch');
    setBanner(null);
    try {
      const res = revoke ? await apiClient.toggleKillSwitch(true) : await apiClient.grantSession();
      const txNotice = await sendOwnerTransactionIfPossible(wallet, res.transaction);
      await onRefresh();
      setBanner({
        type: revoke ? 'warn' : 'ok',
        text: revoke
          ? `KILL-SWITCH KÍCH HOẠT: Đã thu hồi Session Key (${shortenHex(policy.sessionKey)}). ${txNotice.message}`
          : `ĐÃ CẤP LẠI SESSION KEY: Agent được phép hoạt động trở lại trong phạm vi PolicyModule. ${txNotice.message}`
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handlePreviewRebalance = async () => {
    setBusy('preview');
    setBanner(null);
    try {
      const res = await apiClient.previewRebalance();
      setPreviewPlan(res.plan);
      await onRefresh();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleExecuteRebalance = async () => {
    setBusy('execute');
    setBanner(null);
    try {
      const res = await apiClient.executeRebalance();
      setPreviewPlan(res.plan);
      setLastRebalanceRun(res.run);
      await onRefresh();
      setBanner({
        type: res.run.verdict === 'PASS' ? 'ok' : 'warn',
        text: `Đã thực thi chu kỳ Rebalance (${res.run.runId}): Verdict = ${res.run.verdict}.`
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {banner && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            banner.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
              : banner.type === 'warn'
              ? 'border-amber-500/40 bg-amber-950/40 text-amber-200'
              : 'border-red-500/40 bg-red-950/40 text-red-200'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-xs underline opacity-80 hover:opacity-100">
            Đóng
          </button>
        </div>
      )}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-400">
            <span>Tổng Giá Trị Quỹ (Safe)</span>
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
              {shortenHex(portfolio.accountAddress)}
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{formatUsd8(portfolio.totalValueUsd)}</div>
          <div className="mt-1 text-xs text-slate-400">
            Block #{portfolio.blockNumber} • Bảo vệ bởi Safe v1.4.1 + PolicyModule
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-400">
            <span>Hạn Mức Swap 24h (Rolling Cap)</span>
            <span className="rounded bg-[#E84142]/15 px-2 py-0.5 text-[11px] font-semibold text-[#E84142]">
              {policy.capScope}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-white">
              {formatUsd8(spent24hUsd)} <span className="text-sm font-normal text-slate-400">/ {formatUsd8(policy.cap24hUsd)}</span>
            </span>
            <span className="text-xs font-semibold text-emerald-400">
              Còn: {formatUsd8(policy.remainingCapUsd)}
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                spentPct >= 90 ? 'bg-[#EF4444]' : spentPct >= 60 ? 'bg-[#F59E0B]' : 'bg-[#10B981]'
              }`}
              style={{ width: `${spentPct}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-400">
            <span>Trạng Thái Session Key</span>
            {policy.isRevoked ? (
              <ShieldAlert className="h-4 w-4 text-[#EF4444]" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-[#10B981]" />
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                policy.isRevoked
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              }`}
            >
              {policy.isRevoked ? 'REVOKED (ĐÃ THU HỒI)' : 'ACTIVE (ĐANG CẤP QUYỀN)'}
            </span>
          </div>
          <div className="mt-2 font-mono text-xs text-slate-400">
            Key: {shortenHex(policy.sessionKey, 6)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-400">
            <span>Lãi Tích Lũy Mô Phỏng</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-400">+{formatUsd8(accruedYieldUsd)}</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              MockVault4626
            </span>
            <span>5.00% APY (ERC-4626 Carry)</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Portfolio Table + Policy & Emergency Kill-Switch */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Portfolio Allocation Table */}
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-6 shadow-lg lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Danh Mục Tài Sản & Tỷ Trọng Mục Tiêu</h2>
              <p className="text-xs text-slate-400">
                Agent chỉ kích hoạt tái cân bằng khi độ lệch tỷ trọng vượt ngưỡng ±5% (500 bps).
              </p>
            </div>
            <button
              onClick={handleReset}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Mô Phỏng
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                  <th className="pb-3">Tài sản / Vị thế</th>
                  <th className="pb-3">Số dư</th>
                  <th className="pb-3">Giá (USD)</th>
                  <th className="pb-3">Giá trị (USD)</th>
                  <th className="pb-3">Hiện tại vs Mục tiêu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {portfolio.positions.map((pos, idx) => {
                  const currentPct = (pos.currentBps / 100).toFixed(1);
                  const targetPct = (pos.targetBps / 100).toFixed(1);
                  const driftBps = pos.currentBps - pos.targetBps;
                  const isDrifted = Math.abs(driftBps) > 500;
                  return (
                    <tr key={idx} className="hover:bg-slate-900/50">
                      <td className="py-3.5">
                        <div className="font-semibold text-white">{pos.symbol}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {shortenHex(pos.vaultAddress ?? pos.tokenAddress, 6)}
                          {pos.isVaultPosition && (
                            <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                              ERC-4626 Vault
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 font-mono text-slate-200">
                        {formatTokenUnits(pos.rawBalance, pos.decimals)}
                      </td>
                      <td className="py-3.5 font-mono text-slate-300">{formatUsd8(pos.priceUsd)}</td>
                      <td className="py-3.5 font-mono font-semibold text-white">{formatUsd8(pos.valueUsd)}</td>
                      <td className="py-3.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className={isDrifted ? 'font-bold text-amber-400' : 'text-slate-300'}>
                            {currentPct}% <span className="text-slate-500">/ {targetPct}%</span>
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              driftBps > 500
                                ? 'bg-amber-500/20 text-amber-300'
                                : driftBps < -500
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {driftBps > 0 ? `+${(driftBps / 100).toFixed(1)}%` : `${(driftBps / 100).toFixed(1)}%`}
                          </span>
                        </div>
                        <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="bg-[#E84142] transition-all"
                            style={{ width: `${Math.min(100, pos.currentBps / 100)}%` }}
                            title={`Hiện tại: ${currentPct}%`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Whitelist summary */}
          <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 text-xs md:grid-cols-3">
            <div className="rounded-lg bg-slate-900/70 p-3">
              <div className="font-semibold text-slate-300">Whitelisted Tokens ({policy.whitelistedTokens.length})</div>
              <div className="mt-1 font-mono text-[11px] text-slate-400">
                {policy.whitelistedTokens.map(t => shortenHex(t, 4)).join(', ')}
              </div>
            </div>
            <div className="rounded-lg bg-slate-900/70 p-3">
              <div className="font-semibold text-slate-300">Whitelisted Vaults ({policy.whitelistedVaults.length})</div>
              <div className="mt-1 font-mono text-[11px] text-slate-400">
                {policy.whitelistedVaults.map(v => shortenHex(v, 4)).join(', ')}
              </div>
            </div>
            <div className="rounded-lg bg-slate-900/70 p-3">
              <div className="font-semibold text-slate-300">Allowed Recipient (Locked)</div>
              <div className="mt-1 font-mono text-[11px] text-emerald-400">
                Safe Only ({shortenHex(policy.allowedRecipient, 4)})
              </div>
            </div>
          </div>
        </div>

        {/* Policy Config & Emergency Kill-Switch */}
        <div className="space-y-6">
          {/* Emergency Kill-Switch Box */}
          <div className="rounded-xl border-2 border-[#EF4444]/60 bg-gradient-to-b from-red-950/40 to-[#111827] p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-[#EF4444]" />
                <h3 className="text-base font-bold text-white">Emergency Kill-Switch</h3>
              </div>
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-red-300">
                Safe Owner Control
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Thu hồi ngay lập tức quyền thực thi của Session Key trên <code className="text-red-300">PolicyModule</code>. Mọi lệnh từ AI Agent sẽ bị chặn cứng on-chain với mã <code className="text-red-300">ERR_SESSION_REVOKED</code>.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {!policy.isRevoked ? (
                <button
                  onClick={() => handleToggleKillSwitch(true)}
                  disabled={busy !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#EF4444] px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-red-600 disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  Thu Hồi Session Key Ngay (Revoke)
                </button>
              ) : (
                <button
                  onClick={() => handleToggleKillSwitch(false)}
                  disabled={busy !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#10B981] px-4 py-2.5 text-sm font-bold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Unlock className="h-4 w-4" />
                  Cấp Lại Quyền Session Key (Grant)
                </button>
              )}
            </div>
          </div>

          {/* Policy Parameters Form */}
          <form
            onSubmit={handleSavePolicy}
            className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg space-y-4"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Sliders className="h-4 w-4 text-[#E84142]" />
              <h3 className="text-base font-semibold text-white">Cấu Hình Giới Hạn PolicyModule</h3>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Hạn mức Swap 24h (Cap 24h USD)
              </label>
              <input
                type="number"
                min="0"
                step="10"
                value={capInputUsd}
                onChange={e => setCapInputUsd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-[#E84142] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Độ trượt giá tối đa (Max Slippage bps — 100 = 1%)
              </label>
              <input
                type="number"
                min="1"
                max="1000"
                value={slippageBpsInput}
                onChange={e => setSlippageBpsInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-[#E84142] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy !== null}
              className="w-full rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 border border-slate-700 disabled:opacity-50"
            >
              Lưu Cấu Hình Policy
            </button>
          </form>
        </div>
      </div>

      {/* AI Rebalancer Section */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-6 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#E84142]" />
              <h2 className="text-lg font-semibold text-white">
                AI Rebalancer (Rule-Engine Sizing + LLM Explanation)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Thuật toán tính toán lệnh deterministically theo hạn mức 24h còn lại; LLM chỉ giải thích số liệu thật, không tự quyết định giao dịch.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePreviewRebalance}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              {busy === 'preview' ? 'Đang tính toán...' : 'Preview Rebalance'}
            </button>
            <button
              onClick={handleExecuteRebalance}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E84142] px-4 py-2 text-xs font-bold text-white shadow hover:bg-red-600 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {busy === 'execute' ? 'Đang thực thi...' : 'Run Rebalance'}
            </button>
          </div>
        </div>

        {previewPlan ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-900/90 p-4 border border-slate-800">
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    previewPlan.status === 'READY'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : previewPlan.status === 'BLOCKED'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  STATUS: {previewPlan.status}
                </span>
                {previewPlan.isPartial && (
                  <span className="rounded bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300">
                    Partial Rebalance (Giới hạn bởi Cap 24h)
                  </span>
                )}
                <span className="font-mono text-xs text-slate-400">Plan ID: {previewPlan.planId}</span>
              </div>
              {lastRebalanceRun && (
                <button
                  onClick={() => onOpenRunDetail(lastRebalanceRun.runId)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:underline"
                >
                  <span>Xem Bằng Chứng Thực Thi ({lastRebalanceRun.runId})</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Giải thích từ Hệ thống & AI Trợ lý:
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-200">
                {previewPlan.llmExplanation || previewPlan.ruleReasoning}
              </p>
            </div>

            {previewPlan.steps.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase text-slate-400">
                  Các bước lệnh dự kiến ({previewPlan.steps.length} bước):
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {previewPlan.steps.map(step => {
                    const resolveTokenMeta = (addr: string, isVault = false) => {
                      const pos = portfolio.positions.find(
                        p =>
                          (isVault && p.vaultAddress?.toLowerCase() === addr.toLowerCase()) ||
                          (!isVault && p.tokenAddress.toLowerCase() === addr.toLowerCase())
                      );
                      const is18 = addr.toLowerCase().endsWith('0002');
                      return {
                        symbol: isVault ? 'vUSDC' : pos?.symbol?.replace(' (MockVault4626)', '') ?? (is18 ? 'sAVAX' : 'USDC'),
                        decimals: pos?.decimals ?? (is18 ? 18 : 6)
                      };
                    };

                    return (
                      <div
                        key={step.stepIndex}
                        className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">
                            Bước #{step.stepIndex + 1}: {step.action}
                          </span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-emerald-300">
                            ~{formatUsd8(step.estimatedValueUsd)}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          Target: {shortenHex(step.targetContract, 6)}
                        </div>
                        {step.action === 'SWAP_EXACT_IN' ? (() => {
                          const metaIn = resolveTokenMeta(step.tokenIn);
                          const metaOut = resolveTokenMeta(step.tokenOut);
                          return (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-slate-200">
                                <span className="text-amber-300">
                                  {formatTokenUnits(step.amountIn, metaIn.decimals, 2)} {metaIn.symbol}
                                </span>{' '}
                                → Min{' '}
                                <span className="text-emerald-300">
                                  {formatTokenUnits(step.minAmountOut, metaOut.decimals, 2)} {metaOut.symbol}
                                </span>
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">
                                Raw: {step.amountIn} → min {step.minAmountOut}
                              </div>
                            </div>
                          );
                        })() : step.action === 'VAULT_DEPOSIT' ? (() => {
                          const metaIn = resolveTokenMeta(step.tokenIn);
                          return (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-slate-200">
                                <span className="text-amber-300">
                                  {formatTokenUnits(step.assets, metaIn.decimals, 2)} {metaIn.symbol}
                                </span>{' '}
                                → Min{' '}
                                <span className="text-emerald-300">
                                  {formatTokenUnits(step.minShares, metaIn.decimals, 2)} vUSDC
                                </span>
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">
                                Raw: {step.assets} assets → min {step.minShares} shares
                              </div>
                            </div>
                          );
                        })() : (() => {
                          const metaOut = resolveTokenMeta(step.tokenOut);
                          return (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-slate-200">
                                Rút{' '}
                                <span className="text-amber-300">
                                  {formatTokenUnits(step.assets, metaOut.decimals, 2)} {metaOut.symbol}
                                </span>{' '}
                                (Max{' '}
                                <span className="text-emerald-300">
                                  {formatTokenUnits(step.maxShares, metaOut.decimals, 2)} vUSDC
                                </span>)
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">
                                Raw: {step.assets} assets (max {step.maxShares} shares)
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
            <span>
              Bấm <strong className="text-slate-200">Preview Rebalance</strong> để xem kế hoạch cắt giảm tỷ trọng sAVAX thừa và nạp USDC vào MockVault4626.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
