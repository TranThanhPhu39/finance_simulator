import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeErrorResult, parseAbi, type Hex } from 'viem';
import { ErrorCode, type VaultWithdrawStep } from '@repo/shared';
import { PolicyClient, POLICY_ABI, decodePolicyErrorDetails } from '../src';

const ADDRESS = '0x1000000000000000000000000000000000000001';
test('raw nested errors decode from structured RPC data, preserving target/reason', () => {
  const error = encodeErrorResult({ abi: POLICY_ABI, errorName: 'CapExceeded', args: [90n, 20n, 100n] });
  const decoded = decodePolicyErrorDetails({ cause: { error: { data: error } } });
  assert.equal(decoded.code, ErrorCode.ERR_CAP_EXCEEDED);
  assert.deepEqual(decoded.args, [90n, 20n, 100n]);
  const nested = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['Router: Simulated failure'] });
  const outer = encodeErrorResult({ abi: POLICY_ABI, errorName: 'ExecutionFailed', args: [ADDRESS, nested] });
  const result = decodePolicyErrorDetails({ raw: outer });
  assert.equal(result.code, ErrorCode.ERR_ROUTER_FAILED);
  assert.equal(result.name, 'ExecutionFailed');
  assert.equal(result.nested?.name, 'Error');
});

test('unknown/RPC messages are never mistaken for policy evidence', () => {
  assert.equal(decodePolicyErrorDetails(Error('RPC unavailable: CapExceeded')).code, ErrorCode.ERR_RPC_OR_ENV);
  assert.equal(decodePolicyErrorDetails({ data: '0xdeadbeef' }).code, ErrorCode.ERR_RPC_OR_ENV);
  assert.equal(decodePolicyErrorDetails({}).code, ErrorCode.ERR_RPC_OR_ENV);
});

test('Safe GS104 and new policy errors map to distinct codes', () => {
  const gs104 = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['GS104'] });
  assert.equal(decodePolicyErrorDetails(gs104).code, ErrorCode.ERR_MODULE_DISABLED);
  for (const [name, code] of [['Paused', ErrorCode.ERR_PAUSED], ['SpendHistoryFull', ErrorCode.ERR_HISTORY_FULL],
    ['SessionRevoked', ErrorCode.ERR_SESSION_REVOKED], ['UnauthorizedSession', ErrorCode.ERR_UNAUTHORIZED_SESSION]]) {
    const data = encodeErrorResult({ abi: POLICY_ABI, errorName: name });
    assert.equal(decodePolicyErrorDetails({ data }).code, code);
  }
});

test('withdraw builder encodes exact-assets and maxShares independently', () => {
  const client = new PolicyClient('local', 'http://127.0.0.1:1');
  const step: VaultWithdrawStep = { action: 'VAULT_WITHDRAW', stepIndex: 0, targetContract: ADDRESS,
    tokenOut: ADDRESS, assets: '123', maxShares: '456', deadline: 1800000060, estimatedValueUsd: '100' };
  const transaction = client.buildStepTransaction(ADDRESS, step, ADDRESS);
  const decoded = decodeFunctionData({ abi: POLICY_ABI, data: transaction.data as Hex });
  assert.equal(decoded.functionName, 'executeVaultWithdraw');
  const request = decoded.args?.[0] as Record<string, unknown>;
  assert.equal(request.assets, 123n);
  assert.equal(request.maxShares, 456n);
  assert.equal(request.recipient, ADDRESS);
  assert.throws(() => client.buildStepTransaction(ADDRESS, { ...step, assets: '0' }, ADDRESS), /positive raw integer/);
});

test('fresh vault bounds only tighten an approved plan, never weaken it', async () => {
  const client = new PolicyClient('local', 'http://127.0.0.1:1');
  client.ensureNetwork = async () => {};
  Object.defineProperty(client.publicClient, 'getBlockNumber', { value: async () => 1n });
  Object.defineProperty(client.publicClient, 'readContract', { value: async ({ functionName }: { functionName: string }) =>
    functionName === 'asset' ? ADDRESS : 200n });
  Object.defineProperty(client, 'readModule', { value: async (_module: string, name: string) =>
    name === 'safe' ? ADDRESS : { cap24hUsd: 100n, maxPriceAgeSec: 3600, maxSlippageBps: 100 } });
  const base = { stepIndex: 0, targetContract: ADDRESS, estimatedValueUsd: '1', deadline: 1800000060 };
  const deposit = await client.prepareStep(ADDRESS, { ...base, action: 'VAULT_DEPOSIT', tokenIn: ADDRESS,
    assets: '100', minShares: '100' }, ADDRESS);
  assert.equal((decodeFunctionData({ abi: POLICY_ABI, data: deposit.data }).args?.[0] as { minShares: bigint }).minShares, 198n);
  const withdraw = await client.prepareStep(ADDRESS, { ...base, action: 'VAULT_WITHDRAW', tokenOut: ADDRESS,
    assets: '100', maxShares: '1000' }, ADDRESS);
  assert.equal((decodeFunctionData({ abi: POLICY_ABI, data: withdraw.data }).args?.[0] as { maxShares: bigint }).maxShares, 204n);
  const tighter = await client.prepareStep(ADDRESS, { ...base, action: 'VAULT_WITHDRAW', tokenOut: ADDRESS,
    assets: '100', maxShares: '100' }, ADDRESS);
  assert.equal((decodeFunctionData({ abi: POLICY_ABI, data: tighter.data }).args?.[0] as { maxShares: bigint }).maxShares, 100n);
});
