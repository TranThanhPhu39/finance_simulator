import type { AssetPosition, PolicyConfig, PortfolioSnapshot } from '@repo/shared';
export const SAFE = '0x1000000000000000000000000000000000000001';
export const SESSION = '0x1000000000000000000000000000000000000002';
export const USDC = '0x2000000000000000000000000000000000000001';
export const TOKEN = '0x2000000000000000000000000000000000000002';
export const ROUTER = '0x3000000000000000000000000000000000000001';
export const VAULT = '0x4000000000000000000000000000000000000001';

export function fixture(raw = [600000000n, 40000000000000000000n, 0n], targets = [2000, 3000, 5000]) {
  const positions: AssetPosition[] = [
    { tokenAddress: USDC, symbol: 'USDC', decimals: 6, rawBalance: raw[0].toString(), priceUsd: '100000000',
      valueUsd: (raw[0] * 100n).toString(), currentBps: 0, targetBps: targets[0], isVaultPosition: false },
    { tokenAddress: TOKEN, symbol: 'A', decimals: 18, rawBalance: raw[1].toString(), priceUsd: '1000000000',
      valueUsd: (raw[1] / 1000000000n).toString(), currentBps: 0, targetBps: targets[1], isVaultPosition: false },
    { tokenAddress: USDC, vaultAddress: VAULT, symbol: 'vUSDC', decimals: 6, rawBalance: raw[2].toString(),
      priceUsd: '100000000', valueUsd: (raw[2] * 100n).toString(), currentBps: 0, targetBps: targets[2],
      isVaultPosition: true, vaultShares: raw[2].toString(), vaultConversion: { assets: '1000000', shares: '1000000' } },
  ];
  const total = positions.reduce((sum, p) => sum + BigInt(p.valueUsd), 0n);
  positions.forEach(p => { p.currentBps = total ? Number(BigInt(p.valueUsd) * 10000n / total) : 0; });
  const snapshot: PortfolioSnapshot = { accountAddress: SAFE, network: 'local', blockNumber: 1,
    timestamp: 1800000000, totalValueUsd: total.toString(), positions };
  const policy: PolicyConfig = { accountAddress: SAFE, network: 'local', sessionKey: SESSION,
    sessionExpiresAt: snapshot.timestamp + 86400, isRevoked: false, cap24hUsd: '10000000000',
    remainingCapUsd: '10000000000', maxSlippageBps: 100, maxPriceAgeSec: 3600,
    whitelistedTokens: [USDC, TOKEN], whitelistedVaults: [VAULT], whitelistedRouters: [ROUTER],
    allowedRecipient: SAFE, capScope: 'SWAP_INPUT_ONLY' };
  return { snapshot, policy };
}
