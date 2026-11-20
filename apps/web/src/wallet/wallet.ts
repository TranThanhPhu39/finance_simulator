import {createWalletClient,custom,http,type Address,type EIP1193Provider,type Hex} from 'viem';
import {foundry} from 'viem/chains';
declare global {interface Window {ethereum?:EIP1193Provider}}
export type ConnectedWallet={address:Address;mode:'extension'|'anvil';send:(to:Address,data:Hex)=>Promise<Hex>};
export async function connectWallet(mode:'extension'|'anvil',rpcUrl:string,owner:string):Promise<ConnectedWallet>{
  if(mode==='extension'){
    const provider=window.ethereum;if(!provider)throw new Error('Chưa tìm thấy ví trình duyệt. Có thể dùng ví Anvil cho demo local.');
    const accounts=await provider.request({method:'eth_requestAccounts'});const chain=await provider.request({method:'eth_chainId'});
    if(chain!=='0x7a69')throw new Error('Ví đang sai mạng. Chuyển sang Anvil chain 31337 rồi kết nối lại.');
    const address=accounts[0];if(!address||address.toLowerCase()!==owner.toLowerCase())throw new Error('Ví này không phải owner của Safe.');
    const client=createWalletClient({account:address,chain:foundry,transport:custom(provider)});
    return {address,mode,send:(to,data)=>client.sendTransaction({to,data,value:0n})};
  }
  if(!['localhost','127.0.0.1','[::1]'].includes(new URL(rpcUrl).hostname))throw new Error('Ví Anvil chỉ dùng loopback local.');
  const client=createWalletClient({account:owner as Address,chain:foundry,transport:http(rpcUrl)});
  if(await client.getChainId()!==31337)throw new Error('RPC sai mạng.');
  return {address:owner as Address,mode,send:(to,data)=>client.sendTransaction({to,data,value:0n})};
}
export function userRejected(error:unknown):boolean{
  let current=error;for(let i=0;i<10&&current&&typeof current==='object';i++){
    const item=current as {code?:number;cause?:unknown;name?:string};if(item.code===4001||item.name==='UserRejectedRequestError')return true;current=item.cause;
  }return false;
}
