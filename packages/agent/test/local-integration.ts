import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWalletClient, http, parseAbi, bytesToHex, type Address } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { PolicyClient } from '@repo/chain-client';
import { ErrorCode } from '@repo/shared';
import { readPortfolioSnapshot, computeRebalancePlan, PlanExecutor, type PositionConfig } from '../src';

async function main() {
  const rpc = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(rpc).hostname), 'Local loopback RPC only.');
  // Public Anvil mnemonic only. No credentials are read from user wallets.
  const mnemonic = 'test test test test test test test test test test test junk';
  const owner = mnemonicToAccount(mnemonic, { addressIndex: 0 });
  const session = mnemonicToAccount(mnemonic, { addressIndex: 1 });
  const key = session.getHdKey().privateKey;
  assert.ok(key);
  const client = new PolicyClient('local', rpc, bytesToHex(key));
  await client.ensureNetwork();
  const { addresses: a } = JSON.parse(await readFile(new URL('../../../deployments/local.json', import.meta.url), 'utf8')) as {
    addresses: Record<string, Address> };
  const universe = { tokens: [a.MockUSDC, a.MockTokenA], routers: [a.MockRouter], vaults: [a.MockVault4626] };
  const config: PositionConfig[] = [
    { tokenAddress: a.MockUSDC, symbol: 'USDC', targetBps: 2000 },
    { tokenAddress: a.MockTokenA, symbol: 'A', targetBps: 3000 },
    { tokenAddress: a.MockUSDC, vaultAddress: a.MockVault4626, symbol: 'vUSDC', targetBps: 5000 },
  ];
  const snapshot = () => readPortfolioSnapshot(client, a.Safe, a.MockPriceOracle, config, 3600);
  const before = await snapshot();
  const policy = await client.readPolicyConfig(a.PolicyModule, session.address, universe, BigInt(before.blockNumber));
  assert.equal(policy.isRevoked, false);
  assert.equal(policy.remainingCapUsd, '10000000000', 'Fresh deployment required; smoke already consumes cap/revokes session.');
  assert.equal(before.totalValueUsd, '100000000000');
  const plan = computeRebalancePlan(before, policy, a.MockRouter, a.MockUSDC);
  assert.deepEqual(plan.steps.map(s => s.action), ['SWAP_EXACT_IN', 'VAULT_DEPOSIT']);
  const executor = new PlanExecutor(client, a.PolicyModule, a.Safe);
  const [execution, repeated] = await Promise.all([executor.execute(plan), executor.execute(plan)]);
  assert.equal(execution, repeated, 'Duplicate request must share one execution.');
  assert.equal(execution.status, 'COMPLETED', JSON.stringify(execution));
  assert.equal(execution.steps.length, 2);
  assert.ok(execution.steps.every(s => s.status === 'SUCCESS' && s.hash));
  const after = await snapshot();
  assert.equal(after.positions[0].rawBalance, '201000000');
  assert.equal(after.positions[1].rawBalance, '30000000000000000000');
  assert.equal(after.positions[2].vaultShares, '499000000');
  assert.equal(await client.readModule(a.PolicyModule, 'readSpent24hUsd'), 10000000000n);

  // With zero remaining swap cap, a legitimate vault withdrawal must still execute.
  config[0].targetBps = 3000;
  config[2].targetBps = 4000;
  const beforeWithdraw = await snapshot();
  const exhaustedPolicy = await client.readPolicyConfig(a.PolicyModule, session.address, universe, BigInt(beforeWithdraw.blockNumber));
  assert.equal(exhaustedPolicy.remainingCapUsd, '0');
  const withdrawalPlan = computeRebalancePlan(beforeWithdraw, exhaustedPolicy, a.MockRouter, a.MockUSDC);
  assert.deepEqual(withdrawalPlan.steps.map(s => s.action), ['VAULT_WITHDRAW']);
  const withdrawal = await executor.execute(withdrawalPlan);
  assert.equal(withdrawal.status, 'COMPLETED', JSON.stringify(withdrawal));
  const afterWithdraw = await snapshot();
  assert.ok(BigInt(afterWithdraw.positions[0].rawBalance) > BigInt(after.positions[0].rawBalance));
  assert.ok(BigInt(afterWithdraw.positions[2].vaultShares!) < BigInt(after.positions[2].vaultShares!));
  assert.equal(await client.readModule(a.PolicyModule, 'readSpent24hUsd'), 10000000000n);
  assert.ok(afterWithdraw.positions.every(p => Math.abs(p.currentBps - p.targetBps) <= 500));

  // Prepare a still-valid plan, then revoke: executor must surface the true custom error without a fake hash.
  config[0].targetBps = 4000;
  config[2].targetBps = 3000;
  const pendingSnapshot = await snapshot();
  const pendingPlan = computeRebalancePlan(pendingSnapshot, exhaustedPolicy, a.MockRouter, a.MockUSDC);
  assert.equal(pendingPlan.status, 'READY');
  const safeAbi = parseAbi([
    'function isOwner(address owner) view returns (bool)',
    'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool success)',
  ]);
  assert.equal(await client.publicClient.readContract({ address: a.Safe, abi: safeAbi,
    functionName: 'isOwner', args: [owner.address] }), true);
  const ownerWallet = createWalletClient({ account: owner, chain: foundry, transport: http(rpc) });
  const tx = client.buildRevokeSessionTransaction(a.PolicyModule, session.address);
  const signature = ('0x' + owner.address.slice(2).padStart(64, '0') + '0'.repeat(64) + '01') as `0x${string}`;
  const zero = '0x0000000000000000000000000000000000000000';
  const hash = await ownerWallet.writeContract({ address: a.Safe, abi: safeAbi, functionName: 'execTransaction',
    args: [tx.to, 0n, tx.data, 0, 0n, 0n, 0n, zero, zero, signature] });
  assert.equal((await client.publicClient.waitForTransactionReceipt({ hash })).status, 'success');
  const rejected = await executor.execute(pendingPlan);
  assert.equal(rejected.status, 'FAILED');
  assert.equal(rejected.steps[0].status, 'PREFLIGHT_REJECTED');
  assert.equal(rejected.steps[0].error?.code, ErrorCode.ERR_SESSION_REVOKED);
  assert.equal(rejected.steps[0].hash, undefined);
  const final = await snapshot();
  assert.deepEqual(final.positions.map(p => p.rawBalance), pendingSnapshot.positions.map(p => p.rawBalance));
  const report = { environment: 'local', chainId: 31337, simulatedYield: true, verdict: 'PASS',
    verifiedAt: new Date().toISOString(), before, policy, plan, execution, after,
    withdrawalPlan, withdrawal, afterWithdraw, ownerRevokeHash: hash, rejected, final };
  await mkdir(new URL('../../../.runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../../../.runtime/agent-integration.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: live portfolio → planner → signed session tx → Safe/module swap + deposit + withdraw; dedup and revoke verified.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
