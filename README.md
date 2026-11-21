# Treasury Agent Lab — Policy-Bound AI Treasury & StockAgent Launchpad on Avalanche

> **"AI quản lý quỹ, nhưng không bao giờ vượt quyền — và mọi giới hạn đều có bằng chứng kiểm chứng on-chain trên Avalanche."**

Repository này là hệ thống toàn trình kết hợp giữa:
- **Topic 12 — Policy-Bound AI Treasury & On-Chain Verification Lab**: Quỹ tài sản trên **Safe Smart Account (v1.4.1)** được bảo vệ bởi hợp đồng **`PolicyModule.sol`** (giới hạn Session Key, Rolling 24h Spend Cap, Token/Router/ERC-4626 Vault Whitelist, Recipient khóa chặt về Safe, Slippage & Oracle Staleness Check, và Emergency Kill-Switch), đi kèm **Phòng kiểm thử 10 kịch bản chuẩn (`SC-01` → `SC-10`)** với bằng chứng số dư trước/sau và xuất báo cáo JSON/CSV.
- **Topic 16 — StockAgent Launchpad (Verifiable Paper-Trading & Bonded Graduation)**: Vườn ươm định lượng cho phép đăng ký AI Agent theo chuẩn định danh **ERC-8004** kèm khoản thế chấp **USDC Bond**, định giá thời gian thực qua **Pyth Network Hermes API** (`AAPL/USD`, `AVAX/USD`, `USDC/USD`), chạy phiên Paper Trading với đồng hồ tua nhanh (**Accelerated Clock**), ký nhật ký kiểm toán **Proof-of-Action (`keccak256`)**, tự động xét tốt nghiệp (**`GRADUATED`** khi `Compliance = 100%`, `Sharpe ≥ 1.50`, `Max Drawdown ≤ 10%`) hoặc tịch thu Bond (**`SLASHED`**) ngay khi vi phạm chính sách.

---

## 1. Tổng quan Kiến trúc

```text
Owner Wallet (MetaMask / Core / Simulated Owner)
  │
  ├── grantSession / revokeSession (Kill-Switch) / setPolicy ──> Safe v1.4.1 & PolicyModule.sol
  │
Web Dashboard (React 19 + Vite + Tailwind v4 — 4 Màn hình)
  │
  ▼
REST API + SQLite Persistence (apps/api — Node 24 native node:sqlite)
  │
  ├──► AI Rebalancer (@repo/agent)
  │      ├── Deterministic Rule-Engine Sizing (SWAP_INPUT_ONLY rolling cap, pivot reserve, ERC-4626 quotes)
  │      └── LLM Explanation (giải thích số liệu thực tiếng Việt, có deterministic fallback)
  │
  ├──► Policy Verification Lab (@repo/lab — 10 Scenarios SC-01..SC-10)
  │      ├── ONCHAIN_RPC Adapter (Anvil Local 31337 / Avalanche Fuji 43113 qua @repo/chain-client)
  │      ├── SIMULATED_POLICY Adapter (BigInt exact mirror của PolicyModule.sol, không sinh fake txHash)
  │      └── Assertions & Evidence Exporter (JSON / CSV)
  │
  └──► Topic 16 StockAgent Launchpad (@repo/lab/launchpad)
         ├── Pyth Hermes Live Price Client (AAPL/USD, AVAX/USD, USDC/USD + resilient fallback)
         ├── ERC-8004 Agent Registry & USDC Bond Manager
         └── Accelerated Paper-Trading Engine + keccak256 Proof-of-Action Audit Log
```

---

## 2. Cấu trúc Monorepo

