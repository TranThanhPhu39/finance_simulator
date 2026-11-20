import { createServer,type IncomingMessage,type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile,stat } from 'node:fs/promises';
import { resolve,sep,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData,getAddress,type Address,type Hex } from 'viem';
import { POLICY_ABI } from '@repo/chain-client';
import { LocalAdapter,SAFE_ABI,safeOwnerData,listScenarios,newRun,toCsv,json } from '@repo/lab';
import type { EnvironmentInfo } from '@repo/shared';
import { Store,Conflict,type Governance } from './db/store';
import { RunQueue } from './worker/queue';

export const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
function only(input:Record<string,unknown>,fields:string[]){if(Object.keys(input).some(k=>!fields.includes(k)))throw new HttpError(400,'Request có field không được hỗ trợ. Không gửi khóa bí mật vào API.');}
function targets(value:unknown):number[]{if(!Array.isArray(value)||value.length!==3||value.some(v=>!Number.isInteger(v)||v<0||v>10000)||value.reduce((s,n)=>s+n,0)!==10000)throw new HttpError(400,'Tỷ trọng phải là 3 số nguyên bps, tổng 10000.');return value;}
async function body(req:IncomingMessage):Promise<Record<string,unknown>> {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'Cần Content-Type application/json.');
  let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536)throw new HttpError(413,'Request quá lớn.');}
  try{const value=JSON.parse(text||'{}');if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;}catch{throw new HttpError(400,'JSON không hợp lệ.');}
}
export interface AppOptions {database?:string;rpcUrl?:string;metadata?:string;webDist?:string;allowedOrigins?:string[]}
export async function createApplication(options:AppOptions={}) {
  const store=new Store(options.database??resolve(ROOT,'.runtime/treasury.db'));
  const adapter=()=>new LocalAdapter(options.rpcUrl??process.env.LOCAL_RPC_URL??'http://127.0.0.1:8545',options.metadata??resolve(ROOT,'deployments/local.json'));
  const queue=new RunQueue(store,adapter);await queue.start();
  const allowedOrigins=options.allowedOrigins??['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8787','http://localhost:8787'];
  const webDist=options.webDist??resolve(ROOT,'apps/web/dist');
  const visibleLease=()=>{const owner=store.lockOwner('chain');return owner?.startsWith('read:')?undefined:owner;};
  async function environment():Promise<EnvironmentInfo&{busy?:string;pendingGovernance?:Governance[]}> {
    try{const a=await adapter().connect();return {...a.environment(),busy:visibleLease(),pendingGovernance:store.pendingGovernance()};}
    catch(error){return {environment:'local',chainId:31337,ready:false,reason:error instanceof Error?error.message:'Local environment unavailable',simulatedYield:true,
      addresses:{},capabilities:{scenarios:false,reset:false,rebalance:false,ownerWallet:false},busy:visibleLease(),pendingGovernance:store.pendingGovernance()};}
  }
  async function withRead<T>(action:(a:LocalAdapter)=>Promise<T>):Promise<T> {
    const owner='read:'+randomUUID();if(!store.lock('chain',owner))throw new Conflict('Môi trường đang chạy kiểm thử/giao dịch; thử lại sau.');
    try{return await action(await adapter().connect());}finally{store.unlock('chain',owner);}
  }
  const server=createServer(async(req,res)=>{
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(json(value));};
    try {
      const host=(req.headers.host??'').split(':')[0];if(!['localhost','127.0.0.1'].includes(host))throw new HttpError(403,'Local host required.');
      const origin=req.headers.origin;
      if(origin&&!allowedOrigins.includes(origin))throw new HttpError(403,'Origin không được phép.');
      if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Idempotency-Key'});res.end();return;}
      const url=new URL(req.url??'/',`http://${req.headers.host}`);const path=url.pathname.replace(/^\/api(?=\/)/,'');
      if(req.method==='GET'&&path==='/health'){send(200,{status:'ok',version:'hoang-1.0.0'});return;}
      if(req.method==='GET'&&path==='/environment'){send(200,await environment());return;}
      if(req.method==='GET'&&path==='/scenarios'){send(200,listScenarios());return;}
      if(req.method==='GET'&&path==='/treasury'){send(200,await withRead(a=>a.treasury(store.targets())));return;}
      if(req.method==='PUT'&&path==='/targets'){const input=await body(req);only(input,['targets']);const values=targets(input.targets);store.setTargets(values);send(200,{targets:values});return;}
      if(req.method==='POST'&&path==='/rebalance/preview'){const input=await body(req);only(input,['targets']);send(200,await withRead(a=>a.preview(input.targets===undefined?store.targets():targets(input.targets))));return;}
      if(req.method==='GET'&&path==='/runs'){send(200,store.list());return;}
      if(req.method==='POST'&&path==='/runs'){
        const input=await body(req);const key=req.headers['idempotency-key'];
        only(input,['kind','environment','scenarioIds']);
        if(typeof key!=='string'||!/^[\w-]{8,128}$/.test(key))throw new HttpError(400,'Cần Idempotency-Key 8–128 ký tự.');
        if(!['SCENARIO','REBALANCE'].includes(String(input.kind))||!['local','fuji'].includes(String(input.environment)))throw new HttpError(400,'kind/environment không hợp lệ.');
        let runs;
        if(input.kind==='SCENARIO'){
          const ids=input.scenarioIds;
          if(!Array.isArray(ids)||ids.length<1||ids.length>17||new Set(ids).size!==ids.length||ids.some(id=>!listScenarios().some(s=>s.id===id)))throw new HttpError(400,'Chọn 1–17 scenario IDs duy nhất.');
          runs=ids.map(id=>newRun('SCENARIO',input.environment as 'local'|'fuji',String(id)));
        }else runs=[{...newRun('REBALANCE',input.environment as 'local'|'fuji'),targets:store.targets()}];
        const ids=store.createRequest(key,json(input),runs);queue.pump();send(202,{runIds:ids});return;
      }
      const runMatch=path.match(/^\/runs\/([\w-]+)(\/export)?$/);
      if(req.method==='GET'&&runMatch){
        const run=store.get(runMatch[1]);if(!run)throw new HttpError(404,'Không tìm thấy lượt chạy.');
        if(runMatch[2]){const csv=url.searchParams.get('format')==='csv';res.writeHead(200,{'Content-Type':csv?'text/csv; charset=utf-8':'application/json; charset=utf-8',
          'Content-Disposition':`attachment; filename="run-${run.id}.${csv?'csv':'json'}"`,'Cache-Control':'no-store'});res.end(csv?'\uFEFF'+toCsv(run):json(run));return;}
        send(200,run);return;
      }
      if(req.method==='POST'&&path==='/governance/prepare'){
        const input=await body(req);if(!['grant','revoke','policy'].includes(String(input.action)))throw new HttpError(400,'Action không hợp lệ.');
        only(input,['requestId','owner','action','hours','cap24hUsd','maxPriceAgeSec','maxSlippageBps']);
        if(typeof input.owner!=='string'||typeof input.requestId!=='string'||!/^[\w-]{8,128}$/.test(input.requestId))throw new HttpError(400,'Cần owner và requestId.');
        let owner:Address;try{owner=getAddress(input.owner);}catch{throw new HttpError(400,'Địa chỉ owner không hợp lệ.');}
        const id=input.requestId;const existing=store.getGovernance(id);if(existing){if(existing.fingerprint!==json(input))throw new Conflict('Request ID đã dùng với nội dung khác.');send(200,existing);return;}
        if(!store.lock('chain','gov:'+id))throw new Conflict('Môi trường đang bận; chờ lượt hiện tại xong.');
        try {
          const a=await adapter().connect();if(owner.toLowerCase()!==a.owner.toLowerCase())throw new HttpError(403,'Ví kết nối không phải owner của Safe demo.');
          let data:Hex;
          if(input.action==='revoke')data=a.client.buildRevokeSessionTransaction(a.addresses.PolicyModule,a.session).data;
          else if(input.action==='grant'){
            const hours=input.hours??24;if(!Number.isInteger(hours)||Number(hours)<1||Number(hours)>168)throw new HttpError(400,'Thời hạn session 1–168 giờ.');
            data=a.client.buildGrantSessionTransaction(a.addresses.PolicyModule,a.session,(await a.client.publicClient.getBlock()).timestamp+BigInt(Number(hours)*3600)).data;
          }else{
            if(typeof input.cap24hUsd!=='string'||!/^\d{1,58}$/.test(input.cap24hUsd)||BigInt(input.cap24hUsd)>2n**192n-1n
              ||!Number.isInteger(input.maxPriceAgeSec)||Number(input.maxPriceAgeSec)<1||Number(input.maxPriceAgeSec)>86400
              ||!Number.isInteger(input.maxSlippageBps)||Number(input.maxSlippageBps)<0||Number(input.maxSlippageBps)>1000)throw new HttpError(400,'Cap/slippage/tuổi giá ngoài phạm vi.');
            data=encodeFunctionData({abi:POLICY_ABI,functionName:'setPolicy',args:[{cap24hUsd:BigInt(input.cap24hUsd),maxPriceAgeSec:input.maxPriceAgeSec,maxSlippageBps:input.maxSlippageBps}]});
          }
          const g:Governance={id,owner,to:a.addresses.Safe,data:safeOwnerData(owner,{to:a.addresses.PolicyModule,data}),action:String(input.action),
            status:'PREPARED',createdAt:new Date().toISOString(),fingerprint:json(input)};store.saveGovernance(g);send(200,g);return;
        }catch(error){store.unlock('chain','gov:'+id);throw error;}
      }
      const govMatch=path.match(/^\/governance\/([\w-]+)\/(confirm|cancel)$/);
      if(req.method==='POST'&&govMatch){
        const g=store.getGovernance(govMatch[1]);if(!g)throw new HttpError(404,'Không có yêu cầu ký này.');const input=await body(req);
        if(g.status!=='PREPARED'){send(200,g);return;}
        if(govMatch[2]==='cancel'){
          if(input.walletRejected!==true||g.hash)throw new Conflict('Không hủy giao dịch đã gửi hoặc không rõ kết quả.');
          g.status='CANCELLED';store.saveGovernance(g);store.unlock('chain','gov:'+g.id);queue.pump();send(200,g);return;
        }
        if(typeof input.hash!=='string'||!/^0x[\da-f]{64}$/i.test(input.hash))throw new HttpError(400,'Hash không hợp lệ.');
        if(g.hash&&g.hash!==input.hash)throw new Conflict('Yêu cầu này đã gắn với hash khác.');
        const a=await adapter().connect();
        const tx=await a.client.publicClient.getTransaction({hash:input.hash as Hex});
        if(tx.from.toLowerCase()!==g.owner.toLowerCase()||tx.to?.toLowerCase()!==g.to.toLowerCase()||tx.input.toLowerCase()!==g.data.toLowerCase()||tx.value!==0n)throw new HttpError(400,'Giao dịch không khớp yêu cầu owner.');
        g.hash=input.hash;store.saveGovernance(g);
        let receipt;try{receipt=await a.client.publicClient.getTransactionReceipt({hash:input.hash as Hex});}catch{send(202,g);return;}
        g.status='CONFIRMED';g.receiptStatus=receipt.status;store.saveGovernance(g);store.unlock('chain','gov:'+g.id);queue.pump();
        send(200,{...g,receiptStatus:receipt.status});return;
      }
      if(req.method==='GET'&&!url.pathname.startsWith('/api/')){
        const requested=resolve(webDist,'.'+decodeURIComponent(url.pathname));if(requested!==webDist&&!requested.startsWith(webDist+sep))throw new HttpError(403,'Invalid asset path.');
        let file=requested;try{if(!(await stat(file)).isFile())file=resolve(webDist,'index.html');}catch{file=resolve(webDist,'index.html');}
        const content=await readFile(file);const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
        res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(content);return;
      }
      throw new HttpError(404,'Endpoint không tồn tại.');
    }catch(error){const code=error instanceof HttpError?error.status:error instanceof Conflict?409:503;send(code,{error:error instanceof Error?error.message:'Lỗi dịch vụ'});}
  });
  return {server,store,queue,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await queue.close();store.close();}};
}
