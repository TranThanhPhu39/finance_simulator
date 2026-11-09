# Treasury Agent Lab — Bối cảnh dự án

Ngày khởi tạo: 2026-11-09 (Asia/Saigon). Trạng thái: đã dựng cây thư mục và tài liệu, chưa triển khai chức năng.

Tài liệu này lưu mục tiêu, phạm vi, kiến trúc và quy ước chung. Tiến độ thực hiện nằm trong [task.md](task.md). Khi đổi phạm vi hoặc giao diện tích hợp, cập nhật tài liệu này cùng task liên quan.

## 1. Mục tiêu và giá trị sản phẩm

Xây dựng agent tự động tái cân bằng tài sản, có hợp đồng giới hạn quyền trên Avalanche và phòng kiểm thử để chứng minh các giới hạn được thực thi.

Tài sản nằm trong smart account tích hợp Safe. Agent sử dụng session key được cấp quyền hạn chế. Mọi giao dịch của agent phải đi qua PolicyModule trước khi smart account thực thi. Owner có thể thu hồi session key.

Agent tính giao dịch bằng thuật toán theo quy tắc. LLM chỉ giải thích dữ liệu, kế hoạch và kết quả thực thi; không quyết định giao dịch, không ký lệnh và không xác định PASS/FAIL.

Phòng kiểm thử ở bản đầu chỉ đánh giá agent và PolicyModule do nhóm xây dựng. Đây là sản phẩm thử nghiệm với token thử nghiệm, chưa phải hệ thống được kiểm toán để quản lý tài sản thật.

## 2. Phạm vi bản đầu

- Một smart account, một agent, hai hoặc ba token thử nghiệm.
- Một router và một loại swap với lượng đầu vào cố định (exact-input).
- Session có thời hạn, có thể cấp và thu hồi bởi owner.
- Giới hạn tổng giá trị đầu vào giao dịch trong 24 giờ gần nhất.
- Whitelist token đầu vào/đầu ra, router và hàm được hỗ trợ.
- Token đầu ra phải về smart account; giới hạn slippage và kiểm tra nguồn giá.
- Approve đúng spender, đúng phạm vi cần thiết; agent không được tự nâng quyền.
- Khoảng 12–15 tình huống chính, thêm biến thể bằng unit/fuzz/invariant tests.
- Dashboard ba màn hình: Quỹ và chính sách; Chạy kiểm thử; Kết quả.
- Local có thể triển khai/nạp/reset để chạy lại; Fuji dùng cho luồng demo được hỗ trợ.
- Lưu lượt chạy vào SQLite và xuất báo cáo JSON/CSV.

Chưa đưa vào bản đầu: nhiều agent/smart account, nhiều DEX, chiến lược giao dịch do LLM quyết định, giao dịch tùy ý và kiểm thử sản phẩm bên thứ ba.

## 3. Ví dụ mục tiêu hoạt động

Danh mục thử nghiệm 1.000 USD, tỷ trọng mục tiêu stablecoin/token A/token B là 60%/30%/10%. Agent xem xét tái cân bằng khi độ lệch lớn hơn 5 điểm phần trăm. Cap ví dụ là 100 USD trong 24 giờ gần nhất.

Các con số trên là cấu hình demo, không phải hằng số bắt buộc. Kế hoạch có thể chỉ tái cân bằng một phần do hạn mức còn lại. Không ép đạt ngay tỷ trọng mục tiêu bằng cách vượt chính sách.

## 4. Kiến trúc và ranh giới trách nhiệm

```text
Owner wallet ── ký cấp/thu hồi session, sửa policy ──> Safe / PolicyModule

Web ──> API + worker ──> Agent hoặc Lab ──> Chain client
                                             │
                                             v
                        Session key ──> PolicyModule ──> Safe ──> Router
                                             │                    │
                                             └── receipt/state ──┘
                                                      │
                                                      v
Web <── API + SQLite <── RunResult + assertions + bằng chứng

LLM explanation <── dữ liệu có cấu trúc từ kế hoạch và kết quả thực tế
```

