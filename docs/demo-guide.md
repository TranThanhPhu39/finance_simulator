# Chạy demo Treasury Agent Lab local

Yêu cầu: Node.js 24+, Corepack/pnpm 10.11.0 và Foundry (`forge`, `cast`, `anvil`). Trên Windows, helper tự tìm Foundry trong thư mục `.foundry/bin` của tài khoản hiện tại hoặc PATH. Không cần khóa owner thật.

## Khởi động từ repo

```powershell
corepack pnpm@10.11.0 install --frozen-lockfile
corepack pnpm@10.11.0 local:prepare
corepack pnpm@10.11.0 api:dev
```

Mở terminal thứ hai ở repo root:

```powershell
corepack pnpm@10.11.0 web:dev
```

Mở http://127.0.0.1:5173/?mode=onchain (hoặc chọn **On-chain Anvil** ở thanh chế độ). Trang mặc định giữ dashboard mô phỏng/Launchpad từ main. API lắng nghe loopback 8787; Vite proxy `/api`. Helper tạo Anvil trên 8545 nếu chưa có, triển khai một Safe/module và mock mới, rồi xác minh receipts trước khi ghi metadata. Helper từ chối deploy lại khi API trên 8787 đang chạy.

Thông tin khởi tạo: 600 USDC + 40 token A giá 10 USD = 1.000 USD mock; target 20% tiền ví / 30% token A / 50% vault; cap swap 100 USD rolling 24 giờ, slippage 1%. Mock oracle có tuổi giá tối đa 1 giờ. Sau thời gian dài không chạy, giá cũ sẽ bị từ chối; dừng API rồi chuẩn bị deployment mới để demo lại.

## Ba màn hình

1. **Quỹ & chính sách:** số dư, shares/underlying vault, cap/session, tỷ trọng, preview/chạy agent. Lãi vault tính từ toàn bộ events deposit/withdraw và assets hiện tại; nếu có chuyển shares ngoài luồng thì hiển thị thiếu giá vốn, không bịa lãi.
2. **Phòng kiểm thử:** chọn một, nhiều hoặc cả 17 scenario. Nguồn AGENT_RULE / DIRECT_SESSION_CALL / HARNESS_MUTATED được ghi rõ. Lệnh harness sửa không được gọi là prompt injection.
3. **Kết quả:** tiến trình, PASS/FAIL/ERROR/UNSUPPORTED, assertions, trạng thái trước/sau, receipt và hash thật, tải JSON/CSV. Lịch sử ở SQLite nên refresh/restart API không làm mất lượt đã hoàn tất. Danh sách UI hiển thị tối đa 50 lượt gần nhất; báo cáo cũ vẫn truy cập bằng ID.

Scenario chạy trong snapshot riêng, có owner setup qua Safe, rồi khôi phục. Các tx đã được mine và xác minh khi chạy, nhưng hash trên nhánh snapshot bị revert có thể không còn truy vấn được ở node hiện tại. UI ghi rõ lịch sử local và không tạo link explorer giả.

## Thao tác owner

Dùng **Dùng ví thử nghiệm Anvil** để kết nối tài khoản owner công khai mặc định của node. Đây là cơ chế thử nghiệm local do Anvil ký, không phải ví production. Hoặc import ví test riêng vào extension, kết nối đúng account owner và Anvil chain 31337.

Nút cấp/thu hồi session và cập nhật policy yêu cầu wallet gửi owner transaction đến Safe. API chỉ chuẩn bị payload, xác minh from/to/input/value và receipt; backend không giữ khóa owner. Lab cần unlocked Anvil owner để dựng setup có kiểm soát và từ chối RPC không phải Anvil/loopback.

Khi hủy ký thật (4001), yêu cầu được hủy và lease được giải phóng. Nếu lỗi gửi không rõ trạng thái hoặc đã có hash, UI giữ yêu cầu pending; đối chiếu hash, không bấm gửi lặp. Lease không tự hết hạn để tránh một giao dịch owner chậm bị đè bởi reset scenario.

## Trình tự demo

- Kết nối ví thử nghiệm, cấp quyền 24h nếu session đang thu hồi/hết hạn.
- Xem kế hoạch và chạy agent. Đối chiếu token/shares/cap trong kết quả.
- Chạy SC-04, SC-09, SC-11 và SC-16. Mỗi PASS cần đúng lỗi preflight, receipt revert và trạng thái token/shares/allowance/cap phù hợp.
- Thu hồi quyền ở màn hình quỹ, kiểm tra session thay đổi thật.
- Mở lại lịch sử, tải JSON/CSV. Toàn bộ dữ liệu vẫn là mock, không phải lợi suất thật hoặc giao dịch Fuji.

## Kiểm chứng tự động

```powershell
corepack pnpm@10.11.0 typecheck
corepack pnpm@10.11.0 test
corepack pnpm@10.11.0 build
# Dừng API trước khi tạo deployment mới.
corepack pnpm@10.11.0 local:prepare
corepack pnpm@10.11.0 lab:integration
```

Bài API integration chạy 17 scenario, kiểm tra idempotency/validation/origin/owner ký/export và mở lại SQLite sau restart. Nó sử dụng DB test riêng trong `.runtime` và kết thúc với session đã thu hồi. Trước chạy browser tests trên một demo sạch, chuẩn bị deployment mới, khởi động API và Vite.

```powershell
corepack pnpm@10.11.0 exec playwright install chromium
corepack pnpm@10.11.0 exec playwright test
```

Browser test dùng Chromium headless và ví thử nghiệm Anvil thật cho owner flow. Test sai mạng/hủy ký dùng provider giả lập có kiểm soát; không phải bằng chứng đã kiểm tra một extension cụ thể. Ảnh và trace ở `.runtime`, không đưa vào Git. Có thể đặt PLAYWRIGHT_BROWSERS_PATH trong `.runtime/playwright` để giữ browser cache trong workspace.

## SQLite và xử lý gián đoạn

DB mặc định `.runtime/treasury.db`, WAL; tables runs/run_steps/assertions/transaction_evidence/requests/settings/locks/governance. Một API/SQLite instance điều phối một Anvil; không chạy nhiều API với DB khác nhau trên cùng node. Chain lease dùng chung worker, các lượt đọc snapshot và yêu cầu owner.

Queue/idempotency được lưu bền vững. Khi restart, lượt RUNNING bị đánh ERROR, không tự gửi lại. Scenario chỉ thử khôi phục checkpoint khi đúng Safe/deployment; nếu restore thất bại thì giữ môi trường bị khóa. Với giao dịch agent/owner không rõ kết quả, phải kiểm tra hash/nonce trước khi tiếp tục.

Để bắt đầu một demo hoàn toàn mới khi có quarantine: dừng API/Vite; giữ DB cũ để bảo toàn bằng chứng; chạy local:prepare để tạo Safe mới và cấu hình `API_DATABASE_PATH` sang một file mới trong `.runtime` trước khi chạy API. Không tự xóa DB hay replay giao dịch cũ.

API cũng phục vụ frontend production build ở http://127.0.0.1:8787 sau `pnpm build`. Không thiết kế để public Internet: owner RPC là ví test unlocked, reset chỉ dành cho môi trường local được kiểm soát.

Fuji vẫn cần deployment/signer testnet riêng. Scenario reset/setup của Anvil trả UNSUPPORTED trên Fuji. Xem [fuji-deployment.md](fuji-deployment.md).
