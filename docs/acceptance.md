# Nghiệm thu phần lab API dashboard

Kiểm chứng local ngày 2026-11-20. Đây là kết quả MVP local, không phải xác nhận đã triển khai Fuji hay kiểm toán độc lập.

| Điều kiện | Bằng chứng |
| --- | --- |
| Agent chạy qua module và thay đổi token/shares đúng | Live agent integration của Phú và browser/API run SC-02 |
| 17 scenario chạy độc lập | lab:integration: 17/17 PASS, mỗi run có cleanup.restored=true |
| Lệnh sai thực sự bị chặn | Preflight decode đúng custom/nested error + giao dịch mine receipt reverted + assertions số dư/cap/allowance |
| Ví lạ không nhận token hoặc shares | SC-09, SC-17: outsider balances không tăng |
| Cap cộng dồn và biên 24h | SC-05: 60+30 thành công, 20 bị chặn, spent=90 USD; SC-06: còn ở 24h−1s, hết tại 24h |
| Không nhầm RPC error thành PASS | verdictFor bắt buộc assertions, environment error luôn ERROR; handler chỉ decode revert bytes có cấu trúc |
| Không chạy đè state | SQLite chain lease cho queue/owner/read, snapshot restore; quarantine sau kết quả không rõ/restore lỗi |
| Không tự gửi lại sau crash | Unit restart quarantine và durable request idempotency; run RUNNING chuyển ERROR |
| Lưu tiến trình/bằng chứng | SQLite transactions cập nhật run và normalized evidence cùng lúc |
| Reload/restart vẫn có lịch sử | API integration đóng/mở lại DB; browser test reload trang |
| Owner ký thay đổi thật | Browser dùng ví Anvil, API đối chiếu actual from/to/calldata/value/receipt; không có owner key backend |
| Sai mạng/hủy ký | Browser provider test: sai chain có thông báo; reject 4001 hủy yêu cầu, không gửi tiền |
| JSON/CSV có bằng chứng | Export gồm run/version, policy, before/after, assertions, transactions, steps; CSV escape và chặn formula injection |
| Dashboard responsive | Browser desktop 1440x1000 và mobile 390x844, không tràn ngang toàn trang; table cuộn ngang riêng |
| Fuji không giả làm local | Các scenario chỉ khai báo local, yêu cầu Fuji trả UNSUPPORTED |

Lệnh tái hiện ở [demo-guide.md](demo-guide.md). Dữ liệu chạy thực được ghi ở `.runtime/lab-suite.json`; ảnh ở `.runtime/screenshots`. CI upload artifact để review. Không đưa private keys/cache/broadcast credentials/DB vào Git.

Giới hạn: chưa có API auth cho public hosting, chỉ một API instance/SQLite cho một Anvil; giao dịch multi-step không atomic; không automatically reconcile mọi RPC send thất bại sau restart. Mock có public mint/setPrice. Không dùng stack này với tài sản thật.
Bằng chứng CI trên nhánh `feat/hoang-lab-dashboard`:

- [Lab API and dashboard — SUCCESS, commit bf734e4](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44770506335): Ubuntu 24.04, Node 24, cài từ lockfile, typecheck, 30 TS tests, production build, 17/17 API scenarios, SQLite restart và 2 Playwright tests. Artifact `lab-dashboard-evidence` chứa báo cáo, ảnh và log (lưu 7 ngày).
- [Contracts — SUCCESS, commit 08106b4](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44769952765): Solidity format/build/65 tests/ABI, typecheck, 30 TS tests và live agent integration. Các commit tiếp theo chỉ sửa workflow lab, không sửa hợp đồng/agent.

Workflow dashboard cố định Ubuntu 24.04 vì `ubuntu-latest` đã chuyển sang Ubuntu 26.04, chưa được Playwright 1.56.1 trong lockfile hỗ trợ. Task giữ REVIEW để thành viên khác kiểm tra; CI PASS không thay thế demo Fuji.


Bản hợp nhất ngày 2026-11-21 (2fca6ed): giữ dashboard/Launchpad trên main và bổ sung chế độ Anvil riêng. 39 TS tests, 17/17 scenario Anvil, 10/10 scenario mô phỏng, 3 browser flows và production build PASS trên CI. [Workflow lab/dashboard](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44878242076), [workflow hợp đồng/live agent](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44878242164). Xem [integration-modes.md](integration-modes.md).