| Khối | Trách nhiệm | Không được thay thế |
| --- | --- | --- |
| Contracts | Xác thực session, kiểm tra policy và thực thi giới hạn on-chain | Không dựa vào kiểm tra ở UI/agent để bảo vệ tiền |
| Chain client | Đọc trạng thái, xây/gửi giao dịch được hỗ trợ, đọc receipt và giải mã lỗi | Không cung cấp đường gọi tùy ý để agent bỏ qua policy |
| Agent | Đọc danh mục, lập kế hoạch theo quy tắc, thực thi và giải thích | Không có quyền quản trị owner |
| Lab | Dựng tình huống, chạy, kiểm tra trạng thái trước/sau và tổng hợp bằng chứng | Không coi thông báo UI là bằng chứng on-chain |
| API/worker | Validate đầu vào, điều phối, khóa môi trường dùng chung, lưu kết quả | Không tự tính lại chiến lược hoặc thay hợp đồng quyết định quyền |
| Web | Thao tác ví owner, chính sách, tiến trình và báo cáo | Không hiển thị hash giả hoặc thành công trước khi xác nhận |

## 5. Stack dự kiến

| Thành phần | Lựa chọn |
| --- | --- |
| Smart account | Safe, tích hợp PolicyModule |
| Hợp đồng / kiểm thử | Solidity + Foundry |
| Blockchain local | Anvil |
| Mạng demo | Avalanche Fuji |
| Agent / lab / API / chain client | TypeScript |
| Dashboard | React |
| Lưu kết quả | SQLite |
| Quản lý monorepo | Dự kiến pnpm workspaces |

Phiên bản dependency, framework API, thư viện blockchain và framework kiểm thử TypeScript chưa chốt. Khung hiện tại chưa có manifest, dependency hoặc lệnh chạy ứng dụng; sẽ bổ sung trong task SET-02.

## 6. Cây thư mục và quyền sở hữu

```text
uni_hackathon/
├── README.md                     # Hướng dẫn đọc repo và cây thư mục
├── project_context.md            # Bối cảnh, phạm vi, quyết định chung
├── task.md                       # Tiến độ, phụ thuộc, nhật ký bàn giao
├── .gitignore
├── contracts/                    # Người 1 — hợp đồng và bảo mật
│   ├── src/
│   │   ├── interfaces/
│   │   └── libraries/
│   ├── test/
│   │   ├── unit/
│   │   ├── integration/
│   │   ├── fuzz/
│   │   └── invariant/
│   └── script/                   # Script quản trị/cài đặt hợp đồng
├── packages/
│   ├── shared/                   # Cả nhóm — schema, mã lỗi, fixture
│   │   ├── src/
│   │   └── fixtures/
│   ├── chain-client/             # Người 2 — công cụ blockchain
│   │   ├── src/abi/              # ABI xuất từ contracts
│   │   └── test/
│   ├── testkit/                  # Người 2 — môi trường thử nghiệm
│   │   ├── contracts/            # Mock token, giá, router và router lỗi
│   │   ├── src/                  # Deploy/seed/reset qua chain client
│   │   └── test/
│   ├── agent/                    # Người 2 — agent và explanation
│   │   ├── src/
│   │   └── test/
│   └── lab/                      # Người 3 — bộ chạy kiểm thử
│       ├── src/
│       │   ├── scenarios/
│       │   ├── adapters/         # Khả năng local/Fuji
│       │   ├── assertions/
│       │   └── evidence/
│       └── test/
├── apps/
│   ├── api/                      # Người 3 — backend và SQLite
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── worker/
│   │   │   └── db/migrations/
│   │   └── test/
│   └── web/                      # Người 3 — dashboard ba màn hình
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── api/
│       │   └── wallet/
│       └── test/
├── deployments/                  # Metadata triển khai, không chứa khóa
├── scripts/                      # Điều phối, export ABI, smoke test
├── docs/                         # Đặc tả, threat model, demo guide
└── .github/workflows/             # CI sau khi có toolchain
```

Thư mục chưa có nội dung dùng `.gitkeep` để giữ cấu trúc khi đưa lên Git. `testkit/contracts` chứa Solidity mock dùng cho thử nghiệm; task SET-02 cần cấu hình Foundry để build/import được các mock này, không sao chép thành hai nguồn riêng.

## 7. Phân công ba người

Phân công theo bản trong tin nhắn mới nhất. Tên lấy từ file đính kèm: Người 1 = Phú; Người 2 = Tiến; Người 3 = Hoàng. So với file đính kèm, lab chuyển sang Người 3; chain client và môi trường thử nghiệm chuyển sang Người 2. Nếu nhóm đổi lại người phụ trách, cập nhật bảng này và cột Owner trong task.md cùng lúc.

