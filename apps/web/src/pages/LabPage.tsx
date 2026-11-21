import React, { useState } from 'react';
import { Play, FlaskConical, CheckCircle2, XCircle, AlertCircle, ArrowRight, Filter } from 'lucide-react';
import type { RunResult, ScenarioCategory, ScenarioDefinition } from '@repo/shared';
import { apiClient } from '../api/simulator-client';

interface LabPageProps {
  scenarios: ScenarioDefinition[];
  runs: RunResult[];
  onRunsUpdated: () => Promise<void>;
  onSelectRun: (runId: string) => void;
}

const CATEGORIES: Array<{ id: 'ALL' | ScenarioCategory; label: string }> = [
  { id: 'ALL', label: 'Tất cả (10)' },
  { id: 'NORMAL', label: 'NORMAL' },
  { id: 'CAP', label: 'CAP (24h)' },
  { id: 'WHITELIST', label: 'WHITELIST' },
  { id: 'SESSION', label: 'SESSION' },
  { id: 'PRICE', label: 'PRICE' },
  { id: 'EXECUTION', label: 'EXECUTION' }
];

export const LabPage: React.FC<LabPageProps> = ({
  scenarios,
  runs,
  onRunsUpdated,
  onSelectRun
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | ScenarioCategory>('ALL');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const filtered =
    selectedCategory === 'ALL'
      ? scenarios
      : scenarios.filter(s => s.category === selectedCategory);

  const getLatestRunForScenario = (scenarioId: string): RunResult | undefined => {
    return runs.find(r => r.scenarioId === scenarioId);
  };

  const pollUntilDone = async (runId: string): Promise<RunResult> => {
    for (let i = 0; i < 15; i++) {
      const current = await apiClient.getRun(runId);
      if (current.status === 'COMPLETED' || current.status === 'FAILED') {
        return current;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return await apiClient.getRun(runId);
  };

  const handleRunSingle = async (scenarioId: string) => {
    setRunningId(scenarioId);
    setStatusNotice(`Đang thực thi kịch bản ${scenarioId} và đối chiếu assertions...`);
    try {
      const triggered = await apiClient.triggerRun({ scenarioId });
      const finalRun = triggered.run ? await pollUntilDone(triggered.run.runId) : undefined;
      await onRunsUpdated();
      if (finalRun) {
        setStatusNotice(
          `Hoàn tất ${scenarioId}: Verdict = ${finalRun.verdict} (${finalRun.assertions.filter(a => a.passed).length}/${finalRun.assertions.length} assertions đạt).`
        );
      }
    } catch (err) {
      setStatusNotice(`Lỗi khi chạy ${scenarioId}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

  const handleRunFullSuite = async () => {
    setRunningId('ALL');
    setStatusNotice('Đang chạy toàn bộ 10 tình huống kiểm thử (SC-01 đến SC-10)...');
    try {
      const res = await apiClient.triggerRun({
        scenarioIds: scenarios.map(s => s.id)
      });
      await onRunsUpdated();
      const passCount = res.runs.filter(r => r.verdict === 'PASS').length;
      setStatusNotice(`Đã chạy xong toàn bộ Suite: ${passCount}/${res.runs.length} tình huống đạt PASS.`);
    } catch (err) {
      setStatusNotice(`Lỗi khi chạy Suite: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#111827] p-6 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-[#E84142]" />
            <h2 className="text-lg font-bold text-white">
              Phòng Mô Phỏng Chính Sách (10 Kịch Bản Chuẩn)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Mỗi kịch bản kiểm chứng độc lập các giới hạn của <code className="text-slate-300">PolicyModule</code>: Rolling 24h Cap, Whitelist Token/Router/Vault, Recipient khóa về Safe, Kill-Switch và Rollback khi lỗi.
          </p>
        </div>

        <button
          onClick={handleRunFullSuite}
          disabled={runningId !== null}
          className="inline-flex items-center gap-2 rounded-xl bg-[#E84142] px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-red-600 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {runningId === 'ALL' ? 'Đang chạy 10 tình huống...' : 'Chạy Toàn Bộ 10 Tình Huống (Run Full Suite)'}
        </button>
      </div>

      {statusNotice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200">
          <span>{statusNotice}</span>
          <button onClick={() => setStatusNotice(null)} className="underline opacity-75 hover:opacity-100">
            Đóng
          </button>
        </div>
      )}

      {/* Category Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase text-slate-400 mr-2">
          <Filter className="h-3.5 w-3.5" /> Nhóm kịch bản:
        </span>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              selectedCategory === cat.id
                ? 'bg-[#E84142] text-white shadow'
                : 'bg-[#111827] text-slate-300 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Scenarios Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {filtered.map(sc => {
          const latest = getLatestRunForScenario(sc.id);
          const isThisRunning = runningId === sc.id || runningId === 'ALL';
          return (
            <div
              key={sc.id}
              className="flex flex-col justify-between rounded-xl border border-slate-800 bg-[#111827] p-5 shadow-lg transition hover:border-slate-700"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[#E84142]/15 px-2.5 py-1 font-mono text-xs font-bold text-[#E84142]">
                      {sc.id}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                      {sc.category}
                    </span>
                    <span className="rounded bg-slate-900 border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                      {sc.actionSource}
                    </span>
                  </div>

                  {latest && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        latest.verdict === 'PASS'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : latest.verdict === 'FAIL'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {latest.verdict === 'PASS' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : latest.verdict === 'FAIL' ? (
                        <XCircle className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      {latest.verdict}
                    </span>
                  )}
                </div>

                <h3 className="mt-3 text-base font-bold text-white">{sc.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{sc.description}</p>

                <div className="mt-3 rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Mã kết quả kỳ vọng:</span>
                    <code
                      className={`font-mono font-bold ${
                        sc.expectedErrorCode === 'OK' ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {sc.expectedErrorCode}
                    </code>
                  </div>
                  <ul className="mt-2 space-y-1 text-[11px] text-slate-300 list-disc list-inside">
                    {sc.stepsDescription.map((desc, idx) => (
                      <li key={idx}>{desc}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
                <button
                  onClick={() => handleRunSingle(sc.id)}
                  disabled={runningId !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 border border-slate-700 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5 text-[#E84142]" />
                  {isThisRunning ? 'Đang chạy...' : 'Chạy thử kịch bản'}
                </button>

                {latest ? (
                  <button
                    onClick={() => onSelectRun(latest.runId)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:underline"
                  >
                    <span>Xem chi tiết bằng chứng</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">Chưa có lượt chạy</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
