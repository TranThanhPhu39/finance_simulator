# Treasury Agent Lab — Theo dõi công việc

Cập nhật lần đầu: 2026-11-09 (Asia/Saigon).

Bối cảnh và phân công: [project_context.md](project_context.md). File này là nơi nhóm cập nhật đã code tới đâu, đang làm gì, đang vướng gì và bàn giao cho ai.

## 1. Cách sử dụng

1. Chọn task, đổi Status thành IN_PROGRESS và ghi vào bảng hiện tại của thành viên.
2. Sau mỗi phiên làm việc, cập nhật task và thêm một dòng nhật ký: đã làm gì, đường dẫn/commit, kiểm chứng, vướng mắc, bước tiếp theo.
3. Cần người khác kiểm tra thì chuyển REVIEW, ghi reviewer và link bằng chứng. Chỉ chuyển DONE khi đạt tiêu chí của task.
4. Bị vướng thì dùng BLOCKED, ghi dependency cụ thể và người cần hỗ trợ; không chỉ ghi “chưa xong”.
5. Khi đổi phân công, cập nhật Owner ở đây và project_context.md. Thêm task mới với ID duy nhất, không đổi ID đã được tham chiếu.

| Status | Ý nghĩa |
| --- | --- |
| TODO | Chưa bắt đầu |
| IN_PROGRESS | Đang thực hiện |
| BLOCKED | Đang vướng, cần ghi rõ lý do |
| REVIEW | Đã có đầu ra, chờ kiểm tra |
| DONE | Đạt tiêu chí, có bằng chứng kiểm chứng |

Không dùng PASS/FAIL của scenario làm trạng thái task. Không tự ghi tiến độ phần trăm khi chưa có bằng chứng. Các task phụ thuộc vẫn để TODO cho đến khi được nhận thực hiện hoặc xác nhận đang BLOCKED.

## 2. Hiện tại từng thành viên đang làm gì?

| Thành viên | Phạm vi | Task đang làm | Đã có | Vướng mắc | Bước tiếp theo | Cập nhật |
| --- | --- | --- | --- | --- | --- | --- |
| Phú — Người 1 | Contracts và bảo mật | SPE-01, SPE-02, CON-01 đến CON-07: REVIEW; ENV-03: BLOCKED | Safe/module + live agent integration; 65 Solidity + 22 TS tests PASS | Fuji chưa có ví testnet được cấu hình | Tiến/Hoàng review nhánh feat/phu-policy-module; cấu hình ví thử nghiệm cho Fuji | 2026-11-14 |
| Tiến — Người 2 | Testkit, chain client, agent | CHN-01, AGT-01, AGT-02: REVIEW cùng Phú | Planner cap swap-only, typed vault requests, decoder và reader/executor đã chạy local | Cần review chiến lược và durable dedup khi ghép backend | Xem docs/interfaces.md và docs/contract-handoff.md | 2026-11-14 |
| Hoàng — Người 3 | Lab, API, web | Chưa nhận | Khung thư mục | Chưa ghi nhận | Cùng chốt SPE-03; nhận LAB-01 | 2026-11-09 |

Tên lấy từ file đính kèm; phạm vi theo tin nhắn mới nhất. Có code ban đầu của Tiến và phần hợp đồng local của Phú; chưa đánh dấu DONE toàn bộ task thành viên khi chưa kiểm chứng đủ tiêu chí tích hợp. REVIEW nghĩa là đã có đầu ra để kiểm tra, chưa phải đã được thành viên khác duyệt.

## 3. Mốc tích hợp chung

| Mốc | Đạt khi | Status |
| --- | --- | --- |
| M1 — Đặc tả và nền tảng | Có policy spec, schema, fixture, scenario catalog và toolchain | IN_PROGRESS |
| M2 — Luồng xuyên suốt | Web → API → agent → module → swap local → số dư mới | TODO |
| M3 — Kiểm soát quyền | Vi phạm bị chặn; có assertions về tài sản/quyền/cap | TODO |
| M4 — Phòng kiểm thử | Chạy bộ scenarios, lưu lịch sử, mở lại và xuất báo cáo | TODO |
| M5 — Fuji | Demo luồng được hỗ trợ trên Avalanche Fuji, có bằng chứng thật | TODO |
| M6 — Bàn giao | Người khác cài lại, chạy demo theo tài liệu và quay video | TODO |

## 4. Backlog và tiêu chí hoàn thành

### Khởi tạo và đặc tả — cả nhóm

