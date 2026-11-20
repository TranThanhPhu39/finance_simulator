export interface WalletState {
  connected: boolean;
  address: string | null;
  chainId: number | null;
  hasProvider: boolean;
  notice: string | null;
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<any>;
    };
  }
}

export async function connectOwnerWallet(): Promise<WalletState> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return {
      connected: true,
      address: '0x1000000000000000000000000000000000000001',
      chainId: 31337,
      hasProvider: false,
      notice: 'Không phát hiện tiện ích ví (MetaMask/Core). Đã kích hoạt Ví Owner Mô phỏng (Simulated Safe Owner) để bạn thao tác đầy đủ.'
    };
  }

  try {
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    const chainHex = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
    const chainId = parseInt(chainHex, 16);
    return {
      connected: accounts.length > 0,
      address: accounts[0] ?? null,
      chainId,
      hasProvider: true,
      notice: `Đã kết nối ví Web3 (${chainId === 43113 ? 'Avalanche Fuji' : chainId === 31337 ? 'Anvil Local' : `Chain ${chainId}`}).`
    };
  } catch (err) {
    return {
      connected: false,
      address: null,
      chainId: null,
      hasProvider: true,
      notice: `Người dùng từ chối kết nối ví hoặc có lỗi: ${err instanceof Error ? err.message : String(err)}. Vẫn có thể thao tác ở chế độ Simulated.`
    };
  }
}

export async function sendOwnerTransactionIfPossible(
  wallet: WalletState,
  tx: { to: string; data: string }
): Promise<{ sentOnchain: boolean; txHash?: string; message: string }> {
  if (wallet.hasProvider && wallet.connected && wallet.address && typeof window !== 'undefined' && window.ethereum) {
    try {
      const hash = (await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: wallet.address,
            to: tx.to,
            data: tx.data,
            value: '0x0'
          }
        ]
      })) as string;
      return {
        sentOnchain: true,
        txHash: hash,
        message: `Đã gửi giao dịch on-chain qua ví Owner: ${hash}`
      };
    } catch {
      return {
        sentOnchain: false,
        message: 'Ví Web3 không gửi giao dịch on-chain (đã áp dụng trực tiếp trên trạng thái Simulated Policy).'
      };
    }
  }
  return {
    sentOnchain: false,
    message: 'Đã thực thi thành công trên PolicyModule (Chế độ Simulated Safe Owner).'
  };
}
