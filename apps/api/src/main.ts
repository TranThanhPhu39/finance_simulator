import { createApplication } from './server';
async function main(){
  const app=await createApplication({database:process.env.API_DATABASE_PATH});const port=Number(process.env.API_PORT??8787);
  app.server.listen(port,'127.0.0.1',()=>console.log(`Treasury API http://127.0.0.1:${port}`));
  let closing=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(closing)return;closing=true;app.close().then(()=>{process.exitCode=0;}).catch(error=>{console.error(error);process.exitCode=1;});});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
