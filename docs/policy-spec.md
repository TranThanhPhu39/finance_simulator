# Đặc tả PolicyModule v0.1

Ngày triển khai local: 2026-11-14. Đây là lựa chọn triển khai cho phần của Phú, cần review tích hợp với Tiến và Hoàng; không có nghĩa cả nhóm đã duyệt mọi quyết định sản phẩm.

## Tài khoản và quản trị

- Một module gắn cố định với một Safe và một price source, qua constructor. Không có proxy nâng cấp cho module.
- Safe v1.4.1 chạy qua SafeProxy; module dùng `execTransactionFromModuleReturnData` với `Call`, ETH value bằng 0.
- Các hàm quản trị chỉ chấp nhận `msg.sender == safe`. Owner EOA phải ký giao dịch Safe, không gọi thẳng module.
- Owner cấp session, đặt hạn dùng, revoke, pause/unpause và quản lý whitelist/policy. `setPaused(true)` dừng cả swap, deposit, withdraw của agent; owner vẫn quản trị Safe được.
- Session gọi trực tiếp module, được xác thực bằng caller. Chưa hỗ trợ relay/meta-transaction/chữ ký off-chain của session. Nonce giao dịch Ethereum xử lý replay giao dịch đã ký.
- Session chưa cấp bị `UnauthorizedSession`; đã revoke bị `SessionRevoked`; hết hạn tại `timestamp >= expiresAt` bị `SessionExpired`.
- Lịch sử cap thuộc account/module, dùng chung mọi session và không bị reset khi revoke/regrant/đổi policy.

## Loại thao tác được phép

Chỉ có `executeSwap`, `executeVaultDeposit`, `executeVaultWithdraw`. Module tự xây calldata từ request có kiểu. Không có entry point cho raw calldata, arbitrary target, arbitrary approve/transfer, ETH transfer hoặc delegatecall.

Swap chỉ hỗ trợ `ISupportedRouter.exactInputSingle(tokenIn, tokenOut, amountIn, minAmountOut, recipient)`, khớp mock của Tiến. Đây không phải ABI của mọi DEX; muốn nối DEX thật phải làm adapter được review riêng.

Recipient của cả ba thao tác phải bằng Safe. Deposit nhận shares vào Safe; withdraw dùng Safe đồng thời làm receiver và owner của shares. Deadline hợp lệ khi `block.timestamp <= deadline`, lượng tài sản phải lớn hơn 0.

## Rolling cap

- Giá trị USD dùng 8 decimals, khớp `packages/shared/src/types.ts`: 100 USD = `10000000000`.
- Cap là **tổng giá trị đầu vào swap thành công**, không trừ đầu ra và không tính phí gas.
- Mỗi debit = `ceil(amountIn × priceInUsd / 10^tokenDecimals)` tại thời điểm thực thi; không định giá lại debit cũ.
- Window gồm các giao dịch có `timestamp + 86400 > now`. Tại đúng mốc 24 giờ, debit cũ không còn được tính.
- Lệnh làm `spent + requested > cap` bị chặn; đúng bằng cap được phép.
- Hạ cap dưới mức đang dùng làm remaining = 0, không xóa lịch sử. Cap bằng 0 khóa swap.
- Ring buffer chứa tối đa 256 swaps còn hiệu lực, giữ từng debit riêng, không chia bucket theo giờ/ngày. Đầy buffer thì `SpendHistoryFull` và không giao dịch; khi entry hết hạn có thể tiếp tục. Agent phải tránh spam dust.
- Ghi debit trước external call để chống reentrancy; nếu bất kỳ bước nào revert thì toàn bộ debit, token, shares và approve rollback cùng giao dịch.
- Deposit/withdraw **không dùng swap cap** và không hoàn lại cap. Đây là phạm vi theo input trong brainstorm; chưa có cap riêng cho turnover/lỗ vault. Nếu sản phẩm muốn cap cho mọi hành động, phải đổi đặc tả, thuật toán và tests cùng nhau trước demo.

## Token, giá và slippage swap

