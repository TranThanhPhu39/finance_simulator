import assert from 'node:assert/strict';
import test from 'node:test';
import { TreasuryApiService, createApiServer } from '../src';

test('apps/api endpoints serve treasury, rebalance preview/execute, scenarios, runs export and launchpad', async () => {
  const service = new TreasuryApiService(':memory:', 'local', 'SIMULATED_POLICY');
  const server = createApiServer(service);

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const envRes = await fetch(`${baseUrl}/environment`);
    assert.equal(envRes.status, 200);
    const envData = await envRes.json();
    assert.equal(envData.env, 'local');

    const treasuryRes = await fetch(`${baseUrl}/treasury`);
    assert.equal(treasuryRes.status, 200);
    const treasury = await treasuryRes.json();
    assert.equal(treasury.policy.isRevoked, false);

    // Preview & execute rebalance
    const previewRes = await fetch(`${baseUrl}/rebalance/preview`, { method: 'POST' });
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.plan.status, 'READY');

    // Run scenario SC-03 and export CSV
    const runRes = await fetch(`${baseUrl}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'SC-03' })
    });
    assert.equal(runRes.status, 200);
    const { run } = await runRes.json();
    assert.equal(run.scenarioId, 'SC-03');
    assert.equal(run.verdict, 'PASS');

    const csvRes = await fetch(`${baseUrl}/runs/${run.runId}/export?format=csv`);
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('SC-03'));

    // Topic 16 Launchpad registration and paper trade
    const regRes = await fetch(`${baseUrl}/launchpad/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Quant Bot', strategyType: 'CARRY', bondUsdc: '300000000' })
    });
    assert.equal(regRes.status, 201);
    const newAgent = await regRes.json();
    assert.equal(newAgent.status, 'INCUBATING');

    const tradeRes = await fetch(`${baseUrl}/launchpad/paper-trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: newAgent.agentId })
    });
    assert.equal(tradeRes.status, 200);
    const traded = await tradeRes.json();
    assert.equal(traded.agent.status, 'GRADUATED');
    assert.ok(traded.actions.length >= 3);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
