import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRebalancePlan } from '../src/rebalancer';
import { fixture, ROUTER, USDC, TOKEN, VAULT } from './fixtures';

test('swap then vault deposit uses guaranteed cash, preserving pivot reserve', () => {
  const { snapshot, policy } = fixture();
  const p = computeRebalancePlan(snapshot, policy, ROUTER, USDC);
  assert.equal(p.status, 'READY');
  assert.equal(p.isPartial, true);
  assert.equal(p.steps.length, 2);
  const [swap, deposit] = p.steps;
  assert.equal(swap.action, 'SWAP_EXACT_IN');
  assert.equal(deposit.action, 'VAULT_DEPOSIT');
  if (swap.action !== 'SWAP_EXACT_IN' || deposit.action !== 'VAULT_DEPOSIT') throw Error('Wrong steps');
  assert.equal(swap.amountIn, '10000000000000000000');
  assert.equal(swap.minAmountOut, '99000000');
  assert.equal(deposit.assets, '499000000');
  assert.equal(swap.estimatedValueUsd, policy.remainingCapUsd);
  assert.ok(p.steps.every(s => s.deadline === snapshot.timestamp + 300));
});

test('zero swap cap still permits pivot vault deposit', () => {
  const { snapshot, policy } = fixture([1000000000n, 0n, 0n], [5000, 0, 5000]);
  policy.remainingCapUsd = '0';
  const p = computeRebalancePlan(snapshot, policy, ROUTER, USDC);
  assert.equal(p.status, 'READY');
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].action, 'VAULT_DEPOSIT');
});

test('zero swap cap still permits pivot vault withdrawal with exact-assets and maxShares', () => {
  const { snapshot, policy } = fixture([0n, 0n, 1000000000n], [5000, 0, 5000]);
  policy.remainingCapUsd = '0';
  const p = computeRebalancePlan(snapshot, policy, ROUTER, USDC);
  assert.equal(p.status, 'READY');
  const s = p.steps[0];
  assert.equal(s.action, 'VAULT_WITHDRAW');
  if (s.action !== 'VAULT_WITHDRAW') throw Error('Wrong action');
  assert.equal(s.assets, '500000000');
  assert.equal(s.tokenOut, USDC);
  assert.ok(BigInt(s.maxShares) >= 500000000n);
});

test('non-pivot vault withdrawal explicitly swaps its underlying', () => {
  const { snapshot, policy } = fixture([600000000n, 0n, 0n], [7000, 0, 3000]);
  snapshot.positions[2] = { ...snapshot.positions[1], vaultAddress: VAULT, isVaultPosition: true,
    rawBalance: '40000000000000000000', valueUsd: '40000000000', targetBps: 3000,
    vaultConversion: { assets: '1000000000000000000', shares: '2000000000000000000' } };
  snapshot.totalValueUsd = '100000000000';
  const p = computeRebalancePlan(snapshot, policy, ROUTER, USDC);
  assert.deepEqual(p.steps.map(s => s.action), ['VAULT_WITHDRAW', 'SWAP_EXACT_IN']);
  const [withdraw, swap] = p.steps;
  if (withdraw.action !== 'VAULT_WITHDRAW' || swap.action !== 'SWAP_EXACT_IN') throw Error('Wrong steps');
  assert.equal(withdraw.tokenOut, TOKEN);
  assert.equal(swap.tokenIn, TOKEN);
  assert.equal(swap.amountIn, withdraw.assets);
});

test('buying non-pivot vault deposits only minimum guaranteed swap output', () => {
  const { snapshot, policy } = fixture([1000000000n, 0n, 0n], [5000, 0, 5000]);
  snapshot.positions[2] = { ...snapshot.positions[1], vaultAddress: VAULT, isVaultPosition: true,
    targetBps: 5000, vaultConversion: { assets: '1000000000000000000', shares: '2000000000000000000' } };
  const p = computeRebalancePlan(snapshot, policy, ROUTER, USDC);
  const [swap, deposit] = p.steps;
  assert.equal(p.isPartial, true);
  if (swap.action !== 'SWAP_EXACT_IN' || deposit.action !== 'VAULT_DEPOSIT') throw Error('Wrong steps');
  assert.equal(deposit.assets, swap.minAmountOut);
  assert.equal(deposit.tokenIn, TOKEN);
  assert.equal(swap.estimatedValueUsd, '10000000000');
});

test('no duplicate spending of cash across two vault deficits', () => {
  const { snapshot, policy } = fixture([1000000000n, 0n, 0n], [2000, 0, 8000]);
  snapshot.positions[2].targetBps = 4000;
  const secondVault = '0x4000000000000000000000000000000000000002';
  snapshot.positions.push({ ...snapshot.positions[2], vaultAddress: secondVault });
  policy.whitelistedVaults.push(secondVault);
  const p = computeRebalancePlan(snapshot, policy, ROUTER, USDC);
  const deposits = p.steps.filter(s => s.action === 'VAULT_DEPOSIT');
  assert.equal(deposits.reduce((sum, s) => sum + BigInt(s.assets), 0n), 800000000n);
});

test('cap-limited unsatisfied swap is partial; zero-cap swap-only drift is blocked', () => {
  const { snapshot, policy } = fixture([450000000n, 55000000000000000000n, 0n], [6000, 4000, 0]);
  assert.equal(computeRebalancePlan(snapshot, policy, ROUTER, USDC).isPartial, true);
  policy.remainingCapUsd = '0';
  assert.equal(computeRebalancePlan(snapshot, policy, ROUTER, USDC).status, 'BLOCKED');
});

test('balanced portfolio and exact five percentage points do not trigger', () => {
  const { snapshot, policy } = fixture(undefined, [6000, 4000, 0]);
  assert.equal(computeRebalancePlan(snapshot, policy, ROUTER, USDC).status, 'NO_ACTION');
  snapshot.positions[0].targetBps = 6500;
  snapshot.positions[1].targetBps = 3500;
  assert.equal(computeRebalancePlan(snapshot, policy, ROUTER, USDC).status, 'NO_ACTION');
});

test('missing vault quote, revoked session, paused policy and bad targets fail closed', () => {
  for (const alter of [
    ({ snapshot }: ReturnType<typeof fixture>) => { delete snapshot.positions[2].vaultConversion; },
    ({ policy }: ReturnType<typeof fixture>) => { policy.isRevoked = true; },
    ({ policy }: ReturnType<typeof fixture>) => { policy.paused = true; },
    ({ snapshot }: ReturnType<typeof fixture>) => { snapshot.positions[0].targetBps = 10000; },
    ({ policy }: ReturnType<typeof fixture>) => { policy.allowedRecipient = TOKEN; },
  ]) {
    const f = fixture(); alter(f);
    assert.equal(computeRebalancePlan(f.snapshot, f.policy, ROUTER, USDC).status, 'BLOCKED');
  }
});
