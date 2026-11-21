# Treasury Agent Lab

Agent quản lý quỹ có quyền hạn chế, kết hợp phòng kiểm thử để kiểm chứng chính sách bằng trạng thái tài sản trước/sau. Dự án dùng Solidity/Foundry, Safe v1.4.1, TypeScript, React/Vite/Tailwind và SQLite.

**Trạng thái ngày 21/11/2026:** đã hợp nhất các nhánh vào `main`, chạy được mô phỏng và giao dịch local trên Anvil. **Chưa triển khai và xác minh trên Avalanche Fuji.** Launchpad hiện là paper trading; chưa đăng ký ERC-8004 hoặc khóa/cắt phạt USDC thật trên blockchain.

## Sản phẩm làm gì?

- **Treasury và PolicyModule — Topic 12:** tài sản nằm trong Safe; agent chỉ giao dịch qua session key. Hợp đồng kiểm tra thời hạn/thu hồi session, tổng giá trị swap trong rolling 24 giờ, whitelist token/router/vault, người nhận, slippage, nguồn giá và allowance.
- **Phòng kiểm thử:** chạy các tình huống hợp lệ và vượt quyền, đối chiếu receipt, số dư, shares, allowance và hạn mức. PASS cần có assertions đạt; lỗi RPC/môi trường không được coi là chặn thành công.
- **StockAgent Launchpad — phần mở rộng Topic 16:** mô phỏng đăng ký agent, bond, Paper Trade, Graduation/Slash và hash Proof-of-Action. Giá lấy từ Pyth khi khả dụng, có nhãn fallback khi dùng giá dự phòng.

Agent tính giao dịch theo quy tắc. LLM chỉ giải thích dữ liệu và kết quả, không quyết định giao dịch hay PASS/FAIL. Hash Proof-of-Action trong Launchpad là hash dữ liệu mô phỏng, không phải transaction hash hoặc chữ ký giao dịch.

## Hai chế độ sử dụng

| Chế độ | Mở tại | Nội dung | Bằng chứng |
| --- | --- | --- | --- |
| **Mô phỏng & Launchpad** | http://127.0.0.1:5173/ | 4 màn hình: Quỹ/Policy, Lab, Bằng chứng, Launchpad; 10 tình huống mô phỏng | Trạng thái và báo cáo mô phỏng; không gửi giao dịch blockchain |
| **On-chain Anvil** | http://127.0.0.1:5173/?mode=onchain | 3 màn hình: Quỹ/chính sách, Lab, Kết quả/lịch sử; 17 tình huống | Giao dịch thực trên node Anvil chain 31337, dùng token/router/oracle/vault thử nghiệm |

Chuyển chế độ bằng thanh trên cùng. Các mã SC-xx thuộc hai catalog khác nhau; luôn đọc kèm chế độ/version. Anvil local không phải Avalanche Fuji và không thay thế yêu cầu tích hợp Avalanche của cuộc thi.

## Khởi động nhanh

### Yêu cầu

- **Node.js 24+**, Corepack và **pnpm 10.11.0**.
- **Foundry:** `forge`, `cast`, `anvil` nếu chạy chế độ Anvil hoặc kiểm thử Solidity. Helper tự tìm `.foundry/bin` trên Windows hoặc dùng PATH.
- Chạy lệnh từ thư mục gốc repo. Không cần ví thật để dùng mô phỏng và demo Anvil.

### 1. Cài dependencies

```powershell
corepack pnpm@10.11.0 install --frozen-lockfile
```

### 2. Chuẩn bị Anvil nếu muốn dùng cả hai chế độ

Chạy trước khi khởi động API:

```powershell
corepack pnpm@10.11.0 local:prepare
```

Helper khởi động Anvil ở `127.0.0.1:8545` nếu cần, triển khai Safe/PolicyModule và các mock, rồi ghi metadata vào `deployments/local.json`. Safe được nạp khoảng 1.000 USD tài sản mock: 600 USDC và 40 token A giá 10 USD. Target mặc định: 20% USDC trong ví, 30% token A, 50% vault; cap swap 100 USD/24 giờ và slippage 1%.

Mô phỏng/Launchpad có thể chạy độc lập khi không có Anvil. Helper từ chối tạo deployment mới khi API ở 8787 đang chạy; dừng API trước khi chuẩn bị lại. Giá mock có thời hạn, nên sau thời gian dài không dùng cần chuẩn bị deployment mới để demo.

### 3. Chạy API và giao diện

**Terminal 1:**

```powershell
corepack pnpm@10.11.0 api:dev
```

**Terminal 2:**

