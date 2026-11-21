import type { Address } from 'viem';
import { getAddress, parseAbi } from 'viem';
import { PolicyClient } from '@repo/chain-client';
import type { AssetPosition, PortfolioSnapshot } from '@repo/shared';

export interface PositionConfig { tokenAddress: Address; symbol: string; targetBps: number; vaultAddress?: Address }
const META = parseAbi(['function decimals() view returns (uint8)']);
const VAULT = parseAbi(['function asset() view returns (address)', 'function convertToShares(uint256 assets) view returns (uint256)']);

/** Every balance, conversion and price is read at ONE block. Does not invent principal/yield. */
export async function readPortfolioSnapshot(client: PolicyClient, account: Address, oracle: Address,
  config: PositionConfig[], maxPriceAgeSec: number): Promise<PortfolioSnapshot> {
  await client.ensureNetwork();
  const block = await client.publicClient.getBlock();
  const blockNumber = block.number;
  if (blockNumber === null) throw new Error('Pending block is not a confirmed snapshot.');
  const positions: AssetPosition[] = await Promise.all(config.map(async p => {
    const token = getAddress(p.tokenAddress);
    const [decimals, price] = await Promise.all([
      client.publicClient.readContract({ address: token, abi: META, functionName: 'decimals', blockNumber }),
      client.readPriceUsd(oracle, token, blockNumber),
    ]);
    if (decimals > 18 || price.price <= 0n || price.updatedAt <= 0n || price.updatedAt > block.timestamp
      || block.timestamp - price.updatedAt > BigInt(maxPriceAgeSec)) throw new Error(`Invalid/stale snapshot price for ${token}`);
    const unit = 10n ** BigInt(decimals);
    let raw: bigint;
    let extra: Partial<AssetPosition> = {};
    if (p.vaultAddress) {
      const vault = getAddress(p.vaultAddress);
      const [asset, position, quotedShares] = await Promise.all([
        client.publicClient.readContract({ address: vault, abi: VAULT, functionName: 'asset', blockNumber }),
        client.readVaultPosition(vault, account, blockNumber),
        client.publicClient.readContract({ address: vault, abi: VAULT, functionName: 'convertToShares', args: [unit], blockNumber }),
      ]);
      if (asset.toLowerCase() !== token.toLowerCase()) throw new Error('Configured vault underlying mismatch.');
      raw = position.assets;
      extra = { vaultAddress: vault, vaultShares: position.shares.toString(),
        vaultConversion: { assets: unit.toString(), shares: quotedShares.toString() } };
    } else raw = await client.readTokenBalance(token, account, blockNumber);
    return { tokenAddress: token, symbol: p.symbol, decimals, rawBalance: raw.toString(),
      priceUsd: price.price.toString(), valueUsd: (raw * price.price / unit).toString(),
      currentBps: 0, targetBps: p.targetBps, isVaultPosition: !!p.vaultAddress, ...extra };
  }));
  const total = positions.reduce((sum, p) => sum + BigInt(p.valueUsd), 0n);
  for (const p of positions) p.currentBps = total === 0n ? 0 : Number(BigInt(p.valueUsd) * 10000n / total);
  return { accountAddress: account, network: client.env, blockNumber: Number(blockNumber),
    timestamp: Number(block.timestamp), totalValueUsd: total.toString(), positions };
}
