import { createPublicClient, http, parseAbi } from 'viem';
import { avalanche } from 'viem/chains';
import type { PythPriceFeed } from '@repo/shared';

export const PYTH_FEEDS = {
  'AAPL/USD': {
    symbol: 'AAPL/USD',
    feedId: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
    fallbackPriceUsd: '22850000000' // $228.50 (8 decimals)
  },
  'AVAX/USD': {
    symbol: 'AVAX/USD',
    feedId: '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
    fallbackPriceUsd: '2500000000' // $25.00 (8 decimals)
  },
  'USDC/USD': {
    symbol: 'USDC/USD',
    feedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    fallbackPriceUsd: '100000000' // $1.00 (8 decimals)
  }
} as const;

export type SupportedPythSymbol = keyof typeof PYTH_FEEDS;

const AVALANCHE_PYTH_CONTRACT = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6' as const;
const PYTH_ORACLE_ABI = parseAbi([
  'function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))'
]);

function normalizePythPriceTo8Decimals(rawPrice: string | bigint, expo: number): string {
  const value = BigInt(rawPrice);
  const shift = 8 + expo;
  if (shift >= 0) {
    return (value * 10n ** BigInt(shift)).toString();
  }
  return (value / 10n ** BigInt(-shift)).toString();
}

export function getFallbackPythFeeds(symbols?: SupportedPythSymbol[]): PythPriceFeed[] {
  const list = symbols && symbols.length > 0 ? symbols : (Object.keys(PYTH_FEEDS) as SupportedPythSymbol[]);
  const now = Math.floor(Date.now() / 1000);
  return list.map(sym => {
    const item = PYTH_FEEDS[sym];
    return {
      symbol: item.symbol,
      feedId: item.feedId,
      priceUsd: item.fallbackPriceUsd,
      publishTime: now,
      source: 'fallback'
    };
  });
}

async function fetchPythOnchainAvalancheFeeds(
  list: SupportedPythSymbol[],
  timeoutMs: number
): Promise<PythPriceFeed[] | null> {
  try {
    const client = createPublicClient({
      chain: avalanche,
      transport: http('https://api.avax.network/ext/bc/C/rpc', { timeout: timeoutMs })
    });

    const results = await Promise.all(
      list.map(async (sym): Promise<PythPriceFeed | null> => {
        const cfg = PYTH_FEEDS[sym];
        const data = await client.readContract({
          address: AVALANCHE_PYTH_CONTRACT,
          abi: PYTH_ORACLE_ABI,
          functionName: 'getPriceUnsafe',
          args: [cfg.feedId]
        });
        const scaled = normalizePythPriceTo8Decimals(data.price, Number(data.expo));
        if (BigInt(scaled) <= 0n) return null;
        return {
          symbol: cfg.symbol,
          feedId: cfg.feedId,
          priceUsd: scaled,
          publishTime: Number(data.publishTime),
          source: 'pyth-hermes'
        };
      })
    );

    const valid = results.filter((r): r is PythPriceFeed => r !== null);
    if (valid.length === list.length) {
      return valid;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchPythPriceFeeds(
  symbols?: SupportedPythSymbol[],
  timeoutMs = 8000
): Promise<PythPriceFeed[]> {
  const list = symbols && symbols.length > 0 ? symbols : (Object.keys(PYTH_FEEDS) as SupportedPythSymbol[]);
  const queryParams = list.map(sym => `ids[]=${encodeURIComponent(PYTH_FEEDS[sym].feedId)}`).join('&');
  const url = `https://hermes.pyth.network/v2/updates/price/latest?${queryParams}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.PYTH_API_KEY) {
      headers.Authorization = `Bearer ${process.env.PYTH_API_KEY}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        parsed?: Array<{
          id: string;
          price?: { price: string; expo: number; publish_time: number };
        }>;
      };

      if (Array.isArray(payload.parsed) && payload.parsed.length > 0) {
        const byId = new Map<string, { price: string; expo: number; publish_time: number }>();
        for (const entry of payload.parsed) {
          if (entry.id && entry.price) {
            const cleanId = entry.id.startsWith('0x') ? entry.id.toLowerCase() : `0x${entry.id.toLowerCase()}`;
            byId.set(cleanId, entry.price);
          }
        }

        const now = Math.floor(Date.now() / 1000);
        return list.map(sym => {
          const cfg = PYTH_FEEDS[sym];
          const match = byId.get(cfg.feedId.toLowerCase());
          if (!match) {
            return {
              symbol: cfg.symbol,
              feedId: cfg.feedId,
              priceUsd: cfg.fallbackPriceUsd,
              publishTime: now,
              source: 'fallback'
            };
          }
          const scaled = normalizePythPriceTo8Decimals(match.price, match.expo);
          return {
            symbol: cfg.symbol,
            feedId: cfg.feedId,
            priceUsd: BigInt(scaled) > 0n ? scaled : cfg.fallbackPriceUsd,
            publishTime: match.publish_time || now,
            source: 'pyth-hermes'
          };
        });
      }
    }

    // If Hermes REST requires a subscription token (HTTP 401), query Pyth Oracle contract directly on Avalanche C-Chain
    const onchainFeeds = await fetchPythOnchainAvalancheFeeds(list, timeoutMs);
    if (onchainFeeds) {
      return onchainFeeds;
    }

    return getFallbackPythFeeds(list);
  } catch {
    const onchainFeeds = await fetchPythOnchainAvalancheFeeds(list, timeoutMs);
    if (onchainFeeds) {
      return onchainFeeds;
    }
    return getFallbackPythFeeds(list);
  } finally {
    clearTimeout(timer);
  }
}