| Thành viên | Phụ trách chính | Bàn giao | Kiểm tra chéo |
| --- | --- | --- | --- |
| Phú — Người 1 | Safe, PolicyModule, bảo mật hợp đồng | Contract, ABI/error, unit/integration/fuzz/invariant tests | Review độ bao phủ đường vượt quyền của lab |
| Tiến — Người 2 | Testkit, chain client, agent, LLM explanation | Deploy/seed/reset, reader/executor, receipt, agent chạy xuyên suốt | Đối chiếu API/dashboard với giao dịch thực |
| Hoàng — Người 3 | Lab, API/worker, SQLite, dashboard, export | Scenario runner có bằng chứng, ba màn hình, lịch sử/báo cáo | Cài lại theo tài liệu và chạy toàn bộ demo |

Schema và đặc tả là trách nhiệm chung. Giảm việc phụ cho Phú để dành thời gian kiểm tra bảo mật. Hoàng ưu tiên một scenario xuyên suốt trước khi mở rộng dashboard và cả bộ lab; Tiến cung cấp fixture và công cụ chain để Hoàng không phải tự viết lại tích hợp.

## 8. Giao diện dữ liệu cần chốt trước khi code song song

Các cấu trúc dưới đây là danh mục cần thiết kế, chưa phải schema đã triển khai. Nguồn dùng chung sẽ ở `packages/shared/src/`; fixture ở `packages/shared/fixtures/`.

| Cấu trúc | Nội dung tối thiểu cần thống nhất |
| --- | --- |
| PolicyConfig | Account/network, session và thời hạn, cap/window, token/router/function whitelist, recipient, slippage, điều kiện nguồn giá |
| PortfolioSnapshot | Account, chain/block/timestamp, số dư raw, decimals, giá, giá trị và tỷ trọng |
| RebalancePlan | ID, snapshot/policy tham chiếu, NO_ACTION/READY/BLOCKED, giao dịch exact-input, lý do |
| ScenarioDefinition | ID/version, loại kiểm thử, môi trường hỗ trợ, setup, bước chạy và assertions mong đợi |
| RunResult | ID/version, environment, policy snapshot, tiến trình, verdict, steps, assertions, before/after, lỗi và bằng chứng giao dịch |
| ErrorCode | Mã lỗi chung, ánh xạ từ contract revert, lỗi RPC/môi trường và lỗi ứng dụng |

Quy ước cần giữ:

- JSON truyền lượng token và số nguyên lớn dưới dạng chuỗi số nguyên; tính toán dùng số nguyên/BigInt, không dùng số thực cho lượng token.
- Tỷ lệ dùng basis points: 100 bps = 1%; tổng tỷ trọng mục tiêu = 10.000 bps; lệch 5 điểm phần trăm = 500 bps.
- Đơn vị USD, scale giá, làm tròn và decimals cần chốt trong đặc tả trước khi viết cap.
- Phân biệt trạng thái tiến trình (queued/running/completed…) với kết luận kiểm thử.
- Kết luận: PASS = đủ bằng chứng đáp ứng kỳ vọng; FAIL = quan sát trái kỳ vọng; ERROR = lỗi môi trường/thiếu bằng chứng; UNSUPPORTED = môi trường không hỗ trợ tình huống.
- Nếu chưa gửi giao dịch thì không có txHash; ghi rõ lỗi preflight/simulation hoặc thiếu dữ liệu.
- Ghi nguồn hành động: agent theo quy tắc, lệnh do test harness sửa, hoặc lệnh sai gửi trực tiếp bằng session key. Hai loại sau không phải bằng chứng prompt injection vào LLM.
- Bằng chứng cần chỉ rõ network, block, thời gian, phiên bản scenario và policy tại lượt chạy. Fixture phải được ghi là dữ liệu mẫu.

Các hàm tích hợp dự kiến:

```text
Chain client: readPolicy, readSession, readRemainingCap, readPortfolioBalances,
              buildSwapTransaction, buildGrantSessionTransaction,
              buildRevokeSessionTransaction, decodePolicyError
Agent:        previewRebalance, runRebalance
Lab:          listScenarios, runScenario, runSuite
```

API dự kiến: `GET /environment`, `GET /treasury`, `POST /rebalance/preview`, `GET /scenarios`, `POST /runs`, `GET /runs/:id`, `GET /runs/:id/export`. Bảng SQLite dự kiến: `runs`, `run_steps`, `assertions`, `transaction_evidence`. Chi tiết request/response cần được chốt ở task SPE-03.

## 9. Luồng hoạt động

