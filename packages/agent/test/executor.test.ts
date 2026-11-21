import test from 'node:test';
import assert from 'node:assert/strict';
import type { PolicyClient } from '@repo/chain-client';
import { PlanExecutor } from '../src/executor';
import { computeRebalancePlan } from '../src/rebalancer';
import { fixture, SAFE, ROUTER, USDC } from './fixtures';

const MODULE = '0x5000000000000000000000000000000000000001';
function setup(options: { revert?: boolean; timeout?: boolean; preflight?: boolean; sendUnknown?: boolean } = {}) {
  let sent = 0;
  const adapter = {
    prepareStep: async () => ({ to: MODULE, data: '0x1234' }),
    simulateTransaction: async () => { if (options.preflight) throw Error('RPC failed'); },
    submitTransaction: async () => { ++sent; if (options.sendUnknown) throw Error('Connection lost'); return '0x1234'; },
    publicClient: { waitForTransactionReceipt: async () => {
      if (options.timeout) throw Error('Timeout');
      return { status: options.revert ? 'reverted' : 'success', blockNumber: 3n };
    } },
  };
  const { snapshot, policy } = fixture();
  return { executor: new PlanExecutor(adapter as unknown as PolicyClient, MODULE, SAFE),
    plan: computeRebalancePlan(snapshot, policy, ROUTER, USDC), sent: () => sent };
}

test('duplicate requests with same plan submit once per step', async () => {
  const f = setup();
  const [a, b] = await Promise.all([f.executor.execute(f.plan), f.executor.execute(f.plan)]);
  assert.equal(a, b);
  assert.equal(a.status, 'COMPLETED');
  assert.equal(f.sent(), f.plan.steps.length);
  await f.executor.execute(f.plan);
  assert.equal(f.sent(), f.plan.steps.length);
});

test('reused ID with modified payload and concurrent different plan are rejected', async () => {
  const f = setup();
  const running = f.executor.execute(f.plan);
  await assert.rejects(f.executor.execute({ ...f.plan, isPartial: !f.plan.isPartial }), /changed payload/);
  await assert.rejects(f.executor.execute({ ...f.plan, planId: 'second' }), /already running/);
  await running;
});

test('preflight error creates no hash and no send', async () => {
  const f = setup({ preflight: true });
  const result = await f.executor.execute(f.plan);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.steps[0].status, 'PREFLIGHT_REJECTED');
  assert.equal(result.steps[0].hash, undefined);
  assert.equal(f.sent(), 0);
});

test('reverted receipt stops remaining plan steps', async () => {
  const f = setup({ revert: true });
  const result = await f.executor.execute(f.plan);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.steps[0].status, 'REVERTED');
  assert.equal(f.sent(), 1);
});

test('receipt timeout retains hash, stops and never resends same plan', async () => {
  const f = setup({ timeout: true });
  const result = await f.executor.execute(f.plan);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.steps[0].hash, '0x1234');
  await f.executor.execute(f.plan);
  assert.equal(f.sent(), 1);
});

test('send transport failure stays uncertain and cannot trigger blind retry', async () => {
  const f = setup({ sendUnknown: true });
  const result = await f.executor.execute(f.plan);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.steps[0].status, 'SUBMISSION_UNKNOWN');
  assert.equal(result.steps[0].hash, undefined);
  await f.executor.execute(f.plan);
  assert.equal(f.sent(), 1);
});

test('plan is captured before async execution; caller cannot append another transfer', async () => {
  const f = setup();
  const expected = f.plan.steps.length;
  const promise = f.executor.execute(f.plan);
  f.plan.steps.push({ ...f.plan.steps[0], stepIndex: expected });
  const result = await promise;
  assert.equal(result.steps.length, expected);
  assert.equal(f.sent(), expected);
});

test('out-of-order steps are rejected before sending', async () => {
  const f = setup();
  f.plan.steps[0].stepIndex = 7;
  await assert.rejects(f.executor.execute(f.plan), /step order/);
  assert.equal(f.sent(), 0);
});
