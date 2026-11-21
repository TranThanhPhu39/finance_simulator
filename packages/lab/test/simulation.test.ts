import assert from 'node:assert/strict';
import test from 'node:test';
import { ErrorCode } from '@repo/shared';
import {
  listSimulationScenarios,
  runSimulationScenario,
  runSimulationSuite,
  exportRunAsJson,
  exportRunAsCsv,
  PaperTradingEngine,
  computeProofOfActionHash,
  fetchPythPriceFeeds,
  getFallbackPythFeeds,
  PYTH_FEEDS
} from '../src';

test('catalog lists all 10 standard scenarios SC-01 through SC-10', () => {
  const scenarios = listSimulationScenarios();
  assert.equal(scenarios.length, 10);
  assert.deepEqual(
    scenarios.map(s => s.id),
    ['SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-06', 'SC-07', 'SC-08', 'SC-09', 'SC-10']
  );
});

test('all 10 scenarios execute in SIMULATED_POLICY mode and achieve PASS verdict without fake txHash', async () => {
  const results = await runSimulationSuite(undefined, { env: 'local', executionMode: 'SIMULATED_POLICY' });
  assert.equal(results.length, 10);

  for (const res of results) {
    assert.equal(res.executionMode, 'SIMULATED_POLICY');
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.verdict, 'PASS', `Scenario ${res.scenarioId} failed: ${JSON.stringify(res.assertions)}`);
    assert.ok(res.assertions.length >= 2, `Scenario ${res.scenarioId} must have assertions`);
    assert.ok(res.assertions.every(a => a.passed), `All assertions must pass for ${res.scenarioId}`);
    assert.ok(res.steps.every(s => s.txHash === undefined), 'SIMULATED_POLICY must never invent fake txHash');
  }

  // Specific invariants per key scenario
  const sc01 = results.find(r => r.scenarioId === 'SC-01')!;
  assert.equal(sc01.steps.length, 2);
  assert.equal(sc01.spent24hAfterUsd, '10000000000'); // Only swap input ($100) counted, vault deposit excluded

  const sc03 = results.find(r => r.scenarioId === 'SC-03')!;
  assert.equal(sc03.steps.length, 3);
  assert.deepEqual(sc03.steps.map(s => s.status), ['OK', 'OK', 'BLOCKED']);
  assert.equal(sc03.steps[2].errorCode, ErrorCode.ERR_CAP_EXCEEDED);
  assert.equal(sc03.spent24hAfterUsd, '9000000000'); // Exactly $90.00 (60 + 30)

  const sc07 = results.find(r => r.scenarioId === 'SC-07')!;
  assert.equal(sc07.steps[0].errorCode, ErrorCode.ERR_INVALID_RECIPIENT);
  assert.ok(sc07.assertions.some(a => a.name.includes('foreign recipient') && a.passed && a.actual === '0'));

  const sc10 = results.find(r => r.scenarioId === 'SC-10')!;
  assert.equal(sc10.steps[0].errorCode, ErrorCode.ERR_ROUTER_FAILED);
  assert.equal(sc10.spent24hAfterUsd, '0');
  assert.ok(sc10.balanceDiffs.every(b => b.beforeRaw === b.afterRaw));
});

test('ONCHAIN_RPC mode returns UNSUPPORTED when RPC config is missing or scenario is local-only on fuji', async () => {
  const unsupportedFuji = await runSimulationScenario('SC-09', { env: 'fuji', executionMode: 'SIMULATED_POLICY' });
  assert.equal(unsupportedFuji.verdict, 'UNSUPPORTED');

  const missingRpc = await runSimulationScenario('SC-01', { env: 'local', executionMode: 'ONCHAIN_RPC' });
  assert.equal(missingRpc.verdict, 'UNSUPPORTED');
  assert.equal(missingRpc.executionMode, 'ONCHAIN_RPC');

  const fallbackRun = await runSimulationScenario('SC-01', {
    env: 'local',
    executionMode: 'ONCHAIN_RPC',
    fallbackToSimulation: true
  });
  assert.equal(fallbackRun.verdict, 'PASS');
  assert.equal(fallbackRun.executionMode, 'SIMULATED_POLICY');
});

test('exportRunAsJson and exportRunAsCsv serialize steps, assertions and balanceDiffs cleanly', async () => {
  const run = await runSimulationScenario('SC-03', { env: 'local', executionMode: 'SIMULATED_POLICY' });
  const jsonStr = exportRunAsJson(run);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.scenarioId, 'SC-03');
  assert.equal(parsed.verdict, 'PASS');
  assert.equal(parsed.spent24hAfterUsd, '9000000000');

  const csvStr = exportRunAsCsv(run);
  const lines = csvStr.split('\n');
  assert.ok(lines[0].startsWith('runId,scenarioId,scenarioName,env,executionMode'));
  assert.ok(csvStr.includes(',STEP,'));
  assert.ok(csvStr.includes(',ASSERTION,'));
  assert.ok(csvStr.includes(',BALANCE_DIFF,'));
  assert.ok(csvStr.includes('ERR_CAP_EXCEEDED'));
});

