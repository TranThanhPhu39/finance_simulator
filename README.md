# Treasury Agent Lab

AI agent quản lý quỹ sinh lời trên Avalanche (stablecoin cho vay, sAVAX, trái phiếu token hóa) với quyền bị giới hạn on-chain, kết hợp phòng kiểm thử kiểm chứng PolicyModule bằng trạng thái tài sản trước/sau.

> AI quản lý quỹ, nhưng không bao giờ vượt quyền — và mọi giới hạn đều có bằng chứng on-chain trên Avalanche.

Repo đã có PolicyModule/Safe, agent/chain-client và phần lab/API/dashboard chạy local. Phòng kiểm thử có 17 scenarios, queue/SQLite, JSON/CSV và dashboard ba màn hình. Luồng Fuji chưa được triển khai xác minh.

- Đọc [project_context.md](project_context.md) để nắm mục tiêu, phạm vi, kiến trúc, cây thư mục đầy đủ và trách nhiệm từng thành viên.
- Mở [task.md](task.md) để nhận việc, theo dõi tiến độ và ghi nhật ký sau mỗi phiên code.

```text
contracts/             Phú: Safe, PolicyModule, kiểm thử bảo mật
packages/shared/       Cả nhóm: schema, mã lỗi, dữ liệu mẫu
packages/chain-client/ Tiến: đọc/gửi giao dịch và receipt
packages/testkit/      Tiến: token/giá/router/vault mô phỏng, deploy/seed/reset
packages/agent/        Tiến: thuật toán rebalance và giải thích
packages/lab/          Hoàng: scenario runner, assertions, evidence
apps/api/              Hoàng: API, worker, SQLite
apps/web/              Hoàng: dashboard ba màn hình
deployments/           Metadata triển khai thực tế
scripts/               Script điều phối và kiểm tra xuyên suốt
docs/                  Đặc tả, threat model, hướng dẫn demo
.github/workflows/     CI khi đã cấu hình toolchain
```

Phân công theo tin nhắn mới nhất; điểm khác với file đính kèm được ghi trong project_context.md. Thư mục rỗng chứa `.gitkeep` để giữ cấu trúc trên Git.

Hướng dẫn build/test/deploy hợp đồng nằm ở [contracts/README.md](contracts/README.md). Từ thư mục gốc có thể dùng `pnpm contracts:build`, `pnpm contracts:test`, `pnpm contracts:abi` khi Foundry/pnpm có trong PATH.

```powershell
corepack pnpm@10.11.0 install --frozen-lockfile
corepack pnpm@10.11.0 typecheck
corepack pnpm@10.11.0 test
corepack pnpm@10.11.0 local:prepare
corepack pnpm@10.11.0 api:dev
# Terminal thứ hai:
corepack pnpm@10.11.0 web:dev
```

Yêu cầu Node 24+ và Foundry. Mở http://127.0.0.1:5173. Hướng dẫn từ đầu, ký owner, kiểm thử và xử lý gián đoạn ở [demo guide](docs/demo-guide.md). [API](docs/api.md), [nghiệm thu lab](docs/acceptance.md), [interfaces](docs/interfaces.md) và [bàn giao hợp đồng](docs/contract-handoff.md) lưu các giới hạn thực tế. Fuji cần cấu hình riêng theo [hướng dẫn](docs/fuji-deployment.md).
