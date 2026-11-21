# Hợp nhất dashboard và lab Anvil

Cập nhật 2026-11-21 (Asia/Saigon). Hợp nhất main (2dd4055, dashboard/Launchpad) với feat/hoang-lab-dashboard (f29443f, lab Anvil/SQLite). Cả hai lịch sử commit được giữ.

## Hai chế độ trên cùng ứng dụng

| Chế độ | Giao diện | Thực thi và bằng chứng | Lưu dữ liệu |
| --- | --- | --- | --- |
| Mô phỏng & Launchpad (mặc định) | Giữ 4 màn hình trên main, Pyth, đăng ký agent, Paper Trade/Graduation/Slash | SIMULATED_POLICY; không tạo txHash hoặc yêu cầu ví gửi giao dịch; Proof-of-Action là hash dữ liệu mô phỏng | .runtime/treasury-lab.sqlite (giữ đường dẫn DB cũ) |
| On-chain Anvil (/?mode=onchain) | Quỹ/chính sách, lab, lịch sử/bằng chứng | Giao dịch thực trên chain 31337; 17 scenarios, receipt, custom error preflight, before/after/allowance/cap, owner ký qua Safe | .runtime/treasury.db; chain leases, durable queue, idempotency, quarantine |

API chung lắng nghe loopback 8787, Vite 5173 proxy /api. Các route mô phỏng/Launchpad chuyển sang /api/simulation/*; API Anvil giữ /api/*. Origin/Host checks áp dụng trước khi dispatch cả hai chế độ. Đổi policy hoặc thu hồi session trong mô phỏng không tác động Safe thật. API mô phỏng từ chối executionMode=ONCHAIN_RPC; dùng chế độ Anvil để có bằng chứng chain. Scenario SC-xx thuộc hai catalog khác nhau; luôn đọc kèm chế độ/version.

Các type on-chain có prefix Onchain (OnchainRunResult, OnchainScenarioDefinition, OnchainAssertionResult, OnchainRunStatus) để không trùng các type mô phỏng trên main. Runner mô phỏng export runSimulationScenario/runSimulationSuite/listSimulationScenarios; runner Anvil giữ runScenario/listScenarios. CSS Anvil giới hạn trong .onchain-app để giữ Tailwind và bố cục Launchpad.

## Chạy và kiểm chứng

Dùng Node 24+, Corepack/pnpm 10.11.0, Foundry nếu chạy Anvil. Xem README.md và demo-guide.md. Chỉ dùng một API instance cho mỗi Anvil. Mô phỏng/Launchpad hoạt động khi không có node Anvil; API on-chain báo môi trường chưa sẵn sàng. Không dùng hai chế độ với cùng một file SQLite vì schema khác nhau. Không xóa DB lịch sử khi cập nhật.

SIMULATION_DATABASE_PATH ghi đè DB mô phỏng (tương thích SQLITE_DB_PATH cũ); API_DATABASE_PATH ghi đè DB Anvil. Không chạy trực tiếp entry cũ src/index.ts để mở thêm API; dùng api:dev (src/main.ts).

PYTH_OFFLINE=1 dùng giá fallback có nhãn để CI/browser tests tái hiện được; ứng dụng thông thường vẫn gọi Pyth như main. Các thao tác đăng ký, bond và slash ở Launchpad hiện là mô phỏng, chưa phải đăng ký ERC-8004 hay giao dịch token thật trên Fuji.

Đã kiểm chứng local sau hợp nhất: typecheck, 39/39 TS tests (gồm 10 scenario mô phỏng), 17/17 scenario Anvil/API restart/export/owner signing, 3/3 Playwright flows trên desktop/mobile. Browser test thêm kiểm tra Launchpad đăng ký → GRADUATED → SLASHED, suite mô phỏng/export và không có eth_sendTransaction trong mô phỏng. Ảnh đã xem ở .runtime/screenshots; CI lưu artifacts. Production build được kiểm tra với Tailwind và hai dashboard.

Fuji vẫn chưa triển khai. Các scenario reset/time-travel của Anvil không dùng cho Fuji và trả UNSUPPORTED.

Bằng chứng CI bản hợp nhất commit 2fca6ed: [Lab/API/dashboard SUCCESS](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44878242076) và [Contracts/live agent SUCCESS](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44878242164). Cả hai workflow đã hoàn tất trước khi cập nhật main. Commit tài liệu tiếp theo chỉ ghi lại bằng chứng này.