- Chỉ token ERC-20 thông thường trong whitelist, decimals từ 0 đến 18; cache decimals lúc owner whitelist.
- Không cam kết hỗ trợ fee-on-transfer, rebasing, ERC777 callback hoặc token có metadata thay đổi. Số dư token vào phải giảm đúng amountIn.
- Price source trả `getPrice(token) -> (price, updatedAt)`, price là USD 8 decimals. Giá > 0, timestamp > 0, không ở tương lai. `now - updatedAt <= maxPriceAgeSec`.
- Giá lỗi/revert là `InvalidPrice`, giá cũ là `StalePrice`; cả giá input và output đều được kiểm tra.
- Giá trị tham chiếu đầu ra tính theo số nguyên: `floorValue = floor(amountIn × priceIn / scaleIn)`, `quote = floor(floorValue × scaleOut / priceOut)`.
- `requiredOut = ceil(quote × (10000 - maxSlippageBps) / 10000)`. Quote/dust bằng 0 bị từ chối. Floor trung gian có thể bỏ phần nhỏ hơn 1 đơn vị USD 8 decimals; cap luôn làm tròn lên.
- Agent phải gửi `minAmountOut >= requiredOut`; sau swap, module đo balance delta thật của Safe và buộc `actualOut >= minAmountOut`. Không tin lượng output router trả về.
- Slippage cấu hình từ 0 đến 1000 bps (0–10%); demo dùng 100 bps. Nguồn giá max age mặc định demo 3600 giây.

## Vault ERC-4626

- Owner whitelist địa chỉ vault và module lưu underlying `asset()`. Khi thực thi phải còn đúng asset đã lưu, underlying vẫn nằm trong token whitelist.
- Deposit dùng exact assets; `minShares >= ceil(convertToShares(assets) × (10000 - slippageBps) / 10000)`, required shares > 0. Kiểm tra debit underlying đúng assets và shares delta thật đạt minShares.
- Withdraw dùng exact **underlying assets**, không phải shares/redeem. Request có `maxShares` riêng, không dùng `minAmountOut` thay thế.
- Trần maxShares từ policy = `ceil((convertToShares(assets) + 1) × (10000 + slippageBps) / 10000)`. Một base share cộng thêm xử lý việc convertToShares làm tròn xuống.
- Request phải có `0 < maxShares <= trần policy`; actual shares bị burn phải > 0 và <= maxShares. Safe phải nhận đúng assets yêu cầu.
- Giá trị shares tham chiếu do vault đã whitelist cung cấp, không phải oracle độc lập định giá khả năng thanh toán. Không bảo vệ được vault độc hại báo cáo sai toàn bộ trạng thái, mất thanh khoản hoặc bị hack sau khi gửi tiền.

## Approve và atomicity

Safe approve 0 trước, approve đúng amountIn/assets cho router/vault được chọn, thực thi rồi approve 0 và xác nhận allowance cuối. ERC-20 trả false bị chặn; trả rỗng được hỗ trợ nếu trạng thái allowance khớp. Agent không có hàm approve độc lập.

Reentrancy guard bao phủ mọi entry point thay đổi trạng thái. Lệnh thất bại trả `ExecutionFailed(target, reason)` hoặc lỗi kiểm tra hậu điều kiện; không có giao dịch thành công một phần bên trong một lời gọi module. Nhiều TradeSteps gửi bằng nhiều giao dịch riêng vẫn có thể có bước trước thành công, bước sau thất bại; executor phải đọc lại trạng thái.

## Nguồn thiết kế

- [Safe modules](https://docs.safe.global/advanced/smart-account-modules)
- [Safe module execution trả returndata](https://docs.safe.global/reference-smart-account/modules/execTransactionFromModuleReturnData)
- [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)

Safe v1.4.1 và OpenZeppelin v5.2.0 được vendor kèm nguồn/commit/license trong `contracts/lib/*/UPSTREAM.md`. Compiler 0.8.31, EVM Paris, optimizer 200. Bản OpenZeppelin 5.7 có sẵn được giữ nguyên nhưng không dùng vì yêu cầu opcode Osaka.
