# Chuẩn bị demo Fuji

Ngày: 2026-11-14. RPC công khai đã được kiểm tra read-only trả chainId 43113. Chưa broadcast vì workspace chưa có FUJI_DEPLOYER_PRIVATE_KEY hoặc SESSION_ADDRESS cho ví thử nghiệm. Không có địa chỉ/hash Fuji để công bố.

Script `contracts/script/DeployFuji.s.sol` đã build, dùng cùng đường triển khai đã chạy local. Khóa chain vào 43113 và chỉ đọc biến `FUJI_DEPLOYER_PRIVATE_KEY`, tách khỏi khóa deploy local.

## Dữ liệu cần cấu hình trên máy

1. Ví testnet riêng có đủ AVAX test trả phí gas; không dùng ví giữ tài sản thật.
2. Session key riêng; chỉ cần địa chỉ công khai ở SESSION_ADDRESS khi deploy.
3. Cấu hình FUJI_DEPLOYER_PRIVATE_KEY, SESSION_ADDRESS, FUJI_RPC_URL trong terminal local. Không gửi private key/mnemonic vào chat, không đưa vào Git hoặc log.

## Lệnh triển khai khi có cấu hình

```powershell
# Các biến khóa/địa chỉ đã được cấu hình trong terminal local trước đó.
$env:FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc"
cast chain-id --rpc-url $env:FUJI_RPC_URL
cd contracts
# Chạy mô phỏng trước, chưa gửi giao dịch.
forge script script/DeployFuji.s.sol:DeployFuji --rpc-url $env:FUJI_RPC_URL
# Sau khi mô phỏng thành công, triển khai demo testnet.
forge script script/DeployFuji.s.sol:DeployFuji --rpc-url $env:FUJI_RPC_URL --broadcast --non-interactive
cd ..
Remove-Item Env:FUJI_DEPLOYER_PRIVATE_KEY
```

Mọi token, oracle, router và vault được deploy là mock. Có public mint/setPrice/yield mô phỏng; không đại diện tài sản/lợi suất thật hay tích hợp Aave/Benqi. Không dùng khóa thử nghiệm công khai của Anvil trên Fuji.

Trước khi ghi `deployments/fuji.json`, cần xác minh receipt/payload/code, Safe owner/module, policy/whitelist/session và số dư trên chain. Recorder local từ chối Fuji, không dùng nó để ghi địa chỉ testnet. Bước nghiệm thu tiếp theo là agent dùng session riêng chạy swap/deposit/withdraw và revoke trên Fuji, lưu bằng chứng đúng mạng.

Nếu chưa cấu hình ví testnet, dừng ở bước chuẩn bị; kết quả local không được đổi nhãn thành Fuji.
