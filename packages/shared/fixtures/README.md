# Fixture dùng chung v0.2

Các JSON tại đây hoàn toàn là dữ liệu mẫu: địa chỉ giả, timestamp cố định và kế hoạch chưa gửi. Không dùng để khẳng định có tài sản, giao dịch hay lợi suất thật.

- policy.json: capScope SWAP_INPUT_ONLY, USD 8 decimals và whitelist mẫu.
- portfolio.json: 600 USDC + 40 token A giá 10 USD, vault rỗng; mục tiêu 20% tiền ví, 30% token A, 50% vault.
- rebalance-plan.json: swap tối đa 100 USD token A, sau đó gửi vault từ cash đảm bảo; deadline chỉ phù hợp với timestamp fixture.

Frontend/lab dùng schema trong `src/types.ts`; request chạy thật phải đọc snapshot/policy on-chain và tạo plan mới. ScenarioDefinition/RunResult fixtures cho lab vẫn cần Hoàng bổ sung.