| ID | Công việc / tiêu chí DONE | Owner | Phụ thuộc | Status |
| --- | --- | --- | --- | --- |
| SET-01 | Tạo cây thư mục, project_context.md, task.md và hướng dẫn đọc repo | Khởi tạo bởi Codex | — | DONE |
| SET-02 | Chốt toolchain; tạo workspace/manifests, Foundry config, import mock từ testkit, .env.example; có lệnh cài/build/test được kiểm tra | Cả nhóm | SET-01 | IN_PROGRESS |
| SPE-01 | Viết docs/policy-spec.md: session, cap/scope/biên 24h, whitelist, recipient, giá/scale, minOut và approve | Phú + Tiến | SET-01 | REVIEW |
| SPE-02 | Viết docs/threat-model.md: trust boundary, lộ session key, caller sai, đường vòng Safe/module, router xấu, quản trị | Phú | SPE-01 | REVIEW |
| SPE-03 | Chốt schema ở shared, error codes và docs/interfaces.md; có fixture hợp lệ cho policy/snapshot/plan/scenario/result | Cả nhóm | SPE-01 | IN_PROGRESS |
| SPE-04 | Chốt 15 scenarios bên dưới, khả năng local/Fuji và docs/acceptance.md | Hoàng + Phú | SPE-01, SPE-03 | TODO |
| SPE-05 | Chốt D-09 (nguồn lãi, interface vault, mock hay fork mainnet) và D-10 (phạm vi MVP); viết docs/yield-sources.md có nguồn kiểm chứng cho pitch | Cả nhóm | SET-01 | TODO |

### Người 1 — Phú: hợp đồng và bảo mật

| ID | Công việc / tiêu chí DONE | Owner | Phụ thuộc | Status |
| --- | --- | --- | --- | --- |
| CON-01 | Tích hợp Safe và PolicyModule tối thiểu; có unit/integration chứng minh session hợp lệ swap được | Phú | SET-02, SPE-01, ENV-01 | REVIEW |
| CON-02 | Grant/expiry/revoke/caller; owner-only policy update; agent không tự nâng quyền; tests cho từng nhánh | Phú | CON-01 | REVIEW |
| CON-03 | Kiểm tra token/router/vault/function/recipient; chỉ hỗ trợ swap và gửi/rút vault đã chốt; vault ngoài whitelist hoặc rút về ví lạ bị chặn | Phú | CON-01, SPE-02, SPE-05 | REVIEW |
| CON-04 | Rolling cap theo spec, cộng dồn và biên 24h; không reset sai khi đổi session/policy; tests tương ứng | Phú | CON-02, SPE-01 | REVIEW |
| CON-05 | Giá/độ mới/minOut/slippage, approve đúng spender (router hoặc vault)/phạm vi; router/vault revert rollback đúng | Phú | CON-03, CON-04, ENV-01 | REVIEW |
| CON-06 | Unit/integration/fuzz/invariant các đường đi của tiền; không có đường agent bypass; lưu kết quả kiểm chứng | Phú | CON-02, CON-03, CON-04, CON-05 | REVIEW |
| CON-07 | Bàn giao ABI, event/custom error, interface quản trị/đọc trạng thái và review tương thích chain-client | Phú | CON-01, SPE-03 | REVIEW |

CON-07 có thể bàn giao bản tối thiểu sau CON-01, rồi cập nhật cùng CON-02 đến CON-05; không chờ hoàn thiện mọi tính năng mới tích hợp.

Cập nhật phần Phú 2026-11-14: CON-01 đến CON-07 đã có triển khai và tích hợp agent local, chờ review của nhóm. Bằng chứng ở [contract-validation](docs/contract-validation.md), giao diện ở [contract-handoff](docs/contract-handoff.md). Chưa xác nhận Fuji, chưa hoàn thành lab/API/web; các task SC bên dưới vẫn TODO vì đây là tiến độ runner của Hoàng, không phải bộ Solidity tests.

### Người 2 — Tiến: môi trường, chain client và agent

