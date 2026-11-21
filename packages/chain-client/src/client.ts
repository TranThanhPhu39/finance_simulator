import { createPublicClient, createWalletClient, http, parseAbi, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji, foundry } from 'viem/chains';
import { ErrorCode, NetworkEnv } from '@repo/shared';
import { decodePolicyErrorDetails } from './errors';

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

  async readTokenBalance(tokenAddress: Address, owner: Address, blockNumber?: bigint): Promise<bigint> {
    return await this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner], blockNumber
    });
  }

  async readVaultPosition(vaultAddress: Address, owner: Address, blockNumber?: bigint): Promise<{ shares: bigint; assets: bigint }> {
    const shares = await this.publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'balanceOf',
      args: [owner], blockNumber
    });

    const assets = shares > 0n
      ? await this.publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'convertToAssets',
          args: [shares], blockNumber
        })
      : 0n;

    return { shares, assets };
  }

  async readPriceUsd(oracleAddress: Address, tokenAddress: Address, blockNumber?: bigint): Promise<{ price: bigint; updatedAt: bigint }> {
    const [price, updatedAt] = await this.publicClient.readContract({
      address: oracleAddress,
      abi: ORACLE_ABI,
      functionName: 'getPrice',
      args: [tokenAddress], blockNumber
    });
    return { price, updatedAt };
  }

  decodePolicyError(error: unknown): ErrorCode {
    return decodePolicyErrorDetails(error).code;
  }
}
