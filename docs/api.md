# API local v1

Base URL `/api`, port 8787, bind 127.0.0.1. Node 24+. Mutations yêu cầu JSON; Origin ngoài allowlist và Host không phải loopback bị từ chối. Đây là API dev local, không thay thế authentication cho dịch vụ public.

| Endpoint | Hành vi |
| --- | --- |
| GET /health | Tình trạng process/version |
| GET /environment | Readiness, địa chỉ thật, owner/session, capability và chain lease |
| GET /treasury | Snapshot portfolio/policy tại một block, targets và vault PnL nếu có đủ lịch sử |
| PUT /targets | `{targets:[bps,bps,bps]}`; tổng 10000, từng giá trị nguyên 0–10000 |
| POST /rebalance/preview | `{targets?:[...]}`; gọi planner thật, không gửi giao dịch |
| GET /scenarios | Catalog 17 scenario, source/version/capability/expectation |
| POST /runs | `{kind:'SCENARIO',environment:'local'|'fuji',scenarioIds:[...]}` hoặc `{kind:'REBALANCE',environment:...}`; trả runIds |
| GET /runs | 50 lượt gần nhất, payload đầy đủ |
| GET /runs/:id | Tiến trình và kết quả một lượt |
| GET /runs/:id/export?format=json hoặc csv | Báo cáo có policy, state, assertions, tx và steps |
| POST /governance/prepare | requestId + owner + action grant/revoke/policy; chỉ trả unsigned Safe calldata và giữ lease |
| POST /governance/:id/confirm | `{hash}`; kiểm chứng transaction/receipt rồi giải phóng lease |
| POST /governance/:id/cancel | `{walletRejected:true}`; chỉ trước khi gắn hash; để xử lý ví từ chối ký |

POST /runs cần header `Idempotency-Key` 8–128 ký tự chữ/số/gạch dưới/gạch ngang. Cùng key/payload trả cùng IDs; đổi payload trả 409. Rebalance ghi lại targets vào run ngay khi enqueue, không lấy một cấu hình khác khi worker bắt đầu.

Governance grant có hours nguyên 1–168, mặc định 24. Policy nhận cap24hUsd là chuỗi USD 8 decimals, maxSlippageBps nguyên 0–1000, maxPriceAgeSec nguyên 1–86400. Owner phải khớp Safe threshold 1 của demo. Backend không nhận hoặc lưu khóa owner.

Mã HTTP: 400 validation, 403 Host/Origin/owner, 404 không có record/endpoint, 409 xung đột lease/idempotency, 413 body quá lớn, 415 Content-Type, 503 môi trường/RPC chưa sẵn sàng. Body giới hạn 64 KiB. Không có endpoint arbitrary RPC, mint/reset theo payload tùy ý từ browser.

Run status QUEUED/RUNNING/COMPLETED tách khỏi verdict PASS/FAIL/ERROR/UNSUPPORTED. ERROR không được xem là giới hạn đã chặn thành công. Hash chỉ ghi khi có giao dịch thật; custom error của negative tests được xác minh ở preflight, receipt thất bại là bằng chứng bổ sung cùng before/after state.
