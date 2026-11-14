import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Only unlocked Anvil test accounts on a loopback RPC; never handles a private key.
const rpcUrl = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(rpcUrl).hostname)) {
  throw new Error('Smoke test is local-only.');
}
const cast = process.env.CAST_BIN || 'cast';
const calldata = (signature, ...args) => execFileSync(cast,
  ['calldata', signature, ...args.map(String)], { encoding: 'utf8', windowsHide: true }).trim();
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}
assert.equal(await rpc('eth_chainId'), '0x7a69');
const { addresses: a } = JSON.parse(await readFile(new URL('../deployments/local.json', import.meta.url), 'utf8'));
const [owner, session, outsider] = await rpc('eth_accounts');
assert.ok(owner && session && outsider, 'Need three unlocked Anvil accounts.');
const callUint = async (target, data) => BigInt(await rpc('eth_call', [{ to: target, data }, 'latest']));
const balance = (token, account) => callUint(token, calldata('balanceOf(address)', account));
const used = () => callUint(a.PolicyModule, calldata('readSpent24hUsd()'));
const transactions = [];
async function send(label, from, to, data, expectSuccess = true, revertSignature) {
  if (!expectSuccess) {
    assert.ok(revertSignature, 'Expected-revert scenario needs its exact error signature.');
    const selector = execFileSync(cast, ['sig', revertSignature],
      { encoding: 'utf8', windowsHide: true }).trim().toLowerCase();
    let reverted = false;
    try { await rpc('eth_call', [{ from, to, data }, 'latest']); }
    catch (error) {
      assert.ok(error.message.toLowerCase().includes(selector), `Wrong preflight error for ${label}: ${error.message}`);
      reverted = true;
    }
    assert.ok(reverted, `Expected preflight to reject ${label}`);
  }
  const hash = await rpc('eth_sendTransaction', [{ from, to, data, gas: '0x7a1200' }]);
  let receipt;
  for (let attempt = 0; attempt < 50; ++attempt) {
    receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(receipt, 'Receipt timeout');
  assert.equal(receipt.status, expectSuccess ? '0x1' : '0x0', label);
  transactions.push({ label, hash, status: receipt.status,
    ...(revertSignature ? { expectedRevert: revertSignature } : {}), blockNumber: Number(BigInt(receipt.blockNumber)) });
}
const now = BigInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp);
const deadline = now + 3600n;
const swap = (amount, recipient = a.Safe) => calldata(
  'executeSwap((address,address,address,uint256,uint256,address,uint256))',
  `(${a.MockRouter},${a.MockUSDC},${a.MockTokenA},${amount},${amount * 100000000000n * 99n / 100n},${recipient},${deadline})`);
assert.equal(await used(), 0n, 'Run this against a fresh deployment.');
const before = { usdc: await balance(a.MockUSDC, a.Safe), tokenA: await balance(a.MockTokenA, a.Safe) };
await send('valid swap', session, a.PolicyModule, swap(50000000n));
assert.equal(await balance(a.MockUSDC, a.Safe), before.usdc - 50000000n);
assert.equal(await balance(a.MockTokenA, a.Safe), before.tokenA + 5000000000000000000n);
assert.equal(await used(), 5000000000n);
await send('over cumulative cap', session, a.PolicyModule, swap(60000000n), false, 'CapExceeded(uint256,uint256,uint256)');
await send('foreign recipient', session, a.PolicyModule, swap(10000000n, outsider), false, 'InvalidRecipient()');
assert.equal(await balance(a.MockTokenA, outsider), 0n);
assert.equal(await balance(a.MockUSDC, a.Safe), before.usdc - 50000000n);
assert.equal(await used(), 5000000000n);
await send('vault deposit', session, a.PolicyModule, calldata(
  'executeVaultDeposit((address,uint256,uint256,address,uint256))',
  `(${a.MockVault4626},100000000,100000000,${a.Safe},${deadline})`));
assert.equal(await balance(a.MockVault4626, a.Safe), 100000000n);
await send('vault withdraw', session, a.PolicyModule, calldata(
  'executeVaultWithdraw((address,uint256,uint256,address,uint256))',
  `(${a.MockVault4626},20000000,20000000,${a.Safe},${deadline})`));
// Real local blocks advance time, so the mock can accrue yield between the two txs.
const remainingShares = await balance(a.MockVault4626, a.Safe);
assert.ok(remainingShares >= 80000000n && remainingShares < 100000000n,
  'Withdraw must burn >0 and <=20 USDC worth of original shares.');
assert.equal(await balance(a.MockUSDC, a.Safe), before.usdc - 130000000n);
assert.equal(await callUint(a.MockUSDC, calldata('allowance(address,address)', a.Safe, a.MockRouter)), 0n);
assert.equal(await callUint(a.MockUSDC, calldata('allowance(address,address)', a.Safe, a.MockVault4626)), 0n);

// Safe's prevalidated signature is valid only because the owner is the sender of this signed local tx.
const revoke = calldata('revokeSession(address)', session);
const ownerSignature = '0x' + owner.slice(2).padStart(64, '0') + '0'.repeat(64) + '01';
const zero = '0x' + '0'.repeat(40);
await send('owner revokes session through Safe', owner, a.Safe, calldata(
  'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
  a.PolicyModule, 0, revoke, 0, 0, 0, 0, zero, zero, ownerSignature));
await send('revoked session rejected', session, a.PolicyModule, swap(10000000n), false, 'SessionRevoked()');
assert.equal(await used(), 5000000000n);
const after = { usdc: await balance(a.MockUSDC, a.Safe), tokenA: await balance(a.MockTokenA, a.Safe),
  vaultShares: await balance(a.MockVault4626, a.Safe), spent24hUsd: await used() };
const report = { environment: 'local', chainId: 31337, simulatedYield: true,
  verifiedAt: new Date().toISOString(), verdict: 'PASS', before, after, transactions };
await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
await writeFile(new URL('../.runtime/contract-smoke.json', import.meta.url),
  JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
console.log(`PASS: ${transactions.length} mined transactions; balances, cap, vault shares and allowances verified.`);
