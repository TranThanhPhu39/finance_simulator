# Kiểm chứng phần hợp đồng local

Ngày: 2026-11-14 (Asia/Saigon). Phạm vi: code hợp đồng của Phú cùng Safe thật và mock có sẵn của Tiến. Chưa kiểm chứng lab/backend/web hoặc Fuji.

## Bộ Solidity tests

Lệnh từ `contracts/`: `forge test -vv`.

Kết quả cập nhật: **65 tests PASS, 0 FAIL, 0 skipped**. Gồm 63 tests cho policy và 2 tests Counter có sẵn.

| Suite | Số tests | Nội dung chính |
| --- | --- | --- |
| PolicyModuleTest | 36 | Session/admin/kill switch, whitelist/recipient, cap/window, giá/minOut, rollback, history capacity/wrap, zero cap và disabled module |
| VaultTest | 13 | Swap-deposit-withdraw qua Safe, yield mô phỏng, shares bounds, recipient/underlying/vault whitelist và underlying bị thay đổi |
| AdversarialTest | 8 | Router nói dối, thiếu debit, reentrancy, false/no-return approve, vault lỗi hoặc sai shares |
| PolicyFuzzTest | 4 | Split cap, foreign recipient, vault roundtrip, reverse swap và làm tròn USD; 256 cases/test |
| PolicyInvariantTest | 2 | So với ledger độc lập; conservation/safe recipient/zero allowance/không nâng quyền; 64 runs × depth 32/test |
| CounterTest có sẵn | 2 | Ví dụ Foundry, không thuộc PolicyModule |

Integration fixture triển khai Safe v1.4.1 singleton + SafeProxy thật, tạo owner và ký Safe transactions để bật module/cấu hình quyền. Không dùng smart account giả thay cho Safe.

## Triển khai và giao dịch local

Đã chạy `DeployLocal.s.sol --broadcast` trên Anvil loopback chainId 31337, dùng tài khoản thử nghiệm công khai của Anvil. Bộ recorder kiểm chứng 19 receipt triển khai/cấu hình thành công và payload on-chain trước khi ghi metadata.

`node scripts/smoke-contracts.mjs` chạy 7 giao dịch được mine:

1. Swap 50 USDC thành 5 token A thành công.
2. Swap tiếp 60 USDC bị revert vì tổng vượt cap 100 USD; preflight phải đúng CapExceeded.
3. Swap gửi đến ví lạ bị revert InvalidRecipient; ví lạ không nhận token.
4. Gửi 100 USDC vào vault, shares về Safe.
5. Rút 20 USDC từ vault về Safe; lượng shares burn không vượt maxShares.
6. Owner gửi giao dịch Safe thu hồi session thành công.
7. Session gửi lệnh mới bị revert SessionRevoked.

Script xác nhận token, shares, cap, allowance và receipt; không chỉ kiểm tra chuỗi log “Blocked”. Seed ban đầu 600 USDC + 40 token A; cuối flow 470 USDC + 45 token A + khoảng 80 vault-share đơn vị whole-token; cap đã dùng 50 USD. Shares còn lại có thể lớn hơn 80 đôi chút do mock accrue yield giữa các block. Report dùng raw units để tránh nhập nhằng decimals.

Metadata `deployments/local.json` và report `.runtime/contract-smoke.json` được tạo local và bỏ qua Git; địa chỉ/hash mất hiệu lực sau restart/reset Anvil. Cần chạy lại deployment để tái hiện. Smoke chủ động tạo lệnh sai bằng session; không phải prompt injection.

## Agent và TypeScript

`pnpm typecheck` thành công. `pnpm test`: **22 tests PASS**, kiểm tra planner/cash/cap/underlying vault, decoder, typed request, siết quote, dedup, snapshot plan chống sửa giữa lúc chạy và xử lý trạng thái không rõ sau gửi.

`pnpm agent:integration` đã chạy với một deployment local mới, dùng session signer thử nghiệm thật:

1. Reader lấy danh mục tại cùng một block, tổng 1.000 USD mock.
2. Planner tạo swap 10 token A (100 USD), nhận tối thiểu 99 USDC, sau đó deposit 499 USDC. Cash dùng minOut bảo đảm, giữ reserve pivot.
3. Hai request cùng plan chỉ tạo một lần thực thi cho từng bước; cả hai receipts thành công.
4. State thực sau flow: 201 USDC tiền ví, 30 token A, 499 shares vault. Cap swap dùng 100 USD.
5. Đổi target thành 30% tiền ví / 30% token A / 40% vault: agent rút vault thành công dù remaining swap cap bằng 0, không thay đổi cap.
6. Owner revoke qua Safe; plan chuẩn bị trước revoke bị simulation chặn đúng SessionRevoked, không gán txHash và không thay đổi tài sản.

Bằng chứng đầy đủ nằm ở `.runtime/agent-integration.json`, gồm snapshot/policy/plan/receipts/hash trước-sau. File chỉ có hiệu lực như lịch sử local; reset Anvil thì chạy lại toàn bộ. Dedup hiện trong bộ nhớ một executor, chưa thay thế persistence/locking của backend.

## Build và giới hạn

- `forge build --sizes`: build thành công, runtime PolicyModule 12.808 bytes, dưới giới hạn EIP-170 24.576 bytes.
- Solidity 0.8.31, EVM Paris; Safe v1.4.1 và OpenZeppelin v5.2.0 cố định, license/upstream có trong repo.
- ABI export có 57 entries, gồm hàm/event/error/constructor; nguồn là compiler artifact.
- Có lint nhắc về timestamp/cast đã có kiểm tra giới hạn và transfer trong fixture đối kháng; không có compiler error. Timestamp là thiết kế window/session, không phải wall-clock bảo đảm tuyệt đối.
- Chưa kiểm toán độc lập, chưa xác nhận CI từ GitHub, chưa triển khai Fuji, chưa tích hợp DEX/vault thật.
- Schema/planner/client đã khớp contract trong bài tích hợp local; cần Tiến/Hoàng review trước khi ghép API/lab/dashboard. Fuji bị vướng do thiếu cấu hình ví thử nghiệm; hướng dẫn ở fuji-deployment.md.
