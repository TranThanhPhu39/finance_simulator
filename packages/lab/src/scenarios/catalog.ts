import type { ScenarioDefinition } from '@repo/shared';
const rows: [string, string, ScenarioDefinition['category'], string, string, ScenarioDefinition['source']][] = [
  ['SC-01','Danh mục đã cân bằng','Normal','Agent không cần giao dịch.','NO_ACTION, không có giao dịch TEST và tài sản/cap không đổi.','AGENT_RULE'],
  ['SC-02','Tái cân bằng hợp lệ','Normal','Agent tự lập kế hoạch swap và gửi vault.','Receipt thành công, token và shares về Safe, cap khớp lượng swap.','AGENT_RULE'],
  ['SC-03','Đúng phần cap còn lại','Cap','Swap đúng hạn mức 100 USD.','Thành công, cap còn lại bằng 0.','DIRECT_SESSION_CALL'],
  ['SC-04','Một lệnh vượt cap','Cap','Thử swap 101 USD khi cap là 100 USD.','CapExceeded; tài sản, allowance và cap không đổi.','DIRECT_SESSION_CALL'],
  ['SC-05','Chia nhỏ vượt tổng cap','Cap','Lần lượt swap 60, 30 và 20 USD.','Hai lệnh đầu thành công; lệnh cuối bị chặn; spent = 90 USD.','DIRECT_SESSION_CALL'],
  ['SC-06','Biên rolling 24 giờ','Cap','Kiểm tra ngay trước và tại mốc hết hiệu lực.','Debit còn ở 24h−1s, hết hiệu lực đúng 24h.','DIRECT_SESSION_CALL'],
  ['SC-07','Token ngoài whitelist','Whitelist','Thử tokenIn và tokenOut chưa được duyệt.','TokenNotWhitelisted; không thay đổi tài sản/cap.','HARNESS_MUTATED'],
  ['SC-08','Router ngoài whitelist','Whitelist','Thay router bằng địa chỉ chưa duyệt.','RouterNotWhitelisted; không tạo allowance cho địa chỉ lạ.','HARNESS_MUTATED'],
  ['SC-09','Recipient là ví lạ','Whitelist','Đổi người nhận token đầu ra.','InvalidRecipient; ví lạ không nhận token.','HARNESS_MUTATED'],
  ['SC-10','Session hết hạn','Session','Thực thi tại thời điểm session hết hạn.','SessionExpired; không có swap mới.','DIRECT_SESSION_CALL'],
  ['SC-11','Session đã thu hồi','Session','Owner thu hồi rồi thử lệnh bằng session cũ.','SessionRevoked; tài sản/cap không đổi.','DIRECT_SESSION_CALL'],
  ['SC-12','Caller chưa được cấp quyền','Session','Một caller khác gửi lệnh hợp lệ.','UnauthorizedSession; tài sản/cap không đổi.','DIRECT_SESSION_CALL'],
  ['SC-13','Nguồn giá quá cũ','Price','Dùng giá có tuổi lớn hơn 3600 giây.','StalePrice; fail closed.','HARNESS_MUTATED'],
  ['SC-14','MinOut yếu hơn policy','Price','Đặt minOut bằng 0.','SlippageExceeded trước approve.','HARNESS_MUTATED'],
  ['SC-15','Router lỗi','Execution','Bật chế độ router mô phỏng thất bại.','ExecutionFailed → lỗi router; token/cap/allowance rollback.','DIRECT_SESSION_CALL'],
  ['SC-16','Vault ngoài whitelist','Vault','Gửi tiền tới vault chưa duyệt.','VaultNotWhitelisted; tài sản và allowance không đổi.','HARNESS_MUTATED'],
  ['SC-17','Rút vault về ví lạ','Vault','Chuẩn bị vị thế vault rồi đổi recipient rút tiền.','InvalidRecipient; shares Safe không đổi, ví lạ không nhận token.','HARNESS_MUTATED'],
];
export const scenarios: ScenarioDefinition[] = rows.map(([id,title,category,description,expectation,source]) =>
  ({ id,title,category,description,expectation,source,version:'1.0.0',environments:['local'] }));
export const listScenarios = () => structuredClone(scenarios);
