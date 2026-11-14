# Treasury Agent Lab

AI agent quản lý quỹ sinh lời trên Avalanche (stablecoin cho vay, sAVAX, trái phiếu token hóa) với quyền bị giới hạn on-chain, kết hợp phòng kiểm thử kiểm chứng PolicyModule bằng trạng thái tài sản trước/sau.

> AI quản lý quỹ, nhưng không bao giờ vượt quyền — và mọi giới hạn đều có bằng chứng on-chain trên Avalanche.

Repo đã có workspace, mock testkit và PolicyModule tích hợp Safe; agent/chain-client đã chạy swap, gửi/rút vault và revoke xuyên suốt local. Lab/API/dashboard và luồng Fuji chưa hoàn thành.

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
# Sau khi deploy local mới và ghi metadata như contracts/README.md:
corepack pnpm@10.11.0 agent:integration
```

Schema và fixture v0.2 ở `packages/shared/`; xem [interfaces](docs/interfaces.md), [bàn giao hợp đồng](docs/contract-handoff.md) và [kết quả kiểm chứng](docs/contract-validation.md). Việc tiếp theo: Tiến review tích hợp; Hoàng xây runner/API/dashboard; cấu hình ví thử nghiệm theo [hướng dẫn Fuji](docs/fuji-deployment.md). Cập nhật `task.md` sau mỗi phiên.
