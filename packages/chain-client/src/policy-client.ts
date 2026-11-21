import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from 'viem';
import type { PolicyConfig, TradeStep } from '@repo/shared';
import { ChainClient } from './client';
import { POLICY_ABI } from './policy-abi';

const VAULT = parseAbi([
  'function asset() view returns (address)',
  'function convertToShares(uint256 assets) view returns (uint256)',
]);
export interface PolicyUniverse { tokens: Address[]; routers: Address[]; vaults: Address[] }
export interface ModuleTransaction { to: Address; data: Hex }
interface Limits { cap24hUsd: bigint; maxPriceAgeSec: number; maxSlippageBps: number }
interface Session { expiresAt: bigint; revoked: boolean }
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const amount = (raw: string) => {
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error('Amount must be a positive raw integer.');
  return BigInt(raw);
};

/** Read/write adapter for PolicyModule v0.1. All writes target the module, never the router/vault. */
export class PolicyClient extends ChainClient {
  buildGrantSessionTransaction(module: Address, key: Address, expiresAt: bigint): ModuleTransaction {
    return { to: getAddress(module), data: encodeFunctionData({ abi: POLICY_ABI,
      functionName: 'grantSession', args: [getAddress(key), expiresAt] }) };
  }

  buildRevokeSessionTransaction(module: Address, key: Address): ModuleTransaction {
    return { to: getAddress(module), data: encodeFunctionData({ abi: POLICY_ABI,
      functionName: 'revokeSession', args: [getAddress(key)] }) };
  }

  async ensureNetwork(): Promise<void> {
    const expected = this.env === 'local' ? 31337 : 43113;
    if (await this.publicClient.getChainId() !== expected) throw new Error(`RPC chain must be ${expected}.`);
  }

  async readModule<T>(module: Address, functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
    return await this.publicClient.readContract({ address: module, abi: POLICY_ABI, functionName, args, blockNumber }) as T;
  }

  async readPolicyConfig(module: Address, sessionKey: Address, universe: PolicyUniverse, blockNumber?: bigint): Promise<PolicyConfig> {
    await this.ensureNetwork();
    const block = blockNumber ?? await this.publicClient.getBlockNumber();
    const [safe, limits, session, remaining, paused] = await Promise.all([
      this.readModule<Address>(module, 'safe', [], block),
      this.readModule<Limits>(module, 'readPolicy', [], block),
      this.readModule<Session>(module, 'readSession', [sessionKey], block),
      this.readModule<bigint>(module, 'readRemainingCap', [], block),
      this.readModule<boolean>(module, 'paused', [], block),
    ]);
    const tokens = await Promise.all(universe.tokens.map(async token =>
      await this.readModule<boolean>(module, 'allowedTokens', [token], block) ? token : undefined));
    const routers = await Promise.all(universe.routers.map(async router =>
      await this.readModule<boolean>(module, 'allowedRouters', [router], block) ? router : undefined));
    const vaults = await Promise.all(universe.vaults.map(async vault => {
      const asset = await this.readModule<Address>(module, 'vaultAssets', [vault], block);
      return asset !== '0x0000000000000000000000000000000000000000' ? vault : undefined;
    }));
    return { accountAddress: safe, network: this.env, sessionKey,
      sessionExpiresAt: Number(session.expiresAt), isRevoked: session.revoked,
      cap24hUsd: limits.cap24hUsd.toString(), remainingCapUsd: remaining.toString(),
      maxSlippageBps: limits.maxSlippageBps, maxPriceAgeSec: limits.maxPriceAgeSec,
      whitelistedTokens: tokens.filter((a): a is Address => a !== undefined),
      whitelistedRouters: routers.filter((a): a is Address => a !== undefined),
      whitelistedVaults: vaults.filter((a): a is Address => a !== undefined),
      allowedRecipient: safe, paused, capScope: 'SWAP_INPUT_ONLY' };
  }