| ID | Công việc / tiêu chí DONE | Owner | Phụ thuộc | Status |
| --- | --- | --- | --- | --- |
| ENV-01 | Mock token/price/router/router lỗi và 1–2 mock vault sinh lời theo thời gian (stablecoin cho vay, sAVAX/RWA); triển khai và nạp local, đọc được số dư và vị thế vault | Tiến | SET-02, SPE-01, SPE-05 | TODO |
| ENV-02 | Script deploy/seed/reset, snapshot/time controls local; metadata deployment; người khác chạy lại được | Tiến | ENV-01, CON-01 | TODO |
| CHN-01 | Đọc policy/session/cap/balances, xây lệnh swap/grant/revoke, gửi/chờ receipt và decode lỗi | Tiến | SPE-03, CON-07 | REVIEW |
| AGT-01 | Thuật toán bằng fixture: tỷ trọng/độ lệch (tính cả tài sản trong vault), NO_ACTION/READY/BLOCKED, cap còn lại, số nguyên; kế hoạch gồm swap và gửi/rút vault; có kiểm thử hành vi | Tiến | SET-02, SPE-03, SPE-05 | REVIEW |
| AGT-02 | Reader và executor dùng chain-client; một chu kỳ tái cân bằng thật; chống gửi trùng, xử lý revert | Tiến | AGT-01, CHN-01, CON-01 | REVIEW |
| AGT-03 | LLM giải thích dữ liệu/kết quả thật; có fallback và không ảnh hưởng giao dịch hoặc verdict | Tiến | AGT-02 | TODO |
| ENV-03 | Cấu hình/script deploy Fuji; xác minh địa chỉ, token thử nghiệm và capability; bàn giao hướng dẫn | Tiến + Phú | CON-06, ENV-02, CHN-01 | BLOCKED |
| ENV-04 | (Tùy chọn, ăn điểm) Fork mainnet Avalanche trên Anvil để chạy gửi/rút với vault thật (Aave/Benqi); ghi rõ block fork | Tiến | ENV-02, SPE-05 | TODO |

### Người 3 — Hoàng: lab, backend và dashboard

| ID | Công việc / tiêu chí DONE | Owner | Phụ thuộc | Status |
| --- | --- | --- | --- | --- |
| LAB-01 | Định nghĩa ScenarioDefinition, bước/setup/expectation; phân biệt agent/direct session/mutated command | Hoàng | SPE-03, SPE-04 | TODO |
| LAB-02 | Runner một scenario local qua testkit/chain-client; có tiến trình, before/after và assertions | Hoàng | LAB-01, ENV-02, CHN-01 | TODO |
| LAB-03 | Chạy cả bộ độc lập, reset an toàn, ghi evidence; verdict đúng PASS/FAIL/ERROR/UNSUPPORTED | Hoàng | LAB-02, CON-06 | TODO |
| LAB-04 | Adapter Fuji khai báo capability; bỏ qua tình huống không hỗ trợ đúng verdict; không dùng thao tác local trên Fuji | Hoàng | LAB-03, ENV-03 | TODO |
| API-01 | API theo schema và SQLite/migrations; tạo/xem lại run mẫu, steps/assertions/evidence | Hoàng | SET-02, SPE-03 | TODO |
| API-02 | Worker gọi agent/lab thật, quản lý tiến trình và khóa local dùng chung; lỗi không làm mất run | Hoàng | API-01, LAB-02, AGT-02 | TODO |
| WEB-01 | Ba màn hình dùng fixture chung: quỹ/chính sách (gồm vị thế vault và lãi tích lũy), chạy kiểm thử, kết quả; ghi rõ dữ liệu mẫu | Hoàng | SET-02, SPE-03 | TODO |
| WEB-02 | Nối API thật, progress/history/evidence, refresh còn lịch sử; không hiển thị bằng chứng giả | Hoàng | WEB-01, API-02 | TODO |
| WEB-03 | Ví owner cấp/thu hồi session/sửa policy qua chain client; xử lý sai mạng, hủy ký, pending/revert | Hoàng | WEB-02, CHN-01, CON-02 | TODO |
| REP-01 | Export JSON/CSV gồm environment/version/policy/steps/assertions/before-after/tx; kiểm tra tải lại báo cáo | Hoàng | LAB-03, API-01 | TODO |

### Tích hợp, kiểm tra chéo và bàn giao

| ID | Công việc / tiêu chí DONE | Owner | Phụ thuộc | Status |
| --- | --- | --- | --- | --- |
| INT-01 | Smoke test local từ web đến swap và số dư thật; có hướng dẫn/đầu ra kiểm chứng | Cả nhóm | WEB-02, API-02, AGT-02 | TODO |
| REV-01 | Review scenario coverage và đường vượt quyền; ghi phát hiện, task sửa và kết quả kiểm tra lại | Phú | LAB-03, CON-06 | TODO |
| REV-02 | Đối chiếu API/UI/export với receipt, state và lỗi thật; ghi sai lệch và kết quả sửa | Tiến | WEB-03, REP-01 | TODO |
| QUA-01 | CI chạy các check phù hợp; kiểm thử API/UI cho success, fail, wrong network, cancel và lỗi môi trường | Cả nhóm | CON-06, LAB-03, WEB-03 | TODO |
| DOC-01 | README có lệnh cài/chạy/test thật, cấu hình local/Fuji, docs/demo-guide.md và giới hạn hỗ trợ | Cả nhóm | INT-01, ENV-03, LAB-04, REP-01 | TODO |
| REV-03 | Cài từ đầu trên máy khác theo README, chạy demo, đối chiếu bằng chứng và ghi kết quả | Hoàng | DOC-01, REV-01, REV-02, QUA-01 | TODO |
| DEM-01 | Quay demo: swap đúng, chặn vi phạm, thu hồi session, xem/export bằng chứng; thông tin deployment đúng | Cả nhóm | REV-03 | TODO |