test('Topic 16 PaperTradingEngine computes keccak256 Proof-of-Action and graduates compliant high-Sharpe agent', () => {
  const engine = new PaperTradingEngine(1800000000);
  const agent = engine.registerAgent({
    agentId: 'agent_alpha_01',
    name: 'Alpha Carry Optimizer',
    strategyType: 'ERC4626_CARRY',
    bondUsdc: '500000000'
  });
  assert.equal(agent.status, 'INCUBATING');
  assert.ok(agent.erc8004Id.startsWith('erc8004:avax:43113:0x'));

  const session = engine.runAcceleratedPaperSession('agent_alpha_01', [
    { symbol: 'AAPL/USD', side: 'BUY', notionalUsd: '4000000000', priceUsd: '22850000000', returnBps: 80 },
    { symbol: 'AVAX/USD', side: 'SELL', notionalUsd: '5000000000', priceUsd: '2500000000', returnBps: 65 },
    { symbol: 'USDC/USD', side: 'BUY', notionalUsd: '6000000000', priceUsd: '100000000', returnBps: 75 },
    { symbol: 'AAPL/USD', side: 'SELL', notionalUsd: '4500000000', priceUsd: '23000000000', returnBps: 70 }
  ]);

  assert.equal(session.actions.length, 4);
  for (const act of session.actions) {
    assert.ok(/^0x[\da-f]{64}$/i.test(act.proofHash));
    const expectedHash = computeProofOfActionHash({
      agentId: act.agentId,
      timestamp: act.timestamp,
      symbol: act.symbol,
      side: act.side,
      notionalUsd: act.notionalUsd,
      priceUsd: act.priceUsd,
      compliant: act.compliant
    });
    assert.equal(act.proofHash, expectedHash);
  }

  assert.equal(session.graduated, true);
  assert.equal(session.slashed, false);
  assert.equal(session.agent.status, 'GRADUATED');
  assert.equal(session.agent.metrics.complianceRateBps, 10000);
  assert.ok(session.agent.metrics.sharpeRatio >= 1.5);
  assert.ok(session.agent.metrics.maxDrawdownBps <= 1000);
});

test('Topic 16 PaperTradingEngine slashes agent immediately upon policy violation and zeroes bond', () => {
  const engine = new PaperTradingEngine(1800000000);
  engine.registerAgent({
    agentId: 'agent_rogue_02',
    name: 'Rogue Cap Breaker',
    strategyType: 'UNBOUNDED_SWING',
    bondUsdc: '250000000'
  });

  // First trade compliant ($50 <= $100 cap), second trade violates cap ($150 > $100 cap)
  const session = engine.runAcceleratedPaperSession('agent_rogue_02', [
    { symbol: 'AVAX/USD', side: 'BUY', notionalUsd: '5000000000', priceUsd: '2500000000', returnBps: 40 },
    { symbol: 'AVAX/USD', side: 'BUY', notionalUsd: '15000000000', priceUsd: '2500000000', returnBps: -300 }
  ]);

  assert.equal(session.actions[0].compliant, true);
  assert.equal(session.actions[1].compliant, false);
  assert.equal(session.slashed, true);
  assert.equal(session.graduated, false);
  assert.equal(session.agent.status, 'SLASHED');
  assert.equal(session.agent.bondUsdc, '0');
  assert.equal(session.agent.metrics.complianceRateBps, 5000);
});

test('Topic 16 Pyth price client returns valid 8-decimal feeds for AAPL/USD, AVAX/USD, USDC/USD with fallback resilience', async () => {
  const fallbacks = getFallbackPythFeeds();
  assert.equal(fallbacks.length, 3);
  assert.deepEqual(
    fallbacks.map(f => f.symbol),
    ['AAPL/USD', 'AVAX/USD', 'USDC/USD']
  );
  assert.ok(fallbacks.every(f => f.source === 'fallback' && BigInt(f.priceUsd) > 0n));

  // Test live or fallback fetch with short timeout
  const feeds = await fetchPythPriceFeeds(['AAPL/USD', 'AVAX/USD', 'USDC/USD'], 1500);
  assert.equal(feeds.length, 3);
  for (const feed of feeds) {
    assert.ok(feed.symbol in PYTH_FEEDS);
    assert.ok(BigInt(feed.priceUsd) > 0n);
    assert.ok(feed.source === 'pyth-hermes' || feed.source === 'fallback');
  }
});
