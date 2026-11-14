# Hợp đồng Treasury Agent Lab

Phần của Phú: Safe v1.4.1 + PolicyModule v0.1, session/whitelist/cap/giá/approve, swap và ERC-4626 deposit/withdraw. Chỉ dùng tài sản thử nghiệm; chưa kiểm toán và chưa xác minh trên Fuji.

## Build và kiểm thử

Cần Foundry (`forge`, `cast`, `anvil`) trong PATH. Repo đã chứa mã nguồn thư viện, không cần `forge install`. Compiler 0.8.31 được Foundry tải nếu thiếu. EVM target Paris, không yêu cầu opcode Osaka.

```powershell
cd contracts
forge build --sizes
forge test -vv
forge fmt --check src/PolicyModule.sol src/interfaces src/libraries test/fixtures test/unit test/integration test/fuzz test/invariant script/DeployLocal.s.sol script/DeployFuji.s.sol
cd ..
node scripts/export-abi.mjs
```

Windows hiện tại có Foundry ở `$env:USERPROFILE\.foundry\bin`. Có thể thêm vào PATH trong terminal:

```powershell
$env:PATH = "$env:USERPROFILE\.foundry\bin;$env:PATH"
```

Bộ test dùng Safe singleton/proxy thật, owner ký Safe transactions, mock token/router/oracle/vault ở `packages/testkit/contracts`. Các mục `Counter` là ví dụ cũ được giữ nguyên, không thuộc PolicyModule.

## Chạy một deployment local

Terminal 1:

```powershell
anvil --host 127.0.0.1 --port 8545 --silent
```

Terminal 2, bắt đầu ở repo root:

```powershell
# Mnemonic công khai mặc định của Anvil, CHỈ dùng test local.
$env:DEPLOYER_PRIVATE_KEY = (cast wallet private-key "test test test test test test test test test test test junk" 0).Trim()
$env:SESSION_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
$env:LOCAL_RPC_URL = "http://127.0.0.1:8545"
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url $env:LOCAL_RPC_URL --broadcast --non-interactive
cd ..
Remove-Item Env:DEPLOYER_PRIVATE_KEY
node scripts/record-local-deployment.mjs
node scripts/smoke-contracts.mjs
```

DeployLocal từ chối chain khác 31337, tạo Safe threshold 1, token USDC 6 decimals/token A 18 decimals, oracle, router, vault, module; whitelist/grant session bằng owner-signed Safe transactions. Seed 600 USDC + 40 token A giá 10 USD, tổng 1.000 USD mock. Cap 100 USD, slippage 1%, max price age 1 giờ, session 7 ngày.

Recorder chỉ tạo `deployments/local.json` khi tất cả 19 receipt thành công, payload thực khớp sender/nonce/target/value/input và có code ở các địa chỉ deploy. Địa chỉ local không đưa vào Git vì thay đổi sau reset.

Smoke dùng unlocked accounts của Anvil, không đọc khóa riêng: gửi 7 giao dịch và xác minh receipt + trạng thái. Lệnh bị chặn còn được kiểm tra đúng custom error qua preflight. Report ở `.runtime/contract-smoke.json`. Smoke tiêu thụ cap và thu hồi session, nên cần deployment mới trước mỗi lần chạy, không chạy trên ví/danh mục đang sử dụng.

Smoke chỉ dành cho Anvil local; các lệnh gọi sai do script chủ động tạo, không phải prompt injection. Sau khi dừng Anvil, report là bằng chứng lịch sử local, không phải trạng thái mạng đang hoạt động.

## Bàn giao

Để chạy agent thật trên deployment local mới, thay bước smoke bằng `pnpm agent:integration` từ repo root sau khi `pnpm install --frozen-lockfile`. Hai bài đều dùng cap và revoke session, nên không chạy nối tiếp trên cùng deployment. `pnpm typecheck` và `pnpm test` kiểm tra phần TypeScript.

Script Fuji đã build; xem [hướng dẫn Fuji](../docs/fuji-deployment.md) để cấu hình ví thử nghiệm riêng. Chưa có broadcast Fuji được xác minh.

- [Policy spec](../docs/policy-spec.md)
- [Threat model](../docs/threat-model.md)
- [Interface và điểm cần tích hợp](../docs/contract-handoff.md)
- [Kết quả kiểm chứng](../docs/contract-validation.md)
- ABI: `packages/chain-client/src/abi/PolicyModule.json`, xuất lại sau khi thay ABI.

Module quản trị chỉ qua Safe; owner gọi trực tiếp module bị chặn. Swap cap không áp cho vault actions. Withdraw là exact underlying assets + maxShares. Xem tài liệu bàn giao trước khi nối schema/planner/executor.