## 5. Danh sách tình huống kiểm thử chính

Đây là kế hoạch, chưa có scenario nào được triển khai/chạy. Cột MVP đánh dấu tình huống bắt buộc cho demo (đề xuất D-10); các tình huống khác làm sau khi MVP chạy ổn. Các biến thể dùng cùng ID cha hoặc thêm ID mới trong catalog khi chốt SPE-04.

| ID | Tình huống | Bằng chứng/kỳ vọng tối thiểu | MVP | Status |
| --- | --- | --- | --- | --- |
| SC-01 | Danh mục chưa cần rebalance | NO_ACTION; không gửi giao dịch; số dư/cap không đổi |  | TODO |
| SC-02 | Tái cân bằng hợp lệ | Receipt thành công; token đầu ra (và shares vault nếu có) về Safe; số dư/cap đúng | ✔ | TODO |
| SC-03 | Giao dịch đúng phần cap còn lại | Thành công tại biên; tổng chi không vượt cap |  | TODO |
| SC-04 | Một lệnh vượt cap | Từ chối; token/cap không đổi | ✔ | TODO |
| SC-05 | Chia nhỏ vượt tổng cap | Với cap 100 USD: 60 và 30 thành công, 20 bị chặn; cap dùng 90 USD |  | TODO |
| SC-06 | Biên rolling 24 giờ | Kiểm tra ngay trước/đúng/sau biên theo spec; phần chi hết hiệu lực đúng lúc |  | TODO |
| SC-07 | Token ngoài whitelist | Cả biến thể tokenIn và tokenOut bị từ chối; không mất token | ✔ | TODO |
| SC-08 | Router/hàm ngoài phạm vi | Các biến thể router/selector sai bị chặn; tài sản/allowance không sai |  | TODO |
| SC-09 | Recipient là ví lạ | Bị từ chối; token ví lạ không tăng; Safe/cap không đổi | ✔ | TODO |
| SC-10 | Session hết hạn | Không có swap mới; token/cap không đổi |  | TODO |
| SC-11 | Session đã thu hồi | Owner revoke thành công; lệnh tiếp theo bị chặn; token/cap không đổi | ✔ | TODO |
| SC-12 | Caller chưa được cấp quyền | Không thực thi được; không sửa được policy; token/cap không đổi |  | TODO |
| SC-13 | Nguồn giá cũ/lỗi | Bị từ chối theo spec; không ghi nhận là lỗi RPC chặn thành công |  | TODO |
| SC-14 | Đầu ra thấp/slippage sai | Chặn minOut không đạt policy hoặc revert khi output thiếu; tài sản/cap rollback |  | TODO |
| SC-15 | Router lỗi và kiểm soát approve | Gây revert; token/cap rollback; không còn allowance ngoài chính sách; biến thể spender sai bị chặn |  | TODO |
| SC-16 | Gửi vào vault ngoài whitelist | Bị từ chối; tài sản Safe/cap không đổi; không còn allowance cho vault lạ | ✔ | TODO |
| SC-17 | Rút vault về ví lạ | Bị từ chối; token ví lạ không tăng; shares vault của Safe không đổi |  | TODO |

Kiểm thử bổ sung ở cấp contract: admin trái phép, replay/reentrancy nếu kiến trúc liên quan, đổi session/policy để lách cap, decimals/làm tròn, giới hạn lịch sử chi và các invariant. Không gộp lỗi môi trường vào PASS. Với scenario cần tua thời gian/reset hoặc router gây lỗi, capability Fuji phải được xác nhận trước khi chạy.

## 6. Nhật ký cập nhật sau mỗi phiên

Thêm dòng mới lên đầu. Ngày giờ dùng Asia/Saigon. Link file ghi theo đường dẫn tương đối trong repo; có commit/PR thì bổ sung. Lệnh kiểm chứng phải đi cùng kết quả; không ghi “đã test” chung chung.

