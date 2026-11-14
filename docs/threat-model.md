# Threat model phần hợp đồng

Ngày: 2026-11-14. Phạm vi: PolicyModule v0.1 và đường thực thi qua Safe trong môi trường local. Chưa phải báo cáo kiểm toán bảo mật.

## Tài sản và bên được tin cậy

Tài sản cần bảo vệ: token và shares của Safe; quyền quản trị; hạn mức chi; allowance và trạng thái session.

Owner/threshold Safe được tin cậy. Owner có thể chủ động chuyển tiền, sửa policy, whitelist hoặc enable module khác; PolicyModule không giới hạn quyền owner hay bảo vệ khỏi một module khác do owner bật. Module và price source được gắn cố định khi triển khai.

Whitelist là quyết định tin cậy: token, router, vault và oracle phải được review. Kiểm tra balance delta giảm một số sai phạm nhưng không thể chứng minh mọi báo cáo balance/giá của hợp đồng độc hại là thật. Mock mint/price setters công khai chỉ phục vụ demo; không dùng làm oracle/tài sản production.

## Các đường tấn công và biện pháp

| Đường tấn công | Biện pháp | Bằng chứng local |
| --- | --- | --- |
| Session key bị lộ hoặc agent gửi lệnh sai | Session expiry/revoke/pause; mọi thao tác vẫn qua policy | Unit tests session và kill switch |
| Session tự nâng quyền hoặc gọi thẳng Safe | onlySafe quản trị; session không phải enabled module của Safe | Tests admin và GS104 |
| Gửi token/shares/tiền rút đến ví lạ | Recipient/owner của thao tác được khóa vào Safe | Unit/fuzz recipient, vault recipient tests |
| Token/router/vault hoặc selector ngoài phạm vi | Mapping whitelist, typed entry points, không có raw call | Unit whitelist và arbitrary call tests |
| Chia nhỏ lệnh hoặc quay vòng session để lách cap | Shared rolling ledger, tổng đầu vào, không xóa khi đổi session/policy | Split-order unit/fuzz và rolling invariant |
| Giá cũ, giá 0, giá tương lai hoặc oracle revert | Kiểm tra giá/timestamp cả hai token; fail closed | Unit price tests |
| MinOut quá yếu hoặc router nói dối output | Policy-derived floor và đo balance delta | Unit minOut, adversarial router tests |
| Approve vô hạn/sai spender hoặc token trả false | Approve đúng lượng, reset 0, kiểm tra return/allowance | Approve adversarial tests và invariants |
| Router/vault revert sau khi đã approve/ghi cap | Cả lời gọi module revert; state on-chain rollback | Router/vault failure và hậu điều kiện tests |
| Callback gọi lồng để vượt cap | ReentrancyGuard ở mọi mutation | Router có session riêng vẫn không reenter được |
| Vault mint ít hoặc burn shares nhiều hơn báo cáo | Check actual Safe asset/share deltas và min/max shares | Adversarial vault tests |
| DoS bằng lịch sử chi rất dài | Ring 256 entry, fail closed; thời gian prune hữu hạn | History-full và expiry test |

## Giới hạn chưa được giải quyết

- Chưa kiểm chứng deployment Fuji, DEX thật, vault thật, fork mainnet, MEV hoặc oracle kinh tế độc lập.
- Cap chỉ tính swap; chưa giới hạn turnover vault hay tổng lỗ tích lũy qua nhiều lần deposit/withdraw có phí. Không coi cap swap là mức lỗ tối đa của quỹ.
- Biến động giá sau oracle update hoặc trong ngưỡng max age vẫn có thể gây giao dịch bất lợi trong slippage cho phép.
- Timestamp dựa vào block của chain, không phải đồng hồ máy người dùng; validator có ảnh hưởng trong giới hạn giao thức.
- Whitelisted vault có thể mất khả năng thanh toán, báo giá sai hoặc thay đổi implementation; module không bảo đảm lợi suất hay số tiền rút được trong tương lai.
- Sau revoke, tài sản trong vault vẫn nằm đó. Owner có thể rút trực tiếp bằng Safe; cấp session mới là một lựa chọn quản trị riêng.
- Thiết kế không có generic batch, signature delegation hay upgrade; các tính năng đó cần threat model mới.
- MockVault4626 có lãi theo thời gian mô phỏng; không đại diện APY sản phẩm thật. Test yield không chứng minh khả năng sinh lời thực tế.

Trước dùng tài sản thật cần review độc lập, kiểm tra cấu hình Safe/modules/allowances toàn bộ, giới hạn kinh tế vault và đánh giá oracle. Mục tiêu bản hiện tại là demo có thể tái hiện và bằng chứng kiểm tra phạm vi đã nêu.
