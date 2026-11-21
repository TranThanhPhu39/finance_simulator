# Triển khai và Xác minh trên Avalanche Fuji Testnet

Ngày cập nhật: 2026-11-21 (Asia/Saigon).

Hệ thống hợp đồng (`Safe`, `PolicyModule`, `MockUSDC`, `MockTokenA`, `MockPriceOracle`, `MockRouter`, `MockVault4626`) đã được triển khai và xác minh thành công trên **Avalanche Fuji Testnet (`Chain ID: 43113`)** qua script `contracts/script/DeployFuji.s.sol`. Toàn bộ 19 giao dịch khởi tạo, cấu hình whitelist, cấp quyền session và nạp tài sản mẫu đã được xác nhận on-chain tại blocks `61425068` – `61425069` và lưu đầy đủ trong [`deployments/fuji.json`](../deployments/fuji.json).

## 1. Địa chỉ Hợp đồng trên Avalanche Fuji (`Chain ID: 43113`)

| Thành phần | Địa chỉ | Snowtrace Testnet |
| --- | --- | --- |
| **Safe Smart Account (`SafeProxy`)** | `0x920BF449f2dB2f36a1101C50E18074F94988963B` | https://testnet.snowtrace.io/address/0x920BF449f2dB2f36a1101C50E18074F94988963B |
| **PolicyModule v0.1** | `0x61eaabCa8D14Cf80b8d0FbA84031dcfd0a7cf55a` | https://testnet.snowtrace.io/address/0x61eaabCa8D14Cf80b8d0FbA84031dcfd0a7cf55a |
| **Safe Singleton v1.4.1** | `0x22F19E8e980EB8457573974A55a48bc8125BDAcD` | https://testnet.snowtrace.io/address/0x22F19E8e980EB8457573974A55a48bc8125BDAcD |
| **MockUSDC (6 decimals)** | `0x072b540f6cd86a1e22fd8cf068869b2844a88A80` | https://testnet.snowtrace.io/address/0x072b540f6cd86a1e22fd8cf068869b2844a88A80 |
| **MockTokenA (`sAVAX-MOCK`, 18 decimals)** | `0x27f5C7241d1CcB935037a382Fbad26506C2c19b3` | https://testnet.snowtrace.io/address/0x27f5C7241d1CcB935037a382Fbad26506C2c19b3 |
| **MockPriceOracle** | `0xbD3928067440B4c181D03900d777e26228798ca4` | https://testnet.snowtrace.io/address/0xbD3928067440B4c181D03900d777e26228798ca4 |
| **MockRouter** | `0x8cEA45c064b8aDC8534968e7d0e6C0AdCc19f438` | https://testnet.snowtrace.io/address/0x8cEA45c064b8aDC8534968e7d0e6C0AdCc19f438 |
| **MockVault4626 (`vUSDC`, 5% APY)** | `0xa1EeFb44Ec2F6c4Ec6A88f9CAC5C791BC446DACB` | https://testnet.snowtrace.io/address/0xa1EeFb44Ec2F6c4Ec6A88f9CAC5C791BC446DACB |
| **Deployer / Safe Owner** | `0xBb2FEBd51B210BC75db7a31D31A183365C4c42cb` | https://testnet.snowtrace.io/address/0xBb2FEBd51B210BC75db7a31D31A183365C4c42cb |
| **Authorized Session Key (Agent)** | `0x6BC23f3f0c6911F642Ab02eB26A7535AC9Ec0C4D` | https://testnet.snowtrace.io/address/0x6BC23f3f0c6911F642Ab02eB26A7535AC9Ec0C4D |

## 2. Giao dịch Khởi tạo & Cấu hình đã Xác minh trên Fuji

- Deploy `SafeProxy`: [`0x4923d64bb3c0194ef84157c87f7b2aa604d9b313e67387261eb7155d87e979f0`](https://testnet.snowtrace.io/tx/0x4923d64bb3c0194ef84157c87f7b2aa604d9b313e67387261eb7155d87e979f0)
- Deploy `PolicyModule`: [`0x1cbdda6f97ff08c0d1eb386061c6d673b615d3828ce112854ad61e1bef421bc7`](https://testnet.snowtrace.io/tx/0x1cbdda6f97ff08c0d1eb386061c6d673b615d3828ce112854ad61e1bef421bc7)
- Safe Owner `enableModule`: [`0x08121d7656dcb390c5d2d8b9587d971f7625cbe5a5b231b3073d55cd7e8294af`](https://testnet.snowtrace.io/tx/0x08121d7656dcb390c5d2d8b9587d971f7625cbe5a5b231b3073d55cd7e8294af)
- Safe Owner `grantSession`: [`0x7b963ba5ec4aa34f670ebb5f9832cea1bdbf9afe53a9d613a74c574d5de3184b`](https://testnet.snowtrace.io/tx/0x7b963ba5ec4aa34f670ebb5f9832cea1bdbf9afe53a9d613a74c574d5de3184b)
- Mint `600 USDC` & `40 sAVAX-MOCK` vào Safe: [`0xc0032267418cd071f21f65dc115a1d0db0a84feaf0ae7a060cf4f697edbfa859`](https://testnet.snowtrace.io/tx/0xc0032267418cd071f21f65dc115a1d0db0a84feaf0ae7a060cf4f697edbfa859) & [`0x36009c16555f8a60f3c249da1f8835c22632178862eb6b43bbde61385fad2542`](https://testnet.snowtrace.io/tx/0x36009c16555f8a60f3c249da1f8835c22632178862eb6b43bbde61385fad2542)

## 3. Lệnh triển khai lại khi cần

```powershell
$env:FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc"
cd contracts
forge script script/DeployFuji.s.sol:DeployFuji --rpc-url $env:FUJI_RPC_URL --broadcast --non-interactive
cd ..
Remove-Item Env:FUJI_DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue
```

Mọi token, oracle, router và vault được deploy là mock thử nghiệm (`MockERC20`, `MockPriceOracle`, `MockRouter`, `MockVault4626`), không đại diện tài sản hay lợi suất thật. Khóa riêng và `.env` được giữ ngoài Git.
