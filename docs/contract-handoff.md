# Bàn giao phần hợp đồng cho Tiến và Hoàng

Ngày: 2026-11-14. Module đã build và kiểm thử local; ABI ở `packages/chain-client/src/abi/PolicyModule.json`. Đã tích hợp agent/chain-client theo schema v0.2 và chạy xuyên suốt local; API/backend/lab chưa hoàn thành. Xem [interfaces.md](interfaces.md).

## Đọc trạng thái

| Hàm | Kết quả |
| --- | --- |
| safe(), priceSource() | Địa chỉ cố định của account và oracle |
| readPolicy() | Tuple `(uint192 cap24hUsd, uint32 maxPriceAgeSec, uint16 maxSlippageBps)` |
| readSession(key) | Tuple `(uint64 expiresAt, bool revoked)` |
| readSpent24hUsd(), readRemainingCap() | USD 8 decimals; remaining clamp về 0 khi cap nhỏ hơn spent |
| paused() | Kill switch toàn bộ hành động agent |
| allowedTokens(token), tokenDecimals(token) | Whitelist và decimals đã cache |
| allowedRouters(router), vaultAssets(vault) | Router whitelist; vault asset = zero nghĩa là vault chưa được duyệt |

Whitelist chưa có hàm liệt kê mảng. Client cần danh sách địa chỉ từ config/deployment và xác nhận từng entry bằng getter. Đọc snapshot tại một block nhất quán.

## Gửi giao dịch bằng session

```text
executeSwap({ router, tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline })
executeVaultDeposit({ vault, assets, minShares, recipient, deadline })
executeVaultWithdraw({ vault, assets, maxShares, recipient, deadline })
```

Các field amount dùng raw token/share units; client chuyển từ chuỗi JSON sang bigint. USD dùng 1e8. `recipient` bắt buộc Safe. Gửi đến **module**, không gọi router/vault trực tiếp bằng session.

Withdraw là exact-assets: `assets` tính bằng underlying token, `maxShares` là share units. Deposit minShares và withdraw maxShares nên dựa trên quote tại block đọc và điều kiện slippage trong policy-spec. Không tự gán `TradeStep.minAmountOut` vào maxShares.

Deadline là Unix seconds; planner v0.2 đặt snapshot + 300 giây. Các bước gửi riêng không atomic với nhau: đợi receipt, đọc lại trạng thái khi có lỗi, không gửi trùng hoặc retry mù.

## Owner ký qua Safe

Owner thao tác `setPolicy`, `grantSession`, `revokeSession`, `setPaused`, `setTokenAllowed`, `setRouterAllowed`, `setVaultAllowed` bằng **giao dịch Safe**. Gọi module trực tiếp từ ví owner sẽ revert `OnlySafe`. Threshold Safe vẫn có hiệu lực.

DeployLocal minh họa EIP-712 signatures cho Safe threshold 1. Script smoke dùng prevalidated owner signature kèm giao dịch do chính owner gửi trên unlocked Anvil. Không áp dụng cơ chế unlocked account cho Fuji/backend.

## Events, lỗi và evidence

ABI xuất đầy đủ event/custom errors. Các event thực thi: `SwapExecuted`, `VaultDeposited`, `VaultWithdrawn`; revoke dùng `SessionRevokedEvent` để tránh trùng tên error `SessionRevoked`.

`ExecutionFailed(address target, bytes reason)` bọc revert gốc của router/token/vault. `decodePolicyErrorDetails` đã dùng compiler ABI giải mã cả lớp ngoài và nested reason từ dữ liệu có cấu trúc; không dò text RPC để kết luận policy rejection.

| Error | Cách diễn giải |
| --- | --- |
| CapExceeded | Có used/requested/cap, đều USD 8 decimals |
| TokenNotWhitelisted / RouterNotWhitelisted / VaultNotWhitelisted | Có địa chỉ vi phạm |
| InvalidRecipient | Receiver khác Safe |
| UnauthorizedSession / SessionExpired / SessionRevoked / Paused | Phân biệt rõ quyền và trạng thái |
| InvalidPrice / StalePrice | Có token gây lỗi; không phải lỗi RPC |
| SlippageExceeded / UnexpectedBalanceChange | Không đạt giới hạn hoặc hậu điều kiện; giao dịch rollback |
| ExecutionFailed | Giữ target + nested reason để Hoàng hiển thị và assertion |
| SpendHistoryFull | Đủ 256 active swaps; fail closed, không phải lỗi vượt USD cap |
| OnlySafe / InvalidConfiguration / TokenOperationFailed / VaultAssetChanged | Lỗi quản trị/cấu hình hoặc trạng thái đối tác |

Lab phải kiểm tra receipt/revert + balance/shares/cap/allowance trước-sau. Không nhận diện custom error chỉ bằng status 0. Preflight bị chặn thì không bịa txHash; RPC lỗi phải ERROR.

## Điểm cần Tiến đối chiếu

1. Đã sửa planner chỉ trừ cap cho swap, có cash ledger từ minOut, reserve pivot và xử lý cả vault underlying khác pivot. Cần Tiến review chiến lược và các giới hạn sản phẩm trong interfaces.md.
2. TradeStep đã tách swap/deposit/withdraw, có assets/minShares/maxShares/deadline riêng. Builder siết bound theo quote mới; không làm yếu bound trong plan.
3. ErrorCode đã mở rộng; PlanExecutor dừng khi revert/không rõ trạng thái và chống gửi trùng trong một instance. Backend cần persist hash/nonce và khóa nhiều worker; chưa có bảo đảm dedup sau crash.
4. Portfolio reader dùng một block cho số dư/giá/quy đổi. Chưa suy ra lãi khi không có principal; mock yield không được gọi là lợi suất thật.
5. Fuji script đã build và RPC đúng mạng; chưa deploy vì thiếu ví thử nghiệm. Xem [fuji-deployment.md](fuji-deployment.md).

## Điểm cần Hoàng đối chiếu

- Lab chưa được triển khai bởi phần hợp đồng. Bộ Solidity tests và script smoke là bằng chứng của contract, không phải lab/backend đã DONE.
- `SC-02`, `SC-04` đến `SC-17` có các biến thể được kiểm thử ở mức contract; không tự đổi các scenario trong task.md thành DONE trước khi runner chạy thật.
- Báo cáo smoke ở `.runtime/contract-smoke.json` chỉ dùng local chain đang chạy. Sau restart/reset, addresses/hash cũ có thể không tồn tại; phải deploy và xác minh lại.
