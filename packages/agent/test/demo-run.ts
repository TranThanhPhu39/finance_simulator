import { PortfolioSnapshot, PolicyConfig } from '@repo/shared';
import { computeRebalancePlan, generateExplanation } from '../src';

async function main() {
  // Giả lập danh mục 1000 USD đang bị lệch: sAVAX tăng lên 45% (mục tiêu 30%), USDC giảm còn 45% (mục tiêu 60%)
  const mockSnapshot: PortfolioSnapshot = {
    accountAddress: '0x1111111111111111111111111111111111111111',
    network: 'local',
    blockNumber: 100,
    timestamp: Math.floor(Date.now() / 1000),
    totalValueUsd: '100000000000', // $1,000 (8 decimals)
    positions: [
      {
        tokenAddress: '0x0000000000000000000000000000000000000001',
        symbol: 'USDC',
        decimals: 6,
        rawBalance: '450000000',
        priceUsd: '100000000',
        valueUsd: '45000000000', // $450
        currentBps: 4500,        // 45%
        targetBps: 6000,         // Mục tiêu 60% -> Thiếu 15%
        isVaultPosition: false
      },
      {
        tokenAddress: '0x0000000000000000000000000000000000000002',
        symbol: 'sAVAX',
        decimals: 18,
        rawBalance: '18000000000000000000',
        priceUsd: '2500000000',
        valueUsd: '45000000000', // $450
        currentBps: 4500,        // 45%
        targetBps: 3000,         // Mục tiêu 30% -> Thừa 15% ($150)
        isVaultPosition: false
      },
      {
        tokenAddress: '0x0000000000000000000000000000000000000003',
        symbol: 'tBOND',
        decimals: 18,
        rawBalance: '10000000000000000000',
        priceUsd: '1000000000',
        valueUsd: '10000000000', // $100
        currentBps: 1000,        // 10%
        targetBps: 1000,         // Mục tiêu 10% -> Chuẩn
        isVaultPosition: false
      }
    ]
  };

  // Giới hạn Cap 24h chỉ còn $100 (ít hơn số thừa $150 -> Agent phải tự cắt giảm lệnh cho vừa Cap)
  const mockPolicy: PolicyConfig = {
    accountAddress: '0x1111111111111111111111111111111111111111',
    network: 'local',
    sessionKey: '0x2222222222222222222222222222222222222222',
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    isRevoked: false,
    cap24hUsd: '10000000000',
    remainingCapUsd: '10000000000', // Còn $100
    maxSlippageBps: 50,
    maxPriceAgeSec: 3600,
    whitelistedTokens: [],
    whitelistedVaults: [],
    whitelistedRouters: [],
    allowedRecipient: '0x1111111111111111111111111111111111111111'
  };

  const plan = computeRebalancePlan(
    mockSnapshot,
    mockPolicy,
    '0x9999999999999999999999999999999999999999',
    '0x0000000000000000000000000000000000000001'
  );
  const explanation = await generateExplanation(mockSnapshot, plan);

  console.log('=== KẾT QUẢ CHẠY THỬ AGENT ===');
  console.log('Trạng thái:', plan.status);
  console.log('Tái cân bằng một phần (do Cap):', plan.isPartial);
  console.log('Giải thích:', explanation);
  console.log('Chi tiết lệnh:', JSON.stringify(plan.steps, null, 2));
}

main();