  buildStepTransaction(module: Address, step: TradeStep, recipient: Address): ModuleTransaction {
    const to = getAddress(module);
    const target = getAddress(step.targetContract);
    const safe = getAddress(recipient);
    if (!Number.isSafeInteger(step.deadline) || step.deadline <= 0) throw new Error('Invalid deadline.');
    const deadline = BigInt(step.deadline);
    switch (step.action) {
      case 'SWAP_EXACT_IN': return { to, data: encodeFunctionData({ abi: POLICY_ABI, functionName: 'executeSwap', args: [{
        router: target, tokenIn: getAddress(step.tokenIn), tokenOut: getAddress(step.tokenOut),
        amountIn: amount(step.amountIn), minAmountOut: amount(step.minAmountOut), recipient: safe, deadline,
      }] }) };
      case 'VAULT_DEPOSIT': return { to, data: encodeFunctionData({ abi: POLICY_ABI, functionName: 'executeVaultDeposit', args: [{
        vault: target, assets: amount(step.assets), minShares: amount(step.minShares), recipient: safe, deadline,
      }] }) };
      case 'VAULT_WITHDRAW': return { to, data: encodeFunctionData({ abi: POLICY_ABI, functionName: 'executeVaultWithdraw', args: [{
        vault: target, assets: amount(step.assets), maxShares: amount(step.maxShares), recipient: safe, deadline,
      }] }) };
      default: throw new Error('Unsupported action.');
    }
  }

  async prepareStep(module: Address, step: TradeStep, recipient: Address): Promise<ModuleTransaction> {
    await this.ensureNetwork();
    const blockNumber = await this.publicClient.getBlockNumber();
    const safe = await this.readModule<Address>(module, 'safe', [], blockNumber);
    if (safe.toLowerCase() !== recipient.toLowerCase()) throw new Error('Plan account differs from module Safe.');
    if (step.action === 'SWAP_EXACT_IN') return this.buildStepTransaction(module, step, recipient);
    const vault = getAddress(step.targetContract);
    const [asset, reference, limits] = await Promise.all([
      this.publicClient.readContract({ address: vault, abi: VAULT, functionName: 'asset', blockNumber }),
      this.publicClient.readContract({ address: vault, abi: VAULT, functionName: 'convertToShares', args: [amount(step.assets)], blockNumber }),
      this.readModule<Limits>(module, 'readPolicy', [], blockNumber),
    ]);
    const plannedAsset = step.action === 'VAULT_DEPOSIT' ? step.tokenIn : step.tokenOut;
    if (asset.toLowerCase() !== plannedAsset.toLowerCase()) throw new Error('Vault underlying differs from plan.');
    // Tightening protects both policy and the approved plan; never silently weaken a user's bound.
    if (step.action === 'VAULT_DEPOSIT') {
      const minimum = ceil(reference * BigInt(10000 - limits.maxSlippageBps), 10000n);
      return this.buildStepTransaction(module, { ...step,
        minShares: (amount(step.minShares) > minimum ? amount(step.minShares) : minimum).toString() }, recipient);
    }
    const maximum = ceil((reference + 1n) * BigInt(10000 + limits.maxSlippageBps), 10000n);
    return this.buildStepTransaction(module, { ...step,
      maxShares: (amount(step.maxShares) < maximum ? amount(step.maxShares) : maximum).toString() }, recipient);
  }

  async simulateTransaction(transaction: ModuleTransaction): Promise<void> {
    const account = this.walletClient?.account;
    if (!account) throw new Error('Session signer is required.');
    await this.publicClient.call({ account, to: transaction.to, data: transaction.data });
  }

  async submitTransaction(transaction: ModuleTransaction): Promise<Hex> {
    const wallet = this.walletClient;
    if (!wallet?.account) throw new Error('Session signer is required.');
    return wallet.sendTransaction({ account: wallet.account, chain: wallet.chain,
      to: transaction.to, data: transaction.data, value: 0n });
  }
}
