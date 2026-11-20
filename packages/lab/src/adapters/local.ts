import { readFile } from 'node:fs/promises';
import { bytesToHex, encodeFunctionData, getAddress, parseAbi, parseAbiItem, type Address, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { PolicyClient, decodePolicyErrorDetails, POLICY_ABI, type ModuleTransaction } from '@repo/chain-client';
import { computeRebalancePlan, readPortfolioSnapshot, type PositionConfig } from '@repo/agent';
import type { ActionSource, ChainEvidence, EnvironmentInfo, TransactionEvidence, TreasuryView } from '@repo/shared';
import { ErrorCode } from '@repo/shared';

export const TOKEN_ABI = parseAbi(['function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function mint(address,uint256)', 'function approve(address,uint256) returns(bool)']);
export const ORACLE_ABI = parseAbi(['function setPrice(address,uint256)', 'function setPriceWithTimestamp(address,uint256,uint256)']);
export const ROUTER_ABI = parseAbi(['function setShouldFail(bool)']);
export const VAULT_ABI = parseAbi(['function convertToShares(uint256) view returns(uint256)', 'function accrueYield()']);
export const SAFE_ABI = parseAbi(['function getOwners() view returns(address[])', 'function getThreshold() view returns(uint256)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool success)']);
const ZERO = '0x0000000000000000000000000000000000000000';
export const json = (value: unknown) => JSON.stringify(value, (_k,v)=>typeof v==='bigint'?v.toString():v);
export function safeOwnerData(owner: Address, transaction: ModuleTransaction): Hex {
  const signature = ('0x'+owner.slice(2).padStart(64,'0')+'0'.repeat(64)+'01') as Hex;
  return encodeFunctionData({abi:SAFE_ABI,functionName:'execTransaction',args:[transaction.to,0n,transaction.data,0,0n,0n,0n,ZERO,ZERO,signature]});
}
class RpcError extends Error {
  constructor(message: string, public data?: unknown) { super(message); }
}
export class LocalAdapter {
  readonly client: PolicyClient;
  addresses!: Record<string, Address>;
  owner!: Address;
  session!: Address;
  outsider!: Address;
  source: ActionSource = 'DIRECT_SESSION_CALL';
  stage: TransactionEvidence['stage'] = 'SETUP';
  transactions: TransactionEvidence[] = [];
  private onTransaction: (tx:TransactionEvidence)=>void = ()=>{};
  constructor(readonly rpcUrl: string, readonly metadataPath: string) {
    if (!['127.0.0.1','localhost','[::1]'].includes(new URL(rpcUrl).hostname)) throw new Error('Lab local requires loopback RPC.');
    const account = mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:1});
    const key = account.getHdKey().privateKey;
    if (!key) throw new Error('Cannot derive public Anvil test session.');
    this.client = new PolicyClient('local',rpcUrl,bytesToHex(key));
  }
  async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},
      body:json({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json() as {error?:{message:string;data?:unknown};result:T};
    if (payload.error) throw new RpcError(payload.error.message,payload.error.data);
    return payload.result;
  }
  async connect() {
    await this.client.ensureNetwork();
    if (!(await this.rpc<string>('web3_clientVersion')).toLowerCase().includes('anvil')) throw new Error('Scenario reset is supported on Anvil only.');
    const metadata = JSON.parse(await readFile(this.metadataPath,'utf8'));
    if (metadata.environment!=='local'||metadata.chainId!==31337||!metadata.simulatedYield) throw new Error('Invalid local deployment metadata.');
    this.addresses = Object.fromEntries(Object.entries(metadata.addresses).map(([name,value])=>[name,getAddress(String(value))]));
    for (const name of ['Safe','PolicyModule','MockUSDC','MockTokenA','MockPriceOracle','MockRouter','MockVault4626']) {
      const address = this.addresses[name];
      if (!address||await this.rpc<string>('eth_getCode',[address,'latest'])==='0x') throw new Error(`Missing ${name} code; run local:prepare.`);
    }
    const [accounts,owners,threshold,safe] = await Promise.all([
      this.rpc<Address[]>('eth_accounts'),
      this.client.publicClient.readContract({address:this.addresses.Safe,abi:SAFE_ABI,functionName:'getOwners'}),
      this.client.publicClient.readContract({address:this.addresses.Safe,abi:SAFE_ABI,functionName:'getThreshold'}),
      this.client.readModule<Address>(this.addresses.PolicyModule,'safe'),
    ]);
    if (threshold!==1n||safe.toLowerCase()!==this.addresses.Safe.toLowerCase()) throw new Error('Demo requires a correctly bound threshold-1 Safe.');
    const owner = accounts.find(a=>owners.some(o=>o.toLowerCase()===a.toLowerCase()));
    if (!owner||accounts.length<3) throw new Error('Unlocked Anvil test owner/session required.');
    this.owner=getAddress(owner); this.session=getAddress(accounts[1]); this.outsider=getAddress(accounts[2]);
    if (this.client.walletClient?.account.address.toLowerCase()!==this.session.toLowerCase()) throw new Error('Expected default Anvil session account #1.');
    return this;
  }
  environment(): EnvironmentInfo {
    return {environment:'local',chainId:31337,ready:true,simulatedYield:true,addresses:this.addresses,owner:this.owner,
      session:this.session,rpcUrl:this.rpcUrl,capabilities:{scenarios:true,reset:true,rebalance:true,ownerWallet:true}};
  }
  resetEvidence(source:ActionSource,onTransaction:(tx:TransactionEvidence)=>void=()=>{}) {
    this.source=source; this.stage='SETUP'; this.transactions=[]; this.onTransaction=onTransaction;
  }
  private record(tx:TransactionEvidence) { this.transactions.push(tx); this.onTransaction(tx); }
  async send(label:string,from:Address,to:Address,data:Hex, expectedError?:ErrorCode): Promise<TransactionEvidence> {
    let observedError: string|undefined; let revertData: string|undefined;
    if(this.stage==='TEST') {
      try { await this.rpc('eth_call',[{from,to,data},'latest']); }
      catch(error) {
        const decoded = decodePolicyErrorDetails(error);
        if(decoded.code===ErrorCode.ERR_RPC_OR_ENV) throw new Error(`Cannot establish contract revert evidence for ${label}.`);
        observedError=decoded.code;
        if(error instanceof RpcError&&typeof error.data==='string') revertData=error.data;
      }
    }
    // Fixed gas avoids estimate-only rejection: negative tests produce REAL reverted receipts.
    const hash = await this.rpc<Hex>('eth_sendTransaction',[{from,to,data,gas:'0x7a1200'}]);
    let receipt: {status:Hex;blockNumber:Hex;gasUsed:Hex}|null=null;
    for(let i=0;i<100;i++) {
      receipt = await this.rpc('eth_getTransactionReceipt',[hash]);
      if(receipt) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!receipt) throw new Error(`Receipt unknown for ${hash}; do not retry automatically.`);
    const evidence:TransactionEvidence={label,stage:this.stage,source:this.stage==='SETUP'?'OWNER_SETUP':this.source,
      from,to,data,hash,blockNumber:Number(BigInt(receipt.blockNumber)),gasUsed:BigInt(receipt.gasUsed).toString(),
      receiptStatus:receipt.status==='0x1'?'success':'reverted',observedError,expectedError,revertData};
    this.record(evidence);
    if(this.stage==='SETUP'&&evidence.receiptStatus!=='success') throw new Error(`Setup failed: ${label}`);
    return evidence;
  }
  async ownerCall(label:string,transaction:ModuleTransaction) {
    return this.send(label,this.owner,this.addresses.Safe,safeOwnerData(this.owner,transaction));
  }
  async govern(name:string,args:readonly unknown[]) {
    return this.ownerCall(name,{to:this.addresses.PolicyModule,data:encodeFunctionData({abi:POLICY_ABI,functionName:name,args})});
  }
  async setup() {
    this.stage='SETUP';
    await this.rpc('evm_increaseTime',[86401]); await this.rpc('evm_mine');
    const now=Number((await this.client.publicClient.getBlock()).timestamp);
    await this.govern('setPaused',[false]);
    await this.govern('setPolicy',[{cap24hUsd:10000000000n,maxPriceAgeSec:3600,maxSlippageBps:100}]);
    await this.govern('grantSession',[this.session,BigInt(now+7*86400)]);
    for(const token of [this.addresses.MockUSDC,this.addresses.MockTokenA]) await this.govern('setTokenAllowed',[token,true]);
    await this.govern('setRouterAllowed',[this.addresses.MockRouter,true]);
    await this.govern('setVaultAllowed',[this.addresses.MockVault4626,true]);
    await this.send('Router healthy',this.owner,this.addresses.MockRouter,encodeFunctionData({abi:ROUTER_ABI,functionName:'setShouldFail',args:[false]}));
    await this.refreshPrices();
    for(const [token,min] of [[this.addresses.MockUSDC,600000000n],[this.addresses.MockTokenA,40000000000000000000n]] as const) {
      const balance=await this.client.readTokenBalance(token,this.addresses.Safe);
      if(balance<min) await this.send('Seed mock token',this.owner,token,encodeFunctionData({abi:TOKEN_ABI,functionName:'mint',args:[this.addresses.Safe,min-balance]}));
    }
  }
  async refreshPrices() {
    for(const [token,price] of [[this.addresses.MockUSDC,100000000n],[this.addresses.MockTokenA,1000000000n]] as const)
      await this.send('Refresh mock price',this.owner,this.addresses.MockPriceOracle,encodeFunctionData({abi:ORACLE_ABI,functionName:'setPrice',args:[token,price]}));
  }
  async capture():Promise<ChainEvidence> {
    const block=await this.client.publicClient.getBlock(); const blockNumber=block.number;
    const a=this.addresses;
    const balancePairs = [['safeUsdc',a.MockUSDC,a.Safe],['safeTokenA',a.MockTokenA,a.Safe],['safeVaultShares',a.MockVault4626,a.Safe],
      ['outsiderUsdc',a.MockUSDC,this.outsider],['outsiderTokenA',a.MockTokenA,this.outsider],['outsiderVaultShares',a.MockVault4626,this.outsider],['routerUsdc',a.MockUSDC,a.MockRouter]];
    const balances=Object.fromEntries(await Promise.all(balancePairs.map(async([key,token,owner])=>
      [key,(await this.client.readTokenBalance(token as Address,owner as Address,blockNumber)).toString()])));
    const allowances=Object.fromEntries(await Promise.all([['usdcRouter',a.MockUSDC,a.MockRouter],['tokenRouter',a.MockTokenA,a.MockRouter],
      ['usdcVault',a.MockUSDC,a.MockVault4626],['usdcOutsider',a.MockUSDC,this.outsider]].map(async([key,token,spender])=>[key,
        (await this.client.publicClient.readContract({address:token as Address,abi:TOKEN_ABI,functionName:'allowance',args:[a.Safe,spender as Address],blockNumber})).toString()])));
    const [spent,policy,session,paused]=await Promise.all([
      this.client.readModule<bigint>(a.PolicyModule,'readSpent24hUsd',[],blockNumber),
      this.client.readModule<{cap24hUsd:bigint;maxPriceAgeSec:number;maxSlippageBps:number}>(a.PolicyModule,'readPolicy',[],blockNumber),
      this.client.readModule<{expiresAt:bigint;revoked:boolean}>(a.PolicyModule,'readSession',[this.session],blockNumber),
      this.client.readModule<boolean>(a.PolicyModule,'paused',[],blockNumber)]);
    return {blockNumber:Number(blockNumber),blockHash:block.hash!,timestamp:Number(block.timestamp),balances,allowances,spent24hUsd:spent.toString(),
      policy:{...policy,cap24hUsd:policy.cap24hUsd.toString()},session:{expiresAt:session.expiresAt.toString(),revoked:session.revoked},paused};
  }
  async treasury(targets=[2000,3000,5000]):Promise<TreasuryView> {
    const a=this.addresses;
    const config:PositionConfig[]=[{tokenAddress:a.MockUSDC,symbol:'USDC',targetBps:targets[0]},
      {tokenAddress:a.MockTokenA,symbol:'A',targetBps:targets[1]},
      {tokenAddress:a.MockUSDC,vaultAddress:a.MockVault4626,symbol:'vUSDC',targetBps:targets[2]}];
    const portfolio=await readPortfolioSnapshot(this.client,a.Safe,a.MockPriceOracle,config,3600);
    const policy=await this.client.readPolicyConfig(a.PolicyModule,this.session,{tokens:[a.MockUSDC,a.MockTokenA],routers:[a.MockRouter],vaults:[a.MockVault4626]},BigInt(portfolio.blockNumber));
    let vaultYield:TreasuryView['vaultYield'];
    try {
      const [deposits,withdrawals,transfers]=await Promise.all([
        this.client.publicClient.getLogs({address:a.MockVault4626,event:parseAbiItem('event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)'),
          args:{owner:a.Safe},fromBlock:0n,toBlock:BigInt(portfolio.blockNumber)}),
        this.client.publicClient.getLogs({address:a.MockVault4626,event:parseAbiItem('event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)'),
          args:{owner:a.Safe},fromBlock:0n,toBlock:BigInt(portfolio.blockNumber)}),
        this.client.publicClient.getLogs({address:a.MockVault4626,event:parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)'),fromBlock:0n,toBlock:BigInt(portfolio.blockNumber)}),
      ]);
      const external=transfers.some(t=>t.args.from!==ZERO&&t.args.to!==ZERO&&[t.args.from?.toLowerCase(),t.args.to?.toLowerCase()].includes(a.Safe.toLowerCase()));
      if(external) vaultYield={available:false,reason:'Có chuyển shares ngoài deposit/withdraw; thiếu giá vốn.'};
      else {const amount=BigInt(portfolio.positions[2].rawBalance)+withdrawals.reduce((s,l)=>s+(l.args.assets??0n),0n)-deposits.reduce((s,l)=>s+(l.args.assets??0n),0n);
        vaultYield={available:true,assetsRaw:amount.toString(),valueUsd:(amount*BigInt(portfolio.positions[2].priceUsd)/1000000n).toString()};}
    }catch{vaultYield={available:false,reason:'Chưa đọc đủ lịch sử vault để tính lãi.'};}
    return {environment:this.environment(),portfolio,policy,targets,vaultYield};
  }
  async preview(targets?:number[]) { const view=await this.treasury(targets);
    return {...view,plan:computeRebalancePlan(view.portfolio,view.policy,this.addresses.MockRouter,this.addresses.MockUSDC)}; }
  swapData(amount:bigint,changes:Record<string,unknown>={}):Hex {
    return encodeFunctionData({abi:POLICY_ABI,functionName:'executeSwap',args:[{router:this.addresses.MockRouter,tokenIn:this.addresses.MockUSDC,
      tokenOut:this.addresses.MockTokenA,amountIn:amount,minAmountOut:amount*100000000000n*99n/100n,recipient:this.addresses.Safe,
      deadline:BigInt(Math.floor(Date.now()/1000)+30*86400),...changes}]});
  }
  async swap(amount:bigint,expectedError?:ErrorCode,changes:Record<string,unknown>={},caller=this.session) {
    // Timestamp follows CHAIN time, including scenarios that warp it.
    const deadline=(await this.client.publicClient.getBlock()).timestamp+3600n;
    return this.send(`Swap ${amount} raw USDC`,caller,this.addresses.PolicyModule,this.swapData(amount,{deadline,...changes}),expectedError);
  }
}
