import React, { useEffect, useState } from 'react';
import {
  Shield,
  FlaskConical,
  FileCheck2,
  Rocket,
  Wallet,
  Cpu
} from 'lucide-react';
import type { RunResult, ScenarioDefinition } from '@repo/shared';
import { apiClient, shortenHex, type EnvironmentInfo, type TreasuryOverview } from './api/client';
import { connectOwnerWallet, type WalletState } from './wallet/wallet';
import { TreasuryPage } from './pages/TreasuryPage';
import { LabPage } from './pages/LabPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { LaunchpadPage } from './pages/LaunchpadPage';

type TabKey = 'treasury' | 'lab' | 'detail' | 'launchpad';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('treasury');
  const [envInfo, setEnvInfo] = useState<EnvironmentInfo | null>(null);
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioDefinition[]>([]);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    chainId: null,
    hasProvider: false,
    notice: null
  });

  const refreshAll = async () => {
    try {
      const [env, tr, sc, rn] = await Promise.all([
        apiClient.getEnvironment(),
        apiClient.getTreasury(),
        apiClient.listScenarios(),
        apiClient.listRuns()
      ]);
      setEnvInfo(env);
      setOverview(tr);
      setScenarios(sc);
      setRuns(rn);
      if (!selectedRunId && rn.length > 0) {
        setSelectedRunId(rn[0].runId);
      }
    } catch (err) {
      console.error('Failed to load initial data from API:', err);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const handleConnectWallet = async () => {
    const w = await connectOwnerWallet();
    setWallet(w);
  };

  const handleOpenRunDetail = (runId: string) => {
    setSelectedRunId(runId);
    setActiveTab('detail');
  };

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0F172A]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap xl:flex-nowrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Brand Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E84142] shadow-lg shadow-[#E84142]/20">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-extrabold tracking-tight text-white whitespace-nowrap">
                  Treasury Agent Lab
                </span>
                <span className="rounded bg-[#E84142]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#E84142]">
                  Avalanche
                </span>
              </div>
              <p className="text-[11px] text-slate-400 whitespace-nowrap">
                Policy-Bound Safe AI Treasury & ERC-8004 Launchpad
              </p>
            </div>
          </div>

          {/* 4 Main Screen Tabs */}
          <nav className="flex items-center gap-1 rounded-xl border border-slate-800 bg-[#0B1120] p-1 shrink-0">
            <button
              onClick={() => setActiveTab('treasury')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                activeTab === 'treasury'
                  ? 'bg-[#E84142] text-white shadow'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              1. Quỹ & Policy
            </button>

            <button
              onClick={() => setActiveTab('lab')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                activeTab === 'lab'
                  ? 'bg-[#E84142] text-white shadow'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              2. Phòng Lab
            </button>

            <button
              onClick={() => setActiveTab('detail')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                activeTab === 'detail'
                  ? 'bg-[#E84142] text-white shadow'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <FileCheck2 className="h-3.5 w-3.5" />
              3. Bằng Chứng ({runs.length})
            </button>

            <button
              onClick={() => setActiveTab('launchpad')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                activeTab === 'launchpad'
                  ? 'bg-[#E84142] text-white shadow'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Rocket className="h-3.5 w-3.5" />
              4. Launchpad
            </button>
          </nav>

          {/* Environment Badge & Owner Wallet Button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111827] px-2.5 py-1.5 text-xs whitespace-nowrap">
              <Cpu className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-mono font-semibold text-slate-200">
                {envInfo?.executionMode ?? 'SIMULATED_POLICY'}
              </span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                {envInfo?.env === 'fuji' ? 'AVALANCHE FUJI' : 'LOCAL (31337)'}
              </span>
            </div>

            <button
              onClick={handleConnectWallet}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                wallet.connected
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                  : 'border-slate-700 bg-[#111827] text-white hover:border-[#E84142]'
              }`}
            >
              <Wallet className="h-3.5 w-3.5 text-[#E84142]" />
              {wallet.connected && wallet.address
                ? `Owner: ${shortenHex(wallet.address, 4)}`
                : 'Kết nối Ví Owner'}
            </button>
          </div>
        </div>

        {wallet.notice && (
          <div className="border-t border-slate-800/80 bg-slate-900/90 px-4 py-1.5 text-center text-xs text-slate-300">
            {wallet.notice}
          </div>
        )}
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === 'treasury' && (
          <TreasuryPage
            overview={overview}
            wallet={wallet}
            onRefresh={refreshAll}
            onOpenRunDetail={handleOpenRunDetail}
          />
        )}

        {activeTab === 'lab' && (
          <LabPage
            scenarios={scenarios}
            runs={runs}
            onRunsUpdated={refreshAll}
            onSelectRun={handleOpenRunDetail}
          />
        )}

        {activeTab === 'detail' && (
          <RunDetailPage
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRun={id => setSelectedRunId(id)}
          />
        )}

        {activeTab === 'launchpad' && <LaunchpadPage />}
      </main>
    </div>
  );
};
