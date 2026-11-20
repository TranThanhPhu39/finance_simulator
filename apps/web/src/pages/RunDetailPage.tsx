import React from 'react';
import {
  CheckCircle2,
  XCircle,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import type { RunResult } from '@repo/shared';
import { apiClient, formatTokenUnits, formatUsd8, shortenHex } from '../api/client';

interface RunDetailPageProps {
  runs: RunResult[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

export const RunDetailPage: React.FC<RunDetailPageProps> = ({
  runs,
  selectedRunId,
  onSelectRun
}) => {
  const activeRun = runs.find(r => r.runId === selectedRunId) ?? runs[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Column: Run History persisted in SQLite */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg lg:col-span-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#E84142]" />
            <h2 className="text-base font-bold text-white">Lịch Sử Lượt Chạy (SQLite)</h2>
          </div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">
            {runs.length} runs
          </span>
        </div>

        {runs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Chưa có lượt chạy nào trong cơ sở dữ liệu. Hãy sang tab <strong>Phòng Kiểm Thử</strong> để chạy Suite.
          </div>
        ) : (
          <div className="mt-3 max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {runs.map(run => {
              const isSelected = activeRun?.runId === run.runId;
              return (
                <button
                  key={run.runId}
                  onClick={() => onSelectRun(run.runId)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? 'border-[#E84142] bg-slate-900 shadow'
                      : 'border-slate-800/80 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#E84142]">{run.scenarioId}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        run.verdict === 'PASS'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : run.verdict === 'FAIL'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {run.verdict}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs font-semibold text-white">{run.scenarioName}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-mono">{shortenHex(run.runId, 6)}</span>
                    <span>{run.executionMode}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Column: Full Evidence & Export */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-6 shadow-lg lg:col-span-8">
        {!activeRun ? (
          <div className="py-16 text-center text-sm text-slate-400">
            Chọn một lượt chạy ở danh sách bên trái để xem toàn bộ bằng chứng kiểm chứng, assertions và đối chiếu số dư.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Run Header & Export Buttons */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-[#E84142]/15 px-2.5 py-1 font-mono text-xs font-bold text-[#E84142]">
                    {activeRun.scenarioId}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
                      activeRun.verdict === 'PASS'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : activeRun.verdict === 'FAIL'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {activeRun.verdict === 'PASS' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                    VERDICT: {activeRun.verdict}
                  </span>
                  <span className="rounded bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-300">
                    Mode: {activeRun.executionMode}
                  </span>
                  <span className="rounded bg-slate-800 px-2.5 py-1 font-mono text-xs uppercase text-slate-300">
                    Env: {activeRun.env}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-bold text-white">{activeRun.scenarioName}</h2>
                <div className="mt-1 font-mono text-xs text-slate-400">
                  Run ID: {activeRun.runId} • Chi tiêu 24h trước: {formatUsd8(activeRun.spent24hBeforeUsd)} → sau:{' '}
                  <strong className="text-white">{formatUsd8(activeRun.spent24hAfterUsd)}</strong>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={apiClient.getRunExportUrl(activeRun.runId, 'json')}
                  download={`${activeRun.runId}.json`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <FileJson className="h-3.5 w-3.5 text-amber-400" />
                  Export JSON
                </a>
                <a
                  href={apiClient.getRunExportUrl(activeRun.runId, 'csv')}
                  download={`${activeRun.runId}.csv`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#E84142] px-3 py-2 text-xs font-bold text-white hover:bg-red-600"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Export CSV
                </a>
              </div>
            </div>

            {/* Explanation Box */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Tổng hợp & Giải thích Kết quả:
              </div>
              <p className="mt-1 text-sm text-slate-200">{activeRun.explanation}</p>
            </div>

            {/* Execution Steps */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                1. Tiến Trình Từng Bước ({activeRun.steps.length} bước)
              </h3>
              <div className="mt-2 space-y-2">
                {activeRun.steps.map(step => (
                  <div
                    key={step.stepIndex}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-white">
                        #{step.stepIndex + 1} — {step.label}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                          {step.actionSource}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                            step.status === 'OK'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {step.status} ({step.errorCode ?? 'OK'})
                        </span>
                      </div>
                    </div>
                    <p className="mt-1.5 text-slate-300">{step.detail}</p>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      {step.txHash ? (
                        <span>On-chain TxHash: {step.txHash}</span>
                      ) : (
                        <span>
                          TxHash: Không phát sinh giao dịch on-chain (Chặn tại Preflight / {activeRun.executionMode})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Assertions Table */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                2. Bảng Kiểm Chứng Điều Kiện Bắt Buộc (Assertions)
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 uppercase text-slate-400">
                    <tr>
                      <th className="px-3.5 py-2.5">Điều kiện Assertion</th>
                      <th className="px-3.5 py-2.5">Kỳ vọng (Expected)</th>
                      <th className="px-3.5 py-2.5">Quan sát (Actual)</th>
                      <th className="px-3.5 py-2.5">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {activeRun.assertions.map((a, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/40">
                        <td className="px-3.5 py-2.5 font-medium text-white">{a.name}</td>
                        <td className="px-3.5 py-2.5 font-mono text-slate-300">{a.expected}</td>
                        <td className="px-3.5 py-2.5 font-mono text-slate-200">{a.actual}</td>
                        <td className="px-3.5 py-2.5">
                          {a.passed ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" /> PASS
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 font-bold text-red-300">
                              <XCircle className="h-3.5 w-3.5" /> FAIL
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Balance Diffs Table */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                3. ĐỐI CHIẾU SỐ DƯ TRƯỚC & SAU (BALANCE DIFF)
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 uppercase text-slate-400">
                    <tr>
                      <th className="px-3.5 py-2.5">Tài sản</th>
                      <th className="px-3.5 py-2.5">Trước (Số lượng / USD)</th>
                      <th className="px-3.5 py-2.5">Sau (Số lượng / USD)</th>
                      <th className="px-3.5 py-2.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {activeRun.balanceDiffs.map((b, idx) => {
                      const unchanged = b.beforeRaw === b.afterRaw;
                      const decimals =
                        b.symbol === 'A' || b.symbol === 'sAVAX' || b.tokenAddress.toLowerCase().endsWith('0002')
                          ? 18
                          : 6;
                      const cleanSym = b.symbol.replace(' (MockVault4626)', '');
                      return (
                        <tr key={idx} className="hover:bg-slate-900/40">
                          <td className="px-3.5 py-2.5">
                            <div className="font-bold text-white">{b.symbol}</div>
                            <div className="font-mono text-[10px] text-slate-400">
                              {shortenHex(b.tokenAddress, 6)}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-300">
                            <div>
                              <span className="font-semibold text-white">
                                {formatTokenUnits(b.beforeRaw, decimals, 2)} {cleanSym}
                              </span>{' '}
                              <span className="text-slate-400">({formatUsd8(b.beforeUsd)})</span>
                            </div>
                            <div className="text-[10px] text-slate-500">Raw: {b.beforeRaw}</div>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-white">
                            <div>
                              <span className="font-semibold text-white">
                                {formatTokenUnits(b.afterRaw, decimals, 2)} {cleanSym}
                              </span>{' '}
                              <span className="text-emerald-400">({formatUsd8(b.afterUsd)})</span>
                            </div>
                            <div className="text-[10px] text-slate-500">Raw: {b.afterRaw}</div>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                                unchanged
                                  ? 'bg-slate-800 text-slate-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {unchanged ? 'PROTECTED / UNCHANGED' : 'UPDATED'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
