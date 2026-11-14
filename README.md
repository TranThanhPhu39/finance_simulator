# Treasury Agent Lab

AI agent quản lý quỹ sinh lời trên Avalanche (stablecoin cho vay, sAVAX, trái phiếu token hóa) với quyền bị giới hạn on-chain, kết hợp phòng kiểm thử kiểm chứng PolicyModule bằng trạng thái tài sản trước/sau.

> AI quản lý quỹ, nhưng không bao giờ vượt quyền — và mọi giới hạn đều có bằng chứng on-chain trên Avalanche.

Repo hiện có khung thư mục và tài liệu khởi tạo; chưa có ứng dụng, hợp đồng, dependency hoặc lệnh chạy chức năng.

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

Việc tiếp theo: cả nhóm chốt policy/schema/fixture, cấu hình toolchain theo SET-02, sau đó làm một luồng swap local xuyên suốt. Bổ sung lệnh cài/chạy/test tại đây khi đã thực sự kiểm tra được.