**Sử dụng bình thường:** Owner kết nối ví và chuẩn bị Safe → nạp token thử nghiệm → đặt policy/tỷ trọng → cấp session → agent đọc số dư/giá → lập kế hoạch → gửi qua module → kiểm tra policy và swap → đọc receipt/trạng thái → cập nhật dashboard và giải thích.

**Phòng kiểm thử:** Chọn scenario → dựng trạng thái → snapshot trước → chạy agent hoặc lệnh thử vượt quyền → thu receipt/lỗi → snapshot sau → assertions → lưu kết quả và hiển thị PASS/FAIL/ERROR/UNSUPPORTED.

Ví dụ recipient lạ: PASS chỉ khi chứng minh lệnh bị từ chối và số dư token của ví lạ không tăng. Với lệnh bị chặn, kiểm tra thêm tài sản smart account và cap không đổi. Phí gas của người gửi cần tách khỏi số dư token được bảo vệ.

## 10. Các quyết định còn phải chốt

| ID | Cần chốt | Người dẫn dắt |
| --- | --- | --- |
| D-01 | Phiên bản Safe, cơ chế enable module và xác thực session; cách ngăn đường vòng thực thi | Phú |
| D-02 | Cap theo account hay session; lịch sử cap khi đổi/thu hồi session hoặc sửa policy | Phú + Tiến |
| D-03 | Rolling 24 giờ thực sự, biên timestamp, lưu/prune lịch sử, giới hạn gas; không tự đổi thành reset theo ngày | Phú |
| D-04 | Nguồn giá local/Fuji, scale USD, decimals/làm tròn, max age, xử lý dữ liệu lỗi | Phú + Tiến |
| D-05 | Router/hàm exact-input, minOut so với giá tham chiếu, deadline, allowance và cleanup | Phú + Tiến |
| D-06 | Thuật toán ưu tiên cặp swap, xử lý cap còn lại và tái cân bằng một phần | Tiến |
| D-07 | Schema/API/version, error mapping, quy tắc kết luận và phạm vi scenario trên Fuji | Cả nhóm |
| D-08 | Phiên bản toolchain, thư viện, lệnh chạy và CI | Cả nhóm |

Ghi kết luận ngay tại đây hoặc trong tài liệu `docs/` có liên kết, kèm ngày và task liên quan. Chưa coi một quyết định là đã duyệt chỉ vì nó xuất hiện trong ví dụ.

## 11. Tiêu chí nghiệm thu chung

1. Chạy được một swap hợp lệ bằng session key qua PolicyModule; số dư thay đổi đúng.
2. Lệnh vượt quyền bị chặn với bằng chứng token, recipient và cap trước/sau.
3. Nhiều lệnh nhỏ không vượt được tổng cap; có kiểm tra biên rolling 24 giờ.
4. Owner thu hồi session; session đó không thực thi được giao dịch mới.
5. Router lỗi không làm sai tài sản token, cap hoặc để allowance ngoài chính sách.
6. Agent không tự nâng quyền, không gọi tùy ý, không đổi recipient ra ngoài account.
7. Lab chạy lại được, không nhiễm trạng thái giữa scenarios và không nhầm lỗi RPC thành PASS.
8. Dashboard hiển thị dữ liệu thực, lưu lịch sử qua reload, xuất được JSON/CSV.
9. Local được reset có kiểm soát; Fuji chỉ chạy chức năng hỗ trợ và báo cáo đúng mạng.
10. Thành viên khác cài từ hướng dẫn, chạy demo được; chỉ ghi địa chỉ/hash triển khai có thật.

## 12. Quy tắc phối hợp

- Trước khi code: nhận task và cập nhật Owner/Status trong task.md; kiểm tra dependency.
- Sau mỗi phiên: ghi phần đã làm, file/commit hoặc PR, cách kiểm chứng, blocker và bước tiếp theo vào nhật ký task.md.
- DONE cần đáp ứng đầu ra của task và có bằng chứng kiểm chứng phù hợp. Tài liệu/khung thư mục không đồng nghĩa chức năng đã hoàn thành.
- Thay schema/ABI phải thông báo cho phần phụ thuộc, cập nhật fixture và tài liệu liên quan.
- Owner ký thao tác quản trị qua ví; backend không giữ khóa owner. Session key và khóa local không đưa vào Git, báo cáo hoặc log công khai.
- Worker khóa tài nguyên local dùng chung; snapshot/reset/tua thời gian không được vô tình áp dụng cho Fuji.
- LLM lỗi có giải thích mẫu; kết luận và bằng chứng do chương trình xác định vẫn giữ nguyên.
