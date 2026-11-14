import { createPublicClient, createWalletClient, http, parseAbi, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji, foundry } from 'viem/chains';
import { ErrorCode, NetworkEnv } from '@repo/shared';

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);

const VAULT_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)'
]);

const ORACLE_ABI = parseAbi([
  'function getPrice(address token) view returns (uint256 price, uint256 updatedAt)'
]);

export class ChainClient {
  public publicClient;
  public walletClient;
  public env: NetworkEnv;

  constructor(env: NetworkEnv, rpcUrl: string, sessionPrivateKey?: `0x${string}`) {
    this.env = env;
    const chain = env === 'local' ? foundry : avalancheFuji;

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    if (sessionPrivateKey) {
      const account = privateKeyToAccount(sessionPrivateKey);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl)
      });
    }
  }

  async readTokenBalance(tokenAddress: Address, owner: Address): Promise<bigint> {
    return await this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner]
    });
  }

  async readVaultPosition(vaultAddress: Address, owner: Address): Promise<{ shares: bigint; assets: bigint }> {
    const shares = await this.publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'balanceOf',
      args: [owner]
    });

    const assets = shares > 0n
      ? await this.publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'convertToAssets',
          args: [shares]
        })
      : 0n;

    return { shares, assets };
  }

  async readPriceUsd(oracleAddress: Address, tokenAddress: Address): Promise<{ price: bigint; updatedAt: bigint }> {
    const [price, updatedAt] = await this.publicClient.readContract({
      address: oracleAddress,
      abi: ORACLE_ABI,
      functionName: 'getPrice',
      args: [tokenAddress]
    });
    return { price, updatedAt };
  }

  decodePolicyError(error: any): ErrorCode {
    const msg = String(error?.message || error);
    if (msg.includes('CapExceeded')) return ErrorCode.ERR_CAP_EXCEEDED;
    if (msg.includes('TokenNotWhitelisted')) return ErrorCode.ERR_UNAUTHORIZED_TOKEN;
    if (msg.includes('VaultNotWhitelisted')) return ErrorCode.ERR_UNAUTHORIZED_VAULT;
    if (msg.includes('RouterNotWhitelisted')) return ErrorCode.ERR_UNAUTHORIZED_ROUTER;
    if (msg.includes('InvalidRecipient')) return ErrorCode.ERR_INVALID_RECIPIENT;
    if (msg.includes('SessionExpired')) return ErrorCode.ERR_SESSION_EXPIRED;
    if (msg.includes('SessionRevoked')) return ErrorCode.ERR_SESSION_REVOKED;
    if (msg.includes('SlippageExceeded') || msg.includes('Insufficient output')) return ErrorCode.ERR_SLIPPAGE_TOO_HIGH;
    if (msg.includes('StalePrice')) return ErrorCode.ERR_STALE_PRICE;
    if (msg.includes('Router: Simulated failure')) return ErrorCode.ERR_ROUTER_FAILED;
    return ErrorCode.ERR_RPC_OR_ENV;
  }
}