```powershell
corepack pnpm@10.11.0 web:dev
```

Mở **http://127.0.0.1:5173/**. API chạy ở **http://127.0.0.1:8787/api/health**; Vite proxy `/api` về API. Nếu đã cài pnpm đúng phiên bản trong PATH, có thể dùng `pnpm api:dev` và `pnpm web:dev`.

Để phục vụ frontend production cùng API:

```powershell
corepack pnpm@10.11.0 build
corepack pnpm@10.11.0 api:dev
```

Sau đó mở http://127.0.0.1:8787/. Trong terminal chạy thủ công, dùng `Ctrl+C` để dừng API hoặc Vite. Không chạy nhiều API/DB khác nhau điều phối cùng một Anvil.

## Luồng demo gợi ý

1. Chọn **On-chain Anvil**, bấm **Dùng ví thử nghiệm Anvil** và kiểm tra session còn hiệu lực.
2. **Xem kế hoạch → Chạy agent**; xem token/shares/cap thay đổi và receipt trong kết quả.
3. Chạy SC-04 (vượt cap), SC-09 (recipient lạ), SC-11 (session bị thu hồi), SC-16 (vault ngoài whitelist). Kiểm tra cả lỗi preflight, receipt revert và tài sản trước/sau.
4. Owner thu hồi session ở màn hình quỹ; kiểm tra trạng thái session trên chain và thử lệnh tiếp theo.
5. Mở lịch sử, tải JSON/CSV. Chuyển sang **Mô phỏng & Launchpad** để demo Paper Trade/Graduation/Slash.

Mỗi scenario Anvil chạy trong snapshot rồi khôi phục. Receipt/hash được ghi khi thực thi, nhưng giao dịch trên nhánh snapshot đã khôi phục có thể không còn truy vấn được ở node hiện tại. Báo cáo ghi rõ môi trường local và dữ liệu lịch sử; không tạo link explorer giả.

## Kiểm thử và bằng chứng

| Kiểm tra bản hợp nhất | Kết quả đã xác minh |
| --- | --- |
| Solidity: unit, integration, adversarial, fuzz, invariant | 65 tests PASS |
| TypeScript: agent, chain-client, lab, API, SQLite và cách ly hai chế độ | 39 tests PASS |
| Scenario mô phỏng | 10/10 PASS, được kiểm tra trong bộ TS tests |
| Scenario Anvil/API | 17/17 PASS; receipt, before/after, owner signing, export và SQLite restart |
| Playwright | 3 flows PASS: Anvil, sai mạng/hủy ký và mô phỏng/Launchpad; desktop/mobile |
| Typecheck và production build | PASS |

