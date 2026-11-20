export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const value=await response.json();if(!response.ok)throw new ApiError(response.status,value.error??`HTTP ${response.status}`);return value as T;
}
export function post<T>(path:string,body:unknown,headers:Record<string,string>={}){return api<T>(path,{method:'POST',body:JSON.stringify(body),headers});}
export const money=(raw:string|undefined)=>{
  if(raw===undefined)return '—';const n=BigInt(raw);const absolute=n<0n?-n:n;const cents=(absolute+500000n)/1000000n;
  return `${n<0n?'−':''}$${(cents/100n).toLocaleString('en-US')}.${(cents%100n).toString().padStart(2,'0')}`;
};
export const short=(address:string|undefined)=>address?address.slice(0,6)+'…'+address.slice(-4):'—';
export const date=(time:string)=>new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(time));
export function usdRaw(value:string):string {
  if(!/^\d+(\.\d{1,8})?$/.test(value))throw new Error('USD cần là số không âm, tối đa 8 chữ số thập phân.');
  const [whole,fraction='']=value.split('.');return (BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'))).toString();
}