| Thư mục / Package | Vai trò & Nội dung chính | Phụ trách |
| --- | --- | --- |
| `contracts/` | `PolicyModule.sol`, `RollingSpend.sol` (256-entry ring buffer 24h), `IPolicyModule.sol`, script deploy Local/Fuji và 65 Solidity tests (Unit, Vault, Adversarial, Fuzz, Invariant) với Safe v1.4.1 thật | Phú |
| `packages/shared/` | Schema TypeScript v0.2 dùng chung (`PolicyConfig`, `PortfolioSnapshot`, `RebalancePlan`, `ScenarioDefinition`, `RunResult`, `RegisteredAgent`, `PaperTradeAction`, 26 mã `ErrorCode`) và bộ JSON fixtures mẫu | Cả nhóm |
| `packages/testkit/` | Bộ hợp đồng Solidity mô phỏng: `MockERC20.sol`, `MockPriceOracle.sol`, `MockRouter.sol`, `MockVault4626.sol` (sinh lãi theo thời gian chuẩn ERC-4626) | Tiến |
| `packages/chain-client/` | `ChainClient` & `PolicyClient` (`viem`): đọc trạng thái tại cùng một block, đóng gói calldata cho `PolicyModule`, preflight simulation, gửi giao dịch và giải mã nested custom errors (`decodePolicyErrorDetails`) | Tiến + Phú |
| `packages/agent/` | `readPortfolioSnapshot`, thuật toán `computeRebalancePlan`, `PlanExecutor` (chống gửi trùng `planId` + fingerprint) và `generateExplanation` | Tiến + Phú |
| `packages/lab/` | Danh mục 10 kịch bản kiểm thử (`SC-01` → `SC-10`), `policy-simulator.ts`, `onchain-adapter.ts`, bộ kiểm tra `assertions.ts`, xuất báo cáo `evidence.ts` (JSON/CSV), cùng `pyth-client.ts` và `paper-trading.ts` (Topic 16) | Hoàng |
| `apps/api/` | HTTP REST Server (port `3001`) + cơ sở dữ liệu SQLite (`runs`, `run_steps`, `assertions`, `transaction_evidence`, `launchpad_agents`, `launchpad_actions`) và `executionLock` tuần tự | Hoàng |
| `apps/web/` | Ứng dụng Web Dashboard 4 màn hình (port `5173`): **1. Quỹ & Chính sách**, **2. Phòng Kiểm Thử**, **3. Bằng Chứng & Lịch Sử**, **4. StockAgent Launchpad** | Hoàng |
| `docs/` | Đặc tả kỹ thuật: [policy-spec.md](docs/policy-spec.md), [threat-model.md](docs/threat-model.md), [interfaces.md](docs/interfaces.md), [contract-handoff.md](docs/contract-handoff.md), [contract-validation.md](docs/contract-validation.md), [fuji-deployment.md](docs/fuji-deployment.md) | Cả nhóm |

---

## 3. Hướng dẫn Cài đặt, Chạy Kiểm thử & Khởi động Ứng dụng

### Yêu cầu môi trường
- **Node.js**: `>= 22.5.0` (khuyến nghị **Node `v24.x`** để sử dụng trực tiếp module SQLite tích hợp sẵn `node:sqlite` không cần cài C++ build tools).
- **Package Manager**: `pnpm` (có thể bật qua `corepack enable`).
- **Foundry (`forge`, `anvil`)**: Dùng khi build và chạy bộ kiểm thử Solidity trong `contracts/`.

### Bước 1: Cài đặt dependencies & Kiểm tra Typecheck / Unit Tests
```bash
pnpm install
pnpm typecheck
pnpm test
pnpm run web:build
```

Để chạy bộ kiểm thử hợp đồng thông minh Solidity (65 tests):
```bash
cd contracts
forge test -vv
```

### Bước 2: Khởi chạy đồng thời Backend API (port 3001) & Web Dashboard (port 5173)
Mở 2 cửa sổ terminal tại thư mục gốc của repo:

**Terminal 1 — Khởi chạy API & SQLite Server (`http://localhost:3001`):**
```bash
pnpm run api:dev
```

**Terminal 2 — Khởi chạy Web Dashboard (`http://localhost:5173`):**
```bash
pnpm run web:dev
```

Sau đó mở trình duyệt tại **`http://localhost:5173`** để trải nghiệm trực tiếp cả 4 màn hình:
1. **1. Quỹ & Chính Sách**: Xem KPI quỹ, thanh hạn mức Swap 24h, bấm **Preview Rebalance** / **Run Rebalance**, chỉnh sửa Policy, hoặc bấm nút đỏ **Emergency Kill-Switch** để thu hồi Session Key ngay lập tức.
2. **2. Phòng Kiểm Thử**: Bấm **Chạy Toàn Bộ 10 Tình Huống (Run Full Suite)** hoặc lọc và chạy từng kịch bản (`SC-01` đến `SC-10`).
3. **3. Bằng Chứng & Lịch Sử**: Xem lịch sử lưu bền vững trong SQLite, kiểm tra từng điều kiện **Assertions**, bảng **Đối chiếu số dư Trước/Sau (`BalanceDiff`)**, và tải báo cáo thật qua **Export JSON** / **Export CSV**.
4. **4. StockAgent Launchpad (Topic 16)**: Xem giá Pyth Network thời gian thực (`AAPL/USD`, `AVAX/USD`, `USDC/USD`), đăng ký AI Agent mới cấp mã **ERC-8004**, bấm **Paper Trade** để tạo mã băm `keccak256` Proof-of-Action và xét tốt nghiệp `GRADUATED`, hoặc bấm **Slash** để kiểm chứng cơ chế phạt 100% USDC Bond khi vi phạm PolicyModule.