CI của commit hợp nhất `2fca6ed`: [Lab/API/dashboard](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44878242076), [Contracts/live agent](https://github.com/TranThanhPhu39/finance_simulator/actions/runs/44878242164).

```powershell
corepack pnpm@10.11.0 typecheck
corepack pnpm@10.11.0 test
corepack pnpm@10.11.0 build
corepack pnpm@10.11.0 contracts:test
```

Bài tích hợp Anvil cần deployment sẵn sàng và API đã dừng:

```powershell
corepack pnpm@10.11.0 local:prepare
corepack pnpm@10.11.0 lab:integration
```

Bài này kết thúc với session đã thu hồi. Trước browser tests, chuẩn bị deployment mới rồi khởi động API/Vite như trên:

```powershell
corepack pnpm@10.11.0 exec playwright install chromium
corepack pnpm@10.11.0 exec playwright test
```

`PYTH_OFFLINE=1` dùng giá fallback có nhãn để tái hiện kiểm thử; để trống biến này khi muốn lấy giá Pyth. Xem thêm [demo-guide.md](docs/demo-guide.md).

## Cấu trúc và phân công

| Đường dẫn | Trách nhiệm | Thành viên |
| --- | --- | --- |
| `contracts/` | Safe/PolicyModule, RollingSpend, deploy và kiểm thử bảo mật | Phú |
| `packages/shared/` | Policy, snapshot, plan, kiểu dữ liệu mô phỏng và kiểu `Onchain*` | Cả nhóm |
| `packages/testkit/` | Token, router, oracle và vault ERC-4626 mock | Tiến |
| `packages/chain-client/` | Đọc chain, xây/gửi giao dịch, giải mã custom errors | Tiến + Phú |
| `packages/agent/` | Đọc danh mục, thuật toán rebalance, executor và giải thích | Tiến + Phú |
| `packages/lab/` | Hai catalog/runner, assertions, evidence và Launchpad | Hoàng |
| `apps/api/` | HTTP API, SQLite, worker, idempotency và chain leases | Hoàng |
| `apps/web/` | Dashboard hai chế độ, ví owner, history và export | Hoàng |
| `docs/`, `scripts/`, `deployments/` | Đặc tả, hướng dẫn, helper và metadata | Cả nhóm |

Bối cảnh: [project_context.md](project_context.md). Tiến độ và nhật ký: [task.md](task.md).

## API, lưu dữ liệu và cấu hình

| Thành phần | Mặc định |
| --- | --- |
| API mô phỏng/Launchpad | `/api/simulation/*` |
| API Anvil | `/api/*` |
| DB mô phỏng | `.runtime/treasury-lab.sqlite` |
| DB Anvil | `.runtime/treasury.db` |
| Anvil RPC | `http://127.0.0.1:8545` |

Hai DB có schema khác nhau; không cấu hình cùng một file. `SIMULATION_DATABASE_PATH` ghi đè DB mô phỏng (hỗ trợ `SQLITE_DB_PATH` cũ); `API_DATABASE_PATH` ghi đè DB Anvil; `LOCAL_RPC_URL` đổi RPC local. Các file runtime và metadata local nằm ngoài Git.

API Anvil dùng durable queue, idempotency và khóa chain dùng chung cho worker/owner/đọc snapshot. Khi API bị gián đoạn, không tự gửi lại giao dịch chưa rõ kết quả; lượt chạy có thể bị đánh ERROR và môi trường bị khóa chờ đối chiếu. Giữ DB cũ để bảo toàn bằng chứng, xem [hướng dẫn xử lý](docs/demo-guide.md).

Thao tác cấp/thu hồi session và sửa policy trong mô phỏng chỉ thay đổi mô phỏng. Trong Anvil, owner ký giao dịch tới Safe; backend không giữ khóa owner. Session dùng tài khoản test mặc định của Anvil. Các thao tác owner trong Launchpad không gửi giao dịch tới địa chỉ fixture.

## Avalanche Fuji và hồ sơ nộp bài

**Chưa có deployment Fuji được xác minh.** Script và hướng dẫn nằm ở [fuji-deployment.md](docs/fuji-deployment.md). Chỉ ghi địa chỉ/txHash vào metadata sau khi broadcast và kiểm tra receipt thật; không điền địa chỉ mẫu làm bằng chứng. Các scenario cần reset/time-travel của Anvil trả UNSUPPORTED trên Fuji.

Theo [FAQ UniHack](https://team1vn.xyz/#faq-submit) và [biểu mẫu Submit Project](https://team1vn.xyz/dashboard.html), kiểm tra ngày 21/11/2026:

- [x] Repo GitHub để ban giám khảo xem code và hướng dẫn chạy.
- [ ] Tên dự án (tối đa 100 ký tự) và mô tả (tối đa 800 ký tự) trong form.
- [ ] Link pitch slides Canva hoặc Google Slides, cho phép xem.
- [ ] Link video demo 2–3 phút, mở được không cần đăng nhập.
- [ ] Kiểm tra tất cả liên kết và bấm **Submit project**; **Save draft chưa tính là nộp**.
- [ ] Xác minh phần tích hợp Avalanche trên Avalanche L1, Fuji hoặc C-Chain; bản Anvil local chưa thay thế phần này.

Live app, địa chỉ hợp đồng/link explorer và tài liệu bổ sung là các mục tùy chọn trong form. Nếu repo private, thêm GitHub user **`tuantqse90`** làm collaborator. BTC ghi rõ link không truy cập được có thể khiến đội bị loại. Hạn nộp được công bố: **23:59 ngày 21/11/2026, giờ Việt Nam**; [cấu hình BTC](https://team1vn.xyz/api/hack/config). Checklist trên là danh sách cần chuẩn bị, không xác nhận nhóm đã nộp hồ sơ.

## Tài liệu và giới hạn

- [Demo local](docs/demo-guide.md), [hai chế độ sau hợp nhất](docs/integration-modes.md), [API](docs/api.md), [nghiệm thu](docs/acceptance.md).
- [Policy spec](docs/policy-spec.md), [threat model](docs/threat-model.md), [interfaces](docs/interfaces.md), [bàn giao hợp đồng](docs/contract-handoff.md).

Đây là MVP thử nghiệm với tài sản mock. Lãi vault và lợi nhuận/bond/Sharpe của Launchpad là mô phỏng. Chưa được kiểm toán độc lập, chưa cấu hình auth để public API, và giao dịch nhiều bước không atomic. Giữ private key, `.env`, DB và broadcast credentials ngoài Git.
