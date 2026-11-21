import { ErrorCode, type ScenarioDefinition } from '@repo/shared';

export const SCENARIO_CATALOG: ScenarioDefinition[] = [
  {
    id: 'SC-01',
    name: 'Tái cân bằng hợp lệ + gửi stablecoin vào Vault',
    description: 'Agent tính toán kế hoạch tái cân bằng hợp lệ trong hạn mức 24h: bán 10 token A (100 USD) sang USDC và gửi 499 USDC vào Vault sinh lời.',
    category: 'NORMAL',
    actionSource: 'AGENT_RULE',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.OK,
    stepsDescription: [
      'Đọc snapshot danh mục (600 USDC, 40 Token A giá 10 USD, 0 vUSDC) và chính sách PolicyModule.',
      'Thực thi SWAP_EXACT_IN bán 10 Token A (100 USD) nhận về USDC trong biên độ slippage 1%.',
      'Thực thi VAULT_DEPOSIT gửi 499 USDC khả dụng (sau khi giữ reserve 200 USDC) vào Vault ERC-4626.'
    ]
  },
  {
    id: 'SC-02',
    name: 'Giao dịch đơn vượt Cap 24h',
    description: 'Gửi một lệnh swap đầu vào 150 USD vượt quá hạn mức 24h cho phép (100 USD). Hợp đồng phải từ chối và bảo toàn số dư.',
    category: 'CAP',
    actionSource: 'HARNESS_MUTATED',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_CAP_EXCEEDED,
    stepsDescription: [
      'Test harness nâng khối lượng lệnh SWAP_EXACT_IN của Token A lên 15 Token A (150 USD > Cap 100 USD).',
      'Gửi lệnh qua PolicyModule.executeSwap.',
      'PolicyModule chặn với lỗi CapExceeded; số dư Safe và bộ đếm chi tiêu 24h giữ nguyên ở 0 USD.'
    ]
  },
  {
    id: 'SC-03',
    name: 'Chia nhỏ nhiều lệnh (60 + 30 + 20 USD vượt cap 100 USD)',
    description: 'Session gửi liên tiếp 3 lệnh swap 60 USD, 30 USD và 20 USD trong cùng cửa sổ 24h. Hai lệnh đầu thành công (tổng 90 USD), lệnh thứ 3 bị chặn.',
    category: 'CAP',
    actionSource: 'DIRECT_SESSION_CALL',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_CAP_EXCEEDED,
    stepsDescription: [
      'Lệnh 1: Session swap 60 USDC sang Token A (60 USD <= 100 USD) -> Thành công, đã dùng 60 USD.',
      'Lệnh 2: Session swap 30 USDC sang Token A (60 + 30 = 90 USD <= 100 USD) -> Thành công, đã dùng 90 USD.',
      'Lệnh 3: Session swap 20 USDC sang Token A (90 + 20 = 110 USD > 100 USD) -> Bị chặn với CapExceeded, tổng chi tiêu giữ đúng 90 USD.'
    ]
  },
  {
    id: 'SC-04',
    name: 'Dùng token ngoài whitelist',
    description: 'Thử swap sang một token lạ chưa được Safe owner cấp phép trong allowedTokens.',
    category: 'WHITELIST',
    actionSource: 'HARNESS_MUTATED',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_UNAUTHORIZED_TOKEN,
    stepsDescription: [
      'Test harness thay đổi tokenOut của bước swap thành địa chỉ token ngoài whitelist (0x2000...0099).',
      'Gửi lệnh executeSwap qua PolicyModule.',
      'PolicyModule từ chối với lỗi TokenNotWhitelisted; tài sản và hạn mức của Safe không đổi.'
    ]
  },
  {
    id: 'SC-05',
    name: 'Dùng router ngoài whitelist',
    description: 'Thử định tuyến lệnh swap qua một hợp đồng DEX Router lạ chưa được Safe owner đưa vào allowedRouters.',
    category: 'WHITELIST',
    actionSource: 'HARNESS_MUTATED',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_UNAUTHORIZED_ROUTER,
    stepsDescription: [
      'Test harness sửa targetContract của lệnh swap sang địa chỉ router không nằm trong whitelist (0x3000...0099).',
      'Gửi lệnh executeSwap qua PolicyModule.',
      'PolicyModule chặn ngay với lỗi RouterNotWhitelisted trước khi cấp token allowance.'
    ]
  },
  {
    id: 'SC-06',
    name: 'Dùng vault ngoài whitelist',
    description: 'Thử gửi USDC của quỹ vào một hợp đồng ERC-4626 Vault chưa được duyệt trong vaultAssets.',
    category: 'WHITELIST',
    actionSource: 'HARNESS_MUTATED',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_UNAUTHORIZED_VAULT,
    stepsDescription: [
      'Test harness sửa targetContract của lệnh VAULT_DEPOSIT sang địa chỉ vault ngoài whitelist (0x4000...0099).',
      'Gửi lệnh executeVaultDeposit qua PolicyModule.',
      'PolicyModule từ chối với lỗi VaultNotWhitelisted; USDC không bị chuyển đi.'
    ]
  },
  {
    id: 'SC-07',
    name: 'Chuyển token tới ví lạ ngoài Safe',
    description: 'Session key thử chỉ định recipient của lệnh swap là một địa chỉ ví ngoài thay vì địa chỉ Safe.',
    category: 'WHITELIST',
    actionSource: 'DIRECT_SESSION_CALL',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_INVALID_RECIPIENT,
    stepsDescription: [
      'Session key gọi trực tiếp executeSwap với recipient là ví lạ (0x9999...9999).',
      'PolicyModule kiểm tra recipient == safe và revert ngay với InvalidRecipient.',
      'Xác nhận số dư ví lạ bằng 0 và số dư Safe không thay đổi.'
    ]
  },
  {
    id: 'SC-08',
    name: 'Session Key đã bị thu hồi (Kill-Switch)',
    description: 'Safe owner đã thu hồi quyền của session key; mọi giao dịch tiếp theo từ session key đó phải bị từ chối.',
    category: 'SESSION',
    actionSource: 'DIRECT_SESSION_CALL',
    supportedEnvs: ['local', 'fuji'],
    expectedErrorCode: ErrorCode.ERR_SESSION_REVOKED,
    stepsDescription: [
      'Safe owner kích hoạt revokeSession(sessionKey) (isRevoked = true).',
      'Session key thử gửi lệnh executeSwap 50 USDC.',
      'PolicyModule chặn ngay tại modifier authorized với lỗi SessionRevoked.'
    ]
  },
  {
    id: 'SC-09',
    name: 'Giá Oracle quá hạn',
    description: 'Dữ liệu giá từ Oracle có độ trễ vượt quá maxPriceAgeSec (3600 giây) cho phép của chính sách.',
    category: 'PRICE',
    actionSource: 'HARNESS_MUTATED',
    supportedEnvs: ['local'],
    expectedErrorCode: ErrorCode.ERR_STALE_PRICE,
    stepsDescription: [
      'Giá Oracle có timestamp cũ hơn 3601 giây so với block.timestamp hiện tại (maxPriceAgeSec = 3600).',
      'Gửi lệnh executeSwap 50 USDC qua PolicyModule.',
      'PolicyModule từ chối với lỗi StalePrice; không có giao dịch nào được thực thi.'
    ]
  },
  {
    id: 'SC-10',
    name: 'Router thất bại giữa chừng',
    description: 'DEX Router gặp lỗi revert trong lúc thực thi swap; toàn bộ trạng thái số dư, allowance và bộ đếm chi tiêu 24h phải được rollback nguyên vẹn.',
    category: 'EXECUTION',
    actionSource: 'HARNESS_MUTATED',
    supportedEnvs: ['local'],
    expectedErrorCode: ErrorCode.ERR_ROUTER_FAILED,
    stepsDescription: [
      'Cấu hình MockRouter ở trạng thái shouldFail = true ("Router: Simulated failure").',
      'Gửi lệnh executeSwap 50 USDC hợp lệ qua PolicyModule.',
      'Giao dịch revert và rollback hoàn toàn: số dư Safe giữ nguyên, bộ đếm chi tiêu 24h vẫn bằng 0 USD.'
    ]
  }
];

export function listScenarios(): ScenarioDefinition[] {
  return SCENARIO_CATALOG.map(s => ({
    ...s,
    supportedEnvs: [...s.supportedEnvs],
    stepsDescription: [...s.stepsDescription]
  }));
}

export function getScenarioById(scenarioId: string): ScenarioDefinition | undefined {
  const found = SCENARIO_CATALOG.find(s => s.id.toUpperCase() === scenarioId.toUpperCase());
  return found ? { ...found, supportedEnvs: [...found.supportedEnvs], stepsDescription: [...found.stepsDescription] } : undefined;
}