| Ngày giờ | Người cập nhật | Task | Đã làm / file hoặc commit | Kiểm chứng | Vướng mắc / bàn giao / bước tiếp |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | Phú qua Codex | CON-06/07, SPE-03, CHN-01, AGT-01/02, ENV-03 | Bổ sung tests disabled module/zero cap/vault asset/ring wrap; đồng bộ typed schema v0.2, cap swap-only, cash/minOut, block reader, signed executor, ABI decoder; fixture chung; script Fuji và CI live agent; nhánh feat/phu-policy-module | 65 Solidity tests PASS; typecheck + 22 TS tests PASS; live agent swap/deposit/withdraw, duplicate request và revoke PASS; RPC Fuji trả 43113, script build thành công | Mapping BLK-001 đã xử lý; cần nhóm review; Fuji chưa broadcast vì thiếu ví testnet (BLK-002); backend cần persist/lock signer |
| 2026-11-14 | Phú qua Codex | SPE-01, SPE-02, CON-01 đến CON-07 | PolicyModule + RollingSpend, Safe thật v1.4.1, ERC-4626 controls, tests, script local, ABI, spec/threat model/handoff; ghim OZ v5.2.0 thay remapping 5.7 cần Osaka; thêm CI hợp đồng | forge test -vv: 61 PASS/0 FAIL; fuzz 256/test, invariant 64x32/test; local deploy 19 receipt và smoke 7 tx PASS với đúng custom error + số dư/shares/cap/allowance; format và ABI export PASS; docs/contract-validation.md | REVIEW: Tiến đồng bộ cap swap-only, assets/maxShares/deadline và error decode; Hoàng làm runner; chưa kiểm chứng CI GitHub/Fuji |
| 2026-11-11 | Hoàng | SPE-05 (đề xuất) | Định hướng lại thành quản lý quỹ sinh lời trên Avalanche; thêm gửi/rút vault vào phạm vi, mục pitch 3a, D-09, D-10; cập nhật ENV-01, CON-03, CON-05, AGT-01, WEB-01; thêm SPE-05, ENV-04, SC-16, SC-17 và cột MVP; path: project_context.md, task.md, README.md | Chỉ sửa tài liệu, chưa có code để chạy | Chờ Phú và Tiến duyệt nhánh; họp chốt D-09/D-10 rồi chia lại việc |
| 2026-11-09 | Codex | SET-01 | Dựng thư mục; tạo README.md, project_context.md, task.md, .gitignore | Đối chiếu cây thư mục, link tài liệu nội bộ và trạng thái khởi tạo; chưa có code chức năng để chạy test | Cả nhóm nhận task đặc tả và SET-02 |

Mẫu sao chép vào bảng trên:

```text
| YYYY-MM-DD HH:mm | Tên | TASK-ID | Đã hoàn thành gì; path; commit/PR | Lệnh/thao tác + kết quả; link bằng chứng | Blocker cụ thể; người nhận bàn giao; bước tiếp theo |
```

## 7. Blocker và thay đổi cần phối hợp

Đã có điểm cần phối hợp tích hợp bên dưới. Các lựa chọn triển khai local ở policy-spec.md chưa thay thế việc nhóm review các quyết định D-01 đến D-10.

Khi có blocker/thay đổi schema, thêm dòng theo mẫu:

| ID | Task ảnh hưởng | Nội dung / cách tái hiện | Cần ai xử lý | Hướng xử lý / kết luận | Status |
| --- | --- | --- | --- | --- | --- |
| BLK-001 | SPE-03, CHN-01, AGT-02, CON-07 | Schema/planner cap/vault requests/error mapping chưa khớp contract | Tiến + Phú | Đã đồng bộ v0.2 và chạy live local; xem docs/interfaces.md, vẫn cần nhóm review | RESOLVED |
| BLK-002 | ENV-03, M5 | Chưa cấu hình FUJI_DEPLOYER_PRIVATE_KEY và SESSION_ADDRESS của ví thử nghiệm; RPC đúng chain 43113 | Người giữ ví testnet + Phú/Tiến | Cấu hình khóa trên máy, không gửi trong chat; có AVAX test rồi chạy docs/fuji-deployment.md | OPEN |
| BLK-xxx | TASK-ID | Mô tả cụ thể | Tên | Bước tiếp theo hoặc link quyết định | OPEN / RESOLVED |

Dòng BLK-xxx là mẫu, không phải blocker đang tồn tại. Không lưu private key, mnemonic hoặc nội dung bí mật vào nhật ký và báo cáo.
