# Giao diện tích hợp v0.2

Ngày: 2026-11-14. Nguồn kiểu TypeScript: `packages/shared/src/types.ts`; ABI Solidity xuất từ compiler. Đây là giao diện đã chạy được giữa agent và module trên local; API/scenario/run schema cho lab vẫn cần Hoàng bổ sung.

## Quy ước dữ liệu

- Lượng token/shares/USD qua JSON là chuỗi số nguyên; thực hiện phép tính bằng bigint. Giá và giá trị USD có 8 decimals.
- Bps = 1/10000; tổng targetBps = 10000. Ngưỡng kích hoạt là lệch lớn hơn 500 bps (5 điểm phần trăm).
- `capScope` bắt buộc là `SWAP_INPUT_ONLY`; không trừ hoặc hoàn cap khi gửi/rút vault.
- `PortfolioSnapshot` đọc balance, giá và quy đổi vault tại cùng một block xác nhận. `rawBalance` của vault position là **underlying assets**; `vaultShares` giữ raw share balance riêng.
- `vaultConversion` là cặp assets/shares được `convertToShares` tại snapshot block. Đây là quote chỉ dẫn; trước gửi, builder tính lại với amount chính xác và chỉ siết chặt bound của plan.
- Timestamp/deadline là Unix seconds, không phải milliseconds. Plan dùng deadline snapshot + 300 giây.
- Cùng token có thể có vị thế ví và nhiều vị thế vault, phân biệt bằng `(tokenAddress, vaultAddress)`. Không lặp cùng cặp.
- Chưa suy ra accrued yield nếu không có dữ liệu principal/cost basis; không lấy giá trị assets-shares làm lãi thật.

## TradeStep là discriminated union

Mọi bước có `stepIndex`, `targetContract`, `estimatedValueUsd`, `deadline`.

| action | Field riêng | Ý nghĩa |
| --- | --- | --- |
| SWAP_EXACT_IN | tokenIn, tokenOut, amountIn, minAmountOut | Router, exact input; estimatedValueUsd là debit swap cap làm tròn lên |
| VAULT_DEPOSIT | tokenIn, assets, minShares | tokenIn là underlying; assets exact-input, nhận shares tối thiểu |
| VAULT_WITHDRAW | tokenOut, assets, maxShares | tokenOut là underlying; rút exact assets, burn tối đa maxShares |

Withdraw không tự swap underlying sang stablecoin. Nếu underlying khác pivot, plan có bước swap riêng. Khi mua vị thế vault khác pivot, plan swap trước rồi deposit lượng bằng minOut đảm bảo, không dùng output ước đoán cao hơn minOut.

Planner giữ tiền mục tiêu của pivot, theo dõi cash khả dụng và cap qua từng bước, không dùng lại cùng số dư cho hai lần phân bổ. Plan có thể partial vì cap, thiếu cash hoặc lượng output tối thiểu; không hứa đạt tỷ trọng tuyệt đối sau nhiều giao dịch độc lập.

## Các entry point TypeScript

```text
readPortfolioSnapshot(client, account, oracle, positions, maxPriceAgeSec)
client.readPolicyConfig(module, session, universe, blockNumber?)
computeRebalancePlan(snapshot, policy, router, pivotToken)
new PlanExecutor(client, module, safe).execute(plan)
client.buildGrantSessionTransaction(module, key, expiresAt)
client.buildRevokeSessionTransaction(module, key)
```

`PolicyUniverse` cung cấp địa chỉ token/router/vault dự kiến; readPolicyConfig xác minh whitelist từng địa chỉ on-chain. Module không có enumerable whitelist. Owner ký Safe transaction chứa payload grant/revoke; payload module không phải lệnh để owner EOA gọi trực tiếp.

## Kết quả thực thi và chống gửi trùng

`PlanExecution.status` là COMPLETED / FAILED / PENDING; đây không phải PASS/FAIL của lab.

- SUCCESS: receipt success, có hash và block.
- PREFLIGHT_REJECTED: prepare/simulation thất bại, không gán hash giả.
- REVERTED: receipt thất bại sau khi gửi, giữ hash; chưa suy đoán custom reason từ receipt status đơn thuần.
- PENDING: đã có hash nhưng chưa xác nhận, dừng các bước sau.
- SUBMISSION_UNKNOWN: RPC gửi lỗi, chưa biết node đã nhận chưa; giữ trạng thái chưa rõ, không retry mù.

Một PlanExecutor xử lý tuần tự cho một signer/module. Cùng planId + payload trả lại cùng run; đổi payload dưới cùng ID bị từ chối. Executor chụp bản sao plan trước các bước async. Không nhận plan khác trong lúc đang chạy.

Dedup hiện chỉ trong bộ nhớ một instance, không phải exactly-once sau crash hoặc nhiều worker. Backend phải lưu run/tx hash/nonce bền vững, khóa theo signer/module, reconcile trước retry sau restart. Nhiều bước là nhiều giao dịch riêng; bước trước có thể đã thành công khi bước sau thất bại.

## Mã lỗi

`decodePolicyErrorDetails(error)` đọc revert bytes từ raw/data/cause/error có cấu trúc, giải mã ABI và nested ExecutionFailed.reason. Giữ tên lỗi, args và nested details. Không dò chuỗi thông báo RPC để suy ra lệnh bị policy chặn.

ErrorCode đã bổ sung session chưa cấp, paused, invalid price/config/amount, deadline, history full, Safe module disabled, token operation, unexpected balance, vault asset changed và execution/receipt reverted. Lỗi không xác định/RPC vẫn là ERR_RPC_OR_ENV, không dùng làm bằng chứng PASS.
