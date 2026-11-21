// Simulation never asks a browser wallet to send transactions to fixture addresses.
export interface WalletState {
  connected: boolean;
  address: string | null;
  chainId: number | null;
  hasProvider: boolean;
  notice: string | null;
}
export async function connectOwnerWallet(): Promise<WalletState> {
  return {
    connected: true,
    address: "0x1000000000000000000000000000000000000001",
    chainId: 31337,
    hasProvider: false,
    notice:
      "Owner mô phỏng đã sẵn sàng. Chuyển sang On-chain Anvil để ký giao dịch thật.",
  };
}
export async function sendOwnerTransactionIfPossible(
  _wallet: WalletState,
  _tx: { to: string; data: string },
) {
  return {
    sentOnchain: false,
    txHash: undefined as string | undefined,
    message: "Đã cập nhật mô phỏng; không gửi giao dịch blockchain.",
  };
}