---

## 4. Kết quả Kiểm thử Hiện tại (Verification Evidence)

| Phân hệ Kiểm thử | Số lượng Tests | Trạng thái | Nội dung kiểm chứng |
| --- | --- | --- | --- |
| **Solidity Smart Contracts** (`contracts/test/`) | **65 / 65 PASS** | ✅ 100% PASS | 36 Unit tests (`PolicyModuleTest`), 13 ERC-4626 Vault integration tests (`VaultTest`), 8 Adversarial attack tests (`AdversarialTest`), 4 Fuzz suites × 256 runs (`PolicyFuzzTest`), 2 Invariant suites × 64 runs × depth 32 (`PolicyInvariantTest`), 2 Counter tests. Đã kiểm chứng trên GitHub Actions CI run `43613122263`. |
| **TypeScript Workspace** (`agent`, `chain-client`, `lab`, `api`) | **30 / 30 PASS** | ✅ 100% PASS | 9 tests thuật toán `rebalancer.test.ts`, 8 tests `executor.test.ts` (deduplication, preflight, timeout), 5 tests `policy-client.test.ts` (ABI decoding, exact-assets bounds), 7 tests `lab.test.ts` (10 scenarios `SC-01..SC-10`, JSON/CSV export, Pyth Hermes feeds, Paper Trading `keccak256` Proof-of-Action, Graduation & Slashing), 1 integration test toàn trình `api.test.ts`. |
| **Web Production Build** (`apps/web`) | **Vite Build** | ✅ PASS | Biên dịch sạch toàn bộ React 19 + TypeScript + Tailwind CSS v4 (`tsc --noEmit` & `vite build`). |

---

## 5. Địa chỉ Triển khai trên Avalanche Fuji Testnet (`deployments/fuji.json`)

> **Lưu ý minh bạch:** Script triển khai [`contracts/script/DeployFuji.s.sol`](contracts/script/DeployFuji.s.sol) và hướng dẫn chi tiết tại [`docs/fuji-deployment.md`](docs/fuji-deployment.md) đã sẵn sàng cho mạng **Avalanche Fuji (`chainId: 43113`)**. Bảng dưới đây là vị trí lưu metadata khi thực hiện broadcast bằng ví testnet có nạp AVAX thử nghiệm (tuyệt đối không điền địa chỉ hoặc txHash giả khi chưa broadcast):

| Hợp đồng / Thành phần | Mạng | Chain ID | Địa chỉ Triển khai (`deployments/fuji.json`) | Ghi chú |
| --- | --- | --- | --- | --- |
| **Safe Singleton v1.4.1** | Avalanche Fuji | `43113` | `TBD (Cập nhật từ deployments/fuji.json sau khi broadcast)` | Triển khai qua `DeployFuji.s.sol` |
| **SafeProxy (Treasury Account)** | Avalanche Fuji | `43113` | `TBD (Cập nhật từ deployments/fuji.json sau khi broadcast)` | Smart Account giữ tài sản quỹ |
| **PolicyModule v0.1** | Avalanche Fuji | `43113` | `TBD (Cập nhật từ deployments/fuji.json sau khi broadcast)` | Hợp đồng kiểm soát Session & Rolling 24h Cap |
| **MockPriceOracle** | Avalanche Fuji | `43113` | `TBD (Cập nhật từ deployments/fuji.json sau khi broadcast)` | Nguồn giá 8 decimals USD |
| **MockRouter** | Avalanche Fuji | `43113` | `TBD (Cập nhật từ deployments/fuji.json sau khi broadcast)` | Router exact-input trong whitelist |
| **MockVault4626 (vUSDC)** | Avalanche Fuji | `43113` | `TBD (Cập nhật từ deployments/fuji.json sau khi broadcast)` | Vault sinh lời chuẩn ERC-4626 |
